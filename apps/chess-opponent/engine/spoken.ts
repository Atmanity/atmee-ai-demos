// Deciding whether the player just stated a move. Ported from spoken.py.
//
// Playing a move must not depend on a model choosing to: typing "e4" once got
// a paragraph about how principled e4 is while the board sat at the start. A
// move is a deterministic thing and belongs on a deterministic path, so every
// utterance is checked here and, if it reads as a move, handed to the BOARD
// (game.ts), which resolves it against the real position.
//
// This gate is the only defence against playing a move the player never
// committed to, and there is no takeback, so it refuses anything that reads
// as a question, a musing or a sentence. A false negative costs one
// repetition; a false positive costs the game. It does accept "play e4" and
// "the e pawn to e4", because that is how people talk, and the resolver keeps
// that promise by reading a move out of such a sentence (narrowly).

/** Words that turn a move into a question or a hypothetical. Their presence is enough to refuse. */
export const HEDGES = new Set([
  'should', 'shall', 'could', 'would', 'can', 'may', 'might', 'what', 'why',
  'how', 'when', 'who', 'which', 'if', 'maybe', 'perhaps', 'think', 'thinking',
  'about', 'instead', 'consider', 'wondering', 'wonder', 'suppose', 'guess',
  'advice', 'advise', 'suggest', 'recommend', 'better', 'worse', 'good', 'bad',
  'vs', 'versus', 'or', "why's", 'whats', 'dont', 'don', 'not', 'never',
  'wanted', 'planning', 'idea', 'ok', 'okay', 'yes', 'no', 'sure', 'thanks',
]);

/** A move is a handful of words at most: "e4", "knight to f3", "pawn e2 to e4". Longer is a sentence. */
const MAX_WORDS = 6;

const WORD_RE = /[a-z0-9'-]+/g;

/**
 * Speech recognition writes ranks as words far more often than as digits:
 * "e four" is what comes back for "e4" most of the time.
 */
const SPELLED_RANKS: Record<string, string> = {
  one: '1', won: '1', two: '2', too: '2', to: '2', three: '3',
  tree: '3', four: '4', for: '4', fore: '4', five: '5', six: '6',
  sicks: '6', seven: '7', eight: '8', ate: '8',
};
const SPELLED = new RegExp(
  String.raw`\b([a-h])\s+(${Object.keys(SPELLED_RANKS).sort((a, b) => b.length - a.length).join('|')})\b`,
  'g',
);

/**
 * "e four" -> "e4". Only where a file letter precedes the word, so "two moves
 * ago" and "for the centre" are left alone: the homophones ("to", "for",
 * "won") make an unconditional swap dangerous.
 */
export function despellRanks(text: unknown): string {
  return String(text ?? '').toLowerCase().replace(SPELLED, (_m, file: string, word: string) => file + SPELLED_RANKS[word]);
}

/** True when `text` reads as the player stating their own move. Conservative on purpose. */
export function looksLikeMoveStatement(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const raw = text.trim();
  if (!raw) return false;

  // SAN carries its own punctuation ("Nf3!", "Qxd5+", "e8=Q#"), so it is
  // checked before the question guard.
  if (isBareSan(raw) || isBareSan(despellRanks(raw))) return true;
  if (raw.includes('?')) return false;
  // More than one clause is a sentence, not a move.
  if ([',', ';', ':', '.', '!'].some((mark) => raw.includes(mark)) && !isBareSan(raw)) return false;

  const words = despellRanks(raw).match(WORD_RE) ?? [];
  if (!words.length || words.length > MAX_WORDS) return false;
  if (words.some((word) => HEDGES.has(word))) return false;

  // Must name a square or a castle, or "your turn" and "nice one" sail through.
  const joined = words.join(' ');
  if (/\b[a-h][1-8]\b/.test(joined)) return true;
  if (/castl|\b0-0\b|\bo-o\b/.test(joined)) return true;
  return false;
}

/** SAN with its own punctuation: "Nf3!", "Qxd5+", "e8=Q#", "O-O". */
function isBareSan(raw: string): boolean {
  const stripped = raw.trim();
  if (/^[Oo0]-?[Oo0](-?[Oo0])?[+#!?]*$/.test(stripped)) return true;
  return /^[KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?[+#!?]*$/.test(stripped);
}
