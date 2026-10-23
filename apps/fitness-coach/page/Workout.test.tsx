// @vitest-environment jsdom
// The screens, drawn from real coach views: every step offers its controls,
// the pause leaves nothing on screen that advances a workout (even before the
// server has confirmed it), and no screen uses the team's words.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Coach } from '../engine/coach.ts';
import { parseConstraints } from '../engine/constraints.ts';
import type { View } from '../engine/types.ts';
import { Lobby } from './Lobby.tsx';
import { stepParts, Workout, type WorkoutProps } from './Workout.tsx';

afterEach(cleanup);

const BANNED = /\b(session|avatar|api|atmee|demo|sample|mini-app|state|event|tool)s?\b/i;

const draw = (view: View | null, over: Partial<WorkoutProps> = {}) => {
  const props: WorkoutProps = {
    view, seed: 'abc', held: [], live: true, ended: false, host: 'Sammy', pending: null, refusal: '',
    onTap: vi.fn(), onSave: vi.fn(), ...over,
  };
  render(<Workout {...props} />);
  return props;
};

const withPlan = () => {
  const coach = new Coach({ seed: 'abc' });
  coach.command('goal', 'Full body');
  coach.command('level', 'Beginner');
  return coach;
};

const buttons = () => screen.queryAllByRole('button') as HTMLButtonElement[];
const text = () => document.body.textContent ?? '';

describe('the steps', () => {
  it('asks what to train with six goals, held until Sammy is on the call', () => {
    const props = draw(new Coach({ seed: 'abc' }).view(), { live: false });
    expect(screen.getByRole('heading', { name: 'What do you want to train?' })).toBeTruthy();
    expect(buttons()).toHaveLength(6);
    for (const b of buttons()) expect(b.disabled).toBe(true);
    cleanup();
    draw(new Coach({ seed: 'abc' }).view(), { onTap: props.onTap });
    fireEvent.click(buttons()[0]);
    expect(props.onTap).toHaveBeenCalledWith('goal', buttons()[0].querySelector('b')!.textContent);
  });

  it('deals the same six goals before the first screen arrives', () => {
    const view = new Coach({ seed: 'abc' }).view();
    draw(null, { live: false });
    expect(buttons().map((b) => b.querySelector('b')!.textContent)).toEqual(view.goalOptions);
    expect(text()).toContain('Sammy is getting your floor ready');
  });

  it('asks the level, and lets them pick another goal', () => {
    const coach = new Coach({ seed: 'abc' });
    coach.command('goal', 'Mobility');
    const props = draw(coach.view());
    fireEvent.click(screen.getByRole('button', { name: /Intermediate/ }));
    expect(props.onTap).toHaveBeenCalledWith('level', 'Intermediate');
    fireEvent.click(screen.getByRole('button', { name: 'Train something else' }));
    expect(screen.getByRole('heading', { name: 'What do you want to train?' })).toBeTruthy();
  });

  it('shows the plan being built, with the limits it will obey', () => {
    const coach = new Coach({ seed: 'abc', generatePlan: () => new Promise(() => {}) });
    coach.hear({ constraints: parseConstraints('only 20 minutes and a bad knee'), intent: null });
    coach.command('goal', 'Mobility');
    coach.command('level', 'Beginner');
    draw(coach.view());
    expect(screen.getByText('Sammy is building your plan…')).toBeTruthy();
    expect(screen.getByText('20 min cap')).toBeTruthy();
    expect(screen.getByText('Working around: knee')).toBeTruthy();
  });

  it('makes every move a button to start with, and offers a rebuild, a fresh start and the plan to keep', () => {
    const coach = withPlan();
    const plan = coach.view().plan!;
    const props = draw(coach.view());
    expect(screen.getAllByText('Start here')).toHaveLength(plan.warmup_steps.length + plan.workout_steps.length);
    fireEvent.click(screen.getByText(stepParts(plan.workout_steps[0]).name));
    expect(props.onTap).toHaveBeenCalledWith('move', plan.workout_steps[0]);
    expect((screen.getByRole('button', { name: 'Beginner' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(props.onTap).toHaveBeenCalledWith('relevel', 'Advanced');
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(props.onTap).toHaveBeenLastCalledWith('restart');
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(props.onSave).toHaveBeenCalled();
  });

  it('puts the move being coached on top, in words when there are no videos', () => {
    const coach = withPlan();
    coach.command('move', coach.view().plan!.workout_steps[3]);
    draw(coach.view());
    expect(screen.getByRole('heading', { name: 'Plank hold' })).toBeTruthy();
    expect(screen.getByText('30 seconds', { selector: '.sp-now-dose' })).toBeTruthy();
    expect(screen.getByText(/keep these in mind/)).toBeTruthy();
    expect(screen.getAllByText('Switch to').length).toBeGreaterThan(0);
    expect(screen.getByText('Now', { selector: '.sp-move-cta' })).toBeTruthy();
    expect(document.querySelector('video')).toBeNull();
  });

  it('shows a move video being made, then playing', () => {
    const view = withPlan().view();
    const coaching: View = { ...view, stage: 'coach', demos: true, flow: { ...view.flow, start_move: 'Plank hold' }, video: { status: 'generating', request_id: 'r1', prompt: '' } };
    draw(coaching);
    expect(screen.getByText(/Making a short video of Plank hold/)).toBeTruthy();
    cleanup();
    draw({ ...coaching, video: { status: 'ready', request_id: 'r1', prompt: '', video_url: '/api/apps/fitness-coach/clips/x' } });
    expect(document.querySelector('video')?.getAttribute('src')).toBe('/api/apps/fitness-coach/clips/x');
  });

  it('says what is being reworked while a rebuild is in flight', () => {
    draw({ ...withPlan().view(), rebuilding: true });
    expect(screen.getByText(/Sammy is reworking your plan/)).toBeTruthy();
    expect(screen.queryAllByText('Start here')).toHaveLength(0);
  });

  it('turns the plan into something to keep when the call ends', () => {
    const props = draw(withPlan().view(), { live: false, ended: true });
    expect(screen.getByText('Your plan is yours to keep.')).toBeTruthy();
    expect(screen.queryAllByText('Start here')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(props.onSave).toHaveBeenCalled();
  });

  it('shows why a tap was not taken', () => {
    draw(withPlan().view(), { refusal: 'Start over to change what you train.' });
    expect(screen.getByRole('status').textContent).toContain('Start over to change what you train.');
  });
});

describe('the safety pause', () => {
  const pregnant = () => {
    const coach = withPlan();
    coach.command('move', coach.view().plan!.workout_steps[0]);
    coach.hear({ constraints: parseConstraints("I'm 7 months pregnant"), intent: null });
    return coach;
  };

  it('leaves no exercise and nothing that advances a workout on the screen', () => {
    const coach = pregnant();
    draw({ ...coach.view(), demos: true, video: { status: 'ready', request_id: 'r', prompt: '', video_url: '/x' } });
    expect(screen.getByText('Paused for your safety')).toBeTruthy();
    expect(text()).toContain('pregnancy');
    expect(text()).toMatch(/doctor or a qualified health professional/);
    expect(buttons()).toHaveLength(0);
    expect(document.querySelector('video')).toBeNull();
    for (const step of [...coach.view().plan!.warmup_steps, ...coach.view().plan!.workout_steps]) expect(text()).not.toContain(stepParts(step).name);
  });

  it('pauses on what the page heard, before the server has confirmed it', () => {
    const coach = withPlan();
    draw(coach.view(), { held: ['a cardiac history'] });
    expect(screen.getByText('Paused for your safety')).toBeTruthy();
    expect(text()).toContain('a cardiac history');
    expect(buttons()).toHaveLength(0);
    expect(text()).not.toContain('Bodyweight squats');
  });
});

describe('the words on screen', () => {
  it('never uses the team’s words, on any screen', () => {
    const views: [View | null, Partial<WorkoutProps>][] = [
      [null, { live: false }],
      [new Coach({ seed: 'abc' }).view(), {}],
      [withPlan().view(), {}],
      [withPlan().view(), { ended: true, live: false }],
      [pregnantView(), {}],
    ];
    for (const [view, over] of views) {
      draw(view, over);
      expect(text(), view?.stage ?? 'loading').not.toMatch(BANNED);
      cleanup();
    }
    render(<Lobby host="Sammy" onStart={() => {}} />);
    expect(text()).not.toMatch(BANNED);
  });
});

function pregnantView() {
  const coach = withPlan();
  coach.hear({ constraints: parseConstraints('I had a heart attack last year'), intent: null });
  return coach.view();
}

describe('the front door', () => {
  it('starts a call by voice or by typing', () => {
    const onStart = vi.fn();
    render(<Lobby host="Sammy" onStart={onStart} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('A workout built around you.');
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Sammy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Type instead' }));
    expect(onStart.mock.calls).toEqual([[true], [false]]);
  });
});

describe('a plan step, split for the sheet', () => {
  it.each([
    ['Plank hold, 30 seconds', 'Plank hold', '30 seconds'],
    ['Bodyweight squats, 12 reps', 'Bodyweight squats', '12 reps'],
    ['Wall sit - 30 seconds', 'Wall sit', '30 seconds'],
    ['Dead bug', 'Dead bug', ''],
    ['Push-up (knees), 8 reps', 'Push-up (knees)', '8 reps'],
  ])('%s', (step, name, dose) => {
    expect(stepParts(step)).toEqual({ name, dose });
  });
});
