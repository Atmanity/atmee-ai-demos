// What an utterance means to the desk. The original let its model call
// add_symbol/remove_symbol/... and decline_advice; the Avatar API has no
// function calling, so the app decides, on the server: rules first (the verbs,
// the tickers, the companies on the board and a table of well-known names),
// then the app's own model call for what rules cannot read ("put the
// search-engine one up", an advice question in a new phrasing), then Nasdaq's
// symbol search for a name nobody could map.
//
// Advice is checked FIRST and by rules as well as by the model: the no-advice
// rule is the one safety property this app has, so the app holds it itself
// rather than trusting the avatar's persona to.
import { normalizeSymbol } from './board.ts';
import type { Listing } from './feed.ts';
import type { Board, Judgement, Kind } from './types.ts';

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

// ─── the model, for what rules cannot read ───────────────────────────────

export const ACTIONS = ['none', 'add', 'remove', 'focus', 'refresh', 'clear', 'advice'] as const;
export interface ModelReading { action: (typeof ACTIONS)[number]; companies: { said: string; ticker: string }[] }

export const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: [...ACTIONS], description: 'What the user wants done to the watchlist, or advice if they ask what to do with a stock, or none.' },
    companies: {
      type: 'array',
      description: 'Each company or ticker the user names (or refers to), in order.',
      items: {
        type: 'object',
        properties: {
          said: { type: 'string', description: 'The company or ticker as the user said it.' },
          ticker: { type: 'string', description: 'Its primary US ticker (an ADR or OTC ticker for a foreign company), or empty if unsure.' },
        },
        required: ['said', 'ticker'],
      },
    },
  },
  required: ['action', 'companies'],
};

export const judgePrompt = (utterance: string, board: Board) => `A user of a live stock-watchlist app said: "${utterance}"
The board holds: ${board.watchlist.length ? board.watchlist.map((q) => `${q.symbol} (${q.name})`).join(', ') : 'nothing'}${board.fetching.length ? `; arriving: ${board.fetching.join(', ')}` : ''}. The focused one is ${board.focus ?? 'none'}. Speech recognition may have misheard company names.
Classify the request:
- advice: they ask what to DO with a stock or the market: buy, sell, hold, a price target, a prediction, cheap or expensive, "what would you do", even hypothetically or in jest. A question that mixes advice with facts is advice.
- add: they want a stock put on the board ("add Nvidia", "put Apple up", "let's watch Tesla", "what's Tesla doing" when Tesla is NOT on the board).
- focus: they want to look at one ("pull up Apple", "what about Tesla", "what's Apple at").
- remove ("drop Tesla", "take it off"), refresh ("check it again", "any change"), clear ("clear the board", "start over").
- none: anything else, including questions about facts (what a company does, which moved more, what a number means) and small talk.
In companies, list each company or ticker named; "it" or "that one" means the focused one. Give the ticker only if you are sure; never invent one.`;

export type ModelCall = (utterance: string, board: Board) => Promise<ModelReading>;
export type SymbolSearch = (query: string) => Promise<Listing[]>;

/** The listing a name most plausibly means: a stock or fund whose ticker or name starts with what was said. */
export function pickListing(query: string, listings: Listing[]): Listing | null {
  const q = nameNorm(query);
  if (!q) return null;
  const tradable = listings.filter((l) => /^(stocks|etf)$/i.test(l.asset));
  return tradable.find((l) => l.symbol.toLowerCase() === q.replace(/\s+/g, ''))
    ?? tradable.find((l) => ` ${nameNorm(l.name)} `.startsWith(` ${q} `))
    ?? null;
}

/**
 * Rules first; the model when they cannot read the request or name its
 * stock; the symbol search when there is no model or it was not sure. Never
 * throws: a failing model or search leaves what the rules found.
 */
export async function judge(text: string, board: Board, { model, search }: { model?: ModelCall | null; search?: SymbolSearch | null } = {}): Promise<Judgement> {
  const ruled = rules(text, board);
  if (ruled.kind === 'advice' || ruled.kind === 'clear') return ruled;
  if (ruled.kind !== 'none' && !ruled.unresolved.length) return ruled;

  let reading: Judgement = ruled;
  if (model) {
    try {
      const m = await model(text, board);
      if (m.action === 'advice') return { kind: 'advice' };
      // Rules matched a verb but could not name the stock ("what's the board
      // look like at the moment"), and the model says it is not a request: it isn't.
      if (m.action === 'none') return { kind: 'none' };
      const symbols: string[] = [];
      const said: Record<string, string> = {};
      const unresolved: string[] = [];
      for (const company of m.companies ?? []) {
        // A name the rules know beats the model's ticker for it; the feed has the last word on either.
        const symbol = symbolsIn(company.said ?? '', board).symbols[0] || normalizeSymbol(company.ticker);
        if (symbol) {
          if (!symbols.includes(symbol)) symbols.push(symbol);
          if (company.said && company.said.toUpperCase() !== symbol) said[symbol] = company.said;
        } else if (company.said) unresolved.push(company.said);
      }
      reading = { kind: m.action, symbols, said, unresolved };
    } catch (err) {
      console.warn('[market-desk] [Judge] the model failed (%s); keeping the rules\' reading', (err as Error).message);
    }
  }
  if (reading.kind === 'none' || reading.kind === 'clear') return reading;
  if (reading.kind === 'add' && !reading.symbols.length && !reading.unresolved.length) return { kind: 'none' };
  if (!reading.unresolved.length) return reading;

  // Names left over: ask the symbol search.
  const symbols = [...reading.symbols];
  const said = { ...reading.said };
  const unresolved: string[] = [];
  for (const name of reading.unresolved) {
    const hit = search ? pickListing(name, await search(name).catch(() => [])) : null;
    if (hit && !symbols.includes(hit.symbol)) {
      symbols.push(hit.symbol);
      said[hit.symbol] = name;
    } else if (!hit) unresolved.push(name);
  }
  // Only an explicit add is worth a "which listing?" back. Anything else that
  // named nothing the desk knows ("what's the board look like at the moment",
  // "drop the other thing") is left to the avatar.
  if (!symbols.length && reading.kind !== 'add') return { kind: 'none' };
  return { ...reading, symbols, said, unresolved };
}
