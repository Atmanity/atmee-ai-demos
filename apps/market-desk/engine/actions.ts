// The desk's actions, one set for the host's tool calls and the user's
// buttons: resolve what was named, act on the board, wait for the feed when
// a quote is involved, and word the outcome for the host. The server answers
// both routes with `run`; the tests drive it with a fake feed.
import * as board from './board.ts';
import { WAIT_MS, type DeskSession } from './desk.ts';
import { noRoom, pressed, said, TOOLS } from './director.ts';
import { resolveStocks, type SymbolSearch, type TickerLookup } from './judge.ts';
import type { AddReport, Kind, RefreshReport } from './types.ts';

export const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

/**
 * How long each action may take, end to end, in ms: under the tool's own
 * timeout (add and focus 20 s, refresh 16 s, the rest 8 s), leaving room for
 * the page's round trip. Whatever is still in flight then is handed to the
 * pump, which tells the host when it lands.
 */
export const BUDGET_MS: Record<string, number> = { add_symbols: 16_000, focus_symbol: 16_000, refresh_quote: 12_000, remove_symbols: 5_000, clear_board: 5_000 };
/** The name lookups must not eat the wait for the quote. */
export const LOOKUP_MS = 4_000;
export const SEARCH_MS = 5_000;

export interface Deps {
  /** The app's own model call, names to tickers (null without a key). */
  lookup?: TickerLookup | null;
  /** Nasdaq's symbol search. */
  search?: SymbolSearch | null;
  /** Overrides BUDGET_MS (tests). */
  budgetMs?: number;
  /** The page's call this request belongs to: a quote that lands after the wait is told only to that call. */
  call?: number;
}

export interface Done { text: string; refused?: string }

function within<A extends unknown[], R>(fn: ((...args: A) => Promise<R>) | null | undefined, ms: number, what: string) {
  if (!fn) return null;
  return (...args: A) => new Promise<R>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} took over ${ms / 1000}s`)), ms);
    fn(...args).then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * The most stocks one call acts on: each may cost a lookup, and the board
 * holds six anyway. A longer list (a whole positions file passed at once) is
 * still read to the end, so the result can say what was never tried.
 */
export const MAX_NAMES = 12;

/** The stocks a call names, however it names them: an array or one string, under "stocks", "stock", "symbols" or "tickers". Extra fields are ignored. */
function names(args: Record<string, unknown>, ...keys: string[]): string[] {
  const value = keys.map((k) => args[k]).find((v) => v !== undefined && v !== null && v !== '');
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return list.map((v) => String(typeof v === 'object' && v ? (v as Record<string, unknown>).symbol ?? (v as Record<string, unknown>).name ?? '' : v ?? '').trim().slice(0, 60)).filter(Boolean).slice(0, 100);
}
const ALL = ['stocks', 'stock', 'symbols', 'symbol', 'tickers', 'ticker', 'names', 'name'];
const ONE = ['stock', 'symbol', 'ticker', 'name', 'stocks', 'symbols', 'tickers'];

/** "AMD, INTC, QCOM, AVGO, TXN and 3 more". */
const few = (symbols: string[], most = 5) => (symbols.length <= most ? symbols.join(', ') : `${symbols.slice(0, most).join(', ')} and ${symbols.length - most} more`);

/** What the panel prints for an add that did not fully go up. */
function addRefusal(r: AddReport): string | undefined {
  const { full, other } = noRoom(r);
  const lines = other.map((f) => (r.failed.length > 1 ? `${f.symbol}: ${f.reason}` : f.reason));
  // The board's sentence once, however many a list brought that did not fit.
  if (full.length) lines.push(r.failed.length > 1 ? `${full[0].reason} No room for ${few(full.map((f) => f.symbol))}.` : full[0].reason);
  if (r.unresolved.length) lines.push(`No listing matched ${r.unresolved.map((n) => `“${n}”`).join(', ')}. Try the ticker.`);
  return lines.join(' ') || undefined;
}

function refreshRefusal(r: RefreshReport): string | undefined {
  if (r.kind === 'failed') return r.reason;
  if (r.kind === 'tooSoon') return board.TOO_SOON_MESSAGE;
  if (r.kind === 'missing' || r.kind === 'empty') return board.NOT_ON_BOARD_MESSAGE;
  return undefined;
}

/** One action: what it did, as the words the host speaks from, and any refusal for the panel. */
export async function run(session: DeskSession, name: string, args: Record<string, unknown>, by: 'tool' | 'button', deps: Deps = {}): Promise<Done> {
  const started = Date.now();
  const budget = deps.budgetMs ?? BUDGET_MS[name] ?? 8_000;
  const waitMs = () => Math.min(WAIT_MS, Math.max(500, budget - (Date.now() - started)));
  const lookups = { lookup: within(deps.lookup, LOOKUP_MS, 'the ticker lookup'), search: within(deps.search, SEARCH_MS, 'the symbol search') };

  switch (name) {
    case 'add_symbols': {
      const listed = names(args, ...ALL);
      const asked = listed.slice(0, MAX_NAMES);
      if (!asked.length) return { text: 'Not done: no stock was named. Ask which one they want on the board.' };
      const r = await resolveStocks(asked, session.board(), lookups);
      const report = await session.add(r.symbols, { by, said: r.said, unresolved: r.unresolved, waitMs: waitMs(), call: deps.call });
      if (listed.length > asked.length) report.untried = listed.slice(asked.length);
      return { text: said.added(report, session.board()), refused: addRefusal(report) };
    }
    case 'focus_symbol': {
      const asked = names(args, ...ONE)[0];
      if (!asked) return { text: 'Not done: no stock was named. Ask which one they want to look at.' };
      const r = await resolveStocks([asked], session.board(), lookups);
      if (!r.symbols.length) return { text: said.focused({ kind: 'missing', said: asked }, session.board()), refused: `No listing matched “${asked}”. Try the ticker.` };
      const report = await session.focus(r.symbols[0], { by, said: r.said[r.symbols[0]], waitMs: waitMs(), call: deps.call });
      return { text: said.focused(report, session.board()), refused: report.kind === 'added' ? addRefusal(report.report) : undefined };
    }
    case 'refresh_quote': {
      const asked = names(args, ...ONE)[0];
      let symbol: string | null = null;
      if (asked) {
        // What is refreshed is on the board: its rows and written tickers, no lookups.
        symbol = (await resolveStocks([asked], session.board())).symbols[0] ?? null;
        if (!symbol) return { text: `Not done: "${asked}" does not match anything on the board. Ask which stock they mean.`, refused: board.NOT_ON_BOARD_MESSAGE };
      }
      const report = await session.refresh(symbol, { by, waitMs: waitMs(), call: deps.call });
      return { text: said.refreshed(report), refused: refreshRefusal(report) };
    }
    case 'remove_symbols': {
      const asked = names(args, ...ALL).slice(0, MAX_NAMES);
      if (!asked.length) return { text: 'Not done: no stock was named. Ask which one should come off.' };
      // What comes off is on the board: no lookups. A name that matched
      // nothing goes to the board as said, which refuses it in its own words.
      const r = await resolveStocks(asked, session.board());
      const report = session.remove([...r.symbols, ...r.unresolved]);
      return { text: said.removed(report), refused: report.refused.join(' ') || undefined };
    }
    case 'clear_board': {
      const report = session.clear();
      return { text: said.cleared(report), refused: report.cleared ? undefined : report.reason };
    }
  }
  throw new Error(`unknown action ${name}`);
}

/** A button: the tool it runs, with what, and the words the host is told it was. */
export const BUTTONS: Record<Kind, (symbol: string) => { tool: string; args: Record<string, unknown>; label: string }> = {
  add: (symbol) => ({ tool: 'add_symbols', args: { stocks: [symbol] }, label: `Add ${symbol}` }),
  remove: (symbol) => ({ tool: 'remove_symbols', args: { stocks: [symbol] }, label: `Remove ${symbol}` }),
  focus: (symbol) => ({ tool: 'focus_symbol', args: { stock: symbol }, label: `the ${symbol} card` }),
  refresh: (symbol) => ({ tool: 'refresh_quote', args: symbol ? { stock: symbol } : {}, label: `Refresh ${symbol}`.trim() }),
  clear: () => ({ tool: 'clear_board', args: {}, label: 'Clear the board' }),
};

/** A button press, acted on at once; the host is told what it did. */
export async function press(session: DeskSession, kind: Kind, symbol: string, deps: Deps = {}): Promise<Done> {
  const button = BUTTONS[kind](symbol);
  const done = await run(session, button.tool, button.args, 'button', deps);
  return { text: pressed(button.label, done.text), refused: done.refused };
}
