// What the architect is told: the tool instructions (the original prompt's
// rules, condensed), the tools, the state (the original "[Live floor plan]"
// note, now up to 3,858 characters), the tool results and the events for a
// change by hand (the original tool cues and the critic).
import { describe, expect, test } from 'vitest';
import { issues } from './compliance.ts';
import { cardinal } from './describe.ts';
import { byHand, INSTRUCTIONS, INSTRUCTIONS_LIMIT, issueCue, planState, resultFor, say, STATE_LIMIT, TOOLS, type Step } from './director.ts';
import { briefFor, generate } from './generate.ts';
import { MAX_ITEMS_PER_LEVEL, MAX_ROOMS_PER_LEVEL, PlanError } from './home.ts';
import { Critic, Planner } from './planner.ts';
import type { Intent } from './types.ts';

const step = (p: Planner, intent: Intent): Step => ({ intent, result: p.apply(intent) });
const twoBed = (w = 900, h = 700) => {
  const p = new Planner(w, h);
  p.apply({ kind: 'generate', bedrooms: 2 });
  return p;
};

describe('the instructions', () => {
  test('fit the API and name every tool', () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(INSTRUCTIONS_LIMIT);
    for (const tool of TOOLS) expect(INSTRUCTIONS, tool.name).toContain(tool.name);
  });

  test('the plan changes only through the tools, and an outcome is never invented', () => {
    expect(INSTRUCTIONS).toContain('The plan changes only when you call a tool');
    expect(INSTRUCTIONS).toContain('Every request that changes the screen is a tool call, even a single word answering your own question');
    expect(INSTRUCTIONS).toContain("never say a change happened unless the tool's result said so");
    // Live, "add a grand piano" got no call and a made-up "nearly four square metres".
    expect(INSTRUCTIONS).toContain('even for a piece or room you think the plan lacks (a piano, a gym)');
    expect(INSTRUCTIONS).toContain('a refusal must come from it');
    // Round two: "a grand piano takes up nearly four square metres…" came before the refusal.
    expect(INSTRUCTIONS).toContain('Call the tool FIRST and say nothing about the request until it returns');
    // Round two: a second "the drawing to keep" got "whenever you are ready".
    expect(INSTRUCTIONS).toContain('Asked again for something already done (the drawing, a floor), call the tool again');
    const describe = (name: string) => TOOLS.find((t) => t.name === name)!.description;
    expect(describe('add_furniture')).toContain('before saying anything about it');
    expect(describe('draw_sheet')).toContain('even if a sheet is already up');
    expect(INSTRUCTIONS).toContain('Never invent or estimate a size or an outcome');
    expect(INSTRUCTIONS).toContain('never confirm a refused change');
    expect(INSTRUCTIONS).toContain('Call the tool even when you think you know');
    expect(INSTRUCTIONS).toContain('answer from the live plan, no tool');
  });

  test('the original "never" rules hold: no compliance claims, no coordinates, no invented sizes', () => {
    // Codes differ by country, building type and new-build versus refurb; a
    // client who hears "that meets Part M" and builds on it has been misled.
    expect(INSTRUCTIONS).toContain('Never say a plan is compliant');
    expect(INSTRUCTIONS).toContain('good practice');
    expect(INSTRUCTIONS).toContain('Never choose or ask for coordinates');
    expect(INSTRUCTIONS).toContain('never invent a dimension');
    expect(INSTRUCTIONS).toContain('take_from gets SMALLER, give_to gets BIGGER');
  });

  test('destructive changes and suggestions wait for the client', () => {
    // Live, a host offered a new game in a result and then started one on its own.
    expect(INSTRUCTIONS).toContain('Only when the client asks: lay_out_floor over a floor that has rooms, clear_floor, remove_room');
    expect(INSTRUCTIONS).toContain('make it only if they say yes');
  });

  test('the app gives the architect a job and never a name', () => {
    // The face and the voice are the host's own; an invented name contradicts them.
    expect(INSTRUCTIONS).toContain('You are the architect in Planwright');
    expect(INSTRUCTIONS).not.toMatch(/\bIris\b|\bNora\b/);
  });
});

describe('the tools', () => {
  test('fit the API: names, descriptions, schemas, all awaited', () => {
    expect(TOOLS.length).toBeLessThanOrEqual(30);
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
      expect(['web_search', 'lookup']).not.toContain(tool.name);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.description.length, tool.name).toBeLessThanOrEqual(500);
      expect(tool.parameters.type).toBe('object');
      expect(JSON.stringify(tool.parameters).length).toBeLessThanOrEqual(4096);
      expect(tool['x-atmee']?.mode).toBe('await');
      expect(tool['x-atmee']!.timeoutSeconds!).toBeLessThanOrEqual(28);
    }
    expect(JSON.stringify(TOOLS).length).toBeLessThanOrEqual(24576);
  });

  test('the schemas are lenient: a call the platform rejects never reaches the plan', () => {
    // Live, a call that did not fit its schema was answered "invalid arguments"
    // to the host, never reached the page, and the host said it had happened.
    const all = JSON.stringify(TOOLS);
    for (const strict of ['"enum"', '"additionalProperties"', '"pattern"', '"format"', '"minLength"', '"minimum"', '"maximum"']) expect(all).not.toContain(strict);
    for (const tool of TOOLS) {
      const props = tool.parameters.properties as Record<string, { maxLength?: number }>;
      for (const prop of Object.values(props)) if (prop.maxLength !== undefined) expect(prop.maxLength).toBeGreaterThanOrEqual(500);
      expect((tool.parameters.required as string[]) ?? []).toEqual([]);
    }
  });

  test('nothing takes a position; only an exact wall move and the floor size are measurements', () => {
    // The app's central bet: a model asked for x and y guesses, gets refused for
    // overlapping what it cannot see, and retries out loud.
    const fields = TOOLS.flatMap((t) => Object.keys((t.parameters.properties ?? {}) as object));
    for (const coordinate of ['x', 'y', 'x_cm', 'y_cm', 'offset_cm', 'position']) expect(fields).not.toContain(coordinate);
    const lengths = [...new Set(fields.filter((f) => /cm|centimetres|width|depth/.test(f)))].sort();
    expect(lengths).toEqual(['centimetres', 'depth_m', 'width_m']);
  });

  test('the trade fields say which room loses', () => {
    // The names are the fix for a real reversal.
    const trade = TOOLS.find((t) => t.name === 'trade_area')!;
    const p = trade.parameters.properties as Record<string, { description: string }>;
    expect(p.take_from.description).toContain('gets smaller');
    expect(p.give_to.description).toContain('gets bigger');
    expect(trade.description).toContain('take_from gets SMALLER');
  });

  test('the destructive ones say they wait for the client', () => {
    for (const name of ['remove_room', 'clear_floor', 'use_scheme']) {
      expect(TOOLS.find((t) => t.name === name)!.description, name).toMatch(/[Oo]nly when the client asks/);
    }
  });
});

describe('the state', () => {
  test('cardinal names the floor the way a person would', () => {
    expect(cardinal(0, 0, 100, 100, 400, 400)).toBe('north-west');
    expect(cardinal(300, 300, 100, 100, 400, 400)).toBe('south-east');
    expect(cardinal(150, 150, 100, 100, 400, 400)).toBe('centre');
    expect(cardinal(150, 0, 100, 50, 400, 400)).toBe('north');
  });

  test('an empty floor still says what is there, and what to ask', () => {
    const text = planState(new Planner().snapshot());
    expect(text).toContain('no rooms yet');
    expect(text).toContain('9 by 7 metres');
  });

  test('rooms by area and compass, never coordinates', () => {
    const p = twoBed();
    const text = planState(p.snapshot());
    expect(text).toContain('Planwright, live plan');
    expect(text).toContain('square metres');
    expect(text).toMatch(/north|south|east|west|centre/);
    expect(text).not.toMatch(/x_cm|y_cm|\bx=|\by=/);
    for (const room of p.home.level.rooms.values()) expect(text).toContain(room.name);
    expect(text.length).toBeLessThanOrEqual(STATE_LIMIT);
  });

  test('areas are given in the unit the client reads, and only that one', () => {
    // Live, after switching to square feet, the host gave "thirty-nine square
    // feet, leaving fifty-nine square metres" in one sentence.
    const p = twoBed();
    p.apply({ kind: 'set_unit', unit: 'ft2' });
    const text = planState(p.snapshot());
    expect(text).toContain('square feet');
    expect(text.replace('Areas are shown to the client in square feet.', '')).not.toContain('square metres');
  });

  test("a check's area is said in the client's unit too", () => {
    const p = new Planner(900, 700);
    p.home.level.placeRoom('living', [0, 0, 600, 700], 'Living room');
    p.apply({ kind: 'set_unit', unit: 'ft2' });
    const text = planState(p.snapshot());
    expect(text).toContain("226 square feet of the floor isn't in any room");
  });

  test('the arrangement in force is named, so "is this the open plan?" is answered from it', () => {
    const p = new Planner();
    p.apply({ kind: 'generate', bedrooms: 2, style: 'open_plan' });
    expect(planState(p.snapshot())).toContain('Laid out as "Open plan living".');
  });

  test('a whole home keeps its size on top and fits', () => {
    const p = new Planner(1400, 1000);
    p.apply({ kind: 'generate', bedrooms: 3, office: true, dining: true, utility: true, wc: true });
    const text = planState(p.snapshot());
    expect(text).toContain('14 by 10 metres');
    expect(text.length).toBeLessThanOrEqual(STATE_LIMIT);
  });

  test('reference data that never changes stays out', () => {
    // The catalogue and the room kinds are most of the snapshot and none of the conversation.
    const text = planState(twoBed().snapshot());
    expect(text).not.toContain('bed_queen');
    expect(text.toLowerCase()).not.toContain('typolog');
  });

  test('what undo would take back is staged, so "what would undo do" is answered at once', () => {
    const p = twoBed();
    const living = [...p.home.level.rooms.values()].find((r) => r.kind === 'living')!;
    p.apply({ kind: 'rename_room', id: living.id, name: 'Snug' });
    expect(planState(p.snapshot())).toContain('Last change: renamed the living room to Snug (undo_change takes it back)');
  });

  test('the checks are said to be good practice, never regulations', () => {
    const p = twoBed();
    p.home.level.openings = p.home.level.openings.filter((o) => o.kind !== 'window');
    expect(planState(p.snapshot())).toContain("the app's own checks: good practice, not regulations");
  });

  test('the app at its own limits still fits, with the plan itself kept', () => {
    // The worst case the caps allow: twelve rooms, forty pieces, three schemes,
    // a comparison, a second storey, and names the length a person types.
    const p = new Planner(1200, 1000);
    const level = p.home.level;
    generate(level, briefFor(4, { office: true, dining: true, ensuite: true, wc: true }));
    while (level.rooms.size < MAX_ROOMS_PER_LEVEL) {
      try { level.addRoom('storage'); } catch (err) { if (!(err instanceof PlanError)) throw err; break; }
    }
    for (const room of [...level.rooms.values()]) {
      for (const piece of ['queen bed', 'wardrobe', 'armchair', 'plant', 'stool', 'desk']) {
        if (level.items.length >= MAX_ITEMS_PER_LEVEL) break;
        try { level.addItem(piece, room); } catch (err) { if (!(err instanceof PlanError)) throw err; }
      }
    }
    let n = 0;
    for (const room of level.rooms.values()) room.name = `Main bedroom with the bay window ${++n}`;
    for (const name of ['Alternative A', 'Alternative B', 'Alternative C']) p.apply({ kind: 'save_scheme', name });
    p.apply({ kind: 'add_level' });
    p.apply({ kind: 'generate', bedrooms: 3 });
    p.apply({ kind: 'go_to_level', id: 'ground' });
    p.apply({ kind: 'compare_scheme', name: 'Alternative A' });
    const snap = p.snapshot();
    expect(snap.comparing).toBeTruthy();
    expect(level.rooms.size).toBe(MAX_ROOMS_PER_LEVEL);
    const text = planState(snap);
    expect(text.length).toBeLessThanOrEqual(STATE_LIMIT);
    expect(text).toContain('12 by 10 metres');
    expect(text).toContain('Rooms, biggest first');
    expect(text).toContain('Worth knowing');
  });
});

describe('the results', () => {
  test('a change is answered with its real numbers', () => {
    const p = new Planner(800, 600);
    p.home.level.placeRoom('office', [0, 0, 400, 600], 'Study');
    p.home.level.placeRoom('living', [400, 0, 800, 600], 'Living room');
    const s = step(p, { kind: 'trade_area', from: 'study', to: 'living room', m2: 1.2 });
    const text = resultFor([s], [], p.snapshot());
    expect(text).toMatch(/^Done: 1.2 square metres moved from the study to the living room/);
    expect(text).toContain('the living room 25.2 square metres');
    expect(text).toContain('the study 22.8 square metres');
  });

  test('in square feet when that is what the client reads', () => {
    const p = new Planner(800, 600);
    p.home.level.placeRoom('office', [0, 0, 400, 600], 'Study');
    p.home.level.placeRoom('living', [400, 0, 800, 600], 'Living room');
    p.apply({ kind: 'set_unit', unit: 'ft2' });
    const text = resultFor([step(p, { kind: 'trade_area', from: 'study', to: 'living room', m2: 1.2 })], [], p.snapshot());
    expect(text).toContain('the living room 271 square feet');
    expect(text).not.toContain('square metres');
  });

  test('a laid-out floor hands the architect something to say, not a status', () => {
    const p = new Planner();
    const text = resultFor([step(p, { kind: 'generate', bedrooms: 2 })], [], p.snapshot());
    expect(text).toContain('Say one short line');
    expect(text).toContain('Day end, night end');
  });

  test('a layout at a new size says the size it became', () => {
    const p = new Planner();
    const text = resultFor([step(p, { kind: 'generate', bedrooms: 1, w: 800, h: 600 })], [], p.snapshot());
    expect(text).toContain('the floor is 8 by 6 metres');
  });

  test("a refusal carries the plan's reason and forbids confirming it", () => {
    const p = new Planner();
    const text = resultFor([step(p, { kind: 'add_item', type: 'chaise longue' })], [], p.snapshot());
    expect(text).toMatch(/^Refused: nothing has changed/);
    expect(text).toContain('chaise longue');
    expect(text).toContain('Never describe it as done');
    expect(text).toContain('make it only if they agree');
  });

  test('when part of a request fails, the result says which part', () => {
    const p = twoBed();
    const steps = [step(p, { kind: 'save_scheme', name: 'A' }), step(p, { kind: 'add_item', type: 'hovercraft' })];
    const text = resultFor(steps, [], p.snapshot());
    expect(text).toContain('Done: the plan is saved as scheme "A"');
    expect(text).toContain('The rest was refused and has NOT changed: they asked to add a hovercraft');
  });

  test('a result never asks for another change on the architect\'s own initiative', () => {
    // Live, "offer a new game" became a new game the player never asked for.
    const p = twoBed();
    const saved = resultFor([step(p, { kind: 'save_scheme', name: 'A' })], [], p.snapshot());
    expect(saved).toContain('ask whether they want to try a different arrangement');
    const cue = issueCue({ kind: 'daylight', room: 'r1', note: 'The study has no window at all' });
    expect(cue).toContain('Change it only if they agree');
  });

  test('a change gets one voice: the problem it created is folded into its result', () => {
    const p = twoBed();
    const critic = new Critic();
    critic.look(issues(p.home));
    const level = p.home.level;
    const victim = [...level.rooms.values()].find((r) => !r.spec.circulation)!;
    const door = level.openings.find((o) => o.kind === 'door' && (o.a === victim.id || o.b === victim.id))!;
    const s = step(p, { kind: 'remove_opening', id: door.id });
    const text = resultFor([s], critic.look(issues(p.home)), p.snapshot());
    expect(text).toContain('It also created a problem');
  });

  test('the critic names one issue, never a list', () => {
    const cue = issueCue({ kind: 'corridor', room: 'r1', note: 'The hall narrows to 80 cm — two people can\'t pass' }, 3);
    expect(cue).toContain('The hall narrows to 80 cm');
    expect(cue).toContain('mention only this one');
    expect(cue).toContain('under 25 words');
  });

  test('undo is told as going back, not as a new change', () => {
    const p = twoBed();
    const text = resultFor([step(p, { kind: 'undo' })], [], p.snapshot());
    expect(text).toContain('the last change (laid out the ground floor (day end, night end)) is taken back');
    expect(text).toContain('It is not a new change');
  });
});

describe('changes by hand', () => {
  test('a problem made by hand is told, and small edits are not narrated', () => {
    // A drag has no request behind it, so the critic is the only voice there is.
    const p = twoBed();
    const critic = new Critic();
    critic.look(issues(p.home));
    const level = p.home.level;
    const victim = [...level.rooms.values()].find((r) => !r.spec.circulation)!;
    const door = level.openings.find((o) => o.kind === 'door' && (o.a === victim.id || o.b === victim.id))!;
    const events = byHand([step(p, { kind: 'remove_opening', id: door.id })], critic.look(issues(p.home)), p.snapshot());
    expect(events).toHaveLength(1);
    expect(events[0].text).toContain("The client's change by hand created a problem");
    expect(byHand([step(p, { kind: 'set_unit', unit: 'ft2' })], [], p.snapshot())).toEqual([]);
  });

  test('a milestone by hand is told, since the architect cannot see the click', () => {
    const p = new Planner();
    const [event] = byHand([step(p, { kind: 'generate', bedrooms: 1 })], [], p.snapshot());
    expect(event.text).toContain('The client changed the plan by hand: the ground floor is laid out');
  });
});

describe('the opening and photos', () => {
  test('the opening never greets twice: the host has already introduced herself', () => {
    for (const snap of [new Planner().snapshot(), twoBed().snapshot()]) {
      expect(say.opening(snap)).toMatch(/^You have just greeted them; do not greet or introduce yourself again\./);
    }
  });

  test('the opening asks the two things a sketch needs', () => {
    const text = say.opening(new Planner().snapshot());
    expect(text).toContain('roughly how big the place is');
    expect(text).toContain('how many bedrooms');
  });

  test('every result starts with its plain outcome, so a filler cannot pre-judge it', () => {
    const p = twoBed();
    expect(resultFor([step(p, { kind: 'set_unit', unit: 'ft2' })], [], p.snapshot())).toMatch(/^Done: /);
    expect(resultFor([step(p, { kind: 'add_item', type: 'piano' })], [], p.snapshot())).toMatch(/^Refused: /);
    expect(resultFor([], [], p.snapshot())).toMatch(/^Not yet: /);
  });

  test('a plan already on screen is welcomed, not interviewed', () => {
    expect(say.opening(twoBed().snapshot())).toContain('ask what they would change first');
  });

  test('a photo is told by what the app added, and never by guessed sizes', () => {
    const text = say.photo('room', ['a 3-seat sofa in the living room', 'a rug in the living room'], [], 'a small living room');
    expect(text).toContain('You cannot see it');
    expect(text).toContain('never guess a measurement');
  });
});
