import { describe, expect, it } from 'vitest';
import { exhibitById } from './catalogue.ts';
import { arrived, said, TOOLS, tourState } from './director.ts';

const wave = exhibitById('great-wave')!;
const kiss = exhibitById('the-kiss')!;

describe('what Edmund is told', () => {
  it('declares lenient, awaited tools', () => {
    for (const tool of TOOLS) {
      const schema = JSON.stringify(tool.parameters);
      expect(schema).not.toMatch(/enum|pattern|additionalProperties|minLength/);
      expect(tool['x-atmee']?.mode).toBe('await');
    }
  });

  it('puts the current work\'s record, what was seen and the floor plan in the state', () => {
    const state = tourState({ current: wave, seen: [kiss, wave], camera: true });
    expect(state).toContain('camera is on');
    expect(state).toContain('They are at: "The Great Wave off Kanagawa"');
    expect(state).toContain('Prussian blue');
    expect(state).toContain('Seen so far: "The Kiss", "The Great Wave off Kanagawa"');
    expect(state).toContain('Gallery 4, the Japanese print room: "The Great Wave off Kanagawa" (Katsushika Hokusai)');
    expect(state.length).toBeLessThan(3858);
  });

  it('starts every tool result with its outcome', () => {
    expect(said.identified(wave)).toMatch(/^Identified: /);
    expect(said.notInCatalogue('a bench')).toMatch(/^Not identified: the camera shows a bench/);
    expect(said.unclear('')).toMatch(/^Not identified: /);
    expect(said.noCamera).toMatch(/^Not identified: /);
    expect(said.shown(kiss)).toMatch(/^Shown: .*Gallery 3/);
    expect(said.notFound('Guernica')).toMatch(/^Not found: .*"The Kiss"/);
  });

  it('asks for the story on arrival, and only a question when the visitor comes back', () => {
    expect(arrived(wave, 'label', false)).toMatch(/just scanned the label of "The Great Wave off Kanagawa".*Tell them about it/);
    expect(arrived(wave, 'label', true)).toMatch(/again\. Ask what they would like to know/);
    expect(arrived(wave, 'camera', false)).toContain('is pointing the camera at');
  });
});
