// Choosing the opponent's move, from the board's own legal list. Ported from
// engine.py, which exists because the in-call bundle could not ship Stockfish.
//
// It is a one-ply heuristic: material, piece-square tables, checks, castling
// and promotions, plus a cheap "would this hang?" check. It does not search,
// and it sees mate-in-one only when the SAN is already marked `#`. Against a
// club player it will lose pieces to two-move tactics. That is the accepted
// trade, and it is why the avatar is told it looks one move ahead rather than
// that it plays "at a strong level": nothing may claim a strength this file
// does not have.
//
// Two properties hold regardless of strength:
// - The chosen move is an element of the list handed in (identity, not a
//   rebuilt copy), so an illegal move cannot be constructed even in principle.
// - It is deterministic given its seed: same position, same list, same seed,
//   same move. The seed only reorders moves the heuristic scored EQUAL.
//
// The model is deliberately NOT asked to choose: it played weak and
// occasionally nonsense moves. It does the commentary instead.
//
// Pure: no chess library, no I/O, no framework.

/** Centipawns. The king's value is nominal: it is never captured, but it attacks and needs a number. */
export const PIECE_VALUES: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

export const MATE_BONUS = 1_000_000;
export const CHECK_BONUS = 45;
export const CASTLE_BONUS = 60;

const FILES = 'abcdefgh';

// Piece-square tables (the classic simplified-evaluation set), from White's
// point of view in reading order: index 0 is a8, 63 is h1. Black reads them
// mirrored. They make the heuristic develop pieces instead of shuffling a rook.
const PST_PAWN = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
];
const PST_KNIGHT = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];
const PST_BISHOP = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
];
const PST_ROOK = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, 10, 10, 10, 10, 5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0,
];
const PST_QUEEN = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5,
  -10, 5, 5, 5, 5, 5, 0, -10,
  -10, 0, 5, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20,
];
const PST_KING = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20,
];

export const PIECE_SQUARE_TABLES: Record<string, number[]> = {
  p: PST_PAWN, n: PST_KNIGHT, b: PST_BISHOP, r: PST_ROOK, q: PST_QUEEN, k: PST_KING,
};

const KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_STEPS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
const DIAGONALS = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
const ORTHOGONALS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

// ---------------------------------------------------------------------------
// squares and the board

/** "e4" -> the reading-order index the piece-square tables use, or null. */
export function squareToIndex(square: unknown): number | null {
  if (typeof square !== 'string' || square.length !== 2) return null;
  const file = FILES.indexOf(square[0]);
  if (file < 0 || !/[0-9]/.test(square[1])) return null;
  const rank = Number(square[1]);
  if (rank < 1 || rank > 8) return null;
  return (8 - rank) * 8 + file;
}

/** "e4" -> [file, rank], both 0-based, a1 = [0, 0]. */
export function squareToCoords(square: string): [number, number] | null {
  const index = squareToIndex(square);
  if (index === null) return null;
  return [index % 8, 7 - Math.floor(index / 8)];
}

export function coordsToSquare(file: number, rank: number): string | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${FILES[file]}${rank + 1}`;
}

type Colour = 'w' | 'b';
type Placed = [Colour, string];
export type Pieces = Map<string, Placed>;

/**
 * Just enough of a position to score a move: what stands where, and whose
 * moves these are. No legality here; the moves handed in are already legal.
 */
export interface Position {
  pieces: Pieces;
  turn: Colour;
}

export const EMPTY_POSITION: Position = { pieces: new Map(), turn: 'w' };

/**
 * A FEN as a Position, or null when it is not one. Null rather than a throw:
 * a malformed position is a reason to fall back to notation-only scoring,
 * not to fail the opponent's turn and freeze the board.
 */
export function parseFen(fen: unknown): Position | null {
  if (typeof fen !== 'string' || !fen.trim()) return null;
  const fields = fen.trim().split(/\s+/);
  const rows = fields[0].split('/');
  if (rows.length !== 8) return null;
  const pieces: Pieces = new Map();
  for (let row = 0; row < 8; row++) {
    let file = 0;
    for (const ch of rows[row]) {
      if (/[0-9]/.test(ch)) {
        file += Number(ch);
        continue;
      }
      if (!(ch.toLowerCase() in PIECE_VALUES)) return null;
      const square = coordsToSquare(file, 7 - row);
      if (square === null) return null;
      pieces.set(square, [ch === ch.toUpperCase() ? 'w' : 'b', ch.toLowerCase()]);
      file += 1;
    }
    if (file !== 8) return null;
  }
  const turn = fields[1] === 'w' || fields[1] === 'b' ? fields[1] : 'w';
  return { pieces, turn };
}

export function pieceSquareValue(piece: string, colour: Colour, square: string): number {
  const table = PIECE_SQUARE_TABLES[piece];
  let index = squareToIndex(square);
  if (!table || index === null) return 0;
  // Mirror vertically: a8 for White reads as a1 for Black.
  if (colour === 'b') index = (7 - Math.floor(index / 8)) * 8 + (index % 8);
  return table[index];
}

// ---------------------------------------------------------------------------
// who is hitting what

/**
 * Piece letters of every `colour` piece attacking `square`. Pseudo-legal on
 * purpose (a pinned defender still counts): slightly too cautious costs a
 * heuristic nothing; too optimistic hangs a queen.
 */
export function attackersOf(pieces: Pieces, square: string, colour: Colour): string[] {
  const coords = squareToCoords(square);
  if (!coords) return [];
  const [file, rank] = coords;
  const found: string[] = [];
  const is = (sq: string | null, letter: string) => {
    if (!sq) return false;
    const p = pieces.get(sq);
    return Boolean(p && p[0] === colour && p[1] === letter);
  };

  // Pawns capture forwards, so a WHITE pawn attacking `square` sits one rank
  // below it. Getting this backwards is the classic way to walk into a pawn.
  const pawnRank = colour === 'w' ? rank - 1 : rank + 1;
  for (const df of [-1, 1]) if (is(coordsToSquare(file + df, pawnRank), 'p')) found.push('p');
  for (const [df, dr] of KNIGHT_STEPS) if (is(coordsToSquare(file + df, rank + dr), 'n')) found.push('n');
  for (const [df, dr] of KING_STEPS) if (is(coordsToSquare(file + df, rank + dr), 'k')) found.push('k');

  for (const [rays, sliders] of [[DIAGONALS, ['b', 'q']], [ORTHOGONALS, ['r', 'q']]] as const) {
    for (const [df, dr] of rays) {
      for (let step = 1; ; step++) {
        const origin = coordsToSquare(file + df * step, rank + dr * step);
        if (origin === null) break;
        const occupant = pieces.get(origin);
        if (occupant) {
          if (occupant[0] === colour && (sliders as readonly string[]).includes(occupant[1])) found.push(occupant[1]);
          break;
        }
      }
    }
  }
  return found;
}

const cheapest = (letters: string[]) => (letters.length ? Math.min(...letters.map((l) => PIECE_VALUES[l] ?? 0)) : 0);

// ---------------------------------------------------------------------------
// one move, scored

/** A legal move exactly as the board described it; `raw` is the board's own object, handed back untouched. */
export interface Move {
  san: string;
  uci: string;
  raw: unknown;
}

const origin = (m: Move) => m.uci.slice(0, 2);
const destination = (m: Move) => m.uci.slice(2, 4);
const promotion = (m: Move) => m.uci.slice(4, 5).toLowerCase();

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The board's legal-move list, with anything unusable dropped. A dropped
 * entry is a move the opponent will not consider (harmless); an accepted
 * malformed one is a move the board cannot apply (a stalled game).
 */
export function parseMoves(legalMoves: unknown): Move[] {
  if (!Array.isArray(legalMoves)) return [];
  const moves: Move[] = [];
  for (const entry of legalMoves) {
    if (!isPlainObject(entry)) continue;
    const { san, uci } = entry;
    if (typeof san !== 'string' || !san.trim()) continue;
    if (typeof uci !== 'string' || (uci.length !== 4 && uci.length !== 5)) continue;
    if (squareToIndex(uci.slice(0, 2)) === null || squareToIndex(uci.slice(2, 4)) === null) continue;
    moves.push({ san: san.trim(), uci: uci.trim().toLowerCase(), raw: entry });
  }
  return moves;
}

const PIECE_NAMES: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

/** Short labels for the commentary, never for the choice itself. */
export function moveTags(position: Position, move: Move): string[] {
  const tags: string[] = [];
  if (move.san.includes('#')) tags.push('checkmate');
  else if (move.san.includes('+')) tags.push('check');
  if (move.san.startsWith('O-O-O')) tags.push('castle_queenside');
  else if (move.san.startsWith('O-O')) tags.push('castle_kingside');
  if (capturedValue(position, move) > 0) tags.push('capture');
  if (promotion(move)) tags.push('promotion');
  const mover = position.pieces.get(origin(move));
  if (mover) tags.push(PIECE_NAMES[mover[1]]);
  return tags;
}

/** Centipawns won by the capture, if the move is one. */
function capturedValue(position: Position, move: Move): number {
  const target = position.pieces.get(destination(move));
  if (target && target[0] !== position.turn) return PIECE_VALUES[target[1]] ?? 0;
  const mover = position.pieces.get(origin(move));
  // En passant: a pawn moving diagonally onto an empty square took something.
  if (mover && mover[1] === 'p' && origin(move)[0] !== destination(move)[0] && !target) return PIECE_VALUES.p;
  return 0;
}

/**
 * The board after the move, approximately: castling moves only the king and
 * en passant leaves the captured pawn, because neither changes what attacks
 * the destination square, which is the only question asked of this.
 */
function piecesAfter(position: Position, move: Move): Pieces {
  const pieces = new Map(position.pieces);
  const mover = pieces.get(origin(move));
  if (!mover) return pieces;
  pieces.delete(origin(move));
  const [colour, letter] = mover;
  pieces.set(destination(move), [colour, promotion(move) in PIECE_VALUES && promotion(move) ? promotion(move) : letter]);
  return pieces;
}

/**
 * Centipawns the move risks on its destination, signed: what we take, minus
 * what we lose if they take back, plus the cheapest thing we take back with.
 * One exchange deep, no search: enough to stop parking a queen where a pawn
 * hits it, and declining a free piece.
 *
 * The one deliberate change from engine.py: the exchange can only COST us.
 * The original returned `gained - atRisk + recapture` unclamped, so a pawn
 * the enemy queen could take "and lose to our rook" scored +800, and the
 * full-strength opponent answered 1.e4 with 1...h5 (and 2.Nf3 with 2...a6,
 * baiting the bishop). The Python original does exactly that on the same
 * position; no opponent makes a capture that loses it material, so the
 * exchange is worth at most nothing to us.
 */
export function exchangeOutlook(position: Position, move: Move): number {
  const mover = position.pieces.get(origin(move));
  if (!mover) return 0;
  const [us, letter] = mover;
  const them: Colour = us === 'w' ? 'b' : 'w';
  const gained = capturedValue(position, move);
  const after = piecesAfter(position, move);
  const enemy = attackersOf(after, destination(move), them);
  if (!enemy.length) return gained;
  const atRisk = PIECE_VALUES[promotion(move) || letter] ?? 0;
  const ours = attackersOf(after, destination(move), us);
  const recapture = ours.length ? cheapest(enemy) : 0;
  return gained + Math.min(0, recapture - atRisk);
}

/** How much the opponent likes this move. Higher is better; pure and total. */
export function scoreMove(position: Position, move: Move): number {
  // Mate ends the game: nothing else on the board can outweigh it.
  if (move.san.includes('#')) return MATE_BONUS;
  let score = 0;
  if (move.san.includes('+')) score += CHECK_BONUS;
  if (move.san.startsWith('O-O')) score += CASTLE_BONUS;
  const promo = promotion(move);
  if (promo && promo in PIECE_VALUES) score += PIECE_VALUES[promo] - PIECE_VALUES.p;
  const mover = position.pieces.get(origin(move));
  if (mover) {
    const [colour, letter] = mover;
    score += pieceSquareValue(letter, colour, destination(move));
    score -= pieceSquareValue(letter, colour, origin(move));
  }
  // Material dominates positional terms: a free rook outweighs every
  // piece-square bonus on the board put together, which is the point.
  return score + exchangeOutlook(position, move);
}

/** The move the opponent plays, and why (for the commentary). */
export interface Choice {
  move: Move;
  score: number;
  tags: string[];
  san: string;
  uci: string;
}

/**
 * The order two moves the heuristic CANNOT SEPARATE are considered in.
 * Without a seed it is the SAN itself (total, identical every session). With
 * one it is a stable 64-bit digest of (seed, san): stable across runs, so a
 * reported game replays from its seed. It only ever reorders EQUAL scores.
 *
 * The original used blake2b; this is FNV-1a with a murmur finaliser, because
 * the page has no synchronous hash. Same contract, different digests.
 */
export function tieBreak(seed: unknown, san: string): string {
  if (seed === null || seed === undefined) return san;
  const MASK = 0xffffffffffffffffn;
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(`${seed}:${san}`)) {
    h ^= BigInt(byte);
    h = (h * 0x100000001b3n) & MASK;
  }
  h ^= h >> 33n;
  h = (h * 0xff51afd7ed558ccdn) & MASK;
  h ^= h >> 33n;
  h = (h * 0xc4ceb9fe1a85ec53n) & MASK;
  h ^= h >> 33n;
  return h.toString(16).padStart(16, '0');
}

/**
 * Pick one of `legalMoves`, or null when there is nothing usable to pick
 * (a finished game or a malformed list). The caller reports that rather than
 * inventing a move.
 *
 * `rank` is how far down its OWN ordering the opponent plays, and it is the
 * whole of the difficulty setting: 0 is its favourite, 2 its third choice, 5
 * its sixth. A worse move it already ranked keeps every promise above, where a
 * "make a mistake" rule would have had to invent one. Mate is exempt: a
 * beginner setting that declines mate-in-one is not easier, it is broken.
 *
 * `seed` decides only which of several EQUALLY scored moves is played, so the
 * same opening does not replay the same game move for move.
 */
export function chooseMove(fen: unknown, legalMoves: unknown, rank = 0, seed: unknown = null): Choice | null {
  const moves = parseMoves(legalMoves);
  if (!moves.length) return null;
  // No position: score on notation alone (mate, check, castling, promotion).
  const position = parseFen(fen) ?? EMPTY_POSITION;
  const scored = moves.map((move) => ({ move, score: scoreMove(position, move), key: tieBreak(seed, move.san) }));
  scored.sort((a, b) => (b.score - a.score) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let pick = scored[0];
  if (pick.score < MATE_BONUS && rank > 0) pick = scored[Math.min(rank, scored.length - 1)];
  return { move: pick.move, score: pick.score, tags: moveTags(position, pick.move), san: pick.move.san, uci: pick.move.uci };
}
