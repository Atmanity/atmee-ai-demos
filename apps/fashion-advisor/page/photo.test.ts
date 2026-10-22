import { expect, test } from 'vitest';
import { fitWithin, MAX_SIDE } from './photo.ts';

test('a large photo is scaled so its longer side is 1280 px, keeping its shape', () => {
  expect(fitWithin(4032, 3024)).toEqual({ width: MAX_SIDE, height: 960 });
  expect(fitWithin(3024, 4032)).toEqual({ width: 960, height: MAX_SIDE });
});

test('a small photo is never upscaled', () => {
  expect(fitWithin(1024, 1024)).toEqual({ width: 1024, height: 1024 });
  expect(fitWithin(640, 480, 1280)).toEqual({ width: 640, height: 480 });
});

test('degenerate sizes stay at least one pixel', () => {
  expect(fitWithin(0, 0)).toEqual({ width: 1, height: 1 });
  expect(fitWithin(10000, 1)).toEqual({ width: 1280, height: 1 });
});
