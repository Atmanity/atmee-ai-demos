// The Meridian: a museum tour on the visitor's phone. The rear camera fills
// the screen; Edmund Hale, the chairman, stands in it, keyed out of his green
// screen; the visitor talks to him out loud. The page knows which work they
// are at (a label's QR code, or a camera frame the server matched against the
// catalogue) and hands Edmund that work's catalogue record, so everything he
// says about it comes from the museum. He also sees the camera as he answers,
// which is for pointing at details.
//
// At some works the figure from the painting is a guest: Edmund hands the
// visitor over to the guest's own session and the visitor can call him back at
// any time. His session stays open meanwhile, muted (he hears nothing) and out
// of sight: live, a session started again to bring him back took 18 s and
// opened with his greeting from scratch; kept open, he is back at once and
// remembers the conversation.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackToApps, ChatPanel, useAvatar, useToolNet, type Avatar, type ToolCall } from '../../../src/kit/index.ts';
import { EXHIBITS, exhibitById, findExhibit, type Exhibit } from '../engine/catalogue.ts';
import { localize } from '../engine/catalogue.i18n.ts';
import { languageRule, type Lang } from '../engine/lang.ts';
import { arrived, isToolName, said, tourState, type Found } from '../engine/director.ts';
import { guestFor, guestLabel, guestSaid, guestState, type Guest } from '../engine/guests.ts';
import { asksForHost, asksWhat } from '../engine/judge.ts';
import { grabFrame, useCamera, useLabelScanner } from './camera.ts';
import { HOST_NAME, LangContext, saveLang, savedLang, translator, type T } from './i18n.ts';
import { exhibitImage } from './images.ts';
import { Keyed } from './Keyed.tsx';
import { Lobby, Wordmark } from './Lobby.tsx';
import { MuseumMap } from './MuseumMap.tsx';
import { CameraIcon, CameraOffIcon, GuideIcon, KeyboardIcon, MapIcon, ScanIcon } from './icons.tsx';
import { PushToTalk } from './PushToTalk.tsx';
import { Sheet } from './Sheet.tsx';
import { Subtitles } from './Subtitles.tsx';
import { Visit } from './Visit.tsx';
import { WorkInfo } from './WorkInfo.tsx';
import './meridian.css';

const API = '/api/apps/museum-guide';

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

const params = new URLSearchParams(location.search);

export function App() {
  if (params.has('sheet')) return <Sheet />;
  return <Tour opening={exhibitById(params.get('exhibit'))} />;
}

/** Who is guiding the visitor: Edmund, a guest, or one on the way in while the other is still there. */
type Mode = 'host' | 'to-guest' | 'guest' | 'to-host';

/** The call's state over the camera while it connects, and after it ends or fails, in the visitor's language. */
function statusCopy(call: Avatar, name: string, t: T): { title: string; detail: string; busy: boolean } | null {
  switch (call.phase) {
    case 'starting': return { title: t('calling', { name }), detail: t('callingDetail'), busy: true };
    case 'warming': return { title: t('warming', { name }), detail: t('warmingDetail'), busy: true };
    case 'connecting': return { title: t('connecting', { name }), detail: '', busy: true };
    case 'arriving': return { title: t('arriving', { name }), detail: t('arrivingDetail'), busy: true };
    case 'ended': return { title: t('ended'), detail: '', busy: false };
    case 'failed': return { title: t('failed', { name }), detail: t('failedDetail'), busy: false };
    default: return null;
  }
}

function Tour({ opening }: { opening: Exhibit | null }) {
  const camera = useCamera();
  // The tour's language, picked at the front door: the calls speak and listen in it, the screen is in it.
  const [lang, setLangState] = useState<Lang>(savedLang);
  const t = useMemo(() => translator(lang), [lang]);
  const langRef = useRef(lang);
  langRef.current = lang;
  const setLang = (next: Lang) => { setLangState(next); saveLang(next); };
  /** A work as the visitor reads it (and a guide is told it): in the tour's language. */
  const L = useCallback((e: Exhibit) => localize(e, langRef.current), []);
  const HOST = HOST_NAME[lang];
  // The page's language, for screen readers and the right Chinese or Japanese glyphs.
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const [screen, setScreen] = useState<'lobby' | 'tour' | 'visit'>('lobby');
  const [current, setCurrent] = useState<Exhibit | null>(opening);
  // The card on screen: where the visitor is, or a work Edmund pointed them to.
  const [card, setCard] = useState<{ exhibit: Exhibit; here: boolean } | null>(opening ? { exhibit: opening, here: true } : null);
  // A work's whole entry, over the camera: opened as a work is introduced, closed with "Back to camera".
  const [info, setInfo] = useState<Exhibit | null>(null);
  const [seen, setSeen] = useState<Exhibit[]>([]);
  const [looking, setLooking] = useState(false);
  const [notice, setNotice] = useState('');
  const [small, setSmall] = useState(false);
  const [talk, setTalk] = useState(false);
  const [map, setMap] = useState(false);
  const [mapAt, setMapAt] = useState<Exhibit | null>(null);
  // The guest in play (joining, talking, or leaving), and which call is on screen.
  const [guest, setGuest] = useState<Guest | null>(null);
  const [speaker, setSpeaker] = useState<'host' | 'guest'>('host');
  const [handovers, setHandovers] = useState(0);
  const mode = useRef<Mode>('host');
  const ending = useRef(false);
  // The panel's top edge, where the guide stands, as it grows and shrinks.
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
  /** The tour as Edmund is told it: the works in the visitor's language. */
  const toldTour = () => ({ ...at.current, current: at.current.current && L(at.current.current), seen: at.current.seen.map(L) });
  const lastArrival = useRef<{ id: string; at: number } | null>(null);
  // Which call the page is serving; work started for one call is dropped if it answers after it.
  const callGen = useRef(0);
  const hostRef = useRef<ReturnType<typeof useAvatar> | null>(null);
  const guestRef = useRef<ReturnType<typeof useAvatar> | null>(null);
  const guestNow = useRef<Guest | null>(null);
  guestNow.current = guest;
  // The guest Edmund is coming back from (kept from the call-back on: the guest's state may clear first),
  // and the wait for the guest's goodbye.
  const leavingGuest = useRef<Guest | null>(null);
  const backTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  /** Edmund off stage while a guest talks: he hears silence and is not heard. */
  const hostAside = useCallback((aside: boolean) => {
    const host = hostRef.current;
    if (!host) return;
    if (host.audioRef.current) host.audioRef.current.muted = aside;
    if (host.phase === 'live') (aside ? host.mute : host.unmute)();
  }, []);

  const flash = useCallback((text: string) => {
    setNotice(text);
    setTimeout(() => setNotice((n) => (n === text ? '' : n)), 3500);
  }, []);

  /** The visitor is at a work now: the screen, its entry, and whoever is guiding them. */
  const arrive = useCallback((exhibit: Exhibit, how: Found | 'tool') => {
    const last = lastArrival.current;
    const again = Boolean(last && last.id === exhibit.id && Date.now() - last.at < STILL_HERE_MS);
    lastArrival.current = { id: exhibit.id, at: Date.now() };
    const nextSeen = at.current.seen.some((e) => e.id === exhibit.id) ? at.current.seen : [...at.current.seen, exhibit];
    at.current = { ...at.current, current: exhibit, seen: nextSeen };
    setCurrent(exhibit);
    setSeen(nextSeen);
    setCard({ exhibit, here: true });
    if (!again) setInfo(exhibit);
    const host = hostRef.current;
    host?.state(tourState(toldTour()));
    if (mode.current !== 'host') {
      // With a guest on, another work is Edmund's to tell: the guest says so and calls him back, and
      // his welcome back tells it. Mid hand-over he is about to step aside or back: no story now.
      const g = guestNow.current;
      if (mode.current === 'guest' && g && g.exhibit !== exhibit.id) guestRef.current?.event(guestSaid.movedOn(L(exhibit).title), 30);
      return;
    }
    if (how !== 'tool') host?.event(arrived(L(exhibit), how, again), 30);
  }, []);

  // A label's code in view: the same label held there is not a new arrival. Paused while
  // something covers the camera (the map, a work's entry).
  useLabelScanner(camera.videoRef, screen === 'tour' && !map && !info && camera.state === 'on', useCallback((exhibit: Exhibit) => {
    const last = lastArrival.current;
    // Still in view (or back within the window): the visitor is still standing there. Every
    // sighting restarts the window, so a label that never leaves the view never re-arrives
    // (live, the label still in view after the map closed made him tell its story again).
    if (last?.id === exhibit.id && Date.now() - last.at < STILL_HERE_MS) { last.at = Date.now(); return; }
    flash(translator(langRef.current)('label', { title: L(exhibit).title }));
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
      if (found) return { text: said.identified(L(found)), found };
      return { text: answer.kind === 'unclear' ? said.unclear(answer.seen) : said.notInCatalogue(answer.seen), found: null };
    } finally {
      if (gen === callGen.current) setLooking(false);
    }
  }, [camera.videoRef]);

  /** Edmund hands the visitor over to a work's guest. The guest's call starts on the next render (its path names the guest). */
  const handOver = useCallback((g: Guest, how: 'tool' | 'button') => {
    if (mode.current !== 'host') return false;
    mode.current = 'to-guest';
    setGuest(g);
    setInfo(null);
    flash(translator(langRef.current)('onTheWay', { name: guestLabel(g, langRef.current).name }));
    if (how === 'button') hostRef.current?.event(said.handOverPressed(g), 20);
    setHandovers((n) => n + 1);
    return true;
  }, [flash]);

  /** The guest leaves and Edmund comes back; the guest's call ends once his is live. */
  const callHostBack = useCallback((how: 'button' | 'guest' | 'dropped') => {
    if (mode.current !== 'guest') return;
    mode.current = 'to-host';
    leavingGuest.current = guestNow.current;
    const host = hostRef.current;
    if (host?.phase !== 'live') {
      // His session ended meanwhile: a new one (he greets from scratch, then is told he is back).
      flash(translator(langRef.current)('hostOnTheWay', { name: HOST_NAME[langRef.current] }));
      void host?.start({ mic: true, micMuted: true, camera: camera.track, language: langRef.current });
      return;
    }
    // Still there: once the guest has said goodbye (a few seconds at most), he steps back in.
    if (how === 'button') guestRef.current?.event(guestSaid.visitorAsked, 20);
    const started = Date.now();
    clearInterval(backTimer.current);
    backTimer.current = setInterval(() => {
      const guestTalking = how !== 'dropped' && (Date.now() - started < 1500 || guestRef.current?.speaking);
      if (guestTalking && Date.now() - started < 9000) return;
      clearInterval(backTimer.current);
      hostBack();
    }, 300);
  }, [camera.track, flash]);

  /** Edmund on stage again, told whom the visitor met; the guest's call ends. */
  const hostBack = () => {
    if (ending.current) return;
    const g = leavingGuest.current;
    leavingGuest.current = null;
    mode.current = 'host';
    hostAside(false);
    setSpeaker('host');
    if (g) hostRef.current?.event(said.welcomeBack(g, at.current.current && L(at.current.current)), 60);
    void guestRef.current?.end();
    setGuest(null);
  };

  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall) => {
    if (!isToolName(name)) throw new Error(`there is no tool called ${name}`);
    if (name === 'identify_exhibit') {
      const question = typeof args?.question === 'string' ? args.question : undefined;
      const { text, found } = await lookNow(question);
      if (found) arrive(found, 'tool');
      else flash(translator(langRef.current)('notAWork'));
      return text;
    }
    if (name === 'introduce_guest') {
      const g = guestFor(at.current.current);
      if (!g) return said.noGuest(at.current.current);
      return handOver(g, 'tool') ? said.handingOver(g) : said.guestBusy;
    }
    const title = String(args?.title ?? args?.name ?? args?.work ?? '').trim();
    const exhibit = findExhibit(title);
    if (!exhibit) return said.notFound(title);
    setCard({ exhibit, here: exhibit.id === at.current.current?.id });
    // He is introducing it: its entry opens, as for a work the visitor arrives at.
    setInfo(exhibit);
    return said.shown(L(exhibit));
  }, [arrive, flash, handOver, lookNow]);

  // If Edmund answers "what is this?" without looking, the page looks and tells him.
  const net = useToolNet({
    match: (text) => (asksWhat(text) ? { id: `net-${Date.now()}`, name: 'identify_exhibit', arguments: { question: text } } : null),
    run: async (call) => String(await onToolCall(call)),
    avatar: () => hostRef.current!,
  });

  const host = useAvatar('museum-guide', {
    onToolCall: net.watch(onToolCall),
    onUserSaid: (text) => net.heard(text),
    onLive: () => {
      // Back from a guest in a new session: he picks up where the visitor is, and the guest goes.
      if (mode.current === 'to-host') { hostBack(); return; }
      hostRef.current?.event(said.opening(at.current.current && L(at.current.current)), 60);
      // The camera opens once he is on the line (not while the call is still being placed), and he sees it from then on.
      void camera.start().then((track) => {
        if (track) void hostRef.current?.setCamera?.(track);
        else flash(translator(langRef.current)('cameraOffAtStart', { name: HOST_NAME[langRef.current] }));
      });
    },
    onEnded: () => {
      // Ended while a guest has the visitor (his session ran out): the tour goes on; calling him back starts a new one.
      if (!ending.current && (mode.current === 'to-guest' || mode.current === 'guest')) return;
      if (!ending.current && mode.current === 'to-host') { mode.current = 'guest'; return; }
      callGen.current++;
      setLooking(false);
      setScreen((s) => (s === 'tour' ? 'visit' : s));
    },
  });
  hostRef.current = host;

  /** A guest's one tool: Edmund back once their goodbye is said. */
  const onGuestToolCall = useCallback(async ({ name }: ToolCall) => {
    if (name !== 'call_host_back') throw new Error(`there is no tool called ${name}`);
    callHostBack('guest');
    return guestSaid.calledBack;
  }, [callHostBack]);
  // Asking a guest for Edmund: if the guest does not call him back within a few seconds, the page does.
  const guestNet = useToolNet({
    match: (text) => (asksForHost(text) ? { id: `net-${Date.now()}`, name: 'call_host_back', arguments: {} } : null),
    run: async () => {
      if (mode.current !== 'guest') return null;
      callHostBack('guest');
      return guestSaid.netCalledBack;
    },
    avatar: () => guestRef.current!,
  });
  const guestCall = useAvatar(`museum-guide/guest/${guest?.id ?? 'none'}`, {
    onToolCall: guestNet.watch(onGuestToolCall),
    onUserSaid: (text) => guestNet.heard(text),
    onLive: () => {
      const g = guestNow.current;
      if (!g) return;
      mode.current = 'guest';
      guestRef.current?.state(guestState(g, langRef.current));
      // The guest takes the stage (and greets); Edmund steps aside, still on the line.
      hostAside(true);
      setSpeaker('guest');
    },
    onEnded: () => {
      if (ending.current) { callGen.current++; setScreen((s) => (s === 'tour' ? 'visit' : s)); return; }
      // Dropped while talking: Edmund comes back (and is told whom the visitor met).
      if (mode.current === 'guest') callHostBack('dropped');
    },
  });
  guestRef.current = guestCall;

  // A handover asked for: the guest's call, on the guest's path (this render has it).
  useEffect(() => {
    if (!handovers || mode.current !== 'to-guest') return;
    const rule = languageRule(langRef.current);
    if (rule) guestCall.note(rule);
    void guestCall.start({ mic: true, micMuted: true, camera: camera.track, language: langRef.current });
  }, [handovers]);
  // The guest could not come: Edmund carries on.
  useEffect(() => {
    if (guestCall.phase !== 'failed' || mode.current !== 'to-guest') return;
    mode.current = 'host';
    const g = guestNow.current;
    setGuest(null);
    // And Edmund's own call ended meanwhile: there is no one left to guide; the visit is over.
    if (host.phase !== 'live') { callGen.current++; setScreen((s) => (s === 'tour' ? 'visit' : s)); return; }
    if (g) host.event(said.guestCouldNotCome(g), 30);
  }, [guestCall.phase]);
  // Edmund could not come back: the guest stays.
  useEffect(() => {
    if (host.phase !== 'failed' || mode.current !== 'to-host') return;
    mode.current = 'guest';
    flash(t('hostCouldNotComeBack', { name: HOST }));
  }, [host.phase]);

  const active = speaker === 'guest' ? guestCall : host;
  const activeName = speaker === 'guest' && guest ? guestLabel(guest, lang).name : HOST;
  // <html> data-call and data-speaking follow whoever is on screen (each call's hook also sets them).
  useEffect(() => {
    document.documentElement.dataset.call = active.phase;
    document.documentElement.dataset.speaking = String(active.speaking);
  }, [active.phase, active.speaking, host.phase, guestCall.phase, speaker]);

  // The camera covers its box, cropped at the edges, at any size and turn of the phone. Not
  // by CSS object-fit alone: on iPhone Safari the live camera was shrunk to fit instead, with
  // black bars either side.
  useEffect(() => {
    const video = camera.videoRef.current;
    const box = video?.parentElement;
    if (!video || !box) return;
    const fit = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      const k = Math.max(box.clientWidth / video.videoWidth, box.clientHeight / video.videoHeight);
      video.style.width = `${Math.ceil(video.videoWidth * k)}px`;
      video.style.height = `${Math.ceil(video.videoHeight * k)}px`;
    };
    const watch = new ResizeObserver(fit);
    watch.observe(box);
    video.addEventListener('loadedmetadata', fit);
    video.addEventListener('resize', fit);
    fit();
    return () => { watch.disconnect(); video.removeEventListener('loadedmetadata', fit); video.removeEventListener('resize', fit); };
  }, [screen]);

  // The tour is over: the camera goes off with it (the visit card does not show it).
  useEffect(() => { if (screen === 'visit') camera.stop(); }, [screen]);

  // Edmund's picture of the tour, kept current (the same text twice is sent once).
  useEffect(() => { host.state(tourState(toldTour())); }, [host, current, seen, camera.state, lang]);

  const begin = async () => {
    setScreen('tour');
    setSeen([]);
    mode.current = 'host';
    ending.current = false;
    setSpeaker('host');
    setGuest(null);
    lastArrival.current = current ? { id: current.id, at: Date.now() } : null;
    if (current) { setSeen([current]); setInfo(current); }
    callGen.current++;
    // In the visitor's language: the call is set to it, and Edmund keeps to it.
    const rule = languageRule(lang);
    if (rule) host.note(rule);
    // Push to talk: the microphone joins muted and opens while the button is held. No camera
    // yet: it opens when Edmund is on the line (onLive).
    await host.start({ mic: true, micMuted: true, language: lang });
  };

  /** The "What is this?" button: the page looks, then tells whoever is guiding what it found. */
  const whatIsThis = async () => {
    if (looking || active.phase !== 'live') return;
    const { text, found } = await lookNow();
    if (found) { flash(L(found).title); arrive(found, 'camera'); return; }
    flash(t('notAWork'));
    if (speaker === 'host') host.event(said.whatIsThisPressed(text), 30);
  };

  const cameraOn = camera.state === 'on';
  /** The camera button: off stops it and takes it from the calls; on opens it and shows it to whoever is on the line. */
  const toggleCamera = async () => {
    if (cameraOn) {
      camera.stop();
      void host.setCamera?.(null);
      void guestCall.setCamera?.(null);
      return;
    }
    const track = await camera.start();
    if (!track) { flash(t('cameraBlockedToast')); return; }
    if (host.phase === 'live') void host.setCamera?.(track);
    if (guestCall.phase === 'live') void guestCall.setCamera?.(track);
  };

  /** The visitor ticks (or unticks) a work on the map themselves. */
  const markSeen = (exhibit: Exhibit, on: boolean) => {
    setSeen((list) => (on ? (list.some((e) => e.id === exhibit.id) ? list : [...list, exhibit]) : list.filter((e) => e.id !== exhibit.id)));
  };
  /** "Ask Edmund about it": a typed turn, as if the visitor had asked. */
  const askAbout = (exhibit: Exhibit) => {
    setMap(false);
    setInfo(exhibit);
    host.say(`Tell me about "${exhibit.title}".`);
  };

  const leave = () => {
    ending.current = true;
    clearInterval(backTimer.current);
    void host.end();
    void guestCall.end();
  };
  const again = () => { setScreen('lobby'); setCard(current ? { exhibit: current, here: true } : null); };

  const context = { lang, t };
  if (screen === 'lobby') {
    return <LangContext.Provider value={context}><Lobby opening={current} camera={camera.state} onLang={setLang} onBegin={() => void begin()} /></LangContext.Provider>;
  }
  if (screen === 'visit') {
    return <LangContext.Provider value={context}><Visit seen={seen} onAgain={() => { camera.stop(); again(); }} /></LangContext.Provider>;
  }

  const live = active.phase === 'live';
  const hostOn = speaker === 'host' && host.phase === 'live' && mode.current === 'host';
  const busy = mode.current === 'to-guest' || mode.current === 'to-host';
  const status = busy ? null : statusCopy(active, activeName, t);
  const openMap = (where: Exhibit | null = null) => { setMapAt(where); setMap(true); setTalk(false); };
  const infoGuest = guestFor(info);
  return (
    <LangContext.Provider value={context}>
    <div ref={tourRef} className={`mr-tour ${small ? 'is-small' : ''} ${talk ? 'is-talking' : ''} ${info ? 'is-reading' : ''} ${active.speaking ? 'is-speaking' : ''}`}>
      <div className="mr-camera"><video ref={camera.videoRef} playsInline muted aria-label="Your camera" /></div>
      <div className="mr-shade" aria-hidden="true" />

      <header className="mr-bar">
        <BackToApps avatar={active} name={activeName} className="mr-back" />
        <span className="mr-bar-title"><Wordmark /></span>
        <span className="mr-bar-end">
          {active.secondsLeft !== null && live && <span className="mr-clock">{Math.floor(active.secondsLeft / 60)}:{String(active.secondsLeft % 60).padStart(2, '0')}</span>}
          <button type="button" className={`mr-cam ${cameraOn ? '' : 'is-off'}`} onClick={() => void toggleCamera()} disabled={!live || camera.state === 'asking'}
            aria-pressed={cameraOn} aria-label={cameraOn ? t('cameraOff') : t('cameraOn')} title={cameraOn ? t('cameraOff') : t('cameraOn')}>
            {cameraOn ? <CameraIcon /> : <CameraOffIcon />}
          </button>
          <button type="button" className="mr-end" onClick={leave} disabled={!live}>{t('end')}</button>
        </span>
      </header>

      {live && cameraOn && !card && !looking && !info && <div className="mr-reticle" aria-hidden="true" />}
      {live && !cameraOn && camera.state !== 'asking' && !info && (
        <div className="mr-camoff">
          <CameraOffIcon />
          <p>{t('cameraOffNote', { name: activeName })}</p>
          <button type="button" className="mr-primary" onClick={() => void toggleCamera()}>{t('cameraOn')}</button>
        </div>
      )}
      {looking && <div className="mr-toast" role="status"><span className="mr-dot" />{t('looking')}</div>}
      {!looking && notice && <div className="mr-toast" role="status">{busy && <span className="mr-dot" />}{notice}</div>}

      {info && (
        <section className="mr-info" aria-label={L(info).title}>
          <WorkInfo exhibit={info} seen={seen.some((e) => e.id === info.id)} here={current?.id === info.id}
            back={`‹ ${t('backToCamera')}`} onBack={() => setInfo(null)} onOpen={setInfo}
            onAsk={hostOn ? askAbout : undefined} onToggleSeen={markSeen}>
            {infoGuest && hostOn && (
              <button type="button" className="mr-primary mr-meet" onClick={() => handOver(infoGuest, 'button')}>{guestLabel(infoGuest, lang).meet}</button>
            )}
          </WorkInfo>
          <button type="button" className="mr-info-close" onClick={() => setInfo(null)}>{t('backToCamera')}</button>
        </section>
      )}

      <Keyed videoRef={host.videoRef} audioRef={host.audioRef} label={HOST} className={`${small ? 'is-small' : ''} ${speaker === 'host' ? '' : 'is-away'}`} />
      <Keyed videoRef={guestCall.videoRef} audioRef={guestCall.audioRef} label={guest ? guestLabel(guest, lang).name : ''} className={`${small ? 'is-small' : ''} ${speaker === 'guest' ? '' : 'is-away'}`} />

      {status && (
        <div className="mr-status" role="status">
          {status.busy && <span className="mr-spinner" aria-hidden="true" />}
          <strong>{status.title}</strong>
          {status.detail && <span>{status.detail}</span>}
          {!status.busy && <button type="button" className="mr-primary" onClick={() => void begin()}>{t('tryAgain')}</button>}
        </div>
      )}
      {live && active.audioBlocked && <button type="button" className="mr-hear" onClick={active.resumeAudio}>{t('tapToHear', { name: activeName })}</button>}

      {/* Everything to read and press lives in one panel under the camera view, never over it. */}
      <section ref={sheetRef} className="mr-panel" aria-label="Your guide">
        {talk ? (
          <div className="mr-panel-chat">
            <div className="mr-panel-head"><b>{t('conversation', { name: activeName })}</b><button type="button" className="mr-link" onClick={() => setTalk(false)}>{t('done')}</button></div>
            <ChatPanel avatar={active} name={activeName} placeholder={t('askPlaceholder', { name: activeName })} empty={<span>{t('chatEmpty')}</span>} />
          </div>
        ) : (
          <>
            {speaker === 'guest' && guest ? (
              <div className="mr-now is-guest">
                <span><small>{t('talkingWith')}</small><b>{guestLabel(guest, lang).name}</b><em>{t('fromWork', { title: L(exhibitById(guest.exhibit)!).title })}</em></span>
                <button type="button" className="mr-callback" onClick={() => callHostBack('button')} disabled={busy}>{t('callBack', { name: HOST })}</button>
              </div>
            ) : card ? (
              <button type="button" className={`mr-now ${card.here ? 'is-here' : ''}`} onClick={() => setInfo(card.exhibit)}>
                <img src={exhibitImage(card.exhibit)} alt="" />
                <span><small>{card.here ? t('youAreAt') : L(card.exhibit).gallery.split(/[,，]/)[0]}</small><b>{L(card.exhibit).title}</b><em>{L(card.exhibit).artist} · {L(card.exhibit).date}</em></span>
                <span className="mr-now-more" aria-hidden="true">›</span>
              </button>
            ) : (
              <p className="mr-now is-empty">{t('pointHint')}</p>
            )}
            <Subtitles key={speaker} text={active.caption} speaking={active.speaking} name={activeName} heard={active.heard}
              hint={live ? t('askHint', { name: activeName }) : ''} />
          </>
        )}
        <footer className="mr-dock">
          <button type="button" className="mr-dock-btn" onClick={() => openMap()} aria-label={t('mapLabel', { n: seen.length, total: EXHIBITS.length })}>
            <span className="mr-dock-ico"><MapIcon /><i className="mr-badge">{seen.length}</i></span><span className="mr-dock-label">{t('map')}</span>
          </button>
          <button type="button" className={`mr-dock-btn ${talk ? 'is-on' : ''}`} onClick={() => setTalk((t) => !t)} aria-pressed={talk} disabled={!live}>
            <span className="mr-dock-ico"><KeyboardIcon /></span><span className="mr-dock-label">{t('type')}</span>
          </button>
          {live ? <PushToTalk avatar={active} /> : <span className="mr-dock-btn mr-ptt is-idle" aria-hidden="true"><span className="mr-dock-ico" /><span className="mr-dock-label">{t('holdToTalk')}</span></span>}
          <button type="button" className={`mr-dock-btn ${looking ? 'is-busy' : ''}`} onClick={() => void whatIsThis()} disabled={!live || looking || !cameraOn}>
            <span className="mr-dock-ico"><ScanIcon /></span><span className="mr-dock-label">{t('whatIsThis')}</span>
          </button>
          {speaker === 'guest' ? (
            <button type="button" className="mr-dock-btn is-on" onClick={() => callHostBack('button')} disabled={busy}>
              <span className="mr-dock-ico"><GuideIcon /></span><span className="mr-dock-label">{t('callHost', { name: HOST })}</span>
            </button>
          ) : (
            <button type="button" className={`mr-dock-btn ${small ? '' : 'is-on'}`} onClick={() => setSmall((s) => !s)} aria-pressed={!small}>
              <span className="mr-dock-ico"><GuideIcon /></span><span className="mr-dock-label">{small ? t('showHost', { name: HOST }) : HOST}</span>
            </button>
          )}
        </footer>
      </section>

      {map && (
        <MuseumMap seen={seen} current={current} initial={mapAt} onClose={() => setMap(false)}
          onAsk={hostOn ? askAbout : undefined} onToggleSeen={markSeen} />
      )}
    </div>
    </LangContext.Provider>
  );
}
