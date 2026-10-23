import { describe, expect, it } from 'vitest';
import { nextBatch, pick, started, stepsLabel, unstarted } from './cook.ts';

describe('where the user is in a recipe', () => {
  it('a recipe opened to be talked through starts with its first two steps lit', () => {
    expect(started(6)).toEqual({ at: 2, shown: [0, 1] });
    expect(started(1)).toEqual({ at: 1, shown: [0, 0] });
    expect(started(0)).toEqual(unstarted());
  });

  it('a tapped recipe has nothing lit until the walkthrough starts', () => {
    expect(unstarted()).toEqual({ at: 0, shown: null });
    expect(nextBatch(unstarted(), 5)).toEqual({ at: 2, shown: [0, 1] });
  });

  it('goes on two at a time, the last batch may be one, then there is no more', () => {
    let cook = started(5);
    cook = nextBatch(cook, 5)!;
    expect(cook).toEqual({ at: 4, shown: [2, 3] });
    cook = nextBatch(cook, 5)!;
    expect(cook).toEqual({ at: 5, shown: [4, 4] });
    expect(nextBatch(cook, 5)).toBeNull();
  });

  it('a tapped step is where they are, and the next batch follows it', () => {
    expect(pick(3, 6)).toEqual({ at: 4, shown: [3, 3] });
    expect(nextBatch(pick(3, 6), 6)).toEqual({ at: 6, shown: [4, 5] });
    expect(pick(9, 6)).toEqual({ at: 6, shown: [5, 5] });
  });

  it('names the steps the way a person would', () => {
    expect(stepsLabel([0, 1])).toBe('Steps 1 and 2');
    expect(stepsLabel([4, 4])).toBe('Step 5');
    expect(stepsLabel([2, 5])).toBe('Steps 3 to 6');
  });
});
