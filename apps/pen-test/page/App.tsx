// The Pen Test: study a guest, open the conversation, sell the pen.
//
// Here the seller speaks first. Where the server takes `welcome: false` the guest simply waits.
// Elsewhere every avatar greets on arrival, so the guest arrives behind their still photo with the
// volume at zero, and the sound and the clock start once that greeting has passed.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackToApps, HostVideo, useAvatar, type ToolCall } from '../../../src/kit/index.ts';
import ray from '../host/ray.jpg';
import marisol from '../host/marisol.jpg';
import walter from '../host/walter.jpg';
import helen from '../host/helen.jpg';
import theo from '../host/theo.jpg';
import daniel from '../host/daniel.jpg';
import penPhoto from '../host/pen.jpg';
import './pen.css';

const API = '/api/apps/pen-test';
const IMAGES: Record<string, string> = { ray, marisol, walter, helen, theo, daniel };
// The join mute plus the agent linking the page: words before this are not heard.
const MIN_HIDDEN_MS = 8000;
const MAX_HIDDEN_MS = 16000;
const SLOW_MEET_MS = 45000;

interface Level { id: string; name: string; blurb: string; lowest: number; hints: number; seconds: number }
interface Pen { name: string; facts: string[]; list: number }
interface GuestView { id: string; name: string; role: string; spotted: string; image: string }
interface RoundView { index: number; guest: GuestView; outcome: string; offer: number | null; price: number | null; earned: number ; read?: { mood: string; meter: number; price: string | null } | null }
interface Clue { id: string; label: string; x: number; y: number; w: number; h: number; points: string }
interface Reveal {
  clues: Clue[]; keyClue: string; motive: string; top: number; left: number;
  score: { total: number; penalties: number }; falseClaims: string[]; coach: { did: string; improve: string[]; best: string; worst: string };
  board: { money: number; sold: number }; next: RoundView | null; view: RoundView;
}
interface Report { money: number; sold: number; left: number; skills: { label: string; score: number; max: number }[]; drill: string; delivery: { talkShare: number; questions: number; fillers: number }; guests: { name: string; outcome: string; did: string; improve: string[] }[] }
type Screen = 'door' | 'meet' | 'live' | 'read' | 'reveal' | 'report' | 'lost';

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

const clock = (s: number) => { const t = Math.max(0, s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

export function App() {
  const [pen, setPen] = useState<Pen | null>(null);
  const [levels, setLevels] = useState<Level[]>([]);
  const [level, setLevel] = useState<Level | null>(null);
  const [screen, setScreen] = useState<Screen>('door');
  const [runId, setRunId] = useState('');
  const [round, setRound] = useState<RoundView | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [left, setLeft] = useState(0);
  const [note, setNote] = useState('');
  const [stamp, setStamp] = useState('');
  const [slow, setSlow] = useState(false);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [board, setBoard] = useState({ money: 0, sold: 0 });
  const [sellerSpoke, setSellerSpoke] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [whisper, setWhisper] = useState('');
  const [nextGuest, setNextGuest] = useState<RoundView | null>(null);

  const live = useRef({ quietStart: false, arrived: false, finishing: false, liveAt: 0 });
  const roundPath = useRef('');
  const screenRef = useRef<Screen>('door');
  screenRef.current = screen;

  const finish = useRef<(reason: string) => void>(() => {});
  // The guest is gone: the stream stops at once, and the stamp stays up briefly over their photo.
  const walkedAway = useRef(() => {
    if (live.current.finishing) return;
    live.current.finishing = true;
    setStamp('WALKED AWAY');
    void avatarRef.current?.end();
    finish.current('walked');
  });

  const onUserSaid = useCallback(async (text: string) => {
    if (!live.current.arrived || live.current.finishing) return;
    setSellerSpoke(true);
    setNote('');
    const r = await post<{ view: RoundView; direction?: string; closing?: string; refused?: number }>(`${roundPath.current}/line`, { who: 'seller', text });
    setRound(r.view);
    if (r.view.price) setBoard((b) => ({ money: b.money + r.view.earned, sold: b.sold + 1 }));
    if (r.view.outcome === 'walked') return walkedAway.current();
    if (r.direction) avatarRef.current?.state(r.direction);
    if (r.refused) { setNote(`$${r.refused} is under your lowest price. That offer can't stand.`); setTimeout(() => setNote(''), 5000); }
    if (r.closing) {
      avatarRef.current?.event(r.closing, 10);
      setStamp(r.view.earned > (r.view.price ?? 0) ? `SOLD $${r.view.earned}` : `SOLD $${r.view.price}`);
      live.current.finishing = true;
      setTimeout(() => finish.current(r.view.outcome), 6000);
    }
  }, []);

  const onAvatarSaid = useCallback((text: string) => {
    if (!live.current.arrived) return;   // the greeting nobody heard
    void post(`${roundPath.current}/line`, { who: 'guest', text });
  }, []);

  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall) => {
    if (name !== 'decide') return 'Unknown tool.';
    const r = await post<{ view: RoundView }>(`${roundPath.current}/decide`, { choice: args.choice });
    if (r.view.outcome === 'walked') walkedAway.current();
    return 'Noted.';
  }, []);

  const onEnded = useCallback(() => {
    // The guest vanished mid-sale: the connection, not the seller.
    if (screenRef.current === 'live' && !live.current.finishing) { live.current.finishing = true; setScreen('lost'); }
  }, []);

  const avatar = useAvatar(round && runId ? `pen-test/run/${runId}/${round.index}` : 'pen-test', { onUserSaid, onAvatarSaid, onToolCall, onEnded });
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;

  // For recording a demo: `?script` lets a driver send the seller's lines as text.
  useEffect(() => {
    if (location.search.includes('script')) Object.assign(window, { __say: (text: string) => avatarRef.current.say(text) });
  }, []);

  useEffect(() => {
    fetch(`${API}/levels`).then((r) => r.json()).then((d) => { setPen(d.pen); setLevels(d.levels); setLevel(d.levels[0]); }).catch(() => setNote('The game did not load. Try again in a moment.'));
  }, []);

  // Set the guest's direction once they can hear it, then keep their voice off until the walk ends.
  const meet = useCallback(async (run: string, next: RoundView) => {
    live.current = { arrived: false, finishing: false, liveAt: 0, quietStart: false };
    roundPath.current = `/run/${run}/${next.index}`;
    setRound(next); setStamp(''); setNote(''); setSlow(false); setSellerSpoke(false); setReveal(null);
    setScreen('meet');
  }, []);

  // Starts each call once useAvatar points at this guest (the app id comes from the round).
  useEffect(() => {
    if (screen !== 'meet' || !round) return;
    let cancelled = false;
    const slowTimer = setTimeout(() => setSlow(true), SLOW_MEET_MS);
    void (async () => {
      const a = avatarRef.current;
      // Volume, not muted: LiveKit resets `muted` when it attaches the track.
      if (a.audioRef.current) a.audioRef.current.volume = 0;
      const { direction, quietStart } = await (await fetch(`${API}${roundPath.current}/direction`)).json();
      if (cancelled) return;
      live.current.quietStart = Boolean(quietStart);
      a.state(direction);
      await a.start({ mic: true });
    })();
    return () => { cancelled = true; clearTimeout(slowTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, round?.index, runId]);

  useEffect(() => {
    if (screen !== 'meet') return;
    if (avatar.phase === 'failed') { setNote(avatar.detail || 'We lost them in the crowd.'); setScreen('lost'); }
    if (avatar.phase === 'live' && !live.current.liveAt) live.current.liveAt = Date.now();
  }, [screen, avatar.phase, avatar.detail]);

  // The meeting starts once the hidden greeting has passed.
  useEffect(() => {
    if (screen !== 'meet') return;
    const id = setInterval(() => {
      const a = avatarRef.current;
      const since = live.current.liveAt && Date.now() - live.current.liveAt;
      if (!since || since < (live.current.quietStart ? 0 : MIN_HIDDEN_MS)) return;
      const video = a.videoRef.current;
      const faceReady = Boolean(video && video.videoWidth > 0);
      if ((!a.speaking && faceReady) || since > MAX_HIDDEN_MS) {
        clearInterval(id);
        live.current.arrived = true;
        setGreeting(a.caption);   // what was said before arrival is never shown
        if (a.audioRef.current) a.audioRef.current.volume = 1;
        setSeconds(level?.seconds ?? 60);
        setLeft(level?.seconds ?? 60);
        setScreen('live');
      }
    }, 250);
    return () => clearInterval(id);
  }, [screen, level]);

  useEffect(() => {
    if (screen !== 'live') return;
    // The clock stops once the round is decided: a sale or a walk is not a race against the stamp.
    const id = setInterval(() => { if (!live.current.finishing) setLeft((s) => s - 1); }, 1000);
    return () => clearInterval(id);
  }, [screen]);

  useEffect(() => {
    if (screen === 'live' && left <= 0 && !live.current.finishing) {
      live.current.finishing = true;
      setStamp("TIME'S UP");
      setTimeout(() => finish.current('time'), 1500);
    }
  }, [screen, left]);

  // A whisper from the manager when the seller stalls, on the levels that have them.
  useEffect(() => {
    if (screen !== 'live' || !level?.hints || sellerSpoke) return;
    const id = setTimeout(() => setWhisper('Manager: say something. Start with what you see.'), 10000);
    return () => { clearTimeout(id); setWhisper(''); };
  }, [screen, level, sellerSpoke]);

  finish.current = async (reason: string) => {
    const r = await post<{ view: RoundView; next: RoundView | null }>(`${roundPath.current}/finish`, { reason });
    await avatarRef.current.end().catch(() => {});
    setRound(r.view); setNextGuest(r.next); setScreen('read');
    const feedback = await post<Reveal>(`${roundPath.current}/feedback`);
    setReveal(feedback); setBoard(feedback.board); setScreen('reveal');
  };

  async function startRun() {
    if (!level) return;
    const run = await post<{ id: string; seconds: number; first: RoundView }>('/run', { level: level.id });
    setRunId(run.id);
    setBoard({ money: 0, sold: 0 });
    await meet(run.id, run.first);
  }

  async function goOn() {
    if (nextGuest) return meet(runId, nextGuest);
    setReport(await (await fetch(`${API}/run/${runId}/report`)).json());
    setScreen('report');
  }

  async function replay() {
    const r = await post<{ view: RoundView; board: { money: number; sold: number } }>(`${roundPath.current}/replay`);
    await avatarRef.current.end().catch(() => {});
    setBoard(r.board);
    await meet(runId, r.view);
  }

  const urgent = screen === 'live' && left <= 10;
  const inRoom = round && (screen === 'meet' || screen === 'live');
  const subtitle = screen === 'live' && avatar.caption !== greeting ? avatar.caption : '';

  return (
    <div className="pen">
      <header className="pen-bar">
        <BackToApps />
        <strong className="pen-logo">The Pen Test</strong>
        {screen !== 'door' && (
          <span className="pen-tally">
            {round && (
              <span className="pen-pips" aria-label={`Guest ${round.index + 1} of 3`}>
                {[0, 1, 2].map((i) => <i key={i} className={i < round.index ? 'is-done' : i === round.index ? 'is-now' : ''} />)}
              </span>
            )}
            <b>${board.money}</b>
          </span>
        )}
      </header>

      {screen === 'door' && pen && (
        <main className="pen-door">
          <div className="pen-pitch">
            <h1>Sell me this pen.</h1>
            <p>Three strangers, one pen, and a clock. Read each guest, ask the right question, and earn as much as you can.</p>
          </div>
          <div className="pen-lineup" aria-hidden="true">
            {[ray, helen, theo].map((src) => <img key={src} src={src} alt="" />)}
          </div>
          <section className="pen-panel pen-levelbox" aria-label="Level">
            <h2>Time with each guest</h2>
            <div className="pen-levels">
              {levels.map((l) => (
                <button type="button" key={l.id} className={l.id === level?.id ? 'is-on' : ''} onClick={() => setLevel(l)}>
                  <span className="pen-time">{clock(l.seconds)}</span>
                  <b>{l.name}</b>
                  <small>{l.blurb}</small>
                </button>
              ))}
            </div>
          </section>
          <section className="pen-tag pen-penbox" aria-label="The pen">
            <img className="pen-photo" src={penPhoto} alt="The Kestrel No. 4, a steel pen with a soft black grip" />
            <h2>{pen.name}</h2>
            <p className="pen-price">List ${pen.list}{level ? ` · lowest $${level.lowest}` : ''}</p>
            <ul>{pen.facts.map((f) => <li key={f}>{f}</li>)}</ul>
            <p className="pen-small">Claim anything else and you'll be called on it.</p>
          </section>
          <div className="pen-start">
            <button type="button" className="pen-go" onClick={() => void startRun()}>Meet your first guest</button>
            <span className="pen-small">Uses your microphone. You speak first.</span>
          </div>
          {note && <p className="pen-alert">{note}</p>}
        </main>
      )}

      {inRoom && round && (
        <main className="pen-room">
          <div className="pen-screen">
            <HostVideo avatar={avatar} name={round.guest.name} captions={false} className="pen-video" />
            {/* The photo covers the guest's arrival; once the meeting starts it is all live video. */}
            <img className={`pen-still ${screen === 'live' && stamp !== 'WALKED AWAY' ? 'is-off' : ''}`} src={IMAGES[round.guest.image]} alt={round.guest.name} />
            {screen === 'meet' && (
              <div className="pen-meet" role="status">
                <span className="call-spinner" aria-hidden="true" />
                <p>{slow ? 'Still getting them ready…' : round.guest.spotted}</p>
              </div>
            )}
            {screen === 'live' && !sellerSpoke && !subtitle && <p className="pen-cue">You speak first</p>}
            {subtitle && <p className="pen-subtitle">{subtitle}</p>}
            {stamp && <div className="pen-stamp">{stamp}</div>}
          </div>
          <div className={`pen-panel pen-clockbox ${urgent ? 'is-urgent' : ''}`}>
            <div className="pen-dial">
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle cx="60" cy="60" r="54" />
                <circle className="is-left" cx="60" cy="60" r="54" style={{ strokeDashoffset: 339.3 * (1 - (screen === 'live' && seconds ? Math.max(0, left) / seconds : 1)) }} />
              </svg>
              <div className="pen-clock" {...(screen === 'live' ? { 'data-testid': 'clock' } : {})}>{clock(screen === 'live' ? left : level?.seconds ?? 0)}</div>
            </div>
            <p className="pen-small">{screen === 'live' ? 'Time left' : 'Starts when they are ready'}</p>
          </div>
          <aside className="pen-info">
            <div className={`pen-panel pen-read${round.read ? ` is-${round.read.mood.toLowerCase()}` : ''}`} aria-live="polite">
              {round.read && (
                <>
                  <small>Read the guest</small>
                  <div className="pen-read-mood"><b>{round.read.mood}</b>{round.read.price && <span className={`pen-chip is-${round.read.price.replace(/ /g, '-').toLowerCase()}`}>{round.read.price}</span>}</div>
                  <div className="pen-meter"><i style={{ width: `${round.read.meter}%` }} /></div>
                </>
              )}
              <div className="pen-offer-row">
                <span><small>Your offer</small> <b>{round.offer ? `$${round.offer}` : `$${pen?.list}`}</b></span>
                <span><small>Lowest</small> <b>${level?.lowest}</b></span>
              </div>
            </div>
            <div className="pen-slot" aria-live="polite">
              {note ? <p className="pen-alert">{note}</p>
                : whisper ? <p className="pen-whisper">{whisper}</p>
                  : <p className="pen-heard"><small>You</small> {avatar.heard || '\u00a0'}</p>}
            </div>
            <div className="pen-tag">
              <img className="pen-photo" src={penPhoto} alt="The Kestrel No. 4, a steel pen with a soft black grip" />
              <h2>{pen?.name}</h2>
              <ul>{pen?.facts.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          </aside>
        </main>
      )}

      {(screen === 'read' || screen === 'reveal') && round && (
        <main className="pen-marking">
          <div className="pen-left">
            <figure className="pen-marked">
              <img src={IMAGES[round.guest.image]} alt={round.guest.name} />
              {reveal?.clues.filter((c) => c.w > 0).map((c) => <span key={c.id} className={`pen-circle ${c.id === reveal.keyClue ? 'is-key' : ''}`} style={{ left: `${c.x}%`, top: `${c.y}%`, width: `${c.w}%`, height: `${c.h}%` }} aria-hidden="true" />)}
            </figure>
            {stamp && <div className="pen-stamp">{stamp}</div>}
          </div>
          <div className="pen-panel pen-notes">
            {!reveal && (
              <p className="pen-writing"><span className="call-spinner" aria-hidden="true" /> Writing your feedback…</p>
            )}
            {reveal && (
              <>
                <div className="pen-head">
                  <h2>{reveal.view.outcome === 'sold' ? reveal.view.earned > (reveal.view.price ?? 0) ? `Bulk order: $${reveal.view.earned}` : `Sold at $${reveal.view.price}` : reveal.view.outcome === 'walked' ? `${round.guest.name} walked` : 'No sale'}</h2>
                  <p className="pen-score">{reveal.score.total}<small>/100</small></p>
                </div>
                <section className="pen-feedback">
                  <h3>What you did</h3>
                  <p>{reveal.coach.did}</p>
                  <h3>How to improve</h3>
                  <ul>{reveal.coach.improve.map((tip) => <li key={tip}>{tip}</li>)}</ul>
                </section>
                {reveal.falseClaims.length > 0 && <p className="pen-red">False claims: {reveal.falseClaims.join('; ')}</p>}
                <h3>What {round.guest.name} was hiding</h3>
                <p>{reveal.motive}.</p>
                <ul>{reveal.clues.map((c) => <li key={c.id} className={c.id === reveal.keyClue ? 'is-key' : ''}><b>{c.label}.</b> {c.points}</li>)}</ul>
                <p><b>{reveal.view.price ? `${round.guest.name} would have paid $${reveal.top}.` : `${round.guest.name} might have paid up to $${reveal.top}.`}</b> {reveal.view.price ? (reveal.left ? `$${reveal.left} left on the table.` : 'You left nothing on the table.') : ''}</p>
                {reveal.coach.best && <p><b>Best line:</b> "{reveal.coach.best}"</p>}
                {reveal.coach.worst && <p className="pen-red"><b>Worst line:</b> "{reveal.coach.worst}"</p>}
                <div className="pen-actions">
                  <button type="button" className="pen-go" onClick={() => void replay()}>Try again</button>
                  <button type="button" className="pen-go is-quiet" onClick={() => void goOn()}>{nextGuest ? 'Find another guest' : 'See your report card'}</button>
                </div>
              </>
            )}
          </div>
        </main>
      )}

      {screen === 'report' && report && (
        <main className="pen-page pen-panel">
          <p className="pen-money">${report.money}</p>
          <h2>{report.sold} of 3 pens sold · ${report.left} left on the table</h2>
          <div className="pen-skills">
            {report.skills.map((s) => (
              <div key={s.label}><span>{s.label}</span><meter min={0} max={s.max} value={s.score} /><b>{s.score}/{s.max}</b></div>
            ))}
          </div>
          <p>You did {report.delivery.talkShare}% of the talking, asked {report.delivery.questions} questions, and used {report.delivery.fillers} filler words.</p>
          {report.guests.map((g) => (
            <section key={g.name} className="pen-feedback">
              <h3>{g.name}</h3>
              <p>{g.did}</p>
              <ul>{g.improve.map((tip) => <li key={tip}>{tip}</li>)}</ul>
            </section>
          ))}
          <p className="pen-drill"><b>Next drill:</b> {report.drill}</p>
          <button type="button" className="pen-go" onClick={() => { setScreen('door'); setRound(null); }}>Try again</button>
        </main>
      )}

      {screen === 'lost' && (
        <main className="pen-page pen-panel">
          <h2>{note ? 'The call didn\'t start' : 'We lost the connection'}</h2>
          <p>{note || 'This one doesn\'t count against you.'}</p>
          <button type="button" className="pen-go" onClick={() => void replay()}>Try this guest again</button>
        </main>
      )}
    </div>
  );
}
