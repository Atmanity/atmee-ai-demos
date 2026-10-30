import { describe, expect, it } from 'vitest';
import { build, choose, CLASSES, LEVELS, newClub, next, problem, problems, setLevel, total, type Club } from './club.ts';
import { clubState, INSTRUCTIONS, TOOLS } from './director.ts';

const solveAll = (c: Club) => {
  for (const p of problems(c)) {
    c = build(c, p.a, p.b).club;
    if (c.cls === 'times') c = total(c, p.a * p.b).club;
    c = next(c).club;
  }
  return c;
};

describe('Pizza Fractions', () => {
  it('gives a star for the exact fraction', () => {
    const m = build(newClub(), 2, 1);
    expect(m.fx).toContain('star');
    expect(m.club.stars).toBe(1);
  });
  it('accepts an equal fraction and says why', () => {
    const m = build(newClub(), 4, 2);
    expect(m.club.solved).toBe(true);
    expect(m.outcome).toMatch(/same amount/);
  });
  it('never takes more slices than the pizza has', () => {
    expect(build(newClub(), 3, 9).club.b).toBe(3);
  });
  it('keeps what the child did not change', () => {
    const c = build(newClub(), 5, undefined).club;
    expect(build(c, undefined, 2).club).toMatchObject({ a: 5, b: 2 });
  });
  it('reads a spoken number', () => {
    expect(build(newClub(), '3 slices', undefined).club.a).toBe(3);
  });
});

describe('Cookie Times Tables', () => {
  it('asks for the total only once the tray matches', () => {
    expect(total(newClub('times', 2), 12).outcome).toMatch(/^Not yet/);
    const m = build(newClub('times', 2), 3, 4);
    expect(m.club.built).toBe(true);
    expect(m.outcome).not.toMatch(/\b12\b/);
  });
  it('accepts the tray turned around', () => {
    const m = build(newClub('times', 2), 4, 3);
    expect(m.club.built).toBe(true);
    expect(m.outcome).toMatch(/turned around/);
  });
  it('keeps the problem after a wrong total and does not leak it', () => {
    const c = build(newClub('times', 2), 3, 4).club;
    const m = total(c, 9);
    expect(m.club.solved).toBe(false);
    expect(m.outcome).not.toMatch(/\b12\b/);
    expect(total(c, 12).club.stars).toBe(1);
  });
});

it('moves on only after a star, and finishes with every star', () => {
  expect(next(newClub()).outcome).toMatch(/^Not yet/);
  for (const cls of ['fractions', 'times'] as const) for (const { n } of LEVELS) {
    const end = solveAll(newClub(cls, n));
    expect(end.done).toBe(true);
    expect(end.stars).toBe(problems(end).length);
  }
});

it('changes class from a child\'s words', () => {
  expect(choose(newClub(), 'the cookies one').club.cls).toBe('times');
  expect(choose(newClub(), 'dinosaurs').outcome).toMatch(/^Not clear/);
});

describe('levels', () => {
  it('counts only the asked-for cut on level 5', () => {
    const c = newClub('fractions', 5);
    expect(build(c, 6, 3).club.solved).toBe(false);
    expect(build(c, 2, 1).club.solved).toBe(true);
  });
  it('has five for each class, every problem buildable on screen', () => {
    for (const cls of ['fractions', 'times'] as const) {
      expect(CLASSES[cls].levels).toHaveLength(LEVELS.length);
      for (const p of CLASSES[cls].levels.flat()) expect(Math.max(p.a, cls === 'times' ? p.b : 0)).toBeLessThanOrEqual(CLASSES[cls].max);
    }
  });
  it('stays on the level when moving on or changing class', () => {
    const c = build(newClub('fractions', 3), 6, 1).club;
    expect(next(c).club.level).toBe(3);
    expect(choose(c, 'cookies').club.level).toBe(3);
  });
  it('reads a number, harder and easier, and stops at the ends', () => {
    expect(setLevel(newClub(), 'level 4').club.level).toBe(4);
    expect(setLevel(newClub(), 'harder').club.level).toBe(2);
    expect(setLevel(newClub(), 'easier').club.level).toBe(1);
    expect(setLevel(newClub('times', 5), 9).club.level).toBe(5);
    expect(setLevel(newClub(), 'banana').outcome).toMatch(/^Not clear/);
  });
});

describe('the director', () => {
  it('fits the API', () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(4000);
    for (const tool of TOOLS) expect(INSTRUCTIONS).toContain(tool.name);
    for (const tool of TOOLS) expect(JSON.stringify(tool.parameters)).not.toMatch(/enum|additionalProperties|pattern/);
  });
  it('never puts a times total in the state', () => {
    const c = newClub('times', 2);
    const p = problem(c);
    expect(clubState(build(c, p.a, p.b).club)).not.toContain(String(p.a * p.b));
  });
});
