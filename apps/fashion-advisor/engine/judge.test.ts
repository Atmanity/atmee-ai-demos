// What the user's words mean. The phrase tables are ported from the original's
// test_declining_the_camera.py, test_onboarding_lets_you_past.py and
// test_parity.py; their comments are the live failures behind them. The
// styling-loop commands are new (the original left them to tool calls).
import { describe, expect, test } from 'vitest';
import {
  bareName, consumes, containsExplicitTryOnRequest, describesOutfit, extractNameFromTranscript, extractTryOnOffer, extractTryOnRequest,
  fromIntentModel, fromNameModel, fromStyleModel, isAffirmativeReply, isPhotoDecline, judgeRules, looksLikeNonName, MAX_NAME_ATTEMPTS,
  MAX_PHOTO_CONSENT_ASKS, mentionsNoCamera, nameTurnDeflection, parseCommand, type JudgeContext,
} from './judge.ts';
import type { Command, Step } from './types.ts';

const PIECES = ['Slim Navy Silk Tie', 'Black Tortoise-Shell Round Glasses', 'Camel Wool Topcoat', 'Dark Wash Tapered Jeans'];
const at = (step: Step, extra: Partial<JudgeContext> = {}): JudgeContext => ({
  step, suggestions: step === 'styling' ? PIECES : [], offer: null, hasPhoto: step === 'styling', photoDeclined: false, hasName: step !== 'name', hasTarget: step === 'photo' || step === 'styling', ...extra,
});
const command = (text: string, ctx: JudgeContext) => judgeRules(text, ctx).command;

// -- the photo: every way of saying no ---------------------------------------------

describe('declining the photo', () => {
  test.each([
    'skip it, just give me general style advice', 'skip the photo', 'no', 'No thanks', 'nope', "nah, I'd rather not", "I'd rather not",
    "I don't want a photo", "I'm not comfortable with that", 'can you do it without a photo?', 'I have no camera', 'my webcam is broken',
    'not now', 'maybe later', 'just text instead', 'can you work from a description instead?',
  ])('"%s" is a no', (said) => {
    expect(isPhotoDecline(said)).toBe(true);
  });

  test.each([
    // The turn that got "I can't assist with that": an ordinary question is not a refusal.
    'how much would a decent crewneck cost?', 'yes', 'sure, go ahead', 'I have no idea what I want', 'what will you do with the photo?',
  ])('"%s" is not a no', (said) => {
    expect(isPhotoDecline(said)).toBe(false);
  });

  test('the escape the stylist offers is a no on the photo step, typed or spoken alike (one matcher)', () => {
    // Upstream had a second, substring matcher for speech; "I have no idea" read as a no there.
    expect(command('skip it, just give me general style advice', at('photo'))).toEqual({ type: 'declinePhoto' });
    expect(command("I'd rather not", at('photo'))).toEqual({ type: 'declinePhoto' });
    expect(command('I have no idea what I want', at('photo'))?.type).toBe('chat');
  });

  test('"no camera" is not a refusal here: the photo is a file, so the staged answer explains uploading', () => {
    for (const said of ['I have no camera', "my webcam is broken, I'm typing"]) {
      expect(mentionsNoCamera(said)).toBe(true);
      expect(command(said, at('photo'))?.type).toBe('chat');
    }
  });

  test('a no is checked before a yes', () => {
    // Upstream asked "yes?" first, and "ready" in "no, not ready" counted as consent.
    expect(command('no, not ready', at('photo'))).toEqual({ type: 'declinePhoto' });
    expect(command('sure, go ahead', at('photo'))).toEqual({ type: 'photoYes' });
  });

  test('the photo question has a small cap', () => {
    expect(MAX_PHOTO_CONSENT_ASKS).toBeGreaterThanOrEqual(1);
    expect(MAX_PHOTO_CONSENT_ASKS).toBeLessThanOrEqual(3);
  });
});

// -- outfits described in words ------------------------------------------------------

describe('an outfit described in words', () => {
  test.each([
    "I'm wearing black jeans, a grey crewneck and white sneakers", 'I have on a navy blazer over a white tee', 'black jeans, white tee, brown boots', "I'm in a hoodie and joggers",
  ])('"%s" describes an outfit', (said) => {
    expect(describesOutfit(said)).toBe(true);
  });

  test.each(['Sam', 'erm', 'what?', '', 'how much would a decent crewneck cost?'])('"%s" does not', (said) => {
    expect(describesOutfit(said)).toBe(false);
  });

  test('it is kept from any turn, as a chat command carrying it', () => {
    expect(command("I'm wearing black jeans and a grey crewneck", at('name'))).toMatchObject({ type: 'chat', outfit: "I'm wearing black jeans and a grey crewneck" });
    expect(command('black jeans, white tee, brown boots', at('styling', { photoDeclined: true, hasPhoto: false }))).toMatchObject({ type: 'chat', outfit: 'black jeans, white tee, brown boots' });
  });
});

// -- names -----------------------------------------------------------------------------

describe('the name', () => {
  test('from the frames people use, through their filler', () => {
    expect(extractNameFromTranscript("Hi, I'm Joan")).toBe('Joan');
    expect(extractNameFromTranscript("Yeah, okay, so I'm Joan")).toBe('Joan');
    expect(extractNameFromTranscript('my name is Mary Jane Watson')).toBe('Mary Jane Watson');
    expect(extractNameFromTranscript("I'm Sam, going for smart casual for a work dinner")).toBe('Sam');
    expect(extractNameFromTranscript('Call me JJ.')).toBe('JJ');
  });

  test('a frame about something else is not a name', () => {
    expect(extractNameFromTranscript("I'm going for streetwear")).toBe('');
    // Upstream's regex took "wearing black jeans" as a name whenever the model's tool call did not win first.
    expect(extractNameFromTranscript("I'm wearing black jeans")).toBe('');
    expect(extractNameFromTranscript('It is what it is')).toBe('');
  });

  test('a bare name, but not a filler word', () => {
    expect(bareName('Jonas.')).toBe('Jonas');
    expect(bareName('Mary Jane')).toBe('Mary Jane');
    for (const said of ['erm', 'what?', 'okay', 'Hello', 'skip', 'Is it you?', 'I am not sure']) expect(bareName(said), said).toBe('');
  });

  test('adjectives, greetings and style words are not names', () => {
    for (const said of ['jealous', 'stylish', 'Casual', 'yes', 'hey', 'a b c d']) expect(looksLikeNonName(said), said).toBe(true);
    expect(looksLikeNonName('Sam')).toBe(false);
  });

  test('a capitalised framed name is taken by the rules; anything less sure goes to the model, with the rule as a fallback', () => {
    expect(judgeRules("I'm Sam", at('name'))).toEqual({ command: { type: 'name', name: 'Sam' } });
    expect(judgeRules('Jonas', at('name'))).toMatchObject({ command: { type: 'name', name: 'Jonas' }, ask: 'name' });
    expect(judgeRules("i'm excited", at('name'))).toMatchObject({ ask: 'name' });
  });

  test('a style given with the name comes along, so it is not asked for again', () => {
    expect(command("I'm Sam, going for smart casual for a work dinner", at('name'))).toEqual({ type: 'name', name: 'Sam', style: 'smart casual' });
    // A sentence that says more but names no style: the model reads the hint.
    expect(judgeRules("I'm Sam, and I have no camera", at('name'))).toMatchObject({ command: { type: 'name', name: 'Sam' }, ask: 'styleHint' });
  });

  test('"I would rather not say" closes the question warmly', () => {
    for (const said of ["I'd rather not say", 'skip', 'call me whatever', 'no names please']) expect(command(said, at('name')), said).toEqual({ type: 'skipName' });
  });

  test('a style named before the name is kept', () => {
    expect(command("I'm going for business casual", at('name'))).toEqual({ type: 'style', style: 'business casual' });
  });

  test('the name question has a small cap', () => {
    expect(MAX_NAME_ATTEMPTS).toBeGreaterThanOrEqual(1);
    expect(MAX_NAME_ATTEMPTS).toBeLessThanOrEqual(3);
  });

  test('the model answer is validated like a typed one', () => {
    expect(fromNameModel({ name: ' Jonas ' })).toBe('Jonas');
    expect(fromNameModel({ name: '' })).toBe('');
    expect(fromNameModel({ name: 'NONE' })).toBe('');
    expect(fromNameModel({ name: 'stylish' })).toBe('');
  });
});

describe('what people say instead of a name', () => {
  test.each(['I have no camera', "I have no camera. I'm typing. Can you still help me?", 'my webcam is broken', 'camera is off', "I don't have a webcam"])('"%s" is about the camera', (said) => {
    expect(nameTurnDeflection(said)).toBe('camera');
  });

  test.each(['Show me with a hat', 'put a jacket on me', 'can I try on a scarf', 'show me it'])('"%s" is an early try-on', (said) => {
    // The panel's own example; typed verbatim it got "that doesn't sound like a name" three times.
    expect(nameTurnDeflection(said)).toBe('tryon');
  });

  test('a described outfit is an outfit', () => {
    expect(nameTurnDeflection("I'm wearing black jeans, a grey crewneck and white sneakers")).toBe('outfit');
  });

  test.each(['Sam', 'erm', 'what?', ''])('"%s" is an ordinary non-answer', (said) => {
    expect(nameTurnDeflection(said)).toBeNull();
  });

  test('a piece asked for before the photo is remembered', () => {
    expect(command('Show me with a hat', at('name'))).toEqual({ type: 'chat', wish: 'hat' });
    expect(command('can you put a black fedora hat on me?', at('photo'))).toEqual({ type: 'chat', wish: 'black fedora hat' });
  });
});

// -- yes, and the avatar's own offers ------------------------------------------------------

test('a yes is a whole word, not a substring', () => {
  for (const said of ['yes', 'Yeah!', 'sure', 'ok', 'okay then', 'go ahead', 'sounds good', 'yes please']) expect(isAffirmativeReply(said), said).toBe(true);
  // Upstream matched substrings: "look" read as "ok", "yesterday" as "yes".
  for (const said of ['how do I look', 'I bought it yesterday', 'my shoes are broken']) expect(isAffirmativeReply(said), said).toBe(false);
});

describe("the avatar's try-on offers", () => {
  test.each([
    ['Score is 4/10. Do you want to start with the Slim Navy Silk Tie?', 'Slim Navy Silk Tie'],
    ['I would try on the brown belt next; want to see it?', 'brown belt'],
    ['Do you want to try on the Camel Wool Topcoat for the fastest upgrade?', 'Camel Wool Topcoat'],
    ['Wanna test the round glasses first?', 'round glasses'],
    // A confirm that names a real piece: without it the user said "yes" and the model re-asked in a loop.
    ['Just to be clear — did you mean the brown leather belt?', 'brown leather belt'],
  ])('"%s" offers %s', (said, item) => {
    expect(extractTryOnOffer(said)).toBe(item);
  });

  test.each([
    'Do you mean you want to try on or add a specific item?', 'Do you want to try something else?', 'Want to try it?', 'Want to try another one?', 'That looks great on you.', '',
  ])('"%s" offers nothing', (said) => {
    expect(extractTryOnOffer(said)).toBe('');
  });

  test('a yes to a fresh offer puts it on', () => {
    const ctx = at('styling', { offer: 'Camel Wool Topcoat' });
    expect(command('yes please', ctx)).toEqual({ type: 'tryOn', item: 'Camel Wool Topcoat' });
    expect(command("yeah let's do it", ctx)).toEqual({ type: 'tryOn', item: 'Camel Wool Topcoat' });
    expect(command('put it on me', ctx)).toEqual({ type: 'tryOn', item: 'Camel Wool Topcoat' });
  });

  test('an "okay" that pivots to a new piece is that piece, not the offered one', () => {
    const ctx = at('styling', { offer: 'Camel Wool Topcoat' });
    expect(command('Okay. Now I would like to test on the chunky gold chain necklace.', ctx)).toEqual({ type: 'tryOn', item: 'chunky gold chain necklace' });
    expect(containsExplicitTryOnRequest('Okay. Now I would like to test on the chunky gold chain necklace.')).toBe(true);
  });

  test('a no turns the offer down', () => {
    expect(judgeRules('no thanks', at('styling', { offer: 'Camel Wool Topcoat' }))).toEqual({ command: null, clearOffer: true });
  });

  test('a yes with no offer standing does nothing (a stray "sure" never acts)', () => {
    expect(command('sure', at('styling'))).toBeNull();
    expect(command('sure', at('styling', { photoDeclined: true, hasPhoto: false }))).toBeNull();
  });
});

// -- the styling loop ----------------------------------------------------------------------

describe('explicit try-on requests', () => {
  test('are recognised, but "look at me" is not', () => {
    // The guard that stops an image nobody asked for: the current look is already on screen.
    expect(containsExplicitTryOnRequest('can you put the black hat on me')).toBe(true);
    expect(containsExplicitTryOnRequest('show me my current look')).toBe(false);
    expect(containsExplicitTryOnRequest('how do I look')).toBe(false);
  });

  test.each([
    ['try a black fedora', 'black fedora'],
    ['Can you put a tie on me?', 'tie'],
    ['put on a camel topcoat please', 'camel topcoat'],
    ['show me with a gold layered necklace', 'gold layered necklace'],
    ['show me the navy tie on me', 'navy tie'],
    ["Let's see me in a leather jacket", 'leather jacket'],
    ['add a silver watch to my look', 'silver watch'],
    ['how would I look with round glasses?', 'round glasses'],
    ['try on the tapered jeans for the dinner', 'tapered jeans'],
    ['swap in a white oxford shirt', 'white oxford shirt'],
  ])('"%s" asks for %s', (said, item) => {
    expect(extractTryOnRequest(said, PIECES)).toEqual({ item, pronoun: false });
  });

  test('the second one is the second card', () => {
    expect(extractTryOnRequest('try the second one', PIECES)).toEqual({ item: PIECES[1], pronoun: false });
    expect(extractTryOnRequest('can you put the last one on me', PIECES)).toEqual({ item: PIECES[3], pronoun: false });
  });

  test('advice, refusals and non-garments are not requests', () => {
    for (const said of ['should I try a hat?', "don't put the hat on", "I'll try that later", 'show me my current look', 'try something different', 'show me the suggestions', 'add some colour']) {
      expect(extractTryOnRequest(said, PIECES), said).toBeNull();
    }
  });

  test('"try it on" is a reference, to the offered piece', () => {
    expect(extractTryOnRequest('try it on', PIECES)).toEqual({ item: '', pronoun: true });
    expect(command('try it on', at('styling'))).toBeNull();
  });
});

describe('commands in the styling loop', () => {
  const cases: [string, Command | null][] = [
    ['try a black fedora hat', { type: 'tryOn', item: 'black fedora hat' }],
    ['more ideas please', { type: 'more' }],
    ['what else would work?', { type: 'more' }],
    ['rate it again', { type: 'rerate' }],
    ['give me a fresh score', { type: 'rerate' }],
    ['can you rate my outfit', { type: 'rerate' }],
    ['rate me for a wedding instead', { type: 'retarget', style: 'wedding' }],
    ['what about business casual?', { type: 'retarget', style: 'business casual' }],
    ['score me for a beach party', { type: 'retarget', style: 'beach party' }],
    ["I'm now going for old money", { type: 'retarget', style: 'old money' }],
    ['make it more streetwear', { type: 'steer', style: 'streetwear' }],
    ['something more formal', { type: 'steer', style: 'formal' }],
    ['can I take a new photo', { type: 'retake' }],
    ['let me upload another picture', { type: 'retake' }],
    ['go back to my original photo', { type: 'reset' }],
    ['take it all off', { type: 'reset' }],
    ['call me Sam', { type: 'name', name: 'Sam' }],
    // Reassurance and opinions are the avatar's to answer from the read.
    ['I look good now, right?', null],
    ["isn't it better?", null],
    ['what do you think?', null],
  ];
  test.each(cases)('"%s"', (said, expected) => {
    expect(command(said, at('styling'))).toEqual(expected);
  });

  test('a garment in loose words goes to the model, small talk does not', () => {
    expect(judgeRules('what about the blazer though', at('styling'))).toMatchObject({ command: null, ask: 'intent' });
    expect(judgeRules('thanks, that is lovely', at('styling'))).toEqual({ command: null });
  });

  test("the model's intent becomes a command, resolved to the piece on screen", () => {
    const ctx = at('styling');
    expect(fromIntentModel({ intent: 'try_on', item: 'the topcoat', style: '' }, ctx)).toEqual({ type: 'tryOn', item: 'Camel Wool Topcoat' });
    expect(fromIntentModel({ intent: 'try_on', item: '', style: '' }, { ...ctx, offer: 'Slim Navy Silk Tie' })).toEqual({ type: 'tryOn', item: 'Slim Navy Silk Tie' });
    expect(fromIntentModel({ intent: 'try_on', item: 'my current look', style: '' }, ctx)).toBeNull();
    expect(fromIntentModel({ intent: 'retarget', item: '', style: 'Date Night.' }, ctx)).toEqual({ type: 'retarget', style: 'date night' });
    expect(fromIntentModel({ intent: 'chat', item: '', style: '' }, ctx)).toBeNull();
  });
});

describe('onboarding styles', () => {
  test('a style word in an outfit description is not the target', () => {
    expect(command("I'm wearing a casual tee", at('style'))?.type).toBe('chat');
    expect(command("I'm going for casual", at('style'))).toEqual({ type: 'style', style: 'casual' });
  });

  test('a style in the user own words goes to the model', () => {
    expect(judgeRules('the German soccer guy', at('style'))).toMatchObject({ ask: 'style' });
    expect(fromStyleModel({ style: ' Old-Money Soft Academia. ' })).toBe('old-money soft academia');
    expect(fromStyleModel({ style: 'NONE' })).toBe('');
  });
});

test('only real commands come in over the network', () => {
  expect(parseCommand({ type: 'tryOn', item: '  black hat ' })).toEqual({ type: 'tryOn', item: 'black hat' });
  expect(parseCommand({ type: 'tryOn', item: '' })).toBeNull();
  expect(parseCommand({ type: 'photo', mime: 'image/jpeg', data: 'abc', source: 'sample' })).toEqual({ type: 'photo', mime: 'image/jpeg', data: 'abc', source: 'sample' });
  expect(parseCommand({ type: 'reset', extra: 1 })).toEqual({ type: 'reset' });
  expect(parseCommand({ type: 'deleteEverything' })).toBeNull();
  expect(parseCommand('more')).toBeNull();
});

test('app actions are recorded, conversation goes to the avatar', () => {
  expect(consumes({ type: 'tryOn', item: 'hat' })).toBe(true);
  expect(consumes({ type: 'chat', outfit: 'jeans' })).toBe(false);
  expect(consumes(null)).toBe(false);
});
