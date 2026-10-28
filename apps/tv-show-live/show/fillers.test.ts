import { describe, expect, it } from 'vitest';
import { createFillerGate, DELAY_MS } from './fillers.ts';

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
});
