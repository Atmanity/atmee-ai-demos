// Last Seen: the whole film is your phone. Mia's voicemail, two live video calls, a map, a choice.
//
// The phone hides every limit of the live avatar: the call rings while it connects (Answer lights
// once the face is ready), one face fills a video call, and a dark or stalled picture reads as a
// poor connection. Each call connects hidden while the screen before it plays, with your
// microphone closed; Answer opens it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { MicIcon, useAvatar, type ToolCall } from '../../../src/kit/index.ts';
import './phone.css';

const API = '/api/apps/last-seen';
type Caller = 'theo' | 'jonah';
type Destination = 'bridge' | 'party';
interface Person { name: string; where: string; chips: [string[], string[]] }
interface Clue { from: string; text: string; media?: string; lie: string; truth: string }
interface Film { ready: boolean; cast: Record<Caller, boolean>; people: Record<Caller, Person>; evidence: Record<Caller, Clue>; mia: Record<string, string> }
interface Outcome { video: string; title: string; line: string; truths: number; found: string[] }
type Scene =
  | { kind: 'door' } | { kind: 'loading' }
  | { kind: 'message'; video: string; label: string }
  | { kind: 'ringing'; who: Caller } | { kind: 'call'; who: Caller }
  | { kind: 'between' } | { kind: 'decide' } | { kind: 'end' };

// A call: evidence lands at EVIDENCE_S, the caller wraps up from WRAP_S, the call ends after their
// next line, and never past HARD_S (+10 s to finish a sentence).
const EVIDENCE_S = 14;
const WRAP_S = 46;
const END_AFTER_S = 50;
const HARD_S = 60;
const QUIET_MS = 7000;
const READY_TIMEOUT_MS = 75_000;
const MIN_RING_MS = 2500;
const BETWEEN_MIN_MS = 14000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const timeline: { at: number; what: string }[] = [];
const mark = (what: string) => { timeline.push({ at: Math.round(performance.now()), what }); };
if (typeof window !== 'undefined') Object.assign(window, { __lastseen: timeline });
async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}
const clockOf = (min: number) => `${Math.floor(min / 60) % 12 || 12}:${String(min % 60).padStart(2, '0')}`;

/** How hard each phone shakes: Theo sits in a car, Mia sits on a bridge, Jonah stands at a party, drunk. */
const SHAKE: Record<string, number> = { theo: 1, mia: 1.2, jonah: 1.7 };

/**
 * A phone held at arm's length: slow drift of the arm, a faint hand tremor, and now and then a
 * jolt that settles like a spring (a shifted grip). Under a small zoom so the edges never show.
 */
function useHandheld(ref: React.RefObject<HTMLDivElement | null>, strength: React.RefObject<number>) {
  useEffect(() => {
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let id = 0, jolt = { at: -99, x: 0, y: 0, r: 0 }, next = 4;
    const wave = (t: number, f: number[], p: number[]) => f.reduce((sum, k, i) => sum + Math.sin(t * k + p[i]) / (i + 1), 0);
    const tick = (ms: number) => {
      const t = ms / 1000, k = strength.current;
      if (t > next) { jolt = { at: t, x: (Math.random() - 0.5) * 2.4, y: (Math.random() - 0.3) * 2.2, r: (Math.random() - 0.5) * 2 }; next = t + 5 + Math.random() * 7; }
      const since = t - jolt.at, spring = since < 2.5 ? Math.exp(-since * 3) * Math.cos(since * 11) : 0;
      const x = k * (0.55 * wave(t, [0.43, 1.1, 2.7], [0, 1.7, 0.4]) + 0.06 * Math.sin(t * 47) + jolt.x * spring);
      const y = k * (0.5 * wave(t, [0.37, 0.95, 3.1], [2.1, 0.3, 1.1]) + 0.06 * Math.sin(t * 53 + 1) + jolt.y * spring);
      const r = k * (0.35 * wave(t, [0.29, 0.83], [0.9, 2.4]) + jolt.r * spring);
      if (ref.current) ref.current.style.transform = k ? `translate(${x.toFixed(3)}%, ${y.toFixed(3)}%) rotate(${r.toFixed(3)}deg) scale(1.08)` : 'none';
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [ref, strength]);
}

export function App() {
  const [scene, setScene] = useState<Scene>({ kind: 'door' });
  const [film, setFilm] = useState<Film | null>(null);
  const [problem, setProblem] = useState('');
  const [loaded, setLoaded] = useState(0);
  const [runId, setRunId] = useState('');
  const [who, setWho] = useState<Caller>('theo');
  const [minute, setMinute] = useState(72);           // 1:12 a.m.
  const [answerable, setAnswerable] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [banner, setBanner] = useState<Clue | null>(null);
  const [shown, setShown] = useState<Partial<Record<Caller, true>>>({});
  const [pip, setPip] = useState('');
  const [poor, setPoor] = useState(false);
  const [texts, setTexts] = useState<{ from: string; text: string }[]>([]);
  const [typing, setTyping] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [caption, setCaption] = useState('');
  const [parentSpoke, setParentSpoke] = useState(false);
  const spoke = useRef(false);
  const [startAsk, setStartAsk] = useState(0);
  const [, setTick] = useState(0);

  const urls = useRef<Record<string, string>>({});
  const run = useRef('');
  const wantStart = useRef<Caller | null>(null);
  const answered = useRef<() => void>(() => {});
  const chosen = useRef<(d: Destination) => void>(() => {});
  const showNow = useRef<() => void>(() => {});
  const hungUp = useRef(false);
  const ended = useRef(false);
  const revealed = useRef(false);
  const captionAt = useRef(0);
  const samAt = useRef(0);
  const player = useRef<HTMLVideoElement>(null);
  const pipPlayer = useRef<HTMLVideoElement>(null);
  const selfView = useRef<HTMLVideoElement>(null);
  const camera = useRef<MediaStream | null>(null);
  const ring = useRef<HTMLAudioElement>(null);
  const ding = useRef<HTMLAudioElement>(null);
  const debug = typeof location !== 'undefined' && location.search.includes('debug');
  // The caller's phone is in their hand: the picture moves with it.
  const lens = useRef<HTMLDivElement>(null);
  const shake = useRef(0);
  useHandheld(lens, shake);

  const onUserSaid = useCallback((text: string) => {
    if (debug) console.log('[lastseen] sam:', revealed.current ? 'heard' : 'hidden', text);
    if (revealed.current) samAt.current = Date.now();
  }, [debug]);
  // Once the caller has spoken after being shown the proof, the confession is said: stop repeating it.
  const told = useRef<{ state: string; said: RegExp } | null>(null);
  const onAvatarSaid = useCallback((text: string) => {
    if (debug) console.log('[lastseen] caller:', revealed.current ? 'heard' : 'hidden', text);
    if (revealed.current && told.current && told.current.said.test(text)) { avatarRef.current.state(told.current.state); told.current = null; }
  }, [debug]);
  const onEnded = useCallback(() => { ended.current = true; }, []);
  const onToolCall = useCallback(({ name, arguments: args }: ToolCall) => {
    if (name === 'admitted') {
      void post(`/run/${run.current}/${whoRef.current}/admitted`, { what: String(args.what ?? '') });
      if (told.current) { avatarRef.current.state(told.current.state); told.current = null; }
    }
    return 'Noted.';
  }, []);
  const whoRef = useRef<Caller>('theo');
  whoRef.current = who;

  const avatar = useAvatar(runId ? `last-seen/run/${runId}/${who}` : 'last-seen', { onUserSaid, onAvatarSaid, onEnded, onToolCall });
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;

  // ---- calls: connect hidden, reveal on Answer

  useEffect(() => {
    if (!runId || wantStart.current !== who) return;
    wantStart.current = null;
    const a = avatarRef.current;
    if (a.audioRef.current) a.audioRef.current.volume = 0;
    void a.start({ mic: true, micMuted: true });
  }, [who, runId, startAsk]);
  useEffect(() => { if (!revealed.current && avatar.audioRef.current) avatar.audioRef.current.volume = 0; }, [avatar.phase, avatar.audioRef]);
  useEffect(() => { if (runId) mark(`call ${who} ${avatar.phase}`); }, [runId, who, avatar.phase]);
  useEffect(() => { if (avatar.caption) captionAt.current = Date.now(); }, [avatar.caption]);
  useEffect(() => { if (revealed.current && (avatar.speaking || avatar.caption)) { spoke.current = true; setParentSpoke(true); } }, [avatar.speaking, avatar.caption]);
  useEffect(() => {
    if (scene.kind !== 'call') return;
    const id = setInterval(() => setTick((n) => n + 1), 300);
    return () => clearInterval(id);
  }, [scene.kind]);

  const warm = (p: Caller) => { mark(`connect ${p}`); wantStart.current = p; setWho(p); setStartAsk((n) => n + 1); };
  const isReady = () => avatarRef.current.phase === 'live' && (avatarRef.current.videoRef.current?.videoWidth ?? 0) > 0;
  const talkingNow = () => avatarRef.current.speaking || Date.now() - captionAt.current < 1500;
  const hangUp = async () => {
    await avatarRef.current.end();
    for (let i = 0; i < 20 && avatarRef.current.phase === 'live'; i++) await sleep(100);
    await post(`/run/${run.current}/end-all`).catch(() => {});
  };

  // The clock moves a minute every 40 s, as it would on a long night.
  useEffect(() => {
    if (scene.kind === 'door' || scene.kind === 'loading' || scene.kind === 'end') return;
    const id = setInterval(() => setMinute((m) => m + 1), 40000);
    return () => clearInterval(id);
  }, [scene.kind]);

  // A closing tab must not keep the line busy for the next viewer.
  useEffect(() => {
    const bye = () => { if (run.current) navigator.sendBeacon(`${API}/run/${run.current}/end-all`); };
    addEventListener('pagehide', bye);
    return () => removeEventListener('pagehide', bye);
  }, []);

  // For tests: `?script` lets a driver speak Sam's lines as text and press the buttons.
  useEffect(() => {
    if (location.search.includes('script')) Object.assign(window, { __say: (t: string) => avatarRef.current.say(t) });
  }, []);

  useEffect(() => {
    fetch(`${API}/film`).then((r) => r.json()).then((f: Film) => {
      setFilm(f);
      if (!f.ready) setProblem('The film is still being made. Try again in a moment.');
      else if (!f.cast.theo || !f.cast.jonah) setProblem("Theo and Jonah aren't on this server yet.");
    }).catch(() => setProblem('The film did not load. Try again in a moment.'));
  }, []);

  /** A pre-rendered video on the phone (Mia's messages); resolves when it ends. */
  const playVideo = async (id: string, label: string) => {
    setScene({ kind: 'message', video: id, label });
    setCaption(film!.mia[id] ?? '');
    await sleep(50);
    const v = player.current!;
    v.src = urls.current[id];
    v.currentTime = 0;
    const done = new Promise<void>((r) => { v.onended = () => r(); });
    await v.play().catch(() => {});
    mark(`video ${id}`);
    await done;
    setCaption('');
  };

  const sound = (el: HTMLAudioElement | null, on: boolean) => {
    if (!el) return;
    if (on) { el.currentTime = 0; void el.play().catch(() => {}); } else el.pause();
  };

  /** One call: ring until the face is ready and Sam answers, then the live scene. */
  const call = async (p: Caller) => {
    setScene({ kind: 'ringing', who: p });
    setAnswerable(false);
    sound(ring.current, true);
    mark(`ringing ${p}`);
    const rangAt = Date.now();
    const until = Date.now() + READY_TIMEOUT_MS;
    while ((!isReady() || Date.now() - rangAt < MIN_RING_MS) && avatarRef.current.phase !== 'failed' && Date.now() < until) await sleep(150);
    if (!isReady()) {
      sound(ring.current, false);
      mark(`missed ${p}`);
      setTexts((t) => [...t, { from: film!.people[p].name, text: 'Missed video call' }]);
      void avatarRef.current.end();
      return;
    }
    setAnswerable(true);
    await new Promise<void>((r) => { answered.current = r; });
    sound(ring.current, false);

    const cue = await (await fetch(`${API}/run/${run.current}/${p}/cue`)).json();
    const a = avatarRef.current;
    revealed.current = true;
    hungUp.current = false;
    ended.current = false;
    spoke.current = false;
    setParentSpoke(false);
    setSeconds(0);
    setBanner(null);
    setScene({ kind: 'call', who: p });
    if (a.audioRef.current) a.audioRef.current.volume = 1;
    a.setMic(true);
    a.event(cue.opening, 20);
    mark(`live ${p}`);
    samAt.current = Date.now();

    const at = Date.now();
    let wrapped = false, landed = false, wasShown = false, quietSent = 0;
    showNow.current = () => {
      if (wasShown) return;
      wasShown = true;
      mark(`shown ${p}`);
      setBanner(null);
      setShown((s) => ({ ...s, [p]: true }));
      void post(`/run/${run.current}/${p}/shown`);
      avatarRef.current.state(cue.shownState);
      avatarRef.current.event(cue.shownEvent, 15);
      told.current = { state: cue.toldState, said: new RegExp(cue.said, 'i') };
      const media = film!.evidence[p].media;
      if (media) setPip(media);
    };
    const probe = document.createElement('canvas');
    probe.width = 9; probe.height = 16;
    const brightness = () => {
      const v = avatarRef.current.videoRef.current;
      const ctx = probe.getContext('2d', { willReadFrequently: true });
      if (!v || !ctx || !v.videoWidth) return 255;
      ctx.drawImage(v, 0, 0, 9, 16);
      const d = ctx.getImageData(0, 0, 9, 16).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      return sum / (d.length / 4);
    };
    let dark = 0;
    for (;;) {
      await sleep(250);
      const s = (Date.now() - at) / 1000;
      setSeconds(Math.floor(s));
      if (ended.current || hungUp.current) break;
      // A dark or frozen picture reads as the line breaking up.
      dark = brightness() < 24 ? dark + 1 : 0;
      setPoor(dark >= 2);
      if (!landed && s >= EVIDENCE_S) { landed = true; mark(`evidence ${p}`); sound(ding.current, true); setBanner(film!.evidence[p]); }
      // Sam has gone quiet on their turn: the caller moves the scene on with something new.
      if (!talkingNow() && spoke.current && Date.now() - samAt.current > QUIET_MS && Date.now() - quietSent > 15000 && !avatarRef.current.heard) {
        quietSent = Date.now(); avatarRef.current.event(cue.quiet, 10);
      }
      if (!wrapped && s >= WRAP_S) { wrapped = true; avatarRef.current.state(cue.wrap); }
      const quiet = !talkingNow();
      if ((s >= END_AFTER_S && wrapped && quiet) || (s >= HARD_S && quiet) || s >= HARD_S + 10) break;
    }
    avatarRef.current.setMic(false);
    const audio = avatarRef.current.audioRef.current;
    for (let i = 10; i >= 0 && audio; i--) { audio.volume = i / 10; await sleep(30); }
    revealed.current = false;
    told.current = null;
    setBanner(null); setPip(''); setPoor(false);
    mark(`hung up ${p}`);
  };

  const playFilm = useCallback(async () => {
    const f = film!;
    // Mia's voicemail, while Theo's call connects behind it.
    warm('theo');
    await sleep(1800);
    await playVideo('m_voicemail', 'Mia · Video message · 1:09 AM');
    await call('theo');
    setScene({ kind: 'between' });
    await hangUp();
    // The map, and Mum, while Jonah's call connects.
    warm('jonah');
    const betweenAt = Date.now();
    setTexts((t) => [...t, { from: 'Find My', text: "Mia's phone: last seen 12:41 AM, near Riverside Park." }]);
    await sleep(3500); sound(ding.current, true);
    setTyping('Mum'); await sleep(2500); setTyping('');
    setTexts((t) => [...t, { from: 'Mum', text: "Is Mia with you? Her bed's empty." }]);
    sound(ding.current, true);
    while (Date.now() - betweenAt < BETWEEN_MIN_MS) await sleep(200);
    await call('jonah');
    const decided = new Promise<Destination>((r) => { chosen.current = r; });
    setScene({ kind: 'decide' });
    await hangUp();
    const destination = await decided;
    const o = await post<Outcome>(`/run/${run.current}/ending`, { destination });
    await playVideo(o.video, o.video === 'm_bridge' ? 'Mia · FaceTime' : 'Mia · Voicemail · 2:03 AM');
    setOutcome(o);
    setScene({ kind: 'end' });
    void f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [film]);

  const begin = async () => {
    setScene({ kind: 'loading' });
    try {
      // The microphone is needed; the camera is your side of the video calls, if you allow it.
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user', width: 320, height: 480 } })
        .catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
      s.getAudioTracks().forEach((t) => t.stop());
      if (s.getVideoTracks().length) camera.current = new MediaStream(s.getVideoTracks());
    } catch {
      setScene({ kind: 'door' });
      return setProblem('The film needs your microphone: you talk to the people who call you.');
    }
    const assets = [...Object.keys(film!.mia), 'doorbell'];
    let n = 0;
    await Promise.all(assets.map(async (id) => {
      urls.current[id] = URL.createObjectURL(await (await fetch(`${API}/film/${id}.mp4`)).blob());
      setLoaded(++n / assets.length);
    }));
    // Unlock the sounds inside the tap that started the film.
    for (const el of [ring.current, ding.current]) { if (el) { el.muted = true; await el.play().catch(() => {}); el.pause(); el.muted = false; } }
    const { id } = await post<{ id: string }>('/run');
    run.current = id;
    setRunId(id);
    setScene({ kind: 'message', video: '', label: '' });
  };
  useEffect(() => {
    if (scene.kind === 'message' && !scene.video && runId) void playFilm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Your camera in the corner of every call.
  useEffect(() => {
    if (selfView.current && camera.current) selfView.current.srcObject = camera.current;
  }, [scene.kind]);
  useEffect(() => {
    const v = pipPlayer.current;
    if (!v || !pip) return;
    v.src = urls.current[pip]; v.currentTime = 0; void v.play().catch(() => {});
    v.onended = () => setPip('');
  }, [pip]);

  shake.current = scene.kind === 'call' ? SHAKE[who] : scene.kind === 'message' ? SHAKE.mia : 0;
  const p = film?.people[who];
  const onCall = scene.kind === 'call';
  const turn = !onCall ? null : avatar.heard ? 'listening' : talkingNow() || !parentSpoke ? 'talking' : 'yours';
  const chips = onCall && p ? p.chips[shown[who] ? 1 : 0] : [];
  const caught = (Object.keys(shown) as Caller[]);

  return (
    <main className="ls">
      <div className={`ls-phone is-${scene.kind}`}>
        <div className="ls-status"><span>{clockOf(minute)}</span><span className="ls-bars">▮▮▯ <b>12%</b></span></div>

        {/* The live call: mounted from the start, so it can connect hidden behind other screens. */}
        <div ref={lens} className="ls-lens">
          <div className={`ls-remote ${onCall ? 'is-on' : ''}`}>
            <video ref={avatar.videoRef} playsInline muted aria-label={p ? `${p.name}, live` : 'Live call'} />
            <audio ref={avatar.audioRef} autoPlay />
          </div>
          <video ref={player} className={`ls-message ${scene.kind === 'message' ? 'is-on' : ''}`} playsInline />
        </div>

        {scene.kind === 'message' && scene.label && <p className="ls-label">{scene.label}</p>}
        {(scene.kind === 'message' && caption) && <p className="ls-caption">{caption}</p>}

        {scene.kind === 'ringing' && p && (
          <div className="ls-ringing">
            <img src={`${API}/film/${scene.who}.jpg`} alt="" className="ls-ring-bg" />
            <div className="ls-ring-who">
              <img src={`${API}/film/${scene.who}.jpg`} alt="" className="ls-ring-face" />
              <h2>{p.name}</h2>
              <p>{answerable ? 'FaceTime Video' : 'Calling…'}</p>
            </div>
            <div className="ls-ring-actions">
              <button type="button" className="ls-answer" disabled={!answerable} onClick={() => answered.current()} aria-label="Answer">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11z" /></svg>
              </button>
              <span>{answerable ? 'Answer' : 'Connecting'}</span>
            </div>
          </div>
        )}

        {onCall && p && (
          <>
            <div className="ls-call-top"><b>{p.name}</b><span>{p.where} · {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</span></div>
            <video ref={selfView} className="ls-self" playsInline muted autoPlay />
            {!camera.current && <div className="ls-self ls-self-off">You</div>}
            {poor && <div className="ls-poor" style={{ backgroundImage: `url(${API}/film/${who}.jpg)` }}><span>Poor connection…</span></div>}
            {pip && <video ref={pipPlayer} className="ls-pip" playsInline muted />}
            {banner && (
              <div className="ls-banner" role="status">
                <b>{banner.from}</b><span>{banner.text}</span>
                <button type="button" onClick={() => showNow.current()}>Show {p.name}</button>
              </div>
            )}
            {avatar.caption && <p className="ls-caption is-live">{avatar.caption}</p>}
            {avatar.heard && <p className="ls-heard">{avatar.heard}</p>}
            <div className="ls-call-bottom">
              {turn && (
                <p className={`ls-turn is-${turn}`} aria-live="polite">
                  {turn !== 'talking' && <MicIcon />}
                  <span>{{ talking: `${p.name} is talking…`, yours: 'Your turn: say something', listening: `${p.name} is listening` }[turn]}</span>
                </p>
              )}
              <div className="ls-chips">{chips.map((c) => <button key={c} type="button" onClick={() => { samAt.current = Date.now(); avatarRef.current.say(c); }}>{c}</button>)}</div>
              <button type="button" className="ls-hangup" onClick={() => { hungUp.current = true; }} aria-label="Hang up">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" /></svg>
              </button>
            </div>
          </>
        )}

        {(scene.kind === 'between' || scene.kind === 'decide') && (
          <div className="ls-map">
            <svg viewBox="0 0 300 260" className="ls-map-art" aria-label="Map of the neighbourhood">
              <rect width="300" height="260" fill="#16202e" />
              <path d="M-10 175 C 70 150, 120 205, 190 180 S 290 150, 320 170" stroke="#1f3b5c" strokeWidth="26" fill="none" />
              <path d="M20 40 H 280 M60 10 V 250 M200 10 V 250 M20 110 H 280" stroke="#253347" strokeWidth="7" />
              <rect x="176" y="168" width="44" height="7" fill="#7a6b52" />
              <text x="198" y="200" textAnchor="middle" fill="#9fb0c6" fontSize="10">old footbridge</text>
              <rect x="215" y="60" width="26" height="22" fill="#34465f" /><text x="228" y="52" textAnchor="middle" fill="#9fb0c6" fontSize="10">party</text>
              <rect x="44" y="62" width="22" height="20" fill="#34465f" /><text x="55" y="54" textAnchor="middle" fill="#9fb0c6" fontSize="10">home</text>
              <circle cx="168" cy="150" r="7" fill="#f2b34a" className="ls-pin" /><text x="168" y="138" textAnchor="middle" fill="#f2b34a" fontSize="9">Mia · 12:41</text>
            </svg>
            <div className="ls-texts">
              {texts.map((t, i) => <p key={i}><b>{t.from}</b> {t.text}</p>)}
              {typing && <p className="ls-typing"><b>{typing}</b> is typing…</p>}
            </div>
            {scene.kind === 'between' && <p className="ls-hint">Someone else is calling…</p>}
            {scene.kind === 'decide' && (
              <div className="ls-decide">
                <p>Where do you go?</p>
                <button type="button" onClick={() => chosen.current('bridge')}>The old footbridge</button>
                <button type="button" onClick={() => chosen.current('party')}>Back to the party</button>
              </div>
            )}
          </div>
        )}

        {caught.length > 0 && (scene.kind === 'between' || scene.kind === 'decide' || onCall) && (
          <ul className="ls-notes" aria-label="What you know">
            {caught.map((c) => <li key={c}><s>{film!.evidence[c].lie}</s> {film!.evidence[c].truth}</li>)}
          </ul>
        )}

        {(scene.kind === 'door' || scene.kind === 'loading') && (
          <div className="ls-door">
            <p className="ls-door-time">1:12</p>
            <h1>Last Seen</h1>
            <p className="ls-premise">Your sister Mia hasn't come home. Her phone goes straight to voicemail. Two people saw her tonight, and both are lying.</p>
            <p className="ls-how">Answer their video calls and <strong>talk out loud</strong> when it says <strong>Your turn</strong>. When proof arrives, show it to them. About five minutes; headphones help.</p>
            {problem ? <p className="ls-problem">{problem}</p> : (
              <button type="button" className="ls-begin" onClick={begin} disabled={scene.kind === 'loading'}>
                {scene.kind === 'loading' ? `Unlocking… ${Math.round(loaded * 100)}%` : 'Unlock your phone'}
              </button>
            )}
          </div>
        )}

        {scene.kind === 'end' && outcome && (
          <div className="ls-end">
            <h2>{outcome.title}</h2>
            <p>{outcome.line}</p>
            <ul>{outcome.found.length ? outcome.found.map((t) => <li key={t}>{t}</li>) : <li>You caught no one in a lie.</li>}</ul>
            <button type="button" className="ls-begin" onClick={() => location.reload()}>Play again</button>
          </div>
        )}

        <audio ref={ring} src={`${API}/film/ring.mp3`} loop preload="auto" />
        <audio ref={ding} src={`${API}/film/ding.mp3`} preload="auto" />
        {debug && <pre className="ls-debug">{scene.kind} {who} {avatar.phase}</pre>}
      </div>
    </main>
  );
}
