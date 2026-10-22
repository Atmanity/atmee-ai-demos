// @vitest-environment jsdom
// The board drawn, for the controls that replaced the original agent's tools
// (move taps, "Rebuild as", "Start over") and for the hold, which must leave
// nothing on the board that advances the workout.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFallbackPlan } from '../engine/plan.ts';
import { FitnessPanel, type FitnessPanelProps } from './FitnessPanel.tsx';
import { INITIAL_FLOW } from './parsers.ts';

afterEach(cleanup);

const plan = buildFallbackPlan('Full body', 'Beginner');
const none = async () => null;
const props = (over: Partial<FitnessPanelProps> = {}): FitnessPanelProps => ({
  flow: INITIAL_FLOW, plan: null, video: null, stage: 'goal', demos: false, live: true, planning: false, rebuilding: false, seed: 'abc',
  onSelectGoal: none, onSelectLevel: none, onChooseMove: none, onRestart: none,
  ...over,
});
const withPlan = (over: Partial<FitnessPanelProps> = {}) => props({
  flow: { ...INITIAL_FLOW, step: 'plan_ready', goal: 'Full body', level: 'Beginner' }, plan, stage: 'move', ...over,
});

describe('the board', () => {
  it('offers six goals, and holds them until the session is live', () => {
    render(<FitnessPanel {...props({ live: false })} />);
    const goals = screen.getAllByRole('button');
    expect(goals).toHaveLength(6);
    for (const goal of goals) expect((goal as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Start the session to choose/)).toBeTruthy();
  });

  it('shows a tapped goal as chosen at once, and the reason when it is refused', async () => {
    const onSelectGoal = vi.fn(async () => 'Start over to change what you train.');
    render(<FitnessPanel {...props({ onSelectGoal })} />);
    const first = screen.getAllByRole('button')[0];
    fireEvent.click(first);
    expect(onSelectGoal).toHaveBeenCalledWith(first.textContent);
    expect(await screen.findByText('Start over to change what you train.')).toBeTruthy();
  });

  it('makes every plan move a button to start with, and says when demos are off', () => {
    const onChooseMove = vi.fn(none);
    render(<FitnessPanel {...withPlan({ onChooseMove })} />);
    const starts = screen.getAllByText('Start here');
    expect(starts).toHaveLength(plan.warmup_steps.length + plan.workout_steps.length);
    fireEvent.click(screen.getByText(plan.workout_steps[0]));
    expect(onChooseMove).toHaveBeenCalledWith(plan.workout_steps[0]);
    expect(screen.getByText('Demo videos are off')).toBeTruthy();
  });

  it('offers a demo of any move once coaching, and marks the one on stage', () => {
    render(<FitnessPanel {...withPlan({ stage: 'coach', demos: true, flow: { ...INITIAL_FLOW, step: 'plan_ready', goal: 'Full body', level: 'Beginner', start_move: 'Plank hold' }, video: { status: 'generating', requestId: 'r1', prompt: '' } })} />);
    expect(screen.getAllByText('Demo').length).toBe(plan.warmup_steps.length + plan.workout_steps.length - 1);
    expect(screen.getByText('On stage')).toBeTruthy();
    expect(screen.getByText('Rendering Plank hold')).toBeTruthy();
  });

  it('rebuilds at another level and starts over from the plan card', () => {
    const onSelectLevel = vi.fn(none);
    const onRestart = vi.fn(none);
    render(<FitnessPanel {...withPlan({ onSelectLevel, onRestart })} />);
    expect((screen.getByRole('button', { name: 'Beginner' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(onSelectLevel).toHaveBeenCalledWith('Advanced');
    fireEvent.click(screen.getByText('Start over'));
    expect(onRestart).toHaveBeenCalled();
  });

  it('says the plan is being rebuilt while a rebuild is in flight', () => {
    render(<FitnessPanel {...withPlan({ rebuilding: true })} />);
    expect(screen.getByText('Rebuilding…')).toBeTruthy();
  });

  it('leaves nothing that advances the workout under a hold', () => {
    render(<FitnessPanel {...withPlan({
      stage: 'hold', demos: true,
      flow: { ...INITIAL_FLOW, step: 'plan_ready', goal: 'Full body', level: 'Beginner', start_move: 'Plank hold', constraints: { clearance: ['pregnancy'] } },
      video: { status: 'ready', requestId: 'r1', prompt: '', videoUrl: '/api/apps/fitness-coach/clips/x' },
    })} />);
    expect(screen.getByText('Session on hold')).toBeTruthy();
    expect(screen.getByText(/not able to program a workout around that/)).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.querySelector('video')).toBeNull();
  });
});
