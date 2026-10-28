import { describe, expect, it } from 'vitest';
import { createClipSpotter, WINDOW } from './clips.ts';

// Speech-like noise that never repeats, and one fixed "clip" of 0.4 s.
let seed = 7;
const noise = (n: number) => Int16Array.from({ length: n }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 16) % 16000 - 8000; });
const CLIP = noise(9_600);
const cat = (...parts: Int16Array[]) => { const out = new Int16Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
// Fed in uneven chunks, as the stream delivers it.
const feed = (spot: ReturnType<typeof createClipSpotter>, pcm: Int16Array) => {
  const spans = [];
  for (let o = 0, k = 0; o < pcm.length; k++) { const len = [480, 1_337, 2_400][k % 3]; spans.push(...spot.feed(pcm.subarray(o, o + len))); o += len; }
  return spans;
};

describe('filler clips by their sound', () => {
  it('lets speech through, and the first time a clip plays', () => {
    const spot = createClipSpotter();
    expect(feed(spot, cat(noise(48_000), CLIP, noise(48_000)))).toEqual([]);
  });

  it('spots a clip played again, over its whole length, and learns it', () => {
    const spot = createClipSpotter();
    const at = 48_000 + CLIP.length + 48_000;
    const spans = feed(spot, cat(noise(48_000), CLIP, noise(48_000), CLIP, noise(24_000)));
    expect(spans.length).toBeGreaterThan(0);
    // Within the 60 ms the page pads each span by, at either end.
    expect(spans[0].from).toBeLessThan(at + 1_440);
    expect(spans[spans.length - 1].to).toBeGreaterThan(at + CLIP.length - 1_440);
    expect(spans.every((s) => s.from >= at - WINDOW && s.to <= at + CLIP.length + 1)).toBe(true);
    expect(spot.learned().length).toBeGreaterThan(20);
    expect(spot.learned()).toEqual([]);   // handed over once
  });

  it('spots a clip from its first play when the avatar is known to make it', () => {
    const first = createClipSpotter();
    feed(first, cat(noise(30_000), CLIP, noise(30_000), CLIP));
    const known = new Set(first.learned());
    const later = createClipSpotter(known);
    expect(feed(later, cat(noise(30_000), CLIP, noise(30_000))).length).toBeGreaterThan(0);
  });

  it('does not take silence for a clip', () => {
    const spot = createClipSpotter();
    expect(feed(spot, cat(new Int16Array(48_000), noise(24_000), new Int16Array(48_000)))).toEqual([]);
  });
});
