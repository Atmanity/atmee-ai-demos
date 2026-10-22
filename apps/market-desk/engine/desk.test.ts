// The wired board: intents in, changes out, the pump, the timer and the
// announcer. Ported from the original's tests/test_table.py (the tool cases
// now go through DeskSession, which is where the old tool bodies live).
// `board.test.ts` proves the rules; this proves the plumbing: a refusal that
// reaches nobody, a row stuck in `fetching` because the pump dropped its task,
// a payload too big to stream, a desk that will not shut up.
import { describe, expect, test, vi } from 'vitest';
import * as board from './board.ts';
import { Announcer, Desk, DeskSession, Fetcher, RefreshTimer, type FetchQuote, type Speaker } from './desk.ts';
import { boardState } from './director.ts';
import { quote } from './test-helpers.ts';
import type { Quote } from './types.ts';

vi.spyOn(console, 'info').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

class Clock {
  constructor(public now = 1000) {}
  fn = () => this.now;
}

class FakeSpeaker implements Speaker {
  said: string[] = [];
  say(text: string) { this.said.push(text); }
}

/** Let the pump's pulls run (each is a few awaits deep). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function storeWith({ clock = new Clock(), fetch }: { clock?: Clock; fetch?: FetchQuote } = {}) {
  const desk = new Desk(clock.fn);
  const fetcher = fetch ? new Fetcher(desk, fetch, clock.fn) : null;
  return { desk, clock, fetcher };
}

const SIX = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOG'];
function fill(desk: Desk, symbols = SIX) {
  for (const symbol of symbols) {
    desk.apply({ kind: 'add', symbol });
    desk.apply({ kind: 'add', symbol, entry: quote({ symbol }) }, 'agent');
  }
}

// ─── the store and its refusals ──────────────────────────────────────────

test('a refusal comes back with the sentence and changes nothing', () => {
  const { desk } = storeWith();
  desk.apply({ kind: 'add', symbol: 'AAPL' });
  desk.apply({ kind: 'add', symbol: 'AAPL', entry: quote() }, 'agent');
  const result = desk.apply({ kind: 'add', symbol: 'aapl' });
  expect(result).toEqual({ applied: false, reason: "That one's already on the board." });
  expect(desk.snapshot().watchlist).toHaveLength(1);
});

test('an unknown intent is refused rather than silently ignored', () => {
  expect(storeWith().desk.apply({ kind: 'short_it', symbol: 'AAPL' }).applied).toBe(false);
});

test('a refresh with no symbol means the one we are looking at', () => {
  const { desk, clock } = storeWith();
  desk.apply({ kind: 'add', symbol: 'AAPL' });
  desk.apply({ kind: 'add', symbol: 'AAPL', entry: quote() }, 'agent');
  clock.now += 100;
  expect(desk.apply({ kind: 'refresh' }).applied).toBe(true);
  expect(desk.snapshot().fetching).toEqual(['AAPL']);
});

test('a refresh on an empty board is refused, not a crash', () => {
  expect(storeWith().desk.apply({ kind: 'refresh' })).toEqual({ applied: false, reason: "That isn't on the board." });
});

test('every accepted intent hands its listeners the board, never the pull clock', () => {
  // (The original asserted on the broadcast envelope; here the server streams
  // the public snapshot to the page from the same listener.)
  const { desk } = storeWith();
  const seen: unknown[] = [];
  desk.onChange((seq) => seen.push({ seq, board: desk.snapshot() }));
  const result = desk.apply({ kind: 'add', symbol: 'AAPL' });
  expect(result.applied && result.board).not.toHaveProperty('_pulled');
  expect(seen).toHaveLength(1);
  expect(JSON.stringify(seen)).not.toContain('_pulled');
});

// ─── the pump ────────────────────────────────────────────────────────────

test('a claimed symbol is fetched and lands on the board', async () => {
  // The page has no network: a refresh it asks for is pulled by the server's
  // pump off the change listener, or the spinner never resolves.
  const { desk } = storeWith({ fetch: async (symbol) => quote({ symbol }) });
  desk.apply({ kind: 'add', symbol: 'NVDA' });
  expect(desk.snapshot().fetching).toEqual(['NVDA']);
  await settle();
  const snapshot = desk.snapshot();
  expect(snapshot.fetching).toEqual([]);
  expect(snapshot.watchlist.map((e) => e.symbol)).toEqual(['NVDA']);
  expect(snapshot.focus).toBe('NVDA');
});

test('a feed failure on an add shows the reason and frees the slot', async () => {
  const { desk } = storeWith({ fetch: async (symbol) => { throw new board.UnknownSymbol(board.unknownMessage(symbol)); } });
  desk.apply({ kind: 'add', symbol: 'ZZZZ' });
  await settle();
  const snapshot = desk.snapshot();
  expect(snapshot.watchlist).toEqual([]);
  expect(snapshot.fetching).toEqual([]);
  expect(snapshot.last_error).toBe("I couldn't find a listing for ZZZZ — check the ticker.");
});

test('a rate-limited refresh greys the row and says which it was', async () => {
  let calls = 0;
  const { desk, clock } = storeWith({
    fetch: async (symbol) => {
      calls += 1;
      if (calls === 1) return quote({ symbol });
      throw new board.RateLimited(board.RATE_LIMITED_MESSAGE);
    },
  });
  desk.apply({ kind: 'add', symbol: 'AAPL' });
  await settle();
  clock.now += 60;
  desk.apply({ kind: 'refresh', symbol: 'AAPL' });
  await settle();
  const row = board.find(desk.snapshot(), 'AAPL')!;
  expect(row.stale).toBe(true);
  expect(row.error).toBe('The feed is rate-limiting me. Give it about a minute.');
  expect(row.price).toBe(306.83);
});

test('NEW: a quote that answers in its own spelling of the ticker does not make a second row', async () => {
  const { desk } = storeWith({ fetch: async () => quote({ symbol: 'BRK.B' }) });
  desk.apply({ kind: 'add', symbol: 'BRK-B' });
  await settle();
  desk.apply({ kind: 'add', symbol: 'BRK-B' });
  await settle();
  expect(desk.snapshot().watchlist.map((q) => q.symbol)).toEqual(['BRK-B']);
});

test('a crashing fetch does not leave the row spinning forever', async () => {
  const { desk } = storeWith({ fetch: async () => { throw new Error('boom'); } });
  desk.apply({ kind: 'add', symbol: 'AAPL' });
  await settle();
  expect(desk.snapshot().fetching).toEqual([]);
});

// ─── the timer and the announcer ─────────────────────────────────────────

test('the timer pulls the focused symbol and only that one', async () => {
  const pulled: string[] = [];
  const { desk, clock } = storeWith({ fetch: async (symbol) => { pulled.push(symbol); return quote({ symbol }); } });
  for (const symbol of ['AAPL', 'MSFT']) {
    desk.apply({ kind: 'add', symbol });
    await settle();
  }
  pulled.length = 0;
  clock.now += 60;
  new RefreshTimer(desk, { clock: clock.fn }).tick();
  await settle();
  expect(pulled).toEqual(['AAPL']);
});

test('the timer respects the fifteen-second floor it shares with everyone', async () => {
  const { desk, clock } = storeWith({ fetch: async (symbol) => quote({ symbol }) });
  desk.apply({ kind: 'add', symbol: 'AAPL' });
  await settle();
  clock.now += 5;
  expect(new RefreshTimer(desk, { clock: clock.fn }).tick()).toEqual({ applied: false, reason: 'I just pulled that — nothing new yet.' });
});

test('a stale row stands the timer down for five minutes', () => {
  const { desk, clock } = storeWith();
  desk.apply({ kind: 'add', symbol: 'AAPL' });
  desk.apply({ kind: 'add', symbol: 'AAPL', entry: quote() }, 'agent');
  desk.apply({ kind: 'refresh', symbol: 'AAPL', error: board.FEED_DOWN_MESSAGE }, 'agent');
  const timer = new RefreshTimer(desk, { clock: clock.fn });
  clock.now += 60;
  expect(timer.tick()).not.toBeNull(); // this tick is the retry
  clock.now += 120;
  expect(timer.tick()).toBeNull(); // ...and then it is quiet
  clock.now += 200; // past five minutes
  expect(timer.tick()).not.toBeNull(); // and asks again
});

test('the timer does nothing at all on an empty board', () => {
  const { desk, clock } = storeWith();
  expect(new RefreshTimer(desk, { clock: clock.fn }).tick()).toBeNull();
});

test('a move over a point is spoken once, and not again for the same print', () => {
  const speaker = new FakeSpeaker();
  const { desk } = storeWith();
  new Announcer(desk, speaker);
  desk.apply({ kind: 'add', symbol: 'AAPL' });
  desk.apply({ kind: 'add', symbol: 'AAPL', entry: quote({ pct: -2.4, asOf: 111 }) }, 'agent');
  expect(speaker.said).toHaveLength(1);
  expect(speaker.said[0]).toContain('down 2.40%');
  // The same print re-applied says nothing: the common out-of-hours case.
  desk.apply({ kind: 'focus', symbol: 'AAPL' });
  expect(speaker.said).toHaveLength(1);
});

test('a quiet tick is not worth a sentence', () => {
  const speaker = new FakeSpeaker();
  const { desk } = storeWith();
  new Announcer(desk, speaker);
  desk.apply({ kind: 'add', symbol: 'AAPL' });
  desk.apply({ kind: 'add', symbol: 'AAPL', entry: quote({ pct: 0.3, asOf: 111 }) }, 'agent');
  expect(speaker.said).toEqual([]);
});

test('a failed pull never speaks', () => {
  // The timer's failure path greys the card. An avatar that announces its own
  // plumbing failures is a nuisance, not a desk.
  const speaker = new FakeSpeaker();
  const { desk } = storeWith();
  new Announcer(desk, speaker);
  desk.apply({ kind: 'add', symbol: 'AAPL' });
  desk.apply({ kind: 'add', symbol: 'AAPL', entry: quote({ pct: 0.1, asOf: 111 }) }, 'agent');
  desk.apply({ kind: 'refresh', symbol: 'AAPL', error: board.FEED_DOWN_MESSAGE }, 'agent');
  expect(speaker.said).toEqual([]);
});

test('drift is measured against what was last said, not the last tick', () => {
  const speaker = new FakeSpeaker();
  const { desk } = storeWith();
  new Announcer(desk, speaker);
  desk.apply({ kind: 'add', symbol: 'AAPL' });
  [0.3, 0.6, 0.9, 1.2].forEach((pct, i) => {
    desk.apply({ kind: i === 0 ? 'add' : 'refresh', symbol: 'AAPL', entry: quote({ pct, asOf: 100 + i }) }, 'agent');
  });
  // Four quiet steps, one point of total drift: exactly one line.
  expect(speaker.said).toHaveLength(1);
  expect(speaker.said[0]).toContain('up 1.20%');
});

// ─── the payload and the state ───────────────────────────────────────────

test('a full board of ninety-point histories stays small enough to stream on every change', () => {
  // The original's wire dropped envelopes over 32 KiB without a word; the
  // stream has no such cap, but the board goes out on every change.
  const { desk } = storeWith();
  fill(desk);
  const size = new TextEncoder().encode(JSON.stringify({ seq: desk.seq, board: desk.snapshot() })).length;
  expect(size).toBeLessThan(16 * 1024);
});

test('the state carries a line per symbol and never the daily closes', () => {
  // Ninety floats a symbol would bury the prices, the only thing the analyst
  // is ever asked for, and what falls off the end gets invented.
  const { desk } = storeWith();
  fill(desk);
  const state = boardState(desk.snapshot(), 1785861561);
  expect(state.startsWith('[Live market board]')).toBe(true);
  expect(state).not.toContain('306.94'); // a point of the history
  expect(state).not.toContain('series');
  for (const symbol of SIX) expect(state).toContain(`${symbol} 306.83 -0.58%`);
});

test('the state cannot be read as an empty board while quotes are in flight', () => {
  // Found by playing it: two cards were visibly filling in and the analyst said
  // "the board is still empty". Between the request and the data the board
  // genuinely IS empty with symbols in flight, and a field is something a model
  // summarises; a sentence is something it repeats.
  const { desk } = storeWith();
  desk.apply({ kind: 'add', symbol: 'AAPL' });
  desk.apply({ kind: 'add', symbol: 'NVDA' });
  const state = boardState(desk.snapshot(), 1000);
  expect(state).toContain('ARRIVING NOW');
  expect(state).toContain('AAPL, NVDA are');
  expect(state.toLowerCase()).toContain('not empty');
});

test('a background refresh is not announced as a stock arriving', () => {
  // Found by playing it: Apple had been on the board for minutes when the desk
  // said "Apple is arriving now", mid-answer about a different ticker, because
  // `fetching` carries adds and refreshes alike.
  const { desk, clock } = storeWith();
  desk.apply({ kind: 'add', symbol: 'AAPL' });
  desk.apply({ kind: 'add', symbol: 'AAPL', entry: quote() }, 'agent');
  clock.now += 100;
  desk.apply({ kind: 'refresh' });
  expect(desk.snapshot().fetching).toEqual(['AAPL']);
  expect(boardState(desk.snapshot(), clock.now)).not.toContain('ARRIVING');
  // And an add alongside it still is: the two are not the same event.
  desk.apply({ kind: 'add', symbol: 'NVDA' });
  const state = boardState(desk.snapshot(), clock.now);
  expect(state).toContain('NVDA is ARRIVING NOW');
  expect(state.split('ARRIVING NOW')[0].split('—').at(-1)).not.toContain('AAPL');
});

// ─── a symbol that never arrived ─────────────────────────────────────────
//
// Live: "add ZQXWQ" -> the desk said "ZQXWQ is arriving now", the feed 404'd,
// the board printed the reason and the avatar never said another word about
// it. The promise is out before the fetch fails.

test('a symbol that never arrived is said out loud', async () => {
  const speaker = new FakeSpeaker();
  const { desk, fetcher } = storeWith({ fetch: async (symbol) => { throw new board.UnknownSymbol(board.unknownMessage(symbol)); } });
  fetcher!.attach(speaker);
  desk.apply({ kind: 'add', symbol: 'ZQXWQ' });
  await settle();
  expect(speaker.said).toHaveLength(1);
  expect(speaker.said[0]).toContain('ZQXWQ');
  expect(speaker.said[0]).toContain('check the ticker');
  expect(speaker.said[0]).toContain('did NOT go up');
});

test('a failed background refresh still says nothing', async () => {
  let calls = 0;
  const speaker = new FakeSpeaker();
  const { desk, clock, fetcher } = storeWith({
    fetch: async (symbol) => {
      calls += 1;
      if (calls === 1) return quote({ symbol });
      throw new board.FeedUnavailable(board.FEED_DOWN_MESSAGE);
    },
  });
  fetcher!.attach(speaker);
  desk.apply({ kind: 'add', symbol: 'AAPL' });
  await settle();
  speaker.said.length = 0;
  clock.now += 100;
  desk.apply({ kind: 'refresh', symbol: 'AAPL' });
  await settle();
  expect(speaker.said).toEqual([]);
  expect(desk.snapshot().watchlist[0].stale).toBe(true);
});

test('a failed add says nothing when there is no voice yet', async () => {
  // The desk exists before the avatar does; a press during start-up must not take the pump down.
  const { desk } = storeWith({ fetch: async (symbol) => { throw new board.UnknownSymbol(board.unknownMessage(symbol)); } });
  desk.apply({ kind: 'add', symbol: 'ZQXWQ' });
  await settle();
  expect(desk.snapshot().last_error).toBeTruthy();
});

// ─── what the 2026-08-12 panel found ─────────────────────────────────────
// (the 52-week range in the state and the age of a row the timer left behind
// are in director.test.ts, next to the state builder)

// ─── the session: what the old tools did, and what the avatar is told ────

function session(fetch: FetchQuote = async (symbol) => quote({ symbol }), clock = new Clock()) {
  const speaker = new FakeSpeaker();
  return { s: new DeskSession({ fetch, clock: clock.fn, speaker }), speaker, clock };
}

describe('the session (the old tool bodies)', () => {
  test('a phrase that is not a ticker is refused before the round trip, and a ticker is claimed', () => {
    const { s } = session();
    const refused = s.act({ kind: 'add', symbols: ["nvidia's ticker is nvda"] }, 'spoken');
    expect(refused.refused).toContain("couldn't find a listing");
    const ok = s.act({ kind: 'add', symbols: [' nvda '] }, 'spoken');
    expect(ok.refused).toBeUndefined();
    expect(ok.event).toBeUndefined(); // the avatar already answered; the landing will follow
    expect(s.board().fetching).toEqual(['NVDA']);
  });

  test('a refused add tells the avatar to say so and claim nothing', () => {
    const { s } = session();
    fill(s.desk);
    const outcome = s.act({ kind: 'add', symbols: ['META'] }, 'spoken');
    expect(outcome.event).toContain('The board only holds six — drop one first.');
    expect(outcome.event).toContain('do not claim anything was added');
  });

  test.each([
    ['remove', ['MSFT'], "That isn't on the board."],
    ['clear', [], "The board's already clear."],
  ] as const)('every refusal reaches the avatar verbatim: %s', (kind, symbols, expected) => {
    const { s } = session();
    expect(s.act({ kind, symbols: [...symbols] }, 'spoken').event).toContain(expected);
  });

  test('pulling up something not on the board puts it there', () => {
    // Found by playing it. "Pull up Apple" when Apple is not up means PUT it up;
    // refusing it was a dead end, and it sits one letter from "put up".
    const { s } = session();
    const outcome = s.act({ kind: 'focus', symbols: ['MSFT'] }, 'spoken');
    expect(outcome.refused).toBeUndefined();
    expect(s.board().fetching).toEqual(['MSFT']);
  });

  test('pulling up something already there still just focuses it', () => {
    const { s } = session();
    fill(s.desk, ['MSFT', 'AAPL']);
    const outcome = s.act({ kind: 'focus', symbols: ['MSFT'] }, 'typed');
    expect(outcome.event).toContain('front and centre');
    expect(s.board().focus).toBe('MSFT');
  });

  test('the advice question has somewhere to go', () => {
    const { s } = session();
    fill(s.desk, ['NVDA']);
    const typed = s.advice('should I buy it?', 'typed');
    expect(typed.handled).toBe(true);
    expect(typed.event).toContain("I read the tape, I don't give advice.");
    expect(typed.event).toContain('NVDA is at 306.83');
    // Spoken, the avatar answered from the refusal staged in its state; it is not made to refuse twice.
    const spoken = s.advice('should I buy it?', 'spoken');
    expect(spoken.event).toBeUndefined();
    expect(spoken.advice?.fact).toBeTruthy();
  });

  test('a button press tells the avatar nothing, refused or not', () => {
    const { s } = session();
    expect(s.act({ kind: 'clear', symbols: [] }, 'button')).toMatchObject({ refused: "The board's already clear.", event: undefined });
    expect(s.act({ kind: 'add', symbols: ['AAPL'] }, 'button').event).toBeUndefined();
  });

  test('a quote the user asked for is read when it lands, once, and not again by the announcer', async () => {
    const { s, speaker } = session(async (symbol) => quote({ symbol, pct: 2.5, asOf: 500 }));
    s.act({ kind: 'add', symbols: ['NVDA'], said: { NVDA: 'nvidia' } }, 'spoken');
    await settle();
    expect(speaker.said).toHaveLength(1);
    expect(speaker.said[0]).toContain('NVDA (NVDA Inc., for "nvidia") at 306.83, up 2.50% on the day');
  });

  test('a panel add lands silently unless it moved a point (the announcer, as in the original)', async () => {
    const quiet = session(async (symbol) => quote({ symbol, pct: 0.4 }));
    quiet.s.act({ kind: 'add', symbols: ['AAPL'] }, 'button');
    await settle();
    expect(quiet.speaker.said).toEqual([]);
    const loud = session(async (symbol) => quote({ symbol, pct: -1.6 }));
    loud.s.act({ kind: 'add', symbols: ['AAPL'] }, 'button');
    await settle();
    expect(loud.speaker.said).toHaveLength(1);
    expect(loud.speaker.said[0]).toContain('down 1.60%');
  });

  test('several quotes asked for in one breath are read in one line', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { s, speaker } = session(async (symbol) => {
      if (symbol === 'TSLA') await gate;
      return quote({ symbol });
    });
    s.act({ kind: 'add', symbols: ['AAPL', 'NVDA', 'TSLA'] }, 'spoken');
    await settle();
    expect(speaker.said).toEqual([]); // TSLA is still on its way
    release();
    await settle();
    expect(speaker.said).toHaveLength(1);
    expect(speaker.said[0]).toMatch(/AAPL .*NVDA .*TSLA /);
  });

  test('a name the desk looked up and could not find is said with what the user called it', async () => {
    const { s, speaker } = session(async (symbol) => { throw new board.UnknownSymbol(board.unknownMessage(symbol)); });
    s.act({ kind: 'add', symbols: ['NTDOY'], said: { NTDOY: 'nintendo' } }, 'spoken');
    await settle();
    // The recorded bug: "NTDOY" in the error when the user had said "Nintendo".
    expect(speaker.said[0]).toContain('the user asked for "nintendo"; the desk looked for NTDOY');
  });

  test('a refresh the user asked for is read when it lands, and a failed one is owned up to', async () => {
    let n = 0;
    const clock = new Clock();
    const { s, speaker } = session(async (symbol) => {
      n += 1;
      if (n === 3) throw new board.FeedUnavailable(board.FEED_DOWN_MESSAGE);
      return quote({ symbol, asOf: n === 1 ? 100 : 200, pct: 0.2 });
    }, clock);
    s.act({ kind: 'add', symbols: ['AAPL'] }, 'button');
    await settle();
    clock.now += 30;
    s.act({ kind: 'refresh', symbols: [] }, 'spoken');
    await settle();
    expect(speaker.said.at(-1)).toContain('Fresh quote on AAPL');
    clock.now += 30;
    s.act({ kind: 'refresh', symbols: ['AAPL'] }, 'typed');
    await settle();
    expect(speaker.said.at(-1)).toContain('failed');
  });

  test('typed commands are told back; spoken ones were already answered', () => {
    const { s } = session();
    fill(s.desk, ['AAPL', 'MSFT']);
    expect(s.act({ kind: 'remove', symbols: ['MSFT'] }, 'spoken').event).toBeUndefined();
    expect(s.act({ kind: 'remove', symbols: ['AAPL'] }, 'typed').event).toContain('AAPL is off the board');
  });

  test('"drop it" drops the focused one', () => {
    const { s } = session();
    fill(s.desk, ['AAPL', 'MSFT']);
    s.act({ kind: 'remove', symbols: [] }, 'spoken');
    expect(s.board().watchlist.map((q: Quote) => q.symbol)).toEqual(['MSFT']);
  });

  test('a judgement is routed: nothing, advice, a name nobody could map, an action', () => {
    const { s } = session();
    expect(s.handle({ kind: 'none' }, 'hello', 'typed').handled).toBe(false);
    expect(s.handle({ kind: 'advice' }, 'buy?', 'typed').kind).toBe('advice');
    expect(s.handle({ kind: 'add', symbols: [], said: {}, unresolved: ['the other one'] }, 'add the other one', 'spoken').event).toContain('could not tell which listing');
    s.handle({ kind: 'add', symbols: ['AAPL'], said: {}, unresolved: [] }, 'add apple', 'spoken');
    expect(s.board().fetching).toEqual(['AAPL']);
  });
});
