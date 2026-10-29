// Crate: a live radio booth hosted by Nova. Nova digs through Spotify and
// works the decks through the booth's tools; the page answers those calls,
// drives the Spotify embed, keeps Nova's picture of the deck current and
// tells it when a record is about to run out, so it can talk over the outro.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackToApps, CallControls, CallStatus, ChatPanel, HostVideo, useAvatar, useCaptionToggle, type ToolCall } from '../../../src/kit/index.ts';
import { advance, dig, label, pick, playNow, queueNext, setPaused } from '../engine/deck.ts';
import { crateText, deckState, said } from '../engine/director.ts';
import { emptyDeck, type Deck, type Track } from '../engine/types.ts';
import { useSpotifyPlayer, type Playback } from './player.ts';
import nova from '../host/portrait.jpg';
import './crate.css';

const API = '/api/apps/dj-booth';
const HOST = 'Nova';
// How long before a record ends the booth cues Nova.
const CUE_MS = 8000;

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

function Lobby({ onStart }: { onStart: (mic: boolean) => void }) {
  return (
    <div className="cr-lobby">
      <header className="cr-top"><BackToApps /><Logo /></header>
      <main className="cr-hero">
        <img className="cr-hero-face" src={nova} alt="" />
        <h1>Your own radio show, hosted live.</h1>
        <p>Nova digs through Spotify and spins whatever you ask for, or picks for you, talking you in and out of every record.</p>
        <div className="cr-cta">
          <button type="button" className="cr-primary" onClick={() => onStart(true)}>Go on air with your voice</button>
          <button type="button" className="cr-secondary" onClick={() => onStart(false)}>Request by typing</button>
        </div>
        <p className="cr-small">Signed in to Spotify in this browser, you hear whole tracks; otherwise 30-second previews.</p>
      </main>
    </div>
  );
}

export function App() {
  const [deck, setDeck] = useState<Deck>(emptyDeck);
  const deckRef = useRef(deck);
  const update = useCallback((next: Deck) => { deckRef.current = next; setDeck(next); }, []);
  const [progress, setProgress] = useState<Playback | null>(null);

  // Which record the booth has already cued and seen out, so each is told once.
  const cued = useRef<string | null>(null);
  const ended = useRef<string | null>(null);
  const avatarRef = useRef<ReturnType<typeof useAvatar> | null>(null);

  const player = useSpotifyPlayer((p) => {
    setProgress(p);
    const on = deckRef.current.playing;
    if (!on || p.duration <= 0) return;
    const left = p.duration - p.position;
    if (!p.isPaused && left <= CUE_MS && cued.current !== on.id) {
      cued.current = on.id;
      avatarRef.current?.event(said.ending(on, deckRef.current.queue[0] ?? null), 15);
    }
    // The end: the embed stops at (or snaps back from) the last second.
    if (left <= 600 && ended.current !== on.id) {
      ended.current = on.id;
      const next = advance(deckRef.current);
      update(next);
      if (next.playing) spin(next.playing, next);
      else avatarRef.current?.event(said.ranOut(), 30);
    }
  });

  const spin = useCallback((track: Track, from: Deck = deckRef.current) => {
    cued.current = ended.current = null;
    update(playNow(from, track));
    setProgress(null);
    void player.load(track);
  }, [player.load]);

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
  }, [search, spin]);

  const cc = useCaptionToggle('dj-booth', false);
  const avatar = useAvatar('dj-booth', { onToolCall });
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  useEffect(() => { if (avatar.phase === 'starting') avatar.event(said.start(), 60); }, [avatar.phase]);
  // Nova's picture of the deck follows the deck.
  useEffect(() => { avatar.state(deckState(deck)); }, [deck]);
  // The music stops with the show.
  useEffect(() => { if (avatar.phase === 'ended' || avatar.phase === 'failed') void player.pause(); }, [avatar.phase]);

  // The listener's own hands on the decks: Nova cannot see the screen, so it is told.
  function press(what: string, act: () => void) {
    act();
    if (live) avatar.event(said.pressed(what), 20);
  }

  if (avatar.phase === 'idle') return <Lobby onStart={(mic) => void avatar.start({ mic })} />;

  const pct = progress && progress.duration > 0 ? Math.min(100, (progress.position / progress.duration) * 100) : 0;

  return (
    <div className="cr-app">
      <header className="cr-top">
        <BackToApps avatar={avatar} name={HOST} /><Logo />
        {live && <span className="cr-onair">On air</span>}
        <CallControls avatar={avatar} className="cr-controls" />
      </header>

      <main className="cr-main">
        <aside className="cr-host" aria-label={`${HOST}, your DJ`}>
          <HostVideo avatar={avatar} captions={cc.on} onToggleCaptions={cc.toggle} name={HOST} poster={nova} className="cr-host-video">
            <CallStatus avatar={avatar} name={HOST} again="Call Nova back" />
          </HostVideo>
          <p className="cr-nameplate"><b>{HOST}</b> on the decks</p>
        </aside>

        <section className="cr-decks" aria-label="The decks">
          <div className="cr-now">
            {deck.playing?.art ? <img src={deck.playing.art} alt="" /> : <div className="cr-blank" aria-hidden="true" />}
            <div>
              <p className="cr-kicker">{deck.playing ? (deck.paused ? 'Paused' : 'Now playing') : 'The decks are quiet'}</p>
              <p className="cr-title">{deck.playing ? deck.playing.title : 'Ask Nova for a record'}</p>
              {deck.playing && <p className="cr-artist">{deck.playing.artist}</p>}
              <div className="cr-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
            </div>
          </div>
          <div className="cr-buttons">
            <button type="button" disabled={!deck.playing} onClick={() => press(deck.paused ? 'resumed the music' : 'paused the music', () => {
              void (deck.paused ? player.resume() : player.pause());
              update(setPaused(deckRef.current, !deck.paused));
            })}>{deck.paused ? 'Resume' : 'Pause'}</button>
            <button type="button" disabled={!deck.playing} onClick={() => {
              const next = advance(deckRef.current);
              press(`skipped ${deckRef.current.playing ? label(deckRef.current.playing) : 'the record'}`, () => {
                if (next.playing) spin(next.playing, next); else { update(next); void player.pause(); }
              });
            }}>Skip</button>
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

        <ChatPanel avatar={avatar} name={HOST} className="cr-chat" placeholder="Request a song, an artist, a mood…" empty={<>Ask for anything: "play some 80s synth-pop".</>} />
      </main>
    </div>
  );
}
