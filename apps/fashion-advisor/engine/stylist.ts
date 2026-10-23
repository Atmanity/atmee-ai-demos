// The stylist: one user's session, from the name to the last try-on. It owns
// the truth (the photo, what is on it, the read, the pieces, what was tried)
// and runs the slow work (reads, try-ons) as jobs on one serial queue, as the
// original worker did, so a read always belongs to the image it was made from.
//
// Framework-free: the model calls come in through `Models` (server.ts wires
// Gemini and xAI; the tests wire fakes), and everything it says goes out as
// texts from director.ts (fitting.ts turns them into tool results and events).
import { say } from './director.ts';
import {
  ALL_BODY_ZONES, buildAmazonSearchUrl, buildAmazonShopLinks, buildItemAttributes, CURRENT_LOOK_LABEL, cleanSingleLine, inferItemBodyZone,
  isNonGarmentSelfReference, itemsMatch, markItemTried, resolveSuggestionItemName, titleCase, withThumbnails, ZONE_WORDS, type AmazonConfig,
} from './items.ts';
import { looksLikeNonName, MAX_NAME_ATTEMPTS, MAX_PHOTO_CONSENT_ASKS } from './judge.ts';
import { FALLBACK_SUGGESTIONS, tryOnPrompt, type CleanAnalysis } from './prompts.ts';
import { normalizeStyleCategory, stylePhraseKey, targetStyleBrief } from './style.ts';
import type { Analysis, Command, Img, Jobs, Milestone, Outcome, SayEvent, ShopLink, Step, Suggestion, View, Zone } from './types.ts';

/**
 * How many suggestions the board keeps. Three taps of "More ideas" past the
 * opening six. The original capped it because the whole list was replayed on
 * every panel remount and the shell silently dropped a reply over 32 KiB; here
 * the whole list is in every view the page polls and in the avatar's state,
 * so the same bound keeps both comfortably small. The earliest are kept: they
 * are the cards already on screen.
 */
export const MAX_TRACKED_SUGGESTIONS = 18;
const MAX_IMAGES = 12;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

export interface ReadInput { userName: string; target: string; context: string }

export interface Models {
  /** The style read of an image, or null when it did not come through (after retries). */
  analyze(image: Img, input: ReadInput): Promise<CleanAnalysis | null>;
  /** The body zones visible in an image; all of them on any doubt. */
  zones(image: Img): Promise<Set<Zone>>;
  /** Up to six pieces for the target; [] on failure. */
  suggest(input: { image: Img | null; zones: Set<Zone>; target: string; recent: string[] }): Promise<{ item: string; text: string }[]>;
  /** The image with the piece added; null when the answer was unusable; throws when the call failed. */
  tryOn(image: Img, prompt: string): Promise<Img | null>;
  /** Whether an image model is configured at all. */
  readonly tryOnAvailable: boolean;
}

/** Catalogue shots for the suggestion cards, shared by every session (server.ts). */
export interface Thumbnails {
  ensure(items: string[]): void;
  /** The URL once rendered, by lower-cased name. */
  url(key: string): string | undefined;
  /** How many of these items are still rendering. */
  pending(items: string[]): number;
}

export interface StylistOptions {
  /** The page-facing URL of a stored image token. */
  imageUrl: (token: string) => string;
  thumbnails?: Thumbnails;
  amazon?: AmazonConfig;
  newId?: () => string;
}

interface Stored { token: string; img: Img }
interface Shown extends Stored { item: string; kind: 'look' | 'tryon'; shopLinks?: ShopLink[] }

interface Deferred { promise: Promise<Outcome>; resolve: (o: Outcome) => void; settled: boolean }
interface JobRecord { id: string; milestones: Map<Milestone, Deferred> }

const deferred = (): Deferred => {
  let resolve!: (o: Outcome) => void;
  const promise = new Promise<Outcome>((r) => { resolve = r; });
  const d: Deferred = { promise, settled: false, resolve: (o) => { if (!d.settled) { d.settled = true; resolve(o); } } };
  return d;
};

let counter = 0;
const defaultId = () => `${Date.now().toString(36)}${(++counter).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export class Stylist {
  // who, and what for
  name = '';
  nameSkipped = false;
  nameAsks = 0;
  target = '';
  category = '';
  // the photo
  photoDeclined = false;
  photoAsks = 0;
  wantsPhoto = false;
  describedOutfit = '';
  /** A piece asked for before there was a photo; offered first once there is one. */
  wish = '';
  base: (Stored & { zones: Set<Zone> }) | null = null;
  current: Shown | null = null;
  zones = new Set<Zone>(ALL_BODY_ZONES);
  tried: string[] = [];
  latestItem = '';
  analysis: Analysis | null = null;
  notice: View['notice'] = null;
  jobs: Jobs = { photo: false, analysing: false, tryOn: null, queued: [], more: false };
  rev = 0;
  /** When the session was last used, for the server's cleanup. */
  at = Date.now();

  private images = new Map<string, Img>();
  private queue: Promise<unknown> = Promise.resolve();
  private jobRecords = new Map<string, JobRecord>();
  private tryOnEpoch = 0;
  /**
   * Each picture's verdict per occasion. The same outfit for the same occasion
   * always gets the same score: live, "rate it again" on an unchanged photo
   * moved it from 7 to 5 with a different fix. A new photo, a piece put on or
   * another occasion is a new reading; a pieces direction is not.
   */
  private readings = new Map<string, CleanAnalysis>();
  /** Which picture and occasion the verdict on screen is for. */
  private readOf = '';
  private lines = 0;   // rotates the example lines the original picked at random

  constructor(private models: Models, private opts: StylistOptions) {}

  // -- what the page and the avatar see ------------------------------------------

  get step(): Step {
    if (!this.name && !this.nameSkipped) return 'name';
    if (!this.target) return 'style';
    if (!this.base && !this.photoDeclined) return 'photo';
    return 'styling';
  }

  image(token: string): Img | undefined { return this.images.get(token); }

  view(): View {
    const thumbs = this.opts.thumbnails;
    const analysis = this.analysis && thumbs
      ? { ...this.analysis, suggestions: withThumbnails(this.analysis.suggestions, (key) => thumbs.url(key)) }
      : this.analysis;
    const items = this.analysis?.suggestions.map((s) => s.item) ?? [];
    return {
      rev: this.rev,
      step: this.step,
      name: this.name,
      nameSkipped: this.nameSkipped,
      target: this.target,
      category: this.category,
      photo: this.base ? 'present' : this.photoDeclined ? 'declined' : 'none',
      describedOutfit: this.describedOutfit,
      image: this.current ? { url: this.opts.imageUrl(this.current.token), item: this.current.item, kind: this.current.kind, ...(this.current.shopLinks ? { shop_links: this.current.shopLinks } : {}) } : null,
      analysis,
      visibleZones: ALL_BODY_ZONES.filter((z) => this.zones.has(z)),
      latestItem: this.latestItem,
      jobs: { ...this.jobs, queued: [...this.jobs.queued] },
      notice: this.notice,
      tryOnAvailable: this.models.tryOnAvailable,
      thumbnailsPending: thumbs ? thumbs.pending(items) : 0,
      canLoadMore: Boolean(this.analysis) && items.length < MAX_TRACKED_SUGGESTIONS,
      nameAsks: this.nameAsks,
      photoAsks: this.photoAsks,
      wantsPhoto: this.wantsPhoto,
    };
  }

  /** Wait for a job's milestone; undefined for an unknown job or milestone. */
  wait(jobId: string, milestone: Milestone): Promise<Outcome> | undefined {
    return this.jobRecords.get(jobId)?.milestones.get(milestone)?.promise;
  }

  targetBrief() { return targetStyleBrief(this.target, this.category); }
  isVisible(item: string) { return this.zones.has(inferItemBodyZone(item)); }

  // -- acting ------------------------------------------------------------------------

  /** Do what a command asks. Quick things are done on return; slow ones return a job to wait on. */
  act(c: Command): Outcome {
    this.at = Date.now();
    if (c.type !== 'chat') this.notice = null;
    switch (c.type) {
      case 'name': return this.setName(c.name, c.style);
      case 'skipName': {
        this.nameSkipped = true;
        this.touch();
        return this.out(true, [say.nameSkipped()]);
      }
      case 'style':
        if (this.step === 'styling' && this.current) return this.retarget(c.style);
        return this.setStyle(c.style);
      case 'photoYes':
        if (this.base) return this.out(true, []);
        this.wantsPhoto = true;
        this.touch();
        return this.out(true, [say.photoHow()]);
      case 'declinePhoto':
        if (this.base) return this.out(true, []);
        this.photoDeclined = true;
        this.wantsPhoto = false;
        this.touch();
        return this.out(true, [say.photoDeclined(this.view())]);
      case 'photo': return this.takePhoto(c.mime, c.data);
      case 'tryOn': return this.tryOn(c.item, c.text ?? '');
      case 'more': return this.more(Boolean(c.quiet));
      case 'rerate':
        if (!this.current) return this.out(true, [say.needsRead('for a fresh rating')]);
        return this.queued(['done'], () => this.read({ context: 'Manual refresh requested by user' }));
      case 'retarget': return this.current ? this.retarget(c.style) : this.setStyle(c.style);
      case 'steer': return this.steer(c.style);
      case 'retake':
        this.wantsPhoto = true;
        this.touch();
        return this.out(true, [say.retake()]);
      case 'reset': return this.reset();
      case 'chat': return this.chat(c);
    }
  }

  private setName(raw: string, style?: string): Outcome {
    const name = cleanSingleLine(raw, 48);
    if (!name || looksLikeNonName(name)) return this.out(false, []);
    this.name = name;
    this.nameSkipped = false;
    let job: Outcome['job'];
    const styleToo = Boolean(style && !this.target);
    if (style && !this.target) {
      this.target = cleanSingleLine(style, 140);
      if (this.current) job = this.queued(['done'], () => this.read({ context: 'Initial camera look', refresh: true })).job;
    }
    this.touch();
    return { ...this.out(true, [say.named(this.view(), styleToo)]), ...(job ? { job } : {}) };
  }

  private setStyle(style: string): Outcome {
    const target = cleanSingleLine(style, 140);
    if (!target) return this.out(false, []);
    this.target = target;
    this.touch();
    const events = [say.styleSet(this.view())];
    if (!this.current) return this.out(true, events);
    // A photo came first: read it now.
    const queued = this.queued(['done'], () => this.read({ context: 'Initial camera look', refresh: true }));
    return { ...queued, events: [...events, ...queued.events] };
  }

  private retarget(style: string): Outcome {
    const target = cleanSingleLine(style, 140);
    if (!target) return this.out(false, []);
    this.target = target;
    this.touch();
    // Unlike the original, which asked for a new photo here, the photo on
    // screen is re-read: it is the same outfit. The pieces follow the target.
    const queued = this.queued(['done'], () => this.read({ context: `Re-reading the same look for a new target: ${target}`, refresh: true }));
    return { ...queued, events: [say.retargeting(this.view())] };
  }

  private steer(style: string): Outcome {
    const direction = normalizeStyleCategory(style);
    if (!direction) return this.out(false, []);
    this.category = direction;
    if (!this.target) this.target = cleanSingleLine(style, 140);
    this.touch();
    if (!this.current) return this.out(true, [say.styleSet(this.view())]);
    // The original's RefreshSuggestionsJob: a quiet re-read with fresh pieces.
    const queued = this.queued(['done'], () => this.read({ context: 'Refreshing suggestions after preference change', refresh: true, narrate: false }));
    return { ...queued, events: [say.steer(direction)] };
  }

  private chat(c: Extract<Command, { type: 'chat' }>): Outcome {
    if (c.outfit) this.describedOutfit = cleanSingleLine(c.outfit, 400);
    if (c.wish && !this.current) this.wish = cleanSingleLine(c.wish, 60);
    // A turn that did not answer the open question. The avatar's state already
    // told it to move on after the second one (director.ts); this is the app
    // moving on too, so the question cannot come back.
    if (this.step === 'name') {
      this.nameAsks += 1;
      if (this.nameAsks >= MAX_NAME_ATTEMPTS) this.nameSkipped = true;
    } else if (this.step === 'photo') {
      this.photoAsks += 1;
      if (this.photoAsks >= MAX_PHOTO_CONSENT_ASKS) this.photoDeclined = true;
    }
    this.touch();
    return this.out(false, []);
  }

  private takePhoto(mime: string, data: string): Outcome {
    const type = (mime || '').toLowerCase();
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(Buffer.from(data || '', 'base64'));
    } catch {
      bytes = new Uint8Array();
    }
    if (!ACCEPTED_TYPES.has(type) || bytes.length < 100 || bytes.length > MAX_PHOTO_BYTES) {
      this.notice = { kind: 'error', text: 'That file could not be used: a JPEG, PNG or WebP photo under 6 MB works.' };
      this.touch();
      return this.out(true, []);
    }
    const img = { mime: type, bytes };
    const token = this.store(img);
    // A new photo is a new look: the try-ons, the read and its pieces were for the old one.
    this.base = { token, img, zones: new Set(ALL_BODY_ZONES) };
    this.current = { token, img, item: CURRENT_LOOK_LABEL, kind: 'look' };
    this.tried = [];
    this.latestItem = '';
    this.analysis = null;
    this.photoDeclined = false;   // a photo after a refusal is the answer that counts
    this.wantsPhoto = false;
    this.jobs.photo = true;
    this.touch();
    const accepted = this.queued(['image', 'done'], async (mark) => {
      const zones = await this.models.zones(img).catch(() => new Set<Zone>(ALL_BODY_ZONES));
      if (this.base?.token === token) {
        this.base.zones = zones;
        this.zones = zones;
      }
      this.jobs.photo = false;
      // The read starts right after: the board must not show "no read" in between.
      if (this.target && this.base?.token === token) this.jobs.analysing = true;
      this.touch();
      mark('image', []);
      if (this.base?.token !== token) return [];   // a newer photo replaced it; that one gets the read
      if (!this.target) return [say.photoNeedsStyle()];
      return this.read({ context: 'Initial camera look', refresh: true });
    });
    return { ...accepted, events: this.target ? [say.photoReceived(this.view())] : [] };
  }

  private tryOn(raw: string, detail: string): Outcome {
    const asked = cleanSingleLine(raw, 80);
    if (!asked) return this.out(true, []);
    if (isNonGarmentSelfReference(asked)) return this.out(true, [say.tryOnSelf()]);
    if (!this.current) {
      this.wish = asked;
      this.touch();
      return this.out(true, [say.tryOnNeedsPhoto(asked)]);
    }
    const item = resolveSuggestionItemName(asked, this.analysis);
    // Refused before anything is acknowledged: an acknowledgement spoken
    // before the outcome is known is the avatar confirming a try-on that
    // never happened (the original's worst failure mode, with a frozen board).
    if (!this.isVisible(item)) {
      const zone = inferItemBodyZone(item);
      this.notice = { kind: 'error', text: `The ${item} can't go on: your ${ZONE_WORDS[zone]} ${zone === 'feet' || zone === 'wrist' ? "aren't" : "isn't"} in the photo.` };
      this.touch();
      return this.out(true, [say.tryOnHidden(item)]);
    }
    if (!this.models.tryOnAvailable) {
      this.notice = { kind: 'info', text: `Pieces can't be tried on your photo right now, so the ${item} stays on the rail.` };
      this.touch();
      return this.out(true, [say.tryOnUnavailable(item)]);
    }
    // A double tap, or the same request typed and then said: once is enough.
    if ([this.jobs.tryOn, ...this.jobs.queued].some((pending) => pending && itemsMatch(pending, item))) return this.out(true, []);
    const busy = this.jobs.queued[this.jobs.queued.length - 1] ?? this.jobs.tryOn ?? null;
    const epoch = ++this.tryOnEpoch;
    const prompt = tryOnPrompt(item, detail, normalizeStyleCategory(this.category));
    this.jobs.queued.push(item);
    this.touch();
    const ack = busy ? say.tryOnBusy(busy, item) : say.tryOnAck(item, this.lines++);
    const accepted = this.queued(['image', 'done'], async (mark) => {
      this.jobs.queued.splice(this.jobs.queued.indexOf(item), 1);
      const source = this.current;
      if (!source) return [];
      this.jobs.tryOn = item;
      this.touch();
      let result: Img | null;
      try {
        result = await this.models.tryOn(source.img, prompt);
      } catch {
        result = null;
        this.jobs.tryOn = null;
        this.notice = { kind: 'error', text: `The ${item} didn't come out. Try it again.` };
        this.touch();
        mark('image', [say.tryOnFailed(item, false)]);
        return [];
      }
      this.jobs.tryOn = null;
      if (!result) {
        this.notice = { kind: 'error', text: `The ${item} didn't come out. Try it again.` };
        this.touch();
        mark('image', [say.tryOnFailed(item, true)]);
        return [];
      }
      const previousScore = this.analysis?.style_score;
      const token = this.store(result);
      const attributes = buildItemAttributes(item, this.category, normalizeStyleCategory);
      this.current = { token, img: result, item, kind: 'tryon', shopLinks: buildAmazonShopLinks(attributes, this.opts.amazon) };
      this.latestItem = item;
      this.tried = markItemTried(this.tried, item);
      if (this.wish && itemsMatch(this.wish, item)) this.wish = '';
      this.touch();
      // A newer try-on was asked for meanwhile: its narration wins, this one's is dropped.
      const superseded = () => epoch < this.tryOnEpoch;
      this.jobs.analysing = true;   // the re-read follows at once
      mark('image', superseded() ? [] : [say.tryOnOnScreen(item, this.lines++)]);
      // Zones only matter for the next try-on; found alongside the re-read, not before it.
      const zones = this.models.zones(result).catch(() => new Set<Zone>(this.zones));
      const events = await this.read({ context: `After adding: ${item}`, added: item, previousScore });
      if (this.current?.token === token) this.zones = await zones;
      return superseded() ? [] : events;
    });
    return { ...accepted, events: [ack] };
  }

  private more(quiet: boolean): Outcome {
    if (!this.analysis) return this.out(true, quiet ? [] : [say.needsRead('for more pieces')]);
    if (this.analysis.suggestions.length >= MAX_TRACKED_SUGGESTIONS) return this.out(true, quiet ? [] : [say.moreCapped(this.analysis.suggestions.length)]);
    if (this.jobs.more) return this.out(true, []);
    this.jobs.more = true;
    this.touch();
    // Not on the serial queue, as in the original: more pieces need no image job to finish first.
    return this.started(['done'], async () => {
      try {
        const fresh = await this.generateMore(this.analysis?.suggestions.map((s) => s.item) ?? []);
        if (this.analysis) {
          const seen = new Set(this.analysis.suggestions.map((s) => s.item.trim().toLowerCase()));
          const merged = [...this.analysis.suggestions];
          for (const s of fresh) {
            const key = s.item.trim().toLowerCase();
            if (key && !seen.has(key)) { merged.push(s); seen.add(key); }
          }
          this.analysis = { ...this.analysis, suggestions: merged.slice(0, MAX_TRACKED_SUGGESTIONS) };
          this.opts.thumbnails?.ensure(fresh.map((s) => s.item));
        }
        const names = fresh.map((s) => s.item).filter((n) => this.analysis?.suggestions.some((s) => s.item === n));
        return quiet ? [] : [say.moreReady(names, this.tried.length > 0, this.models.tryOnAvailable)];
      } finally {
        this.jobs.more = false;
        this.touch();
      }
    });
  }

  private reset(): Outcome {
    if (!this.base) return this.out(true, [say.needsRead('to go back to their own photo')]);
    const base = this.base;
    const accepted = this.queued(['done'], async () => {
      // The original's reset_to_camera_source: every try-on off, fresh pieces.
      this.current = { token: base.token, img: base.img, item: CURRENT_LOOK_LABEL, kind: 'look' };
      this.zones = new Set(base.zones);
      this.tried = [];
      this.latestItem = '';
      this.analysis = null;
      this.touch();
      return this.read({ context: 'Initial camera look after reset', refresh: true });
    });
    return { ...accepted, events: [say.reset()] };
  }

  // -- the read (the original's _do_analyze_current) -------------------------------

  /** Read the image on screen, keeping or refreshing the pieces; the events say what came of it. */
  async read(opts: { context: string; refresh?: boolean; narrate?: boolean; added?: string; previousScore?: number }): Promise<SayEvent[]> {
    const shown = this.current;
    if (!shown) return [];
    const previous = this.analysis;
    const keepPieces = !opts.refresh && Boolean(previous);
    this.jobs.analysing = true;
    this.touch();
    try {
      // The read and the pieces are independent calls: run together, as the original did.
      const key = `${shown.token}\0${stylePhraseKey(this.target)}`;
      const known = this.readings.get(key);
      const [read, dynamic] = await Promise.all([
        known ?? this.models.analyze(shown.img, { userName: this.name, target: this.targetBrief(), context: opts.context }).catch(() => null),
        keepPieces ? Promise.resolve([]) : this.models.suggest({ image: shown.img, zones: this.zones, target: this.targetBrief(), recent: this.tried }).catch(() => []),
      ]);
      if (!read) {
        this.notice = { kind: 'error', text: 'The verdict didn\'t come through. Tap "Rate it again".' };
        return opts.narrate === false ? [] : [say.analysisFailed()];
      }
      if (!known) {
        this.readings.set(key, read);
        if (this.readings.size > 48) this.readings.delete(this.readings.keys().next().value!);
      }
      // Pieces appended while this read ran are kept too.
      const suggestions = keepPieces ? (this.analysis ?? previous)!.suggestions : this.enrich(this.assemble(dynamic));
      const same = Boolean(known) && this.readOf === key && Boolean(previous);
      this.analysis = { ...read, suggestions, tried_items: this.tried.map(titleCase) };
      this.readOf = key;
      this.opts.thumbnails?.ensure(suggestions.map((s) => s.item));
      if (opts.narrate === false) return [];
      const wish = this.wish;
      const event = say.analysis(this.view(), {
        previousScore: opts.added ? opts.previousScore ?? previous?.style_score : undefined,
        added: opts.added,
        wish,
        // Asked again with nothing changed: the same reading, said as such.
        same,
      });
      if (wish && event.offer && itemsMatch(event.offer, wish)) this.wish = '';
      return [event];
    } finally {
      this.jobs.analysing = false;
      this.touch();
    }
  }

  /** The original's _assemble_suggestions: the model's pieces, topped up, filtered to what can be tried. */
  assemble(dynamic: { item: string; text: string }[]): { item: string; text: string }[] {
    const fallback = FALLBACK_SUGGESTIONS.filter(([, , zone]) => this.zones.has(zone)).map(([item, text]) => ({ item, text }));
    // Words the model sometimes puts in `item`: the UI must never show "NECK" or "UPPER BODY" as a piece.
    const generic = new Set<string>([...ALL_BODY_ZONES, 'upper body', 'lower body', 'accessories', 'accessory', 'clothing', 'outfit', 'item', 'top', 'bottom']);
    const out: { item: string; text: string }[] = [];
    const seen = new Set<string>();
    for (const candidate of [...dynamic, ...fallback]) {
      if (out.length >= 6) break;
      const item = (candidate.item ?? '').trim();
      const key = item.toLowerCase();
      if (!item || seen.has(key)) continue;
      if (this.tried.some((t) => itemsMatch(item, t))) continue;
      if (generic.has(key) || generic.has(key.replace(/ /g, '_'))) continue;
      if (!item.includes(' ') && item.length <= 4) continue;   // a lone short generic word
      if (!this.isVisible(item)) continue;
      out.push({ item, text: (candidate.text ?? '').trim() });
      seen.add(key);
    }
    return out;
  }

  enrich(pieces: { item: string; text: string }[]): Suggestion[] {
    return pieces.map((p) => ({ ...p, amazon_search_url: buildAmazonSearchUrl(p.item, this.opts.amazon) }));
  }

  /** Up to `count` pieces not already on the board, over at most three asks. */
  async generateMore(existing: string[], count = 6): Promise<Suggestion[]> {
    const seen = new Set(existing.map((i) => i.trim().toLowerCase()).filter(Boolean));
    const out: { item: string; text: string }[] = [];
    for (let attempt = 0; attempt < 3 && out.length < count; attempt++) {
      const dynamic = await this.models.suggest({ image: this.current?.img ?? null, zones: this.zones, target: this.targetBrief(), recent: this.tried }).catch(() => []);
      for (const candidate of this.assemble(dynamic)) {
        const key = candidate.item.toLowerCase();
        if (seen.has(key)) continue;
        out.push(candidate);
        seen.add(key);
        if (out.length >= count) break;
      }
    }
    return this.enrich(out);
  }

  // -- plumbing ------------------------------------------------------------------------

  private touch() { this.rev += 1; }

  private out(handled: boolean, events: SayEvent[]): Outcome {
    return { view: this.view(), handled, events };
  }

  private store(img: Img): string {
    const token = (this.opts.newId ?? defaultId)();
    this.images.set(token, img);
    // Keep the user's own photo and what is on screen; drop the oldest try-ons.
    for (const key of this.images.keys()) {
      if (this.images.size <= MAX_IMAGES) break;
      if (key !== token && key !== this.base?.token && key !== this.current?.token) this.images.delete(key);
    }
    return token;
  }

  /** A job on the serial queue (reads and try-ons, one at a time, in order). */
  private queued(milestones: Milestone[], run: (mark: (m: Milestone, events: SayEvent[]) => void) => Promise<SayEvent[]>): Outcome {
    return this.started(milestones, run, true);
  }

  private started(milestones: Milestone[], run: (mark: (m: Milestone, events: SayEvent[]) => void) => Promise<SayEvent[]>, serial = false): Outcome {
    const id = (this.opts.newId ?? defaultId)();
    const record: JobRecord = { id, milestones: new Map(milestones.map((m) => [m, deferred()])) };
    this.jobRecords.set(id, record);
    if (this.jobRecords.size > 24) this.jobRecords.delete(this.jobRecords.keys().next().value!);
    const mark = (m: Milestone, events: SayEvent[]) => record.milestones.get(m)?.resolve({ view: this.view(), handled: true, events });
    const work = async () => {
      try {
        const events = await run(mark);
        for (const [m, d] of record.milestones) if (m !== 'done') d.resolve({ view: this.view(), handled: true, events: [] });
        mark('done', events);
      } catch (err) {
        console.warn('[fashion-advisor] job failed: %s', (err as Error).message);
        this.jobs = { ...this.jobs, photo: false, analysing: false, tryOn: null, more: false };
        this.touch();
        for (const d of record.milestones.values()) d.resolve({ view: this.view(), handled: true, events: [] });
      }
    };
    if (serial) this.queue = this.queue.then(work);
    else void work();
    return { view: this.view(), handled: true, events: [], job: { id, milestones } };
  }
}
