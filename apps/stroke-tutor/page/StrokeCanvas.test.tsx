// @vitest-environment jsdom
// A stroke Ren shows is brushed in from start to end: its direction is the
// lesson. That must replay whenever the stroke is shown anew, including after
// the learner starts the character over.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { StrokeView } from '../engine/types.ts';
import { markKey, type Marks } from './marks.ts';
import { SHOW_MS, StrokeCanvas } from './StrokeCanvas.tsx';

beforeAll(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); frames.length = 0; });

// Animation frames driven by hand, so a brush-in ends exactly when the test says.
const frames: FrameRequestCallback[] = [];
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
/** Runs the waiting frames as if the brush-in's time had passed. */
const finish = () => act(() => { for (const cb of frames.splice(0)) cb(performance.now() + SHOW_MS * 2); });

const shownFirst: StrokeView[] = [{ index: 0, status: 'done', points: [[150, 450], [850, 450]], name: 'the horizontal', teach: 'T' }, { index: 1, status: 'hidden', points: [] }];
const fresh: StrokeView[] = [{ index: 0, status: 'current', points: [] }, { index: 1, status: 'hidden', points: [] }];
const shown: Marks = { [markKey('juu', 0)]: { how: 'shown', tries: 0, asked: true } };
const sheet = (strokes: StrokeView[], marks: Marks) => <StrokeCanvas strokes={strokes} character="juu" marks={marks} grid={1000} label="Practice sheet" />;
const brushing = () => document.querySelector('canvas')!.dataset.showing;

test('a stroke shown, the character started over, and the same stroke shown again: brushed in again', () => {
  const view = render(sheet(fresh, {}));
  view.rerender(sheet(shownFirst, shown));
  expect(brushing()).toBe('0');
  finish();
  expect(brushing()).toBeUndefined();         // the first brush-in is over
  view.rerender(sheet(fresh, {}));            // start over
  view.rerender(sheet(shownFirst, shown));    // shown again
  expect(brushing()).toBe('0');
});

test('strokes already shown when the sheet appears are simply there', () => {
  render(sheet(shownFirst, shown));
  expect(brushing()).toBeUndefined();
});
