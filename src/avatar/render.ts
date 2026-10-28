// The avatar-only way from the page: the page is the agent. Our server starts
// the render (POST /api/apps/<app>/render: it mints the LiveKit tokens with the
// app's own project and calls POST /v1/avatars/{id}/avatar_sessions), then the
// page joins the app's own room as the agent, plays the avatar's video and
// voice, and hands the avatar what to say:
//
//   lk.audio_stream      a byte stream to the avatar per piece of speech: 16 kHz mono
//                        16-bit PCM, attributes sample_rate and num_channels; closing it
//                        ends the piece
//   lk.playback_started  the avatar began playing a piece (RPC to the page)
//   lk.playback_finished it finished or was cut: { playback_position, interrupted }
//   lk.clear_buffer      the page cuts what the avatar is saying (RPC to the avatar)
//
// The page publishes no track: the avatar publishes the voice, in sync with the face.
// Framework-free; src/kit/useAvatarOnly.ts wraps it for React.
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack, type RpcInvocationData } from 'livekit-client';
import { SAMPLE_RATE } from './pcm.ts';

const AUDIO_STREAM = 'lk.audio_stream';
const CLEAR_BUFFER = 'lk.clear_buffer';
const SET_PROMPT = 'avatar.set_prompt';
const PLAYBACK_STARTED = 'lk.playback_started';
const PLAYBACK_FINISHED = 'lk.playback_finished';
const CHUNK_SAMPLES = SAMPLE_RATE / 10;      // 100 ms per write: an even byte count, whole samples
const WARMING_LIMIT_MS = 6 * 60_000;         // how long to keep retrying a 503 (a v2 pool starting up)
const ARRIVAL_TIMEOUT_MS = 7 * 60_000;       // the service waits up to 6 min for a v2 render to join

export type RenderPhase = 'starting' | 'warming' | 'connecting' | 'arriving' | 'live';

export interface RenderInfo {
  sessionId: string;
  serverUrl: string;
  token: string;
  agentIdentity: string;
  avatarIdentity: string;
  maxSeconds: number;
}

export interface Played { interrupted: boolean; position: number }

export interface RenderOptions {
  app: string;                          // the app id: /api/apps/<app>/render
  video?: HTMLVideoElement | null | (() => HTMLVideoElement | null);
  audio?: HTMLAudioElement | null | (() => HTMLAudioElement | null);
  onPhase?: (phase: RenderPhase, detail?: Record<string, unknown>) => void;
  /** The avatar is playing speech (between lk.playback_started and lk.playback_finished). */
  onSpeaking?: (speaking: boolean) => void;
  onAudioBlocked?: (blocked: boolean, resume: () => Promise<void>) => void;
  onEnd?: (reason: string) => void;
}

/** A piece of speech written as it comes (a live microphone). */
export interface SpeechWriter {
  write(pcm: Int16Array): Promise<void>;
  /** Closes the piece; resolves once the avatar has played it, or it was cut. */
  end(): Promise<Played>;
}

export interface RenderedAvatar {
  info: RenderInfo;
  room: Room;
  /** Says a whole piece (16 kHz mono PCM); resolves once the avatar has played it, or it was cut. */
  say(pcm: Int16Array): Promise<Played>;
  /** Opens a piece to write as the audio comes. */
  open(): Promise<SpeechWriter>;
  /** Cuts what the avatar is saying and anything still waiting to be said. */
  interrupt(): Promise<void>;
  /**
   * The renderer's free-form prompts (avatar_service's `avatar.set_prompt`): what the avatar
   * looks like and how it moves, while it talks and while it listens. A prompt holds until it is
   * replaced; null or '' clears it, a mode left out keeps its prompt. Only the agent the avatar
   * publishes on behalf of may set them: this page. Resolves to the renderer's answer, which says
   * whether it draws prompts at all (`renders_prompts`), or null when it could not be asked.
   */
  setPrompt(update: { talking?: string | null; listening?: string | null }): Promise<AvatarPrompts | null>;
  end(): Promise<void>;
}

export interface AvatarPrompts { talking?: string | null; listening?: string | null; renders_prompts?: boolean }

export class RenderError extends Error {
  constructor(readonly code: string, message?: string, readonly retryAfter = 0) { super(message || code); }
}

/**
 * The pieces sent and not yet played, oldest first: the avatar plays them in
 * order and reports each one's end, so its reports settle them in order too.
 * A piece is given up on only once it is the one playing and runs past its
 * deadline: one queued behind a long recording waits its turn.
 */
export function createPlayback() {
  type Entry = { resolve: (p: Played) => void; deadlineMs: number; timer?: ReturnType<typeof setTimeout> };
  const waiting: Entry[] = [];
  const armHead = () => {
    const head = waiting[0];
    if (head && !head.timer) head.timer = setTimeout(() => settle(head, { interrupted: true, position: 0 }), head.deadlineMs);
  };
  return {
    /** A piece is out; give up on it `deadlineMs` after its turn comes (the avatar never said it played). */
    add(deadlineMs: number): Promise<Played> {
      return new Promise<Played>((resolve) => {
        waiting.push({ resolve, deadlineMs });
        armHead();
      });
    },
    /** The avatar's lk.playback_finished: it settles the oldest piece; a cut one takes the rest with it. */
    finished(played: Played) {
      const first = waiting[0];
      if (!first) return;
      settle(first, played);
      if (played.interrupted) this.cutAll();
    },
    /** Everything still waiting, settled as cut. */
    cutAll() { for (const entry of [...waiting]) settle(entry, { interrupted: true, position: 0 }); },
    /** What is waiting now, to cut later: pieces sent after this are left alone. */
    mark() {
      const now = [...waiting];
      return () => { for (const entry of now) settle(entry, { interrupted: true, position: 0 }); };
    },
    get pending() { return waiting.length; },
  };
  function settle(entry: Entry, played: Played) {
    const at = waiting.indexOf(entry);
    if (at < 0) return;
    waiting.splice(at, 1);
    clearTimeout(entry.timer);
    entry.resolve(played);
    armHead();
  }
}

/** The avatar's report, read leniently: a missing or malformed payload counts as played through. */
export function readPlayed(payload: string): Played {
  try {
    const data = JSON.parse(payload);
    return { interrupted: data?.interrupted === true, position: Number(data?.playback_position) || 0 };
  } catch {
    return { interrupted: false, position: 0 };
  }
}

async function startOnServer(app: string, onPhase: RenderOptions['onPhase']): Promise<RenderInfo> {
  const started = Date.now();
  for (;;) {
    const res = await fetch(`/api/apps/${app}/render`, { method: 'POST' }).catch(() => null);
    if (!res) throw new RenderError('backend_unreachable');
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json as RenderInfo;
    // A v2 render pool that scaled to zero answers avatar_warming while it starts; no_capacity while every worker is busy.
    if (res.status === 503 && (json.error === 'avatar_warming' || json.error === 'no_capacity') && Date.now() - started < WARMING_LIMIT_MS) {
      onPhase?.('warming', { error: json.error });
      await new Promise((r) => setTimeout(r, Math.min(Math.max(Number(json.retryAfter) || 5, 2), 20) * 1000));
      continue;
    }
    throw new RenderError(json.error || `http_${res.status}`, json.message, Number(json.retryAfter) || 0);
  }
}

const resolveEl = <T extends HTMLElement>(el: T | null | undefined | (() => T | null)) => (typeof el === 'function' ? el() : el) ?? null;

export async function renderAvatar(opts: RenderOptions): Promise<RenderedAvatar> {
  opts.onPhase?.('starting');
  const info = await startOnServer(opts.app, opts.onPhase);
  const endOnServer = () => fetch(`/api/apps/${opts.app}/render/${info.sessionId}/end`, { method: 'POST', keepalive: true }).catch(() => {});

  opts.onPhase?.('connecting');
  const room = new Room({ adaptiveStream: true, dynacast: true });
  const playback = createPlayback();
  let ended = false;
  let speaking = false;
  const setSpeaking = (on: boolean) => { if (on !== speaking) { speaking = on; opts.onSpeaking?.(on); } };

  room.registerRpcMethod(PLAYBACK_STARTED, async (data: RpcInvocationData) => {
    if (data.callerIdentity === info.avatarIdentity) setSpeaking(true);
    return '';
  });
  room.registerRpcMethod(PLAYBACK_FINISHED, async (data: RpcInvocationData) => {
    if (data.callerIdentity !== info.avatarIdentity) return '';
    playback.finished(readPlayed(data.payload));
    if (!playback.pending) setSpeaking(false);
    return '';
  });

  // The avatar's tracks: its voice first (its video is published once someone listens), then its face.
  let videoPlaying = false;
  let resolveArrival: () => void = () => {};
  let failArrival: (err: RenderError) => void = () => {};
  const arrival = new Promise<void>((resolve, reject) => { resolveArrival = resolve; failArrival = reject; });
  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
    if (participant.identity !== info.avatarIdentity) return;
    if (track.kind === Track.Kind.Audio) {
      const el = resolveEl(opts.audio);
      if (el) track.attach(el);
    } else if (track.kind === Track.Kind.Video) {
      const el = resolveEl(opts.video);
      if (!el) return;
      track.attach(el);
      const playing = () => { if (!videoPlaying) { videoPlaying = true; resolveArrival(); } };
      if (!el.paused && el.readyState >= 2) playing(); else el.addEventListener('playing', playing, { once: true });
    }
  });
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    opts.onAudioBlocked?.(!room.canPlaybackAudio, () => room.startAudio());
  });
  room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
    if (p.identity === info.avatarIdentity && !ended) void finish('avatar_left');
  });
  room.on(RoomEvent.Disconnected, () => { if (!ended) void finish('disconnected'); });

  // Leaving the page ends the render (its billing) even when nothing else gets to run.
  const onHide = () => { if (!ended) void endOnServer(); };
  addEventListener('pagehide', onHide);

  async function finish(reason: string) {
    if (ended) return;
    ended = true;
    // Gone before the face appeared: the start fails now, not at the arrival timeout.
    failArrival(new RenderError(reason));
    removeEventListener('pagehide', onHide);
    playback.cutAll();
    setSpeaking(false);
    await endOnServer();
    await room.disconnect();
    opts.onEnd?.(reason);
  }

  try {
    await room.connect(info.serverUrl, info.token, { autoSubscribe: true });
  } catch (err) {
    ended = true;
    removeEventListener('pagehide', onHide);
    await endOnServer();
    throw new RenderError('connect_failed', (err as Error).message);
  }
  opts.onPhase?.('arriving');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new RenderError('arrival_timeout')), ARRIVAL_TIMEOUT_MS); });
  try {
    await Promise.race([arrival, timeout]);
  } catch (err) {
    await finish((err as RenderError).code ?? 'arrival_timeout');
    throw err;
  } finally {
    clearTimeout(timer);
  }
  opts.onPhase?.('live');

  // One piece at a time on the wire, in order.
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(job: () => Promise<T>) => { const next = queue.then(job, job); queue = next.catch(() => {}); return next; };
  const openStream = () => room.localParticipant.streamBytes({
    topic: AUDIO_STREAM,
    destinationIdentities: [info.avatarIdentity],
    attributes: { sample_rate: String(SAMPLE_RATE), num_channels: '1' },
  });
  const bytes = (pcm: Int16Array) => new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);

  async function open(): Promise<SpeechWriter> {
    if (ended) throw new RenderError('ended');
    const writer = await inTurn(openStream);
    let samples = 0;
    let closed = false;
    return {
      async write(pcm) {
        if (closed || ended || !pcm.length) return;
        samples += pcm.length;
        await writer.write(bytes(pcm));
      },
      async end() {
        if (closed) return { interrupted: true, position: 0 };
        closed = true;
        // Given up on a while after it should have played, counted from its turn: the avatar plays in real time.
        const done = playback.add((samples / SAMPLE_RATE + 30) * 1000);
        await writer.close();
        return done;
      },
    };
  }

  return {
    info,
    room,
    async say(pcm) {
      if (ended) return { interrupted: true, position: 0 };
      const writer = await open();
      for (let at = 0; at < pcm.length; at += CHUNK_SAMPLES) await writer.write(pcm.subarray(at, at + CHUNK_SAMPLES));
      return writer.end();
    },
    open,
    async interrupt() {
      if (ended) return;
      const cut = playback.mark();
      await room.localParticipant.performRpc({ destinationIdentity: info.avatarIdentity, method: CLEAR_BUFFER, payload: '' }).catch(() => {});
      // The avatar reports the cut piece; what was queued behind it was cleared with it and gets no report.
      setTimeout(() => { cut(); if (!playback.pending) setSpeaking(false); }, 1500);
    },
    async setPrompt(update) {
      if (ended) return null;
      try {
        const answer = await room.localParticipant.performRpc({ destinationIdentity: info.avatarIdentity, method: SET_PROMPT, payload: JSON.stringify(update), responseTimeout: 10_000 });
        return JSON.parse(answer) as AvatarPrompts;
      } catch (err) {
        console.warn('[render] set_prompt failed: %s', (err as Error).message);
        return null;
      }
    },
    end: () => finish('ended_by_page'),
  };
}
