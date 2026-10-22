// Home planner: the avatar is the architect; the page owns the plan.
//
// The planner runs here (nothing about a floor plan is secret, and every drag
// should be instant). The avatar is told the plan as its state and each outcome
// as an event; the client's words reach the plan through the judge (rules in
// the page, a model on the server), its photos through the server's reader.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AvatarStage, Composer, Transcript, useAvatar } from '../../../src/kit/index.ts';
import { NOTES } from '../engine/director.ts';
import { roomSideCm, type Line } from '../engine/judge.ts';
import { MAX_SIDE_CM, MIN_SIDE_CM, snap as toGrid } from '../engine/home.ts';
import type { PlanSnapshot } from '../engine/types.ts';
import { RoomPlanner, type Photos, type Purpose } from './RoomPlanner.tsx';
import { HomeSession, type ServerPort } from './session.ts';
import './styles.css';

const API = '/api/apps/room-planner';

const postJson = (path: string, body: unknown) =>
  fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const server: ServerPort = {
  async judge(text, plan, recent) {
    // Without a model key the server answers 503 and the rules alone decide.
    const res = await postJson('/judge', { text, plan, recent });
    return res.ok ? res.json() : null;
  },
  async photo(purpose, input, plan) {
    const res = await postJson('/photo', { purpose, plan, ...input });
    if (res.status === 503) return { error: "Reading photos needs the app's model (GEMINI_API_KEY on the server)." };
    if (!res.ok) return { error: "The photo couldn't be read. Try another one." };
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
 * The floor's starting size, from ?w=900&h=700 (centimetres, or metres: ?w=9):
 * the original took it from the app's install parameters. 9 by 7 metres otherwise.
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
  const [reading, setReading] = useState<Purpose | 'sample' | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [lastPhoto, setLastPhoto] = useState<Photos['last']>(null);

  const avatar = useAvatar('room-planner', {
    // The avatar hears the client too and answers at once; the plan's outcome
    // follows as an event (the notes tell it to wait for that).
    onUserSaid: (text, how) => { if (how === 'spoken') void session.words(text, 'spoken', recent()); },
  });
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;

  const recent = (): Line[] => avatarRef.current.lines.slice(-8).map((l) => ({ who: l.who === 'avatar' ? 'architect' : 'client', text: l.text }));

  const session = useMemo(() => new HomeSession(
    {
      state: (text) => avatarRef.current.state(text),
      event: (text, ttl) => avatarRef.current.event(text, ttl),
      live: () => avatarRef.current.phase === 'live',
    },
    server,
    ({ snapshot, refusal }) => {
      setSnap(snapshot);
      if (refusal) setNotice({ text: refusal, at: Date.now() });
    },
    startingSize(),
  ), []);

  // The plan is on screen (and in the avatar's state) before anyone speaks.
  useEffect(() => { session.restate(); }, [session]);

  // Each session: the standing rules, the plan as it is now, and the opening.
  useEffect(() => {
    if (avatar.phase !== 'starting') return;
    for (const note of NOTES) avatar.note(note);
    session.restate();
    session.open();
  }, [avatar.phase]);

  // A typed line is judged first; only what isn't a plan action goes to the avatar.
  const onTyped = (text: string) => {
    void session.words(text, 'typed', recent()).then((heard) => {
      if (heard.handled) avatarRef.current.record(text);
      else avatarRef.current.say(text);
    });
  };

  const readPhoto = async (purpose: Purpose, input: Parameters<HomeSession['photo']>[1], url: string, which: Purpose | 'sample') => {
    setReading(which);
    setPhotoError(null);
    try {
      const result = await session.photo(purpose, input);
      if ('error' in result) setPhotoError(result.error);
      else setLastPhoto({ seen: result.seen, url, added: result.added });
    } catch {
      setPhotoError("The photo couldn't be read. Try another one.");
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
      .catch(() => setPhotoError("That file couldn't be read as a photo.")),
  };

  return (
    <div className="kit-layout rp-layout">
      <div className="kit-side">
        <AvatarStage
          avatar={avatar} name="Your architect" startLabel="Start planning"
          lobby={<><div className="kit-title">Home planner</div><div className="kit-detail">Plan a whole home by talking: say roughly how big the place is and how many bedrooms, then argue with the sketch. Everything also works by hand on the plan.</div></>}
        />
        <Composer avatar={avatar} placeholder="Type a change: give the kitchen a metre off the hall…" onSubmit={onTyped} />
        <Transcript avatar={avatar} names={{ avatar: 'Architect' }} />
      </div>
      <main className="rp-main">
        <RoomPlanner state={snap} send={(intent) => session.panel(intent)} photos={photos} notice={notice} />
      </main>
    </div>
  );
}
