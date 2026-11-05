// Dead Air: the whole film is your phone. A bored call from a friend closing a mall, a scream, a
// figure, a dropped phone; the security camera; a second friend in the car park whose life hangs on
// what you tell her; and a last call from a number that should not be calling.
//
// As in Last Seen, each live call connects hidden behind the screen before it and rings until the
// face is ready. The page owns every beat: it tells the caller what just happened, when.
import { useCallback, useEffect, useRef, useState } from 'react';
import { MicIcon, useAvatar } from '../../../src/kit/index.ts';
import './phone.css';
import './dead.css';

const API = '/api/apps/dead-air';
type Friend = 'jake' | 'maya';
interface Beat { at: number; id: string; event: string; sound?: string; urgent?: boolean }
interface Caller { name: string; where: string; chips: string[][]; beats: Beat[] }
interface Film { ready: boolean; cast: Record<Friend, boolean>; callers: Record<Friend, Caller>; sounds: string[]; videos: string[] }
type Scene =
  | { kind: 'door' } | { kind: 'loading' } | { kind: 'lock' }
  | { kind: 'ringing'; who: Friend | 'ghost' } | { kind: 'call'; who: Friend }
  | { kind: 'failed'; who: Friend } | { kind: 'cctv'; video: string; label: string }
  | { kind: 'ghost' } | { kind: 'end' };

const READY_TIMEOUT_MS = 75_000;
const MIN_RING_MS = 2500;
const MAYA_DECIDE_S = 25;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const timeline: { at: number; what: string }[] = [];
const mark = (what: string) => { timeline.push({ at: Math.round(performance.now()), what }); };
if (typeof window !== 'undefined') Object.assign(window, { __deadair: timeline });
async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}
const clockOf = (min: number) => `${Math.floor(min / 60) % 12 || 12}:${String(min % 60).padStart(2, '0')}`;

/**
 * A phone held in a hand: slow arm drift, a faint tremor, now and then a jolt that settles like a
 * spring. `strength` 0 is still; 4 is a phone being dropped.
 */
function useHandheld(ref: React.RefObject<HTMLDivElement | null>, strength: React.RefObject<number>) {
  useEffect(() => {
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let id = 0, jolt = { at: -99, x: 0, y: 0, r: 0 }, next = 4;
    const wave = (t: number, f: number[], p: number[]) => f.reduce((sum, k, i) => sum + Math.sin(t * k + p[i]) / (i + 1), 0);
    const tick = (ms: number) => {
      const t = ms / 1000, k = strength.current;
      if (t > next) { jolt = { at: t, x: (Math.random() - 0.5) * 2.4, y: (Math.random() - 0.3) * 2.2, r: (Math.random() - 0.5) * 2 }; next = t + (k > 2 ? 0.3 : 5) + Math.random() * (k > 2 ? 0.5 : 7); }
      const since = t - jolt.at, spring = since < 2.5 ? Math.exp(-since * 3) * Math.cos(since * 11) : 0;
      const x = k * (0.55 * wave(t, [0.43, 1.1, 2.7], [0, 1.7, 0.4]) + 0.06 * Math.sin(t * 47) + jolt.x * spring);
      const y = k * (0.5 * wave(t, [0.37, 0.95, 3.1], [2.1, 0.3, 1.1]) + 0.06 * Math.sin(t * 53 + 1) + jolt.y * spring);
      const r = k * (0.35 * wave(t, [0.29, 0.83], [0.9, 2.4]) + jolt.r * spring);
      if (ref.current) ref.current.style.transform = k ? `translate(${x.toFixed(3)}%, ${y.toFixed(3)}%) rotate(${r.toFixed(3)}deg) scale(${(1.08 + Math.min(k, 4) * 0.02).toFixed(3)})` : 'none';
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
  const [who, setWho] = useState<Friend>('jake');
  const [minute, setMinute] = useState(118);          // 1:58 a.m.
  const [answerable, setAnswerable] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [stage, setStage] = useState(0);              // how far the call has gone wrong, for the chips
  const [pip, setPip] = useState('');
  const [banner, setBanner] = useState<{ from: string; text: string } | null>(null);
  const [flicker, setFlicker] = useState(false);
  const [blackout, setBlackout] = useState(false);
  const [result, setResult] = useState<{ title: string; line: string } | null>(null);
  const [parentSpoke, setParentSpoke] = useState(false);
  const [startAsk, setStartAsk] = useState(0);
  const [, setTick] = useState(0);

  const urls = useRef<Record<string, string>>({});
  const run = useRef('');
  const wantStart = useRef<Friend | null>(null);
  const answered = useRef<() => void>(() => {});
  const revealed = useRef(false);
  const ended = useRef(false);
  const spoke = useRef(false);
  const captionAt = useRef(0);
  const lastLineAt = useRef(0);
  const heardSam = useRef<(text: string) => void>(() => {});
  const lens = useRef<HTMLDivElement>(null);
  const shake = useRef(0);
  const cctv = useRef<HTMLVideoElement>(null);
  const pipPlayer = useRef<HTMLVideoElement>(null);
  const povPlayer = useRef<HTMLVideoElement>(null);
  const [pov, setPov] = useState('');
  const [flip, setFlip] = useState(false);
  const [backCam, setBackCam] = useState(false);
  const [driving, setDriving] = useState(false);
  const [flash, setFlash] = useState(false);
  const [cracked, setCracked] = useState(false);
  const sfx = useRef<Record<string, HTMLAudioElement | null>>({});
  const debug = typeof location !== 'undefined' && location.search.includes('debug');
  useHandheld(lens, shake);

  const onUserSaid = useCallback((text: string) => {
    if (debug) console.log('[deadair] sam:', revealed.current ? 'heard' : 'hidden', text);
    if (revealed.current) heardSam.current(text);
  }, [debug]);
  const onAvatarSaid = useCallback((text: string) => {
    if (debug) console.log('[deadair] caller:', revealed.current ? 'heard' : 'hidden', text);
    lastLineAt.current = Date.now();
  }, [debug]);
  const onEnded = useCallback(() => { ended.current = true; }, []);
  const avatar = useAvatar(runId ? `dead-air/run/${runId}/${who}` : 'dead-air', { onUserSaid, onAvatarSaid, onEnded, onToolCall: () => 'Noted.' });
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;

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
  useEffect(() => {
    if (scene.kind === 'door' || scene.kind === 'loading' || scene.kind === 'end') return;
    const id = setInterval(() => setMinute((m) => m + 1), 40000);
    return () => clearInterval(id);
  }, [scene.kind]);
  useEffect(() => {
    const bye = () => { if (run.current) navigator.sendBeacon(`${API}/run/${run.current}/end-all`); };
    addEventListener('pagehide', bye);
    return () => removeEventListener('pagehide', bye);
  }, []);
  useEffect(() => { if (location.search.includes('script')) Object.assign(window, { __say: (t: string) => avatarRef.current.say(t) }); }, []);
  useEffect(() => {
    fetch(`${API}/film`).then((r) => r.json()).then((f: Film) => {
      setFilm(f);
      if (!f.ready) setProblem('The film is still being made. Try again in a moment.');
      else if (!f.cast.jake || !f.cast.maya) setProblem("Jake and Maya aren't on this server yet.");
    }).catch(() => setProblem('The film did not load. Try again in a moment.'));
  }, []);
  useEffect(() => {
    const v = pipPlayer.current;
    if (!v || !pip) return;
    v.src = urls.current[pip]; v.currentTime = 0; void v.play().catch(() => {});
  }, [pip]);

  const play = (name: string, volume = 1, loop = false) => {
    const el = sfx.current[name];
    if (!el) return;
    el.loop = loop; el.volume = volume; el.currentTime = 0; void el.play().catch(() => {});
  };
  const stop = (name: string) => sfx.current[name]?.pause();
  const drone = (volume: number) => { const el = sfx.current.drone; if (el) el.volume = volume; };

  const warm = (p: Friend) => { mark(`connect ${p}`); wantStart.current = p; setWho(p); setStartAsk((n) => n + 1); };
  const isReady = () => avatarRef.current.phase === 'live' && (avatarRef.current.videoRef.current?.videoWidth ?? 0) > 0;
  const talkingNow = () => avatarRef.current.speaking || Date.now() - captionAt.current < 1500;
  const hangUp = async () => {
    await avatarRef.current.end();
    for (let i = 0; i < 20 && avatarRef.current.phase === 'live'; i++) await sleep(100);
    await post(`/run/${run.current}/end-all`).catch(() => {});
  };
  /** Wait until the caller has finished what they are saying: at least `min`, at most `ms`. */
  const lineDone = async (ms: number, min = 1500) => {
    const until = Date.now() + ms;
    await sleep(min);
    while (Date.now() < until && (talkingNow() || Date.now() - lastLineAt.current < 400)) await sleep(200);
  };

  /** Ring until the face is ready and Sam answers; false if the call never came. */
  const ring = async (p: Friend) => {
    setScene({ kind: 'ringing', who: p });
    setAnswerable(false);
    play('ring', 0.8, true);
    mark(`ringing ${p}`);
    const rangAt = Date.now(), until = Date.now() + READY_TIMEOUT_MS;
    let redials = 0, seenStart = false;
    while ((!isReady() || Date.now() - rangAt < MIN_RING_MS) && Date.now() < until) {
      const phase = avatarRef.current.phase;
      if (phase !== 'ended' && phase !== 'failed' && phase !== 'idle') seenStart = true;
      // The call dropped before the face arrived: redial quietly while the phone keeps ringing.
      if (seenStart && (phase === 'ended' || phase === 'failed')) {
        if (redials++ >= 2) break;
        mark(`redial ${p}`);
        seenStart = false;
        await post(`/run/${run.current}/end-all`).catch(() => {});
        warm(p);
        await sleep(600);
      }
      await sleep(150);
    }
    if (!isReady()) { stop('ring'); mark(`missed ${p}`); void avatarRef.current.end(); return false; }
    setAnswerable(true);
    await new Promise<void>((r) => { answered.current = r; });
    stop('ring');
    return true;
  };

  const goLive = async (p: Friend) => {
    const cue = await (await fetch(`${API}/run/${run.current}/${p}/cue`)).json();
    const a = avatarRef.current;
    revealed.current = true; ended.current = false; spoke.current = false;
    setParentSpoke(false); setSeconds(0); setStage(0); setPip('');
    setScene({ kind: 'call', who: p });
    if (a.audioRef.current) a.audioRef.current.volume = 1;
    a.setMic(true);
    a.event(cue.opening, 20);
    mark(`live ${p}`);
    return cue as { beats: Beat[] };
  };

  /** The caller flips to the back camera: wait for them to say so (or a few seconds), then spin over. */
  const flipTo = async (name: string, ms: number, stay = false) => {
    const asked = Date.now();
    while (Date.now() - asked < 5000 && !/camera|look|see|show/i.test(avatarRef.current.caption)) await sleep(150);
    await sleep(500);
    setFlip(true); await sleep(260);
    setBackCam(true);
    void showPov(name, 0, stay);
    await sleep(260); setFlip(false);
    if (stay) return;
    await sleep(ms);
    setFlip(true); await sleep(260);
    setPov(''); setBackCam(false);
    await sleep(260); setFlip(false);
  };

  /** The phone stops pointing at the face: what its camera sees instead, while the voice goes on. */
  const showPov = async (name: string, ms: number, loop = false) => {
    setPov(name);
    await sleep(30);
    const v = povPlayer.current;
    if (v) { v.src = urls.current[name]; v.loop = loop; v.currentTime = 0; void v.play().catch(() => {}); }
    mark(`pov ${name}`);
    if (ms) { await sleep(ms); setPov(''); }
  };

  /** The call is cut off: violent shaking, the phone hits the floor, then nothing. */
  const dropped = async (p: Friend) => {
    mark(`dropped ${p}`);
    shake.current = 4;
    play('thud', 1);
    await sleep(1400);
    setBlackout(true);
    play('drop', 1);
    avatarRef.current.setMic(false);
    const audio = avatarRef.current.audioRef.current;
    if (audio) audio.volume = 0;
    revealed.current = false;
    await sleep(900);
    shake.current = 0;
    setPov('');
    setScene({ kind: 'failed', who: p });
    setBlackout(false);
    setPip('');
  };

  let charged = false;
  /** The man turns and comes straight at the camera, with a shriek; Jake screams; the phone goes. */
  const charge = async () => {
    charged = true;
    mark('charge');
    await sleep(600);
    void showPov('charge', 0);
    shake.current = 1.6;
    setTimeout(() => { play('shriek', 1); shake.current = 3.5; }, 1200);
  };

  const callJake = async () => {
    if (!(await ring('jake'))) return;
    const { beats } = await goLive('jake');
    shake.current = 0.8;
    const at = Date.now();
    for (const beat of beats) {
      while ((Date.now() - at) / 1000 < beat.at && !ended.current) { setSeconds(Math.floor((Date.now() - at) / 1000)); await sleep(250); }
      if (ended.current) break;
      mark(`beat ${beat.id}`);
      if (beat.sound) play(beat.sound, beat.sound === 'scream' ? 0.55 : 1);
      if (beat.id === 'flicker') { setFlicker(true); setTimeout(() => setFlicker(false), 900); }
      if (beat.id === 'scream') { shake.current = 1.3; drone(0.3); setStage(1); }
      if (beat.id === 'figure') { drone(0.45); setStage(2); }
      // An urgent beat cuts him off: a scream does not wait for him to finish a joke.
      if (beat.urgent) avatarRef.current.interrupt(beat.event); else avatarRef.current.event(beat.event, 12);
      // He turns the phone round to show you, then back to his face.
      // He turns the camera round to show you, and leaves it there.
      if (beat.id === 'figure') await flipTo('figure', 0, true);
      // He runs: the phone swings away from his face; you only hear him.
      if (beat.id === 'coming') {
        await charge();
        await lineDone(9000, 3700);
      }
    }
    // If his call died before the end, the scare still happens: it is the back camera, not his face.
    if (!charged) { if (!pov) await flipTo('figure', 0, true); await sleep(1500); await charge(); await sleep(3200); }
    // The phone hits the floor face up: the ceiling lights, and something leans over the lens.
    play('drop', 1);
    shake.current = 0;
    void showPov('ceiling', 0);
    avatarRef.current.setMic(false);
    const voice = avatarRef.current.audioRef.current;
    if (voice) voice.volume = 0.35;
    revealed.current = false;
    await sleep(4200);
    await dropped('jake');
  };

  /** Maya drives slowly with the phone on the dash mount; then the road; then the crash. */
  const callMaya = async () => {
    if (!(await ring('maya'))) return;
    const { beats } = await goLive('maya');
    // A phone in a dash mount shivers with the engine; streetlights sweep across her.
    shake.current = 0.3;
    setDriving(true);
    const at = Date.now();
    const wait = async (s: number) => { while ((Date.now() - at) / 1000 < s && !ended.current) { setSeconds(Math.floor((Date.now() - at) / 1000)); await sleep(250); } };
    const [road, crash] = beats;
    await wait(road.at);
    mark('beat road');
    drone(0.4);
    avatarRef.current.interrupt(road.event);
    // Her phone's back camera already faces the road: she switches to it, and you see where she is driving.
    await flipTo('road', 0, true);
    setDriving(false);
    shake.current = 0.45;
    await wait(crash.at);
    mark('beat crash');
    const screamAsked = Date.now();
    avatarRef.current.interrupt(crash.event);
    drone(0.6);
    // The crash lands on her scream, not before it.
    while (Date.now() - screamAsked < 4000 && !(avatarRef.current.speaking && captionAt.current > screamAsked)) await sleep(100);
    await sleep(300);
    void showPov('crash', 0);
    play('skid', 1);
    shake.current = 1.4;
    // Let her get the words out, then the impact.
    await lineDone(6000, 1800);
    // Impact: a white flash, the screen cracks, then nothing but the horn.
    play('impact', 1);
    shake.current = 4;
    setFlash(true);
    await sleep(140);
    setCracked(true);
    setFlash(false);
    await sleep(500);
    avatarRef.current.setMic(false);
    const voice = avatarRef.current.audioRef.current;
    if (voice) voice.volume = 0;
    revealed.current = false;
    shake.current = 0;
    setBlackout(true);
    play('horn', 0.55, true);
    play('tinnitus', 0.35);
    mark('crashed');
    for (let i = 0; i < 28; i++) { setSeconds(Math.floor((Date.now() - at) / 1000)); await sleep(250); }
    stop('horn');
    setCracked(false);
    setBlackout(false);
    setPov('');
    setScene({ kind: 'failed', who: 'maya' });
  };

  const playFilm = useCallback(async () => {
    play('drone', 0.12, true);
    warm('jake');
    setScene({ kind: 'lock' });
    await sleep(3500);
    await callJake();
    mark('hung up jake');
    await hangUp();
    await sleep(2200);
    // Maya texts: she's on her way to get him. Her call connects behind it.
    warm('maya');
    setScene({ kind: 'lock' });
    await sleep(1500);
    play('ding', 0.8);
    setBanner({ from: 'Maya', text: "Jake's not answering. Driving over to get him. Call you in a sec" });
    await sleep(4500);
    setBanner(null);
    await sleep(800);
    await callMaya();
    mark('hung up maya');
    await hangUp();
    const end = await post<{ title: string; line: string }>(`/run/${run.current}/ending`);
    // Silence. Then a call that should not come.
    drone(0.08);
    setScene({ kind: 'lock' });
    await sleep(3500);
    setScene({ kind: 'ringing', who: 'ghost' });
    setAnswerable(true);
    play('ring', 0.8, true);
    mark('ringing ghost');
    await Promise.race([new Promise<void>((r) => { answered.current = r; }), sleep(12000)]);
    stop('ring');
    setScene({ kind: 'ghost' });
    play('breath', 1);
    mark('ghost');
    await sleep(6500);
    stop('drone');
    setResult(end);
    setScene({ kind: 'end' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [film]);

  const begin = async () => {
    setScene({ kind: 'loading' });
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      setScene({ kind: 'door' });
      return setProblem('The film needs your microphone: you talk to the people who call you.');
    }
    const names = film!.videos;
    let n = 0;
    await Promise.all(names.map(async (id) => {
      urls.current[id] = URL.createObjectURL(await (await fetch(`${API}/film/${id}.mp4`)).blob());
      setLoaded(++n / names.length);
    }));
    for (const el of Object.values(sfx.current)) { if (el) { el.muted = true; await el.play().catch(() => {}); el.pause(); el.muted = false; } }
    const { id } = await post<{ id: string }>('/run');
    run.current = id;
    setRunId(id);
  };
  useEffect(() => { if (runId) void playFilm(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [runId]);

  const c = film?.callers[who];
  const onCall = scene.kind === 'call';
  const turn = !onCall ? null : avatar.heard ? 'listening' : talkingNow() || !parentSpoke ? 'talking' : 'yours';
  const ringWho = scene.kind === 'ringing' ? scene.who : null;
  const ringName = ringWho === 'ghost' ? 'Jake' : ringWho ? film?.callers[ringWho].name : '';
  const ringFace = ringWho === 'ghost' ? 'jake' : ringWho;

  return (
    <main className="ls da">
      <div className={`ls-phone is-${scene.kind}`}>
        <div className="ls-status"><span>{clockOf(minute)}</span><span className="ls-bars">▮▮▯ <b>9%</b></span></div>

        <div ref={lens} className={`ls-lens ${flicker ? 'is-flicker' : ''} ${flip ? 'is-flipping' : ''}`}>
          <div className={`ls-remote ${onCall ? 'is-on' : ''}`}>
            <video ref={avatar.videoRef} playsInline muted aria-label={c ? `${c.name}, live` : 'Live call'} />
            <audio ref={avatar.audioRef} autoPlay />
          </div>
          <video ref={povPlayer} className={`da-pov ${pov && onCall ? 'is-on' : ''}`} playsInline muted />
        </div>
        {driving && onCall && !backCam && <div className="da-sweep" aria-hidden="true" />}
        {flash && <div className="da-flash" aria-hidden="true" />}
        {cracked && (
          <svg className="da-cracks" viewBox="0 0 100 178" preserveAspectRatio="none" aria-hidden="true">
            <path d="M62 70 L40 20 M62 70 L95 40 M62 70 L88 120 M62 70 L30 150 M62 70 L5 90 M62 70 L70 2 M40 20 L28 5 M88 120 L99 160 M30 150 L18 176 M5 90 L1 70 M62 70 L75 176" />
          </svg>
        )}
        {blackout && <div className="da-black" />}

        {scene.kind === 'lock' && <div className="da-lock"><p className="ls-door-time">{clockOf(minute)}</p><p className="da-date">Saturday</p></div>}
        {banner && <div className="ls-banner da-banner" role="status"><b>{banner.from}</b><span>{banner.text}</span></div>}

        {ringWho && (
          <div className="ls-ringing">
            {ringFace && <img src={`${API}/film/${ringFace}.jpg`} alt="" className="ls-ring-bg" />}
            <div className="ls-ring-who">
              {ringFace && <img src={`${API}/film/${ringFace}.jpg`} alt="" className="ls-ring-face" />}
              <h2>{ringName}</h2>
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

        {onCall && c && (
          <>
            <div className="ls-call-top"><b>{c.name}</b><span>{c.where} · {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</span></div>
            {backCam && <p className="da-backcam">Back camera</p>}
            {avatar.caption && pov !== 'charge' && <p className="ls-caption is-live">{avatar.caption}</p>}
            {avatar.heard && <p className="ls-heard">{avatar.heard}</p>}
            <div className="ls-call-bottom">
              {turn && (
                <p className={`ls-turn is-${turn}`} aria-live="polite">
                  {turn !== 'talking' && <MicIcon />}
                  <span>{{ talking: `${c.name} is talking…`, yours: 'Your turn: say something', listening: `${c.name} is listening` }[turn]}</span>
                </p>
              )}
            </div>
          </>
        )}

        {scene.kind === 'failed' && <div className="da-failed"><b>{film?.callers[scene.who].name}</b><span>Call failed</span></div>}
        {scene.kind === 'ghost' && <div className="da-failed da-ghost"><b>Jake</b><span>00:0{Math.min(9, seconds)}</span></div>}

        {(scene.kind === 'door' || scene.kind === 'loading') && (
          <div className="ls-door da-door">
            <p className="ls-door-time">1:58</p>
            <h1>Dead Air</h1>
            <p className="ls-premise">It's late. Your best friend Jake is closing the mall alone again, and he's bored.</p>
            <p className="ls-how">When someone calls, answer, and <strong>talk out loud</strong> when it says <strong>Your turn</strong>. About three minutes. Headphones, lights off.</p>
            {problem ? <p className="ls-problem">{problem}</p> : (
              <button type="button" className="ls-begin" onClick={begin} disabled={scene.kind === 'loading'}>
                {scene.kind === 'loading' ? `Unlocking… ${Math.round(loaded * 100)}%` : 'Unlock your phone'}
              </button>
            )}
          </div>
        )}

        {scene.kind === 'end' && result && (
          <div className="ls-end da-end">
            <h2>{result.title}</h2>
            <p>{result.line}</p>
            <button type="button" className="ls-begin" onClick={() => location.reload()}>Play again</button>
          </div>
        )}

        {(film?.sounds ?? []).map((s) => <audio key={s} ref={(el) => { sfx.current[s] = el; }} src={`${API}/film/${s}.mp3`} preload="auto" />)}
        {debug && <pre className="ls-debug">{scene.kind} {who} {avatar.phase}</pre>}
      </div>
    </main>
  );
}
