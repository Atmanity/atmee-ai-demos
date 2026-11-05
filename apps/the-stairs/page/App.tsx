// The Stairs: a three-minute film where the viewer is Sam, ten, and talks to each parent.
//
// The film is pre-rendered clips, played on two alternating <video>s so each cut lands on a
// decoded frame. Each parent's live call connects while the clips before it play, hidden, muted
// and with Sam's microphone closed (staging also skips the greeting). The page cuts to the live
// face only once its video plays; until then it loops a silent clip of the same parent waiting
// in the same kitchen, so the viewer never sees a load. One call at a time: Mark's connects
// under the bridge clips that follow Claire's.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackToApps, MicIcon, useAvatar, type ToolCall } from '../../../src/kit/index.ts';
import './stairs.css';

const API = '/api/apps/the-stairs';
type Parent = 'claire' | 'mark';
interface Shot { id: string; caption?: string; speaker?: Parent }
interface Film { shots: Record<string, Shot>; opening: string[]; ready: boolean; cast: Record<Parent, boolean> }
interface Done { next: string[]; ending?: string; title?: string; line?: string; stances?: Record<Parent, string> }
type Screen = 'door' | 'loading' | 'film' | 'end';

// A live scene: the parent wraps up from WRAP_S, the cut comes after their next line, and never past HARD_S.
const WRAP_S = 38;
const END_AFTER_S = 44;
const HARD_S = 58;
// How long a call may take to appear before the scene goes on without it.
const READY_TIMEOUT_MS = 75_000;
const CHOICE_MS = 9000;
const NAMES: Record<Parent, string> = { claire: 'Mum', mark: 'Dad' };
const STANCE: Record<string, string> = { honest: 'told them how it felt', side: 'took a side', silent: 'kept quiet' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// What the film did and when, for a test driver to check that no load ever showed.
const timeline: { at: number; what: string }[] = [];
const mark = (what: string) => { timeline.push({ at: Math.round(performance.now()), what }); };
if (typeof window !== 'undefined') Object.assign(window, { __stairs: timeline });
async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

/**
 * A handheld camera over the whole frame: slow drift and breathing from a few unrelated sine waves,
 * plus a faint tremor, under a small zoom so the edges never show. One camera for every shot, so the
 * motion carries through each cut, the cut to the live face included. Off for reduced motion.
 */
function useHandheld(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let id = 0;
    const wave = (t: number, f: number[], p: number[]) => f.reduce((sum, k, i) => sum + Math.sin(t * k + p[i]) / (i + 1), 0);
    const tick = (ms: number) => {
      const t = ms / 1000;
      const x = 0.32 * wave(t, [0.37, 0.91, 2.3], [0, 1.7, 0.4]) + 0.035 * Math.sin(t * 41);
      const y = 0.26 * wave(t, [0.29, 1.13, 2.9], [2.1, 0.3, 1.1]) + 0.03 * Math.sin(t * 37 + 1);
      const r = 0.14 * wave(t, [0.23, 0.71], [0.9, 2.4]);
      const z = 1.045 + 0.006 * Math.sin(t * 0.21);
      if (ref.current) ref.current.style.transform = `translate(${x.toFixed(3)}%, ${y.toFixed(3)}%) rotate(${r.toFixed(3)}deg) scale(${z.toFixed(4)})`;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [ref]);
}

export function App() {
  const [screen, setScreen] = useState<Screen>('door');
  const [problem, setProblem] = useState('');
  const [loaded, setLoaded] = useState(0);
  const [runId, setRunId] = useState('');
  const [who, setWho] = useState<Parent>('claire');
  const [caption, setCaption] = useState<{ text: string; speaker?: Parent } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [onLive, setOnLive] = useState(false);
  // Set once the live parent has said their first line: until then it is not Sam's turn.
  const [parentSpoke, setParentSpoke] = useState(false);
  const [result, setResult] = useState<Done | null>(null);

  const film = useRef<Film | null>(null);
  const urls = useRef<Record<string, string>>({});
  const players = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  const front = useRef(0);
  const liveBox = useRef<HTMLDivElement>(null);
  const camera = useRef<HTMLDivElement>(null);
  useHandheld(camera);
  const run = useRef('');
  const wantStart = useRef<Parent | null>(null);
  const revealed = useRef(false);
  const scene = useRef({ who: 'claire' as Parent, lastAvatarDone: 0, spokeAfterWrap: false, ended: false });
  const choice = useRef<(c: 'step' | 'stay') => void>(() => {});
  const debug = typeof location !== 'undefined' && location.search.includes('debug');

  const onUserSaid = useCallback((text: string) => {
    if (debug) console.log('[stairs] sam:', revealed.current ? 'heard' : 'hidden', text);
    if (!revealed.current) return;
    void post(`/run/${run.current}/${scene.current.who}/line`, { who: 'sam', text });
  }, []);
  const onAvatarSaid = useCallback((text: string) => {
    if (debug) console.log('[stairs] parent:', revealed.current ? 'heard' : 'hidden', text);
    if (!revealed.current) return;
    scene.current.lastAvatarDone = Date.now();
    scene.current.spokeAfterWrap = true;
    void post(`/run/${run.current}/${scene.current.who}/line`, { who: 'parent', text });
  }, []);
  const onEnded = useCallback(() => { scene.current.ended = true; }, []);
  // What the parent noticed: a hint for the server's judge, never shown.
  const onToolCall = useCallback(({ name, arguments: args }: ToolCall) => {
    if (name !== 'noticed') return 'Unknown tool.';
    void post(`/run/${run.current}/${scene.current.who}/line`, { who: 'noticed', text: `${String(args.what ?? '')} ${String(args.words ?? '')}`.trim() });
    return 'Noted.';
  }, []);

  const avatar = useAvatar(runId ? `the-stairs/run/${runId}/${who}` : 'the-stairs', { onUserSaid, onAvatarSaid, onEnded, onToolCall });
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;

  // A call starts once useAvatar points at that parent (the app path carries who).
  const [startAsk, setStartAsk] = useState(0);
  useEffect(() => {
    if (!runId || wantStart.current !== who) return;
    wantStart.current = null;
    const a = avatarRef.current;
    if (a.audioRef.current) a.audioRef.current.volume = 0;
    void a.start({ mic: true, micMuted: true });
  }, [who, runId, startAsk]);
  useEffect(() => { if (runId) mark(`call ${who} ${avatar.phase}`); }, [runId, who, avatar.phase]);
  useEffect(() => { if (onLive && avatar.speaking) setParentSpoke(true); }, [onLive, avatar.speaking]);
  // Hidden means silent: LiveKit can reset the element when it attaches a track.
  useEffect(() => {
    if (!revealed.current && avatar.audioRef.current) avatar.audioRef.current.volume = 0;
  }, [avatar.phase, avatar.audioRef]);

  // For tests: `?script` lets a driver speak Sam's lines as text.
  useEffect(() => {
    if (location.search.includes('script')) Object.assign(window, { __say: (text: string) => avatarRef.current.say(text) });
  }, []);

  useEffect(() => {
    fetch(`${API}/film`).then((r) => r.json()).then((f: Film) => {
      film.current = f;
      if (!f.ready) setProblem('The film is still being made. Try again in a moment.');
      else if (!f.cast.claire || !f.cast.mark) setProblem('Mum and Dad are not on this server yet.');
    }).catch(() => setProblem('The film did not load. Try again in a moment.'));
  }, []);

  // ---- the film's pieces

  // Asking for a call bumps `startAsk`, so the effect runs even when useAvatar already points at that parent.
  const warm = (p: Parent) => { mark(`connect ${p}`); wantStart.current = p; setWho(p); setStartAsk((n) => n + 1); };
  const isReady = () => {
    const a = avatarRef.current;
    return a.phase === 'live' && (a.videoRef.current?.videoWidth ?? 0) > 0;
  };

  /** Cut to a clip; resolves when it ends (a loop resolves once it is showing). */
  const shot = useCallback(async (id: string, loop = false) => {
    const next = 1 - front.current;
    const v = players[next].current!;
    const old = players[front.current].current!;
    v.src = urls.current[id];
    v.loop = loop;
    v.currentTime = 0;
    const ended = new Promise<void>((r) => { v.onended = () => r(); });
    await v.play().catch(() => {});
    v.classList.add('is-front');
    old.classList.remove('is-front');
    old.pause();
    liveBox.current?.classList.remove('is-front');
    front.current = next;
    mark(`shot ${id}${loop ? ' (hold)' : ''}`);
    const s = film.current!.shots[id];
    setCaption(s.caption ? { text: s.caption, speaker: s.speaker } : null);
    if (!loop) await ended;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A live conversation with one parent. */
  const liveScene = useCallback(async (p: Parent) => {
    scene.current = { who: p, lastAvatarDone: 0, spokeAfterWrap: false, ended: false };
    const until = Date.now() + READY_TIMEOUT_MS;
    if (!isReady()) {
      await shot(p === 'claire' ? 'h_claire' : 'h_mark', true);
      while (!isReady() && avatarRef.current.phase !== 'failed' && Date.now() < until) await sleep(150);
    }
    if (!isReady()) {
      // The call never came: the parent looks at Sam and says nothing, and the film goes on.
      mark(`missed ${p}`);
      setCaption({ text: `(${NAMES[p]} looks at you for a long moment, and says nothing.)` });
      await sleep(4000);
      void avatarRef.current.end();
      return;
    }
    const cue = await (await fetch(`${API}/run/${run.current}/${p}/cue`)).json();
    const a = avatarRef.current;
    mark(`live ${p}`);
    revealed.current = true;
    if (a.audioRef.current) a.audioRef.current.volume = 1;
    liveBox.current?.classList.add('is-front');
    players.forEach((r) => { r.current?.classList.remove('is-front'); r.current?.pause(); });
    setCaption(null);
    setParentSpoke(false);
    setOnLive(true);
    a.setMic(true);
    a.event(cue.opening, 20);
    const at = Date.now();
    let wrapped = false;
    for (;;) {
      await sleep(250);
      const s = (Date.now() - at) / 1000;
      if (scene.current.ended) break;
      if (!wrapped && s >= WRAP_S) { wrapped = true; scene.current.spokeAfterWrap = false; avatarRef.current.state(cue.wrap); }
      const quiet = !avatarRef.current.speaking && Date.now() - scene.current.lastAvatarDone > 1200;
      if ((s >= END_AFTER_S && wrapped && scene.current.spokeAfterWrap && quiet) || s >= HARD_S) break;
    }
    // Out: close the mic, fade the voice, and hang up behind the next shot.
    avatarRef.current.setMic(false);
    const audio = avatarRef.current.audioRef.current;
    for (let i = 10; i >= 0 && audio; i--) { audio.volume = i / 10; await sleep(30); }
    mark(`cut from ${p}`);
    revealed.current = false;
    setOnLive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot]);

  const hangUp = async () => {
    await avatarRef.current.end();
    // useAvatar keeps the old session until its end event: wait a beat before the next call.
    for (let i = 0; i < 20 && avatarRef.current.phase === 'live'; i++) await sleep(100);
  };

  const playFilm = useCallback(async () => {
    const f = film.current!;
    // Opening: Claire's call connects under the argument, from the third shot.
    for (const id of f.opening) {
      if (id === 'o3_working') warm('claire');
      await shot(id);
    }
    // The kitchen goes quiet: what does Sam do?
    setChoosing(true);
    const c = await Promise.race([new Promise<'step' | 'stay'>((r) => { choice.current = r; }), sleep(CHOICE_MS).then(() => 'stay' as const)]);
    setChoosing(false);
    await post(`/run/${run.current}/choice`, { choice: c });

    await liveScene('claire');
    // Mark comes back in; Claire tells him what Sam said. His call connects under it.
    const handoff = shot('b_handoff');
    await hangUp();
    const decided = post<Done>(`/run/${run.current}/claire/done`);
    await handoff;
    warm('mark');
    const bridge = await decided.catch(() => ({ next: ['b_handoff', 'b_wonttalk', 'b_momleaves'] }) as Done);
    for (const id of bridge.next.slice(1)) await shot(id);

    await liveScene('mark');
    await shot('h_mark', true);
    const [ending] = await Promise.all([post<Done>(`/run/${run.current}/mark/done`).catch(() => null), hangUp()]);
    const end = ending ?? { next: ['e_silence'], title: 'Silence', line: 'Sam kept it inside, and so did they.' };
    for (const id of end.next) await shot(id);
    setCaption(null);
    setResult(end);
    setScreen('end');
  }, [shot, liveScene]);

  const begin = async () => {
    setScreen('loading');
    try {
      // Ask for the microphone now, so no prompt interrupts the film.
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      setScreen('door');
      return setProblem('The film needs your microphone: you talk to Mum and Dad out loud.');
    }
    const ids = Object.keys(film.current!.shots);
    let n = 0;
    await Promise.all(ids.map(async (id) => {
      if (!urls.current[id]) urls.current[id] = URL.createObjectURL(await (await fetch(`${API}/film/${id}.mp4`)).blob());
      setLoaded(++n / ids.length);
    }));
    const { id } = await post<{ id: string }>('/run');
    run.current = id;
    setRunId(id);
    setScreen('film');
  };

  useEffect(() => {
    if (screen === 'film') void playFilm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const liveCaption = onLive ? (avatar.caption ? { text: avatar.caption, speaker: who } : null) : caption;

  return (
    <main className={`st ${screen === 'film' ? 'is-playing' : ''}`}>
      <div className="st-stage" aria-label="The film">
        <div ref={camera} className="st-camera">
          <video ref={players[0]} className="st-shot" playsInline preload="auto" />
          <video ref={players[1]} className="st-shot" playsInline preload="auto" />
          <div ref={liveBox} className="st-shot st-live">
            <video ref={avatar.videoRef} playsInline muted aria-label={`${NAMES[who]}, live`} />
            <audio ref={avatar.audioRef} autoPlay />
          </div>
        </div>
        <div className="st-grain" aria-hidden="true" />
        {screen === 'film' && liveCaption && (
          <p className={`st-caption ${liveCaption.speaker ? `is-${liveCaption.speaker}` : 'is-narration'}`}>{liveCaption.text}</p>
        )}
        {screen === 'film' && onLive && avatar.heard && <p className="st-heard">{avatar.heard}</p>}
        {screen === 'film' && onLive && (() => {
          // Whose turn it is: the parent talking, Sam's turn once they stop, or the parent listening to Sam.
          const turn = avatar.heard ? 'listening' : avatar.speaking || !parentSpoke ? 'talking' : 'yours';
          const words = { talking: `${NAMES[who]} is talking…`, yours: 'Your turn: say something', listening: `${NAMES[who]} is listening` }[turn];
          return (
            <p className={`st-turn is-${turn}`} aria-live="polite">
              {turn !== 'talking' && <MicIcon />}<span>{words}</span>
            </p>
          );
        })()}
        {choosing && (
          <div className="st-choice" role="dialog" aria-label="What do you do?">
            <p>The kitchen goes quiet. What do you do?</p>
            <div>
              <button type="button" onClick={() => choice.current('step')}>Step into the kitchen</button>
              <button type="button" onClick={() => choice.current('stay')}>Stay in the doorway</button>
            </div>
            <span className="st-timer" style={{ animationDuration: `${CHOICE_MS}ms` }} />
          </div>
        )}
        {(screen === 'door' || screen === 'loading') && (
          <div className="st-door">
            <h1>The Stairs</h1>
            <p className="st-premise">It's late. You're Sam, ten years old, and you can't sleep. Voices from the kitchen. They're fighting again.</p>
            <p className="st-how">Three minutes. When Mum or Dad turns to you and <strong>Your turn</strong> lights up at the top, talk to them out loud. What you say changes how the night ends. Headphones help.</p>
            {problem ? <p className="st-problem">{problem}</p> : (
              <button type="button" className="st-begin" onClick={begin} disabled={screen === 'loading'}>
                {screen === 'loading' ? `Getting ready ${Math.round(loaded * 100)}%` : 'Begin'}
              </button>
            )}
          </div>
        )}
        {screen === 'end' && result && (
          <div className="st-end">
            <h2>{result.title}</h2>
            <p>{result.line}</p>
            {result.stances && (
              <ul>
                <li>With Mum, you {STANCE[result.stances.claire] ?? 'kept quiet'}.</li>
                <li>With Dad, you {STANCE[result.stances.mark] ?? 'kept quiet'}.</li>
              </ul>
            )}
            <button type="button" className="st-begin" onClick={() => location.reload()}>Watch again</button>
          </div>
        )}
        {debug && <pre className="st-debug">{who} {avatar.phase} live={String(onLive)} mic={String(avatar.micOn)} {avatar.detail}</pre>}
      </div>
      {screen !== 'film' && <BackToApps />}
    </main>
  );
}
