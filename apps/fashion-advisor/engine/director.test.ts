// What the avatar is told: the limits, the staged answers, and that nothing
// it hears can let it claim a try-on or a score the app has not produced.
import { describe, expect, test } from 'vitest';
import { boardState, NOTES, READING_LINES, say, STYLE_CONFIRM_LINES, TRY_ON_ACK_LINES, TRY_ON_BUSY_LINES, TRY_ON_INTRO_LINES } from './director.ts';
import { ALL_BODY_ZONES } from './items.ts';
import type { Analysis, View } from './types.ts';

const WIDE = 'とても長い商品名の説明';

function viewOf(partial: Partial<View> = {}): View {
  return {
    rev: 1, step: 'styling', name: 'Sam', nameSkipped: false, target: 'smart casual', category: '', photo: 'present', describedOutfit: '',
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

describe('limits', () => {
  test('every standing note fits the 2,000-character limit', () => {
    expect(NOTES.length).toBeGreaterThan(0);
    for (const note of NOTES) expect(note.length).toBeLessThanOrEqual(2000);
  });

  test('the state stays under 3,858 characters at its fullest: the cap of pieces, the widest characters, every field at length', () => {
    const long = (n: number) => (WIDE.repeat(Math.ceil(n / WIDE.length))).slice(0, n);
    const v = viewOf({
      name: long(48), target: long(140), describedOutfit: long(400), latestItem: long(48),
      image: { url: '/x', item: long(48), kind: 'tryon' },
      analysis: analysis({
        target_style: long(80), style_summary: long(56), occasion: long(48), color_palette: [long(20), long(20), long(20), long(20), long(20)],
        what_works: long(263), style_tip: long(263),
        suggestions: Array.from({ length: 18 }, (_, i) => ({ item: `${long(44)} ${i}`, text: long(90) })),
        tried_items: Array.from({ length: 20 }, (_, i) => `${long(44)} ${i}`),
      }),
      jobs: { photo: true, analysing: true, tryOn: long(48), queued: [long(48), long(48)], more: true },
    });
    expect(boardState(v).length).toBeLessThan(3858);
  });

  test('every onboarding state fits too', () => {
    for (const step of ['name', 'style', 'photo'] as const) {
      expect(boardState(viewOf({ step, photo: 'none', image: null, nameAsks: 1, photoAsks: 1, describedOutfit: 'x'.repeat(400) })).length).toBeLessThan(3858);
    }
  });
});

describe('the state never leaks what the avatar must not have', () => {
  test('no image URL, token or data', () => {
    const v = viewOf({ analysis: analysis({ suggestions: [{ item: 'Slim Navy Silk Tie', text: 'x', image_url: '/api/apps/fashion-advisor/thumbs/slim', amazon_search_url: 'https://amazon.com/s?k=tie' }] }) });
    const state = boardState(v);
    for (const leak of ['/api/', 'http', 'data:', '0123456789abcdef', 'amazon.com']) expect(state).not.toContain(leak);
  });

  test('a try-on being rendered is not on screen, and it is said', () => {
    const state = boardState(viewOf({ analysis: analysis(), jobs: { photo: false, analysing: false, tryOn: 'Camel Wool Topcoat', queued: [], more: false } }));
    expect(state).toContain('putting the Camel Wool Topcoat on their photo: it is NOT on their screen yet');
    expect(state).toContain('On their screen: their own photo.');
    expect(state).not.toMatch(/Topcoat added by the app/);
  });

  test('before the first read there is no score to repeat', () => {
    const state = boardState(viewOf({ jobs: { photo: false, analysing: true, tryOn: null, queued: [], more: false } }));
    expect(state).toContain("there is no score yet. Don't guess one");
    expect(state).not.toMatch(/out of 10/);
  });

  test('a re-read says the score on screen is the previous one', () => {
    expect(boardState(viewOf({ analysis: analysis(), jobs: { photo: false, analysing: true, tryOn: null, queued: [], more: false } }))).toContain('the score above is the previous one');
  });

  test('with try-ons switched off, the avatar is told never to say a piece is on them', () => {
    expect(boardState(viewOf({ analysis: analysis(), tryOnAvailable: false }))).toContain('never say a piece is on them');
  });
});

describe('staged answers', () => {
  test('the next piece and the score are staged for when they ask', () => {
    const state = boardState(viewOf({ analysis: analysis({ tried_items: ['Slim Navy Silk Tie'] }) }));
    expect(state).toContain('If they ask what to try next, suggest the Camel Wool Topcoat');
    expect(state).toContain("don't make up a different score");
    expect(state).toContain('6 out of 10 for smart casual');
  });

  test('the name question: ask once, then never a third time', () => {
    const first = boardState(viewOf({ step: 'name', name: '', target: '', photo: 'none', image: null }));
    expect(first).toContain('ask for it warmly, once');
    const second = boardState(viewOf({ step: 'name', name: '', target: '', photo: 'none', image: null, nameAsks: 1 }));
    expect(second).toContain('Never ask for a name a third time');
  });

  test('what people say instead of a name gets a real answer', () => {
    const state = boardState(viewOf({ step: 'name', name: '', target: '', photo: 'none', image: null }));
    // "I have no camera": the photo is a file here, so that is no obstacle.
    expect(state).toContain('no camera is needed');
    // "Show me with a hat": a photo first, then straight back to it.
    expect(state).toContain("you'll come straight back to it");
    // "I'm looking for your name right now" was the app's bookkeeping read aloud.
    expect(state).toContain('Never say what you are collecting');
  });

  test('a style already given is not asked for again', () => {
    expect(boardState(viewOf({ step: 'name', name: '', photo: 'none', image: null }))).toContain('confirm the look they\'re going for (smart casual)');
  });

  test('the photo question: once more at most, and it can be dropped', () => {
    const state = boardState(viewOf({ step: 'photo', photo: 'none', image: null, photoAsks: 1 }));
    expect(state).toContain('you cannot open their camera');
    expect(state).toContain('Never ask a third time');
  });

  test('with the photo refused, the avatar is told every turn that the answer was no', () => {
    const state = boardState(viewOf({ photo: 'declined', image: null }));
    expect(state).toContain('that answer is final');
    expect(state).toContain('Never refuse a question because there is no photo');
    expect(state).toContain('ask them to describe it once');
  });

  test('the outfit they typed out is carried, and not asked for again', () => {
    const state = boardState(viewOf({ photo: 'declined', image: null, describedOutfit: "I'm wearing black jeans, a grey crewneck and white sneakers" }));
    expect(state).toContain('grey crewneck');
    expect(state).toContain("don't ask them to describe it again");
  });

  test('no no-photo guidance once there is a photo, or for a session that never refused', () => {
    expect(boardState(viewOf({ analysis: analysis() }))).not.toContain('that answer is final');
    expect(boardState(viewOf({ step: 'photo', photo: 'none', image: null }))).not.toContain('that answer is final');
  });
});

describe('events', () => {
  test('the read: the score change with a try-on, and the next piece offered', () => {
    const v = viewOf({ analysis: analysis({ style_score: 8, tried_items: ['Slim Navy Silk Tie'] }) });
    const up = say.analysis(v, { added: 'Slim Navy Silk Tie', previousScore: 6 });
    expect(up.text).toContain('lifts the look by 2 points (it was 6)');
    expect(up.offer).toBe('Camel Wool Topcoat');
    expect(up.text).toContain('try on the Camel Wool Topcoat next');
    expect(say.analysis(viewOf({ analysis: analysis({ style_score: 5 }) }), { added: 'Camel Wool Topcoat', previousScore: 6 }).text).toContain('hurts the balance by 1');
    expect(say.analysis(viewOf({ analysis: analysis({ style_score: 6 }) }), { added: 'Camel Wool Topcoat', previousScore: 6 }).text).toContain('keeps the score steady at 6');
    expect(say.analysis(viewOf({ analysis: analysis() })).text).not.toMatch(/lifts|hurts|steady/);
  });

  test('with try-ons off, no piece is offered to be put on', () => {
    const e = say.analysis(viewOf({ analysis: analysis(), tryOnAvailable: false }));
    expect(e.offer).toBeUndefined();
    expect(e.text).toContain("don't offer to put it on them");
  });

  test('acknowledgements are marked, so a spoken request (already answered) does not get a second one', () => {
    for (const e of [say.tryOnAck('Slim Navy Silk Tie'), say.styleSet(viewOf()), say.retake(), say.reset(), say.photoHow()]) expect(e.ack).toBe(true);
    for (const e of [say.tryOnOnScreen('tie'), say.tryOnHidden('white sneakers'), say.analysisFailed(), say.tryOnFailed('tie', false)]) expect(e.ack).toBeFalsy();
  });

  test('a piece is never said to be on before it is', () => {
    expect(say.tryOnAck('Camel Wool Topcoat').text).toContain("It is not on yet: don't describe it");
    expect(say.tryOnOnScreen('Camel Wool Topcoat').text).toContain("don't describe it");
  });

  test('ttl stays within the API limit', () => {
    const all = [say.start(), say.named(viewOf()), say.nameSkipped(viewOf()), say.styleSet(viewOf()), say.photoHow(), say.photoDeclined(viewOf()), say.photoReceived(viewOf()),
      say.photoNeedsStyle(viewOf()), say.analysis(viewOf({ analysis: analysis() })), say.analysisFailed(), say.tryOnAck('x'), say.tryOnBusy('x', 'y'), say.tryOnOnScreen('x'),
      say.tryOnHidden('x'), say.tryOnSelf(), say.tryOnNeedsPhoto('x'), say.tryOnUnavailable('x'), say.tryOnFailed('x', true), say.moreReady(['a'], false, true), say.moreCapped(18),
      say.needsRead('x'), say.retargeting(viewOf()), say.steer('formal'), say.retake(), say.reset()];
    for (const e of all) {
      expect(e.ttl).toBeGreaterThan(0);
      expect(e.ttl).toBeLessThanOrEqual(60);
    }
  });

  test('no line claims a name or a backstory: those belong to the avatar it runs on', () => {
    // Upstream's openers each began "Hey, I'm Tyra Banks", over whichever avatar the session had.
    for (const line of [...STYLE_CONFIRM_LINES, ...READING_LINES, ...TRY_ON_ACK_LINES, ...TRY_ON_BUSY_LINES, ...TRY_ON_INTRO_LINES, say.start().text]) {
      expect(line).not.toMatch(/Tyra|Emery|runway|backstage|cover shoot/i);
    }
  });

  test('the refusal acknowledgement offers the thing it can do', () => {
    const text = say.photoDeclined(viewOf({ photo: 'declined' })).text.toLowerCase();
    expect(text).toContain('skip');
    expect(text).toContain('wearing');
    expect(say.photoDeclined(viewOf({ photo: 'declined', describedOutfit: 'black jeans and a tee' })).text).not.toContain('Tell me what you are wearing');
  });

  test('nothing the avatar is told uses the words the original banned', () => {
    const everything = [...NOTES, boardState(viewOf({ analysis: analysis() })), say.analysis(viewOf({ analysis: analysis() })).text].join(' ');
    expect(everything).not.toMatch(/SPEAK:|display_style_analysis|generate_fashion_image|recommend_more_items/);
  });
});
