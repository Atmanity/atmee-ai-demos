// The floor model: ownership, the operators that move walls, and what they
// refuse (ported from test_home.py).
//
// The invariant every test is really about: a cell has one owner. Most of these
// assert that property survives an operator rather than the operator's result.
import { describe, expect, test } from 'vitest';
import { briefFor, generate } from './generate.ts';
import { areaM2, cell, colOf, rectCells, rowOf, sharedEdge, type Cell } from './geom.ts';
import { Home, PlanError, type Level, type Room } from './home.ts';

const home = (w = 900, h = 700) => new Home(w, h);

/** Two rooms that genuinely share a wall, taken off a GENERATED floor. */
function adjacentPair(level: Level): [Room, Room] {
  for (const a of level.rooms.values()) {
    for (const b of level.rooms.values()) {
      if (a.id >= b.id) continue;
      if (sharedEdge(level.cellsOf(a.id), level.cellsOf(b.id))) return [a, b];
    }
  }
  throw new Error('a generated floor must have adjacent rooms');
}

function generated(w = 1000, h = 800, bedrooms = 2): Home {
  const hm = home(w, h);
  generate(hm.level, briefFor(bedrooms));
  return hm;
}

const stairsCells = (level: Level) => new Set([...level.owner].filter(([, owner]) => level.rooms.get(owner)!.kind === 'stairs').map(([k]) => k));
const sortedCells = (cells: Iterable<Cell>) => [...cells].sort((a, b) => a - b);

describe('ownership', () => {
  test('every cell has at most one owner after many adds', () => {
    const level = home().level;
    for (const kind of ['living', 'kitchen', 'bedroom', 'bathroom', 'hall']) level.addRoom(kind);
    const seen = new Set<Cell>();
    for (const room of level.rooms.values()) {
      const cells = level.cellsOf(room.id);
      for (const k of cells) {
        expect(seen.has(k), `${room.name} overlaps another room`).toBe(false);
        seen.add(k);
      }
    }
    expect(sortedCells(seen)).toEqual(sortedCells(level.owner.keys()));
  });

  test('rooms never leave the envelope', () => {
    const level = home(900, 700).level;
    level.addRoom('living');
    level.addRoom('bedroom');
    for (const k of level.owner.keys()) {
      expect(colOf(k) >= 0 && colOf(k) < level.cols).toBe(true);
      expect(rowOf(k) >= 0 && rowOf(k) < level.rows).toBe(true);
    }
  });

  test('unassigned floor is reported, not hidden', () => {
    // A gap is a first-class thing you can see and be told about, which is the
    // entire reason ownership beats free-floating rectangles.
    const hm = home(900, 700);
    hm.level.addRoom('bedroom', null, 12);
    const snap = hm.level.asDict();
    expect(snap.unassigned_m2).toBeGreaterThan(0);
    expect(snap.unassigned.length).toBeGreaterThan(0);
  });
});

describe('refusals', () => {
  test('a room under its minimum area is refused', () => {
    const level = home().level;
    level.addRoom('living', null, 12);
    const living = level.findRoom('living');
    // Keep one contiguous column: connected, so only the area rule can object.
    const cells = sortedCells(level.cellsOf(living.id));
    const keep = new Set(cells.slice(0, 20));
    expect(() => level.commit(new Map(cells.filter((k) => !keep.has(k)).map((k) => [k, null])))).toThrow(/too small/);
  });

  test('a sliver is refused', () => {
    const level = home().level;
    level.addRoom('bedroom', null, 12);
    const bedroom = level.findRoom('bedroom');
    const cells = sortedCells(level.cellsOf(bedroom.id));
    // A full-width room plus a one-cell tail: area still passes, and only the
    // narrowness rule can see the problem.
    const firstRow = rowOf(cells[0]);
    const keep = new Set([...cells.filter((k) => rowOf(k) <= firstRow + 1), cells[cells.length - 1]]);
    expect(() => level.commit(new Map(cells.filter((k) => !keep.has(k)).map((k) => [k, null])))).toThrow(PlanError);
  });

  test('a refused change leaves the floor exactly as it was', () => {
    // A half-applied change means the panel draws a floor the planner believes it rejected.
    const level = home().level;
    level.addRoom('living', null, 14);
    const before = new Map(level.owner);
    const living = level.findRoom('living');
    expect(() => level.commit(new Map([...level.cellsOf(living.id)].slice(0, -2).map((k) => [k, null])))).toThrow(PlanError);
    expect(level.owner).toEqual(before);
  });

  test('shrinking the envelope over a room is refused and names it', () => {
    const level = home(900, 700).level;
    level.addRoom('bedroom', null, 12, 'south_wall');
    expect(() => level.setEnvelope(900, 200)).toThrow(/bedroom/);
  });
});

describe('moving walls', () => {
  test('moving a wall transfers floor and conserves the total', () => {
    const level = generated().level;
    const [a, b] = adjacentPair(level);
    // Counted in cells: two rooms each rounded to one decimal do not sum to the
    // rounded total, and that drift is the test's arithmetic, not the floor's.
    const before = level.cellsOf(a.id).size + level.cellsOf(b.id).size;
    level.moveWall(a, b, 10);
    expect(level.cellsOf(a.id).size + level.cellsOf(b.id).size).toBe(before);
  });

  test('a wall cannot be pushed past the room behind it', () => {
    const level = generated().level;
    const [a, b] = adjacentPair(level);
    expect(() => level.moveWall(a, b, 10_000)).toThrow(PlanError);
  });

  test('a structural wall refuses to move', () => {
    const level = generated().level;
    const [a, b] = adjacentPair(level);
    level.markStructural(a, b);
    expect(() => level.moveWall(a, b, 20)).toThrow(/holding the building up/);
  });
});

describe('merge, split, swap', () => {
  test('merging two rooms keeps every cell', () => {
    const level = generated().level;
    const [a, b] = adjacentPair(level);
    const total = level.cellsOf(a.id).size + level.cellsOf(b.id).size;
    const merged = level.mergeRooms(a, b);
    expect(level.cellsOf(merged.id).size).toBe(total);
    expect(level.rooms.has(b.id)).toBe(false);
  });

  test('merging rooms that do not touch is refused', () => {
    const level = home(1400, 400).level;
    const a = level.addRoom('bedroom', null, 10, 'west_wall');
    const b = level.addRoom('bedroom', null, 10, 'east_wall');
    expect(sharedEdge(level.cellsOf(a.id), level.cellsOf(b.id))).toBeNull();
    expect(() => level.mergeRooms(a, b)).toThrow(/don't touch/);
  });

  test('splitting a room conserves its floor', () => {
    const level = home(900, 700).level;
    const big = level.addRoom('living', null, 30);
    const before = level.cellsOf(big.id).size;
    const created = level.splitRoom(big, 'office');
    expect(level.cellsOf(big.id).size + level.cellsOf(created.id).size).toBe(before);
  });

  test('swapping two rooms trades identity and leaves the floor alone', () => {
    // Exact, not approximate: furniture stores no room id, so the pieces belong
    // to whoever now owns that floor.
    const level = home(900, 700).level;
    const a = level.addRoom('bedroom', null, 13, 'west_wall');
    const b = level.addRoom('office', null, 9, 'east_wall');
    const aCells = sortedCells(level.cellsOf(a.id)), bCells = sortedCells(level.cellsOf(b.id));
    level.swapRooms(a, b);
    expect(sortedCells(level.cellsOf(a.id))).toEqual(aCells);
    expect(sortedCells(level.cellsOf(b.id))).toEqual(bCells);
    expect(a.kind).toBe('office');
    expect(b.kind).toBe('bedroom');
  });
});

describe('furniture', () => {
  test('furniture stays inside the room it was added to', () => {
    const level = home(900, 700).level;
    const bedroom = level.addRoom('bedroom', null, 14);
    const item = level.addItem('queen bed', bedroom);
    const cells = level.cellsOf(bedroom.id);
    expect([...rectCells(item.rect)].every((k) => cells.has(k))).toBe(true);
  });

  test('the room a piece is in is derived from the floor under it', () => {
    const level = home(900, 700).level;
    const bedroom = level.addRoom('bedroom', null, 14);
    expect(level.roomOfItem(level.addItem('queen bed', bedroom))).toBe(bedroom.id);
  });

  test('a piece cannot be dragged onto bare floor', () => {
    const level = home(900, 700).level;
    const bedroom = level.addRoom('bedroom', null, 12, 'north_wall');
    const item = level.addItem('chair', bedroom);
    const bare = Math.min(...level.freeCells());
    expect(() => level.moveItem(item, colOf(bare) * 10, rowOf(bare) * 10)).toThrow(/bare floor/);
  });

  test('a piece cannot be dragged on top of another', () => {
    const level = home(900, 700).level;
    const room = level.addRoom('living', null, 24);
    const first = level.addItem('3-seat sofa', room);
    const second = level.addItem('armchair', room);
    expect(() => level.moveItem(second, first.x_cm, first.y_cm)).toThrow(/lands on top/);
  });

  test('a piece asked for without a room lands inside one room, the kind it lives in (fixed in the port)', () => {
    // The original searched the whole floor at once and drew "a queen bed"
    // across the wall between three rooms.
    const hm = generated();
    const level = hm.level;
    const bed = level.addItem('queen bed');
    expect(level.roomsUnder(bed.rect).size).toBe(1);
    expect(level.rooms.get(level.roomOfItem(bed)!)!.kind).toBe('bedroom');
    const sofa = level.addItem('sofa');
    expect(level.rooms.get(level.roomOfItem(sofa)!)!.kind).toBe('living');
  });

  test('a piece asked for the south wall faces it with its long side', () => {
    const level = home(900, 700).level;
    const room = level.addRoom('living', null, 24);
    const sofa = level.addItem('sofa', room, 'south_wall');
    expect(sofa.w_cm).toBeGreaterThan(sofa.h_cm);
    expect(sofa.rect[3]).toBe([...level.cellsOf(room.id)].reduce((m, k) => Math.max(m, (rowOf(k) + 1) * 10), 0));
  });
});

describe('openings', () => {
  test('a window needs an outside wall', () => {
    const level = home(900, 700).level;
    // A room in the middle of the floor touches no envelope edge, so it has no
    // daylight to give: a design signal, not an error.
    const middle = level.addRoom('storage', null, 4, 'center');
    expect(colOf(Math.min(...level.cellsOf(middle.id)))).toBeGreaterThan(0);
    expect(() => level.addWindow(middle, 'west')).toThrow(/outside wall/);
  });

  test('a door between two rooms lands on the wall they share', () => {
    const level = home(800, 600).level;
    const a = level.placeRoom('living', [0, 0, 500, 600]);
    const b = level.placeRoom('hall', [500, 0, 800, 600]);
    const [axis, line, start, end] = sharedEdge(level.cellsOf(a.id), level.cellsOf(b.id))!;
    const door = level.addDoor(a, b);
    expect([door.axis, door.line_cm]).toEqual([axis, line]);
    expect(start).toBeLessThanOrEqual(door.start_cm);
    expect(door.start_cm + door.width_cm).toBeLessThanOrEqual(end);
    // A door into a hall keeps the room's own floor clear.
    expect(door.swing_into).toBe(b.id);
  });

  test('a door swing takes floor inside a room', () => {
    const level = home(900, 700).level;
    const room = level.addRoom('bedroom', null, 14, 'north_wall');
    const door = level.addFrontDoor(room, 'north');
    const zones = new Map(level.doorSwings());
    expect(zones.has(door.id)).toBe(true);
    const [x0, y0, x1, y1] = zones.get(door.id)!;
    expect(x1 > x0 && y1 > y0).toBe(true);
  });

  test('removing a room takes its doors with it', () => {
    const level = home(800, 600).level;
    const a = level.placeRoom('living', [0, 0, 500, 600]);
    const b = level.placeRoom('hall', [500, 0, 800, 600]);
    level.addDoor(a, b);
    level.removeRoom(b);
    expect(level.openings.every((o) => o.a !== b.id && o.b !== b.id)).toBe(true);
  });
});

describe('levels', () => {
  test('a second level starts with the same envelope', () => {
    const upper = home(900, 700).addLevel();
    expect([upper.w_cm, upper.h_cm]).toEqual([900, 700]);
    expect(upper.name).toBe('upper');
  });

  test('stairs must land on top of each other', () => {
    // The one multi-level error a 2D drawing hides completely. addLevel
    // mirrors the flight, so misalignment has to be built by hand.
    const hm = home(1000, 800);
    hm.level.addRoom('stairs', null, 4, 'west_wall');
    const upper = hm.addLevel();
    expect(hm.stairsAligned(), 'addLevel should have mirrored the flight').toBe(true);
    for (const room of [...upper.rooms.values()].filter((r) => r.kind === 'stairs')) upper.removeRoom(room);
    upper.addRoom('stairs', null, 4, 'east_wall');
    const ground = stairsCells(hm.levels[0]), up = stairsCells(upper);
    expect([...ground].some((k) => up.has(k)), 'the solver put them back in the same place').toBe(false);
    expect(hm.stairsAligned()).toBe(false);
  });

  test('more than two levels is refused', () => {
    const hm = home();
    hm.addLevel();
    expect(() => hm.addLevel()).toThrow(/Two floors/);
  });
});

describe('history', () => {
  test('capture and restore round trip', () => {
    const hm = home(900, 700);
    const room = hm.level.addRoom('living', null, 18);
    hm.level.addItem('3-seat sofa', room);
    const snap = hm.capture();
    hm.level.addRoom('bedroom', null, 12);
    hm.level.addItem('armchair');
    hm.restore(snap);
    expect(hm.level.rooms.size).toBe(1);
    expect(hm.level.items).toHaveLength(1);
  });

  test('restore puts the id counters back', () => {
    // Otherwise undoing an add and adding again mints r7 on a floor whose
    // highest id is r3, and every later capture disagrees with the one before.
    const hm = home(900, 700);
    const snap = hm.capture();
    hm.level.addRoom('bedroom');
    hm.restore(snap);
    expect(hm.level.addRoom('bedroom').id).toBe('r1');
  });

  test('undo survives a level being added', () => {
    const hm = home(900, 700);
    const snap = hm.capture();
    hm.addLevel();
    hm.level.addRoom('bedroom');
    hm.restore(snap);
    expect(hm.levels).toHaveLength(1);
    expect(hm.active).toBe(0);
  });

  test('a restored capture is not shared with the live plan (fixed in the port)', () => {
    // The original restored the captured records themselves, so after loading
    // a saved scheme, dragging a piece moved it inside the saved scheme too.
    const hm = home(900, 700);
    const room = hm.level.addRoom('living', null, 18);
    const sofa = hm.level.addItem('3-seat sofa', room);
    const snap = hm.capture();
    hm.restore(snap);
    hm.level.findItem(sofa.id).x_cm += 10;
    expect(snap.levels[0].items[0].x_cm).toBe(sofa.x_cm);
  });
});

// ------------------------------------------------------- what user testing found
//
// Every test below is a bug three people hit in a live session before anyone
// had written a test for it: the geometry was right and the app was unusable.

describe('what user testing found', () => {
  test('a room can be added to a floor with no free space', () => {
    // A generated floor tiles the envelope, and addRoom looked only for free
    // floor: every room added after the first layout was refused, stairs included.
    const level = generated().level;
    expect(level.freeCells().size, 'meaningless with floor to spare').toBe(0);
    const before = level.rooms.size;
    const added = level.addRoom('storage', null, 2.0);
    expect(level.rooms.size).toBe(before + 1);
    expect(level.cellsOf(added.id).size).toBeGreaterThan(0);
    expect(added.taken_from, 'it should say whose floor it took').toBeTruthy();
  });

  test('carving a new room leaves the donor valid', () => {
    const level = generated().level;
    const added = level.addRoom('wc', null, 1.6);
    for (const room of level.rooms.values()) level.validateRoom(room.id, level.cellsOf(room.id));
    expect(level.cellsOf(added.id).size).toBeGreaterThan(0);
  });

  test('a floor with nothing to spare refuses and says why', () => {
    const hm = home(400, 400);
    hm.level.addRoom('living', null, 11);
    expect(() => { for (let i = 0; i < 6; i++) hm.level.addRoom('bedroom', null, 7); }).toThrow(/already at its minimum|nowhere to put/);
  });

  test('adding an upper floor puts the stairs in on both', () => {
    const hm = generated();
    const upper = hm.addLevel();
    const ground = stairsCells(hm.levels[0]), up = stairsCells(upper);
    expect(ground.size, 'no stairs downstairs').toBeGreaterThan(0);
    expect(up.size, 'no stairs upstairs').toBeGreaterThan(0);
    expect(sortedCells(up), 'the two flights are not in the same place').toEqual(sortedCells(ground));
    expect(hm.stairsAligned()).toBe(true);
  });

  test('undo does not move you to another floor', () => {
    // Pressed upstairs, undo threw the client back to the ground floor and
    // reverted something they could no longer see.
    const hm = generated();
    hm.addLevel();
    hm.goToLevel('upper');
    const snap = hm.capture();
    hm.level.addRoom('bedroom', null, 10);
    hm.restore(snap);
    expect(hm.active).toBe(1);
  });

  test('marking one wall structural does not freeze the others', () => {
    // Keyed by (axis, line), one mark froze every collinear wall on the floor.
    const level = generated().level;
    const [a, b] = adjacentPair(level);
    level.markStructural(a, b);
    for (const p of level.rooms.values()) {
      for (const q of level.rooms.values()) {
        if (p.id >= q.id) continue;
        if (new Set([p.id, q.id, a.id, b.id]).size === 2) continue;
        if (!sharedEdge(level.cellsOf(p.id), level.cellsOf(q.id))) continue;
        // Some pairs refuse for their own reasons; what must never happen is
        // refusing BECAUSE of the other wall.
        try {
          level.moveWall(p, q, 10);
        } catch (err) {
          expect(String((err as Error).message), `${p.name}/${q.name} froze`).not.toContain('holding the building up');
        }
      }
    }
  });

  test('a load-bearing wall cannot be knocked out either', () => {
    // Refusing to MOVE a structural wall while allowing it to be deleted was
    // the wrong way round.
    const level = generated().level;
    const [a, b] = adjacentPair(level);
    level.markStructural(a, b);
    expect(() => level.mergeRooms(a, b)).toThrow(/holding the building up/);
  });

  test('a spoken room name prefers the closest match', () => {
    // "second bedroom" matched "Main bedroom" (both contain "bedroom"), so a
    // client asking for floor for the small bedroom was told, correctly for the
    // WRONG room, that it shares no wall with the hall.
    const level = home(1200, 900).level;
    level.addRoom('bedroom', 'Main bedroom', 14, 'west_wall');
    level.addRoom('bedroom', 'Second bedroom', 10, 'east_wall');
    expect(level.findRoom('Second bedroom').name).toBe('Second bedroom');
    expect(level.findRoom('second bedroom').name).toBe('Second bedroom');
    expect(level.findRoom('Main bedroom').name).toBe('Main bedroom');
  });

  test('a ground floor that already has stairs still connects upstairs', () => {
    // Guarding the whole block on "are there stairs yet" was backwards.
    const hm = home(1000, 800);
    hm.level.addRoom('stairs', null, 4);
    const upper = hm.addLevel();
    expect([...upper.rooms.values()].some((r) => r.kind === 'stairs')).toBe(true);
    expect(hm.stairsAligned()).toBe(true);
  });

  test('stairs survive a floor being removed and added again', () => {
    const hm = generated();
    hm.addLevel();
    hm.removeLevel();
    const upper = hm.addLevel();
    expect([...upper.rooms.values()].some((r) => r.kind === 'stairs')).toBe(true);
    expect(hm.stairsAligned()).toBe(true);
  });

  test('merging carries the structural marks with it', () => {
    // A load-bearing wall between the absorbed room and a third neighbour, left
    // keyed by the room that no longer exists, quietly became movable again.
    const level = generated().level;
    let trio: [Room, Room, Room] | null = null;
    outer: for (const a of level.rooms.values()) {
      for (const b of level.rooms.values()) {
        for (const c of level.rooms.values()) {
          if (new Set([a.id, b.id, c.id]).size !== 3) continue;
          if (!sharedEdge(level.cellsOf(a.id), level.cellsOf(b.id))) continue;
          if (!sharedEdge(level.cellsOf(b.id), level.cellsOf(c.id))) continue;
          trio = [a, b, c];
          break outer;
        }
      }
    }
    expect(trio).not.toBeNull();
    const [a, b, c] = trio!;
    level.markStructural(b, c);   // b's wall with c is load-bearing
    let merged = true;
    try {
      level.mergeRooms(a, b);     // b is absorbed into a
    } catch (err) {
      if (!(err instanceof PlanError)) throw err;
      merged = false;
    }
    if (merged) expect(level.isStructural(a, c), 'the load-bearing wall stopped being load-bearing').toBe(true);
  });

  test('a refused change of use leaves the room being what it was', () => {
    // "I set the store to Living room, she said it was too small, and the
    // schedule called it a living room from then on."
    const level = home(1200, 900).level;
    level.placeRoom('living', [0, 0, 600, 500], 'Living room');
    const store = level.placeRoom('storage', [600, 0, 800, 200], 'Store');
    expect(() => level.renameRoom(store, null, 'living')).toThrow(/too small/);
    expect(store.kind).toBe('storage');
    expect(level.rooms.get(store.id)!.kind).toBe('storage');
  });

  test('a refused swap leaves both rooms called what they were', () => {
    const level = home(1200, 900).level;
    const living = level.placeRoom('living', [0, 0, 600, 500], 'Living room');
    const store = level.placeRoom('storage', [600, 0, 800, 200], 'Store');
    expect(() => level.swapRooms(living, store)).toThrow(PlanError);
    expect([living.name, living.kind]).toEqual(['Living room', 'living']);
    expect([store.name, store.kind]).toEqual(['Store', 'storage']);
  });

  test('a refused merge leaves the doors and the marks alone', () => {
    // The survivor can fail its own minimum width once it inherits a neck: a
    // living room wants 260 cm across; a corridor is 110.
    const level = home(1200, 900).level;
    const living = level.placeRoom('living', [0, 0, 600, 500], 'Living room');
    // A tab, not a full-width band: stacked rectangles of equal width merge
    // into a plain rectangle and nothing is refused.
    const corridor = level.placeRoom('corridor', [0, 500, 200, 610], 'Corridor');
    level.addDoor(living, corridor);
    level.addFrontDoor(corridor, 'west');
    const openingsBefore = level.openings.map((o) => [o.id, o.a, o.b, o.swing_into]);
    const ownerBefore = new Map(level.owner);
    expect(() => level.mergeRooms(living, corridor)).toThrow(PlanError);
    expect(level.owner, 'the floor moved on a refused merge').toEqual(ownerBefore);
    expect(level.openings.map((o) => [o.id, o.a, o.b, o.swing_into]), 'a refused merge rewrote the doors').toEqual(openingsBefore);
    expect(level.rooms.has(corridor.id), 'a refused merge deleted the room anyway').toBe(true);
  });

  test('a refused merge keeps the structural marks keyed to real rooms', () => {
    // The mark has to involve the room being ABSORBED to exercise the remap.
    const level = home(1200, 900).level;
    const living = level.placeRoom('living', [0, 0, 600, 500], 'Living room');
    const corridor = level.placeRoom('corridor', [0, 500, 200, 610], 'Corridor');
    const landing = level.placeRoom('hall', [200, 500, 600, 610], 'Landing');
    expect(sharedEdge(level.cellsOf(corridor.id), level.cellsOf(landing.id))).not.toBeNull();
    level.markStructural(corridor, landing);
    const before = new Set(level.structural);
    expect(() => level.mergeRooms(living, corridor)).toThrow(PlanError);
    expect(level.structural).toEqual(before);
    expect(level.isStructural(corridor, landing)).toBe(true);
  });
});

test('a trade moves floor towards the room named to receive it', () => {
  const level = home(800, 600).level;
  const study = level.placeRoom('office', [0, 0, 400, 600], 'Study');
  const living = level.placeRoom('living', [400, 0, 800, 600], 'Living room');
  const [taker, giver] = level.tradeArea('study', 'living room', 1.2);
  expect(taker.id).toBe(living.id);
  expect(giver.id).toBe(study.id);
  expect(areaM2(level.cellsOf(living.id))).toBe(25.2);
  expect(areaM2(level.cellsOf(study.id))).toBe(22.8);
  expect(level.cellsOf(study.id).has(cell(39, 0))).toBe(false);
});
