import { useState } from 'react';

import type { Intent } from '../engine/table.ts';
import type { MethodId, Snapshot } from '../engine/types.ts';
import { Parabola } from './Parabola.tsx';

/**
 * The board, rendered from the server's view and nothing else. Ported from the
 * original panel; the data layer (the platform's `useAppState`) is swapped for
 * props, and the equation box is new (the original could only be told an
 * equation out loud).
 *
 * There is no algebra in this file. A line of working the teacher has not
 * revealed is not here to be drawn: the server sends `remaining` as a number
 * and the panel draws that many blanks, which is the whole of what it knows.
 * (The view also carries the next line's sentence, staged for the avatar; the
 * panel never draws it.)
 *
 * The controls send the same intents the teacher's words do, so a misheard
 * "next" in front of a class is one tap away from being fixed. They are
 * disabled by what the view says the board will accept, so the teacher is
 * never offered a button whose refusal is already predictable.
 */

export const METHOD_LABELS: Record<MethodId, string> = {
  factoring: 'Factoring',
  completing_square: 'Completing the square',
  quadratic_formula: 'Quadratic formula',
};

/** The three, in teaching order, so the buttons do not reshuffle per equation. */
export const ALL_METHODS: MethodId[] = ['factoring', 'completing_square', 'quadratic_formula'];

export interface BoardPanelProps {
  view: Snapshot | null;
  /** Whether the board takes input (the session is live). */
  live: boolean;
  /** A request is on its way; the controls wait for it. */
  busy: boolean;
  /** The last refusal or misreading, shown under the board. */
  message: string;
  onIntent: (intent: Intent) => void;
  /** Resolves true when the equation went up, and the box clears. */
  onEquation: (text: string) => Promise<boolean> | boolean | void;
}

export function BoardPanel({ view, live, busy, message, onIntent, onEquation }: BoardPanelProps) {
  if (!view) {
    return (
      <div className="qw-panel">
        <div className="qw-loading" aria-live="polite">
          {live ? <span className="qw-spinner" /> : null}
          <span>{live ? 'Setting up the board…' : 'Start the session to put a quadratic on the board.'}</span>
        </div>
      </div>
    );
  }

  const { equation, facts } = view;
  const off = busy || !live;
  const hasMethod = view.method !== null;

  return (
    <div className="qw-panel">
      <header className="qw-head">
        <p className="qw-eyebrow">Quadratics</p>
        <h1 className="qw-equation">{equation ? equation.display : 'Board is clear'}</h1>
        {facts ? (
          <dl className="qw-facts">
            <div>
              <dt>Discriminant</dt>
              <dd>{facts.discriminant}</dd>
            </div>
            <div>
              <dt>Vertex</dt>
              <dd>{facts.vertex_display}</dd>
            </div>
            <div>
              <dt>Axis</dt>
              <dd>x = {facts.axis_display}</dd>
            </div>
            <div>
              <dt>Opens</dt>
              <dd>{facts.opens}</dd>
            </div>
          </dl>
        ) : null}
        <EquationEntry disabled={off} onEquation={onEquation} />
      </header>

      {!equation ? (
        <div className="qw-blank">
          <p>Name a quadratic to put it up.</p>
          <p className="qw-hint">Try “put up x squared minus four x plus three”, or type it in the box above.</p>
        </div>
      ) : (
        <div className={`qw-body${view.graph_visible ? '' : ' qw-body--no-graph'}`}>
          {view.graph_visible && facts ? <Parabola equation={equation} facts={facts} /> : null}

          <section className="qw-working" aria-label="Working">
            <div className="qw-working-head">
              <h2>{view.method_label ?? 'Choose a method'}</h2>
              {hasMethod ? (
                <span className="qw-count">
                  {view.revealed} / {view.total_steps}
                </span>
              ) : null}
            </div>

            {!hasMethod ? (
              <div className="qw-methods">
                {ALL_METHODS.map((method) => (
                  <MethodButton
                    key={method}
                    method={method}
                    available={view.methods_available.includes(method)}
                    busy={off}
                    onPick={() => onIntent({ kind: 'set_method', method })}
                  />
                ))}
              </div>
            ) : (
              <ol className="qw-steps">
                {view.steps.map((step) => (
                  <li key={step.n} className="qw-step">
                    <span className="qw-step-n">{step.n}</span>
                    <span className="qw-step-working">{step.working}</span>
                  </li>
                ))}
                {/* Placeholders, not content: the panel is not told what these
                    lines say, and drawing the count is the honest rendering of
                    "there is more to come". */}
                {Array.from({ length: view.remaining }, (_, index) => (
                  <li key={`blank-${index}`} className="qw-step qw-step--blank">
                    <span className="qw-step-n">{view.revealed + index + 1}</span>
                    <span className="qw-step-working" aria-label="not revealed yet" />
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}

      {message ? (
        <p className="qw-message" role="status">
          {message}
        </p>
      ) : null}

      <footer className="qw-controls">
        <button type="button" className="qw-btn" disabled={off || !hasMethod || view.revealed === 0} onClick={() => onIntent({ kind: 'back_step' })}>
          ‹ Back
        </button>
        <button type="button" className="qw-btn qw-btn--primary" disabled={off || !hasMethod || view.remaining === 0} onClick={() => onIntent({ kind: 'reveal_step' })}>
          Next line ›
        </button>
        <button type="button" className="qw-btn" disabled={off || !hasMethod || view.remaining === 0} onClick={() => onIntent({ kind: 'reveal_all' })}>
          Show all
        </button>
        <span className="qw-spacer" />
        <button type="button" className="qw-btn" disabled={off || !equation} onClick={() => onIntent({ kind: 'set_graph', visible: !view.graph_visible })}>
          {view.graph_visible ? 'Hide graph' : 'Show graph'}
        </button>
        <button type="button" className="qw-btn" disabled={off || !equation} onClick={() => onIntent({ kind: 'clear_board' })}>
          Clear
        </button>
      </footer>
    </div>
  );
}

/**
 * New in the port: an equation box. Typed maths ("x^2 - 4x + 3"), words
 * ("x squared minus four x plus three") or "a, b, c"; the server reads it.
 * The text stays when it could not be read, so it can be corrected.
 */
function EquationEntry({ disabled, onEquation }: { disabled: boolean; onEquation: BoardPanelProps['onEquation'] }) {
  const [text, setText] = useState('');
  const submit = async () => {
    const t = text.trim();
    if (!t || disabled) return;
    if (await onEquation(t)) setText('');
  };
  return (
    <form
      className="qw-entry"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="qw-entry-label" htmlFor="qw-entry-input">
        y =
      </label>
      <input
        id="qw-entry-input"
        className="qw-entry-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="x^2 - 4x + 3"
        aria-label="Equation"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
      />
      <button type="submit" className="qw-btn" disabled={disabled || !text.trim()}>
        Put up
      </button>
    </form>
  );
}

function MethodButton({ method, available, busy, onPick }: { method: MethodId; available: boolean; busy: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      className="qw-method"
      disabled={busy || !available}
      onClick={onPick}
      // Not a tooltip on a disabled control for decoration: this is the one
      // refusal the teacher would otherwise have to trigger to discover.
      title={available ? undefined : "This one doesn't factor over the rationals"}
    >
      {METHOD_LABELS[method]}
      {available ? null : <span className="qw-method-why">won’t factor</span>}
    </button>
  );
}
