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
//   server -> page  session.started, session.output_transcript.delta, causeur.input_transcript,
//                   response.event (function calls), session.closed, error, and her voice: under
//                   playback control (asked for in session.start) each reply as deliveries
//                   (causeur.playback.start/audio/end/clear, then transcript_end), as fast as it is
//                   made, acknowledged with causeur.playback.ack; from a server without it,
//                   session.output_audio.delta (20 ms, in real time, silence too).
//
// Under playback control a delivery plays in one place for its whole length, decided as it opens:
// through the face while it is up, else in the page. Whether she is talking comes from the
// deliveries (voice-state.ts), since her audio arrives seconds ahead of its playing.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Avatar, AvatarHandlers, Line } from '../../../src/kit/index.ts';
import { fromBase64, Resampler24to16, tapMicrophone, toBase64 } from '../../../src/kit/index.ts';
import { useAvatarOnly } from '../../../src/kit/useAvatarOnly.ts';
import type { SpeechWriter } from '../../../src/avatar/render.ts';
import { FaceDelivery } from '../../../src/speech/face.ts';
import { PLAYBACK_CONTROL, playbackAck, refusedPlaybackControl, type Delivery } from '../../../src/speech/protocol.ts';
import { createVoicePlayer, type VoicePlayer } from './audio.ts';
import { Talking, cueMayGo, deliveryOutput, retryAfter } from './voice-state.ts';

const RATE = 24_000;
/** Mic audio goes out in pieces this long. */
const SEND_MS = 100;
/** Loud enough to be speech (16-bit RMS), and how long a quiet spell ends an utterance. */
const VOICED_RMS = 250;
const QUIET_END_MS = 700;
/** Causeur reads a commentary that starts with this as the user typing (causeur/live/envelope.py). */
const TYPED_REPLY = "Reply to the caller now, don't repeat what they said. Do not wait for the caller to speak first. After that, pause and listen.\n\n";
/** How long the show waits for the face before it goes on by voice alone. */
const FACE_START_TIMEOUT_MS = 25_000;
/** A refused cue is tried again this often, while it is still worth saying, and only once she has been quiet this long. */

interface Cue { text: string; until: number; typed: boolean; id?: string; refused?: boolean }

/**
 * One delivery and where it plays. `pending`: it was meant for the face, whose writer is still
 * opening; its audio, its end and a clear wait here, and go to the page if the face cannot take it.
 */
interface Route {
  delivery: Delivery;
  output: 'face' | 'page' | 'pending';
  face?: FaceDelivery;
  held: Int16Array[];
  ended: boolean;
  cleared: boolean;
}

const rms = (pcm: Int16Array) => {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / Math.max(1, pcm.length));
};

export interface SpeechCall extends Avatar {
  /** The face, rendered on demand. */
  face: { phase: Avatar['phase']; speaking: boolean; start(): Promise<void>; end(): Promise<void> };
  /** The face did not come up in time as the show began: the show is voice only. */
  faceOff: boolean;
  /** Where the utterance in progress plays: through the face (lips in sync) or in the page (voice only). */
  voiceVia: 'face' | 'page' | null;
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
  const [faceOff, setFaceOff] = useState(false);
  const faceOffRef = useRef(false);
  const [voiceVia, setVoiceVia] = useState<'face' | 'page' | null>(null);
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
  // The microphone itself, released on hangup (stopping the tap alone leaves the tab holding the mic).
  const micStream = useRef<MediaStream | null>(null);
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
  const sessionStart = useCallback((eventId: string) => send({ type: 'session.start', event_id: eventId, session: {
    model: 'causeur', input_transcript: 'causeur.input_transcript.v1',
    ...(askedForControl.current ? { playback_control: PLAYBACK_CONTROL } : {}),
  } }), [send]);

  // Whether she is speaking now, and since when she has been quiet: from her voice's loudness on
  // the paced stream, from the deliveries under playback control.
  const quietSince = useRef(0);
  const voiced = useRef(false);
  // Playback control: asked for when her voice can play at its own rate, in use once the server says so.
  const askedForControl = useRef(false);
  const controlled = useRef(false);
  const talking = useRef(new Talking());
  const routes = useRef(new Map<number, Route>());

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
    // A typed turn goes before a cue (cueMayGo says when each may go: Causeur refuses either while she speaks).
    const next = cues.current.find((c) => c.typed) ?? cues.current[0];
    if (!next) return;
    const now = Date.now();
    if (!cueMayGo(next, { talking: voiced.current, quietForMs: now - quietSince.current, now, retryAt: retryAt.current })) return;
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
    else {
      cue.refused = true;
      retryAt.current = retryAfter(cue, Date.now());
    }
  }, []);
  useEffect(() => {
    const id = setInterval(pump, 250);
    return () => clearInterval(id);
  }, [pump]);

  // ---- Her voice: played here, or streamed into the face while it is up ----
  const playCtx = useRef<AudioContext | null>(null);
  // Her voice in the page: a continuous player with a jitter buffer (audio.ts).
  const player = useRef<VoicePlayer | null>(null);
  // The face's audio, resampled to 16 kHz without aliasing; one per utterance it takes.
  const resampler = useRef<Resampler24to16 | null>(null);
  const writer = useRef<SpeechWriter | null>(null);
  const writerOpening = useRef(false);
  const play = useCallback((pcm: Int16Array, silent: boolean) => {
    const p = player.current;
    if (!p) return;
    // The page's own volume for Nova (the stage's audio element, which the mixer and the check-in mute set), ramped in the player.
    p.setGain(faceRef.current.audioRef.current?.volume ?? 1);
    p.push(pcm, silent);
  }, []);
  // Her words held while a face writer opens, and where they go if it cannot open: here, at once.
  const heldForFace = useRef<Int16Array[]>([]);
  const toPage = useCallback((why: string) => {
    writerOpening.current = false;
    console.warn('[speech] the face would not take her words (%s): they play here', why);
    setVoiceVia(voiced.current ? 'page' : null);
    for (const held of heldForFace.current) play(held, false);
    heldForFace.current = [];
  }, [play]);

  // ---- Under playback control: each delivery to its one output, and her talking from them ----
  const playbackStarted = useCallback((id: number) => {
    if (!talking.current.started(id)) return;
    voiced.current = true;
    setSpeaking(true);
  }, []);
  const playbackFinished = useCallback((id: number) => {
    if (!talking.current.finished(id)) return;
    voiced.current = false;
    quietSince.current = Date.now();
    setSpeaking(false);
    setVoiceVia(null);
  }, []);
  // What the page's player reports goes to the server, and says when she talks.
  const onReport = useCallback((report: { started: number } | { finished: number; played: number; interrupted: boolean }) => {
    const id = 'started' in report ? report.started : report.finished;
    const route = routes.current.get(id);
    if (!route || route.output !== 'page') return;
    if ('started' in report) {
      send(playbackAck(route.delivery, { status: 'started' }));
      playbackStarted(id);
      return;
    }
    send(playbackAck(route.delivery, { status: 'finished', played_samples: report.played, interrupted: report.interrupted }));
    playbackFinished(id);
  }, [send, playbackStarted, playbackFinished]);
  const toPageRoute = useCallback((route: Route, why?: string) => {
    const id = route.delivery.delivery_id;
    if (why) console.warn('[speech] the face would not take her words (%s): they play here', why);
    route.output = 'page';
    setVoiceVia('page');
    player.current?.open(id);
    for (const pcm of route.held) player.current?.deliver(id, pcm);
    route.held = [];
    if (route.ended) player.current?.end(id);
    if (route.cleared) player.current?.clear(id);
  }, []);
  const toFaceRoute = useCallback((route: Route, writer: SpeechWriter) => {
    const id = route.delivery.delivery_id;
    route.output = 'face';
    route.face = new FaceDelivery({ open: async () => writer, interrupt: () => faceRef.current.interrupt() }, route.delivery, (event) => {
      send(event);
      if (event.status === 'finished') playbackFinished(id);
    });
    for (const pcm of route.held) route.face.push(pcm);
    route.held = [];
    if (route.ended) route.face.end();
    if (route.cleared) void route.face.clear();
    // The face is playing her words already: its start, reported for the server, comes with its speaking.
    if (faceRef.current.speaking) route.face.started();
  }, [send, playbackFinished]);
  const onDelivery = useCallback((msg: Record<string, any>) => {
    const id = msg.delivery_id;
    if (!Number.isInteger(id)) return;
    let route = routes.current.get(id);
    if (msg.type === 'causeur.playback.start') {
      if (!Number.isInteger(msg.start_sample)) return;
      for (const old of routes.current.keys()) if (old < id - 4) routes.current.delete(old);
      route = { delivery: { delivery_id: id, playback_id: msg.playback_id, start_sample: msg.start_sample }, output: 'page', held: [], ended: false, cleared: false };
      routes.current.set(id, route);
      if (deliveryOutput(faceRef.current.phase, faceOffRef.current) === 'face') {
        route.output = 'pending';
        setVoiceVia('face');
        console.info('[speech] her words go to the face');
        // She talks once the face has her words; the server is told the face began with its speaking.
        playbackStarted(id);
        const pending = route;
        void faceRef.current.open().then(
          (w) => (w ? toFaceRoute(pending, w) : toPageRoute(pending, 'the face is gone')),
          (err) => toPageRoute(pending, (err as Error).message));
      } else {
        console.info('[speech] her words play here (face %s)', faceRef.current.phase);
        toPageRoute(route);
      }
      return;
    }
    if (!route) return;
    if (msg.type === 'causeur.playback.audio') {
      if (typeof msg.delta !== 'string') return;
      const pcm = new Int16Array(fromBase64(msg.delta));
      if (route.output === 'pending') route.held.push(pcm);
      else if (route.output === 'face') route.face?.push(pcm);
      else player.current?.deliver(id, pcm);
    } else if (msg.type === 'causeur.playback.end') {
      route.ended = true;
      if (route.output === 'face') route.face?.end();
      else if (route.output === 'page') player.current?.end(id);
    } else if (msg.type === 'causeur.playback.clear') {
      route.cleared = true;
      if (route.output === 'face') void route.face?.clear();
      else if (route.output === 'page') player.current?.clear(id);
    }
  }, [playbackStarted, toFaceRoute, toPageRoute]);
  // The face's own start, for the delivery it is playing.
  useEffect(() => {
    if (!face.speaking) return;
    for (const route of routes.current.values()) if (route.output === 'face') route.face?.started();
  }, [face.speaking]);
  // A reply's words are all said (its transcript is over): its line is closed.
  const closeLine = useCallback(() => {
    const text = captionRef.current.trim();
    captionRef.current = '';
    setCaption('');
    if (text) { addLine({ who: 'avatar', text }); handlersRef.current.onAvatarSaid?.(text); }
  }, [addLine]);

  const onAudio = useCallback((pcm: Int16Array) => {
    const now = Date.now();
    const loud = rms(pcm) > VOICED_RMS;
    if (loud && !voiced.current) {
      voiced.current = true;
      setSpeaking(true);
      // An utterance goes to the face when it is up as she starts, else it plays here.
      if (faceRef.current.phase === 'live' && !faceOffRef.current && !writer.current && !writerOpening.current) {
        writerOpening.current = true;
        heldForFace.current = [];
        setVoiceVia('face');
        console.info('[speech] her words go to the face');
        resampler.current = new Resampler24to16();
        void faceRef.current.open().then((w) => {
          writerOpening.current = false;
          if (!w) return toPage('the face is gone');
          writer.current = w;
          // What came while it opened goes first: nothing of her words is dropped.
          for (const held of heldForFace.current) { const pcm16 = resampler.current?.push(held); if (pcm16?.length) void w.write(pcm16); }
          heldForFace.current = [];
          // An utterance that ended while the face opened is closed now.
          if (!voiced.current) { writer.current = null; void w.end(); }
        }, (err) => toPage((err as Error).message));
      } else if (!writer.current) {
        setVoiceVia('page');
        console.info('[speech] her words play here (face %s)', faceRef.current.phase);
      }
    }
    if (loud) quietSince.current = now;
    if (voiced.current && !loud && now - quietSince.current > QUIET_END_MS) {
      voiced.current = false;
      setSpeaking(false);
      setVoiceVia(null);
      const w = writer.current;
      writer.current = null;
      void w?.end();
      const text = captionRef.current.trim();
      captionRef.current = '';
      setCaption('');
      if (text) { addLine({ who: 'avatar', text }); handlersRef.current.onAvatarSaid?.(text); }
    }
    if (writer.current) {
      const pcm16 = resampler.current?.push(pcm);
      if (pcm16?.length) void writer.current.write(pcm16);
    } else if (writerOpening.current) heldForFace.current.push(pcm);
    else play(pcm, !loud && !voiced.current);
  }, [addLine, play, toPage]);

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
        controlled.current = msg.session?.playback_control === PLAYBACK_CONTROL;
        console.info('[speech] voice %s', controlled.current ? 'under playback control (held whole, acknowledged)' : 'paced');
        live.current = true;
        setPhase('live');
        pump();
        break;
      case 'session.output_audio.delta':
        onAudio(new Int16Array(fromBase64(msg.delta)));
        break;
      case 'causeur.playback.start':
      case 'causeur.playback.audio':
      case 'causeur.playback.end':
      case 'causeur.playback.clear':
        onDelivery(msg);
        break;
      case 'causeur.playback.transcript_end':
        closeLine();
        break;
      case 'session.output_transcript.delta':
        captionRef.current += msg.delta;
        setCaption(captionRef.current);
        break;
      case 'causeur.input_transcript': {
        // Causeur tags what was said over her ([interruption]) or as a backchannel: not the listener's words.
        const text = String(msg.text ?? '').replace(/\[(?:interruption|backchannel)\]\s*/gi, '').trim();
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
        // A server without playback control refused the start for asking: the same socket starts it paced.
        if (!live.current && msg.error?.client_event_id === 'start' && askedForControl.current && refusedPlaybackControl(message)) {
          askedForControl.current = false;
          sessionStart('start-paced');
          break;
        }
        if (msg.error?.client_event_id?.startsWith?.('cue-')) settle(msg.error.client_event_id, false, /between turns/i.test(message));
        else console.warn('[speech] %s', message);
        break;
      }
      case 'session.closed':
        live.current = false;
        setPhase('ended');
        break;
    }
  }, [addLine, closeLine, onAudio, onDelivery, pump, runTool, send, sessionStart, settle]);

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
    micStream.current?.getTracks().forEach((t) => t.stop()); micStream.current = null;
    if (silenceTimer.current) clearInterval(silenceTimer.current);
    silenceTimer.current = null;
    void player.current?.close(); player.current = null;
    routes.current.clear();
    void playCtx.current?.close(); playCtx.current = null;
    void faceRef.current.end();
  }, []);

  const start = useCallback(async ({ mic = false, micMuted = false }: { mic?: boolean; micMuted?: boolean } = {}) => {
    if (ws.current) return;
    setErrorCode(undefined); setDetail(''); setLines([]); setCaption(''); setHeard('');
    captionRef.current = '';
    setPhase('starting');
    // In the click: the browser lets these make sound.
    playCtx.current = new AudioContext({ sampleRate: RATE, latencyHint: 'playback' });
    void playCtx.current.resume();
    player.current = await createVoicePlayer(playCtx.current).catch((err) => {
      console.warn('[speech] the voice player could not start: %s', (err as Error).message);
      return null;
    });
    // Playback control counts her samples: only when they play at their own rate.
    askedForControl.current = Boolean(player.current) && playCtx.current.sampleRate === RATE;
    controlled.current = false;
    talking.current = new Talking();
    routes.current.clear();
    if (player.current) player.current.onReport = onReport;
    let stream: MediaStream | null = null;
    if (mic) {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
      catch { setDetail('No microphone: you can type instead.'); }
    }
    micStream.current = stream;
    micGate.current = Boolean(stream) && !micMuted;
    setMicOn(micGate.current);
    // The face first, so her greeting comes through it. One not up in time does not hold the show:
    // she goes on by voice, and the face takes over her words from the moment it is up.
    faceOffRef.current = false;
    setFaceOff(false);
    const facing = faceRef.current.start();
    const late = await Promise.race([facing.then(() => false), new Promise<boolean>((r) => setTimeout(r, FACE_START_TIMEOUT_MS, true))]);
    if (late) {
      faceOffRef.current = true;
      setFaceOff(true);
      console.info('[speech] the face is not up yet: voice only until it is');
      void facing.then(() => {
        faceOffRef.current = false;
        setFaceOff(false);
        console.info('[speech] the face is up: her words go to it from now on');
      });
    }
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
        sessionStart('start');
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
  }, [app, cleanup, onMessage, onReport, send, sessionStart, startMic]);

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
    // A typed turn while she speaks waits for her to finish: Causeur refuses one mid-reply.
    interrupt(text) { lastTyped.current = text; typed(text); },
    state(text) { directive.current = text.slice(0, 3900); pump(); },
    note(text) { send({ type: 'session.instructions.append', content: text.slice(0, 3900) }); },
    event(text, ttlS = 10) { cues.current.push({ text: text.slice(0, 3900), until: Date.now() + ttlS * 1000, typed: false }); pump(); },
    mute() {}, unmute() {},
    setMic(on) { micGate.current = on; setMicOn(on); },
    async feedMic() { throw new Error('feedMic is not supported over the speech API'); },
    resumeAudio() { void playCtx.current?.resume(); face.resumeAudio(); },
    async sendFiles() { throw new Error('files are not supported over the speech API'); },
    face: { phase: face.phase, speaking: face.speaking, start: face.start, end: face.end },
    faceOff, voiceVia,
  }), [phase, detail, errorCode, speaking, caption, heard, lines, secondsLeft, micOn, face, faceOff, voiceVia, start, end, addLine, typed, pump, send]);
}
