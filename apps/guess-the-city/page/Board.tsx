// The travel-journal board, from the original mini-app panel: the photo, the
// clues given, the reveal and the actions. It shows only what the server's
// view holds, so it can never show the answer early.
import { hintCost, roundValue } from '../engine/game.ts';
import type { Command } from '../engine/judge.ts';
import type { View } from '../engine/types.ts';

export function Board({ view, busy, live, onCommand }: { view: View | null; busy: boolean; live: boolean; onCommand: (c: Command) => void }) {
  if (!view) {
    return (
      <div className="game-panel">
        <div className="game-header"><h1 className="game-title">Guess the City</h1></div>
        <div className="game-loading">
          {live ? <div className="loading-spinner" /> : null}
          <p>{live ? 'Your host is preparing your adventure…' : 'Start the game to see your first mystery city.'}</p>
        </div>
      </div>
    );
  }

  const hintsUsed = view.hints.length;
  const worth = roundValue(hintsUsed);
  const nextHintCost = hintCost(hintsUsed);
  const disabled = busy || !live;

  return (
    <div className="game-panel">
      <div className="game-header">
        <h1 className="game-title">Guess the City</h1>
        <div className="game-stats">
          <span className="stat"><span className="stat-label">Round</span><span className="stat-value">{Math.min(view.round, view.rounds)}/{view.rounds}</span></span>
          <span className="stat"><span className="stat-label">Score</span><span className="stat-value">{view.score}</span></span>
        </div>
      </div>

      <div className="city-photo-container">
        <div className="city-photo" aria-label={view.city ? `Photo of ${view.city.name}` : 'Mystery city photo'}>
          {view.photo && <img key={view.photo} className="city-photo-img" src={view.photo} alt={view.city ? view.city.name : 'Mystery city'} />}
          {!view.revealed && !view.photo && <div className="mystery-overlay">?</div>}
          {view.city && (
            <div className="revealed-overlay">
              <span className="city-name">{view.city.name}</span>
              <span className="city-country">{view.city.country}</span>
            </div>
          )}
        </div>
      </div>

      <div className="hints-section">
        <div className="hints-header">
          <span className="hints-title">Clues</span>
          <span className="hints-count">
            {hintsUsed}/{view.hintsTotal}
            {!view.revealed && !view.over && <span className="round-value"> · worth {worth} pt</span>}
          </span>
        </div>
        {hintsUsed === 0 ? (
          <p className="no-hints">Guess it cold for {worth} points. Each clue you take costs one, down to a minimum of 1.</p>
        ) : (
          <ul className="hints-list">
            {view.hints.map((hint, i) => (
              <li key={i} className="hint-item"><span className="hint-number">{i + 1}</span><span className="hint-text">{hint}</span></li>
            ))}
          </ul>
        )}
      </div>

      {view.city?.funFact && (
        <div className="fun-fact">
          <span className="fun-fact-label">Fun fact</span>
          <p className="fun-fact-text">{view.city.funFact}</p>
        </div>
      )}

      {view.over && (
        <div className="game-over">
          <h2>Adventure complete!</h2>
          <p>You explored {view.rounds} cities and scored {view.score} of {view.rounds * 4} points.</p>
        </div>
      )}

      <div className="game-actions">
        {!view.revealed && !view.over && (
          <>
            <button type="button" className="action-btn hint-btn" onClick={() => onCommand('hint')} disabled={disabled || hintsUsed >= view.hintsTotal}>
              {hintsUsed >= view.hintsTotal ? 'No more clues' : nextHintCost > 0 ? `Get a clue (−${nextHintCost} pt)` : 'Get a clue (free)'}
            </button>
            <button type="button" className="action-btn skip-btn" onClick={() => onCommand('skip')} disabled={disabled}>I give up</button>
          </>
        )}
        {view.revealed && !view.over && (
          <button type="button" className="action-btn next-btn" onClick={() => onCommand('next')} disabled={disabled}>Next city</button>
        )}
        {view.over && (
          <button type="button" className="action-btn new-game-btn" onClick={() => onCommand('new')} disabled={disabled}>Play again</button>
        )}
      </div>

      <div className="voice-prompt">
        <p>{view.over ? 'Say "new game" to play again.' : view.revealed ? 'Say "next city" to continue.' : 'Say your guess out loud, or type it.'}</p>
      </div>
    </div>
  );
}
