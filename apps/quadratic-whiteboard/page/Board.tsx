// The board, its tray and the lesson recap, drawn from the server's view and
// nothing else. Ported from the original panel; the equation box and the
// recap are new.
//
// There is no algebra in this file. A line of working the teacher has not
// revealed is not here to be drawn: the server sends `remaining` as a number
// and the board draws that many chalk blanks, which is the whole of what it
// knows.
//
// The tray's keys send the same intents the host's tools do, so a misheard
// "next" in front of a class is one tap away from being fixed. They are
// disabled by what the view says the board will accept, so the teacher is
// never offered a key whose refusal is already predictable.
import { useState } from 'react';
import type { Intent } from '../engine/table.ts';
import type { MethodId, Snapshot } from '../engine/types.ts';
import { HOST } from './brand.tsx';
import { maths, type NoteEntry } from './notes.ts';
import { Parabola } from './Parabola.tsx';

export const METHOD_LABELS: Record<MethodId, string> = {
  factoring: 'Factoring',
  completing_square: 'Completing the square',
  quadratic_formula: 'Quadratic formula',
};

const METHOD_BLURBS: Record<MethodId, string> = {
  factoring: 'Two numbers that multiply and add',
  completing_square: 'Shows where the vertex comes from',
  quadratic_formula: 'Works on every quadratic',
};

/** The three, in teaching order, so the choices do not reshuffle per equation. */
export const ALL_METHODS: MethodId[] = ['factoring', 'completing_square', 'quadratic_formula'];

/** Equations to start from on a clean board: one of each kind of answer. */
export const EXAMPLES: { typed: string; shown: string; why: string }[] = [
  { typed: 'x^2 - 5x + 6', shown: 'y = x² − 5x + 6', why: 'Factors neatly' },
  { typed: 'x^2 - 4x + 1', shown: 'y = x² − 4x + 1', why: 'Roots in surds' },
  { typed: '2x^2 + 3x + 5', shown: 'y = 2x² + 3x + 5', why: 'No real roots' },
];

// Chalk blanks of uneven length, so the unrevealed lines read as lines to come, not a progress bar.
const BLANK_WIDTHS = ['72%', '58%', '84%', '46%', '66%', '78%', '52%'];

/** Before the first view: being set up, failed to set up, or waiting for a call (after one ended early). */
export type BoardStatus = 'loading' | 'failed' | 'idle' | 'ready';

export interface BoardProps {
  view: Snapshot | null;
  status: BoardStatus;
  /** Whether the board takes input (the call is live). */
  live: boolean;
  /** A request is on its way; the controls wait for it. */
  busy: boolean;
  /** The last refusal or misreading, shown on the board. */
  message: string;
  onRetry?: () => void;
  onIntent: (intent: Intent) => void;
  /** Resolves true when the equation went up. */
  onEquation: (text: string) => Promise<boolean> | boolean | void;
}

export function Board({ view, status, live, busy, message, onRetry, onIntent, onEquation }: BoardProps) {
  const off = busy || !live;
  if (!view) {
    return (
      <section className="cl-board is-waiting" aria-label="The board">
        {status === 'failed' ? (
          <div className="cl-setting" role="alert">
            <p>The board didn’t load.</p>
            {onRetry && <button type="button" className="cl-chalk-btn" onClick={onRetry}>Try again</button>}
          </div>
        ) : status === 'idle' ? (
          <div className="cl-setting">
            <p>Call {HOST} to set up your board.</p>
          </div>
        ) : (
          <div className="cl-setting" aria-busy="true" aria-live="polite">
            <span className="cl-dust" aria-hidden="true" />
            <p>{HOST} is setting up your board…</p>
          </div>
        )}
      </section>
    );
  }

  const { equation, facts } = view;
  return (
    <section className="cl-board" aria-label="The board">
      {!equation || !facts ? (
        <div className="cl-clean">
          <p className="cl-clean-title">A clean board.</p>
          <p className="cl-clean-text">Ask {HOST} to put an equation up, like “put up x squared minus five x plus six”, or start from one of these:</p>
          <ul className="cl-examples">
            {EXAMPLES.map((example) => (
              <li key={example.typed}>
                <button type="button" disabled={off} onClick={() => void onEquation(example.typed)}>
                  <span className="cl-example-eq">{example.shown}</span>
                  <span className="cl-example-why">{example.why}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <header className="cl-board-head">
            <h1 className="cl-eq">{maths(equation.display)}</h1>
            <dl className="cl-facts">
              <div><dt>Discriminant</dt><dd>{maths(facts.discriminant)}</dd></div>
              <div><dt>Vertex</dt><dd>{maths(facts.vertex_display)}</dd></div>
              <div><dt>Axis</dt><dd>{`x = ${maths(facts.axis_display)}`}</dd></div>
              <div><dt>Opens</dt><dd>{facts.opens}</dd></div>
            </dl>
          </header>
          <div className={`cl-body${view.graph_visible ? '' : ' is-algebra'}`}>
            {view.graph_visible && <Parabola equation={equation} facts={facts} />}
            <section className="cl-working" aria-label="Working">
              {view.method ? <Working view={view} off={off} onIntent={onIntent} /> : <Methods view={view} off={off} onIntent={onIntent} />}
            </section>
          </div>
        </>
      )}
      {message && <p className="cl-message" role="status">{message}</p>}
    </section>
  );
}

function Methods({ view, off, onIntent }: { view: Snapshot; off: boolean; onIntent: (intent: Intent) => void }) {
  return (
    <div className="cl-choose">
      <h2 className="cl-ask">How shall we solve it?</h2>
      <p className="cl-ask-hint">Say the method, or pick one.</p>
      <div className="cl-methods">
        {ALL_METHODS.map((method) => {
          const available = view.methods_available.includes(method);
          return (
            <button
              key={method}
              type="button"
              className="cl-method"
              disabled={off || !available}
              onClick={() => onIntent({ kind: 'set_method', method })}
              // Not decoration on a disabled control: this is the one refusal the
              // teacher would otherwise have to trigger to discover.
              title={available ? undefined : 'This one doesn’t factor over the rationals'}
            >
              <span className="cl-method-name">{METHOD_LABELS[method]}</span>
              <span className="cl-method-blurb">{available ? METHOD_BLURBS[method] : 'Won’t factor over the rationals'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Working({ view, off, onIntent }: { view: Snapshot; off: boolean; onIntent: (intent: Intent) => void }) {
  const solved = view.remaining === 0 && view.total_steps > 0;
  const others = view.methods_available.filter((m) => m !== view.method);
  const key = (n: number) => `${view.equation?.display}-${view.method}-${n}`;
  return (
    <>
      <div className="cl-working-head">
        <h2>{view.method_label}</h2>
        <span className="cl-count">{view.revealed} of {view.total_steps}<span className="cl-sr"> lines shown</span></span>
      </div>
      <ol className="cl-lines">
        {view.steps.map((step) => (
          <li key={key(step.n)} className={`cl-line${solved && step.n === view.total_steps ? ' is-answer' : ''}`}>
            <span className="cl-line-n">{step.n}</span>
            <span className="cl-line-text">{maths(step.working)}</span>
          </li>
        ))}
        {/* Placeholders, not content: the board is not told what these lines
            say, and drawing the count is the honest rendering of "more to come". */}
        {Array.from({ length: view.remaining }, (_, i) => (
          <li key={key(view.revealed + i + 1)} className="cl-line is-blank">
            <span className="cl-line-n">{view.revealed + i + 1}</span>
            <span className="cl-line-text" style={{ width: BLANK_WIDTHS[(view.revealed + i) % BLANK_WIDTHS.length] }}><span className="cl-sr">Not revealed yet</span></span>
          </li>
        ))}
      </ol>
      {solved && (
        <div className="cl-solved">
          <span className="cl-stamp">Solved</span>
          {others.length > 0 && (
            <span className="cl-also">
              <span>Also try</span>
              {others.map((method) => (
                <button key={method} type="button" className="cl-chalk-btn" disabled={off} onClick={() => onIntent({ kind: 'set_method', method })}>
                  {METHOD_LABELS[method]}
                </button>
              ))}
            </span>
          )}
        </div>
      )}
    </>
  );
}

/** The tray under the board: a key for every spoken request, and the equation box. */
export function Tray({ view, live, busy, onIntent, onEquation }: Omit<BoardProps, 'status' | 'message' | 'onRetry'>) {
  const off = busy || !live || !view;
  const hasMethod = Boolean(view?.method);
  return (
    <section className="cl-tray" aria-label="Board controls">
      <div className="cl-keys">
        <button type="button" className="cl-key" disabled={off || !hasMethod || view!.revealed === 0} onClick={() => onIntent({ kind: 'back_step' })}>
          <span aria-hidden="true">‹ </span>Back
        </button>
        <button type="button" className="cl-key is-next" disabled={off || !hasMethod || view!.remaining === 0} onClick={() => onIntent({ kind: 'reveal_step' })}>
          Next line<span aria-hidden="true"> ›</span>
        </button>
        <button type="button" className="cl-key" disabled={off || !hasMethod || view!.remaining === 0} onClick={() => onIntent({ kind: 'reveal_all' })}>
          Show all
        </button>
        <button type="button" className="cl-key" disabled={off || !view!.equation} onClick={() => onIntent({ kind: 'set_graph', visible: !view!.graph_visible })}>
          {view?.graph_visible === false ? 'Show graph' : 'Hide graph'}
        </button>
        <button type="button" className="cl-key is-quiet" disabled={off || !view!.equation} onClick={() => onIntent({ kind: 'clear_board' })}>
          Clear
        </button>
      </div>
      <EquationBox disabled={off} onEquation={onEquation} />
    </section>
  );
}

/**
 * The equation box: typed maths ("x^2 - 4x + 3"), words ("x squared minus
 * four x plus three") or "a, b, c"; the server reads it. The text stays when
 * it could not be read, so it can be corrected.
 */
function EquationBox({ disabled, onEquation }: { disabled: boolean; onEquation: BoardProps['onEquation'] }) {
  const [text, setText] = useState('');
  const submit = async () => {
    const t = text.trim();
    if (!t || disabled) return;
    if (await onEquation(t)) setText('');
  };
  return (
    <form className="cl-write" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <label className="cl-write-label" htmlFor="cl-write-input">y =</label>
      <input
        id="cl-write-input" className="cl-write-input" value={text} onChange={(e) => setText(e.target.value)}
        placeholder="x^2 - 5x + 6" aria-label="Equation" autoComplete="off" spellCheck={false} disabled={disabled}
      />
      <button type="submit" className="cl-key is-write" disabled={disabled || !text.trim()}>Write it up</button>
    </form>
  );
}

/** The lesson's done moment: every equation the class saw, and the notes to keep. */
export function Recap({ notes, onDownload }: { notes: NoteEntry[]; onDownload: () => void }) {
  const solved = notes.filter((entry) => entry.answer).length;
  return (
    <section className="cl-recap" aria-label="Today’s board">
      <div className="cl-recap-head">
        <div>
          <p className="cl-eyebrow">Today’s board</p>
          <h2>
            {notes.length} {notes.length === 1 ? 'equation' : 'equations'}, {solved} solved
          </h2>
        </div>
        <button type="button" className="cl-primary" onClick={onDownload}>Download lesson notes</button>
      </div>
      <ol className="cl-recap-list">
        {notes.map((entry) => (
          <li key={entry.equation}>
            <span className="cl-recap-eq">{maths(entry.equation)}</span>
            <span className="cl-recap-methods">
              {entry.worked.length ? entry.worked.map((w) => (
                <span key={w.method} className={w.lines.length === w.total ? 'is-done' : ''}>
                  {w.label}{w.lines.length < w.total ? ` · ${w.lines.length} of ${w.total} lines` : ''}
                </span>
              )) : <span>No working shown</span>}
            </span>
            {entry.answer && <span className="cl-recap-answer">{maths(entry.answer)}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

