import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { detectOpening } from "../engine/openings.ts";
import type { ChessSnapshot, Side, Strength } from "../engine/types.ts";
import { CapturedPieces } from "./CapturedPieces.tsx";
import { ChessBoardView, type Square } from "./ChessBoard.tsx";
import { advantageForSide, computeCaptured } from "./captured.ts";
import { GameControls } from "./GameControls.tsx";
import { Lobby } from "./Lobby.tsx";
import { noticesFor } from "./notices.ts";
import { isSoundMuted, primeAudio, setSoundMuted, sounds } from "./sounds.ts";
import { boardTurnState, playerStatuses } from "./status.ts";

/** What the panel can ask the board for. The page turns each into a board action. */
export type Intent =
  | { kind: "move"; move: string }
  | { kind: "new_game" }
  | { kind: "set_side"; side: Side }
  | { kind: "set_difficulty"; level: Strength }
  | { kind: "resign" };

/** The board's answer to an intent: applied, or refused with a reason. Never throws. */
export interface Sent {
  applied: boolean;
  reason: string;
}

/** The user's side and the opponent's, from one snapshot field. */
export function seating(userColor: Side | undefined): { user: "w" | "b"; agent: "w" | "b" } {
  const user = userColor === "black" ? "b" : "w";
  return { user, agent: user === "w" ? "b" : "w" };
}

/**
 * The board, drawn from the snapshot and nothing else. Ported from the
 * original panel's ChessGame: only its data hook changed (the snapshot and
 * `send` come from the page, which owns the board, instead of from the
 * agent over the platform bridge), and it gained the controls the original
 * left to voice alone: side, difficulty, resign, and a new game mid-game.
 *
 * What stays here is view state: sounds off snapshot diffs, the drag in
 * flight, the mute toggle, and cosmetics recomputed from the snapshot
 * (captured pieces from the FEN). Every sentence it draws is decided in a
 * pure module beside it (status.ts, notices.ts, captured.ts).
 */
export function ChessGame({
  state,
  send,
  pending,
  opponentName,
  disabled = false,
  lobby,
}: {
  state: ChessSnapshot | null;
  send: (intent: Intent) => Promise<Sent>;
  pending: boolean;
  opponentName: string;
  /** Nothing can be played: the opponent is not at the table yet. */
  disabled?: boolean;
  /** What the lobby says before the board is set up. */
  lobby?: string;
}) {
  const [message, setMessage] = useState("");

  const intend = useCallback(
    async (intent: Intent) => {
      const result = await send(intent);
      setMessage(result.applied ? "" : result.reason);
      return result.applied;
    },
    [send],
  );

  // Sounds are view state driven off snapshot DIFFS.
  const prevRef = useRef<ChessSnapshot | null>(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    if (!state || !prev) return;
    // A refusal describes the position it was refused in; once a newer
    // snapshot lands that position is gone. The snapshot's own `last_refusal`
    // follows the same rule, so a spoken refusal clears on the next move too.
    setMessage("");
    const last = state.last_move;
    if (last && last.uci !== prev.last_move?.uci) {
      if (last.san.startsWith("O-O")) sounds.castle();
      else if (last.san.includes("x")) sounds.capture();
      else sounds.move();
      if (state.in_check) sounds.check();
    }
    if (state.result && !prev.result) {
      if (state.result.winner === "agent") sounds.lose();
      else if (state.result.winner === "opponent") sounds.win();
      else sounds.draw();
    }
  }, [state]);

  const isUserTurn = state?.phase === "playing" && state.turn === "user";

  /**
   * A drop is one intent. The legal-move check is the BOARD'S list (a hint
   * from the snapshot): an obviously wrong drop snaps back instantly, while
   * the board stays the real judge. Promotion is always to a queen.
   */
  const handleDrop = useCallback(
    (from: Square, to: Square): boolean => {
      if (!state || state.turn !== "user" || disabled) return false;
      const uci = `${from}${to}`;
      const legal = state.legal_moves.find((move) => move.uci === uci || move.uci === `${uci}q`);
      if (!legal) return false;
      primeAudio();
      void intend({ kind: "move", move: legal.uci });
      return true;
    },
    [intend, state, disabled],
  );

  const opening = useMemo(() => (state ? (state.opening ?? detectOpening(state.history)) : null), [state]);
  const captured = useMemo(() => (state ? computeCaptured(state.fen) : null), [state]);

  const [muted, setMuted] = useState(() => isSoundMuted());
  const toggleSound = () => {
    const next = !muted;
    setMuted(next);
    setSoundMuted(next);
    if (!next) sounds.buttonTap();
  };

  if (!state || !captured) return <Lobby text={lobby} busy={!disabled} />;

  const history = state.history;
  const lastMove = state.last_move
    ? { from: state.last_move.uci.slice(0, 2) as Square, to: state.last_move.uci.slice(2, 4) as Square }
    : null;
  // Seating from the snapshot: the player can ask for the other colour, and
  // every row and the orientation follow it.
  const sides = seating(state.user_color);
  const userLost = sides.user === "w" ? captured.byBlack : captured.byWhite;
  const agentLost = sides.agent === "w" ? captured.byBlack : captured.byWhite;
  const over = state.phase === "game-over";
  const status = playerStatuses({ over, turn: state.turn, inCheck: state.in_check, winner: state.result?.winner ?? null });
  const turnState = boardTurnState({ over, turn: state.turn });
  const notices = noticesFor({ localMessage: message, snapshotRefusal: state.last_refusal, result: state.result, opponentName });
  const softened = state.difficulty && state.difficulty !== "full";

  return (
    <div className="chess-game">
      <div className="chess-stage">
        <button
          type="button"
          className={`chess-sound-toggle${muted ? " is-muted" : ""}`}
          onClick={toggleSound}
          title={muted ? "Unmute chess sounds" : "Mute chess sounds"}
          aria-label={muted ? "Unmute chess sounds" : "Mute chess sounds"}
          aria-pressed={muted}
        >
          {muted ? "🔇" : "🔊"}
        </button>

        <div className="chess-player-row chess-player-row--top">
          <div className="chess-player-row__name">
            <span className="chess-meta__label">{opponentName}</span>
            <span className="chess-side-chip">{sides.agent === "w" ? "White" : "Black"}</span>
            {/* A difficulty the player asked for and cannot see did not take, as far as they know. */}
            {softened && (
              <span className="chess-difficulty" title={`Playing at ${state.difficulty} strength`}>
                {state.difficulty}
              </span>
            )}
            <span className={`chess-meta__status chess-meta__status--${status.agent.tone}`}>{status.agent.text}</span>
          </div>
          <CapturedPieces pieces={agentLost} capturedColor={sides.agent} advantage={advantageForSide(captured, sides.agent)} />
        </div>

        <ChessBoardView
          fen={state.fen}
          boardOrientation={sides.user === "w" ? "white" : "black"}
          draggable={isUserTurn && !pending && !disabled}
          lastMove={lastMove}
          inCheckSquare={(state.check_square as Square | null) ?? null}
          turnState={turnState}
          onPieceDrop={handleDrop}
        />

        <div className="chess-player-row chess-player-row--bottom">
          <div className="chess-player-row__name">
            <span className="chess-meta__label">You</span>
            <span className="chess-side-chip">{sides.user === "w" ? "White" : "Black"}</span>
            <span className={`chess-meta__status chess-meta__status--${status.user.tone}`}>{status.user.text}</span>
          </div>
          <CapturedPieces pieces={userLost} capturedColor={sides.user} advantage={advantageForSide(captured, sides.user)} />
        </div>
      </div>

      <div className="chess-side">
        {/* Two notices, never one box: a refusal must not replace the result. */}
        {notices.map((notice) => (
          <div key={notice.kind} className={`chess-notice chess-notice--${notice.kind}`} role="status" aria-live="polite">
            <span className="chess-notice__text">{notice.text}</span>
            {notice.detail && <span className="chess-notice__detail">{notice.detail}</span>}
          </div>
        ))}

        {over && (
          <div className="chess-game-over-controls">
            <button
              type="button"
              className="chess-btn chess-btn--primary"
              disabled={disabled || pending}
              onClick={() => {
                primeAudio();
                void intend({ kind: "new_game" });
              }}
            >
              New game
            </button>
          </div>
        )}

        <GameControls state={state} disabled={disabled || pending} onIntent={(intent) => { primeAudio(); void intend(intent); }} />

        {!over && (
          <div className="chess-hint">
            Drag a piece, or say or type <em>“e4”</em>, <em>“knight to f3”</em>, <em>“castle”</em>.
            <span className="chess-hint__ask">Ask to switch sides or to go easier, or use the controls above.</span>
          </div>
        )}

        {opening && <div className="chess-opening-label">Opening: {opening}</div>}

        <div className="chess-move-log" aria-label="Move history">
          {history.length > 0 ? (
            <ol className="chess-move-log__list">
              {Array.from({ length: Math.ceil(history.length / 2) }).map((_, index) => (
                <li key={index}>
                  <span className="chess-move-log__num">{index + 1}.</span>
                  <span className="chess-move-log__white">{history[index * 2]}</span>
                  {history[index * 2 + 1] && <span className="chess-move-log__black">{history[index * 2 + 1]}</span>}
                </li>
              ))}
            </ol>
          ) : (
            <span className="chess-move-log__empty">No moves yet.</span>
          )}
        </div>
      </div>
    </div>
  );
}
