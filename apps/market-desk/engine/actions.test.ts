// The desk's actions as the host's tools and the user's buttons reach them:
// names resolved, the board acted on, the feed waited for, and the outcome
// worded so the host's first reply carries it.
import { describe, expect, test, vi } from 'vitest';
import * as board from './board.ts';
import { press, run, TOOL_NAMES } from './actions.ts';
import { DeskSession, type FetchQuote, type Speaker } from './desk.ts';
import { TOOLS } from './director.ts';
import { quote } from './test-helpers.ts';

vi.spyOn(console, 'info').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

class FakeSpeaker implements Speaker {
  said: string[] = [];
  say(text: string) { this.said.push(text); }
}

function desk(fetch: FetchQuote = async (symbol) => fresh(symbol, { price: 212.55, pct: 0.16 })) {
  let now = 1000;
  const speaker = new FakeSpeaker();
  const s = new DeskSession({ fetch, clock: () => now, speaker });
  return { s, speaker, later: (seconds: number) => { now += seconds; } };
}

/** A print from just now: the replies age anything older. */
const fresh = (symbol: string, over: Parameters<typeof quote>[0] = {}) => quote({ symbol, asOf: Math.floor(Date.now() / 1000), ...over });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('every tool the host is given has an action behind it', async () => {
  const { s } = desk();
  for (const name of TOOL_NAMES) await expect(run(s, name, { stocks: ['AAPL'], stock: 'AAPL' }, 'tool')).resolves.toHaveProperty('text');
  expect(TOOL_NAMES.size).toBe(TOOLS.length);
});

describe('the host\'s tools', () => {
  test('add_symbols: the first reply carries the real quotes, named the way the user said them', async () => {
    const { s } = desk();
    const done = await run(s, 'add_symbols', { stocks: ['Nvidia', 'TSLA'] }, 'tool');
    expect(done.text).toMatch(/^Done: on the board now: NVDA \(NVDA Inc\.\) at 212\.55, up 0\.16% today, for "nvidia"; TSLA \(TSLA Inc\.\) at 212\.55/);
    expect(done.refused).toBeUndefined();
    expect(s.board().watchlist.map((q) => q.symbol)).toEqual(['NVDA', 'TSLA']);
  });

  test('add_symbols: a name no step could read is asked about, and printed for the user', async () => {
    const { s } = desk();
    const done = await run(s, 'add_symbols', { stocks: ['the other one'] }, 'tool', { search: async () => [] });
    expect(done.text).toContain('No listing matched "the other one"');
    expect(done.refused).toBe('No listing matched “the other one”. Try the ticker.');
    expect(s.board().watchlist).toEqual([]);
  });

  test('add_symbols: the model reads a description; the feed has the last word', async () => {
    const { s } = desk(async (symbol) => { if (symbol === 'GOOGL') return fresh(symbol); throw new board.UnknownSymbol(board.unknownMessage(symbol)); });
    const lookup = vi.fn(async (names: string[]) => names.map((said) => ({ said, ticker: said.includes('search') ? 'GOOGL' : 'ZQXWQ' })));
    const done = await run(s, 'add_symbols', { stocks: ['the search-engine one', 'the made-up one'] }, 'tool', { lookup });
    expect(done.text).toContain('GOOGL (GOOGL Inc.) at 306.83, down 0.58% today, for "the search-engine one"');
    expect(done.text).toContain('Did NOT go up: ZQXWQ (the user said "the made-up one"): I couldn\'t find a listing for ZQXWQ — check the ticker.');
    expect(done.refused).toBe("I couldn't find a listing for ZQXWQ — check the ticker.");
  });

  test('add_symbols: a quote slower than the budget is "on its way", and the desk tells the host when it lands', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { s, speaker } = desk(async (symbol) => { await gate; return fresh(symbol); });
    const done = await run(s, 'add_symbols', { stocks: ['Apple'] }, 'tool', { budgetMs: 1 });
    expect(done.text).toContain('Still on the way: AAPL');
    release();
    await settle();
    await settle();
    expect(speaker.said[0]).toContain('AAPL (AAPL Inc.) at 306.83');
  });

  test('focus_symbol: looks at what is there, puts up what is not', async () => {
    const { s } = desk();
    await run(s, 'add_symbols', { stocks: ['AAPL', 'NVDA'] }, 'tool');
    expect((await run(s, 'focus_symbol', { stock: 'Nvidia' }, 'tool')).text).toContain('NVDA (NVDA Inc.) at 212.55, up 0.16% today is front and centre now');
    expect(s.board().focus).toBe('NVDA');
    const added = await run(s, 'focus_symbol', { stock: 'Microsoft' }, 'tool');
    expect(added.text).toContain('Done: on the board now: MSFT');
    expect(added.text).toContain('MSFT is front and centre now');
    expect(s.board().focus).toBe('MSFT');
  });

  test('refresh_quote: the one on watch by default; a stock not on the board is offered, never added', async () => {
    const { s, later } = desk();
    await run(s, 'add_symbols', { stocks: ['AAPL'] }, 'tool');
    later(30);
    expect((await run(s, 'refresh_quote', {}, 'tool')).text).toContain('came back with the same print');
    const missing = await run(s, 'refresh_quote', { stock: 'Tesla' }, 'tool');
    expect(missing.text).toContain('TSLA is not on the board');
    expect(missing.text).toContain('add it only if they say so');
    expect(s.board().watchlist.map((q) => q.symbol)).toEqual(['AAPL']);
  });

  test('remove_symbols: "it" is the one on watch; what is not there is refused in the board\'s words', async () => {
    const { s } = desk();
    await run(s, 'add_symbols', { stocks: ['AAPL', 'TSLA'] }, 'tool');
    expect((await run(s, 'remove_symbols', { stocks: ['it'] }, 'tool')).text).toContain('AAPL is off the board (1 of 6 slots used; on watch now: TSLA)');
    const refused = await run(s, 'remove_symbols', { stocks: ['Netflix'] }, 'tool');
    expect(refused.refused).toBe("That isn't on the board.");
    expect(refused.text).toContain('do not claim anything was removed');
  });

  test('clear_board: once clears, twice says it already was', async () => {
    const { s } = desk();
    await run(s, 'add_symbols', { stocks: ['AAPL'] }, 'tool');
    expect((await run(s, 'clear_board', {}, 'tool')).text).toMatch(/^Done: the board is clear/);
    expect((await run(s, 'clear_board', {}, 'tool')).refused).toBe("The board's already clear.");
  });

  test('a call with nothing named asks, and changes nothing', async () => {
    const { s } = desk();
    expect((await run(s, 'add_symbols', { stocks: [] }, 'tool')).text).toMatch(/^Not done: no stock was named/);
    expect((await run(s, 'remove_symbols', {}, 'tool')).text).toMatch(/^Not done: no stock was named/);
    expect(s.board().watchlist).toEqual([]);
  });
});

describe('arguments as the host actually sends them', () => {
  test('capitals, a string for a list, another key, and extra fields all work', async () => {
    const { s } = desk();
    await run(s, 'add_symbols', { stocks: 'NVIDIA', reason: 'the user asked', confidence: 0.9 }, 'tool');
    await run(s, 'add_symbols', { symbols: ['tesla'] }, 'tool');
    await run(s, 'add_symbols', { stock: 'Apple Inc.' }, 'tool');
    expect(s.board().watchlist.map((q) => q.symbol)).toEqual(['NVDA', 'TSLA', 'AAPL']);
    expect((await run(s, 'focus_symbol', { symbol: 'TESLA', note: 'x' }, 'tool')).text).toMatch(/^Done: TSLA/);
    expect((await run(s, 'remove_symbols', { stocks: [{ symbol: 'AAPL' }] }, 'tool')).text).toMatch(/^Done: AAPL is off the board/);
  });

  test('a call with nothing usable asks a question back, never silence', async () => {
    const { s } = desk();
    for (const name of ['add_symbols', 'focus_symbol', 'remove_symbols']) expect((await run(s, name, { stocks: '', foo: 1 }, 'tool')).text).toMatch(/^Not done: no stock was named\. Ask/);
  });
});

describe('the user\'s buttons', () => {
  test('a button acts at once and the host is told what it did, with the real quote', async () => {
    const { s } = desk();
    const done = await press(s, 'add', 'NVDA');
    expect(done.text).toMatch(/^The user pressed "Add NVDA" on screen\. Done: on the board now: NVDA \(NVDA Inc\.\) at 212\.55/);
    expect((await press(s, 'focus', 'NVDA')).text).toContain('pressed "the NVDA card"');
    expect((await press(s, 'remove', 'NVDA')).text).toContain('NVDA is off the board');
  });

  test('the add box takes a company name too', async () => {
    const { s } = desk();
    await press(s, 'add', 'APPLE');
    expect(s.board().watchlist.map((q) => q.symbol)).toEqual(['AAPL']);
  });

  test('a refused press comes back as the board\'s sentence for the panel', async () => {
    const { s } = desk();
    await press(s, 'add', 'AAPL');
    const again = await press(s, 'refresh', 'AAPL');
    expect(again.refused).toBe('I just pulled that — nothing new yet.');
  });
});
