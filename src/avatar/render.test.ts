import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { floatTo16, mixToMono } from './pcm.ts';
import { createPlayback, readPlayed } from './render.ts';

describe('what the avatar is sent: 16-bit PCM', () => {
  test('float samples become 16-bit, full scale both ways, clipped beyond it', () => {
    expect([...floatTo16(new Float32Array([0, 1, -1, 0.5, 2, -3]))]).toEqual([0, 32767, -32768, 16384, 32767, -32768]);
  });

  test('stereo is averaged to mono; mono passes through', () => {
    expect([...mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])])]).toEqual([0.5, 0.5]);
    const mono = new Float32Array([0.25]);
    expect(mixToMono([mono])).toBe(mono);
  });
});

describe("the avatar's reports settle the pieces sent, in order", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test('each lk.playback_finished settles the oldest piece', async () => {
    const playback = createPlayback();
    const first = playback.add(60_000);
    const second = playback.add(60_000);
    playback.finished({ interrupted: false, position: 2.5 });
    expect(await first).toEqual({ interrupted: false, position: 2.5 });
    expect(playback.pending).toBe(1);
    playback.finished({ interrupted: false, position: 1 });
    expect(await second).toEqual({ interrupted: false, position: 1 });
    expect(playback.pending).toBe(0);
  });

  test('a cut piece takes the ones queued behind it (the avatar cleared them)', async () => {
    const playback = createPlayback();
    const first = playback.add(60_000);
    const second = playback.add(60_000);
    playback.finished({ interrupted: true, position: 0.8 });
    expect(await first).toEqual({ interrupted: true, position: 0.8 });
    expect((await second).interrupted).toBe(true);
    expect(playback.pending).toBe(0);
  });

  test('an interrupt cuts what was waiting then, not a piece sent after it', async () => {
    const playback = createPlayback();
    const before = playback.add(60_000);
    const cut = playback.mark();
    const after = playback.add(60_000);
    cut();
    expect((await before).interrupted).toBe(true);
    expect(playback.pending).toBe(1);
    playback.finished({ interrupted: false, position: 3 });
    expect(await after).toEqual({ interrupted: false, position: 3 });
  });

  test('a piece the avatar never reports is given up on at its deadline', async () => {
    const playback = createPlayback();
    const lost = playback.add(5_000);
    vi.advanceTimersByTime(5_000);
    expect(await lost).toEqual({ interrupted: true, position: 0 });
    expect(playback.pending).toBe(0);
  });

  test('a report with nothing waiting is ignored', () => {
    const playback = createPlayback();
    expect(() => playback.finished({ interrupted: false, position: 1 })).not.toThrow();
    expect(playback.pending).toBe(0);
  });
});

describe("the avatar's lk.playback_finished payload", () => {
  test('reads the position and whether it was cut', () => {
    expect(readPlayed('{"playback_position": 3.25, "interrupted": true, "synchronized_transcript": null}')).toEqual({ interrupted: true, position: 3.25 });
  });

  test('a missing or malformed payload counts as played through', () => {
    expect(readPlayed('')).toEqual({ interrupted: false, position: 0 });
    expect(readPlayed('{"interrupted": "yes"}')).toEqual({ interrupted: false, position: 0 });
  });
});
