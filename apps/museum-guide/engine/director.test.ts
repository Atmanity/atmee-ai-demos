import { describe, expect, it } from 'vitest';
import { exhibitById } from './catalogue.ts';
import { arrived, INSTRUCTIONS, said, TOOLS, tourState } from './director.ts';
import { GUEST_INSTRUCTIONS, GUEST_TOOLS, guestById } from './guests.ts';

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

  it('keeps both sets of instructions within the limit, naming every tool and the rule that only tools change the screen', () => {
    for (const [instructions, tools] of [[INSTRUCTIONS, TOOLS], [GUEST_INSTRUCTIONS, GUEST_TOOLS]] as const) {
      expect(instructions.length).toBeLessThanOrEqual(4000);
      for (const tool of tools) expect(instructions).toContain(tool.name);
      expect(instructions).toMatch(/screen changes only when you call a tool/);
    }
  });

  it('welcomes the visitor back, telling the new work when they moved on while the guest talked', () => {
    const girl = guestById('girl')!;
    expect(said.welcomeBack(girl, exhibitById('pearl-earring'))).toMatch(/ask what they would like to see next/);
    expect(said.welcomeBack(girl, wave)).toMatch(/moved on to "The Great Wave off Kanagawa"\. Welcome them back in one sentence, then tell them about it/);
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
