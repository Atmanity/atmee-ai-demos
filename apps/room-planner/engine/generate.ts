// Turning a brief into a floor.
//
// A client describes a household, not a partition: "two of us, a baby coming,
// we work from home, and we want to eat where we cook." Asking them to place
// eight rooms one at a time before anything appears is twenty turns of nothing,
// and it puts the model back in the business of choosing coordinates. So the
// words supply the BRIEF and code supplies the geometry: what arrives is a list
// of rooms and roughly how much floor each should get; what leaves is a
// partition that tiles the envelope with no gaps, no overlaps, and a door into
// every room.
//
// Why a slicing tree: every rectangle comes from cutting a rectangle in two, so
// the output is a partition by construction, with no validation pass that can
// fail for a reason the client would have to hear about.
//
// Why a typology on top: a slicing tree alone puts rooms in weight order, which
// is how you get a bathroom between two halves of a living room. A typology
// supplies the architectural part: a day end and a night end, the corridor where
// the front door is, bedrooms away from the entry.
import { CELL_CM, sharedEdge, type Rect } from './geom.ts';
import { DEFAULT_DOOR_CM, MIN_DOOR_CM, PlanError, type Level, type Room } from './home.ts';
import { pyRound } from './num.ts';
import { kindOrOther, type RoomKind } from './rooms.ts';

/** A corridor at least this wide; below it two people cannot pass. */
export const CORRIDOR_CM = 110;
/** Below this floor area no corridor is carved: on a small floor a hall is dead area. */
export const CORRIDOR_MIN_FLOOR_M2 = 32.0;

/** One room the brief asks for, before it has any floor. */
export class Slot {
  constructor(public kind: string, public name: string | null = null, public area_m2: number | null = null) {}
  get spec(): RoomKind { return kindOrOther(this.kind); }
  get weight(): number { return this.area_m2 ? this.area_m2 : this.spec.weight * 6.0; }
}

/**
 * A way of arranging a home, independent of its size. The zones are the
 * architectural claim: rooms in the first zone sit at the entry end, rooms in
 * the last furthest from it.
 */
export interface Typology {
  key: string;
  label: string;
  note: string;
  zones: string[][];
  corridor: boolean;
}

export const TYPOLOGIES: Typology[] = [
  {
    key: 'day_night',
    label: 'Day end, night end',
    note: 'Living, kitchen and dining together at the entry end; bedrooms and bathroom off the far end of the hall, away from the noise.',
    zones: [
      ['entry', 'hall', 'wc', 'kitchen', 'dining', 'living'],
      ['utility', 'storage', 'office'],
      ['bathroom', 'shower_room', 'bedroom', 'bedroom_single', 'nursery', 'closet'],
    ],
    corridor: true,
  },
  {
    key: 'open_plan',
    label: 'Open plan living',
    note: 'Kitchen, dining and living as one big room across the bright side, with the bedrooms tucked behind it.',
    zones: [
      ['entry', 'hall', 'living', 'kitchen', 'dining'],
      ['wc', 'bathroom', 'shower_room', 'utility', 'storage', 'office'],
      ['bedroom', 'bedroom_single', 'nursery', 'closet'],
    ],
    corridor: true,
  },
  {
    key: 'dual_aspect',
    label: 'Rooms on both sides',
    note: 'A hall down the middle with rooms either side, so every room gets an outside wall and its own window.',
    zones: [
      ['entry', 'hall'],
      ['living', 'kitchen', 'dining', 'office'],
      ['bedroom', 'bedroom_single', 'nursery', 'bathroom', 'shower_room', 'wc', 'utility', 'storage', 'closet'],
    ],
    corridor: true,
  },
  {
    key: 'compact',
    label: 'No wasted hall',
    note: 'Rooms opening straight off each other with no corridor at all — every square metre is floor you use.',
    zones: [
      ['entry', 'living', 'kitchen', 'dining'],
      ['bedroom', 'bedroom_single', 'nursery', 'office'],
      ['bathroom', 'shower_room', 'wc', 'utility', 'storage', 'closet'],
    ],
    corridor: false,
  },
];

export function typology(key: string): Typology {
  return TYPOLOGIES.find((t) => t.key === key) ?? TYPOLOGIES[0];
}

// ------------------------------------------------------------------ the brief

export interface BriefExtras { office?: boolean; dining?: boolean; ensuite?: boolean; wc?: boolean; utility?: boolean; upstairs?: boolean }

/**
 * The rooms a household of this shape needs, before any sizing: a default
 * rather than a decision, so something correct is on screen before the client
 * has answered eight questions.
 *
 * `upstairs` is a different brief, not a variation: asked for three bedrooms on
 * the floor above, the ground-floor brief produced a complete second house (a
 * second kitchen, a second living room), which nobody has ever wanted upstairs.
 */
export function briefFor(bedrooms: number, { office = false, dining = false, ensuite = false, wc = false, utility = false, upstairs = false }: BriefExtras = {}): Slot[] {
  if (upstairs) {
    const slots = [new Slot('hall', 'Landing')];
    if (wc || ensuite) slots.push(new Slot('shower_room', 'En suite'));
    slots.push(new Slot('bathroom'));
    if (office) slots.push(new Slot('office'));
    for (let index = 0; index < Math.max(1, bedrooms); index++) {
      slots.push(index === 0 ? new Slot('bedroom', 'Main bedroom') : new Slot(index === 1 ? 'bedroom' : 'bedroom_single'));
    }
    return slots;
  }
  const slots = [new Slot('entry'), new Slot('living'), new Slot('kitchen')];
  if (dining) slots.push(new Slot('dining'));
  if (office) slots.push(new Slot('office'));
  if (utility) slots.push(new Slot('utility'));
  if (wc) slots.push(new Slot('wc'));
  slots.push(new Slot('bathroom'));
  if (ensuite) slots.push(new Slot('shower_room', 'En suite'));
  for (let index = 0; index < Math.max(0, bedrooms); index++) {
    slots.push(index === 0 ? new Slot('bedroom', 'Main bedroom') : new Slot(index === 1 ? 'bedroom' : 'bedroom_single'));
  }
  return slots;
}

// --------------------------------------------------------------- the partition

/** [key, weight] or [key, weight, min side in cm]. */
export type Weighted<K> = [K, number] | [K, number, number];

/**
 * Cut a rectangle into one piece per entry, in proportion to the weights.
 *
 * - Split across the longer side: a rectangle cut repeatedly across the same
 *   axis ends up eight times longer than it is wide.
 * - Respect what the pieces need to be: a bathroom is not a bathroom below
 *   150 cm across. Weight alone happily hands it 140 and produces a floor that
 *   is then refused, naming a room the client never chose the size of. So a cut
 *   that cannot leave both sides their minimum is not taken on that axis; only
 *   if neither axis can does the proportional cut go through and the refusal
 *   happen honestly.
 */
export function sliceRect<K>(rect: Rect, weighted: Weighted<K>[]): [K, Rect][] {
  const items: [K, number, number][] = weighted.map((e) => [e[0], e[1], e.length > 2 ? (e[2] as number) : 0]);
  if (!items.length) return [];
  if (items.length === 1) return [[items[0][0], rect]];
  const [x0, y0, x1, y1] = rect;
  const total = items.reduce((sum, [, w]) => sum + w, 0) || 1.0;

  // Split the list where it comes closest to halving the weight.
  let running = 0.0;
  let cutAt = 1;
  let best: number | null = null;
  items.slice(0, -1).forEach(([, weight], i) => {
    running += weight;
    const gap = Math.abs(running / total - 0.5);
    if (best === null || gap < best) {
      best = gap;
      cutAt = i + 1;
    }
  });
  const head = items.slice(0, cutAt), tail = items.slice(cutAt);
  const share = head.reduce((sum, [, w]) => sum + w, 0) / total;

  const needHead = need(head), needTail = need(tail);
  const wide = x1 - x0, deep = y1 - y0;
  // An axis works when the shared dimension clears the tightest requirement and
  // the split dimension has room for both minimums.
  const verticalOk = deep >= Math.max(needHead, needTail) && wide >= needHead + needTail;
  const horizontalOk = wide >= Math.max(needHead, needTail) && deep >= needHead + needTail;
  let preferVertical = wide >= deep;
  if (preferVertical && !verticalOk && horizontalOk) preferVertical = false;
  else if (!preferVertical && !horizontalOk && verticalOk) preferVertical = true;

  if (preferVertical) {
    const cut = snapBetween(x0, x1, share, needHead, needTail);
    return [...sliceRect([x0, y0, cut, y1], head), ...sliceRect([cut, y0, x1, y1], tail)];
  }
  const cut = snapBetween(y0, y1, share, needHead, needTail);
  return [...sliceRect([x0, y0, x1, cut], head), ...sliceRect([x0, cut, x1, y1], tail)];
}

/**
 * The tightest minimum side anything in this subtree needs. Necessary rather
 * than sufficient, and cheap: it catches the case that actually happens, one
 * small wet room sharing a cut with three large rooms.
 */
const need = <K>(items: [K, number, number][]) => items.reduce((most, [, , min]) => Math.max(most, min), 0);

/**
 * A grid-aligned cut that leaves each side its minimum. When both cannot be
 * met the clamp collapses to the midpoint rather than silently favouring one
 * side: the refusal that follows should name a room that is genuinely too small.
 */
function snapBetween(low: number, high: number, share: number, needLow: number, needHigh: number): number {
  const raw = low + (high - low) * share;
  const cut = Math.trunc(pyRound(raw / CELL_CM)) * CELL_CM;
  const floor = low + Math.max(CELL_CM, needLow);
  const ceiling = high - Math.max(CELL_CM, needHigh);
  if (floor > ceiling) return Math.max(low + CELL_CM, Math.min(high - CELL_CM, Math.floor((low + high) / 2)));
  return Math.max(floor, Math.min(ceiling, cut));
}

/**
 * Lay the whole floor out, replacing whatever was on it.
 *
 * `reserve` is floor spoken for before slicing starts: the stairs, when the
 * floor below already has them. Laying out an upper storey without it moved
 * the staircase, and two flights that do not meet is the one error a plan of
 * each floor separately cannot show.
 *
 * Throws PlanError naming the room that would not fit rather than drawing a
 * floor with something missing: a plan quietly short a bathroom is the failure
 * a client discovers last and trusts least.
 */
export function generate(level: Level, slots: Slot[], { style = 'day_night', entryWall = 'south', reserve = null as Rect | null, frontDoor = true } = {}): Typology {
  const shape = typology(style);
  if (!slots.length) throw new PlanError("Tell me what rooms you need and I'll lay it out.");
  // The floor is cleared before anything is sliced, so a brief that failed
  // partway used to leave the plan WIPED and half rebuilt. "She said the
  // five-bed wouldn't fit and my whole plan vanished."
  const before = level.capture();
  try {
    layOut(level, shape, slots, entryWall, reserve, frontDoor);
  } catch (err) {
    level.restore(before);
    throw err;
  }
  return shape;
}

function layOut(level: Level, shape: Typology, slots: Slot[], entryWall: string, reserve: Rect | null, frontDoor: boolean): void {
  level.owner.clear();
  level.rooms.clear();
  level.openings = [];
  level.items = [];

  const floorM2 = level.w_cm * level.h_cm / 10_000;
  let ordered = order(slots, shape);
  let body: Rect = [0, 0, level.w_cm, level.h_cm];
  let corridorRect: Rect | null = null;
  if (shape.corridor && floorM2 >= CORRIDOR_MIN_FLOOR_M2) {
    [corridorRect, body] = carveCorridor(level, entryWall);
    ordered = ordered.filter((slot) => !slot.spec.circulation);
  }

  const pieces = sliceRect<Slot>(body, ordered.map((slot): Weighted<Slot> => [slot, slot.weight, slot.spec.min_width_cm]));
  if (corridorRect !== null) level.placeRoom('hall', corridorRect, 'Hall');
  for (const [slot, rect] of pieces) {
    try {
      level.placeRoom(slot.kind, rect, slot.name);
    } catch (err) {
      if (!(err instanceof PlanError)) throw err;
      throw new PlanError(`I can't fit ${article(slot.spec.label)} on a floor this size — ${err.message}`);
    }
  }
  // The stairs go in last and take their floor off whichever room can spare it,
  // so they land above the flight below rather than wherever the partition left room.
  if (reserve !== null) reserveStairs(level, reserve);
  hangDoors(level, frontDoor);
  cutWindows(level);
}

/**
 * Put the stairs where the floor below has them, or at least put them in. The
 * exact footprint first, because two flights in the same place is the point;
 * when that fails the stairs still go in somewhere and stairsAligned reports
 * the floors do not meet. A visible problem beats a lost request.
 */
function reserveStairs(level: Level, rect: Rect): void {
  try {
    level.placeRoom('stairs', rect);
    return;
  } catch (err) {
    if (!(err instanceof PlanError)) throw err;
  }
  try {
    level.addRoom('stairs', null, areaOf(rect));
  } catch (err) {
    // Nothing on this floor can spare the room; the checks say the floors do
    // not connect, which is the truth.
    if (!(err instanceof PlanError)) throw err;
  }
}

const areaOf = (rect: Rect) => (rect[2] - rect[0]) * (rect[3] - rect[1]) / 10_000;

/** Rooms in zone order, so the slicing tree cuts along the grain of a home. */
function order(slots: Slot[], shape: Typology): Slot[] {
  const rank = (slot: Slot): [number, number] => {
    const index = shape.zones.findIndex((zone) => zone.includes(slot.kind));
    return [index === -1 ? shape.zones.length : index, -slot.weight];
  };
  return [...slots].sort((a, b) => {
    const [ra, wa] = rank(a), [rb, wb] = rank(b);
    return ra - rb || wa - wb;
  });
}

/**
 * Take a corridor off the entry wall and hand back what is left. Along the
 * entry wall keeps the front door and the hall on the same side; it does NOT
 * follow that every room touches it, which is why hangDoors floods outwards.
 */
function carveCorridor(level: Level, entryWall: string): [Rect, Rect] {
  const width = CORRIDOR_CM;
  const { w_cm: w, h_cm: h } = level;
  if (entryWall === 'north') return [[0, 0, w, width], [0, width, w, h]];
  if (entryWall === 'south') return [[0, h - width, w, h], [0, 0, w, h - width]];
  if (entryWall === 'west') return [[0, 0, width, h], [width, 0, w, h]];
  return [[w - width, 0, w, h], [0, 0, w - width, h]];
}

/**
 * A door into every room, growing outwards from the entry. Assuming every room
 * touched the corridor was a mistake worth recording: the slicing tree puts a
 * second rank of rooms behind the first, and half a brief's rooms opened onto
 * nothing. So doors are hung by flooding: a room is connected when it shares a
 * wall with something connected, the corridor merely preferred. A bedroom
 * reached through the living room is a real plan (the checks say whether it is
 * a good one); a bedroom reached through nothing is not a plan at all.
 */
function hangDoors(level: Level, frontDoor = true): void {
  const rooms = [...level.rooms.values()];
  const circulation = rooms.filter((r) => r.spec.circulation);
  let seed: Room | null = circulation[0] ?? null;
  if (!seed) {
    for (const r of rooms) if (seed === null || level.cellsOf(r.id).size > level.cellsOf(seed.id).size) seed = r;
  }
  if (seed === null) return;
  const connected = new Set([seed.id]);
  const pending = rooms.filter((room) => room.id !== seed!.id);
  while (pending.length) {
    let progressed = false;
    for (const room of [...pending]) {
      const neighbours = [...level.rooms.values()].filter((other) =>
        connected.has(other.id) && sharedEdge(level.cellsOf(room.id), level.cellsOf(other.id)) !== null);
      if (!neighbours.length) continue;
      // A door onto circulation beats a door through someone's bedroom, and a
      // long shared wall beats a short one. Every candidate is tried: a room
      // counted as connected because its preferred door FAILED is a room with
      // no way in, drawn by code that believed it had just given it one.
      const size = new Map(neighbours.map((n) => [n.id, level.cellsOf(n.id).size]));
      neighbours.sort((p, q) => Number(q.spec.circulation) - Number(p.spec.circulation) || size.get(q.id)! - size.get(p.id)!);
      if (!neighbours.some((other) => tryDoor(level, room, other))) continue;
      connected.add(room.id);
      pending.splice(pending.indexOf(room), 1);
      progressed = true;
    }
    // Genuinely stranded rooms: the checks name them; drawing the rest is still useful.
    if (!progressed) break;
  }
  // The front door goes in whatever the doors flooded out from: the hall when
  // there is one, the biggest room when there is not. Not upstairs, where the
  // way in is the stairs (an outside door on a landing was the original's).
  if (!frontDoor) return;
  for (const wall of ['south', 'north', 'east', 'west']) {
    try {
      level.addFrontDoor(seed, wall);
      break;
    } catch (err) {
      if (!(err instanceof PlanError)) throw err;
    }
  }
}

/**
 * Hang one door, narrowed to what the shared wall can take: a wall two rooms
 * share for only a metre takes a 70 cm door, not an 85 cm one, and giving up
 * on the pair over the default width strands a room for no good reason.
 */
function tryDoor(level: Level, room: Room, target: Room): boolean {
  const edge = sharedEdge(level.cellsOf(room.id), level.cellsOf(target.id));
  if (edge === null) return false;
  const width = Math.min(DEFAULT_DOOR_CM, edge[3] - edge[2] - 2 * CELL_CM);
  if (width < MIN_DOOR_CM) return false;
  try {
    level.addDoor(room, target, width);
  } catch (err) {
    if (!(err instanceof PlanError)) throw err;
    return false;
  }
  return true;
}

/** A window in every room that has an outside wall to put one in. */
function cutWindows(level: Level): void {
  for (const room of level.rooms.values()) {
    if (room.spec.circulation && room.kind !== 'entry') continue;
    for (const wall of ['south', 'east', 'north', 'west']) {
      try {
        level.addWindow(room, wall);
        break;
      } catch (err) {
        if (!(err instanceof PlanError)) throw err;
      }
    }
  }
}

/** "a bathroom", "an en suite", and "stairs", which takes no article. */
export function article(label: string): string {
  const lowered = label.toLowerCase();
  if (lowered.endsWith('s') && !lowered.endsWith('ss')) return lowered;
  return ('aeiou'.includes(lowered.slice(0, 1)) && lowered ? 'an ' : 'a ') + lowered;
}
