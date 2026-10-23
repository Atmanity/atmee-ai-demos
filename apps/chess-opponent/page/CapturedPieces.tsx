import {
  advantageLabel,
  pieceGlyph,
  sortPiecesForDisplay,
  type PieceColor,
  type PieceType,
} from "./captured.ts";

interface CapturedPiecesProps {
  pieces: PieceType[];
  capturedColor: PieceColor;
  advantage?: number;
  label?: string;
}

/** Text presentation: some systems draw the black pawn as a colour emoji without it. */
const TEXT = "︎";

/**
 * The "pieces you have lost, and by how much" strip in a player row. Empty
 * renders NOTHING: a row that says "nothing has been captured" in two glyphs
 * is noise standing where a real signal will go.
 */
export function CapturedPieces({
  pieces,
  capturedColor,
  advantage = 0,
  label = "Lost",
}: CapturedPiecesProps) {
  const sorted = sortPiecesForDisplay(pieces);
  const lead = advantageLabel(advantage);
  if (sorted.length === 0 && !lead) return null;
  return (
    <span
      className={`kb-captured is-${capturedColor === "w" ? "white" : "black"}`}
      role="group"
      aria-label={`${label} pieces`}
    >
      {sorted.map((type, index) => (
        <span key={`${type}-${index}`} className="kb-captured-piece">
          {pieceGlyph(type, capturedColor) + TEXT}
        </span>
      ))}
      {lead && (
        <span className="kb-captured-lead" title={lead.title}>
          {lead.value} <small>{lead.unit}</small>
        </span>
      )}
    </span>
  );
}
