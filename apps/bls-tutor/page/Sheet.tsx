// The drill sheet: what the learner works from, in every phase. It draws the
// server's view and nothing else: a step the learner has not resolved arrives
// with an empty label and is drawn as a question or a lock, never as words.
// Its pictogram stays hidden too, and so does the metronome, until the step
// is resolved: a phone icon or a 110-a-minute beat beside "what now?" would
// answer the question being asked.
import { useEffect, useMemo, useState } from 'react';
import { BUTTON } from '../engine/director.ts';
import type { CatalogEntry, Command, View } from '../engine/types.ts';
import { drillCard } from './drills.ts';
import { ArrowIcon, CheckIcon, Emblem, EyeIcon, LockIcon, Pictogram } from './icons.tsx';
import { Metronome } from './metronome.ts';

export interface SheetProps {
  view: View | null;
  /** The call is live: the drill's buttons work only then (Alex has to hear about them). */
  live: boolean;
  busy: boolean;
  hint: string | null;
  /** A refusal or a failure, as a sentence for the learner. */
  notice: string | null;
  /** The drill could not be set up. */
  failed?: boolean;
  /** A call is being placed or is on: with no drill yet, it is being set up. */
  calling?: boolean;
  onCommand: (command: Command, scenario?: string) => void;
}

export function Sheet(props: SheetProps) {
  const { view, failed, calling = true } = props;
  if (!view) {
    return (
      <section className="by-sheet is-loading" aria-busy={calling && !failed}>
        <div className="by-strip" />
        <div className="by-sheet-pad">
          {failed
            ? <p className="by-empty">We couldn't set up your drill. Check your connection, then call Alex again.</p>
            : calling
              ? <p className="by-empty"><span className="by-pulse" aria-hidden="true" /> Alex is setting up your drill…</p>
              : <p className="by-empty">Call Alex again to start your drill.</p>}
        </div>
      </section>
    );
  }
  if (view.phase === 'emergency') {
    return (
      <section className="by-sheet is-paused">
        <div className="by-strip" />
        <div className="by-sheet-pad">
          <p className="by-empty">Practice is paused.</p>
          {props.notice && <p className="by-notice" role="status">{props.notice}</p>}
        </div>
      </section>
    );
  }
  if (view.phase === 'intro' || !view.scenario) return <Menu {...props} catalog={view.catalog ?? []} />;
  if (view.phase === 'debrief') return <Review {...props} view={view} />;
  return <Drill {...props} view={view} />;
}

function SceneHead({ view }: { view: View }) {
  const s = view.scenario!;
  return (
    <header className="by-scene">
      <span className="by-scene-emblem"><Emblem id={s.id} size={28} /></span>
      <div>
        <p className="by-eyebrow">{drillCard(s.id)?.who ?? s.victim} · {view.steps?.length ?? 0} steps</p>
        <h2>{s.title}</h2>
        <p className="by-scene-text">{s.opening}</p>
      </div>
    </header>
  );
}

function Drill({ view, live, busy, hint, notice, onCommand }: SheetProps & { view: View }) {
  const n = view.steps?.length ?? 0;
  const k = (view.step_index ?? 0) + 1;
  const off = busy || !live;
  const verdict = view.last_verdict ?? null;
  const step = view.steps?.[view.step_index ?? 0];
  const answering = view.phase === 'answering';
  return (
    <section className="by-sheet" aria-label="Your drill">
      <div className="by-strip" />
      <SceneHead view={view} />
      <div className="by-sheet-body">
        <div className="by-step" aria-live="polite">
          <p className="by-step-n">Step {k} of {n}</p>
          {answering ? (
            <>
              <h3 className="by-question">{view.prompt}</h3>
              <p className="by-how">Say what you would do, or type it to Alex.</p>
              {verdict && !verdict.ok && (
                <div className="by-note is-nudge" role="status">
                  <b>Not yet</b>
                  <p>{verdict.note}</p>
                  <small>{view.attempts ?? 0} of 2 tries. After a second miss, Alex shows you the step.</small>
                </div>
              )}
              {hint && <div className="by-note is-hint" role="status"><b>Hint</b><p>{hint}</p></div>}
              <div className="by-actions">
                <button type="button" className="by-secondary" disabled={off} onClick={() => onCommand('reveal')}>{BUTTON.reveal}</button>
                {!hint && <button type="button" className="by-secondary" disabled={off} onClick={() => onCommand('hint')}>{BUTTON.hint}</button>}
              </div>
            </>
          ) : (
            <>
              {step?.outcome === 'shown'
                ? <p className="by-badge is-shown"><EyeIcon /> Shown to you</p>
                : <p className="by-badge is-got"><CheckIcon /> You got it</p>}
              <h3 className="by-label">{step?.label}</h3>
              {verdict?.note && (
                <div className="by-teach"><span className="by-teach-icon"><Pictogram kind={view.visual} /></span><p>{verdict.note}</p></div>
              )}
              {view.metronome_bpm ? <Beat bpm={view.metronome_bpm} /> : null}
              <div className="by-actions">
                <button type="button" className="by-primary" disabled={off} onClick={() => onCommand('next')}>
                  {k >= n ? 'See your review' : BUTTON.next} <ArrowIcon />
                </button>
              </div>
            </>
          )}
          {notice && <p className="by-notice" role="status">{notice}</p>}
          <button type="button" className="by-quiet" disabled={off} onClick={() => onCommand('leave')}>{BUTTON.leave}</button>
        </div>
        <Rail view={view} />
      </div>
    </section>
  );
}

/** The protocol, one rung per step: words only for the ones already resolved. */
function Rail({ view }: { view: View }) {
  return (
    <ol className="by-rail" aria-label="The steps">
      {(view.steps ?? []).map((s, i) => {
        const state = s.status === 'done' ? (s.outcome === 'shown' ? 'shown' : 'got') : s.status === 'current' ? 'now' : 'locked';
        return (
          <li key={s.key} className={`by-rung is-${state}`} aria-current={s.status === 'current' ? 'step' : undefined}>
            <span className="by-rung-sq">{i + 1}</span>
            <span className="by-rung-text">
              {s.status === 'done' ? s.label : s.status === 'current' ? 'This step: your answer' : <><LockIcon /> <span className="by-sr">Locked</span></>}
            </span>
            {s.status === 'done' && (
              <span className="by-rung-mark" title={s.outcome === 'shown' ? 'Shown to you' : 'You got it'} aria-label={s.outcome === 'shown' ? 'shown to you' : 'you got it'}>
                {s.outcome === 'shown' ? <EyeIcon /> : <CheckIcon />}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Review({ view, live, busy, onCommand }: SheetProps & { view: View }) {
  const steps = view.steps ?? [];
  const got = view.score.correct;
  const shown = steps.filter((s) => s.outcome === 'shown').length;
  const off = busy || !live;
  const others = (view.catalog ?? []).filter((c) => c.id !== view.scenario?.id);
  return (
    <section className="by-sheet is-review" aria-label="Your review">
      <div className="by-strip" />
      <div className="by-sheet-pad">
        <p className="by-eyebrow">Drill complete · {view.scenario!.title}</p>
        <p className="by-total"><b>{got}</b> of {steps.length} <span>steps on your own</span></p>
        <p className="by-review-line">
          {shown === 0 ? 'Every step, without help. Run it again in a week to keep it fresh.' : `Go over the ${shown === 1 ? 'step' : `${shown} steps`} marked “shown to you”: ${shown === 1 ? 'that is' : 'those are'} the ones to practise.`}
        </p>
        <ol className="by-review">
          {steps.map((s, i) => (
            <li key={s.key} className={`is-${s.outcome === 'shown' ? 'shown' : 'got'}`}>
              <span className="by-rung-sq">{i + 1}</span>
              <span className="by-review-label">{s.label}</span>
              <span className="by-review-mark">{s.outcome === 'shown' ? <><EyeIcon /> Shown to you</> : <><CheckIcon /> Got it</>}</span>
            </li>
          ))}
        </ol>
        <div className="by-actions">
          <button type="button" className="by-primary" disabled={off} onClick={() => onCommand('start', view.scenario!.id)}>Run this drill again</button>
          <button type="button" className="by-secondary" onClick={() => window.print()}>Print your review</button>
        </div>
        <h3 className="by-next-title">Try another drill</h3>
        <Cards catalog={others} disabled={off} onPick={(id) => onCommand('start', id)} />
      </div>
    </section>
  );
}

function Menu({ catalog, live, busy, notice, onCommand }: SheetProps & { catalog: CatalogEntry[] }) {
  return (
    <section className="by-sheet" aria-label="Choose a drill">
      <div className="by-strip" />
      <div className="by-sheet-pad">
        <p className="by-eyebrow">Four scenes, one step at a time</p>
        <h2 className="by-menu-title">Choose a drill</h2>
        <p className="by-how">Tap one, or tell Alex which you'd like.</p>
        <Cards catalog={catalog} disabled={busy || !live} onPick={(id) => onCommand('start', id)} />
        {notice && <p className="by-notice" role="status">{notice}</p>}
      </div>
    </section>
  );
}

function Cards({ catalog, disabled, onPick }: { catalog: CatalogEntry[]; disabled: boolean; onPick: (id: string) => void }) {
  return (
    <ul className="by-cards">
      {catalog.map((c) => (
        <li key={c.id}>
          <button type="button" className="by-card" disabled={disabled} onClick={() => onPick(c.id)}>
            <span className="by-card-emblem"><Emblem id={c.id} /></span>
            <span className="by-card-text">
              <b>{c.title}</b>
              <span>{drillCard(c.id)?.teaser ?? `${c.victim} · ${c.steps} steps`}</span>
              <small>{drillCard(c.id)?.who ?? c.victim} · {c.steps} steps</small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The compression beat: a click and a pulse at the drill's own rate, for a step already taught. */
function Beat({ bpm }: { bpm: number }) {
  const [on, setOn] = useState(false);
  const metronome = useMemo(() => new Metronome(), []);
  useEffect(() => {
    if (on) metronome.start(bpm);
    else metronome.stop();
    return () => metronome.stop();
  }, [on, bpm, metronome]);
  return (
    <button type="button" className={`by-beat ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => setOn((v) => !v)}
      style={{ ['--by-beat' as string]: `${60 / bpm}s` }}>
      <span className="by-beat-dot" aria-hidden="true" />
      {on ? 'Stop the beat' : 'Practise to the beat'} · {bpm} a minute
    </button>
  );
}

