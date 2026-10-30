// A speech-to-speech call from the page. Our server reserves the session
// (POST /api/apps/<app>/speech: it holds the API key and pins the settings)
// and hands back only the WebSocket address and a token good for one
// connection, within a minute. The page then connects straight to Atmee's
// speech server, streams the microphone, plays the avatar's voice, and runs
// the tools the model calls. Ending goes through our server too
// (POST .../speech/<id>/end), then the socket is closed, so the session
// settles at once. Framework-free; src/kit/useSpeech.ts wraps it for React.
import { MicError, openSpeechAudio, type SpeechAudio } from './audio.ts';
import {
  INPUT_TRANSCRIPT, PLAYBACK_CONTROL, ToolReply, ToolRounds, base64ToPcm, endReason, pcmToBase64, playbackAck,
  refusedPlaybackControl, subprotocols, toolOutput, userText, type Delivery, type ToolCall,
} from './protocol.ts';

export { ToolReply, type ToolCall } from './protocol.ts';

/** What our server returns for a reserved session. */
export interface SpeechInfo { sessionId: string; url: string; token: string; tokenExpiresAt: string; maxSeconds: number }

/** The session as the API reports it once it ended: why, and what it cost. */
export interface SpeechStatus {
  status: 'pending' | 'active' | 'completed' | 'failed';
  endReason?: string | null;
  failureCode?: string | null;
  connectedAt?: string | null;
  endedAt?: string | null;
  endRequestedAt?: string | null;
  billedSeconds?: number | null;
  chargedMicrocredits?: number | null;
}

export type SpeechPhase = 'starting' | 'connecting' | 'live';

/** A tool the page runs: its result is what the model reads (text, or JSON). */
export type ToolHandler = (args: Record<string, unknown>, call: ToolCall) => unknown | Promise<unknown>;

export interface SpeechOptions {
  app: string;                                   // /api/apps/<app>/speech
  tools?: Record<string, ToolHandler>;
  onPhase?: (phase: SpeechPhase) => void;
  /** The user's current message: its whole text so far, and whether it is over. */
  onUserText?: (text: string, final: boolean, tags: { interruption: boolean; backchannel: boolean }) => void;
  /** The avatar's next words, as their audio goes out. */
  onAvatarText?: (delta: string) => void;
  /** A tool round began (the model is waiting on the page) or ended. */
  onToolCall?: (call: ToolCall, result: { output: string; ok: boolean } | null) => void;
  /** The server refused something the page sent (its words are for developers). */
  onError?: (code: string, message: string) => void;
  /** The call is over: `ended` (by either side), `time_up`, `out_of_credits`, `server_full`, `disconnected`, … */
  onEnd?: (reason: string) => void;
}

export interface SpeechCall {
  info: SpeechInfo;
  /** When our server returned the session (Date.now()): its length counts from then. */
  reservedAt: number;
  audio: SpeechAudio;
  /** Mutes the microphone: the server hears silence (and the page sends only silence). */
  setMuted(muted: boolean): void;
  /** Ends the call through our server, then closes the socket; resolves once it is closed. */
  end(): Promise<void>;
  /** The session's state on the API (its cost once it ended). */
  status(): Promise<SpeechStatus | null>;
}

export class SpeechError extends Error {
  constructor(readonly code: string, message?: string, readonly retryAfter = 0) { super(message || code); }
}

const OPEN_TIMEOUT_MS = 15_000;
const START_TIMEOUT_MS = 20_000;

async function post<T>(path: string): Promise<{ ok: boolean; status: number; json: T & { error?: string; message?: string; retryAfter?: number } }> {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  } catch {
    throw new SpeechError('backend_unreachable');
  }
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

/** Places a call: the microphone, the session, the socket, `session.start`. Rejects with a SpeechError. */
export async function startSpeech(opts: SpeechOptions): Promise<SpeechCall> {
  const api = `/api/apps/${opts.app}/speech`;
  opts.onPhase?.('starting');
  let audio: SpeechAudio;
  try {
    audio = await openSpeechAudio();
  } catch (err) {
    throw new SpeechError(err instanceof MicError ? err.code : 'no_audio');
  }

  let info: SpeechInfo;
  let reservedAt = 0;
  try {
    const r = await post<SpeechInfo>(api);
    if (!r.ok) throw new SpeechError(r.json.error || `http_${r.status}`, r.json.message, r.json.retryAfter ?? 0);
    info = r.json;
    reservedAt = Date.now();
  } catch (err) {
    await audio.close();
    throw err;
  }
  const endOnServer = () => post(`${api}/${info.sessionId}/end`).catch(() => null);
  // The page goes (a tab closed, a link followed) from here on: the session is ended
  // by a beacon, whether or not its socket ever opened, so nothing stays reserved.
  const onPageHide = () => { navigator.sendBeacon?.(`${api}/${info.sessionId}/end`); };
  addEventListener('pagehide', onPageHide);
  const status = async (): Promise<SpeechStatus | null> => {
    try {
      const res = await fetch(`${api}/${info.sessionId}`);
      return res.ok ? ((await res.json()) as SpeechStatus) : null;
    } catch {
      return null;
    }
  };

  opts.onPhase?.('connecting');
  let ws: WebSocket;
  try {
    ws = new WebSocket(info.url, subprotocols(info.token));
  } catch {
    // An address the browser will not open (a page on https given ws://): end what was reserved.
    removeEventListener('pagehide', onPageHide);
    await endOnServer();
    await audio.close();
    throw new SpeechError('connect_failed');
  }
  let opened = false;
  let started = false;
  let closing = false;
  let ended = false;
  let muted = false;
  let closedReason: string | undefined;
  let refusal: string | undefined;
  // Playback control, asked for when the voice plays at its own rate, and in
  // use once session.started echoes it. Its open deliveries, by id, for
  // their acknowledgments.
  let controlled = false;
  let askedForControl = audio.controlled;
  const deliveries = new Map<number, Delivery>();
  const rounds = new ToolRounds();
  const silence = () => new Int16Array(480);

  // The microphone and the speaker let go, once.
  const release = async () => {
    if (ended) return false;
    ended = true;
    audio.onFrame = null;
    removeEventListener('pagehide', onPageHide);
    await audio.close().catch(() => {});
    return true;
  };
  const finish = async (reason: string) => { if (await release()) opts.onEnd?.(reason); };
  const runRound = async (calls: ToolCall[]) => {
    for (const call of calls) {
      opts.onToolCall?.(call, null);
      dispatchEvent(new CustomEvent('atmee:tool', { detail: { name: call.name, arguments: call.arguments } }));
      const handler = opts.tools?.[call.name];
      let output: string;
      let ok = true;
      try {
        if (!handler) throw new Error(`this page has no tool named ${call.name}`);
        const value = await handler(call.arguments, call);
        // A ToolReply says whether the app did what was asked; anything else counts as done.
        if (value instanceof ToolReply) ({ output, ok } = { output: toolOutput(value.output), ok: value.ok });
        else output = toolOutput(value);
      } catch (err) {
        ok = false;
        output = toolOutput(undefined, err);
      }
      opts.onToolCall?.(call, { output, ok });
      send({ type: 'response.item.create', item: { type: 'function_call_output', call_id: call.callId, output } });
    }
    send({ type: 'response.create' });
  };

  const send = (event: Record<string, unknown>) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  };
  const sessionStart = (event_id: string) => send({ type: 'session.start', event_id, session: {
    model: 'causeur', input_transcript: INPUT_TRANSCRIPT,
    ...(askedForControl ? { playback_control: PLAYBACK_CONTROL } : {}),
  } });
  audio.onPlayback = (report) => {
    const id = 'started' in report ? report.started : report.finished;
    const delivery = deliveries.get(id);
    if (!delivery) return;
    if ('started' in report) {
      send(playbackAck(delivery, { status: 'started' }));
      return;
    }
    send(playbackAck(delivery, { status: 'finished', played_samples: report.played, interrupted: report.interrupted }));
    // One that played out is kept, as a clear may still come for it; a cleared one is over.
    if (report.interrupted) deliveries.delete(id);
  };

  // Every message until the socket closes.
  const startedOrRefused = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SpeechError(opened ? 'start_timeout' : 'connect_timeout')), OPEN_TIMEOUT_MS + START_TIMEOUT_MS);
    ws.onopen = () => {
      opened = true;
      sessionStart('start');
    };
    ws.onmessage = (e: MessageEvent<string>) => {
      let msg: Record<string, any>;
      try { msg = JSON.parse(e.data); } catch { return; }
      switch (msg.type) {
        case 'session.output_audio.delta':
          if (typeof msg.delta === 'string') audio.play(base64ToPcm(msg.delta));
          return;
        case 'causeur.playback.start': {
          const id = Number(msg.delivery_id);
          // Only the latest few are kept: an old one is answered no more.
          for (const old of deliveries.keys()) if (old < id - 4) deliveries.delete(old);
          deliveries.set(id, { delivery_id: id, playback_id: msg.playback_id, start_sample: Number(msg.start_sample) });
          audio.open(id);
          return;
        }
        case 'causeur.playback.audio':
          if (typeof msg.delta === 'string') audio.deliver(Number(msg.delivery_id), base64ToPcm(msg.delta));
          return;
        case 'causeur.playback.end':
          audio.end(Number(msg.delivery_id));
          return;
        case 'causeur.playback.clear':
          audio.clear(Number(msg.delivery_id));
          return;
        case 'session.started':
          controlled = msg.session?.playback_control === PLAYBACK_CONTROL;
          // Which audio the call has, for whoever compares how it sounds.
          console.info('[speech] voice %s', controlled ? 'under playback control (held whole, acknowledged)'
            : audio.controlled ? 'paced: the server does not offer playback control' : 'paced: no 24 kHz audio context');
          started = true;
          clearTimeout(timer);
          resolve();
          return;
        case 'session.output_transcript.delta':
          if (typeof msg.delta === 'string') opts.onAvatarText?.(msg.delta);
          return;
        case 'causeur.input_transcript': {
          const said = userText(String(msg.text ?? ''));
          // The user's words cut the avatar off: what is still queued of its voice goes.
          // With playback control the server clears the delivery itself, and is told where it stopped.
          if (said.interruption && !controlled) audio.flush();
          opts.onUserText?.(said.text, msg.final === true, { interruption: said.interruption, backchannel: said.backchannel });
          return;
        }
        case 'session.input_transcript.delta': {
          // A server without whole messages: each finalised chunk as a line of its own.
          const said = userText(String(msg.delta ?? ''));
          if (said.interruption && !controlled) audio.flush();
          if (said.text) opts.onUserText?.(said.text, true, { interruption: said.interruption, backchannel: said.backchannel });
          return;
        }
        case 'response.event': {
          const calls = rounds.take(msg);
          if (calls?.length) void runRound(calls);
          return;
        }
        case 'error': {
          const code = String(msg.error?.code ?? 'error');
          const message = String(msg.error?.message ?? '');
          if (!started && msg.error?.client_event_id === 'start' && askedForControl
              && refusedPlaybackControl(message)) {
            // A server without playback control: the same socket starts it paced.
            askedForControl = false;
            sessionStart('start-paced');
            return;
          }
          if (!started && (msg.error?.client_event_id === 'start' || msg.error?.client_event_id === 'start-paced')) {
            refusal = message;
            clearTimeout(timer);
            reject(new SpeechError('start_refused', message));
            return;
          }
          opts.onError?.(code, message);
          return;
        }
        case 'session.closed':
          closedReason = typeof msg.reason === 'string' ? msg.reason : undefined;
          return;
        default:
      }
    };
    ws.onclose = (e) => {
      clearTimeout(timer);
      if (!started) {
        // Refused before it could start. The browser never shows the handshake's
        // status, so the session's own state says why.
        if (refusal === undefined) reject(new SpeechError(e.code === 1013 ? 'server_full' : e.code === 1012 ? 'server_restarting' : opened ? 'start_failed' : 'connect_failed'));
        return;
      }
      void finish(endReason(closedReason, e.code));
    };
  });

  try {
    await startedOrRefused;
  } catch (err) {
    try { ws.close(); } catch { /* not open */ }
    let error = err as SpeechError;
    if (error.code === 'connect_failed' || error.code === 'connect_timeout') {
      const s = await status();
      if (Date.now() > Date.parse(info.tokenExpiresAt)) error = new SpeechError('token_expired');
      else if (s && (s.status === 'completed' || s.status === 'failed')) error = new SpeechError('session_ended');
      else if (s?.connectedAt) error = new SpeechError('session_in_use');
    }
    // Nothing is left reserved: a session that never connected settles now.
    await endOnServer();
    await release();
    throw error;
  }

  // Live: the microphone goes out frame by frame (silence while muted).
  audio.onFrame = (frame) => {
    if (ws.readyState !== WebSocket.OPEN || closing) return;
    send({ type: 'session.input_audio.append', audio: pcmToBase64(muted ? silence() : frame) });
  };
  opts.onPhase?.('live');

  let ending: Promise<void> | null = null;
  return {
    info,
    reservedAt,
    audio,
    setMuted(on) {
      if (on === muted) return;
      muted = on;
      send({ type: on ? 'session.input_audio.mute' : 'session.input_audio.unmute' });
    },
    end() {
      ending ??= (async () => {
        closing = true;
        // Our server ends it first (POST .../end, which records the end with
        // the connection open), then the socket closes: it settles at once,
        // billed until now, instead of at its next usage report.
        await endOnServer();
        send({ type: 'session.close' });
        await new Promise<void>((resolve) => {
          if (ws.readyState === WebSocket.CLOSED) return resolve();
          const timer = setTimeout(() => { try { ws.close(); } catch { /* closed */ } resolve(); }, 5000);
          ws.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
        await finish('ended');
      })();
      return ending;
    },
    status,
  };
}
