// The generator: does a brief become a floor a person could live on? (Ported
// from test_generate.py.) The property that matters is that the output is a
// PARTITION: a slicing tree cannot express a gap or an overlap, and these hold
// that claim to the actual output rather than to the prose about it.
import { describe, expect, test } from 'vitest';
import { article, briefFor, generate, Slot, sliceRect, TYPOLOGIES, typology } from './generate.ts';
import { CELL_CM, colOf, rectCells, rowOf, type Cell } from './geom.ts';
import { Home, PlanError } from './home.ts';

const floor = (w = 1000, h = 800) => new Home(w, h);
const sorted = (cells: Iterable<Cell>) => [...cells].sort((a, b) => a - b);

describe('the slicing tree', () => {
  test('slices tile the rectangle exactly', () => {
    const pieces = sliceRect([0, 0, 1000, 800], [['a', 3.0], ['b', 2.0], ['c', 1.0], ['d', 1.5]]);
    const covered = new Set<Cell>();
    for (const [, rect] of pieces) {
      for (const k of rectCells(rect)) {
        expect(covered.has(k), 'two slices claim the same floor').toBe(false);
        covered.add(k);
      }
    }
    expect(sorted(covered)).toEqual(sorted(rectCells([0, 0, 1000, 800])));
  });

  test('slices are proportional to their weights', () => {
    const pieces = new Map(sliceRect([0, 0, 1000, 1000], [['big', 3.0], ['small', 1.0]]));
    const area = ([x0, y0, x1, y1]: number[]) => (x1 - x0) * (y1 - y0);
    expect(area(pieces.get('big')!)).toBeGreaterThan(area(pieces.get('small')!) * 2);
  });

  test('every slice keeps at least a cell', () => {
    // A weight of nearly nothing must not produce a zero-width room; the cut is
    // clamped, and the room then fails validation loudly instead.
    for (const [, [x0, y0, x1, y1]] of sliceRect([0, 0, 400, 400], [['a', 1000.0], ['b', 0.0001]])) {
      expect(x1 - x0).toBeGreaterThanOrEqual(CELL_CM);
      expect(y1 - y0).toBeGreaterThanOrEqual(CELL_CM);
    }
  });
});

describe('the floor', () => {
  test.each(TYPOLOGIES.map((t) => t.key))('a generated floor is a partition (%s)', (style) => {
    const home = floor();
    generate(home.level, briefFor(2, { office: true }), { style });
    const level = home.level;
    const seen = new Set<Cell>();
    for (const room of level.rooms.values()) {
      const cells = level.cellsOf(room.id);
      expect(cells.size, `${room.name} got no floor`).toBeGreaterThan(0);
      for (const k of cells) {
        expect(seen.has(k), `${room.name} overlaps another room`).toBe(false);
        seen.add(k);
      }
    }
    expect(sorted(seen), 'the generated floor left a gap').toEqual(sorted(level.allCells()));
  });

  test.each(TYPOLOGIES.map((t) => t.key))('every generated room survives its own validation (%s)', (style) => {
    // The generator writes through commit, so this asserts it never produces a
    // room the client would have been refused for asking for.
    const home = floor();
    generate(home.level, briefFor(2, { dining: true }), { style });
    for (const room of home.level.rooms.values()) home.level.validateRoom(room.id, home.level.cellsOf(room.id));
  });

  test('every room has a door', () => {
    const home = floor();
    generate(home.level, briefFor(2, { office: true }));
    const level = home.level;
    for (const room of level.rooms.values()) {
      const doors = level.openings.filter((o) => o.kind === 'door' && (o.a === room.id || o.b === room.id));
      expect(doors.length, `${room.name} has no way in`).toBeGreaterThan(0);
    }
  });

  test('habitable rooms get a window where a wall allows one', () => {
    const home = floor();
    generate(home.level, briefFor(2));
    const level = home.level;
    for (const room of level.rooms.values()) {
      if (!room.spec.habitable) continue;
      const windows = level.openings.filter((o) => o.kind === 'window' && (o.a === room.id || o.b === room.id));
      const touchesOutside = [...level.cellsOf(room.id)].some((k) => colOf(k) === 0 || rowOf(k) === 0 || colOf(k) === level.cols - 1 || rowOf(k) === level.rows - 1);
      if (touchesOutside) expect(windows.length, `${room.name} touches an outside wall but has no window`).toBeGreaterThan(0);
    }
  });

  test('a brief too big for the floor is refused by name', () => {
    const home = floor(400, 400);   // 16 m²
    // The refusal has to name what would not fit; "it didn't work" leaves the
    // client with nothing to decide.
    expect(() => generate(home.level, briefFor(3, { office: true, dining: true, ensuite: true }))).toThrow(/bedroom|living|kitchen|bathroom/i);
  });

  test('regenerating replaces rather than accumulates', () => {
    const home = floor();
    generate(home.level, briefFor(2));
    const first = home.level.rooms.size;
    generate(home.level, briefFor(2));
    expect(home.level.rooms.size).toBe(first);
  });

  test('a small floor skips the corridor', () => {
    // On a small floor a hall is dead area, and rooms opening off each other is
    // what a studio actually is.
    const home = floor(500, 500);   // 25 m², under the corridor threshold
    generate(home.level, [new Slot('living'), new Slot('kitchen'), new Slot('bathroom')]);
    expect([...home.level.rooms.values()].filter((r) => r.kind === 'hall')).toEqual([]);
  });

  test('typology falls back rather than throwing', () => {
    expect(typology('nonsense').key).toBe(TYPOLOGIES[0].key);
  });
});

describe('what user testing found', () => {
  test('an upstairs brief is bedrooms, not a second house', () => {
    // Asked for three bedrooms upstairs, it drew a second kitchen and a second
    // living room on the bedroom floor.
    const kinds = briefFor(3, { upstairs: true }).map((slot) => slot.kind);
    expect(kinds).not.toContain('kitchen');
    expect(kinds).not.toContain('living');
    expect(kinds).not.toContain('entry');
    expect(kinds.filter((k) => k === 'bedroom' || k === 'bedroom_single')).toHaveLength(3);
    expect(kinds).toContain('bathroom');
  });

  test('an upstairs layout always gets stairs', () => {
    // A partition that had never heard of the stairs left them out entirely.
    // Whether they line up is then a visible problem rather than a missing room.
    const home = floor(1000, 800);
    generate(home.level, briefFor(2, { upstairs: true }), { reserve: [0, 0, 200, 180] });
    const stairs = [...home.level.rooms.values()].filter((r) => r.kind === 'stairs');
    expect(stairs.length, 'an upper floor was laid out with no way up to it').toBeGreaterThan(0);
    expect(home.level.cellsOf(stairs[0].id).size).toBeGreaterThan(0);
  });

  test('a refused brief leaves the floor that was already drawn', () => {
    // "She said the five-bed wouldn't fit, and my whole plan vanished."
    const home = floor(900, 700);
    generate(home.level, briefFor(2));
    const roomsBefore = [...home.level.rooms].map(([id, r]) => [id, r.name, r.kind]);
    const ownerBefore = new Map(home.level.owner);
    const openingsBefore = home.level.openings.map((o) => o.id);
    expect(roomsBefore.length && openingsBefore.length, 'this test needs a drawn floor').toBeTruthy();
    expect(() => generate(home.level, briefFor(5, { office: true, dining: true, ensuite: true, wc: true, utility: true }))).toThrow(PlanError);
    expect([...home.level.rooms].map(([id, r]) => [id, r.name, r.kind])).toEqual(roomsBefore);
    expect(home.level.owner).toEqual(ownerBefore);
    expect(home.level.openings.map((o) => o.id)).toEqual(openingsBefore);
  });

  test('stairs take no article', () => {
    expect(article('Stairs')).toBe('stairs');
    expect(article('Bathroom')).toBe('a bathroom');
    expect(article('En suite')).toBe('an en suite');
  });
});
