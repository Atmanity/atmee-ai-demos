// Travel Guide: the avatar is a well-travelled friend; the server owns the
// trip and every lookup. The page draws the board, keeps the avatar's state in
// step with it, and tells the avatar what happened as events.
//
// The board works before the avatar arrives (it is a real map): what the user
// did meanwhile is in the state the avatar arrives to, and its opening event
// is written from that state, so nothing from before is lost or repeated.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AvatarStage, Composer, Transcript, useAvatar } from '../../../src/kit/index.ts';
import { boardState, NOTES, say } from '../engine/director.ts';
import { isNewer, parseSnapshot } from '../engine/messages.ts';
import type { Action, MapConfig, Outcome, Snapshot, Source } from '../engine/types.ts';
import { Board } from './Board.tsx';
import './board.css';

const API = '/api/apps/travel-guide';
const POLL_MS = 1200;
const CREATING = 'creating';

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [config, setConfig] = useState<MapConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const trip = useRef<string | null>(null);
  const held = useRef<Snapshot | null>(null);
  const live = useRef(false);
  const lastAvatarLine = useRef('');
  const lastState = useRef('');

  /** Draw a snapshot from the server, unless a newer one is already on screen. */
  const accept = useCallback((raw: unknown) => {
    const next = parseSnapshot(raw);
    if (!next || !isNewer(held.current, next)) return;
    held.current = next;
    setSnapshot(next);
  }, []);

  const avatar = useAvatar('travel-guide', {
    // The avatar hears the user too and answers at once; the board follows, and
    // an event tells it whatever it could not have known (see director.eventFor).
    onUserSaid: (text, how) => { if (how === 'spoken') void act({ text, from: 'spoken' }); },
    onAvatarSaid: (text) => {
      lastAvatarLine.current = text;
      // "You choose": its pick is read from its own words.
      if (held.current?.awaitingPick) void act({ text, from: 'avatar' });
    },
    onLive: () => {
      live.current = true;
      if (held.current) avatar.event(say.opening(held.current), 60);
    },
    onEnded: () => { live.current = false; },
  });

  async function act(input: { action?: Action; text?: string; from?: Source }): Promise<Outcome | null> {
    if (!trip.current || trip.current === CREATING) return null;
    const isButton = Boolean(input.action);
    if (isButton) setBusy(true);
    try {
      const outcome = await call<Outcome>(`/trips/${trip.current}/act`, { ...input, lastAvatarLine: lastAvatarLine.current });
      accept(outcome.snapshot);
      // Before the avatar is live there is no one to tell: its opening covers the board as it finds it.
      if (outcome.event && live.current) avatar.event(outcome.event, outcome.ttl);
      return outcome;
    } catch (err) {
      console.warn(err);
      return null;
    } finally {
      if (isButton) setBusy(false);
    }
  }

  // The trip starts with the page: the map is usable while the avatar is on its way.
  useEffect(() => {
    if (trip.current) return;
    trip.current = CREATING;
    void call<{ id: string; snapshot: unknown; map: MapConfig }>('/trips', {}).then(({ id, snapshot: first, map }) => {
      trip.current = id;
      setConfig(map);
      accept(first);
    }).catch((err) => { trip.current = null; console.warn(err); });
  }, []);

  // The standing notes go with each session.
  useEffect(() => {
    if (avatar.phase === 'starting') for (const note of NOTES) avatar.note(note);
  }, [avatar.phase]);

  // The avatar's picture of the board follows the board (sent only when it changes).
  useEffect(() => {
    if (!snapshot) return;
    const text = boardState(snapshot);
    if (text !== lastState.current) {
      lastState.current = text;
      avatar.state(text);
    }
  }, [snapshot]);

  // Headlines, dishes and photos land in the background: look again until they have.
  useEffect(() => {
    if (!snapshot?.pending || !trip.current || trip.current === CREATING) return;
    const id = setTimeout(() => { void call<unknown>(`/trips/${trip.current}`).then(accept).catch(() => undefined); }, POLL_MS);
    return () => clearTimeout(id);
  }, [snapshot]);

  // A typed line is judged first; only what isn't a board action goes to the avatar.
  const onTyped = (text: string) => {
    void act({ text, from: 'typed' }).then((outcome) => {
      if (outcome?.handled) avatar.record(text);
      else avatar.say(text);
    });
  };

  return (
    <div className="kit-layout">
      <div className="kit-side">
        <AvatarStage
          avatar={avatar} name="Your guide" startLabel="Meet your guide"
          lobby={<><div className="kit-title">Travel Guide</div><div className="kit-detail">Plan a trip on the map, or say where you are and find something worth seeing nearby. The map works before your guide arrives.</div></>}
        />
        <Composer avatar={avatar} placeholder="“Let’s go to Portugal”, “I’m near Shibuya station”…" onSubmit={(t) => { onTyped(t); }} />
        <Transcript avatar={avatar} names={{ avatar: 'Guide' }} />
      </div>
      <Board snapshot={snapshot} config={config} busy={busy} onAction={(action) => void act({ action })} />
    </div>
  );
}
