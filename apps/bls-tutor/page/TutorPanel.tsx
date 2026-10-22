// The drill, rendered from the server's snapshots and nothing else. Ported from
// the original panel: only its data source changed (props in place of the
// platform's useAppState, with the same {state, send, pending} shape).
//
// There is no scenario content in this file, no grading, and no notion of what
// the next step is: a step the learner has not reached arrives with an empty
// label and is drawn locked. That is the app's central safety property, and it
// is enforced server-side; the page simply has nothing to leak. (The view's
// `staged` block is for the avatar's state and is never drawn.)
//
// View state (metronome on/off, the answer being typed) stays here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EMERGENCY_TITLE } from '../engine/lines.ts';
import { Metronome } from './metronome.ts';
import { visualFor, type Intent, type Snapshot } from './snapshot.ts';

/** What the drill said to an intent: applied, or refused with the sentence to show. */
export interface SendResult {
  applied: boolean;
  reason?: string;
}

export function TutorPanel({ state, send, pending }: {
  state: Snapshot | null;
  /** Sends one intent; never throws (a failure comes back as a refusal). */
  send: (intent: Intent) => Promise<SendResult>;
  /** An intent is in flight, or the avatar is not live: the drill's controls wait. */
  pending: boolean;
}) {
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState('');
  const [metronomeOn, setMetronomeOn] = useState(false);
  const metronome = useMemo(() => new Metronome(), []);
  const metronomeRef = useRef(metronome);
  metronomeRef.current = metronome;

  /** Send one intent; a refusal becomes a line on screen, never a throw. */
  const intend = useCallback(
    async (intent: Intent) => {
      const result = await send(intent);
      setMessage(result.applied ? '' : result.reason ?? '');
      return result.applied;
    },
    [send],
  );

  const bpm = state?.metronome_bpm ?? null;
  useEffect(() => {
    const m = metronomeRef.current;
    if (metronomeOn && bpm) m.start(bpm);
    else m.stop();
    return () => m.stop();
  }, [metronomeOn, bpm]);

  // A step without a rate is a step without a metronome, including when the
  // learner left it running on the previous one.
  useEffect(() => {
    if (!bpm) setMetronomeOn(false);
  }, [bpm]);

  if (!state) {
    return (
      <div className="bls-panel">
        <div className="bls-loading" aria-live="polite">
          <span className="bls-spinner" />
          <span>Setting up the drill…</span>
        </div>
      </div>
    );
  }

  if (state.phase === 'emergency') {
    // Fixed over the whole page, not just this column: on a phone the panel
    // sits below the avatar, and this card must not be one scroll away.
    return (
      <div className="bls-emergency" role="alert">
        <div className="bls-emergency-mark">✚</div>
        <h1>{EMERGENCY_TITLE}</h1>
        <p className="bls-emergency-line">{state.emergency_message}</p>
        <button type="button" className="bls-btn bls-btn-ghost" onClick={() => void intend({ kind: 'ack_safety' })}>
          Nobody is in danger — back to practice
        </button>
        {/* The refusal has to be reachable from EVERY branch that can send an
            intent, not just the main one. `ack_safety` cannot be refused today,
            so this renders nothing today; but an early return that owns a
            button and not the message is how a learner ends up stuck on this
            card with the explanation sitting in a variable two lines up. */}
        {message ? <p className="bls-message" role="status">{message}</p> : null}
        <footer className="bls-safety">{state.safety_notice}</footer>
      </div>
    );
  }

  const steps = state.steps ?? [];
  const verdict = state.last_verdict ?? null;
  const scenario = state.scenario;
  const visual = visualFor(state.visual);

  // Which controls the drill will actually accept right now. Offering the
  // others is not a cosmetic slip: every mid-scenario phase refuses two of the
  // three, so a learner who pressed "Show me" one beat after being taught the
  // step got "We're between steps — say *next* when you're ready", a sentence
  // that reads as the drill being stuck, right after the instructor had asked
  // them a question out loud.
  const answering = state.phase === 'answering';
  const coaching = state.phase === 'coaching';

  return (
    <div className="bls-panel">
      <header className="bls-head">
        <div>
          <p className="bls-eyebrow">BLS practice</p>
          <h1>{scenario ? scenario.title : 'Choose a scenario'}</h1>
        </div>
        {/* Out of the steps in the SCENARIO, not out of the steps reached so
            far: mid-drill `total` counts rungs opened, so step one of a six-step
            scenario read "0 / 1" beside a six-rung ladder. Nothing has been
            scored at the menu, so the chip appears with a scenario. */}
        {state.phase === 'intro' ? null : (
          <div className="bls-score" aria-label="score">
            <strong>{state.score.correct}</strong>
            <span>/ {Math.max(state.score.total, steps.length)}</span>
          </div>
        )}
      </header>

      {state.phase === 'intro' || state.phase === 'debrief' ? (
        <section className="bls-menu">
          {state.phase === 'debrief' ? (
            <>
              <p className="bls-debrief">
                Scenario complete — {state.score.correct} of {state.score.total} steps in one go. Pick another when you're ready.
              </p>
              {/* The review. A score with no list of what went wrong is the one
                  thing a learner cannot act on, and by the debrief every rung is
                  resolved so every label has already been earned. */}
              {steps.length > 0 && (
                <ol className="bls-review" aria-label="What you got">
                  {steps.map((step, index) => (
                    <li key={step.key} className={`bls-review-row is-${step.outcome ?? 'correct'}`}>
                      <span className="bls-rung-index">{index + 1}</span>
                      <span className="bls-rung-label">{step.label}</span>
                      <span className="bls-review-mark">{step.outcome === 'shown' ? 'shown to you' : 'got it'}</span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : (
            <p className="bls-debrief">Pick a scenario. Your instructor will set the scene and ask you what you'd do, one step at a time.</p>
          )}
          <div className="bls-menu-grid">
            {(state.catalog ?? []).map((entry) => (
              <button key={entry.id} type="button" className="bls-card" disabled={pending} onClick={() => void intend({ kind: 'start_scenario', id: entry.id })}>
                <span className="bls-card-title">{entry.title}</span>
                <span className="bls-card-meta">{entry.victim} · {entry.steps} steps</span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <>
          <section className="bls-scene">
            <div className="bls-visual" aria-hidden="true">
              <span className="bls-glyph">{visual.glyph}</span>
              <span className="bls-visual-caption">{visual.caption}</span>
            </div>
            <div className="bls-scene-text">
              {scenario ? <p className="bls-opening">{scenario.opening}</p> : null}
              {state.prompt ? <p className="bls-prompt">{state.prompt}</p> : null}
              {bpm ? (
                <button type="button" className={`bls-btn bls-btn-ghost${metronomeOn ? ' is-on' : ''}`} onClick={() => setMetronomeOn((on) => !on)}>
                  {metronomeOn ? 'Stop' : 'Start'} metronome · {bpm} bpm
                </button>
              ) : null}
            </div>
          </section>

          <ol className="bls-ladder">
            {steps.map((step, index) => (
              <li key={step.key} className={`bls-rung is-${step.status}${step.outcome ? ` outcome-${step.outcome}` : ''}`}>
                <span className="bls-rung-index">{index + 1}</span>
                <span className="bls-rung-label">
                  {/* A rung has words only once it is answered or revealed. The
                      live one is the question being asked out loud, so it says
                      so rather than printing its own answer. */}
                  {step.status === 'current' ? 'This step — your answer?' : step.status === 'hidden' ? '—' : step.label}
                </span>
                {step.status === 'done' ? (
                  // A rung you were handed is not a rung you got.
                  <span
                    className="bls-rung-tick"
                    title={step.outcome === 'shown' ? 'Shown to you' : 'You got this'}
                    aria-label={step.outcome === 'shown' ? 'shown to you' : 'you got this'}
                  >
                    {step.outcome === 'shown' ? '!' : '✓'}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>

          {verdict ? (
            <p className={`bls-verdict${verdict.ok ? ' is-ok' : ''}`} role="status">
              {verdict.note}
            </p>
          ) : null}

          <form
            className="bls-answer"
            onSubmit={(event) => {
              event.preventDefault();
              const text = draft.trim();
              if (!text) return;
              const current = steps.find((step) => step.status === 'current');
              setDraft('');
              void intend({ kind: 'answer', step_key: current?.key ?? '', text });
            }}
          >
            <input
              type="text"
              value={draft}
              disabled={!answering}
              aria-label="What would you do?"
              placeholder={answering ? 'What would you do?' : "Say next when you're ready"}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" className="bls-btn" disabled={pending || !answering}>
              Answer
            </button>
          </form>

          <div className="bls-actions">
            <button type="button" className="bls-btn bls-btn-ghost" disabled={pending || !answering} onClick={() => void intend({ kind: 'reveal' })}>
              Show me
            </button>
            <button type="button" className="bls-btn bls-btn-ghost" disabled={pending || !coaching} onClick={() => void intend({ kind: 'next' })}>
              Next step
            </button>
            {/* The way out. Mid-scenario the only control that moved anything
                was "Next step", which refuses an unanswered step on purpose, so
                a learner who wanted a different scenario had no door at all. */}
            <button type="button" className="bls-btn bls-btn-ghost bls-btn-leave" disabled={pending} onClick={() => void intend({ kind: 'leave_scenario' })}>
              Back to scenarios
            </button>
          </div>
        </>
      )}

      {message ? <p className="bls-message" role="status">{message}</p> : null}

      {/* Permanent, in every phase. Not a dismissible banner. */}
      <footer className="bls-safety">{state.safety_notice}</footer>
    </div>
  );
}
