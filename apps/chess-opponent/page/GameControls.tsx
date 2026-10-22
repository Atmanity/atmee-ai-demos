import { useEffect, useState } from "react";

import type { ChessSnapshot, Side, Strength } from "../engine/types.ts";
import type { Intent } from "./ChessGame.tsx";

/**
 * The controls the original left to voice alone: which side you play, how
 * hard the opponent tries, resigning, and starting over mid-game.
 *
 * Anything that throws a game in progress away (a side swap, a resignation,
 * a new game) asks for a second press: there is no takeback on this board.
 * The difficulty takes effect from the opponent's next move and loses
 * nothing, so it acts at once.
 */
type Armed = "side" | "resign" | "new" | null;

const LEVELS: { level: Strength; label: string; title: string }[] = [
  { level: "full", label: "Full", title: "Its favourite move every time (it still only looks one move ahead)" },
  { level: "casual", label: "Casual", title: "Its third choice each move; it never declines a mate" },
  { level: "beginner", label: "Beginner", title: "Its sixth choice each move; it never declines a mate" },
];

export function GameControls({
  state,
  disabled,
  onIntent,
}: {
  state: ChessSnapshot;
  disabled: boolean;
  onIntent: (intent: Intent) => void;
}) {
  const [armed, setArmed] = useState<Armed>(null);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  // A change on the board disarms whatever was pending.
  useEffect(() => setArmed(null), [state.fen, state.phase]);

  const over = state.phase === "game-over";
  const inProgress = !over && state.history.length > 0;
  const other: Side = state.user_color === "white" ? "black" : "white";

  /** Act now, or on the second press when a game in progress would be lost. */
  const guarded = (which: Exclude<Armed, null>, intent: Intent, needsConfirm: boolean) => {
    if (needsConfirm && armed !== which) return setArmed(which);
    setArmed(null);
    onIntent(intent);
  };

  return (
    <div className="chess-controls" role="group" aria-label="Game controls">
      <div className="chess-control">
        <span className="chess-control__label">You play</span>
        <div className="chess-segmented">
          {(["white", "black"] as const).map((side) => {
            const mine = side === state.user_color;
            const confirming = armed === "side" && !mine;
            return (
              <button
                key={side}
                type="button"
                className={`chess-segmented__option${mine ? " is-on" : ""}${confirming ? " is-armed" : ""}`}
                aria-pressed={mine}
                disabled={disabled}
                title={mine ? `You are playing ${side}` : `Start a new game as ${side}`}
                onClick={() => {
                  if (!mine) guarded("side", { kind: "set_side", side: other }, inProgress);
                }}
              >
                {confirming ? `Restart as ${side === "white" ? "White" : "Black"}?` : side === "white" ? "White" : "Black"}
              </button>
            );
          })}
        </div>
      </div>

      <div className="chess-control">
        <span className="chess-control__label">Opponent</span>
        <div className="chess-segmented">
          {LEVELS.map(({ level, label, title }) => {
            const on = (state.difficulty || "full") === level;
            return (
              <button
                key={level}
                type="button"
                className={`chess-segmented__option${on ? " is-on" : ""}`}
                aria-pressed={on}
                disabled={disabled}
                title={title}
                onClick={() => {
                  if (!on) onIntent({ kind: "set_difficulty", level });
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {!over && (
        <div className="chess-control chess-control--actions">
          <button
            type="button"
            className={`chess-btn chess-btn--quiet${armed === "resign" ? " is-armed" : ""}`}
            disabled={disabled}
            onClick={() => guarded("resign", { kind: "resign" }, true)}
          >
            {armed === "resign" ? "Really resign?" : "Resign"}
          </button>
          <button
            type="button"
            className={`chess-btn chess-btn--quiet${armed === "new" ? " is-armed" : ""}`}
            disabled={disabled}
            onClick={() => guarded("new", { kind: "new_game" }, inProgress)}
          >
            {armed === "new" ? "Start over?" : "New game"}
          </button>
        </div>
      )}
    </div>
  );
}
