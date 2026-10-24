// Planwright: a home planner you talk to. Iris, the architect, changes the plan
// by calling the planner's tools and speaks from what they return; the page
// answers those calls from the planner it runs, shows the plan, keeps Iris's
// picture of it current, tells her what the client does by hand, and hands her
// the floor plans and photos the client shares.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CallControls, CallStatus, ChatPanel, clock, FileDrop, HostVideo, PageDropGuard, useAvatar, useToolNet, BackToApps, useCaptionToggle, type ToolCall } from '../../../src/kit/index.ts';
import { MAX_SIDE_CM, MIN_SIDE_CM, snap as toGrid } from '../engine/home.ts';
import { contextOf, mustDo, roomSideCm } from '../engine/judge.ts';
import type { PlanSnapshot } from '../engine/types.ts';
import { areaLabel } from './geometry.ts';
import { Lobby, Logo } from './Lobby.tsx';
import portrait from '../host/portrait.jpg';
import { HomeSession, type ServerPort } from './session.ts';
import { Studio, type Photos, type Purpose } from './Studio.tsx';
import './planwright.css';

const API = '/api/apps/room-planner';
const HOST = 'Iris';

const postJson = (path: string, body: unknown) =>
  fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const server: ServerPort = {
  async photo(purpose, input, plan) {
    const res = await postJson('/photo', { purpose, plan, ...input });
    if (res.status === 503) return { error: "Reading photos isn't switched on here yet. Add pieces from the kit instead." };
    if (!res.ok) return { error: "That photo couldn't be read. Try another one, taken in good light." };
    return res.json();
  },
};

/** A photo as the server wants it: a JPEG at most 1600 px across, and a URL to show it. */
async function readImage(file: File): Promise<{ image: { mimeType: string; base64: string }; url: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return { image: { mimeType: 'image/jpeg', base64: url.slice(url.indexOf(',') + 1) }, url };
}

/**
 * The floor's starting size, from ?w=900&h=700 (centimetres, or metres: ?w=9).
 * 9 by 7 metres otherwise.
 */
function startingSize(): { w_cm: number; h_cm: number } {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const side = (key: string, fallback: number) => {
    const value = toGrid(roomSideCm(Number(params.get(key))));
    return value >= MIN_SIDE_CM && value <= MAX_SIDE_CM ? value : fallback;
  };
  return { w_cm: side('w', 900), h_cm: side('h', 700) };
}

export function App() {
  const [snap, setSnap] = useState<PlanSnapshot | null>(null);
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null);
  const [sheetSignal, setSheetSignal] = useState(0);
  const [reading, setReading] = useState<Purpose | 'sample' | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [lastPhoto, setLastPhoto] = useState<Photos['last']>(null);
  const avatarRef = useRef<ReturnType<typeof useAvatar> | null>(null);
  // Which call is on: bumped when a call starts and when it ends, so work that
  // answers late (a photo read) is not told to a call it was not asked in.
  const callRef = useRef(0);

  const session = useMemo(() => new HomeSession(
    {
      state: (text) => avatarRef.current?.state(text),
      event: (text, ttl) => avatarRef.current?.event(text, ttl),
      live: () => avatarRef.current?.phase === 'live',
      call: () => callRef.current,
    },
    server,
    ({ snapshot, refusal, drew }) => {
      setSnap(snapshot);
      if (refusal) setNotice({ text: refusal, at: Date.now() });
      if (drew) setSheetSignal((n) => n + 1);
    },
    startingSize(),
  ), []);

  // Iris's tool calls: the planner acts, the plan follows, the result is what she says.
  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall) => session.tool(name, args ?? {}), [session]);

  // If Iris narrates a safe action (units, a floor, the sheet) without calling it, the page does it and tells her.
  const net = useToolNet({
    match: (text) => {
      const call = mustDo(text, contextOf(session.snapshot()));
      return call ? { id: `net-${Date.now()}`, ...call } : null;
    },
    run: async (call) => session.tool(call.name, call.arguments),
    avatar: () => avatarRef.current!,
  });
  // The host's words over the video: off by default, since the chat carries them.
  const cc = useCaptionToggle('room-planner', false);
  const avatar = useAvatar('room-planner', { onToolCall: net.watch(onToolCall), onUserSaid: (text) => net.heard(text) });
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  // The plan is on screen (and in Iris's picture) before anyone speaks.
  useEffect(() => { session.restate(); }, [session]);

  // Each call: the plan as it is now, and the opening once she is on her way.
  useEffect(() => {
    if (avatar.phase === 'ended' || avatar.phase === 'failed') callRef.current += 1;
    if (avatar.phase !== 'starting') return;
    callRef.current += 1;
    session.restate();
    avatar.event(session.opening(), 60);
  }, [avatar.phase]);

  const readPhoto = async (purpose: Purpose, input: Parameters<HomeSession['photo']>[1], url: string, which: Purpose | 'sample') => {
    setReading(which);
    setPhotoError(null);
    try {
      const result = await session.photo(purpose, input);
      if ('error' in result) setPhotoError(result.error);
      else setLastPhoto({ seen: result.seen, url, added: result.added });
    } catch {
      setPhotoError("That photo couldn't be read. Try another one, taken in good light.");
    } finally {
      setReading(null);
    }
  };

  const photos: Photos = {
    reading,
    error: photoError,
    last: lastPhoto,
    onSample: () => void readPhoto('room', { sample: 'room' }, `${API}/samples/room.jpg`, 'sample'),
    onFile: (purpose, file) => void readImage(file)
      .then(({ image, url }) => readPhoto(purpose, { image }, url, purpose))
      .catch(() => setPhotoError("That file isn't a photo we can read. Try a JPEG or PNG.")),
  };

  if (avatar.phase === 'idle') return <Lobby host={HOST} onStart={(mic) => void avatar.start({ mic })} />;

  const rooms = snap?.level.rooms.filter((r) => r.kind !== 'stairs').length ?? 0;

  const host = (
    <section className="pw-host">
      <HostVideo avatar={avatar} captions={cc.on} onToggleCaptions={cc.toggle} name={HOST} poster={portrait} className="pw-host-video">
        <CallStatus avatar={avatar} name={HOST} again={`Call ${HOST} again`} />
      </HostVideo>
      <div className="pw-nameplate">
        <span><b>{HOST}</b> your architect</span>
        {live && <span className="pw-onair">On the call{avatar.secondsLeft !== null && avatar.secondsLeft <= 120 ? ` · ${clock(avatar.secondsLeft)} left` : ''}</span>}
      </div>
      {/* On a phone the video is small: what she is saying rides beside it. */}
      {live && avatar.caption && <p className="pw-host-line" aria-hidden="true">{avatar.caption.slice(-160)}</p>}
      {avatar.phase === 'ended' && snap && (
        <div className="pw-done" role="status">
          <p className="pw-eyebrow">Your plan</p>
          <p className="pw-done-total">
            {rooms ? <>{rooms} rooms · {areaLabel(snap.schedule.total_m2, snap.unit)}</> : 'Nothing drawn yet'}
            {snap.levels.length > 1 && ' on this floor'}
          </p>
          <p className="pw-hint">
            {snap.schemes.length ? `${snap.schemes.length} scheme${snap.schemes.length === 1 ? '' : 's'} saved. ` : ''}
            It stays here until you close the page: download the sheet to keep it.
          </p>
          <button type="button" className="pw-primary" disabled={!rooms} onClick={() => void session.panel({ kind: 'draw_sheet' })}>
            Get the drawing sheet
          </button>
        </div>
      )}
      {avatar.phase === 'failed' && <p className="pw-hint">The plan still works by hand while you try again.</p>}
    </section>
  );

  // A listing's floor plan or photos of the rooms, for Iris herself. Her host
  // reads every file and speaks of the drop once, so the app adds no word of
  // its own; she lays a plan out through her tools, from the sizes printed on
  // it. A photo shared here is not read into furniture: that is Bring your own.
  const files = avatar.filesAccepted ? (
    <FileDrop
      avatar={avatar} name={HOST} accept="image/*,.pdf" className="pw-files"
      label="Share a floor plan or photos"
      hint={`The listing's floor plan (PDF or picture) or photos of your rooms: ${HOST} works from the sizes printed on the plan.`}
    />
  ) : null;

  const chat = (
    <ChatPanel
      avatar={avatar} name={HOST} className="pw-chat" placeholder={`Ask ${HOST} for a change…`}
      empty={<>Talk to {HOST}, or type here: <em>“about 70 square metres, two bedrooms and a study”</em>.</>}
    />
  );

  return (
    <div className="pw-app">
      {/* Until the drop is offered, a file dropped on the page is ignored: opened in the tab, it would end the call. */}
      {!files && <PageDropGuard />}
      <header className="pw-top">
        <BackToApps avatar={avatar} name={HOST} /><Logo />
        <CallControls avatar={avatar} className="pw-controls" />
      </header>
      <Studio
        state={snap} send={(intent) => session.panel(intent)} photos={photos} notice={notice} sheetSignal={sheetSignal}
        host={host} chat={chat} files={files} hostName={HOST}
      />
    </div>
  );
}
