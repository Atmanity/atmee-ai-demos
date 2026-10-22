// The table, rendered from the server's masked view and nothing else: the
// original panel's PokerGame with its data layer swapped. It used
// `useAppState` over the platform bridge; here the view arrives as a prop and
// a click is `onIntent`. Its auto-deal is gone too: the server deals the
// opening hand itself.
//
// Nothing here computes rules: `valid_actions`, `to_call` and `min_raise_to`
// arrive computed. Everything in this file is VIEW state: sounds, the help
// sheet, the pressed state of a button. None of it reaches the table.
import { useEffect, useRef, useState } from "react";

import type { Intent, PokerActionKind, TableView } from "../engine/types.ts";
import { BIG_BLIND, STARTING_STACK } from "../engine/types.ts";
import { ActionBar } from "./ActionBar.tsx";
import { HowToPlay } from "./HowToPlay.tsx";
import { PokerTable } from "./PokerTable.tsx";
import { isSoundMuted, primeAudio, setSoundMuted, sounds } from "./sounds.ts";

export interface PokerGameProps {
  view: TableView | null;
  /** The opponent's seat label: a role, not a person. */
  opponentName: string;
  /** A refusal or note to show on the table. */
  message?: string;
  /** The avatar is at the table (actions are offered only then). */
  live: boolean;
  /** A request is in flight. */
  busy?: boolean;
  onIntent: (intent: Intent) => void;
}

export function PokerGame({ view, opponentName, message = "", live, busy = false, onIntent }: PokerGameProps) {
  // Sounds are view state driven off DIFFS: what changed between two views is
  // the event the sound decorates.
  const prevRef = useRef<TableView | null>(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = view;
    if (!view || !prev || view.seq === prev.seq) return;

    const action = view.last_action;
    const prevAction = prev.last_action;
    if (action && JSON.stringify(action) !== JSON.stringify(prevAction)) {
      switch (action.kind) {
        case "deal":
          sounds.deal();
          break;
        case "fold":
          sounds.fold();
          break;
        case "check":
          sounds.check();
          break;
        case "call":
          sounds.call();
          break;
        case "raise":
          if ((prev.current_bet ?? 0) === 0) sounds.bet();
          else sounds.raise();
          break;
      }
    }
    if (view.street !== prev.street && view.board.length > prev.board.length) {
      const delay = action?.kind === "fold" ? 80 : 280;
      setTimeout(() => sounds.cardFlip(), delay);
      setTimeout(() => sounds.cardFlip(), delay + 140);
      if (view.board.length - prev.board.length > 2) {
        setTimeout(() => sounds.cardFlip(), delay + 280);
      }
    }
    if (view.winner && !prev.winner) {
      const userWon = view.winner.who === "user";
      setTimeout(() => (userWon ? sounds.win() : sounds.lose()), 400);
    }
  }, [view]);

  const intend = (intent: Intent) => {
    primeAudio();
    onIntent(intent);
  };
  const move = (kind: PokerActionKind, amount?: number) =>
    intend(amount === undefined ? { kind } : { kind, amount });

  // Pure view state: the rules are a reference you open and close.
  const [helpOpen, setHelpOpen] = useState(false);
  const [soundsMuted, setSoundsMuted] = useState(() => isSoundMuted());
  const toggleSound = () => {
    const next = !soundsMuted;
    setSoundsMuted(next);
    setSoundMuted(next);
    if (!next) sounds.buttonTap();
  };

  const toggles = (
    <>
      {/* One always-visible help button, next to the mute toggle. */}
      <button type="button" className="poker-help-toggle" onClick={() => setHelpOpen(true)} title="How to play">
        How to play
      </button>
      {helpOpen && <HowToPlay onClose={() => setHelpOpen(false)} />}
      <button
        type="button"
        className={["poker-sound-toggle", soundsMuted && "poker-sound-toggle--muted"].filter(Boolean).join(" ")}
        onClick={toggleSound}
        title={soundsMuted ? "Unmute poker sounds" : "Mute poker sounds"}
        aria-label={soundsMuted ? "Unmute poker sounds" : "Mute poker sounds"}
      >
        {soundsMuted ? (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H3v6h3l5 4z" />
            <line x1="22" y1="9" x2="16" y2="15" />
            <line x1="16" y1="9" x2="22" y2="15" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H3v6h3l5 4z" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
        )}
      </button>
    </>
  );

  if (!view || view.phase === "lobby") {
    // An empty table until the session starts and the server deals. A refusal
    // still renders here, with a way out: a spinner with the reason stranded
    // in a variable was a bug in the original.
    return (
      <div className="poker-game">
        {toggles}
        <PokerTable
          board={[]}
          pot={0}
          players={[
            { name: "You", stack: STARTING_STACK, bet: 0, cards: null, faceDown: false, isActive: false, isDealer: false, folded: false },
            { name: opponentName, stack: STARTING_STACK, bet: 0, cards: null, faceDown: false, isActive: false, isDealer: false, folded: false },
          ]}
        />
        {message ? (
          <>
            <div className="game-message">{message}</div>
            <div className="hand-over-controls">
              <button className="btn-deal" disabled={!live || busy} onClick={() => intend({ kind: "deal" })}>
                Deal
              </button>
            </div>
          </>
        ) : (
          <div className="poker-lobby-line" aria-live="polite">
            {live || view ? (
              <span className="poker-lobby-status"><span className="btn-deal-waiting-spinner" />Shuffling up...</span>
            ) : (
              <span>Sit down (on the left) and the first hand is dealt.</span>
            )}
          </div>
        )}
      </div>
    );
  }

  const user = view.players.user;
  const agent = view.players.agent;
  const isUserTurn = view.action_to === "user" && view.phase === "playing";
  const agentThinking = view.action_to === "agent" && view.phase === "playing";
  const revealAgentCards = view.revealed_hands !== null;
  const winnerLine = (() => {
    if (!view.winner) return "";
    if (view.phase === "game-over") {
      return user.stack === 0 ? `Game over: ${opponentName} wins the match.` : "Game over: You win the match.";
    }
    if (view.winner.who === "split") return `Split pot: ${view.winner.amount} shared${view.winner.hand_rank ? `, both with ${view.winner.hand_rank}` : ""}`;
    // "You wins 200": one third-person template for both seats was
    // ungrammatical on every hand the player won.
    const subject = view.winner.who === "user" ? "You win" : `${opponentName} wins`;
    const rank = view.winner.hand_rank;
    return `${subject} ${view.winner.amount}${rank ? ` with ${rank}` : ""}`;
  })();
  const session = view.session;

  return (
    <div className="poker-game">
      {toggles}

      <PokerTable
        board={view.board}
        pot={view.pot}
        players={[
          {
            name: "You",
            stack: user.stack,
            bet: user.bet,
            cards: view.user_hand.length ? view.user_hand : null,
            faceDown: false,
            isActive: view.action_to === "user",
            isDealer: view.button === "user",
            folded: user.folded,
            handRank: revealAgentCards && view.winner?.who === "user" ? view.winner.hand_rank : undefined,
          },
          {
            name: opponentName,
            stack: agent.stack,
            bet: agent.bet,
            cards: revealAgentCards ? (view.revealed_hands?.agent ?? null) : [null, null],
            faceDown: !revealAgentCards,
            isActive: view.action_to === "agent",
            isDealer: view.button === "agent",
            folded: agent.folded,
            handRank: revealAgentCards && view.winner?.who === "agent" ? view.winner.hand_rank : undefined,
            isThinking: agentThinking,
          },
        ]}
      />

      {(message || winnerLine) && <div className="game-message">{message || winnerLine}</div>}

      {/* Stacks are a running total, not a history. Hidden until the first
          hand settles, so it never shows a 0–0 nobody asked about. */}
      {session.hands_played > 0 && (
        <div className="poker-session" aria-label="Session score">
          <span>Hand {session.hands_played + (view.phase === "playing" ? 1 : 0)}</span>
          <span>
            You {session.hands_won_user} — {session.hands_won_agent} {opponentName}
          </span>
          <span className={session.chips_up_user >= 0 ? "poker-session--up" : "poker-session--down"}>
            {session.chips_up_user >= 0 ? "+" : "−"}
            {Math.abs(session.chips_up_user)} chips
          </span>
        </div>
      )}

      {agentThinking && (
        <div className="agent-waiting" role="status">
          {`${opponentName} is deciding…`}
        </div>
      )}

      {view.phase === "playing" && !view.winner && (
        <ActionBar
          // Keyed on the table's seq: each new decision starts from the table's floor.
          key={view.seq}
          canCheck={view.valid_actions.includes("check")}
          callAmount={isUserTurn ? view.to_call : 0}
          minBet={BIG_BLIND}
          maxBet={user.bet + user.stack}
          minRaise={view.min_raise_to}
          stack={user.stack}
          raiseAllowed={!isUserTurn || view.valid_actions.includes("raise")}
          onFold={() => move("fold")}
          onCheck={() => move("check")}
          onCall={() => move("call")}
          onBet={(amount) => move("raise", amount)}
          onRaise={(amount) => move("raise", amount)}
          disabled={!isUserTurn || busy || !live}
        />
      )}

      {view.phase === "hand-over" && (
        <div className="hand-over-controls">
          <button className="btn-deal" disabled={!live || busy} onClick={() => intend({ kind: "deal" })}>
            Deal Again
          </button>
        </div>
      )}

      {view.phase === "game-over" && (
        <div className="hand-over-controls game-over-controls">
          <button className="btn-deal" disabled={!live || busy} onClick={() => intend({ kind: "restart" })}>
            Restart Game
          </button>
        </div>
      )}

      <div className="poker-voice-hint">
        {!live
          ? "Start the session to play."
          : isUserTurn
            ? 'Your move: say it or type it — "call", "raise to 60", "I fold".'
            : view.phase === "hand-over"
              ? 'Say "deal" for the next hand.'
              : view.phase === "game-over"
                ? 'Say "play again" for a rematch.'
                : ""}
      </div>
    </div>
  );
}
