// The judge with real phrasings: advice is caught first (by rules, and by the
// model where rules cannot), commands by rules, names by the board, the table,
// the model and the symbol search, in that order.
import { describe, expect, test, vi } from 'vitest';
import { judge, pickListing, rules, type ModelCall } from './judge.ts';
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

describe('the model and the search, for what rules cannot read', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const model = (reading: Awaited<ReturnType<ModelCall>>): ModelCall => vi.fn(async () => reading);

  test('a description becomes a ticker through the model', async () => {
    const j = await judge('put the search-engine one up', empty, { model: model({ action: 'add', companies: [{ said: 'the search-engine one', ticker: 'GOOGL' }] }) });
    expect(j).toMatchObject({ kind: 'add', symbols: ['GOOGL'], said: { GOOGL: 'the search-engine one' } });
  });

  test('a new phrasing of an advice question is caught by the model', async () => {
    expect(await judge('would it be smart to pile into Nvidia', desk, { model: model({ action: 'advice', companies: [] }) })).toEqual({ kind: 'advice' });
  });

  test('rules that matched a verb but named nothing defer to a model that says it is not a request', async () => {
    expect(await judge("what's the board look like at the moment", desk, { model: model({ action: 'none', companies: [] }) })).toEqual({ kind: 'none' });
  });

  test('a name the rules know beats the model\'s ticker for it', async () => {
    const j = await judge('throw up the fruit company, Apple', empty, { model: model({ action: 'add', companies: [{ said: 'Apple', ticker: 'APPL' }] }) });
    expect(j).toMatchObject({ symbols: ['AAPL'] });
  });

  test('rules that are sure never wait for the model', async () => {
    const m = model({ action: 'none', companies: [] });
    expect(await judge('add nvidia', empty, { model: m })).toMatchObject({ kind: 'add', symbols: ['NVDA'] });
    expect(await judge('should I buy it', desk, { model: m })).toEqual({ kind: 'advice' });
    expect(m).not.toHaveBeenCalled();
  });

  test('a failing model leaves the rules\' reading, and the search maps the name', async () => {
    const search = vi.fn(async () => [{ symbol: 'ACHR', name: 'Archer Aviation Inc. Class A Common Stock', asset: 'STOCKS', exchange: 'NYSE' }]);
    const j = await judge('add archer aviation', empty, { model: async () => { throw new Error('quota'); }, search });
    expect(j).toMatchObject({ kind: 'add', symbols: ['ACHR'], said: { ACHR: 'archer aviation' } });
  });

  test('a name nobody can map stays unresolved for an add, and goes to the avatar otherwise', async () => {
    const search = async () => [];
    expect(await judge('add the other one', empty, { search })).toMatchObject({ kind: 'add', symbols: [], unresolved: ['other one'] });
    expect(await judge("what's the board look like at the moment", desk, { search })).toEqual({ kind: 'none' });
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
