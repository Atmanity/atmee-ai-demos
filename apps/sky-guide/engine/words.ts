// The sky in a guide's words, never in degrees. Ported from the helpers of the
// original `tools.py` and `table.py`. Pure and fed from snapshots, so the
// avatar is told the same thing the chart drew.
import type { Figure, SkySnapshot, VisibleStar } from './types.ts';

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** "high up in the north-east": what the guide says instead of "altitude 34". */
export function whereInSky(star: Pick<VisibleStar, 'alt' | 'az'> | null | undefined): string {
  const alt = Number(star?.alt);
  const az = Number(star?.az);
  if (!star || !Number.isFinite(alt) || !Number.isFinite(az)) return 'on the chart';
  const height = alt > 70 ? 'almost straight overhead' : alt > 45 ? 'high up' : alt > 25 ? 'about halfway up' : 'low down';
  return `${height} in the ${COMPASS[Math.floor((((az + 22.5) % 360) + 360) % 360 / 45)]}`;
}

/** How many stars to name on each side of a move. Beyond about three the line
 *  stops being a sentence and becomes a list. */
export const NAMED_MOVES = 3;

/** The visible stars as id -> name, brightest first (the snapshot's own order). */
export function namesById(snapshot: SkySnapshot): Map<string, string> {
  return new Map(snapshot.visible.map((s) => [s.id, s.name]));
}

/** Which stars a move brought up and which it took down, brightest first. */
export function risenAndGone(before: SkySnapshot, after: SkySnapshot): { risen: string[]; gone: string[] } {
  const was = namesById(before);
  const now = namesById(after);
  return {
    risen: [...now].filter(([id]) => !was.has(id)).map(([, name]) => name),
    gone: [...was].filter(([id]) => !now.has(id)).map(([, name]) => name),
  };
}

/**
 * What a move did to the sky, in names rather than a question. Asking the model
 * what has risen without handing it the difference leaves memory as the only
 * source, which is the one thing this app forbids.
 */
export function movement(risen: string[], gone: string[]): string {
  const parts: string[] = [];
  if (risen.length) parts.push(`Newly up: ${risen.slice(0, NAMED_MOVES).join(', ')}.`);
  if (gone.length) parts.push(`Gone below the horizon: ${gone.slice(0, NAMED_MOVES).join(', ')}.`);
  return parts.length ? parts.join(' ') : 'Nothing has risen or set — the same stars are up.';
}

/** The brightest star of the lit figure, as the chart drew it: the only honest
 *  source for "where to look". */
export function figureAnchor(snapshot: SkySnapshot, figure: Figure | null): VisibleStar | null {
  const ids = new Set((figure?.lines ?? []).flat());
  const stars = snapshot.visible.filter((s) => ids.has(s.id));
  return stars.length ? stars.reduce((a, b) => (b.mag < a.mag ? b : a)) : null;
}

export type Change = 'place' | 'time' | 'star' | 'figure';

/**
 * What changed that is worth a spoken line, or null. Deliberately narrow:
 * selecting a star is worth talking about, and so is moving the observer or the
 * clock. Clearing a selection, or a figure that dropped below the horizon on its
 * own, is something the user can see happen and does not need narrated.
 */
export function materialChange(before: SkySnapshot, after: SkySnapshot): Change | null {
  if (before.where.label !== after.where.label) return 'place';
  if (before.when.epoch !== after.when.epoch) return 'time';
  if (before.selected !== after.selected && after.selected) return 'star';
  const was = before.figure?.con ?? null;
  const now = after.figure?.con ?? null;
  if (was !== now && now) return 'figure';
  return null;
}
