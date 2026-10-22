import { useCallback, useState, type ReactNode } from 'react';
import { VERDICT_LABEL, type Intent, type Snapshot, type Verdict } from '../engine/types.ts';
import type { GridPoint } from './ink.ts';
import { StrokeCanvas } from './StrokeCanvas.tsx';

/**
 * The board, rendered from the server's snapshots and nothing else. (Ported
 * from the original panel; its `useAppState` became props.)
 *
 * There is no character data in this file, no grader, and no notion of what
 * the next stroke is: a stroke the learner has not earned arrives with no
 * points and is simply not drawn. That is the app's central property, and it
 * is enforced server-side: the page has nothing to leak.
 *
 * View state (the ink under the finger, the clear counter) stays here and
 * never crosses the network. The drop, the finished stroke, is one intent.
 */

/**
 * The pre-lesson branch. It takes the refusal node rather than rendering
 * nothing, because a message that only the later branch can show is a refusal
 * stranded behind an early return: the server refused, the page knew, and the
 * learner was told nothing. Exported so that property has its own test.
 */
export function Loading({ refusal, text = 'Inking the brush…' }: { refusal?: ReactNode; text?: string }) {
  return (
    <div className="st-panel">
      <div className="st-loading" aria-live="polite">
        <span className="st-spinner" />
        <span>{text}</span>
        {refusal}
      </div>
    </div>
  );
}

/** The verdict's tag. A reveal after two misses says so, rather than "Shown to you" as if they had asked. */
export function verdictLabel(verdict: Verdict, attempts: number): string {
  if (verdict.kind === 'reveal' && attempts >= 2) return 'Missed twice, shown';
  return VERDICT_LABEL[verdict.kind];
}

export function StrokeTutorPanel({ state, pending, message, disabled = false, waiting, onIntent }: {
  state: Snapshot | null;
  /** A board action from this panel is in flight. */
  pending: boolean;
  /** The last refusal, shown until the next accepted action. */
  message: string;
  /** No session is running: everything is shown, nothing can be pressed. */
  disabled?: boolean;
  /** What the pre-lesson branch says. */
  waiting?: string;
  onIntent: (intent: Intent) => void;
}) {
  const [clears, setClears] = useState(0);
  const onStroke = useCallback((points: GridPoint[]) => onIntent({ kind: 'stroke', points }), [onIntent]);

  // A refusal must be reachable from EVERY branch below, including the one
  // that renders before the first snapshot.
  const refusal = message ? <p className="st-message" role="status">{message}</p> : null;

  if (!state) return <Loading refusal={refusal} text={waiting} />;

  const character = state.character;
  const verdict = state.last_verdict;
  const position = state.stroke_index + 1;
  const total = character?.strokes_total ?? 0;
  const choosing = state.phase === 'intro' || state.phase === 'debrief';
  const busy = pending || disabled;

  return (
    <div className="st-panel">
      <header className="st-head">
        <div className="st-title">
          <p className="st-eyebrow">Stroke order practice</p>
          <h1>
            {character ? (
              <>
                <span className="st-glyph-inline">{character.glyph}</span>{' '}
                <span className="st-meaning">{character.meaning}</span>
              </>
            ) : 'Pick a character'}
          </h1>
          {character ? <p className="st-reading">{character.reading} · {total} {total === 1 ? 'stroke' : 'strokes'}</p> : null}
        </div>
        {/* Not progress through the character: how many strokes were right at
            the first attempt. A bare "1 / 2" three lines above "Stroke 2 of 2"
            read as the same thing, so it says what it counts. */}
        <div className="st-score">
          <span className="st-score-figure">
            <strong>{state.score.correct}</strong>
            <span> of {state.score.total}</span>
          </span>
          <span className="st-score-label">right first try</span>
        </div>
      </header>

      <StrokeCanvas
        strokes={state.strokes}
        grid={state.grid}
        disabled={state.phase !== 'writing' || busy}
        onStroke={onStroke}
        clearKey={`${character?.id ?? 'none'}-${state.stroke_index}-${clears}`}
      />

      {choosing ? (
        <section className="st-menu">
          <p className="st-lead">
            {state.phase === 'debrief'
              ? `Finished — ${state.score.correct} of ${state.score.total} first time. Pick another.`
              : 'Draw each stroke with your finger or mouse. Your teacher grades the order and the direction, never the handwriting.'}
          </p>
          <div className="st-menu-grid">
            {state.catalog.map((entry) => (
              <button key={entry.id} type="button" className="st-card" disabled={busy} onClick={() => onIntent({ kind: 'start_character', id: entry.id })}>
                <span className="st-card-glyph">{entry.glyph}</span>
                <span className="st-card-meaning">{entry.meaning}</span>
                <span className="st-card-count">{entry.strokes_total} {entry.strokes_total === 1 ? 'stroke' : 'strokes'}</span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <>
          <p className="st-ask" role="status">
            {state.phase === 'writing' ? `Stroke ${position} of ${total} — draw it.` : `Stroke ${position} of ${total} done. Say next when you're ready.`}
          </p>

          {verdict ? (
            <p className={`st-verdict is-${verdict.kind}`} role="status">
              <span className="st-verdict-tag">{verdictLabel(verdict, state.attempts)}</span>
              {verdict.note}
            </p>
          ) : null}

          <div className="st-actions">
            <button type="button" className="st-btn st-btn-ghost" disabled={busy} onClick={() => onIntent({ kind: 'reveal' })}>Show me</button>
            <button
              type="button" className="st-btn st-btn-ghost" disabled={busy}
              onClick={() => { setClears((n) => n + 1); onIntent({ kind: 'clear_attempt' }); }}
            >Clear</button>
            <button type="button" className="st-btn" disabled={busy} onClick={() => onIntent({ kind: 'next_stroke' })}>Next stroke</button>
            <button type="button" className="st-btn st-btn-ghost" disabled={busy} onClick={() => onIntent({ kind: 'next_character' })}>Next character</button>
          </div>

          {/* The way back. Mid-character the only exit used to be "Next
              character", which walks the teaching order forwards, so a learner
              who opened 永 by mistake had to cycle the whole set to leave it. */}
          <div className="st-switch">
            <span className="st-switch-label">Switch to</span>
            {state.catalog.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`st-switch-chip${entry.id === character?.id ? ' is-current' : ''}`}
                disabled={busy || entry.id === character?.id}
                title={`${entry.meaning} · ${entry.strokes_total} strokes`}
                aria-label={`Switch to ${entry.meaning}, ${entry.strokes_total} strokes`}
                onClick={() => onIntent({ kind: 'start_character', id: entry.id })}
              >{entry.glyph}</button>
            ))}
          </div>
        </>
      )}

      {refusal}
    </div>
  );
}
