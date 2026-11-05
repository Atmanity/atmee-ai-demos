import { describe, expect, it } from 'vitest';
import { bridgeFor, bridgeShots, endingFor, ENDINGS, instructions, normalise, OPENING, SHOTS, wordRules, type Met } from './story.ts';

const met = (stance: Met['stance']): Met => ({ stance, summary: '' });
const sam = (...text: string[]) => text.map((t) => ({ who: 'sam' as const, text: t }));

describe('the film', () => {
  it('names only shots it has', () => {
    const used = [...OPENING, 'h_claire', 'h_mark', ...(['scared', 'sides', 'wonttalk'] as const).flatMap(bridgeShots), ...Object.values(ENDINGS).flatMap((e) => e.shots)];
    for (const id of used) expect(SHOTS[id], id).toBeDefined();
  });
});

describe('branching', () => {
  it('sends Claire\'s word to Mark as the bridge', () => {
    expect(bridgeFor(met('honest'))).toBe('scared');
    expect(bridgeFor(met('side'))).toBe('sides');
    expect(bridgeFor(met('silent'))).toBe('wonttalk');
  });

  it('splits them when Sam takes a side with either parent', () => {
    expect(endingFor(met('side'), met('honest'))).toBe('split');
    expect(endingFor(met('honest'), met('side'))).toBe('split');
  });

  it('repairs after one honest talk, and stays silent after none', () => {
    expect(endingFor(met('silent'), met('honest'))).toBe('repair');
    expect(endingFor(met('honest'), met('silent'))).toBe('repair');
    expect(endingFor(met('silent'), met('silent'))).toBe('silence');
  });

  it('reads Sam\'s words without a model', () => {
    expect(wordRules(sam('fine')).stance).toBe('silent');
    expect(wordRules(sam("It's Dad's fault, he's never home")).stance).toBe('side');
    expect(wordRules(sam("I got scared when you were yelling, I don't like it")).stance).toBe('honest');
    expect(wordRules([{ who: 'parent', text: 'Are you scared?' }]).stance).toBe('silent');
  });

  it('keeps a model answer inside the stances', () => {
    expect(normalise({ stance: 'angry' as never, summary: 'x' }).stance).toBe('silent');
    expect(normalise(null)).toEqual({ stance: 'silent', summary: '' });
  });
});

describe('what Mark is told', () => {
  it('carries what Sam told Claire', () => {
    const text = instructions('mark', { choice: 'stay', claire: { stance: 'honest', summary: 'Sam said the yelling is scary.' }, claireLines: sam('the yelling is scary') });
    expect(text).toContain('Sam said the yelling is scary.');
    expect(text).toContain('"the yelling is scary"');
  });
});
