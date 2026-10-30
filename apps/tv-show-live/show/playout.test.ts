import { describe, expect, it } from 'vitest';
import { FRAME, LocalPlayout } from './playout.ts';

const pcm = (n: number, v = 100) => new Int16Array(n).fill(v);
const frames = (p: LocalPlayout, n: number) => Array.from({ length: n }, () => p.next());

describe("a seat's replies on the page's own clock", () => {
  it('plays a reply that came all at once one 20 ms frame at a time, silence before and after', () => {
    const p = new LocalPlayout();
    expect(p.next().frame.every((v) => v === 0)).toBe(true);
    p.open(1);
    p.push(1, pcm(FRAME * 3));
    p.end(1);
    const out = frames(p, 4);
    expect(out[0].started).toBe(1);
    expect(out.slice(0, 3).every((f) => f.frame.every((v) => v === 100))).toBe(true);
    expect(out[2].finished).toEqual({ id: 1, played: FRAME * 3 });
    expect(out[3].frame.every((v) => v === 0)).toBe(true);
  });

  it('waits in silence when the voice runs slower than real time, then goes on where it was', () => {
    const p = new LocalPlayout();
    p.open(1);
    p.push(1, pcm(FRAME + 100));
    const [a, b] = frames(p, 2);
    expect(a.frame.every((v) => v === 100)).toBe(true);
    expect(b.frame.slice(0, 100).every((v) => v === 100) && b.frame.slice(100).every((v) => v === 0)).toBe(true);
    expect(b.finished).toBeUndefined();          // not ended: more is coming
    p.push(1, pcm(FRAME, 7));
    p.end(1);
    const c = p.next();
    expect(c.frame.every((v) => v === 7)).toBe(true);
    expect(c.finished).toEqual({ id: 1, played: FRAME * 2 + 100 });
  });

  it('a clear drops the rest and says how much played; the next reply plays after', () => {
    const p = new LocalPlayout();
    p.open(1);
    p.push(1, pcm(FRAME * 10));
    frames(p, 2);
    expect(p.clear(1)).toBe(FRAME * 2);
    expect(p.next().frame.every((v) => v === 0)).toBe(true);
    p.open(2);
    p.push(2, pcm(FRAME, 5));
    p.end(2);
    const f = p.next();
    expect(f.started).toBe(2);
    expect(f.finished).toEqual({ id: 2, played: FRAME });
  });

  it('a delivery whose end comes after its last frame finishes on the next frame', () => {
    const p = new LocalPlayout();
    p.open(1);
    p.push(1, pcm(FRAME));
    expect(p.next().finished).toBeUndefined();
    p.end(1);
    expect(p.next().finished).toEqual({ id: 1, played: FRAME });
  });

  it('audio after the end, or for a delivery never opened, is not played', () => {
    const p = new LocalPlayout();
    p.push(9, pcm(FRAME));
    p.open(1);
    p.end(1);
    p.push(1, pcm(FRAME));
    expect(p.next().frame.every((v) => v === 0)).toBe(true);
    expect(p.played(1)).toBe(0);
  });
});
