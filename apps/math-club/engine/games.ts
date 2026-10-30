// Math Club's rules: one game per level, each a different way of teaching.
// A round is a ladder of steps. A wrong answer earns the next hint, never the
// answer, and the game alone decides what is right. Mochi performs.

export type GameId = 'fireflies' | 'blocks' | 'shop' | 'teach' | 'cube';
export type Fx = 'jump' | 'tumble' | 'star' | 'finish' | 'new';

/** One question. `answer` null: the child explains in their own words. */
export interface Step { ask: string; answer: number | null; hints: [string, string] }
export interface Round { intro: string; steps: Step[]; n: number; m: number; kind?: string }
export interface Game { id: GameId; level: number; age: string; title: string; role: string; rounds: Round[] }

const count = (n: number): Round => ({
  intro: 'Fireflies are out tonight!', n, m: 0,
  steps: [{ ask: 'How many fireflies can you see?', answer: n, hints: ['Point at each one and count it once.', 'Count them out loud together, slowly, one at a time.'] }],
});

const carry = (a: number, b: number): Round => {
  const ones = (a % 10) + b;
  return {
    intro: `Let's build ${a} plus ${b} with blocks.`, n: a, m: b,
    steps: [
      { ask: `Look at the small blocks: ${a % 10} and ${b}. How many ones altogether?`, answer: ones, hints: ['Start at the bigger number and count on.', 'Count on together on your fingers.'] },
      { ask: `We have ${ones} ones. We swap ten of them for one long rod. How many ones are left over?`, answer: ones - 10, hints: ['Take ten away from the small blocks.', 'Ask what is left after ten of them go into the rod.'] },
      { ask: `Now count the long rods, with the new one. How many tens?`, answer: Math.floor(a / 10) + 1, hints: ['Remember the new rod we just made.', 'Count the rods one by one.'] },
      { ask: 'So what number did we build?', answer: a + b, hints: ['Put the tens first, then the ones.', 'Say how many rods, then how many small blocks.'] },
    ],
  };
};

const shop = (kind: string, intro: string, n: number, m: number, steps: Step[]): Round => ({ kind, intro, n, m, steps });

const fix = (claim: string, ask: string, answer: number, n: number, m: number, hint: string): Round => ({
  intro: `Mochi wrote on the slate: ${claim}`, n, m,
  steps: [
    { ask, answer, hints: [hint, 'Ask them to draw it in the air or count it out.'] },
    { ask: 'Ask them to teach you why your answer was wrong.', answer: null, hints: ['Ask what they would tell a friend.', 'Ask them to use a picture in their words.'] },
  ],
});

const cube = (e: number): Round => ({
  intro: `Here is a cube with sides of ${e}.`, n: e, m: 0,
  steps: [
    { ask: 'Let us unfold it flat. How many squares do you see?', answer: 6, hints: ['Top, bottom, and the sides. Count them.', 'Count the squares on the flat net together.'] },
    { ask: `One square is ${e} by ${e}. What is the area of one square?`, answer: e * e, hints: ['Area is one side times the other side.', `Think of ${e} rows of ${e}.`] },
    { ask: 'There are six squares just like it. What is the area of all of them?', answer: 6 * e * e, hints: ['Six times the area of one square.', 'Add one square at a time.'] },
  ],
});

export const GAMES: Game[] = [
  { id: 'fireflies', level: 1, age: '5–6', title: 'Firefly Catch', role: 'You are a gentle friend. Every try is wonderful, and getting it wrong is part of the fun.', rounds: [count(3), count(5), count(4), count(7)] },
  { id: 'blocks', level: 2, age: '6–7', title: 'Block Builder', role: 'You are a patient tutor. Ask one small step at a time and never tell the answer.', rounds: [carry(18, 5), carry(27, 6), carry(34, 8), carry(46, 7)] },
  { id: 'shop', level: 3, age: '7–8', title: 'Mochi\'s Shop', role: 'You are the shopkeeper and the child is your helper. Stay in character and give them real jobs.', rounds: [
    shop('scale', 'A customer needs 3 kilograms and 500 grams of apples. The scale shows 2 kilograms.', 2000, 3500, [
      { ask: 'How many grams are in 1 kilogram?', answer: 1000, hints: ['Kilo means a thousand.', 'A bag of flour is one kilogram, or a thousand of something.'] },
      { ask: 'So how many more grams of apples do we need?', answer: 1500, hints: ['One more kilogram gets to 3. Then we need 500 more.', 'Add 1000 and 500.'] },
    ]),
    shop('coins', 'Honey costs 45 coins. The customer pays with 100.', 45, 100, [{ ask: 'How much change do we give back?', answer: 55, hints: ['Count up from 45 to 50, then to 100.', 'That is 5, then 50 more.'] }]),
    shop('bags', 'We packed 3 bags with 6 carrots in each.', 3, 6, [{ ask: 'How many carrots did we pack?', answer: 18, hints: ['Count by sixes.', 'Six, twelve, and one more six.'] }]),
    shop('coins', 'Three apples cost 12 coins.', 12, 3, [{ ask: 'How much is one apple?', answer: 4, hints: ['Share 12 coins into 3 equal piles.', 'Deal the coins out one at a time.'] }]),
  ] },
  { id: 'teach', level: 4, age: '8–9', title: 'Teach Mochi', role: 'You are the beginner and the child is your teacher. Be proud of your wrong answer, be amazed when corrected, and ask them to explain.', rounds: [
    fix('1/4 + 1/4 = 2/8', 'Say you are sure. Ask: what should the bottom number be?', 4, 1, 4, 'Are the slices getting smaller when we add them?'),
    fix('6 × 7 = 48', 'Say you are sure. Ask: what is six times seven really?', 42, 6, 7, 'Six sixes is 36. Add one more six.'),
    fix('half of 30 = 60', 'Say you are sure. Ask: what is half of thirty really?', 15, 30, 2, 'Half should be smaller than what we started with.'),
    fix('1/2 + 1/2 = 2/4', 'Say you are sure. Ask: how many whole pizzas is that really?', 1, 1, 2, 'Two halves of a pizza make what?'),
  ] },
  { id: 'cube', level: 5, age: '9–10+', title: 'Cube Lab', role: 'You are a lab partner. Unfold the idea with them and let them discover the rule.', rounds: [cube(2), cube(3), cube(4), cube(5)] },
];

export interface Club { level: number; round: number; step: number; misses: number; total: number; stars: number; solved: boolean; done: boolean }
export interface Move { club: Club; ok: boolean; outcome: string; fx: Fx[] }

export const newClub = (level = 1): Club => ({ level, round: 0, step: 0, misses: 0, total: 0, stars: 0, solved: false, done: false });
export const gameOf = (c: Club) => GAMES[c.level - 1];
export const roundOf = (c: Club) => gameOf(c).rounds[c.round];
export const stepOf = (c: Club) => roundOf(c).steps[Math.min(c.step, roundOf(c).steps.length - 1)];

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
function numberIn(value: unknown): number | null {
  const text = String(value ?? '').toLowerCase().replace(/,/g, '');
  const digits = text.match(/-?\d+/);
  if (digits) return Number(digits[0]);
  const word = NUMBER_WORDS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(text));
  return word >= 0 ? word : null;
}

function advance(c: Club, opening: string): Move {
  const round = roundOf(c);
  if (c.step + 1 < round.steps.length) {
    const club = { ...c, step: c.step + 1, misses: 0 };
    return { club, ok: true, outcome: `${opening} Next, ask: ${stepOf(club).ask}`, fx: ['jump'] };
  }
  return { club: { ...c, solved: true, stars: c.stars + 1, misses: 0 }, ok: true, outcome: `${opening} A star is won. Ask how they knew, react to their reason, then offer the next one.`, fx: ['jump', 'star'] };
}

/** The child's number for this step. */
export function answer(c: Club, value: unknown): Move {
  if (c.done) return { club: c, ok: false, outcome: 'Not now: this game is finished.', fx: [] };
  if (c.solved) return { club: c, ok: false, outcome: 'Not needed: this round is solved. Offer the next one.', fx: [] };
  const step = stepOf(c);
  if (step.answer === null) return { club: c, ok: false, outcome: 'Not a number question: let them explain in words.', fx: [] };
  const n = numberIn(value);
  if (n === null) return { club: c, ok: false, outcome: 'Not clear: ask for the number again.', fx: [] };
  if (n !== step.answer) {
    const hint = step.hints[Math.min(c.misses, 1)];
    return { club: { ...c, misses: c.misses + 1, total: c.total + 1 }, ok: false, outcome: `Not quite: ${n} is not it. Say something kind about the try, then this hint: ${hint} Never say the answer.`, fx: ['tumble'] };
  }
  return advance(c, `Right: ${n}.`);
}

/** The child explained in their own words. */
export function explained(c: Club): Move {
  if (c.done || c.solved || stepOf(c).answer !== null) return { club: c, ok: false, outcome: 'Not needed: there is nothing to explain right now.', fx: [] };
  return advance(c, 'Done: you learned it from them. Thank your teacher.');
}

export function next(c: Club): Move {
  if (c.done) return { club: c, ok: false, outcome: 'Not now: this game is finished.', fx: [] };
  if (!c.solved) return { club: c, ok: false, outcome: 'Not yet: finish this round first.', fx: [] };
  if (c.round + 1 >= gameOf(c).rounds.length) {
    const up = c.level < GAMES.length ? (c.total === 0 ? `No mistakes at all, so dare them to try level ${c.level + 1}.` : `Ask if they want level ${c.level + 1}.`) : 'That is the top level.';
    return { club: { ...c, done: true }, ok: true, outcome: `Done: ${gameOf(c).title} is finished with ${c.stars} stars. ${up}`, fx: ['finish'] };
  }
  const club = { ...c, round: c.round + 1, step: 0, misses: 0, solved: false };
  return { club, ok: true, outcome: `Done: next round. ${roundOf(club).intro} Ask: ${stepOf(club).ask}`, fx: ['new'] };
}

/** Moves to a level from 1 to 5, or one step when the child says harder or easier. */
export function setLevel(c: Club, value: unknown): Move {
  const said = String(value ?? '').toLowerCase();
  const asked = /hard|next|more|up/.test(said) ? c.level + 1 : /eas|less|down/.test(said) ? c.level - 1 : numberIn(value);
  if (asked === null) return { club: c, ok: false, outcome: `Not clear: ask which level from 1 to ${GAMES.length}.`, fx: [] };
  const level = Math.min(GAMES.length, Math.max(1, asked));
  if (level === c.level && !c.done) return { club: c, ok: true, outcome: `Done: we are already on level ${level}.`, fx: [] };
  const club = newClub(level);
  return { club, ok: true, outcome: `Done: level ${level} is ${gameOf(club).title}. ${gameOf(club).role} ${roundOf(club).intro} Ask: ${stepOf(club).ask}`, fx: ['new'] };
}
