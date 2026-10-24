// @vitest-environment jsdom
/**
 * The board as a projection: boards in, intents out, nothing decided here.
 * Ported from the original panel's MarketDesk.test.tsx. The fake on the other
 * side is not a market and not a board: it is a scripted desk answering each
 * intent and pushing hand-authored boards. The rules are proven server-side;
 * what this pins is the screen's half: render the board it is given, send an
 * intent for every click, show a refusal as a message and not as a change, and
 * never draw a price for a quote that has not arrived. Then the other screens:
 * the front door, the tape and the closing sheet.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Board, Kind, Quote } from '../engine/types.ts';
import { DeskBoard, type IntentResult } from './Board.tsx';
import { Closing } from './Closing.tsx';
import { boardCsv, formatAsOf, formatSeriesSpan, rangePosition, sortQuotes } from './format.ts';
import { Lobby } from './Lobby.tsx';
import { Tape } from './Tape.tsx';

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
  const intents: { kind: Kind; symbol?: string }[] = [];
  let answer: (intent: { kind: Kind; symbol?: string }) => Answer = () => ({ applied: false, reason: 'unscripted' });
  let push: (board: Board) => void = () => {};
  function Harness() {
    const [board, setBoard] = useState(initial);
    push = setBoard;
    return (
      <DeskBoard
        board={board}
        onIntent={async (kind, symbol) => {
          const intent = symbol === undefined ? { kind } : { kind, symbol };
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
    script(fn: (intent: { kind: Kind; symbol?: string }) => Answer) { answer = fn; },
    broadcast(board: Board) { act(() => push(board)); },
  };
}

const slotOf = (symbol: string) => screen.getByLabelText(`Watch ${symbol}`).closest('li')!;
const watchPanel = () => screen.getByRole('article', { name: /^On watch:/ });

describe('the board', () => {
  it('renders the stock on watch big, and its slot: price, move, the 52-week range, the line', async () => {
    fakeDesk(snapshot()).render();
    expect(within(watchPanel()).getByText('AAPL')).toBeTruthy();
    expect(within(watchPanel()).getByText('306.83')).toBeTruthy();
    expect(within(watchPanel()).getByText('-1.80 (-0.58%)')).toBeTruthy();
    expect(screen.getByLabelText('AAPL in its 52-week range').getAttribute('aria-valuetext')).toBe('73% of the way from the low to the high');
    expect(within(slotOf('AAPL')).getByText('306.83')).toBeTruthy();
    // The sparkline is inline SVG: no chart library.
    expect(screen.getByLabelText(/^AAPL price history/)).toBeTruthy();
    expect(screen.getByText('Your board').textContent).toContain('1 of 6');
  });

  it('shows the board opening before the first board arrives', () => {
    fakeDesk(null).render();
    expect(screen.getByText('Opening your board…')).toBeTruthy();
  });

  it('draws six slots: the stocks, then the open ones, numbered', () => {
    fakeDesk(snapshot()).render();
    const slots = screen.getAllByRole('listitem');
    expect(slots).toHaveLength(6);
    expect(slots[1].textContent).toContain('02');
    expect(slots[1].textContent).toContain('Open: name a stock to Reese');
  });

  it('a click is an intent, and the answered board is what re-renders', async () => {
    const two = [quote(), quote({ symbol: 'MSFT', name: 'Microsoft' })];
    const desk = fakeDesk(snapshot({ watchlist: two }));
    desk.script(() => ({ applied: true, board: snapshot({ focus: 'MSFT', watchlist: two }) }));
    desk.render();
    fireEvent.click(screen.getByLabelText('Watch MSFT'));
    expect(desk.intents).toEqual([{ kind: 'focus', symbol: 'MSFT' }]);
    await waitFor(() => expect(slotOf('MSFT').className).toContain('is-watched'));
    expect(within(watchPanel()).getByText('MSFT')).toBeTruthy();
    expect(screen.getByLabelText('Watch MSFT').getAttribute('aria-pressed')).toBe('true');
  });

  it('the slot\'s refresh and remove send that symbol; so do the panel\'s', async () => {
    const desk = fakeDesk(snapshot());
    desk.script(() => ({ applied: true, board: snapshot() }));
    desk.render();
    fireEvent.click(screen.getByLabelText('Refresh AAPL'));
    fireEvent.click(screen.getByLabelText('Remove AAPL'));
    fireEvent.click(within(watchPanel()).getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(desk.intents).toEqual([{ kind: 'refresh', symbol: 'AAPL' }, { kind: 'remove', symbol: 'AAPL' }, { kind: 'refresh', symbol: 'AAPL' }]));
  });

  it('a refusal becomes a message, not a crash and not a change', async () => {
    const desk = fakeDesk(snapshot());
    desk.script(() => ({ applied: false, reason: 'I just pulled that — nothing new yet.' }));
    desk.render();
    fireEvent.click(screen.getByLabelText('Refresh AAPL'));
    await screen.findByText('I just pulled that — nothing new yet.');
    // Same board: the screen applied nothing locally.
    expect(within(slotOf('AAPL')).getByText('306.83')).toBeTruthy();
  });

  it("the desk's own failure reaches the user through last_error", async () => {
    fakeDesk(snapshot({ last_error: 'The feed is rate-limiting me. Give it about a minute.' })).render();
    await screen.findByText('The feed is rate-limiting me. Give it about a minute.');
  });

  it('a refusal from elsewhere (a tool call) is printed the same way', () => {
    render(<DeskBoard board={snapshot()} onIntent={async () => ({ applied: true })} notice="The board only holds six — drop one first." />);
    expect(screen.getByRole('status').textContent).toBe('The board only holds six — drop one first.');
  });

  it("lays the page's drop for files under the add box, above the slots", () => {
    render(<DeskBoard board={snapshot()} onIntent={async () => ({ applied: true })} files={<div data-testid="drop" />} />);
    const drop = screen.getByTestId('drop');
    const after = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(screen.getByLabelText('Ticker or company to add'), drop)).toBe(true);
    expect(after(drop, document.querySelector('.oc-slots')!)).toBe(true);
  });

  it('a stock still being fetched shows no price — never a provisional one', async () => {
    fakeDesk(snapshot({ watchlist: [], focus: null, fetching: ['NVDA'] })).render();
    await screen.findByText('pulling a quote…');
    expect(screen.getAllByText('NVDA').length).toBeGreaterThan(0);
    expect(screen.getByText('Reese is pulling the quote…')).toBeTruthy();
    expect(screen.queryByText('306.83')).toBeNull();
  });

  it('a stale row greys and says how old the number it is showing is', async () => {
    fakeDesk(snapshot({ watchlist: [quote({ stale: true, as_of: Math.floor(Date.now() / 1000) - 600 })] })).render();
    expect(within(slotOf('AAPL')).getByText(/stale · 10m ago/)).toBeTruthy();
    expect(slotOf('AAPL').className).toContain('is-stale');
    expect(within(watchPanel()).getByText(/Stale · the last number the desk got, 10m ago/)).toBeTruthy();
  });

  it('a pushed board updates the screen without anyone clicking', async () => {
    const desk = fakeDesk(snapshot());
    desk.render();
    desk.broadcast(snapshot({ watchlist: [quote({ price: 311.4, change: 2.77, change_pct: 0.9 })] }));
    await waitFor(() => expect(within(watchPanel()).getByText('311.40')).toBeTruthy());
    expect(within(watchPanel()).getByText('+2.77 (+0.90%)')).toBeTruthy();
  });

  it('sorting is view state — it sends nothing', () => {
    const desk = fakeDesk(snapshot({ watchlist: [quote({ symbol: 'AAPL', change_pct: -0.58 }), quote({ symbol: 'NVDA', name: 'NVIDIA', change_pct: 3.2 })] }));
    desk.render();
    fireEvent.click(screen.getByText('Sort by move'));
    const symbols = screen.getAllByLabelText(/^Watch /).map((node) => node.getAttribute('aria-label'));
    expect(symbols).toEqual(['Watch NVDA', 'Watch AAPL']);
    expect(desk.intents).toEqual([]);
  });
});

describe('a grey row, and what it does not say', () => {
  // The symptom: a card goes grey and reads "stale · 12m ago" with no reason
  // on it; the only explanation was a banner that names no stock.
  it('prints the reason the quote is stale on the row itself', () => {
    fakeDesk(snapshot({
      watchlist: [quote({ stale: true, error: 'The feed is rate-limiting me. Give it about a minute.' })],
      last_error: 'The feed is rate-limiting me. Give it about a minute.',
    })).render();
    // On the banner, on the slot, and on the panel it is actually about.
    expect(screen.getAllByText(/rate-limiting me/)).toHaveLength(3);
    expect(within(slotOf('AAPL')).getByText(/rate-limiting me/)).toBeTruthy();
  });

  it('does not put an error on a row that is not stale', () => {
    fakeDesk(snapshot({ watchlist: [quote({ stale: false, error: null })] })).render();
    expect(screen.queryByText(/rate-limiting/)).toBeNull();
  });
});

describe('clearing the board by accident', () => {
  // The symptom: one click next to "Sort by move" takes all six rows, there is no undo.
  it('asks before it wipes the board, and sends one intent', async () => {
    const desk = fakeDesk(snapshot());
    desk.script(() => ({ applied: true, board: snapshot({ watchlist: [], focus: null }) }));
    desk.render();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(desk.intents).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Clear the board?' }));
    await waitFor(() => expect(desk.intents).toEqual([{ kind: 'clear' }]));
    await screen.findByText('Nothing on the board yet');
  });
});

describe('an empty board with something to press', () => {
  // The symptom: the desk opened empty and offered two controls, both acting on rows that did not exist.
  it('offers one-tap starters on an empty board, and each is an add intent', async () => {
    const desk = fakeDesk(snapshot({ watchlist: [], focus: null }));
    desk.script(() => ({ applied: true, board: snapshot({ watchlist: [], focus: null, fetching: ['NVDA'] }) }));
    desk.render();
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'NVDA' }));
    await waitFor(() => expect(desk.intents).toEqual([{ kind: 'add', symbol: 'NVDA' }]));
  });

  it('takes a typed ticker and sends it in capitals, without a second opinion on validity', async () => {
    const desk = fakeDesk(snapshot({ watchlist: [], focus: null }));
    desk.script(() => ({ applied: true, board: snapshot({ watchlist: [], focus: null, fetching: ['BRK-B'] }) }));
    desk.render();
    const box = screen.getByLabelText('Ticker or company to add');
    fireEvent.change(box, { target: { value: 'brk-b' } });
    fireEvent.submit(box.closest('form')!);
    await waitFor(() => expect(desk.intents).toEqual([{ kind: 'add', symbol: 'BRK-B' }]));
  });

  it('takes a company name as typed: the desk decides which listing it is', async () => {
    const desk = fakeDesk(snapshot({ watchlist: [], focus: null }));
    desk.script(() => ({ applied: true }));
    desk.render();
    const box = screen.getByLabelText('Ticker or company to add');
    fireEvent.change(box, { target: { value: 'Rocket Lab' } });
    fireEvent.submit(box.closest('form')!);
    await waitFor(() => expect(desk.intents).toEqual([{ kind: 'add', symbol: 'Rocket Lab' }]));
  });

  it('a refused add is shown as a sentence and nothing is claimed', async () => {
    const desk = fakeDesk(snapshot({ watchlist: [], focus: null }));
    desk.script(() => ({ applied: false, reason: "I couldn't find a listing for ZZZZ — check the ticker." }));
    desk.render();
    const box = screen.getByLabelText('Ticker or company to add');
    fireEvent.change(box, { target: { value: 'zzzz' } });
    fireEvent.submit(box.closest('form')!);
    await screen.findByText("I couldn't find a listing for ZZZZ — check the ticker.");
    expect(screen.getAllByRole('listitem').every((li) => li.className.includes('is-open'))).toBe(true);
  });

  it('stops inviting an add once the board is full', () => {
    const six = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL'].map((symbol) => quote({ symbol }));
    fakeDesk(snapshot({ watchlist: six })).render();
    const box = screen.getByLabelText('Ticker or company to add') as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.placeholder).toBe('Board full: drop one first');
    expect(screen.queryByText(/^Open/)).toBeNull();
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

  it('writes the board as a CSV with every number as the board has it', () => {
    const csv = boardCsv(snapshot({ watchlist: [quote({ name: 'Apple, "the" Inc.', as_of: 1785861561 }), quote({ symbol: 'NVDA', stale: true, price: null })] }));
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Ticker,Company,Exchange,Last,Currency,Change,Change %,52-week low,52-week high,Printed (UTC),Stale');
    expect(lines[1]).toBe('AAPL,"Apple, ""the"" Inc.",NasdaqGS,306.83,USD,-1.8,-0.58,202.16,344.57,2026-08-04T16:39:21.000Z,no');
    expect(lines[2]).toMatch(/^NVDA,Apple Inc\.,NasdaqGS,,USD,.*,yes$/);
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

describe('the other screens', () => {
  it('the front door says what it is, how it works, and has a way in by voice and by typing', () => {
    const onStart = vi.fn();
    render(<Lobby onStart={onStart} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Call out a ticker. Reese reads the tape.');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Call out a stock', 'Reese reads the tape', 'Facts, never tips']);
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Reese' }));
    fireEvent.click(screen.getByRole('button', { name: 'Type instead' }));
    expect(onStart.mock.calls).toEqual([[true], [false]]);
    // Reese's face, before the call: decorative, since the name sits beside it.
    const face = document.querySelector('.oc-host-badge img') as HTMLImageElement;
    expect(face.getAttribute('src')).toMatch(/portrait\.jpg/);
    expect(face.getAttribute('alt')).toBe('');
    expect(face.closest('p')!.textContent).toBe('Reese your analyst on the desk');
    // The words the product never puts on screen.
    expect(document.body.textContent).not.toMatch(/\b(session|avatar|API|Atmee|demo|sample|mini-app)\b/i);
  });

  it('the tape runs the board twice over for a seamless loop, and is quiet when the board is', () => {
    const { container, rerender } = render(<Tape board={snapshot({ watchlist: [quote(), quote({ symbol: 'NVDA', change_pct: 1.2 })] })} />);
    expect(container.querySelectorAll('.oc-tick')).toHaveLength(4);
    expect(container.querySelector('.oc-tape')!.getAttribute('aria-hidden')).toBe('true');
    rerender(<Tape board={snapshot({ watchlist: [], fetching: ['TSLA'] })} />);
    expect(container.textContent).toBe('TSLA coming up…');
  });

  it('the closing sheet lists the board as it was, with a download and a way back', () => {
    const onAgain = vi.fn();
    render(<Closing board={snapshot({ watchlist: [quote(), quote({ symbol: 'NVDA', name: 'NVIDIA Corporation', stale: true })] })} now={Date.now()} host="Reese" onAgain={onAgain} />);
    expect(screen.getByRole('heading').textContent).toBe('Your board when you hung up');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual(['AAPLApple Inc.', 'NVDANVIDIA Corporation']);
    expect(rows[0].textContent).toContain('73% up');
    expect(rows[1].textContent).toContain('stale · ');
    expect(screen.getByRole('button', { name: 'Download the board (CSV)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Call Reese again' }));
    expect(onAgain).toHaveBeenCalledOnce();
  });

  it('the closing sheet tells the time in English, whatever the browser\'s language', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleTimeString');
    render(<Closing board={snapshot()} now={Date.UTC(2026, 9, 23, 8, 43)} host="Reese" onAgain={() => {}} />);
    expect(spy.mock.calls.every(([locale]) => locale === 'en-US')).toBe(true);
    expect(screen.getByText(/^Closing sheet · \d{1,2}:43 (AM|PM)$/)).toBeTruthy();
    spy.mockRestore();
  });

  it('the closing sheet for an empty board offers only the way back', () => {
    render(<Closing board={snapshot({ watchlist: [] })} now={Date.now()} host="Reese" onAgain={() => {}} />);
    expect(screen.getByRole('heading').textContent).toBe('You hung up with an empty board');
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
  });
});
