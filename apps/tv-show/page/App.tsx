// Nightcap Live: Nico Vale hosts a talk show and video-calls a guest. Both are
// avatars, each in a call of its own with this page. Once the guest is put
// through, the page plays each one's voice into the other's call as its
// microphone, so they hear each other; the booth (show/booth.ts) decides when
// that happens and what the producer's cues become. The person at the page is
// the producer: they never speak, they choose the topics, and Nico opens each
// one with the guest.
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackToApps, CallStatus, CaptionsButton, HostVideo, clock, useAvatar, useCaptionToggle, type Avatar } from '../../../src/kit/index.ts';
import { createBooth, type Booth, type Role, type Stage } from '../show/booth.ts';
import { GUESTS, firstName, type Guest } from '../show/guests.ts';
import { HOST_NAME, guestState, hostState, introCue, producerCue, topicCue, wrapCue, type Segment } from '../show/script.ts';
import nico from '../host/portrait.jpg';
import frank from '../guests/frank.jpg';
import lumi from '../guests/lumi.jpg';
import mira from '../guests/mira.jpg';
import draconia from '../guests/draconia.jpg';
import vivienne from '../guests/vivienne.jpg';
import './show.css';

const PORTRAITS: Record<string, string> = { frank, lumi, mira, draconia, vivienne };
const HOST_BILLING = 'Host, Nightcap Live';
// After the guest's goodbye: a beat on the two faces, then both calls end.
const END_AFTER_GOODBYE_MS = 4_000;

const STAGE_TEXT: Record<Stage, string> = {
  greeting: 'Nico is opening the show',
  dialing: 'Putting the guest through…',
  'on-air': 'On air',
  closing: 'Wrapping up',
  over: 'Off air',
};

interface LogLine { id: number; who: Role | 'booth'; text: string }

export function App() {
  const [guestId, setGuestId] = useState(GUESTS[0].id);
  const guest = GUESTS.find((g) => g.id === guestId)!;
  const [topics, setTopics] = useState<string[]>(guest.rundown);
  const [onShow, setOnShow] = useState(false);
  const [stage, setStage] = useState<Stage>('greeting');
  const [patched, setPatched] = useState(false);
  const [used, setUsed] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<LogLine[]>([]);
  const [problem, setProblem] = useState('');
  const booth = useRef<Booth | null>(null);
  const segment = useRef<Segment | null>(null);
  const logId = useRef(0);
  const mixer = useRef<AudioContext | null>(null);
  // Subtitles on the program picture: off unless the producer turns them on (remembered).
  const cc = useCaptionToggle('tv-show', false);
  const addLog = (who: LogLine['who'], text: string) => setLog((l) => [...l.slice(-120), { id: ++logId.current, who, text }]);

  const host = useAvatar('tv-show/host', {
    onAvatarSaid: (text) => { addLog('host', text); booth.current?.said('host', text); },
    onEnded: () => offAir('host'),
  });
  const caller = useAvatar(`tv-show/guest/${guestId}`, {
    // Off air (its greeting while it waits to be put through), the guest is neither heard nor logged.
    onAvatarSaid: (text) => {
      const stageNow = booth.current?.stage;
      if (stageNow === 'on-air' || stageNow === 'closing') addLog('guest', text);
      booth.current?.said('guest', text);
    },
    onEnded: () => offAir('guest'),
  });
  const seats = useRef<Record<Role, Avatar>>({ host, guest: caller });
  seats.current = { host, guest: caller };

  // One call ending ends the show: a talk show with one face is no show.
  function offAir(who: Role) {
    if (!booth.current) return;
    const stageNow = booth.current.stage;
    booth.current.close();
    if (stageNow !== 'over') setProblem(who === 'host' ? 'Nico dropped off the call.' : `${firstName(segment.current?.guest.name ?? 'The guest')} dropped off the call.`);
    void seats.current.host.end();
    void seats.current.guest.end();
  }

  // The guest hears the show from the moment its call is up, off air: a call
  // left silent has its avatar speak up on its own. Nico hears the guest only
  // once the guest is put through.
  useEffect(() => {
    if (caller.phase !== 'live' || host.phase !== 'live' || !mixer.current) return;
    void connect(host, caller, mixer.current);
  }, [caller.phase, host.phase]);
  useEffect(() => {
    if (!patched || !mixer.current) return;
    void connect(caller, host, mixer.current);
  }, [patched]);
  /** Plays one avatar's voice into the other's call as its microphone. */
  async function connect(from: Avatar, to: Avatar, ctx: AudioContext) {
    const voice = await voiceOf(from, ctx);
    try {
      if (!voice) throw new Error('no voice to carry');
      await to.feedMic(voice);
    } catch (err) {
      console.warn('[nightcap] could not connect the calls: %s', (err as Error).message);
      setProblem('The two calls could not be connected to each other.');
    }
  }

  // A new guest brings their own suggested rundown.
  useEffect(() => { setTopics(guest.rundown); }, [guestId]);

  // The guest is heard only once put through.
  useEffect(() => { if (caller.audioRef.current) caller.audioRef.current.muted = !patched; }, [patched, caller.phase]);

  useEffect(() => { booth.current?.speaking('host', host.speaking); }, [host.speaking]);
  useEffect(() => { booth.current?.speaking('guest', caller.speaking); }, [caller.speaking]);
  const hostArrived = useRef(false);
  const guestArrived = useRef(false);
  useEffect(() => {
    if (host.phase === 'live' && !hostArrived.current) { hostArrived.current = true; booth.current?.hostLive(); }
  }, [host.phase]);
  useEffect(() => {
    if (caller.phase === 'live' && !guestArrived.current) { guestArrived.current = true; booth.current?.guestLive(); }
  }, [caller.phase]);
  // A call that could not be placed ends the other.
  useEffect(() => {
    if (!onShow) return;
    const failed = host.phase === 'failed' ? host : caller.phase === 'failed' ? caller : null;
    if (!failed) return;
    setProblem(failed === host ? `We couldn't reach Nico: ${host.detail}` : `We couldn't reach ${firstName(guest.name)}: ${caller.detail}`);
    booth.current?.close();
    void host.end();
    void caller.end();
  }, [host.phase, caller.phase]);
  // After the goodbye, both calls end.
  useEffect(() => {
    if (stage !== 'over' || !onShow) return;
    const id = setTimeout(() => { void seats.current.host.end(); void seats.current.guest.end(); }, END_AFTER_GOODBYE_MS);
    return () => clearTimeout(id);
  }, [stage, onShow]);

  function goOnAir(firstTopic: string) {
    const seg: Segment = { guest, subject: firstTopic };
    segment.current = seg;
    setProblem(''); setLog([]); setUsed(new Set([firstTopic])); setPatched(false); setStage('greeting');
    // Made on the click, so the browser lets it run: it carries each voice into the other call.
    void mixer.current?.close();
    mixer.current = new AudioContext();
    hostArrived.current = false; guestArrived.current = false;
    const states = { host: hostState(seg), guest: guestState(seg) };
    booth.current = createBooth({
      states,
      intro: introCue(seg),
      wrap: wrapCue(seg),
      goodbye: `Nico is wrapping up the show: say a short, warm goodbye to him and the viewers.`,
      deliver: ({ to, kind, text }) => {
        // For tests and analytics: everything the booth hands either avatar, as a window event.
        dispatchEvent(new CustomEvent('nightcap:booth', { detail: { to, kind, text } }));
        const seat = seats.current[to];
        if (kind === 'event') seat.event(text, 30);
        else seat.state(text);
      },
      patchIn: () => setPatched(true),
      onStage: setStage,
    });
    host.state(states.host);
    caller.state(states.guest);
    addLog('booth', `First topic: ${firstTopic}`);
    setOnShow(true);
    // Both calls at once (each takes a while); the guest waits off air until Nico introduces them.
    void host.start({ mic: false });
    void caller.start({ mic: false });
  }

  function sendTopic(topic: string) {
    if (!booth.current || !segment.current) return;
    booth.current.cue(topicCue(segment.current, topic));
    setUsed((u) => new Set(u).add(topic));
    addLog('booth', `Topic for Nico: ${topic}`);
  }
  function sendNote(text: string) {
    booth.current?.cue(producerCue(text));
    addLog('booth', `Note for Nico: ${text}`);
  }
  function wrap() {
    booth.current?.wrap();
    addLog('booth', 'Wrap it up');
  }
  async function endShow() {
    booth.current?.close();
    setStage('over');
    await Promise.allSettled([host.end(), caller.end()]);
  }
  function backToLobby() {
    booth.current = null;
    void mixer.current?.close();
    mixer.current = null;
    setOnShow(false);
  }

  const bothDone = (host.phase === 'ended' || host.phase === 'failed' || host.phase === 'idle')
    && (caller.phase === 'ended' || caller.phase === 'failed' || caller.phase === 'idle');

  return (
    <div className="nc-app">
      <header className="nc-bar">
        <BackToApps avatar={host} name="Nico and the guest" className="nc-back" />
        <Logo />
        {onShow && (
          <span className={`nc-air ${stage === 'on-air' || stage === 'closing' ? 'is-on' : ''}`}>
            <span className="nc-air-dot" />{stage === 'on-air' || stage === 'closing' ? 'On air' : STAGE_TEXT[stage]}
          </span>
        )}
        {onShow && host.secondsLeft !== null && <span className="nc-clock">{clock(host.secondsLeft)}</span>}
        {onShow && <CaptionsButton on={cc.on} onToggle={cc.toggle} className="nc-cc" />}
      </header>

      {!onShow ? (
        <Lobby guestId={guestId} setGuestId={setGuestId} topics={topics} setTopics={setTopics} onGo={goOnAir} />
      ) : (
        <main className="nc-show">
          <Program host={host} guest={caller} guestInfo={guest} patched={patched} stage={stage} subtitles={cc.on}
            next={[...topics].find((t) => !used.has(t))} />

          <section className="nc-booth" aria-label="The booth">
            <div className="nc-booth-head">
              <h2>The booth</h2>
              <span className="nc-stage-text">{STAGE_TEXT[stage]}</span>
            </div>
            {problem && <p className="nc-problem" role="alert">{problem}</p>}
            {bothDone && stage === 'over' ? (
              <div className="nc-after">
                <p>That's the show.</p>
                <button type="button" className="nc-btn nc-primary" onClick={backToLobby}>Book another guest</button>
              </div>
            ) : (
              <Console topics={topics} used={used} disabled={stage === 'closing' || stage === 'over'}
                onTopic={sendTopic} onNote={sendNote} onWrap={wrap} onEnd={() => void endShow()} guestFirst={firstName(guest.name)} />
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

/** An avatar's voice as a track of this page's own, for the other call's microphone; null if it never plays. */
async function voiceOf(avatar: Avatar, ctx: AudioContext): Promise<MediaStreamTrack | null> {
  for (let i = 0; i < 50; i++) {
    const stream = avatar.audioRef.current?.srcObject;
    if (stream instanceof MediaStream && stream.getAudioTracks().length) {
      // Through the page's audio graph rather than the remote track itself: a remote
      // track published again as it is can reach the other call silent.
      const out = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(stream).connect(out);
      return out.stream.getAudioTracks()[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

function Logo() {
  return <span className="nc-logo"><span className="nc-moon" aria-hidden="true" />Nightcap <b>Live</b></span>;
}

// The program picture, as it goes out: the set, Nico behind the desk, the
// guest on the studio's wall screen, and the show's graphics over it.
function Program({ host, guest, guestInfo, patched, stage, next, subtitles }: {
  host: Avatar; guest: Avatar; guestInfo: Guest; patched: boolean; stage: Stage; next?: string; subtitles: boolean;
}) {
  const g = firstName(guestInfo.name);
  const live = stage === 'on-air' || stage === 'closing';
  // One subtitle line, from whoever is speaking (the guest only once on air).
  const speaker = guest.speaking && patched ? guest : host.speaking ? host : null;
  const screen = patched ? null : guest.phase === 'live' ? `${g} is on the line` : guest.phase === 'failed' ? `Couldn't reach ${g}` : `Calling ${g}…`;
  return (
    <section className="nc-program" aria-label="The show, as it goes out">
      {/* Nico's shot is the studio; the set carries on to his left, where the guest's screen hangs. */}
      <div className="nc-set" aria-hidden="true" style={{ backgroundImage: `url(${nico})` }} />
      <div className="nc-desk" aria-hidden="true" />

      <div className="nc-monitor">
        <div className="nc-screen">
          <HostVideo avatar={guest} name={guestInfo.name} poster={PORTRAITS[guestInfo.id]} captions={false} className="nc-feed">
            {screen && <div className="nc-cover" role="status">{guest.phase !== 'failed' && <span className="call-spinner" aria-hidden="true" />}<strong>{screen}</strong></div>}
          </HostVideo>
          <span className="nc-feed-tag"><span className="nc-rec" />Live via video call</span>
          {patched && <span className="nc-feed-name"><strong>{guestInfo.name}</strong><span>{guestInfo.billing}</span></span>}
          <span className="nc-glare" aria-hidden="true" />
        </div>
      </div>

      <div className="nc-hostcam">
        <HostVideo avatar={host} name={HOST_NAME} poster={nico} captions={false} className="nc-feed">
          <CallStatus avatar={host} name="Nico" again="" onAgain={() => {}} />
        </HostVideo>
      </div>

      <div className="nc-bug"><span className="nc-moon" aria-hidden="true" />Nightcap <b>Live</b></div>
      <div className={`nc-tally ${live ? 'is-on' : ''}`}>{live ? 'Live' : 'Standby'}</div>

      <div className="nc-third"><strong>{HOST_NAME}</strong><span>{HOST_BILLING}</span></div>
      {subtitles && speaker?.caption && <Subtitle text={speaker.caption} />}
      {(host.audioBlocked || guest.audioBlocked) && (
        <button type="button" className="nc-hear" onClick={() => { host.resumeAudio(); guest.resumeAudio(); }}>Tap to hear the show</button>
      )}
      <div className="nc-ticker" aria-hidden="true">
        <span>Tonight: {guestInfo.name}, {guestInfo.billing}{next ? ` · Coming up: ${next}` : ''} · Nightcap Live</span>
      </div>
    </section>
  );
}

function Subtitle({ text }: { text: string }) {
  // Only the sentence being spoken, as broadcast subtitles show it.
  const sentences = text.trim().split(/(?<=[.!?…])\s+/);
  let line = sentences.pop() ?? '';
  if (line.length < 30 && sentences.length) line = `${sentences.pop()} ${line}`;
  return <div className="nc-subtitle"><span>{line.length > 120 ? `…${line.slice(-120)}` : line}</span></div>;
}

function Lobby({ guestId, setGuestId, topics, setTopics, onGo }: {
  guestId: string; setGuestId: (id: string) => void; topics: string[]; setTopics: (t: string[]) => void; onGo: (first: string) => void;
}) {
  const [text, setText] = useState(topics.join('\n'));
  useEffect(() => { setText(topics.join('\n')); }, [topics]);
  const list = text.split('\n').map((t) => t.trim()).filter(Boolean);
  return (
    <main className="nc-lobby">
      <div className="nc-lobby-intro">
        <h1>Tonight on Nightcap Live</h1>
        <p>Nico video-calls a guest, live. You run the booth: you never speak, you choose the topics, and Nico opens each one with the guest.</p>
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
        <span>The rundown: one topic per line. Nico opens with the first; send the rest from the booth.</span>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => setTopics(list)} />
      </label>
      <button type="button" className="nc-btn nc-primary nc-go" disabled={!list.length} onClick={() => { setTopics(list); onGo(list[0]); }}>
        Go on air
      </button>
      <p className="nc-fine">Two calls run at once (Nico's and the guest's), up to 15 minutes.</p>
    </main>
  );
}

function Console({ topics, used, disabled, onTopic, onNote, onWrap, onEnd, guestFirst }: {
  topics: string[]; used: Set<string>; disabled: boolean; guestFirst: string;
  onTopic: (t: string) => void; onNote: (t: string) => void; onWrap: () => void; onEnd: () => void;
}) {
  const [topic, setTopic] = useState('');
  const [note, setNote] = useState('');
  const extra = useMemo(() => [...used].filter((t) => !topics.includes(t)), [used, topics]);
  return (
    <div className="nc-console">
      <div className="nc-group">
        <h3>Next topic for Nico</h3>
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
        <h3>A note for Nico</h3>
        <form className="nc-row" onSubmit={(e) => { e.preventDefault(); const t = note.trim(); if (t) { onNote(t); setNote(''); } }}>
          <input className="nc-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. ask for a funny story" disabled={disabled} aria-label="Note for Nico" />
          <button type="submit" className="nc-btn" disabled={disabled || !note.trim()}>Send</button>
        </form>
        <p className="nc-hint">Topics and notes reach Nico on his next turn: he reacts to {guestFirst}, then moves on.</p>
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
      {log.length === 0 && <li className="nc-empty">The show starts when Nico does.</li>}
      {log.map((line) => (
        <li key={line.id} className={`nc-line is-${line.who}`}>
          <span className="nc-who">{line.who === 'host' ? 'Nico' : line.who === 'guest' ? firstName(guest.name) : 'Booth'}</span>
          <span>{line.text}</span>
        </li>
      ))}
    </ol>
  );
}
