// Every way to act on the range, in one place: the host's tool calls and the
// student's hands on the screen. Postmark's server `run()`, for a range that
// runs in the page.
//
// A tool call resolves to the words the host speaks from, after the range has
// acted: `fire` resolves when the ball is down, with the range's verdict, so
// the host's first reply after "fire" carries the real result. A press on the
// screen acts at once, and the host (who cannot see the screen) is told by
// `tell` what happened: a new challenge at once, a shot when it lands.
//
// One shot, one account of its landing: whoever is waiting on it hears it. A
// tool call waiting gets it as its result; a shot fired from the screen with no
// call waiting is told as an event. A host `fire` while a shot from the screen
// is already up joins that shot rather than being refused, so the student who
// pressed Fire and said "fire" gets one shot and one line.
import { BY_ID } from './challenges.ts';
import { pressed, said } from './director.ts';
import { challengeIdFrom, commandIn, contextOf, worthAsking, type JudgeContext } from './judge.ts';
import type { Range } from './range.ts';
import type { Change, Command, Intent, Result, Source } from './types.ts';

/** The app's model, for aim words the rules cannot read. Null when there is none or it is unsure. */
export type Interpret = (text: string, ctx: JudgeContext) => Promise<Command | null>;

/** What the student's hands can do. */
export type Press =
  | { kind: 'aim'; angle_deg: number; speed_ms: number }
  | { kind: 'fire' }
  | { kind: 'challenge'; id: string }
  | { kind: 'next' }
  | { kind: 'reset' };

export const TOOL_NAMES = ['aim', 'fire', 'choose_challenge', 'start_over'] as const;

/** A host "next" this soon after the safety net changed the challenge is the same request, late. */
export const NET_GRACE_MS = 15_000;
/**
 * The safety net fires 7 s after the words, and a call up to 6 s before them
 * counts; a shot that went up anywhere in that window (Fire pressed while
 * saying "fire") was the one they meant, so the net does not take another.
 */
export const NET_FIRE_WINDOW_MS = 13_000;

export interface ControlsOptions {
  /** Tell the host something it cannot see (an event). */
  tell: (text: string, ttlS: number) => void;
  /** Every refusal, from any source: the screen shows it. */
  refused?: (reason: string) => void;
  interpret?: Interpret;
  now?: () => number;
}

export class Controls {
  /** The shot in the air, whoever is waiting to hear where it lands, and the call it was fired in. */
  private flight: { waiters: ((landing: string) => void)[]; call: number } | null = null;
  private netChallengeAt = Number.NEGATIVE_INFINITY;
  private lastShotAt = Number.NEGATIVE_INFINITY;
  /** Which call is on: work started in one call is dropped if it finishes in another. */
  private call = 0;

  constructor(readonly range: Range, private opts: ControlsOptions) {
    range.subscribe((change) => this.settle(change));
  }

  private get now() { return this.opts.now?.() ?? Date.now(); }

  private apply(intent: Intent, by: Source): Result {
    const result = this.range.apply(intent, by);
    if (!result.applied) this.opts.refused?.(result.reason);
    else if (intent.kind === 'fire') this.lastShotAt = this.now;
    return result;
  }

  /**
   * A tool call from the host (or the safety net, on its behalf). Resolves to
   * what the host says next. An unknown tool rejects (the host hears "error"),
   * and so does a net shot when one already went up around the words (the net
   * then says nothing).
   */
  tool(name: string, args: Record<string, unknown> = {}, by: 'host' | 'net' = 'host'): Promise<string> {
    if (by === 'net' && name === 'fire' && this.now - this.lastShotAt < NET_FIRE_WINDOW_MS) {
      return Promise.reject(new Error('a shot already went up around those words'));
    }
    switch (name) {
      case 'aim': return this.aim(args);
      case 'fire': return this.fire();
      case 'choose_challenge': return Promise.resolve(this.choose(args.challenge, by));
      case 'start_over': return Promise.resolve(this.startOver());
    }
    return Promise.reject(new Error(`unknown tool ${name}`));
  }

  /** The student's hands: applied at once; the host is told what it cannot see. */
  press(p: Press): Result | null {
    switch (p.kind) {
      // The arrow and the steppers: the state carries the new aim; the coach
      // never narrated the arrow.
      case 'aim': return this.apply({ kind: 'set_aim', angle_deg: p.angle_deg, speed_ms: p.speed_ms }, 'panel');
      case 'fire': {
        if (this.range.snapshot().phase === 'flying') return null;
        const r = this.apply({ kind: 'fire' }, 'panel');
        if (r.applied) this.flight = { waiters: [], call: this.call };
        return r;
      }
      case 'challenge': {
        const c = BY_ID.get(p.id);
        if (!c || c.id === this.range.snapshot().challenge.id) return null;
        const r = this.apply({ kind: 'start_challenge', id: c.id }, 'panel');
        if (r.applied) this.opts.tell(pressed(`picked "${c.name}"`, said.challenge(r.snapshot)), 20);
        return r;
      }
      case 'next': {
        const r = this.apply({ kind: 'next_challenge' }, 'panel');
        if (r.applied) this.opts.tell(pressed('pressed "Next challenge"', said.challenge(r.snapshot)), 20);
        return r;
      }
      case 'reset': {
        const r = this.apply({ kind: 'reset' }, 'panel');
        if (r.applied) this.opts.tell(pressed('pressed "Start over"', said.reset(r.snapshot)), 15);
        return r;
      }
    }
  }

  // ---- the tools ------------------------------------------------------------

  private async aim(args: Record<string, unknown>): Promise<string> {
    const before = this.range.snapshot();
    const given = { angle: numberArg(args.angle_deg), speed: numberArg(args.speed_ms) };
    let { angle, speed } = given;
    let thenFire = yes(args.then_fire);
    // Whatever was not a plain number is read as words, with its unit: "forty-five" for an angle still counts.
    const words = [
      typeof args.request === 'string' ? args.request : '',
      angle === undefined && wordy(args.angle_deg) ? `${args.angle_deg} degrees` : '',
      speed === undefined && wordy(args.speed_ms) ? `${args.speed_ms} metres a second` : '',
    ].map((w) => w.trim()).filter(Boolean).join(', ').slice(0, 200);
    // The numbers come first; words fill whatever is still missing. Words that
    // cannot be read refuse the whole call: half an aim is not what was asked.
    if (words && (angle === undefined || speed === undefined)) {
      const ctx = contextOf(before);
      let command = commandIn(words, ctx);
      if (command?.kind === 'fire') {
        // "Fire" as the words: the shot, after whatever numbers came with it.
        if (angle === undefined && speed === undefined) return this.fire();
        thenFire = true;
      } else {
        if (command?.kind !== 'aim' && this.opts.interpret && worthAsking(words)) {
          const call = this.call;
          command = await this.opts.interpret(words, ctx).catch(() => null);
          // The model answered after the call ended: that student is gone; move nothing.
          if (call !== this.call) return said.callEnded();
        }
        if (command?.kind !== 'aim') return said.unreadable(words);
        angle ??= command.angle_deg;
        speed ??= command.speed_ms;
        thenFire ||= command.thenFire === true;
      }
    }
    else if (words) {
      // Both numbers came; the words can still ask for the shot ("…and fire").
      const command = commandIn(words, contextOf(before));
      if (command?.kind === 'fire' || (command?.kind === 'aim' && command.thenFire)) thenFire = true;
    }
    if (angle === undefined && speed === undefined) return said.noAim();
    // Never clamped: the launcher refuses what it cannot do, with the numbers.
    const r = this.apply({ kind: 'set_aim', angle_deg: angle ?? null, speed_ms: speed ?? null }, 'host');
    if (!r.applied) return said.aimRefused(r.reason, this.range.snapshot());
    if (thenFire) return said.aimedAndFired(r.snapshot, await this.fire());
    // A value that came from words is new to them, so it is named; their own numbers are not repeated.
    const fromWords = (given.angle === undefined && angle !== undefined) || (given.speed === undefined && speed !== undefined);
    return fromWords ? said.stepped(r.snapshot, before) : said.aimed(r.snapshot);
  }

  private fire(): Promise<string> {
    return new Promise((resolve) => {
      if (this.flight && this.range.snapshot().phase === 'flying') {
        this.flight.waiters.push((landing) => resolve(said.joined(landing)));
        return;
      }
      const r = this.apply({ kind: 'fire' }, 'host');
      if (!r.applied) return resolve(said.fireRefused(r.reason));
      this.flight = { waiters: [resolve], call: this.call };
    });
  }

  private choose(value: unknown, by: 'host' | 'net'): string {
    const before = this.range.snapshot();
    const asked = String(value ?? '').trim().slice(0, 80);
    const id = challengeIdFrom(asked);
    let intent: Intent;
    if (id === 'next') {
      // The safety net put the next one up because the host had not; a late
      // "next" from the host is that same request, not one more.
      if (by === 'host' && this.now - this.netChallengeAt < NET_GRACE_MS) return said.alreadyUp(before);
      intent = { kind: 'next_challenge' };
    } else {
      if (!id) return said.unknownChallenge(asked);
      // Naming the challenge already up is not a request to wipe its scoreboard.
      if (id === before.challenge.id) return said.alreadyUp(before);
      intent = { kind: 'start_challenge', id };
    }
    const r = this.apply(intent, 'host');
    if (!r.applied) return said.refused(r.reason);
    if (by === 'net') this.netChallengeAt = this.now;
    return said.challenge(r.snapshot);
  }

  private startOver(): string {
    const r = this.apply({ kind: 'reset' }, 'host');
    return r.applied ? said.reset(r.snapshot) : said.refused(r.reason);
  }

  /**
   * The call is over (hung up or failed) or a new one is starting. What this
   * call left running finishes without it: a model call's aim is dropped, a
   * shot in the air lands on the screen but is told to no one, and the safety
   * net's memory of this call (its last challenge, the last shot) is cleared.
   */
  endCall(): void {
    this.call += 1;
    this.netChallengeAt = Number.NEGATIVE_INFINITY;
    this.lastShotAt = Number.NEGATIVE_INFINITY;
    if (this.flight) {
      for (const w of this.flight.waiters) w(said.callEnded());
      this.flight.waiters = [];
    }
  }

  // ---- the landing ----------------------------------------------------------

  /** Who hears about a shot coming down (or not: a challenge changed under it). */
  private settle(change: Change) {
    const flight = this.flight;
    if (!flight) return;
    if (change.intent.kind === 'land') {
      this.flight = null;
      const landing = said.landed(change.snapshot);
      if (flight.waiters.length) for (const w of flight.waiters) w(landing);
      // A shot from an earlier call is that call's; this one never saw it go.
      else if (flight.call === this.call) this.opts.tell(pressed('pressed Fire', landing), 20);
    } else if (change.snapshot.phase !== 'flying') {
      // A new challenge or a clean scoreboard while it flew: nothing lands.
      this.flight = null;
      for (const w of flight.waiters) w(said.cancelled(change.snapshot));
    }
  }
}

/** A number the host passed, or undefined (a string of digits counts, "45°" too; words do not). */
function numberArg(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(?:°|deg(?:rees?)?|m\/s|ms|metres? (?:a|per) second|meters? (?:a|per) second)?\s*$/i.exec(value);
  return m ? Number(m[1]) : undefined;
}

/** A value that is neither empty nor a number: words to read ("forty-five"). */
const wordy = (value: unknown) => typeof value === 'string' && value.trim() !== '' && numberArg(value) === undefined;

/** true, "true", "yes": the host's ways of saying yes in a boolean slot. */
const yes = (value: unknown) => value === true || (typeof value === 'string' && /^(?:true|yes|y|1)$/i.test(value.trim()));
