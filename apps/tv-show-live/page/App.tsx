// The Gilded Reel: Jada Monroe hosts a late-night show about the art of film.
// She introduces tonight's film, rolls its trailer, then invites its designer
// onto the screen in the studio wall, all on speech-to-speech. Each avatar has
// a speech session (show/speech.ts); the faces are avatar-only renders in one
// LiveKit room of the site's own: Jada's (facing the lens) and the guest's.
// The page wires them: each avatar's voice is what the other hears and what
// its face says. The cameras are the page's own: the director
// (show/director.ts) cuts between framings of those two renders, Jada in a
// medium shot or a close-up, the guest, or both side by side, so a show needs
// only two renders. The person
// at the page is the producer: they never speak; they choose the topics, and
// Jada opens each one with the guest.
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackToApps, clock, useAvatarOnly, type AvatarOnly, type SpeechWriter } from '../../../src/kit/index.ts';
import { createBooth, TURN_QUIET_MS, type Booth, type Role, type Stage } from '../show/booth.ts';
import { startScore } from './score.ts';
import { createAdvancer, type Advancer, type Verdict } from '../show/advance.ts';
import { createBooker, type Booker, type Booking } from '../show/booker.ts';
import { createFloor } from '../show/floor.ts';
import { createFillerGate, DELAY_MS as FILLER_DELAY_MS } from '../show/fillers.ts';
import { createDirector, type Director, type Shot, type ShotMode } from '../show/director.ts';
import { FILM, GUESTS, HOST, SHOW, firstName, type Guest } from '../show/cast.ts';
import { bridgeCue, farewellCue, filmCue, goodbyeCue, guestFarewellCue, guestPrompts, holdCue, hostPrompts, LISTENING_EVERY_MS, holdMoreCue, inviteCue, inviteNowCue, noteCue, nudgeCue, topicCue, welcomeCue, wrapCue } from '../show/script.ts';
import { openSpeech, SpeechError, type SpeechLine } from '../show/speech.ts';
import { createResampler, createVoice } from '../show/voice.ts';
import cam2 from '../studio/cam2.jpg';
import wall from '../studio/wall.jpg';
import desk from '../studio/desk.webp';
import ines from '../guests/ines.jpg';
import still1 from '../film/still-1.jpg';
import still2 from '../film/still-2.jpg';
import still3 from '../film/still-3.jpg';
import still4 from '../film/still-4.jpg';
import still5 from '../film/still-5.jpg';
import './gilded.css';

const API = '/api/apps/tv-show-live';
const PORTRAITS: Record<string, string> = { ines };
const STILLS: Record<number, string> = { 1: still1, 2: still2, 3: still3, 4: still4, 5: still5 };
const END_AFTER_GOODBYE_MS = 4_000;
const SHOT_MS = 5_200;          // each trailer still, held and pushed in on
// The booth hears Jada's line end in her speech session; viewers hear it from her face about
// 4 s later (measured). The trailer rolls once the face is through it, not over her last words.
// Plus the filler gate's fixed delay (show/fillers.ts), which every voice passes on its way to its face.
const FACE_LAG_MS = 4_500 + FILLER_DELAY_MS;
// Her line after the trailer is cued this long before the trailer ends, so that what she says
// comes out of her face as it ends: her session takes a second or so to start the line, then
// her face is FACE_LAG_MS behind. Cued at the end, she was silent on screen for five seconds.
const INVITE_LEAD_MS = FACE_LAG_MS + 1_500;
const TRAILER_FADE_MS = 900;
const CAPTION_LINGER_MS = 3_000;
const SEGMENT_MS = 4 * 60_000;   // a guest's time on air before an auto-booked guest may take over   // the dissolve into the trailer and back out to the studio

const STAGE_TEXT: Record<Stage, string> = {
  greeting: 'Jada is opening the show',
  introducing: 'Jada is introducing the film',
  trailer: 'Rolling the trailer',
  holding: 'Holding for the guest',
  inviting: 'Jada is inviting the guest on',
  dialing: 'Putting the guest through…',
  'on-air': 'On air',
  closing: 'Wrapping up',
  over: 'Off air',
};

interface LogLine { id: number; who: Role | 'booth'; text: string; name?: string }

/** The server's view of a guest being invented (invent.ts). */
interface InventionView {
  id: string;
  steps: Partial<Record<'character' | 'portrait' | 'voice' | 'avatar', { status: 'waiting' | 'running' | 'done' | 'failed'; ms?: number }>>;
  guest?: Omit<Guest, 'avatarId'>;
  portrait?: string;
  ready: boolean;
  error?: string;
  seconds: number;
}
const isInvented = (id?: string) => Boolean(id?.startsWith('invented-'));
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
/** A guest's still: the cast's own, or an invented guest's portrait. */
const posterOf = (g: Guest | null, inventions: Record<string, InventionView>) => (g ? PORTRAITS[g.id] ?? inventions[g.id]?.portrait ?? BLANK : BLANK);

// Each avatar's voice reaches its face as ONE stream for the whole show,
// silence included. Measured live against the raw voice: a piece per stretch
// of speech lost 1.3 s of 13.8 s to dropouts (every new piece starts the
// renderer cold); one stream lost 0.05 s of 13.4 s.
const WRITE_SAMPLES = 1600;   // 100 ms at 16 kHz per write: fewer, larger packets

/**
 * Hands one avatar's voice to a face. The face opens its stream asynchronously,
 * so frames wait for it; writes go out one after another, in order, in 100 ms chunks.
 */
function faceFeeder(face: () => AvatarOnly) {
  let writer: Promise<SpeechWriter | null> | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  let pending: Int16Array[] = [];
  let pendingSamples = 0;
  const flush = () => {
    if (!pendingSamples || !writer) return;
    const pcm = new Int16Array(pendingSamples);
    let at = 0;
    for (const p of pending) { pcm.set(p, at); at += p.length; }
    pending = []; pendingSamples = 0;
    const w = writer;
    chain = chain.then(() => w.then((x) => x?.write(pcm))).catch(() => {});
  };
  return {
    get open() { return writer !== null; },
    start() { writer = face().open(); },
    frame(pcm: Int16Array) {
      if (!writer) return;
      pending.push(pcm); pendingSamples += pcm.length;
      if (pendingSamples >= WRITE_SAMPLES) flush();
    },
    end() {
      flush();
      const w = writer;
      writer = null;
      chain = chain.then(() => w?.then((x) => x?.end())).catch(() => {});
    },
  };
}

export function App() {
  // The lobby's choice: a guest of the cast, or one to invent from a description.
  const [guestId, setGuestId] = useState(GUESTS[0].id);
  const [inventText, setInventText] = useState('');
  const castGuest = GUESTS.find((g) => g.id === guestId) ?? GUESTS[0];
  // The guest on air (or about to be): the cast's, or an invented one once it is written.
  const [current, setCurrent] = useState<Guest | null>(castGuest);
  const guest: Guest = current ?? { id: 'pending', name: 'Tonight\'s guest', billing: 'joining shortly', from: '', avatarId: '', rundown: [] };
  // Two guest slots, so the next guest's face warms up while the one on air talks: each holds a
  // guest (seated once built), and onTv says which slot the TV shows.
  const [slots, setSlots] = useState<(Guest | null)[]>([null, null]);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const [onTv, setOnTv] = useState(0);
  const onTvRef = useRef(0);
  onTvRef.current = onTv;
  // Guests being invented: the server's view of each, polled; and what each is for.
  const [inventions, setInventions] = useState<Record<string, InventionView>>({});
  // What each invented guest is for: the slot it goes to, whether it opens the show, and whether
  // the show booked it on its own (auto-booking), which brings it on at a natural moment.
  const purpose = useRef<Record<string, { slot: number; opening: boolean; auto?: boolean }>>({});
  // Auto-booking (show/booker.ts): the show books its next guest from the conversation.
  const [autoBook, setAutoBook] = useState(true);
  const autoBookRef = useRef(true);
  autoBookRef.current = autoBook;
  const booker = useRef<Booker | null>(null);
  // An auto-booked guest comes on once the guest on air has had their time: their topics used
  // up, or SEGMENT_MS on air.
  const [segmentDone, setSegmentDone] = useState(false);
  const segmentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A guest can be invented from the lobby, before the show: go on air when it is ready, and
  // Jada never has to hold for them (a build takes three to five minutes).
  const [lobbyInvention, setLobbyInvention] = useState<string | null>(null);
  // The cast guest the show opened with, if any, for the booth's roster of guests.
  const [castOnShow, setCastOnShow] = useState<Guest | null>(null);
  const [gone, setGone] = useState<string[]>([]);
  // What the TV says between two guests (the key art, and who is next).
  const [tvCard, setTvCard] = useState<string | null>(null);
  const [topics, setTopics] = useState<string[]>(castGuest.rundown);
  // Auto-advance (show/advance.ts): the next topic goes to Jada when the conversation says the
  // current one has run its course. The advancer is made per show; refs keep its view current.
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [suggestWrap, setSuggestWrap] = useState(false);
  const advancer = useRef<Advancer | null>(null);
  const firstTopic = useRef('');
  const live = useRef({ topics: [] as string[], used: new Set<string>(), auto: true, wrapped: false });
  live.current.topics = topics;
  live.current.auto = autoAdvance;
  const [showId, setShowId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('greeting');
  const [patched, setPatched] = useState(false);
  const [used, setUsed] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<LogLine[]>([]);
  const [problem, setProblem] = useState('');
  const [onShow, setOnShow] = useState(false);
  const [trailer, setTrailer] = useState(false);
  // The trailer fades in over the studio, and out of it at its end: while it fades out it is
  // still there, but the studio is back on air (her window back in her seat, her voice heard).
  const [trailerLeaving, setTrailerLeaving] = useState(false);
  const trailerUp = trailer && !trailerLeaving;
  // While the trailer plays the studio is off air: what Jada says then is neither heard nor logged.
  // During the trailer Jada watches it in a corner window, silent: what she says then is
  // neither heard nor logged, and her faces get silence (see hush), so they never mouth it.
  const trailerOn = useRef(false);
  trailerOn.current = trailer;
  // Her voice is kept off her faces from the roll until her line after the trailer is cued:
  // with her face FACE_LAG_MS behind, that is the trailer's time on screen.
  const hush = useRef(false);
  const [shot, setShot] = useState<Shot>('host-front');
  const [shotMode, setShotMode] = useState<ShotMode>('auto');
  const director = useRef<Director | null>(null);
  const logId = useRef(0);
  const addLog = (who: LogLine['who'], text: string, name = who === 'guest' ? segment.current?.name : undefined) => setLog((l) => [...l.slice(-150), { id: ++logId.current, who, text, name }]);
  // What is being said, word by word, in step with the faces: words arrive with the voice, which
  // the faces play FACE_LAG_MS later, so each word shows that much later, as heard.
  const [speaking, setSpeaking] = useState<Partial<Record<Role, { name?: string; text: string }>>>({});
  // Captions on the video: the line being said, as heard; it lingers CAPTION_LINGER_MS after.
  const [caption, setCaption] = useState<{ who: Role; name: string; text: string } | null>(null);
  useEffect(() => {
    const role = (['guest', 'host'] as Role[]).find((r) => speaking[r]?.text.trim());
    if (role) return void setCaption({ who: role, name: role === 'host' ? HOST.name : speaking[role]!.name ?? 'Guest', text: speaking[role]!.text.trim() });
    const id = setTimeout(() => setCaption(null), CAPTION_LINGER_MS);
    return () => clearTimeout(id);
  }, [speaking]);
  // Director mode shows the booth and the transcript beside the picture; full window, the picture alone.
  const [view, setView] = useState<'director' | 'full'>('director');
  const [captionsOn, setCaptionsOn] = useState(true);
  const toggleFullScreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => {}); };

  // A ref, not the state: the booth's callbacks are made before the show has its id.
  const showRef = useRef<string | null>(null);
  // A seat: the host, or a guest by id (g-<id>), so two guests can each have a face and a line.
  const seatApi = (seat: string) => `${API}/show/${showRef.current}/${seat}`;
  const face = (seat: string) => (showId ? `tv-show-live/show/${showId}/${seat}` : 'tv-show-live');
  const slotFace = (i: number) => (slots[i] ? face(`g-${slots[i]!.id}`) : 'tv-show-live');
  // Jada's face is her camera-1 avatar (facing the lens); her speech session is her main avatar's.
  // Jada is one avatar: her conversation and her one render, turned toward the TV (a render's
  // pose is fixed by its picture).
  const hostFace = useAvatarOnly(face('host'));
  const slotFaces = [useAvatarOnly(slotFace(0)), useAvatarOnly(slotFace(1))];
  const guestFace = slotFaces[onTv];
  // Each face is told what it shows, and to keep a fixed camera, once it is up; while it listens,
  // its small reactions take turns every LISTENING_EVERY_MS (script.ts).
  const promptTurn = useRef(0);
  useEffect(() => {
    const id = setInterval(() => { promptTurn.current++; sendPrompts(false); }, LISTENING_EVERY_MS);
    return () => clearInterval(id);
  }, []);
  const sendPrompts = (first: boolean) => {
    const k = promptTurn.current;
    const pick = (p: { talking: string; listening: string[] }) => ({ talking: p.talking, listening: p.listening[k % p.listening.length] });
    const f0 = faces.current;
    if (f0.host.phase === 'live') {
      void f0.host.setPrompt(first ? pick(hostPrompts) : { listening: pick(hostPrompts).listening })
        .then((a) => { if (first) console.info('[gilded-reel] Jada prompt: renders_prompts=%s', a?.renders_prompts); });
    }
    [f0.g0, f0.g1].forEach((f, i) => {
      const g = slotsRef.current[i];
      if (f.phase !== 'live' || !g) return;
      void f.setPrompt(first ? pick(guestPrompts(g)) : { listening: pick(guestPrompts(g)).listening })
        .then((a) => { if (first) console.info('[gilded-reel] %s prompt: renders_prompts=%s', g.name, a?.renders_prompts); });
    });
  };
  useEffect(() => { if (hostFace.phase === 'live' || slotFaces.some((f) => f.phase === 'live')) sendPrompts(true); },
    [hostFace.phase, slotFaces[0].phase, slotFaces[1].phase, slots[0]?.id, slots[1]?.id]);
  const faces = useRef({ host: hostFace, g0: slotFaces[0], g1: slotFaces[1] });
  faces.current = { host: hostFace, g0: slotFaces[0], g1: slotFaces[1] };

  const booth = useRef<Booth | null>(null);
  const lines = useRef<Partial<Record<Role, SpeechLine>>>({});
  const words = useRef<Record<Role, string>>({ host: '', guest: '' });
  const segment = useRef<Guest | null>(null);
  // Who is speaking now (their voice's stretch): while one speaks, the other's voice is not passed
  // to them. Each session takes any sound from its user as a barge-in, and live a guest's "Oh,"
  // or "hmm" cut the host off mid-sentence again and again. A pause longer than the voice's
  // stretch still lets the other answer.
  const talking = useRef<Record<Role, boolean>>({ host: false, guest: false });
  // ...held until the speaker has been quiet TURN_QUIET_MS, as the booth ends a turn: a voice's
  // stretch ends after 0.6 s, and a pause mid-sentence let the other's "mm-hmm" through, which
  // cut the host off while the guest was not speaking at all.
  const talkingUntil = useRef<Partial<Record<Role, ReturnType<typeof setTimeout>>>>({});
  // And what goes on air: only the speaker; the listener's "mm-hmm" and "wow" stay off it (show/floor.ts).
  const floor = useMemo(() => createFloor(), []);

  // Each avatar's voice: its face says it, the other avatar hears it, and the booth sees when it speaks.
  const voices = useMemo(() => {
    const make = (role: Role, seats: ('host' | 'g0' | 'g1')[]) => {
      const feeders = seats.map((seat) => ({ seat, feeder: faceFeeder(() => faces.current[seat]) }));
      const resample = createResampler();
      // The voice reaches the face through the filler gate: "yeah uh ummm oh" never said or mouthed.
      const gate = createFillerGate();
      const voice = createVoice({
        // The voice's stretches say when the avatar speaks, for the booth and the transcript.
        onStart() {
          gate.stretch();
          clearTimeout(talkingUntil.current[role]);
          talking.current[role] = true;
          floor.speaking(role, true);
          if (!floor.onAir(role)) return;   // a backchannel: neither the booth nor the director sees it
          booth.current?.speaking(role, true);
          director.current?.speaking(role, true);
        },
        onFrame() {},
        onEnd() {
          clearTimeout(talkingUntil.current[role]);
          talkingUntil.current[role] = setTimeout(() => { talking.current[role] = false; }, TURN_QUIET_MS);
          const aired = floor.wentOnAir(role);
          floor.speaking(role, false);
          booth.current?.speaking(role, false);
          director.current?.speaking(role, false);
          const said = words.current[role].trim();
          words.current[role] = '';
          if (said && aired && !trailerOn.current) {
            advancer.current?.line({ who: role, text: said });
            booker.current?.line({ who: role, text: said });
          }
          // The live line becomes a line of the transcript once its last word has been heard.
          const name = role === 'guest' ? segment.current?.name : undefined;
          setTimeout(() => {
            setSpeaking((l) => ({ ...l, [role]: undefined }));
            if (said && aired && !trailerOn.current) addLog(role, said, name);
          }, FACE_LAG_MS);
        },
      });
      return {
        feed(pcm: Int16Array) {
          voice.feed(pcm);
          // Not heard (off the floor), or Jada during the trailer: the face
          // gets silence of the same length, so its stream keeps time.
          const quiet = !floor.onAir(role) || (role === 'host' && hush.current);
          const pcm16 = resample(quiet ? new Int16Array(pcm.length) : pcm);
          // One stream per face for the whole show, from the first frame once that face is up.
          for (const due of gate.push(pcm16, performance.now())) {
            for (const { seat, feeder } of feeders) {
              if (seat !== 'host' && seat !== `g${onTvRef.current}`) continue;   // the guest's voice: the slot on the TV
              if (!feeder.open && faces.current[seat].phase === 'live') feeder.start();
              feeder.frame(due);
            }
          }
        },
        words(delta: string) { gate.words(delta, performance.now()); },
        flush() { voice.flush(); for (const { feeder } of feeders) feeder.end(); },
      };
    };
    return { host: make('host', ['host']), guest: make('guest', ['g0', 'g1']) };
  }, []);

  // rejoin: a guest whose line dropped, put back through once (their face is still up), the
  // conversation carrying on where it was.
  async function openSeat(role: Role, who?: Guest, rejoin = false): Promise<SpeechLine | undefined> {
    const other: Role = role === 'host' ? 'guest' : 'host';
    let opened: SpeechLine | undefined;
    try {
      const line = await openSpeech(seatApi(role === 'host' ? 'host' : `g-${who!.id}`), {
        onAudio(b64, pcm) {
          voices[role].feed(pcm);
          if (!talking.current[other]) lines.current[other]?.hear(b64);
        },
        onWords(delta) {
          words.current[role] += delta;
          voices[role].words(delta);
          if (!trailerOn.current && floor.onAir(role)) {
            const name = role === 'guest' ? segment.current?.name : undefined;
            setTimeout(() => setSpeaking((l) => ({ ...l, [role]: { name, text: (l[role]?.text ?? '') + delta } })), FACE_LAG_MS);
          }
          // Auto-advance judges the guest's answer while it is still being given (show/advance.ts).
          if (role === 'guest' && floor.onAir('guest')) advancer.current?.hearing(words.current.guest);
        },
        onClosed(reason) {
          if (!booth.current || booth.current.stage === 'over' || lines.current[role] !== opened) return;
          // A guest who dropped is put back through once; the show goes on. Jada cannot be replaced.
          if (role === 'guest' && who && !rejoin) {
            lines.current.guest = undefined;
            addLog('booth', `${who.name}'s line dropped (${reason}): putting them back through`);
            void openSeat('guest', who, true);
            return;
          }
          offAir(`${role === 'host' ? HOST.name : who?.name ?? 'The guest'} left the line (${reason}).`);
        },
        onError(message) {
          console.warn('[gilded-reel] %s: %s', role, message);
          // A speak-up sent while her turn was still open: the booth sends it again when it is over.
          if (role === 'host' && /between turns/i.test(message)) booth.current?.speakUpRefused();
        },
      });
      opened = line;
      lines.current[role] = line;
      if (rejoin) {
        addLog('booth', `${who!.name} is back on the line`);
        booth.current?.cue(`${firstName(who!.name)}'s video call dropped for a moment and is back now: say so lightly in a few words, then carry on where you were.`);
        return line;
      }
      if (role === 'host') booth.current?.hostLive();
      // The guest is on: the two-shot, Jada and the TV, until the booth or the director cuts.
      else {
        setPatched(true); chooseShot('two'); booth.current?.guestLive(); advancer.current?.topic(firstTopic.current, true);
        booker.current?.guestOn();
        setSegmentDone(false);
        clearTimeout(segmentTimer.current);
        segmentTimer.current = setTimeout(() => setSegmentDone(true), SEGMENT_MS);
      }
      return line;
    } catch (err) {
      offAir(`We couldn't open ${role === 'host' ? HOST.name : segment.current?.name}'s line: ${(err as SpeechError).code ?? (err as Error).message}`);
    }
  }

  // Jada's face starts backstage, and a guest's as soon as it is seated in a slot (a cast guest
  // at once, an invented one once it is built); the show starts, with Jada's line, once her face
  // and a cast guest's are up. The guest's face waits on the TV, hidden, until they are put through.
  useEffect(() => { if (showId) void hostFace.start(); }, [showId]);
  useEffect(() => { if (showId && slots[0] && (slotFaces[0].phase === 'idle' || slotFaces[0].phase === 'ended')) void slotFaces[0].start(); }, [showId, slots[0]]);
  useEffect(() => { if (showId && slots[1] && (slotFaces[1].phase === 'idle' || slotFaces[1].phase === 'ended')) void slotFaces[1].start(); }, [showId, slots[1]]);
  const hostOpened = useRef(false);
  const [backstage, setBackstage] = useState(true);
  useEffect(() => {
    const waitFor = [hostFace, ...(isInvented(slots[0]?.id) || !slots[0] ? [] : [slotFaces[0]])];
    if (waitFor.some((f) => f.phase !== 'live') || hostOpened.current || !booth.current) return;
    hostOpened.current = true;
    setBackstage(false);
    void openSeat('host');
  }, [hostFace.phase, slotFaces[0].phase, slots[0]]);
  useEffect(() => {
    if (!onShow) return;
    // Jada's camera, or the camera of the guest on air (or about to be, before anyone is on),
    // failing ends the show; a next guest's failing does not: the booth says so, the show goes on.
    const failed = [hostFace, slotFaces[onTv]].find((f) => f.phase === 'failed');
    if (failed) return offAir(failed.detail || 'A camera could not start.');
    const next = 1 - onTv;
    if (patched && slotFaces[next].phase === 'failed' && slots[next]) {
      addLog('booth', `${slots[next]!.name}'s camera could not start (${slotFaces[next].detail || 'unknown'}); the show goes on with ${segment.current?.name ?? 'the guest on air'}`);
      for (const [id, w] of Object.entries(purpose.current)) if (id === slots[next]!.id) delete purpose.current[id];
      setSlots((all) => all.map((g, i) => (i === next ? null : g)));
    }
  }, [hostFace.phase, slotFaces[0].phase, slotFaces[1].phase]);
  // A guest's face is up: the booth may put them through (held for, or handed over to).
  useEffect(() => {
    if (!onShow) return;
    if (!patched && slotFaces[0].phase === 'live') booth.current?.guestReady();
    const next = 1 - onTv;
    const nextFor = slots[next] && purpose.current[slots[next]!.id];
    if (patched && slots[next] && slotFaces[next].phase === 'live' && !handingOver.current && (!nextFor?.auto || segmentDone)) handOver(next);
  }, [slotFaces[0].phase, slotFaces[1].phase, patched, onShow, segmentDone]);
  useEffect(() => {
    if (stage !== 'over' || !onShow) return;
    const id = setTimeout(() => void wrapUp(), END_AFTER_GOODBYE_MS);
    return () => clearTimeout(id);
  }, [stage, onShow]);
  useEffect(() => { if (!onShow) { setCurrent(castGuest); setTopics(castGuest.rundown); } }, [guestId]);

  // Both voices are heard whatever the shot; nobody in the studio during the trailer.
  useEffect(() => {
    const set = (f: AvatarOnly, on: boolean) => { if (f.audioRef.current) f.audioRef.current.muted = !on; };
    set(hostFace, !trailerUp);
    slotFaces.forEach((f, i) => set(f, patched && i === onTv && !trailerUp));
  }, [trailerUp, patched, onTv, hostFace.phase, slotFaces[0].phase, slotFaces[1].phase]);

  function offAir(why: string) {
    if (!booth.current) return;
    const wasOver = booth.current.stage === 'over';
    booth.current.close();
    if (!wasOver && why) setProblem(why);
    void wrapUp();
  }

  async function wrapUp() {
    booth.current?.close();
    director.current?.close();
    setTrailer(false);
    voices.host.flush();
    voices.guest.flush();
    await Promise.allSettled([lines.current.host?.end(), lines.current.guest?.end(), faces.current.host.end(), faces.current.g0.end(), faces.current.g1.end()]);
    lines.current = {};
    if (showRef.current) void fetch(`${API}/show/${showRef.current}/end`, { method: 'POST', keepalive: true }).catch(() => {});
  }

  async function goOnAir(first: string, describe?: string) {
    const cast = describe ? null : castGuest;
    // An invention begun in the lobby carries on: its guest, written or built already, is the opening guest.
    const early = describe && lobbyInvention ? lobbyInvention : null;
    const earlyView = early ? inventions[early] : undefined;
    const earlyGuest = earlyView?.guest ? { ...earlyView.guest, avatarId: '' } : null;
    goneGuests.current = [];
    setCastOnShow(cast); setGone([]); setTvCard(null); setSpeaking({});
    setCurrent(cast ?? earlyGuest); setSlots([cast ?? (earlyView?.ready ? earlyGuest : null), null]); setOnTv(0); onTvRef.current = 0; handingOver.current = false;
    if (!early) { setInventions({}); purpose.current = {}; }
    if (earlyGuest) { first = earlyGuest.rundown[0] ?? ''; setTopics(earlyGuest.rundown); }
    setProblem(''); setLog([]); setUsed(new Set(first ? [first] : [])); setPatched(false); setStage('greeting'); setTrailer(false); setTrailerLeaving(false); setShot('host-front'); setShotMode('auto'); setSuggestWrap(false);
    director.current?.close();
    director.current = createDirector({ onShot: setShot });
    firstTopic.current = first;
    live.current.wrapped = false;
    live.current.used = new Set(first ? [first] : []);
    // Live while it is this show's: an advancer of an earlier show stays quiet. (Not the show's id:
    // that is only known once the server has made the show, after this.)
    const mine: Advancer = createAdvancer({
      judge: async (topic, lines) => {
        const res = await fetch(`${API}/show/${showRef.current}/judge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic, lines, guest: segment.current?.name }) });
        if (!res.ok) throw new Error(`judge ${res.status}`);
        return (await res.json()) as Verdict;
      },
      next: () => live.current.topics.find((t) => !live.current.used.has(t)) ?? null,
      move: (topic, reason) => sendTopic(topic, reason),
      exhausted: () => {
        if (Object.values(purpose.current).some((w) => !w.opening)) { setSegmentDone(true); addLog('booth', 'That was the last topic on the rundown: the next guest comes on when ready'); return; }
        setSuggestWrap(true);
        addLog('booth', "That was the last topic on the rundown: wrap it up when you're ready");
      },
      enabled: () => advancer.current === mine && live.current.auto && !live.current.wrapped && booth.current?.stage === 'on-air',
    });
    advancer.current = mine;
    // Live while it is this show's, as the advancer.
    const myBooker: Booker = createBooker({
      ask: async (lines, guests) => {
        const res = await fetch(`${API}/show/${showRef.current}/book`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines, guests, guest: segment.current?.name }) });
        if (!res.ok) throw new Error(`booker ${res.status}`);
        return (await res.json()) as Booking;
      },
      book: (description, reason) => void bookGuest(description, reason),
      enabled: () => booker.current === myBooker && autoBookRef.current && !live.current.wrapped && booth.current?.stage === 'on-air'
        && !handingOver.current && !Object.keys(purpose.current).some((id) => !inventionsRef.current[id]?.ready && !inventionsRef.current[id]?.error),
      guests: () => showGuests(),
    });
    booker.current = myBooker;
    setSegmentDone(false);
    clearTimeout(segmentTimer.current);
    hostOpened.current = false;
    segment.current = cast ?? earlyGuest;
    setBackstage(true);
    // The texts are read when used: an invented guest is only written a few seconds into the show.
    const now = () => segment.current ?? guest;
    booth.current = createBooth({
      film: filmCue(),
      rollTrailer: () => { hush.current = true; addLog('booth', `Roll the ${FILM.title} trailer`); const show = showRef.current; setTimeout(() => { if (showRef.current === show) setTrailer(true); }, FACE_LAG_MS); },
      invite: () => inviteCue(now()),
      guestReady: () => faces.current.g0.phase === 'live' && Boolean(slotsRef.current[0]),
      hold: () => holdCue(segment.current),
      holdMore: () => holdMoreCue(segment.current),
      inviteNow: () => inviteNowCue(now()),
      welcome: () => welcomeCue(now(), firstTopic.current),
      nudge: () => nudgeCue(now()),
      wrap: () => wrapCue(now()),
      goodbye: goodbyeCue,
      deliver({ to, kind, text }) {
        // For tests and analytics: everything the booth hands either avatar, as a window event.
        dispatchEvent(new CustomEvent('late-line:booth', { detail: { to, kind, text } }));
        const line = lines.current[to];
        if (!line) return void console.warn('[gilded-reel] no line for %s yet: %s dropped', to, kind);
        if (kind === 'directive') line.directive(text);
        else line.commentary(text);
      },
      dialGuest: () => void openSeat('guest', slotsRef.current[0]!),
      onStage: (next) => { setStage(next); director.current?.stage(next); },
    });
    if (first) addLog('booth', `First topic: ${first}`);
    if (describe && !early) {
      const id = await startInvention(describe);
      if (!id) return;
      purpose.current[id] = { slot: 0, opening: true };
      addLog('booth', `Inventing tonight's guest: ${describe}`);
    }
    const res = await fetch(`${API}/shows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) return setProblem(json.message || json.error || 'We could not book the studio.');
    showRef.current = json.showId;
    setOnShow(true);
    setShowId(json.showId);
  }

  async function startInvention(description: string): Promise<string | null> {
    const res = await fetch(`${API}/guests/invent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description }) }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) { setProblem(json.message || json.error || 'We could not start inventing the guest.'); return null; }
    setInventions((all) => ({ ...all, [json.id]: { id: json.id, steps: {}, ready: false, seconds: 0 } }));
    return json.id;
  }

  // Follow the guests being invented: written (the opening guest is named, their rundown is the
  // booth's), then built (seated in their slot, whose face starts at once).
  useEffect(() => {
    if (!onShow && !lobbyInvention) return;
    const id = setInterval(async () => {
      for (const [inv, what] of Object.entries(purpose.current)) {
        const known = inventionsRef.current[inv];
        if (known?.ready || known?.error) continue;
        const res = await fetch(`${API}/guests/invent/${inv}`).catch(() => null);
        if (!res?.ok) continue;
        const view = (await res.json()) as InventionView;
        setInventions((all) => ({ ...all, [inv]: view }));
        const written = view.guest && { ...view.guest, avatarId: '' };
        if (written && what.opening && !segment.current) {
          segment.current = written;
          setCurrent(written);
          setTopics(written.rundown);
          firstTopic.current = written.rundown[0] ?? '';
          live.current.used = new Set(firstTopic.current ? [firstTopic.current] : []);
          setUsed(new Set(live.current.used));
          addLog('booth', `Tonight's guest: ${written.name}, ${written.billing}. First topic: ${firstTopic.current}`);
        }
        if (view.ready && written) {
          addLog('booth', `${written.name} is ready (${view.seconds} s); their camera is starting`);
          if (onShowRef.current) setSlots((all) => all.map((g, i) => (i === what.slot ? written : g)));
        }
        if (view.error) {
          addLog('booth', `Could not invent the guest: ${view.error}`);
          if (what.opening) offAir(`We could not invent tonight's guest: ${view.error}`);
        }
      }
    }, 2000);
    return () => clearInterval(id);
  }, [onShow, lobbyInvention]);
  const inventInLobby = async (description: string) => {
    const id = await startInvention(description);
    if (!id) return;
    purpose.current = { [id]: { slot: 0, opening: true } };
    segment.current = null;
    setLobbyInvention(id);
  };
  const onShowRef = useRef(onShow);
  onShowRef.current = onShow;
  const inventionsRef = useRef(inventions);
  inventionsRef.current = inventions;

  // A new guest mid-show: once their face is up, Jada thanks the guest on air and brings the next
  // one in; once she has said it (and her face has too), the TV switches, the old line and face
  // end, and the new guest's line opens, their welcome waiting as her next reply.
  const handingOver = useRef(false);
  function handOver(next: number) {
    const to = slotsRef.current[next];
    const from = segment.current;
    if (!to || !from || !booth.current) return;
    handingOver.current = true;
    addLog('booth', `Bring on ${to.name}`);
    const show = showRef.current;
    // Each step lands on the faces FACE_LAG_MS after it is said; the page acts once viewers have seen it.
    const later = (f: () => void | Promise<void>) => setTimeout(() => { if (showRef.current === show) void f(); }, FACE_LAG_MS - 1_500);
    booth.current.handover({
      farewell: farewellCue(from),
      goodbye: guestFarewellCue,
      bridge: bridgeCue(from, to),
      // The guest has said goodbye: their line and face end, and the TV says who is next.
      retire: () => later(async () => {
        const old = onTvRef.current;
        goneGuests.current.push(`${from.name}, ${from.billing}`);
        setGone((g) => [...g, from.id]);
        setTvCard(`Up next: ${to.name}`);
        await lines.current.guest?.end();
        lines.current.guest = undefined;
        await faces.current[old === 0 ? 'g0' : 'g1'].end();
      }),
      // Jada has introduced them: the new guest is put through, and says hello first.
      bringOn: () => later(async () => {
        const old = onTvRef.current;
        onTvRef.current = next;
        setOnTv(next);
        setTvCard(null);
        segment.current = to;
        setCurrent(to);
        setTopics(to.rundown);
        firstTopic.current = to.rundown[0] ?? '';
        live.current.used = new Set(firstTopic.current ? [firstTopic.current] : []);
        setUsed(new Set(live.current.used));
        setSuggestWrap(false);
        setSlots((all) => all.map((g, i) => (i === old ? null : g)));
        const line = await openSeat('guest', to);
        if (line && firstTopic.current) booth.current?.cue(welcomeCue(to, firstTopic.current));
        handingOver.current = false;
      }),
    });
  }
  const posterByName = (name?: string) => {
    const cast = GUESTS.find((g) => g.name === name);
    if (cast) return PORTRAITS[cast.id];
    return Object.values(inventions).find((v) => v.guest?.name === name)?.portrait ?? BLANK;
  };
  /** Where a guest of the show is: on air, waiting with their camera, or gone. */
  const statusOf = (id: string): string | null => {
    if (gone.includes(id)) return 'Gone';
    const slot = slots.findIndex((g) => g?.id === id);
    if (slot < 0) return null;
    if (patched && slot === onTv && segment.current?.id === id) return 'On air';
    const phase = slotFaces[slot].phase;
    return phase === 'live' ? 'Camera ready' : phase === 'failed' ? 'Camera failed' : 'Camera starting';
  };
  const pendingInvite = Object.entries(purpose.current).some(([id, w]) => !w.opening && !inventions[id]?.error && !(slots[w.slot] && slots[w.slot]!.id === id && onTv === w.slot));
  const inviteGuest = async (description: string) => {
    if (!patched || pendingInvite) return;
    const id = await startInvention(description);
    if (!id) return;
    purpose.current[id] = { slot: 1 - onTvRef.current, opening: false };
    addLog('booth', `Inventing the next guest: ${description}`);
  };
  // Auto-booking's choice: invented as the producer's would be, brought on at a natural moment.
  async function bookGuest(description: string, reason: string) {
    if (!patched) return;
    const id = await startInvention(description);
    if (!id) return;
    purpose.current[id] = { slot: 1 - onTvRef.current, opening: false, auto: true };
    addLog('booth', `Booking the next guest: ${description} (${reason})`);
  }
  /** Every guest of the show: the one on air, those gone, and those being made. */
  function showGuests(): string[] {
    const names = new Set<string>();
    if (segment.current) names.add(`${segment.current.name}, ${segment.current.billing}`);
    for (const id of Object.keys(purpose.current)) {
      const g = inventionsRef.current[id]?.guest;
      names.add(g ? `${g.name}, ${g.billing}` : (inventionsRef.current[id] ? 'a guest being invented' : id));
    }
    for (const line of goneGuests.current) names.add(line);
    return [...names];
  }
  const goneGuests = useRef<string[]>([]);

  // Shortly before the trailer ends, her line after it is cued (see INVITE_LEAD_MS); at its end it goes.
  const trailerEnding = () => { hush.current = false; booth.current?.trailerDone(); };
  const trailerDone = () => {
    trailerEnding();
    setTrailerLeaving(true);
    const show = showRef.current;
    setTimeout(() => { if (showRef.current === show) { setTrailer(false); setTrailerLeaving(false); } }, TRAILER_FADE_MS);
  };
  // Commentating: a cued remark at some of the trailer's shots (commentary, which she speaks at once).
  // A topic for Jada: the producer's, or auto-advance's (with the judge's reason).
  const sendTopic = (topic: string, reason?: string) => {
    if (!booth.current || !segment.current) return;
    booth.current.cue(topicCue(segment.current, topic));
    live.current.used.add(topic);
    setUsed((u) => new Set(u).add(topic));
    advancer.current?.topic(topic);
    addLog('booth', reason === undefined ? `Topic for Jada: ${topic}` : `Moving on: ${topic} (${reason})`);
  };
  // The booth's one command box: read for what the producer means (an invitation, a topic, or a
  // note for Jada's next turn) and done; the reply under the box says which.
  const [commandReply, setCommandReply] = useState('');
  const sendCommand = async (text: string) => {
    setCommandReply('Reading…');
    const res = await fetch(`${API}/show/${showRef.current}/intent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }).catch(() => null);
    const intent = res?.ok ? await res.json().catch(() => null) : null;
    if (intent?.kind === 'invite' && intent.description) {
      if (!patched) return setCommandReply(`A new guest can come once ${firstName(guest.name)} is on.`);
      if (pendingInvite) return setCommandReply('A guest is already being made: try again once they are on.');
      const id = await startInvention(intent.description);
      if (!id) return setCommandReply('Could not start inventing them.');
      purpose.current[id] = { slot: 1 - onTvRef.current, opening: false };
      addLog('booth', `Inviting the next guest: ${intent.description}`);
      return setCommandReply(`Inviting: ${intent.description}`);
    }
    if (intent?.kind === 'topic' && intent.topic) {
      sendTopic(intent.topic);
      return setCommandReply(`Sent as the next topic: ${intent.topic}`);
    }
    booth.current?.cue(noteCue(text));
    addLog('booth', `Note for Jada: ${text}`);
    setCommandReply('Sent to Jada as a note for her next turn.');
  };
  const wrap = () => { booth.current?.wrap(); live.current.wrapped = true; setSuggestWrap(false); addLog('booth', 'Wrap it up'); };
  const chooseShot = (mode: ShotMode) => { setShotMode(mode); director.current?.mode(mode); };
  const endShow = () => { offAir(''); setStage('over'); };
  const backToLobby = () => { booth.current = null; setOnShow(false); setShowId(null); setLobbyInvention(null); purpose.current = {}; setInventions({}); };

  const done = (p: AvatarOnly['phase']) => p === 'ended' || p === 'failed' || p === 'idle';
  const allDone = done(hostFace.phase) && slotFaces.every((f) => done(f.phase));

  return (
    <div className={`nc-app gr ${onShow ? 'is-show' : ''}`}>
      <header className="nc-bar">
        <BackToApps avatar={hostFace} name="Jada and the guest" className="nc-back" />
        <Logo />
        {onShow && (
          <span className={`nc-air ${stage === 'on-air' || stage === 'closing' ? 'is-on' : ''}`}>
            <span className="nc-air-dot" />{stage === 'on-air' || stage === 'closing' ? 'On air' : STAGE_TEXT[stage]}
          </span>
        )}
        {onShow && hostFace.secondsLeft !== null && <span className="nc-clock">{clock(hostFace.secondsLeft)}</span>}
        {onShow && (
          <div className="gr-view" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'full'} onClick={() => setView('full')}>Full window</button>
            <button type="button" aria-pressed={view === 'director'} onClick={() => setView('director')}>Director</button>
          </div>
        )}
        {onShow && <button type="button" className="nc-btn gr-fullscreen" onClick={toggleFullScreen} aria-label="Full screen">⛶</button>}
      </header>

      {!onShow ? (
        <Lobby guestId={guestId} setGuestId={setGuestId} inventText={inventText} setInventText={setInventText} topics={topics} setTopics={setTopics} onGo={goOnAir} problem={problem}
          invention={lobbyInvention ? inventions[lobbyInvention] : undefined} onInvent={inventInLobby} />
      ) : (
        <main className={`nc-show ${view === 'full' ? 'is-full' : ''}`}>
          <Program host={hostFace} tvFaces={slotFaces} onTv={onTv} tvCard={tvCard} caption={trailerUp || backstage || !captionsOn ? null : caption} captionsOn={captionsOn} onCaptions={() => setCaptionsOn((c) => !c)} posters={slots.map((g) => posterOf(g, inventions))} guestInfo={guest} patched={patched} stage={stage}
            backstage={backstage} shot={shot} trailer={trailer} trailerLeaving={trailerLeaving} onTrailerEnding={trailerEnding} onTrailerDone={trailerDone} />
          <section className="nc-booth" aria-label="The booth" hidden={view === 'full'}>
            <div className="nc-booth-head">
              <h2>The booth</h2>
              <span className="nc-stage-text">{STAGE_TEXT[stage]}</span>
            </div>
            {problem && <p className="nc-problem" role="alert">{problem}</p>}
            {stage === 'over' && allDone ? (
              <div className="nc-after">
                <p>That's the show.</p>
                <button type="button" className="nc-btn nc-primary" onClick={backToLobby}>Book another night</button>
              </div>
            ) : (
              <Console topics={topics} used={used} disabled={stage !== 'on-air'} onTopic={(t) => sendTopic(t)} onCommand={sendCommand} commandReply={commandReply}
                onWrap={wrap} onEnd={endShow}
                autoAdvance={autoAdvance} onAutoAdvance={setAutoAdvance} autoBook={autoBook} onAutoBook={setAutoBook} suggestWrap={suggestWrap}
                cast={castOnShow ? [{ guest: castOnShow, poster: PORTRAITS[castOnShow.id], status: statusOf(castOnShow.id) ?? 'Waiting' }] : []}
                statusOf={statusOf} inventions={Object.values(inventions)} />
            )}
          </section>
          <section className="nc-transcript" aria-label="On air" hidden={view === 'full'}>
            <h2>Transcript</h2>
            <Transcript log={log} live={speaking} poster={(who, name) => (who === 'host' ? cam2 : posterByName(name))} />
          </section>
        </main>
      )}
    </div>
  );
}

function Logo() {
  return <span className="nc-logo gr-logo"><span className="gr-fan" aria-hidden="true" />The Gilded <b>Reel</b></span>;
}

function Face({ face, poster }: { face: AvatarOnly; poster: string }) {
  return (
    <div className="ll-face">
      <img className="ll-poster" src={poster} alt="" aria-hidden="true" />
      <video ref={face.videoRef} playsInline muted autoPlay />
      <audio ref={face.audioRef} autoPlay />
    </div>
  );
}

// The program picture: one studio. The set (studio/wall.jpg) was outpainted from
// Jada's own camera still: her desk runs on to the right, under a TV on the
// wall. Her whole render lies exactly over her still, never cropped (her desk
// leaves through the bottom of the frame; the edges inside the frame fade, so
// the renderer's drift has no hard line to slip against); the guest plays on
// the TV. The director's shots are camera
// moves on that set: wide, pushed in on Jada, pushed in on the TV.
function Program({ host, tvFaces, onTv, tvCard, caption, captionsOn, onCaptions, posters, guestInfo, patched, stage, backstage, shot, trailer, trailerLeaving, onTrailerEnding, onTrailerDone }: {
  host: AvatarOnly; tvFaces: AvatarOnly[]; onTv: number; tvCard: string | null; caption: { who: Role; name: string; text: string } | null; captionsOn: boolean; onCaptions: () => void; posters: string[]; guestInfo: Guest; patched: boolean; stage: Stage;
  backstage: boolean; shot: Shot; trailer: boolean; trailerLeaving: boolean; onTrailerEnding: () => void; onTrailerDone: () => void;
}) {
  const live = stage === 'on-air' || stage === 'closing';
  const g = firstName(guestInfo.name);
  // Backstage waits on the faces that are starting: Jada's, and a cast guest's (an invented
  // guest's face starts later, once it is built, while the show is on).
  const faces = [host, ...tvFaces.filter((f) => f.phase !== 'idle')];
  const failed = faces.find((f) => f.phase === 'failed');
  const backstageText = failed ? failed.detail : faces.some((f) => f.phase === 'warming') ? 'Lighting the stage…' : 'Getting the studio ready…';
  // Which cameras are up, so a long wait says what it is waiting for.
  const cameras: [string, AvatarOnly][] = [['Jada', host], ...(tvFaces[0].phase !== 'idle' ? [[g, tvFaces[0]] as [string, AvatarOnly]] : [])];
  // Until the guest is on, the camera stays wide on Jada and the key art on the TV.
  const camera = !patched ? 'wide' : shot === 'host-side' ? 'host' : shot === 'guest' ? 'tv' : 'wide';
  const third = camera === 'tv' ? { name: guestInfo.name, billing: guestInfo.billing } : camera === 'host' || !patched ? HOST : null;
  return (
    <section className={`gr-program is-${camera} ${trailer && !trailerLeaving ? 'is-trailer' : ''}`} aria-label="The show, as it goes out">
      <div className="gr-set">
        <img className="gr-wall" src={wall} alt="" />
        <div className="gr-tv">
          {/* Both guest slots stay in the TV (a video off screen is not sent): the one on air shows. */}
          <div className={`gr-tv-feed ${patched ? 'is-on' : ''}`}>
            {tvFaces.map((f, i) => <div key={i} className={`gr-tv-slot ${i === onTv ? '' : 'is-off'}`}><Face face={f} poster={posters[i]} /></div>)}
          </div>
          {(!patched || tvCard) && (
            <div className="gr-tv-card" aria-hidden="true">
              <img src={STILLS[5]} alt="" />
              <span className="gr-kicker">Tonight</span>
              <strong>{FILM.title}</strong>
              <span>{tvCard ?? (stage === 'dialing' ? `Calling ${g}…` : 'Behind the frame')}</span>
            </div>
          )}
          {patched && <span className="tv-live"><span className="nc-rec" />Live · via video call</span>}
          <span className="gr-tv-glass" aria-hidden="true" />
        </div>
        {/* Both of Jada's renders stay in frame (a video off screen is not sent); the other one is hidden. */}
        {/* Her render also makes the corner window over the trailer: the same element, restyled, so its video never restarts. */}
        <div className="gr-host" data-label={HOST.name}><Face face={host} poster={cam2} /></div>
        {/* The front of the desk, in front of her: when the renderer zooms in, her arms go
            behind a desk that stays put, and the desk runs on unbroken. */}
        <img className="gr-desk" src={desk} alt="" />
      </div>
      <button type="button" className={`gr-cc ${captionsOn ? 'is-on' : ''}`} onClick={onCaptions} aria-pressed={captionsOn} aria-label="Subtitles">CC</button>
      {caption && (
        <div className={`gr-caption is-${caption.who}`} aria-live="off">
          <span className="gr-caption-name">{firstName(caption.name)}</span>
          <span className="gr-caption-text">{captionTail(clean(caption.text))}</span>
        </div>
      )}
      {third && !caption && <div className="gr-third"><strong>{third.name}</strong><span>{third.billing}</span></div>}
      <div className="nc-bug gr-bug"><span className="gr-fan" aria-hidden="true" />The Gilded <b>Reel</b></div>
      <div className={`nc-tally ${live ? 'is-on' : ''}`}>{live ? 'Live' : 'Standby'}</div>
      {trailer && <Trailer leaving={trailerLeaving} onEnding={onTrailerEnding} onDone={onTrailerDone} />}
      {backstage && (
        <div className="gr-backstage" role="status">
          {!failed && <span className="gr-spin" aria-hidden="true" />}
          <strong>{backstageText}</strong>
          {!failed && <span>The show starts as soon as Jada and {g} are in place.</span>}
          {!failed && (
            <ul className="gr-ready" aria-label="Cameras">
              {cameras.map(([name, f]) => (
                <li key={name} className={f.phase === 'live' ? 'is-up' : ''}>{name}: {f.phase === 'live' ? 'ready' : f.phase === 'warming' ? 'waiting for a worker' : 'starting (a minute or two when the render pool is spinning up)'}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {faces.some((f) => f.audioBlocked) && (
        <button type="button" className="nc-hear" onClick={() => faces.forEach((f) => f.resumeAudio())}>Tap to hear the show</button>
      )}
      <div className="nc-ticker gr-ticker" aria-hidden="true">
        <span>Tonight on {SHOW}: {FILM.title} · {guestInfo.name}, {guestInfo.billing}</span>
      </div>
    </section>
  );
}

// The trailer, full frame: each still held and slowly pushed in on, cut with a
// dissolve, its card over it, between letterbox bars.
function Trailer({ leaving, onEnding, onDone }: { leaving: boolean; onEnding: () => void; onDone: () => void }) {
  const [shot, setShot] = useState(0);
  const shots = FILM.trailer;
  const score = useRef<ReturnType<typeof startScore>>(null);
  useEffect(() => {
    const id = setTimeout(onEnding, Math.max(0, shots.length * SHOT_MS - INVITE_LEAD_MS));
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    score.current = startScore((shots.length * SHOT_MS) / 1000);
    return () => score.current?.end();
  }, []);
  useEffect(() => {
    const s = shots[shot];
    if (s?.card) score.current?.hit(s.title === true);
    if (shot === shots.length - 1) setTimeout(() => score.current?.end(), SHOT_MS - 1_300);
  }, [shot]);
  useEffect(() => {
    if (shot >= shots.length) { onDone(); return; }
    const id = setTimeout(() => setShot((s) => s + 1), SHOT_MS);
    return () => clearTimeout(id);
  }, [shot]);
  return (
    <div className={`gr-trailer ${leaving ? 'is-leaving' : ''}`} role="img" aria-label={`The ${FILM.title} trailer`}>
      {shots.map((s, i) => (
        <div key={s.still} className={`gr-shot ${i === shot ? 'is-on' : ''} ${i < shot ? 'is-past' : ''}`}>
          <img src={STILLS[s.still]} alt="" />
          {s.card && <span className={`gr-card ${s.title ? 'is-title' : ''}`}>{s.card}</span>}
        </div>
      ))}
      <span className="gr-rating">Coming this winter</span>
    </div>
  );
}

const INVENT = 'invent';
function Lobby({ guestId, setGuestId, inventText, setInventText, topics, setTopics, onGo, problem, invention, onInvent }: {
  guestId: string; setGuestId: (id: string) => void; inventText: string; setInventText: (t: string) => void;
  topics: string[]; setTopics: (t: string[]) => void; onGo: (first: string, describe?: string) => void; problem: string;
  invention?: InventionView; onInvent: (description: string) => void;
}) {
  const inventing = guestId === INVENT;
  const [text, setText] = useState(topics.join('\n'));
  useEffect(() => { setText(topics.join('\n')); }, [topics]);
  const list = text.split('\n').map((t) => t.trim()).filter(Boolean);
  return (
    <main className="nc-lobby">
      <div className="nc-lobby-intro">
        <h1>Tonight on The Gilded Reel</h1>
        <p>Jada introduces {FILM.title}, rolls the trailer, then brings its designer onto the studio screen, live on Atmee's speech-to-speech. You run the booth: you never speak, you choose the topics, and Jada opens each one.</p>
      </div>
      <figure className="gr-poster">
        <img src={still5} alt="" />
        <figcaption><strong>{FILM.title}</strong><span>An invented desert epic, made for this show</span></figcaption>
      </figure>
      <fieldset className="nc-guests">
        <legend>Tonight's guest</legend>
        {GUESTS.map((g) => (
          <label key={g.id} className={`nc-guest ${g.id === guestId ? 'is-picked' : ''}`}>
            <input type="radio" name="guest" value={g.id} checked={g.id === guestId} onChange={() => setGuestId(g.id)} />
            <img src={PORTRAITS[g.id]} alt="" />
            <span><strong>{g.name}</strong><small>{g.billing}</small></span>
          </label>
        ))}
        <label className={`nc-guest gr-invent ${inventing ? 'is-picked' : ''}`}>
          <input type="radio" name="guest" value={INVENT} checked={inventing} onChange={() => setGuestId(INVENT)} />
          <span className="gr-invent-mark" aria-hidden="true">✦</span>
          <span><strong>Invent a guest</strong><small>Describe them; they are made while Jada opens the show</small></span>
        </label>
      </fieldset>
      {inventing && (
        <label className="nc-topics">
          <span>Who is tonight's guest? One of {FILM.title}'s makers: a sentence is enough. Their name, look, voice and topics are invented for you.</span>
          <textarea rows={3} value={inventText} onChange={(e) => setInventText(e.target.value)} disabled={Boolean(invention)} placeholder="e.g. the gruff Icelandic cinematographer who shot the sandstorms" />
        </label>
      )}
      {inventing && (invention
        ? <div className="gr-lobby-progress"><GuestProgress view={invention} /><p className="nc-fine">{invention.ready ? 'Ready: go on air, and Jada brings them on straight after the trailer.' : 'You can go on air now: Jada holds for them after the trailer if they are not ready yet.'}</p></div>
        : <button type="button" className="nc-btn" disabled={inventText.trim().length < 3} onClick={() => onInvent(inventText.trim())}>Invent them now</button>)}
      {!inventing && <label className="nc-topics">
        <span>The rundown: one topic per line. Jada opens with the first once the designer is on; send the rest from the booth.</span>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => setTopics(list)} />
      </label>}
      {problem && <p className="nc-problem" role="alert">{problem}</p>}
      <button type="button" className="nc-btn nc-primary nc-go" disabled={inventing ? inventText.trim().length < 3 : !list.length}
        onClick={() => { if (inventing) onGo('', inventText.trim()); else { setTopics(list); onGo(list[0]); } }}>
        Go on air
      </button>
      <p className="nc-fine">Two speech sessions and two cameras run at once (three for a moment when a new guest comes on), up to 15 minutes.</p>
    </main>
  );
}

function Console({ topics, used, disabled, onTopic, onCommand, commandReply, onWrap, onEnd, autoAdvance, onAutoAdvance, autoBook, onAutoBook, suggestWrap, cast, statusOf, inventions }: {
  topics: string[]; used: Set<string>; disabled: boolean;
  onTopic: (t: string) => void; onCommand: (text: string) => void; commandReply: string; onWrap: () => void; onEnd: () => void;
  autoAdvance: boolean; onAutoAdvance: (on: boolean) => void; autoBook: boolean; onAutoBook: (on: boolean) => void; suggestWrap: boolean;
  cast: { guest: Guest; poster: string; status: string }[]; statusOf: (id: string) => string | null; inventions: InventionView[];
}) {
  const [command, setCommand] = useState('');
  const order = [...used];
  const current = order.at(-1);
  const all = [...topics, ...order.filter((t) => !topics.includes(t))];
  const autopilot = autoAdvance && autoBook;
  return (
    <div className="nc-console gr-console">
      <div className="gr-pilot">
        <label className="gr-switch">
          <input type="checkbox" checked={autopilot} onChange={(e) => { onAutoAdvance(e.target.checked); onAutoBook(e.target.checked); }} />
          <span className="gr-switch-track" aria-hidden="true" />
          <span><strong>Autopilot</strong><small>{autopilot ? 'Topics and guests move on their own' : autoAdvance || autoBook ? 'Partly on' : 'Everything waits for you'}</small></span>
        </label>
        <details className="gr-settings">
          <summary aria-label="Autopilot settings">Settings</summary>
          <label className="gr-auto"><input type="checkbox" checked={autoAdvance} onChange={(e) => onAutoAdvance(e.target.checked)} /><span>Next topic when this one has run its course</span></label>
          <label className="gr-auto"><input type="checkbox" checked={autoBook} onChange={(e) => onAutoBook(e.target.checked)} /><span>Book the next guest when the conversation calls for one</span></label>
        </details>
      </div>

      <section className="gr-section">
        <h3>Guests</h3>
        {cast.map((c) => (
          <div key={c.guest.id} className={`gr-progress ${c.status === 'On air' ? 'is-on-air' : c.status === 'Gone' ? 'is-gone' : ''}`}>
            <img src={c.poster} alt="" />
            <div><strong>{c.guest.name}</strong><small>{c.guest.billing}</small><span className="gr-status">{c.status}</span></div>
          </div>
        ))}
        {inventions.map((v) => <GuestProgress key={v.id} view={v} status={statusOf(v.id)} />)}
      </section>

      <section className="gr-section">
        <h3>Rundown</h3>
        <ol className="gr-rundown">
          {all.map((t) => {
            const state = t === current ? 'is-current' : used.has(t) ? 'is-done' : 'is-next';
            return (
              <li key={t} className={state}>
                <button type="button" disabled={disabled || state !== 'is-next'} onClick={() => onTopic(t)} title={state === 'is-next' ? 'Move to this topic' : undefined}>{t}</button>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="gr-section">
        <h3>Tell the booth</h3>
        <form className="gr-command" onSubmit={(e) => { e.preventDefault(); const t = command.trim(); if (t) { onCommand(t); setCommand(''); } }}>
          <input className="nc-input" value={command} onChange={(e) => setCommand(e.target.value)} disabled={disabled} aria-label="Tell the booth"
            placeholder="Invite the director · talk about the glass palace · ask about the hardest costume" />
          <button type="submit" className="nc-btn" disabled={disabled || !command.trim()}>Send</button>
        </form>
        {commandReply && <p className="nc-hint">{commandReply}</p>}
      </section>

      <div className="nc-actions gr-actions">
        <button type="button" className={`nc-btn ${suggestWrap ? 'is-suggested' : ''}`} disabled={disabled} onClick={onWrap}>Wrap it up</button>
        <button type="button" className="nc-btn nc-danger" onClick={onEnd}>End the show</button>
      </div>
    </div>
  );
}

// A guest being invented, as the booth follows it: one status, the step it is at (written, drawn
// and voiced, built), then where the guest is once built (camera, on air, gone).
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
function buildStatus(view: InventionView): string {
  if (view.error) return `Failed: ${view.error}`;
  if (view.ready) return 'Ready';
  const st = (k: keyof InventionView['steps']) => view.steps[k]?.status;
  const doing = st('avatar') === 'running' ? 'Building avatar' : st('portrait') === 'running' || st('voice') === 'running' ? 'Portrait & voice' : 'Writing the character';
  return `${doing} · ${mmss(view.seconds)}`;
}
function GuestProgress({ view, status }: { view: InventionView; status?: string | null }) {
  const g = view.guest;
  const shown = status ?? buildStatus(view);
  return (
    <div className={`gr-progress ${status === 'On air' ? 'is-on-air' : status === 'Gone' ? 'is-gone' : view.error ? 'is-failed' : view.ready ? 'is-ready' : 'is-building'}`}>
      {view.portrait ? <img src={view.portrait} alt="" /> : <span className="gr-progress-blank" aria-hidden="true">✦</span>}
      <div>
        <strong>{g ? g.name : 'Inventing a guest…'}</strong>
        {g && <small>{g.billing}</small>}
        <span className="gr-status">{shown}</span>
      </div>
    </div>
  );
}

function Transcript({ log, live, poster }: { log: LogLine[]; live: Partial<Record<Role, { name?: string; text: string }>>; poster: (who: Role, name?: string) => string }) {
  const list = useRef<HTMLOListElement>(null);
  const liveText = (live.host?.text ?? '') + (live.guest?.text ?? '');
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [log.length, liveText.length]);
  const speaker = (who: Role, name: string | undefined, text: string, key: string, isLive = false) => (
    <li key={key} className={`gr-turn is-${who} ${isLive ? 'is-live' : ''}`}>
      <img src={poster(who, name)} alt="" />
      <div>
        <span className="gr-turn-name">{who === 'host' ? 'Jada' : firstName(name ?? 'Guest')}</span>
        <p>{clean(text)}{isLive && <span className="gr-caret" aria-hidden="true" />}</p>
      </div>
    </li>
  );
  // One entry per turn: a speaker's consecutive lines (a voice's stretches end on every pause)
  // merge, and the line being said joins its speaker's entry when it continues it.
  type Entry = { key: string; who: Role | 'booth'; name?: string; text: string; live?: boolean };
  const entries: Entry[] = [];
  for (const line of log) {
    const last = entries.at(-1);
    if (line.who !== 'booth' && last && last.who === line.who && last.name === line.name) last.text += ` ${line.text}`;
    else entries.push({ key: String(line.id), who: line.who, name: line.name, text: line.text });
  }
  for (const role of ['host', 'guest'] as Role[]) {
    const text = live[role]?.text.trim();
    if (!text) continue;
    const last = entries.at(-1);
    if (last && last.who === role && last.name === live[role]!.name) { last.text += ` ${text}`; last.live = true; }
    else entries.push({ key: `live-${role}`, who: role, name: live[role]!.name, text, live: true });
  }
  return (
    <ol className="nc-lines gr-lines" ref={list} aria-live="polite">
      {entries.length === 0 && <li className="nc-empty">The show starts when Jada does.</li>}
      {entries.map((e) => (e.who === 'booth'
        ? <li key={e.key} className="gr-note">{e.text}</li>
        : speaker(e.who, e.name, e.text, e.key, e.live)))}
    </ol>
  );
}
/**
 * The speech model's fillers, out of what is read: "hmm", "uh", "ummm", "erm", "mm", and an
 * "I mean" or "you know" left trailing after them.
 */
const FILLER = /(^|[\s,.!?…—-])(?:u+h+m*|u+m+|h+m+|m+h*m+|e+r+m+|e+h+|a+h+|o+h{2,})(?=$|[\s,.!?…—-])[,.]?/gi;
export function clean(text: string): string {
  let t = text.replace(FILLER, '$1');
  t = t.replace(/(?:[\s,]+(?:i mean|you know|well|so|ok|okay|right|but|yeah|oh|ah|ha|haha))+[\s,.…!]*$/i, (m) => (/[.!?]\s*$/.test(t.slice(0, t.length - m.length)) ? '' : m));
  return t.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}
/** A caption's last words: about two lines' worth, from a word boundary. */
function captionTail(text: string, max = 150) {
  if (text.length <= max) return text;
  const cut = text.slice(-max);
  return '…' + cut.slice(cut.indexOf(' ') + 1);
}
