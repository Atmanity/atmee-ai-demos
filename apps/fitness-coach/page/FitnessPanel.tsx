// The board, ported from the original panel's FitnessPanel.tsx (itself
// livekit_demos' FitnessVideoPanel). The markup and class names are the
// original's, so the layout is the one that was designed. What changed:
//
// - every choice has a control. The original took the starting move, a
//   re-level and later demos only by voice, through the agent's tools; the
//   Avatar API has no function calling, so plan moves are buttons ("Start
//   here", then "Demo"), the plan card has a "Rebuild as" level switch and a
//   "Start over" link;
// - the stage says up front when demos are off (known from the server before
//   any move is picked), instead of offering a demo that can never come;
// - "Rebuilding…" shows while a plan is being rebuilt for new limits, the
//   board's half of the original note's "the moves above are the OLD ones".
//
// Every branch decision lives in `board.ts`, where it is tested without a DOM.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  boardMode,
  emptySectionNotice,
  GOAL_COUNT,
  goalOptions,
  moveAction,
  moveCaption,
  NO_OPTIMISM,
  settleOptimism,
  TRAINING_GOAL_OPTIONS,
  videoLabel,
  type BoardStage,
  type PlanSection,
} from './board.ts';
import { baseMoveName } from '../engine/plan.ts';
import { constraintChips, type FitnessFlow, type FitnessPlan, type FitnessVideo } from './parsers.ts';

const LEVELS = [
  { name: 'Beginner', blurb: 'Steady, clear, joint-friendly' },
  { name: 'Intermediate', blurb: 'More pace and strength work' },
  { name: 'Advanced', blurb: 'Harder moves, higher intensity' },
];

/** A handler answers with the reason the tap was refused, or `null`. */
type Choose = (value: string) => Promise<string | null>;

export interface FitnessPanelProps {
  flow: FitnessFlow;
  plan: FitnessPlan | null;
  video: FitnessVideo | null;
  stage: BoardStage;
  /** Demo videos can be rendered in this session. */
  demos: boolean;
  /** The avatar is live: taps go somewhere. */
  live: boolean;
  /** A plan is being built at a new level while the old one is on screen. */
  planning: boolean;
  /** A rebuild for new limits is in flight. */
  rebuilding: boolean;
  seed: string;
  onSelectGoal: Choose;
  onSelectLevel: Choose;
  onChooseMove: Choose;
  onRestart: () => Promise<string | null>;
}

export function FitnessPanel(props: FitnessPanelProps) {
  const { flow, plan, video, stage, demos, live, planning, rebuilding, seed } = props;
  // Optimistic, and separate from `flow`: a tap has to look accepted before
  // the server's answer comes back, or the button feels broken.
  const [optimistic, setOptimistic] = useState(NO_OPTIMISM);
  const [optimisticMove, setOptimisticMove] = useState('');
  /** What the app said when it would not take the tap. */
  const [refusal, setRefusal] = useState('');

  const status = video?.status;
  const isBusy = status === 'generating';
  const mode = boardMode(flow, plan, video, optimistic);
  const { hold, showVideoStage, showSelectionCards, showLevelSelection, isPlanning } = mode;
  const { selectedGoal, selectedLevel } = mode;
  const topic = plan?.goal?.trim() || plan?.plan_title?.trim() || 'Your workout';
  const label = videoLabel(video, demos);
  // Which move the stage is about: the clip that plays has to be the move that was named.
  const caption = moveCaption(flow, video);
  const showCaptionRow = Boolean(caption) && status === 'ready';
  const action = hold ? '' : moveAction(stage, demos, live);
  const currentMove = (optimisticMove || flow.start_move).toLowerCase();

  // Six of twenty, seeded per session so a reload shows the same six; a goal
  // reached by speaking goes in front, so the highlight has something to mark.
  const goalChips = useMemo(() => goalOptions(TRAINING_GOAL_OPTIONS, GOAL_COUNT, selectedGoal, seed), [selectedGoal, seed]);

  // What the coach heard the user has to work around, drawn even before there
  // is a plan: seeing "20 min cap" appear is how the user knows they were heard.
  const chips = constraintChips(flow.constraints);

  useEffect(() => { if (plan) setOptimistic(NO_OPTIMISM); }, [plan]);
  // The app has published a goal of its own (from the tap, or from "actually,
  // glutes"): the guess is settled and must stop being preferred.
  useEffect(() => { setOptimistic((current) => settleOptimism('goal', current)); }, [flow.goal]);
  useEffect(() => { setOptimistic((current) => settleOptimism('level', current)); }, [flow.level]);
  useEffect(() => { setOptimisticMove(''); }, [flow.start_move]);

  const refuseWith = (undo: () => void) => (reason: string | null) => {
    if (!reason) return;
    // Not taken: drop the optimism rather than leave a button looking chosen.
    undo();
    setRefusal(reason);
  };

  const handleGoalClick = (goal: string) => {
    setOptimistic({ goal, level: '' });
    setRefusal('');
    void props.onSelectGoal(goal).then(refuseWith(() => setOptimistic(NO_OPTIMISM)));
  };

  const handleLevelClick = (level: string) => {
    setOptimistic((current) => ({ goal: current.goal, level }));
    setRefusal('');
    void props.onSelectLevel(level).then(refuseWith(() => setOptimistic((current) => ({ goal: current.goal, level: '' }))));
  };

  const handleMoveClick = (step: string) => {
    setOptimisticMove(baseMoveName(step));
    setRefusal('');
    void props.onChooseMove(step).then(refuseWith(() => setOptimisticMove('')));
  };

  const handleRelevel = (level: string) => {
    setRefusal('');
    void props.onSelectLevel(level).then(refuseWith(() => {}));
  };

  const handleRestart = () => {
    setRefusal('');
    void props.onRestart().then(refuseWith(() => {}));
  };

  const refusalNotice = refusal ? <p className="fitness-refusal" role="status">{refusal}</p> : null;

  // A plan step: a button when it can be picked, the original's plain text otherwise.
  const stepItem = (step: string, key: string) => {
    if (!action) return <li key={key}>{step}</li>;
    const current = Boolean(currentMove) && baseMoveName(step).toLowerCase() === currentMove;
    return (
      <li key={key}>
        <button type="button" className={`fitness-move${current ? ' fitness-move--current' : ''}`} aria-pressed={current} onClick={() => handleMoveClick(step)}>
          <span className="fitness-move__text">{step}</span>
          <span className="fitness-move__cta">{current ? (demos ? 'On stage' : 'Coaching') : action}</span>
        </button>
      </li>
    );
  };

  // A section the BANS emptied says so rather than vanishing: "safety beats
  // completeness", and a silently missing warm-up reads as a forgotten one.
  const section = (title: string, kind: PlanSection, body: ReactNode, empty: boolean) => {
    const emptied = empty ? emptySectionNotice(flow.constraints, kind) : '';
    if (empty && !emptied) return null;
    return (
      <div className={`fitness-list-block fitness-list-block--${kind}`}>
        <h4>{title}</h4>
        {empty ? <p className="fitness-list-block__empty">{emptied}</p> : body}
      </div>
    );
  };

  return (
    <div className={`fitness-stack${showVideoStage ? '' : ' fitness-stack--intro'}`}>
      {showVideoStage && (
        <div className="fitness-video-shell">
          <div className={`fitness-video-stage${showCaptionRow ? ' fitness-video-stage--captioned' : ''}`}>
            <div className="fitness-video-stage__topline">
              <span>{label}</span>
              {plan && <strong>{plan.level}</strong>}
            </div>
            {status === 'ready' && video?.videoUrl ? (
              <video key={video.requestId || video.videoUrl} className="fitness-video" src={video.videoUrl} controls autoPlay loop playsInline muted preload="metadata" />
            ) : isBusy ? (
              <div className="fitness-empty fitness-empty--loading" role="status">
                <div className="spinner spinner--fitness" />
                <h3>{caption ? `Rendering ${caption}` : 'Generating video…'}</h3>
                {/* Honest: grok-imagine-video takes 90-180 s. "Just take a second" was a promise the render could not keep. */}
                <p>This can take a minute or two — your coach will talk you through it.</p>
              </div>
            ) : status === 'error' ? (
              <div className="fitness-video-notice fitness-video-notice--error" role="status">
                <h3>Video generation failed</h3>
                {caption && <p className="fitness-video-notice__move">{caption}</p>}
                <p className="fitness-error-message">{video?.message ?? 'The demo could not be rendered.'}</p>
              </div>
            ) : status === 'unavailable' || !demos ? (
              /* Not an error: a session with no video key still coaches. */
              <div className="fitness-video-notice" role="status">
                <h3>Demo videos are off</h3>
                {flow.start_move && <p className="fitness-video-notice__move">Coaching: {flow.start_move}</p>}
                <p className="fitness-prompt">
                  {video?.message ?? 'Video demos are not switched on for this session.'} You will still be coached through every move.
                </p>
              </div>
            ) : (
              <div className="fitness-video-placeholder" role="status">
                <span>Choose a starting move</span>
                <p>Tap a move in the plan, or tell your coach. Its demo renders here.</p>
              </div>
            )}
            {showCaptionRow && <p className="fitness-video-stage__caption">Demoing: {caption}</p>}
          </div>
        </div>
      )}

      <div className="fitness-details-scroll">
        {/* First in the scroll: it is the reason nothing below it will change.
            Amber, not the error red and not the plan's green: this is caution. */}
        {hold && (
          <div className="fitness-card fitness-card--hold" role="status">
            <span className="fitness-topic__eyebrow fitness-topic__eyebrow--hold">Session on hold</span>
            <p className="fitness-hold-message">{hold}</p>
          </div>
        )}

        {plan && (
          <div className="fitness-card fitness-plan-card">
            <div className="fitness-topic">
              <div className="fitness-topic__row">
                <span className="fitness-topic__eyebrow">Workout Topic</span>
                {!hold && live && <button type="button" className="fitness-link" onClick={handleRestart}>Start over</button>}
              </div>
              <h3>{topic}</h3>
              <p>{plan.plan_title}</p>
            </div>

            <div className="fitness-metrics">
              <span>{plan.level}</span>
              <span>{plan.duration_minutes} min</span>
              <span>{plan.workout_steps.length} moves</span>
              {!hold && (rebuilding || planning) && (
                <span className="fitness-metrics__busy" role="status"><span className="spinner spinner--fitness spinner--small" />Rebuilding…</span>
              )}
            </div>

            {!hold && live && (
              <div className="fitness-relevel" role="group" aria-label="Rebuild the plan at another level">
                <span className="fitness-constraints__eyebrow">Rebuild as</span>
                <div className="fitness-relevel__options">
                  {LEVELS.map(({ name }) => {
                    const current = flow.level.toLowerCase() === name.toLowerCase();
                    return (
                      <button key={name} type="button" className={current ? 'fitness-choice--selected' : undefined} aria-pressed={current} disabled={current || planning} onClick={() => handleRelevel(name)}>
                        {name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {chips.length > 0 && (
              <div className="fitness-constraints">
                <span className="fitness-constraints__eyebrow">Built around</span>
                <div className="fitness-constraints__chips">
                  {chips.map((chip) => <span key={chip} className="fitness-chip">{chip}</span>)}
                </div>
              </div>
            )}

            {action === 'Start here' && <p className="fitness-prompt fitness-pick-hint">Pick the move to start with.</p>}

            <div className="fitness-section-grid">
              {section('Warm-up', 'warmup', <ul>{plan.warmup_steps.map((step, i) => stepItem(step, `wu-${i}`))}</ul>, plan.warmup_steps.length === 0)}
              {section('Workout', 'workout', <ol>{plan.workout_steps.map((step, i) => stepItem(step, `wo-${i}`))}</ol>, plan.workout_steps.length === 0)}
              {section('Form cues', 'cues', <ul>{plan.coaching_cues.map((cue, i) => <li key={`cq-${i}`}>{cue}</li>)}</ul>, plan.coaching_cues.length === 0)}
            </div>
          </div>
        )}

        {/* Before a plan exists the chips live on their own, so a limit given
            during onboarding is visibly banked rather than apparently ignored. */}
        {!plan && chips.length > 0 && (
          <div className="fitness-card fitness-constraints fitness-constraints--standalone">
            <span className="fitness-constraints__eyebrow">Heard</span>
            <div className="fitness-constraints__chips">
              {chips.map((chip) => <span key={chip} className="fitness-chip">{chip}</span>)}
            </div>
          </div>
        )}

        {refusal && !showSelectionCards && <div className="fitness-card fitness-card--refusal">{refusalNotice}</div>}

        {showSelectionCards && (
          <div className="fitness-card fitness-card--suggestions fitness-card--choice">
            <span className="fitness-topic__eyebrow">Start With A Goal</span>
            <h3>What do you want to train?</h3>
            <div className="fitness-suggestion-grid">
              {goalChips.map((goal) => {
                const isSelected = selectedGoal.toLowerCase() === goal.toLowerCase();
                return (
                  <button key={goal} type="button" className={isSelected ? 'fitness-choice--selected' : undefined} aria-pressed={isSelected} disabled={!live} onClick={() => handleGoalClick(goal)}>
                    {goal}
                  </button>
                );
              })}
            </div>
            {!live && <p className="fitness-prompt">Start the session to choose — or just tell your coach.</p>}
            {refusalNotice}
          </div>
        )}

        {showLevelSelection && (
          <div className="fitness-card fitness-card--level fitness-card--choice fitness-card--choice-delayed">
            <span className="fitness-topic__eyebrow">Goal Selected</span>
            <h3>{selectedGoal}</h3>
            <p className="fitness-prompt">Choose the level and your plan gets built.</p>
            <div className="fitness-level-grid">
              {LEVELS.map((level) => {
                const isSelected = selectedLevel.toLowerCase() === level.name.toLowerCase();
                return (
                  <button key={level.name} type="button" className={isSelected ? 'fitness-choice--selected' : undefined} aria-pressed={isSelected} disabled={!live} onClick={() => handleLevelClick(level.name)}>
                    <strong>{level.name}</strong>
                    <span>{level.blurb}</span>
                  </button>
                );
              })}
            </div>
            {isPlanning && (
              <div className="fitness-selection-status" role="status">
                <div className="spinner spinner--fitness" />
                <span>Setting up your {selectedLevel.toLowerCase()} {selectedGoal} plan…</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
