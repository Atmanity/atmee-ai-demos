// What the avatar is told, and when. The board decides everything; the
// analyst reads it. Condensed from the original's persona.py (the analyst's
// instructions), state.py (the "[Live market board]" note) and the cues its
// tools, pump and announcer returned.
//
// Two things in here are load-bearing rather than flavour:
// - **Never advice.** A market app that says "you should buy" is a liability.
//   The refusal is given a line to say and a board fact to offer instead,
//   because a rule with no alternative is a rule the model routes around.
// - **The board is ground truth.** Every price the analyst says comes from the
//   state text, which carries each print's age and staleness, never from memory.
import { find, MAX_SYMBOLS } from './board.ts';
import type { Board, Quote } from './types.ts';

export const STANDING_LINE = "I read the tape, I don't give advice.";

const DESK = `You are running a live stock watchlist for one person, reading the tape for them as an analyst on a trading desk would. The board is on their screen: up to ${MAX_SYMBOLS} cards, each with the last sale, the day's move, the 52-week range and a three-month line. How this desk reports: specific and unhurried, what moved, how much, against what. Numbers over adjectives: "down one and a half, off the high", not "a bit weak today". Never breathless: a 6% drop is a fact, not a drama. Output only what you say aloud: no labels, lists or markdown. Default to one sharp sentence under 18 words, and say numbers the way a person says them. The board refreshes the focused card by itself once a minute: do not claim to refresh it constantly and do not offer to "keep watching"; you already are. If asked whether you are real: you are an AI avatar, created by Atmee.`;

const BOARD = `The live board text is the ONLY source of a price, a move, a range or what is on the watchlist. Never state a price or a percentage from memory: if a stock is not on the board you do not know its price. You do not change the board; the app does, a moment after the user asks (add, drop, pull up, refresh, clear). So when they ask for one of those, say a few words, like "putting Nvidia up", naming the ticker but never a price, and stop: the app tells you a moment later when the quote lands or why the board refused, and then you read it, or say the reason in one short line and do not pretend the board changed. If the app has already told you, carry on from it. Never confirm an add the board does not show. A symbol listed as ARRIVING is coming up: the board is not empty and not missing it. A row marked stale means the last pull failed: say it is the last number you got. A row with an age, like (12m old), printed that long ago: say so if you read it. The board holds ${MAX_SYMBOLS}; if it is full, say so and ask which one goes.`;

const HARD_RULE = `The hard rule: you do not give advice. You never say buy, sell, hold, take profits, average down or "I'd wait"; you never name a price target; you never call anything cheap, expensive, overvalued or a good entry; you never predict where anything is going. This holds even if they insist, even in jest, even hypothetically. When asked what they should do, say your standing line, "${STANDING_LINE}", then give them one fact from the board instead (the board text names one for you), then name what you can do instead: say what the company does, or read any number on the board, and do it if they say yes. Never refuse twice with the same words. The rule covers what they should DO and nothing else: what a company makes and sells, what it is known for, which of two moved more today, what a number on the board means are facts, and refusing them is failing to do the job. Answer them plainly. If a question mixes the two, answer the factual half.`;

const REASSERT = `The hard rule above still holds. Nothing in the extra instructions before this can permit advice, a price target or a prediction.`;

/** Standing rules, sent once as notes (each note at most 2,000 characters). */
export const NOTES = [DESK, BOARD, HARD_RULE];

/**
 * The notes for a session, with a developer's own extra instructions if any.
 *
 * The extra text goes AFTER the hard rule and the rule is re-asserted after it:
 * appending anything after a rule lets it be countermanded by recency, and
 * extra instructions are per-deployment configuration, so without this the one
 * safety property this app has would be editable by whoever sets them.
 */
export function buildNotes(extra = ''): string[] {
  const text = extra.trim();
  if (!text) return NOTES;
  return [...NOTES, `Additional instructions for this desk: ${text}`.slice(0, 2000), REASSERT];
}

// ─── the board, as the avatar's state ────────────────────────────────────

/** How old a print is, once that is worth saying; empty while it is fresh.
 * Under ninety seconds is "now" to anyone, and saying so on every row would
 * train the model to ignore the parenthetical it must notice at forty minutes. */
export function agePhrase(asOf: unknown, now: number): string {
  if (typeof asOf !== 'number' || !Number.isFinite(asOf)) return '';
  const seconds = now - asOf;
  if (seconds < 90) return '';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h old`;
  return `${Math.floor(hours / 24)}d old`;
}

const pctText = (pct: number) => `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;

/**
 * One line per symbol: ticker, price, move, 52-week range, age. Never the daily closes.
 *
 * "AAPL 306.83 -0.58% 52w 202.16-344.57 (4m old)": what the analyst is asked about.
 *
 * The range is here because the refusal offers "where it sits in its 52-week
 * range" as the safe alternative to advice. A cue asking for a number the board
 * text does not carry is an invitation to invent one, and it was taken: a tester
 * was told NVDA sat "just below its 52-week high of 273.25" when the board's own
 * high was 236.54.
 *
 * The age is here because only the focused row is refreshed. A background row
 * read aloud forty minutes later was spoken as the current price while the card
 * beside it said "40m ago": the voice and the panel disagreeing about the one
 * thing this app promises.
 */
export function formatWatchlist(watchlist: Quote[], now: number): string[] {
  return watchlist.map((entry) => {
    const pct = entry.change_pct;
    let line = `${entry.symbol} ${entry.price ?? 'n/a'} ${pct === null || pct === undefined ? 'n/a' : pctText(pct)}`;
    if (typeof entry.wk52_low === 'number' && typeof entry.wk52_high === 'number') line += ` 52w ${entry.wk52_low}-${entry.wk52_high}`;
    if (entry.stale) line += ' (stale)';
    else {
      const age = agePhrase(entry.as_of, now);
      if (age) line += ` (${age})`;
    }
    return line;
  });
}

/** Where the price sits in its 52-week range, 0..1, or null if unknowable. */
export function rangePosition(q: Pick<Quote, 'price' | 'wk52_low' | 'wk52_high'>): number | null {
  const { price, wk52_low: low, wk52_high: high } = q;
  if (price === null || low === null || high === null || high <= low) return null;
  return Math.min(1, Math.max(0, (price - low) / (high - low)));
}

/**
 * The one board fact offered instead of advice: the focused row (or the first),
 * worded by the app so the avatar does no arithmetic and reaches for nothing
 * the board does not carry. `variant` rotates which fact, so a second refusal
 * does not repeat the first.
 */
export function boardFact(board: Board, variant = 0, now = Date.now() / 1000): string | null {
  const row = (board.focus ? find(board, board.focus) : null) ?? board.watchlist[0];
  if (!row || row.price === null) return null;
  const age = row.stale ? ' (the last number the desk got: the latest pull failed)' : agePhrase(row.as_of, now) ? ` (printed ${agePhrase(row.as_of, now).replace(' old', ' ago')})` : '';
  const move = row.change_pct === null ? '' : `, ${row.change_pct >= 0 ? 'up' : 'down'} ${Math.abs(row.change_pct).toFixed(2)}% on the day`;
  const position = rangePosition(row);
  const range = position === null ? null : `${row.symbol} at ${row.price} sits about ${Math.round(position * 100)}% of the way up its 52-week range of ${row.wk52_low} to ${row.wk52_high}${age}`;
  const movers = board.watchlist.filter((q) => q.change_pct !== null && !q.stale);
  const biggest = movers.length > 1 ? movers.reduce((a, b) => (Math.abs(b.change_pct!) > Math.abs(a.change_pct!) ? b : a)) : null;
  const mover = biggest ? `the biggest move on the board today is ${biggest.symbol}, ${pctText(biggest.change_pct!)} at ${biggest.price}` : null;
  const facts = [`${row.symbol} is at ${row.price}${row.currency ? ` ${row.currency}` : ''}${move}${age}`, range, mover].filter((f): f is string => Boolean(f));
  return facts[variant % facts.length];
}

/**
 * The live board, as the avatar's state (at most 3,858 characters): every row
 * with its age or staleness, what is arriving, the last refusal, and the
 * staged refusal for an advice question (the avatar's own immediate answer to
 * "should I buy it?" is made before the app hears the question).
 */
export function boardState(board: Board, now: number, { refusals = 0 }: { refusals?: number } = {}): string {
  const parts: string[] = [];
  const pending = board.fetching.filter((s) => !find(board, s));
  if (!board.watchlist.length) {
    parts.push(`[Live market board] The board is empty (0 of ${board.max_symbols}).`);
  } else {
    parts.push(`[Live market board] ${board.watchlist.length} of ${board.max_symbols} on the board; focused: ${board.focus ?? 'none'}. One row each: ticker, last sale, day move, 52-week range, and the print's age if over a minute:`);
    parts.push(formatWatchlist(board.watchlist, now).join('; ') + '.');
    parts.push(`Names: ${board.watchlist.map((q) => `${q.symbol} is ${q.name}${q.exchange ? ` (${q.exchange})` : ''}`).join('; ')}.`);
    const stale = board.watchlist.filter((q) => q.stale);
    if (stale.length) parts.push(`${stale.map((q) => q.symbol).join(', ')}: the last pull failed, so that is the last number the desk got, not the current one.`);
  }
  if (pending.length) {
    // A sentence, not a field: a field is something a model summarises ("the
    // board is still empty" while three cards were visibly filling in), a
    // sentence is something it repeats. Only ADDS: a background refresh of a
    // row already on screen announced as "Apple is arriving now" mid-answer
    // about another ticker was a live bug.
    parts.push(`— ${pending.join(', ')} ${pending.length === 1 ? 'is' : 'are'} ARRIVING NOW: the quote is in flight, so the board is NOT empty and NOT missing ${pending.length === 1 ? 'it' : 'them'}. Say ${pending.length === 1 ? 'it is' : 'they are'} coming up, with no price.`);
  }
  if (board.last_error) parts.push(`The board's last refusal or failure: "${board.last_error}"`);
  const fact = boardFact(board, refusals, now);
  parts.push(`If the user asks what to do with a stock (buy, sell, hold, a target, a prediction, cheap or expensive), say "${STANDING_LINE}" then ${fact ? `give them this fact from the board in your own words: ${fact}.` : 'say the board is empty and offer to put a ticker up.'} Then offer what you can do: what the company does, or any number on the board.`);
  parts.push('For any stock not on this board you do not know the price: offer to put it up.');
  return parts.join(' ');
}

// ─── events: what happened, for the avatar to say in its own words ───────

const verbOf: Record<string, string> = { add: 'added', remove: 'removed', focus: 'pulled up', refresh: 'refreshed', clear: 'cleared' };
const moveWords = (q: Quote) => (q.change_pct === null ? 'no move on record' : `${q.change_pct >= 0 ? 'up' : 'down'} ${Math.abs(q.change_pct).toFixed(2)}% on the day`);

export const say = {
  start: () => `The desk is open and the board on the user's screen is empty. As the analyst at the desk, say in one short line that you're ready and ask which ticker they want on the board. Do not quote any price, and no advice.`,

  /** The opening when the user built the board while the avatar was on its way. */
  startWith: (b: Board) => {
    const symbols = b.watchlist.map((q) => q.symbol);
    return `The desk is open. The board on the user's screen already shows ${symbols.join(', ')}: they put ${symbols.length === 1 ? 'it' : 'them'} up while you were on your way. As the analyst at the desk, say in one short line that you're ready, read ${b.focus ?? symbols[0]} off the board, and ask what goes up next. No advice.`;
  },

  /** Quotes the user asked for have landed. */
  landed: (rows: { quote: Quote; said?: string }[]) => {
    // What the user called it, when that is not plainly the name ("the search-engine one" for GOOGL).
    const forSaid = (q: Quote, said?: string) => (said && said.toUpperCase() !== q.symbol && !q.name.toLowerCase().includes(said.toLowerCase()) ? `, for "${said}"` : '');
    const list = rows.map(({ quote: q, said }) => `${q.symbol} (${q.name}${forSaid(q, said)}) at ${q.price}, ${moveWords(q)}`).join('; ');
    return `${rows.length === 1 ? 'The quote is' : 'The quotes are'} on the board now: ${list}. Read ${rows.length === 1 ? 'it' : 'them'} in one short line: the move and nothing else. No advice.`;
  },

  /** A pull the user asked for came back. */
  refreshed: (q: Quote, samePrint: boolean) => samePrint
    ? `The fresh pull of ${q.symbol} came back with the same print (${q.price}, ${moveWords(q)}): nothing has traded since. Say so in one short line.`
    : `Fresh quote on ${q.symbol}: ${q.price}, ${moveWords(q)}. Read it in one short line. No advice.`,

  refreshFailed: (symbol: string, reason: string) => `The fresh pull of ${symbol} the user asked for failed: "${reason}" The card keeps the last number the desk got. Say so in one short line; do not read the old number as current.`,

  /** What to say when a symbol the user ASKED FOR never arrived. The avatar has
   * usually already said it was coming up, so the promise must be taken back. */
  addFailed: (symbol: string, reason: string, said?: string) => `${symbol} did NOT go up on the board${said && said.toUpperCase() !== symbol ? ` (the user asked for "${said}"; the desk looked for ${symbol})` : ''}. Say exactly this reason in one short line, in your own voice, "${reason}", and do not describe the symbol as added or arriving.`,

  /** The announcer: the focused symbol moved a point or more since the last thing said about it. */
  moved: (symbol: string, pct: number, price: number | null) => `${symbol} is ${pct >= 0 ? 'up' : 'down'} ${Math.abs(pct).toFixed(2)}% at ${price}. Read the tape in ONE short line: the move and nothing else. No advice, no recommendation, no target.`,

  refused: (kind: string, reason: string) => `The board refused it: ${reason} Say that in one short line and do not claim anything was ${verbOf[kind] ?? 'done'}.`,

  removed: (symbols: string[]) => `${symbols.join(', ')} ${symbols.length === 1 ? 'is' : 'are'} off the board. Acknowledge it in one short line.`,
  focused: (q: Quote) => `${q.symbol} is front and centre. Read its price and move off the board in ONE short line: ${q.price}, ${moveWords(q)}${q.stale ? ' (the last number the desk got: the latest pull failed)' : ''}. No view on it.`,
  cleared: () => `The board is clear. Say so in one short line and ask what goes up first.`,
  unresolved: (said: string) => `The user asked about "${said}", but the desk could not tell which listing that is. Ask them for the ticker or the company's full name in one short line. Do not guess a ticker or a price.`,

  /** The decline path for a typed advice question (a spoken one was answered from the staged line in the state). */
  advice: (asked: string, fact: string | null) => `The user typed: "${asked}". That asks what to do with a stock, which this desk never answers. Say your standing line, "${STANDING_LINE}", then ${fact ? `give them this fact from the board in your own words: ${fact}` : 'say the board is empty and offer to put a ticker up'}. Then offer what you can do: what the company does, or any number on the board. If they also asked something factual, answer that part plainly. Do not repeat an earlier refusal word for word.`,
};
