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

/**
 * The "pieces you have lost, and by how much" strip in a player row.
 *
 * Empty renders NOTHING. It used to print "Lost —" from the first move of the
 * game, which on the top row collided with the mute button and bought this
 * panel a padding hack; a row that says "nothing has been captured" in two
 * glyphs is noise standing where a real signal will go. "Lost" survives as the
 * strip's accessible name, which is where it was doing its actual work.
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
    <div
      className={`chess-captured chess-captured--${capturedColor === "w" ? "white" : "black"}`}
      role="group"
      aria-label={`${label} pieces`}
    >
      {sorted.map((type, index) => (
        <span key={`${type}-${index}`} className="chess-captured__piece">
          {pieceGlyph(type, capturedColor)}
        </span>
      ))}
      {lead && (
        <span className="chess-captured__advantage" title={lead.title}>
          <span className="chess-captured__advantage-value">{lead.value}</span>
          <span className="chess-captured__advantage-unit">{lead.unit}</span>
        </span>
      )}
    </div>
  );
}
