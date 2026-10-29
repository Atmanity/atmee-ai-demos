// Crate: a live radio booth hosted by Nova. Nova digs through Spotify and
// works the decks through the booth's tools; the page answers those calls,
// drives the player (the listener's Spotify Premium, else the embed's
// previews), keeps Nova's picture of the deck current and gives her a break
// near the end of every record: the music ducks under her, and the next
// record waits until she has finished introducing it.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackToApps, CallStatus, clock as kitClock, ChatPanel, HangUpIcon, HostVideo, useAvatar, useCaptionToggle, type Avatar, type ToolCall } from '../../../src/kit/index.ts';
import { advance, askOpen, clearHostPicks, dig, label, lined, playedTonight, pick, playNow, queueNext, setPaused } from '../engine/deck.ts';
import { crateText, deckState, LINE_LOW, said } from '../engine/director.ts';
import { emptyDeck, type Deck, type Track } from '../engine/types.ts';
import { DEFAULT_THEME, type Theme } from '../engine/theme.ts';
import { useSpotifyPlayer, type Playback } from './player.ts';
import { useSpeechCall } from './speech.ts';
import { useSdkPlayer } from './sdk-player.ts';
import { accessToken, connect, connected, disconnect, finishConnect } from './spotify-auth.ts';
import { answering, breakLead, freshClock, heard, HOLD_MAX_MS, INTRO_TALK_MS, INTRO_WAIT_MS, musicLevel, QUIET_MS, tick, type Clock, type Hold } from '../engine/booth.ts';
import nova from '../host/portrait.jpg';
import './crate.css';

const API = '/api/apps/dj-booth';
// The face on demand: kept up this long after the listener spoke, and ended after this long unneeded.
const FACE_LISTENER_MS = 30_000;
const FACE_IDLE_MS = 45_000;
// How far into a record a short line is filled, past the time she may talk over it.
const TOP_UP_AT_MS = 25_000;
// A top-up needs at least this long before the break, and expires before it.
const TOP_UP_CLEAR_MS = 8_000;
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
          <button type="button" className="cr-primary" onClick={() => onStart(true)}>Go on air</button>
        </div>
        {spotify.problem && <p className="cr-small cr-problem">{spotify.problem}</p>}
      </main>
      {/* Spotify sits at the foot of the page: the way in is Go on air. */}
      <footer className="cr-lobby-foot">
        {spotify.clientId && (
          <div className="cr-spotify">
            {spotify.connected ? (
              <span className="cr-spotify-chip" title="Whole tracks and a music volume, through your Spotify Premium">
                <SpotifyIcon /><span>Spotify Premium connected</span>
                <button type="button" onClick={() => { disconnect(); location.reload(); }}>Disconnect</button>
              </span>
            ) : (
              <>
                <button type="button" className="cr-spotify-connect" onClick={() => void connect(spotify.clientId!)}><SpotifyIcon /> Connect Spotify Premium</button>
                <p className="cr-small">For whole tracks and a music volume. Without it the booth plays 30-second previews.</p>
              </>
            )}
          </div>
        )}
      </footer>
    </div>
  );
}

// How long the microphone stays open after the button is let go, so the last word is not cut off.
const TAIL_MS = 400;

/** Hold to talk (the button, or the space bar outside the text box): the only way the mic opens. */
/** The steps of a call coming up, in the booth's words. */
const TUNING: Partial<Record<Avatar['phase'], string>> = {
  starting: `Calling ${HOST}`,
  warming: `${HOST} is warming up the booth`,
  connecting: 'Patching you through',
  arriving: `${HOST}'s stepping up to the mic`,
};
const TUNING_STEPS = Object.keys(TUNING);

/**
 * The booth while a call comes up. It goes the moment Nova is really there, her video playing
 * or her voice heard, which is before the kit calls the call live (it waits a moment more for
 * her agent), so no status ever sits over her greeting.
 */
function TuningIn({ avatar }: { avatar: Avatar }) {
  const [present, setPresent] = useState(false);
  useEffect(() => {
    if (avatar.phase === 'starting') setPresent(false);
    const video = avatar.videoRef.current;
    if (!video) return;
    const playing = () => setPresent(true);
    video.addEventListener('playing', playing);
    return () => video.removeEventListener('playing', playing);
  }, [avatar.phase]);
  const step = TUNING[avatar.phase];
  const on = Boolean(step) && !present && !avatar.speaking;
  // Kept mounted through its fade; the last words stay while it fades.
  const last = useRef(step);
  if (step) last.current = step;
  return (
    <div className={`cr-tuning ${on ? 'is-on' : ''}`} role="status" aria-live="polite" aria-hidden={!on}>
      <div className="cr-eq" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ animationDelay: `${i * 0.13}s` }} />)}</div>
      <p className="cr-tuning-words">{last.current}<span className="cr-ellipsis" aria-hidden="true" /></p>
      {avatar.phase === 'warming' && avatar.detail && <p className="cr-tuning-detail">{avatar.detail}</p>}
      <ol className="cr-tuning-steps" aria-hidden="true">
        {TUNING_STEPS.map((p, i) => <li key={p} className={i <= TUNING_STEPS.indexOf(avatar.phase) ? 'is-done' : ''} />)}
      </ol>
    </div>
  );
}

/**
 * `text` as it fits `el` (which caps its height): whole, or "…" and the longest end of it
 * that fits, cut at a word where it can be. Measured in `el`, a hidden twin of the shown line.
 */
function fitTail(el: HTMLElement, text: string): string {
  const fits = (t: string) => { el.textContent = t; return el.scrollHeight <= el.clientHeight + 1; };
  if (fits(text)) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(`…${text.slice(-mid)}`)) lo = mid; else hi = mid - 1;
  }
  const tail = text.slice(-lo);
  const space = tail.indexOf(' ');
  return `…${space > 0 && space < 12 ? tail.slice(space + 1) : tail}`;
}

// How long the button keeps showing what was heard, once the words are final.
const HEARD_SHOWN_MS = 3000;

function PushToTalk({ avatar, onPress }: { avatar: Avatar; onPress?: () => void }) {
  const onAir = avatar.phase === 'live';
  const [held, setHeld] = useState(false);
  // What fits the button's two lines: the whole line, or "…" and as much of its end as fits.
  const measure = useRef<HTMLSpanElement>(null);
  const [fitted, setFitted] = useState('');
  // The words as they are recognised while the button is held, then the final line for a moment.
  const [said, setSaid] = useState('');
  const lineCount = useRef(avatar.lines.length);
  // The last words heard while held, kept on the button after letting go until the final line arrives.
  const lastHeard = useRef('');
  if (held && avatar.heard) lastHeard.current = avatar.heard;
  useEffect(() => {
    const fresh = avatar.lines.slice(lineCount.current);
    lineCount.current = avatar.lines.length;
    const mine = fresh.filter((l) => l.who === 'user' && !l.typed).at(-1);
    if (!mine) return;
    setSaid(mine.text);
    const id = setTimeout(() => setSaid(''), HEARD_SHOWN_MS);
    return () => clearTimeout(id);
  }, [avatar.lines.length]);
  const holding = useRef(false);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mic = useRef(avatar);
  mic.current = avatar;
  const press = useRef(onPress);
  press.current = onPress;
  const down = useCallback(() => {
    if (mic.current.phase !== 'live') return;
    press.current?.();
    clearTimeout(closing.current);
    holding.current = true;
    setHeld(true);
    setSaid('');
    mic.current.setMic(true);
  }, []);
  const up = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    setHeld(false);
    if (lastHeard.current) setSaid(lastHeard.current);
    lastHeard.current = '';
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
  const shown = held ? (avatar.heard || 'Listening…') : said ? `“${said}”` : '';
  useLayoutEffect(() => { setFitted(measure.current && shown ? fitTail(measure.current, shown) : shown); }, [shown]);
  return (
    <button
      type="button" className={`cr-ptt ${held ? 'is-held' : ''}`} aria-pressed={held} disabled={!onAir}
      // The button never takes focus (the space bar works anywhere), so no focus ring sits on it.
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); down(); }}
      onMouseDown={(e) => e.preventDefault()} tabIndex={-1}
      onPointerUp={up} onPointerCancel={up} onContextMenu={(e) => e.preventDefault()}
    >
      <span className="cr-ptt-dot" aria-hidden="true" />
      <span ref={measure} className="cr-ptt-words is-said cr-ptt-measure" aria-hidden="true" />
      {!onAir
        ? <span className="cr-ptt-words"><span>Getting Nova on air…</span></span>
        : held
        ? <span className="cr-ptt-words is-said" aria-live="polite"><span>{fitted}</span></span>
        : said
          ? <span className="cr-ptt-words is-said"><span>{fitted}</span></span>
          : <span className="cr-ptt-words"><span>Hold to talk to Nova</span></span>}
      <small>{!onAir ? 'the mic opens in a moment' : held ? 'let go to send' : said ? 'sent to Nova' : 'or hold the space bar'}</small>
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
  // The record whose line was last topped up, so each is asked once.
  const toppedUp = useRef<string | null>(null);
  const [onBreak, setOnBreak] = useState(false);
  const [holding, setHolding] = useState<Track | null>(null);
  const onPlayback = (p: Playback) => {
    setProgress(p);
    const on = deckRef.current.playing;
    if (!on || holding) return;
    const { clock: next, cue } = tick(clock.current, on.id, p);
    clock.current = next;
    // The line is filled early in each record, so her break never finds it empty.
    const d = deckRef.current;
    // Only well before the break (a 30-second preview never gets one: its break fills the line), and
    // short-lived, so a late delivery can never land in the break or on the next record.
    const beforeBreak = p.duration - p.position - breakLead(p.duration);
    if (!p.isPaused && p.position >= TOP_UP_AT_MS && beforeBreak > TOP_UP_CLEAR_MS && d.queue.length < LINE_LOW && toppedUp.current !== on.id) {
      toppedUp.current = on.id;
      avatarRef.current?.event(said.topUp(on, d.queue.length), Math.min(10, Math.floor((beforeBreak - TOP_UP_CLEAR_MS / 2) / 1000)));
    }
    if (cue === 'break') {
      setOnBreak(true);
      const d = deckRef.current;
      avatarRef.current?.event(said.break(on, d.queue[0] ?? null, Math.max(0, d.queue.length - 1)), BREAK_TTL_S);
    } else if (cue === 'ended') {
      const after = advance(deckRef.current);
      update(after);
      if (after.playing) hold(after.playing, 'break', true);
      else {
        setOnBreak(false);
        avatarRef.current?.event(said.ranOut(), 30);
      }
    }
  };
  // Which player drives the radio clock: the Premium one while it is in use, else the embed. It
  // switches the moment Premium fails, before the page re-renders, so no leftover update from the
  // failed player moves the clock.
  const sdkLive = useRef(useSdk);
  sdkLive.current = useSdk;
  const holdingNow = useRef<Track | null>(null);
  holdingNow.current = holding;
  const embed = useSpotifyPlayer((p) => { if (!sdkLive.current) onPlayback(p); });
  const sdk = useSdkPlayer(token, (p) => { if (sdkLive.current) onPlayback(p); }, (problem) => {
    console.warn('[crate] spotify player: %s', problem);
    sdkLive.current = false;
    playerRef.current = embed;
    void sdk.pause();
    setSdkFailed(true);
    setSpotify((s) => ({ ...s, problem: `${problem}. Playing previews instead.` }));
    // The record that failed to play goes on the embed now, so the show does not go silent; one
    // still waiting for Nova's intro waits on, and the hold starts it on the embed.
    const d = deckRef.current;
    if (d.playing && !d.paused && !holdingNow.current) {
      clock.current = freshClock(d.playing.id);
      void embed.load(d.playing);
    }
  });
  const player = useSdk ? sdk : embed;
  // The player a record starts on, read when it starts (a hold set before a switch uses the new one).
  const playerRef = useRef(player);
  playerRef.current = player;

  // Whether Nova has spoken since the held record was set: after a break she already has; after a
  // change of record she is about to introduce it, and the record waits for that intro.
  const spokeSinceHold = useRef(true);
  // What the held record is waiting for, and since when (HOLD_MAX_MS).
  const holdKind = useRef<Hold>('break');
  const heldAt = useRef(0);
  const hold = useCallback((track: Track, kind: Hold, spoke: boolean) => {
    holdKind.current = kind;
    heldAt.current = Date.now();
    spokeSinceHold.current = spoke;
    setHolding(track);
  }, []);

  const spin = useCallback((track: Track, from: Deck = deckRef.current) => {
    clock.current = freshClock(track.id);
    setHolding(null);
    setOnBreak(false);
    update(playNow(from, track));
    setProgress(null);
    void playerRef.current.load(track);
  }, []);

  /** A new record in place of the one on: the old fades out, the new waits for Nova to introduce it. */
  const changeOver = useCallback((track: Track, from: Deck = deckRef.current) => {
    if (!from.playing || from.paused) return spin(track, from);
    clock.current = freshClock(track.id);
    setOnBreak(false);
    update(playNow(from, track));
    setProgress(null);
    hold(track, 'change', false);
  }, [spin, hold]);

  /** Digs for records: the crate on screen becomes the results; null when search is not set up. */
  const search = useCallback(async (query: string): Promise<Track[] | null> => {
    const res = await fetch(`${API}/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    if (res.status === 503) return null;
    if (!res.ok) throw new Error(`search: ${res.status}`);
    const { tracks } = await res.json() as { tracks: Track[] };
    update(dig(deckRef.current, query, tracks));
    return tracks;
  }, []);

  // Whether the show has had its first record: that one waits for Nova's opening.
  const opened = useRef(false);
  // The records the listener asked for (by id): a change of vibe keeps them in line.
  const askedFor = useRef(new Set<string>());
  // When the listener last asked for anything: a request may cut a record off, Nova alone may not.
  const lastListenerAt = useRef(0);
  // When the listener's last ask was acted on with a record put on now.
  const askUsedAt = useRef(0);

  /** A record on now (a change-over when one is playing) or in line: what Nova is told. */
  const put = useCallback((track: Track, when: unknown, requested = false): string => {
    const d = deckRef.current;
    if (lined(d, track)) return said.alreadyLined(track);
    // Acting on the listener's ask (until used, or 90 s): a record may then cut in, replay or change the vibe.
    // Nova never picks a song twice herself, and never cuts a record off on her own.
    const asked = requested || askOpen(lastListenerAt.current, askUsedAt.current, Date.now());
    if (!asked && playedTonight(d, track)) return said.alreadyPlayed(track);
    // Nova never cuts off a playing record on her own: her "now" goes in line unless the listener asked.
    const cutsOff = when !== 'next' && Boolean(d.playing) && opened.current && !asked;
    if ((when === 'next' || cutsOff) && d.playing) {
      if (asked) askedFor.current.add(track.id);
      const next = queueNext(d, track);
      update(next);
      return cutsOff ? said.heldForOpener(track, next.queue.length) : said.queued(track, next.queue.length);
    }
    // A record on "now" for the listener uses their ask.
    if (asked) askUsedAt.current = Date.now();
    // The listener changing what plays now changes the direction: Nova's own picks in line go, theirs stay.
    let from = d;
    let cleared = 0;
    if (asked && opened.current) {
      from = clearHostPicks(d, (t) => askedFor.current.has(t.id));
      cleared = d.queue.length - from.queue.length;
    }
    if (!opened.current) {
      // The show's first record waits for Nova's opening: the style of the set, then the record.
      opened.current = true;
      clock.current = freshClock(track.id);
      update(playNow(d, track));
      hold(track, 'opener', false);
      return said.opener(track);
    }
    if (from.playing && !from.paused) {
      changeOver(track, from);
      return said.changeOver(track) + said.newVibe(cleared);
    }
    spin(track, from);
    return said.playing(track) + said.newVibe(cleared);
  }, [changeOver, spin]);

  // Nova's tool calls: the deck changes, the player follows, the result is what Nova says next.
  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall) => {
    const d = deckRef.current;
    console.info('[crate] tool %s %o', name, args);
    switch (name) {
      case 'search_tracks': {
        const query = String(args.query ?? '').trim().slice(0, 200);
        if (!query) return 'No search was given: say what to search for.';
        const tracks = await search(query);
        return tracks ? crateText(query, tracks, (t) => playedTonight(deckRef.current, t)) : said.noSearch();
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
        // The listener's own request: the best match, even one that played tonight (they asked for it again).
        return put(tracks[0], args.when ?? 'now', true);
      }
      case 'line_up': {
        const wanted = (Array.isArray(args.records) ? args.records : []).map((r) => String(r ?? '').trim().slice(0, 200)).filter(Boolean).slice(0, 10);
        if (!wanted.length) return 'No records were given: pass up to ten searches.';
        const found = await Promise.all(wanted.map((q) => fetch(`${API}/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })
          .then((r) => (r.ok ? r.json() : { tracks: [] })).then((j: { tracks?: Track[] }) => j.tracks ?? []).catch(() => [] as Track[])));
        let deckNow = deckRef.current;
        const added: Track[] = [];
        const missed: string[] = [];
        found.forEach((tracks, i) => {
          const pickOne = tracks.find((t) => !lined(deckNow, t) && !playedTonight(deckNow, t));
          if (!pickOne) return void missed.push(wanted[i]);
          deckNow = queueNext(deckNow, pickOne);
          added.push(pickOne);
        });
        update(deckNow);
        return said.linedUp(added, missed, deckNow.queue.length);
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
  // Two engines with one shape: the full-stack session (the default), whose face is always rendered,
  // or Nova over the speech API with her face rendered on demand (?engine=speech).
  const engine = useMemo(() => (new URLSearchParams(location.search).get('engine') === 'speech' ? 'speech' : 'session'), []);
  const avatarHandlers = { onToolCall, onUserSaid: () => { lastListenerAt.current = Date.now(); } };
  const fullStack = useAvatar('dj-booth', avatarHandlers);
  const speechCall = useSpeechCall('dj-booth', avatarHandlers);
  const avatar: Avatar = engine === 'speech' ? speechCall : fullStack;
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  // After a break, the next record waits until Nova has been quiet a moment (or too long has passed).
  useEffect(() => {
    if (!holding) return;
    // The deadline counts from the moment the record was held, whatever Nova does meanwhile:
    // past it, the record starts under her (ducked) and she talks over its intro.
    const left = Math.max(0, HOLD_MAX_MS[holdKind.current] - (Date.now() - heldAt.current));
    if (avatar.speaking) {
      spokeSinceHold.current = true;
      const id = setTimeout(() => spin(holding), left);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => spin(holding), Math.min(left, spokeSinceHold.current ? QUIET_MS : INTRO_WAIT_MS[holdKind.current]));
    return () => clearTimeout(id);
  }, [holding, avatar.speaking]);

  // Seeking: the position under the listener's finger while they drag, applied when they let go.
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubRef = useRef<number | null>(null);
  scrubRef.current = scrub;
  const commitSeek = useCallback(() => {
    const to = scrubRef.current;
    if (to === null) return;
    setScrub(null);
    void player.seek(to);
    // Jumping back into a record that has had its break lets it have another before it ends.
    if (deckRef.current.playing) clock.current = freshClock(deckRef.current.playing.id);
    setOnBreak(false);
  }, [player]);

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
  // When Nova's last answer to the listener ended (its follow-up may come right after), and whether she is answering now.
  const answerEndedAt = useRef(0);
  const isAnswer = useRef(false);
  useEffect(() => {
    const now = Date.now();
    const starting = avatar.speaking && !wasSpeaking.current;
    const ending = !avatar.speaking && wasSpeaking.current;
    wasSpeaking.current = avatar.speaking;
    if (ending && isAnswer.current) answerEndedAt.current = now;
    if (avatar.speaking && !starting) return;
    const since = { sinceListenerMs: now - lastListenerAt.current, sinceAnswerMs: now - answerEndedAt.current };
    const verdict = !heard({ musicOn, onBreak, positionMs: progress?.position ?? 0, ...since });
    setMuffled(verdict);
    if (starting) {
      isAnswer.current = answering(since.sinceListenerMs, since.sinceAnswerMs);
      if (verdict) console.info('[crate] an unprompted line over the record plays silent');
    }
  }, [avatar.speaking, musicOn, onBreak, (progress?.position ?? 0) < INTRO_TALK_MS]);
  const voiced = avatar.speaking && !muffled;

  // The face on demand (speech engine): up for her breaks, a held record, the opening and the listener
  // talking to her; down after a while of music with nobody talking. One that cannot run here (no
  // LiveKit for the site) is not asked for again; the stage then shows her portrait while she talks.
  const face = speechCall.face;
  const faceDisabled = useRef(false);
  // The listener starting to talk (the talk button down, or their first words heard) warms the face up,
  // so it is there by the time Nova answers.
  const [faceWantedUntil, setFaceWantedUntil] = useState(0);
  const warmFace = useCallback(() => setFaceWantedUntil(Date.now() + FACE_LISTENER_MS), []);
  useEffect(() => { if (avatar.heard) warmFace(); }, [Boolean(avatar.heard)]);
  const needFace = engine === 'speech' && live
    && (onBreak || Boolean(holding) || !opened.current || Date.now() < faceWantedUntil || Date.now() - lastListenerAt.current < FACE_LISTENER_MS || avatar.speaking);
  // Re-checked when the warm-up window runs out.
  useEffect(() => {
    if (faceWantedUntil <= Date.now()) return;
    const id = setTimeout(() => setFaceWantedUntil((t) => t), faceWantedUntil - Date.now() + 50);
    return () => clearTimeout(id);
  }, [faceWantedUntil]);
  useEffect(() => {
    if (face.phase === 'failed' && !faceDisabled.current) {
      faceDisabled.current = true;
      console.warn('[crate] the face could not start; Nova goes on by voice');
    }
  }, [face.phase]);
  useEffect(() => {
    if (!needFace || faceDisabled.current) return;
    if (face.phase === 'idle' || face.phase === 'ended') void face.start();
  }, [needFace, face.phase]);
  useEffect(() => {
    if (engine !== 'speech' || needFace || face.phase !== 'live') return;
    const id = setTimeout(() => void face.end(), FACE_IDLE_MS);
    return () => clearTimeout(id);
  }, [needFace, face.phase]);
  useEffect(() => { if (!live && face.phase === 'live') void face.end(); }, [live]);
  useEffect(() => { if (engine === 'speech') console.info('[crate] face %s', face.phase); }, [face.phase]);
  useEffect(() => { if (engine === 'speech') console.info('[crate] face %s', face.speaking ? 'plays her words' : 'idle'); }, [face.speaking]);

  /**
   * A record from the crate, chosen by the listener: the same rules as their request (a record in
   * line plays from the line, the one on now is left alone, a vibe change clears Nova's picks).
   */
  function playFromCrate(track: Track) {
    const d = deckRef.current;
    if (d.playing?.id === track.id) return;
    if (d.queue.some((t) => t.id === track.id)) return playFromQueue(track);
    lastListenerAt.current = Date.now();
    put(track, 'now', true);
    // Refused (another release of a song on or in line): nothing changed, so Nova is not cut in.
    if (deckRef.current.playing?.id === track.id) cutIn(`put on ${label(track)}`, track);
  }

  /** A record from the line, chosen by the listener: it leaves the line and comes on now, introduced by Nova. */
  function playFromQueue(track: Track) {
    lastListenerAt.current = Date.now();
    const d = deckRef.current;
    const from = { ...d, queue: d.queue.filter((t) => t.id !== track.id) };
    changeOver(track, from);
    cutIn(`put on ${label(track)} from the line`, track);
  }

  /** The listener changed the record by hand: Nova stops mid-sentence (silent at once) and talks about the new one. */
  function cutIn(what: string, track: Track) {
    if (!live) return;
    if (avatar.speaking) setMuffled(true);
    avatar.interrupt(said.cutIn(what, track));
  }
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

  // Every show starts from an empty booth: the previous show's deck, opening, timers and asks go
  // ("Call Nova back" starts a new session on the same page).
  useEffect(() => {
    if (avatar.phase !== 'starting') return;
    void player.pause();
    update(emptyDeck);
    opened.current = false;
    clock.current = freshClock();
    setHolding(null);
    setOnBreak(false);
    setProgress(null);
    lastListenerAt.current = 0;
    askUsedAt.current = 0;
    askedFor.current.clear();
    toppedUp.current = null;
    avatar.event(said.start(), 60);
  }, [avatar.phase]);
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
  // On the speech engine the face shows only when it is really the one saying her words (or up and
  // idle while she is quiet); her voice in the page alone shows as a voice, never as a frozen face.
  const [talking, setTalking] = useState(false);
  useEffect(() => {
    if (voiced) return void setTalking(true);
    const id = setTimeout(() => setTalking(false), FACE_LINGER_MS);
    return () => clearTimeout(id);
  }, [voiced]);
  const faceShown = engine === 'session'
    || (speechCall.face.phase === 'live' && !speechCall.faceOff && speechCall.voiceVia !== 'page');
  const stage: 'face' | 'overlay' | 'record' | 'voice' = musicOn
    ? (talking && faceShown ? 'overlay' : 'record')
    : faceShown ? 'face' : deck.playing?.cover ? 'record' : 'voice';

  if (avatar.phase === 'idle') {
    return <Lobby spotify={spotify} onStart={(mic) => {
      player.prepare();
      setPushToTalk(mic);
      // Push to talk: the microphone joins muted and opens only while the button is held.
      void avatar.start({ mic, micMuted: mic });
    }} />;
  }

  const duration = progress?.duration || deck.playing?.durationMs || 0;
  const seekable = live && Boolean(deck.playing) && !holding && duration > 0;

  const pct = progress && progress.duration > 0 ? Math.min(100, (progress.position / progress.duration) * 100) : 0;
  const kicker = holding ? 'Up after Nova' : deck.playing ? (deck.paused ? 'Paused' : onBreak ? 'Nova on the mic' : 'Now playing') : 'The decks are quiet';

  return (
    <div className={`cr-app is-booth ${live ? 'is-live' : ''}`} style={themeStyle(theme)} data-backdrop={theme.backdrop}>
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
              {spotify.clientId && !useSdk && (
                <button type="button" className="cr-mixer-spotify" onClick={() => { if (confirm('Connecting Spotify Premium ends this show; start a new one after. Connect now?')) { void avatar.end().finally(() => void connect(spotify.clientId!)); } }}>
                  <SpotifyIcon /> Connect Spotify Premium
                </button>
              )}
            </div>
          )}
        </div>
        {/* In place from the first frame, so nothing shifts when the call goes live; they fade in then. */}
        <span className="cr-onair cr-when-live">On air</span>
        <button type="button" className="cr-end" onClick={() => void avatar.end()} title="End the show" disabled={avatar.phase === 'ended' || avatar.phase === 'failed'}><HangUpIcon /></button>
      </header>

      <main className={`cr-main ${tab === null ? 'is-solo' : ''}`}>
        <section className="cr-center" aria-label="The booth">
          <div className={`cr-stage is-${stage}`}>
            {/* Mounted all along: the call's video plays into it, shown or not. */}
            <HostVideo avatar={avatar} captions={cc.on && !muffled} onToggleCaptions={cc.toggle} name={HOST} poster={nova} className="cr-host-video">
              <TuningIn avatar={avatar} />
              {/* After a call ends or fails: the kit's card, with its way back in. */}
              {(avatar.phase === 'ended' || avatar.phase === 'failed') && (
                <CallStatus avatar={avatar} name={HOST} again="Call Nova back" onAgain={() => void avatar.start({ mic: pushToTalk, micMuted: pushToTalk })} />
              )}
            </HostVideo>
            {deck.playing?.cover && (
              <div className="cr-record" aria-hidden={stage === 'face'}>
                <img key={deck.playing.cover} src={deck.playing.cover} alt={`${deck.playing.title} cover`} />
              </div>
            )}
            {/* Her voice without her face: the face is not up, or not the one speaking. */}
            <div className={`cr-voice ${avatar.speaking ? 'is-speaking' : ''}`} aria-hidden={stage !== 'voice'}>
              <span /><span /><span />
              <b>{HOST}</b>
            </div>
            <span className="cr-stage-tag">{stage === 'record' ? `${HOST} on the decks` : `${HOST} on the mic`}</span>
          </div>

          <div className="cr-meta">
            <p className="cr-kicker">{kicker}</p>
            {/* Keyed by the record, so a new one fades in rather than swapping in place. */}
            <h1 className="cr-title" key={`t-${deck.playing?.id ?? 'none'}`}><span>{deck.playing ? deck.playing.title : 'Ask Nova for a record'}</span></h1>
            <p className="cr-artist" key={`a-${deck.playing?.id ?? 'none'}`}>{deck.playing ? `${deck.playing.artist}${deck.playing.year ? ` · ${deck.playing.year}` : ''}` : '\u00a0'}</p>
            <div className="cr-time">
              <span>{scrub !== null ? mmss(scrub) : progress && !holding ? mmss(progress.position) : '0:00'}</span>
              {/* Drag or click to jump in the record; the jump happens on release. */}
              <input
                type="range" className="cr-seek" aria-label="Position in the record" min={0} max={duration || 1} step={1000}
                value={scrub ?? (holding ? 0 : progress?.position ?? 0)} disabled={!seekable}
                style={{ '--pct': `${scrub !== null && duration ? (scrub / duration) * 100 : holding ? 0 : pct}%` } as React.CSSProperties}
                onChange={(e) => setScrub(Number(e.target.value))}
                onPointerUp={() => commitSeek()} onKeyUp={() => commitSeek()} onBlur={() => commitSeek()}
              />
              <span>{progress && progress.duration > 0 ? mmss(progress.duration) : deck.playing?.durationMs ? mmss(deck.playing.durationMs) : '–:––'}</span>
            </div>
          </div>

          <div className="cr-dock">
            <button type="button" className="cr-icon" disabled={!deck.playing} title={deck.paused ? 'Resume' : 'Pause'}
              onClick={() => press(deck.paused ? 'resumed the music' : 'paused the music', () => {
                void (deck.paused ? player.resume() : player.pause());
                update(setPaused(deckRef.current, !deck.paused));
              })}>{deck.paused ? <PlayIcon /> : <PauseIcon />}</button>
            {pushToTalk ? <PushToTalk avatar={avatar} onPress={warmFace} /> : <p className="cr-typing">Type your requests in the chat</p>}
            <button type="button" className="cr-icon" disabled={!deck.playing} title="Skip" onClick={() => {
              const next = advance(deckRef.current);
              const skippedWhat = `skipped ${deckRef.current.playing ? label(deckRef.current.playing) : 'the record'}`;
              lastListenerAt.current = Date.now();
              if (next.playing) {
                changeOver(next.playing, next);
                cutIn(skippedWhat, next.playing);
              } else press(skippedWhat, () => { update(next); void player.pause(); });
            }}><SkipIcon /></button>
          </div>

          {deck.queue.length > 0 && (
            <section className="cr-upnext" aria-label="Up next">
              <h2>Up next</h2>
              <ol>
                {deck.queue.map((t, i) => (
                  <li key={`${t.id}-${i}`}>
                    <button type="button" onClick={() => playFromQueue(t)} aria-label={`Play ${t.title} by ${t.artist} now`}>
                      {t.art ? <img src={t.art} alt="" /> : <span className="cr-blank" />}
                      <span><b>{t.title}</b><small>{t.artist}</small></span>
                    </button>
                  </li>
                ))}
              </ol>
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
              <ol className="cr-rows">{deck.queue.map((t, i) => <TrackRow key={`${t.id}-${i}`} track={t} onPlay={() => playFromQueue(t)} />)}</ol>
            ) : <p className="cr-empty">Nova lines records up here as the set builds.</p>}
          </div>
          <div className="cr-panel" hidden={tab !== 'crate'}>
            {deck.dug && <p className="cr-dug">Dug for <b>{deck.dug}</b></p>}
            {deck.crate.length ? (
              <ol className="cr-rows">
                {deck.crate.map((t, i) => (
                  <TrackRow key={t.id} track={t} number={i + 1} onPlay={() => playFromCrate(t)} />
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
