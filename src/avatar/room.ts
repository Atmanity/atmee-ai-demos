// Joining an app's avatar session from the page: start it through our own
// server (the API key never reaches the browser), join the LiveKit room as the
// user, wait until the avatar is on screen, then talk to it, tell it what the
// app knows, and hear both sides of the conversation.
//
// Framework-free; src/kit/useAvatar.ts wraps it for React.
import { Room, RoomEvent, Track } from 'livekit-client';
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
  video?: HTMLVideoElement | null;
  audio?: HTMLAudioElement | null;
  mic?: MediaStream | null;             // null: typing only (a silent track is published)
  onPhase?: (phase: Phase, detail?: Record<string, unknown>) => void;
  /** The avatar's words; `done` once the utterance is complete. */
  onAvatarSpeech?: (text: string, done: boolean) => void;
  /** The user's words as the avatar's speech recognition heard them; `final` once the utterance is complete. */
  onUserSpeech?: (text: string, final: boolean) => void;
  onSpeaking?: (speaking: boolean) => void;
  onAudioBlocked?: (blocked: boolean, resume: () => Promise<void>) => void;
  onEnd?: (reason: unknown) => void;
}

export interface AvatarSession {
  session: SessionInfo;
  room: Room;
  /** A typed user turn, held while the avatar has the floor (floor.ts). */
  say(text: string): Promise<void>;
  send(message: AppMessage): Promise<void>;
  state(text: string): Promise<void>;
  note(text: string): Promise<void>;
  event(text: string, ttlS?: number): Promise<void>;
  setMicMuted(muted: boolean): Promise<void>;
  end(): Promise<void>;
}

export class AvatarError extends Error {
  constructor(public code: string, message?: string) { super(message || code); }
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
  opts.onPhase?.('starting');
  const session = await startSession(api, opts.onPhase).catch((err) => { stopMic(); throw err; });
  // From here the avatar is waiting in the room: a closed tab must end the session.
  const endUrl = `${api}/session/${session.sessionId}/end`;
  let ended = false;
  const onPageHide = () => { if (!ended) navigator.sendBeacon(endUrl); };
  addEventListener('pagehide', onPageHide);
  opts.onPhase?.('connecting');

  const room = new Room({ adaptiveStream: true, dynacast: true });
  let linked = false;
  let lastState: string | undefined;
  let micTrack: { mute(): Promise<unknown>; unmute(): Promise<unknown> } | undefined;
  let silence: { ctx: AudioContext; track: MediaStreamTrack } | undefined;
  const outbox: [string, string][] = [];   // sent before the agent links the user
  const sendText = async (topic: string, text: string) => {
    if (!linked) {
      outbox.push([topic, text]);
      return;
    }
    await room.localParticipant.sendText(text, { topic });
  };
  const floor = createFloor((text) => sendText(CHAT, text));
  const endOnServer = () => fetch(endUrl, { method: 'POST', keepalive: true }).catch(() => {});
  const release = () => {
    ended = true;
    removeEventListener('pagehide', onPageHide);
    floor.close();
    stopMic();
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

  let arrived!: () => void;
  const arrival = new Promise<void>((resolve) => { arrived = resolve; });
  if (video) {
    Object.assign(video, { muted: true, playsInline: true, autoplay: true });
    video.addEventListener('playing', () => arrived(), { once: true });
  }
  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === Track.Kind.Video) {
      if (!video) return arrived();
      track.attach(video);
      video.play().catch(() => {});
    } else if (track.kind === Track.Kind.Audio && audio) {
      track.attach(audio);
    }
  });
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    const now = speakers.some((p) => p.identity !== room.localParticipant.identity);
    if (floor.speaking(now)) opts.onSpeaking?.(now);
  });
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => opts.onAudioBlocked?.(!room.canPlaybackAudio, () => room.startAudio()));
  room.on(RoomEvent.Reconnecting, () => debug('reconnecting'));
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
    } else {
      silence = await publishSilence(room);
    }
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
    send,
    state: (text) => send({ type: 'state', text }),
    note: (text) => send({ type: 'note', text }),
    event: (text, ttlS) => send({ type: 'event', text, ...(ttlS ? { ttl_s: ttlS } : {}) }),
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
