// @vitest-environment jsdom
//
// The panel as a projection: snapshots in, intents out, nothing decided here
// (ported from the original TutorPanel.test.tsx; the scripted agent on the far
// side of the platform's bridge became a scripted `send`).
//
// What this pins is the panel's half: render the drill it was given, send an
// intent per action, show a refusal, never draw a step it was not given, and
// keep the safety line on screen in every phase.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMERGENCY_LINE, EMERGENCY_TITLE } from '../engine/lines.ts';
import type { View } from '../engine/types.ts';
import type { Intent, Snapshot } from './snapshot.ts';
import { TutorPanel, type SendResult } from './TutorPanel.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SAFETY = 'This is CPR practice, not certification, and not medical advice. In a real emergency call 911.';

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    phase: 'answering',
    scenario: { id: 'adult_cardiac_arrest', title: 'Adult collapse in a café', victim: 'adult', opening: 'A man has slumped off his chair.' },
    step_index: 1,
    steps: [
      { key: 'scene_safe', label: 'Check the scene is safe', status: 'done' },
      // The server strips the live rung's label: it is the question.
      { key: 'call_911', label: '', status: 'current' },
      { key: 'compressions', label: '', status: 'hidden' },
    ],
    attempts: 0,
    score: { correct: 1, total: 2 },
    last_verdict: null,
    prompt: 'No response, and he is only gasping. What now?',
    visual: 'phone_aed',
    metronome_bpm: null,
    safety_ack: true,
    safety_notice: SAFETY,
    ...over,
  };
}

/** A scripted drill on the far side of `send`. */
function fakeAgent(initial: Snapshot) {
  const intents: Intent[] = [];
  let onIntent: (intent: Intent) => SendResult = () => ({ applied: false, reason: 'unscripted' });
  let push: (s: Snapshot) => void = () => {};
  function Host() {
    const [state, setState] = useState<Snapshot>(initial);
    push = setState;
    return <TutorPanel state={state} pending={false} send={async (intent) => { intents.push(intent); return onIntent(intent); }} />;
  }
  return {
    Host,
    intents,
    script(fn: (intent: Intent) => SendResult) { onIntent = fn; },
    broadcast(snap: Snapshot) { act(() => push(snap)); },
  };
}

/** Render the panel against a scripted drill. */
function mount(initial: Snapshot) {
  const agent = fakeAgent(initial);
  render(<agent.Host />);
  return agent;
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => { vi.useRealTimers(); });
afterEach(cleanup);

describe('TutorPanel', () => {
  it('renders the ladder it was given and locks the step it was not', async () => {
    const agent = fakeAgent(snapshot());
    render(<agent.Host />);
    // The live rung is the question, so it shows a prompt and not its label.
    expect(await screen.findByText('This step — your answer?')).toBeTruthy();
    expect(screen.getByText('Check the scene is safe')).toBeTruthy();   // answered
    // The third rung has no label in the snapshot, so it has none on screen.
    expect(screen.queryByText(/compressions/i)).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('sends an answer for the CURRENT step, not the one the user typed about', async () => {
    const agent = fakeAgent(snapshot());
    agent.script(() => ({ applied: true }));
    render(<agent.Host />);
    fireEvent.change(screen.getByLabelText('What would you do?'), { target: { value: 'call 911 and get an AED' } });
    click('Answer');
    await waitFor(() => expect(agent.intents.length).toBe(1));
    expect(agent.intents[0]).toEqual({ kind: 'answer', step_key: 'call_911', text: 'call 911 and get an AED' });
  });

  it('shows a refusal instead of pretending the intent landed', async () => {
    // Driven through an intent the panel still OFFERS: a refusal the drill
    // returns for any reason still has to reach the learner.
    const agent = fakeAgent(snapshot());
    agent.script(() => ({ applied: false, reason: "You haven't answered this step yet." }));
    render(<agent.Host />);
    click('Show me');
    expect(await screen.findByText("You haven't answered this step yet.")).toBeTruthy();
    expect(agent.intents[0]).toEqual({ kind: 'reveal' });
  });

  it('asks to be shown a step, with no rules of its own', async () => {
    const agent = fakeAgent(snapshot());
    agent.script(() => ({ applied: true }));
    render(<agent.Host />);
    click('Show me');
    await waitFor(() => expect(agent.intents.length).toBe(1));
    expect(agent.intents[0]).toEqual({ kind: 'reveal' });
  });

  it('starts a scenario from the menu', async () => {
    const agent = fakeAgent(snapshot({
      phase: 'intro', scenario: null, steps: [], prompt: null, score: { correct: 0, total: 0 },
      catalog: [{ id: 'choking_adult', title: 'Choking at a dinner table', victim: 'adult', steps: 6 }],
    }));
    agent.script(() => ({ applied: true }));
    render(<agent.Host />);
    click(/Choking at a dinner table/);
    await waitFor(() => expect(agent.intents.length).toBe(1));
    expect(agent.intents[0]).toEqual({ kind: 'start_scenario', id: 'choking_adult' });
  });

  it('replaces everything with the emergency card and keeps the safety line', async () => {
    const agent = fakeAgent(snapshot());
    render(<agent.Host />);
    await screen.findByText('This step — your answer?');
    agent.broadcast({ phase: 'emergency', scenario: null, score: { correct: 1, total: 2 }, safety_ack: true, safety_notice: SAFETY, emergency_message: EMERGENCY_LINE });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/hang up and call 911/)).toBeTruthy();
    // The drill is gone, not merely covered.
    expect(screen.queryByText('This step — your answer?')).toBeNull();
    expect(screen.queryByText('Check the scene is safe')).toBeNull();
    expect(screen.getByText(SAFETY)).toBeTruthy();
  });

  it('keeps the safety line on screen while practising', async () => {
    mount(snapshot());
    expect(await screen.findByText(SAFETY)).toBeTruthy();
  });

  it('offers the metronome only on a step that carries a rate', async () => {
    const agent = fakeAgent(snapshot({ metronome_bpm: 110, visual: 'torso_hands' }));
    render(<agent.Host />);
    expect(await screen.findByRole('button', { name: /metronome · 110 bpm/ })).toBeTruthy();
    agent.broadcast(snapshot({ metronome_bpm: null }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /metronome/ })).toBeNull());
  });

  it('never prints the answer to the step it is asking about', async () => {
    // A ladder that shows "Call 911 and send for an AED" beside "what do you do
    // next?" is reading practice. The rung earns its words by being answered or revealed.
    mount(snapshot());
    await waitFor(() => {
      expect(screen.queryByText('Call 911 and send for an AED')).toBeNull();
      expect(screen.getByText('This step — your answer?')).toBeTruthy();
      expect(screen.getByText('Check the scene is safe')).toBeTruthy();
    });
  });
});

describe('reviewing what you missed', () => {
  // The symptom: you finish a drill, the screen says "3 of 5", and there is
  // nowhere on it that tells you WHICH two you did not get.
  const finished = (): Snapshot => snapshot({
    phase: 'debrief',
    prompt: null,
    score: { correct: 1, total: 3 },
    steps: [
      { key: 'scene_safe', label: 'Check the scene is safe', status: 'done', outcome: 'correct' },
      { key: 'call_911', label: 'Call 911 and get an AED', status: 'done', outcome: 'shown' },
      { key: 'compressions', label: 'Push hard and fast in the centre of the chest', status: 'done', outcome: 'shown' },
    ],
    catalog: [{ id: 'choking_adult', title: 'Choking', victim: 'adult', steps: 4 }],
  });

  it('names every step at the debrief, not just the score', async () => {
    mount(finished());
    expect(await screen.findByText('Call 911 and get an AED')).toBeTruthy();
    expect(screen.getByText('Push hard and fast in the centre of the chest')).toBeTruthy();
    expect(screen.getByText('Check the scene is safe')).toBeTruthy();
  });

  it('marks the ones that had to be shown differently from the ones you got', async () => {
    mount(finished());
    await screen.findByText('Call 911 and get an AED');
    expect(screen.getAllByText('shown to you').length).toBe(2);
    expect(screen.getAllByText('got it').length).toBe(1);
  });

  it('still offers another scenario under the review', async () => {
    // A review that dead-ends is a review nobody reaches twice.
    mount(finished());
    expect(await screen.findByRole('button', { name: /Choking/ })).toBeTruthy();
  });

  it('marks a revealed rung on the live ladder too', async () => {
    mount(snapshot({
      steps: [
        { key: 'scene_safe', label: 'Check the scene is safe', status: 'done', outcome: 'shown' },
        { key: 'call_911', label: '', status: 'current' },
        { key: 'compressions', label: '', status: 'hidden' },
      ],
    }));
    expect(await screen.findByLabelText('shown to you')).toBeTruthy();
  });

  it('does not draw an outcome for a rung the learner has not resolved', async () => {
    mount(snapshot());
    await screen.findByText('This step — your answer?');
    expect(screen.queryByLabelText('shown to you')).toBeNull();
  });
});

describe('the score in the header', () => {
  // Seen on step one of a six-step scenario: the header read "0 / 1" with six
  // rungs underneath it. `total` counts rungs opened so far.
  it('counts out of the scenario, not out of the steps reached so far', async () => {
    mount(snapshot({
      score: { correct: 0, total: 1 },
      steps: ['a', 'b', 'c', 'd', 'e', 'f'].map((key, i) => ({ key, label: '', status: i ? 'hidden' as const : 'current' as const })),
    }));
    const score = await screen.findByLabelText('score');
    expect(score.textContent).toContain('/ 6');
    expect(score.textContent).not.toContain('/ 1');
  });

  it('still shows the real total at the debrief', async () => {
    mount(snapshot({
      phase: 'debrief', prompt: null, score: { correct: 2, total: 3 },
      steps: [
        { key: 'a', label: 'One', status: 'done', outcome: 'correct' },
        { key: 'b', label: 'Two', status: 'done', outcome: 'correct' },
        { key: 'c', label: 'Three', status: 'done', outcome: 'shown' },
      ],
      catalog: [],
    }));
    const score = await screen.findByLabelText('score');
    expect(score.textContent).toContain('2');
    expect(score.textContent).toContain('/ 3');
  });

  // Seen live: "actually this one is too hard, can I go back and pick a
  // different scenario?" mid-step, and the panel offered only ways forward.
  it('offers a way out of a scenario mid-step, not only a way forward', async () => {
    const agent = fakeAgent(snapshot());
    agent.script(() => ({ applied: true }));
    render(<agent.Host />);
    click('Back to scenarios');
    await waitFor(() => expect(agent.intents).toContainEqual({ kind: 'leave_scenario' }));
  });

  it('does not show a score chip at the menu, where nothing has been scored', async () => {
    mount(snapshot({
      phase: 'intro', scenario: null, prompt: null, steps: [], score: { correct: 0, total: 0 },
      catalog: [{ id: 'choking_adult', title: 'Choking', victim: 'adult', steps: 6 }],
    }));
    await screen.findByText('Choose a scenario');
    expect(screen.queryByLabelText('score')).toBeNull();
  });
});

describe('offering only what the drill will accept', () => {
  // The reported bug: the ladder showed step one flagged "!" (taught, so the
  // drill was between steps) while the panel still offered Answer and Show me,
  // and Show me came back "We're between steps".
  const coaching = () => snapshot({
    phase: 'coaching',
    steps: [
      { key: 'scene_safe', label: 'Check the scene is safe', status: 'done', outcome: 'shown' },
      { key: 'call_911', label: '', status: 'hidden' },
    ],
    prompt: null,
    last_verdict: { ok: false, note: 'Check the scene: slippery poolside.', revealed: true },
  });
  const disabled = (name: string) => screen.getByRole('button', { name }).hasAttribute('disabled');

  it('does not offer Answer or Show me while coaching', async () => {
    mount(coaching());
    await screen.findByText('Check the scene is safe');
    expect(disabled('Answer')).toBe(true);
    expect(disabled('Show me')).toBe(true);
    expect(disabled('Next step')).toBe(false);   // the one move that IS accepted
    const box = screen.getByLabelText('What would you do?') as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.placeholder).toBe("Say next when you're ready");
  });

  it('does not offer Next step while a rung is still unanswered', async () => {
    mount(snapshot());
    await screen.findByText('This step — your answer?');
    expect(disabled('Next step')).toBe(true);
    expect(disabled('Answer')).toBe(false);
    expect(disabled('Show me')).toBe(false);
  });

  it('always leaves the way out open', async () => {
    mount(coaching());
    await screen.findByText('Check the scene is safe');
    expect(disabled('Back to scenarios')).toBe(false);
  });
});

describe('new in the port', () => {
  it('never draws what is staged for the avatar', async () => {
    const view: View = { ...snapshot(), staged: { step: { label: 'Call 911 and send for an AED', teach: 'Call 911 — speaker on, phone down.', hint: 'You need two things on their way.' } } };
    render(<TutorPanel state={view} pending={false} send={async () => ({ applied: true })} />);
    await screen.findByText('This step — your answer?');
    const text = document.body.textContent ?? '';
    for (const secret of ['Call 911 and send for an AED', 'speaker on', 'two things on their way']) expect(text).not.toContain(secret);
  });

  it('the emergency card covers the whole page, with the numbers and the exact line, and one way off it', async () => {
    const send = vi.fn(async () => ({ applied: true }));
    render(<TutorPanel state={{ phase: 'emergency', scenario: null, score: { correct: 0, total: 0 }, safety_ack: false, safety_notice: SAFETY, emergency_message: EMERGENCY_LINE }} pending={true} send={send} />);
    const card = screen.getByRole('alert');
    expect(card.className).toBe('bls-emergency');   // position: fixed over everything (bls.css)
    expect(screen.getByRole('heading', { name: EMERGENCY_TITLE })).toBeTruthy();
    expect(screen.getByText(EMERGENCY_LINE)).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    // Never disabled: not by an intent in flight, not by the avatar being gone.
    click('Nobody is in danger — back to practice');
    await waitFor(() => expect(send).toHaveBeenCalledWith({ kind: 'ack_safety' }));
  });
});
