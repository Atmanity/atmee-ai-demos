import { describe, expect, it } from 'vitest';
import { CALLERS, instructions, OUTCOME, TOOLS } from './story.ts';

describe('the calls', () => {
  it('start normal and go wrong in order', () => {
    for (const f of ['jake', 'maya'] as const) {
      const at = CALLERS[f].beats.map((b) => b.at);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
    }
    expect(CALLERS.jake.beats.at(-1)!.id).toBe('coming');
    expect(CALLERS.maya.beats.at(-1)!.id).toBe('crash');
  });
  it('turn the camera only when the caller says so', () => {
    expect(CALLERS.jake.beats.find((b) => b.id === 'figure')!.event).toMatch(/turn the camera/);
    expect(CALLERS.maya.beats.find((b) => b.id === 'road')!.event).toMatch(/look/);
  });
  it('never warn the first caller up front', () => {
    expect(instructions('jake')).toMatch(/Nothing is wrong when the call starts/);
    expect(TOOLS.length).toBeGreaterThan(0);
    expect(OUTCOME.title).toBe('Dead Air');
  });
});
