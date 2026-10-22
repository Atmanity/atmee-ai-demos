// Turning words into board actions: real phrasings, with the context they are
// said in. The name filter is ported from test_the_trip_is_kept.py; the rest
// is new (the original's model called tools; this app reads the words itself).
import { describe, expect, test } from 'vitest';
import { actionFrom, actionIn, avatarPick, isAName, nameIn, placeIn, ruleAction, type JudgeContext } from './judge.ts';
import type { Action } from './types.ts';

const PLANNING: JudgeContext = { stage: 'planning', current: 'Japan', visited: ['Japan'], hasSpots: false, spoken: true };
const WELCOME: JudgeContext = { stage: 'welcome', current: '', visited: [], hasSpots: false, spoken: true };
const AROUND: JudgeContext = { stage: 'around', current: 'Japan', visited: ['Japan', 'Peru'], hasSpots: true, spoken: true };
const TRIP: JudgeContext = { stage: 'planning', current: 'Peru', visited: ['Japan', 'Peru'], hasSpots: false, spoken: true };

describe('names', () => {
  // The board invites "tell me where you are dreaming of"; typed as the first
  // message, the header then read "Hello dreaming of Japan" for the rest of the session.
  test.each(['dreaming of Japan', 'I want Japan', 'a trip to Peru', 'show me Italy', 'thinking about Spain', 'hello there', 'yes please', '3 day trip', 'remember_traveler', 'I would really love to go somewhere warm'])('a request is never a name: %s', (said) => {
    expect(isAName(said)).toBe(false);
  });

  test.each(['Sam', 'Mei Lin', 'Ana Sofia Ruiz', 'Lumi'])('a name is still a name: %s', (said) => {
    expect(isAName(said)).toBe(true);
  });

  test('said outright, or answered right after being asked', () => {
    expect(nameIn('My name is Sam.')).toBe('Sam');
    expect(nameIn('call me mei lin please')).toBe('Mei Lin');
    expect(nameIn("I'm Sam, and I'm dreaming of Japan", 'What should I call you?')).toBe('Sam');
    expect(nameIn('Sam!', 'Hi, I am your guide. What would you like me to call you?')).toBe('Sam');
    expect(nameIn("It's Ana Sofia.", "What's your name?")).toBe('Ana Sofia');
  });

  test('a bare word is not a name unless the guide just asked for one, and a country is never one by implication', () => {
    expect(nameIn('Sam')).toBeNull();
    expect(nameIn("I'm hungry", 'What should I call you?')).toBeNull();
    expect(nameIn('Japan', 'What should I call you, and where are you dreaming of?')).toBeNull();
    expect(nameIn('My name is Georgia')).toBe('Georgia');
  });
});

describe('places', () => {
  test.each<[string, string | null]>([
    ["I'm near Shibuya station", 'shibuya station'],
    ['We are staying in Lisbon for a week', 'lisbon'],
    ["I'm at the Louvre right now", 'the louvre'],
    ["What's worth seeing around the Colosseum?", 'the colosseum'],
    ['near Union Square', 'union square'],
    ["What's near me?", ''],
    ['anything good nearby', ''],
    ["I'm at home", ''],
    ["I'm in the mood for Italian food", null],
    ['I am in love with Japan', null],
    ['Tell me about Japan', null],
  ])('%s', (said, place) => {
    expect(placeIn(said)?.place ?? null).toBe(place);
  });
});

describe('the rules', () => {
  const cases: [string, JudgeContext, Action | null][] = [
    // planning a trip
    ["I'm dreaming of Japan", WELCOME, { kind: 'destination', country: 'Japan' }],
    ["Let's go to Portugal!", PLANNING, { kind: 'destination', country: 'Portugal' }],
    ['Peru.', PLANNING, { kind: 'destination', country: 'Peru' }],
    ['How about Peru instead?', PLANNING, { kind: 'destination', country: 'Peru' }],
    ['Maybe somewhere in Asia, like Vietnam', WELCOME, { kind: 'destination', country: 'Vietnam', continent: 'Asia' }],
    ['Somewhere in South America', WELCOME, { kind: 'continent', continent: 'South America' }],
    ['the UK', WELCOME, { kind: 'destination', country: 'United Kingdom' }],
    ['You choose!', WELCOME, { kind: 'pick' }],
    ['surprise me', PLANNING, { kind: 'pick' }],
    ["Let's plan a trip", WELCOME, { kind: 'show', stage: 'planning' }],
    ['How about Bali?', PLANNING, { kind: 'search', query: 'Bali' }],
    ["I'm at home dreaming of Japan", WELCOME, { kind: 'destination', country: 'Japan' }],
    // the trip
    ['Back to Japan', TRIP, { kind: 'revisit', country: 'Japan' }],
    ['Can we go back to the first one?', TRIP, { kind: 'revisit', country: 'Japan' }],
    ['the previous country please', TRIP, { kind: 'revisit', country: 'Japan' }],
    // headlines and food
    ["What's in the news there?", PLANNING, { kind: 'news' }],
    ['show me the headlines', PLANNING, { kind: 'news' }],
    ['What should I eat?', PLANNING, { kind: 'food' }],
    ["I'm in the mood for Italian food", PLANNING, { kind: 'food' }],
    // around them
    ["I'm near Shibuya station", WELCOME, { kind: 'around', place: 'shibuya station' }],
    ["What's near me?", PLANNING, { kind: 'show', stage: 'around' }],
    ['Another one!', AROUND, { kind: 'next' }],
    ['what else is there?', AROUND, { kind: 'next' }],
    ['Go back to the one before', AROUND, { kind: 'previous' }],
    ['go back to Peru', AROUND, { kind: 'revisit', country: 'Peru' }],
    // not the board's business
    ['That sounds lovely', PLANNING, null],
    ["What's the weather like there in May?", PLANNING, null],
    ['Tell me more about it', AROUND, null],
    ['Japan is beautiful', PLANNING, null],
    ['another one', PLANNING, null], // no spots: nothing to move to
  ];
  test.each(cases)('%s', (said, ctx, expected) => {
    expect(ruleAction(said, ctx)).toEqual(expected);
  });

  test('"yes please" is whatever the guide just offered, when it offered one thing', () => {
    expect(ruleAction('Yes please', { ...PLANNING, lastAvatarLine: 'Shall I pull up the latest headlines?' })).toEqual({ kind: 'news' });
    expect(ruleAction('Sure!', { ...PLANNING, lastAvatarLine: 'Want to hear what to eat there?' })).toEqual({ kind: 'food' });
    expect(ruleAction('yeah', { ...AROUND, lastAvatarLine: 'Want the next one?' })).toEqual({ kind: 'next' });
    expect(ruleAction('Yes', { ...WELCOME, lastAvatarLine: 'Shall I pick somewhere for you?' })).toEqual({ kind: 'pick' });
    expect(ruleAction('Yes please', { ...PLANNING, lastAvatarLine: 'The headlines, or the food?' })).toBeNull();
    // The guide proposed a country: "yes" puts it on the map (the guide often offers one when asked for a continent).
    expect(ruleAction('Yes!', { ...WELCOME, lastAvatarLine: 'Asia is wonderful. How about Vietnam?' })).toEqual({ kind: 'destination', country: 'Vietnam' });
    expect(ruleAction('sounds great', { ...TRIP, lastAvatarLine: 'Shall we go back to Japan?' })).toEqual({ kind: 'revisit', country: 'Japan' });
    expect(ruleAction('Yes', { ...WELCOME, lastAvatarLine: 'I loved my time in Japan.' })).toBeNull(); // a memory, not an offer
  });

  test('a place after "how about" must sound like a name when spoken, or "a beach" would geocode to a town called Beach', () => {
    expect(ruleAction('how about a beach', PLANNING)).toBeNull();
    expect(ruleAction('how about bali', PLANNING)).toBeNull();
    expect(ruleAction('how about bali', { ...PLANNING, spoken: false })).toEqual({ kind: 'search', query: 'bali' });
    expect(ruleAction('how about a beach', { ...PLANNING, spoken: false })).toBeNull();
  });

  test('a country that contains another is read whole', () => {
    expect(ruleAction("Let's go to Niger", WELCOME)).toEqual({ kind: 'destination', country: 'Niger' });
    expect(ruleAction("Let's go to Papua New Guinea", WELCOME)).toEqual({ kind: 'destination', country: 'Papua New Guinea' });
  });
});

describe("the model's answer, checked like the rules", () => {
  test('is turned into an action', () => {
    expect(actionFrom({ action: 'destination', country: 'Japan', city: 'Kyoto' }, WELCOME)).toEqual({ kind: 'destination', country: 'Japan', city: 'Kyoto' });
    expect(actionFrom({ action: 'destination', country: '', city: 'Kyoto' }, WELCOME)).toEqual({ kind: 'search', query: 'Kyoto' });
    expect(actionFrom({ action: 'destination', country: 'Japan' }, TRIP)).toEqual({ kind: 'revisit', country: 'Japan' });
    expect(actionFrom({ action: 'around', place: 'Gion' }, PLANNING)).toEqual({ kind: 'around', place: 'Gion' });
    expect(actionFrom({ action: 'nearby' }, PLANNING)).toEqual({ kind: 'show', stage: 'around' });
    expect(actionFrom({ action: 'news' }, PLANNING)).toEqual({ kind: 'news' });
  });

  test('and refused where the rules would refuse', () => {
    expect(actionFrom({ action: 'name', name: 'dreaming of Japan' }, WELCOME)).toBeNull();
    expect(actionFrom({ action: 'destination', country: 'Japan' }, PLANNING)).toBeNull(); // already there
    expect(actionFrom({ action: 'next' }, PLANNING)).toBeNull(); // no spots
    expect(actionFrom({ action: 'none' }, PLANNING)).toBeNull();
    expect(actionFrom({ action: 'launch rockets' }, PLANNING)).toBeNull();
    expect(actionFrom(null, PLANNING)).toBeNull();
  });
});

describe('controls', () => {
  test('a control sends a checked action', () => {
    expect(actionIn({ kind: 'search', query: '  Kyoto, Japan ' })).toEqual({ kind: 'search', query: 'Kyoto, Japan' });
    expect(actionIn({ kind: 'coords', lat: 38.7, lon: -9.1 })).toEqual({ kind: 'coords', lat: 38.7, lon: -9.1 });
    expect(actionIn({ kind: 'goto', index: 2 })).toEqual({ kind: 'goto', index: 2 });
    expect(actionIn({ kind: 'show', stage: 'around' })).toEqual({ kind: 'show', stage: 'around' });
    expect(actionIn({ kind: 'next' })).toEqual({ kind: 'next' });
  });

  test.each([null, 'next', {}, { kind: 'launch' }, { kind: 'search', query: '' }, { kind: 'coords', lat: '1', lon: 2 }, { kind: 'show', stage: 'moon' }, { kind: 'goto', index: Number.NaN }])('anything else is no action: %j', (value) => {
    expect(actionIn(value)).toBeNull();
  });
});

describe("the guide's own pick", () => {
  test('is exactly one country it is not already showing', () => {
    expect(avatarPick("Let's go to Portugal, you'll love the light.", '')).toBe('Portugal');
    expect(avatarPick('Instead of Japan, how about Peru?', 'Japan')).toBe('Peru');
    expect(avatarPick('Portugal, or maybe Greece?', '')).toBeNull();
    expect(avatarPick('Do you like beaches or mountains?', '')).toBeNull();
  });
});
