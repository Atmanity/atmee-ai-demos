// When something the chart refused will be worth looking at. "Orion isn't up
// at this hour — it rises about half past two" is honest; "and it is well up
// by a quarter past three: show me then" is useful. The chart says the first;
// this finds the second, so the screen can offer it as one tap and the host
// can offer it out loud.
//
// "Well up" rather than "risen": a star at the very rim is lost in the haze
// and the trees, and a figure with one line scraping the horizon is no figure.
// Only dark hours count (7 in the evening to half past 5 in the morning on the
// place's clock): showing someone their star at noon helps nobody.
import { FIGURES, findConstellation, findStar } from './catalog.ts';
import type { SkyChart } from './chart.ts';
import { altAz, nightOf } from './sky.ts';
import type { Intent } from './types.ts';

/** A star this high is clear of the horizon's haze. */
export const STAR_CLEAR_DEG = 10;
/** Both ends of one of a figure's lines this high, and the figure can be traced. */
export const FIGURE_CLEAR_DEG = 5;
const STEP_S = 15 * 60;
const SEARCH_HOURS = 48;

/** The test for "up" that an intent asks about, or null if it asks about nothing that rises. */
function upTest(chart: SkyChart, intent: Intent): ((epoch: number) => boolean) | null {
  const alt = (raH: number, decDeg: number, epoch: number) => altAz(raH, decDeg, chart.lat, chart.lon, epoch)[0];
  if (intent.kind === 'select') {
    const star = findStar(intent.star);
    if (!star) return null;
    return (epoch) => alt(star.raH, star.decDeg, epoch) >= STAR_CLEAR_DEG;
  }
  if (intent.kind === 'show_constellation') {
    const con = findConstellation(intent.name);
    const lines = con ? FIGURES[con] : undefined;
    if (!lines) return null;
    const stars = lines.map(([a, b]) => [findStar(a)!, findStar(b)!] as const);
    return (epoch) => stars.some(([a, b]) => alt(a.raH, a.decDeg, epoch) >= FIGURE_CLEAR_DEG && alt(b.raH, b.decDeg, epoch) >= FIGURE_CLEAR_DEG);
  }
  return null;
}

/**
 * The first quarter hour on the place's clock, after the chart's instant and
 * within two nights, when the star or figure is well up in the dark. Null when
 * there is none (it never rises from here, or only by day this time of year).
 */
export function whenUp(chart: SkyChart, intent: Intent): number | null {
  const isUp = upTest(chart, intent);
  if (!isUp) return null;
  const offset = chart.tz * 3600;
  let epoch = Math.floor((chart.epoch + offset) / STEP_S + 1) * STEP_S - offset;
  for (let i = 0; i < (SEARCH_HOURS * 3600) / STEP_S; i++, epoch += STEP_S) {
    const { hours } = nightOf(epoch, chart.tz);
    if (hours < 19 || hours > 29.5) continue;
    if (isUp(epoch)) return epoch;
  }
  return null;
}
