// What words mean to the plan. The rules are tested with phrasings people
// actually use (the original tool tests became these: the trade direction, the
// metres a client speaks, the words for undo); the operations on how a step
// becomes intents; the safety net on what it may do for the host.
import { beforeAll, describe, expect, test } from 'vitest';
import { contextOf, digitize, findRoomIn, mustDo, normalizeUtterance, roomSideCm, rulesFor, sizeForArea, stepsToIntents, type JudgeContext, type Step } from './judge.ts';
import { Planner } from './planner.ts';

let planner: Planner;
let ctx: JudgeContext;
const id = (name: string) => [...planner.home.level.rooms.values()].find((r) => r.name === name)!.id;
const empty = () => contextOf(new Planner().snapshot());

beforeAll(() => {
  planner = new Planner(1000, 800);
  planner.apply({ kind: 'generate', bedrooms: 2, office: true, dining: true });
  const sofaRoom = id('Living room');
  planner.apply({ kind: 'add_item', type: 'sofa', room: sofaRoom });
  planner.apply({ kind: 'add_item', type: 'queen bed', room: id('Main bedroom') });
  planner.apply({ kind: 'save_scheme', name: 'Open plan version' });
  ctx = contextOf(planner.snapshot());
});

describe('the words', () => {
  test('number words become digits only where they are amounts', () => {
    expect(digitize('nine by seven')).toBe('9 by 7');
    expect(digitize('give the study two and a half square metres')).toBe('give the study 2.5 square metres');
    expect(digitize('a two bed with twenty five square metres')).toBe('a 2 bed with 25 square metres');
    expect(digitize('save this one')).toBe('save this one');
    expect(digitize('half a metre')).toBe('0.5 metre');
  });

  test('fillers come off both ends', () => {
    expect(normalizeUtterance('Okay, can you put the sofa by the window, please?')).toBe('put the sofa by the window');
    expect(normalizeUtterance("No, let's go upstairs.")).toBe('go upstairs');
    expect(normalizeUtterance('Make it 9m × 7m')).toBe('make it 9 m 7 m');
  });

  test('a spoken room name prefers the closest match, by whole words', () => {
    // "second bedroom" matched "Main bedroom" once (both contain "bedroom").
    // An exact name wins: the second bedroom of a generated two-bed is "Bedroom".
    expect(findRoomIn(ctx, 'the bedroom')).toBe(id('Bedroom'));
    expect(findRoomIn(ctx, 'main bedroom')).toBe(id('Main bedroom'));
    expect(findRoomIn(ctx, 'bed')).toBeNull();
    expect(findRoomIn(ctx, 'lounge')).toBe(id('Living room'));
  });
});

describe('the rules', () => {
  test('undo, by the words people use', () => {
    for (const said of ['Undo', 'undo that', 'Take that back.', 'No, put it back.', 'I preferred it before', 'go back']) {
      expect(rulesFor(said, ctx), said).toEqual([{ kind: 'undo' }]);
    }
  });

  test('the trade goes the way it was asked, however it is phrased', () => {
    // The verb a negotiation runs on, and the one whose direction must not slip:
    // live, the model once swapped the rooms and the study SHRANK.
    const study = id('Study'), kitchen = id('Kitchen'), living = id('Living room'), hall = id('Hall');
    expect(rulesFor('Give the living room two metres off the study', ctx)).toEqual([{ kind: 'trade_area', from: study, to: living, m2: 2 }]);
    expect(rulesFor('give the study 1.5 square metres from the kitchen', ctx)).toEqual([{ kind: 'trade_area', from: kitchen, to: study, m2: 1.5 }]);
    expect(rulesFor('Take two square metres from the hall and give it to the kitchen.', ctx)).toEqual([{ kind: 'trade_area', from: hall, to: kitchen, m2: 2 }]);
    expect(rulesFor('make the study two metres bigger by taking it from the kitchen', ctx)).toEqual([{ kind: 'trade_area', from: kitchen, to: study, m2: 2 }]);
    expect(rulesFor('make the kitchen a metre smaller and give it to the study', ctx)).toEqual([{ kind: 'trade_area', from: kitchen, to: study, m2: 1 }]);
  });

  test('the size of the place, in the metres people speak', () => {
    // The app's own example is "nine metres by seven"; refusing it would reject its own instructions.
    expect(rulesFor('nine by seven', ctx)).toEqual([{ kind: 'set_envelope', w: 900, h: 700 }]);
    expect(rulesFor("It's about 12 metres by 8.", ctx)).toEqual([{ kind: 'set_envelope', w: 1200, h: 800 }]);
    expect(rulesFor('make it 800 by 600', ctx)).toEqual([{ kind: 'set_envelope', w: 800, h: 600 }]);
    expect(rulesFor('the flat is about seventy square metres', ctx)).toEqual([{ kind: 'set_envelope', ...sizeOf(70) }]);
  });

  test('a size no unit can rescue still reaches the plan, which refuses it in its own words', () => {
    const intents = rulesFor('make it 0.4 by 0.3', ctx)!;
    expect(intents).toEqual([{ kind: 'set_envelope', w: 0.4, h: 0.3 }]);
    const p = new Planner();
    const r = p.apply(intents[0]);
    expect(!r.applied && r.reason).toContain('two and twenty metres');
  });

  test('a brief on an empty floor is laid out at once, the size first if they gave one', () => {
    const blank = empty();
    expect(rulesFor('Two of us and we work from home, so a two-bed with a study.', blank)).toEqual([
      { kind: 'generate', bedrooms: 2, style: 'day_night', office: true, dining: false, ensuite: false, wc: false, utility: false },
    ]);
    const both = rulesFor("It's about seventy square metres, three bedrooms, open plan", blank)!;
    expect(both.map((i) => i.kind)).toEqual(['set_envelope', 'generate']);
    expect(both[1]).toMatchObject({ bedrooms: 3, style: 'open_plan' });
    // On a drawn floor a bare count could mean anything; that goes to the model.
    expect(rulesFor('we need two bedrooms', ctx)).toBeNull();
    expect(rulesFor('redraw it as a three bed', ctx)![0]).toMatchObject({ kind: 'generate', bedrooms: 3 });
  });

  test('several requests in one breath are several steps, or none', () => {
    expect(rulesFor('Save this and try it open plan', ctx)).toEqual([
      { kind: 'save_scheme', name: '' },
      { kind: 'generate', style: 'open_plan', bedrooms: 2, office: true, dining: true, ensuite: false, wc: false, utility: false },
    ]);
    // Half an instruction applied is worse than the whole one judged by the model.
    expect(rulesFor('save this and make it feel cosier', ctx)).toBeNull();
  });

  test('furniture by type, room and relation, never a position', () => {
    expect(rulesFor('A queen bed in the main bedroom by the window', ctx)).toEqual([{ kind: 'add_item', type: 'bed_queen', room: id('Main bedroom'), near: 'window' }]);
    expect(rulesFor('add a desk to the study against the north wall', ctx)).toEqual([{ kind: 'add_item', type: 'desk', room: id('Study'), near: 'north_wall' }]);
    const sofa = planner.snapshot().level.items.find((i) => i.type === 'sofa_3')!.id;
    expect(rulesFor('put the sofa by the window', ctx)).toEqual([{ kind: 'place_item', id: sofa, near: 'window' }]);
    expect(rulesFor('turn the sofa round', ctx)).toEqual([{ kind: 'rotate_item', id: sofa, deg: 90 }]);
    expect(rulesFor('get rid of the bed', ctx)).toEqual([{ kind: 'remove_item', id: planner.snapshot().level.items.find((i) => i.type === 'bed_queen')!.id }]);
    // A closet is a room and a wardrobe: the model decides.
    expect(rulesFor('add a closet', ctx)).toBeNull();
    // A bare noun is not an instruction.
    expect(rulesFor('a sofa', ctx)).toBeNull();
  });

  test('rooms by name: add, remove, swap, knock together, divide, rename, change of use', () => {
    expect(rulesFor('Add a utility next to the kitchen', ctx)).toEqual([{ kind: 'add_room', room_kind: 'utility', near: `beside:${id('Kitchen')}` }]);
    expect(rulesFor('we need a WC on the north side', ctx)).toEqual([{ kind: 'add_room', room_kind: 'wc', near: 'north_wall' }]);
    expect(rulesFor("get rid of the dining room", ctx)).toEqual([{ kind: 'remove_room', id: id('Dining room') }]);
    expect(rulesFor('swap the study and the main bedroom', ctx)).toEqual([{ kind: 'swap_rooms', a: id('Study'), b: id('Main bedroom') }]);
    expect(rulesFor('knock the kitchen and dining room together', ctx)).toEqual([{ kind: 'merge_rooms', a: id('Kitchen'), b: id('Dining room') }]);
    expect(rulesFor('divide the living room to make a study', ctx)).toEqual([{ kind: 'split_room', id: id('Living room'), room_kind: 'office' }]);
    expect(rulesFor('call the study the snug', ctx)).toEqual([{ kind: 'rename_room', id: id('Study'), name: 'Snug' }]);
    expect(rulesFor('make the study a nursery instead', ctx)).toEqual([{ kind: 'rename_room', id: id('Study'), room_kind: 'nursery' }]);
    expect(rulesFor('the wall between the kitchen and the hall is load-bearing', ctx)).toEqual([{ kind: 'mark_structural', a: id('Kitchen'), b: id('Hall') }]);
    expect(rulesFor('put a door between the study and the living room', ctx)).toEqual([{ kind: 'add_door', a: id('Study'), b: id('Living room') }]);
    expect(rulesFor('put a window in the kitchen on the north side', ctx)).toEqual([{ kind: 'add_window', id: id('Kitchen'), wall: 'north' }]);
  });

  test('floors, schemes, units and the sheet', () => {
    expect(rulesFor('add an upstairs', ctx)).toEqual([{ kind: 'add_level' }]);
    expect(rulesFor('go upstairs', ctx)).toBeNull();   // there is no upstairs yet
    expect(rulesFor('Can I see that in square feet?', ctx)).toEqual([{ kind: 'set_unit', unit: 'ft2' }]);
    expect(rulesFor('back to metric', ctx)).toEqual([{ kind: 'set_unit', unit: 'm2' }]);
    expect(rulesFor('save this one as the first version', ctx)).toEqual([{ kind: 'save_scheme', name: 'First version' }]);
    expect(rulesFor('compare it with the open plan version', ctx)).toEqual([{ kind: 'compare_scheme', name: 'Open plan version' }]);
    expect(rulesFor('go back to the open plan version', ctx)).toEqual([{ kind: 'load_scheme', name: 'Open plan version' }]);
    expect(rulesFor('stop comparing', ctx)).toEqual([{ kind: 'compare_scheme', name: 'off' }]);
    expect(rulesFor('draw up the sheet', ctx)).toEqual([{ kind: 'draw_sheet' }]);
    expect(rulesFor('start over', ctx)).toEqual([{ kind: 'clear' }]);
  });

  test('questions, refusals and chat are not commands', () => {
    for (const said of [
      'How big is the living room?', "What's the biggest room?", 'Is there room for a desk in the study?',
      "Don't move that wall", 'We are a couple with a baby on the way', 'That looks great', 'Hmm, not sure',
      'which bedroom gets the morning sun', 'Do we need a hall?',
    ]) expect(rulesFor(said, ctx), said).toBeNull();
  });
});

describe('the operations', () => {
  test('its steps become the same intents a button sends', () => {
    const steps: Step[] = [
      { op: 'set_floor_size', width_m: 8, depth_m: 6 },
      { op: 'lay_out_floor', bedrooms: 2, style: 'nonsense', office: true },
      { op: 'trade_area', take_from: 'r3', give_to: 'r5', m2: -2 },
      { op: 'add_furniture', piece: 'bed_queen', room: 'r6', near: 'beside', beside: 'i2' },
      { op: 'turn_furniture', item: 'i1', quarter_turns: 2 },
    ];
    expect(stepsToIntents(steps, ctx).intents).toEqual([
      { kind: 'set_envelope', w: 800, h: 600 },
      { kind: 'generate', bedrooms: 2, style: 'day_night', office: true, dining: false, ensuite: false, wc: false, utility: false },
      { kind: 'trade_area', from: 'r3', to: 'r5', m2: 2 },
      { kind: 'add_item', type: 'bed_queen', room: 'r6', near: 'beside:i2' },
    ]);
  });

  test('a floor given as an area keeps its proportions', () => {
    const { intents } = stepsToIntents([{ op: 'set_floor_size', area_m2: 70 }], ctx);
    expect(intents).toEqual([{ kind: 'set_envelope', ...sizeOf(70) }]);
  });

  test('a change it could not pin down becomes a question, not a guess', () => {
    expect(stepsToIntents([{ op: 'trade_area', give_to: 'r3' }], ctx)).toEqual({ intents: [], ask: 'Which room should give the space up, and which one gets it?' });
    expect(stepsToIntents([{ op: 'select', room: 'r99' }], ctx).intents).toEqual([]);
    expect(stepsToIntents(undefined, ctx)).toEqual({ intents: [], ask: null });
  });
});

describe('the safety net', () => {
  test('what it does when the host does not, and only the actions safe to repeat', () => {
    const two = new Planner();
    two.apply({ kind: 'generate', bedrooms: 2 });
    const one = contextOf(two.snapshot());
    two.apply({ kind: 'add_level' });
    two.apply({ kind: 'go_to_level', id: 'ground' });
    two.apply({ kind: 'save_scheme', name: 'A' });
    two.apply({ kind: 'compare_scheme', name: 'A' });
    const both = contextOf(two.snapshot());
    const cases: [string, JudgeContext, ReturnType<typeof mustDo>][] = [
      ['Can I see that in square feet?', one, { name: 'switch_units', arguments: { unit: 'ft2' } }],
      ['back to metric please', one, { name: 'switch_units', arguments: { unit: 'm2' } }],
      ['Show me upstairs.', both, { name: 'go_to_floor', arguments: { floor: 'upper' } }],
      ['go back downstairs', both, { name: 'go_to_floor', arguments: { floor: 'ground' } }],
      ['Add an upstairs.', one, { name: 'add_upper_floor', arguments: {} }],
      ['Stop comparing.', both, { name: 'use_scheme', arguments: { action: 'stop_comparing' } }],
      ['Can I download the plan?', one, { name: 'draw_sheet', arguments: {} }],
      // a cost if doubled, a question, a description, or nothing to do
      ['Undo that.', one, null], ['Save this one.', one, null], ['Clear the floor.', one, null],
      ['Give the living room two square metres off the hall.', one, null],
      ["It's a house with two bedrooms upstairs.", one, null], ['Add an upstairs.', both, null],
      ['Stop comparing.', one, null], ['Show me upstairs.', one, null],
      ['What is on the drawing sheet?', one, null], ["Don't show it in square feet.", one, null],
      ['Can I download the plan?', empty(), null],
    ];
    for (const [said, plan, expected] of cases) expect(mustDo(said, plan), said).toEqual(expected);
  });
});

describe('units', () => {
  test('a side spoken in metres becomes centimetres; centimetres stay', () => {
    expect(roomSideCm(9)).toBe(900);
    expect(roomSideCm(12.5)).toBe(1250);
    expect(roomSideCm(800)).toBe(800);
    expect(roomSideCm(0.4)).toBe(0.4);
    expect(roomSideCm(40)).toBe(40);   // 40 m is past the 20 m limit either way: the plan refuses it
  });
});

const sizeOf = (area: number) => {
  const { w, h } = sizeForArea(area, { w_cm: 1000, h_cm: 800 });
  return { w, h };
};
