import { describe, expect, it } from 'vitest';
import { createFillerGate, DELAY_MS, FADE_SAMPLES } from './fillers.ts';

const FRAME_MS = 20;
// Feed a voice: a frame every 20 ms whose samples say which frame it is, words at given times.
function run(script: { at: number; words: string }[], ms: number, stretchAt: number[] = []) {
  const gate = createFillerGate();
  const out: number[] = [];   // the frame number of each sample that came out, or -1 for silence
  let w = 0;
  for (let t = 0, i = 0; t <= ms + DELAY_MS; t += FRAME_MS, i++) {
    if (stretchAt.includes(t)) gate.stretch();
    while (w < script.length && script[w].at <= t) gate.words(script[w++].words, t);
    for (const pcm of gate.push(new Int16Array([i + 1]), t)) out.push(pcm[0] ? pcm[0] - 1 : -1);
  }
  return out;
}
const at = (ms: number) => Math.round(ms / FRAME_MS);

describe('fillers off the faces', () => {
  it('lets ordinary speech through, DELAY_MS late, in order', () => {
    const out = run([{ at: 0, words: 'The light ' }, { at: 400, words: 'was everything.' }], 1000);
    expect(out.slice(0, at(1000))).toEqual(Array.from({ length: at(1000) }, (_, i) => i));
  });

  it('silences fillers trailing after a sentence', () => {
    const out = run([{ at: 0, words: 'Were you repairing them between takes?' }, { at: 1000, words: ' yeah uh uhhh' }, { at: 1400, words: ' ummm oh' }], 2000);
    expect(out[at(500)]).toBe(at(500));            // the question is heard
    expect(out[at(1200)]).toBe(-1);                // the fillers are not
    expect(out[at(1800)]).toBe(-1);
  });

  it('silences a stretch that is only a filler', () => {
    const out = run([{ at: 100, words: 'Hmm.' }], 600, [0]);
    expect(out[at(200)]).toBe(-1);
  });

  it('keeps a sentence that only starts with a filler-like word', () => {
    const out = run([{ at: 0, words: 'Yeah,' }, { at: 300, words: ' the light was everything.' }], 1000, [0]);
    expect(out[at(100)]).toBe(at(100));
    expect(out[at(600)]).toBe(at(600));
  });

  it('keeps words that only look like fillers mid-sentence', () => {
    const out = run([{ at: 0, words: 'We used, well, three silks' }], 600, [0]);
    expect(out.slice(0, at(600)).every((v) => v >= 0)).toBe(true);
  });

  it('silences a hesitation mid-sentence, and keeps the words around it', () => {
    const out = run([{ at: 0, words: 'We used,' }, { at: 600, words: ' uh,' }, { at: 1200, words: ' three silks.' }], 1600, [0]);
    expect(out[at(200)]).toBe(at(200));            // "We used" is heard
    expect(out[at(800)]).toBe(-1);                 // the "uh" is not
    expect(out[at(1300)]).toBe(at(1300));          // "three silks" is heard
  });

  it('silences a span it is told is a filler clip, even when real words follow', () => {
    const gate = createFillerGate();
    const out: number[] = [];
    for (let t = 0, i = 0; t <= 1_000 + DELAY_MS; t += FRAME_MS, i++) {
      if (t === 500) gate.silence(300, 560);           // the clip: 300 to 560 ms
      if (t === 600) gate.words('the light was everything.', t);
      for (const pcm of gate.push(new Int16Array([i + 1]), t)) out.push(pcm[0] ? pcm[0] - 1 : -1);
    }
    expect(out[at(200)]).toBe(at(200));
    expect(out[at(400)]).toBe(-1);
    expect(out[at(540)]).toBe(-1);                     // made after the call, still inside the span
    expect(out[at(700)]).toBe(at(700));
  });

  it('fades sound out into a silenced stretch and back in after it, never a step', () => {
    const gate = createFillerGate();
    const loud = () => new Int16Array(480).fill(10_000);
    const out: Int16Array[] = [];
    for (let t = 0; t <= 600 + DELAY_MS; t += 20) out.push(...gate.push(loud(), t, t >= 200 && t < 400));
    const flat = Int16Array.from(out.flatMap((f) => [...f]));
    let jump = 0;
    for (let i = 1; i < flat.length; i++) jump = Math.max(jump, Math.abs(flat[i] - flat[i - 1]));
    expect(jump).toBeLessThanOrEqual(Math.ceil(10_000 / FADE_SAMPLES) + 1);
    expect(flat[at(100) * 480]).toBe(10_000);       // before: heard
    expect(flat[at(300) * 480]).toBe(0);            // muted: silent
    expect(flat[at(500) * 480]).toBe(10_000);       // after: heard again
  });
});

