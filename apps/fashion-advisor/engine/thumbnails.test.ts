// Ported from the original's test_suggestion_thumbnails.py: catalogue shots
// render in the background, each garment once, a failure never stops the
// rest, and with no image model there are none (not broken cards).
import { expect, test } from 'vitest';
import { Stylist, type Models } from './stylist.ts';
import { ThumbnailRack } from './thumbnails.ts';
import type { Img } from './types.ts';

const shot: Img = { mime: 'image/jpeg', bytes: new Uint8Array(200) };
const rack = (render: (item: string) => Promise<Img | null>, enabled = true) => new ThumbnailRack(render, { enabled, urlFor: (key) => `/thumbs/${encodeURIComponent(key)}` });

test('one shot per item, served by URL', async () => {
  const asked: string[] = [];
  const r = rack(async (item) => { asked.push(item); return shot; });
  r.ensure(['Cap', 'Beanie']);
  await r.idle();
  expect(asked.sort()).toEqual(['Beanie', 'Cap']);
  expect(r.url('cap')).toBe('/thumbs/cap');
  expect(r.image('beanie')).toBe(shot);
});

test('the same item is not paid for twice, however it is cased or spaced', async () => {
  // A re-read republishes the same pieces; each repeat render is a paid picture identical to one on screen.
  const asked: string[] = [];
  const r = rack(async (item) => { asked.push(item); return shot; });
  r.ensure(['Cap']);
  await r.idle();
  r.ensure(['Cap', 'cap', ' CAP ']);
  await r.idle();
  expect(asked).toEqual(['Cap']);
});

test('a failed render does not stop the others, and is not retried in a loop', async () => {
  let calls = 0;
  const r = rack(async () => {
    calls += 1;
    if (calls === 1) throw new Error('provider down');
    return shot;
  });
  r.ensure(['A', 'B']);
  await r.idle();
  expect([r.url('a'), r.url('b')].filter(Boolean)).toHaveLength(1);
  r.ensure(['A', 'B']);
  await r.idle();
  expect(calls).toBe(2);
});

test('no image model: nothing is rendered or promised', async () => {
  let calls = 0;
  const off = rack(async () => { calls += 1; return shot; }, false);
  off.ensure(['Cap']);
  expect(off.pending(['Cap'])).toBe(0);
  expect(calls).toBe(0);
  const unconfigured = rack(async () => null);
  unconfigured.ensure(['Cap']);
  await unconfigured.idle();
  expect(unconfigured.url('cap')).toBeUndefined();
});

test('three at a time (the image API is rate limited per second), and the board knows how many are pending', async () => {
  let active = 0;
  let peak = 0;
  const gates: (() => void)[] = [];
  const r = rack(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => gates.push(resolve));
    active -= 1;
    return shot;
  });
  const items = ['A', 'B', 'C', 'D', 'E', 'F'];
  r.ensure(items);
  expect(r.pending(items)).toBe(6);
  const drain = setInterval(() => gates.splice(0).forEach((go) => go()), 2);
  await r.idle();
  clearInterval(drain);
  expect(peak).toBe(3);
  expect(r.pending(items)).toBe(0);
});

test('the shots reach the cards in every view, so a reload or a poll never loses one', async () => {
  const gates: (() => void)[] = [];
  const r = rack(async () => { await new Promise<void>((resolve) => gates.push(resolve)); return shot; });
  const models: Models = {
    tryOnAvailable: true,
    analyze: async (_img, input) => ({ target_style: input.target, style_summary: 's', occasion: '', style_score: 6, color_palette: ['a', 'b', 'c'], what_works: 'w', style_tip: 't' }),
    zones: async () => new Set(['head', 'neck', 'upper_body', 'lower_body', 'wrist', 'feet'] as const),
    suggest: async () => [{ item: 'Navy Blue Corduroy Cap', text: 'a' }, { item: 'Grey Cashmere Beanie', text: 'b' }],
    tryOn: async () => null,
  };
  const stylist = new Stylist(models, { imageUrl: (t) => `/img/${t}`, thumbnails: r });
  stylist.act({ type: 'name', name: 'Sam', style: 'casual' });
  const photo = stylist.act({ type: 'photo', mime: 'image/jpeg', data: Buffer.alloc(300).toString('base64'), source: 'upload' });
  await stylist.wait(photo.job!.id, 'done');
  // The two pieces from the model, topped up to six from the original's stand-ins.
  expect(stylist.view().thumbnailsPending).toBe(stylist.view().analysis!.suggestions.length);
  expect(stylist.view().analysis!.suggestions.every((s) => !s.image_url)).toBe(true);
  const drain = setInterval(() => gates.splice(0).forEach((go) => go()), 2);
  await r.idle();
  clearInterval(drain);
  const pieces = stylist.view().analysis!.suggestions;
  expect(pieces.slice(0, 2).map((s) => s.image_url)).toEqual(['/thumbs/navy%20blue%20corduroy%20cap', '/thumbs/grey%20cashmere%20beanie']);
  expect(pieces.every((s) => s.image_url)).toBe(true);
  expect(stylist.view().thumbnailsPending).toBe(0);
});
