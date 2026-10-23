// What is wrong with the floor, and the schedule that says what it adds up to.
//
// Two things a drawing on its own cannot tell you: whether you can get to every
// room, and what you are actually buying. Both are computed from scratch on
// every read: an issue that outlived the wall it complained about is the one
// bug a critic cannot recover from.
//
// These are opinions, not a code check. Nothing here cites a regulation, and
// the designer never says "compliant". The numbers are the point below which a
// room stops working: a corridor two people cannot pass in, a bathroom with no
// room to turn around, a bedroom reached only through another one.
//
// The ordering is severity, and severity is what it costs to fix later: a room
// you cannot reach is a plan problem, a pinched walkway a furniture problem.
import { areaM2, CELL_CM, cell, colOf, gapBetween, narrowestCm, overlaps, rectCells, rectWithin, rowOf, sharedEdge, type Cell, type Rect } from './geom.ts';
import type { Home, Item, Level } from './home.ts';
import { cmpStr, fmtG, pyRound } from './num.ts';
import { BED_ACCESS_CM, SNUG_CM, WALKWAY_CM } from './place.ts';

/** Beyond this the list is elided rather than allowed to bury the worst of it. */
export const MAX_ISSUES = 12;
/** Two people passing. */
export const CORRIDOR_MIN_CM = 90;
/** A wheelchair, or a person with a laundry basket, turning around. */
export const TURNING_CIRCLE_CM = 150;
/**
 * Assumed head height of a window, for turning a width into a glazed area.
 * Windows carry a width and no height; one honest constant compares rooms fairly.
 */
export const GLAZING_HEIGHT_CM = 130;
/** Daylight rule of thumb: glazing worth about a tenth of the floor. */
export const DAYLIGHT_RATIO = 0.10;
/** Dead floor worth mentioning; below it, it is a drawing artefact. */
export const DEAD_FLOOR_M2 = 1.5;

// Severity ranks. Lower is worse, and worse is said first.
const UNREACHABLE = 0;
const NO_DOOR = 0;
const STRANDED_PIECE = 1;
const BLOCKED_DOOR = 2;
const TIGHT_CORRIDOR = 3;
const NO_DAYLIGHT = 4;
const NO_TURNING = 5;
const DEAD_FLOOR = 6;
const WET_RUN = 7;
const WALKWAY = 8;
const BED_REACH = 9;
const STAIRS = 0;

export interface Issue { room?: string | null; item?: string; kind: string; note: string }
type Ranked = [number, Issue];

/** Everything wrong with the home right now, worst first, capped. */
export function issues(home: Home): Issue[] {
  const level = home.level;
  const found: Ranked[] = [
    ...circulationIssues(level, home.active > 0),
    ...roomIssues(level),
    ...furnitureIssues(level),
    ...wetIssues(level),
    ...levelIssues(home),
  ];
  found.sort((p, q) => p[0] - q[0] || cmpStr(p[1].room ?? '', q[1].room ?? '') || cmpStr(p[1].kind, q[1].kind));
  return found.slice(0, MAX_ISSUES).map(([, issue]) => issue);
}

// ------------------------------------------------------------- getting around

/**
 * Room ids you can walk to from the front door. A door is an edge and the
 * outside is the start, so a home with no front door reaches nothing: better
 * said once about the missing door than once per room.
 */
export function reachable(level: Level, { upstairs = false } = {}): Set<string> {
  const graph = new Map<string, Set<string>>([...level.rooms.keys()].map((id) => [id, new Set<string>()]));
  // Upstairs, the way in is the stairs (a change in the port: the original
  // asked every floor for a front door, so a new upper floor was told it had
  // none, and a laid-out one got an outside door on the landing).
  const start = new Set<string>(upstairs ? [...level.rooms.values()].filter((r) => r.kind === 'stairs').map((r) => r.id) : []);
  for (const opening of level.openings) {
    if (opening.kind !== 'door') continue;
    if (opening.a && opening.b) {
      graph.get(opening.a)?.add(opening.b);
      graph.get(opening.b)?.add(opening.a);
    } else {
      const inside = opening.a || opening.b;
      if (inside) start.add(inside);
    }
  }
  const seen = new Set(start);
  const queue = [...start];
  for (let i = 0; i < queue.length; i++) {
    for (const next of graph.get(queue[i]) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

function circulationIssues(level: Level, upstairs = false): Ranked[] {
  const out: Ranked[] = [];
  if (!level.rooms.size) return out;
  const front = level.openings.filter((o) => o.kind === 'door' && o.exterior);
  // Upstairs a floor with no stairs is the level check's complaint ("the two
  // floors don't connect"), not a missing front door.
  const stairs = [...level.rooms.values()].some((r) => r.kind === 'stairs');
  if (upstairs ? !stairs && !front.length : !front.length) {
    return upstairs ? [] : [[UNREACHABLE, { kind: 'no_front_door', note: "There's no front door on this floor yet" }]];
  }
  const canReach = reachable(level, { upstairs });
  for (const room of level.rooms.values()) {
    if (upstairs && room.kind === 'stairs') continue;   // the way in, not a room to get to
    const name = room.name.toLowerCase();
    const doors = level.openings.filter((o) => o.kind === 'door' && (o.a === room.id || o.b === room.id));
    if (!doors.length) {
      out.push([NO_DOOR, { room: room.id, kind: 'no_door', note: `The ${name} has no door — there's no way into it` }]);
    } else if (!canReach.has(room.id)) {
      // Upstairs the way in is the stairs, and the floor has no front door to name.
      out.push([UNREACHABLE, { room: room.id, kind: 'unreachable', note: `You can't get to the ${name} from the ${upstairs ? 'stairs' : 'front door'}` }]);
    } else if (!room.spec.circulation) {
      const through = [...neighboursViaDoors(level, room.id)].filter((id) => level.rooms.has(id)).map((id) => level.rooms.get(id)!);
      if (through.length === 1 && through.every((other) => !other.spec.circulation && !other.spec.wet)) {
        out.push([TIGHT_CORRIDOR + 1, { room: room.id, kind: 'through_room', note: `The ${name} is only reached through the ${through[0].name.toLowerCase()}` }]);
      }
    }
  }
  return out;
}

function neighboursViaDoors(level: Level, roomId: string): Set<string> {
  const out = new Set<string>();
  for (const o of level.openings) {
    if (o.kind !== 'door') continue;
    if (o.a === roomId && o.b) out.add(o.b);
    else if (o.b === roomId && o.a) out.add(o.a);
  }
  return out;
}

// ------------------------------------------------------- the rooms themselves

function roomIssues(level: Level): Ranked[] {
  const out: Ranked[] = [];
  for (const room of level.rooms.values()) {
    const cells = level.cellsOf(room.id);
    if (!cells.size) continue;
    const name = room.name.toLowerCase();
    if (room.spec.circulation) {
      const narrow = narrowestCm(cells);
      if (narrow < CORRIDOR_MIN_CM) {
        out.push([TIGHT_CORRIDOR, { room: room.id, kind: 'corridor', note: `The ${name} narrows to ${narrow} cm — two people can't pass` }]);
      }
    }
    if (room.spec.habitable) {
      const glazed = level.openings
        .filter((o) => o.kind === 'window' && (o.a === room.id || o.b === room.id))
        .reduce((sum, o) => sum + o.width_cm * GLAZING_HEIGHT_CM, 0);
      const wanted = areaM2(cells) * 10_000 * DAYLIGHT_RATIO;
      if (glazed <= 0) out.push([NO_DAYLIGHT, { room: room.id, kind: 'daylight', note: `The ${name} has no window at all` }]);
      else if (glazed < wanted) out.push([NO_DAYLIGHT + 1, { room: room.id, kind: 'daylight', note: `The ${name} is short of daylight for its size` }]);
    }
    if (room.spec.wet && !hasTurningCircle(level, room.id)) {
      out.push([NO_TURNING, { room: room.id, kind: 'turning', note: `There's no clear metre and a half to turn around in the ${name}` }]);
    }
  }
  const dead = level.freeCells();
  if (dead.size && areaM2(dead) >= DEAD_FLOOR_M2) {
    out.push([DEAD_FLOOR, { kind: 'dead_floor', note: `${fmtG(areaM2(dead))} square metres of the floor isn't in any room` }]);
  }
  return out;
}

/**
 * Whether a 150 cm square of clear floor fits somewhere in the room. Furniture
 * counts against it: a bathroom is fine empty and unusable once the bath is in,
 * and the empty one is not the one anybody lives in.
 */
function hasTurningCircle(level: Level, roomId: string): boolean {
  const cells = level.cellsOf(roomId);
  if (!cells.size) return false;
  const taken = new Set<Cell>();
  for (const item of level.items) for (const k of rectCells(item.rect)) taken.add(k);
  const free = new Set([...cells].filter((k) => !taken.has(k)));
  const span = Math.floor(TURNING_CIRCLE_CM / CELL_CM);
  for (const k of free) {
    const c = colOf(k), r = rowOf(k);
    let clear = true;
    for (let dc = 0; dc < span && clear; dc++) for (let dr = 0; dr < span && clear; dr++) if (!free.has(cell(c + dc, r + dr))) clear = false;
    if (clear) return true;
  }
  return false;
}

// ----------------------------------------------------------------- furniture

function furnitureIssues(level: Level): Ranked[] {
  const out: Ranked[] = [];
  for (const item of level.items) {
    const owners = level.roomsUnder(item.rect);
    const label = item.label.toLowerCase();
    if (!owners.size) {
      out.push([STRANDED_PIECE, { room: null, item: item.id, kind: 'stranded', note: `The ${label} is standing on floor that isn't a room` }]);
    } else if (owners.size > 1) {
      const names = [...owners].filter((o) => level.rooms.has(o)).map((o) => level.rooms.get(o)!.name.toLowerCase()).sort(cmpStr);
      out.push([STRANDED_PIECE, { room: null, item: item.id, kind: 'straddles', note: `The ${label} crosses the wall between the ${names[0]} and the ${names[1]}` }]);
    }
  }
  level.items.forEach((item, index) => {
    for (const other of level.items.slice(index + 1)) {
      const found = gapBetween(item.rect, other.rect);
      if (found === null) continue;
      const cm = found[1];
      if (SNUG_CM < cm && cm < WALKWAY_CM) {
        out.push([WALKWAY, { room: level.roomOfItem(item), item: item.id, kind: 'walkway', note: `Walkway by the ${item.label.toLowerCase()} is ${cm} cm` }]);
      }
    }
  });
  for (const [, zone] of level.doorSwings()) {
    const blocking = level.items.find((item) => overlaps(item.rect, zone));
    if (blocking) {
      out.push([BLOCKED_DOOR, { room: level.roomOfItem(blocking), item: blocking.id, kind: 'door', note: `A door can't open — the ${blocking.label.toLowerCase()} is in the way` }]);
    }
  }
  for (const item of level.items) {
    if (!item.piece.type.startsWith('bed_')) continue;
    const sides = freeSides(level, item, BED_ACCESS_CM);
    if (sides < 2) {
      const label = item.label.toLowerCase();
      out.push([BED_REACH, {
        room: level.roomOfItem(item), item: item.id, kind: 'reach',
        note: sides === 1 ? `The ${label} can only be reached from one side` : `The ${label} can't be reached from either side`,
      }]);
    }
  }
  return out;
}

/** How many of a piece's long sides have `needCm` of clear room beside them. */
function freeSides(level: Level, item: Item, needCm: number): number {
  const [x0, y0, x1, y1] = item.rect;
  const longAxisNS = y1 - y0 >= x1 - x0;
  const probes: Rect[] = longAxisNS
    ? [[x0 - needCm, y0, x0, y1], [x1, y0, x1 + needCm, y1]]
    : [[x0, y0 - needCm, x1, y0], [x0, y1, x1, y1 + needCm]];
  const roomId = level.roomOfItem(item);
  const roomCells = roomId ? level.cellsOf(roomId) : new Set<Cell>();
  let free = 0;
  for (const probe of probes) {
    if (!rectWithin(probe, roomCells)) continue;
    if (level.items.some((other) => other.id !== item.id && overlaps(probe, other.rect))) continue;
    free++;
  }
  return free;
}

// ---------------------------------------------------------- plumbing and levels

/**
 * Wet rooms scattered across the floor mean pipe runs under everything. A soft
 * complaint on purpose: a cost and a noise problem, not a correctness one.
 */
function wetIssues(level: Level): Ranked[] {
  const wet = [...level.rooms.values()].filter((room) => room.spec.wet);
  if (wet.length < 2) return [];
  // Which wet rooms have a wet neighbour. Returning as soon as ANY pair touched
  // let a third wet room at the far end of the floor go unmentioned.
  const cells = new Map(wet.map((room) => [room.id, level.cellsOf(room.id)]));
  const paired = new Set<string>();
  for (const room of wet) {
    for (const other of wet) {
      if (other.id !== room.id && sharedEdge(cells.get(room.id)!, cells.get(other.id)!) !== null) paired.add(room.id);
    }
  }
  const stranded = wet.filter((room) => !paired.has(room.id));
  if (!stranded.length) return [];
  const names = stranded.map((room) => room.name.toLowerCase()).sort(cmpStr).join(', ');
  const note = stranded.length === wet.length
    ? `The plumbed rooms (${names}) are all separate — that's a long pipe run`
    : `The ${names} is off on its own — that's a long pipe run to it`;
  return [[WET_RUN, { kind: 'plumbing', note }]];
}

function levelIssues(home: Home): Ranked[] {
  if (home.levels.length < 2 || home.stairsAligned()) return [];
  const hasStairs = home.levels.map((level) => [...new Set(level.owner.values())].some((id) => level.rooms.get(id)?.kind === 'stairs'));
  if (!hasStairs.every(Boolean)) {
    const missing = hasStairs[0] ? 'upstairs' : 'downstairs';
    return [[STAIRS, { kind: 'stairs', note: `There are no stairs ${missing} — the two floors don't connect` }]];
  }
  return [[STAIRS, { kind: 'stairs', note: "The stairs don't line up between the two floors" }]];
}

// ------------------------------------------------------------------- schedule

/** One square metre in square feet. */
export const FT2_PER_M2 = 10.7639;

export interface ScheduleRow { id: string; name: string; kind: string; area_m2: number; area: number }
export interface Schedule {
  unit: 'm2' | 'ft2'; rows: ScheduleRow[]; total_m2: number; total: number;
  circulation_m2: number; circulation_pct: number; unassigned_m2: number; envelope: number;
}

/**
 * What the floor adds up to: the thing a client actually reacts to.
 * Circulation is broken out because a negotiation turns on it: every square
 * metre of hall is one the bedrooms did not get.
 */
export function schedule(home: Home, unit: 'm2' | 'ft2' = 'm2'): Schedule {
  const level = home.level;
  const rows: ScheduleRow[] = [...level.rooms.values()].map((room) => {
    const area = areaM2(level.cellsOf(room.id));
    return { id: room.id, name: room.name, kind: room.kind, area_m2: area, area: inUnit(area, unit) };
  });
  rows.sort((p, q) => q.area_m2 - p.area_m2);
  const total = rows.reduce((sum, row) => sum + row.area_m2, 0);
  const circulation = rows.filter((row) => level.rooms.get(row.id)!.spec.circulation).reduce((sum, row) => sum + row.area_m2, 0);
  return {
    unit, rows,
    total_m2: pyRound(total, 1),
    total: inUnit(total, unit),
    circulation_m2: pyRound(circulation, 1),
    circulation_pct: total ? pyRound(circulation / total * 100) : 0,
    unassigned_m2: areaM2(level.freeCells()),
    envelope: inUnit(level.w_cm * level.h_cm / 10_000, unit),
  };
}

export const inUnit = (valueM2: number, unit: 'm2' | 'ft2') => (unit === 'ft2' ? pyRound(valueM2 * FT2_PER_M2) : pyRound(valueM2, 1));

export interface Delta { name: string; area_m2: number; was_m2: number; delta_m2: number; delta: number }

/**
 * Room-by-room difference between the live plan and a saved scheme. Matched on
 * NAME rather than id: the two were captured at different times, and their ids
 * describe when a room was made rather than what it is.
 */
export function compare(home: Home, otherRows: { name: string; area_m2: number }[], unit: 'm2' | 'ft2' = 'm2'): Delta[] {
  const here = new Map(schedule(home, unit).rows.map((row) => [row.name, row]));
  const there = new Map(otherRows.map((row) => [row.name, row]));
  const out: Delta[] = [];
  for (const name of [...new Set([...here.keys(), ...there.keys()])].sort(cmpStr)) {
    const mine = here.get(name)?.area_m2 ?? 0.0;
    const theirs = there.get(name)?.area_m2 ?? 0.0;
    if (pyRound(mine - theirs, 1) === 0 && here.has(name) && there.has(name)) continue;
    out.push({
      name, area_m2: mine, was_m2: theirs,
      delta_m2: pyRound(mine - theirs, 1),
      delta: inUnit(Math.abs(mine - theirs), unit) * (mine >= theirs ? 1 : -1),
    });
  }
  return out;
}
