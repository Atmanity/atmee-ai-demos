// The goals the board offers, and how six of the twenty are dealt.
//
// From the original panel (`FitnessPanel.tsx`, `board.ts`). Moved into the
// engine because the avatar's state names the same six the screen shows, so
// the server and the page must deal them identically.

export const TRAINING_GOAL_OPTIONS = [
  'Full body',
  'Fat-loss HIIT',
  'Core + cardio',
  'Mobility',
  'Glutes + legs',
  'Upper body strength',
  'Low-impact sweat',
  'Stretch + recovery',
  'Posture reset',
  'Beginner strength',
  'Quick morning energy',
  'Desk break mobility',
  'Cardio conditioning',
  'Balance + stability',
  'Bodyweight burn',
  'Joint-friendly strength',
  'Athletic power',
  'Pilates core',
  'Back + shoulders',
  'Weekend reset',
];

export const GOAL_COUNT = 6;

/**
 * The seed when nothing else seeds the deal. The original shuffle was
 * `Math.random()` in a `useMemo([])`, which re-dealt on every remount: the
 * six goals the user was reading changed under them for no visible reason.
 */
export const GOAL_SEED = 'fitness-coach';

function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function random(state: number): () => number {
  let a = state || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates over a seeded PRNG: same seed, same order, every time. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const next = random(hash(seed));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The goals to draw. A goal the user reached by *speaking* ("core and
 * cardio") may be nowhere in the six, and the board then highlighted nothing
 * and looked like it had not heard; it goes in front instead.
 */
export function goalOptions(all: readonly string[], count: number, selected: string, seed: string = GOAL_SEED): string[] {
  const deal = seededShuffle(all, seed).slice(0, count);
  const chosen = (selected || '').trim();
  if (!chosen) return deal;
  if (deal.some((goal) => goal.toLowerCase() === chosen.toLowerCase())) return deal;
  return [chosen, ...deal].slice(0, count);
}
