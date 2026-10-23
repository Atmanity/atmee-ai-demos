// The range screen (ported from the panel's flight/RangePanel.tsx and
// rebuilt): the challenge brief, the chalkboard, the launcher's console with
// Fire, the last shot's numbers, the lesson once earned, and the six
// challenges.
//
// Everything rendered is the range's snapshot. Nothing here decides anything:
// not where a shot lands, not whether it cleared, not even when it has landed.
// It draws what it is given, asks for an aim when a finger lifts or a stepper
// is pressed and for a shot when Fire is pressed, and shows the latest
// refusal from any source: the host's account of it may be paraphrased.
import type { CSSProperties } from 'react';
import { CHALLENGES } from '../engine/challenges.ts';
import type { Press } from '../engine/controls.ts';
import type { RangeSnapshot } from '../engine/types.ts';
import { Field } from './Field.tsx';
import { HOST } from './Lobby.tsx';

const pad2 = (n: number) => String(n).padStart(2, '0');
const indexOf = (id: string) => CHALLENGES.findIndex((c) => c.id === id);

/** The challenge's conditions, as the screen names them. */
export function conditionsOf(state: RangeSnapshot): string[] {
  const c = state.challenge;
  const out = [`g ${c.gravity} m/s²${Math.abs(c.gravity - 9.81) > 0.01 ? ' · the Moon' : ''}`];
  out.push(c.wind_ms ? `${Math.abs(c.wind_ms)} m/s ${c.wind_ms < 0 ? 'headwind' : 'tailwind'}` : 'No wind');
  if (c.ceiling_m !== null) out.push(`Roof at ${c.ceiling_m} m`);
  if (state.limits.speed[1] < 40) out.push(`Speed capped at ${state.limits.speed[1]} m/s`);
  return out;
}

export function Brief({ state }: { state: RangeSnapshot }) {
  const { challenge } = state;
  return (
    <header className="aw-brief">
      <span className="aw-brief-n" aria-hidden="true">{pad2(indexOf(challenge.id) + 1)}</span>
      <div className="aw-brief-copy">
        <h1 className="aw-brief-name">{challenge.name}</h1>
        <p className="aw-brief-blurb">{challenge.blurb}</p>
        <ul className="aw-conditions" aria-label="Conditions">
          {conditionsOf(state).map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
    </header>
  );
}

/** The chalkboard, locked (with a word on why) until the host is on the call. */
export function Board({ state, seq, locked, onPress }: { state: RangeSnapshot; seq: number; locked: string | null; onPress: (p: Press) => void }) {
  return (
    <div className="aw-field">
      <Field state={state} seq={seq} locked={locked !== null} onAim={(aim) => onPress({ kind: 'aim', ...aim })} />
      {locked && <div className="aw-lock" role="status">{locked}</div>}
      {!locked && state.attempts === 0 && state.phase === 'aiming' && (
        <p className="aw-field-hint" aria-hidden="true">Drag up from the launcher to aim</p>
      )}
    </div>
  );
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** The launcher: the aim, with steppers for exact numbers, and Fire. */
export function Console({ state, seq, live, onPress }: { state: RangeSnapshot; seq: number; live: boolean; onPress: (p: Press) => void }) {
  const { aim, limits, phase } = state;
  const flying = phase === 'flying';
  const off = !live || flying;
  const set = (angle: number, speed: number) => onPress({ kind: 'aim', angle_deg: round1(angle), speed_ms: round1(speed) });
  const flightStyle = { '--aw-flight': `${state.last_shot?.play_s ?? 1}s` } as CSSProperties;
  return (
    <div className="aw-console">
      <Stepper
        label="Angle" value={`${aim.angle_deg}°`} disabled={off}
        down={aim.angle_deg > limits.angle[0] ? () => set(Math.max(limits.angle[0], aim.angle_deg - 1), aim.speed_ms) : null}
        up={aim.angle_deg < limits.angle[1] ? () => set(Math.min(limits.angle[1], aim.angle_deg + 1), aim.speed_ms) : null}
        unit="degree"
      />
      <Stepper
        label="Speed" value={`${aim.speed_ms} m/s`} disabled={off}
        down={aim.speed_ms > limits.speed[0] ? () => set(aim.angle_deg, Math.max(limits.speed[0], aim.speed_ms - 1)) : null}
        up={aim.speed_ms < limits.speed[1] ? () => set(aim.angle_deg, Math.min(limits.speed[1], aim.speed_ms + 1)) : null}
        unit="metre a second"
      />
      <button type="button" className={`aw-fire ${flying ? 'is-flying' : ''}`} disabled={off} onClick={() => onPress({ kind: 'fire' })}>
        {flying ? <><span>In the air</span><i key={seq} className="aw-fire-bar" style={flightStyle} aria-hidden="true" /></> : 'Fire'}
      </button>
    </div>
  );
}

function Stepper({ label, value, unit, disabled, down, up }: {
  label: string; value: string; unit: string; disabled: boolean; down: (() => void) | null; up: (() => void) | null;
}) {
  return (
    <div className="aw-stepper" role="group" aria-label={label}>
      <span className="aw-stepper-label">{label}</span>
      <span className="aw-stepper-value" aria-live="polite">{value}</span>
      <span className="aw-stepper-buttons">
        <button type="button" onClick={down ?? undefined} disabled={disabled || !down} aria-label={`${label} down one ${unit}`}>−</button>
        <button type="button" onClick={up ?? undefined} disabled={disabled || !up} aria-label={`${label} up one ${unit}`}>+</button>
      </span>
    </div>
  );
}

/** The last shot, in the range's numbers; nothing while it flies, because the snapshot has nothing. */
export function Result({ state, message }: { state: RangeSnapshot; message: string }) {
  const shot = state.last_shot;
  const landed = shot && state.phase !== 'flying' && shot.cleared !== undefined;
  return (
    <section className="aw-result" aria-label="Last shot" aria-live="polite">
      {message && <p className="aw-refusal" role="status">{message}</p>}
      {!shot && <p className="aw-result-empty">No shot yet. Drag the arrow or use the steppers, then fire; or tell {HOST} an angle.</p>}
      {shot && !landed && <p className="aw-result-flying">In the air…</p>}
      {landed && (
        <>
          <div className="aw-result-head">
            <span className={`aw-verdict ${shot.cleared ? 'is-cleared' : 'is-missed'}`}>{shot.cleared ? 'Cleared' : `Missed by ${shot.miss_m} m`}</span>
            <dl className="aw-stats">
              <div><dt>Distance</dt><dd>{shot.range_m} m</dd></div>
              <div><dt>Apex</dt><dd>{shot.apex_m} m</dd></div>
              <div><dt>In the air</dt><dd>{shot.flight_s} s</dd></div>
            </dl>
          </div>
          <p className="aw-note">{shot.note}</p>
          {state.phase === 'aiming' && <p className="aw-result-since">That was {shot.angle_deg}° at {shot.speed_ms} m/s; you have re-aimed since.</p>}
        </>
      )}
    </section>
  );
}

/** The teaching point, only once the challenge is cleared (the snapshot has none before). */
export function Lesson({ state, live, allCleared, onPress, onLogbook }: {
  state: RangeSnapshot; live: boolean; allCleared: boolean; onPress: (p: Press) => void; onLogbook: () => void;
}) {
  const { challenge, phase } = state;
  if (!challenge.teach || phase !== 'debrief') return null;
  return (
    <aside className="aw-lesson" aria-label="The lesson">
      <p className="aw-eyebrow">The lesson</p>
      <p className="aw-lesson-text">{challenge.teach}</p>
      <div className="aw-lesson-actions">
        {allCleared
          ? <button type="button" className="aw-primary" onClick={onLogbook}>All six cleared: open your logbook</button>
          : <button type="button" className="aw-primary" disabled={!live} onClick={() => onPress({ kind: 'next' })}>Next challenge <span aria-hidden="true">→</span></button>}
      </div>
    </aside>
  );
}

/** The six challenges, and starting this one over. */
export function Syllabus({ state, live, onPress }: { state: RangeSnapshot; live: boolean; onPress: (p: Press) => void }) {
  return (
    <nav className="aw-syllabus" aria-label="Challenges">
      <ol>
        {state.catalog.map((entry, i) => {
          const current = entry.id === state.challenge.id;
          return (
            <li key={entry.id}>
              <button
                type="button" className={`${current ? 'is-current' : ''} ${entry.cleared ? 'is-cleared' : ''}`}
                aria-current={current ? 'step' : undefined} disabled={!live}
                onClick={() => onPress({ kind: 'challenge', id: entry.id })}
              >
                <span className="aw-num" aria-hidden="true">{pad2(i + 1)}</span>
                <span className="aw-syllabus-name">{entry.name}</span>
                {entry.cleared && <span className="aw-tick" aria-label="cleared">✓</span>}
              </button>
            </li>
          );
        })}
      </ol>
      <button type="button" className="aw-quiet" disabled={!live || state.attempts === 0} onClick={() => onPress({ kind: 'reset' })}>Start over</button>
    </nav>
  );
}

/** The six challenges as pips: cleared, current, to come. */
export function Pips({ state }: { state: RangeSnapshot }) {
  const cleared = state.catalog.filter((e) => e.cleared).length;
  return (
    <ol className="aw-pips" aria-label={`${cleared} of ${state.catalog.length} challenges cleared`}>
      {state.catalog.map((e) => (
        <li key={e.id} className={`${e.cleared ? 'is-cleared' : ''} ${e.id === state.challenge.id ? 'is-current' : ''}`} title={e.name} />
      ))}
    </ol>
  );
}
