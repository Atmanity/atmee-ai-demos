// @vitest-environment jsdom
//
// The sheet as a projection of the drill's views: which controls each phase
// offers (a button the drill would refuse reads as the drill being stuck),
// the way out always open, nothing pressable while Alex is not on the call,
// and the red card with the numbers, the exact line and one way off it.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { viewOf } from '../engine/drill.ts';
import { EMERGENCY_LINE, EMERGENCY_TITLE, SAFETY_LINE } from '../engine/lines.ts';
import { RECOVERY_POSITION } from '../engine/scenarios.ts';
import { BlsTutor } from '../engine/tutor.ts';
import type { View } from '../engine/types.ts';
import { Emergency } from './Emergency.tsx';
import { Sheet } from './Sheet.tsx';

afterEach(cleanup);

function sheet(view: View | null, over: { live?: boolean; failed?: boolean } = {}) {
  const onCommand = vi.fn();
  render(<Sheet view={view} live={over.live ?? true} busy={false} hint={null} notice={null} failed={over.failed} onCommand={onCommand} />);
  return onCommand;
}
const started = (id = RECOVERY_POSITION.id) => { const t = new BlsTutor(); t.startScenario(id); return t; };
const button = (name: string | RegExp) => screen.queryByRole('button', { name });

describe('the controls each phase offers', () => {
  test('a step being asked: show me and a hint, no next', () => {
    const onCommand = sheet(viewOf(started()));
    expect(button('Show me this step')).toBeTruthy();
    expect(button('Give me a hint')).toBeTruthy();
    expect(button(/Next step/)).toBeNull();
    fireEvent.click(button('Show me this step')!);
    expect(onCommand).toHaveBeenCalledWith('reveal');
  });

  test('a step resolved: next, no show me', () => {
    const t = started();
    t.reveal();
    const onCommand = sheet(viewOf(t));
    expect(button('Show me this step')).toBeNull();
    fireEvent.click(button(/Next step/)!);
    expect(onCommand).toHaveBeenCalledWith('next');
  });

  test('the last step resolved: the button says where it goes', () => {
    const t = started();
    for (let i = 0; i < RECOVERY_POSITION.steps.length - 1; i++) { t.reveal(); t.nextStep(); }
    t.reveal();
    sheet(viewOf(t));
    expect(button(/See your review/)).toBeTruthy();
  });

  test('the way out is open in every step phase', () => {
    const t = started();
    sheet(viewOf(t));
    expect(button('Choose another drill')).toBeTruthy();
    cleanup();
    t.reveal();
    sheet(viewOf(t));
    expect(button('Choose another drill')).toBeTruthy();
  });

  test('nothing is pressable while Alex is not on the call', () => {
    sheet(viewOf(started()), { live: false });
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled, b.textContent!).toBe(true);
  });

  test('the live step is drawn as a question, never as its words; locked steps as locks', () => {
    sheet(viewOf(started()));
    expect(screen.getByText('This step: your answer')).toBeTruthy();
    expect(screen.getAllByText('Locked')).toHaveLength(RECOVERY_POSITION.steps.length - 1);
    for (const step of RECOVERY_POSITION.steps) expect(document.body.textContent).not.toContain(step.label);
  });
});

describe('empty and loading', () => {
  test('setting up, and a set-up that failed says what to do', () => {
    sheet(null);
    expect(screen.getByText(/Alex is setting up your drill/)).toBeTruthy();
    cleanup();
    sheet(null, { failed: true });
    expect(screen.getByText(/Check your connection, then call Alex again/)).toBeTruthy();
  });

  test('the list of drills, when none is running', () => {
    const onCommand = sheet(viewOf(new BlsTutor()));
    expect(screen.getByRole('heading', { name: 'Choose a drill' })).toBeTruthy();
    fireEvent.click(button(/Choking at a dinner table/)!);
    expect(onCommand).toHaveBeenCalledWith('start', 'choking_adult');
  });
});

test('the red card: the numbers to dial, the exact line, one way off, and the safety line', () => {
  const onResume = vi.fn();
  render(<Emergency onResume={onResume} />);
  const card = screen.getByRole('alert');
  expect(card.textContent).toContain(EMERGENCY_TITLE);
  expect(card.textContent).toContain(EMERGENCY_LINE);
  expect(card.textContent).toContain(SAFETY_LINE);
  expect(card.querySelector('a[href="tel:911"]')).toBeTruthy();
  expect(card.querySelector('a[href="tel:112"]')).toBeTruthy();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /Nobody is in danger/ }));
  expect(onResume).toHaveBeenCalledOnce();
});
