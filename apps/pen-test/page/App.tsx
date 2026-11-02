// The Pen Test: walk the mall, spot a guest, open the conversation, sell the pen.
//
// The platform has every avatar greet when it arrives, and here the seller speaks first. So the
// guest arrives behind the mall walk, with sound off and the seller's mic closed. Once that
// greeting has passed the walk ends, the mic opens and the clock starts. The seller never hears it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackToApps, HostVideo, useAvatar, type ToolCall } from '../../../src/kit/index.ts';
import ray from '../host/ray.jpg';
import marisol from '../host/marisol.jpg';
import walter from '../host/walter.jpg';
import mall from '../host/mall.jpg';
import hand from '../host/hand.webp';
import './pen.css';

const API = '/api/apps/pen-test';
const IMAGES: Record<string, string> = { ray, marisol, walter };
// The join mute plus the agent linking the page: words before this are not heard.
const MIN_HIDDEN_MS = 8000;
const MAX_HIDDEN_MS = 16000;
const SLOW_WALK_MS = 45000;

interface Level { id: string; name: string; blurb: string; lowest: number; hints: number; seconds: number }
interface Pen { name: string; facts: string[]; list: number }
interface GuestView { id: string; name: string; role: string; spotted: string; image: string }
interface RoundView { index: number; guest: GuestView; outcome: string; offer: number | null; price: number | null }
interface Clue { id: string; label: string; x: number; y: number; points: string }
interface Reveal {
  clues: Clue[]; keyClue: string; motive: string; top: number; left: number; read: { motive: boolean; clue: boolean };
  score: { total: number; penalties: number }; falseClaims: string[]; coach: { best: string; worst: string; note: string };
  board: { money: number; sold: number }; next: RoundView | null; view: RoundView;
}
interface Report { money: number; sold: number; left: number; skills: { label: string; score: number; max: number }[]; drill: string; delivery: { talkShare: number; questions: number; fillers: number } }
type Screen = 'door' | 'walk' | 'live' | 'read' | 'reveal' | 'report' | 'lost';

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

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
  const [options, setOptions] = useState<{ motives: string[]; clues: { id: string; label: string }[] } | null>(null);
  const [pick, setPick] = useState<{ motive?: string; clue?: string }>({});
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [board, setBoard] = useState({ money: 0, sold: 0 });
  const [sellerSpoke, setSellerSpoke] = useState(false);

  const live = useRef({ arrived: false, finishing: false, liveAt: 0 });
  const roundPath = useRef('');
  const screenRef = useRef<Screen>('door');
  screenRef.current = screen;

  const finish = useRef<(reason: string) => void>(() => {});

  const onUserSaid = useCallback(async (text: string) => {
    if (!live.current.arrived || live.current.finishing) return;
    setSellerSpoke(true);
    setNote('');
    const r = await post<{ view: RoundView; direction?: string; closing?: string; refused?: number }>(`${roundPath.current}/line`, { who: 'seller', text });
    setRound(r.view);
    if (r.view.price) setBoard((b) => ({ money: b.money + r.view.price!, sold: b.sold + 1 }));
    if (r.direction) avatarRef.current?.state(r.direction);
    if (r.refused) { setNote(`$${r.refused} is under your lowest price. That offer can't stand.`); setTimeout(() => setNote(''), 5000); }
    if (r.closing) {
      avatarRef.current?.event(r.closing, 10);
      setStamp(r.view.outcome === 'sold' ? `SOLD $${r.view.price}` : 'WALKED AWAY');
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
    if (r.view.outcome === 'walked' && !live.current.finishing) {
      live.current.finishing = true;
      setStamp('WALKED AWAY');
      setTimeout(() => finish.current('walked'), 3500);
    }
    return 'Noted.';
  }, []);

  const onEnded = useCallback(() => {
    // The guest vanished mid-sale: the connection, not the seller.
    if (screenRef.current === 'live' && !live.current.finishing) { live.current.finishing = true; setScreen('lost'); }
  }, []);

  const avatar = useAvatar(round && runId ? `pen-test/run/${runId}/${round.index}` : 'pen-test', { onUserSaid, onAvatarSaid, onToolCall, onEnded });
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;

  useEffect(() => {
    fetch(`${API}/levels`).then((r) => r.json()).then((d) => { setPen(d.pen); setLevels(d.levels); setLevel(d.levels[0]); }).catch(() => setNote('The mall is closed right now. Try again in a moment.'));
  }, []);

  // Set the guest's direction once they can hear it, then keep their voice off until the walk ends.
  const meet = useCallback(async (run: string, next: RoundView) => {
    live.current = { arrived: false, finishing: false, liveAt: 0 };
    roundPath.current = `/run/${run}/${next.index}`;
    setRound(next); setStamp(''); setNote(''); setSlow(false); setSellerSpoke(false); setPick({}); setReveal(null); setOptions(null);
    setScreen('walk');
  }, []);

  // Starts each call once useAvatar points at this guest (the app id comes from the round).
  useEffect(() => {
    if (screen !== 'walk' || !round) return;
    let cancelled = false;
    const slowTimer = setTimeout(() => setSlow(true), SLOW_WALK_MS);
    void (async () => {
      const a = avatarRef.current;
      if (a.audioRef.current) a.audioRef.current.muted = true;
      const { direction } = await (await fetch(`${API}${roundPath.current}/direction`)).json();
      if (cancelled) return;
      a.state(direction);
      await a.start({ mic: true, micMuted: true });
    })();
    return () => { cancelled = true; clearTimeout(slowTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, round?.index, runId]);

  useEffect(() => {
    if (screen !== 'walk') return;
    if (avatar.phase === 'failed') { setNote(avatar.detail || 'We lost them in the crowd.'); setScreen('lost'); }
    if (avatar.phase === 'live' && !live.current.liveAt) live.current.liveAt = Date.now();
  }, [screen, avatar.phase, avatar.detail]);

  // The walk ends once the hidden greeting has passed.
  useEffect(() => {
    if (screen !== 'walk') return;
    const id = setInterval(() => {
      const a = avatarRef.current;
      const since = live.current.liveAt && Date.now() - live.current.liveAt;
      if (!since || since < MIN_HIDDEN_MS) return;
      const video = a.videoRef.current;
      const faceReady = Boolean(video && video.videoWidth > 0);
      if ((!a.speaking && faceReady) || since > MAX_HIDDEN_MS) {
        clearInterval(id);
        live.current.arrived = true;
        if (a.audioRef.current) a.audioRef.current.muted = false;
        a.setMic(true);
        setSeconds(level?.seconds ?? 60);
        setLeft(level?.seconds ?? 60);
        setScreen('live');
      }
    }, 250);
    return () => clearInterval(id);
  }, [screen, level]);

  useEffect(() => {
    if (screen !== 'live') return;
    const id = setInterval(() => setLeft((s) => s - 1), 1000);
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
    const id = setTimeout(() => setNote('Manager: say something. Start with what you see.'), 6000);
    return () => clearTimeout(id);
  }, [screen, level, sellerSpoke]);

  finish.current = async (reason: string) => {
    const r = await post<{ view: RoundView; read: { motives: string[]; clues: { id: string; label: string }[] } }>(`${roundPath.current}/finish`, { reason });
    await avatarRef.current.end().catch(() => {});
    setRound(r.view); setOptions(r.read); setScreen('read');
  };

  async function startRun() {
    if (!level) return;
    const run = await post<{ id: string; seconds: number; first: RoundView }>('/run', { level: level.id });
    setRunId(run.id);
    setBoard({ money: 0, sold: 0 });
    await meet(run.id, run.first);
  }

  async function submitRead() {
    const r = await post<Reveal>(`${roundPath.current}/read`, pick);
    setReveal(r); setBoard(r.board); setScreen('reveal');
  }

  async function goOn() {
    if (reveal?.next) return meet(runId, reveal.next);
    setReport(await (await fetch(`${API}/run/${runId}/report`)).json());
    setScreen('report');
  }

  async function replay() {
    const r = await post<{ view: RoundView }>(`${roundPath.current}/replay`);
    await avatarRef.current.end().catch(() => {});
    await meet(runId, r.view);
  }

  const urgent = screen === 'live' && left <= 10;
  const close = stamp || screen === 'read';

  return (
    <div className={`pen is-${screen}`}>
      <img className="pen-world" src={mall} alt="" aria-hidden="true" />

      {screen === 'door' && pen && (
        <main className="pen-door">
          <header className="pen-bar"><BackToApps /></header>
          <div className="pen-pitch">
            <p className="pen-kicker">The Pen Test</p>
            <h1>Sell me this pen.</h1>
            <p>One pen. Three strangers in a mall. Walk up, read them, and earn as much as you can.</p>
          </div>
          <div className="pen-choices">
            <section className="pen-levels" aria-label="How long you get with each guest">
              {levels.map((l) => (
                <button type="button" key={l.id} className={l.id === level?.id ? 'is-on' : ''} onClick={() => setLevel(l)}>
                  <span className="pen-time">{clock(l.seconds)}</span><b>{l.name}</b><small>{l.blurb}</small>
                </button>
              ))}
            </section>
            <section className="pen-tag" aria-label="The pen">
              <h2>{pen.name}</h2>
              <p className="pen-price">List ${pen.list}{level ? ` · lowest $${level.lowest}` : ''}</p>
              <ul>{pen.facts.map((f) => <li key={f}>{f}</li>)}</ul>
            </section>
          </div>
          <div className="pen-start">
            <button type="button" className="pen-go" onClick={() => void startRun()}>Walk into the mall</button>
            <span>Microphone on. You speak first.</span>
          </div>
          {note && <p className="pen-note">{note}</p>}
          <img className="pen-hand" src={hand} alt="" aria-hidden="true" />
        </main>
      )}

      {round && (screen === 'walk' || screen === 'live') && (
        <main className="pen-floor">
          <div className={`pen-stage is-${round.guest.id}`}>
            <HostVideo avatar={avatar} name={round.guest.name} captions={false} className="pen-video" />
            {/* Live video can lose a photorealistic guest while they listen, so they hold still until they speak. */}
            <img className={`pen-hold ${avatar.speaking ? 'is-off' : ''}`} src={IMAGES[round.guest.image]} alt="" aria-hidden="true" />
          </div>
          {screen === 'live' && sellerSpoke && avatar.caption && <p className="pen-subtitle">{avatar.caption}</p>}
          {screen === 'walk' && (
            <div className="pen-walk" role="status">
              <img className="pen-stroll" src={mall} alt="" />
              <img className={`pen-approach is-${round.guest.id}`} src={IMAGES[round.guest.image]} alt={`${round.guest.name} ahead in the mall`} />
              <p>{slow ? "The mall's busy. Still looking for them…" : round.guest.spotted}</p>
            </div>
          )}
          {stamp && <div className="pen-stamp">{stamp}</div>}
          {screen === 'live' && (
            <>
              <div className={`pen-clock ${urgent ? 'is-urgent' : ''}`} data-testid="clock">{clock(left)}</div>
              <div className="pen-tally">{board.sold} sold · ${board.money}<small>Guest {round.index + 1} of 3</small></div>
              {!sellerSpoke && <p className="pen-cue">You speak first</p>}
              {note && <p className="pen-note">{note}</p>}
              {avatar.heard && <p className="pen-heard">{avatar.heard}</p>}
              <aside className="pen-tag is-held">
                <p className="pen-price">Offer {round.offer ? `$${round.offer}` : `$${pen?.list}`} · lowest ${level?.lowest}</p>
                <ul>{pen?.facts.map((f) => <li key={f}>{f}</li>)}</ul>
              </aside>
            </>
          )}
          <img className={`pen-hand ${close ? 'is-down' : ''}`} src={hand} alt="" aria-hidden="true" />
        </main>
      )}

      {screen === 'read' && round && options && (
        <main className="pen-sheet">
          <p className="pen-kicker">Before you walk on</p>
          <h2>What did you read in {round.guest.name}?</h2>
          <h3>What were they really after?</h3>
          <div className="pen-chips">{options.motives.map((m) => <button type="button" key={m} className={pick.motive === m ? 'is-on' : ''} onClick={() => setPick((p) => ({ ...p, motive: m }))}>{m}</button>)}</div>
          <h3>Which clue told you?</h3>
          <div className="pen-chips">{options.clues.map((c) => <button type="button" key={c.id} className={pick.clue === c.id ? 'is-on' : ''} onClick={() => setPick((p) => ({ ...p, clue: c.id }))}>{c.label}</button>)}</div>
          <button type="button" className="pen-go" disabled={!pick.motive || !pick.clue} onClick={() => void submitRead()}>See what you missed</button>
        </main>
      )}

      {screen === 'reveal' && reveal && round && (
        <main className="pen-marking">
          <figure className="pen-marked">
            <img src={IMAGES[round.guest.image]} alt={round.guest.name} />
            {reveal.clues.map((c) => <span key={c.id} className={`pen-circle ${c.id === reveal.keyClue ? 'is-key' : ''}`} style={{ left: `${c.x}%`, top: `${c.y}%` }} aria-hidden="true" />)}
          </figure>
          <div className="pen-notes">
            <div className="pen-head">
              <h2>{reveal.view.outcome === 'sold' ? `Sold at $${reveal.view.price}` : reveal.view.outcome === 'walked' ? `${round.guest.name} walked` : 'No sale'}</h2>
              <p className="pen-score">{reveal.score.total}<small>/100</small></p>
            </div>
            <p><b>Real reason:</b> {reveal.motive} <span className={reveal.read.motive ? 'pen-ok' : 'pen-red'}>{reveal.read.motive ? 'You read it.' : 'You missed it.'}</span></p>
            <ul>{reveal.clues.map((c) => <li key={c.id} className={c.id === reveal.keyClue ? 'is-key' : ''}><b>{c.label}.</b> {c.points}</li>)}</ul>
            <p><b>{reveal.view.price ? `${round.guest.name} would have paid $${reveal.top}.` : `${round.guest.name} might have paid up to $${reveal.top}.`}</b> {reveal.view.price ? (reveal.left ? `$${reveal.left} left on the table.` : 'You left nothing on the table.') : ''}</p>
            {reveal.falseClaims.length > 0 && <p className="pen-red">False claims: {reveal.falseClaims.join('; ')}</p>}
            {reveal.coach.best && <p><b>Best line:</b> "{reveal.coach.best}"</p>}
            {reveal.coach.worst && <p className="pen-red"><b>Worst line:</b> "{reveal.coach.worst}"</p>}
            {reveal.coach.note && <p>{reveal.coach.note}</p>}
            <button type="button" className="pen-go" onClick={() => void goOn()}>{reveal.next ? 'Back into the mall' : 'See your report card'}</button>
          </div>
        </main>
      )}

      {screen === 'report' && report && (
        <main className="pen-sheet">
          <p className="pen-kicker">End of shift</p>
          <p className="pen-money">${report.money}</p>
          <h2>{report.sold} of 3 pens sold · ${report.left} left on the table</h2>
          <div className="pen-skills">
            {report.skills.map((s) => (
              <div key={s.label}><span>{s.label}</span><meter min={0} max={s.max} value={s.score} /><b>{s.score}/{s.max}</b></div>
            ))}
          </div>
          <p>You did {report.delivery.talkShare}% of the talking, asked {report.delivery.questions} questions, and used {report.delivery.fillers} filler words.</p>
          <p className="pen-drill"><b>Next drill:</b> {report.drill}</p>
          <button type="button" className="pen-go" onClick={() => { setScreen('door'); setRound(null); }}>Try another run</button>
        </main>
      )}

      {screen === 'lost' && (
        <main className="pen-sheet">
          <h2>You lost them in the crowd</h2>
          <p>{note || 'The connection dropped. This one doesn\'t count against you.'}</p>
          <button type="button" className="pen-go" onClick={() => void replay()}>Find them again</button>
        </main>
      )}
    </div>
  );
}
