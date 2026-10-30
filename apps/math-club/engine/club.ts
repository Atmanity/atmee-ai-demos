// Math Club's rules: two classes with one shape. The child builds the problem
// on screen (slices of a pizza, rows of a cookie tray) and the class decides
// when it is right. A button and a host's tool call make the same move.

export type ClassId = 'fractions' | 'times';
export type Fx = 'set' | 'right' | 'wrong' | 'star' | 'finish';

/** Fractions: a = slices cut, b = slices taken. Times: a = rows, b = cookies in each row. */
export interface Problem { story: string; a: number; b: number; exact?: boolean }

const pizza = (story: string, a: number, b: number): Problem => ({ story: `Take ${story} of the pizza.`, a, b });
/** Level 5: the same amount on a pizza cut a set way, so only that cut counts. */
const same = (fraction: string, a: number, b: number): Problem => ({ story: `Show ${fraction} on a pizza cut into ${a} slices.`, a, b, exact: true });
const tray = (a: number, b: number): Problem => ({ story: `Bake ${a} rows of ${b} cookies.`, a, b });

export const LEVELS = [
  { n: 1, age: '5–6' }, { n: 2, age: '6–7' }, { n: 3, age: '7–8' }, { n: 4, age: '8–9' }, { n: 5, age: '9–10+' },
];

/** Each class has one list of problems per level, easiest first. */
export const CLASSES: Record<ClassId, { title: string; thing: string; max: number; levels: Problem[][] }> = {
  fractions: {
    title: 'Pizza Fractions', thing: 'pizza', max: 12,
    levels: [
      [pizza('one half', 2, 1), pizza('one quarter', 4, 1), pizza('two quarters', 4, 2), pizza('three quarters', 4, 3)],
      [pizza('one third', 3, 1), pizza('two thirds', 3, 2), pizza('one eighth', 8, 1), pizza('three eighths', 8, 3)],
      [pizza('one sixth', 6, 1), pizza('five sixths', 6, 5), pizza('two fifths', 5, 2), pizza('five eighths', 8, 5)],
      [pizza('three tenths', 10, 3), pizza('seven tenths', 10, 7), pizza('five twelfths', 12, 5), pizza('eleven twelfths', 12, 11)],
      [same('three sixths', 2, 1), same('six eighths', 4, 3), same('four sixths', 3, 2), same('nine twelfths', 8, 6)],
    ],
  },
  times: {
    title: 'Cookie Times Tables', thing: 'cookie tray', max: 12,
    levels: [
      [tray(2, 2), tray(2, 5), tray(3, 2), tray(5, 2)],
      [tray(3, 4), tray(4, 3), tray(5, 5), tray(2, 10)],
      [tray(3, 6), tray(4, 6), tray(6, 5), tray(4, 4)],
      [tray(7, 3), tray(6, 7), tray(8, 4), tray(7, 7)],
      [tray(8, 7), tray(9, 6), tray(9, 8), tray(12, 7)],
    ],
  },
};

/** What the child chose to put on: their word, shown on the pizza or the cookies. */
export const TOPPINGS: Record<string, string> = { pepperoni: '#ef6c4d', mushroom: '#c9b8a3', olive: '#2b2b33', pineapple: '#ffe066', basil: '#4f9d69', chocolate: '#4a2a1a', sprinkles: '#ff7ab6', raisin: '#5b3a5e', strawberry: '#e63950', blueberry: '#3f5fbf' };

export interface Club { cls: ClassId; level: number; i: number; topping: string; misses: number; a: number; b: number; built: boolean; solved: boolean; stars: number; done: boolean }
export interface Move { club: Club; ok: boolean; outcome: string; fx: Fx[] }

export const newClub = (cls: ClassId = 'fractions', level = 1): Club => ({ cls, level, i: 0, topping: cls === 'fractions' ? 'pepperoni' : 'chocolate', misses: 0, a: 1, b: cls === 'fractions' ? 0 : 1, built: false, solved: false, stars: 0, done: false });
export const problems = (c: Club): Problem[] => CLASSES[c.cls].levels[c.level - 1];
export const problem = (c: Club): Problem => problems(c)[c.i];

const whole = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.-]/g, '') || NaN);
  return Number.isFinite(n) ? Math.round(n) : null;
};
export const classOf = (value: unknown): ClassId | null => {
  const said = String(value ?? '').toLowerCase();
  return /fraction|pizza/.test(said) ? 'fractions' : /times|cookie|multipl/.test(said) ? 'times' : null;
};

const star = (c: Club, words: string): Move => ({ club: { ...c, solved: true, stars: c.stars + 1 }, ok: true, outcome: `Right: ${words} A star went on the chart.`, fx: ['right', 'star'] });

/** Build the problem: any move of the pizza or the tray. A value left out stays as it is. */
export function build(c: Club, a: unknown, b: unknown): Move {
  if (c.done) return { club: c, ok: false, outcome: 'Not now: the class is finished.', fx: [] };
  if (c.solved) return { club: c, ok: false, outcome: 'Not needed: this one is solved. Ask if they want the next problem.', fx: [] };
  const max = CLASSES[c.cls].max;
  const nextA = Math.min(max, Math.max(1, whole(a) ?? c.a));
  const low = c.cls === 'fractions' ? 0 : 1;
  const nextB = Math.min(c.cls === 'fractions' ? nextA : max, Math.max(low, whole(b) ?? c.b));
  const after = { ...c, a: nextA, b: nextB };
  const p = problem(c);
  if (c.cls === 'fractions') {
    if (nextB * p.a === p.b * nextA && (!p.exact || nextA === p.a)) {
      const same = nextA !== p.a ? ` ${nextB} out of ${nextA} is the same amount as ${p.b} out of ${p.a}, which is a clever find.` : '';
      return star(after, `${nextB} out of ${nextA} slices is exactly right.${same}`);
    }
    return { club: after, ok: true, outcome: `Done: the pizza has ${nextA} slices and ${nextB} taken. Not the amount asked for yet.`, fx: ['set'] };
  }
  const built = (nextA === p.a && nextB === p.b) || (nextA === p.b && nextB === p.a);
  const flipped = built && nextA !== p.a ? ' The tray is turned around, and the total stays the same.' : '';
  return {
    club: { ...after, built }, ok: true,
    outcome: built ? `Right: the tray matches.${flipped} Ask how many cookies there are altogether. Do not say the total.` : `Done: the tray has ${nextA} rows of ${nextB}. It does not match the problem yet.`,
    fx: built ? ['right'] : ['set'],
  };
}

/** The child's total for a built cookie tray. */
export function total(c: Club, value: unknown): Move {
  if (c.cls !== 'times' || c.done) return { club: c, ok: false, outcome: 'Not here: this class has no total to give.', fx: [] };
  if (c.solved) return { club: c, ok: false, outcome: 'Not needed: this one is solved.', fx: [] };
  if (!c.built) return { club: c, ok: false, outcome: 'Not yet: the tray has to match the problem first.', fx: [] };
  const n = whole(value);
  if (n === null) return { club: c, ok: false, outcome: 'Not clear: ask how many cookies again.', fx: [] };
  if (n !== c.a * c.b) {
    const misses = c.misses + 1;
    return { club: { ...c, misses }, ok: false, outcome: `Not quite: ${n} is not it. ${misses >= 2 ? 'Offer to count together, one row at a time, out loud.' : 'Give one small hint.'} Do not say the total.`, fx: ['wrong'] };
  }
  return star(c, `${c.a} times ${c.b} is ${n}.`);
}

export function next(c: Club): Move {
  if (c.done) return { club: c, ok: false, outcome: 'Not now: the class is finished.', fx: [] };
  if (!c.solved) return { club: c, ok: false, outcome: 'Not yet: finish this problem first.', fx: [] };
  if (c.i + 1 >= problems(c).length) return { club: { ...c, done: true }, ok: true, outcome: `Done: level ${c.level} is finished with ${c.stars} stars.${c.level >= LEVELS.length ? ' That is the top level.' : c.misses === 0 ? ` No mistakes at all, so dare them to try level ${c.level + 1}.` : ` Ask if they want level ${c.level + 1}.`}`, fx: ['finish'] };
  const after = { ...newClub(c.cls, c.level), i: c.i + 1, stars: c.stars, topping: c.topping, misses: c.misses };
  return { club: after, ok: true, outcome: `Done: next problem. ${problem(after).story}`, fx: ['set'] };
}

export function choose(c: Club, value: unknown): Move {
  const cls = classOf(value);
  if (!cls) return { club: c, ok: false, outcome: 'Not clear: ask if they want Pizza Fractions or Cookie Times Tables.', fx: [] };
  if (cls === c.cls && !c.done) return { club: c, ok: true, outcome: `Done: we are already in ${CLASSES[cls].title}.`, fx: [] };
  const club = newClub(cls, c.level);
  return { club, ok: true, outcome: `Done: ${CLASSES[cls].title} is on the screen. ${problem(club).story}`, fx: ['set'] };
}

/** Moves to a level from 1 to 5, or the next one when the child only says harder or easier. */
export function setLevel(c: Club, value: unknown): Move {
  const said = String(value ?? '').toLowerCase();
  const asked = /hard|up|next|more/.test(said) ? c.level + 1 : /eas|down|less/.test(said) ? c.level - 1 : whole(value);
  if (asked === null) return { club: c, ok: false, outcome: `Not clear: ask which level from 1 to ${LEVELS.length}.`, fx: [] };
  const level = Math.min(LEVELS.length, Math.max(1, asked));
  if (level === c.level && !c.done) return { club: c, ok: true, outcome: `Done: we are already on level ${level}.`, fx: [] };
  const club = newClub(c.cls, level);
  return { club, ok: true, outcome: `Done: level ${level}. ${problem(club).story}`, fx: ['set'] };
}

/** Puts the child's favourite on the pizza or the cookies, in their own word. */
export function setTopping(c: Club, value: unknown): Move {
  const said = String(value ?? '').toLowerCase();
  const topping = Object.keys(TOPPINGS).find((t) => said.includes(t) || said.includes(t.replace(/s$/, '')));
  if (!topping) return { club: c, ok: false, outcome: `Not on the shelf: laugh about it, then offer ${Object.keys(TOPPINGS).filter((t) => (c.cls === 'fractions') === Object.keys(TOPPINGS).indexOf(t) < 5).join(', ')}.`, fx: [] };
  return { club: { ...c, topping }, ok: true, outcome: `Done: ${topping} is on. Say you love it, then give the problem.`, fx: ['set'] };
}
