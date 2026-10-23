import { describe, expect, test } from 'vitest';
import {
  FIRE_PHRASES, commandFromModel, commandIn, intentsFor, interpretPrompt, isFireRequest, mustDo, nextChallengeId, normalize, worthAsking, type JudgeContext,
} from './judge.ts';
import { Launcher } from './launcher.ts';
import { Range } from './range.ts';
import type { Command } from './types.ts';

const onWall: JudgeContext = { aim: { angle_deg: 45, speed_ms: 20 }, limits: { angle: [5, 85], speed: [5, 40] }, challengeId: 'wall40' };
const said = (text: string, ctx = onWall) => commandIn(text, ctx);

// ---- "fire" is decided in code (the FireWatch tests from test_table.py) ----

describe('fire: the whole utterance and nothing else', () => {
  test('saying fire takes the shot without anybody agreeing to', () => {
    // Found by playing the original, twice: its model would not call the
    // `fire` tool; four plain requests came back with an invented "you need to
    // aim first" while the launcher sat aimed with the numbers on screen.
    const range = new Range(new Launcher());
    const command = said('fire');
    expect(command).toEqual({ kind: 'fire' });
    for (const intent of intentsFor(command!)) range.apply(intent, 'host');
    expect(range.snapshot().phase).toBe('flying');
    expect(range.snapshot().attempts).toBe(1);
    range.dispose();
  });

  test('every phrase of the original fires, courtesies and punctuation aside', () => {
    for (const phrase of FIRE_PHRASES) expect(isFireRequest(phrase), phrase).toBe(true);
    for (const text of ['Fire!', 'Send it.', 'OK, fire.', 'please fire now', 'Just let it go!', 'ok please fire', 'Fire away!', 'Alright, take the shot then.'])
      expect(isFireRequest(text), text).toBe(true);
    for (const text of ['Coach, fire!', 'Okay so, fire.', 'and fire', 'Again!', 'Same again.', 'One more time', 'try again']) expect(said(text), text).toEqual({ kind: 'fire' });
  });

  test('a question about firing is left to the avatar', () => {
    // A rule that also matched "should I fire flatter?" would take a shot the
    // person was only asking about: worse than the bug it fixes.
    for (const text of ['why did that miss?', 'should I fire flatter?', 'what if I fire now', 'did it fire?', 'I fired too low', "don't fire", 'no, fire', 'wait, fire'])
      expect(said(text), text).not.toEqual({ kind: 'fire' });
  });

  test('firing twice does not fire twice', () => {
    // The second "fire" still reaches the avatar (it answers from a state that
    // says the shot is in the air); what it must not do is put up a second shot.
    const range = new Range(new Launcher());
    expect(range.apply({ kind: 'fire' }, 'host').applied).toBe(true);
    const again = range.apply({ kind: 'fire' }, 'host');
    expect(again).toEqual({ applied: false, reason: "It's already in the air." });
    expect(range.snapshot().attempts).toBe(1);
    range.dispose();
  });
});

// ---- aims -------------------------------------------------------------------

describe('aims, as people say them', () => {
  const aim = (angle?: number, speed?: number, thenFire?: boolean): Command => ({
    kind: 'aim', ...(angle !== undefined && { angle_deg: angle }), ...(speed !== undefined && { speed_ms: speed }), ...(thenFire && { thenFire }),
  });
  const cases: [string, Command][] = [
    // absolute: only what was said changes ("try forty degrees" is an angle and no speed)
    ['Try forty degrees.', aim(40)], ['try 40°', aim(40)], ['Forty-five degrees', aim(45)], ['try 40', aim(40)], ['Try forty.', aim(40)],
    ['How about thirty?', aim(30)], ['set the angle to sixty', aim(60)], ['angle 35', aim(35)], ['aim at 40', aim(40)],
    ['22 metres per second', aim(undefined, 22)], ['speed thirty', aim(undefined, 30)], ['twelve and a half metres a second', aim(undefined, 12.5)],
    ['forty point five degrees', aim(40.5)], ['Let\'s go with twenty-two m/s', aim(undefined, 22)],
    // pairs: "angle at speed"
    ['Twenty-five at thirty.', aim(25, 30)], ['45 at 24', aim(45, 24)], ['forty degrees at twenty two metres a second', aim(40, 22)],
    ['40 degrees at 20', aim(40, 20)], ['20 m/s at 40 degrees', aim(40, 20)], ['thirty degrees, twenty-five metres per second', aim(30, 25)],
    // relative: fixed steps from the current aim (45°, 20 m/s)
    ['Make it steeper.', aim(50)], ['A bit steeper', aim(48)], ['much steeper', aim(55)], ['flatter', aim(40)], ['a little flatter please', aim(42)],
    ['aim higher', aim(50)], ['lower the angle', aim(40)], ['bring it down a touch', aim(42)],
    ['A bit more speed.', aim(undefined, 21)], ['more power', aim(undefined, 22)], ['harder', aim(undefined, 22)], ['a bit harder', aim(undefined, 21)],
    ['slower', aim(undefined, 18)], ['lower the speed', aim(undefined, 18)], ['give it a lot more speed', aim(undefined, 25)],
    ['steeper and faster', aim(50, 22)], ['Can you make it a bit steeper?', aim(48)],
    // explicit steps
    ['five degrees steeper', aim(50)], ['up 10', aim(55)], ['two metres a second faster', aim(undefined, 22)], ['5 more degrees', aim(50)],
    ['steeper by ten', aim(55)], ['take off 3 degrees', aim(42)],
    // never clamped: the range refuses with the numbers, and that is the lesson
    ['Try ninety degrees.', aim(90)], ['straight up', aim(90)], ['full power', aim(undefined, 40)], ['sixty metres a second', aim(undefined, 60)],
    // a correction: the later number wins
    ['try sixty, no, sixty-five', aim(65)],
    // an aim and then the shot, as the last clause and a whole fire phrase
    ['Forty-five at twenty-four and fire.', aim(45, 24, true)], ['Forty degrees. Fire!', aim(40, undefined, true)],
    ['Fire at forty degrees.', aim(40, undefined, true)], ['shoot it a bit flatter', aim(42, undefined, true)], ['launch at 30 at 25', aim(30, 25, true)], ['fire flatter', aim(40, undefined, true)],
    ['Raise it.', aim(50)], ['Drop it a little.', aim(42)], ['a couple more degrees', aim(47)], ['a few degrees steeper', aim(48)], ['try 40, then send it', aim(40, undefined, true)], ['steeper and go', aim(50, undefined, true)],
  ];
  test.each(cases)('%s', (text, expected) => { expect(said(text)).toEqual(expected); });

  test('a capped launcher\'s "full power" is its own cap', () => {
    expect(said('full power', { ...onWall, limits: { angle: [5, 85], speed: [5, 18] }, challengeId: 'maxrange' })).toEqual(aim(undefined, 18));
  });

  test('relative steps start from where the launcher is now', () => {
    expect(said('a bit steeper', { ...onWall, aim: { angle_deg: 30, speed_ms: 12 } })).toEqual(aim(33));
    expect(said('steeper', { ...onWall, aim: { angle_deg: 85, speed_ms: 12 } })).toEqual(aim(90)); // off the rail: refused, not clamped
  });

  const notAims = [
    'Why did that miss?', 'Should I go steeper?', 'What if I try forty?', 'Is forty-five the best angle?', 'I tried forty degrees and it fell short',
    'That was close', 'next shot', 'give it more', 'forty five and then some', 'hello', 'the wall', 'nice one', 'it went 40 metres',
  ];
  test.each(notAims)('not an action: %s', (text) => { expect(said(text)).toBeNull(); });
});

// ---- challenges, "next one", "start over" ---------------------------------

describe('challenges by voice', () => {
  const cases: [string, Command | null][] = [
    ["Let's do the moon.", { kind: 'challenge', id: 'moonshot' }], ['the moon', { kind: 'challenge', id: 'moonshot' }],
    ['The windy one', { kind: 'challenge', id: 'headwind' }], ['into the headwind', { kind: 'challenge', id: 'headwind' }],
    ['under the roof', { kind: 'challenge', id: 'ceiling' }], ['can we do the roof one?', { kind: 'challenge', id: 'ceiling' }],
    ['land in the zone', { kind: 'challenge', id: 'zone30' }], ['switch to the landing zone', { kind: 'challenge', id: 'zone30' }],
    ['max range', { kind: 'challenge', id: 'maxrange' }], ['the capped one', { kind: 'challenge', id: 'maxrange' }],
    ['Next one.', { kind: 'next' }], ['next challenge please', { kind: 'next' }], ["ok let's move on", { kind: 'next' }], ['something different', { kind: 'next' }],
    ['Start over.', { kind: 'reset' }], ['let me start that one over', { kind: 'reset' }], ['clear the trails', { kind: 'reset' }], ['reset', { kind: 'reset' }],
    // talk, not requests
    ['why is the moon so different?', null], ['the dragon one', null], ['I love the wind challenge', null], ['next time', null], ['over the wall!', null],
  ];
  test.each(cases)('%s', (text, expected) => { expect(said(text)).toEqual(expected); });

  test('naming the challenge already up is talk, not a request to wipe its scoreboard', () => {
    expect(said('the wall')).toBeNull();
    expect(said("let's do the wall", { ...onWall, challengeId: 'moonshot' })).toEqual({ kind: 'challenge', id: 'wall40' });
  });
});

describe('normalising what was said', () => {
  test.each([
    ['Try forty-five degrees at twenty m/s!', 'try 45 deg at 20 ms'],
    ['Forty degrees. Fire!', '40 deg , fire'],
    ['twenty one metres per second', '21 ms'],
    ['the windy one', 'the windy one'],
    ['one degree', '1 deg'],
    ['a hundred', '100'],
    ['twelve point five', '12.5'],
    ['Let’s go, 45°', 'lets go , 45 deg'],
  ])('%s → %s', (text, expected) => { expect(normalize(text)).toBe(expected); });
});

describe('what a command does to the range', () => {
  test('an aim with a shot is two intents, in order; nothing else is', () => {
    expect(intentsFor({ kind: 'aim', angle_deg: 40, thenFire: true })).toEqual([{ kind: 'set_aim', angle_deg: 40, speed_ms: null }, { kind: 'fire' }]);
    expect(intentsFor({ kind: 'next' })).toEqual([{ kind: 'next_challenge' }]);
    expect(intentsFor({ kind: 'challenge', id: 'zone30' })).toEqual([{ kind: 'start_challenge', id: 'zone30' }]);
  });
});

// ---- the model fallback -----------------------------------------------------

describe('the model, for what the rules cannot read', () => {
  test('only short, aim-ish lines that are not questions are worth asking about', () => {
    for (const text of ['give it some welly', 'the one with low gravity', 'try the headwind thing', 'a smidge more welly', 'lob it like a mortar', 'something harder', 'give it more'])
      expect(worthAsking(text), text).toBe(true);
    for (const text of ['Why did that miss?', 'fire', 'hello there', 'thanks coach', 'Should I go steeper?', 'what a lovely day it is on this range, I could stay here all afternoon long with more coffee'])
      expect(worthAsking(text), text).toBe(false);
  });

  test("the model's answer is validated, never trusted further", () => {
    expect(commandFromModel({ action: 'aim', angle_deg: 52.04, speed_ms: null }, onWall)).toEqual({ kind: 'aim', angle_deg: 52 });
    expect(commandFromModel({ action: 'aim', angle_deg: null, speed_ms: 23 }, onWall)).toEqual({ kind: 'aim', speed_ms: 23 });
    expect(commandFromModel({ action: 'aim', angle_deg: 120 }, onWall)).toEqual({ kind: 'aim', angle_deg: 120 }); // never clamped
    expect(commandFromModel({ action: 'challenge', challenge_id: 'moonshot' }, onWall)).toEqual({ kind: 'challenge', id: 'moonshot' });
    for (const raw of [
      { action: 'aim' }, { action: 'aim', angle_deg: Number.NaN }, { action: 'aim', angle_deg: '40' }, { action: 'challenge', challenge_id: 'wall40' },
      { action: 'challenge', challenge_id: 'dragon' }, { action: 'none', angle_deg: 40 }, { action: 'fire' }, null, 'aim', 42,
    ]) expect(commandFromModel(raw, onWall), JSON.stringify(raw)).toBeNull();
  });

  test('the prompt carries the utterance, the aim now and the challenge ids', () => {
    const prompt = interpretPrompt('a touch more oomph', onWall);
    expect(prompt).toContain('"a touch more oomph"');
    expect(prompt).toContain('45 degrees and 20 metres a second');
    for (const id of ['wall40', 'zone30', 'maxrange', 'headwind', 'ceiling', 'moonshot']) expect(prompt).toContain(id);
    expect(prompt).toContain('never change it to fit a limit');
  });
});

// ---- the safety net ---------------------------------------------------------

describe('what the safety net does when the host does not, and only what is safe to repeat', () => {
  const cases: [string, ReturnType<typeof mustDo>][] = [
    // the shot: the whole utterance, as the original's FireWatch
    ['Fire!', { name: 'fire', arguments: {} }], ['send it', { name: 'fire', arguments: {} }], ['OK, fire.', { name: 'fire', arguments: {} }],
    ['Coach, fire!', { name: 'fire', arguments: {} }], ['Same again.', { name: 'fire', arguments: {} }], ['let it fly', { name: 'fire', arguments: {} }],
    // a clean scoreboard
    ['Start over.', { name: 'start_over', arguments: {} }], ['clear the trails', { name: 'start_over', arguments: {} }],
    // a challenge by its id; "next" pinned to the one after the challenge up now
    ["Let's do the moon.", { name: 'choose_challenge', arguments: { challenge: 'moonshot' } }],
    ['the windy one', { name: 'choose_challenge', arguments: { challenge: 'headwind' } }],
    ['Next challenge, please.', { name: 'choose_challenge', arguments: { challenge: 'zone30' } }],
    // left to the host: questions, aims (a relative one done twice moves twice), an aim with a shot, talk
    ['Should I fire flatter?', null], ['Why did that miss?', null], ['a bit steeper', null], ['forty degrees', null],
    ['Forty-five at twenty-four and fire.', null], ["don't fire", null], ['the wall', null], ['that was close', null], ['next time', null],
  ];
  test.each(cases)('%s', (text, expected) => { expect(mustDo(text, onWall)).toEqual(expected); });

  test('the recogniser\'s variants still count ("Fire." with its punctuation, "Let it go!")', () => {
    for (const text of ['Fire.', 'Let it go!', 'Fire away.', 'Okay, so, fire.']) expect(mustDo(text, onWall)?.name, text).toBe('fire');
  });

  test('"next" wraps from the last challenge to the first', () => {
    expect(nextChallengeId('moonshot')).toBe('wall40');
    expect(mustDo('next one', { ...onWall, challengeId: 'moonshot' })).toEqual({ name: 'choose_challenge', arguments: { challenge: 'wall40' } });
  });
});
