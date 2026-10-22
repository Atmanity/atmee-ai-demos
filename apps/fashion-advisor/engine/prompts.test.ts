// Model answers are untrusted input that ends up on screen and in the
// avatar's state: the normalisers keep the original's clamps and fallbacks.
import { describe, expect, test } from 'vitest';
import { ALL_BODY_ZONES } from './items.ts';
import { analysisFrom, analysisPrompt, isTransientError, retryTransient, suggestionsFrom, suggestionsPrompt, suggestionThumbnailPrompt, tryOnPrompt, zonesFrom } from './prompts.ts';

describe('the style read', () => {
  test('clamped and cleaned', () => {
    const a = analysisFrom({ style_summary: '  A very long summary that goes on and on and on and on and on and on ', occasion: 'Dinner', style_score: 14, color_palette: ['navy'], what_works: 'w '.repeat(200), style_tip: '' }, 'smart casual');
    expect(a.style_score).toBe(10);
    expect(a.style_summary.length).toBeLessThanOrEqual(56);
    expect(a.color_palette).toEqual(['navy', 'neutral', 'black']);
    expect(a.what_works.length).toBeLessThanOrEqual(263);
    expect(a.what_works.endsWith('...')).toBe(true);
    expect(a.style_tip).toBe('Refine fit and color balance.');
    expect(a.target_style).toBe('smart casual');
  });

  test('a missing or silly score is 5; the floor is 1', () => {
    expect(analysisFrom({ style_score: 'great' }, '').style_score).toBe(5);
    expect(analysisFrom({}, '').style_score).toBe(5);
    expect(analysisFrom({ style_score: -3 }, '').style_score).toBe(1);
    expect(analysisFrom({}, '').style_summary).toBe('Style review');
  });

  test('the score is asked against the target', () => {
    const prompt = analysisPrompt({ userName: '', target: 'wedding', context: 'After adding: Camel Wool Topcoat' });
    expect(prompt).toContain('Desired style goal: wedding.');
    expect(prompt).toContain('User name: unknown.');
    expect(prompt).toContain('Context: After adding: Camel Wool Topcoat.');
  });
});

describe('the body zones in the photo', () => {
  test('only real zones', () => {
    expect([...zonesFrom({ visible_body_parts: ['head', 'upper_body', 'Elbow', ' FEET '] })].sort()).toEqual(['feet', 'head', 'neck', 'upper_body']);
  });

  test('the neck is visible whenever the head and the upper body are', () => {
    // Gemini sometimes dropped "neck" after a hat try-on, and a necklace was then refused on a neckline in plain view.
    expect(zonesFrom({ visible_body_parts: ['head', 'upper_body'] }).has('neck')).toBe(true);
    expect(zonesFrom({ visible_body_parts: ['upper_body'] }).has('neck')).toBe(false);
  });

  test('on any doubt, every zone', () => {
    for (const raw of [null, {}, { visible_body_parts: 'head' }, { visible_body_parts: [] }, { visible_body_parts: ['elbow'] }]) {
      expect(zonesFrom(raw).size).toBe(ALL_BODY_ZONES.length);
    }
  });
});

describe('suggested pieces', () => {
  test('named pieces only, trimmed', () => {
    expect(suggestionsFrom({ suggestions: [{ item: '  Slim Navy Silk Tie ', text: 'x'.repeat(200) }, { item: '', text: 'no item' }, 'junk', null] }))
      .toEqual([{ item: 'Slim Navy Silk Tie', text: 'x'.repeat(90) }]);
    expect(suggestionsFrom({ suggestions: 'none' })).toEqual([]);
  });

  test('the prompt carries the zones as a constraint, the target, and what was tried', () => {
    const prompt = suggestionsPrompt({ zones: new Set(['upper_body', 'head'] as const), target: 'old money', recent: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] });
    expect(prompt).toContain('visible body zones only (this is a CONSTRAINT, not the item name): head, upper_body');
    expect(prompt).toContain("desired style goal: 'old money'");
    expect(prompt).toContain('Avoid these recently tried items: b, c, d, e, f, g, h, i.');
  });
});

describe('the image prompts', () => {
  test("the thumbnail prompt is upstream's, word for word", () => {
    // Without the refusals the model returned a whole styled outfit, or the
    // garment on a mannequin: beside a real try-on, a second person.
    const prompt = suggestionThumbnailPrompt('Navy Blue Corduroy Cap');
    expect(prompt).toContain('exactly one fashion item: "Navy Blue Corduroy Cap"');
    expect(prompt).toContain('only that single named item');
    expect(prompt).toContain('dark neutral studio background');
    for (const banned of ['No person', 'no mannequin', 'no body parts', 'no watermark']) expect(prompt).toContain(banned);
  });

  test('the try-on prompt adds the piece and keeps everything else', () => {
    expect(tryOnPrompt('Camel Wool Topcoat', 'Adds structure.', 'smart-casual'))
      .toBe('Add Camel Wool Topcoat to this person in a realistic, natural way. Adds structure. Keep the overall vibe aligned with a smart-casual style direction. Keep everything else — face, body, background — exactly the same.');
    expect(tryOnPrompt('tie', '', '')).toBe('Add tie to this person in a realistic, natural way. Keep everything else — face, body, background — exactly the same.');
  });
});

describe('retries', () => {
  test('network blips, 5xx and 429 are worth another go; the rest are not', () => {
    for (const msg of ['gemini-x: 503 overloaded', 'fetch failed', 'The operation was aborted due to timeout', '429 Too Many Requests']) expect(isTransientError(new Error(msg)), msg).toBe(true);
    for (const msg of ['GEMINI_API_KEY is not set', '400 invalid argument']) expect(isTransientError(new Error(msg)), msg).toBe(false);
  });

  test('three attempts with a growing pause, then the failure is thrown', async () => {
    const waits: number[] = [];
    let calls = 0;
    await expect(retryTransient(async () => { calls += 1; throw new Error('503'); }, { sleep: async (ms) => { waits.push(ms); } })).rejects.toThrow('503');
    expect(calls).toBe(3);
    expect(waits).toEqual([1200, 2400]);
  });

  test('a success after a blip is returned; a hard error is not retried', async () => {
    let calls = 0;
    expect(await retryTransient(async () => { calls += 1; if (calls === 1) throw new Error('timeout'); return 'ok'; }, { sleep: async () => {} })).toBe('ok');
    calls = 0;
    await expect(retryTransient(async () => { calls += 1; throw new Error('400 bad request'); }, { sleep: async () => {} })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
