// One avatar's speech-to-speech session, from the page. Our server reserves it
// (POST <seat>/speech: the API key stays there, and the session's role on the
// show is pinned there); the page connects to the speech server's WebSocket
// with the short-lived token, starts the session, and from then on:
//
//   session.input_audio.append   what the avatar hears: 24 kHz PCM16, in real
//                                time from the first tick, never left empty
//                                (silence when nothing else comes), as the
//                                server needs for its turn timing
//   session.output_audio.delta   what it says: the same format, paced in real
//                                time, silence included
//   causeur.directive.set        a direction for its next replies ('' clears it)
//   session.commentary.append    something to say now, between turns
//
// With playback control (asked for; a server without it starts the session
// paced): what it says comes as deliveries (causeur.playback.start, .audio,
// .end, .clear), each reply as fast as the voice makes it, for the faces to
// hold and acknowledge (causeur.playback.ack). The page replays them on its own
// clock (show/playout.ts) and hands that to onAudio frame by frame, as the
// paced voice came: whoever reads onAudio need not know which it is.
import { LocalPlayout } from './playout.ts';
import { PLAYBACK_CONTROL, refusedPlaybackControl } from '../../../src/speech/protocol.ts';

const FRAME_MS = 20;
const FRAME_BYTES = 480 * 2;                     // 20 ms of 24 kHz mono PCM16
const SILENCE = btoa(String.fromCharCode(...new Uint8Array(FRAME_BYTES)));
const WARMING_LIMIT_MS = 3 * 60_000;

export class SpeechError extends Error {
  constructor(readonly code: string, message?: string) { super(message || code); }
}

/** A delivery, under playback control: it opens, takes its audio as it comes, ends or is cleared;
 * and on the page's own clock it began to play, or played out. */
export type DeliveryEvent =
  | { kind: 'open'; delivery: { delivery_id: number; playback_id: unknown; start_sample: number } }
  | { kind: 'audio'; id: number; pcm: Int16Array }
  | { kind: 'end'; id: number }
  | { kind: 'clear'; id: number; played: number }
  | { kind: 'local-start'; id: number }
  | { kind: 'local-end'; id: number; played: number };

export interface SpeechHandlers {
  /** One 20 ms frame of the avatar's voice, in real time, as sent (base64) and decoded;
   * `replayed`: from deliveries, on the page's own clock (the faces have it already). */
  onAudio(b64: string, pcm: Int16Array, replayed: boolean): void;
  /** Under playback control, each delivery's life, for the faces; `ack` answers the server on this line. */
  onDelivery?(event: DeliveryEvent, ack: (event: Record<string, unknown>) => void): void;
  /** The avatar's words as they are spoken. */
  onWords?(delta: string): void;
  /** The line closed on its own (dropped, timed out, ended by the server); not called after end(). */
  onClosed?(reason: string): void;
  onError?(message: string): void;
}

export interface SpeechLine {
  sessionId: string;
  /** Whether its voice comes under playback control (deliveries, acknowledged). */
  controlled: boolean;
  /** A playback acknowledgment (causeur.playback.ack) for the server. */
  ack(event: Record<string, unknown>): void;
  /** What the avatar hears next: one 20 ms frame (base64), in place of a frame of silence. */
  hear(b64: string): void;
  directive(text: string): void;
  commentary(text: string): void;
  end(): Promise<void>;
}

const pcmToB64 = (pcm: Int16Array) => {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

const b64ToPcm = (b64: string) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
};

async function reserve(api: string) {
  const started = Date.now();
  for (;;) {
    const res = await fetch(`${api}/speech`, { method: 'POST' }).catch(() => null);
    if (!res) throw new SpeechError('backend_unreachable');
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json as { sessionId: string; url: string; token: string };
    if (res.status === 503 && json.error === 'no_capacity' && Date.now() - started < WARMING_LIMIT_MS) {
      await new Promise((r) => setTimeout(r, Math.max(Number(json.retryAfter) || 5, 2) * 1000));
      continue;
    }
    throw new SpeechError(json.error || `http_${res.status}`, json.message);
  }
}

/** Opens the seat's session (`api` is /api/apps/<app>/show/<show>/<seat>); resolves once it has started. */
export async function openSpeech(api: string, handlers: SpeechHandlers): Promise<SpeechLine> {
  const { sessionId, url, token } = await reserve(api);
  const endOnServer = () => fetch(`${api}/speech/${sessionId}/end`, { method: 'POST', keepalive: true }).catch(() => {});
  const ws = new WebSocket(url, ['atmee-live', `atmee-token.${token}`]);
  let closed = false;
  let controlled = false;
  let askedForControl = true;
  const playout = new LocalPlayout();
  let ticker: ReturnType<typeof setInterval> | undefined;
  const queued: string[] = [];          // frames to hear, waiting for their tick
  const send = (event: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event)); };
  const ack = (event: Record<string, unknown>) => send(event);
  const onHide = () => { if (!closed) void endOnServer(); };
  addEventListener('pagehide', onHide);

  const finish = (reason: string, ours = false) => {
    if (closed) return;
    closed = true;
    clearInterval(ticker);
    removeEventListener('pagehide', onHide);
    if (!ours) handlers.onClosed?.(reason);
  };

  await new Promise<void>((resolve, reject) => {
    const start = (event_id: string) => send({ type: 'session.start', event_id, session: {
      model: 'causeur', ...(askedForControl ? { playback_control: PLAYBACK_CONTROL } : {}) } });
    ws.onopen = () => start('start');
    ws.onerror = () => reject(new SpeechError('connect_failed'));
    ws.onclose = (e) => { reject(new SpeechError('closed', e.reason)); finish(e.reason || 'closed'); };
    ws.onmessage = (m) => {
      const e = JSON.parse(String(m.data));
      switch (e.type) {
        case 'session.started':
          controlled = e.session?.playback_control === PLAYBACK_CONTROL;
          console.info('[gilded-reel] voice %s', controlled ? 'under playback control' : 'paced');
          resolve();
          break;
        case 'session.output_audio.delta': handlers.onAudio(e.delta, b64ToPcm(e.delta), false); break;
        case 'causeur.playback.start':
          if (!Number.isInteger(e.delivery_id) || !Number.isInteger(e.start_sample)) break;
          playout.open(e.delivery_id);
          handlers.onDelivery?.({ kind: 'open', delivery: { delivery_id: e.delivery_id, playback_id: e.playback_id, start_sample: e.start_sample } }, ack);
          break;
        case 'causeur.playback.audio': {
          if (!Number.isInteger(e.delivery_id) || typeof e.delta !== 'string') break;
          const pcm = b64ToPcm(e.delta);
          playout.push(e.delivery_id, pcm);
          handlers.onDelivery?.({ kind: 'audio', id: e.delivery_id, pcm }, ack);
          break;
        }
        case 'causeur.playback.end':
          if (!Number.isInteger(e.delivery_id)) break;
          playout.end(e.delivery_id);
          handlers.onDelivery?.({ kind: 'end', id: e.delivery_id }, ack);
          break;
        case 'causeur.playback.clear':
          if (!Number.isInteger(e.delivery_id)) break;
          handlers.onDelivery?.({ kind: 'clear', id: e.delivery_id, played: playout.clear(e.delivery_id) }, ack);
          break;
        case 'session.output_transcript.delta': handlers.onWords?.(e.delta); break;
        case 'session.closed': finish(e.reason || 'closed'); break;
        case 'error': {
          const message = e.error?.message ?? 'error';
          // A server without playback control refused the start for asking: the same socket starts it paced.
          if (e.error?.client_event_id === 'start' && askedForControl && refusedPlaybackControl(message)) {
            askedForControl = false;
            start('start-paced');
            break;
          }
          // Refused before it started: the session is no use.
          reject(new SpeechError(e.error?.code ?? 'refused', message));
          handlers.onError?.(message);
          break;
        }
      }
    };
  }).catch(async (err) => {
    closed = true;
    removeEventListener('pagehide', onHide);
    ws.close();
    await endOnServer();
    throw err;
  });

  // Real time from here: every 20 ms the frames that are due go out, a queued
  // frame where there is one, silence otherwise.
  const since = performance.now();
  let sent = 0;
  ticker = setInterval(() => {
    const due = Math.floor((performance.now() - since) / FRAME_MS) - sent;
    for (let i = 0; i < due; i++, sent++) {
      send({ type: 'session.input_audio.append', audio: queued.shift() ?? SILENCE });
      // Under playback control the voice plays here, on this clock, a frame per tick.
      if (controlled && !closed) {
        const { frame, started, finished } = playout.next();
        if (started !== undefined) handlers.onDelivery?.({ kind: 'local-start', id: started }, ack);
        handlers.onAudio(pcmToB64(frame), frame, true);
        if (finished) handlers.onDelivery?.({ kind: 'local-end', id: finished.id, played: finished.played }, ack);
      }
    }
    // Never let what is waiting grow past a second: the voice would lag behind.
    if (queued.length > 50) queued.splice(0, queued.length - 50);
  }, FRAME_MS);

  return {
    sessionId,
    controlled,
    ack,
    hear(b64) { if (!closed) queued.push(b64); },
    directive(text) { send({ type: 'causeur.directive.set', directive: text }); },
    commentary(text) { send({ type: 'session.commentary.append', content: text }); },
    async end() {
      if (closed) return;
      // Ended by us (a handover, the end of the show): not a line that dropped.
      finish('ended', true);
      ws.close();
      await endOnServer();
    },
  };
}
