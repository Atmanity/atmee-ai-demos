// Stand-in: the speaker talks, and Remy says it, cleaned up or translated. The microphone streams
// to speech recognition through this app's server; each finished clause goes to /turn for its words
// and its voice, all at once, so a long sentence doesn't wait; the avatar takes the results strictly
// in the order they were spoken. Each row keeps what every step cost, in milliseconds.
import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeTo16k, fromBase64, type AvatarOnly, type MicTap } from '../../../src/kit/index.ts';
import { createClauses } from '../engine/clauses.ts';

const API = '/api/apps/presenter-studio';
const MAX_ROWS = 12;
const FINAL_WAIT_MS = 1_200;      // how long Stop waits for the last words
const ECHO_TAIL_MS = 400;         // how long after Remy stops the room still rings

export interface Settings { language: string; target: string; tone: string; headphones: boolean }

export interface Row {
  id: number;
  heard: string;
  said: string;
  status: 'working' | 'on air' | 'played' | 'cut' | 'dropped' | 'nothing to say';
  /** Each step, ms: speech ended -> heard; the rewrite; the voice; handed over -> the face began. */
  hearMs?: number;
  rewriteMs?: number;
  voiceMs?: number;
  faceMs?: number;
  /** Speech ended -> the face began. */
  totalMs?: number;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

export function useStandIn(face: AvatarOnly, mic: MicTap, settings: Settings) {
  const [on, setOn] = useState(false);
  const [starting, setStarting] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [caption, setCaption] = useState('');
  const [problem, setProblem] = useState('');
  const socket = useRef<WebSocket | null>(null);
  const clauses = useRef(createClauses());
  const nextId = useRef(1);
  const tail = useRef<Promise<void>>(Promise.resolve());   // the clauses, in spoken order
  const take = useRef(0);                                  // bumped by a cut: clauses of an older take are dropped
  const recent = useRef<string[]>([]);
  const audioStart = useRef(0);
  const lastSpeech = useRef(0);                            // the latest word's end, on the page's clock
  const finalDone = useRef<(() => void) | null>(null);
  const speakingUntil = useRef(0);
  const cutAt = useRef(0);                                 // words spoken before this were cut with the rest
  const [micPaused, setMicPaused] = useState(false);
  const live = useRef({ settings, speaking: face.speaking });
  live.current = { settings, speaking: face.speaking };
  useEffect(() => { if (!face.speaking) speakingUntil.current = performance.now() + ECHO_TAIL_MS; }, [face.speaking]);

  const update = useCallback((id: number, change: Partial<Row>) => setRows((all) => all.map((r) => (r.id === id ? { ...r, ...change } : r))), []);

  const send = useCallback((heard: string, spokenEnd: number) => {
    const id = nextId.current++;
    const mine = take.current;
    const hearMs = Math.max(0, Math.round(performance.now() - spokenEnd));
    setRows((all) => [{ id, heard, said: '', status: 'working' as const, hearMs }, ...all].slice(0, MAX_ROWS));
    const { target: chosen, tone, language } = live.current.settings;
    // Speech recognition can write Chinese either way; the speaker who chose 繁體中文 reads it that way.
    const target = chosen === 'same' && language === 'zh-TW' ? 'Traditional Chinese' : chosen;
    const turn = fetch(`${API}/turn`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: heard, target, tone, recent: recent.current }),
    }).then(async (res) => {
      if (!res.ok) throw new Error('turn');
      const json = await res.json();
      update(id, { said: json.said, rewriteMs: json.rewriteMs, voiceMs: json.voiceMs });
      return json as { said: string; clip?: string };
    });
    recent.current = [...recent.current, heard].slice(-3);

    tail.current = tail.current.then(async () => {
      try {
        const { said, clip } = await turn;
        if (mine !== take.current) return update(id, { status: 'cut' });
        if (!said || !clip) return update(id, { status: 'nothing to say' });
        const pcm = await decodeTo16k(fromBase64(clip));
        if (mine !== take.current) return update(id, { status: 'cut' });
        const handed = performance.now();
        const writer = await face.open();
        if (!writer) return update(id, { status: 'dropped' });
        await writer.write(pcm);
        void writer.started?.then(() => {
          const at = performance.now();
          update(id, { status: 'on air', faceMs: Math.round(at - handed), totalMs: Math.round(at - spokenEnd) });
        });
        // Handed over, not played: the avatar plays its pieces in order, so the next clause needn't wait.
        void writer.end().then((played) => update(id, { status: played.interrupted ? 'cut' : 'played' }));
      } catch {
        update(id, { status: 'dropped' });
      }
    });
  }, [face, update]);

  const release = useCallback((text: string, ended: boolean, at: number) => {
    for (const clause of clauses.current.feed(text, ended)) send(clause, at);
  }, [send]);

  const stop = useCallback(async () => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        finalDone.current = resolve;
        ws.send('finalize');
        setTimeout(resolve, FINAL_WAIT_MS);
      });
    }
    finalDone.current = null;
    socket.current = null;
    await mic.stop();
    ws?.close();
    for (const clause of clauses.current.flush()) send(clause, lastSpeech.current || performance.now());
    setCaption('');
    setOn(false);
  }, [mic, send]);

  const start = useCallback(async () => {
    if (socket.current || starting) return;
    setProblem('');
    setStarting(true);
    clauses.current = createClauses({ wholeSentences: live.current.settings.target !== 'same' });
    recent.current = [];
    audioStart.current = 0;
    lastSpeech.current = 0;
    cutAt.current = 0;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}${API}/socket?language=${encodeURIComponent(live.current.settings.language)}`);
    ws.binaryType = 'arraybuffer';
    socket.current = ws;

    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === 'lost') return setProblem('Speech recognition dropped. Start again.');
      if (message.type === 'ended') { release('', true, lastSpeech.current || performance.now()); return; }
      if (message.type !== 'heard') return;
      if (!message.final) return setCaption(message.text);
      setCaption('');
      const spokenEnd = audioStart.current + message.at * 1000;
      if (message.text) lastSpeech.current = spokenEnd;
      // Heard after the Cut, but said before it: cut with the rest.
      if (spokenEnd <= cutAt.current) { clauses.current.flush(); if (message.ended) finalDone.current?.(); return; }
      release(message.text, message.ended, lastSpeech.current || performance.now());
      if (message.ended) finalDone.current?.();
    };
    ws.onclose = () => {
      if (socket.current !== ws) return;
      socket.current = null;
      void mic.stop();
      setOn(false);
      setCaption('');
    };

    const opened = await new Promise<boolean>((resolve) => {
      ws.addEventListener('open', () => resolve(true), { once: true });
      ws.addEventListener('error', () => resolve(false), { once: true });
    });
    if (!opened || socket.current !== ws) {
      setStarting(false);
      if (!opened) { socket.current = null; setProblem('Could not reach speech recognition.'); }
      return;
    }
    const ok = await mic.begin((pcm) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (!audioStart.current) audioStart.current = performance.now();
      // Without headphones the microphone hears Remy, who would then be restated in turn. Silence in
      // place of the audio keeps speech recognition's clock on time.
      const deaf = !live.current.settings.headphones && (live.current.speaking || performance.now() < speakingUntil.current);
      setMicPaused(deaf);
      ws.send(deaf ? new Int16Array(pcm.length) : pcm);
    });
    setStarting(false);
    if (ok) setOn(true);
    else { socket.current = null; ws.close(); }
  }, [mic, release, starting]);

  /** Cuts what Remy is saying, and every clause still on its way. */
  const cut = useCallback(async () => {
    take.current++;
    cutAt.current = performance.now();
    clauses.current.flush();
    await face.interrupt();
  }, [face]);

  // The studio closing ends the stand-in with it.
  useEffect(() => { if (face.phase !== 'live' && socket.current) void stop(); }, [face.phase, stop]);
  useEffect(() => () => { socket.current?.close(); }, []);

  /** Clauses said but not yet on air: translated speech can run longer than the speech, and this grows. */
  const behind = rows.filter((r) => r.status === 'working').length;

  return { on, starting, rows, caption, problem, micPaused: on && micPaused, behind, start, stop, cut };
}
