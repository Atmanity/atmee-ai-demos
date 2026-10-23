// Intents onto the chart: the original's reducer (validate before mutate;
// refuse by name). A tool call, a button, a tap and the safety net all end
// here, so there is one set of rules for what the chart accepts.
//
// What anybody is told about a change is decided elsewhere: a tool's result
// in `actions.ts`, a control's line in the narrator (`narration` below).
import { SkyChart } from './chart.ts';
import { told } from './director.ts';
import { epochForNight, nightOf, SkyError, tonight } from './sky.ts';
import type { Intent, SkyView } from './types.ts';
import { materialChange, type Change } from './words.ts';

export interface Applied {
  before: SkyView;
  view: SkyView;
  /** Each refusal's sentence, for the chart to show and the host to say. */
  refusals: string[];
  /** The intents the chart accepted, in order. */
  accepted: Intent[];
  /** The material change, if any (place > time > star > figure). */
  change: Change | null;
}

export interface ApplyOptions {
  /** The real time now (unix seconds), for "tonight", "midnight" and clock hours. */
  now?: number;
  /**
   * A new place keeps the hour of the night rather than the instant: "the sky
   * from Lisbon" while the chart shows Taipei at 9 pm is Lisbon at 9 pm that
   * night, which is what someone asking means (the same instant would be
   * Lisbon at 1 in the afternoon). On unless a time is asked for alongside.
   */
  keepHour?: boolean;
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

/**
 * Apply intents in order. Each is validated on its own: a refused place does
 * not stop the time move asked for in the same breath, and a refused intent
 * leaves the chart exactly as it was.
 */
export function apply(chart: SkyChart, intents: Intent[], { now = Date.now() / 1000, keepHour = true }: ApplyOptions = {}): Applied {
  const before = chart.view();
  const refusals: string[] = [];
  const accepted: Intent[] = [];
  const timed = intents.some((i) => i.kind === 'set_time');
  for (const intent of intents) {
    if (!INTENT_KINDS.includes(intent.kind)) {
      refusals.push(`'${intent.kind}' isn't something I can do to the sky.`);
      continue;
    }
    try {
      const night = nightOf(chart.epoch, chart.tz);
      applyOne(chart, intent, now);
      if (intent.kind === 'set_place' && keepHour && !timed) {
        const epoch = epochForNight(night.date, night.hours, chart.tz);
        try {
          if (epoch !== null) chart.setTime({ epoch });
        } catch (err) {
          if (!(err instanceof SkyError)) throw err;   // at the edge of 1900 or 2100: the instant stays
        }
      }
      accepted.push(intent);
    } catch (err) {
      if (!(err instanceof SkyError)) throw err;
      refusals.push(err.message);
    }
  }
  const view = chart.view();
  return { before, view, refusals, accepted, change: materialChange(before.snapshot, view.snapshot) };
}

/** The line for a change made with the chart's own controls (the original
 *  change cue): place and time with what rose and set, a tapped star with its
 *  fact, a lit figure with where to look. Null for changes nobody needs told. */
export function narration(before: SkyView, after: SkyView): string | null {
  switch (materialChange(before.snapshot, after.snapshot)) {
    case 'place': return told.placeMoved(before, after);
    case 'time': return told.timeMoved(before, after);
    case 'star': return told.tapped(after);
    case 'figure': return told.figure(after);
    default: return null;
  }
}
