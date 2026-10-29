// Joining an app's avatar session from the page: start it through our own
// server (the API key never reaches the browser), join the LiveKit room as the
// user, wait until the avatar is on screen, then talk to it, tell it what the
// app knows, hand it files to read, and hear both sides of the conversation.
//
// Framework-free; src/kit/useAvatar.ts wraps it for React.
import { Room, RoomEvent, Track } from 'livekit-client';
import {
  FILE, FILE_STATUS, FILES_ATTRIBUTE, MAX_FILES, FileError, agentIn, createDrops, cutCaption, openDrop,
  type Drop, type FileAnswer, type FileOutcome, type FileProgress,
} from './files.ts';
import { createFloor } from './floor.ts';

const CHAT = 'lk.chat';                 // a typed user turn; the avatar answers it
const APP = 'atmee.app';                // the app's state, notes, events, mute
const TRANSCRIPTION = 'lk.transcription';
const ARRIVAL_TIMEOUT_MS = 90_000;      // from joining the room to the avatar's video playing
const WARMING_LIMIT_MS = 6 * 60_000;    // how long to keep retrying a 503 no_capacity
const LINK_DELAY_MS = 2_500;            // atmee.app is heard only once the agent links the user

/** What the app can tell the avatar on `atmee.app`. */
export type AppMessage =
  | { type: 'state'; text: string }                 // what is true now; replaces the last (<= 3,858 chars)
  | { type: 'note'; text: string }                  // kept for the whole session (<= 2,000 chars each)
  | { type: 'event'; text: string; ttl_s?: number } // spoken about in the avatar's own words, once it has the floor
  | { type: 'mute' }                                // the avatar hears the user as silence (and no transcript comes)
  | { type: 'unmute' };

export type Phase = 'starting' | 'warming' | 'connecting' | 'arriving' | 'live';

export interface SessionInfo { sessionId: string; serverUrl: string; userToken: string; maxSeconds: number | null }

export interface JoinOptions {
  app: string;                          // the app id: /api/apps/<app>/...
  /** Where the host's video and voice play: the element, or how to find it once the tracks arrive (an app may mount its call screen after starting). */
  video?: HTMLVideoElement | null | (() => HTMLVideoElement | null);
  audio?: HTMLAudioElement | null | (() => HTMLAudioElement | null);
  mic?: MediaStream | null;             // null: typing only (a silent track is published)
  /** Publish the microphone muted (push to talk): nothing is heard until setMicMuted(false). */
  micMuted?: boolean;
  /**
   * A video track to publish as the user's camera: the host sees its latest frame
   * when it answers. A copy is published, so ending the call leaves the page's own
   * track (a preview, a scanner) running.
   */
  camera?: MediaStreamTrack | null;
  onPhase?: (phase: Phase, detail?: Record<string, unknown>) => void;
  /** The avatar's words; `done` once the utterance is complete. */
  onAvatarSpeech?: (text: string, done: boolean) => void;
  /** The user's words as the avatar's speech recognition heard them; `final` once the utterance is complete. */
  onUserSpeech?: (text: string, final: boolean) => void;
  onSpeaking?: (speaking: boolean) => void;
  onAudioBlocked?: (blocked: boolean, resume: () => Promise<void>) => void;
  onEnd?: (reason: unknown) => void;
  /**
   * A call of one of the app's tools (`appTools` on the server). The returned
   * value (a string, or anything JSON) is the result an `await` tool hands the
   * avatar; a `notify` tool's is ignored. A throw becomes "error: …".
   */
  onToolCall?: (call: ToolCall) => unknown | Promise<unknown>;
  /** Whether the host takes files now (its agent's atmee.files), each time that changes. */
  onFilesAccepted?: (accepted: boolean) => void;
}

/** A drop's options: what the user said with it, and each file's progress as the host's agent answers it. */
export interface SendFilesOptions { caption?: string; onStatus?: (progress: FileProgress) => void }

export interface ToolCall { id: string; name: string; arguments: Record<string, unknown> }

export interface AvatarSession {
  session: SessionInfo;
  room: Room;
  /** A typed user turn, held while the avatar has the floor (floor.ts). */
  say(text: string): Promise<void>;
  /** A typed user turn sent at once, not held: it cuts the avatar off mid-sentence (barge-in), for an app that means to. */
  interrupt(text: string): Promise<void>;
  send(message: AppMessage): Promise<void>;
  state(text: string): Promise<void>;
  note(text: string): Promise<void>;
  event(text: string, ttlS?: number): Promise<void>;
  setMicMuted(muted: boolean): Promise<void>;
  /**
   * Publish this audio track as the user's microphone, in place of the silence
   * of a typing-only session (another avatar's voice, say); null puts the
   * silence back. For a session started without a microphone.
   */
  feedMic(track: MediaStreamTrack | null): Promise<void>;
  /**
   * Publish this video track as the user's camera now (a copy: the page keeps its own), in
   * place of any before it; null takes the camera away. For a camera opened after the call.
   */
  setCamera(track: MediaStreamTrack | null): Promise<void>;
  /** Whether the host takes files (its runtime reads them): offer a drop only then. */
  acceptsFiles(): boolean;
  /**
   * Drops 1 to MAX_FILES files into the call for the host to read and talk
   * about. Resolves once every file is ready or refused, one outcome per file
   * in order. Rejects, sending nothing, with too_many_files, or with
   * files_unsupported when the host takes no files.
   */
  sendFiles(files: FileList | File[], options?: SendFilesOptions): Promise<FileOutcome[]>;
  end(): Promise<void>;
}

export class AvatarError extends Error {
  constructor(public code: string, message?: string) { super(message || code); }
}

const TOOL_RPC = 'atmee.tool';

/** The element itself, or the one the getter finds within a few seconds (a call screen mounting after the start). */
async function element<T extends HTMLMediaElement>(target: T | (() => T | null)): Promise<T | null> {
  if (typeof target !== 'function') return target;
  for (let i = 0; i < 50; i++) {
    const found = target();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}
// LiveKit refuses an RPC response over 15,360 bytes.
const MAX_TOOL_REPLY_BYTES = 15_000;

/** What an app's tool result is sent back as: a string as it is, anything else as JSON; "ok" for nothing. */
export function toolReply(result: unknown): string {
  if (result === undefined || result === null) return 'ok';
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  return new TextEncoder().encode(text).length > MAX_TOOL_REPLY_BYTES ? 'error: the result was too large' : text;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// The recogniser tags words said over the avatar's speech: "[interruption]" for
// a turn that started there, "[backchannel]" for words it did not take as a
// turn (live, "Sure, I can share a photo" came as "[backchannel] Sure, I." and
// "can share a photo."). The words are still the user's.
const cleanUserText = (text: string) => text.replace(/^\s*\[(?:interruption|backchannel)\]\s*/i, '');

let joins = 0;

export async function joinAvatar(opts: JoinOptions): Promise<AvatarSession> {
  const { app, video, audio, mic } = opts;
  const join = ++joins;
  const debug = (...args: unknown[]) => console.debug(`[avatar #${join}]`, ...args);
  debug('join', app);
  const api = `/api/apps/${app}`;
  let lateMic: MediaStream | undefined;   // a microphone turned on mid-session (typing first)
  const stopMic = () => [mic, lateMic].forEach((m) => m?.getTracks().forEach((t) => t.stop()));
  // The copy of the page's camera published now (from the start, or later with setCamera).
  let camera = opts.camera?.clone();
  const stopCamera = () => camera?.stop();
  opts.onPhase?.('starting');
  const session = await startSession(api, opts.onPhase).catch((err) => { stopMic(); stopCamera(); throw err; });
  // From here the avatar is waiting in the room: a closed tab must end the session.
  const endUrl = `${api}/session/${session.sessionId}/end`;
  let ended = false;
  const onPageHide = () => { if (!ended) navigator.sendBeacon(endUrl); };
  addEventListener('pagehide', onPageHide);
  opts.onPhase?.('connecting');

  const room = new Room({ adaptiveStream: true, dynacast: true });
  // The avatar's tool calls arrive as an RPC from its agent; registered before
  // connecting so no early call finds nobody to answer it.
  room.registerRpcMethod(TOOL_RPC, async ({ payload }) => {
    if (!opts.onToolCall) return 'error: this page handles no tools';
    try {
      return toolReply(await opts.onToolCall(JSON.parse(payload) as ToolCall));
    } catch (err) {
      return `error: ${(err as Error).message}`;
    }
  });
  let linked = false;
  let lastState: string | undefined;
  let micTrack: { mute(): Promise<unknown>; unmute(): Promise<unknown> } | undefined;
  let silence: { ctx: AudioContext; track: MediaStreamTrack } | undefined;
  let fed: MediaStreamTrack | undefined;   // a track the app publishes as the microphone (feedMic)
  const outbox: [string, string][] = [];   // sent before the agent links the user
  const sendText = async (topic: string, text: string) => {
    if (!linked) {
      outbox.push([topic, text]);
      return;
    }
    await room.localParticipant.sendText(text, { topic });
  };
  const floor = createFloor((text) => sendText(CHAT, text));
  const drops = createDrops();
  const endOnServer = () => fetch(endUrl, { method: 'POST', keepalive: true }).catch(() => {});
  const release = () => {
    ended = true;
    removeEventListener('pagehide', onPageHide);
    floor.close();
    drops.refuse('unreadable');
    stopMic();
    stopCamera();
    void silence?.ctx.close();
  };
  const finish = (reason: unknown) => {
    if (ended) return;
    release();
    opts.onEnd?.(reason);
  };

  // Both sides' words arrive here, one stream per utterance. Streams sent as
  // this participant are the user's speech, transcribed; the rest are the
  // avatar's. A finished stream is a finished utterance.
  room.registerTextStreamHandler(TRANSCRIPTION, async (reader, participant) => {
    const fromUser = participant?.identity === room.localParticipant.identity;
    if (!fromUser) floor.utterance();
    let text = '';
    try {
      for await (const chunk of reader) {
        text += chunk;
        if (fromUser) opts.onUserSpeech?.(cleanUserText(text), false);
        else opts.onAvatarSpeech?.(text, false);
      }
    } catch {
      // the stream was cut off; keep what arrived
    }
    if (!text.trim()) return;
    // The recogniser sends a growing utterance as several streams of one
    // segment; only the last carries lk.transcription_final.
    const final = reader.info.attributes?.['lk.transcription_final'] === 'true';
    if (fromUser) opts.onUserSpeech?.(cleanUserText(text), final);
    else opts.onAvatarSpeech?.(text, true);
  });

  // The agent's answers about the files the user dropped, one per file and
  // status, taken from the agent alone.
  room.registerTextStreamHandler(FILE_STATUS, async (reader, participant) => {
    const agent = agentIn(room);
    if (!agent || participant?.identity !== agent.identity) return;
    let answer: FileAnswer;
    try {
      answer = JSON.parse(await reader.readAll());
    } catch {
      return;
    }
    if (typeof answer?.batchId === 'string') drops.answer(answer);
  });
  const acceptsFiles = () => agentIn(room)?.attributes[FILES_ATTRIBUTE] === '1';
  // The agent says it takes files once its runtime agrees, a moment after it joins.
  let accepting = false;
  const checkFiles = () => {
    const now = acceptsFiles();
    if (now === accepting) return;
    accepting = now;
    opts.onFilesAccepted?.(now);
  };
  room.on(RoomEvent.ParticipantAttributesChanged, checkFiles);
  room.on(RoomEvent.ParticipantConnected, checkFiles);
  room.on(RoomEvent.ParticipantDisconnected, checkFiles);
  // A drop to the agent alone, the caption as text and each file as its own
  // stream on the same topic. sendText resolves once every file is out; its id
  // is the drop's batchId.
  const sendDrop = async (drop: Drop, caption?: string) => {
    const agent = agentIn(room);
    if (!agent || !acceptsFiles()) {
      drop.fail(agent ? new FileError('files_unsupported', 'This host does not take files') : new FileError('no_agent', 'The host is not in the call'));
      return;
    }
    const info = await room.localParticipant.sendText(JSON.stringify({ caption: cutCaption(caption) }), {
      topic: FILE, attachments: drop.files, destinationIdentities: [agent.identity],
    }).catch(() => null);
    if (info) drops.sent(drop, info.id);
    else drop.refuse('failed');
  };

  let arrived!: () => void;
  const arrival = new Promise<void>((resolve) => { arrived = resolve; });
  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === Track.Kind.Video) {
      if (!video) return arrived();
      void element(video).then((el) => {
        if (!el) return arrived();   // the app shows no video: arrival is the track itself
        Object.assign(el, { muted: true, playsInline: true, autoplay: true });
        el.addEventListener('playing', () => arrived(), { once: true });
        track.attach(el);
        el.play().catch(() => {});
      });
    } else if (track.kind === Track.Kind.Audio && audio) {
      void element(audio).then((el) => { if (el) track.attach(el); });
    }
  });
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    const now = speakers.some((p) => p.identity !== room.localParticipant.identity);
    if (floor.speaking(now)) opts.onSpeaking?.(now);
  });
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => opts.onAudioBlocked?.(!room.canPlaybackAudio, () => room.startAudio()));
  room.on(RoomEvent.Reconnecting, () => {
    debug('reconnecting');
    // A reconnect cuts the streams still going out: their drops cannot finish.
    drops.refuseUploading('unreadable');
  });
  room.on(RoomEvent.Reconnected, () => debug('reconnected'));
  room.on(RoomEvent.SignalReconnecting, () => debug('signal reconnecting'));
  room.on(RoomEvent.ConnectionStateChanged, (state) => debug('connection', state));
  room.on(RoomEvent.ParticipantConnected, (p) => debug('participant joined', p.identity));
  room.on(RoomEvent.ParticipantDisconnected, (p) => debug('participant left', p.identity));
  room.on(RoomEvent.ConnectionQualityChanged, (quality, p) => { if (p.isLocal) debug('my connection quality', quality); });
  room.on(RoomEvent.Disconnected, (reason) => {
    debug('room disconnected, reason', reason);
    linked = false;
    finish(reason);
  });

  let arrivalTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await room.connect(session.serverUrl, session.userToken);
    await room.startAudio().catch(() => {});
    if (mic) {
      const published = await room.localParticipant.publishTrack(mic.getAudioTracks()[0], { source: Track.Source.Microphone });
      micTrack = published.track as typeof micTrack;
      // Before the agent arrives, so not a frame of it is heard.
      if (opts.micMuted) await micTrack!.mute();
    } else {
      silence = await publishSilence(room);
    }
    if (camera) await room.localParticipant.publishTrack(camera, { source: Track.Source.Camera, simulcast: false });
    opts.onPhase?.('arriving');
    const timeout = new Promise<'timeout'>((resolve) => { arrivalTimer = setTimeout(resolve, ARRIVAL_TIMEOUT_MS, 'timeout'); });
    if ((await Promise.race([arrival, timeout])) === 'timeout') throw new AvatarError('arrival_timeout', 'The avatar did not appear in time');
  } catch (err) {
    release();
    room.disconnect();
    await endOnServer();
    throw err instanceof AvatarError ? err : new AvatarError('connect_failed', (err as Error).message);
  } finally {
    clearTimeout(arrivalTimer);
  }

  await sleep(LINK_DELAY_MS);
  linked = true;
  checkFiles();
  while (outbox.length) await sendText(...outbox.shift()!);
  opts.onPhase?.('live', { maxSeconds: session.maxSeconds });

  const send = async (message: AppMessage) => {
    if (message.type === 'state' && message.text === lastState) return;
    // An event counts before it goes, so a turn typed right after waits for it.
    const withdraw = message.type === 'event' ? floor.event(message.ttl_s) : null;
    try {
      await sendText(APP, JSON.stringify(message));
    } catch (err) {
      withdraw?.();
      throw err;
    }
    // A state counts once it is out, so one that failed can be sent again.
    if (message.type === 'state') lastState = message.text;
  };

  return {
    session, room,
    say: (text) => floor.say(text),
    interrupt: (text) => sendText(CHAT, text),
    send,
    state: (text) => send({ type: 'state', text }),
    note: (text) => send({ type: 'note', text }),
    event: (text, ttlS) => send({ type: 'event', text, ...(ttlS ? { ttl_s: ttlS } : {}) }),
    acceptsFiles,
    async sendFiles(files, { caption, onStatus } = {}) {
      const list = [...(files ?? [])];
      if (list.length > MAX_FILES) throw new FileError('too_many_files', `At most ${MAX_FILES} files in one drop`);
      if (!list.length) return [];
      const drop = openDrop(list, onStatus);
      drops.add(drop);
      if (ended) drop.refuse('unreadable');
      else void sendDrop(drop, caption);
      return drop.done;
    },
    async setMicMuted(muted) {
      if (!micTrack && !muted) {
        // A typing-only session turning the mic on: a real microphone in place of the silence.
        lateMic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (ended) return void lateMic.getTracks().forEach((t) => t.stop());
        const published = await room.localParticipant.publishTrack(lateMic.getAudioTracks()[0], { source: Track.Source.Microphone });
        micTrack = published.track as typeof micTrack;
        if (silence) {
          await room.localParticipant.unpublishTrack(silence.track);
          void silence.ctx.close();
          silence = undefined;
        }
        return;
      }
      if (micTrack) await (muted ? micTrack.mute() : micTrack.unmute());
    },
    async feedMic(track) {
      if (micTrack) throw new Error('feedMic is for a session started without a microphone');
      if (ended || track === (fed ?? null)) return;
      const previous = fed ?? silence?.track;
      const previousSilence = silence;
      fed = track ?? undefined;
      silence = undefined;
      // The new track first, then the old one goes: the agent never sees the user without a microphone.
      if (track) await room.localParticipant.publishTrack(track, { source: Track.Source.Microphone, name: 'feed', dtx: false });
      else silence = await publishSilence(room);
      if (previous) await room.localParticipant.unpublishTrack(previous, false);
      if (previousSilence) void previousSilence.ctx.close();
    },
    async setCamera(track) {
      if (ended) return;
      const previous = camera;
      camera = track?.clone();
      if (camera) await room.localParticipant.publishTrack(camera, { source: Track.Source.Camera, simulcast: false });
      if (previous) {
        await room.localParticipant.unpublishTrack(previous, false);
        previous.stop();
      }
    },
    async end() {
      if (ended) return;
      finish('ended');
      // End on the server first: leaving first settles the session as user_left.
      await endOnServer();
      await room.disconnect();
    },
  };
}

// A 503 no_capacity means no rendering capacity yet: wait Retry-After (at least
// 5 s; 30 s when it is missing) and start again, for up to WARMING_LIMIT_MS.
// Any other failure, a bodyless 503 (embeds turned off) included, is final.
async function startSession(api: string, onPhase?: JoinOptions['onPhase']): Promise<SessionInfo> {
  const since = Date.now();
  for (;;) {
    const res = await fetch(`${api}/session`, { method: 'POST' }).catch(() => null);
    if (!res) throw new AvatarError('backend_unreachable', 'Could not reach the app server');
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body;
    const waited = Date.now() - since;
    const wait = body.retryAfter ? Math.max(body.retryAfter, 5) : 30;
    if (body.error !== 'no_capacity' || waited + wait * 1000 > WARMING_LIMIT_MS) throw new AvatarError(body.error || `http_${res.status}`, body.message);
    onPhase?.('warming', { retryIn: wait, waited: Math.round(waited / 1000) });
    await sleep(wait * 1000);
  }
}

// Typing only: publish a silent microphone, as the tested typing-only sessions
// did. Without DTX: Opus would send almost nothing for digital silence, the
// server would rate the connection lost, the client would force a full
// reconnect, and the platform ends a session whose user reconnects.
async function publishSilence(room: Room) {
  const ctx = new AudioContext();
  const track = ctx.createMediaStreamDestination().stream.getAudioTracks()[0];
  await room.localParticipant.publishTrack(track, { name: 'silence', dtx: false });
  return { ctx, track };
}
