// The Gilded Reel: Jada Monroe hosts a late-night show about the art of film.
// She introduces tonight's film, rolls its trailer, then invites its designer
// onto the screen in the studio wall, all on speech-to-speech. Each avatar has
// a speech session (show/speech.ts); the faces are avatar-only renders in one
// LiveKit room of the site's own: Jada's (facing the lens) and the guest's.
// The page wires them: each avatar's voice is what the other hears and what
// its face says. The cameras are the page's own: the director
// (show/director.ts) cuts between framings of those two renders, Jada in a
// medium shot or a close-up, the guest, or both side by side, so a show needs
// only two renders. The person
// at the page is the producer: they never speak; they choose the topics, and
// Jada opens each one with the guest.
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackToApps, clock, useAvatarOnly, type AvatarOnly, type SpeechWriter } from '../../../src/kit/index.ts';
import { createBooth, type Booth, type Role, type Stage } from '../show/booth.ts';
import { startScore } from './score.ts';
import { createFloor } from '../show/floor.ts';
import { createDirector, hostPose, type Director, type Pose, type Shot, type ShotMode } from '../show/director.ts';
import { FILM, GUESTS, HOST, SHOW, firstName, type Guest } from '../show/cast.ts';
import { TRAILER_REMARKS } from '../show/script.ts';
import { filmCue, goodbyeCue, inviteCue, noteCue, nudgeCue, topicCue, welcomeCue, wrapCue } from '../show/script.ts';
import { openSpeech, SpeechError, type SpeechLine } from '../show/speech.ts';
import { createResampler, createVoice } from '../show/voice.ts';
import cam1 from '../studio/cam1.jpg';
import cam2 from '../studio/cam2.jpg';
import wall from '../studio/wall.jpg';
import desk from '../studio/desk.webp';
import ines from '../guests/ines.jpg';
import still1 from '../film/still-1.jpg';
import still2 from '../film/still-2.jpg';
import still3 from '../film/still-3.jpg';
import still4 from '../film/still-4.jpg';
import still5 from '../film/still-5.jpg';
import './gilded.css';

const API = '/api/apps/tv-show-live';
const PORTRAITS: Record<string, string> = { ines };
const STILLS: Record<number, string> = { 1: still1, 2: still2, 3: still3, 4: still4, 5: still5 };
const END_AFTER_GOODBYE_MS = 4_000;
type TrailerMode = 'react' | 'commentate';

const SHOT_MS = 5_200;          // each trailer still, held and pushed in on
// The booth hears Jada's line end in her speech session; viewers hear it from her face about
// 4 s later (measured). The trailer rolls once the face is through it, not over her last words.
const FACE_LAG_MS = 4_500;

const STAGE_TEXT: Record<Stage, string> = {
  greeting: 'Jada is opening the show',
  introducing: 'Jada is introducing the film',
  trailer: 'Rolling the trailer',
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
 * Hands one avatar's voice to a face. The face opens its stream asynchronously,
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
  const [trailer, setTrailer] = useState(false);
  // While the trailer plays the studio is off air: what Jada says then is neither heard nor logged.
  // During the trailer Jada is in a corner window: she reacts silently, or she commentates
  // (two cued remarks), heard over the score and logged.
  const [trailerMode, setTrailerMode] = useState<TrailerMode>('react');
  const trailerOn = useRef(false);
  trailerOn.current = trailer && trailerMode === 'react';
  const [shot, setShot] = useState<Shot>('host-front');
  const [wrapping, setWrapping] = useState(false);
  const pose = hostPose(stage, wrapping);
  const [shotMode, setShotMode] = useState<ShotMode>('auto');
  const director = useRef<Director | null>(null);
  const logId = useRef(0);
  const addLog = (who: LogLine['who'], text: string) => setLog((l) => [...l.slice(-150), { id: ++logId.current, who, text }]);

  // A ref, not the state: the booth's callbacks are made before the show has its id.
  const showRef = useRef<string | null>(null);
  const seatApi = (seat: Role) => `${API}/show/${showRef.current}/${seat}`;
  const face = (seat: string) => (showId ? `tv-show-live/show/${showId}/${seat}` : 'tv-show-live');
  // Jada's face is her camera-1 avatar (facing the lens); her speech session is her main avatar's.
  // Jada twice, one pose each (a render's pose is fixed): camera 1 facing the lens, for the
  // viewers, and her main avatar turned to the TV, for her guest. Both say her one voice.
  const frontFace = useAvatarOnly(face('front'));
  const hostFace = useAvatarOnly(face('host'));
  const guestFace = useAvatarOnly(face('guest'));
  const faces = useRef({ front: frontFace, host: hostFace, guest: guestFace });
  faces.current = { front: frontFace, host: hostFace, guest: guestFace };

  const booth = useRef<Booth | null>(null);
  const lines = useRef<Partial<Record<Role, SpeechLine>>>({});
  const words = useRef<Record<Role, string>>({ host: '', guest: '' });
  const segment = useRef<Guest | null>(null);
  // Who is speaking now (their voice's stretch): while one speaks, the other's voice is not passed
  // to them. Each session takes any sound from its user as a barge-in, and live a guest's "Oh,"
  // or "hmm" cut the host off mid-sentence again and again. A pause longer than the voice's
  // stretch still lets the other answer.
  const talking = useRef<Record<Role, boolean>>({ host: false, guest: false });
  // And what goes on air: the listener's "mm-hmm" and "ok" over the speaker are kept off it (show/floor.ts).
  const floor = useMemo(() => createFloor(), []);

  // Each avatar's voice: its face says it, the other avatar hears it, and the booth sees when it speaks.
  const voices = useMemo(() => {
    const make = (role: Role, seats: ('front' | 'host' | 'guest')[]) => {
      const feeders = seats.map((seat) => ({ seat, feeder: faceFeeder(() => faces.current[seat]) }));
      const resample = createResampler();
      const voice = createVoice({
        // The voice's stretches say when the avatar speaks, for the booth and the transcript.
        onStart() {
          talking.current[role] = true;
          floor.speaking(role, true);
          if (!floor.onAir(role)) return;   // a backchannel: neither the booth nor the director sees it
          booth.current?.speaking(role, true);
          director.current?.speaking(role, true);
        },
        onFrame() {},
        onEnd() {
          talking.current[role] = false;
          const aired = floor.wentOnAir(role);
          floor.speaking(role, false);
          booth.current?.speaking(role, false);
          director.current?.speaking(role, false);
          const said = words.current[role].trim();
          words.current[role] = '';
          if (said && aired && !trailerOn.current) addLog(role, said);
        },
      });
      return {
        feed(pcm: Int16Array) {
          voice.feed(pcm);
          // Off the floor, the face gets silence of the same length, so its stream keeps time.
          const pcm16 = resample(floor.onAir(role) ? pcm : new Int16Array(pcm.length));
          // One stream per face for the whole show, from the first frame once that face is up.
          for (const { seat, feeder } of feeders) {
            if (!feeder.open && faces.current[seat].phase === 'live') feeder.start();
            feeder.frame(pcm16);
          }
        },
        flush() { voice.flush(); for (const { feeder } of feeders) feeder.end(); },
      };
    };
    return { host: make('host', ['front', 'host']), guest: make('guest', ['guest']) };
  }, []);

  async function openSeat(role: Role) {
    const other: Role = role === 'host' ? 'guest' : 'host';
    try {
      const line = await openSpeech(seatApi(role), {
        onAudio(b64, pcm) {
          voices[role].feed(pcm);
          if (!talking.current[other]) lines.current[other]?.hear(b64);
        },
        onWords(delta) { words.current[role] += delta; },
        onClosed(reason) { if (booth.current && booth.current.stage !== 'over') offAir(`${role === 'host' ? HOST.name : segment.current?.name} left the line (${reason}).`); },
        onError(message) { console.warn('[gilded-reel] %s: %s', role, message); },
      });
      lines.current[role] = line;
      if (role === 'host') booth.current?.hostLive();
      // The guest is on: the two-shot, Jada and the TV, until the booth or the director cuts.
      else { setPatched(true); chooseShot('two'); booth.current?.guestLive(); }
    } catch (err) {
      offAir(`We couldn't open ${role === 'host' ? HOST.name : segment.current?.name}'s line: ${(err as SpeechError).code ?? (err as Error).message}`);
    }
  }

  // Both faces start backstage (they take longest); the show starts, with Jada's line, only
  // once both are up, so nothing on screen is still loading. The guest's face waits off
  // screen until Jada invites them on.
  useEffect(() => {
    if (!showId) return;
    void frontFace.start();
    void hostFace.start();
    void guestFace.start();
  }, [showId]);
  const hostOpened = useRef(false);
  const [backstage, setBackstage] = useState(true);
  useEffect(() => {
    if ([frontFace, hostFace, guestFace].some((f) => f.phase !== 'live') || hostOpened.current || !booth.current) return;
    hostOpened.current = true;
    setBackstage(false);
    void openSeat('host');
  }, [frontFace.phase, hostFace.phase, guestFace.phase]);
  useEffect(() => {
    if (!onShow) return;
    const failed = [frontFace, hostFace, guestFace].find((f) => f.phase === 'failed');
    if (failed) offAir(failed.detail || 'A camera could not start.');
  }, [frontFace.phase, hostFace.phase, guestFace.phase]);
  useEffect(() => {
    if (stage !== 'over' || !onShow) return;
    const id = setTimeout(() => void wrapUp(), END_AFTER_GOODBYE_MS);
    return () => clearTimeout(id);
  }, [stage, onShow]);
  useEffect(() => { setTopics(guest.rundown); }, [guestId]);

  // Both voices are heard whatever the shot; nobody in the studio during the trailer.
  useEffect(() => {
    const set = (f: AvatarOnly, on: boolean) => { if (f.audioRef.current) f.audioRef.current.muted = !on; };
    set(frontFace, pose === 'front' && (!trailer || trailerMode === 'commentate'));
    set(hostFace, pose === 'turned' && !trailer);
    set(guestFace, patched && !trailer);
  }, [pose, trailer, trailerMode, patched, frontFace.phase, hostFace.phase, guestFace.phase]);

  function offAir(why: string) {
    if (!booth.current) return;
    const wasOver = booth.current.stage === 'over';
    booth.current.close();
    if (!wasOver && why) setProblem(why);
    void wrapUp();
  }

  async function wrapUp() {
    booth.current?.close();
    director.current?.close();
    setTrailer(false);
    voices.host.flush();
    voices.guest.flush();
    await Promise.allSettled([lines.current.host?.end(), lines.current.guest?.end(), faces.current.front.end(), faces.current.host.end(), faces.current.guest.end()]);
    lines.current = {};
    if (showRef.current) void fetch(`${API}/show/${showRef.current}/end`, { method: 'POST', keepalive: true }).catch(() => {});
  }

  async function goOnAir(first: string) {
    setProblem(''); setLog([]); setUsed(new Set([first])); setPatched(false); setStage('greeting'); setTrailer(false); setShot('host-front'); setShotMode('auto'); setWrapping(false); remarked.current.clear();
    director.current?.close();
    director.current = createDirector({ onShot: setShot });
    hostOpened.current = false;
    segment.current = guest;
    setBackstage(true);
    booth.current = createBooth({
      film: filmCue(),
      rollTrailer: () => { addLog('booth', `Roll the ${FILM.title} trailer`); const show = showRef.current; setTimeout(() => { if (showRef.current === show) setTrailer(true); }, FACE_LAG_MS); },
      invite: inviteCue(guest),
      welcome: welcomeCue(guest, first),
      nudge: nudgeCue(guest),
      wrap: wrapCue(guest),
      goodbye: goodbyeCue,
      deliver({ to, kind, text }) {
        // For tests and analytics: everything the booth hands either avatar, as a window event.
        dispatchEvent(new CustomEvent('late-line:booth', { detail: { to, kind, text } }));
        const line = lines.current[to];
        if (!line) return void console.warn('[gilded-reel] no line for %s yet: %s dropped', to, kind);
        if (kind === 'directive') line.directive(text);
        else line.commentary(text);
      },
      dialGuest: () => void openSeat('guest'),
      onStage: (next) => { setStage(next); director.current?.stage(next); },
    });
    addLog('booth', `First topic: ${first}`);
    const res = await fetch(`${API}/shows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guest: guest.id }) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) return setProblem(json.message || json.error || 'We could not book the studio.');
    showRef.current = json.showId;
    setOnShow(true);
    setShowId(json.showId);
  }

  const trailerDone = () => { setTrailer(false); booth.current?.trailerDone(); };
  // Commentating: a cued remark at some of the trailer's shots (commentary, which she speaks at once).
  // Each remark once per trailer: in development React runs the trailer's effects twice.
  const remarked = useRef(new Set<number>());
  const trailerShot = (i: number) => {
    const remark = TRAILER_REMARKS[i];
    if (trailerMode !== 'commentate' || !remark || remarked.current.has(i)) return;
    remarked.current.add(i);
    lines.current.host?.commentary(remark);
    addLog('booth', `Trailer remark ${i === 0 ? 'one' : 'two'}`);
  };
  const sendTopic = (topic: string) => {
    if (!booth.current || !segment.current) return;
    booth.current.cue(topicCue(segment.current, topic));
    setUsed((u) => new Set(u).add(topic));
    addLog('booth', `Topic for Jada: ${topic}`);
  };
  const sendNote = (text: string) => { booth.current?.cue(noteCue(text)); addLog('booth', `Note for Jada: ${text}`); };
  const wrap = () => { booth.current?.wrap(); setWrapping(true); addLog('booth', 'Wrap it up'); };
  const chooseShot = (mode: ShotMode) => { setShotMode(mode); director.current?.mode(mode); };
  const endShow = () => { offAir(''); setStage('over'); };
  const backToLobby = () => { booth.current = null; setOnShow(false); setShowId(null); };

  const done = (p: AvatarOnly['phase']) => p === 'ended' || p === 'failed' || p === 'idle';
  const allDone = done(frontFace.phase) && done(hostFace.phase) && done(guestFace.phase);

  return (
    <div className="nc-app gr">
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
          <Program front={frontFace} host={hostFace} pose={pose} guest={guestFace} guestInfo={guest} patched={patched} stage={stage}
            backstage={backstage} shot={shot} trailer={trailer} trailerMode={trailerMode} onTrailerShot={trailerShot} onTrailerDone={trailerDone} />
          <section className="nc-booth" aria-label="The booth">
            <div className="nc-booth-head">
              <h2>The booth</h2>
              <span className="nc-stage-text">{STAGE_TEXT[stage]}</span>
            </div>
            {problem && <p className="nc-problem" role="alert">{problem}</p>}
            {stage === 'over' && allDone ? (
              <div className="nc-after">
                <p>That's the show.</p>
                <button type="button" className="nc-btn nc-primary" onClick={backToLobby}>Book another night</button>
              </div>
            ) : (
              <Console topics={topics} used={used} disabled={stage !== 'on-air'} onTopic={sendTopic} onNote={sendNote}
                onWrap={wrap} onEnd={endShow} guestFirst={firstName(guest.name)} shotMode={shotMode} onShot={chooseShot}
                trailerMode={trailerMode} onTrailerMode={setTrailerMode} trailerLocked={stage !== 'greeting' && stage !== 'introducing'} />
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
  return <span className="nc-logo gr-logo"><span className="gr-fan" aria-hidden="true" />The Gilded <b>Reel</b></span>;
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

// The program picture: one studio. The set (studio/wall.jpg) was outpainted from
// Jada's own camera still: her desk runs on to the right, under a TV on the
// wall. Her whole render lies exactly over her still, never cropped (her desk
// leaves through the bottom of the frame; the edges inside the frame fade, so
// the renderer's drift has no hard line to slip against); the guest plays on
// the TV. The director's shots are camera
// moves on that set: wide, pushed in on Jada, pushed in on the TV.
function Program({ front, host, pose, guest, guestInfo, patched, stage, backstage, shot, trailer, trailerMode, onTrailerShot, onTrailerDone }: {
  front: AvatarOnly; host: AvatarOnly; pose: Pose; guest: AvatarOnly; guestInfo: Guest; patched: boolean; stage: Stage;
  backstage: boolean; shot: Shot; trailer: boolean; trailerMode: TrailerMode; onTrailerShot: (i: number) => void; onTrailerDone: () => void;
}) {
  const live = stage === 'on-air' || stage === 'closing';
  const g = firstName(guestInfo.name);
  const faces = [front, host, guest];
  const failed = faces.find((f) => f.phase === 'failed');
  const backstageText = failed ? failed.detail : faces.some((f) => f.phase === 'warming') ? 'Lighting the stage…' : 'Getting the studio ready…';
  // Which cameras are up, so a long wait says what it is waiting for.
  const cameras: [string, AvatarOnly][] = [['Camera 1', front], ['Camera 2', host], [g, guest]];
  // Until the guest is on, the camera stays wide on Jada and the key art on the TV.
  const camera = !patched ? 'wide' : shot === 'host-side' ? 'host' : shot === 'guest' ? 'tv' : 'wide';
  const third = camera === 'tv' ? { name: guestInfo.name, billing: guestInfo.billing } : camera === 'host' || !patched ? HOST : null;
  return (
    <section className={`gr-program is-${camera} ${trailer ? 'is-trailer' : ''}`} aria-label="The show, as it goes out">
      <div className="gr-set">
        <img className="gr-wall" src={wall} alt="" />
        <div className="gr-tv">
          <div className={`gr-tv-feed ${patched ? 'is-on' : ''}`}><Face face={guest} poster={PORTRAITS[guestInfo.id]} /></div>
          {!patched && (
            <div className="gr-tv-card" aria-hidden="true">
              <img src={STILLS[5]} alt="" />
              <span className="gr-kicker">Tonight</span>
              <strong>{FILM.title}</strong>
              <span>{stage === 'dialing' ? `Calling ${g}…` : 'Behind the frame'}</span>
            </div>
          )}
          {patched && <span className="tv-live"><span className="nc-rec" />Live · via video call</span>}
          <span className="gr-tv-glass" aria-hidden="true" />
        </div>
        {/* Both of Jada's renders stay in frame (a video off screen is not sent); the other one is hidden. */}
        {/* Camera 1 also makes the corner window over the trailer: the same element, restyled, so its video never restarts. */}
        <div className={`gr-host is-front ${pose === 'front' ? '' : 'is-off'}`} data-label={HOST.name}><Face face={front} poster={cam1} /></div>
        <div className={`gr-host ${pose === 'turned' ? '' : 'is-off'}`}><Face face={host} poster={cam2} /></div>
        {/* The front of the desk, in front of her: when the renderer zooms in, her arms go
            behind a desk that stays put, and the desk runs on unbroken. */}
        <img className="gr-desk" src={desk} alt="" />
      </div>
      {third && <div className="gr-third"><strong>{third.name}</strong><span>{third.billing}</span></div>}
      <div className="nc-bug gr-bug"><span className="gr-fan" aria-hidden="true" />The Gilded <b>Reel</b></div>
      <div className={`nc-tally ${live ? 'is-on' : ''}`}>{live ? 'Live' : 'Standby'}</div>
      {trailer && <Trailer level={trailerMode === 'commentate' ? 0.45 : 0.9} onShot={onTrailerShot} onDone={onTrailerDone} />}
      {backstage && (
        <div className="gr-backstage" role="status">
          {!failed && <span className="gr-spin" aria-hidden="true" />}
          <strong>{backstageText}</strong>
          {!failed && <span>The show starts as soon as Jada and {g} are in place.</span>}
          {!failed && (
            <ul className="gr-ready" aria-label="Cameras">
              {cameras.map(([name, f]) => (
                <li key={name} className={f.phase === 'live' ? 'is-up' : ''}>{name}: {f.phase === 'live' ? 'ready' : f.phase === 'warming' ? 'waiting for a worker' : 'starting'}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {(front.audioBlocked || host.audioBlocked || guest.audioBlocked) && (
        <button type="button" className="nc-hear" onClick={() => faces.forEach((f) => f.resumeAudio())}>Tap to hear the show</button>
      )}
      <div className="nc-ticker gr-ticker" aria-hidden="true">
        <span>Tonight on {SHOW}: {FILM.title} · {guestInfo.name}, {guestInfo.billing}</span>
      </div>
    </section>
  );
}

// The trailer, full frame: each still held and slowly pushed in on, cut with a
// dissolve, its card over it, between letterbox bars.
function Trailer({ level, onShot, onDone }: { level: number; onShot: (i: number) => void; onDone: () => void }) {
  const [shot, setShot] = useState(0);
  const shots = FILM.trailer;
  const score = useRef<ReturnType<typeof startScore>>(null);
  useEffect(() => {
    score.current = startScore((shots.length * SHOT_MS) / 1000, level);
    return () => score.current?.end();
  }, []);
  useEffect(() => {
    const s = shots[shot];
    if (s) onShot(shot);
    if (s?.card) score.current?.hit(s.title === true);
    if (shot === shots.length - 1) setTimeout(() => score.current?.end(), SHOT_MS - 1_300);
  }, [shot]);
  useEffect(() => {
    if (shot >= shots.length) { onDone(); return; }
    const id = setTimeout(() => setShot((s) => s + 1), SHOT_MS);
    return () => clearTimeout(id);
  }, [shot]);
  return (
    <div className="gr-trailer" role="img" aria-label={`The ${FILM.title} trailer`}>
      {shots.map((s, i) => (
        <div key={s.still} className={`gr-shot ${i === shot ? 'is-on' : ''} ${i < shot ? 'is-past' : ''}`}>
          <img src={STILLS[s.still]} alt="" />
          {s.card && <span className={`gr-card ${s.title ? 'is-title' : ''}`}>{s.card}</span>}
        </div>
      ))}
      <span className="gr-rating">Coming this winter</span>
    </div>
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
        <h1>Tonight on The Gilded Reel</h1>
        <p>Jada introduces {FILM.title}, rolls the trailer, then brings its designer onto the studio screen, live on Atmee's speech-to-speech. You run the booth: you never speak, you choose the topics, and Jada opens each one.</p>
      </div>
      <figure className="gr-poster">
        <img src={still5} alt="" />
        <figcaption><strong>{FILM.title}</strong><span>An invented desert epic, made for this show</span></figcaption>
      </figure>
      <fieldset className="nc-guests">
        <legend>Tonight's guest</legend>
        {GUESTS.map((g) => (
          <label key={g.id} className={`nc-guest ${g.id === guestId ? 'is-picked' : ''}`}>
            <input type="radio" name="guest" value={g.id} checked={g.id === guestId} onChange={() => setGuestId(g.id)} />
            <img src={PORTRAITS[g.id]} alt="" />
            <span><strong>{g.name}</strong><small>{g.billing}</small></span>
          </label>
        ))}
      </fieldset>
      <label className="nc-topics">
        <span>The rundown: one topic per line. Jada opens with the first once the designer is on; send the rest from the booth.</span>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => setTopics(list)} />
      </label>
      {problem && <p className="nc-problem" role="alert">{problem}</p>}
      <button type="button" className="nc-btn nc-primary nc-go" disabled={!list.length} onClick={() => { setTopics(list); onGo(list[0]); }}>
        Go on air
      </button>
      <p className="nc-fine">Two speech sessions and three cameras run at once, up to 15 minutes.</p>
    </main>
  );
}

function Console({ topics, used, disabled, onTopic, onNote, onWrap, onEnd, guestFirst, shotMode, onShot, trailerMode, onTrailerMode, trailerLocked }: {
  topics: string[]; used: Set<string>; disabled: boolean; guestFirst: string; shotMode: ShotMode;
  onTopic: (t: string) => void; onNote: (t: string) => void; onWrap: () => void; onEnd: () => void; onShot: (m: ShotMode) => void;
  trailerMode: TrailerMode; onTrailerMode: (m: TrailerMode) => void; trailerLocked: boolean;
}) {
  const [topic, setTopic] = useState('');
  const [note, setNote] = useState('');
  const extra = [...used].filter((t) => !topics.includes(t));
  const cams: [ShotMode, string][] = [['auto', 'Auto'], ['host', 'Jada'], ['guest', guestFirst], ['two', 'Both']];
  return (
    <div className="nc-console">
      <div className="nc-group">
        <h3>Shot</h3>
        <div className="gr-cams" role="radiogroup" aria-label="Shot">
          {cams.map(([m, label]) => (
            <button key={m} type="button" role="radio" aria-checked={shotMode === m} className={`nc-chip ${shotMode === m ? 'is-on' : ''}`} onClick={() => onShot(m)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="nc-group">
        <h3>During the trailer</h3>
        <div className="gr-cams" role="radiogroup" aria-label="During the trailer">
          {([['react', 'Jada reacts'], ['commentate', 'Jada commentates']] as [TrailerMode, string][]).map(([m, label]) => (
            <button key={m} type="button" role="radio" aria-checked={trailerMode === m} disabled={trailerLocked} className={`nc-chip ${trailerMode === m ? 'is-on' : ''}`} onClick={() => onTrailerMode(m)}>{label}</button>
          ))}
        </div>
      </div>
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
          <input className="nc-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. ask about the hardest costume" disabled={disabled} aria-label="Note for Jada" />
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
