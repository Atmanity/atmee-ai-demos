import { describe, expect, it, vi } from 'vitest';
import { createResampler, createVoice, isQuiet } from './voice.ts';

const frame = (value: number, n = 480) => new Int16Array(n).fill(value);
const ramp = (from: number, n: number) => Int16Array.from({ length: n }, (_, i) => from + i);

describe('the resampler', () => {
  it('makes two samples of every three, across frames, without drift', () => {
    const resample = createResampler();
    let total = 0;
    for (let k = 0; k < 50; k++) total += resample(frame(100)).length;
    expect(total).toBeGreaterThanOrEqual(50 * 320 - 1);
    expect(total).toBeLessThanOrEqual(50 * 320);
  });

  it('interpolates a straight line into a straight line, also where two frames meet', () => {
    const resample = createResampler();
    const out = [...resample(ramp(0, 480)), ...resample(ramp(480, 480))];
    // The input is the line y = x, so output k sits at 1.5 k.
    out.forEach((v, k) => expect(v).toBe(Math.round(1.5 * k)));
  });
});

describe('the voice', () => {
  function setup() {
    const events = { onStart: vi.fn(), onFrame: vi.fn(), onEnd: vi.fn() };
    return { events, voice: createVoice(events, 600) };
  }

  it('opens a piece on the first sound, not on silence', () => {
    const { events, voice } = setup();
    for (let i = 0; i < 10; i++) voice.feed(frame(0));
    expect(events.onStart).not.toHaveBeenCalled();
    voice.feed(frame(5000));
    expect(events.onStart).toHaveBeenCalledOnce();
    expect(events.onFrame).toHaveBeenCalledOnce();
  });

  it('keeps a short pause inside the piece and closes it after 600 ms of quiet', () => {
    const { events, voice } = setup();
    voice.feed(frame(5000));
    for (let i = 0; i < 20; i++) voice.feed(frame(0));   // 400 ms: a pause between words
    voice.feed(frame(5000));
    expect(events.onEnd).not.toHaveBeenCalled();
    for (let i = 0; i < 29; i++) voice.feed(frame(0));
    expect(events.onEnd).not.toHaveBeenCalled();
    voice.feed(frame(0));                                 // the 30th quiet frame: 600 ms
    expect(events.onEnd).toHaveBeenCalledOnce();
    expect(voice.speaking).toBe(false);
  });

  it('counts low noise as quiet', () => {
    expect(isQuiet(frame(200))).toBe(true);
    expect(isQuiet(frame(-400))).toBe(false);
  });
});
