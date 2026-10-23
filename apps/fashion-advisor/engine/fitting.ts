// One fitting: the stylist (engine/stylist.ts) behind the two ways in. Emery
// calls a tool, or the user presses a button; both become the same intent,
// the stylist acts, and what it reports becomes words. For Emery's call they
// are the tool's result; for a button they are an event saying what the user
// pressed and what came of it (she cannot see the screen).
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
  | { kind: 'photo'; mime: string; data: string; example?: boolean };

/** Who asked: Emery through a tool, or the user through a button (what they pressed, for her). */
export type Asker = { by: 'host' } | { by: 'user'; pressed: string };

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

/** A tool call as an intent, its arguments checked; null for a tool Notch does not have. */
export function intentOfTool(name: string, args: Record<string, unknown> = {}): Intent | null {
  const str = (key: string, max: number) => (typeof args[key] === 'string' ? cleanSingleLine(args[key] as string, max) : '');
  switch (name) {
    case 'rate_outfit': return str('occasion', 80) ? { kind: 'rate', occasion: str('occasion', 80) } : { kind: 'rate' };
    case 'suggest_pieces': return str('direction', 60) ? { kind: 'pieces', direction: str('direction', 60) } : { kind: 'pieces' };
    case 'try_on': return { kind: 'tryOn', piece: str('piece', 80) };
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
    case 'photo':
      if (typeof b.mime !== 'string' || typeof b.data !== 'string') return null;
      return { intent: { kind: 'photo', mime: b.mime, data: b.data, example: b.example === true }, pressed: b.example === true ? 'chose the example outfit' : 'added a new photo of their outfit' };
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
    if (asker.by === 'user') {
      const frame = (text: string) => said.pressed(asker.pressed, text);
      if (ran.text) ran.text = frame(ran.text);
      if (ran.job && ran.result) this.framing.set(ran.job.id, { ...this.framing.get(ran.job.id), frame });
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
        return out.job ? this.awaiting(out, 'done') : { view: out.view, text: null };
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
      return out.job ? this.awaiting(out, 'done', (o) => said.steered(o.view, lean)) : this.now(words(out.events));
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
