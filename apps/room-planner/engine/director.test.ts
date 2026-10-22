// What the avatar is told: the notes (the original prompt's rules, condensed),
// the state (the original "[Live floor plan]" note, now up to 3,858
// characters) and the events (the original tool cues and the critic).
import { describe, expect, test } from 'vitest';
import { issues } from './compliance.ts';
import { cardinal } from './describe.ts';
import { eventsFor, issueCue, NOTE_LIMIT, NOTES, planState, say, STATE_LIMIT, type Step } from './director.ts';
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

describe('the notes', () => {
  test('every note fits its limit', () => {
    for (const note of NOTES) expect(note.length).toBeLessThanOrEqual(NOTE_LIMIT);
  });

  test('the app gives the avatar a job and never a name', () => {
    // The face and the voice are the avatar's. An invented name had the prompt
    // saying "You are Nora" while the screen showed someone else.
    const all = NOTES.join(' ');
    expect(all).toContain('architect');
    expect(all).toContain('Keep your own name');
    expect(all).not.toMatch(/\bNora\b|persona_name/);
  });

  test('the notes forbid claiming compliance', () => {
    // Codes differ by country, building type and new-build versus refurb; a
    // client who hears "that meets Part M" and builds on it has been misled.
    const all = NOTES.join(' ');
    expect(all).toContain('Never say a plan is "compliant"');
    expect(all).toContain('good practice');
  });

  test('the notes tell the avatar it does not make changes, and never to confirm a refused one', () => {
    const all = NOTES.join(' ');
    expect(all).toContain('You cannot change the plan yourself');
    expect(all).toContain('never confirm a change the app refused');
    expect(all).toContain('never ask the client for x and y');
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
    expect(text).toContain('square metres');
    expect(text).toMatch(/north|south|east|west|centre/);
    expect(text).not.toMatch(/x_cm|y_cm|\bx=|\by=/);
    for (const room of p.home.level.rooms.values()) expect(text).toContain(room.name);
    expect(text.length).toBeLessThanOrEqual(STATE_LIMIT);
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

  test('what undo would take back is staged, so "undo" can be answered at once', () => {
    const p = twoBed();
    const level = p.home.level;
    const living = [...level.rooms.values()].find((r) => r.kind === 'living')!;
    p.apply({ kind: 'rename_room', id: living.id, name: 'Snug' });
    expect(planState(p.snapshot())).toContain('Last change: renamed the living room to Snug');
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

describe('the events', () => {
  test('a spoken change is told with its real numbers', () => {
    const p = new Planner(800, 600);
    p.home.level.placeRoom('office', [0, 0, 400, 600], 'Study');
    p.home.level.placeRoom('living', [400, 0, 800, 600], 'Living room');
    const s = step(p, { kind: 'trade_area', from: 'study', to: 'living room', m2: 1.2 });
    const [event] = eventsFor('spoken', [s], [], p.snapshot());
    expect(event.text).toContain('1.2 square metres moved from the study to the living room');
    expect(event.text).toContain('the living room 25.2 square metres');
    expect(event.text).toContain('the study 22.8 square metres');
  });

  test('a laid-out floor hands the avatar something to say, not a status', () => {
    const p = new Planner();
    const [event] = eventsFor('spoken', [step(p, { kind: 'generate', bedrooms: 2 })], [], p.snapshot());
    expect(event.text).toContain('Say one short line');
    expect(event.text).toContain('Day end, night end');
  });

  test('the floor size is told in the metres it became', () => {
    const p = new Planner();
    const [event] = eventsFor('typed', [step(p, { kind: 'set_envelope', w: 800, h: 600 })], [], p.snapshot());
    expect(event.text).toContain('8 by 6 metres');
  });

  test('a refusal carries the plan\'s reason and forbids confirming it', () => {
    const p = new Planner();
    const s = step(p, { kind: 'add_item', type: 'chaise longue' });
    const [event] = eventsFor('spoken', [s], [], p.snapshot());
    expect(event.text).toContain('the plan refused it');
    expect(event.text).toContain('chaise longue');
    expect(event.text).toContain('do NOT describe it as done');
  });

  test('when part of a request fails, the event says which part', () => {
    const p = twoBed();
    const steps = [step(p, { kind: 'save_scheme', name: 'A' }), step(p, { kind: 'add_item', type: 'hovercraft' })];
    const [event] = eventsFor('spoken', steps, [], p.snapshot());
    expect(event.text).toContain('First the app did this: the plan is saved as scheme "A"');
    expect(event.text).toContain('Then the client asked to add a hovercraft');
  });

  test('a spoken change does not get the complaint twice', () => {
    // The designer once said the same thing about one change twice: in the
    // line the change asked for, and from the critic a beat later.
    const p = twoBed();
    const critic = new Critic();
    critic.look(issues(p.home));
    const level = p.home.level;
    const victim = [...level.rooms.values()].find((r) => !r.spec.circulation)!;
    const door = level.openings.find((o) => o.kind === 'door' && (o.a === victim.id || o.b === victim.id))!;
    const s = step(p, { kind: 'remove_opening', id: door.id });
    const fresh = critic.look(issues(p.home));
    const events = eventsFor('spoken', [s], fresh, p.snapshot());
    expect(events).toHaveLength(1);
    expect(events[0].text).toContain('created a problem');
  });

  test('a panel change is still critiqued out loud, and small edits are not narrated', () => {
    // A drag has no request behind it, so the critic is the only voice there is.
    const p = twoBed();
    const critic = new Critic();
    critic.look(issues(p.home));
    const level = p.home.level;
    const victim = [...level.rooms.values()].find((r) => !r.spec.circulation)!;
    const door = level.openings.find((o) => o.kind === 'door' && (o.a === victim.id || o.b === victim.id))!;
    const s = step(p, { kind: 'remove_opening', id: door.id });
    const events = eventsFor('panel', [s], critic.look(issues(p.home)), p.snapshot());
    expect(events).toHaveLength(1);
    expect(events[0].text).toContain('created a problem');
    expect(eventsFor('panel', [step(p, { kind: 'set_unit', unit: 'ft2' })], [], p.snapshot())).toEqual([]);
  });

  test('a milestone from the panel is told, since the avatar cannot see the click', () => {
    const p = new Planner();
    const [event] = eventsFor('panel', [step(p, { kind: 'generate', bedrooms: 1 })], [], p.snapshot());
    expect(event.text).toContain('The client used the panel: the ground floor is laid out');
  });

  test('the critic names one issue, never a list', () => {
    const cue = issueCue({ kind: 'corridor', room: 'r1', note: 'The hall narrows to 80 cm — two people can\'t pass' }, 3);
    expect(cue).toContain('The hall narrows to 80 cm');
    expect(cue).toContain('mention only this one');
    expect(cue).toContain('under 25 words');
  });

  test('undo is told as going back, not as a new change', () => {
    const p = twoBed();
    const [event] = eventsFor('spoken', [step(p, { kind: 'undo' })], [], p.snapshot());
    expect(event.text).toContain('the last change (laid out the ground floor (day end, night end)) is taken back');
    expect(event.text).toContain('It is not a new change');
  });

  test('the opening asks the two things a sketch needs', () => {
    const text = say.opening(new Planner().snapshot());
    expect(text).toContain('roughly how big the place is');
    expect(text).toContain('how many bedrooms');
  });

  test('a photo is told by what the app added, and never by guessed sizes', () => {
    const text = say.photo('room', ['a 3-seat sofa in the living room', 'a rug in the living room'], [], 'a small living room');
    expect(text).toContain('You cannot see it');
    expect(text).toContain('never guess a measurement');
  });
});
