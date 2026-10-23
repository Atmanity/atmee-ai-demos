// The home: levels, rooms made of owned cells, and the operators that move walls.
//
// Pure: no avatar, no React, no I/O. Every rule is unit-testable and the
// planner above it does nothing but translate intents and catch PlanError.
//
// Ownership is the whole design. A level is a grid; every cell belongs to
// exactly one room or to nobody. Rooms cannot overlap (a cell has one owner),
// gaps cannot hide (an unowned cell is drawable and complainable-about), and
// "these two rooms share a wall" survives every resize because the wall is not
// stored: it is read off the ownership boundary whenever anyone asks.
//
// - Every operator is rectilinear and total. Growing, trading area, sliding a
//   shared wall, merging, splitting: each is a reassignment of cells, validated
//   before it commits. None can leave a sliver, because a sliver fails
//   narrowestCm and the reassignment is rolled back with a sentence the client
//   can be told.
// - Furniture has no room id. The room a piece is in is whichever room owns
//   the cells under it, so sliding a wall re-homes the wardrobe for free and
//   swapping two rooms is exact.
// - Openings are positioned by code. addDoor takes two rooms and finds their
//   shared wall; addWindow takes a room and a compass side and finds its
//   exterior run. Nobody says where along a wall, only which wall.
//
// Coordinates are centimetres from the north-west corner: x runs east, y south.
import { KIT_FAMILIES, normalizeType, resolveType, USUAL_ROOMS, type Piece } from './catalog.ts';
import {
  areaM2, bbox, boundary, CELL_CM, cell, colOf, isConnected, narrowestCm, overlaps,
  rectCells, rowOf, sharedEdge, strips, type Cell, type Edge, type Rect,
} from './geom.ts';
import { cmpStr, fmtG, mod, pyRound, toNumber } from './num.ts';
import { solve, type Spot } from './place.ts';
import { KINDS, normalizeKind, resolveKind, ROOM_FAMILIES, type RoomKind } from './rooms.ts';

// ------------------------------------------------------------------ limits
//
// Every cap is a REFUSAL, not truncation: a plan silently missing the bedroom
// the client just asked for is worse than being told the floor is full.

export const MIN_SIDE_CM = 200;
export const MAX_SIDE_CM = 2000;
export const MAX_ROOMS_PER_LEVEL = 12;
export const MAX_ITEMS_PER_LEVEL = 40;
export const MAX_OPENINGS_PER_LEVEL = 24;
export const MAX_LEVELS = 2;
export const LEVEL_NAMES = ['ground', 'upper'] as const;
export const WALLS = ['north', 'south', 'east', 'west'] as const;
/** A door is as wide as it is deep when it swings. */
export const DEFAULT_DOOR_CM = 85;
/** Narrower than this is not a door you get furniture through. */
export const MIN_DOOR_CM = 70;
export const DEFAULT_WINDOW_CM = 120;

/** A refusal, in the words the client will hear. */
export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanError';
  }
}

// ----------------------------------------------------------------- records

export class Room {
  /**
   * Set when this room's floor was taken off another one, so the designer can
   * say whose it was. Transient: never captured.
   */
  taken_from: string | null = null;
  constructor(public id: string, public name: string, public kind: string) {}
  get spec(): RoomKind { return KINDS[this.kind] ?? KINDS.other; }
}

export interface OpeningView {
  id: string; kind: 'door' | 'window'; axis: 'v' | 'h'; line_cm: number; start_cm: number; width_cm: number;
  a?: string; b?: string; swing_into?: string;
}

/**
 * A door or a window on an ownership boundary. `a` and `b` are the rooms on the
 * low and high side of line_cm, null meaning outside: an exterior window and an
 * interior door are the same record with a different neighbour, which is why
 * there is no separate "wall" concept to keep in step.
 */
export class Opening {
  constructor(
    public id: string,
    public kind: 'door' | 'window',
    public axis: 'v' | 'h',
    public line_cm: number,
    public start_cm: number,
    public width_cm: number,
    public a: string | null,
    public b: string | null,
    public swing_into: string | null = null,
  ) {}

  get rect(): Rect {
    return this.axis === 'v'
      ? [this.line_cm, this.start_cm, this.line_cm, this.start_cm + this.width_cm]
      : [this.start_cm, this.line_cm, this.start_cm + this.width_cm, this.line_cm];
  }

  get exterior(): boolean { return this.a === null || this.b === null; }

  copy(): Opening {
    return new Opening(this.id, this.kind, this.axis, this.line_cm, this.start_cm, this.width_cm, this.a, this.b, this.swing_into);
  }

  asDict(): OpeningView {
    const out: OpeningView = { id: this.id, kind: this.kind, axis: this.axis, line_cm: this.line_cm, start_cm: this.start_cm, width_cm: this.width_cm };
    if (this.a) out.a = this.a;
    if (this.b) out.b = this.b;
    if (this.swing_into) out.swing_into = this.swing_into;
    return out;
  }
}

export interface ItemView { id: string; type: string; label: string; x_cm: number; y_cm: number; w_cm: number; h_cm: number; rot: number }

export class Item {
  constructor(public id: string, public piece: Piece, public x_cm: number, public y_cm: number, public rot = 0) {}
  get label() { return this.piece.label; }
  /** Footprint width AFTER rotation: a quarter turn swaps the sides. */
  get w_cm() { return this.rot === 90 || this.rot === 270 ? this.piece.h_cm : this.piece.w_cm; }
  get h_cm() { return this.rot === 90 || this.rot === 270 ? this.piece.w_cm : this.piece.h_cm; }
  get rect(): Rect { return [this.x_cm, this.y_cm, this.x_cm + this.w_cm, this.y_cm + this.h_cm]; }
  copy(): Item { return new Item(this.id, this.piece, this.x_cm, this.y_cm, this.rot); }
  asDict(): ItemView {
    return { id: this.id, type: this.piece.type, label: this.piece.label, x_cm: this.x_cm, y_cm: this.y_cm, w_cm: this.w_cm, h_cm: this.h_cm, rot: this.rot };
  }
}

/**
 * One counter per prefix, shared across the whole home: a client saying "move
 * r4" on the upper floor must not reach a different r4 downstairs.
 */
export class Ids {
  counts: Record<string, number> = {};
  mint(prefix: string): string {
    this.counts[prefix] = (this.counts[prefix] ?? 0) + 1;
    return `${prefix}${this.counts[prefix]}`;
  }
}

/** A structural mark, keyed by the pair of rooms the wall separates. */
const pairKey = (a: string, b: string) => [a, b].sort(cmpStr).join('|');

export type RoomRef = Room | string | null | undefined;
export type ItemRef = Item | string | null | undefined;

export interface RoomView { id: string; name: string; kind: string; area_m2: number; rects: Rect[]; edges: Rect[]; bbox: Rect }
export interface WallView { a: string; b: string; axis: 'v' | 'h'; line_cm: number; start_cm: number; end_cm: number; structural: boolean }
export interface LevelView {
  name: string; w_cm: number; h_cm: number; rooms: RoomView[]; unassigned: Rect[]; unassigned_m2: number;
  openings: OpeningView[]; items: ItemView[]; walls: WallView[];
}

export interface LevelCapture {
  name: string; w_cm: number; h_cm: number; owner: Map<Cell, string>; rooms: Map<string, Room>;
  openings: Opening[]; items: Item[]; structural: Set<string>;
}

// ----------------------------------------------------------------- a level

/** One storey: an envelope, the rooms that partition it, and what is in them. */
export class Level {
  owner = new Map<Cell, string>();
  rooms = new Map<string, Room>();
  openings: Opening[] = [];
  items: Item[] = [];
  /**
   * Walls the client declared structural, as the pair of rooms they separate.
   * Keyed by rooms rather than by (axis, line): a line runs the whole width of
   * the floor and several unrelated pairs can share one, so keying by line froze
   * every collinear wall on the plan the moment one was marked load-bearing.
   */
  structural = new Set<string>();

  constructor(public name: string, public w_cm: number, public h_cm: number, public ids: Ids) {
    this.w_cm = Math.trunc(w_cm);
    this.h_cm = Math.trunc(h_cm);
  }

  // -------------------------------------------------------------- queries

  get cols() { return Math.floor(this.w_cm / CELL_CM); }
  get rows() { return Math.floor(this.h_cm / CELL_CM); }

  allCells(): Set<Cell> {
    const out = new Set<Cell>();
    for (let c = 0; c < this.cols; c++) for (let r = 0; r < this.rows; r++) out.add(cell(c, r));
    return out;
  }

  cellsOf(roomId: string): Set<Cell> {
    const out = new Set<Cell>();
    for (const [k, owner] of this.owner) if (owner === roomId) out.add(k);
    return out;
  }

  freeCells(): Set<Cell> {
    const out = new Set<Cell>();
    for (let c = 0; c < this.cols; c++) for (let r = 0; r < this.rows; r++) {
      const k = cell(c, r);
      if (!this.owner.has(k)) out.add(k);
    }
    return out;
  }

  roomAtCell(k: Cell): string | null { return this.owner.get(k) ?? null; }

  /** Every room whose floor the rectangle sits on. Empty means unassigned floor. */
  roomsUnder(rect: Rect): Set<string> {
    const out = new Set<string>();
    for (const k of rectCells(rect)) {
      const owner = this.owner.get(k);
      if (owner !== undefined) out.add(owner);
    }
    return out;
  }

  /**
   * The room a piece is in: derived, never stored. The majority owner rather
   * than "all of them", because a piece may overhang a doorway by a few
   * centimetres; one genuinely straddling two rooms is a complaint raised in
   * compliance, not a different answer here.
   */
  roomOfItem(item: Item): string | null {
    const counts = new Map<string, number>();
    for (const k of rectCells(item.rect)) {
      const owner = this.owner.get(k);
      if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    let best: string | null = null;
    for (const [owner, n] of counts) {
      if (best === null || n > counts.get(best)! || (n === counts.get(best)! && owner > best)) best = owner;
    }
    return best;
  }

  itemsIn(roomId: string): Item[] { return this.items.filter((item) => this.roomOfItem(item) === roomId); }

  findRoom(ref: RoomRef): Room {
    // An already-resolved record passes straight through. Stringified into a
    // lookup key, every room matched the same way and two distinct rooms
    // collapsed into one ("that's the same room twice" for a perfectly good pair).
    if (ref instanceof Room) {
      const found = this.rooms.get(ref.id);
      if (!found) throw new PlanError(`The ${ref.name.toLowerCase()} isn't on this floor.`);
      return found;
    }
    const key = normalizeKind(ref);
    if (!key) throw new PlanError('Which room did you mean?');
    for (const room of this.rooms.values()) if (room.id.toLowerCase() === key.replaceAll(' ', '')) return room;
    // Exact name first, then containment. Containment alone made "second
    // bedroom" match "Main bedroom" (both contain "bedroom"), so a client asking
    // for floor for the small bedroom was told, correctly for the WRONG room,
    // that it shares no wall with the hall.
    for (const room of this.rooms.values()) if (room.name.toLowerCase() === key) return room;
    const named = [...this.rooms.values()]
      .filter((r) => r.name.toLowerCase().includes(key) || key.includes(r.name.toLowerCase()))
      .sort((p, q) => Math.abs(p.name.length - key.length) - Math.abs(q.name.length - key.length));
    if (named.length) return named[0];
    const spec = resolveKind(key);
    if (spec) {
      const ofKind = [...this.rooms.values()].filter((r) => r.kind === spec.kind);
      if (ofKind.length) return ofKind[0];
    }
    throw new PlanError(`There's no ${key} on this floor.`);
  }

  findItem(ref: ItemRef): Item {
    if (ref instanceof Item) return ref;
    const key = normalizeType(ref);
    if (!key) throw new PlanError("I can't find that piece on the plan.");
    for (const item of this.items) if (item.id.toLowerCase() === key) return item;
    const named = this.items.filter((item) =>
      item.label.toLowerCase().includes(key) || item.piece.type.includes(key)
      || key.includes(item.label.toLowerCase()) || key.includes(item.piece.type.replaceAll('_', ' ')));
    // Latest match wins, which is what "the chair" means after two.
    if (named.length) return named[named.length - 1];
    throw new PlanError("I can't find that piece on the plan.");
  }

  findOpening(ref: Opening | string | null | undefined): Opening {
    if (ref instanceof Opening) return ref;
    const key = normalizeType(ref);
    for (const opening of this.openings) if (opening.id.toLowerCase() === key) return opening;
    const named = this.openings.filter((o) => key && (o.kind.includes(key) || key.includes(o.kind)));
    if (named.length) return named[named.length - 1];
    throw new PlanError("I can't find that door or window on the plan.");
  }

  // ----------------------------------------------------------- validation

  /** Everything that makes a cell set a usable room. Throws, or returns. */
  validateRoom(roomId: string, cells: Set<Cell>): void {
    const room = this.rooms.get(roomId)!;
    const spec = room.spec;
    const name = room.name.toLowerCase();
    if (!cells.size) throw new PlanError(`That would leave the ${name} with no floor at all.`);
    if (!isConnected(cells)) throw new PlanError(`That would split the ${name} into two separate pieces.`);
    const area = areaM2(cells);
    if (area < spec.min_area_m2) {
      throw new PlanError(`That takes the ${name} down to ${fmtG(area)} square metres — under ${fmtG(spec.min_area_m2)}, which is too small to work.`);
    }
    const narrow = narrowestCm(cells);
    if (narrow < spec.min_width_cm) {
      throw new PlanError(`That leaves the ${name} only ${narrow} centimetres across at its tightest — it needs ${spec.min_width_cm}.`);
    }
  }

  /**
   * Reassign cells, validate every room the change touched, or roll back. The
   * rollback is the reason this exists: an operator that mutated and then
   * checked would leave a refused change half-applied, and the panel would
   * draw a floor the planner believes it rejected.
   *
   * `ignore` is for a room being emptied ON PURPOSE (the losing side of a
   * merge); otherwise giving away every cell fails "a room needs some floor"
   * and the merge refuses itself, naming a room the client asked to get rid of.
   */
  commit(changes: Map<Cell, string | null>, { ignore = [] as string[] } = {}): void {
    const touched = new Set<string>();
    for (const owner of changes.values()) if (owner) touched.add(owner);
    for (const k of changes.keys()) {
      const owner = this.owner.get(k);
      if (owner !== undefined) touched.add(owner);
    }
    for (const id of ignore) touched.delete(id);
    const before = new Map(this.owner);
    for (const [k, owner] of changes) {
      if (owner === null) {
        this.owner.delete(k);
      } else {
        const c = colOf(k), r = rowOf(k);
        if (!(c >= 0 && c < this.cols && r >= 0 && r < this.rows)) {
          this.owner = before;
          throw new PlanError('That runs off the edge of the floor.');
        }
        this.owner.set(k, owner);
      }
    }
    try {
      for (const roomId of [...touched].sort(cmpStr)) {
        if (this.rooms.has(roomId)) this.validateRoom(roomId, this.cellsOf(roomId));
      }
    } catch (err) {
      this.owner = before;
      throw err;
    }
  }

  // ---------------------------------------------------------------- rooms

  setEnvelope(wCm: unknown, hCm: unknown): void {
    const w = snap(asInt(wCm, 'width')), h = snap(asInt(hCm, 'depth'));
    if (Math.min(w, h) < MIN_SIDE_CM || Math.max(w, h) > MAX_SIDE_CM) {
      throw new PlanError("A floor that size isn't something I can draw — give me between two and twenty metres.");
    }
    // Shrinking is the interesting case: cells outside the new envelope would
    // silently vanish with whatever room owned them, so refuse and name it.
    for (const [k, roomId] of this.owner) {
      if (colOf(k) * CELL_CM >= w || rowOf(k) * CELL_CM >= h) {
        const room = this.rooms.get(roomId);
        throw new PlanError(`Shrinking it would cut into the ${room ? room.name.toLowerCase() : 'plan'} — move that first.`);
      }
    }
    this.w_cm = w;
    this.h_cm = h;
  }

  addRoom(kind: unknown, name: unknown = null, areaTarget: unknown = null, near: unknown = 'center'): Room {
    const spec = resolveKind(kind);
    if (!spec) throw new PlanError(`I don't lay out a ${normalizeKind(kind) || 'room'} — I do ${ROOM_FAMILIES}.`);
    if (this.rooms.size >= MAX_ROOMS_PER_LEVEL) {
      throw new PlanError(`That's as many rooms as one floor holds — ${MAX_ROOMS_PER_LEVEL}. Merge two before adding another.`);
    }
    const asked = toNumber(areaTarget);
    const want = asked ? asked : spec.min_area_m2 * 1.6;
    let rect = this.findFreeRect(want, spec.min_width_cm, near, spec.min_area_m2);
    let takenFrom: Room | null = null;
    if (rect === null) {
      // A GENERATED floor has no free cells at all (the partition tiles the
      // envelope), so "find a clear stretch" can never succeed on one. That
      // made every room added after the first layout impossible, stairs
      // included, while the app went on flagging that the two floors did not
      // connect. So the fallback is the honest one a designer would make: take
      // it off whichever room can best spare it.
      [rect, takenFrom] = this.carveFromNeighbour(spec, want);
    }
    if (rect === null) {
      throw new PlanError(`There's nowhere to put ${article(spec.label)} — every room is already at its minimum. Make the floor bigger, or take a room out.`);
    }
    const room = new Room(this.ids.mint('r'), name ? String(name).trim() : this.uniqueName(spec.label), spec.kind);
    this.rooms.set(room.id, room);
    try {
      this.commit(new Map([...rectCells(rect)].map((k) => [k, room.id])));
    } catch (err) {
      this.rooms.delete(room.id);
      throw err;
    }
    room.taken_from = takenFrom ? takenFrom.name : null;
    return room;
  }

  /**
   * Take a new room out of whichever existing room can best spare it. Tried
   * only when there is no unassigned floor. The donor is the room with the most
   * slack over its own minimum, and the slice comes off one end of its bounding
   * box so both halves stay rectangles; validation still applies to the donor.
   */
  carveFromNeighbour(spec: RoomKind, wantM2: number): [Rect, Room] | [null, null] {
    const needCells = Math.max(1, Math.trunc(pyRound(wantM2 * 10_000 / (CELL_CM * CELL_CM))));
    const minCells = Math.max(1, Math.floor(spec.min_width_cm / CELL_CM));
    const slack = (r: Room) => areaM2(this.cellsOf(r.id)) - r.spec.min_area_m2;
    const donors = [...this.rooms.values()].map((r) => [r, slack(r)] as const).sort((p, q) => q[1] - p[1]).map(([r]) => r);
    for (const donor of donors) {
      const cells = this.cellsOf(donor.id);
      if (areaM2(cells) - donor.spec.min_area_m2 < wantM2) continue;
      const [x0, y0, x1, y1] = bbox(cells);
      const wide = Math.floor((x1 - x0) / CELL_CM);
      const deep = Math.floor((y1 - y0) / CELL_CM);
      const donorMin = Math.floor(donor.spec.min_width_cm / CELL_CM);
      // Slice off the far end, across whichever axis leaves both parts wide
      // enough to still be rooms.
      for (const alongX of [wide >= deep, wide < deep]) {
        let rect: Rect;
        if (alongX) {
          const take = Math.max(minCells, Math.min(wide - donorMin, Math.ceil(needCells / Math.max(deep, 1))));
          if (take < minCells || take >= wide) continue;
          rect = [x1 - take * CELL_CM, y0, x1, y1];
        } else {
          const take = Math.max(minCells, Math.min(deep - donorMin, Math.ceil(needCells / Math.max(wide, 1))));
          if (take < minCells || take >= deep) continue;
          rect = [x0, y1 - take * CELL_CM, x1, y1];
        }
        if ([...rectCells(rect)].every((k) => cells.has(k))) return [rect, donor];
      }
    }
    return [null, null];
  }

  /**
   * Create a room on an exact rectangle of floor. The generator's way in, and
   * the only caller that supplies coordinates: a whole-floor partition is
   * computed as rectangles that tile the envelope.
   */
  placeRoom(kind: unknown, rect: Rect, name: unknown = null): Room {
    const spec = resolveKind(kind);
    if (!spec) throw new PlanError(`I don't lay out a ${normalizeKind(kind) || 'room'}.`);
    if (this.rooms.size >= MAX_ROOMS_PER_LEVEL) throw new PlanError(`That's as many rooms as one floor holds — ${MAX_ROOMS_PER_LEVEL}.`);
    const room = new Room(this.ids.mint('r'), name ? String(name).trim() : this.uniqueName(spec.label), spec.kind);
    this.rooms.set(room.id, room);
    try {
      this.commit(new Map([...rectCells(rect)].map((k) => [k, room.id])));
    } catch (err) {
      this.rooms.delete(room.id);
      throw err;
    }
    return room;
  }

  /** "Bedroom", then "Bedroom 2": numbered only once there are two. */
  uniqueName(label: string): string {
    const taken = new Set([...this.rooms.values()].map((r) => r.name));
    if (!taken.has(label)) return label;
    let n = 2;
    while (taken.has(`${label} ${n}`)) n++;
    return `${label} ${n}`;
  }

  removeRoom(ref: RoomRef): Room {
    const room = this.findRoom(ref);
    for (const item of this.itemsIn(room.id)) this.items.splice(this.items.indexOf(item), 1);
    this.openings = this.openings.filter((o) => o.a !== room.id && o.b !== room.id);
    for (const k of this.cellsOf(room.id)) this.owner.delete(k);
    this.rooms.delete(room.id);
    return room;
  }

  renameRoom(ref: RoomRef, name: unknown = null, kind: unknown = null): Room {
    const room = this.findRoom(ref);
    if (kind) {
      const spec = resolveKind(kind);
      if (!spec) throw new PlanError(`I don't know what a ${normalizeKind(kind)} is.`);
      // A kind change tightens the rules, so it has to face them BEFORE it
      // sticks. Validating after the assignment left a refused change applied:
      // the client heard "that's too small to be a living room" and the room
      // was a living room from then on.
      const was = room.kind;
      room.kind = spec.kind;
      try {
        this.validateRoom(room.id, this.cellsOf(room.id));
      } catch (err) {
        room.kind = was;
        throw err;
      }
    }
    if (name) room.name = String(name).trim();
    return room;
  }

  /**
   * Trade two rooms' identities, leaving the floor exactly as it is. Exact
   * because furniture stores no room id: the pieces belong to whichever room
   * now owns that floor.
   */
  swapRooms(aRef: RoomRef, bRef: RoomRef): [Room, Room] {
    const a = this.findRoom(aRef), b = this.findRoom(bRef);
    if (a.id === b.id) throw new PlanError("That's the same room twice.");
    // Traded first and validated after, a refused swap had already happened:
    // the client heard the store cannot be the living room while both rooms
    // were already wearing each other's names.
    const before = [[a.name, a.kind], [b.name, b.kind]];
    [a.name, b.name] = [b.name, a.name];
    [a.kind, b.kind] = [b.kind, a.kind];
    try {
      this.validateRoom(a.id, this.cellsOf(a.id));
      this.validateRoom(b.id, this.cellsOf(b.id));
    } catch (err) {
      [[a.name, a.kind], [b.name, b.kind]] = before;
      throw err;
    }
    return [a, b];
  }

  mergeRooms(aRef: RoomRef, bRef: RoomRef): Room {
    const a = this.findRoom(aRef), b = this.findRoom(bRef);
    if (a.id === b.id) throw new PlanError("That's the same room twice.");
    if (sharedEdge(this.cellsOf(a.id), this.cellsOf(b.id)) === null) {
      throw new PlanError(`The ${a.name.toLowerCase()} and the ${b.name.toLowerCase()} don't touch, so there's no wall to take out.`);
    }
    // Merging DELETES the wall, a bigger change than moving it: refusing to
    // move a load-bearing wall while allowing it to be knocked out was the
    // wrong way round.
    if (this.isStructural(a, b)) {
      throw new PlanError(`The wall between the ${a.name.toLowerCase()} and the ${b.name.toLowerCase()} is holding the building up — it can't come out.`);
    }
    // Ownership FIRST, because it is the only step that can be refused (the
    // survivor may fail its own minimum width once it inherits a narrow
    // stretch). Rewriting the doors and the structural marks first meant a
    // refused merge rolled the floor back but kept the bookkeeping.
    this.commit(new Map([...this.cellsOf(b.id)].map((k) => [k, a.id])), { ignore: [b.id] });

    // From here the merge is certain: everything that referenced the absorbed
    // room moves onto the survivor, and the wall between them goes.
    this.openings = this.openings.filter((o) => !((o.a === a.id && o.b === b.id) || (o.a === b.id && o.b === a.id)));
    for (const opening of this.openings) {
      if (opening.a === b.id) opening.a = a.id;
      if (opening.b === b.id) opening.b = a.id;
      if (opening.swing_into === b.id) opening.swing_into = a.id;
    }
    // The structural marks move with the openings. Left keyed by the room that
    // no longer exists, a load-bearing wall between the absorbed room and a
    // third neighbour quietly became movable again.
    const merged = new Set<string>();
    for (const key of this.structural) {
      if (key === pairKey(a.id, b.id)) continue;
      const [p, q] = key.split('|').map((id) => (id === b.id ? a.id : id));
      merged.add(pairKey(p, q));
    }
    this.structural = merged;
    this.rooms.delete(b.id);
    return a;
  }

  /**
   * Cut a room in two along its long axis, at the halfway line. A split that
   * can be described is one a client can picture, and the follow-up for "no,
   * more like a third" is moveWall.
   */
  splitRoom(ref: RoomRef, kind: unknown = null, name: unknown = null, axis: unknown = 'auto'): Room {
    const room = this.findRoom(ref);
    const cells = this.cellsOf(room.id);
    const [x0, y0, x1, y1] = bbox(cells);
    const want = normalizeKind(axis);
    const vertical = want === 'auto' || want === '' ? x1 - x0 >= y1 - y0 : ['v', 'vertical', 'east west'].includes(want);
    const spec = resolveKind(kind) ?? KINDS.other;
    let taken: Set<Cell>;
    if (vertical) {
      const cut = snap(Math.floor((x0 + x1) / 2));
      taken = new Set([...cells].filter((k) => colOf(k) * CELL_CM >= cut));
    } else {
      const cut = snap(Math.floor((y0 + y1) / 2));
      taken = new Set([...cells].filter((k) => rowOf(k) * CELL_CM >= cut));
    }
    if (!taken.size || taken.size === cells.size) throw new PlanError(`The ${room.name.toLowerCase()} is too small to divide.`);
    const created = new Room(this.ids.mint('r'), name ? String(name).trim() : this.uniqueName(spec.label), spec.kind);
    this.rooms.set(created.id, created);
    try {
      this.commit(new Map([...taken].map((k) => [k, created.id])));
    } catch (err) {
      this.rooms.delete(created.id);
      throw err;
    }
    return created;
  }

  // --------------------------------------------------------- moving walls

  /**
   * Slide the wall between two rooms. A positive delta gives `a` the floor.
   * This is the drag, the most-used verb in a negotiation, and it takes real
   * centimetres because a human is pointing at a spot.
   */
  moveWall(aRef: RoomRef, bRef: RoomRef, deltaCm: unknown): [Room, Room] {
    const a = this.findRoom(aRef), b = this.findRoom(bRef);
    if (a.id === b.id) throw new PlanError("That's the same room twice.");
    const edge = sharedEdge(this.cellsOf(a.id), this.cellsOf(b.id));
    if (edge === null) throw new PlanError(`The ${a.name.toLowerCase()} and the ${b.name.toLowerCase()} don't share a wall.`);
    const [axis, line, start, end] = edge;
    if (this.isStructural(a, b)) throw new PlanError("That wall is holding the building up — I can't move it. We can work around it.");
    const delta = snap(asInt(deltaCm, 'distance'));
    if (delta === 0) throw new PlanError("That wouldn't move it anywhere.");

    // Positive delta means `a` gains, whichever side of the line it is on.
    // Which side it IS on has to be looked up rather than assumed: the shared
    // edge is reported low-to-high, and taking `a` for the low side reached
    // into cells `a` already owned whenever it was the high one.
    const [gaining, losing] = delta > 0 ? [a, b] : [b, a];
    const gainingIsLow = isLowSide(this, gaining, losing);
    const steps = Math.floor(Math.abs(delta) / CELL_CM);
    const changes = new Map<Cell, string | null>();
    const losingCells = this.cellsOf(losing.id);
    for (let step = 0; step < steps; step++) {
      const offset = gainingIsLow ? Math.floor(line / CELL_CM) + step : Math.floor(line / CELL_CM) - 1 - step;
      for (let along = Math.floor(start / CELL_CM); along < Math.floor(end / CELL_CM); along++) {
        const k = axis === 'v' ? cell(offset, along) : cell(along, offset);
        if (!losingCells.has(k)) throw new PlanError(`The wall can't go that far — it runs out of ${losing.name.toLowerCase()} first.`);
        changes.set(k, gaining.id);
      }
    }
    this.commit(changes);
    return [a, b];
  }

  /**
   * Move floor across a shared wall, stated in square metres: the unit a
   * client negotiates in, converted here into the wall movement that delivers
   * it, so nobody computes a distance.
   */
  tradeArea(fromRef: RoomRef, toRef: RoomRef, m2: unknown): [Room, Room] {
    const giver = this.findRoom(fromRef), taker = this.findRoom(toRef);
    const edge = sharedEdge(this.cellsOf(giver.id), this.cellsOf(taker.id));
    if (edge === null) {
      throw new PlanError(`The ${giver.name.toLowerCase()} and the ${taker.name.toLowerCase()} don't share a wall, so there's nothing to trade across.`);
    }
    const length = edge[3] - edge[2];
    const want = Math.abs(toNumber(m2) || 0);
    if (want <= 0) throw new PlanError('How much floor did you want to move?');
    const delta = snap(Math.max(CELL_CM, Math.trunc(pyRound(want * 10_000 / length))));
    // A positive delta gives the floor to the first room named, so the taker
    // goes first and no sign juggling is needed.
    return this.moveWall(taker, giver, delta);
  }

  /**
   * Give a room more floor from the free floor around it. Free floor only:
   * growing at a neighbour's expense is a decision with a loser, and tradeArea
   * is the verb that names both rooms.
   */
  growRoom(ref: RoomRef, m2: unknown, towards: unknown = null): Room {
    const room = this.findRoom(ref);
    const want = toNumber(m2) || 0;
    if (want <= 0) throw new PlanError('How much bigger did you want it?');
    const cells = this.cellsOf(room.id);
    const free = this.freeCells();
    const need = Math.trunc(pyRound(want * 10_000 / (CELL_CM * CELL_CM)));
    const wantSide = normalizeKind(towards).replaceAll(' ', '_').replaceAll('_wall', '');
    let best: [number, Cell[]] | null = null;
    for (const side of WALLS) {
      const strip = this.stripBeside(cells, side, free);
      if (!strip.length) continue;
      const take = strip.slice(0, need);
      let cost = !wantSide || side === wantSide ? 0.0 : 1.0;
      cost += Math.abs(take.length - need) / Math.max(need, 1);
      if (best === null || cost < best[0]) best = [cost, take];
    }
    if (best === null) throw new PlanError(`There's no free floor next to the ${room.name.toLowerCase()} — we'd have to take it off another room.`);
    this.commit(new Map(best[1].map((k) => [k, room.id])));
    return room;
  }

  /** Free cells against one side of a shape, whole ranks, nearest first. */
  stripBeside(cells: Set<Cell>, side: string, free: Set<Cell>): Cell[] {
    const [x0, y0, x1, y1] = bbox(cells);
    const columns = [...new Set([...cells].map(colOf))].sort((p, q) => p - q);
    const rows = [...new Set([...cells].map(rowOf))].sort((p, q) => p - q);
    const out: Cell[] = [];
    if (side === 'north' || side === 'south') {
      const step = side === 'north' ? -1 : 1;
      let rank = side === 'north' ? Math.floor(y0 / CELL_CM) - 1 : Math.floor(y1 / CELL_CM);
      for (;;) {
        const here = columns.map((c) => cell(c, rank)).filter((k) => free.has(k));
        if (here.length !== columns.length) break;
        out.push(...here);
        rank += step;
      }
    } else {
      const step = side === 'west' ? -1 : 1;
      let rank = side === 'west' ? Math.floor(x0 / CELL_CM) - 1 : Math.floor(x1 / CELL_CM);
      for (;;) {
        const here = rows.map((r) => cell(rank, r)).filter((k) => free.has(k));
        if (here.length !== rows.length) break;
        out.push(...here);
        rank += step;
      }
    }
    return out;
  }

  /** Declare the wall between two rooms load-bearing, so it stops moving. */
  markStructural(aRef: RoomRef, bRef: RoomRef): [Room, Room] {
    const a = this.findRoom(aRef), b = this.findRoom(bRef);
    if (sharedEdge(this.cellsOf(a.id), this.cellsOf(b.id)) === null) {
      throw new PlanError(`The ${a.name.toLowerCase()} and the ${b.name.toLowerCase()} don't share a wall.`);
    }
    this.structural.add(pairKey(a.id, b.id));
    return [a, b];
  }

  isStructural(a: Room, b: Room): boolean { return this.structural.has(pairKey(a.id, b.id)); }

  /**
   * Every maximal rectangle of unassigned floor, as [col, row, w, h] in cells,
   * by the largest-rectangle-in-a-histogram sweep. The free floor left after two
   * rooms is almost always an L, and a search asking "does a rectangle of
   * exactly this size fit here" answers no across the whole L while several
   * good rooms would fit inside it.
   */
  maximalFreeRects(): [number, number, number, number][] {
    const free = this.freeCells();
    if (!free.size) return [];
    const cols = this.cols, rows = this.rows;
    const out: [number, number, number, number][] = [];
    const heights = new Array<number>(cols).fill(0);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) heights[c] = free.has(cell(c, r)) ? heights[c] + 1 : 0;
      const stack: [number, number][] = [];
      for (let c = 0; c <= cols; c++) {
        const here = c < cols ? heights[c] : 0;
        let start = c;
        while (stack.length && stack[stack.length - 1][1] >= here) {
          const [left, tall] = stack.pop()!;
          out.push([left, r - tall + 1, c - left, tall]);
          start = left;
        }
        if (here > 0 && (!stack.length || stack[stack.length - 1][1] < here)) stack.push([start, here]);
      }
    }
    return out;
  }

  /**
   * A clear rectangle of unassigned floor, as close to the ask as it gets. The
   * ask is a preference (a bathroom asked at five square metres on a floor with
   * four left is drawn at four); minArea is the real floor, below which the
   * room would fail validation anyway.
   */
  findFreeRect(wantM2: number, minWidthCm: number, near: unknown, minAreaM2 = 0): Rect | null {
    const need = Math.max(1, Math.trunc(pyRound(wantM2 * 10_000 / (CELL_CM * CELL_CM))));
    const floor = Math.max(1, Math.trunc(pyRound(minAreaM2 * 10_000 / (CELL_CM * CELL_CM))));
    const minCells = Math.max(1, Math.floor(minWidthCm / CELL_CM));
    const relation = normalizeKind(near).replaceAll(' ', '_');
    let best: [number, Rect] | null = null;
    for (const [c0, r0, span, tall] of this.maximalFreeRects()) {
      if (span < minCells || tall < minCells) continue;
      for (let w = minCells; w <= span; w++) {
        const h = Math.max(minCells, Math.min(tall, pyRound(need / w) || 1));
        if (h > tall || w * h < floor) continue;
        // A room three times longer than it is wide is a corridor whatever it is called.
        const ratio = w / h;
        if (!(ratio >= 0.3 && ratio <= 3.2)) continue;
        // Only the extremes and the middle of each axis: the relation is a
        // preference over which END of the free stretch to sit at.
        for (const c of anchorsWithin(c0, span - w)) {
          for (const r of anchorsWithin(r0, tall - h)) {
            const rect: Rect = [c * CELL_CM, r * CELL_CM, (c + w) * CELL_CM, (r + h) * CELL_CM];
            let cost = Math.abs(w * h - need) / need;
            cost += roomRelationCost(this, relation, rect) / 1000;
            // Squarer rooms are better rooms, all else equal.
            cost += Math.abs(w - h) / Math.max(w, h) * 0.25;
            if (best === null || cost < best[0]) best = [cost, rect];
          }
        }
      }
    }
    return best ? best[1] : null;
  }

  // ------------------------------------------------------------- openings

  addWindow(roomRef: RoomRef, wall: unknown, widthCm: unknown = null): Opening {
    const room = this.findRoom(roomRef);
    const side = normalizeKind(wall).replace(' wall', '').trim();
    if (!(WALLS as readonly string[]).includes(side)) throw new PlanError('Tell me which side — north, south, east or west.');
    const run = this.exteriorRun(room.id, side);
    if (run === null) {
      throw new PlanError(`The ${room.name.toLowerCase()} doesn't reach the ${side} outside wall, so a window there would look into another room.`);
    }
    return this.placeOpening('window', room, side, run, widthCm || DEFAULT_WINDOW_CM);
  }

  addFrontDoor(roomRef: RoomRef, wall: unknown, widthCm: unknown = null): Opening {
    const room = this.findRoom(roomRef);
    const side = normalizeKind(wall).replace(' wall', '').trim();
    if (!(WALLS as readonly string[]).includes(side)) throw new PlanError('Tell me which side — north, south, east or west.');
    const run = this.exteriorRun(room.id, side);
    if (run === null) throw new PlanError(`The ${room.name.toLowerCase()} doesn't reach the ${side} outside wall.`);
    return this.placeOpening('door', room, side, run, widthCm || DEFAULT_DOOR_CM);
  }

  /** A doorway between two rooms, centred on the wall they share. */
  addDoor(aRef: RoomRef, bRef: RoomRef, widthCm: unknown = null): Opening {
    const a = this.findRoom(aRef), b = this.findRoom(bRef);
    if (a.id === b.id) throw new PlanError("That's the same room twice.");
    const edge = sharedEdge(this.cellsOf(a.id), this.cellsOf(b.id));
    if (edge === null) {
      throw new PlanError(`The ${a.name.toLowerCase()} and the ${b.name.toLowerCase()} don't share a wall — there's nowhere to put a door between them.`);
    }
    const [axis, line, start, end] = edge;
    const width = snap(asInt(widthCm || DEFAULT_DOOR_CM, 'width'));
    if (end - start < width) throw new PlanError(`The wall between the ${a.name.toLowerCase()} and the ${b.name.toLowerCase()} is too short for a door.`);
    this.assertOpeningRoom();
    // Which room is on the low side of the line decides a/b, which is what
    // makes an opening readable without consulting the rooms again.
    const [low, high] = isLowSide(this, a, b) ? [a, b] : [b, a];
    const offset = snap(start + Math.floor((end - start - width) / 2));
    // The door opens into the more circulation-ish of the two: a door into a
    // hall keeps the room's own floor clear, which is what a real one does.
    const into = high.spec.circulation && !low.spec.circulation ? high : low;
    const opening = new Opening(this.ids.mint('o'), 'door', axis, line, offset, width, low.id, high.id, into.id);
    this.openings.push(opening);
    return opening;
  }

  private assertOpeningRoom(): void {
    if (this.openings.length >= MAX_OPENINGS_PER_LEVEL) {
      throw new PlanError("That's as many doors and windows as this floor holds — take one out first.");
    }
  }

  /**
   * The room's longest stretch of outside wall on one side. Only the envelope
   * edge counts; a room that does not reach it has no window to give, which is
   * a design signal (an interior room with no daylight) rather than an error.
   */
  exteriorRun(roomId: string, side: string): Edge | null {
    const cells = this.cellsOf(roomId);
    if (!cells.size) return null;
    let along: number[];
    let axis: 'v' | 'h', line: number;
    const list = [...cells];
    if (side === 'north') {
      along = list.filter((k) => rowOf(k) === 0).map(colOf); axis = 'h'; line = 0;
    } else if (side === 'south') {
      along = list.filter((k) => rowOf(k) === this.rows - 1).map(colOf); axis = 'h'; line = this.h_cm;
    } else if (side === 'west') {
      along = list.filter((k) => colOf(k) === 0).map(rowOf); axis = 'v'; line = 0;
    } else {
      along = list.filter((k) => colOf(k) === this.cols - 1).map(rowOf); axis = 'v'; line = this.w_cm;
    }
    if (!along.length) return null;
    along.sort((p, q) => p - q);
    let best: [number, number] = [0, 0];
    let start = along[0], prev = along[0];
    for (const value of [...along.slice(1), null]) {
      if (value !== null && value === prev + 1) { prev = value; continue; }
      if (prev + 1 - start > best[1] - best[0]) best = [start, prev + 1];
      if (value !== null) start = prev = value;
    }
    return [axis, line, best[0] * CELL_CM, best[1] * CELL_CM];
  }

  private placeOpening(kind: 'door' | 'window', room: Room, side: string, run: Edge, widthCm: unknown): Opening {
    const [axis, line, start, end] = run;
    const width = snap(asInt(widthCm, 'width'));
    if (end - start < width) throw new PlanError(`The ${room.name.toLowerCase()}'s ${side} wall is too short for that.`);
    this.assertOpeningRoom();
    const offset = snap(start + Math.floor((end - start - width) / 2));
    for (const other of this.openings) {
      if (other.axis !== axis || other.line_cm !== line) continue;
      if (offset < other.start_cm + other.width_cm && other.start_cm < offset + width) throw new PlanError(`There's already a ${other.kind} there.`);
    }
    // Outside is on the low side for a north or west wall, the high side
    // otherwise, which is what makes a/b mean something without a separate
    // "which way is out" field.
    const outsideLow = side === 'north' || side === 'west';
    const opening = new Opening(
      this.ids.mint('o'), kind, axis, line, offset, width,
      outsideLow ? null : room.id, outsideLow ? room.id : null, kind === 'door' ? room.id : null,
    );
    this.openings.push(opening);
    return opening;
  }

  removeOpening(ref: Opening | string | null | undefined): Opening {
    const opening = this.findOpening(ref);
    this.openings.splice(this.openings.indexOf(opening), 1);
    return opening;
  }

  /** The floor each door needs to open: a square on the room side of the wall. */
  doorSwings(): [string, Rect][] {
    const zones: [string, Rect][] = [];
    for (const o of this.openings) {
      if (o.kind !== 'door' || !o.swing_into) continue;
      const depth = o.width_cm;
      const a = o.start_cm, b = o.start_cm + o.width_cm;
      const intoLow = o.swing_into === o.a;
      let rect: Rect;
      if (o.axis === 'v') rect = intoLow ? [o.line_cm - depth, a, o.line_cm, b] : [o.line_cm, a, o.line_cm + depth, b];
      else rect = intoLow ? [a, o.line_cm - depth, b, o.line_cm] : [a, o.line_cm, b, o.line_cm + depth];
      zones.push([o.id, clampRect(rect, this.w_cm, this.h_cm)]);
    }
    return zones;
  }

  // ------------------------------------------------------------ furniture

  addItem(typeName: unknown, roomRef: RoomRef = null, near: unknown = 'center'): Item {
    const piece = resolveType(typeName);
    if (!piece) throw new PlanError(`I don't have a ${normalizeType(typeName) || 'piece'} in my kit — I've got ${KIT_FAMILIES}.`);
    if (this.items.length >= MAX_ITEMS_PER_LEVEL) throw new PlanError(`The floor's full at ${MAX_ITEMS_PER_LEVEL} pieces — take something out first.`);
    let room = roomRef ? this.findRoom(roomRef) : null;
    let spot: Spot | null = null;
    if (room || !this.rooms.size) {
      spot = this.solveFor(piece, near, room);
    } else {
      // No room named. The original searched every owned cell at once, which
      // put "a queen bed" across three rooms; a piece belongs in ONE room, so
      // the rooms it usually lives in are tried first, then the rest by size.
      for (const candidate of this.roomsFor(piece)) {
        spot = this.solveFor(piece, near, candidate);
        if (spot) { room = candidate; break; }
      }
    }
    if (spot === null) {
      const where = room ? ` in the ${room.name.toLowerCase()}` : '';
      throw new PlanError(`There's nowhere${where} that fits without overlapping — clear some space.`);
    }
    const item = new Item(this.ids.mint('i'), piece, spot.x_cm, spot.y_cm, spot.rot);
    this.items.push(item);
    return item;
  }

  /** The rooms a piece is tried in when none was named: its usual kinds, then the rest, biggest first. */
  private roomsFor(piece: Piece): Room[] {
    const usual = USUAL_ROOMS[piece.type] ?? ['living'];
    const rank = (room: Room) => (usual.includes(room.kind) ? usual.indexOf(room.kind) : usual.length);
    const size = new Map([...this.rooms.values()].map((r) => [r.id, this.cellsOf(r.id).size]));
    return [...this.rooms.values()].filter((r) => !r.spec.circulation || r.kind === 'entry')
      .sort((p, q) => rank(p) - rank(q) || size.get(q.id)! - size.get(p.id)!);
  }

  /**
   * Move a piece already on the plan to a RELATION, not a coordinate. Failure
   * leaves the piece exactly where it was: a reposition that cannot find a spot
   * must not cost the client the piece.
   */
  placeItem(ref: ItemRef, roomRef: RoomRef = null, near: unknown = 'center'): Item {
    const item = this.findItem(ref);
    let room = roomRef ? this.findRoom(roomRef) : null;
    if (room === null) {
      const current = this.roomOfItem(item);
      room = current ? this.rooms.get(current) ?? null : null;
    }
    const spot = this.solveFor(item.piece, near, room, item.id);
    if (spot === null) throw new PlanError(`There's nowhere there the ${item.label.toLowerCase()} fits — it's still where it was.`);
    item.x_cm = spot.x_cm;
    item.y_cm = spot.y_cm;
    item.rot = spot.rot;
    return item;
  }

  private solveFor(piece: Piece, near: unknown, room: Room | null, ignore: string | null = null): Spot | null {
    const region = room ? this.cellsOf(room.id) : new Set(this.owner.keys());
    const relation = normalizeKind(near).replaceAll(' ', '_') || 'center';
    const anchors: Record<string, Rect[]> = {};
    for (const opening of this.openings) {
      if (room && room.id !== opening.a && room.id !== opening.b) continue;
      (anchors[opening.kind] ??= []).push(opening.rect);
    }
    if (relation.startsWith('beside')) {
      const wanted = relation.includes(':') ? relation.slice(relation.indexOf(':') + 1) : '';
      try {
        anchors[relation] = [this.findItem(wanted).rect];
      } catch (err) {
        if (!(err instanceof PlanError)) throw err;
      }
    }
    return solve(piece, relation, { region, items: this.items, swings: this.doorSwings().map(([, rect]) => rect), anchors, ignore });
  }

  /** A drag. Coordinates ARE accepted: a human is pointing at a spot. */
  moveItem(ref: ItemRef, xCm: unknown, yCm: unknown): Item {
    const item = this.findItem(ref);
    const x = snap(asInt(xCm, 'x')), y = snap(asInt(yCm, 'y'));
    this.assertPlaceable([x, y, x + item.w_cm, y + item.h_cm], item.id);
    item.x_cm = x;
    item.y_cm = y;
    return item;
  }

  rotateItem(ref: ItemRef, deg: unknown): Item {
    const item = this.findItem(ref);
    const degrees = asInt(deg, 'angle');
    if (mod(degrees, 90) !== 0) throw new PlanError('I only turn things in quarter turns.');
    const rot = mod(item.rot + degrees, 360);
    const turned = new Item(item.id, item.piece, item.x_cm, item.y_cm, rot);
    this.assertPlaceable(turned.rect, item.id);
    item.rot = rot;
    return item;
  }

  removeItem(ref: ItemRef): Item {
    const item = this.findItem(ref);
    this.items.splice(this.items.indexOf(item), 1);
    return item;
  }

  private assertPlaceable(rect: Rect, ignore: string | null = null): void {
    if (rect[0] < 0 || rect[1] < 0 || rect[2] > this.w_cm || rect[3] > this.h_cm) throw new PlanError('That would put it through the outside wall.');
    if (!this.roomsUnder(rect).size) throw new PlanError("There's no room there yet — that's bare floor.");
    for (const other of this.items) {
      if (other.id === ignore) continue;
      if (overlaps(rect, other.rect)) throw new PlanError(`That lands on top of the ${other.label.toLowerCase()}.`);
    }
  }

  // -------------------------------------------------------------- history

  /**
   * A restorable copy of everything a change can touch, deep enough that a
   * later mutation cannot reach back into it (rooms, openings and items are
   * mutable; a shallow copy would hand undo the very state it is meant to roll
   * back to). Piece is shared: it is catalogue data and nothing mutates it.
   */
  capture(): LevelCapture {
    return {
      name: this.name, w_cm: this.w_cm, h_cm: this.h_cm,
      owner: new Map(this.owner),
      rooms: new Map([...this.rooms].map(([id, r]) => [id, new Room(r.id, r.name, r.kind)])),
      openings: this.openings.map((o) => o.copy()),
      items: this.items.map((i) => i.copy()),
      structural: new Set(this.structural),
    };
  }

  /**
   * Put the level back as a capture had it. Copies again on the way in: the
   * original restored the captured records themselves, so after loading a saved
   * scheme a dragged piece moved inside the scheme too.
   */
  restore(snap: LevelCapture): void {
    this.name = snap.name;
    this.w_cm = snap.w_cm;
    this.h_cm = snap.h_cm;
    this.owner = new Map(snap.owner);
    this.rooms = new Map([...snap.rooms].map(([id, r]) => [id, new Room(r.id, r.name, r.kind)]));
    this.openings = snap.openings.map((o) => o.copy());
    this.items = snap.items.map((i) => i.copy());
    this.structural = new Set(snap.structural);
  }

  // ------------------------------------------------------------- snapshot

  /**
   * Every wall between two rooms, as something the panel can put a grip on.
   * Published rather than recomputed in the panel: a second implementation of
   * sharedEdge would drift and disagree about which rooms a grip belongs to.
   */
  sharedWalls(): WallView[] {
    const out: WallView[] = [];
    const rooms = [...this.rooms.values()];
    const cells = new Map(rooms.map((r) => [r.id, this.cellsOf(r.id)]));
    rooms.forEach((a, index) => {
      for (const b of rooms.slice(index + 1)) {
        const edge = sharedEdge(cells.get(a.id)!, cells.get(b.id)!);
        if (edge === null) continue;
        const [axis, line, start, end] = edge;
        const [low, high] = isLowSide(this, a, b) ? [a, b] : [b, a];
        out.push({ a: low.id, b: high.id, axis, line_cm: line, start_cm: start, end_cm: end, structural: this.structural.has(pairKey(low.id, high.id)) });
      }
    });
    return out;
  }

  /** What the panel draws: rooms as merged rectangles and edges, never cells. */
  asDict(): LevelView {
    const rooms = [...this.rooms.values()].map((room): RoomView => {
      const cells = this.cellsOf(room.id);
      return { id: room.id, name: room.name, kind: room.kind, area_m2: areaM2(cells), rects: strips(cells), edges: boundary(cells), bbox: bbox(cells) };
    });
    const unassigned = this.freeCells();
    return {
      name: this.name, w_cm: this.w_cm, h_cm: this.h_cm, rooms,
      unassigned: strips(unassigned), unassigned_m2: areaM2(unassigned),
      openings: this.openings.map((o) => o.asDict()), items: this.items.map((i) => i.asDict()), walls: this.sharedWalls(),
    };
  }
}

// ---------------------------------------------------------------- the home

export interface HomeCapture { levels: LevelCapture[]; names: string[]; active: number; selected: string | null; ids: Record<string, number> }

/** Every level, and which one is being worked on. */
export class Home {
  ids = new Ids();
  levels: Level[];
  active = 0;
  selected: string | null = null;
  unit: 'm2' | 'ft2' = 'm2';

  constructor(wCm = 900, hCm = 700) {
    this.levels = [new Level('ground', wCm, hCm, this.ids)];
  }

  get level(): Level { return this.levels[this.active]; }

  findLevel(ref: unknown): number {
    const key = normalizeKind(ref);
    for (let index = 0; index < this.levels.length; index++) {
      const name = this.levels[index].name;
      if (name === key || name.includes(key)) return index;
    }
    if (['upstairs', 'first', 'top'].includes(key)) return this.levels.length > 1 ? 1 : 0;
    if (['downstairs', 'ground', 'bottom'].includes(key)) return 0;
    throw new PlanError(`There's no ${key} floor.`);
  }

  /**
   * Add the storey above, and put the stairs in on the way. Left to the client,
   * adding a floor raised "the two floors don't connect" and the only cure (a
   * stairs room) could not go on a generated floor with no free cell. Carving
   * them here also guarantees what a 2D drawing cannot show: that both flights
   * are in the same place.
   */
  addLevel(): Level {
    if (this.levels.length >= MAX_LEVELS) throw new PlanError('Two floors is as many as I draw.');
    const ground = this.levels[0];
    const level = new Level(LEVEL_NAMES[this.levels.length], ground.w_cm, ground.h_cm, this.ids);
    this.levels.push(level);
    this.active = this.levels.length - 1;
    if (!ground.rooms.size) return level;
    // Carve a flight downstairs only if there is not one already. Guarding the
    // WHOLE block on that check meant a ground floor that already had stairs
    // gave the new storey none at all.
    let box = this.stairsRect();
    if (box === null) {
      let stairs: Room;
      try {
        stairs = ground.addRoom('stairs', null, 3.6);
      } catch (err) {
        if (!(err instanceof PlanError)) throw err;
        // A ground floor with nothing to spare gets no stairs; the checks say
        // so by name. Better than refusing the whole upper floor over it.
        return level;
      }
      // A flight with no door is a room nobody can reach: the ground floor's
      // checks said "the stairs has no door" right after a clean upstairs.
      // Hang one onto circulation first, then onto the room they came out of.
      const next = ground.sharedWalls().filter((w) => w.a === stairs.id || w.b === stairs.id).map((w) => ground.rooms.get(w.a === stairs.id ? w.b : w.a)!);
      const rank = (room: Room) => (room.spec.circulation ? 0 : room.name === stairs.taken_from ? 1 : 2);
      for (const room of next.sort((p, q) => rank(p) - rank(q))) {
        try {
          ground.addDoor(stairs, room);
          break;
        } catch (err) {
          if (!(err instanceof PlanError)) throw err;
        }
      }
      box = bbox(ground.cellsOf(stairs.id));
    }
    try {
      level.placeRoom('stairs', box);
    } catch (err) {
      if (!(err instanceof PlanError)) throw err;
    }
    return level;
  }

  /** The ground floor's stairs footprint, for the floor above to match. */
  stairsRect(): Rect | null {
    const ground = this.levels[0];
    const cells = [...ground.owner].filter(([, owner]) => ground.rooms.get(owner)?.kind === 'stairs').map(([k]) => k);
    return cells.length ? bbox(cells) : null;
  }

  removeLevel(): void {
    if (this.levels.length < 2) throw new PlanError("There's only the one floor.");
    this.levels.pop();
    this.active = 0;
  }

  goToLevel(ref: unknown): Level {
    this.active = this.findLevel(ref);
    this.selected = null;
    return this.level;
  }

  /**
   * Whether the stairs land on top of each other: the one multi-level error a
   * 2D drawing hides completely, because each floor looks fine on its own.
   */
  stairsAligned(): boolean {
    if (this.levels.length < 2) return true;
    const foot = this.levels.map((level) => new Set([...level.owner].filter(([, owner]) => level.rooms.get(owner)?.kind === 'stairs').map(([k]) => k)));
    if (!foot.every((f) => f.size)) return false;
    return [...foot[0]].some((k) => foot[1].has(k));
  }

  select(ref: unknown): string | null {
    if (ref === null || ref === undefined || ref === '' || ref === 'none') {
      this.selected = null;
      return null;
    }
    // A selection names a room or a piece; whichever it finds is what was clicked.
    try {
      this.selected = this.level.findItem(ref as string).id;
    } catch (err) {
      if (!(err instanceof PlanError)) throw err;
      this.selected = this.level.findRoom(ref as string).id;
    }
    return this.selected;
  }

  clear(): void {
    const level = this.level;
    if (!level.rooms.size && !level.items.length) throw new PlanError('This floor is already empty.');
    level.owner.clear();
    level.rooms.clear();
    level.openings = [];
    level.items = [];
    level.structural.clear();
    this.selected = null;
  }

  capture(): HomeCapture {
    return {
      levels: this.levels.map((level) => level.capture()),
      names: this.levels.map((level) => level.name),
      active: this.active,
      selected: this.selected,
      ids: { ...this.ids.counts },
    };
  }

  /**
   * Put the home back the way capture() found it. The id counters go back too,
   * or undoing an add and adding again makes "r7" appear on a floor whose
   * highest id is r3.
   */
  restore(snap: HomeCapture): void {
    while (this.levels.length > snap.levels.length) this.levels.pop();
    while (this.levels.length < snap.levels.length) this.levels.push(new Level(LEVEL_NAMES[this.levels.length], 900, 700, this.ids));
    this.levels.forEach((level, index) => level.restore(snap.levels[index]));
    // Which floor you are LOOKING at is not part of the plan. Restoring it
    // meant an undo pressed upstairs threw the client back to the ground floor
    // and reverted a change they could no longer see.
    this.active = Math.min(this.active, this.levels.length - 1);
    this.selected = snap.selected;
    // `unit` is deliberately NOT restored: square feet is how the client reads
    // the plan, not something they did to it.
    this.ids.counts = { ...snap.ids };
  }
}

// ----------------------------------------------------------- small helpers

export function asInt(value: unknown, what: string): number {
  const n = toNumber(value);
  if (!Number.isFinite(n)) throw new PlanError(`I need a number for the ${what}.`);
  return Math.trunc(pyRound(n));
}

/** "a bathroom", "an en suite", and "stairs", which takes no article. */
export function article(label: string): string {
  const lowered = label.toLowerCase();
  if (lowered.endsWith('s') && !lowered.endsWith('ss')) return lowered;
  return ('aeiou'.includes(lowered[0] ?? '') && lowered ? 'an ' : 'a ') + lowered;
}

/** Where inside a free stretch to sit: hard against either end, or centred. */
function anchorsWithin(start: number, slack: number): number[] {
  if (slack <= 0) return [start];
  return [...new Set([start, start + Math.floor(slack / 2), start + slack])].sort((p, q) => p - q);
}

/** To the grid. Rounding at the edge keeps every length a whole number of cells. */
export const snap = (value: number) => Math.trunc(pyRound(value / CELL_CM)) * CELL_CM;

function clampRect(rect: Rect, w: number, h: number): Rect {
  return [Math.max(0, rect[0]), Math.max(0, rect[1]), Math.min(w, rect[2]), Math.min(h, rect[3])];
}

/** True when `a` sits on the low side of the wall it shares with `b`. */
export function isLowSide(level: Level, a: Room, b: Room): boolean {
  const edge = sharedEdge(level.cellsOf(a.id), level.cellsOf(b.id));
  if (edge === null) return true;
  const [axis, line] = edge;
  const box = bbox(level.cellsOf(a.id));
  return axis === 'v' ? box[2] <= line : box[3] <= line;
}

/** How badly a candidate rectangle misses the relation asked for. */
function roomRelationCost(level: Level, relation: string, rect: Rect): number {
  const cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2;
  const midX = level.w_cm / 2, midY = level.h_cm / 2;
  const centre = Math.abs(cx - midX) + Math.abs(cy - midY);
  if (['', 'center', 'centre', 'middle'].includes(relation)) return centre;
  const side = relation.replace('_wall', '');
  if ((WALLS as readonly string[]).includes(side)) {
    if (side === 'north') return rect[1];
    if (side === 'south') return level.h_cm - rect[3];
    if (side === 'west') return rect[0];
    return level.w_cm - rect[2];
  }
  if (relation.startsWith('beside')) {
    const wanted = relation.includes(':') ? relation.slice(relation.indexOf(':') + 1) : '';
    let other: Room;
    try {
      other = level.findRoom(wanted);
    } catch (err) {
      if (!(err instanceof PlanError)) throw err;
      return centre;
    }
    const box = bbox(level.cellsOf(other.id));
    return Math.abs(cx - (box[0] + box[2]) / 2) + Math.abs(cy - (box[1] + box[3]) / 2);
  }
  return centre;
}
