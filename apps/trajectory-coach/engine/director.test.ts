// What the host is told: the tools and instructions against the API's limits
// and the rules the original paid for; the live range (the numbers and never
// the polyline, nothing about a shot still in the air, a lesson only once
// earned); and the texts it speaks from.
import { describe, expect, test } from 'vitest';
import { CHALLENGES } from './challenges.ts';
import { INSTRUCTIONS, TOOLS, pressed, rangeState, said } from './director.ts';
import { Launcher, MAX_HISTORY } from './launcher.ts';

describe('the tools and the instructions fit the API', () => {
  test('names, count, descriptions, schemas, all await within 28 s', () => {
    expect(TOOLS.length).toBeLessThanOrEqual(30);
    const names = TOOLS.map((t) => t.name);
    expect(names).toEqual(['aim', 'fire', 'choose_challenge', 'start_over']);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of TOOLS) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
      expect(['web_search', 'lookup']).not.toContain(tool.name);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeLessThanOrEqual(500);
      expect(tool.parameters.type).toBe('object');
      expect(JSON.stringify(tool.parameters).length).toBeLessThanOrEqual(4096);
      expect(tool['x-atmee']?.mode).toBe('await');
      expect(tool['x-atmee']!.timeoutSeconds!).toBeLessThanOrEqual(28);
    }
    expect(JSON.stringify(TOOLS).length).toBeLessThanOrEqual(24576);
  });

  test('fire waits long enough for the longest flight the page plays, and the aim words for the model', () => {
    const timeout = (name: string) => TOOLS.find((t) => t.name === name)!['x-atmee']!.timeoutSeconds!;
    expect(timeout('fire')).toBeGreaterThanOrEqual(10);   // 2.5 s of play + slack, with room to spare
    expect(timeout('aim')).toBeGreaterThanOrEqual(12);    // a 6 s model call, then perhaps a shot
  });

  test('the schemas are lenient: the platform refuses a misfit before the page can read it', () => {
    // Live (another app): "Beginner, please." failed an enum, never reached the
    // page, and the host said it had been done. The page reads loose values itself.
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      for (const key of ['enum', 'pattern', 'format', 'minLength']) expect(o, key).not.toHaveProperty(key);
      expect(o.additionalProperties).not.toBe(false);
      if (typeof o.maxLength === 'number') expect(o.maxLength).toBeGreaterThanOrEqual(500);
      for (const v of Object.values(o)) walk(v);
    };
    for (const tool of TOOLS) walk(tool.parameters);
    const required = Object.fromEntries(TOOLS.map((t) => [t.name, (t.parameters as { required?: string[] }).required ?? []]));
    expect(required).toEqual({ aim: [], fire: [], choose_challenge: ['challenge'], start_over: [] });
    const challenge = (TOOLS.find((t) => t.name === 'choose_challenge')!.parameters as { properties: { challenge: { description: string } } }).properties.challenge;
    for (const c of CHALLENGES) expect(challenge.description).toContain(c.id);
    expect(challenge.description).toContain('"next"');
  });

  test('what resets the range is called only when the student asks', () => {
    for (const name of ['choose_challenge', 'start_over']) expect(TOOLS.find((t) => t.name === name)!.description).toContain('never on your own');
  });

  test('the instructions fit, name every tool and keep the rules the original paid for', () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(4000);
    for (const tool of TOOLS) expect(INSTRUCTIONS).toContain(tool.name);
    const rules = INSTRUCTIONS.toLowerCase();
    // "you need to aim first" while the launcher sat aimed (four times in one session)
    expect(rules).toContain('never tell them to set an aim first');
    // "the angle is now thirty degrees" right after they said thirty
    expect(rules).toContain('never repeat numbers they just said');
    // "do you want to send it?" after nearly every turn
    expect(rules).toContain('never end a turn by asking whether to fire');
    // numbers quoted, not recomputed; a shot in the air is not guessed, nor one not yet fired
    expect(rules).toContain('exactly as written');
    expect(rules).toContain('never guess where a shot will land');
    expect(rules).toContain('never predict whether the shot will clear');
    // never clamped: "try ninety" is refused by the range, with the numbers
    expect(rules).toContain('even outside the limits');
    // live: "Start over." got no call and "I've wiped the board clean"; "Fire!" during the welcome got none
    expect(rules).toContain('every request that changes the screen is a tool call');
    expect(rules).toContain('never say an action happened');
    expect(rules).toContain('even said while you are still talking');
  });
});

describe('the live range', () => {
  test('a shot in the air is described without its result', () => {
    const l = new Launcher();
    l.fire();
    const state = rangeState(l.snapshot());
    expect(state).toContain('in the air');
    for (const spoiler of ['40.77', '10.19', 'below the top', 'CLEARED', 'missed by']) expect(state, spoiler).not.toContain(spoiler);
  });

  test("a landed shot carries its numbers and the range's sentence verbatim, never the polyline", () => {
    const l = new Launcher();
    l.fire();
    const shot = l.land();
    const state = rangeState(l.snapshot());
    expect(state).toContain('40.77');
    expect(state).toContain('10.19');
    expect(state).toContain(`"${shot.note}"`);
    expect(state).toContain('missed by 2.24 m');
    expect(state).not.toMatch(/path|\[\[/);
  });

  test('conditions that are not Earth-normal are named', () => {
    expect(rangeState(new Launcher('headwind').snapshot())).toContain('6 m/s headwind');
    expect(rangeState(new Launcher('moonshot').snapshot())).toContain('gravity of 1.62');
    expect(rangeState(new Launcher('ceiling').snapshot())).toContain('without going above 6 m');
  });

  test('the limits are on the board, so "what can it do?" needs no tool', () => {
    expect(rangeState(new Launcher().snapshot())).toContain('5 to 85 degrees, 5 to 40 metres a second');
    expect(rangeState(new Launcher('maxrange').snapshot())).toContain('5 to 18 metres a second');
  });

  test('the six challenges are listed, with how to put one up', () => {
    const state = rangeState(new Launcher().snapshot());
    for (const c of CHALLENGES) expect(state).toContain(`${c.name}: ${c.blurb}`);
    expect(state).toContain('call choose_challenge');
    expect(state).toContain('Challenge 1 of 6: Clear the wall');
  });

  test('a teaching point appears only once it is earned', () => {
    const l = new Launcher();
    expect(rangeState(l.snapshot())).not.toContain(CHALLENGES[0].teach);
    l.setAim(45, 24);
    l.fire();
    expect(rangeState(l.snapshot())).not.toContain(CHALLENGES[0].teach);   // cleared, but still in the air
    l.land();
    expect(rangeState(l.snapshot())).toContain(CHALLENGES[0].teach);
    for (const other of CHALLENGES.slice(1)) expect(rangeState(l.snapshot())).not.toContain(other.teach);
  });

  test('the busiest range, on every challenge, stays under 3,858 characters', () => {
    for (const c of CHALLENGES) {
      const l = new Launcher(c.id);
      const cleared = () => l.snapshot().catalog.some((e) => e.id === c.id && e.cleared);
      // Clear it first, so the teaching point rides along with a full history.
      for (let a = 5; a <= 85 && !cleared(); a += 1)
        for (let v = 5; v <= c.speed_max && !cleared(); v += 1) { l.setAim(a, v); l.fire(); l.land(); }
      expect(cleared(), c.id).toBe(true);
      for (let i = 0; i < MAX_HISTORY + 2; i++) { l.setAim(20 + i * 5, c.speed_max); l.fire(); l.land(); }
      for (const state of [rangeState(l.snapshot()), (l.fire(), rangeState(l.snapshot()))]) expect(state.length, c.id).toBeLessThan(3858);
    }
  });
});

describe('what the host speaks from', () => {
  test('the opening describes the challenge that is actually up', () => {
    // The original's hand-typed greeting described the wall to a student
    // looking at the Moon. Every figure comes from the snapshot the page draws.
    const wall = said.opening(new Launcher('wall40').snapshot());
    expect(wall).toContain('Clear the wall');
    expect(wall).toContain('forty metres out');
    const moon = said.opening(new Launcher('moonshot').snapshot());
    expect(moon).toContain('On the Moon');
    expect(moon.toLowerCase()).not.toContain('wall');
    expect(moon.toLowerCase()).toContain('drag the arrow');
    // The host's own greeting already introduced him: no second one.
    expect(wall).toMatch(/^You have just greeted them; do not greet or introduce yourself again\./);
    expect(wall.toLowerCase()).not.toContain('welcome');
  });

  test('every result starts with its plain outcome, before any filler could pre-judge it', () => {
    const l = new Launcher();
    const s = l.snapshot();
    const results = [
      said.aimed(s), said.stepped(s, s, { angle: true, speed: false }), said.aimRefused('90 is off the rail.', s), said.noAim(), said.unreadable('welly'),
      said.fireRefused("It's already in the air."), said.cancelled(s), said.challenge(s), said.alreadyUp(s), said.unknownChallenge('dragon'),
      said.refused('No.'), said.reset(s),
    ];
    l.fire(); l.land();
    results.push(said.landed(l.snapshot()), said.joined(said.landed(l.snapshot())), said.aimedAndFired(l.snapshot(), said.landed(l.snapshot())));
    for (const text of results) expect(text, text).toMatch(/^(Done|Refused|Nothing moved|Not fired|Not landed|Already up|Not done|Landed, (missed|cleared)):/);
  });

  test("a miss is said in the range's own words, then one change; later misses ask why", () => {
    const l = new Launcher();
    l.fire();
    const shot = l.land();
    const first = said.landed(l.snapshot());
    expect(first).toContain(`"${shot.note}"`);
    expect(first).toContain('without changing a single number');
    expect(first).toContain('one specific change');
    l.fire(); l.land(); l.fire(); l.land();
    expect(said.landed(l.snapshot())).toContain('explain WHY');
  });

  test('a clear gets the result and the teaching point, and the next challenge only if they want it', () => {
    const l = new Launcher();
    l.setAim(45, 24);
    l.fire();
    l.land();
    const line = said.landed(l.snapshot());
    expect(line).toMatch(/^Landed, cleared: /);
    expect(line).toContain('Over with 9.75 m to spare');
    expect(line).toContain('Forty-five degrees maximises range');
    // A result never has the host act on its own: Postmark's host once started a new game unasked.
    expect(line).toContain('put it up only if they say so');
  });

  test('clearing the sixth points to the logbook instead of a next challenge', () => {
    const l = new Launcher();
    const winning: Record<string, [number, number]> = { wall40: [45, 24], zone30: [45, 17.2], maxrange: [45, 18], headwind: [20, 34], ceiling: [20, 30], moonshot: [45, 9.9] };
    for (const c of CHALLENGES) { l.startChallenge(c.id); l.setAim(...winning[c.id]); l.fire(); l.land(); }
    expect(l.snapshot().catalog.every((e) => e.cleared)).toBe(true);
    const line = said.landed(l.snapshot());
    expect(line).toContain('all six');
    expect(line).toContain('logbook');
    expect(line).not.toContain('next challenge');
  });

  test('an aim from their numbers is not read back; one from words names the new value; neither predicts nor asks', () => {
    // The original's aim cue once ended "and ask if they want to send it",
    // which is why the coach asked that after almost every turn. Live, "a bit
    // steeper" got "way more arc to sail right over the wall!" before any shot.
    const l = new Launcher();
    const before = l.snapshot();
    const own = said.aimed(before);
    expect(own).toContain('without repeating their numbers');
    l.setAim(48, null);
    const stepped = said.stepped(l.snapshot(), before, { angle: true, speed: false });
    expect(stepped).toMatch(/^Done: moved the angle from 45 to 48 degrees\./);
    expect(stepped).toContain('Tell them the new angle once');
    for (const cue of [own, stepped]) {
      expect(cue).toContain('Do not predict whether it will clear');
      expect(cue).toContain('do not ask whether to fire');
    }
  });

  test('a refused aim keeps the numbers and says the launcher did not move', () => {
    const l = new Launcher();
    const text = said.aimRefused('The launcher only elevates between 5 and 85 degrees — 90 is off the rail.', l.snapshot());
    expect(text).toContain('90 is off the rail');
    expect(text).toContain('did not move');
    expect(text).toContain('45 degrees and 20 metres a second');
  });

  test('a challenge is set up with its conditions, and never with an angle', () => {
    const text = said.challenge(new Launcher('headwind').snapshot());
    expect(text).toMatch(/^Done: Into the headwind is up/);
    expect(text).toContain('6 m/s headwind');
    expect(text).toContain('Never suggest an angle');
  });

  test('what the student did on screen is told as what they did, then the outcome', () => {
    expect(pressed('pressed Fire', 'The shot landed.')).toBe('The student pressed Fire on screen. The shot landed.');
  });
});
