// Crate: a live radio booth hosted by Nova. Nova digs through Spotify and
// works the decks through the booth's tools; the page answers those calls,
// drives the player (the listener's Spotify Premium, else the embed's
// previews), keeps Nova's picture of the deck current and gives her a break
// near the end of every record: the music ducks under her, and the next
// record waits until she has finished introducing it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackToApps, CallStatus, ChatPanel, HangUpIcon, HostVideo, useAvatar, useCaptionToggle, type Avatar, type ToolCall } from '../../../src/kit/index.ts';
import { advance, dig, label, pick, playNow, queueNext, setPaused } from '../engine/deck.ts';
import { crateText, deckState, said } from '../engine/director.ts';
import { emptyDeck, type Deck, type Track } from '../engine/types.ts';
import { useSpotifyPlayer, type Playback } from './player.ts';
import { useSdkPlayer } from './sdk-player.ts';
import { accessToken, connect, connected, disconnect, finishConnect } from './spotify-auth.ts';
import { freshClock, HOLD_MAX_MS, musicLevel, QUIET_MS, tick, type Clock } from '../engine/booth.ts';
import nova from '../host/portrait.jpg';
import './crate.css';

const API = '/api/apps/dj-booth';
const HOST = 'Nova';

function Logo() {
  return (
    <a className="cr-logo" href="./" aria-label="Crate home">
      <svg viewBox="0 0 40 40" width="30" height="30" aria-hidden="true">
        <circle cx="20" cy="20" r="17" fill="currentColor" />
        <circle cx="20" cy="20" r="11" fill="none" stroke="var(--cr-bg)" strokeWidth="1" opacity=".5" />
        <circle cx="20" cy="20" r="5" fill="var(--cr-bg)" />
      </svg>
      <span>Crate</span>
    </a>
  );
}

/** Whether the booth plays through the listener's Spotify Premium (whole tracks, a volume) or the embed (previews). */
interface SpotifyLink { clientId: string | null; connected: boolean; problem: string }

function Lobby({ onStart, spotify }: { onStart: (mic: boolean) => void; spotify: SpotifyLink }) {
  return (
    <div className="cr-lobby">
      <header className="cr-top"><BackToApps /><Logo /></header>
      <main className="cr-hero">
        <img className="cr-hero-face" src={nova} alt="" />
        <h1>Your own radio show, hosted live.</h1>
        <p>Nova digs through Spotify, builds the set and talks you in and out of every record, between the songs, like real radio.</p>
        <div className="cr-cta">
          <button type="button" className="cr-primary" onClick={() => onStart(true)}>Go on air with your voice</button>
          <button type="button" className="cr-secondary" onClick={() => onStart(false)}>Request by typing</button>
        </div>
        {spotify.clientId && (spotify.connected ? (
          <p className="cr-small">Playing through your Spotify Premium: whole tracks, with a volume. <button type="button" className="cr-link" onClick={() => { disconnect(); location.reload(); }}>Disconnect</button></p>
        ) : (
          <p className="cr-small">
            <button type="button" className="cr-link" onClick={() => void connect(spotify.clientId!)}>Connect Spotify Premium</button> for whole tracks and a music volume; without it the booth plays 30-second previews.
          </p>
        ))}
        {spotify.problem && <p className="cr-small cr-problem">{spotify.problem}</p>}
      </main>
    </div>
  );
}

// How long the microphone stays open after the button is let go, so the last word is not cut off.
const TAIL_MS = 400;

/** Hold to talk (the button, or the space bar outside the text box): the only way the mic opens. */
function PushToTalk({ avatar }: { avatar: Avatar }) {
  const [held, setHeld] = useState(false);
  const holding = useRef(false);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mic = useRef(avatar);
  mic.current = avatar;
  const down = useCallback(() => {
    clearTimeout(closing.current);
    holding.current = true;
    setHeld(true);
    mic.current.setMic(true);
  }, []);
  const up = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    setHeld(false);
    closing.current = setTimeout(() => mic.current.setMic(false), TAIL_MS);
  }, []);
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const keydown = (e: KeyboardEvent) => { if (e.code === 'Space' && !typing(e)) { e.preventDefault(); if (!e.repeat) down(); } };
    const keyup = (e: KeyboardEvent) => { if (e.code === 'Space' && !typing(e)) up(); };
    addEventListener('keydown', keydown);
    addEventListener('keyup', keyup);
    return () => { removeEventListener('keydown', keydown); removeEventListener('keyup', keyup); clearTimeout(closing.current); };
  }, [down, up]);
  return (
    <button
      type="button" className={`cr-ptt ${held ? 'is-held' : ''}`} aria-pressed={held}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); down(); }}
      onPointerUp={up} onPointerCancel={up} onContextMenu={(e) => e.preventDefault()}
    >
      <span className="cr-ptt-dot" aria-hidden="true" />
      {held ? 'Listening… let go to send' : 'Hold to talk to Nova'}
      <small>or hold the space bar</small>
    </button>
  );
}

export function App() {
  const [deck, setDeck] = useState<Deck>(emptyDeck);
  const deckRef = useRef(deck);
  const update = useCallback((next: Deck) => { deckRef.current = next; setDeck(next); }, []);
  const [progress, setProgress] = useState<Playback | null>(null);
  const avatarRef = useRef<Avatar | null>(null);

  // Spotify: the listener's Premium through the Web Playback SDK when connected, else the embed.
  const [spotify, setSpotify] = useState<SpotifyLink>({ clientId: null, connected: connected(), problem: '' });
  useEffect(() => {
    void (async () => {
      const { clientId } = await fetch(`${API}/config`).then((r) => r.json()).catch(() => ({ clientId: null }));
      const signedIn = clientId ? await finishConnect(clientId) : false;
      setSpotify((s) => ({ ...s, clientId, connected: signedIn || connected() }));
    })();
  }, []);
  const token = useCallback(() => accessToken(spotify.clientId ?? ''), [spotify.clientId]);
  // A Premium player that fails (no Premium, an old token) falls back to the embed for the rest of the visit.
  const [sdkFailed, setSdkFailed] = useState(false);
  const useSdk = spotify.connected && Boolean(spotify.clientId) && !sdkFailed;

  // The radio clock: each record's break near its end, its end, and the next record held until Nova finishes.
  const clock = useRef<Clock>(freshClock());
  const [onBreak, setOnBreak] = useState(false);
  const [holding, setHolding] = useState<Track | null>(null);
  const onPlayback = (p: Playback) => {
    setProgress(p);
    const on = deckRef.current.playing;
    if (!on || holding) return;
    const { clock: next, cue } = tick(clock.current, on.id, p);
    clock.current = next;
    if (cue === 'break') {
      setOnBreak(true);
      const d = deckRef.current;
      avatarRef.current?.event(said.break(on, d.queue[0] ?? null, Math.max(0, d.queue.length - 1)), 30);
    } else if (cue === 'ended') {
      const after = advance(deckRef.current);
      update(after);
      if (after.playing) setHolding(after.playing);
      else {
        setOnBreak(false);
        avatarRef.current?.event(said.ranOut(), 30);
      }
    }
  };
  const embed = useSpotifyPlayer(onPlayback);
  const sdk = useSdkPlayer(token, onPlayback, (problem) => {
    console.warn('[crate] spotify player: %s', problem);
    setSdkFailed(true);
    setSpotify((s) => ({ ...s, problem: `${problem}. Playing previews instead.` }));
  });
  const player = useSdk ? sdk : embed;

  const spin = useCallback((track: Track, from: Deck = deckRef.current) => {
    clock.current = freshClock(track.id);
    setHolding(null);
    setOnBreak(false);
    update(playNow(from, track));
    setProgress(null);
    void player.load(track);
  }, [player]);

  const search = useCallback(async (query: string): Promise<string> => {
    const res = await fetch(`${API}/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    if (res.status === 503) return said.noSearch();
    if (!res.ok) throw new Error(`search: ${res.status}`);
    const { tracks } = await res.json() as { tracks: Track[] };
    update(dig(deckRef.current, query, tracks));
    return crateText(query, tracks);
  }, []);

  // Nova's tool calls: the deck changes, the player follows, the result is what Nova says next.
  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall) => {
    const d = deckRef.current;
    console.info('[crate] tool %s %o', name, args);
    switch (name) {
      case 'search_tracks': {
        const query = String(args.query ?? '').trim().slice(0, 200);
        return query ? search(query) : 'No search was given: say what to search for.';
      }
      case 'play_track': {
        const track = pick(d, args.number);
        if (!track) return said.noPick(args.number, d);
        if (args.when === 'next' && d.playing) {
          const next = queueNext(d, track);
          update(next);
          return said.queued(track, next.queue.length);
        }
        spin(track);
        return said.playing(track);
      }
      case 'pause_music':
        if (!d.playing) return said.nothingOn();
        void player.pause();
        update(setPaused(d, true));
        return said.paused();
      case 'resume_music':
        if (!d.playing) return said.nothingOn();
        void player.resume();
        update(setPaused(d, false));
        return said.resumed();
      case 'skip_track': {
        const next = advance(d);
        if (next.playing) spin(next.playing, next);
        else { update(next); void player.pause(); }
        return said.skipped(next.playing);
      }
    }
    throw new Error(`unknown tool ${name}`);
  }, [search, spin, player]);

  const cc = useCaptionToggle('dj-booth', false);
  const [pushToTalk, setPushToTalk] = useState(false);
  const avatar = useAvatar('dj-booth', { onToolCall });
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  // After a break, the next record waits until Nova has been quiet a moment (or too long has passed).
  useEffect(() => {
    if (!holding) return;
    if (avatar.speaking) {
      const giveUp = setTimeout(() => spin(holding), HOLD_MAX_MS);
      return () => clearTimeout(giveUp);
    }
    const go = setTimeout(() => spin(holding), QUIET_MS);
    return () => clearTimeout(go);
  }, [holding, avatar.speaking]);

  // The volumes: the music ducks under Nova (in her breaks, and whenever she speaks over a record).
  const [musicVolume, setMusicVolume] = useState(0.8);
  const [novaVolume, setNovaVolume] = useState(1);
  const ducked = avatar.speaking || onBreak || Boolean(holding);
  const level = useRef(musicVolume);
  useEffect(() => {
    // A short fade, not a jump.
    const target = musicLevel(musicVolume, ducked);
    const from = level.current;
    let step = 0;
    const id = setInterval(() => {
      step += 1;
      level.current = from + (target - from) * (step / 6);
      player.setVolume(level.current);
      if (step >= 6) clearInterval(id);
    }, 60);
    return () => clearInterval(id);
  }, [musicVolume, ducked, player]);
  useEffect(() => { if (avatar.audioRef.current) avatar.audioRef.current.volume = novaVolume; }, [novaVolume, avatar.phase]);

  useEffect(() => { if (avatar.phase === 'starting') avatar.event(said.start(), 60); }, [avatar.phase]);
  // Nova's picture of the deck follows the deck.
  useEffect(() => { avatar.state(deckState(deck)); }, [deck]);
  // The music stops with the show.
  useEffect(() => { if (avatar.phase === 'ended' || avatar.phase === 'failed') { setHolding(null); void player.pause(); } }, [avatar.phase]);

  // The listener's own hands on the decks: Nova cannot see the screen, so it is told.
  function press(what: string, act: () => void) {
    act();
    if (live) avatar.event(said.pressed(what), 20);
  }

  if (avatar.phase === 'idle') {
    return <Lobby spotify={spotify} onStart={(mic) => {
      player.prepare();
      setPushToTalk(mic);
      // Push to talk: the microphone joins muted and opens only while the button is held.
      void avatar.start({ mic, micMuted: mic });
    }} />;
  }

  const pct = progress && progress.duration > 0 ? Math.min(100, (progress.position / progress.duration) * 100) : 0;
  const kicker = holding ? 'Up after Nova' : deck.playing ? (deck.paused ? 'Paused' : onBreak ? 'Nova on the mic' : 'Now playing') : 'The decks are quiet';

  return (
    <div className="cr-app">
      <header className="cr-top">
        <BackToApps avatar={avatar} name={HOST} /><Logo />
        {live && <span className="cr-onair">On air</span>}
        {live && <button type="button" className="call-round is-end cr-controls" onClick={() => void avatar.end()} title="End the show"><HangUpIcon /></button>}
      </header>

      <main className="cr-main">
        <aside className="cr-host" aria-label={`${HOST}, your DJ`}>
          <HostVideo avatar={avatar} captions={cc.on} onToggleCaptions={cc.toggle} name={HOST} poster={nova} className="cr-host-video">
            <CallStatus avatar={avatar} name={HOST} again="Call Nova back" />
          </HostVideo>
          <p className="cr-nameplate"><b>{HOST}</b> on the decks</p>
          {live && pushToTalk && <PushToTalk avatar={avatar} />}
        </aside>

        <section className="cr-decks" aria-label="The decks">
          <div className="cr-now">
            {deck.playing?.art ? <img src={deck.playing.art} alt="" /> : <div className="cr-blank" aria-hidden="true" />}
            <div>
              <p className="cr-kicker">{kicker}</p>
              <p className="cr-title">{deck.playing ? deck.playing.title : 'Ask Nova for a record'}</p>
              {deck.playing && <p className="cr-artist">{deck.playing.artist}</p>}
              <div className="cr-bar" aria-hidden="true"><span style={{ width: `${holding ? 0 : pct}%` }} /></div>
            </div>
          </div>
          <div className="cr-buttons">
            <button type="button" disabled={!deck.playing} onClick={() => press(deck.paused ? 'resumed the music' : 'paused the music', () => {
              void (deck.paused ? player.resume() : player.pause());
              update(setPaused(deckRef.current, !deck.paused));
            })}>{deck.paused ? 'Resume' : 'Pause'}</button>
            <button type="button" disabled={!deck.playing} onClick={() => {
              const next = advance(deckRef.current);
              press(`skipped ${deckRef.current.playing ? label(deckRef.current.playing) : 'the record'}${next.playing ? `; ${label(next.playing)} is on now` : ''}`, () => {
                if (next.playing) spin(next.playing, next); else { update(next); void player.pause(); }
              });
            }}>Skip</button>
          </div>
          <div className="cr-mixer">
            <label title={player.canVolume ? undefined : 'Connect Spotify Premium (on the start page) for a music volume'}>
              <span>Music</span>
              <input type="range" min={0} max={1} step={0.05} value={musicVolume} disabled={!player.canVolume}
                onChange={(e) => setMusicVolume(Number(e.target.value))} aria-label="Music volume" />
            </label>
            <label>
              <span>{HOST}</span>
              <input type="range" min={0} max={1} step={0.05} value={novaVolume} onChange={(e) => setNovaVolume(Number(e.target.value))} aria-label={`${HOST}'s volume`} />
            </label>
            {!player.canVolume && <small>Previews play at your system volume: connect Spotify Premium for a music volume.</small>}
          </div>
          <div ref={player.host} className="cr-embed" />

          {deck.queue.length > 0 && (
            <div className="cr-list">
              <h2>Up next</h2>
              <ol>{deck.queue.map((t, i) => <li key={`${t.id}-${i}`}><span>{t.title}</span> <small>{t.artist}</small></li>)}</ol>
            </div>
          )}

          <div className="cr-list">
            <h2>{deck.dug ? <>The crate: <em>{deck.dug}</em></> : 'The crate'}</h2>
            {deck.crate.length ? (
              <ol className="cr-crate">
                {deck.crate.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => press(`put on ${label(t)}`, () => spin(t))} aria-label={`Play ${t.title} by ${t.artist}`}>
                      {t.art ? <img src={t.art} alt="" /> : <span className="cr-blank" />}
                      <span><b>{t.title}</b><small>{t.artist}{t.year ? ` · ${t.year}` : ''}</small></span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : <p className="cr-empty">Records Nova digs up land here. Tap one to put it on yourself.</p>}
          </div>
        </section>

        <ChatPanel avatar={avatar} name={HOST} className="cr-chat" placeholder="Request a song, an artist, a mood…" empty={<>Hold the button to talk, or type: "play some 80s synth-pop".</>} />
      </main>
    </div>
  );
}
