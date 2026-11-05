// Where Are You, Lily? Everything is your phone: the lock screen, her FaceTime call, the map.
// The call connects hidden while it rings, so her face is there the moment you answer. Opening the
// map shrinks the call to a corner, as a real call does; tap it to bring her back.
import { useCallback, useEffect, useRef, useState } from 'react';
import { MicIcon, useAvatar } from '../../../src/kit/index.ts';
import { CLUE_NOTE, cluesIn, ENDINGS, FINALE, FLIP_COST, FOOTSTEPS, OPENING, PLACES, possible, SECONDS_PER_PERCENT, START_BATTERY, TRUTH, VIEWS, viewAsked, type Clue, type Ending, type View } from '../story.ts';
import './lily.css';

const API = '/api/apps/lily';
type Scene = 'door' | 'lock' | 'call' | 'end';
interface Film { ready: boolean; cast: boolean; welcomes: boolean }

const READY_TIMEOUT_MS = 75_000;
const FOOTSTEPS_AT_S = 95;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const timeline: { at: number; what: string }[] = [];
const mark = (what: string) => { timeline.push({ at: Math.round(performance.now()), what }); console.log(`[lily] ${what}`); };
if (typeof window !== 'undefined') Object.assign(window, { __lily: timeline });
async function post<T>(path: string): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export function App() {
  const [film, setFilm] = useState<Film | null>(null);
  const [scene, setScene] = useState<Scene>('door');
  const [runId, setRunId] = useState('');
  const [ready, setReady] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [found, setFound] = useState<Clue[]>([]);
  const [toast, setToast] = useState('');
  const [battery, setBattery] = useState(START_BATTERY);
  const [picked, setPicked] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [black, setBlack] = useState(false);
  const seen = useRef<View[]>([]);
  const foundRef = useRef<Clue[]>([]);
  const endingRef = useRef<Ending | null>(null);
  const flipping = useRef(false);
  const captionAt = useRef(0);
  const liveAt = useRef(0);
  const drained = useRef(0);

  useEffect(() => { fetch(`${API}/film`).then((r) => r.json()).then(setFilm).catch(() => setFilm(null)); }, []);

  // ---- sound
  const sounds = useRef<Record<string, HTMLAudioElement>>({});
  const play = useCallback((name: string, volume = 1, loop = false) => {
    const a = sounds.current[name] ?? (sounds.current[name] = new Audio(`${API}/film/${name}.mp3`));
    a.loop = loop; a.volume = volume; a.currentTime = 0; void a.play().catch(() => {});
  }, []);
  const stop = (name: string) => sounds.current[name]?.pause();

  const addClues = (cs: Clue[]) => {
    const fresh = cs.filter((c) => !foundRef.current.includes(c));
    if (!fresh.length) return;
    foundRef.current = [...foundRef.current, ...fresh];
    setFound(foundRef.current);
    setToast(CLUE_NOTE[fresh[0]]);
    mark(`clue ${fresh.join(',')}`);
  };
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 3500); return () => clearTimeout(id); }, [toast]);

  const onAvatarSaid = useCallback((text: string) => { mark(`lily: ${text}`); addClues(cluesIn(text)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const onUserSaid = useCallback((text: string) => {
    mark(`you: ${text}`);
    const v = viewAsked(text, seen.current);
    if (v && !endingRef.current) void flip(v);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const avatar = useAvatar(runId ? `lily/run/${runId}/lily` : 'lily', { onUserSaid, onAvatarSaid, onToolCall: () => 'Noted.' });
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;
  useEffect(() => { if (avatar.caption) captionAt.current = Date.now(); }, [avatar.caption]);
  const lineDone = async (timeout: number, min = 0) => {
    const from = Date.now();
    while (Date.now() - from < timeout && captionAt.current < from) await sleep(100);
    await sleep(min);
    while (Date.now() - from < timeout && (avatarRef.current.speaking || Date.now() - captionAt.current < 1400)) await sleep(150);
  };

  // ---- the back camera: she turns it, you see what she sees, her voice carries on.
  async function flip(v: View) {
    if (flipping.current) return;
    flipping.current = true;
    seen.current = [...seen.current, v];
    drained.current += FLIP_COST;
    mark(`flip ${v}`);
    avatarRef.current.event(VIEWS[v].event, 15);
    await sleep(900);
    setMapOpen(false);
    setView(v);
    addClues(VIEWS[v].clues);
    await sleep(6500);
    setView(null);
    flipping.current = false;
  }

  // ---- ringing: connect behind the lock screen; Accept lights once her face is there.
  const begin = async () => {
    setScene('lock');
    play('ring', 0.8, true);
    const { id } = await post<{ id: string }>('/run');
    setRunId(id);
    mark('run');
  };
  useEffect(() => {
    if (!runId || scene !== 'lock') return;
    mark('connect');
    void avatarRef.current.start({ mic: true, micMuted: true });
    const from = Date.now();
    const id = setInterval(() => {
      const a = avatarRef.current;
      if (a.phase === 'live' && (a.videoRef.current?.videoWidth ?? 0) > 0) { clearInterval(id); setReady(true); mark('ready'); }
      else if (a.phase === 'failed' || a.phase === 'ended' || Date.now() - from > READY_TIMEOUT_MS) { clearInterval(id); mark(`connect failed ${a.phase} ${a.errorCode ?? ''}`); stop('ring'); setScene('door'); }
    }, 200);
    return () => clearInterval(id);
  }, [runId, scene]);

  const accept = () => {
    stop('ring');
    const a = avatarRef.current;
    a.setMic(true);
    if (!film?.welcomes) a.event(OPENING, 20);
    else a.interrupt(OPENING);
    liveAt.current = Date.now();
    play('water', 0.12, true);
    mark('answered');
    setScene('call');
  };

  // ---- the clock: battery, trains, the footsteps.
  useEffect(() => {
    if (scene !== 'call') return;
    let trains = 0, steps = false;
    const id = setInterval(() => {
      const s = (Date.now() - liveAt.current) / 1000;
      const b = Math.max(0, START_BATTERY - Math.floor(s / SECONDS_PER_PERCENT) - drained.current);
      setBattery(b);
      if (b <= 2 && b > 0 && Math.floor(s) % 20 === 0) play('lowbatt', 0.5);
      if (s > 25 + trains * 50) { trains += 1; play('train', 0.55); }
      if (!steps && s > FOOTSTEPS_AT_S && !endingRef.current) {
        steps = true; play('steps', 0.8); setTimeout(() => play('bang', 0.7), 4800);
        avatarRef.current.interrupt(FOOTSTEPS); mark('footsteps');
      }
      if (b === 0 && !endingRef.current && !sent) void finish('dead');
    }, 500);
    return () => clearInterval(id);
  }, [scene, sent]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- sending the police
  const send = async (placeId: string) => {
    if (sent) return;
    setSent(placeId); setPicked(null); setMapOpen(false);
    mark(`sent ${placeId}`);
    const place = PLACES.find((p) => p.id === placeId)!;
    avatarRef.current.event(`Your sibling just told you they sent the police to ${place.name}. Whisper thank you, and that you will stay on the line.`, 12);
    await sleep(14000);
    void finish(placeId === TRUTH ? 'found' : 'wrong');
  };

  async function finish(e: Ending) {
    if (endingRef.current) return;
    endingRef.current = e; setEnding(e);
    mark(`ending ${e}`);
    setMapOpen(false); setView(null);
    const a = avatarRef.current;
    a.setMic(false);
    if (e === 'found') play('sirens', 0.7);
    a.interrupt(FINALE[e]);
    await lineDone(16000, 1500);
    if (e === 'found') await sleep(2500);
    if (e !== 'found') { setBlack(true); stop('water'); }
    await sleep(1600);
    await a.end().catch(() => {});
    stop('water'); stop('sirens');
    if (runId) void post(`/run/${runId}/end-all`).catch(() => {});
    mark('end');
    setScene('end');
  }

  useEffect(() => {
    const bye = () => { if (runId) navigator.sendBeacon(`${API}/run/${runId}/end-all`); };
    addEventListener('pagehide', bye);
    return () => removeEventListener('pagehide', bye);
  }, [runId]);

  const talking = avatar.speaking || Date.now() - captionAt.current < 1200;
  const left = possible(found);
  const sentPlace = PLACES.find((p) => p.id === sent);

  if (scene === 'door' || scene === 'end') {
    const fin = scene === 'end' && ending ? ENDINGS[ending] : null;
    return (
      <main className="ly ly-door">
        <div className="ly-card">
          <p className="ly-kicker">{fin ? 'Ashford · 1:31 a.m.' : 'Ashford · 1:12 a.m.'}</p>
          <h1>{fin ? fin.title : 'Where are you, Lily?'}</h1>
          <p className="ly-lede">{fin ? fin.line(sentPlace?.name ?? 'the wrong place') : "Your little sister never came home from the party. It's 1:12 a.m., and your phone is about to ring."}</p>
          {!fin && <p className="ly-how">Talk to her out loud. Ask what she hears and sees, ask her to show you, and use your map. Her battery won't last.</p>}
          <button className="ly-go" disabled={!film?.cast || !film.ready} onClick={() => {
            endingRef.current = null; setEnding(null); setBlack(false); setSent(null); setFound([]); foundRef.current = []; seen.current = []; drained.current = 0; setBattery(START_BATTERY); setReady(false); setRunId('');
            void begin();
          }}>{fin ? 'Try again' : 'Start'}</button>
          {film && !film.cast && <p className="ly-how">Lily is not set up on this server (LILY_AVATAR).</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="ly ly-phone">
      {/* The call: one video element for the whole film; the map only shrinks it. */}
      <div className={`ly-call${mapOpen ? ' is-pip' : ''}${scene === 'lock' ? ' is-hidden' : ''}`} onClick={() => mapOpen && setMapOpen(false)}>
        <video ref={avatar.videoRef} autoPlay playsInline muted={false} className="ly-face" />
        <audio ref={avatar.audioRef} autoPlay />
        {view && <video key={view} className="ly-back" src={`${API}/film/${view}.mp4`} autoPlay muted playsInline onEnded={(e) => e.currentTarget.pause()} />}
        {!mapOpen && (
          <>
            <div className="ly-top">
              <span className="ly-name">Lily</span>
              <span className={`ly-batt${battery <= 3 ? ' is-low' : ''}`}><i><b style={{ width: `${Math.max(8, battery * 10)}%` }} /></i>{battery}%</span>
            </div>
            {view && <span className="ly-backtag">Back camera</span>}
            {avatar.caption && <p className="ly-sub">{avatar.caption}</p>}
            {sentPlace && !ending && <p className="ly-dispatch">Police on the way to {sentPlace.name}</p>}
            <div className="ly-bar">
              <span className="ly-turn"><span className={`ly-mic${avatar.micOn ? ' is-on' : ''}`}><MicIcon /></span>{ending ? '' : talking ? 'Lily is talking' : 'Your turn: talk to her'}</span>
              <button className="ly-mapbtn" onClick={(e) => { e.stopPropagation(); setMapOpen(true); }} disabled={Boolean(ending)}>
                Map{found.length > 0 && <b>{found.length}</b>}
              </button>
            </div>
          </>
        )}
      </div>
      {black && <div className="ly-black"><span>Call failed</span></div>}

      {mapOpen && (
        <section className="ly-map">
          <header><h2>Ashford</h2><p>{left.length} of {PLACES.length} places still possible</p></header>
          <div className="ly-area">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="ly-land" aria-hidden>
            <path d="M12 0 C 22 12, 30 22, 45 33 S 66 44, 68 51 S 52 64, 42 75 S 28 92, 30 100" className="ly-river" />
            <path d="M66 0 L 86 100" className="ly-rail" />
            <path d="M73.6 38 L 88 38" className="ly-rail" />
            <path d="M0 58 L 100 58 M50 0 L 50 100" className="ly-road" />
          </svg>
          {PLACES.map((p) => {
            const ok = left.includes(p);
            return (
              <button key={p.id} className={`ly-pin${ok ? '' : ' is-out'}${picked === p.id ? ' is-picked' : ''}`} style={{ left: `${p.x}%`, top: `${p.y}%` }} onClick={() => setPicked(p.id)}>
                <i /><span>{p.name}</span>
              </button>
            );
          })}
          </div>
          <div className="ly-notes">
            <p className="ly-label">What you know</p>
            {found.length ? <ul>{found.map((c) => <li key={c}>{CLUE_NOTE[c]}</li>)}</ul> : <p className="ly-empty">Nothing yet. Ask her what she can hear and see.</p>}
          </div>
          {picked && (() => { const p = PLACES.find((x) => x.id === picked)!; return (
            <div className="ly-place">
              <h3>{p.name}</h3><p>{p.note}</p>
              <div className="ly-actions">
                <button onClick={() => setPicked(null)}>Back</button>
                <button className="is-send" disabled={Boolean(sent)} onClick={() => void send(p.id)}>Send police here</button>
              </div>
            </div>
          ); })()}
        </section>
      )}

      {scene === 'lock' && (
        <section className="ly-lock">
          <p className="ly-time">1:12</p>
          <p className="ly-date">Friday, November 6</p>
          <div className="ly-incoming">
            <img src={`${API}/film/lily.jpg`} alt="" />
            <p className="ly-who">Lily</p>
            <p className="ly-what">FaceTime Video</p>
          </div>
          <div className="ly-answer">
            <button className="ly-decline" disabled aria-label="Decline">✕</button>
            <button className="ly-accept" disabled={!ready} onClick={accept} aria-label="Accept">{ready ? '✆' : '…'}</button>
          </div>
        </section>
      )}
      {toast && <p className="ly-toast">New clue · {toast}</p>}
    </main>
  );
}
