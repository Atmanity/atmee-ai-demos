// @vitest-environment jsdom
/**
 * The panel as a projection: boards in, intents out, nothing decided here.
 * Ported from the original panel's MarketDesk.test.tsx. The fake on the other
 * side is not a market and not a board: it is a scripted desk answering each
 * intent and pushing hand-authored boards. The rules are proven server-side;
 * what this pins is the panel's half: render the board it is given, send an
 * intent for every click, show a refusal as a message and not as a change, and
 * never draw a price for a quote that has not arrived.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Board, Quote } from '../engine/types.ts';
import { formatAsOf, formatSeriesSpan, rangePosition, sortQuotes } from './format.ts';
import { MarketDesk, type IntentResult } from './MarketDesk.tsx';

afterEach(cleanup);

function quote(over: Partial<Quote> = {}): Quote {
  return {
    symbol: 'AAPL', name: 'Apple Inc.', currency: 'USD', exchange: 'NasdaqGS', price: 306.83, prev_close: 308.63, change: -1.8, change_pct: -0.58,
    wk52_high: 344.57, wk52_low: 202.16, series: [303.1, 304.4, 305.9, 306.83], series_start_ts: 1783344600, series_step: '1d',
    as_of: Math.floor(Date.now() / 1000) - 30, stale: false, error: null, ...over,
  };
}

function snapshot(over: Partial<Board> = {}): Board {
  return { watchlist: [quote()], focus: 'AAPL', fetching: [], last_error: null, max_symbols: 6, ...over };
}

type Answer = IntentResult & { board?: Board };

/** A scripted desk: records intents, answers them, and can push a board unasked. */
function fakeDesk(initial: Board | null) {
  const intents: Record<string, unknown>[] = [];
  let answer: (intent: any) => Answer = () => ({ applied: false, reason: 'unscripted' });
  let push: (board: Board) => void = () => {};
  function Harness() {
    const [board, setBoard] = useState(initial);
    push = setBoard;
    return (
      <MarketDesk
        board={board}
        onIntent={async (intent) => {
          intents.push(intent);
          const result = answer(intent);
          if (result.board) setBoard(result.board);
          return { applied: result.applied, reason: result.reason };
        }}
      />
    );
  }
  return {
    intents,
    render: () => render(<Harness />),
    script(fn: (intent: any) => Answer) { answer = fn; },
    broadcast(board: Board) { act(() => push(board)); },
  };
}

describe('MarketDesk', () => {
  it('renders the board: price, move, and the 52-week range', async () => {
    fakeDesk(snapshot()).render();
    await waitFor(() => expect(screen.getByText('AAPL')).toBeTruthy());
    expect(screen.getByText('306.83')).toBeTruthy();
    expect(screen.getByText('-1.80 (-0.58%)')).toBeTruthy();
    expect(screen.getByLabelText('AAPL in its 52-week range')).toBeTruthy();
    // The sparkline is inline SVG: no chart library.
    expect(screen.getByLabelText(/AAPL price history/)).toBeTruthy();
  });

  it('shows nothing at all before the first board', () => {
    fakeDesk(null).render();
    expect(screen.getByText('Opening the board…')).toBeTruthy();
  });

  it('a click is an intent, and the answered board is what re-renders', async () => {
    const two = [quote(), quote({ symbol: 'MSFT', name: 'Microsoft' })];
    const desk = fakeDesk(snapshot({ watchlist: two }));
    desk.script(() => ({ applied: true, board: snapshot({ focus: 'MSFT', watchlist: two }) }));
    desk.render();
    fireEvent.click(await screen.findByLabelText('Focus MSFT'));
    expect(desk.intents).toEqual([{ kind: 'focus', symbol: 'MSFT' }]);
    await waitFor(() => expect(screen.getByLabelText('Focus MSFT').closest('article')?.className).toContain('card-focused'));
  });

  it('the ✕ and ⟳ buttons send remove and refresh for that symbol', async () => {
    const desk = fakeDesk(snapshot());
    desk.script(() => ({ applied: true, board: snapshot() }));
    desk.render();
    fireEvent.click(await screen.findByLabelText('Refresh AAPL'));
    await waitFor(() => expect((screen.getByLabelText('Remove AAPL') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByLabelText('Remove AAPL'));
    await waitFor(() => expect(desk.intents).toEqual([{ kind: 'refresh', symbol: 'AAPL' }, { kind: 'remove', symbol: 'AAPL' }]));
  });

  it('a refusal becomes a message, not a crash and not a change', async () => {
    const desk = fakeDesk(snapshot());
    desk.script(() => ({ applied: false, reason: 'I just pulled that — nothing new yet.' }));
    desk.render();
    fireEvent.click(await screen.findByLabelText('Refresh AAPL'));
    await screen.findByText('I just pulled that — nothing new yet.');
    // Same board: the panel applied nothing locally.
    expect(screen.getByText('306.83')).toBeTruthy();
  });

  it("the desk's own failure reaches the user through last_error", async () => {
    fakeDesk(snapshot({ last_error: 'The feed is rate-limiting me. Give it about a minute.' })).render();
    await screen.findByText('The feed is rate-limiting me. Give it about a minute.');
  });

  it('a symbol still being fetched shows no price — never a provisional one', async () => {
    fakeDesk(snapshot({ watchlist: [], focus: null, fetching: ['NVDA'] })).render();
    await screen.findByText('pulling a quote…');
    expect(screen.getByText('NVDA')).toBeTruthy();
    expect(screen.queryByText('306.83')).toBeNull();
  });

  it('a stale row greys and says how old the number it is showing is', async () => {
    fakeDesk(snapshot({ watchlist: [quote({ stale: true, as_of: Math.floor(Date.now() / 1000) - 600 })] })).render();
    await screen.findByText(/stale · 10m ago/);
    expect(screen.getByText('AAPL').closest('article')?.className).toContain('card-stale');
  });

  it('a pushed board updates the panel without anyone clicking', async () => {
    const desk = fakeDesk(snapshot());
    desk.render();
    await screen.findByText('306.83');
    desk.broadcast(snapshot({ watchlist: [quote({ price: 311.4, change: 2.77, change_pct: 0.9 })] }));
    await screen.findByText('311.40');
    expect(screen.getByText('+2.77 (+0.90%)')).toBeTruthy();
  });

  it('clear sends one intent and asks for nothing else', async () => {
    const desk = fakeDesk(snapshot());
    desk.script(() => ({ applied: true, board: snapshot({ watchlist: [], focus: null }) }));
    desk.render();
    // Two clicks, because Clear asks first (see "clearing the board by accident"). Still exactly ONE intent.
    fireEvent.click(await screen.findByText('Clear'));
    fireEvent.click(screen.getByText('Clear the board?'));
    expect(desk.intents).toEqual([{ kind: 'clear' }]);
    await screen.findByText(/Nothing on the board/);
  });

  it('sorting is view state — it sends nothing', async () => {
    const desk = fakeDesk(snapshot({ watchlist: [quote({ symbol: 'AAPL', change_pct: -0.58 }), quote({ symbol: 'NVDA', name: 'NVIDIA', change_pct: 3.2 })] }));
    desk.render();
    fireEvent.click(await screen.findByText('Sort by move'));
    const symbols = screen.getAllByLabelText(/^Focus /).map((node) => node.getAttribute('aria-label'));
    expect(symbols).toEqual(['Focus NVDA', 'Focus AAPL']);
    expect(desk.intents).toEqual([]);
  });

  it('NEW: the advice refusal is drawn, with the fact offered instead', () => {
    render(<MarketDesk board={snapshot()} onIntent={async () => ({ applied: true })} advice={{ asked: 'should I buy it?', fact: 'AAPL is at 306.83 USD, down 0.58% on the day' }} />);
    expect(screen.getByText('“should I buy it?”')).toBeTruthy();
    expect(screen.getByText("I read the tape, I don't give advice.")).toBeTruthy();
    expect(screen.getByText(/From the board: AAPL is at 306.83/)).toBeTruthy();
  });

  it('NEW: a refusal of something said is shown like one of the panel\'s own', () => {
    render(<MarketDesk board={snapshot()} onIntent={async () => ({ applied: true })} notice="The board only holds six — drop one first." />);
    expect(screen.getByText('The board only holds six — drop one first.')).toBeTruthy();
  });
});

describe('board helpers', () => {
  it('puts the price where it sits in its 52-week range', () => {
    expect(rangePosition(quote({ price: 202.16 }))).toBe(0);
    expect(rangePosition(quote({ price: 344.57 }))).toBe(1);
    expect(rangePosition(quote({ wk52_high: null }))).toBeNull();
  });

  it('does not fake an age it cannot know', () => {
    const now = 1_800_000_000_000;
    expect(formatAsOf(now / 1000 - 5, now)).toBe('just now');
    expect(formatAsOf(now / 1000 - 7200, now)).toBe('2h ago');
  });

  it('leaves the board order alone unless asked', () => {
    const list = [quote({ symbol: 'A', change_pct: 1 }), quote({ symbol: 'B', change_pct: 5 })];
    expect(sortQuotes(list, 'board')).toBe(list);
    expect(sortQuotes(list, 'move').map((q) => q.symbol)).toEqual(['B', 'A']);
  });
});

describe('a grey row, and what it does not say', () => {
  // The symptom: a card goes grey and reads "stale · 12m ago" with no reason
  // on it; the only explanation was a banner that names no symbol.
  it('prints the reason the quote is stale on the card itself', async () => {
    fakeDesk(snapshot({
      watchlist: [quote({ stale: true, error: 'The feed is rate-limiting me. Give it about a minute.' })],
      last_error: 'The feed is rate-limiting me. Give it about a minute.',
    })).render();
    // Once on the banner, once on the row it is actually about.
    await waitFor(() => expect(screen.getAllByText(/rate-limiting me/)).toHaveLength(2));
  });

  it('does not put an error on a row that is not stale', async () => {
    fakeDesk(snapshot({ watchlist: [quote({ stale: false, error: null })] })).render();
    await screen.findByText('AAPL');
    expect(screen.queryByText(/rate-limiting/)).toBeNull();
  });
});

describe('what period the sparkline covers', () => {
  // The symptom: an unlabelled squiggle that could be one session or one year.
  it('says how far back the line goes', () => {
    const now = Date.now();
    expect(formatSeriesSpan(quote({ series_start_ts: Math.floor(now / 1000) - 30 * 86400 }), now)).toBe('last 30 days');
  });

  it('says so when the line has been thinned rather than claiming daily bars', () => {
    const now = Date.now();
    expect(formatSeriesSpan(quote({ series_start_ts: Math.floor(now / 1000) - 365 * 86400, series_step: '4d' }), now)).toBe('last 12 months · every 4 days');
  });

  it('claims nothing for a row with no history to draw', () => {
    expect(formatSeriesSpan(quote({ series: [], series_start_ts: null }))).toBeNull();
    expect(formatSeriesSpan(quote({ series: [1] }))).toBeNull();
  });
});

describe('clearing the board by accident', () => {
  // The symptom: one click next to "Sort by move" takes all six rows, there is no undo.
  it('asks before it wipes the board', async () => {
    const desk = fakeDesk(snapshot());
    desk.script(() => ({ applied: true, board: snapshot() }));
    desk.render();
    await screen.findByText('AAPL');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(desk.intents).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Clear the board?' }));
    await waitFor(() => expect(desk.intents).toEqual([{ kind: 'clear' }]));
  });
});

describe('an empty board with nothing to press', () => {
  // The symptom: the desk opens empty and offers exactly two controls, "Sort by
  // move" and "Clear", both of which act on rows that do not exist.
  it('offers one-tap starters on an empty board, and each is an add intent', async () => {
    const desk = fakeDesk(snapshot({ watchlist: [], focus: null }));
    desk.script(() => ({ applied: true, board: snapshot({ watchlist: [], focus: null, fetching: ['NVDA'] }) }));
    desk.render();
    fireEvent.click(await screen.findByRole('button', { name: 'NVDA' }));
    await waitFor(() => expect(desk.intents).toEqual([{ kind: 'add', symbol: 'NVDA' }]));
  });

  it('takes a typed ticker and sends it uppercased, without a second opinion on validity', async () => {
    const desk = fakeDesk(snapshot({ watchlist: [], focus: null }));
    desk.script(() => ({ applied: true, board: snapshot({ watchlist: [], focus: null, fetching: ['BRK-B'] }) }));
    desk.render();
    const box = await screen.findByLabelText('Ticker to add');
    fireEvent.change(box, { target: { value: 'brk-b' } });
    fireEvent.submit(box.closest('form')!);
    await waitFor(() => expect(desk.intents).toEqual([{ kind: 'add', symbol: 'BRK-B' }]));
  });

  it('a refused add is shown as a sentence and nothing is claimed', async () => {
    const desk = fakeDesk(snapshot({ watchlist: [], focus: null }));
    desk.script(() => ({ applied: false, reason: "I couldn't find a listing for ZZZZ — check the ticker." }));
    desk.render();
    const box = await screen.findByLabelText('Ticker to add');
    fireEvent.change(box, { target: { value: 'zzzz' } });
    fireEvent.submit(box.closest('form')!);
    await screen.findByText("I couldn't find a listing for ZZZZ — check the ticker.");
  });

  it('stops inviting an add once the board is full', async () => {
    const six = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL'].map((symbol) => quote({ symbol }));
    fakeDesk(snapshot({ watchlist: six })).render();
    await screen.findByText('The board is full — drop one first.');
    expect((screen.getByLabelText('Ticker to add') as HTMLInputElement).disabled).toBe(true);
  });
});
