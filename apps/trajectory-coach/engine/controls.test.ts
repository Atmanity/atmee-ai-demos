// The range's controls: what each tool does and returns, what each button
// does and tells the host, and the one account of every landing.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CHALLENGES } from './challenges.ts';
import { Controls, NET_GRACE_MS, type Interpret } from './controls.ts';
import { Launcher } from './launcher.ts';
import { Range } from './range.ts';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function setup(challenge?: string, interpret?: Interpret) {
  const range = new Range(new Launcher(challenge));
  const told: string[] = [];
  const refusals: string[] = [];
  const controls = new Controls(range, { tell: (text) => told.push(text), refused: (r) => refusals.push(r), interpret, now: () => Date.now() });
  const land = () => vi.advanceTimersByTime(3_000);
  /** A tool call whose promise is watched, so a test can see whether it has resolved yet. */
  const call = (name: string, args: Record<string, unknown> = {}, by: 'host' | 'net' = 'host') => {
    const out = { text: undefined as string | undefined, error: undefined as Error | undefined };
    const done = controls.tool(name, args, by).then((t) => { out.text = t; }, (e: Error) => { out.error = e; });
    return { out, done };
  };
  return { range, controls, told, refusals, land, call };
}

describe('fire: the host hears where it landed, in the first reply', () => {
  test('the result waits for the ball to come down, and carries the range\'s sentence', async () => {
    const { range, told, land, call } = setup();
    const { out, done } = call('fire');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(range.snapshot().phase).toBe('flying');
    expect(out.text).toBeUndefined();   // still in the air: nothing to say yet
    land();
    await done;
    expect(out.text).toMatch(/^Landed, missed: "You were at 0\.76 m going past 40 m, 2\.24 m below the top\./);
    expect(out.text).toContain('one specific change');
    expect(told).toEqual([]);           // the tool result is the one account of it
  });

  test('a shot from the Fire button is told once, when it lands, not when it goes', () => {
    const { controls, told, land } = setup();
    controls.press({ kind: 'fire' });
    expect(told).toEqual([]);
    land();
    expect(told).toHaveLength(1);
    expect(told[0]).toMatch(/^The student pressed Fire on screen\. Landed, missed: "You were at 0\.76 m/);
  });

  test('"fire" said while the button\'s shot flies joins it: one shot, one account', async () => {
    const { controls, range, told, land, call } = setup();
    controls.press({ kind: 'fire' });
    const { out, done } = call('fire');
    land();
    await done;
    expect(out.text).toMatch(/^Landed, missed: .*already in the air when you called fire/);
    expect(told).toEqual([]);
    expect(range.snapshot().attempts).toBe(1);
  });

  test('a challenge changed while it flies: the waiting call hears it never landed', async () => {
    const { controls, land, call } = setup();
    const { out, done } = call('fire');
    controls.press({ kind: 'challenge', id: 'moonshot' });
    await done;
    expect(out.text).toMatch(/^Not landed: .*On the Moon/);
    land();
    expect(out.text).toMatch(/^Not landed/);
  });
});

describe('aim: the exact numbers, the app\'s steps for words, never clamped', () => {
  test('numbers move the launcher; the result has an opinion and no question', async () => {
    const { range, call } = setup();
    const { out, done } = call('aim', { angle_deg: 40 });
    await done;
    expect(range.snapshot().aim).toEqual({ angle_deg: 40, speed_ms: 20 });   // only what was said changes
    expect(out.text).toMatch(/^Done: the launcher is at 40 degrees and 20 metres a second, as they asked/);
    expect(out.text).toContain('without repeating their numbers');
  });

  test('"try ninety" is refused with the numbers, shown on screen, and nothing moves', async () => {
    const { range, refusals, call } = setup();
    const { out, done } = call('aim', { angle_deg: 90 });
    await done;
    expect(out.text).toContain('90 is off the rail');
    expect(out.text).toContain('did not move');
    expect(refusals).toEqual(['The launcher only elevates between 5 and 85 degrees — 90 is off the rail.']);
    expect(range.snapshot().aim).toEqual({ angle_deg: 45, speed_ms: 20 });
  });

  test('a capped launcher refuses a speed past its cap, with the cap', async () => {
    const { call } = setup('maxrange');
    const { out, done } = call('aim', { speed_ms: 25 });
    await done;
    expect(out.text).toContain('5 to 18 metres a second');
  });

  test('words with no number go through the range\'s own steps', async () => {
    const { range, call } = setup();
    const steeper = call('aim', { request: 'a bit steeper' });
    await steeper.done;
    expect(range.snapshot().aim.angle_deg).toBe(48);
    expect(steeper.out.text).toMatch(/^Done: moved the angle from 45 to 48 degrees\./);
    await call('aim', { request: 'more power' }).done;
    expect(range.snapshot().aim.speed_ms).toBe(22);
  });

  test('what the rules cannot read goes to the app\'s model; without one, the host asks for a number', async () => {
    const model = vi.fn<Interpret>(async () => ({ kind: 'aim', angle_deg: 70 }));
    const withModel = setup(undefined, model);
    await withModel.call('aim', { request: 'lob it like a mortar' }).done;
    expect(model).toHaveBeenCalledWith('lob it like a mortar', { aim: { angle_deg: 45, speed_ms: 20 }, limits: { angle: [5, 85], speed: [5, 40] }, challengeId: 'wall40' });
    expect(withModel.range.snapshot().aim.angle_deg).toBe(70);

    const without = setup();
    const { out, done } = without.call('aim', { request: 'give it some welly' });
    await done;
    expect(out.text).toContain('could not read "give it some welly"');
    expect(without.range.snapshot().aim).toEqual({ angle_deg: 45, speed_ms: 20 });
  });

  test('a model that answers something other than an aim moves nothing', async () => {
    const { range, call } = setup(undefined, async () => ({ kind: 'challenge', id: 'moonshot' }));
    const { out, done } = call('aim', { request: 'the lunar thing' });
    await done;
    expect(out.text).toContain('could not read');
    expect(range.snapshot().challenge.id).toBe('wall40');
  });

  test('nothing to go on: nothing moves, and the host asks', async () => {
    const { call } = setup();
    const { out, done } = call('aim', {});
    await done;
    expect(out.text).toMatch(/^Nothing moved: /);
  });

  test('"forty-five at twenty-four and fire": aimed, fired, and the landing in one result', async () => {
    const { range, land, call } = setup();
    const { out, done } = call('aim', { angle_deg: 45, speed_ms: 24, then_fire: true });
    land();
    await done;
    expect(out.text).toMatch(/^Landed, cleared: "Over with 9\.75 m to spare/);
    expect(out.text).toContain('The shot went at 45 degrees and 24 metres a second');
    expect(range.snapshot().attempts).toBe(1);
  });

  test('the same, said as words', async () => {
    const { range, land, call } = setup();
    const { out, done } = call('aim', { request: 'a bit flatter and fire' });
    land();
    await done;
    expect(range.snapshot().last_shot?.angle_deg).toBe(42);
    expect(out.text).toMatch(/^Landed, missed: /);
  });

  test('a refused aim takes no shot', async () => {
    const { range, call } = setup();
    const { out, done } = call('aim', { angle_deg: 95, then_fire: true });
    await done;
    expect(out.text).toContain('off the rail');
    expect(range.snapshot().attempts).toBe(0);
  });

  test('the launcher does not move while a shot is in the air', async () => {
    const { range, call } = setup();
    void call('fire');
    const { out, done } = call('aim', { angle_deg: 30 });
    await done;
    expect(out.text).toMatch(/^Refused: .*still in the air/);
    expect(range.snapshot().aim.angle_deg).toBe(45);
  });
});

describe('loose arguments: the schemas are lenient, so the range reads what arrives', () => {
  test('a challenge in any case, by name, by nickname, or "next" in other words; extra fields ignored', async () => {
    const { range, call } = setup();
    for (const [value, id] of [
      ['Moonshot', 'moonshot'], ['On the Moon', 'moonshot'], ['the windy one', 'headwind'], ['  ROOF ', 'ceiling'],
      ['Land in the Zone', 'zone30'], ['max range', 'maxrange'], ['the wall', 'wall40'],
    ] as const) {
      const r = call('choose_challenge', { challenge: value, why: 'they asked' });
      await r.done;
      expect(range.snapshot().challenge.id, value).toBe(id);
      expect(r.out.text, value).toMatch(/^(Done|Already up):/);
    }
    await call('choose_challenge', { challenge: 'Next one' }).done;
    expect(range.snapshot().challenge.id).toBe('zone30');
    await call('choose_challenge', { challenge: 'a different challenge' }).done;
    expect(range.snapshot().challenge.id).toBe('maxrange');
  });

  test('an unusable challenge, or none, is a question for the host to ask, never silence', async () => {
    const { range, call } = setup();
    for (const args of [{ challenge: 'the dragon' }, { challenge: '' }, {}, { challenge: 'the' }]) {
      const r = call('choose_challenge', args);
      await r.done;
      expect(r.out.text, JSON.stringify(args)).toMatch(/^Not done: .*Ask which one they want\.$/);
    }
    expect(range.snapshot().challenge.id).toBe('wall40');
  });

  test('numbers as strings, with units, or in words; then_fire as "true"; extra fields ignored', async () => {
    const { range, land, call } = setup();
    await call('aim', { angle_deg: '40', note: 'extra' }).done;
    expect(range.snapshot().aim).toEqual({ angle_deg: 40, speed_ms: 20 });
    await call('aim', { angle_deg: '35°', speed_ms: '22 m/s' }).done;
    expect(range.snapshot().aim).toEqual({ angle_deg: 35, speed_ms: 22 });
    await call('aim', { angle_deg: 'forty-five' }).done;
    expect(range.snapshot().aim.angle_deg).toBe(45);
    await call('aim', { speed_ms: 'twenty four' }).done;
    expect(range.snapshot().aim.speed_ms).toBe(24);
    const fired = call('aim', { angle_deg: 45, then_fire: 'true' });
    land();
    await fired.done;
    expect(fired.out.text).toMatch(/^Landed, cleared: /);
  });

  test('extra fields on the tools with no arguments are ignored too', async () => {
    const { range, land, call } = setup();
    const r = call('fire', { reason: 'they said fire' });
    land();
    await r.done;
    expect(range.snapshot().attempts).toBe(1);
    await call('start_over', { confirm: true }).done;
    expect(range.snapshot().attempts).toBe(0);
  });
});

describe('choose_challenge and start_over', () => {
  test('a challenge goes up with its conditions; the one already up is left alone', async () => {
    const { range, call, land } = setup();
    void call('fire'); land(); await vi.runAllTimersAsync();
    const same = call('choose_challenge', { challenge: 'wall40' });
    await same.done;
    expect(same.out.text).toMatch(/^Already up: Clear the wall is on the range/);
    expect(range.snapshot().attempts).toBe(1);   // its scoreboard kept

    const moon = call('choose_challenge', { challenge: 'moonshot' });
    await moon.done;
    expect(moon.out.text).toMatch(/^Done: On the Moon is up/);
    expect(moon.out.text).toContain('gravity of 1.62');
    expect(range.snapshot().challenge.id).toBe('moonshot');
  });

  test('"next" moves along the list and wraps; an unknown name lists the six', async () => {
    const { range, call } = setup('moonshot');
    await call('choose_challenge', { challenge: 'next' }).done;
    expect(range.snapshot().challenge.id).toBe('wall40');
    const dragon = call('choose_challenge', { challenge: 'dragon' });
    await dragon.done;
    expect(dragon.out.text).toMatch(/^Not done: there is no "dragon" challenge/);
    for (const c of CHALLENGES) expect(dragon.out.text).toContain(c.name);
  });

  test('a late "next" from the host after the safety net already moved on is the same request', async () => {
    const { range, call } = setup();
    await call('choose_challenge', { challenge: 'zone30' }, 'net').done;
    const late = call('choose_challenge', { challenge: 'next' });
    await late.done;
    expect(late.out.text).toContain('Already up: Land in the zone is on the range');
    expect(range.snapshot().challenge.id).toBe('zone30');
    vi.advanceTimersByTime(NET_GRACE_MS);
    await call('choose_challenge', { challenge: 'next' }).done;
    expect(range.snapshot().challenge.id).toBe('maxrange');
  });

  test('start_over clears the scoreboard and says where the launcher is', async () => {
    const { range, call, land } = setup();
    await call('aim', { angle_deg: 30 }).done;
    void call('fire'); land(); await vi.runAllTimersAsync();
    const reset = call('start_over');
    await reset.done;
    expect(reset.out.text).toMatch(/^Done: Clear the wall is clear/);
    expect(reset.out.text).toContain('45 degrees and 20 metres a second');
    expect(range.snapshot().attempts).toBe(0);
    expect(range.snapshot().history).toEqual([]);
  });

  test('an unknown tool is an error the host hears', async () => {
    const { call } = setup();
    const { out, done } = call('launch_the_moon');
    await done;
    expect(out.error?.message).toContain('unknown tool');
  });
});

describe('the safety net does not take a second shot', () => {
  test('a shot that went up around the words (Fire pressed while saying it) was the one they meant', async () => {
    const { controls, range, land, call } = setup();
    controls.press({ kind: 'fire' });
    land();
    vi.advanceTimersByTime(4_000);
    const net = call('fire', {}, 'net');
    await net.done;
    expect(net.out.error).toBeDefined();
    expect(range.snapshot().attempts).toBe(1);
  });

  test('with no shot near the words, the net fires and gets the landing', async () => {
    const { range, land, call } = setup();
    const net = call('fire', {}, 'net');
    land();
    await net.done;
    expect(net.out.text).toMatch(/^Landed, missed/);
    expect(range.snapshot().attempts).toBe(1);
  });
});

describe('the student\'s hands', () => {
  test('the arrow and the steppers move the launcher and tell the host nothing (the board shows it)', () => {
    const { controls, range, told } = setup();
    controls.press({ kind: 'aim', angle_deg: 38, speed_ms: 21 });
    expect(range.snapshot().aim).toEqual({ angle_deg: 38, speed_ms: 21 });
    expect(told).toEqual([]);
  });

  test('a challenge picked on screen is told with its setup; the one already up does nothing', () => {
    const { controls, told } = setup();
    expect(controls.press({ kind: 'challenge', id: 'wall40' })).toBeNull();
    controls.press({ kind: 'challenge', id: 'headwind' });
    expect(told).toEqual([expect.stringMatching(/^The student picked "Into the headwind" on screen\. Done: Into the headwind is up/)]);
  });

  test('Next challenge and Start over are told too', () => {
    const { controls, told } = setup();
    controls.press({ kind: 'next' });
    controls.press({ kind: 'reset' });
    expect(told[0]).toMatch(/^The student pressed "Next challenge" on screen\. Done: Land in the zone is up/);
    expect(told[1]).toMatch(/^The student pressed "Start over" on screen\. Done: Land in the zone is clear/);
  });

  test('Fire while a shot is up does nothing', () => {
    const { controls, range } = setup();
    controls.press({ kind: 'fire' });
    expect(controls.press({ kind: 'fire' })).toBeNull();
    expect(range.snapshot().attempts).toBe(1);
  });
});
