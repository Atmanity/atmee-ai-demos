// The table: Sasha's side of the board, the board, your side, and under it
// whatever the moment needs (a refusal, the controls, or the result). Drawn
// from the board's snapshot and nothing else; every action goes out as an
// intent the page turns into a board action.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ChessSnapshot, Side, Strength } from "../engine/types.ts";
import { CapturedPieces } from "./CapturedPieces.tsx";
import { ChessBoardView, type Square } from "./ChessBoard.tsx";
import { advantageForSide, computeCaptured } from "./captured.ts";
import { GameControls } from "./GameControls.tsx";
import { refusalNotice, resultReasonLine, resultSentence } from "./notices.ts";
import { downloadPgn } from "./pgn.ts";
import { primeAudio, sounds } from "./sounds.ts";
import { boardTurnState, playerStatuses } from "./status.ts";

/** What the table can ask the board for. The page turns each into a board action. */
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

const sideWord = (c: "w" | "b") => (c === "w" ? "White" : "Black");
/** A board reason as a sentence on screen: a leading letter raised (a quote or a square stays as it is), one full stop. */
export const sentence = (text: string) => {
  const t = text.trim();
  const raised = /^[a-z]/.test(t) ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  return /[.!?…]$/.test(raised) ? raised : `${raised}.`;
};

export function Game({
  state,
  send,
  thinking,
  host,
  locked = null,
  className = "",
}: {
  state: ChessSnapshot | null;
  send: (intent: Intent) => Promise<Sent>;
  /** Sasha is about to move (the beat after yours). */
  thinking: boolean;
  /** The host's name. */
  host: string;
  /** Why nothing can be played right now (the call is connecting or over), or null. */
  locked?: string | null;
  className?: string;
}) {
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Square | null>(null);
  const disabled = locked !== null;

  const intend = useCallback(
    async (intent: Intent) => {
      primeAudio();
      const result = await send(intent);
      setMessage(result.applied ? "" : result.reason);
      return result.applied;
    },
    [send],
  );

  // Sounds and the end of a local refusal are driven off snapshot DIFFS.
  const prevRef = useRef<ChessSnapshot | null>(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    setSelected(null);
    if (!state || !prev) return;
    // A refusal describes the position it was refused in; once a newer
    // snapshot lands that position is gone.
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

  const canMove = Boolean(state && state.phase === "playing" && state.turn === "user" && !thinking && !disabled);

  /** A move is one intent: the board's own list says whether it can be tried (a promotion is a queen). */
  const tryMove = useCallback(
    (from: Square, to: Square): boolean => {
      if (!state || !canMove) return false;
      const uci = `${from}${to}`;
      const legal = state.legal_moves.find((move) => move.uci === uci || move.uci === `${uci}q`);
      if (!legal) return false;
      setSelected(null);
      void intend({ kind: "move", move: legal.uci });
      return true;
    },
    [intend, state, canMove],
  );

  const targets = useMemo(
    () => (state && selected ? state.legal_moves.filter((m) => m.uci.startsWith(selected)).map((m) => m.uci.slice(2, 4)) : []),
    [state, selected],
  );

  /** Tap a piece, then tap where it goes: for a phone, where a drag is fiddly. */
  const onSquareClick = useCallback(
    (square: Square) => {
      if (!state || !canMove) return;
      if (selected && targets.includes(square)) {
        tryMove(selected, square);
        return;
      }
      const movable = state.legal_moves.some((m) => m.uci.startsWith(square));
      setSelected(movable && square !== selected ? square : null);
    },
    [state, canMove, selected, targets, tryMove],
  );

  const captured = useMemo(() => (state ? computeCaptured(state.fen) : null), [state]);

  if (!state || !captured) {
    return (
      <section className={`kb-table ${className}`} aria-label="The board">
        <div className="kb-board-col">
          <div className="kb-frame is-loading" role="status" aria-live="polite">
            <span className="kb-spinner" aria-hidden="true" />
            <span>{host} is setting up the board…</span>
          </div>
        </div>
      </section>
    );
  }

  const lastMove = state.last_move
    ? { from: state.last_move.uci.slice(0, 2) as Square, to: state.last_move.uci.slice(2, 4) as Square }
    : null;
  const sides = seating(state.user_color);
  const userLost = sides.user === "w" ? captured.byBlack : captured.byWhite;
  const agentLost = sides.agent === "w" ? captured.byBlack : captured.byWhite;
  const over = state.phase === "game-over";
  const status = playerStatuses({ over, turn: state.turn, inCheck: state.in_check, winner: state.result?.winner ?? null });
  const turnState = boardTurnState({ over, turn: state.turn });
  const refusal = refusalNotice(message, state.last_refusal);
  const softened = state.difficulty && state.difficulty !== "full";

  return (
    <section className={`kb-table ${className}`} aria-label="The board">
      <div className="kb-board-col">
        <div className="kb-strip is-them">
          <span className="kb-strip-name">{host}</span>
          <span className={`kb-chip is-${sides.agent}`}>{sideWord(sides.agent)}</span>
          {/* A strength the player asked for and cannot see did not take, as far as they know. */}
          {softened && <span className="kb-chip is-strength" title={`Playing at ${state.difficulty} strength`}>{state.difficulty}</span>}
          {/* With the call over, her move waits for the next one: she is not thinking now. */}
          <span className={`kb-status is-${thinking ? "thinking" : locked && status.agent.tone === "thinking" ? "idle" : status.agent.tone}`}>
            {thinking ? "Thinking…" : locked && status.agent.tone === "thinking" ? "Her move" : status.agent.text}
          </span>
          <CapturedPieces pieces={agentLost} capturedColor={sides.agent} advantage={advantageForSide(captured, sides.agent)} />
        </div>

        <div className={`kb-frame is-${turnState}`}>
          <ChessBoardView
            fen={state.fen}
            boardOrientation={sides.user === "w" ? "white" : "black"}
            draggable={canMove}
            lastMove={lastMove}
            inCheckSquare={(state.check_square as Square | null) ?? null}
            turnState={turnState}
            onPieceDrop={tryMove}
            onSquareClick={onSquareClick}
            selected={selected}
            targets={targets}
          />
          {locked && (
            <div className="kb-lock" role="status">
              <span>{locked}</span>
            </div>
          )}
        </div>

        <div className="kb-strip is-you">
          <span className="kb-strip-name">You</span>
          <span className={`kb-chip is-${sides.user}`}>{sideWord(sides.user)}</span>
          <span className={`kb-status is-${status.user.tone}`}>{status.user.text}</span>
          <CapturedPieces pieces={userLost} capturedColor={sides.user} advantage={advantageForSide(captured, sides.user)} />
        </div>

        {refusal && (
          <div className="kb-refusal" role="status" aria-live="polite">
            <svg className="kb-refusal-mark" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
              <circle cx="10" cy="10" r="9" fill="currentColor" />
              <path d="M6.5 6.5l7 7M13.5 6.5l-7 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <p>
              {sentence(refusal.text)}
              {refusal.detail && <small>{refusal.detail}</small>}
            </p>
          </div>
        )}

        {over && state.result ? (
          <Result state={state} host={host} disabled={disabled || thinking} onIntent={(intent) => void intend(intent)} />
        ) : (
          <>
            <GameControls state={state} host={host} disabled={disabled || thinking} onIntent={(intent) => void intend(intent)} />
            <p className="kb-hint">
              Drag or tap a piece, or tell {host} your move: <q>e4</q>, <q>knight to f3</q>, <q>castle</q>.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

/** The game's end: who won and how, and what next. */
function Result({ state, host, disabled, onIntent }: { state: ChessSnapshot; host: string; disabled: boolean; onIntent: (intent: Intent) => void }) {
  const result = state.result!;
  const moves = Math.ceil(state.history.length / 2);
  const other: Side = state.user_color === "white" ? "black" : "white";
  const tone = result.winner === "opponent" ? "is-win" : result.winner === "agent" ? "is-loss" : "is-draw";
  return (
    <section className={`kb-result ${tone}`} aria-label="Result">
      <p className="kb-eyebrow">Game over</p>
      <p className="kb-result-line">{resultSentence(result.winner, host)}</p>
      <p className="kb-result-why">{resultReasonLine(result.reason)}</p>
      <ul className="kb-result-facts">
        <li><b>{moves}</b> move{moves === 1 ? "" : "s"}</li>
        <li>You played <b>{state.user_color === "white" ? "White" : "Black"}</b></li>
        {state.opening && <li><b>{state.opening}</b></li>}
      </ul>
      <div className="kb-result-actions">
        <button type="button" className="kb-primary" disabled={disabled} onClick={() => onIntent({ kind: "new_game" })}>Play again</button>
        <button type="button" className="kb-secondary" disabled={disabled} onClick={() => onIntent({ kind: "set_side", side: other })}>
          Play again as {other === "white" ? "White" : "Black"}
        </button>
        {state.history.length > 0 && (
          <button type="button" className="kb-quiet" onClick={() => downloadPgn(state, host)}>Download the scoresheet</button>
        )}
      </div>
    </section>
  );
}
