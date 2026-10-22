// The home behind one door: the reducer, the snapshot, the undo history and
// the critic. (In the original this was table.py around the platform's
// StateStore; on the API the page owns it, so it is a plain class.)
//
// - apply() is the only writer. A wall dragged on the plan, a spoken "give the
//   living room two metres off the study" and a button all arrive as intents;
//   Home validates before mutating, so a refusal leaves the plan untouched and
//   carries a sentence the client can be told.
// - snapshot() is the public projection. Derived fields (issues, schedule, the
//   comparison) are computed on every read so they cannot go stale.
// - The Critic is the designer's initiative: after each accepted change it
//   names only issues that have just APPEARED, at most one per change.
import { catalogView } from './catalog.ts';
import { compare, issues, schedule, type Issue } from './compliance.ts';
import { cardinal } from './describe.ts';
import { briefFor, generate, Slot, TYPOLOGIES } from './generate.ts';
import { areaM2, bbox } from './geom.ts';
import { Home, PlanError, type HomeCapture, type Item, type Level, type Opening, type Room } from './home.ts';
import { fmtG, toNumber } from './num.ts';
import { KINDS } from './rooms.ts';
import { Schemes } from './schemes.ts';
import { render } from './sheet.ts';
import type { ApplyResult, Done, Intent, PlanSnapshot, RoomFact, SheetView } from './types.ts';

/** How far back undo reaches: deep enough to walk out of a bad five minutes. */
export const UNDO_DEPTH = 30;

/**
 * Intents that change nothing worth undoing. `select` is a highlight: in the
 * history the first undo after clicking a bedroom would deselect it. Saving and
 * dropping a scheme change the scheme LIST, which a capture does not hold, so
 * the step they pushed restored nothing at all while the designer confirmed a
 * rollback that had not happened. Loading a scheme replaces the plan, so it
 * stays a step.
 */
export const NON_HISTORIC = ['select', 'undo', 'set_unit', 'compare_scheme', 'go_to_level', 'draw_sheet', 'save_scheme', 'drop_scheme'];

export const NOTHING_TO_UNDO = "There's nothing to undo yet.";

/** Every intent kind the planner accepts: the vocabulary of controls and the judge. */
export const INTENT_KINDS = [
  'generate', 'set_envelope', 'add_room', 'remove_room', 'rename_room', 'swap_rooms', 'merge_rooms', 'split_room',
  'move_wall', 'trade_area', 'grow_room', 'mark_structural', 'add_door', 'add_front_door', 'add_window', 'remove_opening',
  'add_item', 'place_item', 'move_item', 'rotate_item', 'remove_item', 'add_level', 'remove_level', 'go_to_level',
  'save_scheme', 'load_scheme', 'drop_scheme', 'compare_scheme', 'select', 'draw_sheet', 'set_unit', 'clear', 'undo',
] as const;

const str = (value: unknown) => (value === null || value === undefined ? '' : String(value));

export class Planner {
  readonly home: Home;
  readonly schemes = new Schemes();
  private history: { capture: HomeCapture; label: string }[] = [];
  private view: { comparing: string | null; sheet: SheetView | null } = { comparing: null, sheet: null };

  constructor(wCm = 900, hCm = 700) {
    this.home = new Home(wCm, hCm);
  }

  canUndo(): boolean { return this.history.length > 0; }

  /** Apply one intent: applied with what it did, or refused with a sentence. */
  apply(intent: Intent): ApplyResult {
    const kind = str(intent.kind).trim().toLowerCase();
    if (kind === 'undo') {
      const last = this.history.pop();
      if (!last) return { applied: false, reason: NOTHING_TO_UNDO };
      this.home.restore(last.capture);
      return this.ok({ kind, label: `undid ${last.label}`, undone: last.label });
    }
    const before = NON_HISTORIC.includes(kind) ? null : this.home.capture();
    let done: Done;
    try {
      done = this.reduce(kind, intent);
    } catch (err) {
      if (err instanceof PlanError) return { applied: false, reason: err.message };
      // A bug, not a refusal. Put the plan back and say something a client can
      // hear rather than leaving half a change on screen.
      console.error('[room-planner] %s failed', kind, err);
      if (before) this.home.restore(before);
      return { applied: false, reason: "The drawing didn't take that — try it another way." };
    }
    if (before) {
      this.history.push({ capture: before, label: done.label });
      this.history.splice(0, Math.max(0, this.history.length - UNDO_DEPTH));
    }
    return this.ok(done);
  }

  private ok(done: Done): ApplyResult {
    return { applied: true, snapshot: this.snapshot(), done };
  }

  private fact(level: Level, room: Room): RoomFact {
    const cells = level.cellsOf(room.id);
    const [x0, y0, x1, y1] = bbox(cells);
    return { id: room.id, name: room.name, area_m2: areaM2(cells), where: cardinal(x0, y0, x1 - x0, y1 - y0, level.w_cm, level.h_cm) };
  }

  private itemFact(level: Level, item: Item, near?: unknown): NonNullable<Done['item']> {
    const roomId = level.roomOfItem(item);
    return { id: item.id, label: item.label, room: roomId ? level.rooms.get(roomId)?.name ?? null : null, w_cm: item.w_cm, h_cm: item.h_cm, ...(near ? { near: str(near) } : {}) };
  }

  private openingFact(level: Level, opening: Opening, wall?: unknown): NonNullable<Done['opening']> {
    const rooms = [opening.a, opening.b].filter((id): id is string => Boolean(id)).map((id) => level.rooms.get(id)?.name ?? id);
    return { kind: opening.kind, front: opening.kind === 'door' && opening.exterior, rooms, ...(wall ? { wall: str(wall).toLowerCase().replace(/[_ ]?wall$/, '') } : {}) };
  }

  private reduce(kind: string, intent: Intent): Done {
    const home = this.home;
    const level = home.level;
    const lower = (name: string) => name.toLowerCase();
    switch (kind) {
      // ------------------------------------------------------------ the floor
      case 'generate': {
        // Which floor you are on changes what a brief MEANS: upstairs defaults
        // to sleeping accommodation and inherits the stairs from below.
        const upstairs = home.active > 0;
        const shape = generate(level, slotsFor(intent, upstairs), {
          style: str(intent.style) || 'day_night',
          entryWall: str(intent.entry_wall) || 'south',
          reserve: upstairs ? home.stairsRect() : null,
          frontDoor: !upstairs,
        });
        return { kind, label: `laid out the ${level.name} floor (${lower(shape.label)})`, typology: { key: shape.key, label: shape.label, note: shape.note } };
      }
      case 'set_envelope': {
        level.setEnvelope(intent.w, intent.h);
        return { kind, label: `made the floor ${fmtG(level.w_cm / 100)} by ${fmtG(level.h_cm / 100)} metres`, size: { w_cm: level.w_cm, h_cm: level.h_cm } };
      }
      // ------------------------------------------------------------ the rooms
      case 'add_room': {
        const room = level.addRoom(intent.room_kind || intent.type, intent.name, intent.area_m2, intent.near || 'center');
        const donor = room.taken_from ? [...level.rooms.values()].find((r) => r.name === room.taken_from) : undefined;
        return { kind, label: `added the ${lower(room.name)}`, rooms: [this.fact(level, room)], ...(donor ? { takenFrom: this.fact(level, donor) } : {}) };
      }
      case 'remove_room': {
        const room = level.findRoom(intent.id as string);
        const area = areaM2(level.cellsOf(room.id));
        level.removeRoom(room);
        return { kind, label: `removed the ${lower(room.name)}`, removed: { name: room.name, area_m2: area } };
      }
      case 'rename_room': {
        const room = level.findRoom(intent.id as string);
        const was = room.name;
        level.renameRoom(room, intent.name, intent.room_kind);
        return { kind, label: was === room.name ? `made the ${lower(room.name)} a ${lower(room.spec.label)}` : `renamed the ${lower(was)} to ${room.name}`, rooms: [this.fact(level, room)], was };
      }
      case 'swap_rooms': {
        const [a, b] = level.swapRooms(intent.a as string, intent.b as string);
        return { kind, label: `swapped the ${lower(b.name)} and the ${lower(a.name)}`, rooms: [this.fact(level, a), this.fact(level, b)] };
      }
      case 'merge_rooms': {
        const absorbed = level.findRoom(intent.b as string);
        const name = absorbed.name;
        const room = level.mergeRooms(intent.a as string, absorbed);
        return { kind, label: `knocked the ${lower(room.name)} and the ${lower(name)} together`, rooms: [this.fact(level, room)], was: name };
      }
      case 'split_room': {
        const room = level.findRoom(intent.id as string);
        const created = level.splitRoom(room, intent.room_kind, intent.name, intent.axis || 'auto');
        return { kind, label: `divided the ${lower(room.name)}`, rooms: [this.fact(level, room), this.fact(level, created)] };
      }
      // -------------------------------------------------------- moving walls
      case 'move_wall': {
        // Real centimetres, because this comes from a hand dragging a wall.
        const [a, b] = level.moveWall(intent.a as string, intent.b as string, intent.delta);
        const delta = toNumber(intent.delta);
        const [gains, loses] = delta > 0 ? [a, b] : [b, a];
        return { kind, label: `moved the wall between the ${lower(a.name)} and the ${lower(b.name)}`, rooms: [this.fact(level, gains), this.fact(level, loses)] };
      }
      case 'trade_area': {
        const giverBefore = areaM2(level.cellsOf(level.findRoom(intent.from as string).id));
        const [taker, giver] = level.tradeArea(intent.from as string, intent.to as string, intent.m2);
        const moved = Math.round((giverBefore - areaM2(level.cellsOf(giver.id))) * 10) / 10;
        return { kind, label: `traded ${fmtG(moved)} m² from the ${lower(giver.name)} to the ${lower(taker.name)}`, rooms: [this.fact(level, taker), this.fact(level, giver)], moved_m2: moved };
      }
      case 'grow_room': {
        const room = level.growRoom(intent.id as string, intent.m2, intent.towards);
        return { kind, label: `grew the ${lower(room.name)} into spare floor`, rooms: [this.fact(level, room)] };
      }
      case 'mark_structural': {
        const [a, b] = level.markStructural(intent.a as string, intent.b as string);
        return { kind, label: `marked the wall between the ${lower(a.name)} and the ${lower(b.name)} load-bearing`, rooms: [this.fact(level, a), this.fact(level, b)] };
      }
      // ------------------------------------------------------------ openings
      case 'add_door': {
        const opening = level.addDoor(intent.a as string, intent.b as string, intent.width);
        const fact = this.openingFact(level, opening);
        return { kind, label: `put a door between the ${fact.rooms.map(lower).join(' and the ')}`, opening: fact };
      }
      case 'add_front_door': {
        const opening = level.addFrontDoor(intent.id as string, intent.wall, intent.width);
        const fact = this.openingFact(level, opening, intent.wall);
        return { kind, label: `put the front door in the ${lower(fact.rooms[0] ?? 'room')}`, opening: fact };
      }
      case 'add_window': {
        const opening = level.addWindow(intent.id as string, intent.wall, intent.width);
        const fact = this.openingFact(level, opening, intent.wall);
        return { kind, label: `put a window in the ${lower(fact.rooms[0] ?? 'room')} on the ${fact.wall} side`, opening: fact };
      }
      case 'remove_opening': {
        const opening = level.removeOpening(intent.id as string);
        const fact = this.openingFact(level, opening);
        const where = fact.front ? 'the front door' : `the ${opening.kind} ${fact.rooms.length > 1 ? `between the ${fact.rooms.map(lower).join(' and the ')}` : `in the ${lower(fact.rooms[0] ?? 'room')}`}`;
        return { kind, label: `took out ${where}`, opening: fact };
      }
      // ----------------------------------------------------------- furniture
      case 'add_item': {
        const item = level.addItem(intent.type, (intent.room as string) || null, intent.near || 'center');
        const fact = this.itemFact(level, item, intent.near);
        return { kind, label: `added a ${lower(item.label)}${fact.room ? ` to the ${lower(fact.room)}` : ''}`, item: fact };
      }
      case 'place_item': {
        const item = level.placeItem(intent.id as string, (intent.room as string) || null, intent.near || 'center');
        return { kind, label: `moved the ${lower(item.label)}`, item: this.itemFact(level, item, intent.near) };
      }
      case 'move_item': {
        const item = level.moveItem(intent.id as string, intent.x, intent.y);
        return { kind, label: `moved the ${lower(item.label)}`, item: this.itemFact(level, item) };
      }
      case 'rotate_item': {
        const item = level.rotateItem(intent.id as string, 'deg' in intent ? intent.deg : 90);
        return { kind, label: `turned the ${lower(item.label)}`, item: this.itemFact(level, item) };
      }
      case 'remove_item': {
        const item = level.removeItem(intent.id as string);
        return { kind, label: `removed the ${lower(item.label)}`, item: { id: item.id, label: item.label, room: null, w_cm: item.w_cm, h_cm: item.h_cm } };
      }
      // -------------------------------------------------------------- levels
      case 'add_level': {
        const added = home.addLevel();
        return { kind, label: 'added an upper floor', level: added.name };
      }
      case 'remove_level': {
        home.removeLevel();
        return { kind, label: 'removed the upper floor', level: home.level.name };
      }
      case 'go_to_level': {
        const shown = home.goToLevel(intent.id);
        return { kind, label: `went to the ${shown.name} floor`, level: shown.name };
      }
      // ------------------------------------------------------------- schemes
      case 'save_scheme': {
        const scheme = this.schemes.save(home, intent.name);
        return { kind, label: `saved scheme ${scheme.name}`, scheme: scheme.name };
      }
      case 'load_scheme': {
        const scheme = this.schemes.restore(home, intent.name);
        this.view.comparing = null;
        return { kind, label: `went back to scheme ${scheme.name}`, scheme: scheme.name };
      }
      case 'drop_scheme': {
        const dropped = this.schemes.drop(intent.name);
        if (this.view.comparing === dropped.name) this.view.comparing = null;
        return { kind, label: `dropped scheme ${dropped.name}`, scheme: dropped.name };
      }
      case 'compare_scheme': {
        const name = intent.name;
        if (name === null || name === undefined || name === '' || name === 'off') {
          this.view.comparing = null;
          return { kind, label: 'closed the comparison' };
        }
        this.view.comparing = this.schemes.find(name).name;
        return { kind, label: `compared with scheme ${this.view.comparing}`, scheme: this.view.comparing };
      }
      // ---------------------------------------------------------------- misc
      case 'select': {
        const id = home.select(intent.id);
        return { kind, label: id ? `selected ${id}` : 'cleared the selection' };
      }
      case 'draw_sheet': {
        // Not a change to the plan, a picture of it, which is why it is out of
        // the undo history. Rendered here: the page can hand the client a file.
        if (!level.rooms.size) throw new PlanError("There's nothing on this floor to draw up yet.");
        this.view.sheet = { status: 'ready', svg: render(home, { unit: home.unit }), floor: level.name };
        return { kind, label: 'drew up the sheet' };
      }
      case 'set_unit': {
        home.unit = str(intent.unit) === 'ft2' ? 'ft2' : 'm2';
        return { kind, label: `switched to ${home.unit === 'ft2' ? 'square feet' : 'square metres'}`, unit: home.unit };
      }
      case 'clear': {
        home.clear();
        return { kind, label: `cleared the ${level.name} floor` };
      }
      default:
        throw new PlanError(`'${kind}' isn't something I can do to a floor plan.`);
    }
  }

  /** The public projection: everything the page draws and nothing else. */
  snapshot(): PlanSnapshot {
    const home = this.home;
    const level = home.level;
    const out: PlanSnapshot = {
      level: level.asDict(),
      levels: home.levels.map((lv) => lv.name),
      active: home.active,
      selected: home.selected,
      unit: home.unit,
      schedule: schedule(home, home.unit),
      issues: issues(home),
      schemes: this.schemes.asList(),
      stairs_aligned: home.stairsAligned(),
      can_undo: this.canUndo(),
      // Reference data the page must not carry a second copy of.
      catalog: catalogView(),
      room_kinds: Object.values(KINDS).map((spec) => ({ kind: spec.kind, label: spec.label, min_area_m2: spec.min_area_m2 })),
      typologies: TYPOLOGIES.map((t) => ({ key: t.key, label: t.label, note: t.note })),
      others: home.levels.filter((_, index) => index !== home.active).map((lv) => ({
        name: lv.name, w_cm: lv.w_cm, h_cm: lv.h_cm,
        rooms: [...lv.rooms.values()].map((r) => ({ name: r.name, area_m2: areaM2(lv.cellsOf(r.id)) })),
      })),
      last_change: this.history[this.history.length - 1]?.label ?? null,
    };
    if (this.view.sheet) out.sheet = this.view.sheet;
    const comparing = this.view.comparing ? this.schemes.saved.get(this.view.comparing) : undefined;
    if (comparing) {
      out.comparing = {
        name: comparing.name, rows: comparing.rows, deltas: compare(home, comparing.rows, home.unit),
        thumb: comparing.thumb, circulation_pct: comparing.circulation_pct,
      };
    }
    return out;
  }
}

/**
 * The brief, however it arrived: a room list when the client knows exactly
 * what they want, a household shape when they do not (which is what makes a
 * first plan possible three turns into a conversation).
 */
export function slotsFor(intent: Intent, upstairs = false): Slot[] {
  const rooms = intent.rooms;
  if (Array.isArray(rooms) && rooms.length) {
    const out: Slot[] = [];
    for (const entry of rooms) {
      if (typeof entry === 'string') out.push(new Slot(entry));
      else if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>;
        out.push(new Slot(str(e.kind || e.room_kind || 'other'), (e.name as string) ?? null, (toNumber(e.area_m2) || null)));
      }
    }
    if (out.length) return out;
  }
  const bedrooms = Math.trunc(toNumber(intent.bedrooms)) || 1;
  return briefFor(bedrooms, {
    office: Boolean(intent.office), dining: Boolean(intent.dining), ensuite: Boolean(intent.ensuite),
    wc: Boolean(intent.wc), utility: Boolean(intent.utility), upstairs,
  });
}

// ------------------------------------------------------------------ the critic

/** Whether the floor on screen has been drawn: a floor holding only its stairs has not. */
export const isDrawn = (snap: PlanSnapshot) => snap.level.rooms.some((room) => room.kind !== 'stairs');

/**
 * What makes an issue the same issue. The note carries the measurement, so a
 * corridor that narrows from 90 to 70 cm is a NEW complaint, while the same
 * corridor restated after an unrelated change is not.
 */
export const issueKey = (issue: Issue) => `${issue.room ?? null}|${issue.item ?? null}|${issue.kind}|${issue.note}`;

/**
 * The designer noticing what just went wrong, and only what JUST did. Issues
 * that are gone are forgotten, so narrowing a corridor, widening it and
 * narrowing it again is worth mentioning twice.
 *
 * One addition over the original: an empty floor has nothing to critique. The
 * original's first look at a blank floor found "63 square metres isn't in any
 * room", so resizing an empty floor got a complaint about floor nobody had
 * drawn on yet.
 */
export class Critic {
  private spoken = new Set<string>();

  /** Issues new since the last look; every current one is marked seen. */
  look(found: Issue[], { hasRooms = true } = {}): Issue[] {
    const fresh = hasRooms ? found.filter((issue) => !this.spoken.has(issueKey(issue))) : [];
    this.spoken = new Set(found.map(issueKey));
    return fresh;
  }
}
