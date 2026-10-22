/**
 * Captured material, for the two player rows — derived from the FEN.
 *
 * This is VIEW state: recomputed from the authoritative snapshot, stored
 * nowhere. Counting what is missing from the board against the starting set
 * needs no rules engine, which is what let chess.js leave the panel entirely.
 * (Promotions skew a piece-by-piece diff, so the count is clamped at zero per
 * type and the ADVANTAGE is computed from total point values, which stays
 * honest through promotion.)
 */

export type PieceColor = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

export interface CapturedSnapshot {
  /** Pieces captured BY White, i.e. black pieces taken. */
  byWhite: PieceType[];
  /** Pieces captured BY Black. */
  byBlack: PieceType[];
  /** Material lead of whichever side is ahead, always positive. */
  advantage: number;
  advantageColor: PieceColor | null;
}

const PIECE_VALUES: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_ORDER: PieceType[] = ["q", "r", "b", "n", "p"];
const STARTING_COUNTS: Record<PieceType, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };

const WHITE_GLYPHS: Record<PieceType, string> = {
  p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔",
};
const BLACK_GLYPHS: Record<PieceType, string> = {
  p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚",
};

export function pieceGlyph(type: PieceType, color: PieceColor): string {
  return color === "w" ? WHITE_GLYPHS[type] : BLACK_GLYPHS[type];
}

function countPieces(fen: string): Record<PieceColor, Record<PieceType, number>> {
  const placement = fen.split(" ")[0] ?? "";
  const counts: Record<PieceColor, Record<PieceType, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  };
  for (const ch of placement) {
    const lower = ch.toLowerCase() as PieceType;
    if (!(lower in PIECE_VALUES)) continue;
    counts[ch === lower ? "b" : "w"][lower] += 1;
  }
  return counts;
}

export function computeCaptured(fen: string): CapturedSnapshot {
  const onBoard = countPieces(fen);
  const byWhite: PieceType[] = []; // black pieces missing
  const byBlack: PieceType[] = []; // white pieces missing
  let whitePoints = 0;
  let blackPoints = 0;
  for (const type of Object.keys(PIECE_VALUES) as PieceType[]) {
    const blackMissing = Math.max(0, STARTING_COUNTS[type] - onBoard.b[type]);
    const whiteMissing = Math.max(0, STARTING_COUNTS[type] - onBoard.w[type]);
    for (let i = 0; i < blackMissing; i++) byWhite.push(type);
    for (let i = 0; i < whiteMissing; i++) byBlack.push(type);
    whitePoints += onBoard.w[type] * PIECE_VALUES[type];
    blackPoints += onBoard.b[type] * PIECE_VALUES[type];
  }
  if (whitePoints > blackPoints)
    return { byWhite, byBlack, advantage: whitePoints - blackPoints, advantageColor: "w" };
  if (blackPoints > whitePoints)
    return { byWhite, byBlack, advantage: blackPoints - whitePoints, advantageColor: "b" };
  return { byWhite, byBlack, advantage: 0, advantageColor: null };
}

/**
 * The lead to show on ONE row: the row belonging to the side that is ahead,
 * and zero for the other.
 *
 * This existed only as an inline ternary, and it was inverted on both rows:
 * the agent's row was given the advantage when `advantageColor === user`. At
 * game over the top row read "<opponent> · Lost · ♟ +1" while the USER was
 * the pawn up — the panel stating something false about the one number a
 * player checks mid-game. It is a function now because it is testable.
 */
export function advantageForSide(
  captured: CapturedSnapshot,
  side: PieceColor,
): number {
  return captured.advantageColor === side ? captured.advantage : 0;
}

export interface AdvantageLabel {
  /** "+3" — what the eye reads. */
  value: string;
  /** "pawns" — the unit, which was missing entirely. */
  unit: string;
  /** The long form, for `title` and assistive tech. */
  title: string;
}

/**
 * "+3" is not a score and not a game total; it is three pawns of material,
 * right now. Without the unit it reads as points, which is the one thing the
 * brief says it must not be mistaken for.
 */
export function advantageLabel(advantage: number): AdvantageLabel | null {
  if (!(advantage > 0)) return null;
  const unit = advantage === 1 ? "pawn" : "pawns";
  return {
    value: `+${advantage}`,
    unit,
    title: `${advantage} ${unit} of material ahead right now`,
  };
}

/** Group by type, heaviest first, so the row does not reshuffle as it grows. */
export function sortPiecesForDisplay(pieces: PieceType[]): PieceType[] {
  const counts: Record<PieceType, number> = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
  for (const piece of pieces) counts[piece] += 1;
  const out: PieceType[] = [];
  for (const type of PIECE_ORDER) {
    for (let i = 0; i < counts[type]; i++) out.push(type);
  }
  return out;
}
