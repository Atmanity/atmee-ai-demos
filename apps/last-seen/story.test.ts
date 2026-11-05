import { describe, expect, it } from 'vitest';
import { CAST, ending, EVIDENCE, instructions, MIA, shownState, TOOLS } from './story.ts';

describe('the callers', () => {
  it('carry their lie, their truth and the scripted reveal', () => {
    for (const caller of ['theo', 'jonah'] as const) {
      const text = instructions(caller, []);
      expect(text).toContain(CAST[caller].lie);
      expect(text).toContain(EVIDENCE[caller].truth);
      expect(text).toContain(EVIDENCE[caller].reveal);
      expect(text).toContain('EVIDENCE SHOWN');
    }
  });

  it('tell the second caller what Sam already knows', () => {
    expect(instructions('jonah', [EVIDENCE.theo.truth])).toContain(EVIDENCE.theo.truth);
  });

  it('never name the moves they must not make', () => {
    for (const caller of ['theo', 'jonah'] as const) expect(instructions(caller, []).toLowerCase()).not.toMatch(/don't hang up|do not hang up|don't say goodbye/);
  });

  it('give every session at least one tool', () => {
    expect(TOOLS.length).toBeGreaterThan(0);
    expect(shownState('theo')).toContain(EVIDENCE.theo.text);
  });
});

describe('endings', () => {
  it('finds Mia at the bridge, whatever was caught', () => {
    expect(ending('bridge', 0).video).toBe('m_bridge');
    expect(ending('bridge', 2).line).toMatch(/both lies/);
  });

  it('misses her at the party', () => {
    expect(ending('party', 1)).toMatchObject({ video: 'm_party', title: 'Missed' });
  });

  it('only plays videos it has', () => {
    for (const d of ['bridge', 'party'] as const) expect(MIA[ending(d, 1).video]).toBeDefined();
  });
});
