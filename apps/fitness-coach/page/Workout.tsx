// Spotter's main screen: one panel per step of the session, drawn only from
// the server's view (and, for the safety pause, from what the page itself
// heard a moment earlier).
//
//   goal -> level -> building -> the plan sheet (pick a first move)
//        -> the plan sheet with "Now" on top (coaching a move)
//   any step -> paused for safety: no exercise is shown again
//
// Every choice Sammy can be asked for out loud is also a control here; a tap
// acts at once and Sammy is told what happened.
import { useEffect, useState } from 'react';
import { baseMoveName, findStep } from '../engine/plan.ts';
import type { Command, View } from '../engine/types.ts';
import {
  boardMode, emptySectionNotice, GOAL_COUNT, goalOptions, moveAction, moveCaption, TRAINING_GOAL_OPTIONS, videoLabel,
  type BoardStage, type PlanSection,
} from './board.ts';
import { clearanceNotice, constraintChips, INITIAL_FLOW, parseSnapshot, type FitnessFlow, type FitnessPlan, type FitnessVideo } from './parsers.ts';

export interface Pending { command: Command; value: string }

export interface WorkoutProps {
  /** The server's view; null while the first one is on its way. */
  view: View | null;
  /** Deals the six goals before the first view arrives (the server deals them with the same seed). */
  seed: string;
  /** Conditions the page itself heard: the pause shows at once, before the server confirms. */
  held: string[];
  /** The call is live: taps reach Sammy. */
  live: boolean;
  /** The call has ended: the plan becomes something to keep. */
  ended: boolean;
  host: string;
  /** A tap still on its way to the server. */
  pending: Pending | null;
  /** Why the last tap was not taken. */
  refusal: string;
  onTap: (command: Command, value?: string) => void;
  onSave: () => void;
}

/** One line under each goal: what the workout will feel like. */
const GOAL_NOTES: Record<string, string> = {
  'Full body': 'Every major muscle in one go',
  'Fat-loss HIIT': 'Short bursts, short rests',
  'Core + cardio': 'A steady trunk and a raised heart rate',
  'Mobility': 'Joints that move the way they should',
  'Glutes + legs': 'Hips, glutes and everything below',
  'Upper body strength': 'Push, pull and hold',
  'Low-impact sweat': 'Real effort, no jumping',
  'Stretch + recovery': 'Slow, easy and restoring',
  'Posture reset': 'Open the chest, wake up the back',
  'Beginner strength': 'The basic patterns, done well',
  'Quick morning energy': 'A short start to the day',
  'Desk break mobility': 'Undo a day of sitting',
  'Cardio conditioning': 'Build your engine',
  'Balance + stability': 'Steadier on one leg',
  'Bodyweight burn': 'No kit, honest effort',
  'Joint-friendly strength': 'Strength that is kind to joints',
  'Athletic power': 'Fast, springy, explosive',
  'Pilates core': 'Control from the centre',
  'Back + shoulders': 'The muscles behind you',
  'Weekend reset': 'Loosen up and feel good',
};

const LEVELS: [string, string][] = [
  ['Beginner', 'New to this, or coming back after a break'],
  ['Intermediate', 'You train most weeks'],
  ['Advanced', 'Years of steady, hard training'],
];

/** A plan step split into the move's name and its dosage: "Plank hold, 30 seconds" -> ["Plank hold", "30 seconds"]. */
export function stepParts(step: string): { name: string; dose: string } {
  const name = baseMoveName(step);
  const at = step.toLowerCase().indexOf(name.toLowerCase());
  const rest = at >= 0 ? `${step.slice(0, at)} ${step.slice(at + name.length)}` : '';
  const dose = rest.replace(/\s+/g, ' ').replace(/^[\s,:;–—-]+|[\s,:;–—-]+$/g, '').replace(/\s+of$/i, '').trim();
  return { name, dose };
}

const unique = (items: string[]) => [...new Set(items.filter(Boolean))];

export function Workout(props: WorkoutProps) {
  const { view, held, live, ended, host, pending, refusal, onTap } = props;
  const snap = view ? parseSnapshot(view) : null;
  const flow = snap?.flow ?? INITIAL_FLOW;
  const plan = snap?.plan ?? null;
  const video = snap?.video ?? null;
  const conditions = unique([...(flow.constraints.clearance ?? []), ...held]);
  const optimistic = { goal: pending?.command === 'goal' ? pending.value : '', level: pending?.command === 'level' ? pending.value : '' };
  const mode = boardMode(flow, plan, video, optimistic);
  const stage: BoardStage = conditions.length ? 'hold' : view?.stage ?? 'goal';
  const notice = refusal ? <p className="sp-refusal" role="status">{refusal}</p> : null;

  if (stage === 'hold') return <Hold conditions={conditions} host={host} />;

  if (stage === 'goal' || stage === 'level' || stage === 'planning') {
    const goals = view?.goalOptions ?? goalOptions(TRAINING_GOAL_OPTIONS, GOAL_COUNT, mode.selectedGoal, props.seed);
    return (
      <div className="sp-stage">
        {notice}
        {stage === 'goal' && <GoalPicker goals={goals} selected={mode.selectedGoal} live={live && !pending} ready={Boolean(view)} host={host} onPick={(goal) => onTap('goal', goal)} />}
        {stage === 'level' && <LevelPicker goals={goals} goal={mode.selectedGoal} selected={mode.selectedLevel} live={live && !pending} host={host} onTap={onTap} />}
        {stage === 'planning' && <Building flow={flow} host={host} />}
        <Heard flow={flow} host={host} />
        {ended && <p className="sp-ended-note">Call {host} again to pick up where you left off.</p>}
      </div>
    );
  }

  // A plan is on the screen: picking a first move, or coaching one.
  const demos = view?.demos ?? false;
  const coaching = stage === 'coach' && !ended;
  return (
    <div className="sp-stage">
      {notice}
      {ended && plan && (
        <section className="sp-done" aria-label="Your plan to keep">
          <div>
            <p className="sp-eyebrow">Nice work today</p>
            <h2>Your plan is yours to keep.</h2>
            <p>Save it for next time, or call {host} again to keep going.</p>
          </div>
          <button type="button" className="sp-primary" onClick={props.onSave}>Save plan</button>
        </section>
      )}
      {coaching && plan && <NowMove flow={flow} plan={plan} video={video} demos={demos} host={host} />}
      {plan && (
        <PlanSheet
          plan={plan} flow={flow} stage={stage} live={live && !ended} demos={demos} cues={!(coaching && !hasVideo(video, demos))}
          working={Boolean(view?.planning || view?.rebuilding)} pending={pending} host={host} onTap={onTap} onSave={props.onSave} ended={ended}
        />
      )}
    </div>
  );
}

function GoalPicker({ goals, selected, live, ready, host, onPick }: { goals: string[]; selected: string; live: boolean; ready: boolean; host: string; onPick: (goal: string) => void }) {
  return (
    <section className="sp-panel" aria-labelledby="sp-goal-h">
      <p className="sp-eyebrow">Step 1 · Goal</p>
      <h2 id="sp-goal-h">What do you want to train?</h2>
      <p className="sp-panel-lede">{live ? `Tap one, or tell ${host} in your own words.` : ready ? `Tap one once ${host} is with you, or just tell her.` : `${host} is getting your floor ready…`}</p>
      <ul className="sp-tiles">
        {goals.map((goal, i) => {
          const chosen = selected.toLowerCase() === goal.toLowerCase();
          return (
            <li key={goal}>
              <button type="button" className={`sp-tile${chosen ? ' is-chosen' : ''}`} aria-pressed={chosen} disabled={!live} onClick={() => onPick(goal)}>
                <span className="sp-tile-n">{String(i + 1).padStart(2, '0')}</span>
                <b>{goal}</b>
                {GOAL_NOTES[goal] && <span className="sp-tile-note">{GOAL_NOTES[goal]}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LevelPicker({ goals, goal, selected, live, host, onTap }: { goals: string[]; goal: string; selected: string; live: boolean; host: string; onTap: WorkoutProps['onTap'] }) {
  const [changing, setChanging] = useState(false);
  useEffect(() => setChanging(false), [goal]);
  if (changing) return <GoalPicker goals={goals} selected={goal} live={live} ready host={host} onPick={(next) => onTap('goal', next)} />;
  return (
    <section className="sp-panel" aria-labelledby="sp-level-h">
      <p className="sp-eyebrow">Step 2 · Level</p>
      <h2 id="sp-level-h">How experienced are you?</h2>
      <p className="sp-panel-lede">Training <b>{goal}</b>. Your plan is built the moment you choose.</p>
      <ul className="sp-levels">
        {LEVELS.map(([level, note], i) => {
          const chosen = selected.toLowerCase() === level.toLowerCase();
          return (
            <li key={level}>
              <button type="button" className={`sp-level${chosen ? ' is-chosen' : ''}`} aria-pressed={chosen} disabled={!live} onClick={() => onTap('level', level)}>
                <LevelBars n={i + 1} />
                <b>{level}</b>
                <span>{note}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {live && <button type="button" className="sp-quiet" onClick={() => setChanging(true)}>Train something else</button>}
    </section>
  );
}

function LevelBars({ n }: { n: number }) {
  return (
    <svg className="sp-bars" viewBox="0 0 30 20" width="30" height="20" aria-hidden="true">
      {[0, 1, 2].map((i) => <rect key={i} x={i * 11} y={14 - i * 6} width="8" height={6 + i * 6} rx="1.5" className={i < n ? 'is-on' : ''} />)}
    </svg>
  );
}

function Building({ flow, host }: { flow: FitnessFlow; host: string }) {
  return (
    <section className="sp-panel sp-building" role="status" aria-live="polite">
      <p className="sp-eyebrow">Step 3 · Plan</p>
      <h2>{host} is building your plan…</h2>
      <p className="sp-panel-lede"><b>{flow.level}</b> · {flow.goal}</p>
      <div className="sp-skeleton" aria-hidden="true">
        <span style={{ width: '62%' }} /><span style={{ width: '40%' }} /><span style={{ width: '84%' }} /><span style={{ width: '71%' }} /><span style={{ width: '55%' }} />
      </div>
    </section>
  );
}

/** What was heard to work around, before there is a plan to show it on. */
function Heard({ flow, host }: { flow: FitnessFlow; host: string }) {
  const chips = constraintChips(flow.constraints);
  return (
    <div className="sp-heard">
      {chips.length > 0 ? (
        <>
          <span className="sp-label">Your plan will work around</span>
          <span className="sp-chips">{chips.map((chip) => <span key={chip} className="sp-chip">{chip}</span>)}</span>
        </>
      ) : (
        <p className="sp-hint">Anything to work around? Tell {host} any time: “only 20 minutes”, “no equipment”, “my knee is sore”.</p>
      )}
    </div>
  );
}

/** The move video has a place on the screen (videos are on and one was asked for). */
const hasVideo = (video: FitnessVideo | null, demos: boolean) => demos && Boolean(video) && video!.status !== 'unavailable';

function NowMove({ flow, plan, video, demos, host }: { flow: FitnessFlow; plan: FitnessPlan; video: FitnessVideo | null; demos: boolean; host: string }) {
  const step = findStep(plan, flow.start_move);
  const { name, dose } = step ? stepParts(step) : { name: flow.start_move, dose: '' };
  const caption = moveCaption(flow, video);
  const status = video?.status;
  const showVideo = hasVideo(video, demos);
  return (
    <section className="sp-now" aria-labelledby="sp-now-h">
      <div className="sp-now-head">
        <p className="sp-eyebrow is-on">Now</p>
        <h2 id="sp-now-h">{name}</h2>
        {dose && <p className="sp-now-dose">{dose}</p>}
      </div>
      {showVideo ? (
        <div className={`sp-clip is-${status}`}>
          <span className="sp-clip-label">{videoLabel(video, demos)}</span>
          {status === 'ready' && video?.videoUrl ? (
            <video key={video.requestId || video.videoUrl} src={video.videoUrl} controls autoPlay loop playsInline muted preload="metadata" aria-label={`${caption || name}, shown by a trainer`} />
          ) : status === 'generating' ? (
            <div className="sp-clip-wait" role="status"><span className="sp-spinner" aria-hidden="true" /><p>Making a short video of {caption || name}. It takes a minute or two; {host} will talk you through the setup meanwhile.</p></div>
          ) : (
            <div className="sp-clip-wait" role="status"><p>The video didn’t come through. {host} is coaching it in words.</p></div>
          )}
        </div>
      ) : (
        <div className="sp-form">
          <p className="sp-label">Listen for {host}’s setup, then keep these in mind</p>
          <ul>{plan.coaching_cues.slice(0, 4).map((cue) => <li key={cue}>{cue}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

function PlanSheet({ plan, flow, stage, live, demos, cues, working, pending, host, ended, onTap, onSave }: {
  plan: FitnessPlan; flow: FitnessFlow; stage: BoardStage; live: boolean; demos: boolean; cues: boolean; working: boolean;
  pending: Pending | null; host: string; ended: boolean; onTap: WorkoutProps['onTap']; onSave: () => void;
}) {
  const action = moveAction(stage, demos, live && !working);
  const current = (pending?.command === 'move' ? baseMoveName(pending.value) : flow.start_move).toLowerCase();
  const chips = constraintChips(flow.constraints);
  const rows = (steps: string[]) => steps.map((step, i) => {
    const { name, dose } = stepParts(step);
    const now = Boolean(current) && name.toLowerCase() === current;
    const label = now ? 'Now' : action;
    const body = (
      <>
        <span className="sp-move-n">{String(i + 1).padStart(2, '0')}</span>
        <span className="sp-move-name">{name}{dose && <small>{dose}</small>}</span>
        {label && <span className="sp-move-cta">{label}</span>}
      </>
    );
    return (
      <li key={`${step}-${i}`}>
        {action && !now
          ? <button type="button" className="sp-move" onClick={() => onTap('move', step)} disabled={Boolean(pending)}>{body}</button>
          : <div className={`sp-move is-static${now ? ' is-now' : ''}`}>{body}</div>}
      </li>
    );
  });
  const section = (title: string, kind: PlanSection, steps: string[]) => {
    const emptied = steps.length ? '' : emptySectionNotice(flow.constraints, kind);
    if (!steps.length && !emptied) return null;
    return (
      <section className={`sp-part is-${kind}`} aria-label={title}>
        <h3>{title}</h3>
        {steps.length ? <ol className="sp-moves">{rows(steps)}</ol> : <p className="sp-emptied">{emptied}</p>}
      </section>
    );
  };
  return (
    <article className={`sp-sheet${working ? ' is-working' : ''}`} aria-labelledby="sp-plan-h">
      <header className="sp-sheet-head">
        <p className="sp-eyebrow">Your plan · {plan.goal || flow.goal}</p>
        <h2 id="sp-plan-h">{plan.plan_title}</h2>
        <ul className="sp-meta">
          <li><b>{plan.duration_minutes}</b> min</li>
          <li><b>{plan.workout_steps.length}</b> moves</li>
          <li>{plan.level}</li>
        </ul>
        {chips.length > 0 && (
          <p className="sp-around"><span className="sp-label">Built around</span>{chips.map((chip) => <span key={chip} className="sp-chip">{chip}</span>)}</p>
        )}
        {working && <p className="sp-working" role="status"><span className="sp-spinner is-small" aria-hidden="true" />{host} is reworking your plan…</p>}
      </header>
      {stage === 'move' && live && !working && <p className="sp-pick">Pick your first move: tap it, or tell {host}.</p>}
      <div className="sp-parts">
        {section('Warm-up', 'warmup', plan.warmup_steps)}
        {section('Workout', 'workout', plan.workout_steps)}
      </div>
      {cues && plan.coaching_cues.length > 0 && (
        <section className="sp-cues" aria-label="Form cues">
          <h3>Form cues</h3>
          <ul>{plan.coaching_cues.map((cue) => <li key={cue}>{cue}</li>)}</ul>
        </section>
      )}
      <footer className="sp-sheet-foot">
        {live && (
          <div className="sp-relevel" role="group" aria-label="Rebuild the plan at another level">
            <span className="sp-label">Level</span>
            {LEVELS.map(([level]) => {
              const on = flow.level.toLowerCase() === level.toLowerCase();
              return <button key={level} type="button" aria-pressed={on} className={on ? 'is-on' : ''} disabled={on || working || Boolean(pending)} onClick={() => onTap('relevel', level)}>{level}</button>;
            })}
          </div>
        )}
        <span className="sp-foot-actions">
          {live && <button type="button" className="sp-quiet" onClick={() => onTap('restart')} disabled={Boolean(pending)}>Start over</button>}
          {!ended && <button type="button" className="sp-secondary" onClick={onSave}>Save plan</button>}
        </span>
      </footer>
    </article>
  );
}

function Hold({ conditions, host }: { conditions: string[]; host: string }) {
  return (
    <div className="sp-stage">
      <section className="sp-hold" role="status" aria-labelledby="sp-hold-h">
        <p className="sp-eyebrow is-stop">Paused for your safety</p>
        <h2 id="sp-hold-h">Let’s stop here for today.</h2>
        <p className="sp-hold-lede">{clearanceNotice({ clearance: conditions })}</p>
        <h3>What to do next</h3>
        <ol>
          <li>Talk to your doctor or a qualified health professional about exercising.</li>
          <li>Once they’ve cleared you, come back and {host} will build your plan from the start.</li>
        </ol>
        <p className="sp-small">Your workout is put away and won’t be shown on this call.</p>
      </section>
    </div>
  );
}
