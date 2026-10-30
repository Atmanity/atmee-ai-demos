// Math Club: a child talks with Mochi inside a game. Each level is a different
// game. The game runs here and Mochi's tools move it; the screen shows Mochi
// jumping, what Mochi heard, and the world answering. Children do not type or
// tap the maths: they talk.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackToApps, CallControls, CallStatus, ChatPanel, HostVideo, useAvatar, type ToolCall } from '../../../src/kit/index.ts';
import { clubState, opening, pressed } from '../engine/director.ts';
import { answer, explained, gameOf, GAMES, newClub, next, roundOf, setLevel, stepOf, type Club, type Fx, type Move } from '../engine/games.ts';
import mochi from '../host/portrait.jpg';
import { Cutout } from './Cutout.tsx';
import { World } from './Worlds.tsx';
import './club.css';

const HOST = 'Mochi';

function moveOf(c: Club, name: string, a: Record<string, unknown>): Move | null {
  switch (name) {
    case 'give_answer': return answer(c, a.answer);
    case 'child_explained': return explained(c);
    case 'next_round': return next(c);
    case 'set_level': return setLevel(c, a.level);
    default: return null;
  }
}

const BLURBS: Record<string, string> = {
  fireflies: 'Count the fireflies',
  blocks: 'Build sums with blocks',
  shop: 'Help run the shop',
  teach: 'Catch Mochi’s mistakes',
  cube: 'Unfold the cube',
};

function Star({ on }: { on: boolean }) {
  return <svg viewBox="0 0 24 24" className={on ? 'is-on' : ''} aria-hidden="true"><path d="M12 2l3 6.6 7 .8-5.2 4.8 1.4 7L12 17.7 5.8 21.2l1.4-7L2 9.4l7-.8z" /></svg>;
}

function Confetti() {
  const colours = ['#ffd166', '#ff7a59', '#fff7e6', '#6fd6b8', '#8fa8ff'];
  return <div className="mc-confetti" aria-hidden="true">{Array.from({ length: 48 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, background: colours[i % 5], animationDelay: `${(i * 73) % 900}ms` }} />)}</div>;
}

function Lobby({ onGo }: { onGo: (level: number) => void }) {
  const [level, setPick] = useState(1);
  return (
    <div className="mc-lobby">
      <header className="mc-lobby-top"><BackToApps /></header>
      <main>
        <section className="mc-hero">
          <div>
            <h1>Math<br />Club</h1>
            <p>Talk with Mochi. Solve it out loud. Watch Mochi jump.</p>
            <button type="button" className="mc-go" onClick={() => onGo(level)}>Talk to Mochi</button>
          </div>
          <Cutout image={mochi} className="mc-hero-mochi" />
        </section>
        <ul className="mc-games">
          {GAMES.map((g) => (
            <li key={g.id}>
              <button type="button" data-game={g.id} className={level === g.level ? 'is-on' : ''} aria-pressed={level === g.level} onClick={() => setPick(g.level)}>
                <small>Level {g.level} · age {g.age}</small><b>{g.title}</b><span>{BLURBS[g.id]}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mc-grown">For grown-ups: Mochi hears everything said during a game, and a button mutes the microphone. There is no account, and Mochi never asks for personal details.</p>
      </main>
    </div>
  );
}

export function App() {
  const [club, setClub] = useState<Club>(() => newClub());
  const [fx, setFx] = useState<Fx[]>([]);
  const [fxKey, setFxKey] = useState(0);
  const ref = useRef(club);
  const body = useRef<HTMLDivElement>(null);

  const leap = useCallback((high: boolean) => {
    body.current?.animate([
      { transform: 'translateY(0) scale(1.08, .9)' },
      { transform: `translateY(${high ? -42 : -26}%) scale(.94, 1.08)`, offset: .45 },
      { transform: 'translateY(0) scale(1.12, .86)', offset: .8 },
      { transform: 'translateY(0) scale(1)' },
    ], { duration: 720, easing: 'ease-out' });
  }, []);
  const tumble = useCallback(() => {
    body.current?.animate([
      { transform: 'rotate(0)' }, { transform: 'translateX(-5%) rotate(-12deg)' }, { transform: 'translateX(5%) rotate(10deg)' }, { transform: 'rotate(0)' },
    ], { duration: 620, easing: 'ease-in-out' });
  }, []);

  // The game moves here first, so two calls in one breath each see the last one's result.
  const apply = useCallback((name: string, args: Record<string, unknown>) => {
    const move = moveOf(ref.current, name, args);
    if (!move) return null;
    ref.current = move.club;
    setClub(move.club);
    if (move.fx.length) { setFx(move.fx); setFxKey((k) => k + 1); }
    if (move.fx.includes('jump')) { leap(move.fx.includes('star')); if (move.fx.includes('star')) setTimeout(() => leap(true), 760); }
    if (move.fx.includes('tumble')) tumble();
    return move;
  }, [leap, tumble]);

  // An answer counts only if the child said something since the last one: the host must not answer for them.
  const spoke = useRef(false);
  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall) => {
    if (name === 'give_answer' || name === 'child_explained') {
      if (!spoke.current) return 'Not yet: the child has not said anything. Wait for them, and do not say the answer.';
      spoke.current = false;
    }
    return apply(name, (args ?? {}) as Record<string, unknown>)?.outcome ?? `Not a game tool: ${name}.`;
  }, [apply]);
  const avatar = useAvatar('math-club', { onToolCall, onUserSaid: () => { spoke.current = true; } });
  const live = avatar.phase === 'live';

  const press = (name: string, args: Record<string, unknown> = {}) => {
    const move = apply(name, args);
    if (move && live) avatar.event(pressed(move.outcome), 30);
  };

  const opened = useRef(false);
  useEffect(() => {
    if (avatar.phase === 'idle' || avatar.phase === 'starting') opened.current = false;
    if (live && !opened.current) { opened.current = true; avatar.event(opening(ref.current), 60); }
  }, [avatar.phase, live]);
  useEffect(() => { if (live) avatar.state(clubState(club)); }, [club, live]);

  const typing = new URLSearchParams(location.search).has('type');
  if (avatar.phase === 'idle') {
    return <Lobby onGo={(level) => { const c = newClub(level); ref.current = c; setClub(c); void avatar.start({ mic: !typing }); }} />;
  }

  const game = gameOf(club);
  const round = roundOf(club);
  const said = avatar.heard || [...avatar.lines].reverse().find((l) => l.who === 'user')?.text || '';
  return (
    <div className="mc-app" data-game={game.id}>
      <div className="mc-sky" aria-hidden="true" />
      <header className="mc-hud">
        <BackToApps avatar={avatar} name={HOST} />
        <div className="mc-title"><small>Level {club.level}</small><b>{game.title}</b></div>
        <div className="mc-stars" aria-label={`${club.stars} of ${game.rounds.length} stars`}>{game.rounds.map((_, i) => <Star key={i} on={i < club.stars} />)}</div>
      </header>

      {club.done ? (
        <div className="mc-finish">
          <h2>{club.stars} stars!</h2>
          {club.level < GAMES.length && <button type="button" className="mc-go" onClick={() => press('set_level', { level: club.level + 1 })}>Next game: {GAMES[club.level].title}</button>}
        </div>
      ) : (
        <>
          <div className="mc-card" key={`${club.level}-${club.round}-${club.step}`}>
            <p className="mc-intro">{round.intro}</p>
            <h2>{club.solved ? 'You did it!' : stepOf(club).ask.replace(/^Say you are sure\. Ask: /, '').replace(/^Ask them to teach you why your answer was wrong\.$/, 'Why was Mochi wrong? Teach Mochi!')}</h2>
            {round.steps.length > 1 && <ol className="mc-steps">{round.steps.map((_, i) => <li key={i} className={i < club.step || club.solved ? 'done' : i === club.step ? 'now' : ''} />)}</ol>}
          </div>
          <World id={game.id} club={club} />
        </>
      )}

      <div className={`mc-mochi ${avatar.speaking ? 'is-talking' : ''}`}>
        {live && avatar.caption && <p className="mc-bubble">{avatar.caption}</p>}
        <div ref={body} className="mc-body"><Cutout video={avatar.videoRef} image={mochi} /></div>
        <i className="mc-shadow" />
      </div>
      <div className="mc-call"><HostVideo avatar={avatar} name={HOST} captions={false} className="mc-host-video"><CallStatus avatar={avatar} name={HOST} again="Call Mochi again" /></HostVideo></div>

      <footer className="mc-dock">
        {!typing && live && (
          <>
            <div className={`mc-ear ${avatar.micOn ? 'is-on' : ''}`}><i /><p aria-live="polite">{said ? <>“{said}”</> : avatar.micOn ? 'Mochi is listening. Say something!' : 'The microphone is off'}</p></div>
            <CallControls avatar={avatar} className="mc-mic" />
          </>
        )}
        {typing && <ChatPanel avatar={avatar} name={HOST} className="mc-chat" placeholder="Say something to Mochi" />}
        {club.solved && !club.done && <button type="button" className="mc-go mc-next" onClick={() => press('next_round')}>Next</button>}
      </footer>

      {fx.includes('star') && <svg key={fxKey} className="mc-fly" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 6.6 7 .8-5.2 4.8 1.4 7L12 17.7 5.8 21.2l1.4-7L2 9.4l7-.8z" /></svg>}
      {(fx.includes('star') || fx.includes('finish')) && <Confetti key={`c${fxKey}`} />}
    </div>
  );
}
