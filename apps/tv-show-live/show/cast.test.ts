import { describe, expect, it } from 'vitest';
import { onCallFor } from './cast.ts';

describe('onCallFor', () => {
  it('finds the on-call guest whose role the invitation names', () => {
    expect(onCallFor("Amberfall's visionary director, known for moody atmospheric drama")?.id).toBe('mireille');
  });

  it('leaves other roles to be invented', () => {
    expect(onCallFor('the gruff Icelandic cinematographer who shot the sandstorms')).toBeUndefined();
  });

  it('skips a guest already invited or gone', () => {
    expect(onCallFor('the director', ['mireille'])).toBeUndefined();
  });

  it('never offers an opening guest', () => {
    expect(onCallFor('the costume and production designer')).toBeUndefined();
  });
});
