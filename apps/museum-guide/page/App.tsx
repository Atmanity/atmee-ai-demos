// The Meridian: a museum tour on the visitor's phone. The rear camera fills
// the screen; Edmund Hale, the chairman, stands in it, keyed out of his green
// screen; the visitor talks to him out loud. The page knows which work they
// are at (a label's QR code, or a camera frame the server matched against the
// catalogue) and hands Edmund that work's catalogue record, so everything he
// says about it comes from the museum. He also sees the camera as he answers,
// which is for pointing at details.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackToApps, callCopy, ChatPanel, useAvatar, useToolNet, type ToolCall } from '../../../src/kit/index.ts';
import { EXHIBITS, exhibitById, findExhibit, type Exhibit } from '../engine/catalogue.ts';
import { arrived, isToolName, said, tourState, type Found } from '../engine/director.ts';
import { grabFrame, useCamera, useLabelScanner } from './camera.ts';
import { exhibitImage } from './images.ts';
import { Keyed } from './Keyed.tsx';
import { Lobby, Wordmark } from './Lobby.tsx';
import { MuseumMap } from './MuseumMap.tsx';
import { GuideIcon, KeyboardIcon, MapIcon, ScanIcon } from './icons.tsx';
import { PushToTalk } from './PushToTalk.tsx';
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
  const [map, setMap] = useState(false);
  const [mapAt, setMapAt] = useState<Exhibit | null>(null);
  // Edmund stands on the sheet's top edge, wherever that is as the sheet grows and shrinks.
  const tourRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const sheet = sheetRef.current;
    const tour = tourRef.current;
    if (!sheet || !tour) return;
    const fit = () => tour.style.setProperty('--sheet', `${sheet.offsetHeight}px`);
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(sheet);
    return () => watch.disconnect();
  }, [screen, talk]);
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
  useLabelScanner(camera.videoRef, screen === 'tour' && !map, useCallback((exhibit: Exhibit) => {
    const last = lastArrival.current;
    // Still in view (or back within the window): the visitor is still standing there. Every
    // sighting restarts the window, so a label that never leaves the view never re-arrives
    // (live, the label still in view after the map closed made him tell its story again).
    if (last?.id === exhibit.id && Date.now() - last.at < STILL_HERE_MS) { last.at = Date.now(); return; }
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
    // Push to talk: the microphone joins muted and opens while the button is held.
    await avatar.start({ mic: true, micMuted: true, camera: track });
  };

  /** The "What is this?" button: the page looks, then tells Edmund what it found. */
  const whatIsThis = async () => {
    if (looking || avatar.phase !== 'live') return;
    const { text, found } = await lookNow();
    if (found) { flash(found.title); arrive(found, 'camera'); return; }
    flash('Not one of the Meridian\'s works');
    avatar.event(`The visitor pressed "What is this?". ${text}`, 30);
  };

  /** The visitor ticks (or unticks) a work on the map themselves. */
  const markSeen = (exhibit: Exhibit, on: boolean) => {
    setSeen((list) => (on ? (list.some((e) => e.id === exhibit.id) ? list : [...list, exhibit]) : list.filter((e) => e.id !== exhibit.id)));
  };
  /** "Ask Edmund about it" on the map: a typed turn, as if the visitor had asked. */
  const askAbout = (exhibit: Exhibit) => {
    setMap(false);
    avatar.say(`Tell me about "${exhibit.title}".`);
  };

  const leave = () => { void avatar.end(); };
  const again = () => { setScreen('lobby'); setCard(current ? { exhibit: current, here: true } : null); };

  if (screen === 'lobby') return <Lobby opening={current} camera={camera.state} onBegin={() => void begin()} />;
  if (screen === 'visit') {
    return <Visit seen={seen} onAgain={() => { camera.stop(); again(); }} />;
  }

  const live = avatar.phase === 'live';
  const status = callCopy(avatar, HOST);
  const words = captionTail(avatar.caption, 120);
  const openMap = (at: Exhibit | null = null) => { setMapAt(at); setMap(true); setTalk(false); };
  return (
    <div ref={tourRef} className={`mr-tour ${small ? 'is-small' : ''} ${talk ? 'is-talking' : ''} ${avatar.speaking ? 'is-speaking' : ''}`}>
      <video ref={camera.videoRef} className="mr-camera" playsInline muted aria-label="Your camera" />
      <div className="mr-shade" aria-hidden="true" />

      <header className="mr-bar">
        <BackToApps avatar={avatar} name={HOST} className="mr-back" />
        <span className="mr-bar-title"><Wordmark /></span>
        <span className="mr-bar-end">
          {avatar.secondsLeft !== null && live && <span className="mr-clock">{Math.floor(avatar.secondsLeft / 60)}:{String(avatar.secondsLeft % 60).padStart(2, '0')}</span>}
          <button type="button" className="mr-end" onClick={leave} disabled={!live}>End</button>
        </span>
      </header>

      {live && !card && !looking && <div className="mr-reticle" aria-hidden="true" />}
      {looking && <div className="mr-toast" role="status"><span className="mr-dot" />Looking…</div>}
      {!looking && notice && <div className="mr-toast" role="status">{notice}</div>}

      <Keyed videoRef={avatar.videoRef} audioRef={avatar.audioRef} label={`${HOST} Hale, your guide`} className={small ? 'is-small' : ''} />

      {status && (
        <div className="mr-status" role="status">
          {status.busy && <span className="mr-spinner" aria-hidden="true" />}
          <strong>{status.title}</strong>
          {status.detail && <span>{status.detail}</span>}
          {!status.busy && <button type="button" className="mr-primary" onClick={() => void begin()}>Try again</button>}
        </div>
      )}
      {live && avatar.audioBlocked && <button type="button" className="mr-hear" onClick={avatar.resumeAudio}>Tap to hear {HOST}</button>}

      {/* Everything to read and press lives in one sheet under the camera view, never over it. */}
      <section ref={sheetRef} className="mr-panel" aria-label="Your guide">
        {talk ? (
          <div className="mr-panel-chat">
            <div className="mr-panel-head"><b>Conversation with {HOST}</b><button type="button" className="mr-link" onClick={() => setTalk(false)}>Done</button></div>
            <ChatPanel avatar={avatar} name={HOST} placeholder={`Ask ${HOST}…`} empty={<span>Type here when the gallery is too loud to talk.</span>} />
          </div>
        ) : (
          <>
            {card ? (
              <button type="button" className={`mr-now ${card.here ? 'is-here' : ''}`} onClick={() => openMap(card.exhibit)}>
                <img src={exhibitImage(card.exhibit)} alt="" />
                <span><small>{card.here ? 'You are at' : card.exhibit.gallery.split(',')[0]}</small><b>{card.exhibit.title}</b><em>{card.exhibit.artist} · {card.exhibit.date}</em></span>
                <span className="mr-now-more" aria-hidden="true">›</span>
              </button>
            ) : (
              <p className="mr-now is-empty">Point the camera at a work, or at the code on its label.</p>
            )}
            <div className="mr-subs" aria-live="polite">
              {words ? <p className="mr-subs-said"><b>{HOST}</b>{words}</p>
                : !avatar.heard && live && <p className="mr-subs-hint">Hold the mic and ask {HOST} anything.</p>}
              {avatar.heard && <p className="mr-subs-you">{avatar.heard}</p>}
            </div>
          </>
        )}
        <footer className="mr-dock">
          <button type="button" className="mr-dock-btn" onClick={() => openMap()} aria-label={`Museum map, ${seen.length} of ${EXHIBITS.length} seen`}>
            <span className="mr-dock-ico"><MapIcon /><i className="mr-badge">{seen.length}</i></span><span className="mr-dock-label">Map</span>
          </button>
          <button type="button" className={`mr-dock-btn ${talk ? 'is-on' : ''}`} onClick={() => setTalk((t) => !t)} aria-pressed={talk} disabled={!live}>
            <span className="mr-dock-ico"><KeyboardIcon /></span><span className="mr-dock-label">Type</span>
          </button>
          {live ? <PushToTalk avatar={avatar} /> : <span className="mr-dock-btn mr-ptt is-idle" aria-hidden="true"><span className="mr-dock-ico" /><span className="mr-dock-label">Hold to talk</span></span>}
          <button type="button" className={`mr-dock-btn ${looking ? 'is-busy' : ''}`} onClick={() => void whatIsThis()} disabled={!live || looking}>
            <span className="mr-dock-ico"><ScanIcon /></span><span className="mr-dock-label">What is this?</span>
          </button>
          <button type="button" className={`mr-dock-btn ${small ? '' : 'is-on'}`} onClick={() => setSmall((s) => !s)} aria-pressed={!small}>
            <span className="mr-dock-ico"><GuideIcon /></span><span className="mr-dock-label">{small ? `Show ${HOST}` : HOST}</span>
          </button>
        </footer>
      </section>

      {map && (
        <MuseumMap seen={seen} current={current} initial={mapAt} onClose={() => setMap(false)}
          onAsk={live ? askAbout : undefined} onToggleSeen={markSeen} />
      )}
    </div>
  );
}
