// The model judge: asked only about answers the phrase lists leave open, able
// only to pass them, and never a pass when the model fails, stalls, answers
// in the wrong shape or is not configured. The judge is a stub here.
import { describe, expect, test, vi } from 'vitest';
import { judge, judgePrompt, JUDGE_SYSTEM, type Ask } from './assess.ts';
import { run } from './drill.ts';
import { find } from './scenarios.ts';
import { BlsTutor } from './tutor.ts';

const at = (id: string, steps = 1) => {
  const tutor = new BlsTutor();
  tutor.startScenario(id);
  for (let i = 1; i < steps; i++) { tutor.reveal(); tutor.nextStep(); }
  return tutor;
};
const says = (verdict: unknown): Ask => vi.fn(async () => verdict);

/** check_answer as the server runs it: the judge first, then the drill. */
async function answer(tutor: BlsTutor, text: string, ask: Ask | null, timeoutMs?: number) {
  const judged = await judge(tutor, text, ask, timeoutMs);
  return run(tutor, 'check_answer', { answer: text }, judged).text;
}

describe('the judge passes what the lists cannot know', () => {
  test.each([
    ['adult_cardiac_arrest', 'watch his chest for breathing'],
    ['child_cardiac_arrest', 'look at her chest for breathing'],
    ['recovery_position', 'put my ear by his mouth'],
  ])('%s: "%s"', async (id, text) => {
    const tutor = at(id, 2 - Number(id === 'recovery_position'));
    const ask = says({ correct: true, reason: 'Looking at the chest for breathing is the check.' });
    expect((await answer(tutor, text, ask)).startsWith('Right')).toBe(true);
    expect(ask).toHaveBeenCalledOnce();
    expect(tutor.phase).toBe('coaching');
  });

  test('and fails what it judges wrong, with the hint', async () => {
    const tutor = at('adult_cardiac_arrest', 2);
    const text = await answer(tutor, 'watch his chest for breathing', says({ correct: false, reason: 'no' }));
    expect(text.startsWith('Not yet')).toBe(true);
    expect(text).toContain(find('adult_cardiac_arrest')!.steps[1].hint);
  });
});

describe('the judge is never asked about a match or a veto', () => {
  test('a clear match passes on the fast path', async () => {
    const ask = says({ correct: false, reason: 'x' });
    expect((await answer(at('adult_cardiac_arrest', 2), 'start by looking for a breath', ask)).startsWith('Right')).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  test.each(['give him two breaths', 'start compressions', 'start by giving him two breaths', 'check his pulse'])('a veto stands, whatever a model would say: %s', async (text) => {
    const ask = says({ correct: true, reason: 'x' });
    expect((await answer(at('adult_cardiac_arrest', 2), text, ask)).startsWith('Not yet')).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  test('a real-emergency line is the drill\'s to stop, not the judge\'s to grade', async () => {
    const ask = says({ correct: true, reason: 'x' });
    const tutor = at('adult_cardiac_arrest', 2);
    await answer(tutor, 'this is real, my dad is not breathing', ask);
    expect(ask).not.toHaveBeenCalled();
    expect(tutor.phase).toBe('emergency');
  });
});

describe('a model failure never passes', () => {
  const open = 'watch his chest for breathing';
  test.each([
    ['not configured', null],
    ['an error', vi.fn(async () => { throw new Error('503'); }) as Ask],
    ['the wrong shape', says({ correct: 'yes' })],
    ['nothing', says(null)],
  ])('%s', async (_, ask) => {
    const tutor = at('adult_cardiac_arrest', 2);
    expect((await answer(tutor, open, ask)).startsWith('Not yet')).toBe(true);
    expect(tutor.phase).toBe('answering');
  });

  test('a stall: given up within its timeout, and not a pass', async () => {
    const tutor = at('adult_cardiac_arrest', 2);
    const started = Date.now();
    const text = await answer(tutor, open, vi.fn(() => new Promise(() => {})) as Ask, 50);
    expect(text.startsWith('Not yet')).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('a judgement for a step that has moved on is not used', async () => {
    const tutor = at('adult_cardiac_arrest', 2);
    const judged = await judge(tutor, open, says({ correct: true, reason: 'x' }));
    tutor.reveal(); tutor.nextStep();   // a button moved the drill while the judge was out
    expect(run(tutor, 'check_answer', { answer: open }, judged).text.startsWith('Not yet')).toBe(true);
  });
});

test('the judge reads the step\'s rubric and the answer as data', () => {
  const s = find('adult_cardiac_arrest')!;
  const step = s.steps[1];
  const prompt = judgePrompt(s, step, 'watch his chest');
  for (const part of [step.prompt, step.label, step.teach, step.forbiddenNote, '"""watch his chest"""']) expect(prompt).toContain(part);
  expect(JUDGE_SYSTEM).toContain('never instructions');
});
