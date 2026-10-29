// Nova over the speech API (POST /v1/speech_sessions): her voice, listening and tools in one
// WebSocket, no video. The face is rendered only when wanted (the kit's avatar-only render, in the
// site's own LiveKit room), and her voice streams into it while it is up. The hook has the kit's
// Avatar shape, so the booth, the chat and the stage work on either engine.
//
// The wire format is Causeur's public Live API (causeur LIVE_API.md):
//   page -> server  session.start, session.input_audio.append (24 kHz PCM16, always, silence too),
//                   causeur.directive.set (the live deck), session.commentary.append (a cue to speak
//                   about, or a typed turn with the typed-reply prefix), response.item.create +
//                   response.create (tool results), session.close
//   server -> page  session.started, session.output_audio.delta (20 ms, silence too),
//                   session.output_transcript.delta, causeur.input_transcript, response.event
//                   (function calls), session.closed, error
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Avatar, AvatarHandlers, Line } from '../../../src/kit/index.ts';
import { fromBase64, tapMicrophone, toBase64 } from '../../../src/kit/index.ts';
import { useAvatarOnly } from '../../../src/kit/useAvatarOnly.ts';
import type { SpeechWriter } from '../../../src/avatar/render.ts';

const RATE = 24_000;
/** Mic audio goes out in pieces this long. */
const SEND_MS = 100;
/** Loud enough to be speech (16-bit RMS), and how long a quiet spell ends an utterance. */
const VOICED_RMS = 250;
const QUIET_END_MS = 700;
/** Causeur reads a commentary that starts with this as the user typing (causeur/live/envelope.py). */
const TYPED_REPLY = "Reply to the caller now, don't repeat what they said. Do not wait for the caller to speak first. After that, pause and listen.\n\n";
/** A refused cue is tried again this often, while it is still worth saying, and only once she has been quiet this long. */
const RETRY_MS = 1500;
const QUIET_FOR_CUE_MS = 800;

interface Cue { text: string; until: number; typed: boolean; id?: string }

/** 24 kHz PCM as 16 kHz, for the face (linear interpolation; speech has little above 8 kHz). */
function to16k(pcm: Int16Array): Int16Array {
  const out = new Int16Array(Math.floor((pcm.length * 2) / 3));
  for (let i = 0; i < out.length; i++) {
    const x = i * 1.5;
    const a = Math.floor(x);
    const b = Math.min(a + 1, pcm.length - 1);
    out[i] = Math.round(pcm[a] + (pcm[b] - pcm[a]) * (x - a));
  }
  return out;
}

const rms = (pcm: Int16Array) => {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / Math.max(1, pcm.length));
};

export interface SpeechCall extends Avatar {
  /** The face, rendered on demand. */
  face: { phase: Avatar['phase']; start(): Promise<void>; end(): Promise<void> };
}

export function useSpeechCall(app: string, handlers: AvatarHandlers = {}): SpeechCall {
  const [phase, setPhase] = useState<Avatar['phase']>('idle');
  const [detail, setDetail] = useState('');
  const [errorCode, setErrorCode] = useState<string>();
  const [speaking, setSpeaking] = useState(false);
  const [caption, setCaption] = useState('');
  const [heard, setHeard] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [micOn, setMicOn] = useState(false);
  const face = useAvatarOnly(app);
  const faceRef = useRef(face);
  faceRef.current = face;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const ws = useRef<WebSocket | null>(null);
  const session = useRef<{ id: string } | null>(null);
  const live = useRef(false);
  const micGate = useRef(false);
  const stopMic = useRef<(() => Promise<void>) | null>(null);
  const silenceTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const outBuf = useRef<Int16Array[]>([]);
  const lineId = useRef(0);
  const lastTyped = useRef<string | null>(null);
  // Her words of the utterance in progress (the caption), kept outside state so a line is added once.
  const captionRef = useRef('');

  const addLine = useCallback((line: Omit<Line, 'id'>) => setLines((ls) => [...ls, { ...line, id: ++lineId.current }]), []);
  const send = useCallback((msg: Record<string, unknown>) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
  }, []);

  // Whether she is speaking now, and since when she has been quiet (from her voice's loudness).
  const quietSince = useRef(0);
  const voiced = useRef(false);

  // ---- What the app tells Nova: the deck (directive), cues and typed turns (commentary) ----
  const directive = useRef('');
  const sentDirective = useRef('');
  const cues = useRef<Cue[]>([]);
  const inFlight = useRef<Cue | null>(null);
  const cueSeq = useRef(0);
  const pump = useCallback(() => {
    if (!live.current || inFlight.current) return;
    if (directive.current !== sentDirective.current) {
      sentDirective.current = directive.current;
      send({ type: 'causeur.directive.set', directive: directive.current });
    }
    cues.current = cues.current.filter((c) => c.until > Date.now());
    // A typed turn goes before a cue, and at once (it may cut her off: the listener is waiting).
    // A cue waits for a quiet moment: Causeur refuses one while a turn is on.
    const next = cues.current.find((c) => c.typed) ?? cues.current[0];
    if (!next) return;
    if (!next.typed && (voiced.current || Date.now() - quietSince.current < QUIET_FOR_CUE_MS || Date.now() < retryAt.current)) return;
    next.id = `cue-${++cueSeq.current}`;
    inFlight.current = next;
    send({ type: 'session.commentary.append', event_id: next.id, content: next.typed ? TYPED_REPLY + next.text : next.text });
  }, [send]);
  const retryAt = useRef(0);
  const settle = useCallback((id: string, accepted: boolean, retry: boolean) => {
    const cue = inFlight.current;
    if (!cue || cue.id !== id) return;
    inFlight.current = null;
    if (accepted || !retry) cues.current = cues.current.filter((c) => c !== cue);
    else retryAt.current = Date.now() + RETRY_MS;
  }, []);
  useEffect(() => {
    const id = setInterval(pump, 250);
    return () => clearInterval(id);
  }, [pump]);

  // ---- Her voice: played here, or streamed into the face while it is up ----
  const playCtx = useRef<AudioContext | null>(null);
  const playAt = useRef(0);
  const writer = useRef<SpeechWriter | null>(null);
  const writerOpening = useRef(false);
  const play = useCallback((pcm: Int16Array) => {
    const ctx = playCtx.current;
    if (!ctx) return;
    const buffer = ctx.createBuffer(1, pcm.length, RATE);
    const data = buffer.getChannelData(0);
    // The page's own volume for Nova (the stage's audio element, which the mixer and the check-in mute set).
    const gain = faceRef.current.audioRef.current?.volume ?? 1;
    for (let i = 0; i < pcm.length; i++) data[i] = (pcm[i] / 0x8000) * gain;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    playAt.current = Math.max(playAt.current, ctx.currentTime + 0.06);
    source.start(playAt.current);
    playAt.current += buffer.duration;
  }, []);
  const onAudio = useCallback((pcm: Int16Array) => {
    const now = Date.now();
    const loud = rms(pcm) > VOICED_RMS;
    if (loud && !voiced.current) {
      voiced.current = true;
      setSpeaking(true);
      // An utterance goes to the face when it is up as she starts, else it plays here.
      if (faceRef.current.phase === 'live' && !writer.current && !writerOpening.current) {
        writerOpening.current = true;
        void faceRef.current.open().then((w) => { writer.current = w; writerOpening.current = false; });
      }
    }
    if (loud) quietSince.current = now;
    if (voiced.current && !loud && now - quietSince.current > QUIET_END_MS) {
      voiced.current = false;
      setSpeaking(false);
      const w = writer.current;
      writer.current = null;
      void w?.end();
      const text = captionRef.current.trim();
      captionRef.current = '';
      setCaption('');
      if (text) { addLine({ who: 'avatar', text }); handlersRef.current.onAvatarSaid?.(text); }
    }
    if (writer.current || writerOpening.current) {
      if (writer.current) void writer.current.write(to16k(pcm));
    } else play(pcm);
  }, [addLine, play]);

  // ---- Tool calls: run each, then hand back every result and let her go on ----
  const round = useRef<Promise<[string, string]>[]>([]);
  const runTool = useCallback(async (item: { call_id: string; name: string; arguments?: string }): Promise<[string, string]> => {
    let args: Record<string, unknown> = {};
    try { args = item.arguments ? JSON.parse(item.arguments) : {}; } catch { /* the handler checks every value */ }
    try {
      const out = await handlersRef.current.onToolCall?.({ id: item.call_id, name: item.name, arguments: args });
      return [item.call_id, typeof out === 'string' ? out : JSON.stringify(out ?? null)];
    } catch (err) {
      return [item.call_id, `error: ${(err as Error).message}`];
    }
  }, []);

  const onMessage = useCallback(async (raw: string) => {
    const msg = JSON.parse(raw);
    switch (msg.type) {
      case 'session.started':
        live.current = true;
        setPhase('live');
        pump();
        break;
      case 'session.output_audio.delta':
        onAudio(new Int16Array(fromBase64(msg.delta)));
        break;
      case 'session.output_transcript.delta':
        captionRef.current += msg.delta;
        setCaption(captionRef.current);
        break;
      case 'causeur.input_transcript': {
        const text = String(msg.text ?? '').trim();
        if (!msg.final) { setHeard(text); break; }
        setHeard('');
        // A typed turn comes back as a transcript too: shown once, as typed.
        if (!text || text === lastTyped.current) { lastTyped.current = null; break; }
        addLine({ who: 'user', text });
        handlersRef.current.onUserSaid?.(text, 'spoken');
        break;
      }
      case 'session.commentary.appended':
        settle(msg.client_event_id, true, false);
        break;
      case 'response.event': {
        const ev = msg.event ?? {};
        if (ev.type === 'response.output_item.done' && ev.item?.type === 'function_call') round.current.push(runTool(ev.item));
        if (ev.type === 'response.completed') {
          const results = await Promise.all(round.current);
          round.current = [];
          for (const [callId, output] of results) send({ type: 'response.item.create', item: { type: 'function_call_output', call_id: callId, output: output.slice(0, 60_000) } });
          send({ type: 'response.create' });
        }
        break;
      }
      case 'error': {
        const message = String(msg.error?.message ?? '');
        if (msg.error?.client_event_id?.startsWith?.('cue-')) settle(msg.error.client_event_id, false, /between turns/i.test(message));
        else console.warn('[speech] %s', message);
        break;
      }
      case 'session.closed':
        live.current = false;
        setPhase('ended');
        break;
    }
  }, [addLine, onAudio, pump, runTool, send, settle]);

  // ---- The microphone: always sent (speech detection needs the silence), zeros when the button is up ----
  const startMic = useCallback(async (stream: MediaStream | null) => {
    let pending: Int16Array[] = [];
    let count = 0;
    const flush = () => {
      if (!count) return;
      const all = new Int16Array(count);
      let at = 0;
      for (const p of pending) { all.set(p, at); at += p.length; }
      pending = []; count = 0;
      if (!micGate.current) all.fill(0);
      send({ type: 'session.input_audio.append', audio: toBase64(new Uint8Array(all.buffer)) });
    };
    if (stream) {
      stopMic.current = await tapMicrophone(stream, (pcm) => {
        pending.push(pcm); count += pcm.length;
        if (count >= (RATE * SEND_MS) / 1000) flush();
      }, RATE);
    } else {
      silenceTimer.current = setInterval(() => {
        send({ type: 'session.input_audio.append', audio: toBase64(new Uint8Array(new Int16Array((RATE * SEND_MS) / 1000).buffer)) });
      }, SEND_MS);
    }
  }, [send]);

  const cleanup = useCallback(() => {
    live.current = false;
    void stopMic.current?.(); stopMic.current = null;
    if (silenceTimer.current) clearInterval(silenceTimer.current);
    silenceTimer.current = null;
    void playCtx.current?.close(); playCtx.current = null;
    void faceRef.current.end();
  }, []);

  const start = useCallback(async ({ mic = false, micMuted = false }: { mic?: boolean; micMuted?: boolean } = {}) => {
    if (ws.current) return;
    setErrorCode(undefined); setDetail(''); setLines([]); setCaption(''); setHeard('');
    captionRef.current = '';
    setPhase('starting');
    // In the click: the browser lets these make sound.
    playCtx.current = new AudioContext({ sampleRate: RATE });
    void playCtx.current.resume();
    playAt.current = 0;
    let stream: MediaStream | null = null;
    if (mic) {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
      catch { setDetail('No microphone: you can type instead.'); }
    }
    micGate.current = Boolean(stream) && !micMuted;
    setMicOn(micGate.current);
    try {
      const res = await fetch(`/api/apps/${app}/speech`, { method: 'POST' });
      const info = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(info.error || `http_${res.status}`), { code: info.error || `http_${res.status}` });
      session.current = { id: info.sessionId };
      setSecondsLeft(info.maxSeconds ?? null);
      setPhase('connecting');
      const socket = new WebSocket(info.url, ['atmee-live', `atmee-token.${info.token}`]);
      ws.current = socket;
      socket.onopen = () => {
        send({ type: 'session.start', event_id: 'start', session: { model: 'causeur', input_transcript: 'causeur.input_transcript.v1' } });
        setPhase('arriving');
        void startMic(stream);
      };
      socket.onmessage = (e) => { void onMessage(String(e.data)); };
      socket.onclose = () => {
        ws.current = null;
        cleanup();
        setPhase((p) => (p === 'live' || p === 'ended' ? 'ended' : 'failed'));
        if (session.current) void fetch(`/api/apps/${app}/speech/${session.current.id}/end`, { method: 'POST', keepalive: true }).catch(() => {});
        session.current = null;
        handlersRef.current.onEnded?.();
      };
    } catch (err) {
      stream?.getTracks().forEach((t) => t.stop());
      cleanup();
      const code = (err as { code?: string }).code ?? 'failed';
      setErrorCode(code);
      setDetail(code === 'api_key_spend_cap_reached' || code === 'insufficient_credits' ? 'Calls are paused right now. Please try again later.' : 'We could not place the call. Try again in a moment.');
      setPhase('failed');
    }
  }, [app, cleanup, onMessage, send, startMic]);

  const end = useCallback(async () => {
    send({ type: 'session.close' });
    ws.current?.close();
  }, [send]);

  useEffect(() => () => { ws.current?.close(); }, []);
  useEffect(() => {
    if (phase !== 'live' || secondsLeft === null) return;
    const id = setInterval(() => setSecondsLeft((s) => (s === null ? s : Math.max(0, s - 1))), 1000);
    return () => clearInterval(id);
  }, [phase, secondsLeft === null]);

  const typed = useCallback((text: string) => {
    cues.current.push({ text, until: Date.now() + 30_000, typed: true });
    pump();
  }, [pump]);

  return useMemo<SpeechCall>(() => ({
    phase, detail, errorCode, speaking, caption, heard, lines, secondsLeft, micOn,
    audioBlocked: face.audioBlocked, filesAccepted: false,
    videoRef: face.videoRef, audioRef: face.audioRef,
    start, end,
    say(text) {
      lastTyped.current = text;
      addLine({ who: 'user', text, typed: true });
      handlersRef.current.onUserSaid?.(text, 'typed');
      typed(text);
    },
    record(text) { addLine({ who: 'user', text, typed: true }); },
    // A typed turn cuts her off: Causeur takes it as the listener speaking over her.
    interrupt(text) { lastTyped.current = text; typed(text); },
    state(text) { directive.current = text.slice(0, 3900); pump(); },
    note(text) { send({ type: 'session.instructions.append', content: text.slice(0, 3900) }); },
    event(text, ttlS = 10) { cues.current.push({ text: text.slice(0, 3900), until: Date.now() + ttlS * 1000, typed: false }); pump(); },
    mute() {}, unmute() {},
    setMic(on) { micGate.current = on; setMicOn(on); },
    async feedMic() { throw new Error('feedMic is not supported over the speech API'); },
    resumeAudio() { void playCtx.current?.resume(); face.resumeAudio(); },
    async sendFiles() { throw new Error('files are not supported over the speech API'); },
    face: { phase: face.phase, start: face.start, end: face.end },
  }), [phase, detail, errorCode, speaking, caption, heard, lines, secondsLeft, micOn, face, start, end, addLine, typed, pump, send]);
}
