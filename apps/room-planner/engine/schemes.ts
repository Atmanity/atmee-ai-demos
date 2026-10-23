// Saved schemes: the "here are two ways to do this" a negotiation runs on.
//
// A designer presents a choice, not a plan. But an app that lets you EDIT
// several plans at once has to ask "which one?" of every single request, and
// the answer has to survive speech recognition that hears "scheme B" as "scream
// be". So there is exactly ONE editable plan and up to three saved schemes
// beside it: snapshots to flip to, compare against, and restore. You cannot say
// "make the kitchen bigger in both"; the designer switches, applies and
// switches back, and says so rather than faking it.
//
// A scheme keeps the capture that restores it and the schedule it had when
// saved. The schedule is stored rather than recomputed because comparing must
// not require restoring: a compare that mutated the live plan to read the other
// one would be the worst kind of feature.
import { schedule, type ScheduleRow } from './compliance.ts';
import { areaM2, strips, type Rect } from './geom.ts';
import { PlanError, type Home, type HomeCapture } from './home.ts';

/** Three, and the cap is a refusal: silently dropping the oldest loses work. */
export const MAX_SCHEMES = 3;

/**
 * Just enough geometry to draw a scheme beside the live one: room shapes,
 * names and areas. No furniture, doors or wall grips: at thumbnail size none of
 * it is legible, and a comparison only needs to show which rooms got bigger.
 */
export interface Thumb { w_cm: number; h_cm: number; rooms: { id: string; name: string; kind: string; area_m2: number; rects: Rect[] }[] }

export interface Scheme {
  name: string;
  capture: HomeCapture;
  rows: ScheduleRow[];
  total_m2: number;
  rooms: number;
  /** Two layouts of one envelope are often identical on total area and every
   *  room within half a metre; the hall is what separates them. */
  circulation_pct: number;
  thumb: Thumb;
}

export interface SchemeSummary { name: string; rooms: number; total_m2: number; circulation_pct: number }

export function thumbnail(home: Home): Thumb {
  const level = home.level;
  return {
    w_cm: level.w_cm,
    h_cm: level.h_cm,
    rooms: [...level.rooms.values()].map((room) => {
      const cells = level.cellsOf(room.id);
      return { id: room.id, name: room.name, kind: room.kind, area_m2: areaM2(cells), rects: strips(cells) };
    }),
  };
}

export class Schemes {
  saved = new Map<string, Scheme>();

  save(home: Home, name: unknown): Scheme {
    const label = String(name || '').trim() || `Scheme ${this.saved.size + 1}`;
    if (!this.saved.has(label) && this.saved.size >= MAX_SCHEMES) {
      throw new PlanError(`I'm holding ${MAX_SCHEMES} schemes already — tell me which one to drop and I'll save over it.`);
    }
    const table = schedule(home);
    const scheme: Scheme = {
      name: label,
      capture: home.capture(),
      rows: table.rows,
      total_m2: table.total_m2,
      rooms: home.level.rooms.size,
      circulation_pct: table.circulation_pct,
      thumb: thumbnail(home),
    };
    this.saved.set(label, scheme);
    return scheme;
  }

  find(name: unknown): Scheme {
    const key = String(name || '').trim().toLowerCase();
    if (!key) throw new PlanError('Which scheme did you mean?');
    for (const scheme of this.saved.values()) if (scheme.name.toLowerCase() === key) return scheme;
    for (const scheme of this.saved.values()) if (scheme.name.toLowerCase().includes(key)) return scheme;
    throw new PlanError(`I haven't got a scheme called ${String(name)}.`);
  }

  restore(home: Home, name: unknown): Scheme {
    const scheme = this.find(name);
    home.restore(scheme.capture);
    return scheme;
  }

  drop(name: unknown): Scheme {
    const scheme = this.find(name);
    this.saved.delete(scheme.name);
    return scheme;
  }

  asList(): SchemeSummary[] {
    return [...this.saved.values()].map((s) => ({ name: s.name, rooms: s.rooms, total_m2: s.total_m2, circulation_pct: s.circulation_pct }));
  }
}
