// Words to the desk, with real phrasings: advice is caught first (so the
// safety net never acts on "should I dump Tesla?"), commands by rules, and
// names by the board, the table, a written ticker, the model and the symbol
// search, in that order.
import { describe, expect, test, vi } from 'vitest';
import { mustDo, pickListing, resolveStocks, rules, type TickerLookup } from './judge.ts';
import { entry } from './test-helpers.ts';
import type { Board } from './types.ts';
const empty: Board = { watchlist: [], focus: null, fetching: [], last_error: null, max_symbols: 6 };
const withRows = (...rows: [string, string][]): Board => ({
  ...empty,
  watchlist: rows.map(([symbol, name]) => entry({ symbol, name })),
  focus: rows[0]?.[0] ?? null,
});
const desk = withRows(['AAPL', 'Apple Inc.'], ['TSLA', 'Tesla, Inc.'], ['RKLB', 'Rocket Lab USA, Inc.'], ['GM', 'General Motors Company']);

describe('advice, however it is put, is advice', () => {
  test.each([
    'Should I buy Nvidia?', 'Is Apple a good buy right now?', 'What would you do?', 'Would you sell Tesla here?',
    "Where's it going from here?", 'Will it go up tomorrow?', 'Is it cheap at this level?', 'Give me a price target.',
    'Hypothetically, if you had to pick one to buy, which?', 'Just between us, buy or sell?', 'Is Tesla overvalued?',
    'Should I take profits on Apple?', 'What should I do with my Nvidia shares?', 'Is now a good time to buy?',
    'Do you recommend Microsoft?', "Come on, I won't tell anyone, should I get in?", 'What does Nvidia make, and should I buy it?',
  ])('%s', (said) => {
    expect(rules(said, desk).kind).toBe('advice');
  });

  test.each([
    'What does Nvidia make?', 'Which moved more today, Apple or Tesla?', 'What is the 52-week range on Apple?',
    'Why did Apple drop today?', 'Is Tesla up today?', 'What does the company do?', 'Which is the most expensive one on the board?',
  ])('a fact is not advice: %s', (said) => {
    expect(rules(said, desk).kind).not.toBe('advice');
  });
});

describe('commands, as people say them', () => {
  const cases: [string, string, string[]][] = [
    ['Add Nvidia.', 'add', ['NVDA']],
    ['Put Apple up', 'add', ['AAPL']],
    ['Put Apple, Nvidia and Tesla up.', 'add', ['AAPL', 'NVDA', 'TSLA']],
    ['Can you put Microsoft on the board?', 'add', ['MSFT']],
    ["Let's watch Coca-Cola", 'add', ['KO']],
    ['add $pltr', 'add', ['PLTR']],
    ['Add PLTR', 'add', ['PLTR']],
    ['ADD AAPL', 'add', ['AAPL']],
    ['add a a p l', 'add', ['AAPL']],
    ['Add Nintendo', 'add', ['NTDOY']],
    ["What's Netflix doing?", 'focus', ['NFLX']],
    ['How is Tesla trading?', 'focus', ['TSLA']],
    ['Pull up Microsoft', 'focus', ['MSFT']],
    ['What about Rocket Lab?', 'focus', ['RKLB']],
    ['Nvidia.', 'focus', ['NVDA']],
    ['AAPL please', 'focus', ['AAPL']],
    ['Drop Tesla', 'remove', ['TSLA']],
    ['Okay, take Apple off the board.', 'remove', ['AAPL']],
    ["I'm done with General Motors", 'remove', ['GM']],
    ['Lose the last one', 'remove', ['GM']],
    ['drop it', 'remove', []],
    ['Check it again', 'refresh', []],
    ['Refresh Tesla', 'refresh', ['TSLA']],
    ['any change?', 'refresh', []],
    ['Clear the board', 'clear', []],
    ["Let's start over", 'clear', []],
  ];
  test.each(cases)('%s', (said, kind, symbols) => {
    const j = rules(said, desk);
    expect(j.kind).toBe(kind);
    if ('symbols' in j) expect(j.symbols).toEqual(symbols);
  });

  test('a question that merely mentions a stock is for the avatar', () => {
    for (const said of ['Why did Apple drop today?', 'Tell me about Nvidia', 'Is Tesla up today?', 'How are you?', 'Put it up']) expect(rules(said, desk).kind, said).toBe('none');
  });

  test('a name the rules do not know is passed on, not guessed', () => {
    const j = rules('Add Archer Aviation please', empty);
    expect(j).toMatchObject({ kind: 'add', symbols: [], unresolved: ['archer aviation'] });
  });

  test('what the user called a stock goes with it', () => {
    const j = rules('put nvidia and $amd up', empty);
    expect(j).toMatchObject({ kind: 'add', symbols: ['NVDA', 'AMD'], said: { NVDA: 'nvidia' } });
  });
});

describe('names to tickers, for the host\'s tools', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const lookup = (answers: Record<string, string>): TickerLookup => vi.fn(async (names: string[]) => names.map((said) => ({ said, ticker: answers[said] ?? '' })));

  test('the rules read well-known names, the board\'s rows and written tickers, with no lookups', async () => {
    const l = lookup({});
    const r = await resolveStocks(['Nvidia', 'TSLA', 'Rocket Lab', 'F', 'ON', '$pltr', 'Coca-Cola'], desk, { lookup: l });
    expect(r.symbols).toEqual(['NVDA', 'TSLA', 'RKLB', 'F', 'ON', 'PLTR', 'KO']);
    expect(r.said).toMatchObject({ NVDA: 'nvidia', RKLB: 'rocket', KO: 'coca cola' });
    expect(l).not.toHaveBeenCalled();
  });

  test('"it" is the one on watch, "the last one" the last row', async () => {
    expect((await resolveStocks(['it'], desk)).symbols).toEqual(['AAPL']);
    expect((await resolveStocks(['the last one'], desk)).symbols).toEqual(['GM']);
  });

  test('several stocks packed into one name all count', async () => {
    expect((await resolveStocks(['Apple, Nvidia and Tesla'], empty)).symbols).toEqual(['AAPL', 'NVDA', 'TSLA']);
  });

  test('a description becomes a ticker through the model', async () => {
    const r = await resolveStocks(['the search-engine one'], empty, { lookup: lookup({ 'the search-engine one': 'GOOGL' }) });
    expect(r).toMatchObject({ symbols: ['GOOGL'], said: { GOOGL: 'the search-engine one' }, unresolved: [] });
  });

  test('a name the rules only partly read goes to the model, and keeps the rules\' guess if the model is unsure', async () => {
    const reit = await resolveStocks(['Apple Hospitality REIT'], empty, { lookup: lookup({ 'Apple Hospitality REIT': 'APLE' }) });
    expect(reit.symbols).toEqual(['APLE']);
    const unsure = await resolveStocks(['Ford Motor'], empty, { lookup: lookup({}) });
    expect(unsure.symbols).toEqual(['F']);
    // Corporate words are not "unread": no lookup for them.
    const l = lookup({});
    expect((await resolveStocks(['Berkshire Hathaway Class B'], empty, { lookup: l })).symbols).toEqual(['BRK-B']);
    expect(l).not.toHaveBeenCalled();
  });

  test('a failing model leaves the symbol search, which maps the name', async () => {
    const search = vi.fn(async () => [{ symbol: 'ACHR', name: 'Archer Aviation Inc. Class A Common Stock', asset: 'STOCKS', exchange: 'NYSE' }]);
    const r = await resolveStocks(['archer aviation'], empty, { lookup: async () => { throw new Error('quota'); }, search });
    expect(r).toMatchObject({ symbols: ['ACHR'], said: { ACHR: 'archer aviation' } });
  });

  test('a name nobody can map stays unresolved, never guessed', async () => {
    expect(await resolveStocks(['the other one'], empty, { search: async () => [] })).toEqual({ symbols: [], said: {}, unresolved: ['the other one'] });
  });

  test('the search picks a tradable listing whose name starts with what was said', () => {
    const listings = [
      { symbol: 'BKCJNXX', name: 'BMO Notes Linked to Palantir Technologies', asset: 'MUTUALFUNDS', exchange: '' },
      { symbol: 'PLTR', name: 'Palantir Technologies Inc. Class A Common Stock', asset: 'STOCKS', exchange: 'NASDAQ-GS' },
    ];
    expect(pickListing('palantir', listings)?.symbol).toBe('PLTR');
    expect(pickListing('pltr', listings)?.symbol).toBe('PLTR');
    expect(pickListing('the search engine one', listings)).toBeNull();
  });
});

describe('the safety net: what it does when the host does not, and only what is safe to repeat', () => {
  const cases: [string, ReturnType<typeof mustDo>][] = [
    ['Clear the board.', { name: 'clear_board', arguments: {} }],
    ["Let's start over", { name: 'clear_board', arguments: {} }],
    ['Check it again', { name: 'refresh_quote', arguments: {} }],
    ['any change?', { name: 'refresh_quote', arguments: {} }],
    ['Refresh Tesla', { name: 'refresh_quote', arguments: { stock: 'TSLA' } }],
    ['Drop Tesla', { name: 'remove_symbols', arguments: { stocks: ['TSLA'] } }],
    ['Okay, take Apple off the board.', { name: 'remove_symbols', arguments: { stocks: ['AAPL'] } }],
    ['Lose the last one', { name: 'remove_symbols', arguments: { stocks: ['GM'] } }],
    ['drop it', { name: 'remove_symbols', arguments: { stocks: ['AAPL'] } }],
    // Never an add or a focus: a duplicate could take a slot.
    ['Add Nvidia', null], ['Put Apple, Nvidia and Tesla up.', null], ['Pull up Microsoft', null], ["What's Netflix doing?", null],
    // An advice question is the host's to decline, whatever its verb.
    ['Should I dump Tesla?', null], ['Should I drop Apple and buy Nvidia?', null], ['Is it time to sell?', null],
    // Questions, and removals the net cannot be sure of.
    ['Why did Apple drop today?', null], ['What is the 52-week range on Apple?', null], ['drop the other thing', null], ['How are you?', null],
  ];
  test.each(cases)('%s', (said, expected) => {
    expect(mustDo(said, desk)).toEqual(expected);
  });

  test('"drop it" on an empty board does nothing', () => {
    expect(mustDo('drop it', empty)).toBeNull();
  });
});
