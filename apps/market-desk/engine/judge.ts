// Words to the desk. Two jobs, both on the app's side of the host:
//
// - **Names to tickers** (`resolveStocks`). The host calls add_symbols with
//   the stocks as the user named them ("Nvidia", "the search-engine one",
//   "TSLA"); the app decides which listing each is: rules first (the board's
//   own rows, ~90 well-known names, written tickers, spelled-out letters), then
//   the app's own model call, then Nasdaq's symbol search. The feed has the
//   last word on any ticker.
// - **The safety net's reading** (`mustDo`). When the user's words clearly ask
//   for something safe to repeat (clear the board, refresh, drop a stock on
//   the board) and the host does not call the tool, the page does it. The
//   rules read commands as people say them, and an advice question first:
//   "should I dump Tesla?" is a question for the host to decline, never a
//   removal.
import { normalizeSymbol } from './board.ts';
import type { Listing } from './feed.ts';
import type { Board, Kind } from './types.ts';

/** The rules' reading of one utterance. */
export type Judgement =
  | { kind: 'none' }
  | { kind: 'advice' }
  | { kind: Kind; symbols: string[]; said: Record<string, string>; unresolved: string[] };

/** Text as the command rules read it: lower case, plain quotes, no accents. */
export const norm = (text: string) => text
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"')
  .toLowerCase().replace(/[^a-z0-9$&'.^\- ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Text as names are matched: no punctuation, no possessives, "&" as "and". */
const nameNorm = (text: string) => norm(text)
  .replace(/&/g, ' and ').replace(/'s\b/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ─── advice: what to DO with a stock ─────────────────────────────────────

const ADVICE: RegExp[] = [
  /\bshould (i|we|you|they)\b.{0,40}\b(buy|sell|hold|short|invest|get in|get out|dump|trim|load up|pile in|add more|take (some )?profits?|cash out|average down|bail)\b/,
  /\b(buy|sell|hold)\b.{0,25}\bor\b.{0,25}\b(buy|sell|hold)\b/,
  /\b(good|great|bad|smart|safe|solid|decent|wise|dumb) (buy|sell|investment|bet|entry|move|time to (buy|sell|get in))\b/,
  /\b(worth (buying|it|a buy|investing|owning)|buy the dip|time to (buy|sell)|good entry|entry point|price target|target price)\b/,
  /\bwhere('s| is| are| will| do you think| does)\b.{0,30}\b(go|going|head|heading|be|end up)\b/,
  /\b(going to|gonna|will (it|they|\w+)) (go up|go down|rise|fall|crash|moon|recover|bounce|drop|climb|tank|keep (going|rising|falling))\b/,
  // "Which is the most expensive one on the board?" asks for a price level, not a verdict.
  /(?<!\b(most|least|more|less) )\b(cheap|expensive|overvalued|undervalued|over valued|under valued|overpriced|underpriced|a bargain|a steal)\b/,
  /\b(what would you (do|buy|pick|sell)|would you (buy|sell|hold|invest|own|get)|do you recommend|recommend|your (pick|tip|advice|call)|any tips|what should i (do|buy|sell|invest|get)|if you were me|in my shoes|(pick|choose) one to (buy|own|invest)|tell me what to buy)\b/,
  /\b(put (my|some|all my|our) money|put money (in|into)|financial advice|investment advice)\b/,
];

// ─── commands ────────────────────────────────────────────────────────────

// A verb counts when it starts the request: "drop Tesla", "can you drop
// Tesla", "okay, drop it", not "why did Apple drop today?".
const LEAD = "(?:^|\\b(?:please|can you|could you|would you|will you|let'?s|go ahead and|and|then|ok|okay|now|just|i want to|i'd like to|i wanna|we can|also|so|hey)\\s+)";
const verb = (words: string) => new RegExp(`${LEAD}(?:${words})\\b`);

const COMMANDS: [Kind, RegExp[]][] = [
  ['clear', [/\b(clear|wipe|reset|empty)\b.{0,20}\b(board|watchlist|list|desk|everything|all)\b/, /\bstart over\b|\bclean slate\b|\bfresh start\b/, /\btake (everything|it all|all of (it|them)) off\b/, /^clear( it)?( out)?$/]],
  ['remove', [verb('drop|remove|delete|lose|ditch|scrap|dump|kill|bin'), /\bget rid of\b/, /\btake\b.{1,40}\boff\b/, /\bi'?m done with\b/, /\bno more\b.{1,30}\bplease\b/]],
  ['refresh', [verb('refresh|update|re-?pull|re-?check|re-?load'), /\bcheck (it|that|this|them|[a-z]+) again\b/, /\bpull (it|that|this|[a-z]+) again\b/, /\bany change\b/, /\bwhat'?s it at now\b/, /\bfresh (quote|number|price|print)\b/]],
  ['focus', [verb('pull up|bring up|look at|focus on|focus|switch to|go to|go back to|back to|show me|zoom in on|zoom in|let me see'), /\b(what|how) about\b/, /\bwhat'?s\s+.+?\s+(doing|at|trading)\b/, /\bhow'?s\s+.+?\s+doing\b/, /\bhow (is|are)\s+.+?\s+(doing|trading)\b/, /\bprice (of|on|for)\b/, /\bwhere'?s\s+.+?\s+trading\b/]],
  ['add', [verb('add|put|throw|stick|get|watch|track|follow'), /\b(on|onto|to) (the|my) (board|watchlist|desk|list)\b/, /\bput up\b/]],
];

/** What the request names, after the verb: "add palantir please" -> "palantir". */
const OBJECT: Partial<Record<Kind, RegExp[]>> = {
  add: [/\b(?:add|put|throw|stick|get|watch|track|follow)\s+(?:up\s+)?(.+)$/],
  focus: [/\b(?:pull up|bring up|look at|focus on|switch to|go back to|back to|go to|show me|zoom in on|let me see|what about|how about)\s+(.+)$/, /\bwhat'?s\s+(.+?)\s+(?:doing|at|trading)\b/, /\bhow'?s\s+(.+?)\s+doing\b/, /\bhow (?:is|are)\s+(.+?)\s+(?:doing|trading)\b/, /\bprice (?:of|on|for)\s+(.+)$/],
  remove: [/\b(?:drop|remove|delete|lose|ditch|scrap|dump|kill|bin)\s+(.+)$/, /\bget rid of\s+(.+)$/, /\btake\s+(.+?)\s+off\b/, /\bi'?m done with\s+(.+)$/],
};
const TRAILING = /\b(up|on|onto|off|in|to|from|for me|please|now|again|too|as well|the board|my board|the watchlist|my watchlist|the desk|the list|on there|stock|stocks|shares|ticker|right now|today|real quick|for a sec)\b/g;
const PRONOUN = /^(it|that|this|them|those|these|that one|this one|the one|the focused one|the stock|one)$/;

// ─── names ───────────────────────────────────────────────────────────────

/** Well-known names a person says instead of the ticker. The model (or the
 * symbol search) covers the rest; the feed has the last word on any ticker. */
export const ALIASES: Record<string, string> = {
  apple: 'AAPL', nvidia: 'NVDA', microsoft: 'MSFT', tesla: 'TSLA', amazon: 'AMZN', google: 'GOOGL', alphabet: 'GOOGL',
  meta: 'META', facebook: 'META', netflix: 'NFLX', amd: 'AMD', 'advanced micro devices': 'AMD', intel: 'INTC', ibm: 'IBM',
  oracle: 'ORCL', salesforce: 'CRM', adobe: 'ADBE', palantir: 'PLTR', broadcom: 'AVGO', qualcomm: 'QCOM', micron: 'MU',
  'coca cola': 'KO', coke: 'KO', pepsi: 'PEP', pepsico: 'PEP', disney: 'DIS', walmart: 'WMT', costco: 'COST', nike: 'NKE',
  starbucks: 'SBUX', mcdonalds: 'MCD', mcdonald: 'MCD', boeing: 'BA', berkshire: 'BRK-B', 'berkshire hathaway': 'BRK-B',
  'jp morgan': 'JPM', jpmorgan: 'JPM', 'goldman sachs': 'GS', 'bank of america': 'BAC', visa: 'V', mastercard: 'MA',
  paypal: 'PYPL', uber: 'UBER', airbnb: 'ABNB', spotify: 'SPOT', shopify: 'SHOP', coinbase: 'COIN', exxon: 'XOM',
  'exxon mobil': 'XOM', chevron: 'CVX', pfizer: 'PFE', 'johnson and johnson': 'JNJ', 'eli lilly': 'LLY', lilly: 'LLY',
  ford: 'F', 'general motors': 'GM', 'at and t': 'T', verizon: 'VZ', tsmc: 'TSM', 'taiwan semiconductor': 'TSM',
  asml: 'ASML', sony: 'SONY', toyota: 'TM', nintendo: 'NTDOY', alibaba: 'BABA', 'home depot': 'HD', target: 'TGT',
  'procter and gamble': 'PG', unitedhealth: 'UNH', snowflake: 'SNOW', 'super micro': 'SMCI', supermicro: 'SMCI',
  arm: 'ARM', rivian: 'RIVN', lucid: 'LCID', gamestop: 'GME', 'american express': 'AXP', amex: 'AXP', 'servicenow': 'NOW',
};
const ALIAS_KEYS = Object.keys(ALIASES).sort((a, b) => b.length - a.length);

/** Tickers that are also everyday words: matched only when written as a ticker ($ON, or upper case when typed). */
const WORD_TICKERS = new Set(['A', 'I', 'IT', 'ON', 'ALL', 'NOW', 'BE', 'ARE', 'SO', 'GO', 'DO', 'SEE', 'KEY', 'LOW', 'CAT', 'BIG', 'FUN', 'ANY', 'HAS', 'CAN', 'ONE', 'WELL', 'GOOD', 'BEST', 'LIFE', 'PLAY', 'RUN', 'TRUE', 'OPEN', 'CASH', 'PEAK', 'MAIN', 'EAT', 'HOPE', 'LOVE', 'TECH', 'BOX', 'FAST', 'NICE', 'EDIT', 'ICE', 'PATH', 'WISH', 'AN', 'AM', 'PM', 'OK', 'US', 'UP', 'NO', 'OR', 'AT', 'BY', 'IS', 'TO', 'OF', 'IN', 'AS', 'MY', 'ME', 'WE', 'HE', 'AI']);
/** Upper-case words that are not tickers (and, in a line typed in capitals, the words of the request itself). */
const NOT_TICKERS = new Set([
  'I', 'A', 'OK', 'AM', 'PM', 'US', 'USA', 'UK', 'EU', 'CEO', 'CFO', 'AI', 'ET', 'EST', 'EDT', 'TV', 'IPO', 'ETF', 'NYSE', 'NASDAQ', 'S', 'P', 'USD', 'EPS', 'PE', 'YTD', 'OMG', 'LOL', 'BTW', 'FYI', 'ASAP',
  'ADD', 'PUT', 'DROP', 'PULL', 'UP', 'THE', 'IT', 'ON', 'OFF', 'AND', 'SHOW', 'ME', 'WHAT', 'WHATS', 'HOW', 'HOWS', 'IS', 'ARE', 'NOW', 'CHECK', 'AGAIN', 'CLEAR', 'BOARD', 'LOOK', 'AT', 'FOCUS', 'ABOUT', 'TAKE', 'GET', 'WATCH', 'TRACK', 'TO', 'MY', 'FOR', 'PLS', 'THAT', 'THIS', 'ONE', 'DOING', 'PRICE', 'OF', 'BUY', 'SELL', 'HOLD', 'SHOULD', 'YES', 'NO', 'HI', 'HEY', 'WHY', 'WHO', 'CAN', 'YOU', 'LOSE', 'KILL', 'DUMP', 'ALL', 'STOCK', 'STOCKS', 'TICKER',
]);
/** First words of company names too common to stand for the company alone. */
const GENERIC = new Set(['the', 'international', 'american', 'general', 'united', 'first', 'bank', 'global', 'new', 'national', 'eli', 'jp', 'super', 'advanced', 'taiwan', 'home']);

interface Found { symbols: string[]; said: Record<string, string>; spans: [number, number][] }

/** The key a board row is called by: "Tesla, Inc." -> "tesla"; "General Motors Company" -> "general motors". */
const rowKey = (name: string) => {
  const words = nameNorm(name).split(' ').filter(Boolean);
  if (!words.length) return '';
  return GENERIC.has(words[0]) && words[1] ? `${words[0]} ${words[1]}` : words[0];
};

/** Every symbol the text names, in the order it names them. */
export function symbolsIn(text: string, board: Board): Found {
  const hits: { at: number; symbol: string; said: string }[] = [];
  const spans: [number, number][] = [];
  const t = ` ${nameNorm(text)} `;
  const taken = (from: number, to: number) => spans.some(([a, b]) => from < b && to > a);
  const claim = (at: number, end: number, symbol: string, said: string) => {
    if (taken(at, end)) return;
    spans.push([at, end]);
    hits.push({ at, symbol, said });
  };
  const scan = (phrase: string, symbol: string, said = phrase) => {
    if (!phrase) return;
    let from = 0;
    for (;;) {
      const at = t.indexOf(` ${phrase} `, from);
      if (at < 0) return;
      claim(at + 1, at + 1 + phrase.length, symbol, said);
      from = at + phrase.length + 1;
    }
  };

  // Rows already on the board (or on their way), by ticker and by name.
  const rows = [...board.watchlist.map((q) => ({ symbol: q.symbol, name: q.name })), ...board.fetching.filter((s) => !board.watchlist.some((q) => q.symbol === s)).map((s) => ({ symbol: s, name: '' }))];
  for (const row of rows) {
    const key = rowKey(row.name);
    if (key && key.length > 2) scan(key, row.symbol, key);
    if (!WORD_TICKERS.has(row.symbol) && row.symbol.length > 1) scan(nameNorm(row.symbol), row.symbol, row.symbol);
  }
  // Well-known names.
  for (const alias of ALIAS_KEYS) scan(alias, ALIASES[alias], alias);
  // Tickers spelled out letter by letter: "n v d a", "a. a. p. l".
  for (const m of norm(text).matchAll(/(?:^|\s)((?:[a-z]\.?\s){1,4}[a-z])\.?(?=\s|$)/g)) {
    const symbol = normalizeSymbol(m[1]);
    const letters = m[1].replace(/[.\s]/g, '');
    if (symbol && letters.length >= 2) scan(m[1].replace(/\./g, '').replace(/\s+/g, ' ').trim(), symbol, symbol);
  }
  // Written as a ticker: $tsla, or upper case ("add PLTR"; recognisers write some tickers this way).
  for (const m of text.matchAll(/\$([A-Za-z]{1,5}(?:[.-][A-Za-z]{1,2})?)\b|\b([A-Z]{2,5}(?:[.-][A-Z]{1,2})?)\b/g)) {
    const raw = m[1] ?? m[2];
    if (!m[1] && NOT_TICKERS.has(raw)) continue;
    const symbol = normalizeSymbol(raw);
    if (symbol) scan(nameNorm(raw), symbol, symbol);
  }
  hits.sort((a, b) => a.at - b.at);
  const symbols: string[] = [];
  const said: Record<string, string> = {};
  for (const hit of hits) {
    if (symbols.includes(hit.symbol)) continue;
    symbols.push(hit.symbol);
    if (hit.said.toUpperCase() !== hit.symbol) said[hit.symbol] = hit.said;
  }
  return { symbols, said, spans };
}

/** The words a request named that no rule could turn into a ticker: "add palantir please" -> ["palantir"]. */
function leftovers(text: string, kind: Kind, found: Found): string[] {
  if (found.symbols.length) return [];
  const t = norm(text).replace(/[.?!,]+$/g, '');
  for (const re of OBJECT[kind] ?? []) {
    const m = re.exec(t);
    if (!m) continue;
    let phrase = m[1].replace(/[.?!,]/g, ' ').replace(TRAILING, ' ').replace(/^\s*(the|a|an|some|of)\s+/, ' ').replace(/\s+/g, ' ').trim();
    phrase = phrase.replace(/^(the|a|an)\s+/, '');
    if (!phrase || PRONOUN.test(phrase)) return [];
    return phrase.split(/\s*(?:,|\band\b|&)\s*/).map((p) => p.trim()).filter((p) => p && !PRONOUN.test(p));
  }
  return [];
}

/** "Lose the last one", "drop the first one": a position on the board. */
function positional(text: string, board: Board): string | null {
  const t = norm(text);
  if (!board.watchlist.length) return null;
  if (/\b(last|latest) one\b|\bthe last\b/.test(t)) return board.watchlist[board.watchlist.length - 1].symbol;
  if (/\bfirst one\b|\bthe first\b/.test(t)) return board.watchlist[0].symbol;
  return null;
}

const FILLER = /\b(please|um+|uh+|okay|ok|and|the|stock|stocks|ticker|shares|so|hey|hmm|yeah|yes|now)\b/g;

/** Rules only: instant and free. `unresolved` lists names the rules could not map. */
export function rules(text: string, board: Board): Judgement {
  const t = norm(text);
  if (!t) return { kind: 'none' };
  if (ADVICE.some((re) => re.test(t))) return { kind: 'advice' };
  const found = symbolsIn(text, board);
  const kind = COMMANDS.find(([, patterns]) => patterns.some((re) => re.test(t)))?.[0];
  if (kind === 'clear') return { kind, symbols: [], said: {}, unresolved: [] };
  if (kind) {
    let symbols = found.symbols;
    if (!symbols.length && (kind === 'remove' || kind === 'focus')) {
      const at = positional(text, board);
      if (at) symbols = [at];
    }
    const unresolved = symbols.length ? [] : leftovers(text, kind, found);
    // "Put it up" names nothing the desk can see (the stock was named earlier, to the avatar): the avatar answers it.
    if (kind === 'add' && !symbols.length && !unresolved.length) return { kind: 'none' };
    return { kind, symbols, said: found.said, unresolved };
  }
  // No verb: a bare name or ticker ("Nvidia.", "AAPL please") pulls it up, and puts it up if it is not there.
  if (found.symbols.length) {
    let rest = ` ${nameNorm(text)} `;
    for (const [a, b] of [...found.spans].sort((x, y) => y[0] - x[0])) rest = rest.slice(0, a) + ' ' + rest.slice(b);
    if (!rest.replace(FILLER, ' ').trim()) {
      return { kind: found.symbols.length === 1 ? 'focus' : 'add', symbols: found.symbols, said: found.said, unresolved: [] };
    }
  }
  return { kind: 'none' };
}


// ─── the safety net ──────────────────────────────────────────────────────

export type NetCall = { name: 'clear_board' | 'refresh_quote' | 'remove_symbols' | 'focus_symbol'; arguments: Record<string, unknown> };

/** Asking to look at a stock, as opposed to asking about it ("what's Tesla doing?" is answered from the board). */
const LOOK = /\b(pull up|bring up|look at|focus on|switch to|go back to|back to|go to|show me|zoom in on|let me see|put [a-z0-9.\- ]+ (front and cent(er|re)|on watch))\b/;

/**
 * The tool call the user's words clearly ask for, among those safe to do
 * twice: a second clear finds the board clear, a second refresh hits the 15 s
 * floor, a second removal finds the stock gone, a second focus finds it in
 * front already. Never an add (a duplicate could take a slot), and a focus
 * only of a stock already on the board (otherwise it would add).
 */
export function mustDo(text: string, board: Board): NetCall | null {
  const j = rules(text, board);
  if (j.kind === 'clear') return { name: 'clear_board', arguments: {} };
  if (j.kind === 'refresh') return { name: 'refresh_quote', arguments: j.symbols[0] ? { stock: j.symbols[0] } : {} };
  // Bringing a stock already on the board to the front is safe to do twice; one that is not there would be an add.
  if (j.kind === 'focus') {
    const symbol = j.symbols[0];
    return symbol && board.watchlist.some((q) => q.symbol === symbol) && LOOK.test(norm(text)) ? { name: 'focus_symbol', arguments: { stock: symbol } } : null;
  }
  if (j.kind === 'remove') {
    if (j.symbols.length) return { name: 'remove_symbols', arguments: { stocks: j.symbols } };
    // "Drop it": the one on watch. "Drop the other thing" names nothing the net can be sure of.
    if (!j.unresolved.length && board.focus && /\b(it|that|this)( one)?\b/.test(norm(text))) return { name: 'remove_symbols', arguments: { stocks: [board.focus] } };
  }
  return null;
}

// ─── names to tickers ────────────────────────────────────────────────────

/** The app's own model call: names to tickers, for what the rules cannot read. */
export type TickerLookup = (names: string[], board: Board) => Promise<{ said: string; ticker: string }[]>;
export type SymbolSearch = (query: string) => Promise<Listing[]>;

export const LOOKUP_SCHEMA = {
  type: 'object',
  properties: {
    stocks: {
      type: 'array',
      description: 'One entry per name, in order.',
      items: {
        type: 'object',
        properties: {
          said: { type: 'string', description: 'The name, exactly as given.' },
          ticker: { type: 'string', description: 'Its primary US ticker (an ADR or OTC ticker for a foreign company), or empty if unsure.' },
        },
        required: ['said', 'ticker'],
      },
    },
  },
  required: ['stocks'],
};

export const lookupPrompt = (names: string[], board: Board) => `A user of a live stock-watchlist app asked for these stocks, as speech recognition heard them: ${names.map((n) => `"${n}"`).join(', ')}.
The board holds: ${board.watchlist.length ? board.watchlist.map((q) => `${q.symbol} (${q.name})`).join(', ') : 'nothing'}. Company names may be misheard; a description ("the search-engine one") means the company it describes.
For each name give its primary US-listed ticker. Give a ticker only if you are sure which listing is meant; never invent one.`;

/** The listing a name most plausibly means: a stock or fund whose ticker or name starts with what was said. */
export function pickListing(query: string, listings: Listing[]): Listing | null {
  const q = nameNorm(query);
  if (!q) return null;
  const tradable = listings.filter((l) => /^(stocks|etf)$/i.test(l.asset));
  return tradable.find((l) => l.symbol.toLowerCase() === q.replace(/\s+/g, ''))
    ?? tradable.find((l) => ` ${nameNorm(l.name)} `.startsWith(` ${q} `))
    ?? null;
}

export interface Resolved {
  /** Tickers, in the order they were named. */
  symbols: string[];
  /** What the user called each ticker, when that was not the ticker itself. */
  said: Record<string, string>;
  /** Names nobody could turn into a ticker. */
  unresolved: string[];
}

/** A ticker as the host writes one: "TSLA", "F", "BRK.B", "$pltr". */
const WRITTEN_TICKER = /^\$[A-Za-z]{1,5}(?:[.-][A-Za-z]{1,2})?$|^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$/;

/**
 * Each name the host passed, as a ticker: "it" and "the last one" by the
 * board; then the rules (the board's rows by name or ticker, the well-known
 * names, a written ticker); then the model, once for all that are left; then
 * Nasdaq's symbol search. Never throws: a failing model or search leaves the
 * name unresolved, and the host asks the user for the ticker.
 */
export async function resolveStocks(names: string[], board: Board, { lookup, search }: { lookup?: TickerLookup | null; search?: SymbolSearch | null } = {}): Promise<Resolved> {
  // One entry per name, filled by the first step that can read it; the order is kept.
  // `guess` is the rules' reading of a name they only partly read ("Apple
  // Hospitality REIT" is not Apple): the model decides those, the guess stands if it cannot.
  const entries: { name: string; found: [string, string | undefined][]; guess?: Found }[] = [];
  for (const raw of names) {
    const name = String(raw ?? '').trim().slice(0, 80);
    if (!name) continue;
    const entry: (typeof entries)[number] = { name, found: [] };
    entries.push(entry);
    if (PRONOUN.test(norm(name).replace(/[.?!,]+$/, ''))) {
      if (board.focus) entry.found.push([board.focus, undefined]);
      continue;
    }
    const at = positional(name, board);
    if (at) {
      entry.found.push([at, undefined]);
      continue;
    }
    const found = symbolsIn(name, board);
    if (found.symbols.length) {
      if (lookup && unread(name, found, board)) entry.guess = found;
      else for (const symbol of found.symbols) entry.found.push([symbol, found.said[symbol] ?? (found.symbols.length === 1 ? name : undefined)]);
      continue;
    }
    // A ticker as written that is also a word ("ON", "AI") or one letter ("F"): the rules skip those.
    if (WRITTEN_TICKER.test(name)) entry.found.push([normalizeSymbol(name), undefined]);
  }

  const open = () => entries.filter((e) => !e.found.length);
  if (open().length && lookup) {
    try {
      const answers = await lookup(open().map((e) => e.name), board);
      for (const entry of open()) {
        const answer = answers.find((a) => nameNorm(a.said ?? '') === nameNorm(entry.name));
        const symbol = normalizeSymbol(answer?.ticker);
        if (symbol) entry.found.push([symbol, entry.name]);
      }
    } catch (err) {
      console.warn('[market-desk] [Resolve] the model failed (%s); trying the symbol search', (err as Error).message);
    }
  }
  for (const entry of open()) {
    if (entry.guess) {
      for (const symbol of entry.guess.symbols) entry.found.push([symbol, entry.guess.said[symbol] ?? entry.name]);
      continue;
    }
    const hit = search ? pickListing(entry.name, await search(entry.name).catch(() => [])) : null;
    if (hit) entry.found.push([hit.symbol, entry.name]);
  }

  const symbols: string[] = [];
  const said: Record<string, string> = {};
  const unresolved: string[] = [];
  for (const entry of entries) {
    if (!entry.found.length) unresolved.push(entry.name);
    for (const [symbol, name] of entry.found) {
      if (symbols.includes(symbol)) continue;
      symbols.push(symbol);
      if (name && name.toUpperCase().replace(/^\$/, '') !== symbol) said[symbol] = name;
    }
  }
  return { symbols, said, unresolved };
}

/** Words that do not change which company a name means. */
const CORPORATE = /\b(inc|incorporated|corp|corporation|company|co|companies|holdings?|group|plc|ltd|limited|class|shares?|stock|stocks|common|ordinary|adr|the|and|please|ticker)\b/g;

/** The name has words the rules did not account for (beyond the board row's own name): their match may be a different company. */
function unread(name: string, found: Found, board: Board): boolean {
  let rest = ` ${nameNorm(name)} `;
  for (const [a, b] of [...found.spans].sort((x, y) => y[0] - x[0])) rest = rest.slice(0, a) + ' ' + rest.slice(b);
  const known = new Set(board.watchlist.filter((q) => found.symbols.includes(q.symbol)).flatMap((q) => nameNorm(q.name).split(' ')));
  return rest.replace(CORPORATE, ' ').split(/\s+/).filter((w) => w && w.length > 1 && !known.has(w)).length > 0;
}
