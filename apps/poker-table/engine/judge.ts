// Reading the player's own move out of what they said: in code, not in prose.
// Ported from the original's `moves.py`; the comments below are its scars.
//
// Live staging session, text mode, panel dead. Three of the four blockers were
// the same disease:
//
//     "I fold. can we start a new hand?"
//     -> "You can't start a new hand right now since we're still in play."
//     "purple banana forty seven?"
//     -> "You raised to 47! The pot's grown to 1,027."
//
// The fold never happened and the gibberish did. Both came from the same
// place: the human's move was an optional tool the model could call, or not,
// with arguments it was free to invent. A tool call is a model output; it is
// not evidence the player said anything.
//
// So the move is parsed HERE, deterministically, from the exact text, and
// applied through the same table a button press goes through. There is no
// model fallback: the original's (a gated `player_move` tool) could only ever
// re-apply what this parser had already found, so it is not ported.
//
// Two rules keep this honest:
// * A clause that is a question is never a move. "can we start a new hand?"
//   is a request; "should I fold?" is a question about folding. Splitting on
//   sentence punctuation is what lets "I fold. can we start a new hand?" be
//   both a fold AND a deal request.
// * No action word, no action. "forty seven" is a number, not a bet. An
//   utterance the table cannot read applies NOTHING; when it looks like it was
//   trying to be a move, the avatar asks which one they meant.

export type ParsedMove = { kind: 'fold' | 'check' | 'call' | 'all_in' } | { kind: 'raise'; amount?: number };

/** What one user turn asked the table for. */
export interface ParsedTurn {
  /** A move ready for the table, or null. */
  move: ParsedMove | null;
  wantsNewHand: boolean;
  asksOwnCards: boolean;
  /** Set when the turn looked like it was reaching for a move and the table could not read which. */
  unclear: string | null;
}

// Number words, so "raise to forty" is the same move as "raise to 40". Speech
// transcription writes small numbers as words about as often as digits, and a
// raise that silently does not parse is the bug this module exists to stop.
const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000 };
const isNumberWord = (w: string) => w in UNITS || w in TENS || w in SCALES;
const isDigits = (w: string) => /^\d+$/.test(w);

// A clause is a question when it ENDS in one. "I fold?" is a player wondering
// out loud; "I fold." is a player folding.
const CLAUSE_SPLIT = /(?<=[.!?;])\s+/;

// What makes a question-marked clause an actual QUESTION rather than a
// fragment with a "?" stuck on the end. The number check used to run over the
// whole utterance, so "is the pot 270?" and "so I have 980 left?" were ruled
// unreadable and the avatar asked whether they meant fold/check/call instead of
// answering. "purple banana forty seven?" carries no question in it, and that
// one still has to be asked about: it became a 47-chip raise once.
const ASKS = new RegExp(
  "\\b(what|what'?s|where|when|why|how|who|which|whose|" +
  'is|are|am|was|were|do|does|did|can|could|should|shall|would|will|' +
  'have|has|had|' +
  'i|me|my|we|us|our|you|your|it|that|this|there|the|' +
  'pot|stack|chips?|blind|left)\\b',
);

// Negated contractions are matched as a SUFFIX, never inside \b…\b. Written as
// `\bn'?t\b` the alternative could not fire at all (the `n` of "won't" follows
// a word character), so "I won't fold" and "you can't check there" committed a
// real fold and a real check for the player. The apostrophe-less forms a
// transcript produces are an explicit list, because a bare `nt$` also ends
// "want", "point" and "count", and "I want to fold" is a fold.
const NEGATED =
  "\\w+n['’]t\\b" +
  '|\\b(?:wo|ca|do|does|did|is|are|was|were|have|has|had|would|should|could|must|need|ai)nt\\b';

// Hedges and negations. "I'm not folding" and "why would I fold" contain the
// word fold and mean the opposite of it; nothing here is applied, and the
// avatar asks rather than guesses.
const HEDGE = new RegExp(
  '\\b(not|never|instead of|rather than|why would|what if|maybe|' +
  'thinking about|tempted to|almost|nearly|unless|before i|should i)\\b|' + NEGATED,
);

const ALL_IN = /\b(all[\s-]?in|allin|shove|shoving|jam|jamming)\b/;
const FOLD = /\b(fold|folds|folding|muck|mucking|lay it down)\b|\bi'?m out\b|\bim out\b/;
// "let me check my cards" is not a check, and "check this out" is not a check.
const CHECK = /\bcheck(?:s|ing)?\b(?!\s+(?:my|the|this|that|it|out|on|whether|if|in)\b)/;
// "call it" IS a call; "call it a night" and "what do you call" are not.
const CALL = /\bcall(?:s|ing)?\b(?!\s+it\s+a\b)/;
// "raised": the recogniser heard "Raise to five" as "Raised to five." live, and
// a table that answers its own player's raise with silence is the worst miss.
const RAISE = /\b(raise|raises|raised|raising|re-?raise|bet|bets|betting|make it|makes it|put in)\b/;

// Asking for cards. Deliberately generous: the cost of a spurious deal request
// is a refusal ("a hand is already in play") or nothing at all mid-hand, while
// the cost of missing one is a table that sits on a finished hand.
const NEW_HAND = /\b(deal|new hand|another hand|next hand|one more|play again|start over|start again|another round|next round|re-?deal)\b/;

// Asking what they hold. The original's pattern was never acted on, and it
// also matched "what's my stack?" and "I fold my hand"; this one is used, so it
// asks for a question word and a card word, and "have to" is not "have".
const OWN_CARDS = /\b(?:what|which)\s+cards?\b|\b(?:what|which|tell me|remind me|read me|show me|read)\b[^.!?]*\b(?:my|i)\b[^.!?]*\b(?:cards?|hand|holding|hold|(?:have|got)(?!\s+to\b))\b/;

const words = (text: string) => text.match(/[a-z0-9']+/g) ?? [];

/** A digit run or a short chain of number words -> an int. */
function toNumber(tokens: string[]): number | null {
  let total = 0;
  let current = 0;
  let used = false;
  for (const word of tokens) {
    if (isDigits(word)) { current += Number(word); used = true; }
    else if (word in UNITS) { current += UNITS[word]; used = true; }
    else if (word in TENS) { current += TENS[word]; used = true; }
    else if (word in SCALES) {
      if (!used) current = 1;
      current *= SCALES[word];
      used = true;
      total += current;
      current = 0;
    } else if (word === 'and' || word === '-') continue;
    else break;
  }
  return used ? total + current : null;
}

/** The first number at or after `start`, digits or words. */
function amountAfter(text: string, start: number): number | null {
  const tail = words(text.slice(start));
  const i = tail.findIndex((w) => isDigits(w) || isNumberWord(w));
  return i < 0 ? null : toNumber(tail.slice(i));
}

/**
 * A number that reads like an amount, not like English. Narrower than the
 * number words: "haha nice one" and "two of a kind" contain unit words, and a
 * table that answers chatter with "which action did you mean?" is its own kind
 * of broken. Digits and the tens are what a chip amount looks like.
 */
function hasChipSizedNumber(text: string): boolean {
  return words(text).some((w) => isDigits(w) || w in TENS || w in SCALES);
}

function moveInClause(clause: string): ParsedMove | null {
  if (ALL_IN.test(clause)) return { kind: 'all_in' };
  if (FOLD.test(clause)) return { kind: 'fold' };
  const raise = RAISE.exec(clause);
  if (raise) {
    // A raise with no number is still a raise: the table refuses it with the
    // sentence that names the legal range, which beats silence.
    const amount = amountAfter(clause, raise.index + raise[0].length);
    return amount === null ? { kind: 'raise' } : { kind: 'raise', amount };
  }
  if (CHECK.test(clause)) return { kind: 'check' };
  if (CALL.test(clause)) return { kind: 'call' };
  return null;
}

/** What the player asked for, read off the text alone. Never touches the table. */
export function parseTurn(text: string): ParsedTurn {
  // "1,000" is one number: the felt prints amounts with a thousands comma, and
  // read as words it was "1" and "000", a raise to 1.
  const lowered = (text ?? '').trim().toLowerCase().replace(/[’]/g, "'").replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  const parsed: ParsedTurn = { move: null, wantsNewHand: false, asksOwnCards: false, unclear: null };
  if (!lowered) return parsed;

  const clauses = lowered.split(CLAUSE_SPLIT).filter((c) => c.trim());
  const moves: ParsedMove[] = [];
  let hedged = false;
  // The text the number check may see: the same clause filtering move
  // detection uses, so a figure inside a question is not a move they failed to name.
  const unasked: string[] = [];
  for (const clause of clauses.length ? clauses : [lowered]) {
    if (clause.trimEnd().endsWith('?')) {
      if (!ASKS.test(clause)) unasked.push(clause);
      continue; // a question about a move is still not a move
    }
    unasked.push(clause);
    const move = moveInClause(clause);
    if (!move) continue;
    if (HEDGE.test(clause)) { hedged = true; continue; }
    moves.push(move);
  }

  parsed.wantsNewHand = NEW_HAND.test(lowered);
  parsed.asksOwnCards = OWN_CARDS.test(lowered);

  if (new Set(moves.map((m) => m.kind)).size > 1) {
    // "call or maybe raise": two moves is no move, and picking one is exactly
    // the chip-spending guess this module refuses to make.
    parsed.unclear = 'they named more than one action';
    return parsed;
  }
  if (moves.length) {
    parsed.move = moves[0];
    return parsed;
  }
  if (hedged) {
    parsed.unclear = 'they talked about an action without taking it';
    return parsed;
  }
  if (hasChipSizedNumber(unasked.join(' ')) && !parsed.wantsNewHand) {
    // The purple-banana case: a number with no action attached. It became a
    // 47-chip raise once; it must never become one again.
    parsed.unclear = 'they said a number but no action';
  }
  return parsed;
}

// ---- the host's calls, checked against the player's own words --------------
//
// The host now calls `play_move` with the player's words, and a tool call is
// a model output, not evidence: "purple banana forty seven?" once became a
// 47-chip raise because the model was free to invent the arguments. So the
// table plays a move only when the player's OWN words, heard at this point in
// the hand, contain that very move. The same rule is what stops a bet landing
// twice: once a move lands, the table has moved on, and the words that asked
// for it belong to the hand as it was.

/** Two readings name the same move (a raise only with the same amount). */
export function sameMove(a: ParsedMove | null, b: ParsedMove | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind !== 'raise' || b.kind !== 'raise') return true;
  return a.amount === b.amount;
}

/**
 * Whether the player's own lines contain this move. Each line is read on its
 * own and all of them together: a recogniser can split "raise to" from "sixty".
 */
export function backs(move: ParsedMove, lines: readonly string[]): boolean {
  const said = lines.map((l) => l.trim()).filter(Boolean);
  if (!said.length) return false;
  const runOn = said.map((l) => l.replace(/[.!;,]+$/, '')).join(' ');
  return [...said, said.join(' '), runOn].some((text) => sameMove(parseTurn(text).move, move));
}

/** The safety net's actions: safe to do twice, and never a move. */
export type NetAction = 'deal_hand' | 'new_match' | 'read_my_cards' | 'show_hand_rankings';

// Asking for a hand, narrower than NEW_HAND: "what's the deal with the
// blinds?" between hands would otherwise deal one.
const DEAL = /^(?:ok(?:ay)?,? |alright,? |right,? )?deal\b|\bdeal (?:me|us|them|'?em|again|it|another|the next)\b|\b(?:new|next|another) hand\b|\bone more hand\b/;
// Asking what beats what. Live, Dex recited the rankings and offered the
// chart instead of opening it; opening it twice changes nothing.
const RANKINGS = /\bwhat beats what\b|\bhand rankings?\b|\brankings\b|\bwhich hands? (?:beats?|wins?|is better)\b|\bwhat(?:'s| is) the best hand\b|\bwhat hands? beats?\b|\bshow (?:me )?the (?:chart|rankings?)\b/;
const REMATCH = /\b(?:rematch|new match|another match|play (?:it )?again|run it back)\b/;

/**
 * The table action the player's words clearly ask for, among those safe to
 * repeat: a second deal or rematch is refused while a hand is in play, and
 * reading their cards or opening the rankings chart twice costs nothing. Moves are never here: a bet the
 * net played on top of the host's would be a bet applied twice.
 */
export function mustDo(text: string): NetAction | null {
  const t = (text ?? '').trim().toLowerCase().replace(/[’]/g, "'");
  if (!t) return null;
  if (REMATCH.test(t)) return 'new_match';
  if (DEAL.test(t)) return 'deal_hand';
  if (parseTurn(t).asksOwnCards) return 'read_my_cards';
  if (RANKINGS.test(t)) return 'show_hand_rankings';
  return null;
}
