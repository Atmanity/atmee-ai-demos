import type { Intent, RangeSnapshot } from '../engine/types.ts';
import { Field } from './Field.tsx';
import { readout } from './scene.ts';

/**
 * The range: the drawing, the challenge, and what a hand can do (ported from
 * the panel's flight/RangePanel.tsx).
 *
 * Everything rendered is the range's snapshot. This component decides
 * nothing: not where a shot lands, not whether it cleared, not even when it
 * has landed. It draws what it is given, asks for `set_aim` when a finger
 * lifts and `fire` when the button is pressed, and shows the latest refusal,
 * from any source: a spoken request the range refused is on screen too, since
 * the avatar's account of it may be paraphrased.
 */
export function RangePanel({ state, seq, live, message, thinking, onIntent }: {
  state: RangeSnapshot;
  seq: number;
  /** The session is on: until then the launcher is locked. */
  live: boolean;
  message: string;
  /** The app's model is working out what a line meant. */
  thinking?: boolean;
  onIntent: (intent: Intent) => void;
}) {
  const { challenge, aim, last_shot: shot, phase } = state;
  const flying = phase === 'flying';
  const cleared = shot?.cleared === true;

  return (
    <div className="tc-panel">
      <header className="tc-header">
        <div>
          <span className="tc-title">{challenge.name}</span>
          <span className="tc-blurb">{challenge.blurb}</span>
        </div>
        <div className="tc-score">
          <span>{state.attempts === 1 ? '1 shot' : `${state.attempts} shots`}</span>
          {state.best_miss_m !== null && !cleared && <span className="tc-best">best miss {state.best_miss_m} m</span>}
        </div>
      </header>

      <div className="tc-stage">
        <Field state={state} seq={seq} locked={!live} onAim={(next) => onIntent({ kind: 'set_aim', ...next })} />
        {!live && <div className="tc-lock">Start the session to step up to the launcher.</div>}
      </div>

      <div className="tc-readout">
        <span className="tc-aim">{aim.angle_deg}° · {aim.speed_ms} m/s</span>
        <span className={`tc-result${cleared ? ' tc-result--cleared' : ''}`}>{readout(shot, phase)}</span>
        <button type="button" className="tc-fire" disabled={!live || flying} onClick={() => onIntent({ kind: 'fire' })}>
          {flying ? 'In the air' : 'Fire'}
        </button>
      </div>

      {shot?.note && !flying && <p className="tc-note">{shot.note}</p>}

      {/* The teaching point is only in the snapshot once the challenge has been
          cleared: printing it beside the aiming arrow would turn the exercise
          into reading. */}
      {challenge.teach && phase === 'debrief' && (
        <div className="tc-teach">
          <p>{challenge.teach}</p>
          <button type="button" className="tc-next" disabled={!live} onClick={() => onIntent({ kind: 'next_challenge' })}>Next challenge →</button>
        </div>
      )}

      <nav className="tc-catalog" aria-label="Challenges">
        {state.catalog.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`tc-chip${entry.id === challenge.id ? ' tc-chip--current' : ''}${entry.cleared ? ' tc-chip--cleared' : ''}`}
            disabled={!live}
            onClick={() => onIntent({ kind: 'start_challenge', id: entry.id })}
          >
            {entry.name}
          </button>
        ))}
        <button type="button" className="tc-chip tc-chip--ghost" disabled={!live || state.attempts === 0} onClick={() => onIntent({ kind: 'reset' })}>
          Start over
        </button>
      </nav>

      {message && <div className="tc-message" role="status">{message}</div>}

      <p className="tc-hint">
        {thinking ? 'Working out what you meant…' : (
          <>Drag from the launcher to aim, or just say it: <em>"try forty degrees"</em>, <em>"a bit harder"</em>, <em>"fire"</em>, <em>"why did that miss?"</em></>
        )}
      </p>
    </div>
  );
}
