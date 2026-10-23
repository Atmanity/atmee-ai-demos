// A stroke drawn backwards is told as two plain sentences that cannot be
// flipped. Live, "Top to bottom." after an upward stroke became "that one went
// top to bottom!": the learner was told they had done the right thing.
import { describe, expect, test } from 'vitest';
import { CHARACTERS, JUU, KI } from './characters.ts';
import { resample } from './strokes.ts';
import { travelOf, travelPair } from './travel.ts';
import { StrokeTutor } from './tutor.ts';

const drawing = (points: readonly (readonly [number, number])[]) => resample(points, 40).map(([x, y]) => [Math.trunc(x), Math.trunc(y)] as [number, number]);

describe('travelOf', () => {
  test.each([
    [[[500, 120], [500, 880]], 'from the top down'],
    [[[500, 880], [500, 120]], 'from the bottom up'],
    [[[150, 450], [850, 450]], 'from left to right'],
    [[[850, 450], [150, 450]], 'from right to left'],
    [[[490, 430], [200, 860]], 'from the top down to the left'],
    [[[510, 430], [800, 860]], 'from the top down to the right'],
    [[[200, 860], [490, 430]], 'from the bottom up to the right'],
  ] as const)('%j', (points, words) => {
    expect(travelOf(points)).toBe(words);
  });

  test('what they drew and what is right never come out as the same words', () => {
    expect(travelPair([[500, 120], [510, 880]], [[500, 120], [500, 880]]).drawn).toBe('the other way round');
  });
});

describe('the verdict on a stroke drawn backwards', () => {
  test('十 stroke 2 upwards: from the bottom up, and it goes from the top down', () => {
    const tutor = new StrokeTutor();
    tutor.startCharacter('juu');
    tutor.reveal();
    tutor.nextStroke();
    const verdict = tutor.stroke(drawing([...JUU.strokes[1].points].reverse()));
    expect(verdict.kind).toBe('direction');
    expect(verdict.travel).toEqual({ drawn: 'from the bottom up', right: 'from the top down' });
  });

  test('木 stroke 3 backwards: up and to the right, and it goes down to the left', () => {
    const tutor = new StrokeTutor();
    tutor.startCharacter('ki');
    for (let i = 0; i < 2; i += 1) { tutor.reveal(); tutor.nextStroke(); }
    expect(tutor.stroke(drawing([...KI.strokes[2].points].reverse())).travel).toEqual({ drawn: 'from the bottom up to the right', right: 'from the top down to the left' });
  });

  test('every stroke of every character, drawn backwards, says two different directions', () => {
    let checked = 0;
    for (const character of CHARACTERS) {
      character.strokes.forEach((stroke, index) => {
        const tutor = new StrokeTutor();
        tutor.startCharacter(character.id);
        for (let i = 0; i < index; i += 1) { tutor.reveal(); tutor.nextStroke(); }
        const verdict = tutor.stroke(drawing([...stroke.points].reverse()));
        if (verdict.kind !== 'direction') return;   // a reversed stroke can read as another stroke; that verdict is not about direction
        expect(verdict.travel, `${character.id} ${index + 1}`).toBeDefined();
        expect(verdict.travel!.drawn, `${character.id} ${index + 1}`).not.toBe(verdict.travel!.right);
        checked += 1;
      });
    }
    expect(checked).toBeGreaterThanOrEqual(20);   // of 22 strokes
  });

  test('only a direction verdict carries the two sentences', () => {
    const tutor = new StrokeTutor();
    tutor.startCharacter('juu');
    expect(tutor.stroke(drawing(JUU.strokes[1].points)).travel).toBeUndefined();   // the other stroke: order
    expect(tutor.stroke(drawing(JUU.strokes[0].points)).travel).toBeUndefined();   // right
  });
});
