import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSpeech, type DeliveryEvent } from './speech.ts';

// The speech server's side of one seat's WebSocket, faked: what the page sent, and a way to answer.
class FakeSocket {
  static last: FakeSocket;
  static OPEN = 1;
  readyState = 0;
  sent: Record<string, any>[] = [];
  onopen?: () => void;
  onmessage?: (m: { data: string }) => void;
  onclose?: (e: { reason: string }) => void;
  onerror?: () => void;
  constructor(readonly url: string) { FakeSocket.last = this; setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  answer(event: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify(event) }); }
  starts() { return this.sent.filter((e) => e.type === 'session.start'); }
}

const b64 = (n: number, v = 1000) => {
  const pcm = new Int16Array(n).fill(v);
  const bytes = new Uint8Array(pcm.buffer);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'performance'] });
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('addEventListener', () => {});
  vi.stubGlobal('removeEventListener', () => {});
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ sessionId: 's1', url: 'wss://speech.test', token: 't' }), { status: 201 }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function open(started: Record<string, unknown>, refuse?: string) {
  const audio: { replayed: boolean; loud: boolean }[] = [];
  const events: DeliveryEvent[] = [];
  const line = openSpeech('/api/apps/tv-show-live/show/x/host', {
    onAudio: (_b, pcm, replayed) => audio.push({ replayed, loud: pcm.some((v) => v !== 0) }),
    onDelivery: (e) => events.push(e),
  });
  await vi.advanceTimersByTimeAsync(1);
  const ws = FakeSocket.last;
  if (refuse) ws.answer({ type: 'error', error: { code: 'invalid_request', message: refuse, client_event_id: 'start' } });
  ws.answer({ type: 'session.started', session: started });
  return { line: await line, ws, audio, events };
}

describe("a seat's voice under playback control", () => {
  it('asks for it, and replays each delivery on the page clock as the paced voice came', async () => {
    const { line, ws, audio, events } = await open({ playback_control: 'playback-v2' });
    expect(ws.starts()[0].session.playback_control).toBe('playback-v2');
    expect(line.controlled).toBe(true);
    ws.answer({ type: 'causeur.playback.start', delivery_id: 1, playback_id: 3, start_sample: 0 });
    ws.answer({ type: 'causeur.playback.audio', delivery_id: 1, delta: b64(480 * 3) });   // 60 ms, all at once
    ws.answer({ type: 'causeur.playback.end', delivery_id: 1 });
    expect(events.map((e) => e.kind)).toEqual(['open', 'audio', 'end']);
    await vi.advanceTimersByTimeAsync(100);
    // One frame a tick: three of the reply, then silence, all marked as replayed.
    expect(audio.slice(0, 5).map((a) => a.loud)).toEqual([true, true, true, false, false]);
    expect(audio.every((a) => a.replayed)).toBe(true);
    expect(events.filter((e) => e.kind === 'local-start' || e.kind === 'local-end')).toEqual([
      { kind: 'local-start', id: 1 }, { kind: 'local-end', id: 1, played: 1440 }]);
    // And what it hears goes on in real time beside it.
    expect(ws.sent.filter((e) => e.type === 'session.input_audio.append').length).toBeGreaterThanOrEqual(5);
  });

  it("a clear stops the rest on the page clock and says how much of it played there", async () => {
    const { ws, audio, events } = await open({ playback_control: 'playback-v2' });
    ws.answer({ type: 'causeur.playback.start', delivery_id: 2, playback_id: 3, start_sample: 0 });
    ws.answer({ type: 'causeur.playback.audio', delivery_id: 2, delta: b64(480 * 50) });
    await vi.advanceTimersByTimeAsync(40);
    ws.answer({ type: 'causeur.playback.clear', delivery_id: 2 });
    const cleared = events.find((e) => e.kind === 'clear');
    expect(cleared).toMatchObject({ kind: 'clear', id: 2 });
    expect((cleared as { played: number }).played).toBeGreaterThan(0);
    const before = audio.length;
    await vi.advanceTimersByTimeAsync(60);
    expect(audio.slice(before).every((a) => !a.loud)).toBe(true);
  });

  it('a server without playback control: the same socket starts it paced, and its voice is not replayed', async () => {
    const { line, ws, audio } = await open({}, "Unsupported session fields: ['playback_control']; supported: audio, model");
    expect(ws.starts().map((e) => [e.event_id, e.session.playback_control])).toEqual([['start', 'playback-v2'], ['start-paced', undefined]]);
    expect(line.controlled).toBe(false);
    ws.answer({ type: 'session.output_audio.delta', delta: b64(480) });
    await vi.advanceTimersByTimeAsync(60);
    expect(audio).toEqual([{ replayed: false, loud: true }]);   // only what came, as it came
  });
});
