import { describe, expect, it } from 'vitest';

import { dailyValue, provenance, reasonFrom, servingLine } from './nutrition.ts';

describe('a value over the daily reference', () => {
  it('reads as over rather than as exactly a full day', () => {
    // The symptom: 113 g of butter is 117% of the fat reference and drew a bar
    // pixel-identical to a food at exactly 100%. The bar clamps because it
    // cannot draw past its track; the CARD has to say so some other way.
    const over = dailyValue(91, 78);
    expect(over.pct).toBe(117);
    expect(over.barPct).toBe(100);
    expect(over.over).toBe(true);
  });

  it('does not mark a value that merely fills the track', () => {
    const exact = dailyValue(78, 78);
    expect(exact.pct).toBe(100);
    expect(exact.over).toBe(false);
  });

  it('leaves a nutrient with no reference without a percentage at all', () => {
    // Total sugar has no daily value here: the FDA's 50 g figure is for ADDED
    // sugar, and dividing by it called a banana's own sugar "28% DV".
    expect(dailyValue(14, undefined)).toEqual({ pct: null, barPct: 0, over: false });
  });

  it('never draws a bar backwards', () => {
    expect(dailyValue(-5, 78).barPct).toBe(0);
  });
});

describe('where the numbers came from', () => {
  it('tells a label reading apart from a guess', () => {
    expect(provenance('label')?.label).toBe('read from your label');
    expect(provenance('estimate')?.label).toBe('estimated');
  });

  it('says nothing when the payload does not know', () => {
    // Silence, not a default: claiming "estimated" on a payload that made no
    // claim is the app implying it can tell the two apart when it cannot.
    expect(provenance(undefined)).toBeNull();
    expect(provenance('')).toBeNull();
    expect(provenance('somewhere')).toBeNull();
  });
});

describe('the serving line', () => {
  it('marks a portion the app assumed', () => {
    expect(servingLine('1 medium banana', true)).toBe('assumed: 1 medium banana');
  });

  it('leaves a stated portion alone', () => {
    expect(servingLine('100 g', false)).toBe('100 g');
    expect(servingLine('100 g', undefined)).toBe('100 g');
  });

  it('still says the portion was assumed when there is no portion text', () => {
    expect(servingLine('', true)).toBe('portion assumed');
    expect(servingLine('', false)).toBe('');
  });
});

describe('why a call failed', () => {
  it('shows the agent’s own reason', () => {
    // The symptom: "Try a sample" was fire-and-forget, so a refusal became an
    // unhandled rejection in a console nobody can open from inside an iframe
    // and the button looked like it did nothing.
    expect(reasonFrom('no sample image in the bundle')).toBe('no sample image in the bundle');
    expect(reasonFrom({ reason: 'vision is off for this session' })).toBe(
      'vision is off for this session',
    );
    expect(reasonFrom(new Error('rpc timed out'))).toBe('rpc timed out');
  });

  it('still says something when the agent said only ok:false', () => {
    expect(reasonFrom(undefined, 'it could not be read')).toBe('it could not be read');
    expect(reasonFrom({})).toBe('it did not go through');
  });
});
