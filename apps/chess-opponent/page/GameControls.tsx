import { useEffect, useState } from "react";

import type { ChessSnapshot, Side, Strength } from "../engine/types.ts";
import type { Intent } from "./Game.tsx";

/**
 * Which side you play, how hard Sasha tries, resigning, and starting over.
 *
 * Anything that throws a game in progress away (a side swap, a resignation,
 * a new game) asks for a second press: there is no takeback on this board.
 * The strength takes effect from Sasha's next move and loses nothing, so it
 * acts at once.
 */
type Armed = "side" | "resign" | "new" | null;

const LEVELS: { level: Strength; label: string; title: string }[] = [
  { level: "full", label: "Full", title: "Her favourite move every time (she still only looks one move ahead)" },
  { level: "casual", label: "Casual", title: "Her third choice each move; she never misses a mate" },
  { level: "beginner", label: "Beginner", title: "Her sixth choice each move; she never misses a mate" },
];

export function GameControls({
  state,
  host,
  disabled,
  onIntent,
}: {
  state: ChessSnapshot;
  host: string;
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
    <div className="kb-controls-bar" role="group" aria-label="Game controls">
      <div className="kb-control">
        <span className="kb-control-label" id="kb-side-label">You play</span>
        <div className="kb-segmented" role="group" aria-labelledby="kb-side-label">
          {(["white", "black"] as const).map((side) => {
            const mine = side === state.user_color;
            const confirming = armed === "side" && !mine;
            return (
              <button
                key={side}
                type="button"
                className={`kb-segment${mine ? " is-on" : ""}${confirming ? " is-armed" : ""}`}
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

      <div className="kb-control">
        <span className="kb-control-label" id="kb-strength-label">{host}'s strength</span>
        <div className="kb-segmented" role="group" aria-labelledby="kb-strength-label">
          {LEVELS.map(({ level, label, title }) => {
            const on = (state.difficulty || "full") === level;
            return (
              <button
                key={level}
                type="button"
                className={`kb-segment${on ? " is-on" : ""}`}
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
        <div className="kb-control is-actions">
          <button
            type="button"
            className={`kb-quiet is-danger${armed === "resign" ? " is-armed" : ""}`}
            disabled={disabled}
            onClick={() => guarded("resign", { kind: "resign" }, true)}
          >
            {armed === "resign" ? "Really resign?" : "Resign"}
          </button>
          <button
            type="button"
            className={`kb-quiet${armed === "new" ? " is-armed" : ""}`}
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
