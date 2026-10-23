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

// ─── the session: what the tools and buttons do, and who tells the host ──

function session(fetch: FetchQuote = async (symbol) => quote({ symbol }), clock = new Clock()) {
  const speaker = new FakeSpeaker();
  return { s: new DeskSession({ fetch, clock: clock.fn, speaker }), speaker, clock };
}

/** A feed whose answers wait until released. */
function gated(answer: (symbol: string) => Quote | Error = (symbol) => quote({ symbol })) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fetch: FetchQuote = async (symbol) => {
    await gate;
    const a = answer(symbol);
    if (a instanceof Error) throw a;
    return a;
  };
  return { fetch, release: () => release() };
}

describe('adding: the reply carries the real quote', () => {
  test('an add waits for the quote and reports it; the caller tells the host, not the pump', async () => {
    const { s, speaker } = session(async (symbol) => quote({ symbol, pct: 2.5, asOf: 500 }));
    const report = await s.add(['NVDA'], { by: 'tool', said: { NVDA: 'nvidia' } });
    expect(report.landed.map((l) => [l.quote.symbol, l.quote.change_pct, l.said])).toEqual([['NVDA', 2.5, 'nvidia']]);
    expect(s.board().watchlist.map((q) => q.symbol)).toEqual(['NVDA']);
    // Moved 2.5%, but the reply reads it: the announcer stays quiet.
    expect(speaker.said).toEqual([]);
  });

  test('a phrase that is not a ticker is refused before the round trip', async () => {
    const pulled: string[] = [];
    const { s } = session(async (symbol) => { pulled.push(symbol); return quote({ symbol }); });
    const report = await s.add(["nvidia's ticker is nvda!"], { by: 'tool' });
    expect(report.failed[0].reason).toContain("couldn't find a listing");
    expect(pulled).toEqual([]);
  });

  test('the board says what it refuses: full, and already there', async () => {
    const { s } = session();
    fill(s.desk);
    const full = await s.add(['META'], { by: 'tool' });
    expect(full.failed).toEqual([{ symbol: 'META', reason: 'The board only holds six — drop one first.', said: undefined }]);
    const again = await s.add(['AAPL'], { by: 'tool' });
    expect(again.already.map((q) => q.symbol)).toEqual(['AAPL']);
  });

  test('a listing the feed does not know comes back as the reason, said once (by the caller)', async () => {
    const { s, speaker } = session(async (symbol) => { throw new board.UnknownSymbol(board.unknownMessage(symbol)); });
    const report = await s.add(['ZQXWQ'], { by: 'tool' });
    expect(report.failed).toEqual([{ symbol: 'ZQXWQ', reason: "I couldn't find a listing for ZQXWQ — check the ticker.", said: undefined }]);
    expect(speaker.said).toEqual([]);
    expect(s.board().fetching).toEqual([]);
  });

  test('several stocks in one call: what landed and what did not, together', async () => {
    const { s } = session(async (symbol) => {
      if (symbol === 'ZZZZ') throw new board.UnknownSymbol(board.unknownMessage(symbol));
      return quote({ symbol });
    });
    const report = await s.add(['AAPL', 'ZZZZ', 'TSLA'], { by: 'tool' });
    expect(report.landed.map((l) => l.quote.symbol)).toEqual(['AAPL', 'TSLA']);
    expect(report.failed.map((f) => f.symbol)).toEqual(['ZZZZ']);
  });

  test('a quote slower than the wait is reported on its way, then told when it lands, in one line', async () => {
    const feed = gated();
    const { s, speaker } = session(feed.fetch);
    const report = await s.add(['AAPL', 'NVDA'], { by: 'tool', said: { NVDA: 'nvidia' }, waitMs: 5 });
    expect(report.pending).toEqual(['AAPL', 'NVDA']);
    expect(speaker.said).toEqual([]);
    feed.release();
    await settle();
    await settle();
    expect(speaker.said).toHaveLength(1);
    expect(speaker.said[0]).toMatch(/AAPL .*NVDA /);
    expect(speaker.said[0]).toContain('you said were coming');
  });

  test('a late add that fails takes the promise back, with what the user called it', async () => {
    const feed = gated((symbol) => new board.UnknownSymbol(board.unknownMessage(symbol)));
    const { s, speaker } = session(feed.fetch);
    await s.add(['NTDOY'], { by: 'tool', said: { NTDOY: 'Nintendo' }, waitMs: 5 });
    feed.release();
    await settle();
    // The recorded bug: "NTDOY" in the error when the user had said "Nintendo".
    expect(speaker.said[0]).toContain('the user asked for "Nintendo"; the desk looked for NTDOY');
  });

  test('a button add of a stock the host then asks for waits on the same pull', async () => {
    const feed = gated();
    const pulls: string[] = [];
    const { s } = session(async (symbol) => { pulls.push(symbol); return feed.fetch(symbol, { now: 0 }); });
    const button = s.add(['AAPL'], { by: 'button' });
    const tool = s.add(['AAPL'], { by: 'tool' });
    feed.release();
    const [a, b] = await Promise.all([button, tool]);
    expect(pulls).toEqual(['AAPL']);
    expect(a.landed[0].quote.symbol).toBe('AAPL');
    expect(b.landed[0].quote.symbol).toBe('AAPL');
  });

  test('a board cleared while a quote was in flight does not get the row back', async () => {
    const feed = gated();
    const { s } = session(feed.fetch);
    const add = s.add(['AAPL'], { by: 'tool' });
    s.clear();
    feed.release();
    const report = await add;
    expect(s.board().watchlist).toEqual([]);
    expect(report.landed).toEqual([]);
  });
});

describe('focus, refresh, remove, clear', () => {
  test('pulling up something not on the board puts it there and looks at it', async () => {
    // Found by playing it. "Pull up Apple" when Apple is not up means PUT it up;
    // refusing it was a dead end, and it sits one letter from "put up".
    const { s } = session();
    fill(s.desk, ['AAPL']);
    const report = await s.focus('MSFT', { by: 'tool' });
    expect(report.kind).toBe('added');
    expect(s.board().focus).toBe('MSFT');
  });

  test('pulling up something already there focuses it, and the reply (not the announcer) reads it', async () => {
    const { s, speaker } = session();
    s.desk.apply({ kind: 'add', symbol: 'AAPL' });
    s.desk.apply({ kind: 'add', symbol: 'AAPL', entry: quote({ pct: 0.2 }) }, 'agent');
    s.desk.apply({ kind: 'add', symbol: 'NVDA' });
    s.desk.apply({ kind: 'add', symbol: 'NVDA', entry: quote({ symbol: 'NVDA', pct: -3.1 }) }, 'agent');
    const report = await s.focus('NVDA', { by: 'button' });
    expect(report).toMatchObject({ kind: 'focused', quote: { symbol: 'NVDA' } });
    expect(s.board().focus).toBe('NVDA');
    expect(speaker.said).toEqual([]);
  });

  test('a refresh waits for the fresh print, and says when nothing has traded since', async () => {
    let n = 0;
    const clock = new Clock();
    const { s } = session(async (symbol) => { n += 1; return quote({ symbol, asOf: n < 3 ? 100 : 200 }); }, clock);
    await s.add(['AAPL'], { by: 'tool' });
    clock.now += 30;
    expect(await s.refresh(null, { by: 'tool' })).toMatchObject({ kind: 'fresh', samePrint: true });
    clock.now += 30;
    expect(await s.refresh('AAPL', { by: 'tool' })).toMatchObject({ kind: 'fresh', samePrint: false });
  });

  test('a refresh inside the 15 s floor reads the number the board has', async () => {
    const { s } = session();
    await s.add(['AAPL'], { by: 'tool' });
    expect(await s.refresh(null, { by: 'tool' })).toMatchObject({ kind: 'tooSoon', quote: { symbol: 'AAPL' } });
  });

  test('a failed refresh keeps the last number, greyed, and says why', async () => {
    let n = 0;
    const clock = new Clock();
    const { s, speaker } = session(async (symbol) => {
      n += 1;
      if (n > 1) throw new board.RateLimited(board.RATE_LIMITED_MESSAGE);
      return quote({ symbol });
    }, clock);
    await s.add(['AAPL'], { by: 'tool' });
    clock.now += 30;
    const report = await s.refresh(null, { by: 'tool' });
    expect(report).toMatchObject({ kind: 'failed', reason: board.RATE_LIMITED_MESSAGE, quote: { price: 306.83, stale: true } });
    expect(speaker.said).toEqual([]);
  });

  test('a refresh of nothing, or of a stock not on the board, says so', async () => {
    const { s } = session();
    expect(await s.refresh(null, { by: 'tool' })).toEqual({ kind: 'empty' });
    fill(s.desk, ['AAPL']);
    expect(await s.refresh('TSLA', { by: 'tool' })).toEqual({ kind: 'missing', symbol: 'TSLA' });
  });

  test('a refresh slower than the wait is told when it lands', async () => {
    let n = 0;
    const clock = new Clock();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { s, speaker } = session(async (symbol) => {
      n += 1;
      if (n > 1) await gate;
      return quote({ symbol, asOf: 100 + n });
    }, clock);
    await s.add(['AAPL'], { by: 'tool' });
    clock.now += 30;
    expect(await s.refresh(null, { by: 'tool', waitMs: 5 })).toEqual({ kind: 'pending', symbol: 'AAPL' });
    release();
    await settle();
    expect(speaker.said.at(-1)).toContain('Fresh quote on AAPL');
  });

  test('a refresh that joins the timer\'s pull is read once, by the reply', async () => {
    const feed = gated((symbol) => quote({ symbol, pct: -2.2, asOf: 900 }));
    const clock = new Clock();
    const { s, speaker } = session(async (symbol) => (s.board().watchlist.length ? feed.fetch(symbol, { now: 0 }) : quote({ symbol, pct: 0.1, asOf: 100 })), clock);
    await s.add(['AAPL'], { by: 'tool' });
    clock.now += 60;
    s.timer.tick();
    const refresh = s.refresh(null, { by: 'tool' });
    feed.release();
    expect(await refresh).toMatchObject({ kind: 'fresh', quote: { change_pct: -2.2 } });
    expect(speaker.said).toEqual([]);
  });

  test('"drop it" drops the one on watch; a stock not on the board is refused in the board\'s words', () => {
    const { s } = session();
    fill(s.desk, ['AAPL', 'MSFT']);
    expect(s.remove([])).toMatchObject({ removed: ['AAPL'], refused: [] });
    expect(s.board().watchlist.map((q: Quote) => q.symbol)).toEqual(['MSFT']);
    expect(s.remove(['TSLA'])).toMatchObject({ removed: [], refused: ["That isn't on the board."] });
  });

  test('clearing, and clearing again', () => {
    const { s } = session();
    fill(s.desk, ['AAPL']);
    expect(s.clear()).toEqual({ cleared: true });
    expect(s.clear()).toEqual({ cleared: false, reason: "The board's already clear." });
  });
});
