import { describe, expect, it } from 'vitest';
import { clubState, INSTRUCTIONS, opening, TOOLS } from './director.ts';
import { answer, explained, gameOf, GAMES, newClub, next, roundOf, setLevel, stepOf, type Club } from './games.ts';

const playRound = (c: Club) => {
  for (const step of roundOf(c).steps) c = step.answer === null ? explained(c).club : answer(c, step.answer).club;
  return c;
};

it('every level is a different game and every game can be finished', () => {
  expect(new Set(GAMES.map((g) => g.id)).size).toBe(5);
  for (const g of GAMES) {
    let c = newClub(g.level);
    for (let i = 0; i < g.rounds.length; i++) c = next(playRound(c)).club;
    expect(c.done).toBe(true);
    expect(c.stars).toBe(g.rounds.length);
  }
});

describe('hints', () => {
  it('climbs the ladder on wrong answers and never gives the answer', () => {
    const c = newClub(2);
    const once = answer(c, 12);
    const twice = answer(once.club, 11);
    expect(once.outcome).toContain(stepOf(c).hints[0]);
    expect(twice.outcome).toContain(stepOf(c).hints[1]);
    expect(twice.outcome).not.toMatch(/\b13\b/);
    expect(twice.club.step).toBe(0);
  });
  it('resets for the next step', () => {
    const wrong = answer(newClub(2), 12).club;
    expect(answer(wrong, 13).club).toMatchObject({ step: 1, misses: 0 });
  });
});

it('walks the carrying steps of 18 + 5', () => {
  expect(roundOf(newClub(2)).steps.map((s) => s.answer)).toEqual([13, 3, 2, 23]);
});

it('reads number words and asks again for no number', () => {
  expect(answer(newClub(), 'three!').ok).toBe(true);
  expect(answer(newClub(), 'banana').outcome).toMatch(/^Not clear/);
});

describe('Teach Mochi', () => {
  it('needs the child to explain before the star', () => {
    const c = answer(newClub(4), 4).club;
    expect(c.solved).toBe(false);
    expect(answer(c, 4).outcome).toMatch(/^Not a number/);
    expect(explained(c).club.stars).toBe(1);
  });
  it('does not take an explanation on a number step', () => {
    expect(explained(newClub(4)).ok).toBe(false);
  });
});

it('moves on only after a star', () => {
  expect(next(newClub()).outcome).toMatch(/^Not yet/);
});

it('dares them up after a clean game, not after mistakes', () => {
  const finish = (c: Club) => { let m; for (let i = 0; i < gameOf(c).rounds.length; i++) { m = next(playRound(c)); c = m.club; } return m!.outcome; };
  expect(finish(newClub())).toMatch(/dare them/);
  expect(finish(answer(newClub(), 99).club)).not.toMatch(/dare them/);
});

it('changes level by number, harder and easier, within the ends', () => {
  expect(setLevel(newClub(), 'level 4').club.level).toBe(4);
  expect(setLevel(newClub(), 'harder').club.level).toBe(2);
  expect(setLevel(newClub(), 'easier').club.level).toBe(1);
  expect(setLevel(newClub(5), 9).club.level).toBe(5);
});

describe('the director', () => {
  it('fits the API', () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(4000);
    for (const tool of TOOLS) expect(INSTRUCTIONS).toContain(tool.name);
    for (const tool of TOOLS) expect(JSON.stringify(tool.parameters)).not.toMatch(/enum|additionalProperties|pattern/);
  });
  it('never puts a pending answer in what Mochi is told', () => {
    for (const g of GAMES) {
      const c = newClub(g.level);
      for (const s of roundOf(c).steps) {
        if (s.answer !== null && s.answer > 9 && !stepOf(c).ask.includes(String(s.answer))) {
          expect(clubState(c)).not.toMatch(new RegExp(`\\b${s.answer}\\b`));
        }
      }
    }
  });
  it('opens without a second greeting and in the game\'s role', () => {
    expect(opening(newClub(3))).toMatch(/^You have just greeted them.*shopkeeper/);
  });
});
