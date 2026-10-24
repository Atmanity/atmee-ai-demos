// React for the avatar-only way (src/avatar/render.ts): the page is the agent.
// The app makes the speech (its own model and voice, a recording, a microphone)
// and hands it over as 16 kHz PCM; the avatar is the face that says it, in the
// app's own LiveKit room. The phases are the full-stack hook's, so the kit's
// BackToApps works with it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RenderError, renderAvatar, type Played, type RenderedAvatar, type SpeechWriter } from '../avatar/render.ts';
import type { AvatarPhase } from './useAvatar.ts';

export type { Played, SpeechWriter } from '../avatar/render.ts';

export interface AvatarOnly {
  phase: AvatarPhase;
  detail: string;
  errorCode?: string;
  /** The avatar is playing speech now. */
  speaking: boolean;
  secondsLeft: number | null;
  audioBlocked: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  start(): Promise<void>;
  end(): Promise<void>;
  /** Hands the avatar a whole piece to say; resolves once it played (or was cut). */
  say(pcm: Int16Array): Promise<Played>;
  /** Opens a piece to write as it comes (a live microphone); null when not live. */
  open(): Promise<SpeechWriter | null>;
  /** Cuts what the avatar is saying. */
  interrupt(): Promise<void>;
  resumeAudio(): void;
}

const ERRORS: Record<string, string> = {
  livekit_not_configured: "This app renders into the site's own LiveKit room, and the site has none set up (LIVEKIT_URL, see the README).",
  no_avatar: 'This app is not set up yet: give it a host (its avatar.json, see the README).',
  no_capacity: 'Every renderer is busy right now. Try again in a minute.',
  avatar_warming: 'The renderer is still starting. Try again in a minute.',
  insufficient_credits: 'Paused right now. Please try again later.',
  api_key_spend_cap_reached: 'Paused right now. Please try again later.',
  arrival_timeout: 'The face did not appear in time. A second try usually works.',
  connect_failed: 'We could not join the room. Check your connection and try again.',
  backend_unreachable: 'We could not reach the server. Check your connection and try again.',
};

const WARMING: Record<string, string> = {
  avatar_warming: 'The renderer is starting up; the first face of the day takes a minute or two.',
  no_capacity: 'Every renderer is busy; waiting for one to free up.',
};

export function useAvatarOnly(app: string, handlers: { onEnded?: () => void } = {}): AvatarOnly {
  const [phase, setPhase] = useState<AvatarPhase>('idle');
  const [detail, setDetail] = useState('');
  const [errorCode, setErrorCode] = useState<string>();
  const [speaking, setSpeaking] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const render = useRef<RenderedAvatar | null>(null);
  const starting = useRef(false);
  const resumeRef = useRef<() => Promise<void>>(async () => {});
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const start = useCallback(async () => {
    if (starting.current || render.current) return;
    starting.current = true;
    setErrorCode(undefined);
    setDetail('');
    setSpeaking(false);
    try {
      const rendered = await renderAvatar({
        app,
        video: () => videoRef.current,
        audio: () => audioRef.current,
        onPhase: (p, d) => {
          setPhase(p);
          if (p === 'warming') setDetail(WARMING[String(d?.error)] ?? WARMING.avatar_warming);
        },
        onSpeaking: setSpeaking,
        onAudioBlocked: (blocked, resume) => { setAudioBlocked(blocked); resumeRef.current = resume; },
        onEnd: () => {
          render.current = null;
          setSpeaking(false);
          setSecondsLeft(null);
          setPhase((p) => (p === 'failed' ? p : 'ended'));
          handlersRef.current.onEnded?.();
        },
      });
      render.current = rendered;
      setSecondsLeft(rendered.info.maxSeconds);
    } catch (err) {
      const code = err instanceof RenderError ? err.code : 'failed';
      setErrorCode(code);
      setDetail(ERRORS[code] ?? 'We could not start the face. Try again in a moment.');
      console.warn('[render] could not start: %s', code);
      setPhase('failed');
    } finally {
      starting.current = false;
    }
  }, [app]);

  const end = useCallback(async () => { await render.current?.end(); }, []);
  const say = useCallback(async (pcm: Int16Array): Promise<Played> => render.current?.say(pcm) ?? { interrupted: true, position: 0 }, []);
  const open = useCallback(async () => render.current?.open() ?? null, []);
  const interrupt = useCallback(async () => { await render.current?.interrupt(); }, []);

  useEffect(() => () => { void render.current?.end(); }, []);
  useEffect(() => {
    if (phase !== 'live' || secondsLeft === null) return;
    const id = setInterval(() => setSecondsLeft((s) => (s === null ? s : Math.max(0, s - 1))), 1000);
    return () => clearInterval(id);
  }, [phase, secondsLeft === null]);

  return useMemo(() => ({
    phase, detail, errorCode, speaking, secondsLeft, audioBlocked, videoRef, audioRef,
    start, end, say, open, interrupt,
    resumeAudio: () => { void resumeRef.current(); },
  }), [phase, detail, errorCode, speaking, secondsLeft, audioBlocked, start, end, say, open, interrupt]);
}
