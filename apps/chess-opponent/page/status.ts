/**
 * Whose move it is, in words and in weight — the panel's first job.
 *
 * The brief's bar is "first landing point: the board, and immediately under
 * it, whose move it is". Both rows used to render their status at 12px in the
 * same muted grey, so "Your move" and "Waiting" were indistinguishable at a
 * glance and only the agent's "Thinking…" carried the accent. The TEXT is
 * decided here (pure, tested); the WEIGHT is the `tone` this returns, which
 * the stylesheet turns into a pill.
 *
 * Check is decided here too. `in_check` was only ever used to fire a sound,
 * so a player who had muted the panel — the default — was never told in words
 * that their king was attacked. `in_check` describes the side to MOVE, so the
 * word lands on whichever row is active.
 */
import type { GameResultWinner } from "../engine/types.ts";

/** How much visual weight a row's status earns. */
export type StatusTone = "active" | "thinking" | "idle" | "result";

export interface RowStatus {
  text: string;
  tone: StatusTone;
}

export interface StatusInputs {
  /** `phase === "game-over"`. */
  over: boolean;
  /** The snapshot's `turn`. */
  turn: "user" | "agent" | null;
  /** The snapshot's `in_check` — always about the side to move. */
  inCheck: boolean;
  /** The snapshot's `result.winner`, if the game has one. */
  winner: GameResultWinner | null;
}

/** The word a finished game leaves on a row, from that row's point of view. */
function outcomeFor(
  winner: GameResultWinner | null,
  row: "user" | "agent",
): string {
  if (winner === "draw") return "Draw";
  if (winner === null) return "Game over";
  const wonIt = row === "agent" ? winner === "agent" : winner === "opponent";
  return wonIt ? "Won" : "Lost";
}

/**
 * The status for both player rows.
 *
 * After a result both rows say what HAPPENED: "Waiting" under a finished game
 * is a status for a turn that is never coming, which is the panel lying.
 */
export function playerStatuses(input: StatusInputs): {
  user: RowStatus;
  agent: RowStatus;
} {
  if (input.over) {
    return {
      user: { text: outcomeFor(input.winner, "user"), tone: "result" },
      agent: { text: outcomeFor(input.winner, "agent"), tone: "result" },
    };
  }
  const idle: RowStatus = { text: "Waiting", tone: "idle" };
  const check = input.inCheck ? " — check" : "";
  if (input.turn === "user") {
    return { user: { text: `Your move${check}`, tone: "active" }, agent: idle };
  }
  if (input.turn === "agent") {
    return {
      user: idle,
      agent: { text: `Thinking…${check}`, tone: "thinking" },
    };
  }
  return { user: idle, agent: idle };
}

/**
 * Which board ring to draw: the player's own turn gets the accent, the
 * opponent's a desaturated one, a finished game none.
 */
export function boardTurnState(input: {
  over: boolean;
  turn: "user" | "agent" | null;
}): "yours" | "theirs" | "over" | "none" {
  if (input.over) return "over";
  if (input.turn === "user") return "yours";
  if (input.turn === "agent") return "theirs";
  return "none";
}
