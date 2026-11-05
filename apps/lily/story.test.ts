import { describe, expect, it } from 'vitest';
import { cluesIn, PLACES, possible, TRUTH, VIEWS, viewAsked, type Clue } from './story.ts';

describe('the map', () => {
  it('needs more than one clue: every single clue leaves decoys', () => {
    for (const c of ['train', 'water', 'brick', 'machines', 'sign', 'tower'] as Clue[]) expect(possible([c]).length, c).toBeGreaterThan(1);
  });
  it('three sensed clues are enough, and the sign plus one more', () => {
    expect(possible(['train', 'water', 'brick']).map((p) => p.id)).toEqual([TRUTH]);
    expect(possible(['sign', 'water']).map((p) => p.id)).toEqual([TRUTH]);
    expect(possible(['train', 'brick', 'machines']).map((p) => p.id).sort()).toEqual(['foundry', 'mill']);
  });
  it('the truth has every clue, and every view only shows true clues', () => {
    const mill = PLACES.find((p) => p.id === TRUTH)!;
    for (const v of Object.values(VIEWS)) for (const c of v.clues) expect(mill.has).toContain(c);
  });
});

describe('hearing her and you', () => {
  it('picks clues out of what she says', () => {
    expect(cluesIn('There is a train horn, really close, and water rushing outside').sort()).toEqual(['train', 'water']);
    expect(cluesIn('The walls are brick and there are these old rusted machines')).toEqual(['brick', 'machines']);
    expect(cluesIn('It says HARL and then nothing')).toEqual(['sign']);
  });
  it('knows when you ask to see, and what', () => {
    expect(viewAsked('Can you turn the camera to the window?', [])).toBe('window');
    expect(viewAsked('Show me the sign on the wall', [])).toBe('sign');
    expect(viewAsked('Show me', ['room'])).toBe('window');
    expect(viewAsked('Are you hurt?', [])).toBeNull();
  });
});
