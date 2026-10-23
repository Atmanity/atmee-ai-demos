// Yonder: dream up a trip on a live map with Lumi. Lumi calls the board's
// tools (a destination, the food, the news, the sights around a place) and
// speaks from what they return; the page answers those calls through the
// server, draws the board, keeps Lumi's picture of it current, and tells Lumi
// about the user's own presses.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CallControls, CallStatus, ChatPanel, HostVideo, clock, useAvatar, useToolNet, BackToApps, useCaptionToggle, type Avatar, type ToolCall } from '../../../src/kit/index.ts';
import { boardState, pressed, say, tools } from '../engine/director.ts';
import { mustDo, netContext, stillNeeded, type NetTool } from '../engine/judge.ts';
import { isNewer, parseSnapshot } from '../engine/messages.ts';
import type { Action, MapConfig, Outcome, Snapshot } from '../engine/types.ts';
import { Guidebook } from './Guidebook.tsx';
import portrait from '../host/portrait.jpg';
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
  // Nothing started for one call or one trip may act on another. A call's work
  // (a tool's late answer, a press, its "still looking" timer) belongs to the
  // call it started in: callGen moves on when a call starts and when it ends.
  // A trip's answers (its creation, polls, tool and button results) belong to
  // their trip: tripGen moves on with every new trip.
  const callGen = useRef(0);
  const tripGen = useRef(0);
  const callTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const clearCallTimers = useCallback(() => {
    for (const timer of callTimers.current) clearTimeout(timer);
    callTimers.current.clear();
  }, []);

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

  /** A fresh trip: the whole world, nothing on the route. Only the newest one lands, whichever answers last. */
  const newTrip = useCallback(() => {
    const mine = ++tripGen.current;
    held.current = null;
    setSnapshot(null);
    setNotes(emptyNotes());
    const created = request<{ id: string; snapshot: unknown; map: MapConfig }>('/trips', {}).then(({ id, snapshot: first, map }) => {
      if (mine === tripGen.current) {
        setConfig(map);
        accept(first);
        open();
      }
      return id;
    });
    created.catch(() => { if (mine === tripGen.current) setNotice('We could not open the map. Check your connection and reload the page.'); });
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
    const mine = callGen.current;
    const current = () => mine === callGen.current;
    const label = doing(name, args);
    if (label) setWorking(label);
    let late = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const pending = trip();
      const forTrip = tripGen.current;
      const id = await pending;
      const call = request<Outcome>(`/trips/${id}/tool`, { name, arguments: args }).then((o) => {
        if (forTrip === tripGen.current) accept(o.snapshot);
        return o.result;
      });
      const deadline = DEADLINE_MS[name];
      const giveUp = new Promise<typeof LATE>((resolve) => {
        if (!deadline) return;
        timer = setTimeout(() => resolve(LATE), deadline);
        callTimers.current.add(timer);
      });
      const first = await Promise.race([call, giveUp]);
      if (first !== LATE) return first;
      // A slow lookup lands later, as an event: only to this call, and only while it is on.
      late = true;
      const tell = (text: string) => { if (current() && isLive.current) avatarRef.current?.event(text, 45); };
      void call.then((result) => tell(say.landed(result)), () => tell(say.lateFailed()))
        .finally(() => { if (current()) setWorking(null); });
      return say.stillWorking(label ?? 'it');
    } catch (err) {
      if (!lost(err) && current()) setNotice('The map service did not answer. Try again in a moment.');
      return say.serviceDown();
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
        callTimers.current.delete(timer);
      }
      if (!late && current()) setWorking(null);
    }
  }, [trip, accept, lost]);

  // If Lumi narrates "here's Portugal" without calling the tool, the app does it and tells Lumi.
  const net = useToolNet({
    match: (text) => {
      const call = held.current ? mustDo(text, netContext(held.current)) : null;
      return call ? { id: `net-${Date.now()}`, name: call.name, arguments: call.arguments } : null;
    },
    // Done meanwhile (by Lumi her own way, or a button): stand down quietly.
    run: async (call) => (held.current && !stillNeeded({ name: call.name as NetTool, arguments: call.arguments }, netContext(held.current)) ? null : onToolCall(call)),
    avatar: () => avatarRef.current!,
  });
  // The host's words over the video: off by default, since the chat carries them.
  const cc = useCaptionToggle('travel-guide', false);
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
    const mine = callGen.current;
    setBusy(true);
    setNotice('');
    try {
      const pending = trip();
      const forTrip = tripGen.current;
      const id = await pending;
      const { snapshot: next, result } = await request<Outcome>(`/trips/${id}/act`, { action });
      // The press happened, so the board follows; but only the call it was made in hears about it.
      if (forTrip === tripGen.current) accept(next);
      if (label && result && mine === callGen.current && isLive.current) avatar.event(pressed(label, result), 30);
    } catch (err) {
      if (!lost(err)) setNotice('That did not go through. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    const mine = callGen.current;
    setShowTrip(false);
    const created = newTrip();
    const forTrip = tripGen.current;
    void created.then(() => {
      if (forTrip === tripGen.current && mine === callGen.current && isLive.current) avatar.event(pressed('Start a new trip', say.freshTrip()), 30);
    }, () => undefined);
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

  // A new call starts clean and opens again; an ended or failed one leaves nothing running, and an ended one shows the trip it made.
  useEffect(() => {
    if (avatar.phase === 'starting') {
      callGen.current += 1;
      opened.current = false;
      isLive.current = false;
      setShowTrip(false);
      setWorking(null);
      setNotice('');
    }
    if (avatar.phase === 'ended' || avatar.phase === 'failed') {
      callGen.current += 1;
      isLive.current = false;
      clearCallTimers();
      setWorking(null);
    }
    if (avatar.phase === 'ended') setShowTrip(true);
  }, [avatar.phase]);
  useEffect(() => clearCallTimers, [clearCallTimers]);

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
    const forTrip = tripGen.current;
    const id = setTimeout(() => {
      void trip().then((tid) => request<unknown>(`/trips/${tid}`)).then((raw) => { if (forTrip === tripGen.current) accept(raw); }).catch(() => undefined);
    }, POLL_MS);
    return () => clearTimeout(id);
  }, [snapshot]);

  if (!entered) return <Lobby host={HOST} onStart={enter} />;

  const s = snapshot;
  const mode: MapMode = s?.stage === 'around' && s.spot ? 'around' : s?.map ? 'country' : 'world';
  const size = tripSize(s, notes);
  return (
    <div className="yd-app">
      <header className="yd-top">
        <BackToApps avatar={avatar} name={HOST} /><Logo />
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
            <HostVideo avatar={avatar} captions={cc.on} onToggleCaptions={cc.toggle} name={HOST} poster={portrait} className="yd-host-video">
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
