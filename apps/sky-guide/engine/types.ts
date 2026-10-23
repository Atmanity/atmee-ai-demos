// What the engine, the director and the page share. The snapshot is the
// original's `SkyChart.snapshot()`, field for field: everything the chart
// draws is here and nothing else is (no right ascension, no declination; the
// positions arrive already worked out for one place at one instant).

export interface Where { label: string; lat: number; lon: number }
export interface When { epoch: number; label: string }

export interface VisibleStar {
  id: string;
  name: string;
  /** Degrees above the horizon; always positive, or it would not be here. */
  alt: number;
  /** Degrees clockwise from due north, so 90 is east. */
  az: number;
  /** Visual magnitude: smaller is brighter, and Sirius is -1.46. */
  mag: number;
  con: string;
}

export interface Figure {
  con: string;
  name: string;
  /** Pairs of star ids, both of which are guaranteed to be in `visible`. */
  lines: [string, string][];
}

export interface Fact { title: string; lines: string[] }

export interface SkySnapshot {
  where: Where;
  when: When;
  visible: VisibleStar[];
  figure: Figure | null;
  selected: string | null;
  fact: Fact | null;
  catalog_size: number;
}

/** One of the eighteen figures, as it stands at this place and instant. */
export interface FigureStatus {
  con: string;
  name: string;
  /** At least one of its lines can be drawn (both ends above the horizon). */
  up: boolean;
  /** Its brightest star on the chart, when up: the honest "where to look". */
  anchor: VisibleStar | null;
  /** When down: "it rises about 2 in the morning", "it never rises from that latitude", or "". */
  rise: string;
}

/** What the page renders and the host is told: the snapshot plus the
 *  figures' standing and the instant in words. All from one SkyChart. */
export interface SkyView {
  snapshot: SkySnapshot;
  figures: FigureStatus[];
  /** "about 9 in the evening" */
  spokenWhen: string;
  /** The place is raw coordinates, so the clock is local solar time. */
  solarTime: boolean;
  /** The night this instant belongs to, for the time control: the evening's
   *  local date and the hours since its midnight (12 to 36). */
  night: { date: string; hours: number };
}

/** Everything the chart can be asked to do. A control, a tool call and the
 *  safety net all become these; the chart validates before it mutates. */
export type Intent =
  | { kind: 'set_place'; label?: string; lat?: number | string; lon?: number | string }
  | {
      kind: 'set_time';
      preset?: string;        // "tonight" | "midnight" | "dawn" (and the original's synonyms)
      shiftHours?: number;    // relative to the chart's instant
      epoch?: number;         // absolute
      clockHour?: number;     // the next time the place's clock reads this hour (0-24, may be fractional)
      date?: string;          // "YYYY-MM-DD": that night, at the same hour of the night as now
      month?: number;         // 1-12: the next such month (the 15th, or `day`), same hour of the night
      day?: number;
      season?: 'winter' | 'spring' | 'summer' | 'autumn';   // by the place's hemisphere
      nightHours?: number;    // this same night, this many hours after the evening's midnight (12-36)
    }
  | { kind: 'select'; star: string }
  | { kind: 'show_constellation'; name: string }
  | { kind: 'clear_selection' }
  | { kind: 'clear_figure' };
