import { describe, expect, test } from 'vitest';
import { Downsampler, FRAME, JitterBuffer, RATE } from './audio.ts';

const tone = (hz: number, rate: number, seconds: number, amp = 0.5) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const rms = (x: ArrayLike<number>) => Math.sqrt(Array.from(x).reduce((s, v) => s + v * v, 0) / x.length);

describe('the microphone, as the API hears it: 24 kHz frames of 20 ms', () => {
  test.each([48_000, 44_100, 24_000, 16_000])('from a %i Hz device, one frame per 20 ms, in blocks of 128', (rate) => {
    const ds = new Downsampler(rate, RATE, FRAME);
    const frames: Int16Array[] = [];
    const input = tone(440, rate, 1);
    for (let i = 0; i < input.length; i += 128) ds.push(input.subarray(i, i + 128), (f) => frames.push(f));
    expect(frames.length).toBeGreaterThanOrEqual(49);
    expect(frames.length).toBeLessThanOrEqual(50);
    expect(frames.every((f) => f.length === FRAME)).toBe(true);
    // Speech passes through: a 440 Hz tone keeps its level.
    const out = Float32Array.from(frames.flatMap((f) => Array.from(f)), (v) => v / 32768);
    expect(rms(out.subarray(480))).toBeCloseTo(0.5 / Math.SQRT2, 1);
  });

  test('above the new Nyquist rate, sound is filtered out, not folded back in', () => {
    const ds = new Downsampler(48_000, RATE, FRAME);
    const frames: Int16Array[] = [];
    ds.push(tone(18_000, 48_000, 0.5), (f) => frames.push(f));
    const out = Float32Array.from(frames.slice(2).flatMap((f) => Array.from(f)), (v) => v / 32768);
    expect(rms(out)).toBeLessThan(0.08);
  });

  test('every frame is a new array: one posted to the page is never written again', () => {
    const ds = new Downsampler(24_000, RATE, FRAME);
    const frames: Int16Array[] = [];
    ds.push(tone(300, 24_000, 0.1), (f) => frames.push(f));
    expect(new Set(frames).size).toBe(frames.length);
  });

  test("the worklet runs the class's own source: it stands alone, with no field initialisers a build would lower", () => {
    const source = Downsampler.toString();
    expect(source).not.toMatch(/__publicField|__defNormalProp/);
    const Rebuilt = new Function(`return (${source});`)() as typeof Downsampler;
    const frames: Int16Array[] = [];
    new Rebuilt(48_000, RATE, FRAME).push(tone(440, 48_000, 0.1), (f) => frames.push(f));
    expect(frames.length).toBe(5);              // 100 ms
    expect(new Function(`return (${JitterBuffer.toString()});`)()).toBeTypeOf('function');
  });
});

describe("the avatar's voice, through the jitter buffer", () => {
  const frame = (v: number) => new Int16Array(FRAME).fill(v);

  test('silent until primed, then plays what was sent, resampled to the device', () => {
    const jb = new JitterBuffer(RATE, 48_000, 2400, 14_400);
    const out = new Float32Array(128);
    jb.push(frame(8000));
    jb.pull(out);
    expect(rms(out)).toBe(0);                   // 20 ms queued, 100 ms needed
    for (let i = 0; i < 5; i++) jb.push(frame(8000));
    const level = jb.pull(out);
    expect(level).toBeCloseTo(8000 / 32768, 3);
    // 128 samples at 48 kHz take 64 at 24 kHz.
    expect(jb.queued).toBe(6 * FRAME - 64);
  });

  test('runs dry into silence and primes again, instead of playing scraps', () => {
    const jb = new JitterBuffer(RATE, RATE, 960, 9600);
    const out = new Float32Array(128);
    jb.push(new Int16Array(1000).fill(1000));
    for (let i = 0; i < 8; i++) jb.pull(out);
    expect(jb.underruns).toBe(1);
    jb.push(new Int16Array(500).fill(1000));
    expect(jb.pull(out)).toBe(0);               // 500 < 960: still priming
  });

  test('never lags far behind: past the limit the oldest audio goes, down to the primed depth', () => {
    const jb = new JitterBuffer(RATE, RATE, 2400, 14_400);
    for (let i = 0; i < 40; i++) jb.push(frame(100));
    expect(jb.queued).toBeLessThanOrEqual(14_400);
    expect(jb.dropped).toBeGreaterThan(0);
  });

  test('a flush drops what is queued at once (the user cut in)', () => {
    const jb = new JitterBuffer(RATE, RATE, 480, 9600);
    for (let i = 0; i < 4; i++) jb.push(frame(5000));
    jb.flush();
    expect(jb.queued).toBe(0);
    expect(jb.pull(new Float32Array(128))).toBe(0);
  });
});
