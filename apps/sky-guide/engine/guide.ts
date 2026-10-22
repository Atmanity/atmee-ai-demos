// Intents onto the chart, and what the avatar should hear about them. This is
// the original's reducer (validate before mutate; refuse by name) plus the
// decision its tool cues and narrator made: who speaks for a change.
//
// - A control (tap, button, picker): the chart moves at once; the line about it
//   is the narrator's (coalesced in the page, so three quick +1h clicks are one
//   line). A refusal is told at once.
// - A typed line: the app acted instead of the avatar, so every outcome is told.
// - A spoken line: the avatar has ALREADY started its own reply, from the state
//   it had. What that state staged (a star that is up, a figure that is up) is
//   not told again; what it could not stage (another place or hour, a rise
//   time, a refusal, a star with only catalogue-row facts) is.
import { BRIGHTEST_WORDS, SkyChart } from './chart.ts';
import { FACTS, findConstellation, findStar } from './catalog.ts';
import { combine, say } from './director.ts';
import { epochForNight, nightOf, SkyError, tonight } from './sky.ts';
import type { How, Intent, SkyView } from './types.ts';
import { materialChange, type Change } from './words.ts';

export interface Outcome {
  before: SkyView;
  view: SkyView;
  /** Each refusal's sentence, for the chart to show (the avatar is told too). */
  refusals: string[];
  /** The material change, if any (place > time > star > figure). */
  change: Change | null;
  /** What to tell the avatar now, or null. */
  event: string | null;
  /** A control's change: the narrator says the line, coalesced. */
  narrate: boolean;
}

export interface ActOptions {
  /** Every name in the request was said as the catalogue says it (no alias or
   *  mishearing): only then can the avatar have answered it from the state. */
  exact?: boolean;
  /** The real time now (unix seconds), for "tonight", "midnight" and clock hours. */
  now?: number;
}

const INTENT_KINDS = ['set_place', 'set_time', 'select', 'show_constellation', 'clear_selection', 'clear_figure'];

/** One intent onto the chart. Throws SkyError with the sentence to say. */
function applyOne(chart: SkyChart, intent: Intent, now: number): void {
  switch (intent.kind) {
    case 'set_place':
      return chart.setPlace(intent.label, intent.lat, intent.lon);
    case 'set_time': {
      if (intent.clockHour !== undefined) {
        if (!(intent.clockHour >= 0 && intent.clockHour <= 24)) throw new SkyError(`I couldn't read ${intent.clockHour} as an hour.`);
        return chart.setTime({ epoch: tonight(now, chart.tz, intent.clockHour % 24) });
      }
      if (intent.nightHours !== undefined) {
        const epoch = epochForNight(nightOf(chart.epoch, chart.tz).date, Number(intent.nightHours), chart.tz);
        if (epoch === null) throw new SkyError(`I couldn't read ${intent.nightHours} as an hour of the night.`);
        return chart.setTime({ epoch });
      }
      if (intent.date !== undefined || intent.month !== undefined || intent.season !== undefined) {
        const night = nightOf(chart.epoch, chart.tz);
        const date = intent.date ?? nextDate(night.date, intent, chart.lat);
        const epoch = date ? epochForNight(date, night.hours, chart.tz) : null;
        if (epoch === null) throw new SkyError(`I couldn't read ${intent.date ?? intent.month ?? intent.season} as a date.`);
        return chart.setTime({ epoch });
      }
      return chart.setTime({ epoch: intent.epoch, shiftHours: intent.shiftHours, preset: intent.preset, now });
    }
    case 'select':
      return chart.select(intent.star);
    case 'show_constellation':
      return chart.showConstellation(intent.name);
    case 'clear_selection':
      return chart.clearSelection();
    case 'clear_figure':
      return chart.clearFigure();
    default:
      // Refused BY NAME, so a typo is a visible refusal rather than a silent no-op.
      throw new SkyError(`'${(intent as { kind?: string }).kind}' isn't something I can do to the sky.`);
  }
}

/** Mid-season months, north and south: winter is January north of the equator
 *  and July south of it. */
const SEASONS = { winter: [1, 7], spring: [4, 10], summer: [7, 1], autumn: [10, 4] } as const;

/** The next night in a month (on `day`, else the 15th) from the chart's night,
 *  as "YYYY-MM-DD"; the chart's own month stays where it is unless a day is given. */
function nextDate(from: string, when: { month?: number; day?: number; season?: keyof typeof SEASONS }, lat: number): string | null {
  const month = when.season ? SEASONS[when.season][lat >= 0 ? 0 : 1] : when.month;
  if (!month || month < 1 || month > 12) return null;
  const [y, m, d] = from.split('-').map(Number);
  const day = when.day ?? (month === m ? d : 15);
  if (!(day >= 1 && day <= 31)) return null;
  const year = month > m || (month === m && day >= d) ? y : y + 1;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;   // "the 31st of April"
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Could the avatar have answered this from the state it had before? */
function staged(intent: Intent, before: SkyView): boolean {
  if (intent.kind === 'select') {
    const asked = intent.star.trim().toLowerCase();
    const star = BRIGHTEST_WORDS.includes(asked) ? before.snapshot.visible[0] : findStar(intent.star);
    if (!star) return false;
    const up = before.snapshot.visible.some((v) => v.id === star.id);
    // A star with authored lines had them in the notes; one without has only
    // its catalogue row, which arrives with the marking, so it is told.
    return up && Boolean(FACTS[star.id]);
  }
  if (intent.kind === 'show_constellation') {
    const con = findConstellation(intent.name);
    return Boolean(con && before.figures.some((f) => f.con === con && f.up));
  }
  return false;
}

/**
 * Apply a request (one or more intents, in order) and decide what the avatar is
 * told. Each intent is validated on its own: a refused place does not stop the
 * time move asked for in the same breath, and a refused intent leaves the chart
 * exactly as it was.
 */
export function act(chart: SkyChart, intents: Intent[], how: How, { exact = true, now = Date.now() / 1000 }: ActOptions = {}): Outcome {
  const before = chart.view();
  const refusals: string[] = [];
  const told: Intent[] = [];
  // A star that was up a moment ago says nothing about where it is after a
  // move asked for in the same breath ("show me Vega at midnight").
  const moves = intents.some((i) => i.kind === 'set_place' || i.kind === 'set_time');
  for (const intent of intents) {
    if (!INTENT_KINDS.includes(intent.kind)) {
      refusals.push(`'${intent.kind}' isn't something I can do to the sky.`);
      continue;
    }
    try {
      applyOne(chart, intent, now);
      if (how === 'typed' || !exact || moves || !staged(intent, before)) told.push(intent);
    } catch (err) {
      if (!(err instanceof SkyError)) throw err;
      refusals.push(err.message);
    }
  }
  const view = chart.view();
  const change = materialChange(before.snapshot, view.snapshot);

  if (how === 'control') {
    return { before, view, refusals, change, event: combine(refusals.map(say.refused)), narrate: change !== null };
  }

  const parts: string[] = [];
  const moved = before.snapshot.where.label !== view.snapshot.where.label;
  const turned = before.snapshot.when.epoch !== view.snapshot.when.epoch;
  if (moved) parts.push(say.placeMoved(before, view));
  else if (turned) parts.push(say.timeMoved(before, view));
  else if (how === 'typed' && told.some((i) => i.kind === 'set_place' || i.kind === 'set_time')) parts.push(say.unchanged(view));
  if (told.some((i) => i.kind === 'show_constellation') && view.snapshot.figure) parts.push(say.figure(view));
  if (told.some((i) => i.kind === 'select') && view.snapshot.fact) parts.push(say.pointed(view));
  parts.push(...refusals.map(say.refused));
  return { before, view, refusals, change, event: combine(parts), narrate: false };
}

/** The narrator's line for a control's change (the original change cue): place
 *  and time with what rose and set, a tapped star with its fact, a lit figure
 *  with where to look. Null for changes nobody needs narrated. */
export function narration(before: SkyView, after: SkyView): string | null {
  switch (materialChange(before.snapshot, after.snapshot)) {
    case 'place': return say.placeMoved(before, after);
    case 'time': return say.timeMoved(before, after);
    case 'star': return say.tapped(after);
    case 'figure': return say.figure(after);
    default: return null;
  }
}
