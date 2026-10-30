// React for the speech-to-speech way (src/speech/session.ts): a voice call
// with the app's own conversation, in the avatar's voice. There is no video:
// the page shows what it likes (a call screen, a character it animates from
// the voice's level). The phases are the other hooks', so BackToApps works
// with it, and the conversation fires the same `atmee:line` and `atmee:tool`
// window events and sets the same data-call / data-speaking on <html>.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CallLines, type Said, type SpeechLine } from '../speech/lines.ts';
import { SpeechError, startSpeech, type SpeechCall, type SpeechStatus, type ToolCall, type ToolHandler } from '../speech/session.ts';
import type { AvatarPhase } from './useAvatar.ts';

export type { SpeechStatus, ToolCall, ToolHandler } from '../speech/session.ts';
export { ToolReply } from '../speech/session.ts';
export type { SpeechLine } from '../speech/lines.ts';

/** One tool the model asked for, and what the page answered. */
export interface ToolRun { id: string; name: string; arguments: Record<string, unknown>; output?: string; ok?: boolean; at: number }

/** The call after it ended: how long, why, and what it cost (once the API settled it). */
export interface CallSummary {
  /** Seconds from the line opening to the end, as the page counted them. */
  seconds: number;
  /** Why it ended, in the page's terms (`ended`, `time_up`, `out_of_credits`, `disconnected`, …). */
  reason: string;
  /** The API's settled session, or null while it is still settling (or could not be read). */
  status: SpeechStatus | null;
  settling: boolean;
}

export interface Speech {
  phase: Extract<AvatarPhase, 'idle' | 'starting' | 'connecting' | 'live' | 'ended' | 'failed'>;
  detail: string;
  errorCode?: string;
  /** The End button was pressed: the call is closing. */
  ending: boolean;
  /** The avatar's voice is playing. */
  speaking: boolean;
  /** The user has finished and no answer is playing yet, or the page is running a tool. */
  thinking: boolean;
  muted: boolean;
  /** The browser holds the sound until a tap (autoplay): show a button for resumeAudio(). */
  audioBlocked: boolean;
  secondsLeft: number | null;
  lines: SpeechLine[];
  toolRuns: ToolRun[];
  summary: CallSummary | null;
  /** The avatar's voice and the microphone, 0..1 (RMS) as they play: for a meter or a character's mouth, read each frame. */
  levels(): { voice: number; mic: number };
  start(): Promise<void>;
  end(): Promise<void>;
  setMuted(muted: boolean): void;
  resumeAudio(): void;
}

export const SPEECH_ERRORS: Record<string, string> = {
  mic_blocked: 'The microphone is blocked: allow it in the address bar, then call again.',
  no_mic: 'No microphone could be opened. Connect one and call again.',
  no_audio: 'This browser could not start the call audio.',
  no_avatar: "This app isn't switched on yet: it needs an avatar with a voice (see its README).",
  avatar_has_no_voice: "This app's avatar has no voice yet, so it can't take calls.",
  speech_unavailable: "Voice calls aren't switched on here yet.",
  embed_disabled: "Voice calls aren't switched on here yet.",
  insufficient_credits: 'Calls are paused right now. Please try again later.',
  api_key_spend_cap_reached: 'Calls are paused right now. Please try again later.',
  concurrent_session_limit: 'Every line is busy right now. Try again in a minute.',
  server_full: 'Every line is busy right now. Try again in a minute.',
  server_restarting: 'The line is being restarted. Try again in a minute.',
  token_expired: 'The call took too long to connect. Call again.',
  session_in_use: 'That line was picked up elsewhere. Call again for a new one.',
  session_ended: 'That line closed before it connected. Call again.',
  connect_failed: "We couldn't connect the call. Check your connection and try again.",
  connect_timeout: "We couldn't connect the call. Check your connection and try again.",
  start_refused: 'The call was refused as it started. Try again in a moment.',
  start_failed: 'The call dropped as it started. Try again in a moment.',
  start_timeout: 'The call did not start in time. Try again in a moment.',
  backend_unreachable: 'We could not reach the server. Check your connection and try again.',
  upstream_failed: 'We could not place the call. Try again in a moment.',
};

/** What to say about how the call ended. */
export const END_WORDS: Record<string, string> = {
  ended: 'Call ended',
  time_up: "Time's up: the call reached its limit",
  out_of_credits: 'The call ran out of credits',
  server_restarting: 'The line was closed for maintenance',
  disconnected: 'The line dropped',
};

// The voice counts as speaking above this level, and goes on counting for a
// moment after it falls, so a breath between words is no change of floor.
const SPEAKING_LEVEL = 0.01;
const SPEAKING_HOLD_MS = 350;
// "Thinking" lasts until the answer starts, or this long without one (the avatar may stay quiet).
const THINKING_MAX_MS = 15_000;

export function useSpeech(app: string, options: { tools?: Record<string, ToolHandler>; onEnded?: (reason: string) => void } = {}): Speech {
  const [phase, setPhase] = useState<Speech['phase']>('idle');
  const [detail, setDetail] = useState('');
  const [errorCode, setErrorCode] = useState<string>();
  const [ending, setEnding] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [toolsRunning, setToolsRunning] = useState(0);
  const [muted, setMutedState] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [lines, setLines] = useState<SpeechLine[]>([]);
  const [toolRuns, setToolRuns] = useState<ToolRun[]>([]);
  const [summary, setSummary] = useState<CallSummary | null>(null);
  const call = useRef<SpeechCall | null>(null);
  const starting = useRef(false);
  const liveAt = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => { document.documentElement.dataset.call = phase; }, [phase]);
  useEffect(() => { document.documentElement.dataset.speaking = String(speaking); }, [speaking]);

  // The call's lines (src/speech/lines.ts); each finished one also goes out as an `atmee:line` window event.
  const transcript = useRef(new CallLines());
  const publish = (said: Said[]) => {
    setLines(transcript.current.lines);
    for (const line of said) dispatchEvent(new CustomEvent('atmee:line', { detail: line }));
  };

  const waitingSince = useRef(0);
  const onUserText = useCallback((text: string, final: boolean, tags: { interruption: boolean; backchannel: boolean }) => {
    publish(transcript.current.user(text, final, tags));
    if (final && !tags.backchannel && text) {
      waitingSince.current = Date.now();
      setWaiting(true);
    }
  }, []);

  const onAvatarText = useCallback((delta: string) => {
    transcript.current.avatar(delta);
    publish([]);
  }, []);

  // Each call has a number: a summary still settling when the next call starts is dropped.
  const generation = useRef(0);
  const settle = useCallback(async (c: SpeechCall, reason: string) => {
    const mine = generation.current;
    const seconds = liveAt.current ? Math.round((Date.now() - liveAt.current) / 1000) : 0;
    setSummary({ seconds, reason, status: null, settling: true });
    // The API settles a session at its end report, a moment after the socket closes.
    for (let i = 0; i < 24; i++) {
      const s = await c.status();
      if (mine !== generation.current) return;
      if (s && (s.status === 'completed' || s.status === 'failed')) {
        setSummary({ seconds, reason, status: s, settling: false });
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
      if (mine !== generation.current) return;
    }
    setSummary((sum) => (sum ? { ...sum, settling: false } : sum));
  }, []);

  const start = useCallback(async () => {
    if (starting.current || call.current) return;
    starting.current = true;
    generation.current++;
    transcript.current = new CallLines();
    setErrorCode(undefined); setDetail(''); setLines([]); setToolRuns([]); setSummary(null);
    setEnding(false); setSpeaking(false); setWaiting(false); setToolsRunning(0); setMutedState(false);
    const names = Object.keys(optionsRef.current.tools ?? {});
    // The latest handlers, whatever render placed the call.
    let endedEarly: string | null = null;
    const tools = Object.fromEntries(names.map((name) => [name, (args: Record<string, unknown>, c: ToolCall) => optionsRef.current.tools?.[name]?.(args, c)]));
    try {
      const placed = await startSpeech({
        app,
        tools,
        onPhase: (p) => setPhase(p),
        onUserText,
        onAvatarText,
        onToolCall: (c, result) => {
          if (!result) {
            setToolsRunning((n) => n + 1);
            setToolRuns((runs) => [...runs, { id: c.callId, name: c.name, arguments: c.arguments, at: Date.now() }]);
            return;
          }
          setToolsRunning((n) => Math.max(0, n - 1));
          setToolRuns((runs) => runs.map((r) => (r.id === c.callId ? { ...r, output: result.output, ok: result.ok } : r)));
        },
        onError: (code, message) => console.warn('[speech] %s: %s', code, message),
        onEnd: (reason) => {
          const c = call.current;
          // Ended before the call was handed back (the line dropped at once): settled once it is.
          if (!c) endedEarly = reason;
          call.current = null;
          setPhase('ended');
          setSpeaking(false);
          setWaiting(false);
          publish(transcript.current.close());
          if (c) void settle(c, reason);
          optionsRef.current.onEnded?.(reason);
        },
      });
      liveAt.current = Date.now();
      if (endedEarly !== null) {
        void settle(placed, endedEarly);
        return;
      }
      call.current = placed;
      // The session's length counts from its reservation, not from the line opening.
      setSecondsLeft(Math.max(0, placed.info.maxSeconds - Math.round((Date.now() - placed.reservedAt) / 1000)));
      setAudioBlocked(placed.audio.suspended);
    } catch (err) {
      const code = err instanceof SpeechError ? err.code : 'failed';
      setErrorCode(code);
      setDetail(SPEECH_ERRORS[code] ?? 'We could not place the call. Try again in a moment.');
      if (err instanceof SpeechError && err.message !== code) console.warn('[speech] %s: %s', code, err.message);
      setPhase('failed');
    } finally {
      starting.current = false;
    }
  }, [app, onUserText, onAvatarText, settle]);

  const end = useCallback(async () => {
    const c = call.current;
    if (!c) return;
    setEnding(true);
    await c.end();
  }, []);

  const setMuted = useCallback((on: boolean) => {
    call.current?.setMuted(on);
    setMutedState(on);
  }, []);

  // Speaking, from the voice's own level as it plays; the clock, from the session's length.
  useEffect(() => {
    if (phase !== 'live') return;
    let lastLoud = 0;
    const id = setInterval(() => {
      const c = call.current;
      if (!c) return;
      const now = Date.now();
      if (c.audio.level > SPEAKING_LEVEL) lastLoud = now;
      const on = now - lastLoud < SPEAKING_HOLD_MS;
      setSpeaking((was) => (was === on ? was : on));
      if (on || now - waitingSince.current > THINKING_MAX_MS) setWaiting((was) => (was ? false : was));
      setAudioBlocked(c.audio.suspended);
    }, 50);
    const clock = setInterval(() => setSecondsLeft((s) => (s === null ? s : Math.max(0, s - 1))), 1000);
    return () => { clearInterval(id); clearInterval(clock); };
  }, [phase]);

  useEffect(() => () => { void call.current?.end(); }, []);

  const levels = useCallback(() => {
    const c = call.current;
    return c ? { voice: c.audio.level, mic: c.audio.micLevel } : { voice: 0, mic: 0 };
  }, []);
  const resumeAudio = useCallback(() => { void call.current?.audio.resume().then(() => setAudioBlocked(false)); }, []);

  return useMemo(() => ({
    phase, detail, errorCode, ending, speaking, thinking: phase === 'live' && !speaking && (waiting || toolsRunning > 0),
    muted, audioBlocked, secondsLeft, lines, toolRuns, summary, levels, start, end, setMuted, resumeAudio,
  }), [phase, detail, errorCode, ending, speaking, waiting, toolsRunning, muted, audioBlocked, secondsLeft, lines, toolRuns, summary, levels, start, end, setMuted, resumeAudio]);
}

/** "2:05" for seconds. */
export const minutes = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;

/** Credits for microcredits (100 microcredits = 1 credit), as the API prices them. */
export const credits = (micro: number) => (micro / 100).toLocaleString('en', { maximumFractionDigits: 2 });
