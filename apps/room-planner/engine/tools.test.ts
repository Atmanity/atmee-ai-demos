// The architect's tool calls against the real planner: what each call does to
// the plan, and what she is given to say. Arguments are what a host hears
// ("the second bedroom", "two metres", "by the window"), never ids or positions.
import { describe, expect, test } from 'vitest';
import { issues } from './compliance.ts';
import { TOOLS } from './director.ts';
import { Critic, Planner } from './planner.ts';
import { runTool } from './tools.ts';

function plan(w = 900, h = 700, brief: Record<string, unknown> = { bedrooms: 2 }) {
  const planner = new Planner(w, h);
  planner.apply({ kind: 'generate', ...brief });
  const critic = new Critic();
  critic.look(issues(planner.home));
  const call = (name: string, args: Record<string, unknown> = {}) => runTool(planner, critic, name, args);
  const room = (name: string) => [...planner.home.level.rooms.values()].find((r) => r.name === name)!;
  const area = (name: string) => planner.snapshot().level.rooms.find((r) => r.name === name)!.area_m2;
  return { planner, critic, call, room, area };
}

describe('the floor', () => {
  test('lay_out_floor draws a whole floor from a brief, at the size given, in one step', () => {
    const planner = new Planner();
    const out = runTool(planner, new Critic(), 'lay_out_floor', { bedrooms: 2, study: true, width_m: 10, depth_m: 8 });
    expect(out.refusal).toBeNull();
    expect(out.text).toMatch(/^Done: the floor is 10 by 8 metres; the ground floor is laid out as "Day end, night end"/);
    expect([planner.home.level.w_cm, planner.home.level.h_cm]).toEqual([1000, 800]);
    expect([...planner.home.level.rooms.values()].some((r) => r.kind === 'office')).toBe(true);
    // One undo takes the whole thing back, size and all.
    planner.apply({ kind: 'undo' });
    expect([planner.home.level.w_cm, planner.home.level.h_cm, planner.home.level.rooms.size]).toEqual([900, 700, 0]);
  });

  test('a size given as an area keeps the proportions; half a size is a question', () => {
    const planner = new Planner(1000, 800);
    runTool(planner, new Critic(), 'lay_out_floor', { bedrooms: 1, area_m2: 50 });
    expect(planner.home.level.w_cm * planner.home.level.h_cm / 10_000).toBeCloseTo(50, 0);
    const half = runTool(new Planner(), new Critic(), 'set_floor_size', { width_m: 9 });
    expect(half.text).toMatch(/^Not yet: nothing changed. And the other side/);
  });

  test('a redraw at a smaller size replaces the floor instead of refusing the shrink', () => {
    const { planner, call } = plan(1200, 900, { bedrooms: 3 });
    const out = call('lay_out_floor', { bedrooms: 1, style: 'open_plan', width_m: 7, depth_m: 6 });
    expect(out.refusal).toBeNull();
    expect(planner.home.level.w_cm).toBe(700);
  });

  test('set_floor_size refuses to cut into rooms, in the plan\'s own words', () => {
    const { call } = plan();
    const out = call('set_floor_size', { width_m: 5, depth_m: 4 });
    expect(out.refusal).toMatch(/^Shrinking it would cut into the/);
    expect(out.text).toMatch(/^Refused: nothing has changed/);
  });

  test('an upper floor comes with its stairs, and the other tools act on the floor on screen', () => {
    const { planner, call } = plan();
    expect(call('add_upper_floor').text).toContain('there is an upper floor now');
    expect(planner.home.active).toBe(1);
    expect(call('go_to_floor', { floor: 'ground' }).text).toContain('looking at the ground floor');
    expect(call('add_upper_floor').refusal).toBe('Two floors is as many as I draw.');
  });
});

describe('the negotiation', () => {
  test('trade_area moves floor the way it was asked, and answers with both new sizes', () => {
    const planner = new Planner(800, 600);
    planner.home.level.placeRoom('office', [0, 0, 400, 600], 'Study');
    planner.home.level.placeRoom('living', [400, 0, 800, 600], 'Living room');
    const out = runTool(planner, new Critic(), 'trade_area', { take_from: 'the study', give_to: 'living room', m2: 1.2 });
    expect(out.refusal).toBeNull();
    expect(out.text).toMatch(/^Done: 1.2 square metres moved from the study to the living room: the living room 25.2 square metres now, the study 22.8 square metres/);
    // The other way round is the other way round.
    runTool(planner, new Critic(), 'trade_area', { take_from: 'Living room', give_to: 'Study', m2: 2.4 });
    expect(planner.snapshot().level.rooms.find((r) => r.name === 'Study')!.area_m2).toBe(25.2);
  });

  test('a trade the plan cannot make is refused with its reason', () => {
    const { call, area } = plan(1000, 800, { bedrooms: 2, office: true });
    const before = area('Hall');
    const out = call('trade_area', { take_from: 'the hall', give_to: 'study', m2: 1 });
    expect(out.refusal).toMatch(/^That leaves the hall only \d+ centimetres across/);
    expect(out.text).toContain('They asked to move 1 square metre from the hall to the study');
    expect(area('Hall')).toBe(before);
  });

  test('square feet are converted before they reach the plan', () => {
    const { planner, call, room } = plan(1000, 800, { bedrooms: 2, office: true });
    const living = room('Living room');
    const next = planner.snapshot().level.walls.find((w) => w.a === living.id || w.b === living.id)!;
    const other = next.a === living.id ? next.b : next.a;
    const out = call('trade_area', { take_from: other, give_to: 'Living room', sq_ft: 10.7639 });
    if (!out.refusal) expect(out.steps[0].intent.m2).toBe(1);
  });

  test('a trade with no amount is a question, not a guess of one square metre', () => {
    const { call } = plan();
    const out = call('trade_area', { take_from: 'Hall', give_to: 'Main bedroom' });
    expect(out.steps).toEqual([]);
    expect(out.text).toContain('How much floor should move');
  });

  test('"the second bedroom" is the second bedroom, never the main one', () => {
    // A real bug: containment made "second bedroom" match "Main bedroom".
    const { call, room } = plan();
    const second = room('Bedroom');
    const out = call('rename_room', { room: 'the second bedroom', new_name: 'Nursery' });
    expect(out.refusal).toBeNull();
    expect(room('Nursery').id).toBe(second.id);
    expect(room('Main bedroom')).toBeTruthy();
  });

  test('a room that is not there is refused by name', () => {
    const { call } = plan();
    const out = call('remove_room', { room: 'gym' });
    expect(out.refusal).toBe("There's no gym on this floor.");
    expect(out.text).toContain("There's no gym on this floor.");
  });

  test('rooms are added, divided, knocked together and swapped by name', () => {
    const { planner, call, room } = plan(1400, 1000);
    expect(call('add_room', { room: 'utility', near: 'north' }).text).toMatch(/^Done: the utility is on the plan, [\d.]+ square metres/);
    const before = planner.home.level.rooms.size;
    const divided = call('divide_room', { room: 'Living room', new_use: 'study' });
    expect(divided.text).toMatch(/^Done: the living room is divided in two: the living room [\d.]+ square metres and the new study [\d.]+ square metres/);
    expect(planner.home.level.rooms.size).toBe(before + 1);
    const merged = call('knock_together', { room_a: 'Living room', room_b: 'Study' });
    expect(merged.text).toMatch(/^Done: the wall between the living room and the study is out/);
    const main = room('Main bedroom').id, second = room('Bedroom').id;
    const swapped = call('swap_rooms', { room_a: 'Main bedroom', room_b: 'Bedroom' });
    if (!swapped.refusal) expect(room('Main bedroom').id).toBe(second);
    else expect(room('Main bedroom').id).toBe(main);
  });
});

describe('doors and windows', () => {
  test('a window goes on the outside wall named, a door between two rooms', () => {
    const { planner, call, room } = plan();
    const living = room('Living room');
    const outside = planner.snapshot();
    const reach = ['north', 'south', 'east', 'west'].find((side) => {
      const r = outside.level.rooms.find((x) => x.id === living.id)!;
      return side === 'north' ? r.rects.some((q) => q[1] <= 0) : side === 'south' ? r.rects.some((q) => q[3] >= outside.level.h_cm) : side === 'west' ? r.rects.some((q) => q[0] <= 0) : r.rects.some((q) => q[2] >= outside.level.w_cm);
    })!;
    const out = call('add_door_or_window', { kind: 'window', room: 'living room', wall: reach });
    expect(out.text).toMatch(new RegExp(`the living room has a window on the ${reach} side now|There's already a window there|too short`));
    expect(call('add_door_or_window', { kind: 'door', room: 'living room' }).text).toContain('Which room should the door open into?');
  });

  test('a door is taken out by the rooms it joins, and a vague request is a question', () => {
    const { planner, call } = plan();
    const level = planner.snapshot().level;
    const inside = level.openings.find((o) => o.kind === 'door' && o.a && o.b)!;
    const [a, b] = [inside.a, inside.b].map((id) => level.rooms.find((r) => r.id === id)!.name);
    const out = call('remove_door_or_window', { kind: 'door', room: a, other_room: b });
    expect(out.refusal).toBeNull();
    expect(planner.snapshot().level.openings.some((o) => o.id === inside.id)).toBe(false);
    const doors = planner.snapshot().level.openings.filter((o) => o.kind === 'door' && o.a && o.b).length;
    if (doors > 1) expect(call('remove_door_or_window', { kind: 'door' }).text).toContain('Which one');
    expect(call('remove_door_or_window', { kind: 'window', room: 'Kitchen', wall: 'north' }).refusal ?? '').toMatch(/^There's no window|^$/);
  });
});

describe('furniture', () => {
  test('a piece goes in at its real size, then moves and turns without being re-added', () => {
    const { planner, call } = plan();
    const added = call('add_furniture', { piece: 'queen bed', room: 'Main bedroom', near: 'middle' });
    expect(added.text).toMatch(/^Done: a queen bed \(152 by 203 centimetres, its real size\) is in the main bedroom/);
    const id = planner.home.level.items[0].id;
    const turned = call('move_furniture', { piece: 'the bed', quarter_turns: 1 });
    expect(turned.text).toContain('the queen bed is turned');
    expect(planner.home.level.items).toHaveLength(1);
    expect(planner.home.level.items[0].id).toBe(id);
    expect(call('move_furniture', { piece: 'bed' }).text).toContain('Where should it go, or should it turn?');
    expect(call('remove_furniture', { piece: 'queen bed' }).text).toContain('the queen bed is off the plan');
  });

  test('a piece the kit does not have is refused with what it does have', () => {
    const { call } = plan();
    expect(call('add_furniture', { piece: 'grand piano' }).refusal).toMatch(/I don't have a grand piano in my kit/);
  });
});

describe('schemes, units, undo and the sheet', () => {
  test('a scheme is saved, compared and opened by name; one saved scheme is the one meant', () => {
    const { call } = plan();
    expect(call('save_scheme', { name: 'First' }).text).toContain('the plan is saved as scheme "First"');
    expect(call('use_scheme', { action: 'compare' }).text).toContain('scheme "First" is side by side with the plan');
    expect(call('use_scheme', { action: 'stop_comparing' }).text).toContain('the comparison is closed');
    expect(call('use_scheme', { action: 'stop_comparing' }).refusal).toBe('No scheme is being compared right now.');
    expect(call('use_scheme', { action: 'open', scheme: 'first' }).text).toContain('the plan is back to scheme "First"');
    expect(call('use_scheme', { action: 'drop', scheme: 'Second' }).refusal).toMatch(/haven't got a scheme called Second/);
  });

  test('with no schemes saved, there is nothing to compare', () => {
    const { call } = plan();
    expect(call('use_scheme', { action: 'compare', scheme: 'A' }).refusal).toBe('There are no saved schemes yet.');
  });

  test('units, undo and the sheet', () => {
    const { planner, call } = plan();
    expect(call('switch_units', { unit: 'ft2' }).text).toMatch(/areas now show in square feet: \d+ square feet in all/);
    expect(call('undo_change').text).toContain('the last change (laid out the ground floor (day end, night end)) is taken back');
    expect(planner.home.level.rooms.size).toBe(0);
    expect(call('undo_change').refusal).toBe("There's nothing to undo yet.");
    expect(call('draw_sheet').refusal).toBe("There's nothing on this floor to draw up yet.");
  });

  test('the sheet is drawn for the page to open', () => {
    const { call } = plan();
    const out = call('draw_sheet');
    expect(out.drew).toBe(true);
    expect(out.text).toContain('the drawing sheet');
  });

  test('clear_floor empties the floor, and undo brings it back', () => {
    const { planner, call } = plan();
    const rooms = planner.home.level.rooms.size;
    expect(call('clear_floor').text).toContain('floor is empty again (undo brings it back)');
    call('undo_change');
    expect(planner.home.level.rooms.size).toBe(rooms);
  });
});

describe('every call', () => {
  test('every declared tool is answered with words, whatever the arguments', () => {
    for (const tool of TOOLS) {
      const { call } = plan();
      const out = call(tool.name, {});
      expect(typeof out.text, tool.name).toBe('string');
      expect(out.text.length, tool.name).toBeGreaterThan(10);
      expect(out.text, tool.name).not.toMatch(/x_cm|y_cm|undefined|NaN/);
    }
  });

  test('a tool the app does not have is refused, not thrown', () => {
    const { call } = plan();
    const out = call('paint_walls', { colour: 'blue' });
    expect(out.refusal).toBe("That isn't something the plan can do.");
  });

  test('a problem the change created is in the same result', () => {
    const { planner, call } = plan();
    const level = planner.snapshot().level;
    const victim = level.rooms.find((r) => !['hall', 'corridor', 'entry'].includes(r.kind) && level.openings.filter((o) => o.kind === 'door' && (o.a === r.id || o.b === r.id)).length === 1)!;
    const door = level.openings.find((o) => o.kind === 'door' && (o.a === victim.id || o.b === victim.id))!;
    const other = level.rooms.find((r) => r.id === (door.a === victim.id ? door.b : door.a));
    const out = call('remove_door_or_window', other ? { kind: 'door', room: victim.name, other_room: other.name } : { kind: 'front_door', room: victim.name });
    expect(out.refusal).toBeNull();
    expect(out.text).toContain('It also created a problem');
  });
});

describe('what the host passes, its own way', () => {
  test('capitalised words and synonyms are understood, and an unknown extra field is ignored', () => {
    const { planner, call } = plan();
    expect(call('lay_out_floor', { bedrooms: 'two', style: 'Open Plan', study: 'yes', mood: 'cosy' }).text).toContain('laid out as "Open plan living"');
    expect([...planner.home.level.rooms.values()].some((r) => r.kind === 'office')).toBe(true);
    expect(call('switch_units', { unit: 'Square Feet' }).text).toContain('areas now show in square feet');
    expect(call('switch_units', { unit: 'metric' }).text).toContain('areas now show in square metres');
    expect(call('add_upper_floor', { please: true }).refusal).toBeNull();
    expect(call('go_to_floor', { floor: 'Downstairs' }).text).toContain('looking at the ground floor');
    expect(call('save_scheme', { name: 'A' }).refusal).toBeNull();
    expect(call('use_scheme', { action: 'Compare' }).text).toContain('is side by side with the plan');
    expect(call('use_scheme', { action: 'close it' }).text).toContain('the comparison is closed');
  });

  test('a door, a window or the front door by any of their names, on a wall named any way', () => {
    const { planner, call } = plan();
    const level = planner.snapshot().level;
    const front = level.openings.find((o) => o.kind === 'door' && (!o.a || !o.b))!;
    const room = level.rooms.find((r) => r.id === (front.a ?? front.b))!;
    expect(call('remove_door_or_window', { kind: 'Front Door', room: room.name }).refusal).toBeNull();
    const out = call('add_door_or_window', { kind: 'entrance', room: room.name, wall: 'The South Wall' });
    expect(out.text).toMatch(/^(Done: the front door is in the|Refused: )/);
  });

  test('a piece turned "round" turns twice, in place, even when its room is named', () => {
    const { planner, call } = plan();
    call('add_furniture', { piece: 'Queen Bed', room: 'Main bedroom', near: 'Middle' });
    const [x, y] = [planner.home.level.items[0].x_cm, planner.home.level.items[0].y_cm];
    const out = call('move_furniture', { piece: 'Queen bed', room: 'Main bedroom', quarter_turns: 'round' });
    expect(out.steps.map((s) => s.intent.kind)).toEqual(['rotate_item']);
    expect(out.steps[0].intent.deg).toBe(180);
    expect([planner.home.level.items[0].x_cm, planner.home.level.items[0].y_cm]).toEqual([x, y]);
    expect(call('move_furniture', { piece: 'queen bed', quarter_turns: 90 }).steps[0]?.intent.deg).toBe(90);
  });

  test('a value that cannot be read becomes a question, never a guess or silence', () => {
    const { call } = plan();
    expect(call('lay_out_floor', { bedrooms: 2, style: 'gothic' }).text).toMatch(/^Not yet: nothing changed. Which arrangement/);
    expect(call('switch_units', { unit: 'cubits' }).text).toContain('Square metres or square feet?');
    expect(call('go_to_floor', { floor: 'basement' }).text).toContain('Which floor');
    expect(call('add_furniture', { piece: 'sofa', near: 'ceiling' }).text).toContain('Roughly where in the room');
    expect(call('remove_door_or_window', { kind: 'hatch' }).text).toContain('A door, a window or the front door?');
  });
});

describe('found live', () => {
  test('a piano is refused by the plan, in its own words', () => {
    const { call } = plan();
    const out = call('add_furniture', { piece: 'grand piano', room: 'Living room' });
    expect(out.text).toMatch(/^Refused: nothing has changed\..*I don't have a grand piano in my kit/);
  });

  test('open plan is one room for kitchen and living, as the architect says it is', () => {
    const { planner, call } = plan();
    call('lay_out_floor', { bedrooms: 2, study: true, style: 'open_plan' });
    const rooms = [...planner.home.level.rooms.values()];
    expect(rooms.some((r) => r.kind === 'kitchen')).toBe(false);
    expect(rooms.find((r) => r.kind === 'living')!.name).toBe('Kitchen and living room');
    expect(call('trade_area', { take_from: 'kitchen', give_to: 'study', m2: 1 }).text).not.toContain("There's no kitchen");
  });

  test("adding an upstairs keeps the ground floor's layout, gives the stairs a door, and says where they came from", () => {
    const { planner, call } = plan();
    call('lay_out_floor', { bedrooms: 2, study: true, style: 'open_plan' });
    const ground = planner.home.levels[0];
    const before = new Map([...ground.rooms.values()].map((r) => [r.id, `${r.name}|${r.kind}`]));
    const out = call('add_upper_floor');
    expect(out.text).toMatch(/the ground floor keeps its layout, and the stairs took their floor off the [a-z ]+ \(now [\d.]+ square metres\)/);
    // Every room is still there, as it was; the only new room is the stairs.
    for (const [id, what] of before) expect(`${ground.rooms.get(id)?.name}|${ground.rooms.get(id)?.kind}`).toBe(what);
    const stairs = [...ground.rooms.values()].find((r) => r.kind === 'stairs')!;
    expect(ground.rooms.size).toBe(before.size + 1);
    expect(ground.openings.some((o) => o.kind === 'door' && (o.a === stairs.id || o.b === stairs.id))).toBe(true);
    planner.apply({ kind: 'go_to_level', id: 'ground' });
    expect(planner.snapshot().issues.map((i) => i.note).join(' ')).not.toContain('The stairs has no door');
  });

  test('"the drawing to keep" from an empty upstairs draws the floor that has rooms', () => {
    const { planner, call } = plan();
    call('add_upper_floor');
    const out = call('draw_sheet');
    expect(out.drew).toBe(true);
    const sheet = planner.snapshot().sheet!;
    expect(sheet.floor).toBe('ground');
    expect(sheet.pages!.map((p) => p.floor)).toEqual(['ground']);
    expect(out.text).toContain('for the ground floor');
  });

  test('with both floors drawn, the sheet has a page for each, the one on screen first', () => {
    const { planner, call } = plan();
    call('add_upper_floor');
    call('lay_out_floor', { bedrooms: 2 });
    call('draw_sheet');
    expect(planner.snapshot().sheet!.pages!.map((p) => p.floor)).toEqual(['upper', 'ground']);
  });
});
