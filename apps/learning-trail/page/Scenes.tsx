// The four scenes, hand-drawn in SVG like cut paper. Each is a game the child
// plays by voice or by big buttons; the trail says what happens, these show it.
import type { CSSProperties, ReactNode } from 'react';
import { CLAIMS, LAYERS, PUMPS, ROCKS, type Trail } from '../engine/trail.ts';

export type Act = (move: { name: string; value?: string }) => void;
interface SceneProps { trail: Trail; onAct: Act }

const Big = ({ children, onClick, tone = '', disabled }: { children: ReactNode; onClick: () => void; tone?: string; disabled?: boolean }) => (
  <button type="button" className={`tm-big ${tone}`} onClick={onClick} disabled={disabled}>{children}</button>
);

const MAGMA_TOP = [262, 212, 162, 96];

export function Boom({ trail, onAct }: SceneProps) {
  const top = MAGMA_TOP[Math.min(trail.pressure, PUMPS)];
  return (
    <div className={`tm-scene ${trail.erupted ? 'is-erupted' : ''}`} data-scene="boom">
      <svg viewBox="0 0 640 400" preserveAspectRatio="xMidYMid slice" role="img" aria-label={trail.erupted ? 'The volcano is erupting' : `A volcano with its pressure at ${trail.pressure} of ${PUMPS}`}>
        <rect width="640" height="400" className="sky" />
        <g className="tm-cloud"><ellipse cx="110" cy="64" rx="56" ry="18" /><ellipse cx="146" cy="52" rx="34" ry="18" /></g>
        <g className="tm-cloud slow"><ellipse cx="510" cy="88" rx="62" ry="17" /><ellipse cx="478" cy="76" rx="30" ry="15" /></g>
        {trail.erupted && <g className="tm-ash">{[0, 1, 2, 3, 4, 5].map((i) => <circle key={i} cx={270 + i * 20} cy={70} r={22 + (i % 3) * 8} style={{ '--i': i } as CSSProperties} />)}</g>}
        {trail.erupted && <g className="tm-spray">{Array.from({ length: 16 }, (_, i) => <circle key={i} cx="320" cy="104" r={5 + (i % 3) * 3} style={{ '--a': `${(i - 7.5) * 11}deg`, '--i': i } as CSSProperties} />)}</g>}
        <path d="M0 400 L0 320 L180 300 L276 106 L364 106 L460 300 L640 320 L640 400 Z" className="hill" />
        <path d="M216 226 L424 226 L444 268 L196 268 Z" className="band" />
        {[[70, 300], [110, 306], [530, 306], [572, 300], [150, 312], [490, 312]].map(([x, y]) => <path key={x} d={`M${x} ${y - 46} L${x + 18} ${y} L${x - 18} ${y} Z`} className="pine" />)}
        <path d="M276 106 L298 150 L316 128 L338 158 L364 106 Z" className={trail.erupted ? 'cap hot' : 'cap'} />
        <clipPath id="tm-pipe"><path d="M308 106 L332 106 L340 262 C390 270 410 310 320 330 C230 310 250 270 300 262 Z" /></clipPath>
        <path d="M308 106 L332 106 L340 262 C390 270 410 310 320 330 C230 310 250 270 300 262 Z" className="pipe" />
        <g clipPath="url(#tm-pipe)">
          <rect x="220" y={top} width="200" height="240" className="magma" />
          {Array.from({ length: trail.pressure * 3 }, (_, i) => <circle key={i} cx={300 + (i * 17) % 44} cy={320} r={4 + i % 3} className="tm-bubble" style={{ '--i': i } as CSSProperties} />)}
        </g>
        {trail.erupted && <path d="M308 106 C296 150 262 210 246 300 L282 300 C296 230 310 170 320 130 C330 170 350 230 364 300 L396 300 C378 210 344 150 332 106 Z" className="flow" />}
      </svg>
      <div className="tm-gauge" aria-hidden="true"><span>Pressure</span><i style={{ width: `${(trail.pressure / PUMPS) * 100}%` }} /></div>
      <div className="tm-actions">
        <Big onClick={() => onAct({ name: 'pump_volcano' })} disabled={trail.erupted} tone="hot">{trail.erupted ? 'Kaboom!' : 'Pump the gas!'}</Big>
      </div>
    </div>
  );
}

const RINGS = ['#fff0a8', '#f5b81f', '#e8590c', '#7a5230'];
const SIZES = [38, 74, 124, 138];

export function Layers({ trail, onAct }: SceneProps) {
  return (
    <div className="tm-scene" data-scene="layers">
      <svg viewBox="0 0 640 400" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`The Earth with ${trail.layers} of ${LAYERS.length} layers built`}>
        <rect width="640" height="400" className="ground" />
        {Array.from({ length: 22 }, (_, i) => <circle key={i} cx={(i * 97) % 640} cy={(i * 61) % 400} r={2 + i % 3} className="speck" />)}
        <circle cx="320" cy="200" r="152" className="socket" />
        {LAYERS.map((l, i) => i < trail.layers && <circle key={l.id} className="tm-ring" cx="320" cy="200" r={SIZES[i]} fill={RINGS[i]} />).reverse()}
        {trail.layers === LAYERS.length && <path className="tm-land" d="M240 96 q40 -24 76 -8 q24 18 -8 36 q-40 12 -68 -28 Z M360 230 q44 -20 76 12 q6 40 -40 50 q-44 -14 -36 -62 Z" />}
      </svg>
      <div className="tm-actions">
        {LAYERS.map((l, i) => <Big key={l.id} tone={i < trail.layers ? 'done' : ''} disabled={i < trail.layers} onClick={() => onAct({ name: 'add_layer', value: l.name })}>{l.name}</Big>)}
      </div>
    </div>
  );
}

export function Silly({ trail, onAct }: SceneProps) {
  const claim = CLAIMS[Math.min(trail.claim, CLAIMS.length - 1)];
  const done = trail.claim >= CLAIMS.length;
  return (
    <div className="tm-scene" data-scene="silly">
      <svg viewBox="0 0 640 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="640" height="400" className="sky" />
        <path d="M0 400 L0 250 Q320 170 640 250 L640 400 Z" className="river" />
        <path d="M40 262 Q320 180 600 262" className="rope" />
        {Array.from({ length: 12 }, (_, i) => <rect key={i} x={70 + i * 42} y={236 - Math.sin((i + 0.5) / 12 * Math.PI) * 48} width="30" height="46" rx="5" className="plank" />)}
      </svg>
      <blockquote className="tm-claim" key={trail.claim}>{done ? `You checked them all! ${trail.caught} of ${CLAIMS.length} right.` : claim.line}</blockquote>
      <div className="tm-actions">
        <Big tone="hot" disabled={done} onClick={() => onAct({ name: 'judge_claim', value: 'silly' })}>Nope, silly!</Big>
        <Big tone="good" disabled={done} onClick={() => onAct({ name: 'judge_claim', value: 'true' })}>That's true!</Big>
      </div>
    </div>
  );
}

const ROCK_ART: Record<string, ReactNode> = {
  pumice: <><path d="M16 74 Q4 34 44 22 Q88 6 110 46 Q124 84 76 92 Q34 100 16 74 Z" fill="#d9d2c1" />{[[40, 44], [66, 34], [86, 56], [52, 68], [32, 62], [72, 74]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="5" fill="#a89d88" />)}</>,
  obsidian: <><path d="M20 80 L38 22 L88 12 L114 58 L84 92 Z" fill="#23202b" /><path d="M38 22 L88 12 L66 52 Z" fill="#4c4860" /><path d="M66 52 L114 58 L84 92 Z" fill="#35324a" /></>,
  basalt: <><path d="M14 80 L24 36 L62 18 L104 32 L116 76 L70 94 Z" fill="#54565c" /><path d="M24 36 L62 18 L58 54 Z" fill="#6c6f76" /><path d="M58 54 L104 32 L116 76 Z" fill="#46484d" /></>,
};

export function Rocks({ trail, onAct }: SceneProps) {
  const done = trail.rock >= ROCKS.length;
  const rock = ROCKS[Math.min(trail.rock, ROCKS.length - 1)];
  return (
    <div className="tm-scene tm-camp" data-scene="rocks">
      <svg viewBox="0 0 640 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="640" height="400" className="dusk" />
        <path d="M0 400 L0 290 Q320 250 640 290 L640 400 Z" className="hill" />
        <path d="M90 300 L170 170 L250 300 Z" className="tent" /><path d="M170 170 L150 300 L190 300 Z" className="tent-door" />
        <g className="tm-fire"><path d="M500 300 q-34 -40 0 -92 q34 52 0 92 Z" /><path d="M500 300 q-14 -20 0 -44 q14 24 0 44 Z" className="inner" /></g>
      </svg>
      <blockquote className="tm-claim" key={trail.rock}>{done ? 'Case closed, detective!' : rock.clue}</blockquote>
      <div className="tm-rocks">
        {ROCKS.map((r, i) => (
          <button key={r.id} type="button" className={`tm-rock ${i < trail.rock ? 'found' : ''}`} disabled={i < trail.rock} onClick={() => onAct({ name: 'pick_rock', value: r.name })}>
            <svg viewBox="0 0 130 104" aria-hidden="true">{ROCK_ART[r.id]}</svg>
            <span>{r.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A sticker, drawn: one for each stop. */
export function Sticker({ id, size = 58 }: { id: string; size?: number }) {
  const art: Record<string, ReactNode> = {
    boom: <><path d="M14 66 L32 22 L48 22 L66 66 Z" fill="#7a5230" /><path d="M34 22 q6 -16 12 0 q-2 12 -12 0" fill="#e8590c" /><circle cx="26" cy="12" r="4" fill="#f5b81f" /><circle cx="54" cy="10" r="3" fill="#f5b81f" /></>,
    layers: <><circle cx="40" cy="40" r="28" fill="#7a5230" /><circle cx="40" cy="40" r="20" fill="#e8590c" /><circle cx="40" cy="40" r="11" fill="#f5b81f" /></>,
    silly: <><circle cx="40" cy="40" r="28" fill="#f5b81f" /><circle cx="30" cy="34" r="4" fill="#4a2a1a" /><circle cx="50" cy="34" r="4" fill="#4a2a1a" /><path d="M26 50 q14 14 28 0" fill="#e8590c" /></>,
    rocks: <><circle cx="34" cy="34" r="20" fill="none" stroke="#4a2a1a" strokeWidth="7" /><path d="M50 50 L68 68" stroke="#4a2a1a" strokeWidth="9" strokeLinecap="round" /><circle cx="34" cy="34" r="14" fill="#bfe6e4" /></>,
  };
  return <svg viewBox="0 0 80 80" width={size} height={size} className="tm-sticker" aria-hidden="true"><circle cx="40" cy="40" r="39" fill="#fdf3dc" />{art[id]}</svg>;
}
