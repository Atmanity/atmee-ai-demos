// The board wired up: the reducer, the store, the fetch pump, the announcer,
// the refresh timer, and one user's desk session whose actions the host's
// tools and the page's buttons call. Ported from the original's table.py
// (and the action half of tools.py). Framework-free: the server runs one
// DeskSession per page; the tests run it with a fake feed and a fake clock.
//
// Why the fetch is not in the reducer: an action that needs a quote does not
// block the board on one. It claims a slot in `fetching`, the reducer returns
// at once, and the pump (a change listener) applies a SECOND intent when the
// data lands. Every path (a button, the host's add_symbols, the 60 s timer)
// therefore looks identical, and the reducer never blocks on a socket. A
// caller that wants the outcome (a tool call the host is waiting on) awaits
// the pump's pull, not the reducer.
import * as board from './board.ts';
import { BoardError } from './board.ts';
import { say } from './director.ts';
import { fetchEntry } from './feed.ts';
import type { AddReport, Asker, Board, BoardState, ClearReport, FocusReport, PullOutcome, Quote, RefreshReport, RemoveReport } from './types.ts';

/** How often the focused symbol is pulled on the desk's own initiative. */
export const TICK_SECONDS = 60;
/** A move of this size since the last thing said about the symbol is worth a line.
 * Below it the board updates silently: an analyst who reads out every 0.1% tick is noise. */
export const SPEAK_THRESHOLD_PCT = 1.0;
/** After a failed pull the timer stands down for this long. A feed that is down
 * or rate-limiting is not fixed by asking again in a minute, and hammering a 429
 * is how the whole app gets locked out. */
export const FAILURE_COOLDOWN_S = 300;
/** How long the desk's own lines stay worth saying (the kit caps event ttl at 60 s). */
export const MOVE_TTL_S = 30;
export const RESULT_TTL_S = 45;
/** How long a caller waits for a quote by default. The feed's worst case is
 * Nasdaq's 6 s timeout and then Yahoo's; the host's tool waits at most 20 s. */
export const WAIT_MS = 12_000;

export type Clock = () => number;
export const systemClock: Clock = () => Date.now() / 1000;

export interface Intent { kind: string; symbol?: string | null; entry?: Quote; error?: string; now?: number }
export type Result = { applied: true; seq: number; board: Board } | { applied: false; reason: string };
/**
 * Where the desk's own lines go: the server relays them to the page, which
 * hands them to the host as events. `call` is the page's call a line was
 * promised in (a quote "on its way"), so the page can drop it once that call
 * is over; a line with none (a 1% move) belongs to whichever call is on.
 */
export interface Speaker { say(text: string, ttlS: number, call?: number): void }
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


interface Asked {
  by: Asker;
  said?: string;
  call?: number;
  /** A "pull up" of a stock not yet on the board: it takes watch when it lands, if watch is still where it was then. */
  front?: { from: string | null };
}

/**
 * The pump that turns a claim in `fetching` into a quote on the board.
 *
 * It hangs off the store's change listener rather than being called by each
 * caller, so a symbol claimed by a button is pulled by exactly the same code
 * as one claimed by the host's tool or the timer.
 *
 * Every pull can be awaited (`settled`), which is how a tool call returns the
 * real quote in the host's first reply. Who tells the host how a pull went:
 * - a pull a caller is waiting on (`tool`, `button`): the caller, in its reply;
 * - a pull whose caller stopped waiting (`late`): the pump, when it lands
 *   (several in one line) or fails;
 * - an add nobody asked for that fails: the pump (a promise may be out);
 * - the timer's own pulls: the announcer on a 1% move; a failure says nothing
 *   (the row greys; a desk narrating its plumbing every minute is a nuisance).
 */
export class Fetcher {
  private tasks = new Map<string, Promise<PullOutcome>>();
  private asked = new Map<string, Asked>();
  private outcomes = new Map<string, PullOutcome>();
  private landed: { quote: Quote; said?: string; call?: number; front?: boolean }[] = [];

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

  /** Someone asked for this pull: their reply, or the late line, reports it. */
  expect(symbol: string, asked: Asked) { this.asked.set(symbol, asked); }

  /** Another caller waits on a pull already in flight: its reply reports it too. */
  join(symbol: string, next: Asked) {
    const asked = this.asked.get(symbol);
    this.asked.set(symbol, { by: next.by, said: next.said ?? asked?.said, call: next.call ?? asked?.call, front: next.front ?? asked?.front });
  }

  /** The caller stopped waiting: the landing (or the failure) is told by the pump. */
  late(symbol: string, call?: number) {
    const asked = this.asked.get(symbol);
    this.asked.set(symbol, { ...asked, by: 'late', call: call ?? asked?.call });
  }

  /** The pull in flight for this symbol, or null when there is none. */
  settled(symbol: string): Promise<PullOutcome> | null { return this.tasks.get(symbol) ?? null; }

  /** How the last pull of this symbol ended. */
  outcome(symbol: string): PullOutcome | null { return this.outcomes.get(symbol) ?? null; }

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

  private async pull(symbol: string, isRefresh: boolean): Promise<PullOutcome> {
    const kind = isRefresh ? 'refresh' : 'add';
    let entry: Quote;
    try {
      entry = await this.fetch(symbol, { now: this.clock() });
    } catch (err) {
      // A crashed pump is a frozen spinner: anything that is not a board error is the feed being down.
      const reason = err instanceof BoardError ? err.message : board.FEED_DOWN_MESSAGE;
      if (!(err instanceof BoardError)) console.error('[market-desk] [Feed] %s %s crashed: %s', kind, symbol, (err as Error)?.message);
      else console.info('[market-desk] [Feed] %s %s failed: %s', kind, symbol, reason);
      const asked = this.asked.get(symbol);
      this.asked.delete(symbol);
      // The board let go of this pull (cleared, or the stock removed) while it
      // was in flight: as with a landing, there is nothing to show or say.
      if (isRefresh ? !board.find(this.desk.raw(), symbol) : !this.desk.raw().fetching.includes(symbol)) {
        const dropped: PullOutcome = { symbol, kind, ok: false, reason: 'It came off the board before its quote came back.' };
        this.outcomes.set(symbol, dropped);
        this.flushLanded();
        return dropped;
      }
      const outcome: PullOutcome = { symbol, kind, ok: false, reason };
      this.outcomes.set(symbol, outcome);
      this.desk.apply({ kind, symbol, error: reason }, 'agent');
      const reported = asked?.by === 'tool' || asked?.by === 'button';
      if (this.speaker && !isRefresh && !reported) this.speaker.say(say.addFailed(symbol, reason, asked?.said), RESULT_TTL_S, asked?.call);
      // A refresh someone stopped waiting for was promised; the timer's own never was.
      else if (this.speaker && isRefresh && asked?.by === 'late') this.speaker.say(say.refreshFailed(symbol, reason), RESULT_TTL_S, asked.call);
      this.flushLanded();
      return outcome;
    }
    // The board keys on the ticker it claimed: a feed that answers in its own
    // spelling (BRK.B for BRK-B) must not put a second row up.
    entry = { ...entry, symbol };
    const asked = this.asked.get(symbol);
    this.asked.delete(symbol);
    const before = board.find(this.desk.raw(), symbol);
    // The line about this print is the asker's, not the announcer's: one voice per change.
    if (asked) this.announcer?.markSpoken(symbol, entry.as_of, entry.change_pct);
    const outcome: PullOutcome = { symbol, kind, ok: true };
    this.outcomes.set(symbol, outcome);
    const watchBefore = this.desk.raw().focus;
    let result = this.desk.apply({ kind, symbol, entry }, 'agent');
    if (!result.applied) {
      console.warn('[market-desk] [Feed] %s %s refused on landing: %s', kind, symbol, result.reason);
      return outcome;
    }
    // "Pull up NVDA" for a stock that was not up yet: it takes watch on landing,
    // late or not, unless the user put something else on watch meanwhile.
    const front = Boolean(asked?.front && board.find(result.board, symbol) && watchBefore === asked.front.from);
    if (front && result.board.focus !== symbol) {
      const focused = this.desk.apply({ kind: 'focus', symbol }, 'agent');
      if (focused.applied) result = focused;
    }
    if (asked?.by !== 'late' || !this.speaker) return outcome;
    if (isRefresh) {
      if (board.find(result.board, symbol)) this.speaker.say(say.refreshed(entry, before?.as_of === entry.as_of), RESULT_TTL_S, asked.call);
      return outcome;
    }
    if (board.find(result.board, symbol)) this.landed.push({ quote: board.find(result.board, symbol)!, said: asked.said, call: asked.call, front });
    this.flushLanded();
    return outcome;
  }

  /** Tell the host about the late quotes that landed, once none it is owed is still in flight. */
  private flushLanded() {
    if (!this.landed.length || !this.speaker) return;
    const waiting = [...this.asked.entries()].some(([s, a]) => a.by === 'late' && this.desk.raw().fetching.includes(s) && !board.find(this.desk.raw(), s));
    if (waiting) return;
    // One line per call: quotes promised in different calls are never read out together.
    const rows = this.landed.splice(0);
    for (const call of [...new Set(rows.map((r) => r.call))]) this.speaker.say(say.landed(rows.filter((r) => r.call === call)), RESULT_TTL_S, call);
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
 * One user's desk: the board, its pump, announcer and timer, and the actions
 * the host's tools and the page's buttons both call. Each action returns a
 * report of what happened, which the director words for the host. The ones
 * that need a quote wait for the pump (at most `waitMs`), so the reply carries
 * the real number; anything still in flight when the wait runs out is handed
 * to the pump, which tells the host when it lands.
 */
export class DeskSession {
  readonly desk: Desk;
  readonly announcer: Announcer;
  readonly fetcher: Fetcher;
  readonly timer: RefreshTimer;

  constructor({ fetch, clock = systemClock, speaker = null }: { fetch?: FetchQuote; clock?: Clock; speaker?: Speaker | null } = {}) {
    this.desk = new Desk(clock);
    this.announcer = new Announcer(this.desk, speaker);
    this.fetcher = new Fetcher(this.desk, fetch, clock, speaker, this.announcer);
    this.timer = new RefreshTimer(this.desk, { clock });
  }

  board(): Board { return this.desk.snapshot(); }

  /** Until these pulls settle, or `ms` runs out. */
  private async wait(symbols: string[], ms: number): Promise<void> {
    const pulls = symbols.map((s) => this.fetcher.settled(s)).filter((p): p is Promise<PullOutcome> => p !== null);
    if (!pulls.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.allSettled(pulls), new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.max(0, ms)); })]);
    clearTimeout(timer);
  }

  /**
   * Put stocks up and wait for their quotes. `symbols` are tickers (a name is
   * the caller's to resolve first); `said` is what the user called each one,
   * keyed by ticker. The board refuses what it must (full, a phrase that is
   * not a ticker) before any round trip.
   */
  async add(symbols: string[], { by, said = {}, waitMs = WAIT_MS, unresolved = [], call, front = false }: { by: 'tool' | 'button'; said?: Record<string, string>; waitMs?: number; unresolved?: string[]; call?: number; front?: boolean }): Promise<AddReport> {
    // Where watch is now: a "pull up" moves it on landing only if it has not moved by then.
    const wantFront = front ? { from: this.desk.raw().focus } : undefined;
    const report: AddReport = { landed: [], already: [], failed: [], pending: [], unresolved: [...unresolved] };
    const claimed: string[] = [];
    for (const raw of symbols) {
      const symbol = board.normalizeSymbol(raw);
      if (!symbol) {
        const shown = String(raw).trim().toUpperCase() || 'that';
        report.failed.push({ symbol: shown, reason: board.unknownMessage(shown), said: said[raw] });
        continue;
      }
      if (claimed.includes(symbol)) continue;
      const state = this.desk.raw();
      const row = board.find(state, symbol);
      if (row) {
        report.already.push(row);
        continue;
      }
      if (state.fetching.includes(symbol)) {
        // Already on its way (a button, a moment ago): wait for that pull.
        this.fetcher.join(symbol, { by, said: said[symbol], call, front: wantFront });
        claimed.push(symbol);
        continue;
      }
      const r = this.desk.apply({ kind: 'add', symbol });
      if (!r.applied) {
        report.failed.push({ symbol, reason: r.reason, said: said[symbol] });
        continue;
      }
      this.fetcher.expect(symbol, { by, said: said[symbol], call, front: wantFront });
      claimed.push(symbol);
    }
    await this.wait(claimed, waitMs);
    const state = this.desk.raw();
    for (const symbol of claimed) {
      const row = board.find(state, symbol);
      if (row) report.landed.push({ quote: row, said: said[symbol] });
      else if (state.fetching.includes(symbol)) {
        report.pending.push(symbol);
        this.fetcher.late(symbol, call);
      } else {
        const outcome = this.fetcher.outcome(symbol);
        const reason = outcome?.ok ? 'It came off the board again before it could be read.' : outcome?.reason ?? state.last_error ?? board.FEED_DOWN_MESSAGE;
        report.failed.push({ symbol, reason, said: said[symbol] });
      }
    }
    return report;
  }

  /** Bring one stock front and centre (the one the timer refreshes); put it up first if it is not there. */
  async focus(symbol: string, { by, said, waitMs = WAIT_MS, call }: { by: 'tool' | 'button'; said?: string; waitMs?: number; call?: number }): Promise<FocusReport> {
    const row = board.find(this.desk.raw(), symbol);
    if (!row) {
      // "Pull up Apple" when Apple is not on the board means PUT it up, and
      // look at it. Refusing was a dead end, and "pull up" sits one letter
      // from "put up": a request to add three once came back "the board is empty".
      // The pump puts it on watch when it lands, now or after the wait.
      const report = await this.add([symbol], { by, said: said ? { [symbol]: said } : {}, waitMs, call, front: true });
      return { kind: 'added', report: { ...report, landed: report.landed.map((l) => ({ ...l, quote: board.find(this.desk.raw(), l.quote.symbol) ?? l.quote })) } };
    }
    // The reply reads this print, so it is the announcer's baseline, not news.
    this.announcer.markSpoken(symbol, row.as_of, row.change_pct);
    this.desk.apply({ kind: 'focus', symbol });
    return { kind: 'focused', quote: board.find(this.desk.raw(), symbol)! };
  }

  /** Pull a fresh quote for one stock (the focused one by default) and wait for it. */
  async refresh(symbol: string | null, { by, waitMs = WAIT_MS, call }: { by: 'tool' | 'button'; waitMs?: number; call?: number }): Promise<RefreshReport> {
    const state = this.desk.raw();
    const target = symbol ?? state.focus;
    if (!target) return { kind: 'empty' };
    const before = board.find(state, target);
    const inFlight = state.fetching.includes(target);
    if (!before && !inFlight) return { kind: 'missing', symbol: target };
    if (inFlight) this.fetcher.join(target, { by, call });
    else {
      const r = this.desk.apply({ kind: 'refresh', symbol: target });
      // On a row that is there and not in flight, the one refusal left is the 15 s floor.
      if (!r.applied) return { kind: 'tooSoon', quote: before! };
      this.fetcher.expect(target, { by, call });
    }
    await this.wait([target], waitMs);
    const now = this.desk.raw();
    if (now.fetching.includes(target)) {
      this.fetcher.late(target, call);
      return { kind: 'pending', symbol: target };
    }
    const after = board.find(now, target);
    if (!after) return { kind: 'missing', symbol: target };
    const outcome = this.fetcher.outcome(target);
    if (after.stale || outcome?.ok === false) return { kind: 'failed', quote: after, reason: after.error ?? outcome?.reason ?? board.FEED_DOWN_MESSAGE };
    return { kind: 'fresh', quote: after, samePrint: before?.as_of === after.as_of };
  }

  /** Take stocks off (the focused one when none is named). Instant: nothing to fetch. */
  remove(symbols: string[]): RemoveReport {
    const state = this.desk.raw();
    const targets = symbols.length ? symbols : state.focus ? [state.focus] : [];
    if (!targets.length) return { removed: [], refused: [board.NOT_ON_BOARD_MESSAGE], board: this.board() };
    const removed: string[] = [];
    const refused: string[] = [];
    for (const symbol of targets) {
      const r = this.desk.apply({ kind: 'remove', symbol });
      if (r.applied) removed.push(symbol);
      else refused.push(targets.length > 1 ? `${symbol}: ${r.reason}` : r.reason);
    }
    return { removed, refused, board: this.board() };
  }

  clear(): ClearReport {
    const r = this.desk.apply({ kind: 'clear' });
    return r.applied ? { cleared: true } : { cleared: false, reason: r.reason };
  }

  close() {
    this.timer.stop();
  }
}
