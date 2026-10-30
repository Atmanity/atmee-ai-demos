// The five worlds. Each draws what the game has reached so far; the answers
// the child has not found yet are never on screen.
import type { CSSProperties } from 'react';
import type { Club, GameId, Round } from '../engine/games.ts';
import { roundOf } from '../engine/games.ts';

const style = (v: Record<string, string | number>) => v as CSSProperties;

function Fireflies({ round, solved }: { round: Round; solved: boolean }) {
  return (
    <div className="w-prop w-flies">
      <div className="w-moon" />
      {Array.from({ length: round.n }, (_, i) => <i key={i} className={`w-fly ${solved ? 'is-caught' : ''}`} style={style({ '--x': `${12 + (i * 37) % 76}%`, '--y': `${10 + (i * 53) % 58}%`, '--d': `${i * .37}s` })} />)}
      <div className={`w-jar ${solved ? 'is-lit' : ''}`}><b /></div>
    </div>
  );
}

function Blocks({ round, step, solved }: { round: Round; step: number; solved: boolean }) {
  const { n: a, m: b } = round;
  const ones = (a % 10) + b;
  const swapped = step >= 2 || solved;
  const rods = Math.floor(a / 10) + (swapped ? 1 : 0);
  const loose = swapped ? ones - 10 : ones;
  return (
    <div className="w-prop w-blocks">
      <div className="w-sum">{a} + {b}</div>
      <div className="w-bench">
        <div className="w-col"><small>Tens</small><div className="w-rods">{Array.from({ length: rods }, (_, i) => <i key={i} className={swapped && i === rods - 1 ? 'is-new' : ''} />)}</div></div>
        <div className="w-col"><small>Ones</small><div className="w-ones">{Array.from({ length: loose }, (_, i) => <i key={i} className={!swapped && i >= a % 10 ? 'is-added' : ''} style={style({ '--d': `${i * 30}ms` })} />)}</div></div>
      </div>
      {solved && <div className="w-result">{a + b}</div>}
    </div>
  );
}

function Shop({ round, solved }: { round: Round; solved: boolean }) {
  return (
    <div className="w-prop w-shop">
      <div className="w-awning" />
      <div className="w-counter">
        {round.kind === 'scale' && (
          <div className="w-scale"><div className="w-dial" style={style({ '--turn': solved ? '150deg' : '60deg' })}><i /></div><div className="w-apples">{Array.from({ length: solved ? 7 : 4 }, (_, i) => <span key={i} />)}</div><b>{solved ? '3 kg 500 g' : '2 kg'}</b></div>
        )}
        {round.kind === 'coins' && <div className="w-coins"><div className="w-price">{round.m === 100 ? 'Honey: 45' : '3 apples: 12'}</div>{Array.from({ length: 8 }, (_, i) => <i key={i} style={style({ '--d': `${i * 60}ms` })} className={solved ? 'is-paid' : ''} />)}</div>}
        {round.kind === 'bags' && <div className="w-bags">{Array.from({ length: round.n }, (_, b) => <div key={b} className="w-bag">{Array.from({ length: round.m }, (_, c) => <i key={c} />)}</div>)}</div>}
      </div>
    </div>
  );
}

function Slate({ round, step, solved }: { round: Round; step: number; solved: boolean }) {
  const claim = round.intro.replace('Mochi wrote on the slate: ', '');
  return (
    <div className="w-prop w-class">
      <div className="w-slate"><p className={step > 0 || solved ? 'is-wrong' : ''}>{claim}</p>{(step > 0 || solved) && <em>You fixed it!</em>}</div>
    </div>
  );
}

function Cube({ round, step, solved }: { round: Round; step: number; solved: boolean }) {
  const open = step >= 1 || solved;
  return (
    <div className="w-prop w-lab">
      <div className={`w-cube ${open ? 'is-open' : ''}`}>
        {['front', 'top', 'bottom', 'left', 'right', 'back'].map((f) => <i key={f} className={`f-${f}`}>{step >= 2 || solved ? round.n * round.n : ''}</i>)}
      </div>
      <p className="w-label">Side: {round.n}{solved ? ` · All six: ${6 * round.n * round.n}` : ''}</p>
    </div>
  );
}

export function World({ id, club }: { id: GameId; club: Club }) {
  const round = roundOf(club);
  return (
    <>
      {id === 'fireflies' && <Fireflies round={round} solved={club.solved} />}
      {id === 'blocks' && <Blocks round={round} step={club.step} solved={club.solved} />}
      {id === 'shop' && <Shop round={round} solved={club.solved} />}
      {id === 'teach' && <Slate round={round} step={club.step} solved={club.solved} />}
      {id === 'cube' && <Cube round={round} step={club.step} solved={club.solved} />}
    </>
  );
}
