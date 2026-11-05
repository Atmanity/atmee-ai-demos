import { describe, expect, it } from 'vitest';
import { atDeadline, LAYERS, normalise, readOf, START_TRUST, stateFor, step, unlocked, wordVerdict, type Run } from './story.ts';

const run = (trust = START_TRUST): Run => ({ trust, lies: 0, ended: null, at: 0 });

describe('trust', () => {
  it('opens his secret a layer at a time', () => {
    expect(unlocked(3).map((l) => l.id)).toEqual(['three']);
    expect(unlocked(5).map((l) => l.id)).toEqual(['three', 'mother']);
    expect(unlocked(8).map((l) => l.id)).toEqual(['three', 'mother', 'box']);
    expect(stateFor(3, 0)).not.toContain(LAYERS[2].secret);
    expect(stateFor(8, 0)).toContain(LAYERS[2].secret);
  });

  it('climbs with curiosity and falls with lies', () => {
    const r = run();
    step(r, { warmth: 2, lie: false, asksOut: false });
    expect(r.trust).toBe(5);
    step(r, { warmth: 0, lie: true, asksOut: false });
    expect(r.trust).toBe(2);
    expect(r.lies).toBe(1);
  });

  it('ends with the camera off after two lies or no trust', () => {
    const r = run();
    step(r, { warmth: 0, lie: true, asksOut: false });
    expect(step(r, { warmth: 0, lie: true, asksOut: false })).toBe('off');
    expect(step(run(1), { warmth: -2, lie: false, asksOut: false })).toBe('off');
  });

  it('opens the door only to someone he trusts who asks', () => {
    expect(step(run(8), { warmth: 0, lie: false, asksOut: true })).toBe('open');
    expect(step(run(5), { warmth: 0, lie: false, asksOut: true })).toBeNull();
    expect(atDeadline(run(9))).toBe('open');
    expect(atDeadline(run(4))).toBe('breach');
  });
});

describe('reading the negotiator', () => {
  it('hears warmth, pressure and lies without a model', () => {
    expect(wordVerdict('Walter, tell me what happened').warmth).toBe(1);
    expect(wordVerdict('Come out now or else').warmth).toBe(-1);
    expect(wordVerdict("I promise you'll go free, no charges").lie).toBe(true);
    expect(wordVerdict('Will you open the door for me?').asksOut).toBe(true);
  });
  it('keeps a model answer in range', () => {
    expect(normalise({ warmth: 7 }).warmth).toBe(2);
    expect(normalise(null)).toEqual({ warmth: 0, lie: false, asksOut: false });
    expect(readOf(0)).toBe('Shutting you out');
    expect(readOf(9)).toBe('Trusts you');
  });
});
