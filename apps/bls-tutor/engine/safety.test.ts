// The real-emergency watch (ported from test_safety.py, plus the port's additions).
//
// The asymmetry is deliberate and it is what these tests pin: a learner
// narrating the drill must not trip it, and someone kneeling next to a person
// who is not breathing must.
import { describe, expect, test } from 'vitest';
import { clearsEmergency, isPracticeResume, isRealEmergency } from './safety.ts';

describe('ported from test_safety.py', () => {
  test.each([
    "he's not breathing",
    'she is not breathing what do I do',
    'this is happening right now',
    "I'm with him and he just collapsed",
    'should I call 911?',
    'this is a real emergency',
    'someone collapsed help me now',
  ])('an emergency in progress stops the drill: %s', (text) => {
    expect(isRealEmergency(text)).toBe(true);
  });

  test.each([
    'I would call 911 right now',
    "I'd check if he's breathing",
    'in this scenario is he breathing?',
    'check for normal breathing',
    'start compressions',
    'call 911 and get an AED',
    '',
    "what's the compression rate again",
  ])('ordinary practice speech does not trip it: %s', (text) => {
    expect(isRealEmergency(text)).toBe(false);
  });

  // "kid", "said" and "did" all end in "id ", which is one of the hypothetical
  // markers. Matched as a bare substring it silently suppressed the stop for
  // the exact sentence this app exists to catch: a parent typing "my kid is not
  // breathing" got the drill.
  test.each([
    'my kid is not breathing',
    "he said he's not breathing",
    'I did CPR and he still has no pulse',
  ])('a word that merely contains a marker does not suppress the stop: %s', (text) => {
    expect(isRealEmergency(text)).toBe(true);
  });

  test.each([
    "sorry, I'm just practising",
    "no emergency, let's keep going",
    'new scenario please',
    "it's not a real emergency",
  ])('the learner can say they are practising again: %s', (text) => {
    expect(isPracticeResume(text)).toBe(true);
  });

  test('a report is not a resume', () => {
    expect(isPracticeResume("he's not breathing")).toBe(false);
  });
});

describe('choosing a scenario out loud does not trip the 911 card (from test_table.py)', () => {
  // The menu's own titles are "Adult collapse in a café" and "Choking at a
  // dinner table", so picking one aloud hit the emergency patterns and replaced
  // the app with a red Call-911 screen a minute after arriving.
  test('browsing the menu', () => {
    expect(isRealEmergency("let's do the one where someone collapsed")).toBe(false);
    expect(isRealEmergency('can we try the choking scenario')).toBe(false);
    expect(isRealEmergency('give me the one with the child')).toBe(false);
  });
  test('while an actual report still stops the drill, including at the menu', () => {
    expect(isRealEmergency('someone collapsed and is not breathing')).toBe(true);
    expect(isRealEmergency('he collapsed, should i call 911')).toBe(true);
  });
});

describe("the port's additions, all towards stopping", () => {
  test('a phone keyboard’s curly apostrophe does not hide the words', () => {
    expect(isRealEmergency('He isn’t breathing')).toBe(true);
    expect(isRealEmergency('she’s dying')).toBe(true);
    // ...and still suppresses a narrated drill.
    expect(isRealEmergency('I’d check if he’s not breathing')).toBe(false);
  });
  test('911 and 112 as people say and type them', () => {
    expect(isRealEmergency('should I call nine one one')).toBe(true);
    expect(isRealEmergency('do I call 9-1-1?')).toBe(true);
    expect(isRealEmergency('should I call 112')).toBe(true);
    expect(isRealEmergency('call 112?')).toBe(true);
    expect(isRealEmergency('I would call 112')).toBe(false);
  });
  test.each(['my dad collapsed', 'my baby is choking', 'my wife is unconscious', 'our son just passed out'])('someone of their own in a bad way: %s', (text) => {
    expect(isRealEmergency(text)).toBe(true);
  });
  test.each(["he's choking, so I'd ask if he can cough", 'in this scenario my patient collapsed', 'my answer is to check the scene'])('narration still does not: %s', (text) => {
    expect(isRealEmergency(text)).toBe(false);
  });
});

describe('clearing the card (the original model decided this; the port lists the phrasings)', () => {
  test.each([
    "false alarm, nobody's hurt",
    'sorry, nobody is in danger',
    'I was only asking',
    "it's not a real emergency",
    'can we go back to practising',
    'new scenario please',
    'everyone’s fine, just practising',
  ])('says plainly nobody is in danger: %s', (text) => {
    expect(clearsEmergency(text)).toBe(true);
  });

  test.each([
    "false alarm... no wait, he's not breathing",
    "nobody is hurt but my dad collapsed",
    'is this real?',
    "he's still not breathing",
    'okay',
    '',
  ])('anything that still reads as an emergency keeps it up: %s', (text) => {
    expect(clearsEmergency(text)).toBe(false);
  });
});
