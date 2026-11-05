// The Vault: a command-post screen. Walter is live on the vault's intercom camera; the clock runs
// from 2:57 to 3:00. Every line you say goes to the server, which judges it, moves his trust and
// tells him what he may now share. The endings are his own, played live: he opens the door, or he
// switches the intercom off, or the clock runs out and the team goes in.
import { useCallback, useEffect, useRef, useState } from 'react';
import { MicIcon, useAvatar } from '../../../src/kit/index.ts';
import './vault.css';

const API = '/api/apps/the-vault';
type Ending = 'open' | 'off' | 'breach';
interface Note { id: string; note: string; said: string }
interface View { trust: number; read: string; state: string; notes: Note[]; ending?: Ending | null }
interface Film { ready: boolean; cast: boolean; deadline: number; endings: Record<Ending, { title: string; line: string }> }
type Scene = 'door' | 'connecting' | 'live' | 'ending' | 'end';

const READY_TIMEOUT_MS = 75_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const timeline: { at: number; what: string }[] = [];
const mark = (what: string) => { timeline.push({ at: Math.round(performance.now()), what }); console.log('[vault] %s', what); };
if (typeof window !== 'undefined') Object.assign(window, { __vault: timeline });
async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;

const OPENING = "The negotiator just connected to the vault intercom. You look up at the camera and say: \"You're the one they sent? You look young.\" Then ask who you are talking to.";
const FINALE: Record<Ending, string> = {
  open: 'You trust this negotiator now. Tell them, in your own words and briefly, that you are opening the door, and that they should look in box 1147 before anyone else does. Then stand up.',
  off: 'You have stopped trusting this negotiator. Say only, quietly: "I asked for someone who would listen." Then nothing more.',
  breach: "It is three o'clock. You hear them at the door. Say only, softly: \"Box eleven forty-seven. Somebody look.\"",
};

export function App() {
  const [film, setFilm] = useState<Film | null>(null);
  const [scene, setScene] = useState<Scene>('door');
  const [runId, setRunId] = useState('');
  const [view, setView] = useState<View | null>(null);
  const [known, setKnown] = useState<string[]>([]);
  const [left, setLeft] = useState(180);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [cut, setCut] = useState(false);
  const viewRef = useRef<View | null>(null);
  const endingRef = useRef<Ending | null>(null);
  const deadlineAt = useRef(0);
  const captionAt = useRef(0);
  const debug = typeof location !== 'undefined' && location.search.includes('debug');

  useEffect(() => { fetch(`${API}/film`).then((r) => r.json()).then(setFilm).catch(() => setFilm(null)); }, []);

  // ---- room sound
  const sounds = useRef<Record<string, HTMLAudioElement>>({});
  const play = useCallback((name: string, volume = 1, loop = false) => {
    const a = sounds.current[name] ?? (sounds.current[name] = new Audio(`${API}/film/${name}.mp3`));
    a.loop = loop; a.volume = volume; a.currentTime = 0; void a.play().catch(() => {});
    return a;
  }, []);
  const stop = (name: string) => { const a = sounds.current[name]; if (a) a.pause(); };

  const onUserSaid = useCallback((text: string) => {
    mark(`you: ${text}`);
    if (!runId || endingRef.current) return;
    void post<View>(`/run/${runId}/said`, { text }).then((v) => {
      viewRef.current = v; setView(v);
      avatarRef.current?.state(v.state);
      if (v.ending) void finish(v.ending);
    }).catch(() => {});
  }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onAvatarSaid = useCallback((text: string) => {
    mark(`walter: ${text}`);
    const v = viewRef.current;
    if (!v) return;
    for (const n of v.notes) if (new RegExp(n.said, 'i').test(text)) setKnown((k) => (k.includes(n.id) ? k : [...k, n.id]));
  }, []);

  const avatar = useAvatar(runId ? `the-vault/run/${runId}/walter` : 'the-vault', { onUserSaid, onAvatarSaid, onToolCall: () => 'Noted.' });
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;
  useEffect(() => { if (avatar.caption) captionAt.current = Date.now(); }, [avatar.caption]);

  // Wait until he has started and then finished a line.
  const lineDone = async (timeout: number, min = 0) => {
    const from = Date.now();
    while (Date.now() - from < timeout && captionAt.current < from) await sleep(100);
    await sleep(min);
    while (Date.now() - from < timeout && (avatarRef.current.speaking || Date.now() - captionAt.current < 1400)) await sleep(150);
  };

  // ---- the call
  const begin = async () => {
    setScene('connecting');
    play('static', 0.35, true);
    const run = await post<View & { id: string }>('/run');
    viewRef.current = run; setView(run); setRunId(run.id);
    mark('run');
  };
  // Connect once the run id has rebuilt the hook around the run's route.
  useEffect(() => {
    if (!runId || scene !== 'connecting') return;
    mark('connect');
    void avatarRef.current.start({ mic: true });
  }, [runId, scene]);
  useEffect(() => {
    if (scene !== 'connecting') return;
    const from = Date.now();
    const id = setInterval(() => {
      const a = avatarRef.current;
      if (a.phase === 'live' && (a.videoRef.current?.videoWidth ?? 0) > 0) {
        clearInterval(id);
        stop('static'); play('hum', 0.12, true);
        a.state(viewRef.current?.state ?? '');
        a.event(OPENING, 20);
        deadlineAt.current = Date.now() + (film?.deadline ?? 180) * 1000;
        mark('live');
        setScene('live');
      } else if (a.phase === 'failed' || a.phase === 'ended' || Date.now() - from > READY_TIMEOUT_MS) {
        clearInterval(id);
        mark(`connect failed: ${a.phase} ${a.errorCode ?? ''}`);
        stop('static');
        setScene('door');
      }
    }, 200);
    return () => clearInterval(id);
  }, [scene, film, play]);

  // ---- the clock
  useEffect(() => {
    if (scene !== 'live') return;
    const id = setInterval(() => {
      const s = Math.max(0, (deadlineAt.current - Date.now()) / 1000);
      setLeft(s);
      if (s <= 10 && s > 0 && Math.ceil(s) !== Math.ceil(s + 0.25)) play('tick', 0.5);
      if (s === 0 && !endingRef.current) {
        void post<View>(`/run/${runId}/deadline`).then((v) => finish(v.ending ?? 'breach')).catch(() => finish('breach'));
      }
    }, 250);
    return () => clearInterval(id);
  }, [scene, runId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function finish(e: Ending) {
    if (endingRef.current) return;
    endingRef.current = e;
    setEnding(e);
    mark(`ending ${e}`);
    setScene('ending');
    const a = avatarRef.current;
    a.setMic(false);
    if (e === 'breach') play('alarm', 0.5);
    a.interrupt(FINALE[e]);
    await lineDone(14000, 1500);
    await sleep(e === 'open' ? 1200 : 600);
    if (e === 'open') play('clunk', 0.9);
    if (e === 'breach') { play('static', 0.6); setCut(true); await sleep(1800); stop('static'); }
    if (e === 'off') { setCut(true); play('clunk', 0.4); }
    await sleep(e === 'open' ? 2200 : 1200);
    await a.end().catch(() => {});
    stop('hum'); stop('alarm');
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
  const urgent = left <= 30;
  const trust = view?.trust ?? 3;
  const notes = (view?.notes ?? []).filter((n) => known.includes(n.id));

  if (scene === 'door' || scene === 'end') {
    const fin = scene === 'end' && ending && film ? film.endings[ending] : null;
    return (
      <main className="vt vt-door">
        <div className="vt-card">
          <p className="vt-kicker">{fin ? 'Harlow Savings · 3:00 a.m.' : 'Harlow Savings · 2:57 a.m.'}</p>
          <h1>{fin ? fin.title : 'The Vault'}</h1>
          <p className="vt-lede">{fin ? fin.line : "The night guard has locked himself in the bank vault. Alone, unarmed, no demands. He asked for someone who'll listen. The team goes in at 3:00."}</p>
          {!fin && <p className="vt-how">You are the negotiator. Talk to him out loud. What you say decides how this ends.</p>}
          <button className="vt-go" disabled={!film?.cast} onClick={() => { endingRef.current = null; setEnding(null); setCut(false); setKnown([]); setLeft(film?.deadline ?? 180); void begin(); }}>
            {fin ? 'Take the call again' : 'Take the intercom'}
          </button>
          {film && !film.cast && <p className="vt-how">Walter is not set up on this server (THE_VAULT_WALTER).</p>}
        </div>
      </main>
    );
  }

  return (
    <main className={`vt vt-post${urgent ? ' is-urgent' : ''}`}>
      <section className="vt-feed">
        <div className={`vt-screen${cut ? ' is-cut' : ''}`}>
          <video ref={avatar.videoRef} autoPlay playsInline className={scene === 'connecting' ? 'is-hidden' : ''} />
          <audio ref={avatar.audioRef} autoPlay />
          {scene === 'connecting' && <div className="vt-snow"><span>Patching you into the vault intercom…</span></div>}
          {cut && <div className="vt-snow is-dead"><span>{ending === 'off' ? 'INTERCOM OFF' : 'NO SIGNAL'}</span></div>}
          <div className="vt-osd">
            <span className="vt-rec">● VAULT CAM 01</span>
            <span>{scene === 'connecting' ? '02:57:00' : `02:${String(57 + Math.floor((180 - left) / 60)).padStart(2, '0')}:${String(Math.floor((180 - left) % 60)).padStart(2, '0')}`}</span>
          </div>
          {avatar.caption && !cut && <p className="vt-sub">{avatar.caption}</p>}
        </div>
        <div className="vt-you">
          <span className={`vt-mic${avatar.micOn ? ' is-on' : ''}`}><MicIcon /></span>
          <span className="vt-turn">{scene === 'connecting' ? 'Connecting…' : scene === 'ending' ? '' : talking ? 'Walter is talking' : 'Your turn: talk to him'}</span>
          {avatar.heard && <span className="vt-heard">“{avatar.heard}”</span>}
        </div>
      </section>

      <aside className="vt-side">
        <div className="vt-clock">
          <p className="vt-label">Team goes in</p>
          <p className="vt-count">{mmss(left)}</p>
        </div>
        <div className="vt-read">
          <p className="vt-label">How he reads you</p>
          <div className="vt-meter">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < trust ? 'on' : ''} />)}</div>
          <p className="vt-readword">{view?.read ?? 'Guarded'}</p>
        </div>
        <div className="vt-file">
          <p className="vt-label">Case file · Walter Reyes, 58</p>
          <ul>
            <li>Night guard here, 20 years. No record.</li>
            <li>Alone in the vault. Unarmed. No demands.</li>
            {notes.map((n) => <li key={n.id} className="is-new">{n.note}</li>)}
          </ul>
        </div>
        {debug && <p className="vt-debug">trust {trust} · {avatar.phase} · {scene}</p>}
      </aside>
    </main>
  );
}
