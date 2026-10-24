// One fitting: the stylist (engine/stylist.ts) behind the two ways in. Emery
// calls a tool, or the user presses a button; both become the same intent,
// the stylist acts, and what it reports becomes words. For Emery's call they
// are the tool's result; for a button they are an event saying what the user
// pressed and what came of it (she cannot see the screen). A photo the user
// also shared with her in the call is the exception: she reacts to that drop
// herself, so only Notch's verdict on it is told.
//
// Slow work (a read, a try-on) runs as a job with milestones. A request says
// which milestone carries its outcome (`result`); the page waits for it (a
// tool for at most ~20 s) and passes the other milestones on as events.
import { said, say } from './director.ts';
import { cleanSingleLine, isNonGarmentSelfReference, itemsMatch } from './items.ts';
import { pieceFromWords } from './judge.ts';
import { normalizeStyleCategory, stylePhraseKey } from './style.ts';
import type { Stylist } from './stylist.ts';
import type { Milestone, Outcome, SayEvent, View } from './types.ts';

export type Intent =
  | { kind: 'rate'; occasion?: string }
  | { kind: 'pieces'; direction?: string }
  | { kind: 'tryOn'; piece: string; why?: string }
  | { kind: 'restore' }
  | { kind: 'photo'; mime: string; data: string; example?: boolean; shared?: Shared; which?: string };

/**
 * How Emery has a photo too: shared with her in the drop that brings it to the mirror ('now': she
 * reacts to that drop herself), or earlier in the call ('before': one of the looks the user is
 * choosing between, put back in the mirror).
 */
export type Shared = 'now' | 'before';

/**
 * Who asked: Emery through a tool, or the user through a button (what they pressed, for her; empty
 * when there is nothing to tell, a photo in a drop she reacts to herself).
 */
export type Asker = { by: 'host' } | { by: 'user'; pressed: string };

/** A drop holds at most ten files, so a choice of looks has at most ten. */
const MAX_LOOKS = 10;

/** Which of the looks the user is choosing between a photo is (two or more): its place, its file's name, picked from the others or not. */
function lookOf(raw: unknown): { n: number; of: number; name: string; picked: boolean } | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Record<string, unknown>;
  const n = Number(l.n);
  const of = Number(l.of);
  if (!Number.isInteger(n) || !Number.isInteger(of) || of < 2 || of > MAX_LOOKS || n < 1 || n > of) return null;
  return { n, of, name: typeof l.name === 'string' ? cleanSingleLine(l.name.replace(/"/g, ''), 60) : '', picked: l.picked === true };
}

export interface Ran {
  view: View;
  /** The words for Emery now; null when they come with the job's `result` milestone. */
  text: string | null;
  job?: { id: string; milestones: Milestone[] };
  result?: Milestone;
}

export interface Step { view: View; text: string | null }

interface Framing { result?: Milestone; compose?: (out: Outcome) => string | null; frame?: (text: string) => string }

const words = (events: SayEvent[]) => events.map((e) => e.text).join(' ').trim() || null;

/** An occasion as the host passed it: "  A Summer Wedding, please!" is "summer wedding"; '' when nothing is left. */
export function occasionFrom(raw: string): string {
  const said = cleanSingleLine(raw, 200).toLowerCase()
    .replace(/[.!?,;:"]+/g, ' ').replace(/\s+(?:please|instead|then|now|today|tonight)\s*$/, '')
    .replace(/^(?:(?:for|to|at|an?|the|my|our|this|that|i'?m dressing for|dressing for|going to)\s+)+/, '').trim();
  return cleanSingleLine(said, 80);
}

/** Where the pieces should lean: "Make it a bit dressier" is "formal"; '' when the words name no direction. */
export function leanFrom(raw: string): string {
  const said = cleanSingleLine(raw, 200).toLowerCase().replace(/[.!?,;:"]+/g, ' ')
    .replace(/^(?:(?:make|it|them|the|pieces|rail|a|bit|little|more|something|lean|leaning|toward|towards|into|go|please)\s+)+/, '').trim();
  if (!said) return '';
  if (/\b(dress(?:y|ier)|fanc(?:y|ier)|smart(?:er)?|sharp(?:er)?|elegant|formal|polished)\b/.test(said)) return 'formal';
  if (/\b(relax(?:ed)?|laid[- ]?back|chill(?:er)?|casual(?:er)?|comfy|comfortable)\b/.test(said)) return 'casual';
  return normalizeStyleCategory(said);
}

/** A tool call as an intent. Arguments are read leniently (case, articles, synonyms, extra fields); null for a tool Notch does not have. */
export function intentOfTool(name: string, args: Record<string, unknown> = {}): Intent | null {
  const str = (key: string) => (typeof args?.[key] === 'string' ? args[key] as string : '');
  switch (name) {
    case 'rate_outfit': return occasionFrom(str('occasion')) ? { kind: 'rate', occasion: occasionFrom(str('occasion')) } : { kind: 'rate' };
    case 'suggest_pieces': return leanFrom(str('direction')) ? { kind: 'pieces', direction: leanFrom(str('direction')) } : { kind: 'pieces' };
    case 'try_on': return { kind: 'tryOn', piece: cleanSingleLine(str('piece'), 80) };
    case 'restore_photo': return { kind: 'restore' };
    default: return null;
  }
}

/** A button press as an intent, with what the user pressed in words for Emery; null when it is not one. */
export function intentOfButton(body: unknown): { intent: Intent; pressed: string } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const str = (key: string, max: number) => (typeof b[key] === 'string' ? cleanSingleLine(b[key] as string, max) : '');
  switch (b.button) {
    case 'photo': {
      if (typeof b.mime !== 'string' || typeof b.data !== 'string') return null;
      const example = b.example === true;
      const look = lookOf(b.look);
      const shared = b.shared === 'now' || b.shared === 'before' ? b.shared : undefined;
      const which = example ? 'the example outfit' : look ? `look ${look.n} of ${look.of}${look.name ? ` ("${look.name}")` : ''}` : 'their outfit photo';
      // In a drop Emery reacts to herself, the photo is not told again as a press.
      const pressed = shared === 'now' ? ''
        : example ? 'chose the example outfit'
          : look?.picked ? `put ${which} in the mirror`
            : look ? `added ${look.of} outfit photos to choose between` : 'added a new photo of their outfit';
      return { intent: { kind: 'photo', mime: b.mime, data: b.data, example, ...(shared ? { shared } : {}), which }, pressed };
    }
    case 'occasion': {
      const occasion = str('occasion', 80);
      return occasion ? { intent: { kind: 'rate', occasion }, pressed: `picked "${occasion}" as what they're dressing for` } : null;
    }
    case 'rerate': return { intent: { kind: 'rate' }, pressed: 'tapped Rate it again' };
    case 'more': return { intent: { kind: 'pieces' }, pressed: 'tapped More pieces' };
    case 'tryOn': {
      const piece = str('piece', 80);
      return piece ? { intent: { kind: 'tryOn', piece, ...(str('why', 160) ? { why: str('why', 160) } : {}) }, pressed: `tapped Try it on for the ${piece}` } : null;
    }
    case 'restore': return { intent: { kind: 'restore' }, pressed: 'tapped Back to my photo' };
    default: return null;
  }
}

export class Fitting {
  /** When the fitting was last used, for the server's cleanup. */
  at = Date.now();
  private framing = new Map<string, Framing>();
  /** Jobs that end in a verdict and have not landed yet (queued behind a try-on, or running). */
  private reading = new Set<string>();

  constructor(readonly stylist: Stylist) {}

  view(): View { return this.stylist.view(); }

  /** Do what was asked. Quick outcomes come back as words now; slow ones name the milestone that carries them. */
  do(intent: Intent, asker: Asker): Ran {
    this.at = Date.now();
    const ran = this.run(intent);
    if (asker.by === 'user' && asker.pressed) {
      const frame = (text: string) => said.pressed(asker.pressed, text);
      // What was pressed is said once: with the outcome now, else with the outcome that follows.
      if (ran.text) ran.text = frame(ran.text);
      else if (ran.job && ran.result) this.framing.set(ran.job.id, { ...this.framing.get(ran.job.id), frame });
    }
    return ran;
  }

  /** A job's milestone, once it lands, with its words (framed for a button's outcome). Undefined for an unknown job. */
  step(jobId: string, milestone: Milestone): Promise<Step> | undefined {
    const waiting = this.stylist.wait(jobId, milestone);
    if (!waiting) return undefined;
    return waiting.then((out) => {
      const f = this.framing.get(jobId);
      const outcome = milestone === f?.result && f.compose ? f.compose(out) : words(out.events);
      return { view: out.view, text: outcome && milestone === f?.result && f.frame ? f.frame(outcome) : outcome };
    });
  }

  private run(intent: Intent): Ran {
    switch (intent.kind) {
      case 'rate': return this.rate(intent.occasion);
      case 'pieces': return this.pieces(intent.direction);
      case 'tryOn': return this.tryOn(intent.piece, intent.why);
      case 'restore': return this.restore();
      case 'photo': {
        const out = this.reads(this.stylist.act({ type: 'photo', mime: intent.mime, data: intent.data, source: intent.example ? 'sample' : 'upload' }));
        // A file that could not be used is refused on screen (the notice); nothing for Emery to say.
        if (!out.job) return { view: out.view, text: null };
        const photo = intent.which ?? (intent.example ? 'the example outfit' : 'their outfit photo');
        // Emery hears at once that the photo is in the mirror; the verdict follows. If she was
        // told to ask for the occasion, "it can't be rated yet" is not said twice.
        const askedOccasion = !this.stylist.target;
        const ran = this.awaiting(out, 'done', (o) => {
          const outcome = words(o.events);
          if (!outcome || (askedOccasion && !o.view.target)) return null;
          if (!o.view.analysis) return outcome;
          return intent.shared === 'now' ? said.sharedRead(photo, outcome) : said.photoRead(outcome);
        });
        // Shared with her in the drop that brought it: she reacts to the drop herself, and a line
        // that the photo is in would be a second reaction. Only the verdict follows.
        if (intent.shared === 'now') return ran;
        return { ...ran, text: said.photoIn(out.view, photo, intent.shared === 'before') };
      }
    }
  }

  private now(text: string | null): Ran {
    return { view: this.stylist.view(), text };
  }

  private awaiting(out: Outcome, result: Milestone, compose?: Framing['compose']): Ran {
    const job = out.job!;
    this.framing.set(job.id, { result, compose });
    if (this.framing.size > 48) this.framing.delete(this.framing.keys().next().value!);
    return { view: out.view, text: null, job, result };
  }

  /** A job that ends in a verdict: while it is pending, asking again waits for it instead of reading twice. */
  private reads(out: Outcome): Outcome {
    const id = out.job?.id;
    if (id) {
      this.reading.add(id);
      void this.stylist.wait(id, 'done')?.then(() => this.reading.delete(id));
    }
    return out;
  }

  /** Rate the photo: for a new occasion (the same photo re-read for it), or again for the same one. */
  private rate(occasion?: string): Ran {
    const s = this.stylist;
    const occ = cleanSingleLine(occasion ?? '', 80);
    if (occ && stylePhraseKey(occ) !== stylePhraseKey(s.target)) {
      // A new photo still being checked is read, right after, for the occasion it finds then:
      // noting it is enough (a second read would mean a second verdict).
      if (s.jobs.photo) {
        s.target = occ;
        return this.now(said.readRunning(s.view()));
      }
      const out = this.reads(s.act(s.current ? { type: 'retarget', style: occ } : { type: 'style', style: occ }));
      return out.job ? this.awaiting(out, 'done') : this.now(words(out.events));
    }
    if (!s.target) return this.now(said.noOccasion());
    if (!s.current) return this.now(say.needsRead('to be rated').text);
    // A try-on's re-read is already coming, and a read already running is the one they want: not a second.
    const putting = s.jobs.tryOn ?? s.jobs.queued[0];
    if (putting) return this.now(said.tryOnRunning(putting));
    if (s.jobs.photo || s.jobs.analysing || this.reading.size) return this.now(said.readRunning(s.view()));
    return this.awaiting(this.reads(s.act({ type: 'rerate' })), 'done');
  }

  /** More pieces on the rail, or fresh ones leaning a direction. */
  private pieces(direction?: string): Ran {
    const s = this.stylist;
    if (!s.analysis) return this.now(s.current ? said.noVerdictYet() : say.needsRead('for more pieces').text);
    const lean = normalizeStyleCategory(direction ?? '');
    if (lean) {
      const out = s.act({ type: 'steer', style: direction! });
      // A quiet read says nothing unless the look changed under it; then that is the outcome.
      return out.job ? this.awaiting(out, 'done', (o) => words(o.events) ?? said.steered(o.view, lean)) : this.now(words(out.events));
    }
    if (s.jobs.more) return this.now(said.moreOnTheWay());
    const out = s.act({ type: 'more' });
    return out.job ? this.awaiting(out, 'done') : this.now(words(out.events));
  }

  /** Start a try-on: accepted or refused at once; the picture and its new score follow as events. */
  private tryOn(piece: string, why?: string): Ran {
    const s = this.stylist;
    const rail = s.analysis?.suggestions ?? [];
    const named = pieceFromWords(piece, rail.map((r) => r.item));
    if (!named) return this.now(said.whichPiece());
    if (!named.onRail && !named.garment && !isNonGarmentSelfReference(named.item)) return this.now(said.notAPiece(named.item));
    const card = rail.find((r) => itemsMatch(named.item, r.item));
    const out = s.act({ type: 'tryOn', item: named.item, ...(why || card?.text ? { text: why || card!.text } : {}) });
    return { view: out.view, text: words(out.events) ?? said.alreadyGoing(named.item), ...(out.job ? { job: out.job } : {}) };
  }

  /** Back to the own photo, every try-on off, rated fresh. */
  private restore(): Ran {
    const s = this.stylist;
    if (!s.base) return this.now(say.needsRead('to go back to their own photo').text);
    if (s.current?.kind === 'look' && !s.jobs.tryOn && !s.jobs.queued.length) return this.now(said.alreadyOwn());
    return this.awaiting(this.reads(s.act({ type: 'reset' })), 'done');
  }
}
