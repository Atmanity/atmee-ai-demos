/**
 * The two things the panel says under the board in a sentence: a refusal and
 * a result. They are NOT the same thing and used to be the same box.
 *
 * Three faults are fixed here, and all three were the panel losing something
 * the player needed:
 *
 * 1. `message || resultLine` meant a refusal arriving after the game ended
 *    silently REPLACED the result — the one sentence the game exists to
 *    produce. They are separate notices now and both can stand.
 * 2. `result.reason` was never rendered anywhere, so a bare "Draw." never
 *    explained itself and the fifty-move rule looked like a bug.
 * 3. A refusal only ever reached this panel from a PANEL-originated intent.
 *    A move said out loud and refused changed zero pixels. The agent now puts
 *    `last_refusal` on the snapshot (cleared by the next accepted move), so a
 *    spoken refusal and an illegal drag arrive through the same door.
 */
import type { GameEndReason, GameResultWinner } from "../engine/types.ts";

/** A refusal as the agent's snapshot carries it. Absent on older payloads. */
export interface SnapshotRefusal {
  move?: string | null;
  reason?: string | null;
}

export interface Notice {
  kind: "result" | "refusal";
  /** The sentence itself. */
  text: string;
  /** The quieter second line: the reason, or the move that was refused. */
  detail?: string;
}

/** "You win." / "<opponent> wins." / "Draw." — never only a status word. */
export function resultSentence(
  winner: GameResultWinner,
  opponentName: string,
): string {
  if (winner === "agent") return `${opponentName} wins.`;
  if (winner === "opponent") return "You win.";
  return "Draw.";
}

/**
 * Why the game ended, in a player's words rather than a snapshot enum.
 *
 * "Draw." on its own is the panel refusing to explain itself, and the three
 * drawing rules are precisely the ones a casual player does not know.
 */
export function resultReasonLine(reason: GameEndReason | null): string {
  switch (reason) {
    case "checkmate":
      return "Checkmate — the king is attacked and cannot escape.";
    case "stalemate":
      return "Stalemate — no legal move, but the king is not in check.";
    case "insufficient_material":
      return "Neither side has enough material left to force mate.";
    case "threefold_repetition":
      return "The same position came up three times.";
    case "fifty_moves":
      return "Fifty moves passed with no capture and no pawn move.";
    case "resignation":
      return "The game ended by resignation.";
    default:
      return "";
  }
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Turn a snapshot refusal, plus whatever the last panel-originated intent was
 * refused with, into one refusal notice.
 *
 * The local message wins when both exist: it is the freshest thing this panel
 * knows, and after a drag it is the same refusal anyway.
 */
export function refusalNotice(
  localMessage: string,
  snapshotRefusal: SnapshotRefusal | null | undefined,
): Notice | null {
  const local = clean(localMessage);
  if (local) return { kind: "refusal", text: local };
  const reason = clean(snapshotRefusal?.reason);
  if (!reason) return null;
  const move = clean(snapshotRefusal?.move);
  return {
    kind: "refusal",
    text: reason,
    detail: move ? `Heard as “${move}”.` : undefined,
  };
}

export interface NoticeInputs {
  localMessage: string;
  snapshotRefusal: SnapshotRefusal | null | undefined;
  result: { winner: GameResultWinner; reason: GameEndReason } | null;
  opponentName: string;
}

/**
 * Every notice to draw, in reading order.
 *
 * The result comes first and is never displaced: a refusal is about one move,
 * the result is about the whole game.
 */
export function noticesFor(input: NoticeInputs): Notice[] {
  const notices: Notice[] = [];
  if (input.result) {
    notices.push({
      kind: "result",
      text: resultSentence(input.result.winner, input.opponentName),
      detail: resultReasonLine(input.result.reason) || undefined,
    });
  }
  const refusal = refusalNotice(input.localMessage, input.snapshotRefusal);
  if (refusal) notices.push(refusal);
  return notices;
}
