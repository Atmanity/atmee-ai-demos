// Crate: a live radio booth hosted by Nova. Nova digs through Spotify and
// works the decks through the booth's tools; the page answers those calls,
// drives the player (the listener's Spotify Premium, else the embed's
// previews), keeps Nova's picture of the deck current and gives her a break
// near the end of every record: the music ducks under her, and the next
// record waits until she has finished introducing it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackToApps, CallStatus, clock as kitClock, useToolNet, ChatPanel, HangUpIcon, HostVideo, useAvatar, useCaptionToggle, type Avatar, type ToolCall } from '../../../src/kit/index.ts';
import { advance, dig, label, lined, listenerWants, nowBecomesNext, pick, playNow, queueNext, setPaused } from '../engine/deck.ts';
import { crateText, deckState, said } from '../engine/director.ts';
import { emptyDeck, type Deck, type Track } from '../engine/types.ts';
import { DEFAULT_THEME, type Theme } from '../engine/theme.ts';
import { useSpotifyPlayer, type Playback } from './player.ts';
import { useSdkPlayer } from './sdk-player.ts';
import { accessToken, connect, connected, disconnect, finishConnect } from './spotify-auth.ts';
import { freshClock, heard, HOLD_MAX_MS, INTRO_TALK_MS, INTRO_WAIT_MS, musicLevel, QUIET_MS, tick, type Clock } from '../engine/booth.ts';
import nova from '../host/portrait.jpg';
import './crate.css';

const API = '/api/apps/dj-booth';
// How long the page waits for Nova's own call before it skips (or pauses) for the listener itself.
const NET_WAIT_MS = 4500;
// The music's fades: a change of record fades the old one out over this, a duck dips over the same.
const FADE_MS = 1200;
const FADE_STEPS = 12;
/** Milliseconds as m:ss. */
const mmss = (ms: number) => kitClock(Math.floor(ms / 1000));
// A break's cue goes stale fast: one Nova hears late would introduce a record that already played.
const BREAK_TTL_S = 15;
// Nova's face stays up this long after she stops, so the stage does not flicker between sentences.
const FACE_LINGER_MS = 1500;
const HOST = 'Nova';

function Logo() {
  return (
    <a className="cr-logo" href="./" aria-label="Crate home">
      <svg viewBox="0 0 40 40" width="30" height="30" aria-hidden="true">
        <circle cx="20" cy="20" r="17" fill="currentColor" />
        <circle cx="20" cy="20" r="11" fill="none" stroke="var(--bg)" strokeWidth="1" opacity=".5" />
        <circle cx="20" cy="20" r="5" fill="var(--bg)" />
      </svg>
      <span>Crate</span>
    </a>
  );
}

/** Whether the booth plays through the listener's Spotify Premium (whole tracks, a volume) or the embed (previews). */
interface SpotifyLink { clientId: string | null; connected: boolean; problem: string }

function Lobby({ onStart, spotify }: { onStart: (mic: boolean) => void; spotify: SpotifyLink }) {
  return (
    <div className="cr-app cr-lobby" style={themeStyle(DEFAULT_THEME)}>
      <Backdrop theme={DEFAULT_THEME} cover={null} />
      <header className="cr-top"><BackToApps /><Logo /></header>
      <main className="cr-hero">
        <img className="cr-hero-face" src={nova} alt="" />
        <h1>Your own radio show, hosted live.</h1>
        <p>Nova digs through Spotify, builds the set and talks you in and out of every record, between the songs, like real radio.</p>
        <div className="cr-cta">
          <button type="button" className="cr-primary" onClick={() => onStart(true)}>Go on air with your voice</button>
          <button type="button" className="cr-secondary" onClick={() => onStart(false)}>Request by typing</button>
        </div>
        {spotify.clientId && (
          <div className="cr-spotify">
            {spotify.connected ? (
              <>
                <span className="cr-spotify-on"><SpotifyIcon /> Spotify Premium connected: whole tracks, music volume</span>
                <button type="button" className="cr-link" onClick={() => { disconnect(); location.reload(); }}>Disconnect</button>
              </>
            ) : (
              <>
                <button type="button" className="cr-spotify-connect" onClick={() => void connect(spotify.clientId!)}><SpotifyIcon /> Connect Spotify Premium</button>
                <p className="cr-small">For whole tracks and a music volume. Without it the booth plays 30-second previews.</p>
              </>
            )}
          </div>
        )}
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
      avatarRef.current?.event(said.break(on, d.queue[0] ?? null, Math.max(0, d.queue.length - 1)), BREAK_TTL_S);
    } else if (cue === 'ended') {
      const after = advance(deckRef.current);
      update(after);
      if (after.playing) { spokeSinceHold.current = true; setHolding(after.playing); }
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

  // Whether Nova has spoken since the held record was set: after a break she already has; after a
  // change of record she is about to introduce it, and the record waits for that intro.
  const spokeSinceHold = useRef(true);

  const spin = useCallback((track: Track, from: Deck = deckRef.current) => {
    clock.current = freshClock(track.id);
    setHolding(null);
    setOnBreak(false);
    update(playNow(from, track));
    setProgress(null);
    void player.load(track);
  }, [player]);

  /** A new record in place of the one on: the old fades out, the new waits for Nova to introduce it. */
  const changeOver = useCallback((track: Track, from: Deck = deckRef.current) => {
    if (!from.playing || from.paused) return spin(track, from);
    clock.current = freshClock(track.id);
    setOnBreak(false);
    update(playNow(from, track));
    setProgress(null);
    spokeSinceHold.current = false;
    setHolding(track);
  }, [spin]);

  /** Digs for records: the crate on screen becomes the results; null when search is not set up. */
  const search = useCallback(async (query: string): Promise<Track[] | null> => {
    const res = await fetch(`${API}/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    if (res.status === 503) return null;
    if (!res.ok) throw new Error(`search: ${res.status}`);
    const { tracks } = await res.json() as { tracks: Track[] };
    update(dig(deckRef.current, query, tracks));
    return tracks;
  }, []);

  // When a record was last put on "now", and when the listener last asked for anything: a request may cut a record off, Nova alone may not.
  const lastNowAt = useRef(0);
  const lastListenerAt = useRef(0);

  /** A record on now (a change-over when one is playing) or in line: what Nova is told. */
  const put = useCallback((track: Track, when: unknown): string => {
    const d = deckRef.current;
    if (lined(d, track)) return said.alreadyLined(track);
    const cutsOff = when !== 'next' && d.playing && nowBecomesNext(lastNowAt.current, lastListenerAt.current, Date.now());
    if ((when === 'next' || cutsOff) && d.playing) {
      const next = queueNext(d, track);
      update(next);
      return cutsOff ? said.heldForOpener(track, next.queue.length) : said.queued(track, next.queue.length);
    }
    lastNowAt.current = Date.now();
    if (d.playing && !d.paused) {
      changeOver(track);
      return said.changeOver(track);
    }
    spin(track);
    return said.playing(track);
  }, [changeOver, spin]);

  // Nova's tool calls: the deck changes, the player follows, the result is what Nova says next.
  const onToolCall = useCallback(async ({ id, name, arguments: args }: ToolCall) => {
    const d = deckRef.current;
    console.info('[crate] tool %s %o%s', name, args, id.startsWith('net-') ? ' (the page, for the listener)' : '');
    switch (name) {
      case 'search_tracks': {
        const query = String(args.query ?? '').trim().slice(0, 200);
        if (!query) return 'No search was given: say what to search for.';
        const tracks = await search(query);
        return tracks ? crateText(query, tracks) : said.noSearch();
      }
      case 'play_track': {
        const track = pick(d, args.number);
        return track ? put(track, args.when) : said.noPick(args.number, d);
      }
      case 'play_request': {
        // One step for a listener's request: the best match, played (or lined up) at once.
        const query = String(args.query ?? '').trim().slice(0, 200);
        if (!query) return 'No request was given: ask what they would like.';
        const tracks = await search(query);
        if (!tracks) return said.noSearch();
        if (!tracks.length) return crateText(query, tracks);
        return put(tracks[0], args.when ?? 'now');
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
        if (next.playing) changeOver(next.playing, next);
        else { update(next); void player.pause(); }
        return said.skipped(next.playing);
      }
    }
    throw new Error(`unknown tool ${name}`);
  }, [search, put, changeOver, player]);

  const cc = useCaptionToggle('dj-booth', false);
  // The side panel stays closed until the listener opens the playlist or the chat.
  const [tab, setTab] = useState<'chat' | 'next' | 'crate' | null>(null);
  // The volumes live behind a gear: open on a click, closed by a click elsewhere or Escape.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!settingsOpen) return;
    const away = (e: PointerEvent) => { if (!settingsRef.current?.contains(e.target as Node)) setSettingsOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setSettingsOpen(false); };
    addEventListener('pointerdown', away);
    addEventListener('keydown', escape);
    return () => { removeEventListener('pointerdown', away); removeEventListener('keydown', escape); };
  }, [settingsOpen]);

  // The look follows the record: each one's theme is asked for when it is lined up, so it is ready as it plays.
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const themes = useRef(new Map<string, Promise<Theme>>());
  const themeOf = useCallback((t: Track) => {
    if (!themes.current.has(t.id)) {
      themes.current.set(t.id, fetch(`${API}/theme`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ track: t }) })
        .then((r) => r.json()).then((j) => j.theme as Theme).catch(() => DEFAULT_THEME));
    }
    return themes.current.get(t.id)!;
  }, []);
  useEffect(() => {
    const on = deck.playing;
    if (!on) return;
    let current = true;
    void themeOf(on).then((t) => { if (current) setTheme(t); });
    return () => { current = false; };
  }, [deck.playing?.id]);
  useEffect(() => { if (deck.queue[0]) void themeOf(deck.queue[0]); }, [deck.queue[0]?.id]);
  const [pushToTalk, setPushToTalk] = useState(false);
  // The listener's plain asks (skip, pause, carry on) happen even when Nova answers without the tool:
  // the page does them itself a few seconds on and tells her.
  const net = useToolNet({
    match: (text) => { const name = listenerWants(text); return name ? { id: `net-${Date.now()}`, name, arguments: {} } : null; },
    run: async (call) => String(await onToolCall(call)),
    avatar: () => avatarRef.current!,
    waitMs: NET_WAIT_MS,
  });
  const avatar = useAvatar('dj-booth', {
    onToolCall: net.watch(onToolCall),
    onUserSaid: (text) => { lastListenerAt.current = Date.now(); net.heard(text); },
  });
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  // After a break, the next record waits until Nova has been quiet a moment (or too long has passed).
  useEffect(() => {
    if (!holding) return;
    if (avatar.speaking) {
      spokeSinceHold.current = true;
      const giveUp = setTimeout(() => spin(holding), HOLD_MAX_MS);
      return () => clearTimeout(giveUp);
    }
    // An intro still to come is waited for (a while); one given, only until Nova has been quiet a moment.
    const go = setTimeout(() => spin(holding), spokeSinceHold.current ? QUIET_MS : INTRO_WAIT_MS);
    return () => clearTimeout(go);
  }, [holding, avatar.speaking]);

  // The volumes: the music ducks under Nova (in her breaks, and whenever she speaks over a record).
  const [musicVolume, setMusicVolume] = useState(0.8);
  const [novaVolume, setNovaVolume] = useState(1);
  // Unprompted words over a playing record (Causeur's check-ins, which a session cannot turn off)
  // play silent: no voice, no overlay, no dip in the music. Between utterances the page keeps its
  // guess for the next one, so a check-in's first syllable never slips out; an utterance keeps the
  // verdict it started with.
  const musicOn = live && Boolean(deck.playing) && !deck.paused && !holding;
  const [muffled, setMuffled] = useState(false);
  const wasSpeaking = useRef(false);
  useEffect(() => {
    const starting = avatar.speaking && !wasSpeaking.current;
    wasSpeaking.current = avatar.speaking;
    if (avatar.speaking && !starting) return;
    const verdict = !heard({ musicOn, onBreak, sinceListenerMs: Date.now() - lastListenerAt.current, positionMs: progress?.position ?? 0 });
    setMuffled(verdict);
    if (starting && verdict) console.info('[crate] an unprompted line over the record plays silent');
  }, [avatar.speaking, musicOn, onBreak, (progress?.position ?? 0) < INTRO_TALK_MS]);
  const voiced = avatar.speaking && !muffled;
  const ducked = voiced || onBreak || Boolean(holding);
  const level = useRef(musicVolume);
  useEffect(() => {
    // A short fade, not a jump.
    const target = holding ? 0 : musicLevel(musicVolume, ducked);
    const from = level.current;
    let step = 0;
    const id = setInterval(() => {
      step += 1;
      level.current = from + (target - from) * (step / FADE_STEPS);
      player.setVolume(level.current);
      if (step >= FADE_STEPS) {
        clearInterval(id);
        // Faded out for a held record: stop the old one (the embed, with no volume, stops here at once).
        if (holding) void player.pause();
      }
    }, FADE_MS / FADE_STEPS);
    return () => clearInterval(id);
  }, [musicVolume, ducked, player, Boolean(holding)]);
  useEffect(() => { if (avatar.audioRef.current) avatar.audioRef.current.volume = muffled ? 0 : novaVolume; }, [novaVolume, muffled, avatar.phase]);

  useEffect(() => { if (avatar.phase === 'starting') avatar.event(said.start(), 60); }, [avatar.phase]);
  // Nova's picture of the deck follows the deck.
  useEffect(() => { avatar.state(deckState(deck)); }, [deck]);
  // The music stops with the show.
  useEffect(() => { if (avatar.phase === 'ended' || avatar.phase === 'failed') { setHolding(null); void player.pause(); } }, [avatar.phase]);

  // The listener's own hands on the decks: Nova cannot see the screen, so it is told.
  function press(what: string, act: () => void) {
    lastListenerAt.current = Date.now();
    act();
    if (live) avatar.event(said.pressed(what), 20);
  }

  // The stage shows Nova only when she is on the mic; the rest of the time, the record.
  // Full when no music plays (between records, paused, quiet decks); over music, a small round overlay on the cover.
  const [talking, setTalking] = useState(false);
  useEffect(() => {
    if (voiced) return void setTalking(true);
    const id = setTimeout(() => setTalking(false), FACE_LINGER_MS);
    return () => clearTimeout(id);
  }, [voiced]);
  const stage: 'face' | 'overlay' | 'record' = !musicOn ? 'face' : talking ? 'overlay' : 'record';

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
    <div className="cr-app" style={themeStyle(theme)} data-backdrop={theme.backdrop}>
      <Backdrop theme={theme} cover={deck.playing?.cover ?? null} />
      <header className="cr-top">
        <BackToApps avatar={avatar} name={HOST} /><Logo />
        <span className="cr-mood" title="This look was made by AI for the record playing">✦ {theme.mood}</span>
        {spotify.clientId && !useSdk && (
          // The Premium player (a music volume, the dip under Nova) is a sign-in away; it leaves the page, so the show ends first.
          <button type="button" className="cr-pill cr-pill-spotify" title="Connect Spotify Premium for a music volume (ends this show)"
            onClick={() => { if (confirm('Connecting Spotify Premium ends this show; start a new one after. Connect now?')) { void avatar.end().finally(() => void connect(spotify.clientId!)); } }}>
            <SpotifyIcon /> Connect Premium
          </button>
        )}
        <button type="button" className={`cr-pill is-first ${tab === 'next' || tab === 'crate' ? 'is-on' : ''}`} onClick={() => setTab(tab === 'next' || tab === 'crate' ? null : 'next')}>
          Playlist{deck.queue.length ? ` · ${deck.queue.length}` : ''}
        </button>
        <button type="button" className={`cr-pill ${tab === 'chat' ? 'is-on' : ''}`} onClick={() => setTab(tab === 'chat' ? null : 'chat')}>Chat</button>
        <div className="cr-settings" ref={settingsRef}>
          <button type="button" className={`cr-pill cr-gear ${settingsOpen ? 'is-on' : ''}`} aria-expanded={settingsOpen} aria-label="Settings" title="Settings"
            onClick={() => setSettingsOpen((o) => !o)}><GearIcon /></button>
          {settingsOpen && (
            <div className="cr-mixer" role="dialog" aria-label="Volume">
                  {/* Spotify's embed is another site's frame: no page can set its volume, so the slider is there only with Premium. */}
                  {player.canVolume && (
                    <label>
                      <span>Music</span>
                      <input type="range" min={0} max={1} step={0.05} value={musicVolume} onChange={(e) => setMusicVolume(Number(e.target.value))} aria-label="Music volume" />
                    </label>
                  )}
                  <label>
                    <span>{HOST}</span>
                    <input type="range" min={0} max={1} step={0.05} value={novaVolume} onChange={(e) => setNovaVolume(Number(e.target.value))} aria-label={`${HOST}'s volume`} />
                  </label>
            </div>
          )}
        </div>
        {live && <span className="cr-onair">On air</span>}
        {live && <button type="button" className="cr-end" onClick={() => void avatar.end()} title="End the show"><HangUpIcon /></button>}
      </header>

      <main className={`cr-main ${tab === null ? 'is-solo' : ''}`}>
        <section className="cr-center" aria-label="The booth">
          <div className={`cr-stage is-${stage}`}>
            {/* Mounted all along: the call's video plays into it, shown or not. */}
            <HostVideo avatar={avatar} captions={cc.on && !muffled} onToggleCaptions={cc.toggle} name={HOST} poster={nova} className="cr-host-video">
              <CallStatus avatar={avatar} name={HOST} again="Call Nova back" />
            </HostVideo>
            {deck.playing?.cover && (
              <div className="cr-record" aria-hidden={stage === 'face'}>
                <img key={deck.playing.cover} src={deck.playing.cover} alt={`${deck.playing.title} cover`} />
              </div>
            )}
            <span className="cr-stage-tag">{stage === 'record' ? `${HOST} on the decks` : `${HOST} on the mic`}</span>
          </div>

          <div className="cr-meta">
            <p className="cr-kicker">{kicker}</p>
            <h1 className="cr-title">{deck.playing ? deck.playing.title : 'Ask Nova for a record'}</h1>
            {deck.playing && <p className="cr-artist">{deck.playing.artist}{deck.playing.year ? ` · ${deck.playing.year}` : ''}</p>}
            <div className="cr-time">
              <span>{progress && !holding ? mmss(progress.position) : '0:00'}</span>
              <div className="cr-bar" role="progressbar" aria-label="Time in the record" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(holding ? 0 : pct)}>
                <span style={{ width: `${holding ? 0 : pct}%` }} />
              </div>
              <span>{progress && progress.duration > 0 ? mmss(progress.duration) : deck.playing?.durationMs ? mmss(deck.playing.durationMs) : '–:––'}</span>
            </div>
          </div>

          <div className="cr-dock">
            <button type="button" className="cr-icon" disabled={!deck.playing} title={deck.paused ? 'Resume' : 'Pause'}
              onClick={() => press(deck.paused ? 'resumed the music' : 'paused the music', () => {
                void (deck.paused ? player.resume() : player.pause());
                update(setPaused(deckRef.current, !deck.paused));
              })}>{deck.paused ? <PlayIcon /> : <PauseIcon />}</button>
            {live && pushToTalk ? <PushToTalk avatar={avatar} /> : <p className="cr-typing">Type your requests in the chat</p>}
            <button type="button" className="cr-icon" disabled={!deck.playing} title="Skip" onClick={() => {
              const next = advance(deckRef.current);
              const skippedWhat = `skipped ${deckRef.current.playing ? label(deckRef.current.playing) : 'the record'}`;
              lastListenerAt.current = Date.now();
              if (next.playing) {
                changeOver(next.playing, next);
                if (live) avatar.event(said.chose(skippedWhat, next.playing), 20);
              } else press(skippedWhat, () => { update(next); void player.pause(); });
            }}><SkipIcon /></button>
          </div>

          {deck.queue.length > 0 && (
            <section className="cr-upnext" aria-label="Up next">
              <h2>Up next</h2>
              <ol>
                {deck.queue.slice(0, 3).map((t, i) => (
                  <li key={`${t.id}-${i}`}>
                    {t.art ? <img src={t.art} alt="" /> : <span className="cr-blank" />}
                    <span><b>{t.title}</b><small>{t.artist}</small></span>
                  </li>
                ))}
              </ol>
              {deck.queue.length > 3 && <button type="button" className="cr-link" onClick={() => setTab('next')}>+{deck.queue.length - 3} more</button>}
            </section>
          )}
          <div ref={player.host} className="cr-embed" />
        </section>

        <aside className="cr-side" hidden={tab === null}>
          <button type="button" className="cr-close" onClick={() => setTab(null)} aria-label="Close">×</button>
          <nav className="cr-tabs" role="tablist">
            {(['chat', 'next', 'crate'] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'is-on' : ''} onClick={() => setTab(t)}>
                {t === 'chat' ? 'Chat' : t === 'next' ? `Up next${deck.queue.length ? ` · ${deck.queue.length}` : ''}` : 'Crate'}
              </button>
            ))}
          </nav>
          <div className="cr-panel" hidden={tab !== 'chat'}>
            <ChatPanel avatar={avatar} name={HOST} className="cr-chat" placeholder="Request a song, an artist, a mood…" empty={<>Hold the button to talk, or type: "play some 80s synth-pop".</>} />
          </div>
          <div className="cr-panel" hidden={tab !== 'next'}>
            {deck.queue.length ? (
              <ol className="cr-rows">{deck.queue.map((t, i) => <TrackRow key={`${t.id}-${i}`} track={t} />)}</ol>
            ) : <p className="cr-empty">Nova lines records up here as the set builds.</p>}
          </div>
          <div className="cr-panel" hidden={tab !== 'crate'}>
            {deck.dug && <p className="cr-dug">Dug for <b>{deck.dug}</b></p>}
            {deck.crate.length ? (
              <ol className="cr-rows">
                {deck.crate.map((t, i) => (
                  <TrackRow key={t.id} track={t} number={i + 1} onPlay={() => {
                    lastListenerAt.current = Date.now();
                    changeOver(t);
                    if (live) avatar.event(said.chose(`put on ${label(t)}`, t), 20);
                  }} />
                ))}
              </ol>
            ) : <p className="cr-empty">Records Nova digs up land here. Tap one to put it on yourself.</p>}
          </div>
        </aside>
      </main>
    </div>
  );
}

function TrackRow({ track, number, onPlay }: { track: Track; number?: number; onPlay?: () => void }) {
  const body = (
    <>
      {track.art ? <img src={track.art} alt="" /> : <span className="cr-blank" />}
      <span><b>{track.title}</b><small>{track.artist}{track.year ? ` · ${track.year}` : ''}</small></span>
      {number !== undefined && <em>{number}</em>}
    </>
  );
  return <li>{onPlay ? <button type="button" onClick={onPlay} aria-label={`Play ${track.title} by ${track.artist}`}>{body}</button> : <div>{body}</div>}</li>;
}

const icon = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true } as const;
const SpotifyIcon = () => <svg {...icon} width={18} height={18}><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.6 14.4a.6.6 0 0 1-.9.2c-2.4-1.5-5.4-1.8-8.9-1a.6.6 0 1 1-.3-1.2c3.9-.9 7.2-.5 9.9 1.1.3.2.4.6.2.9zm1.2-2.7a.8.8 0 0 1-1.1.3c-2.7-1.7-6.9-2.2-10.1-1.2a.8.8 0 1 1-.5-1.5c3.7-1.1 8.3-.6 11.4 1.3.4.2.5.7.3 1.1zm.1-2.8C14.7 9 9.4 8.8 6.3 9.7a.9.9 0 1 1-.5-1.8c3.5-1.1 9.4-.9 13.1 1.3a.9.9 0 1 1-1 1.7z" /></svg>;
const GearIcon = () => <svg {...icon} width={18} height={18}><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)" /></svg>;
const PauseIcon = () => <svg {...icon}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>;
const PlayIcon = () => <svg {...icon}><path d="M7 4.5v15l13-7.5z" /></svg>;
const SkipIcon = () => <svg {...icon}><path d="M5 5v14l10-7zM17 5h2.5v14H17z" /></svg>;

/** The theme as the page's custom properties; registered in the CSS, so every change fades. */
function themeStyle(t: Theme): React.CSSProperties {
  return {
    '--bg': t.bg, '--surface': t.surface, '--ink': t.ink, '--dim': t.dim, '--accent': t.accent, '--glow': t.glow,
    '--display': `'${t.font}', 'Archivo Black', sans-serif`,
  } as React.CSSProperties;
}

/** The moving light behind everything: the record's colours, and its cover blurred into them. */
function Backdrop({ theme, cover }: { theme: Theme; cover: string | null }) {
  return (
    <div className={`cr-backdrop is-${theme.backdrop}`} aria-hidden="true">
      {cover && <div className="cr-backdrop-cover" key={cover} style={{ backgroundImage: `url(${cover})` }} />}
      <span className="cr-blob is-a" /><span className="cr-blob is-b" /><span className="cr-blob is-c" />
      <div className="cr-grain" />
    </div>
  );
}
