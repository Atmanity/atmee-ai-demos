import { expect, test } from 'vitest';
import { fitWithin, jpegName, MAX_SIDE, photoFile } from './photo.ts';

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

test('a photo shared in the call keeps its name, as a JPEG', () => {
  expect(jpegName('IMG_0042.HEIC')).toBe('IMG_0042.jpg');
  expect(jpegName('look two.png')).toBe('look two.jpg');
  expect(jpegName('outfit.JPEG')).toBe('outfit.JPEG');
  expect(jpegName('.png')).toBe('photo.jpg');
  const file = photoFile({ mime: 'image/jpeg', data: '', preview: 'blob:x', blob: new Blob(['x'], { type: 'image/jpeg' }) }, 'look.webp');
  expect([file.name, file.type]).toEqual(['look.jpg', 'image/jpeg']);
});
