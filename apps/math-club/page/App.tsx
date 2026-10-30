// Math Club: Mochi teaches fractions with a pizza and times tables with a
// cookie tray. The class runs here; Mochi's tools and the child's big buttons
// make the same moves. Children do not type: the call joins with the microphone
// shut, and a big button opens it while held.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackToApps, CallControls, CallStatus, ChatPanel, HostVideo, useAvatar, type ToolCall } from '../../../src/kit/index.ts';
import { build, choose, CLASSES, LEVELS, newClub, next, problem, problems, setLevel, setTopping, TOPPINGS, total, type ClassId, type Club, type Fx, type Move } from '../engine/club.ts';
import { clubState, opening, pressed } from '../engine/director.ts';
import mochi from '../host/portrait.jpg';
import './club.css';

const HOST = 'Mochi';

function moveOf(c: Club, name: string, a: Record<string, unknown>): Move | null {
  switch (name) {
    case 'set_pizza': return build(c, a.slices, a.taken);
    case 'set_tray': return build(c, a.rows, a.each);
    case 'check_total': return total(c, a.total);
    case 'next_problem': return next(c);
    case 'choose_class': return choose(c, a.class);
    case 'set_level': return setLevel(c, a.level);
    case 'set_topping': return setTopping(c, a.topping);
    default: return null;
  }
}

/** A wedge from the centre of a pizza of radius r, as an SVG path. */
function wedge(i: number, n: number, r: number) {
  if (n === 1) return `M0 ${-r} A${r} ${r} 0 1 1 -0.01 ${-r} Z`;
  const at = (k: number) => { const t = (k / n) * 2 * Math.PI - Math.PI / 2; return `${(Math.cos(t) * r).toFixed(2)} ${(Math.sin(t) * r).toFixed(2)}`; };
  return `M0 0 L${at(i)} A${r} ${r} 0 ${n === 2 ? 0 : 0} 1 ${at(i + 1)} Z`;
}

function Pizza({ slices, taken, topping = 'pepperoni' }: { slices: number; taken: number; topping?: string }) {
  return (
    <svg viewBox="-130 -130 260 260" className="mc-pizza" role="img" aria-label={`A pizza cut into ${slices} slices with ${taken} taken`}>
      {Array.from({ length: slices }, (_, i) => {
        const mid = ((i + 0.5) / slices) * 2 * Math.PI - Math.PI / 2;
        const out = i < taken ? 22 : 0;
        return (
          <g key={`${slices}-${i}`} className={`mc-slice ${i < taken ? 'is-taken' : ''}`} style={{ transform: `translate(${Math.cos(mid) * out}px, ${Math.sin(mid) * out}px)` }}>
            <path d={wedge(i, slices, 104)} className="crust" />
            <path d={wedge(i, slices, 92)} className="cheese" />
            {[0, 1, 2].map((k) => { const t = ((i + 0.25 + k * 0.25) / slices) * 2 * Math.PI - Math.PI / 2; const d = 42 + (k % 2) * 26; return <circle key={k} cx={Math.cos(t) * d} cy={Math.sin(t) * d} r={7} fill={TOPPINGS[topping]} />; })}
          </g>
        );
      })}
    </svg>
  );
}

function Tray({ rows, each, topping = 'chocolate' }: { rows: number; each: number; topping?: string }) {
  return (
    <div className="mc-tray" role="img" aria-label={`A tray with ${rows} rows of ${each} cookies`} style={{ gridTemplateColumns: `repeat(${each}, 1fr)`, aspectRatio: `${each} / ${rows}` }}>
      {Array.from({ length: rows * each }, (_, i) => <svg key={`${each}-${i}`} viewBox="0 0 40 40" className="mc-cookie" style={{ animationDelay: `${i * 22}ms` }} aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#d9964b" /><circle cx="13" cy="14" r="3.2" fill={TOPPINGS[topping]} /><circle cx="26" cy="12" r="2.6" fill={TOPPINGS[topping]} /><circle cx="24" cy="26" r="3.4" fill={TOPPINGS[topping]} /><circle cx="12" cy="27" r="2.4" fill={TOPPINGS[topping]} /></svg>)}
    </div>
  );
}

function Confetti() {
  const colours = ['#ffd166', '#ef6c4d', '#f4f1e6', '#7fc8a9'];
  return <div className="mc-confetti" aria-hidden="true">{Array.from({ length: 36 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, background: colours[i % 4], animationDelay: `${(i * 73) % 900}ms` }} />)}</div>;
}

function Lobby({ onGo }: { onGo: (cls: ClassId, level: number) => void }) {
  const [cls, setCls] = useState<ClassId>('fractions');
  const [level, setLevelPick] = useState(1);
  return (
    <div className="mc-lobby">
      <header className="mc-top"><BackToApps /><span className="mc-logo">Math Club</span></header>
      <main>
        <img src={mochi} alt="Mochi, a red panda teacher with a yellow neckerchief" className="mc-face" />
        <h1>Maths you can eat.</h1>
        <p>Just talk to Mochi. Mochi listens, asks you questions, and cuts the pizza the way you say.</p>
        <div className="mc-classes">
          {(Object.keys(CLASSES) as ClassId[]).map((id) => (
            <button key={id} type="button" className={cls === id ? 'is-on' : ''} aria-pressed={cls === id} onClick={() => setCls(id)}>
              <span className="mc-thumb">{id === 'fractions' ? <Pizza slices={4} taken={1} /> : <Tray rows={2} each={3} />}</span>
              <b>{CLASSES[id].title}</b>
            </button>
          ))}
        </div>
        <div className="mc-levels" role="group" aria-label="Choose a level">
          {LEVELS.map((l) => <button key={l.n} type="button" className={level === l.n ? 'is-on' : ''} aria-pressed={level === l.n} onClick={() => setLevelPick(l.n)}><b>{l.n}</b><span>age {l.age}</span></button>)}
        </div>
        <button type="button" className="mc-big" onClick={() => onGo(cls, level)}>Talk to Mochi</button>
        <p className="mc-grown">For grown-ups: Mochi hears everything said while a class is on, and a button mutes the microphone. There is no account, and Mochi never asks for personal details.</p>
      </main>
    </div>
  );
}

export function App() {
  const [club, setClub] = useState<Club>(() => newClub());
  const [fx, setFx] = useState<Fx[]>([]);
  const [fxKey, setFxKey] = useState(0);
  const ref = useRef(club);

  // The class moves here first, so two calls in one breath each see the last one's result.
  const apply = useCallback((name: string, args: Record<string, unknown>) => {
    const move = moveOf(ref.current, name, args);
    if (!move) return null;
    ref.current = move.club;
    setClub(move.club);
    if (move.fx.length) { setFx(move.fx); setFxKey((k) => k + 1); }
    return move;
  }, []);

  // A total counts only if the child said something since the last one: the host must not answer for them.
  const spoke = useRef(false);
  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall) => {
    if (name === 'check_total') {
      if (!spoke.current) return 'Not yet: the child has not said a number. Wait for them, and do not say the total.';
      spoke.current = false;
    }
    return apply(name, (args ?? {}) as Record<string, unknown>)?.outcome ?? `Not a class tool: ${name}.`;
  }, [apply]);
  const avatar = useAvatar('math-club', { onToolCall, onUserSaid: () => { spoke.current = true; } });
  const live = avatar.phase === 'live';

  // A button acts at once; Mochi cannot see the screen, so Mochi is told.
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
    return <Lobby onGo={(cls, level) => { const c = newClub(cls, level); ref.current = c; setClub(c); const mic = !typing; void avatar.start({ mic }); }} />;
  }

  const cls = CLASSES[club.cls];
  const pizza = club.cls === 'fractions';
  const said = avatar.heard || [...avatar.lines].reverse().find((l) => l.who === 'user')?.text || '';
  return (
    <div className="mc-app">
      <header className="mc-top">
        <BackToApps avatar={avatar} name={HOST} />
        <span className="mc-logo">Math Club</span>
        <span className="mc-level">Level {club.level}</span>
        <button type="button" className="mc-switch" onClick={() => press('choose_class', { class: pizza ? 'times' : 'fractions' })}>{pizza ? CLASSES.times.title : CLASSES.fractions.title}</button>
        <ol className="mc-stars" aria-label={`${club.stars} of ${problems(club).length} stars`}>
          {problems(club).map((_, i) => <li key={i} className={i < club.stars ? 'won' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 6.6 7 .8-5.2 4.8 1.4 7L12 17.7 5.8 21.2l1.4-7L2 9.4l7-.8z" /></svg></li>)}
        </ol>
      </header>
      <main className="mc-main">
        <aside className="mc-side">
          <div className={`mc-host ${avatar.speaking ? 'is-talking' : ''}`}><HostVideo avatar={avatar} name={HOST} poster={mochi} className="mc-host-video"><CallStatus avatar={avatar} name={HOST} again="Call Mochi again" /></HostVideo></div>
          {!typing && live && (
            <div className="mc-ear">
              <p className={said ? 'is-heard' : ''} aria-live="polite">{said ? <><small>Mochi heard</small>“{said}”</> : <small>{avatar.micOn ? 'Mochi is listening. Say something!' : 'The microphone is off'}</small>}</p>
              <CallControls avatar={avatar} className="mc-mic" />
            </div>
          )}
          {typing && <ChatPanel avatar={avatar} name={HOST} placeholder="Say something to Mochi" />}
        </aside>
        <section className="mc-stage" aria-live="polite">
          {club.done ? (
            <div className="mc-finish">
              <img src={mochi} alt="" />
              <h2>{club.stars} stars! Top of the class!</h2>
              {club.level < LEVELS.length && <button type="button" className="mc-big" onClick={() => press('set_level', { level: club.level + 1 })}>Level {club.level + 1}</button>}
              <button type="button" className="mc-quiet" onClick={() => press('choose_class', { class: pizza ? 'times' : 'fractions' })}>Try {pizza ? CLASSES.times.title : CLASSES.fractions.title}</button>
            </div>
          ) : (
            <>
              <h2 className="mc-story" key={`${club.cls}${club.i}`}><small>Problem {club.i + 1}</small>{problem(club).story}</h2>
              <div className="mc-table">
                {pizza ? <Pizza slices={club.a} taken={club.b} topping={club.topping} /> : <Tray rows={club.a} each={club.b} topping={club.topping} />}
                {pizza && <p className="mc-fraction" aria-hidden="true"><b>{club.b}</b><i /><b>{club.a}</b></p>}
              </div>
              {club.solved && <button type="button" className="mc-big mc-next" onClick={() => press('next_problem')}>Next!</button>}
            </>
          )}
          {fx.includes('star') && <svg key={fxKey} className="mc-fly" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 6.6 7 .8-5.2 4.8 1.4 7L12 17.7 5.8 21.2l1.4-7L2 9.4l7-.8z" /></svg>}
          {(fx.includes('star') || fx.includes('finish')) && <Confetti key={`c${fxKey}`} />}
          {fx.includes('wrong') && <p className="mc-try" key={`w${fxKey}`}>Try again!</p>}
        </section>
      </main>
    </div>
  );
}
