// The planner: reducer refusals, undo, schemes, the sheet and the critic
// (ported from test_table.py; the note, persona and tool tests moved to
// director.test.ts and judge.test.ts with the parts they test).
import { describe, expect, test } from 'vitest';
import { issues } from './compliance.ts';
import { sharedEdge } from './geom.ts';
import { MAX_ITEMS_PER_LEVEL, MAX_ROOMS_PER_LEVEL, PlanError } from './home.ts';
import { Critic, NOTHING_TO_UNDO, Planner } from './planner.ts';
import type { ApplyResult, Intent } from './types.ts';

const applied = (r: ApplyResult) => {
  if (!r.applied) throw new Error(`refused: ${r.reason}`);
  return r;
};
const refused = (r: ApplyResult) => {
  if (r.applied) throw new Error(`applied: ${r.done.label}`);
  return r.reason;
};

describe('the reducer', () => {
  test('every intent reaches the home', () => {
    const p = new Planner();
    applied(p.apply({ kind: 'generate', bedrooms: 2, office: true }));
    const bedroom = [...p.home.level.rooms.values()].find((r) => r.kind.startsWith('bedroom'))!;
    for (const intent of [
      { kind: 'add_item', type: 'queen bed', room: bedroom.id },
      { kind: 'set_unit', unit: 'ft2' },
      { kind: 'save_scheme', name: 'First' },
      { kind: 'compare_scheme', name: 'First' },
      { kind: 'add_level' },
      { kind: 'go_to_level', id: 'ground' },
      { kind: 'clear' },
    ]) applied(p.apply(intent));
    expect(p.home.level.rooms.size).toBe(0);
  });

  test('a domain refusal arrives as a reason the user can hear', () => {
    const p = new Planner();
    const cases: [Intent, string][] = [
      [{ kind: 'set_envelope', w: 100, h: 100 }, 'two and twenty metres'],
      [{ kind: 'add_item', type: 'chaise longue' }, 'in my kit'],
      [{ kind: 'move_item', id: 'i9', x: 0, y: 0 }, "can't find that piece"],
      [{ kind: 'rotate_item', id: 'i9', deg: 45 }, "can't find that piece"],
      [{ kind: 'remove_room', id: 'nowhere' }, 'no nowhere on this floor'],
      [{ kind: 'clear' }, 'already empty'],
    ];
    for (const [intent, fragment] of cases) expect(refused(p.apply(intent)), JSON.stringify(intent)).toContain(fragment);
    expect(p.home.level.w_cm, 'a refused intent must leave the plan untouched').toBe(900);
  });

  test('an unknown intent is refused rather than ignored', () => {
    expect(refused(new Planner().apply({ kind: 'paint_it_blue' }))).toContain('floor plan');
  });

  test('a refused intent changes nothing on screen', () => {
    const p = new Planner();
    applied(p.apply({ kind: 'generate', bedrooms: 1 }));
    const before = JSON.stringify(p.snapshot());
    refused(p.apply({ kind: 'add_item', type: 'hovercraft' }));
    expect(JSON.stringify(p.snapshot())).toBe(before);
  });

  test('an accepted intent hands back the whole plan', () => {
    const r = applied(new Planner().apply({ kind: 'generate', bedrooms: 1 }));
    expect(r.snapshot.level.rooms.length).toBeGreaterThan(0);
    expect(r.done.typology?.label).toBe('Day end, night end');
  });

  test('rooms travel as rectangles, not cells', () => {
    // A 4 x 3 m room is one rectangle and four segments, where its 1,200 cells
    // would swamp everything else the page draws.
    const p = new Planner();
    applied(p.apply({ kind: 'generate', bedrooms: 2 }));
    for (const room of p.snapshot().level.rooms) {
      expect(room.rects.length).toBeLessThanOrEqual(4);
      expect(room.edges.length).toBeLessThanOrEqual(16);
    }
  });

  test('a spoken room name reaches the right room', () => {
    const p = new Planner();
    applied(p.apply({ kind: 'generate', bedrooms: 2 }));
    const r = applied(p.apply({ kind: 'rename_room', id: 'kitchen', name: 'Galley' }));
    expect([...p.home.level.rooms.values()].some((room) => room.name === 'Galley')).toBe(true);
    expect(r.done.was).toBe('Kitchen');
  });

  test('trade_area moves floor in the direction it was asked', () => {
    // Found live: the model called this with the rooms the other way round and
    // the study SHRANK when the client had just asked for it to grow. No
    // "if applied" guard: a version that skipped itself on a refusal is
    // exactly what hid the problem.
    const p = new Planner(1000, 800);
    applied(p.apply({ kind: 'generate', bedrooms: 2 }));
    const level = p.home.level;
    for (const a of [...level.rooms.values()]) {
      for (const b of [...level.rooms.values()]) {
        if (a.id >= b.id || !sharedEdge(level.cellsOf(a.id), level.cellsOf(b.id))) continue;
        const giver = level.cellsOf(a.id).size, taker = level.cellsOf(b.id).size;
        const r = p.apply({ kind: 'trade_area', from: a.id, to: b.id, m2: 1.0 });
        if (!r.applied) continue;
        expect(level.cellsOf(b.id).size, 'give_to did not grow').toBeGreaterThan(taker);
        expect(level.cellsOf(a.id).size, 'take_from did not shrink').toBeLessThan(giver);
        expect(r.done.rooms!.map((room) => room.id)).toEqual([b.id, a.id]);
        expect(r.done.moved_m2).toBeGreaterThan(0);
        return;
      }
    }
    throw new Error('no pair on a generated floor could trade area');
  });

  test('a crash inside an operator becomes a refusal and leaves the plan alone', () => {
    const p = new Planner();
    applied(p.apply({ kind: 'generate', bedrooms: 1 }));
    const before = JSON.stringify(p.snapshot().level);
    const original = p.home.level.addRoom;
    p.home.level.addRoom = () => { throw new TypeError('boom'); };
    const quiet = console.error;
    console.error = () => {};
    try {
      expect(refused(p.apply({ kind: 'add_room', room_kind: 'study' }))).toContain("didn't take that");
    } finally {
      console.error = quiet;
      p.home.level.addRoom = original;
    }
    expect(JSON.stringify(p.snapshot().level)).toBe(before);
  });

  test('a brief with the size of the place is one step, even when the floor shrinks', () => {
    // Resizing first as its own step refused any shrink ("it would cut into
    // the kitchen") and the layout then went ahead at the old size.
    const p = new Planner(1200, 900);
    applied(p.apply({ kind: 'generate', bedrooms: 3 }));
    const done = applied(p.apply({ kind: 'generate', bedrooms: 1, w: 700, h: 600 })).done;
    expect(done.size).toEqual({ w_cm: 700, h_cm: 600 });
    expect([p.home.level.w_cm, p.home.level.h_cm]).toEqual([700, 600]);
    applied(p.apply({ kind: 'undo' }));
    expect([p.home.level.w_cm, p.home.level.h_cm]).toEqual([1200, 900]);
    expect([...p.home.level.rooms.values()].filter((r) => r.kind.startsWith('bedroom')).length).toBe(3);
  });

  test('a brief at a size that cannot hold it is refused and leaves the plan as it was', () => {
    const p = new Planner();
    applied(p.apply({ kind: 'generate', bedrooms: 2 }));
    const before = JSON.stringify(p.snapshot().level);
    refused(p.apply({ kind: 'generate', bedrooms: 5, office: true, dining: true, w: 300, h: 300 }));
    expect(JSON.stringify(p.snapshot().level)).toBe(before);
  });
});

describe('schemes', () => {
  test('a saved scheme survives the plan changing under it', () => {
    const p = new Planner();
    applied(p.apply({ kind: 'generate', bedrooms: 2 }));
    applied(p.apply({ kind: 'save_scheme', name: 'Two bed' }));
    const before = p.schemes.find('Two bed').rooms;
    applied(p.apply({ kind: 'generate', bedrooms: 1, style: 'compact' }));
    expect(p.schemes.find('Two bed').rooms, 'the scheme moved with the plan').toBe(before);
    applied(p.apply({ kind: 'load_scheme', name: 'Two bed' }));
    expect(p.home.level.rooms.size).toBe(before);
  });

  test('a fourth scheme is refused rather than dropping the oldest', () => {
    const p = new Planner();
    applied(p.apply({ kind: 'generate', bedrooms: 1 }));
    for (const name of ['A', 'B', 'C']) applied(p.apply({ kind: 'save_scheme', name }));
    expect(refused(p.apply({ kind: 'save_scheme', name: 'D' }))).toContain('3 schemes already');
    expect([...p.schemes.saved.keys()]).toEqual(['A', 'B', 'C']);
  });

  test('comparing shows the room-by-room difference', () => {
    const p = new Planner(1000, 800);
    applied(p.apply({ kind: 'generate', bedrooms: 2 }));
    applied(p.apply({ kind: 'save_scheme', name: 'First' }));
    applied(p.apply({ kind: 'generate', bedrooms: 2, style: 'compact' }));
    applied(p.apply({ kind: 'compare_scheme', name: 'First' }));
    const comparing = p.snapshot().comparing;
    expect(comparing?.name).toBe('First');
    expect(comparing!.deltas.length, 'a different layout must show some difference').toBeGreaterThan(0);
    expect(comparing!.thumb!.rooms.length).toBeGreaterThan(0);
    applied(p.apply({ kind: 'compare_scheme', name: 'off' }));
    expect(p.snapshot().comparing).toBeUndefined();
  });

  test('comparing never disturbs the live plan', () => {
    const p = new Planner();
    applied(p.apply({ kind: 'generate', bedrooms: 2 }));
    applied(p.apply({ kind: 'save_scheme', name: 'First' }));
    applied(p.apply({ kind: 'generate', bedrooms: 1, style: 'compact' }));
    const before = [...p.home.level.rooms].map(([id, r]) => [id, r.name]);
    applied(p.apply({ kind: 'compare_scheme', name: 'First' }));
    expect([...p.home.level.rooms].map(([id, r]) => [id, r.name])).toEqual(before);
  });

  test('a loaded scheme is not edited by later changes', () => {
    const p = new Planner();
    applied(p.apply({ kind: 'generate', bedrooms: 2 }));
    applied(p.apply({ kind: 'save_scheme', name: 'A' }));
    applied(p.apply({ kind: 'load_scheme', name: 'A' }));
    applied(p.apply({ kind: 'rename_room', id: 'kitchen', name: 'Galley' }));
    applied(p.apply({ kind: 'load_scheme', name: 'A' }));
    expect([...p.home.level.rooms.values()].some((r) => r.name === 'Kitchen')).toBe(true);
  });
});

describe('undo', () => {
  test('undo puts a removed room back', () => {
    const p = new Planner();
    applied(p.apply({ kind: 'generate', bedrooms: 2 }));
    const before = p.home.level.rooms.size;
    const victim = [...p.home.level.rooms.values()][0];
    applied(p.apply({ kind: 'remove_room', id: victim.id }));
    expect(p.home.level.rooms.size).toBe(before - 1);
    const r = applied(p.apply({ kind: 'undo' }));
    expect(p.home.level.rooms.size).toBe(before);
    expect(r.done.undone).toBe(`removed the ${victim.name.toLowerCase()}`);
  });

  test('undo takes back a wall drag to the exact centimetre', () => {
    const p = new Planner(1000, 800);
    applied(p.apply({ kind: 'generate', bedrooms: 2 }));
    const level = p.home.level;
    for (const a of level.rooms.values()) {
      for (const b of level.rooms.values()) {
        if (a.id >= b.id || !sharedEdge(level.cellsOf(a.id), level.cellsOf(b.id))) continue;
        const before = p.home.level.cellsOf(a.id).size;
        if (!p.apply({ kind: 'move_wall', a: a.id, b: b.id, delta: 10 }).applied) continue;
        applied(p.apply({ kind: 'undo' }));
        expect(p.home.level.cellsOf(a.id).size).toBe(before);
        return;
      }
    }
    throw new Error('no movable wall on a generated floor');
  });

  test('undo steps back one change at a time', () => {
    const p = new Planner();
    applied(p.apply({ kind: 'generate', bedrooms: 2 }));
    const roomId = [...p.home.level.rooms.keys()][0];
    for (const piece of ['plant', 'armchair', 'stool']) applied(p.apply({ kind: 'add_item', type: piece, room: roomId }));
    expect(p.home.level.items).toHaveLength(3);
    applied(p.apply({ kind: 'undo' }));
    expect(p.home.level.items).toHaveLength(2);
    applied(p.apply({ kind: 'undo' }));
    expect(p.home.level.items).toHaveLength(1);
  });

  test('undo on an untouched plan says so rather than doing nothing', () => {
    expect(refused(new Planner().apply({ kind: 'undo' }))).toBe(NOTHING_TO_UNDO);
  });

  test('a refused change does not become an undo step', () => {
    // Otherwise the first Undo after a refusal silently does nothing, and the
    // client presses it again and loses a change they wanted.
    const p = new Planner();
    applied(p.apply({ kind: 'generate', bedrooms: 1 }));
    refused(p.apply({ kind: 'add_item', type: 'hovercraft' }));
    applied(p.apply({ kind: 'undo' }));
    expect(p.home.level.rooms.size).toBe(0);
  });

  test('selecting is not a change worth undoing', () => {
    const p = new Planner();
    applied(p.apply({ kind: 'generate', bedrooms: 1 }));
    const first = [...p.home.level.rooms.keys()][0];
    applied(p.apply({ kind: 'select', id: first }));
    applied(p.apply({ kind: 'select', id: null }));
    applied(p.apply({ kind: 'undo' }));
    expect(p.home.level.rooms.size, 'undo spent itself on a highlight').toBe(0);
  });

  test('switching floors is not a change worth undoing', () => {
    const p = new Planner();
    applied(p.apply({ kind: 'generate', bedrooms: 1 }));
    applied(p.apply({ kind: 'add_level' }));
    applied(p.apply({ kind: 'go_to_level', id: 'ground' }));
    applied(p.apply({ kind: 'go_to_level', id: 'upper' }));
    applied(p.apply({ kind: 'undo' }));
    expect(p.home.levels, 'undo spent itself on looking at a floor').toHaveLength(1);
  });

  test('saving a scheme does not swallow the next undo', () => {
    // "I saved it, pressed undo, and she said she'd rolled it back; the
    // armchair was still there." Saving changes the scheme list, which a
    // capture does not hold, so the step it pushed restored nothing.
    const p = new Planner();
    applied(p.apply({ kind: 'generate', bedrooms: 2 }));
    const roomId = [...p.home.level.rooms.keys()][0];
    applied(p.apply({ kind: 'add_item', type: 'armchair', room: roomId }));
    applied(p.apply({ kind: 'save_scheme', name: 'A' }));
    applied(p.apply({ kind: 'undo' }));
    expect(p.home.level.items, 'undo spent itself on saving a scheme').toEqual([]);
    expect(p.schemes.saved.has('A'), 'undo is for the plan, not the scheme list').toBe(true);
  });

  test('the page is told whether there is anything to undo, and what it was', () => {
    // An Undo button that is always lit and sometimes refuses is worse than one that greys out.
    const p = new Planner();
    expect(p.snapshot().can_undo).toBe(false);
    const r = applied(p.apply({ kind: 'generate', bedrooms: 1 }));
    expect(r.snapshot.can_undo).toBe(true);
    expect(r.snapshot.last_change).toBe('laid out the ground floor (day end, night end)');
    expect(applied(p.apply({ kind: 'undo' })).snapshot.can_undo).toBe(false);
  });

  test('undo reaches back thirty changes and no further', () => {
    const p = new Planner();
    applied(p.apply({ kind: 'generate', bedrooms: 1 }));
    const living = [...p.home.level.rooms.values()].find((r) => r.kind === 'living')!.id;
    for (let i = 0; i < 31; i++) applied(p.apply({ kind: 'rename_room', id: living, name: `Living ${i}` }));
    let steps = 0;
    while (p.apply({ kind: 'undo' }).applied) steps++;
    expect(steps).toBe(30);
    expect(p.home.level.rooms.size, 'the oldest steps fell off the end').toBeGreaterThan(0);
  });
});

describe('the drawing sheet', () => {
  test('a sheet with nothing to draw is refused, not left hanging', () => {
    const p = new Planner();
    expect(refused(p.apply({ kind: 'draw_sheet' }))).toContain('nothing on this floor');
    expect(p.snapshot().sheet, 'left showing a sheet').toBeUndefined();
  });

  test('a sheet is drawn at once, ready to show and to download', () => {
    const p = new Planner();
    applied(p.apply({ kind: 'generate', bedrooms: 2 }));
    const r = applied(p.apply({ kind: 'draw_sheet' }));
    expect(r.snapshot.sheet?.status).toBe('ready');
    expect(r.snapshot.sheet?.svg).toMatch(/^<svg /);
    expect(p.canUndo() && r.snapshot.last_change, 'drawing the sheet is not a change to the plan').toContain('laid out');
  });
});

describe('the critic', () => {
  const look = (critic: Critic, p: Planner) => critic.look(issues(p.home), { hasRooms: p.home.level.rooms.size > 0 });

  test('it speaks once about a newly broken plan', () => {
    const p = new Planner();
    const critic = new Critic();
    applied(p.apply({ kind: 'generate', bedrooms: 2 }));
    look(critic, p);
    // Take the door off a room: it becomes unreachable, the worst thing a floor plan can be.
    const level = p.home.level;
    const victim = [...level.rooms.values()].find((r) => !r.spec.circulation)!;
    const door = level.openings.find((o) => o.kind === 'door' && (o.a === victim.id || o.b === victim.id))!;
    applied(p.apply({ kind: 'remove_opening', id: door.id }));
    const fresh = look(critic, p);
    expect(fresh.some((i) => i.room === victim.id), 'a room with no way in must be mentioned').toBe(true);
    applied(p.apply({ kind: 'set_unit', unit: 'ft2' }));
    expect(look(critic, p), 'an unrelated change re-said the complaint').toEqual([]);
  });

  test('it says nothing about a clean plan', () => {
    const p = new Planner();
    const critic = new Critic();
    applied(p.apply({ kind: 'generate', bedrooms: 1 }));
    expect(look(critic, p).every((i) => !i.note.includes('no way into'))).toBe(true);
  });

  test('an empty floor has nothing to critique', () => {
    // Resizing a blank floor used to earn "63 square metres isn't in any room".
    const p = new Planner();
    const critic = new Critic();
    applied(p.apply({ kind: 'set_envelope', w: 800, h: 700 }));
    expect(look(critic, p)).toEqual([]);
  });

  test('a complaint that went away and came back is said again', () => {
    const p = new Planner();
    const critic = new Critic();
    applied(p.apply({ kind: 'generate', bedrooms: 2 }));
    look(critic, p);
    const level = p.home.level;
    const victim = [...level.rooms.values()].find((r) => !r.spec.circulation)!;
    const door = level.openings.find((o) => o.kind === 'door' && (o.a === victim.id || o.b === victim.id))!;
    applied(p.apply({ kind: 'remove_opening', id: door.id }));
    expect(look(critic, p).length).toBeGreaterThan(0);
    applied(p.apply({ kind: 'undo' }));
    look(critic, p);
    applied(p.apply({ kind: 'remove_opening', id: door.id }));
    expect(look(critic, p).length).toBeGreaterThan(0);
  });
});

describe('at the limits', () => {
  test('a floor at every cap still produces a snapshot', () => {
    const p = new Planner(1200, 1000);
    const level = p.home.level;
    applied(p.apply({ kind: 'generate', bedrooms: 4, office: true, dining: true, ensuite: true, wc: true }));
    while (level.rooms.size < MAX_ROOMS_PER_LEVEL) {
      try {
        level.addRoom('storage');
      } catch (err) {
        if (!(err instanceof PlanError)) throw err;
        break;
      }
    }
    for (const room of [...level.rooms.values()]) {
      for (const piece of ['queen bed', 'wardrobe', 'armchair', 'plant', 'stool', 'desk']) {
        if (level.items.length >= MAX_ITEMS_PER_LEVEL) break;
        try {
          level.addItem(piece, room);
        } catch (err) {
          if (!(err instanceof PlanError)) throw err;
        }
      }
    }
    expect(level.rooms.size).toBe(MAX_ROOMS_PER_LEVEL);
    expect(level.items).toHaveLength(MAX_ITEMS_PER_LEVEL);
    expect(refused(p.apply({ kind: 'add_item', type: 'plant' }))).toContain('full at 40');
    expect(refused(p.apply({ kind: 'add_room', room_kind: 'wc' }))).toContain('as many rooms as one floor holds');
  });
});
