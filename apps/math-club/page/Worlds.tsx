// The five worlds. Each draws what the game has reached so far; the answers
// the child has not found yet are never on screen.
import type { CSSProperties } from 'react';
import type { Club, GameId, Round } from '../engine/games.ts';
import { roundOf } from '../engine/games.ts';
import apple from '../art/apple.webp';
import basket from '../art/basket.webp';
import carrot from '../art/carrot.webp';
import coin from '../art/coin.webp';
import honey from '../art/honey.webp';
import jar from '../art/jar.webp';
import one from '../art/one.webp';
import rod from '../art/rod.webp';
import scale from '../art/scale.webp';
import slate from '../art/slate.webp';

const style = (v: Record<string, string | number>) => v as CSSProperties;

function Fireflies({ round, solved }: { round: Round; solved: boolean }) {
  return (
    <div className="w-prop w-flies">
      {Array.from({ length: round.n }, (_, i) => <i key={i} className={`w-fly ${solved ? 'is-caught' : ''}`} style={style({ '--x': `${12 + (i * 37) % 76}%`, '--y': `${6 + (i * 53) % 52}%`, '--d': `${i * .37}s` })} />)}
      <div className={`w-jar ${solved ? 'is-lit' : ''}`}><img src={jar} alt="" /></div>
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
      <div className="w-sum">{a} + {b}{solved ? ` = ${a + b}` : ''}</div>
      <div className="w-bench">
        <div className="w-rods">{Array.from({ length: rods }, (_, i) => <img key={i} src={rod} alt="" className={swapped && i === rods - 1 ? 'is-new' : ''} />)}</div>
        <div className="w-ones">{Array.from({ length: loose }, (_, i) => <img key={i} src={one} alt="" className={!swapped && i >= a % 10 ? 'is-added' : ''} style={style({ '--d': `${i * 30}ms` })} />)}</div>
      </div>
    </div>
  );
}

const Coins = ({ n, paid }: { n: number; paid: boolean }) => <div className="w-coins">{Array.from({ length: n }, (_, i) => <img key={i} src={coin} alt="" className={paid ? 'is-paid' : ''} style={style({ '--d': `${i * 60}ms` })} />)}</div>;

function Shop({ round, solved }: { round: Round; solved: boolean }) {
  return (
    <div className="w-prop w-shop">
      {round.kind === 'scale' && (
        <div className="w-scale">
          <div className="w-pile">{Array.from({ length: solved ? 7 : 4 }, (_, i) => <img key={i} src={apple} alt="" />)}</div>
          <img src={scale} alt="" />
          <i className="w-needle" style={style({ '--turn': solved ? '150deg' : '60deg' })} />
          <b>{solved ? '3 kg 500 g' : '2 kg'}</b>
        </div>
      )}
      {round.kind === 'coins' && round.m === 100 && <div className="w-sale"><img src={honey} alt="" className="w-item" /><p>45</p><Coins n={5} paid={solved} /></div>}
      {round.kind === 'coins' && round.m === 3 && <div className="w-sale"><div className="w-pile">{[0, 1, 2].map((i) => <img key={i} src={apple} alt="" />)}</div><p>12</p><Coins n={5} paid={solved} /></div>}
      {round.kind === 'bags' && (
        <div className="w-bags">
          {Array.from({ length: round.n }, (_, b) => (
            <div key={b} className="w-bag"><div className="w-carrots">{Array.from({ length: round.m }, (_, c) => <img key={c} src={carrot} alt="" style={style({ '--r': `${(c - 2.5) * 9}deg` })} />)}</div><img src={basket} alt="" /></div>
          ))}
        </div>
      )}
    </div>
  );
}

function Slate({ round, step, solved }: { round: Round; step: number; solved: boolean }) {
  const claim = round.intro.replace('Mochi wrote on the slate: ', '');
  return (
    <div className="w-prop w-class">
      <div className="w-slate"><img src={slate} alt="" /><div><p className={step > 0 || solved ? 'is-wrong' : ''}>{claim}</p>{(step > 0 || solved) && <em>You fixed it!</em>}</div></div>
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
