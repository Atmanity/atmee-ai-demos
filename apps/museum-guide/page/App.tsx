// The Meridian: a museum tour on the visitor's phone. The rear camera fills
// the screen; Edmund Hale, the chairman, stands in it, keyed out of his green
// screen; the visitor talks to him out loud. The page knows which work they
// are at (a label's QR code, or a camera frame the server matched against the
// catalogue) and hands Edmund that work's catalogue record, so everything he
// says about it comes from the museum. He also sees the camera as he answers,
// which is for pointing at details.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackToApps, callCopy, ChatPanel, MicIcon, MicOffIcon, useAvatar, useToolNet, type ToolCall } from '../../../src/kit/index.ts';
import { exhibitById, findExhibit, type Exhibit } from '../engine/catalogue.ts';
import { arrived, isToolName, said, tourState, type Found } from '../engine/director.ts';
import { grabFrame, useCamera, useLabelScanner } from './camera.ts';
import { exhibitImage } from './images.ts';
import { Keyed } from './Keyed.tsx';
import { Lobby, Wordmark } from './Lobby.tsx';
import { Sheet } from './Sheet.tsx';
import { Visit } from './Visit.tsx';
import './meridian.css';

const API = '/api/apps/museum-guide';
export const HOST = 'Edmund';

/** The same work again within this long is the visitor still standing at it, not arriving. */
const STILL_HERE_MS = 90_000;

type Identified = { kind: 'found'; id: string; seen: string } | { kind: 'not_in_catalogue' | 'unclear'; seen: string };

/** Asks the server which work a frame shows. */
async function identify(image: string, question?: string): Promise<Identified | 'failed'> {
  try {
    const res = await fetch(`${API}/identify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, question }) });
    return res.ok ? ((await res.json()) as Identified) : 'failed';
  } catch {
    return 'failed';
  }
}

/** "What's this?", "who painted that", "what am I looking at": the visitor asking about what is in front of them. */
const ASKS_WHAT = /\b(what('s| is) (this|that|it)\b|what am i looking at|who (painted|made|did) (this|that|it)\b|tell me about (this|that|it)\b)/i;

const params = new URLSearchParams(location.search);

/** The end of a long caption, cut at a word: what he is saying now is what the visitor needs to read. */
export function captionTail(text: string, max = 180): string {
  if (text.length <= max) return text;
  const tail = text.slice(-max);
  return `…${tail.slice(tail.indexOf(' ') + 1)}`;
}

export function App() {
  if (params.has('sheet')) return <Sheet />;
  return <Tour opening={exhibitById(params.get('exhibit'))} />;
}

function Tour({ opening }: { opening: Exhibit | null }) {
  const camera = useCamera();
  const [screen, setScreen] = useState<'lobby' | 'tour' | 'visit'>('lobby');
  const [current, setCurrent] = useState<Exhibit | null>(opening);
  // The card on screen: where the visitor is, or a work Edmund pointed them to.
  const [card, setCard] = useState<{ exhibit: Exhibit; here: boolean } | null>(opening ? { exhibit: opening, here: true } : null);
  const [seen, setSeen] = useState<Exhibit[]>([]);
  const [looking, setLooking] = useState(false);
  const [notice, setNotice] = useState('');
  const [small, setSmall] = useState(false);
  const [talk, setTalk] = useState(false);
  const at = useRef({ current, seen, camera: camera.state === 'on' });
  at.current = { current, seen, camera: camera.state === 'on' };
  const lastArrival = useRef<{ id: string; at: number } | null>(null);
  // Which call the page is serving; work started for one call is dropped if it answers after it.
  const callGen = useRef(0);
  const avatarRef = useRef<ReturnType<typeof useAvatar> | null>(null);

  const flash = useCallback((text: string) => {
    setNotice(text);
    setTimeout(() => setNotice((n) => (n === text ? '' : n)), 3500);
  }, []);

  /** The visitor is at a work now: the screen, Edmund's state, and (unless he asked) an event for him to talk about it. */
  const arrive = useCallback((exhibit: Exhibit, how: Found | 'tool') => {
    const last = lastArrival.current;
    const again = Boolean(last && last.id === exhibit.id && Date.now() - last.at < STILL_HERE_MS);
    lastArrival.current = { id: exhibit.id, at: Date.now() };
    const nextSeen = at.current.seen.some((e) => e.id === exhibit.id) ? at.current.seen : [...at.current.seen, exhibit];
    at.current = { ...at.current, current: exhibit, seen: nextSeen };
    setCurrent(exhibit);
    setSeen(nextSeen);
    setCard({ exhibit, here: true });
    const avatar = avatarRef.current;
    if (!avatar) return;
    avatar.state(tourState(at.current));
    if (how !== 'tool') avatar.event(arrived(exhibit, how, again), 30);
  }, []);

  // A label's code in view: the same label held there is not a new arrival.
  useLabelScanner(camera.videoRef, screen === 'tour', useCallback((exhibit: Exhibit) => {
    const last = lastArrival.current;
    if (last?.id === exhibit.id && Date.now() - last.at < STILL_HERE_MS) return;
    flash(`Label: ${exhibit.title}`);
    arrive(exhibit, 'label');
  }, [arrive, flash]));

  /** Looks through the camera now; the text is what Edmund is told. */
  const lookNow = useCallback(async (question?: string): Promise<{ text: string; found: Exhibit | null }> => {
    const frame = grabFrame(camera.videoRef.current);
    if (!frame) return { text: said.noCamera, found: null };
    const gen = callGen.current;
    setLooking(true);
    try {
      const answer = await identify(frame, question);
      if (gen !== callGen.current) throw new Error('the call this was for has ended');
      if (answer === 'failed') return { text: said.failed, found: null };
      const found = answer.kind === 'found' ? exhibitById(answer.id) : null;
      if (found) return { text: said.identified(found), found };
      return { text: answer.kind === 'unclear' ? said.unclear(answer.seen) : said.notInCatalogue(answer.seen), found: null };
    } finally {
      if (gen === callGen.current) setLooking(false);
    }
  }, [camera.videoRef]);

  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall) => {
    if (!isToolName(name)) throw new Error(`there is no tool called ${name}`);
    if (name === 'identify_exhibit') {
      const question = typeof args?.question === 'string' ? args.question : undefined;
      const { text, found } = await lookNow(question);
      if (found) arrive(found, 'tool');
      else flash('Not one of the Meridian\'s works');
      return text;
    }
    const title = String(args?.title ?? args?.name ?? args?.work ?? '').trim();
    const exhibit = findExhibit(title);
    if (!exhibit) return said.notFound(title);
    setCard({ exhibit, here: exhibit.id === at.current.current?.id });
    return said.shown(exhibit);
  }, [arrive, flash, lookNow]);

  // If Edmund answers "what is this?" without looking, the page looks and tells him.
  const net = useToolNet({
    match: (text) => (ASKS_WHAT.test(text) ? { id: `net-${Date.now()}`, name: 'identify_exhibit', arguments: { question: text } } : null),
    run: async (call) => String(await onToolCall(call)),
    avatar: () => avatarRef.current!,
  });

  const avatar = useAvatar('museum-guide', {
    onToolCall: net.watch(onToolCall),
    onUserSaid: (text) => net.heard(text),
    onLive: () => avatarRef.current?.event(said.opening(at.current.current), 60),
    onEnded: () => { callGen.current++; setLooking(false); setScreen((s) => (s === 'tour' ? 'visit' : s)); },
  });
  avatarRef.current = avatar;

  // Edmund's picture of the tour, kept current (the same text twice is sent once).
  useEffect(() => { avatar.state(tourState({ current, seen, camera: camera.state === 'on' })); }, [avatar, current, seen, camera.state]);

  const begin = async () => {
    const track = await camera.start();
    if (!track) return;
    setScreen('tour');
    setSeen([]);
    lastArrival.current = current ? { id: current.id, at: Date.now() } : null;
    if (current) setSeen([current]);
    callGen.current++;
    await avatar.start({ mic: true, camera: track });
  };

  /** The "What is this?" button: the page looks, then tells Edmund what it found. */
  const whatIsThis = async () => {
    if (looking || avatar.phase !== 'live') return;
    const { text, found } = await lookNow();
    if (found) { flash(found.title); arrive(found, 'camera'); return; }
    flash('Not one of the Meridian\'s works');
    avatar.event(`The visitor pressed "What is this?". ${text}`, 30);
  };

  const leave = () => { void avatar.end(); };
  const again = () => { setScreen('lobby'); setCard(current ? { exhibit: current, here: true } : null); };

  if (screen === 'lobby') return <Lobby opening={current} camera={camera.state} onBegin={() => void begin()} />;
  if (screen === 'visit') {
    return <Visit seen={seen} onAgain={() => { camera.stop(); again(); }} />;
  }

  const live = avatar.phase === 'live';
  const status = callCopy(avatar, HOST);
  const words = captionTail(avatar.caption);
  return (
    <div className={`mr-tour ${small ? 'is-small' : ''} ${avatar.speaking ? 'is-speaking' : ''}`}>
      <video ref={camera.videoRef} className="mr-camera" playsInline muted aria-label="Your camera" />
      <div className="mr-shade" aria-hidden="true" />

      <header className="mr-bar">
        <BackToApps avatar={avatar} name={HOST} className="mr-back" />
        <Wordmark />
        <span className="mr-bar-end">
          {avatar.secondsLeft !== null && live && <span className="mr-clock">{Math.floor(avatar.secondsLeft / 60)}:{String(avatar.secondsLeft % 60).padStart(2, '0')}</span>}
          <button type="button" className="mr-chip" onClick={() => setTalk((t) => !t)} aria-pressed={talk}>{talk ? 'Close' : 'Type'}</button>
          <button type="button" className="mr-chip is-end" onClick={leave} disabled={!live}>Leave</button>
        </span>
      </header>

      {card && (
        <section className={`mr-card ${card.here ? 'is-here' : 'is-elsewhere'}`} aria-live="polite">
          <img src={exhibitImage(card.exhibit)} alt="" />
          <div>
            <p className="mr-card-where">{card.here ? 'You are at' : card.exhibit.gallery}</p>
            <h2>{card.exhibit.title}</h2>
            <p>{card.exhibit.artist} · {card.exhibit.date}</p>
          </div>
          <button type="button" className="mr-x" onClick={() => setCard(null)} aria-label="Close the card">×</button>
        </section>
      )}

      {live && !card && !looking && <div className="mr-reticle" aria-hidden="true"><span>Point at a work, or its label's code</span></div>}
      {looking && <div className="mr-looking" role="status"><span className="mr-dot" />Looking…</div>}
      {notice && <div className="mr-notice" role="status">{notice}</div>}

      <Keyed videoRef={avatar.videoRef} audioRef={avatar.audioRef} label={`${HOST} Hale, your guide`} className={small ? 'is-small' : ''} />
      <button type="button" className="mr-size" onClick={() => setSmall((s) => !s)} aria-label={small ? `Bring ${HOST} back` : `Move ${HOST} aside`}>
        {small ? '⤢' : '⤡'}
      </button>

      {live && (words || avatar.heard) && (
        <div className="mr-words" aria-live="polite">
          {words && <p className="mr-said">{words}</p>}
          {avatar.heard && <p className="mr-heard">{avatar.heard}</p>}
        </div>
      )}

      {status && (
        <div className="mr-status" role="status">
          {status.busy && <span className="mr-spinner" aria-hidden="true" />}
          <strong>{status.title}</strong>
          {status.detail && <span>{status.detail}</span>}
          {!status.busy && <button type="button" className="mr-primary" onClick={() => void begin()}>Try again</button>}
        </div>
      )}
      {live && avatar.audioBlocked && <button type="button" className="mr-hear" onClick={avatar.resumeAudio}>Tap to hear {HOST}</button>}

      {live && (
        <footer className="mr-controls">
          <button type="button" className={`mr-round ${avatar.micOn ? '' : 'is-off'}`} onClick={() => avatar.setMic(!avatar.micOn)}
            aria-pressed={!avatar.micOn} title={avatar.micOn ? 'Mute your microphone' : 'Unmute your microphone'}>
            {avatar.micOn ? <MicIcon /> : <MicOffIcon />}
          </button>
          <button type="button" className="mr-shutter" onClick={() => void whatIsThis()} disabled={looking}>
            <span aria-hidden="true" />What is this?
          </button>
        </footer>
      )}

      {talk && (
        <div className="mr-talk">
          <ChatPanel avatar={avatar} name={HOST} placeholder={`Ask ${HOST}…`} empty={<span>Your conversation with {HOST} shows here. Type if the gallery is too loud to talk.</span>} />
        </div>
      )}
    </div>
  );
}
