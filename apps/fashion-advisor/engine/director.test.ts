// What Emery is told: the API's limits, the board she answers from, what she
// has seen of it, and that nothing she is told lets her claim a try-on or a
// score Notch has not produced, or act on her own.
import { describe, expect, test } from 'vitest';
import { boardState, dropCaption, instructions, said, say, tools, TRY_ON_ACK_LINES, TRY_ON_INTRO_LINES, type Sight } from './director.ts';
import { ALL_BODY_ZONES } from './items.ts';
import type { Analysis, View } from './types.ts';

const WIDE = 'とても長い商品名の説明';

function viewOf(partial: Partial<View> = {}): View {
  return {
    rev: 1, step: 'styling', name: '', nameSkipped: true, target: 'smart casual', category: '', photo: 'present', describedOutfit: '',
    image: { url: '/api/apps/fashion-advisor/studios/abc/images/0123456789abcdef', item: 'Current look', kind: 'look' },
    analysis: null, visibleZones: [...ALL_BODY_ZONES], latestItem: '',
    jobs: { photo: false, analysing: false, tryOn: null, queued: [], more: false },
    notice: null, tryOnAvailable: true, thumbnailsPending: 0, canLoadMore: true, nameAsks: 0, photoAsks: 0, wantsPhoto: false,
    ...partial,
  };
}

const analysis = (partial: Partial<Analysis> = {}): Analysis => ({
  target_style: 'smart casual', style_summary: 'Clean navy base', occasion: 'Dinner', style_score: 6, color_palette: ['navy', 'white', 'denim'],
  what_works: 'The navy layer frames you.', style_tip: 'Ground it with sharper shoes.',
  suggestions: [{ item: 'Slim Navy Silk Tie', text: 'Sharpens the neckline.' }, { item: 'Camel Wool Topcoat', text: 'Adds structure.' }],
  tried_items: [], ...partial,
});

describe('the API limits', () => {
  test.each([true, false])('the tools fit (try-ons %s): names, descriptions, schemas, all await, within 28 s', (tryOns) => {
    const list = tools(tryOns);
    expect(list.length).toBeLessThanOrEqual(30);
    const names = list.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of list) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
      expect(['web_search', 'lookup']).not.toContain(tool.name);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeLessThanOrEqual(500);
      expect(tool.parameters.type).toBe('object');
      expect(JSON.stringify(tool.parameters).length).toBeLessThanOrEqual(4096);
      expect(tool['x-atmee']?.mode).toBe('await');
      expect(tool['x-atmee']!.timeoutSeconds!).toBeLessThanOrEqual(28);
    }
    expect(JSON.stringify(list).length).toBeLessThanOrEqual(24576);
  });

  test.each([true, false])('the instructions fit and name every tool (try-ons %s)', (tryOns) => {
    const text = instructions(tryOns);
    expect(text.length).toBeLessThanOrEqual(4000);
    for (const tool of tools(tryOns)) expect(text).toContain(tool.name);
  });

  test('without an image model there are no try-on tools, and Emery is told never to offer one', () => {
    expect(tools(false).map((t) => t.name)).toEqual(['rate_outfit', 'suggest_pieces']);
    expect(tools(true).map((t) => t.name)).toEqual(['rate_outfit', 'suggest_pieces', 'try_on', 'restore_photo']);
    expect(instructions(false)).not.toMatch(/try_on|restore_photo/);
    expect(instructions(false)).toContain('never offer a try-on');
  });

  test('the instructions keep the hard-won rules', () => {
    const text = instructions(true);
    for (const rule of ['Every request that changes the screen is a tool call', 'Never say an action happened', 'the moment they say what they are dressing for', 'call it with that direction', 'Never give, guess or hint at a score yourself', 'never say it is on them or describe it',
      'Never body-shame', 'you cannot open their camera', 'answer from the live board in your context, no tool', 'only when they ask']) expect(text).toContain(rule);
  });

  test('the resetting tool says "only when the user asks"', () => {
    expect(tools(true).find((t) => t.name === 'restore_photo')!.description).toContain('Only when the user asks');
  });

  test('the board stays under 3,858 characters at its fullest: a full rail, the widest characters, every field at length', () => {
    const long = (n: number) => (WIDE.repeat(Math.ceil(n / WIDE.length))).slice(0, n);
    const v = viewOf({
      target: long(140), latestItem: long(48), image: { url: '/x', item: long(48), kind: 'tryon' },
      analysis: analysis({
        target_style: long(80), style_summary: long(56), occasion: long(48), color_palette: [long(20), long(20), long(20), long(20), long(20)],
        what_works: long(263), style_tip: long(263),
        suggestions: Array.from({ length: 18 }, (_, i) => ({ item: `${long(44)} ${i}`, text: long(90) })),
        tried_items: Array.from({ length: 20 }, (_, i) => `${long(44)} ${i}`),
      }),
      jobs: { photo: true, analysing: true, tryOn: long(48), queued: [long(48), long(48)], more: true },
      tryOnAvailable: false, notice: { kind: 'error', text: long(120) },
    });
    expect(boardState(v).length).toBeLessThan(3858);
    // And ten looks to choose between (a drop's most), each with a long name, a score and unseen.
    const looks: Sight['looks'] = Array.from({ length: 10 }, (_, i) => ({ name: long(80), inMirror: i === 9, seen: false, score: 10 }));
    expect(boardState(v, { mirrorSeen: false, looks }).length).toBeLessThan(3858);
  });
});

describe('the board never says what Emery must not have', () => {
  test('no image URL, token or shop link', () => {
    const v = viewOf({ analysis: analysis({ suggestions: [{ item: 'Slim Navy Silk Tie', text: 'x', image_url: '/api/apps/fashion-advisor/thumbs/slim', amazon_search_url: 'https://amazon.com/s?k=tie' }] }) });
    const state = boardState(v);
    for (const leak of ['/api/', 'http', 'data:', '0123456789abcdef', 'amazon.com']) expect(state).not.toContain(leak);
  });

  test('a try-on being rendered is not on screen, and it says so', () => {
    const state = boardState(viewOf({ analysis: analysis(), jobs: { photo: false, analysing: false, tryOn: 'Camel Wool Topcoat', queued: [], more: false } }));
    expect(state).toContain('putting the Camel Wool Topcoat on their photo right now: it is NOT on their screen yet');
    expect(state).toContain('In the mirror: their own photo.');
  });

  test('before the first verdict there is no score to repeat', () => {
    const state = boardState(viewOf({ jobs: { photo: false, analysing: true, tryOn: null, queued: [], more: false } }));
    expect(state).toContain("there is no score yet. Don't guess one");
    expect(state).not.toMatch(/out of 10/);
  });

  test('a re-read says the verdict on screen is the previous one', () => {
    expect(boardState(viewOf({ analysis: analysis(), jobs: { photo: false, analysing: true, tryOn: null, queued: [], more: false } }))).toContain('the verdict above is the previous one');
  });

  test('an empty fitting says what to ask for, and where the photo goes', () => {
    const state = boardState(viewOf({ target: '', image: null, photo: 'none' }));
    expect(state).toContain('Dressing for: not set yet');
    expect(state).toContain('The mirror is empty');
    expect(state).toContain('Use an example outfit');
  });

  test('the verdict, the rail in order (for "the second one"), and the next piece are on the board', () => {
    const state = boardState(viewOf({ analysis: analysis({ tried_items: ['Slim Navy Silk Tie'] }) }));
    expect(state).toContain('6 out of 10 for smart casual');
    expect(state).toContain('1. Slim Navy Silk Tie; 2. Camel Wool Topcoat');
    expect(state).toContain('The strongest next piece: the Camel Wool Topcoat');
    expect(state).toContain('never a different score');
  });

  test('with try-ons off, Emery is told never to offer one', () => {
    expect(boardState(viewOf({ analysis: analysis(), tryOnAvailable: false }))).toContain('never offer a try-on');
  });
});

describe('what Emery sees', () => {
  test.each([true, false])("the rules say what she sees now, and that a score is Notch's alone (try-ons %s)", (tryOns) => {
    const text = instructions(tryOns);
    expect(text).not.toMatch(/cannot see (?:them|the photo)|can't see (?:them|the photo)/i);
    for (const rule of ['You never see them live, only what they share with you in the call', 'never a try-on', 'the board says which photos you have seen',
      'Notch reads the photo in the mirror and alone scores it', "a score is Notch's alone, for the look in the mirror", 'they tap it under the mirror',
      'An invitation or dress code says what they are dressing for: call rate_outfit with that occasion', 'or a colour or detail of a photo you have not seen']) expect(text).toContain(rule);
  });

  test('the board says whether she has seen the photo in the mirror; a try-on she never sees', () => {
    expect(boardState(viewOf())).toContain("In the mirror: their own photo. You haven't seen it: don't describe it.");
    expect(boardState(viewOf(), { mirrorSeen: true })).toContain('In the mirror: their own photo. You have seen it: they shared it with you.');
    const tryOn = boardState(viewOf({ image: { url: '/x', item: 'Camel Wool Topcoat', kind: 'tryon' }, latestItem: 'Camel Wool Topcoat' }), { mirrorSeen: true });
    expect(tryOn).toContain("with the Camel Wool Topcoat put on by Notch (a try-on, which you can't see)");
    expect(tryOn).not.toContain('You have seen it');
  });

  test("the looks they are choosing between: which is in the mirror, Notch's score for each so far, and which she has not seen", () => {
    const state = boardState(viewOf({ analysis: analysis({ style_score: 7 }) }), {
      mirrorSeen: true,
      looks: [{ name: 'navy.jpg', inMirror: false, seen: true, score: 5 }, { name: 'camel.jpg', inMirror: true, seen: true, score: 7 }, { name: 'black.jpg', inMirror: false, seen: false }],
    });
    expect(state).toContain('In the mirror: their own photo (look 2). You have seen it');
    expect(state).toContain("The looks they are choosing between, with Notch's score for this occasion once in the mirror (they tap one under it to put it there): 1. \"navy.jpg\": 5/10; 2. \"camel.jpg\" (in the mirror): 7/10; 3. \"black.jpg\". You haven't seen look 3.");
    // One photo is no choice.
    expect(boardState(viewOf(), { mirrorSeen: true, looks: [{ name: 'navy.jpg', inMirror: true, seen: true }] })).not.toContain('choosing between');
  });

  test('a photo and no occasion yet: the board says it cannot be scored, so she asks', () => {
    expect(boardState(viewOf({ target: '' }))).toContain("Dressing for: not set yet, so the photo can't be scored: ask what they're dressing for");
    expect(boardState(viewOf({ target: '', image: null, photo: 'none' }))).not.toContain("can't be scored");
  });

  test('what the user says with the files they share', () => {
    expect(dropCaption({ photos: 3, occasion: 'dinner out' })).toBe("3 outfits I'm choosing between for dinner out.");
    expect(dropCaption({ photos: 1 })).toBe('My outfit.');
    expect(dropCaption({ photos: 1, example: true, occasion: 'dinner out' })).toBe('The example outfit for dinner out.');
    expect(dropCaption({ invitation: true })).toBe("The invitation: it says what I'm dressing for.");
    expect(dropCaption({})).toBeUndefined();
  });

  test("a photo in its own drop: only Notch's verdict is said, never that a photo came in; a look she saw earlier is said to be in, with no score", () => {
    expect(said.sharedRead('look 1 of 3 ("navy.jpg")', 'Done: the verdict is 6 out of 10.')).toBe('Notch has read look 1 of 3 ("navy.jpg"), the one in the mirror. Done: the verdict is 6 out of 10.');
    expect(said.photoIn(viewOf(), 'look 2 of 3', true)).toMatch(/^Done: look 2 of 3 is in the mirror now, .*you saw it when they shared it, but never guess its score\.$/);
    expect(said.photoIn(viewOf())).toContain("don't guess anything about it");
  });
});

describe('the words Emery speaks from', () => {
  test('the verdict: the score change with a try-on, and the next piece offered only if they say yes', () => {
    const v = viewOf({ analysis: analysis({ style_score: 8, tried_items: ['Slim Navy Silk Tie'] }) });
    const up = say.analysis(v, { added: 'Slim Navy Silk Tie', previousScore: 6 });
    expect(up.text).toContain('Done: with the Slim Navy Silk Tie on, the outfit scores 8 out of 10 for smart casual');
    expect(up.text).toContain('lifts the look by 2 points (it was 6)');
    expect(up.offer).toBe('Camel Wool Topcoat');
    expect(up.text).toContain("ask whether they'd like to try on the Camel Wool Topcoat next; put it on only if they say yes");
    expect(say.analysis(viewOf({ analysis: analysis({ style_score: 5 }) }), { added: 'Camel Wool Topcoat', previousScore: 6 }).text).toContain('hurts the balance by 1');
    expect(say.analysis(viewOf({ analysis: analysis({ style_score: 6 }) }), { added: 'Camel Wool Topcoat', previousScore: 6 }).text).toContain('keeps the score steady at 6');
    const plain = say.analysis(viewOf({ analysis: analysis() })).text;
    expect(plain).toContain('Done: the verdict is 6 out of 10 for smart casual ("Clean navy base")');
    expect(plain).toContain('What works: The navy layer frames you. The one fix: Ground it with sharper shoes.');
    expect(plain).not.toMatch(/lifts|hurts|steady/);
  });

  test('with try-ons off, a piece is named, never offered to be put on', () => {
    const e = say.analysis(viewOf({ analysis: analysis(), tryOnAvailable: false }));
    expect(e.offer).toBeUndefined();
    expect(e.text).toContain('Then name the Slim Navy Silk Tie as the piece to add');
    expect(e.text).not.toMatch(/try on/);
  });

  test('a piece is never said to be on before it is', () => {
    expect(say.tryOnAck('Camel Wool Topcoat').text).toContain("it is not on yet. Say so in a few words");
    expect(say.tryOnAck('Camel Wool Topcoat').text).toContain("don't describe it; you'll be told when it's on their screen");
    expect(say.tryOnOnScreen('Camel Wool Topcoat').text).toContain("don't describe it");
    expect(say.tryOnBusy('Camel Wool Topcoat', 'Slim Navy Silk Tie').text).toContain('neither is on yet');
  });

  test('a refused try-on gives the reason', () => {
    expect(say.tryOnHidden('White Leather Sneakers').text).toContain("their feet aren't in the photo");
    expect(say.tryOnNeedsPhoto('black fedora').text).toContain("Not yet: there's no photo to put the black fedora on");
  });

  test('no result asks Emery to act on her own: every offer waits for a yes', () => {
    const v = viewOf({ analysis: analysis() });
    const texts = [
      say.analysis(v).text, say.moreReady(['Grey Cashmere Beanie', 'Gold Chain'], false, true).text, say.tryOnFailed('tie', false).text,
      said.steered(v, 'streetwear'), said.lost(), say.analysisFailed().text,
    ];
    for (const text of texts) {
      for (const offer of text.match(/(?:ask whether|offer to)[^.]*\./g) ?? []) expect(offer, text).toMatch(/only (?:try again )?if they say|only if they say yes|offer to rate it again/);
    }
  });

  test('the opening follows where the fitting stands', () => {
    // An empty room: her greeting already asked where they're headed, so nothing more (live, the question came twice).
    expect(said.opening(viewOf({ target: '', image: null, photo: 'none' }))).toBeNull();
    expect(said.opening(viewOf({ target: '', image: null, photo: 'none' }), true)).toBeNull();
    expect(said.opening(viewOf({ image: null, photo: 'none' }))).toContain("confirm in a few words that they're dressing for smart casual");
    expect(said.opening(viewOf({ target: '' }))).toContain("don't ask again, wait for their answer");
    expect(said.opening(viewOf({ jobs: { photo: false, analysing: true, tryOn: null, queued: [], more: false } }))).toContain("Don't guess it");
    expect(said.opening(viewOf({ analysis: analysis() }))).toContain('6 out of 10 for smart casual');
    expect(said.opening(viewOf({ analysis: analysis() }), true)).toMatch(/^You have just greeted them; do not greet or introduce yourself again\. They called you back to carry on the same fitting/);
    // Her own greeting already introduced her: the opening never greets again.
    for (const v of [viewOf(), viewOf({ target: '' }), viewOf({ image: null, photo: 'none' })]) {
      expect(said.opening(v)).toMatch(/^You have just greeted them; do not greet or introduce yourself again\./);
      expect(said.opening(v)).not.toMatch(/welcome|introduce yourself as|what (?:are you|they're) dressing for\?/i);
    }
  });

  test('a button press is told as what the user pressed, then what came of it', () => {
    expect(said.pressed('tapped More pieces', 'Two new pieces are on the rail.')).toBe('The user tapped More pieces on screen. Two new pieces are on the rail.');
  });

  test('steering the rail names the fresh pieces and the refreshed verdict', () => {
    const text = said.steered(viewOf({ analysis: analysis({ style_score: 7 }) }), 'streetwear');
    expect(text).toContain('Done: the rail now leans streetwear: Slim Navy Silk Tie, Camel Wool Topcoat first');
    expect(text).toContain('7 out of 10 for smart casual');
    expect(said.steered(viewOf({ analysis: analysis(), notice: { kind: 'error', text: 'x' } }), 'streetwear')).toContain("didn't come through");
  });

  test('every result starts with its plain outcome, so the platform\'s filler cannot pre-judge it', () => {
    const v = viewOf({ analysis: analysis() });
    const results = [
      say.styleSet(viewOf({ image: null })), say.styleSet(v), say.photoNeedsStyle(), say.analysis(v), say.analysisFailed(), say.tryOnAck('x'), say.tryOnBusy('x', 'y'),
      say.tryOnOnScreen('x'), say.tryOnHidden('White Sneakers'), say.tryOnSelf(), say.tryOnNeedsPhoto('x'), say.tryOnUnavailable('x'), say.tryOnFailed('x', true),
      say.moreReady(['a'], false, true), say.moreReady([], false, true), say.moreReady(['a', 'b'], false, false, true), say.lookChanged(), say.tryOnStale('x'), say.moreStale(), say.moreCapped(18), say.needsRead('x'), say.reset(),
    ].map((e) => e.text).concat([
      said.noOccasion(), said.readRunning(v), said.noVerdictYet(), said.tryOnRunning('x'), said.alreadyOwn(), said.alreadyGoing('x'), said.moreOnTheWay(),
      said.whichPiece(), said.notAPiece('x'), said.steered(v, 'streetwear'), said.stillWorking(), said.lost(), said.photoIn(v, 'the example outfit'), said.photoIn(viewOf({ target: '' })), said.photoIn(v, 'look 2 of 3', true),
    ]);
    for (const text of results) expect(text, text).toMatch(/^(Done|Not yet|Not yet rated|Not added|Not applied|Refused|Failed|Started|Queued|Nothing new|Nothing to add|Nothing to do|Already started|Not clear):/);
  });

  test('the tool schemas are lenient: the platform rejects a call that does not fit them before the page sees it', () => {
    for (const tool of tools(true)) {
      const schema = JSON.stringify(tool.parameters);
      for (const strict of ['additionalProperties', 'minLength', 'enum', 'pattern', 'format']) expect(schema, tool.name).not.toContain(strict);
      for (const prop of Object.values((tool.parameters as { properties: Record<string, { maxLength?: number }> }).properties)) expect(prop.maxLength ?? 500).toBeGreaterThanOrEqual(500);
    }
    expect(tools(true).find((t) => t.name === 'try_on')!.parameters.required).toEqual(['piece']);
    expect(tools(true).find((t) => t.name === 'rate_outfit')!.parameters.required).toBeUndefined();
  });

  test('more pieces found for a verdict still being read say where they go', () => {
    expect(say.moreReady(['Grey Beanie'], false, false).text).toMatch(/^Done: 1 new piece is on the rail now, among them Grey Beanie/);
    expect(say.moreReady(['Grey Beanie', 'Gold Chain'], false, false, true).text).toMatch(/^Done: 2 new pieces go on the rail with the new verdict in a moment/);
    expect(say.moreReady(['Grey Beanie'], false, false, true).text).toMatch(/^Done: 1 new piece goes on the rail with the new verdict/);
  });

  test('ttl stays within the API limit', () => {
    const v = viewOf({ analysis: analysis() });
    const all = [say.named(v), say.nameSkipped(), say.styleSet(v), say.photoHow(), say.photoDeclined(v), say.photoReceived(v), say.photoNeedsStyle(),
      say.analysis(v), say.analysisFailed(), say.tryOnAck('x'), say.tryOnBusy('x', 'y'), say.tryOnOnScreen('x'), say.tryOnHidden('x'), say.tryOnSelf(),
      say.tryOnNeedsPhoto('x'), say.tryOnUnavailable('x'), say.tryOnFailed('x', true), say.moreReady(['a'], false, true), say.moreCapped(18),
      say.needsRead('x'), say.retargeting(v), say.steer('formal'), say.retake(), say.reset()];
    for (const e of all) {
      expect(e.ttl).toBeGreaterThan(0);
      expect(e.ttl).toBeLessThanOrEqual(60);
    }
  });

  test('no line claims a name or a backstory: those belong to the host the fitting runs on', () => {
    for (const line of [...TRY_ON_ACK_LINES, ...TRY_ON_INTRO_LINES, said.opening(viewOf())]) expect(line).not.toMatch(/Tyra|runway|backstage|cover shoot/i);
  });
});
