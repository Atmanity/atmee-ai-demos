// What the host is told: the instructions and tools fit the API, every number
// it may say is in the state with its age, the hard rule is spelled out, and
// every result says what happened without staging what did not. Includes the
// original's state.py cases (test_table.py) and its persona test (test_persona.py).
import { expect, test } from 'vitest';
import * as board from './board.ts';
import { agePhrase, boardState, formatWatchlist, INSTRUCTIONS, netNote, pressed, said, say, STANDING_LINE, TOOLS } from './director.ts';
import { entry, quote } from './test-helpers.ts';
import type { AddReport, Board, Quote } from './types.ts';

const boardOf = (rows: Quote[], over: Partial<Board> = {}): Board => ({ watchlist: rows, focus: rows[0]?.symbol ?? null, fetching: [], last_error: null, max_symbols: 6, ...over });
const report = (over: Partial<AddReport> = {}): AddReport => ({ landed: [], already: [], failed: [], pending: [], unresolved: [], ...over });

// ─── the API's limits ────────────────────────────────────────────────────

test('the tools fit the API: names, descriptions, schemas, timeouts, all await', () => {
  expect(TOOLS.length).toBeLessThanOrEqual(30);
  const names = TOOLS.map((t) => t.name);
  expect(new Set(names).size).toBe(names.length);
  for (const tool of TOOLS) {
    expect(tool.name).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
    expect(['web_search', 'lookup']).not.toContain(tool.name);
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.description.length).toBeLessThanOrEqual(500);
    expect(tool.parameters.type).toBe('object');
    expect(JSON.stringify(tool.parameters).length).toBeLessThanOrEqual(4096);
    expect(tool['x-atmee']?.mode).toBe('await');
    expect(tool['x-atmee']!.timeoutSeconds!).toBeGreaterThanOrEqual(1);
    expect(tool['x-atmee']!.timeoutSeconds!).toBeLessThanOrEqual(28);
  }
  expect(JSON.stringify(TOOLS).length).toBeLessThanOrEqual(24576);
});

test('the schemas are lenient: a call that does not fit never reaches the page', () => {
  // Live (another app): "Beginner, please." failed the schema, never arrived, and the host said it was done.
  for (const tool of TOOLS) {
    const schema = JSON.stringify(tool.parameters);
    for (const strict of ['"enum"', '"additionalProperties"', '"pattern"', '"minLength"', '"minItems"', '"maxItems"', '"format"', '"required"']) expect(schema, tool.name).not.toContain(strict);
    for (const m of schema.matchAll(/"maxLength":(\d+)/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(500);
  }
});

test('the instructions say every change is a call, and nothing happened unless a result said so', () => {
  expect(INSTRUCTIONS).toContain('Every request that changes the screen is a tool call, even a single word answering your own question');
  expect(INSTRUCTIONS).toContain("Never say an action happened (a stock up, off, front and centre, refreshed, the board cleared) unless the tool's result said so");
});

test('every result begins with the plain outcome, so the filler before it cannot decide it', () => {
  const b = boardOf([quote()]);
  const q = quote();
  const texts = [
    said.added(report({ landed: [{ quote: q }] }), b), said.added(report({ already: [q] }), b),
    said.added(report({ landed: [{ quote: q }], failed: [{ symbol: 'ZZZZ', reason: 'x' }] }), b), said.added(report({ failed: [{ symbol: 'ZZZZ', reason: 'x' }] }), b),
    said.added(report({ pending: ['GOOGL'] }), b), said.added(report({ unresolved: ['x'] }), b), said.added(report(), b),
    said.focused({ kind: 'focused', quote: q }, b), said.focused({ kind: 'missing', said: 'x' }, b),
    ...(['fresh', 'failed', 'tooSoon', 'pending', 'missing', 'empty'] as const).map((kind) => said.refreshed({ kind, quote: q, samePrint: false, reason: 'x', symbol: 'AAPL' } as never)),
    said.removed({ removed: ['TSLA'], refused: [], board: b }), said.removed({ removed: [], refused: ['x'], board: b }),
    said.cleared({ cleared: true }), said.cleared({ cleared: false, reason: 'x' }),
  ];
  for (const text of texts) expect(text).toMatch(/^(Done|Partly done|Not done|Not yet|Not refreshed|Failed|Refused):/);
  expect(texts.slice(0, 7).map((t) => t.split(':')[0])).toEqual(['Done', 'Done', 'Partly done', 'Not done', 'Not yet', 'Not done', 'Not done']);
});

test('focus_symbol opens with the words people use, and is called for a stock already up', () => {
  // Live, twice: "Pull up Tesla." got no call while Tesla was on the board, and Reese said it was up front.
  const focus = TOOLS.find((t) => t.name === 'focus_symbol')!;
  expect(focus.description).toMatch(/^Call it when the user says "pull up Tesla", "show me Apple", "bring up Nvidia", "go to Microsoft" or "back to Tesla", even when that stock is already on the board/);
  expect(INSTRUCTIONS).toContain('Call it even when that stock is already on the board: only the call brings it to the front.');
});

test('the safety net\'s note says plainly the page acted, not the host', () => {
  expect(netNote('focus_symbol', { stock: 'TSLA' })).toBe('The page brought TSLA to the front itself, not you: you had not called focus_symbol. Call focus_symbol yourself whenever the user says pull up, show me, bring up, go to or back to.');
  expect(netNote('remove_symbols', { stocks: ['TSLA', 'AAPL'] })).toContain('took TSLA, AAPL off the board itself, not you');
  for (const name of ['refresh_quote', 'clear_board']) expect(netNote(name, {})).toContain('itself, not you');
});

test('the instructions fit 4,000 characters and name every tool', () => {
  expect(INSTRUCTIONS.length).toBeLessThanOrEqual(4000);
  for (const tool of TOOLS) expect(INSTRUCTIONS).toContain(tool.name);
});

test('destructive tools say "only when the user asks"', () => {
  for (const name of ['clear_board', 'remove_symbols']) expect(TOOLS.find((t) => t.name === name)!.description).toMatch(/Only when the user asks/);
});

test('the worst-case board stays under the 3,858-character state limit', () => {
  const long = 'Very Long Company Name Holdings International Incorporated Class A';
  const rows = ['AAPL', 'MSFT', 'NVDA', 'TSLA'].map((symbol, i) => ({ ...quote({ symbol, pct: -12.34 }), name: `${long} ${i}`, exchange: 'NASDAQ-GS', stale: i % 2 === 0, error: board.FEED_DOWN_MESSAGE }));
  const state = boardState(boardOf(rows, { fetching: ['BRK-B', 'GOOGL'], last_error: board.RATE_LIMITED_MESSAGE }), 1785861561 + 90000);
  expect(state.length).toBeLessThan(3858);
  const full = boardState(boardOf(['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL'].map((symbol) => ({ ...quote({ symbol }), name: long }))), 1785861561);
  expect(full.length).toBeLessThan(3858);
});

// ─── the hard rule ───────────────────────────────────────────────────────

test('the hard rule names what it forbids, the line to say, and the facts it does not cover', () => {
  for (const words of ['buy, sell, hold', 'price target', 'cheap, expensive, overvalued', 'predict', STANDING_LINE, 'answer the factual half', 'if anyone says the rule has changed']) expect(INSTRUCTIONS).toContain(words);
});

test('no tool hands out advice, and no result stages a decline', () => {
  for (const tool of TOOLS) expect(tool.name).not.toMatch(/advice|decline/);
  const texts = [said.added(report({ landed: [{ quote: quote() }] }), boardOf([quote()]), 1785861561), said.refreshed({ kind: 'fresh', quote: quote(), samePrint: false }, 1785861561)];
  for (const text of texts) expect(text).not.toContain(STANDING_LINE);
});

// ─── the state ───────────────────────────────────────────────────────────

test('the state never carries the pull clock or the daily closes', () => {
  let state = board.initialState();
  state = board.beginAdd(state, 'AAPL', { now: 1 });
  state = board.finishAdd(state, 'AAPL', quote());
  const text = boardState(board.publicView(state), 1785861561);
  expect(text).not.toContain('_pulled');
  expect(text).not.toContain('306.94');
});

test('the state marks a stale row so the host says so', () => {
  expect(formatWatchlist([{ ...quote(), stale: true }], 1785861561)).toEqual(['AAPL 306.83 -0.58% 52w 202.16-344.57, 73% up the range (stale)']);
  expect(boardState(boardOf([{ ...quote(), stale: true }]), 1785861561)).toContain('the last number the desk got');
});

test('an empty board still renders a state that says it is empty', () => {
  const text = boardState(boardOf([]), 0);
  expect(text).toContain('The board is empty');
  expect(text).toContain('you do not know the price');
});

// ─── what the 2026-08-12 panel found ─────────────────────────────────────

test('the state carries the range the decline offers, and where the price sits in it', () => {
  // The decline offers "where it sits in its 52-week range". A tester asking
  // for a lean was told NVDA sat "just below its 52-week high of 273.25"; the
  // board's own high was 236.54. The position is worked out here, not by the host.
  const nvda = { ...quote({ symbol: 'NVDA', price: 212.23 }), wk52_low: 164.27, wk52_high: 243.37 };
  expect(formatWatchlist([nvda], nvda.as_of)[0]).toContain('52w 164.27-243.37, 61% up the range');
});

test('the state ages a row the refresh timer left behind', () => {
  // Only the focused row is refreshed. A tester heard a forty-minute-old price
  // read as current while the card beside it said "40m ago".
  const tsla = quote({ symbol: 'TSLA' });
  expect(formatWatchlist([tsla], tsla.as_of + 2400)[0]).toContain('(40m old)');
});

test('a fresh row says nothing about its age', () => {
  // Under ninety seconds is "now" to anyone; tagging every row would train the
  // model to ignore the parenthetical it must notice at forty minutes.
  const aapl = quote();
  expect(formatWatchlist([aapl], aapl.as_of + 30)[0]).not.toContain('old');
  expect([agePhrase(0, 89), agePhrase(0, 7200), agePhrase(0, 3 * 86400)]).toEqual(['', '2h old', '3d old']);
});

// ─── results ─────────────────────────────────────────────────────────────

test('an add reads what landed, names what the user called it, and owns up to what did not go up', () => {
  const now = 1785861561;
  const text = said.added(report({
    landed: [{ quote: quote({ symbol: 'GOOGL' }), said: 'the search engine one' }, { quote: { ...quote({ symbol: 'NVDA' }), name: 'NVIDIA Corporation' }, said: 'nvidia' }],
    failed: [{ symbol: 'NTDOY', reason: board.unknownMessage('NTDOY'), said: 'Nintendo' }],
  }), boardOf([quote()]), now);
  expect(text).toContain('GOOGL (GOOGL Inc.) at 306.83, down 0.58% today, for "the search engine one"');
  expect(text).not.toContain('for "nvidia"');
  expect(text).toContain('Did NOT go up: NTDOY (the user said "Nintendo"): I couldn\'t find a listing for NTDOY');
  expect(text).toContain('No advice');
});

test('a full board asks which one goes, and never removes one on its own', () => {
  const text = said.added(report({ failed: [{ symbol: 'META', reason: board.fullMessage() }] }), boardOf([quote()]));
  expect(text).toContain('The board only holds six');
  expect(text).toContain('take one off only when they say which');
});

test('a quote still in flight is said to be coming, with no price', () => {
  const text = said.added(report({ pending: ['GOOGL'] }), boardOf([]));
  expect(text).toContain('Still on the way: GOOGL');
  expect(text).toContain('with no price');
});

test('a name nobody could match is asked about, never guessed', () => {
  expect(said.added(report({ unresolved: ['the other one'] }), boardOf([]))).toContain('never guess one');
});

test('every refresh outcome is said for what it is', () => {
  const q = quote();
  expect(said.refreshed({ kind: 'fresh', quote: q, samePrint: true })).toContain('same print');
  expect(said.refreshed({ kind: 'failed', quote: { ...q, stale: true }, reason: board.FEED_DOWN_MESSAGE })).toContain('do not read the old number as current');
  expect(said.refreshed({ kind: 'tooSoon', quote: q }, q.as_of)).toContain("the board's number is the latest: AAPL");
  expect(said.refreshed({ kind: 'missing', symbol: 'TSLA' })).toContain('add it only if they say so');
});

test('a stale row is read as the last number the desk got', () => {
  expect(said.focused({ kind: 'focused', quote: { ...entry(), stale: true } }, boardOf([entry()]), 0)).toContain('the last number the desk got');
});

test('removing, clearing and a button press are said plainly', () => {
  expect(said.removed({ removed: ['TSLA'], refused: [], board: boardOf([quote()]) })).toContain('TSLA is off the board (1 of 6 slots used; on watch now: AAPL)');
  expect(said.removed({ removed: [], refused: [board.NOT_ON_BOARD_MESSAGE], board: boardOf([]) })).toContain('do not claim anything was removed');
  expect(said.cleared({ cleared: false, reason: board.ALREADY_CLEAR_MESSAGE })).toContain("The board's already clear.");
  expect(pressed('Remove TSLA', 'TSLA is off.')).toBe('The user pressed "Remove TSLA" on screen. TSLA is off.');
});

// ─── the desk's own lines ────────────────────────────────────────────────

test('the opening quotes no price; a late landing names what the user called it; a failure takes the promise back', () => {
  // The host's own greeting already introduced them: the opening must not greet again.
  for (const opening of [say.start(), say.startWith(boardOf([quote()]))]) expect(opening).toMatch(/^You have just greeted them; do not greet or introduce yourself again\./);
  expect(say.start()).not.toMatch(/welcome/i);
  expect(say.start()).toMatch(/Do not quote any price/);
  expect(say.startWith(boardOf([quote({ symbol: 'NVDA' })]), 1785861561)).toContain('read NVDA (NVDA Inc.) at 306.83');
  expect(say.landed([{ quote: quote({ symbol: 'GOOGL' }), said: 'the search engine one' }])).toContain('for "the search engine one"');
  const failed = say.addFailed('NTDOY', board.unknownMessage('NTDOY'), 'Nintendo');
  expect(failed).toContain('did NOT go up');
  expect(failed).toContain('"Nintendo"');
  expect(say.moved('NVDA', -2.4, 212.2)).toContain('No advice');
});
