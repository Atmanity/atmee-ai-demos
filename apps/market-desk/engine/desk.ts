// The board wired up: the reducer, the store, the fetch pump, the announcer,
// the refresh timer, and one user's desk session that turns actions into board
// changes and tells the avatar what happened. Ported from the original's
// table.py (and the action half of tools.py). Framework-free: the server runs
// one DeskSession per page; the tests run it with a fake feed and a fake clock.
//
// Why the fetch is not in the reducer: an action that needs a quote does not
// wait for one. It claims a slot in `fetching`, the reducer returns at once,
// and the pump (a change listener) applies a SECOND intent when the data lands.
// Every path (a button, a spoken "add Nvidia", the 60 s timer) therefore looks
// identical, and the reducer never blocks on a socket.
import * as board from './board.ts';
import { BoardError } from './board.ts';
import { boardFact, say } from './director.ts';
import { fetchEntry } from './feed.ts';
import type { Action, Board, BoardState, Judgement, Origin, Outcome, Quote } from './types.ts';

/** How often the focused symbol is pulled on the desk's own initiative. */
export const TICK_SECONDS = 60;
/** A move of this size since the last thing said about the symbol is worth a line.
 * Below it the board updates silently: an analyst who reads out every 0.1% tick is noise. */
export const SPEAK_THRESHOLD_PCT = 1.0;
/** After a failed pull the timer stands down for this long. A feed that is down
 * or rate-limiting is not fixed by asking again in a minute, and hammering a 429
 * is how the whole app gets locked out. */
export const FAILURE_COOLDOWN_S = 300;
/** How long the avatar's lines stay worth saying (the kit caps event ttl at 60 s). */
export const MOVE_TTL_S = 30;
export const RESULT_TTL_S = 45;

export type Clock = () => number;
export const systemClock: Clock = () => Date.now() / 1000;

export interface Intent { kind: string; symbol?: string | null; entry?: Quote; error?: string; now?: number }
export type Result = { applied: true; seq: number; board: Board } | { applied: false; reason: string };
/** Where the desk's own lines go: the server relays them to the page, which hands them to the avatar as events. */
export interface Speaker { say(text: string, ttlS: number): void }
export type FetchQuote = (symbol: string, opts: { now: number }) => Promise<Quote>;
type Listener = (seq: number, state: BoardState, intent: Intent) => void;

/**
 * Intents onto the board. Pure: it calls `board`, which returns new state. An
 * intent naming a symbol arrives in one of three shapes:
 * - bare (`{kind: 'add', symbol: 'MSFT'}`): a request. The board validates it
 *   and claims a slot in `fetching`; the pump does the network.
 * - with `entry`: the quote landed; the row goes on the board.
 * - with `error`: the quote did not land; the reason is shown, and for a
 *   refresh the existing row is greyed rather than dropped.
 */
export function makeReducer(clock: Clock = systemClock) {
  return function reduce(state: BoardState, intent: Intent): BoardState {
    const kind = String(intent.kind || '').trim().toLowerCase();
    const now = Number(intent.now || clock());
    let raw = intent.symbol;
    // A refresh or focus with no symbol means "the one we are looking at".
    if ((kind === 'refresh' || kind === 'focus') && !raw) raw = state.focus;
    const symbol = board.normalizeSymbol(raw);
    const { entry, error } = intent;

    if (kind === 'clear') return board.clear(state);
    if (['add', 'remove', 'focus', 'refresh'].includes(kind) && !symbol) {
      // Nothing usable was named. For refresh/focus that means the board is
      // empty; for add it means speech recognition handed us a phrase.
      throw new board.NotOnBoard(
        kind === 'focus' ? board.FOCUS_NOT_ON_BOARD_MESSAGE
          : kind === 'add' ? board.unknownMessage(String(raw || 'that')) : board.NOT_ON_BOARD_MESSAGE,
      );
    }
    if (kind === 'add') {
      if (error) return board.failAdd(state, symbol, String(error));
      if (entry) return board.finishAdd(state, symbol, entry);
      return board.beginAdd(state, symbol, { now });
    }
    if (kind === 'refresh') {
      if (error) return board.failRefresh(state, symbol, String(error));
      if (entry) return board.finishRefresh(state, symbol, entry);
      return board.beginRefresh(state, symbol, { now });
    }
    if (kind === 'remove') return board.remove(state, symbol);
    if (kind === 'focus') return board.focus(state, symbol);
    throw new BoardError(`'${kind}' is not something this desk can do`);
  };
}

/** The board's one writer. A refusal changes nothing and comes back as a sentence. */
export class Desk {
  private state = board.initialState();
  private listeners: Listener[] = [];
  private reduce: ReturnType<typeof makeReducer>;
  seq = 0;

  constructor(clock: Clock = systemClock) {
    this.reduce = makeReducer(clock);
  }

  apply(intent: Intent, by: 'user' | 'agent' = 'user'): Result {
    let next: BoardState;
    try {
      next = this.reduce(this.state, intent);
    } catch (err) {
      if (err instanceof BoardError) return { applied: false, reason: err.message };
      throw err;
    }
    this.state = next;
    this.seq += 1;
    for (const listener of this.listeners) {
      try {
        listener(this.seq, next, intent);
      } catch (err) {
        console.error('[market-desk] [Desk] a listener failed after %s by %s: %s', intent.kind, by, (err as Error).message);
      }
    }
    return { applied: true, seq: this.seq, board: this.snapshot() };
  }

  /** The public board: what the page draws (the refresh floor's clock stays here). */
  snapshot(): Board { return board.publicView(this.state); }
  raw(): BoardState { return this.state; }
  onChange(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }
}

/**
 * Says something when the focused symbol has actually moved.
 *
 * Two guards, and both exist because the alternative is an avatar that will not
 * shut up. The `as_of` guard means a re-pull of an unchanged quote (the common
 * case out of hours) is silent however often the timer fires. The threshold is
 * measured against the percentage LAST SPOKEN, not the previous tick, so a stock
 * drifting 0.2% at a time still gets a line once it has drifted a point.
 * A stale row never speaks: that is the timer's failure path.
 */
export class Announcer {
  private spoken = new Map<string, [number, number]>();

  constructor(desk: Desk, private speaker: Speaker | null = null, private threshold = SPEAK_THRESHOLD_PCT) {
    desk.onChange((_seq, state) => {
      const cue = this.cueFor(state);
      if (cue && this.speaker) this.speaker.say(cue, MOVE_TTL_S);
    });
  }

  attach(speaker: Speaker) { this.speaker = speaker; }

  /** Something else just said this print aloud (a quote the user asked for, landing): it is the new baseline. */
  markSpoken(symbol: string, asOf: number, pct: number | null) {
    if (pct !== null) this.spoken.set(symbol, [asOf, pct]);
  }

  /** The line to say, or null. Split out so the whole rule tests without a session. */
  cueFor(state: Board): string | null {
    const symbol = state.focus;
    if (!symbol) return null;
    const entry = board.find(state, symbol);
    if (!entry || entry.stale) return null;
    const pct = entry.change_pct;
    const asOf = entry.as_of;
    if (pct === null || asOf === null || asOf === undefined) return null;
    const last = this.spoken.get(symbol);
    if (last && last[0] === asOf) return null; // same print, nothing new to read
    const baseline = last ? last[1] : 0;
    if (Math.abs(pct - baseline) < this.threshold) {
      // Seen, just not worth a sentence; re-seeing it must not become one either.
      this.spoken.set(symbol, [asOf, baseline]);
      return null;
    }
    this.spoken.set(symbol, [asOf, pct]);
    return say.moved(symbol, pct, entry.price);
  }
}

interface Asked { origin: Origin; said?: string }

/**
 * The pump that turns a claim in `fetching` into a quote on the board.
 *
 * It hangs off the store's change listener rather than being called by each
 * caller, so a symbol claimed by the panel's refresh button is pulled by exactly
 * the same code as one claimed by a spoken request.
 *
 * It also tells the avatar about pulls the user asked for: a symbol that never
 * arrived (any add: the avatar has usually already said it was coming), and,
 * new in this port, the quote that did land for a spoken or typed request (the
 * avatar answered that request before the app could act, so the real number
 * follows as an event). Several asked-for quotes in flight land as one line.
 * A failed background refresh still says nothing: the row keeps its last price
 * and greys, and a desk narrating its own plumbing every minute is a nuisance.
 */
export class Fetcher {
  private tasks = new Map<string, Promise<void>>();
  private asked = new Map<string, Asked>();
  private landed: { quote: Quote; said?: string }[] = [];

  constructor(
    private desk: Desk,
    private fetch: FetchQuote = (symbol, opts) => fetchEntry(symbol, opts),
    private clock: Clock = systemClock,
    private speaker: Speaker | null = null,
    private announcer: Announcer | null = null,
  ) {
    desk.onChange((_seq, state) => this.onChange(state));
  }

  attach(speaker: Speaker) { this.speaker = speaker; }

  /** A claim the user made (by voice, typing or a button), so its landing or failure can be told. */
  expect(symbol: string, asked: Asked) { this.asked.set(symbol, asked); }

  /** Every pull in flight, settled. For tests and shutdown. */
  async idle(): Promise<void> {
    while (this.tasks.size) await Promise.allSettled([...this.tasks.values()]);
  }

  private onChange(state: BoardState) {
    for (const symbol of state.fetching) {
      if (this.tasks.has(symbol)) continue;
      // Add or refresh is decided by the board itself, not by remembering which intent started it.
      const isRefresh = board.find(state, symbol) !== null;
      const task = this.pull(symbol, isRefresh).finally(() => this.tasks.delete(symbol));
      this.tasks.set(symbol, task);
    }
  }

  private async pull(symbol: string, isRefresh: boolean): Promise<void> {
    const kind = isRefresh ? 'refresh' : 'add';
    let entry: Quote;
    try {
      entry = await this.fetch(symbol, { now: this.clock() });
    } catch (err) {
      // A crashed pump is a frozen spinner: anything that is not a board error is the feed being down.
      const reason = err instanceof BoardError ? err.message : board.FEED_DOWN_MESSAGE;
      if (!(err instanceof BoardError)) console.error('[market-desk] [Feed] %s %s crashed: %s', kind, symbol, (err as Error)?.message);
      else console.info('[market-desk] [Feed] %s %s failed: %s', kind, symbol, reason);
      this.desk.apply({ kind, symbol, error: reason }, 'agent');
      const asked = this.asked.get(symbol);
      this.asked.delete(symbol);
      if (this.speaker && !isRefresh) this.speaker.say(say.addFailed(symbol, reason, asked?.said), RESULT_TTL_S);
      // A refresh the user asked for out loud was promised ("pulling it now"); the timer's own never was.
      else if (this.speaker && (asked?.origin === 'spoken' || asked?.origin === 'typed')) this.speaker.say(say.refreshFailed(symbol, reason), RESULT_TTL_S);
      this.flushLanded();
      return;
    }
    // The board keys on the ticker it claimed: a feed that answers in its own
    // spelling (BRK.B for BRK-B) must not put a second row up.
    entry = { ...entry, symbol };
    const asked = this.asked.get(symbol);
    this.asked.delete(symbol);
    const tell = asked && (asked.origin === 'spoken' || asked.origin === 'typed');
    const before = board.find(this.desk.raw(), symbol);
    // The line about this print is the landing's, not the announcer's: one voice per change.
    if (tell) this.announcer?.markSpoken(symbol, entry.as_of, entry.change_pct);
    const result = this.desk.apply({ kind, symbol, entry }, 'agent');
    if (!result.applied) {
      console.warn('[market-desk] [Feed] %s %s refused on landing: %s', kind, symbol, result.reason);
      return;
    }
    if (!tell || !this.speaker) return;
    if (isRefresh) {
      if (board.find(result.board, symbol)) this.speaker.say(say.refreshed(entry, before?.as_of === entry.as_of), RESULT_TTL_S);
      return;
    }
    if (board.find(result.board, symbol)) this.landed.push({ quote: board.find(result.board, symbol)!, said: asked.said });
    this.flushLanded();
  }

  /** Tell the avatar about the asked-for quotes that landed, once none it asked for is still in flight. */
  private flushLanded() {
    if (!this.landed.length || !this.speaker) return;
    const waiting = [...this.asked.entries()].some(([s, a]) => (a.origin === 'spoken' || a.origin === 'typed') && this.desk.raw().fetching.includes(s) && !board.find(this.desk.raw(), s));
    if (waiting) return;
    this.speaker.say(say.landed(this.landed.splice(0)), RESULT_TTL_S);
  }
}

/**
 * Pull the focused symbol every minute, on the desk's own initiative. It only
 * ever applies a bare `refresh`: the pump does the network and the announcer
 * decides whether to speak. Two refusals are entirely normal and neither is
 * logged loudly: an empty board, and the 15 s floor right after a person asked
 * for the same thing by hand.
 */
export class RefreshTimer {
  private readonly interval: number;
  private readonly cooldown: number;
  private readonly clock: Clock;
  private quietUntil = 0;
  private handle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private desk: Desk,
    { interval = TICK_SECONDS, cooldown = FAILURE_COOLDOWN_S, clock = systemClock }: { interval?: number; cooldown?: number; clock?: Clock } = {},
  ) {
    this.interval = interval;
    this.cooldown = cooldown;
    this.clock = clock;
  }

  start(): this {
    if (!this.handle) {
      this.handle = setInterval(() => {
        try { this.tick(); } catch (err) { console.error('[market-desk] [Timer] tick failed: %s', (err as Error).message); }
      }, this.interval * 1000);
      this.handle.unref?.();
    }
    return this;
  }

  stop() {
    if (this.handle) clearInterval(this.handle);
    this.handle = null;
  }

  get running() { return this.handle !== null; }

  /** One pull. Returns the store's result, or null when standing down. */
  tick(): Result | null {
    const now = this.clock();
    if (now < this.quietUntil) return null;
    const snapshot = this.desk.raw();
    const symbol = snapshot.focus;
    if (!symbol) return null;
    // The pump reports its failures by greying the row, some seconds after the
    // pull this timer asked for; that flag is what the NEXT tick reads to stand
    // down. This tick IS the retry; the cooldown is what the next one waits for.
    // Standing down instead of pulling would be permanent: the flag only clears
    // when a pull succeeds.
    const entry = board.find(snapshot, symbol);
    if (entry?.stale) {
      this.quietUntil = now + this.cooldown;
      console.info('[market-desk] [Timer] %s is stale: retrying now, then quiet for %ds', symbol, this.cooldown);
    }
    return this.desk.apply({ kind: 'refresh', symbol }, 'agent');
  }
}

/**
 * One user's desk: the board, its pump, announcer and timer, and the actions a
 * person can take on it. What the avatar is told depends on where the action
 * came from:
 * - a button: nothing (the board shows it; a refusal is printed on the panel),
 *   except a failed add and the announcer, as in the original;
 * - speech: the avatar has already answered it, so only what it could not
 *   know follows: a refusal, the quote that landed, a symbol that never did;
 * - a typed line: it is recorded, not forwarded, so the avatar hears the result.
 */
export class DeskSession {
  readonly desk: Desk;
  readonly announcer: Announcer;
  readonly fetcher: Fetcher;
  readonly timer: RefreshTimer;
  refusals = 0;

  constructor({ fetch, clock = systemClock, speaker = null }: { fetch?: FetchQuote; clock?: Clock; speaker?: Speaker | null } = {}) {
    this.desk = new Desk(clock);
    this.announcer = new Announcer(this.desk, speaker);
    this.fetcher = new Fetcher(this.desk, fetch, clock, speaker, this.announcer);
    this.timer = new RefreshTimer(this.desk, { clock });
  }

  board(): Board { return this.desk.snapshot(); }

  private outcome(extra: Partial<Outcome> & { handled: boolean }): Outcome {
    return { seq: this.desk.seq, board: this.board(), ...extra };
  }

  /** A desk action from a control, the judge, or a typed command. */
  act(action: Action, origin: Origin): Outcome {
    const tellRefusal = origin !== 'button';
    const refused = (reason: string) => this.outcome({ handled: true, kind: action.kind, refused: reason, event: tellRefusal ? say.refused(action.kind, reason) : undefined });
    const state = this.desk.raw();

    if (action.kind === 'clear') {
      const r = this.desk.apply({ kind: 'clear' });
      if (!r.applied) return refused(r.reason);
      return this.outcome({ handled: true, kind: 'clear', event: origin === 'typed' ? say.cleared() : undefined });
    }

    if (action.kind === 'add') return this.add(action.symbols, origin, action.said ?? {});

    if (action.kind === 'focus') {
      const symbol = action.symbols[0] ?? state.focus;
      if (!symbol) return refused(board.FOCUS_NOT_ON_BOARD_MESSAGE);
      // "Pull up Apple" when Apple is not on the board means PUT it up. Refusing
      // it was a dead end, and "pull up" sits one letter from "put up": a request
      // to add three symbols once came back as "the board is currently empty".
      if (!board.find(state, symbol)) {
        if (state.fetching.includes(symbol)) return this.outcome({ handled: true, kind: 'focus' }); // already on its way
        return this.add(action.symbols, origin, action.said ?? {});
      }
      const r = this.desk.apply({ kind: 'focus', symbol });
      if (!r.applied) return refused(r.reason);
      const row = board.find(r.board, symbol)!;
      return this.outcome({ handled: true, kind: 'focus', event: origin === 'typed' ? say.focused(row) : undefined });
    }

    if (action.kind === 'remove') {
      const symbols = action.symbols.length ? action.symbols : state.focus ? [state.focus] : [];
      if (!symbols.length) return refused(board.NOT_ON_BOARD_MESSAGE);
      const gone: string[] = [];
      const reasons: string[] = [];
      for (const symbol of symbols) {
        const r = this.desk.apply({ kind: 'remove', symbol });
        if (r.applied) gone.push(symbol);
        else reasons.push(symbols.length > 1 ? `${symbol}: ${r.reason}` : r.reason);
      }
      if (!gone.length) return refused(reasons.join(' '));
      const event = reasons.length && tellRefusal ? `${say.removed(gone)} ${say.refused('remove', reasons.join(' '))}` : origin === 'typed' ? say.removed(gone) : undefined;
      return this.outcome({ handled: true, kind: 'remove', refused: reasons.join(' ') || undefined, event });
    }

    // refresh: the named symbol, or the focused one
    const symbol = action.symbols[0] ?? null;
    const r = this.desk.apply({ kind: 'refresh', symbol });
    if (!r.applied) return refused(r.reason);
    const pulled = symbol ?? state.focus;
    if (pulled) this.fetcher.expect(pulled, { origin });
    return this.outcome({ handled: true, kind: 'refresh' });
  }

  private add(symbols: string[], origin: Origin, said: Record<string, string>): Outcome {
    const tell = origin !== 'button';
    if (!symbols.length) {
      const reason = board.unknownMessage('that');
      return this.outcome({ handled: true, kind: 'add', refused: reason, event: tell ? say.refused('add', reason) : undefined });
    }
    const reasons: string[] = [];
    for (const raw of symbols) {
      // The board decides what a ticker is; a phrase is refused before it costs a round trip.
      const symbol = board.normalizeSymbol(raw);
      const r: Result = symbol ? this.desk.apply({ kind: 'add', symbol }) : { applied: false, reason: board.unknownMessage(String(raw).toUpperCase()) };
      if (r.applied) this.fetcher.expect(symbol, { origin, said: said[raw] ?? said[symbol] });
      else reasons.push(symbols.length > 1 ? `${symbol || String(raw).toUpperCase()}: ${r.reason}` : r.reason);
    }
    const reason = reasons.join(' ') || undefined;
    return this.outcome({ handled: true, kind: 'add', refused: reason, event: reason && tell ? say.refused('add', reason) : undefined });
  }

  /** What the judge read in a line the user said or typed, acted on. */
  handle(judgement: Judgement, text: string, origin: Origin): Outcome {
    if (judgement.kind === 'none') return this.none();
    if (judgement.kind === 'advice') return this.advice(text, origin);
    if (judgement.kind === 'add' && !judgement.symbols.length && judgement.unresolved.length) return this.unresolved(judgement.unresolved, origin);
    return this.act({ kind: judgement.kind, symbols: judgement.symbols, said: judgement.said }, origin);
  }

  /** The decline path. A typed question is answered by an event (it is never
   * forwarded as a turn); a spoken one was already answered from the refusal
   * staged in the state, so the avatar is not made to refuse twice. */
  advice(asked: string, origin: Origin): Outcome {
    const fact = boardFact(this.board(), this.refusals);
    this.refusals += 1;
    return this.outcome({
      handled: true, kind: 'advice',
      advice: { asked, fact: fact ?? 'The board is empty.' },
      event: origin === 'typed' ? say.advice(asked, fact) : undefined,
    });
  }

  /** The user named something the desk could not turn into a ticker. */
  unresolved(names: string[], origin: Origin): Outcome {
    return this.outcome({ handled: true, kind: 'add', event: origin !== 'button' ? say.unresolved(names.join(', ')) : undefined });
  }

  /** Not a desk action: the avatar answers it from the board in its state. */
  none(): Outcome { return this.outcome({ handled: false }); }

  close() {
    this.timer.stop();
  }
}
