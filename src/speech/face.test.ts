import { describe, expect, test } from 'vitest';
import type { Played } from '../avatar/render.ts';
import { FaceDelivery, type Face } from './face.ts';

const delivery = { delivery_id: 4, playback_id: 9, start_sample: 0 };
const pcm = (n: number) => new Int16Array(n).fill(1000);
const settle = () => new Promise((r) => setTimeout(r, 0));

/** A face whose renderer the test drives: what was written, and when and how it reports the piece. */
function fakeFace() {
  const written: number[] = [];
  let report: ((p: Played) => void) | null = null;
  let closed = false;
  let cuts = 0;
  const face: Face & { written: number[]; closed: () => boolean; cuts: () => number; report: (p: Played) => void } = {
    written,
    closed: () => closed,
    cuts: () => cuts,
    report: (p) => report?.(p),
    async open() {
      return {
        async write(p) { written.push(p.length); },
        end() { closed = true; return new Promise<Played>((r) => { report = r; }); },
      };
    },
    async interrupt() { cuts++; },
  };
  return face;
}

function run(face = fakeFace()) {
  const sent: Record<string, unknown>[] = [];
  const d = new FaceDelivery(face, delivery, (e) => sent.push(e));
  return { face, d, sent, acks: () => sent.map(({ status, played_samples, interrupted, position_source }) => ({ status, played_samples, interrupted, position_source })) };
}

describe('a delivery played by a face', () => {
  test('its audio goes to the face at 16 kHz, and a natural end is acknowledged with every sample sent', async () => {
    const { face, d, acks, sent } = run();
    d.push(pcm(480));
    d.push(pcm(960));
    d.started();
    d.end();
    await settle();
    expect(face.written.reduce((a, b) => a + b, 0)).toBe(960);   // 1440 samples at 24 kHz = 960 at 16 kHz
    expect(face.closed()).toBe(true);
    face.report({ interrupted: false, position: 0.06 });
    await settle();
    expect(acks()).toEqual([
      { status: 'started', played_samples: undefined, interrupted: undefined, position_source: undefined },
      { status: 'finished', played_samples: 1440, interrupted: false, position_source: 'renderer_reported' },
    ]);
    expect(sent[1]).toMatchObject({ type: 'causeur.playback.ack', delivery_id: 4, playback_id: 9, start_sample: 0 });
  });

  test("a clear closes the piece first, then cuts, and reports where the face got to", async () => {
    const { face, d, acks } = run();
    d.push(pcm(24_000));                                  // one second
    await settle();
    const clearing = d.clear();
    await settle();
    expect(face.closed()).toBe(true);                     // closed before the cut, so the report settles it
    expect(face.cuts()).toBe(1);
    face.report({ interrupted: true, position: 0.25 });
    await clearing;
    expect(acks()).toEqual([{ status: 'finished', played_samples: 6000, interrupted: true, position_source: 'renderer_reported' }]);
  });

  test('a clear after its end was sent waits for no natural report: it cuts at once', async () => {
    const { face, d, acks } = run();
    d.push(pcm(24_000));
    d.end();
    await settle();
    const clearing = d.clear();
    await settle();
    expect(face.cuts()).toBe(1);
    face.report({ interrupted: true, position: 0.5 });
    await clearing;
    expect(acks()).toEqual([{ status: 'finished', played_samples: 12_000, interrupted: true, position_source: 'renderer_reported' }]);
  });

  test('a clear for a delivery that already played out is answered with all of it', async () => {
    const { face, d, acks } = run();
    d.push(pcm(4800));
    d.end();
    await settle();
    face.report({ interrupted: false, position: 0.2 });
    await settle();
    await d.clear();
    expect(acks().map((a) => [a.played_samples, a.interrupted])).toEqual([[4800, false], [4800, true]]);
  });

  test('a position past what was sent is held to what was sent', async () => {
    const { face, d, acks } = run();
    d.push(pcm(2400));
    const clearing = d.clear();
    await settle();
    face.report({ interrupted: true, position: 9 });
    await clearing;
    expect(acks()[0]).toMatchObject({ played_samples: 2400, interrupted: true });
  });

  test('cut by the face with no clear from the server: no usable position, never "interrupted"', async () => {
    const { face, d, acks } = run();
    d.push(pcm(2400));
    d.end();
    await settle();
    face.report({ interrupted: true, position: 0 });      // the renderer gave up on it, or went away
    await settle();
    expect(acks()).toEqual([{ status: 'finished', played_samples: 0, interrupted: false, position_source: 'unavailable' }]);
  });

  test('a face that could not open: no position for a natural end, nothing reached it for a clear', async () => {
    const broken: Face = { open: () => Promise.reject(new Error('gone')), interrupt: async () => {} };
    const a = run(broken as ReturnType<typeof fakeFace>);
    a.d.push(pcm(480));
    a.d.end();
    await settle(); await settle();
    expect(a.acks()).toEqual([{ status: 'finished', played_samples: 0, interrupted: false, position_source: 'unavailable' }]);
    const b = run(broken as ReturnType<typeof fakeFace>);
    b.d.push(pcm(480));
    await b.d.clear();
    expect(b.acks()).toEqual([{ status: 'finished', played_samples: 0, interrupted: true, position_source: 'not_submitted' }]);
  });

  test('nothing reaches the face once it is cleared (what was still queued neither), and its start is not reported after', async () => {
    const { face, d, acks } = run();
    d.push(pcm(480));
    const clearing = d.clear();
    d.push(pcm(480));
    d.started();
    await settle();
    face.report({ interrupted: true, position: 0 });
    await clearing;
    expect(face.written.reduce((a, b) => a + b, 0)).toBe(0);
    expect(acks().map((a) => a.status)).toEqual(['finished']);
  });
});
