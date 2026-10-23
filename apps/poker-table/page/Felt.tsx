// The table: Dex's seat at the head of the felt (his live video is the seat),
// the board and the pot in the middle, the player's seat at the bottom. It
// draws the server's masked view and nothing else, so it can never show
// Dex's cards before a real showdown.
import { useEffect, useState } from 'react';
import { CallStatus, HostVideo, type Avatar } from '../../../src/kit/index.ts';
import { HOST } from '../engine/director.ts';
import { handRankLabel } from '../engine/evaluator.ts';
import type { TableView } from '../engine/types.ts';
import portrait from '../host/portrait.jpg';
import { CardView } from './CardView.tsx';
import { ChipStack } from './ChipStack.tsx';

/** The headline when a hand ends, from the player's side of the table. */
export function resultHeadline(view: TableView): string {
  const w = view.winner;
  if (!w) return '';
  if (w.who === 'split') return `Split pot · ${w.amount.toLocaleString('en-US')}`;
  return `${w.who === 'user' ? 'You win' : `${HOST} wins`} ${w.amount.toLocaleString('en-US')}`;
}

/** How the hand was won, under the headline. */
export function resultDetail(view: TableView): string {
  const w = view.winner;
  if (!w) return '';
  if (w.who === 'split') return w.hand_rank ? `Both with ${w.hand_rank.toLowerCase()}` : 'Equal hands';
  if (!view.revealed_hands) return w.who === 'user' ? `${HOST} folded` : 'You folded';
  return w.hand_rank ? `with ${w.hand_rank.toLowerCase()}` : '';
}

/** What the player holds right now, from their own cards and the board: a beginner's crib, never Dex's. */
export function yourHand(view: TableView | null): string | null {
  if (!view || !view.user_hand.length || view.players.user.folded) return null;
  if (view.board.length >= 3) return handRankLabel([...view.user_hand, ...view.board]);
  return view.user_hand[0][0] === view.user_hand[1]?.[0] ? 'Pocket pair' : null;
}

const sentence = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? '' : '.') : '');

export function Felt({ view, avatar, message }: { view: TableView | null; avatar: Avatar; message?: string }) {
  const live = avatar.phase === 'live';
  const user = view?.players.user;
  const agent = view?.players.agent;
  const handOver = view && (view.phase === 'hand-over' || view.phase === 'game-over');
  const thinking = Boolean(view && view.phase === 'playing' && view.action_to === 'agent');
  const dexCards = view?.revealed_hands?.agent ?? null;
  const dealt = Boolean(view && view.phase !== 'lobby' && view.user_hand.length);

  return (
    <div className={`bs-felt ${handOver ? 'is-over' : ''}`} data-phase={view?.phase ?? 'dealing'}>
      <div className="bs-surface">
        <div className={`bs-seat is-dex ${thinking ? 'is-acting' : ''} ${agent?.folded ? 'is-folded' : ''}`}>
          <div className="bs-hole is-dex" aria-label={dexCards ? `${HOST}'s cards` : `${HOST}'s cards, face down`}>
            {dealt ? (dexCards ? dexCards.map((c) => <CardView key={c} card={c} size="sm" />) : <><CardView faceDown size="sm" /><CardView faceDown size="sm" /></>) : null}
          </div>
          <figure className="bs-dex" aria-label={`${HOST}, your opponent`}>
            <HostVideo avatar={avatar} name={HOST} poster={portrait} captions={false} className="bs-dex-video">
              <CallStatus avatar={avatar} name={HOST} again={`Call ${HOST} again`} />
            </HostVideo>
            <figcaption className="bs-plate">
              <b>{HOST}</b>
              {view?.button === 'agent' && <span className="bs-dealer" title="Dealer button">D</span>}
              {agent && <span className="bs-stack">{agent.stack.toLocaleString('en-US')}</span>}
            </figcaption>
            {thinking && <span className="bs-thinking" role="status">thinking…</span>}
          </figure>
          <SpeechBubble text={avatar.caption} live={live} />
        </div>

        <div className="bs-bet is-dex">{agent && agent.bet > 0 && <ChipStack amount={agent.bet} compact />}</div>

        <div className="bs-center">
          <div className="bs-board" aria-label={view?.board.length ? `The board: ${view.board.length} cards` : 'The board'}>
            {Array.from({ length: 5 }, (_, i) => <CardView key={i} card={view?.board[i]} size="md" />)}
          </div>
          {!view ? (
            <p className="bs-dealing" aria-live="polite">{HOST} is shuffling up…</p>
          ) : handOver ? (
            <div className="bs-result" role="status">
              <strong>{resultHeadline(view)}</strong>
              <span>{resultDetail(view)}</span>
            </div>
          ) : (
            <div className="bs-pot">{view.pot > 0 && <ChipStack amount={view.pot} label="Pot" />}</div>
          )}
          {message && <p className="bs-message" role="alert">{sentence(message)}</p>}
        </div>

        <div className="bs-bet is-you">{user && user.bet > 0 && <ChipStack amount={user.bet} compact />}</div>

        <div className={`bs-seat is-you ${view?.action_to === 'user' && view.phase === 'playing' ? 'is-acting' : ''} ${user?.folded ? 'is-folded' : ''}`}>
          <div className="bs-hole is-you" aria-label="Your cards">
            {dealt ? view!.user_hand.map((c) => <CardView key={c} card={c} size="lg" />) : <><CardView size="lg" /><CardView size="lg" /></>}
          </div>
          <div className="bs-plate is-you">
            <b>You</b>
            {view?.button === 'user' && <span className="bs-dealer" title="Dealer button">D</span>}
            {user && <span className="bs-stack">{user.stack.toLocaleString('en-US')}</span>}
            {yourHand(view) && <span className="bs-rank" title="Your best hand right now">{yourHand(view)}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Dex's words as he says them, beside his seat: the sentence being spoken, cleared after a pause. */
function SpeechBubble({ text, live }: { text: string; live: boolean }) {
  const [shown, setShown] = useState('');
  useEffect(() => {
    if (!text) return;
    const sentences = text.trim().split(/(?<=[.!?…])\s+/);
    let line = sentences.pop() ?? '';
    if (line.length < 40 && sentences.length) line = `${sentences.pop()} ${line}`;
    setShown(line.length > 150 ? `…${line.slice(-150)}` : line);
    const id = setTimeout(() => setShown(''), 6000);
    return () => clearTimeout(id);
  }, [text]);
  if (!live || !shown) return <div className="bs-bubble is-empty" aria-hidden="true" />;
  return <p className="bs-bubble" aria-hidden="true">{shown}</p>;
}
