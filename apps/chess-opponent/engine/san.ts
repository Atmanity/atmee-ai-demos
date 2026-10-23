// Reading SAN and UCI against the board's legal moves, the way python-chess's
// parse_san / parse_uci do. The original resolver was written against those
// semantics, and they differ from chess.js's own lenient move() in the places
// that matter here: an ambiguous "Nd2" is an error to ASK about (chess.js
// would quietly pick a knight), "e4" never means "dxe4" (a pawn capture must
// name its file), and "Kg1" is not a castle. So the board's legal list comes
// from chess.js, and this decides which of those moves some words name.
import type { Move as BoardMove } from 'chess.js';

/** Not SAN/UCI at all (python-chess's InvalidMoveError). */
export class InvalidNotation extends Error {}
/** Well-formed, but not a legal move here (IllegalMoveError). */
export class IllegalNotation extends Error {}
/** Well-formed and legal for more than one piece (AmbiguousMoveError). */
export class AmbiguousNotation extends Error {}

const SAN_RE = /^([NBKRQ])?([a-h])?([1-8])?[-x]?([a-h][1-8])(=?[nbrqkNBRQK])?[+#]?$/;
const KINGSIDE = new Set(['O-O', 'O-O+', 'O-O#', '0-0', '0-0+', '0-0#']);
const QUEENSIDE = new Set(['O-O-O', 'O-O-O+', 'O-O-O#', '0-0-0', '0-0-0+', '0-0-0#']);
const BACK_RANKS = /[18]$/;

const isCastle = (m: BoardMove) => m.isKingsideCastle() || m.isQueensideCastle();

export function parseSan(legal: readonly BoardMove[], san: string): BoardMove {
  if (KINGSIDE.has(san) || QUEENSIDE.has(san)) {
    const castle = legal.find((m) => (KINGSIDE.has(san) ? m.isKingsideCastle() : m.isQueensideCastle()));
    if (!castle) throw new IllegalNotation(`illegal san: ${san}`);
    return castle;
  }
  const match = SAN_RE.exec(san);
  if (!match) throw new InvalidNotation(`invalid san: ${san}`);
  const [, piece, file, rank, to, promo] = match;
  const promotion = promo ? promo.slice(-1).toLowerCase() : undefined;

  if (!piece && file && rank) {
    // Fully specified ("e2e4", "g1f3"): allowed even for pieces, castling included.
    const found = legal.find((m) => m.from === file + rank && m.to === to && (m.promotion ?? undefined) === (promotion ?? (m.piece === 'p' && BACK_RANKS.test(to) ? 'q' : undefined)));
    if (!found) throw new IllegalNotation(`illegal san: ${san}`);
    // A pawn reaching the back rank must say what it becomes.
    if ((found.promotion ?? undefined) !== promotion) throw new IllegalNotation(`missing promotion piece type: ${san}`);
    return found;
  }

  const candidates = legal.filter((m) => {
    if (m.to !== to || isCastle(m)) return false;
    if (file && m.from[0] !== file) return false;
    if (rank && m.from[1] !== rank) return false;
    if (piece) return m.piece === piece.toLowerCase();
    // A pawn move; and a pawn capture must name the file it came from.
    return m.piece === 'p' && (file ? true : m.from[0] === to[0]);
  }).filter((m) => (m.promotion ?? undefined) === promotion);

  if (candidates.length > 1) throw new AmbiguousNotation(`ambiguous san: ${san}`);
  if (!candidates.length) throw new IllegalNotation(`illegal san: ${san}`);
  return candidates[0];
}

export function parseUci(legal: readonly BoardMove[], uci: string): BoardMove {
  if (!/^[a-h][1-8][a-h][1-8][pnbrqk]?$/.test(uci) || uci.slice(0, 2) === uci.slice(2, 4)) {
    throw new InvalidNotation(`invalid uci: ${uci}`);
  }
  const found = legal.find((m) => m.lan === uci);
  if (!found) throw new IllegalNotation(`illegal uci: ${uci}`);
  return found;
}
