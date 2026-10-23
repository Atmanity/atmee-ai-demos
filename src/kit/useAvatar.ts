// The avatar session as React state. An app calls state()/note()/event() any
// time; what it says before the avatar is live is kept and delivered once the
// avatar can hear it (the latest state, every note, recent events).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AvatarError, joinAvatar, type AvatarSession, type Phase, type ToolCall } from '../avatar/room.ts';

export type AvatarPhase = 'idle' | Phase | 'ended' | 'failed';
export interface Line { id: number; who: 'avatar' | 'user'; text: string; typed?: boolean }

export interface AvatarHandlers {
  /** A finished utterance of the user (spoken, as recognised; or typed). */
  onUserSaid?: (text: string, how: 'spoken' | 'typed') => void;
  /** A finished utterance of the avatar. */
  onAvatarSaid?: (text: string) => void;
  /** The avatar is in the room and hears the app. */
  onLive?: () => void;
  onEnded?: () => void;
  /** A call of one of the app's tools; the return value is an `await` tool's result. */
  onToolCall?: (call: ToolCall) => unknown | Promise<unknown>;
}

export interface Avatar {
  phase: AvatarPhase;
  detail: string;
  errorCode?: string;
  speaking: boolean;
  caption: string;          // the avatar's words as they come
  heard: string;            // the user's words as they are recognised
  lines: Line[];
  secondsLeft: number | null;
  micOn: boolean;
  audioBlocked: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  start(opts?: { mic?: boolean }): Promise<void>;
  end(): Promise<void>;
  /** A typed user turn: it shows in the transcript and the avatar answers it. */
  say(text: string): void;
  /** Show a line the user typed that the app handled itself (nothing is sent to the avatar). */
  record(text: string): void;
  state(text: string): void;
  note(text: string): void;
  event(text: string, ttlS?: number): void;
  mute(): void;
  unmute(): void;
  setMic(on: boolean): void;
  resumeAudio(): void;
}

const ERRORS: Record<string, string> = {
  avatar_busy: 'Already on another call. Try again in a minute.',
  avatar_not_ready: 'Not ready to take calls yet. Try again shortly.',
  no_capacity: 'Every line is busy right now. Try again in a minute.',
  insufficient_credits: 'Calls are paused right now. Please try again later.',
  api_key_spend_cap_reached: 'Calls are paused right now. Please try again later.',
  no_avatar: 'This app is not set up yet: give it a host (AVATAR_DEFAULT, see the README).',
  arrival_timeout: 'The call did not connect in time. A second try usually works.',
  backend_unreachable: 'We could not reach the server. Check your connection and try again.',
  upstream_failed: 'We could not place the call. Try again in a moment.',
};

export function useAvatar(app: string, handlers: AvatarHandlers = {}): Avatar {
  const [phase, setPhase] = useState<AvatarPhase>('idle');
  const [detail, setDetail] = useState('');
  const [errorCode, setErrorCode] = useState<string>();
  const [speaking, setSpeaking] = useState(false);
  const [caption, setCaption] = useState('');
  const [heard, setHeard] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const sessionRef = useRef<AvatarSession | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const resumeRef = useRef<(() => Promise<void>) | undefined>(undefined);
  // What the app said before the avatar was live, to deliver on arrival.
  const pending = useRef<{ state?: string; notes: string[]; events: { text: string; ttl?: number }[] }>({ notes: [], events: [] });
  const sentNotes = useRef(new Set<string>());   // notes this session already has
  // A typed turn comes back as a user transcription too; that echo is not new speech.
  const lastTyped = useRef<{ text: string; at: number } | null>(null);
  const isEcho = (text: string) => {
    const typed = lastTyped.current;
    const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return Boolean(typed && Date.now() - typed.at < 20_000 && norm(typed.text) === norm(text));
  };
  const lineId = useRef(0);
  const addLine = useCallback((line: Omit<Line, 'id'>) => {
    setLines((ls) => [...ls.slice(-80), { ...line, id: ++lineId.current }]);
    // For tests and analytics, whatever the app's layout: every finished line, as a window event.
    dispatchEvent(new CustomEvent('atmee:line', { detail: line }));
  }, []);
  // The call's phase and whether the host is speaking, on <html> (data-call, data-speaking): for CSS and tests.
  useEffect(() => { document.documentElement.dataset.call = phase; }, [phase]);
  useEffect(() => { document.documentElement.dataset.speaking = String(speaking); }, [speaking]);

  const starting = useRef(false);   // set before the first await: a second click while the mic prompt is up starts nothing
  const start = useCallback(async ({ mic = false }: { mic?: boolean } = {}) => {
    if (sessionRef.current || starting.current) return;
    starting.current = true;
    setErrorCode(undefined); setDetail(''); setLines([]); setCaption(''); setHeard('');
    sentNotes.current.clear();
    let stream: MediaStream | null = null;
    if (mic) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch {
        setDetail('No microphone: you can type instead.');
      }
    }
    setMicOn(Boolean(stream));
    try {
      const session = await joinAvatar({
        app, mic: stream, video: () => videoRef.current, audio: () => audioRef.current,
        onPhase: (p, d) => {
          setPhase(p);
          if (p === 'warming') setDetail(`Getting ready (${d?.waited ?? 0} s)…`);
          if (p === 'live') setSecondsLeft(typeof d?.maxSeconds === 'number' ? d.maxSeconds : null);
        },
        onAvatarSpeech: (text, done) => {
          setCaption(text);
          if (!done) return;
          addLine({ who: 'avatar', text });
          handlersRef.current.onAvatarSaid?.(text);
        },
        onUserSpeech: (text, final) => {
          if (isEcho(text)) {
            if (final) lastTyped.current = null;
            return;
          }
          setHeard(final ? '' : text);
          if (!final) return;
          addLine({ who: 'user', text });
          handlersRef.current.onUserSaid?.(text, 'spoken');
        },
        onSpeaking: setSpeaking,
        onToolCall: (call) => {
          const handle = handlersRef.current.onToolCall;
          if (!handle) throw new Error('this page handles no tools');
          return handle(call);
        },
        onAudioBlocked: (blocked, resume) => { setAudioBlocked(blocked); resumeRef.current = resume; },
        onEnd: () => {
          sessionRef.current = null;
          setPhase((p) => (p === 'failed' ? p : 'ended'));
          setSpeaking(false);
          handlersRef.current.onEnded?.();
        },
      });
      sessionRef.current = session;
      // Deliver what the app said while the avatar was on its way.
      const { state, notes, events } = pending.current;
      for (const text of notes) {
        sentNotes.current.add(text);
        await session.note(text);
      }
      if (state) await session.state(state);
      // Events from before the avatar arrived were meant for its arrival; the last few still matter.
      for (const e of events.slice(-3)) await session.event(e.text, e.ttl);
      pending.current.events = [];
      handlersRef.current.onLive?.();
    } catch (err) {
      const code = err instanceof AvatarError ? err.code : 'failed';
      setErrorCode(code);
      setDetail(ERRORS[code] ?? 'We could not place the call. Try again in a moment.');
      console.warn('[call] could not start: %s', code);
      setPhase('failed');
      stream?.getTracks().forEach((t) => t.stop());
    } finally {
      starting.current = false;
    }
  }, [app, addLine]);

  const end = useCallback(async () => { await sessionRef.current?.end(); }, []);

  useEffect(() => () => { void sessionRef.current?.end(); }, []);
  useEffect(() => {
    if (phase !== 'live' || secondsLeft === null) return;
    const id = setInterval(() => setSecondsLeft((s) => (s === null ? s : Math.max(0, s - 1))), 1000);
    return () => clearInterval(id);
  }, [phase, secondsLeft === null]);

  return useMemo<Avatar>(() => ({
    phase, detail, errorCode, speaking, caption, heard, lines, secondsLeft, micOn, audioBlocked, videoRef, audioRef,
    start, end,
    say(text) {
      lastTyped.current = { text, at: Date.now() };
      addLine({ who: 'user', text, typed: true });
      handlersRef.current.onUserSaid?.(text, 'typed');
      void sessionRef.current?.say(text);
    },
    record(text) { addLine({ who: 'user', text, typed: true }); },
    state(text) {
      pending.current.state = text;
      void sessionRef.current?.state(text);
    },
    note(text) {
      if (!pending.current.notes.includes(text)) pending.current.notes.push(text);
      if (!sessionRef.current || sentNotes.current.has(text)) return;
      sentNotes.current.add(text);
      void sessionRef.current.note(text);
    },
    event(text, ttl) {
      if (sessionRef.current) void sessionRef.current.event(text, ttl);
      else pending.current.events.push({ text, ttl });
    },
    mute() { void sessionRef.current?.send({ type: 'mute' }); },
    unmute() { void sessionRef.current?.send({ type: 'unmute' }); },
    setMic(on) {
      const session = sessionRef.current;
      if (!session) return setMicOn(on);   // before a session: the choice for start()
      // A typing-only session gets a real microphone here; the toggle shows on only once it is.
      session.setMicMuted(!on).then(() => setMicOn(on), () => setDetail('No microphone: you can type instead.'));
    },
    resumeAudio() { void resumeRef.current?.().then(() => setAudioBlocked(false)); },
  }), [phase, detail, errorCode, speaking, caption, heard, lines, secondsLeft, micOn, audioBlocked, start, end, addLine]);
}
