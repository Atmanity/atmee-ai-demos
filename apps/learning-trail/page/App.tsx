// Trailmix: Mochi walks a child along the Volcano Trail. The trail runs here;
// Mochi's tools and the child's big buttons make the same moves, so the screen
// reacts to a shout as much as to a tap. Children do not type: the call joins
// with the microphone shut, and a big button opens it while held.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackToApps, CallStatus, ChatPanel, HostVideo, MicIcon, useAvatar, useToolNet, type Avatar, type ToolCall } from '../../../src/kit/index.ts';
import { arrival, followUp, pressed, trailState } from '../engine/director.ts';
import { mustDo } from '../engine/judge.ts';
import { addLayer, cleared, finished, judge, newTrail, pickRock, pump, STOPS, walkOn, type Fx, type Move, type Trail } from '../engine/trail.ts';
import { Boom, Layers, Rocks, Silly, Sticker, type Act } from './Scenes.tsx';
import mochi from '../host/portrait.jpg';
import './trailmix.css';

const HOST = 'Mochi';
const TAIL_MS = 400;

/** Tool or button, one move on the trail. */
function moveOf(t: Trail, name: string, value: unknown): Move | null {
  switch (name) {
    case 'pump_volcano': return pump(t);
    case 'add_layer': return addLayer(t, value);
    case 'judge_claim': return judge(t, value);
    case 'pick_rock': return pickRock(t, value);
    case 'walk_on': return walkOn(t);
    default: return null;
  }
}

function HoldToTalk({ avatar }: { avatar: Avatar }) {
  const [held, setHeld] = useState(false);
  const tail = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const press = () => { clearTimeout(tail.current); setHeld(true); avatar.setMic(true); };
  const letGo = () => { setHeld(false); clearTimeout(tail.current); tail.current = setTimeout(() => avatar.setMic(false), TAIL_MS); };
  useEffect(() => () => clearTimeout(tail.current), []);
  return (
    <button
      type="button" className={`tm-talk ${held ? 'is-open' : ''}`} aria-pressed={held}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); press(); }}
      onPointerUp={letGo} onPointerCancel={letGo} onContextMenu={(e) => e.preventDefault()}
    >
      <MicIcon /><span>{held ? 'Mochi is listening' : 'Hold to talk'}</span>
    </button>
  );
}

function Map({ trail }: { trail: Trail }) {
  // Four spots along a winding path, as percentages of the strip.
  const spots = [[9, 66], [37, 32], [65, 66], [91, 32]];
  const [x, y] = spots[Math.min(trail.stop, spots.length - 1)];
  return (
    <div className="tm-map">
      <svg viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden="true"><path d="M36 40 C80 8 110 8 148 19 S220 62 260 40 S330 4 364 19" /></svg>
      <ol>
        {STOPS.map((s, i) => (
          <li key={s.id} style={{ left: `${spots[i][0]}%`, top: `${spots[i][1]}%` }} className={trail.stickers.includes(s.id) ? 'won' : i === trail.stop ? 'here' : ''}>
            <i>{i + 1}</i><span>{s.title}</span>
          </li>
        ))}
      </ol>
      <img className="tm-token" src={mochi} alt="" style={{ left: `${x}%`, top: `${y}%` }} />
    </div>
  );
}

function Confetti() {
  const colours = ['#e8590c', '#f5b81f', '#fdf3dc', '#6b7f3a'];
  return <div className="tm-confetti" aria-hidden="true">{Array.from({ length: 36 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, background: colours[i % 4], animationDelay: `${(i % 9) * 40}ms` }} />)}</div>;
}

function Lobby({ onGo }: { onGo: (mic: boolean) => void }) {
  return (
    <div className="tm-lobby">
      <div className="tm-lobby-copy">
        <h1 className="tm-logo">Trailmix</h1>
        <p className="tm-tag">Every subject is an expedition.</p>
        <p>Walk the Volcano Trail with Mochi. Pump up a rumbling volcano, build the Earth, catch Mochi's silly mistakes and fill your backpack with stickers.</p>
        <div className="tm-lobby-go">
          <button type="button" className="tm-big hot" onClick={() => onGo(true)}>Start the trail</button>
          <button type="button" className="tm-quiet" onClick={() => onGo(false)}>Play with taps only</button>
        </div>
        <p className="tm-grown">For grown-ups: Mochi hears what is said while the talk button is held. There is no account, and Mochi never asks for personal details.</p>
      </div>
      <img src={mochi} alt="Mochi, a red panda explorer with a yellow neckerchief and a backpack" className="tm-lobby-face" />
    </div>
  );
}

export function App() {
  const [trail, setTrail] = useState<Trail>(newTrail);
  const [fx, setFx] = useState<Fx[]>([]);
  const [fxKey, setFxKey] = useState(0);
  const [withMic, setWithMic] = useState(false);
  const trailRef = useRef(trail);

  // The trail moves here first, so two calls in one breath each see the last one's result.
  const apply = useCallback((name: string, value: unknown) => {
    const move = moveOf(trailRef.current, name, value);
    if (!move) return null;
    trailRef.current = move.trail;
    setTrail(move.trail);
    if (move.fx.length) { setFx(move.fx); setFxKey((k) => k + 1); }
    return move;
  }, []);

  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall) => {
    const a = (args ?? {}) as Record<string, unknown>;
    const move = apply(name, a.layer ?? a.verdict ?? a.rock);
    if (!move) return `Not a trail tool: ${name}.`;
    return move.outcome + (move.fx.includes('hop') || move.fx.includes('finish') ? ` ${arrival(move.trail)}` : followUp(move.trail));
  }, [apply]);

  const net = useToolNet({
    match: (text) => { const name = mustDo(text); return name && cleared(trailRef.current) ? { id: `net-${Date.now()}`, name, arguments: {} } : null; },
    run: async (call) => String(await onToolCall(call)),
    avatar: () => avatarRef.current!,
  });
  const avatar = useAvatar('learning-trail', { onToolCall: net.watch(onToolCall), onUserSaid: (text) => net.heard(text) });
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  // A button acts at once; Mochi cannot see the screen, so Mochi is told.
  const onAct: Act = ({ name, value }) => {
    const move = apply(name, value);
    if (!move) return;
    const next = move.fx.includes('hop') || move.fx.includes('finish') ? arrival(move.trail) : pressed(move.outcome + followUp(move.trail));
    if (live) avatar.event(next, 30);
  };

  // Each new call walks a fresh trail; Mochi's opening waits for the line to be live.
  useEffect(() => {
    if (avatar.phase === 'starting') { const t = newTrail(); trailRef.current = t; setTrail(t); setFx([]); }
  }, [avatar.phase]);
  const opened = useRef(false);
  useEffect(() => {
    if (avatar.phase === 'idle' || avatar.phase === 'starting') opened.current = false;
    if (live && !opened.current) { opened.current = true; avatar.event(arrival(trailRef.current), 60); }
  }, [avatar.phase, live]);
  useEffect(() => { if (live) avatar.state(trailState(trail)); }, [trail, live]);

  if (avatar.phase === 'idle') return <Lobby onGo={(mic) => { setWithMic(mic); void avatar.start({ mic, micMuted: mic }); }} />;

  const stop = STOPS[trail.stop];
  const canWalk = cleared(trail);
  const typing = new URLSearchParams(location.search).has('type');
  return (
    <div className="tm-app">
      <header className="tm-top">
        <BackToApps avatar={avatar} name={HOST} />
        <span className="tm-logo small">Trailmix</span>
        <Map trail={trail} />
      </header>

      <main className="tm-main">
        <section className={`tm-stage ${fx.includes('erupt') ? 'tm-shake' : ''}`} aria-live="polite">
          {finished(trail) ? (
            <div className="tm-finish" data-scene="finish">
              <div className="tm-badge"><img src={mochi} alt="" /></div>
              <h2>Junior Volcanologist!</h2>
              <p>You walked the whole trail and filled your backpack.</p>
              <button type="button" className="tm-big hot" onClick={() => { const t = newTrail(); trailRef.current = t; setTrail(t); if (live) avatar.event(arrival(t, true), 30); }}>Walk it again</button>
            </div>
          ) : (
            <>
              <h2 className="tm-stop"><small>Stop {trail.stop + 1}</small> {stop.title}<em>{stop.game}</em></h2>
              {stop.id === 'boom' && <Boom trail={trail} onAct={onAct} />}
              {stop.id === 'layers' && <Layers trail={trail} onAct={onAct} />}
              {stop.id === 'silly' && <Silly trail={trail} onAct={onAct} />}
              {stop.id === 'rocks' && <Rocks trail={trail} onAct={onAct} />}
              {canWalk && <button type="button" className="tm-walk" onClick={() => onAct({ name: 'walk_on' })}>Walk on</button>}
            </>
          )}
          {fx.includes('sticker') && <div className="tm-fly" key={fxKey}><Sticker id={trail.stickers[trail.stickers.length - 1]} size={150} /></div>}
          {(fx.includes('sticker') || fx.includes('finish')) && <Confetti key={`c${fxKey}`} />}
          {fx.includes('wrong') && <p className="tm-try" key={`w${fxKey}`}>Try again!</p>}
        </section>

        <aside className="tm-side">
          <div className="tm-host">
            <HostVideo avatar={avatar} name={HOST} poster={mochi} className="tm-host-video">
              <CallStatus avatar={avatar} name={HOST} again="Call Mochi again" />
            </HostVideo>
          </div>
          {withMic && live && <HoldToTalk avatar={avatar} />}
          <div className="tm-pack">
            <h3>Backpack</h3>
            <ul>{STOPS.map((s) => <li key={s.id} className={trail.stickers.includes(s.id) ? 'won' : ''} title={s.sticker}>{trail.stickers.includes(s.id) ? <Sticker id={s.id} /> : <i />}</li>)}</ul>
          </div>
          {typing && <ChatPanel avatar={avatar} name={HOST} placeholder="Say something to Mochi" />}
        </aside>
      </main>
    </div>
  );
}
