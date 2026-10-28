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
const FRAME_MS = 20;
const FRAME_BYTES = 480 * 2;                     // 20 ms of 24 kHz mono PCM16
const SILENCE = btoa(String.fromCharCode(...new Uint8Array(FRAME_BYTES)));
const WARMING_LIMIT_MS = 3 * 60_000;

export class SpeechError extends Error {
  constructor(readonly code: string, message?: string) { super(message || code); }
}

export interface SpeechHandlers {
  /** One frame of the avatar's voice, as sent (base64) and decoded. */
  onAudio(b64: string, pcm: Int16Array): void;
  /** The avatar's words as they are spoken. */
  onWords?(delta: string): void;
  onClosed?(reason: string): void;
  onError?(message: string): void;
}

export interface SpeechLine {
  sessionId: string;
  /** What the avatar hears next: one 20 ms frame (base64), in place of a frame of silence. */
  hear(b64: string): void;
  directive(text: string): void;
  commentary(text: string): void;
  end(): Promise<void>;
}

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
  let ticker: ReturnType<typeof setInterval> | undefined;
  const queued: string[] = [];          // frames to hear, waiting for their tick
  const send = (event: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event)); };
  const onHide = () => { if (!closed) void endOnServer(); };
  addEventListener('pagehide', onHide);

  const finish = (reason: string) => {
    if (closed) return;
    closed = true;
    clearInterval(ticker);
    removeEventListener('pagehide', onHide);
    handlers.onClosed?.(reason);
  };

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => send({ type: 'session.start', session: { model: 'causeur' } });
    ws.onerror = () => reject(new SpeechError('connect_failed'));
    ws.onclose = (e) => { reject(new SpeechError('closed', e.reason)); finish(e.reason || 'closed'); };
    ws.onmessage = (m) => {
      const e = JSON.parse(String(m.data));
      switch (e.type) {
        case 'session.started': resolve(); break;
        case 'session.output_audio.delta': handlers.onAudio(e.delta, b64ToPcm(e.delta)); break;
        case 'session.output_transcript.delta': handlers.onWords?.(e.delta); break;
        case 'session.closed': finish(e.reason || 'closed'); break;
        case 'error': {
          const message = e.error?.message ?? 'error';
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
    for (let i = 0; i < due; i++, sent++) send({ type: 'session.input_audio.append', audio: queued.shift() ?? SILENCE });
    // Never let what is waiting grow past a second: the voice would lag behind.
    if (queued.length > 50) queued.splice(0, queued.length - 50);
  }, FRAME_MS);

  return {
    sessionId,
    hear(b64) { if (!closed) queued.push(b64); },
    directive(text) { send({ type: 'causeur.directive.set', directive: text }); },
    commentary(text) { send({ type: 'session.commentary.append', content: text }); },
    async end() {
      if (closed) return;
      finish('ended');
      ws.close();
      await endOnServer();
    },
  };
}
