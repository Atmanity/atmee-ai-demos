// The Late Line: Jada Monroe hosts a late-night talk show and video-calls a
// guest, both avatars, on speech-to-speech. Each avatar has a speech session
// (show/speech.ts) and a face, an avatar-only render; the two faces share one
// LiveKit room of the site's own. The page wires them: each avatar's voice is
// what the other hears, and what its own face says. The person at the page
// is the producer: they never speak; they choose the topics, and Jada opens
// each one with the guest.
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackToApps, clock, useAvatarOnly, type AvatarOnly, type SpeechWriter } from '../../../src/kit/index.ts';
import { createBooth, type Booth, type Role, type Stage } from '../show/booth.ts';
import { GUESTS, HOST, SHOW, firstName, type Guest } from '../show/cast.ts';
import { goodbyeCue, inviteCue, noteCue, nudgeCue, topicCue, welcomeCue, wrapCue } from '../show/script.ts';
import { openSpeech, SpeechError, type SpeechLine } from '../show/speech.ts';
import { createResampler, createVoice } from '../show/voice.ts';
import jada from '../host/portrait.jpg';
import otto from '../guests/otto.jpg';
import rosa from '../guests/rosa.jpg';
import './late-line.css';

const API = '/api/apps/tv-show-live';
const PORTRAITS: Record<string, string> = { otto, rosa };
const END_AFTER_GOODBYE_MS = 4_000;

const STAGE_TEXT: Record<Stage, string> = {
  greeting: 'Jada is opening the show',
  inviting: 'Jada is inviting the guest on',
  dialing: 'Putting the guest through…',
  'on-air': 'On air',
  closing: 'Wrapping up',
  over: 'Off air',
};

interface LogLine { id: number; who: Role | 'booth'; text: string }

// Each avatar's voice reaches its face as ONE stream for the whole show,
// silence included. Measured live against the raw voice: a piece per stretch
// of speech lost 1.3 s of 13.8 s to dropouts (every new piece starts the
// renderer cold); one stream lost 0.05 s of 13.4 s.
const WRITE_SAMPLES = 1600;   // 100 ms at 16 kHz per write: fewer, larger packets

/**
 * Hands one avatar's voice to its face. The face opens a piece asynchronously,
 * so frames wait for it; writes go out one after another, in order, in 100 ms chunks.
 */
function faceFeeder(face: () => AvatarOnly) {
  let writer: Promise<SpeechWriter | null> | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  let pending: Int16Array[] = [];
  let pendingSamples = 0;
  const flush = () => {
    if (!pendingSamples || !writer) return;
    const pcm = new Int16Array(pendingSamples);
    let at = 0;
    for (const p of pending) { pcm.set(p, at); at += p.length; }
    pending = []; pendingSamples = 0;
    const w = writer;
    chain = chain.then(() => w.then((x) => x?.write(pcm))).catch(() => {});
  };
  return {
    get open() { return writer !== null; },
    start() { writer = face().open(); },
    frame(pcm: Int16Array) {
      if (!writer) return;
      pending.push(pcm); pendingSamples += pcm.length;
      if (pendingSamples >= WRITE_SAMPLES) flush();
    },
    end() {
      flush();
      const w = writer;
      writer = null;
      chain = chain.then(() => w?.then((x) => x?.end())).catch(() => {});
    },
  };
}

export function App() {
  const [guestId, setGuestId] = useState(GUESTS[0].id);
  const guest = GUESTS.find((g) => g.id === guestId)!;
  const [topics, setTopics] = useState<string[]>(guest.rundown);
  const [showId, setShowId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('greeting');
  const [patched, setPatched] = useState(false);
  const [used, setUsed] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<LogLine[]>([]);
  const [problem, setProblem] = useState('');
  const [onShow, setOnShow] = useState(false);
  const logId = useRef(0);
  const addLog = (who: LogLine['who'], text: string) => setLog((l) => [...l.slice(-150), { id: ++logId.current, who, text }]);

  // A ref, not the state: the booth's callbacks are made before the show has its id.
  const showRef = useRef<string | null>(null);
  const seatApi = (seat: Role) => `${API}/show/${showRef.current}/${seat}`;
  const hostFace = useAvatarOnly(showId ? `tv-show-live/show/${showId}/host` : 'tv-show-live');
  const guestFace = useAvatarOnly(showId ? `tv-show-live/show/${showId}/guest` : 'tv-show-live');
  const faces = useRef<Record<Role, AvatarOnly>>({ host: hostFace, guest: guestFace });
  faces.current = { host: hostFace, guest: guestFace };

  const booth = useRef<Booth | null>(null);
  const lines = useRef<Partial<Record<Role, SpeechLine>>>({});
  const words = useRef<Record<Role, string>>({ host: '', guest: '' });
  const segment = useRef<Guest | null>(null);
  const firstTopic = useRef('');

  // Each avatar's voice: its face says it, the other avatar hears it, and the booth sees when it speaks.
  const voices = useMemo(() => {
    const make = (role: Role) => {
      const feeder = faceFeeder(() => faces.current[role]);
      const resample = createResampler();
      const voice = createVoice({
        // The voice's pieces say when the avatar speaks, for the booth and the transcript.
        onStart() { booth.current?.speaking(role, true); },
        onFrame() {},
        onEnd() {
          booth.current?.speaking(role, false);
          const said = words.current[role].trim();
          words.current[role] = '';
          if (said) addLog(role, said);
        },
      });
      return {
        feed(pcm: Int16Array) {
          voice.feed(pcm);
          // One stream for the whole show, from the first frame once the face is up.
          if (!feeder.open && faces.current[role].phase === 'live') feeder.start();
          feeder.frame(resample(pcm));
        },
        flush() { voice.flush(); feeder.end(); },
      };
    };
    return { host: make('host'), guest: make('guest') };
  }, []);

  async function openSeat(role: Role) {
    const other: Role = role === 'host' ? 'guest' : 'host';
    try {
      const line = await openSpeech(seatApi(role), {
        onAudio(b64, pcm) {
          voices[role].feed(pcm);
          lines.current[other]?.hear(b64);
        },
        onWords(delta) { words.current[role] += delta; },
        onClosed(reason) { if (booth.current && booth.current.stage !== 'over') offAir(`${role === 'host' ? HOST.name : segment.current?.name} left the line (${reason}).`); },
        onError(message) { console.warn('[late-line] %s: %s', role, message); },
      });
      lines.current[role] = line;
      if (role === 'host') booth.current?.hostLive();
      else { setPatched(true); booth.current?.guestLive(); }
    } catch (err) {
      offAir(`We couldn't open ${role === 'host' ? HOST.name : segment.current?.name}'s line: ${(err as SpeechError).code ?? (err as Error).message}`);
    }
  }

  // Both faces first, backstage (they take longest); the show starts, with Jada's line, only once
  // both are up, so nothing on screen is still loading. The guest's face waits, its TV off, until
  // Jada invites them on.
  useEffect(() => {
    if (!showId) return;
    void hostFace.start();
    void guestFace.start();
  }, [showId]);
  const hostOpened = useRef(false);
  const [backstage, setBackstage] = useState(true);
  useEffect(() => {
    if (hostFace.phase !== 'live' || guestFace.phase !== 'live' || hostOpened.current || !booth.current) return;
    hostOpened.current = true;
    setBackstage(false);
    void openSeat('host');
  }, [hostFace.phase, guestFace.phase]);
  useEffect(() => {
    if (!onShow) return;
    const failed = hostFace.phase === 'failed' ? hostFace : guestFace.phase === 'failed' ? guestFace : null;
    if (failed) offAir(failed.detail || 'A face could not start.');
  }, [hostFace.phase, guestFace.phase]);
  useEffect(() => {
    if (stage !== 'over' || !onShow) return;
    const id = setTimeout(() => void wrapUp(), END_AFTER_GOODBYE_MS);
    return () => clearTimeout(id);
  }, [stage, onShow]);
  useEffect(() => { setTopics(guest.rundown); }, [guestId]);

  function offAir(why: string) {
    if (!booth.current) return;
    const wasOver = booth.current.stage === 'over';
    booth.current.close();
    if (!wasOver) setProblem(why);
    void wrapUp();
  }

  async function wrapUp() {
    booth.current?.close();
    voices.host.flush();
    voices.guest.flush();
    await Promise.allSettled([lines.current.host?.end(), lines.current.guest?.end(), faces.current.host.end(), faces.current.guest.end()]);
    lines.current = {};
    if (showRef.current) void fetch(`${API}/show/${showRef.current}/end`, { method: 'POST', keepalive: true }).catch(() => {});
  }

  async function goOnAir(first: string) {
    setProblem(''); setLog([]); setUsed(new Set([first])); setPatched(false); setStage('greeting');
    hostOpened.current = false;
    segment.current = guest;
    firstTopic.current = first;
    setBackstage(true);
    booth.current = createBooth({
      invite: inviteCue(guest),
      welcome: welcomeCue(guest, first),
      nudge: nudgeCue(guest),
      wrap: wrapCue(guest),
      goodbye: goodbyeCue,
      deliver({ to, kind, text }) {
        // For tests and analytics: everything the booth hands either avatar, as a window event.
        dispatchEvent(new CustomEvent('late-line:booth', { detail: { to, kind, text } }));
        const line = lines.current[to];
        if (!line) return void console.warn('[late-line] no line for %s yet: %s dropped', to, kind);
        if (kind === 'directive') line.directive(text);
        else line.commentary(text);
      },
      dialGuest: () => void openSeat('guest'),
      onStage: setStage,
    });
    addLog('booth', `First topic: ${first}`);
    const res = await fetch(`${API}/shows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guest: guest.id }) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) return setProblem(json.message || json.error || 'We could not book the studio.');
    showRef.current = json.showId;
    setOnShow(true);
    setShowId(json.showId);
  }

  const sendTopic = (topic: string) => {
    if (!booth.current || !segment.current) return;
    booth.current.cue(topicCue(segment.current, topic));
    setUsed((u) => new Set(u).add(topic));
    addLog('booth', `Topic for Jada: ${topic}`);
  };
  const sendNote = (text: string) => { booth.current?.cue(noteCue(text)); addLog('booth', `Note for Jada: ${text}`); };
  const wrap = () => { booth.current?.wrap(); addLog('booth', 'Wrap it up'); };
  const endShow = () => { offAir(''); setStage('over'); };
  const backToLobby = () => { booth.current = null; setOnShow(false); setShowId(null); };

  const done = (p: AvatarOnly['phase']) => p === 'ended' || p === 'failed' || p === 'idle';
  const allDone = done(hostFace.phase) && done(guestFace.phase);

  return (
    <div className="nc-app ll">
      <header className="nc-bar">
        <BackToApps avatar={hostFace} name="Jada and the guest" className="nc-back" />
        <Logo />
        {onShow && (
          <span className={`nc-air ${stage === 'on-air' || stage === 'closing' ? 'is-on' : ''}`}>
            <span className="nc-air-dot" />{stage === 'on-air' || stage === 'closing' ? 'On air' : STAGE_TEXT[stage]}
          </span>
        )}
        {onShow && hostFace.secondsLeft !== null && <span className="nc-clock">{clock(hostFace.secondsLeft)}</span>}
      </header>

      {!onShow ? (
        <Lobby guestId={guestId} setGuestId={setGuestId} topics={topics} setTopics={setTopics} onGo={goOnAir} problem={problem} />
      ) : (
        <main className="nc-show">
          <Program host={hostFace} guest={guestFace} guestInfo={guest} patched={patched} stage={stage} backstage={backstage}
            next={[...topics].find((t) => !used.has(t))} />
          <section className="nc-booth" aria-label="The booth">
            <div className="nc-booth-head">
              <h2>The booth</h2>
              <span className="nc-stage-text">{STAGE_TEXT[stage]}</span>
            </div>
            {problem && <p className="nc-problem" role="alert">{problem}</p>}
            {stage === 'over' && allDone ? (
              <div className="nc-after">
                <p>That's the show.</p>
                <button type="button" className="nc-btn nc-primary" onClick={backToLobby}>Book another guest</button>
              </div>
            ) : (
              <Console topics={topics} used={used} disabled={stage !== 'on-air'} onTopic={sendTopic} onNote={sendNote}
                onWrap={wrap} onEnd={endShow} guestFirst={firstName(guest.name)} />
            )}
          </section>
          <section className="nc-transcript" aria-label="On air">
            <h2>On air</h2>
            <Transcript log={log} guest={guest} />
          </section>
        </main>
      )}
    </div>
  );
}

function Logo() {
  return <span className="nc-logo"><span className="ll-mark" aria-hidden="true" />The Late <b>Line</b></span>;
}

function Face({ face, poster }: { face: AvatarOnly; poster: string }) {
  return (
    <div className="ll-face">
      <img className="ll-poster" src={poster} alt="" aria-hidden="true" />
      <video ref={face.videoRef} playsInline muted autoPlay />
      <audio ref={face.audioRef} autoPlay />
    </div>
  );
}

// The program picture: Jada's shot is the studio, and the set carries on to
// her left, where the guest is on a flat-panel TV on the wall, angled toward
// her: a thin bezel, glass glare, a pixel grid, the screen's light on the wall.
function Program({ host, guest, guestInfo, patched, stage, backstage, next }: {
  host: AvatarOnly; guest: AvatarOnly; guestInfo: Guest; patched: boolean; stage: Stage; backstage: boolean; next?: string;
}) {
  const g = firstName(guestInfo.name);
  const live = stage === 'on-air' || stage === 'closing';
  // One card for the whole studio until both faces are up: the slower one's state, never two spinners.
  const failed = [host, guest].find((f) => f.phase === 'failed');
  const slower = [host, guest].find((f) => f.phase !== 'live');
  const backstageText = failed ? failed.detail : slower?.phase === 'warming' ? 'Warming up the cameras…' : 'Getting the studio ready…';
  const onScreen = patched && guest.phase === 'live';
  const screen = onScreen ? null : stage === 'dialing' ? `Calling ${g}…` : 'Stand by';
  return (
    <section className="nc-program ll-tv-program" aria-label="The show, as it goes out">
      <div className="nc-set" aria-hidden="true" style={{ backgroundImage: `url(${jada})` }} />
      <div className={`tv-spill ${onScreen ? 'is-on' : ''}`} aria-hidden="true" />
      <div className="tv">
        <div className="tv-mount" aria-hidden="true" />
        <div className="tv-body">
          <div className={`tv-panel ${onScreen ? 'is-on' : ''}`}>
            <Face face={guest} poster={PORTRAITS[guestInfo.id]} />
            {screen && !backstage && <div className="tv-idle" role="status"><span className="ll-mark" aria-hidden="true" /><strong>{screen}</strong></div>}
            {onScreen && <span className="tv-live"><span className="nc-rec" />Live · via video call</span>}
            {onScreen && <span className="tv-name"><strong>{guestInfo.name}</strong><span>{guestInfo.billing}</span></span>}
            <span className="tv-grid" aria-hidden="true" />
            <span className="tv-glare" aria-hidden="true" />
          </div>
          <span className="tv-led" aria-hidden="true" />
        </div>
      </div>
      <div className="nc-hostcam">
        <Face face={host} poster={jada} />
      </div>
      {backstage && (
        <div className="ll-backstage" role="status">
          {!failed && <span className="call-spinner" aria-hidden="true" />}
          <strong>{backstageText}</strong>
          {!failed && <span>The show starts as soon as Jada and {g} are in place.</span>}
        </div>
      )}
      <div className="nc-desk" aria-hidden="true" />
      <div className="nc-bug"><span className="ll-mark" aria-hidden="true" />The Late <b>Line</b></div>
      <div className={`nc-tally ${live ? 'is-on' : ''}`}>{live ? 'Live' : 'Standby'}</div>
      <div className="nc-third"><strong>{HOST.name}</strong><span>{HOST.billing}</span></div>
      {(host.audioBlocked || guest.audioBlocked) && (
        <button type="button" className="nc-hear" onClick={() => { host.resumeAudio(); guest.resumeAudio(); }}>Tap to hear the show</button>
      )}
      <div className="nc-ticker" aria-hidden="true">
        <span>Tonight on {SHOW}: {guestInfo.name}, {guestInfo.billing}{next ? ` · Coming up: ${next}` : ''}</span>
      </div>
    </section>
  );
}

function Lobby({ guestId, setGuestId, topics, setTopics, onGo, problem }: {
  guestId: string; setGuestId: (id: string) => void; topics: string[]; setTopics: (t: string[]) => void; onGo: (first: string) => void; problem: string;
}) {
  const [text, setText] = useState(topics.join('\n'));
  useEffect(() => { setText(topics.join('\n')); }, [topics]);
  const list = text.split('\n').map((t) => t.trim()).filter(Boolean);
  return (
    <main className="nc-lobby">
      <div className="nc-lobby-intro">
        <h1>Tonight on The Late Line</h1>
        <p>Jada calls a guest, live. They hear each other directly on Atmee's speech-to-speech, and both faces are in one studio. You run the booth: you never speak, you choose the topics, and Jada opens each one.</p>
      </div>
      <fieldset className="nc-guests">
        <legend>Book a guest</legend>
        {GUESTS.map((g) => (
          <label key={g.id} className={`nc-guest ${g.id === guestId ? 'is-picked' : ''}`}>
            <input type="radio" name="guest" value={g.id} checked={g.id === guestId} onChange={() => setGuestId(g.id)} />
            <img src={PORTRAITS[g.id]} alt="" />
            <span><strong>{g.name}</strong><small>{g.billing}</small></span>
          </label>
        ))}
      </fieldset>
      <label className="nc-topics">
        <span>The rundown: one topic per line. Jada opens with the first; send the rest from the booth.</span>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => setTopics(list)} />
      </label>
      {problem && <p className="nc-problem" role="alert">{problem}</p>}
      <button type="button" className="nc-btn nc-primary nc-go" disabled={!list.length} onClick={() => { setTopics(list); onGo(list[0]); }}>
        Go on air
      </button>
      <p className="nc-fine">Two speech sessions and two faces run at once, up to 15 minutes.</p>
    </main>
  );
}

function Console({ topics, used, disabled, onTopic, onNote, onWrap, onEnd, guestFirst }: {
  topics: string[]; used: Set<string>; disabled: boolean; guestFirst: string;
  onTopic: (t: string) => void; onNote: (t: string) => void; onWrap: () => void; onEnd: () => void;
}) {
  const [topic, setTopic] = useState('');
  const [note, setNote] = useState('');
  const extra = [...used].filter((t) => !topics.includes(t));
  return (
    <div className="nc-console">
      <div className="nc-group">
        <h3>Next topic for Jada</h3>
        <ul className="nc-rundown">
          {[...topics, ...extra].map((t) => (
            <li key={t}>
              <button type="button" className={`nc-chip ${used.has(t) ? 'is-used' : ''}`} disabled={disabled} onClick={() => onTopic(t)}>
                {used.has(t) && <span aria-label="sent">✓ </span>}{t}
              </button>
            </li>
          ))}
        </ul>
        <form className="nc-row" onSubmit={(e) => { e.preventDefault(); const t = topic.trim(); if (t) { onTopic(t); setTopic(''); } }}>
          <input className="nc-input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={`A new topic to raise with ${guestFirst}`} disabled={disabled} aria-label="New topic" />
          <button type="submit" className="nc-btn" disabled={disabled || !topic.trim()}>Send</button>
        </form>
      </div>
      <div className="nc-group">
        <h3>A note for Jada</h3>
        <form className="nc-row" onSubmit={(e) => { e.preventDefault(); const t = note.trim(); if (t) { onNote(t); setNote(''); } }}>
          <input className="nc-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. ask for a funny story" disabled={disabled} aria-label="Note for Jada" />
          <button type="submit" className="nc-btn" disabled={disabled || !note.trim()}>Send</button>
        </form>
        <p className="nc-hint">Topics and notes reach Jada on her next turn: she reacts to {guestFirst}, then moves on.</p>
      </div>
      <div className="nc-actions">
        <button type="button" className="nc-btn" disabled={disabled} onClick={onWrap}>Wrap it up</button>
        <button type="button" className="nc-btn nc-danger" onClick={onEnd}>End the show</button>
      </div>
    </div>
  );
}

function Transcript({ log, guest }: { log: LogLine[]; guest: Guest }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [log.length]);
  return (
    <ol className="nc-lines" ref={list} aria-live="polite">
      {log.length === 0 && <li className="nc-empty">The show starts when Jada does.</li>}
      {log.map((line) => (
        <li key={line.id} className={`nc-line is-${line.who}`}>
          <span className="nc-who">{line.who === 'host' ? 'Jada' : line.who === 'guest' ? firstName(guest.name) : 'Booth'}</span>
          <span>{line.text}</span>
        </li>
      ))}
    </ol>
  );
}
