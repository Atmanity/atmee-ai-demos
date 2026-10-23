// Where the user is in a recipe. Rachel talks a recipe through two steps at a
// time; the steps she is on are lit up on screen, and she moves on by calling
// next_steps (or the user presses "Next steps"). The app keeps the place, so
// the screen and the voice agree about which step is which.

/** The batch of steps lit up, and where the next batch starts. */
export interface Cook {
  /** The first step of the next batch (0-based). Equal to the number of steps once all have been given. */
  at: number;
  /** The steps lit up now, first and last (0-based, inclusive), or null before the walkthrough starts. */
  shown: [number, number] | null;
}

/** Steps given per batch. */
export const BATCH = 2;

/** A recipe just opened by a tap: nothing lit up yet. */
export const unstarted = (): Cook => ({ at: 0, shown: null });

/** The next batch after `cook`, or null when every step has been given. */
export function nextBatch(cook: Cook, steps: number): Cook | null {
  if (cook.at >= steps) return null;
  const last = Math.min(cook.at + BATCH, steps) - 1;
  return { at: last + 1, shown: [cook.at, last] };
}

/** A recipe opened to be talked through: its first batch lit up. */
export const started = (steps: number): Cook => nextBatch(unstarted(), steps) ?? unstarted();

/** The user tapped a step: that step is where they are, and the next batch follows it. */
export function pick(step: number, steps: number): Cook {
  const i = Math.max(0, Math.min(step, steps - 1));
  return { at: i + 1, shown: [i, i] };
}

/** "Steps 3 and 4", "Step 5", for the host and the screen alike. */
export function stepsLabel(shown: [number, number]): string {
  const [a, b] = shown;
  if (a === b) return `Step ${a + 1}`;
  if (b === a + 1) return `Steps ${a + 1} and ${b + 1}`;
  return `Steps ${a + 1} to ${b + 1}`;
}
