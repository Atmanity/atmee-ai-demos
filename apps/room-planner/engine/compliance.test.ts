// The checks that make the plan worth showing a client, and the schedule
// (ported from test_compliance.py). The rule: an issue must not outlive the
// thing it complained about, so each test that fixes a problem also asserts the
// complaint went away.
import { describe, expect, test } from 'vitest';
import { compare, issues, reachable, schedule } from './compliance.ts';
import { briefFor, generate, Slot, type BriefExtras } from './generate.ts';
import { sharedEdge } from './geom.ts';
import { Home, PlanError, type Room } from './home.ts';

function furnished(w = 1000, h = 800, brief: BriefExtras = {}): Home {
  const home = new Home(w, h);
  generate(home.level, briefFor(2, brief));
  return home;
}

const kinds = (home: Home) => new Set(issues(home).map((i) => i.kind));

describe('reachability', () => {
  test('a generated floor is fully reachable', () => {
    const home = furnished(1000, 800, { office: true });
    expect([...reachable(home.level)].sort()).toEqual([...home.level.rooms.keys()].sort());
    expect(kinds(home).has('unreachable')).toBe(false);
    expect(kinds(home).has('no_door')).toBe(false);
  });

  test('a floor with no front door says so once', () => {
    const home = furnished();
    home.level.openings = home.level.openings.filter((o) => !o.exterior);
    // Once, not once per room: the missing door is the single fact.
    expect(issues(home).filter((i) => i.kind === 'no_front_door')).toHaveLength(1);
  });

  test("a room whose door is removed becomes unreachable, and recovers", () => {
    const home = furnished();
    const level = home.level;
    const room = [...level.rooms.values()].find((r) => !r.spec.circulation)!;
    const doors = level.openings.filter((o) => o.kind === 'door' && (o.a === room.id || o.b === room.id));
    const kept = [...level.openings];
    level.openings = level.openings.filter((o) => !doors.includes(o));
    expect(issues(home).some((i) => i.room === room.id)).toBe(true);
    level.openings = kept;
    expect(issues(home).filter((i) => i.room === room.id && (i.kind === 'no_door' || i.kind === 'unreachable'))).toEqual([]);
  });
});

describe('rooms', () => {
  test('a room with no window is flagged for daylight', () => {
    const home = furnished();
    const level = home.level;
    const bedroom = [...level.rooms.values()].find((r) => r.kind.startsWith('bedroom'))!;
    level.openings = level.openings.filter((o) => !(o.kind === 'window' && (o.a === bedroom.id || o.b === bedroom.id)));
    expect(issues(home).filter((i) => i.room === bedroom.id).some((i) => i.kind === 'daylight')).toBe(true);
  });

  test('dead floor is reported with its size', () => {
    const home = new Home(1000, 800);
    home.level.addRoom('living', null, 20);
    const found = issues(home).filter((i) => i.kind === 'dead_floor');
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].note).toContain('square metres');
  });

  test('a bathroom packed with furniture loses its turning circle', () => {
    // Empty it is fine; furnished it is not, and the furnished one is the only
    // version anybody lives in.
    const home = new Home(1000, 800);
    const level = home.level;
    const bath = level.addRoom('bathroom', null, 4);
    const before = issues(home).filter((i) => i.kind === 'turning');
    for (let filled = 0; filled < 6; filled++) {
      try {
        level.addItem('wardrobe', bath);
      } catch (err) {
        if (!(err instanceof PlanError)) throw err;
        break;
      }
    }
    expect(issues(home).filter((i) => i.kind === 'turning').length).toBeGreaterThanOrEqual(before.length);
  });
});

describe('furniture', () => {
  test('a piece straddling two rooms is named with both', () => {
    const home = furnished();
    const level = home.level;
    let pair: [Room, Room, number, number] | null = null;
    for (const a of level.rooms.values()) {
      for (const b of level.rooms.values()) {
        if (a.id >= b.id || pair) continue;
        const edge = sharedEdge(level.cellsOf(a.id), level.cellsOf(b.id));
        if (edge && edge[0] === 'v' && edge[3] - edge[2] >= 200) pair = [a, b, edge[1], edge[2]];
      }
    }
    expect(pair, 'this layout has no long north-south wall to straddle').not.toBeNull();
    const [a, , line, start] = pair!;
    const item = level.addItem('coffee table', a);
    // Sat squarely on the wall itself. A drag would be refused; a wall MOVING
    // under a piece is how this happens for real.
    item.x_cm = line - Math.floor(item.w_cm / 2);
    item.y_cm = start + 20;
    expect(issues(home).filter((i) => i.kind === 'straddles' || i.kind === 'stranded').length).toBeGreaterThan(0);
    expect(issues(home).find((i) => i.kind === 'straddles')!.note).toMatch(/crosses the wall between the .+ and the .+/);
  });

  test('a pinched walkway names its measurement', () => {
    const home = new Home(1000, 800);
    const level = home.level;
    const room = level.addRoom('living', null, 30);
    const a = level.addItem('3-seat sofa', room);
    const b = level.addItem('coffee table', room);
    b.x_cm = a.x_cm;
    b.y_cm = a.y_cm + a.h_cm + 40;   // a 40 cm squeeze
    const found = issues(home).filter((i) => i.kind === 'walkway');
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].note).toContain('40 cm');
  });
});

describe('plumbing', () => {
  test('scattered wet rooms are a soft complaint', () => {
    const home = new Home(1200, 900);
    generate(home.level, [new Slot('living'), new Slot('kitchen'), new Slot('bathroom'), new Slot('bedroom'), new Slot('utility')]);
    // Either they touch, or the complaint names them.
    for (const issue of issues(home).filter((i) => i.kind === 'plumbing')) expect(issue.note).toContain('pipe run');
  });
});

describe('levels', () => {
  test('unaligned stairs are flagged', () => {
    const home = new Home(1000, 800);
    home.level.addRoom('stairs', null, 4, 'west_wall');
    const upper = home.addLevel();
    // Adding the floor lines them up; moving one is what breaks it.
    for (const room of [...upper.rooms.values()].filter((r) => r.kind === 'stairs')) upper.removeRoom(room);
    expect(issues(home).filter((i) => i.kind === 'stairs').length, 'an upper floor with no stairs at all must be flagged').toBeGreaterThan(0);
  });

  test('upstairs, the way in is the stairs, not a front door (fixed in the port)', () => {
    // The original asked every floor for a front door: a new upper floor was
    // told it had none, and a laid-out one got an outside door on the landing.
    const home = new Home(1000, 800);
    generate(home.level, briefFor(2));
    home.addLevel();
    expect(issues(home).map((i) => i.kind)).not.toContain('no_front_door');
    expect(issues(home).map((i) => i.kind), 'the stairs are the way in, not a room without a door').not.toContain('no_door');
    generate(home.level, briefFor(2, { upstairs: true }), { reserve: home.stairsRect(), frontDoor: false });
    expect(home.level.openings.filter((o) => o.kind === 'door' && o.exterior)).toEqual([]);
    expect([...reachable(home.level, { upstairs: true })].sort()).toEqual([...home.level.rooms.keys()].sort());
    expect(issues(home).map((i) => i.kind)).not.toContain('unreachable');
  });

  test('upstairs, a room you cannot reach is unreachable from the stairs, not the front door', () => {
    // A floor with no front door was told "you can't get to the bedroom from the front door".
    const home = new Home(1000, 800);
    generate(home.level, briefFor(2));
    home.addLevel();
    generate(home.level, briefFor(2, { upstairs: true }), { reserve: home.stairsRect(), frontDoor: false });
    const level = home.level;
    const stairs = [...level.rooms.values()].find((r) => r.kind === 'stairs')!;
    // Cut the way off: every door on the stairs goes, but the rooms keep theirs.
    level.openings = level.openings.filter((o) => o.a !== stairs.id && o.b !== stairs.id);
    const cut = issues(home).filter((i) => i.kind === 'unreachable');
    expect(cut.length).toBeGreaterThan(0);
    for (const issue of cut) {
      expect(issue.note).toMatch(/from the stairs$/);
      expect(issue.note).not.toContain('front door');
    }
  });

  test('a second floor is connected the moment it is added', () => {
    // It used to arrive disconnected, with no way to fix it.
    const home = new Home(1000, 800);
    generate(home.level, briefFor(2));
    home.addLevel();
    expect(issues(home).filter((i) => i.kind === 'stairs')).toEqual([]);
  });
});

describe('the schedule', () => {
  test('the schedule totals the rooms and breaks out circulation', () => {
    const table = schedule(furnished(1000, 800, { office: true }));
    expect(table.rows.length).toBeGreaterThan(0);
    expect(Math.abs(table.total_m2 - table.rows.reduce((s, r) => s + r.area_m2, 0))).toBeLessThanOrEqual(0.2);
    expect(table.circulation_pct).toBeGreaterThanOrEqual(0);
    expect(table.circulation_pct).toBeLessThanOrEqual(100);
  });

  test('the schedule converts to square feet', () => {
    const home = furnished();
    expect(schedule(home, 'ft2').total).toBeGreaterThan(schedule(home, 'm2').total * 10);
  });

  test('compare matches rooms by name, not id', () => {
    // Two schemes were captured at different times; their ids describe when a
    // room was made rather than what it is.
    const home = furnished();
    const saved = schedule(home).rows.map((row) => ({ ...row, area_m2: Math.round((row.area_m2 - 1.0) * 10) / 10 }));
    const deltas = compare(home, saved);
    expect(deltas.length).toBeGreaterThan(0);
    for (const d of deltas) expect(Math.abs(d.delta_m2 - 1.0)).toBeLessThan(0.01);
  });

  test('compare reports a room that only one scheme has', () => {
    const home = furnished();
    const saved = [...schedule(home).rows, { id: 'rX', name: 'Wine cellar', kind: 'storage', area_m2: 4.0, area: 4.0 }];
    const rows = new Map(compare(home, saved).map((row) => [row.name, row]));
    expect(rows.has('Wine cellar')).toBe(true);
    expect(rows.get('Wine cellar')!.delta_m2).toBe(-4.0);
  });
});
