// Yonder: dream up a trip on a live map with Lumi. Lumi calls the board's
// tools (a destination, the food, the news, the sights around a place) and
// speaks from what they return; the page answers those calls through the
// server, draws the board, keeps Lumi's picture of it current, and tells Lumi
// about the user's own presses.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CallControls, CallStatus, ChatPanel, HostVideo, clock, useAvatar, useToolNet, type Avatar, type ToolCall } from '../../../src/kit/index.ts';
import { boardState, pressed, say, tools } from '../engine/director.ts';
import { mustDo, netContext } from '../engine/judge.ts';
import { isNewer, parseSnapshot } from '../engine/messages.ts';
import type { Action, MapConfig, Outcome, Snapshot } from '../engine/types.ts';
import { Guidebook } from './Guidebook.tsx';
import { Lobby, Logo } from './Lobby.tsx';
import { emptyNotes, notesFrom, tripSize, tripText } from './notes.ts';
import { describeBounds } from './outline.ts';
import { TripSummary } from './Summary.tsx';
import { TravelMap, type MapMode } from './TravelMap.tsx';
import './yonder.css';

const API = '/api/apps/travel-guide';
const HOST = 'Lumi';
const POLL_MS = 1200;

/** How long a tool may take before the host is told "still looking": a few seconds inside its own timeout. */
const DEADLINE_MS: Record<string, number> = Object.fromEntries(
  tools(true).flatMap((t) => (t['x-atmee']?.mode === 'await' ? [[t.name, ((t['x-atmee'].timeoutSeconds ?? 8) - 4) * 1000]] : [])),
);
const LATE: unique symbol = Symbol('late');

class HttpError extends Error {
  constructor(public status: number, path: string) { super(`${path}: ${status}`); }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new HttpError(res.status, path);
  return res.json();
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const placeOf = (args: Record<string, unknown>) => (typeof args.place === 'string' ? args.place.trim().slice(0, 60) : '');

/** What Lumi is doing while a tool runs, after "Lumi is". */
function doing(name: string, args: Record<string, unknown>): string | null {
  const place = placeOf(args);
  switch (name) {
    case 'choose_destination': return place ? `finding ${place}` : 'finding your destination';
    case 'show_food': return 'finding dishes';
    case 'show_news': return 'pulling the headlines';
    case 'explore_near': return place ? `looking around ${place}` : 'looking around';
    case 'next_sight': return 'finding the next sight';
    case 'previous_sight': return 'going back a sight';
    default: return null;
  }
}

export function App() {
  const [entered, setEntered] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [config, setConfig] = useState<MapConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [showTrip, setShowTrip] = useState(false);
  const [notes, setNotes] = useState(emptyNotes);
  const tripId = useRef<Promise<string> | null>(null);
  const held = useRef<Snapshot | null>(null);
  const lastState = useRef('');
  const isLive = useRef(false);
  const opened = useRef(false);
  const avatarRef = useRef<Avatar | null>(null);

  /** Draw a snapshot from the server, unless a newer one is already on screen. */
  const accept = useCallback((raw: unknown) => {
    const next = parseSnapshot(raw);
    if (!next || !isNewer(held.current, next)) return;
    held.current = next;
    setSnapshot(next);
  }, []);

  /** Lumi's opening, once per call, from the board as Lumi finds it. */
  const open = useCallback(() => {
    if (opened.current || !isLive.current || !held.current) return;
    opened.current = true;
    avatarRef.current?.event(say.opening(held.current), 60);
  }, []);

  /** A fresh trip: the whole world, nothing on the route. */
  const newTrip = useCallback(() => {
    held.current = null;
    setSnapshot(null);
    setNotes(emptyNotes());
    const created = request<{ id: string; snapshot: unknown; map: MapConfig }>('/trips', {}).then(({ id, snapshot: first, map }) => {
      setConfig(map);
      accept(first);
      open();
      return id;
    });
    created.catch(() => setNotice('We could not open the map. Check your connection and reload the page.'));
    tripId.current = created;
    return created;
  }, [accept, open]);

  const trip = useCallback(() => tripId.current ?? newTrip(), [newTrip]);

  /** The server forgot the trip (it restarted, or the trip expired): start a fresh one. */
  const lost = useCallback((err: unknown) => {
    if (!(err instanceof HttpError && err.status === 404)) return false;
    void newTrip();
    setNotice('Your trip had expired, so a fresh map is open.');
    return true;
  }, [newTrip]);

  // Lumi's tool calls: the server acts, the board follows, the result is what Lumi says.
  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall): Promise<string> => {
    const label = doing(name, args);
    if (label) setWorking(label);
    let late = false;
    try {
      const id = await trip();
      const call = request<Outcome>(`/trips/${id}/tool`, { name, arguments: args }).then((o) => { accept(o.snapshot); return o.result; });
      const deadline = DEADLINE_MS[name];
      const first = deadline ? await Promise.race([call, sleep(deadline).then((): typeof LATE => LATE)]) : await call;
      if (first !== LATE) return first;
      // Slow lookups (Overpass can take half a minute) land later, as an event.
      late = true;
      void call.then((result) => avatarRef.current?.event(say.landed(result), 45), () => avatarRef.current?.event(say.lateFailed(), 30))
        .finally(() => setWorking(null));
      return say.stillWorking(label ?? 'it');
    } catch (err) {
      if (!lost(err)) setNotice('The map service did not answer. Try again in a moment.');
      return say.serviceDown();
    } finally {
      if (!late) setWorking(null);
    }
  }, [trip, accept, lost]);

  // If Lumi narrates "here's Portugal" without calling the tool, the app does it and tells Lumi.
  const net = useToolNet({
    match: (text) => {
      const call = held.current ? mustDo(text, netContext(held.current)) : null;
      return call ? { id: `net-${Date.now()}`, name: call.name, arguments: call.arguments } : null;
    },
    run: (call) => onToolCall(call),
    avatar: () => avatarRef.current!,
  });
  const avatar = useAvatar('travel-guide', {
    onToolCall: net.watch(onToolCall),
    onUserSaid: (text) => net.heard(text),
    onLive: () => { isLive.current = true; open(); },
    onEnded: () => { isLive.current = false; },
  });
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  // A button acts at once; Lumi cannot see the screen, so Lumi is told.
  async function press(action: Action, label: string) {
    setBusy(true);
    setNotice('');
    try {
      const id = await trip();
      const { snapshot: next, result } = await request<Outcome>(`/trips/${id}/act`, { action });
      accept(next);
      if (label && result && isLive.current) avatar.event(pressed(label, result), 30);
    } catch (err) {
      if (!lost(err)) setNotice('That did not go through. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setShowTrip(false);
    void newTrip().then(() => { if (isLive.current) avatar.event(pressed('Start a new trip', say.freshTrip()), 30); }, () => undefined);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([tripText(held.current, notes, HOST, new Date())], { type: 'text/plain;charset=utf-8' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'yonder-trip.txt' });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function enter(mic: boolean) {
    setEntered(true);
    if (!tripId.current) void newTrip().catch(() => undefined);
    void avatar.start({ mic });
  }

  // A new call opens again; an ended one shows the trip it made.
  useEffect(() => {
    if (avatar.phase === 'starting') {
      opened.current = false;
      isLive.current = false;
      setShowTrip(false);
    }
    if (avatar.phase === 'ended') setShowTrip(true);
  }, [avatar.phase]);

  // Lumi's picture of the board follows the board (sent only when it changes); the trip notes gather what it showed.
  useEffect(() => {
    if (!snapshot) return;
    const text = boardState(snapshot);
    if (text !== lastState.current) {
      lastState.current = text;
      avatar.state(text);
    }
    setNotes((n) => notesFrom(n, snapshot));
  }, [snapshot]);

  // Dishes, photos and headlines land in the background: look again until they have.
  useEffect(() => {
    if (!snapshot?.pending) return;
    const id = setTimeout(() => { void trip().then((tid) => request<unknown>(`/trips/${tid}`)).then(accept).catch(() => undefined); }, POLL_MS);
    return () => clearTimeout(id);
  }, [snapshot]);

  if (!entered) return <Lobby host={HOST} onStart={enter} />;

  const s = snapshot;
  const mode: MapMode = s?.stage === 'around' && s.spot ? 'around' : s?.map ? 'country' : 'world';
  const size = tripSize(s, notes);
  return (
    <div className="yd-app">
      <header className="yd-top">
        <Logo />
        {live && <p className="yd-callline"><span className="yd-livedot" aria-hidden="true" />On the line{avatar.secondsLeft !== null && <span> · {clock(avatar.secondsLeft)} left</span>}</p>}
        <button type="button" className="yd-tripbtn" aria-pressed={showTrip} onClick={() => setShowTrip((v) => !v)}>
          Your trip{size > 0 && <span className="yd-badge" aria-label={`${size} saved`}>{size}</span>}
        </button>
        <CallControls avatar={avatar} className="yd-controls" />
      </header>

      <main className="yd-main">
        <section className="yd-stage" aria-label="The map">
          {config ? (
            <TravelMap
              config={config} mode={mode} map={s?.map ?? null} spots={s?.spot ?? null}
              onPick={(what, lat, lon) => void press(what === 'destination' ? { kind: 'destinationAt', lat, lon } : { kind: 'coords', lat, lon }, what === 'destination' ? 'Plan a trip here, on the map' : 'What is around here, on the map')}
              onSpot={(index) => void press({ kind: 'goto', index }, 'a pin on the map')}
            />
          ) : (
            <div className="yd-map is-loading" role="status"><span>Unfolding the map…</span></div>
          )}
          <Plate s={s} mode={mode} />
          <div className="yd-flags" aria-live="polite">
            {working && <p className="yd-working"><span className="yd-pulse" aria-hidden="true" />{HOST} is {working}…</p>}
            {notice && (
              <p className="yd-notice">{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss">×</button></p>
            )}
          </div>
          <figure className={`yd-host ${live ? 'is-live' : 'is-waiting'}`} aria-label={`${HOST}, your guide`}>
            <HostVideo avatar={avatar} name={HOST} className="yd-host-video">
              <CallStatus avatar={avatar} name={HOST} again={`Call ${HOST} again`} />
            </HostVideo>
            <figcaption className="yd-nameplate"><b>{HOST}</b><span>your guide</span>{live && <span className="yd-onair">Live</span>}</figcaption>
          </figure>
        </section>

        <aside className="yd-sheet" aria-label="Guidebook">
          <div className="yd-sheet-body">
            {showTrip ? (
              <TripSummary snapshot={s} notes={notes} host={HOST} ended={avatar.phase === 'ended'} onBack={() => setShowTrip(false)} onDownload={download} onNewTrip={startOver} />
            ) : s ? (
              <Guidebook snapshot={s} busy={busy} host={HOST} onAction={(action, label) => void press(action, label)} />
            ) : (
              <p className="yd-quiet yd-loading">Unfolding the map…</p>
            )}
          </div>
          <ChatPanel
            avatar={avatar} name={HOST} className="yd-chat" placeholder={`Ask ${HOST}, or name a place…`}
            empty={<>Say hello out loud, or type here. Try “Let’s go to Portugal” or “What’s worth seeing around Shibuya station?”</>}
          />
        </aside>
      </main>
    </div>
  );
}

/** The place card on the map: the country, the place being wandered, or the world. */
function Plate({ s, mode }: { s: Snapshot | null; mode: MapMode }) {
  if (!s) return null;
  if (mode === 'around' && s.spot) {
    const v = s.spot;
    return (
      <div className="yd-plate">
        <p className="yd-plate-kicker">Wandering around</p>
        <h2>{v.place}</h2>
        <p className="yd-plate-sub">{v.spot ? `Sight ${v.index + 1} of ${v.total} · ${v.spot.name}` : v.lookupFailed ? 'The places service is not answering' : 'Nothing stands out here'}</p>
      </div>
    );
  }
  if (mode === 'country' && s.map) {
    return (
      <div className="yd-plate">
        <p className="yd-plate-kicker">{s.map.city || 'Destination'}</p>
        <h2>{s.map.country}</h2>
        <p className="yd-plate-sub">{describeBounds(s.map.center, s.map.bbox)}</p>
      </div>
    );
  }
  return (
    <div className="yd-plate is-world">
      <p className="yd-plate-kicker">{s.continent ? `Drawn to ${s.continent}` : 'Anywhere'}</p>
      <h2>The world</h2>
      <p className="yd-plate-sub">Tap the map to plan a trip there</p>
    </div>
  );
}
