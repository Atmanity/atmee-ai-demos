// The game's truth, free of any model or framework: levels, the sale gate, money and scores.
// A guest never decides on their own. The judge reads each line, these rules update the round,
// and the guest acts out the result.
import { GUESTS, guestById, type Guest, type Motive } from './guests.ts';

export const LIST_PRICE = 25;
export const PEN = {
  name: 'Kestrel No. 4',
  facts: ['Writes on wet paper', 'Wide soft grip', 'Ink does not smudge once dry', 'One refill lasts about three years', 'Steel body, lifetime warranty'],
};

export type LevelId = 'walkin' | 'floor' | 'closer' | 'thirty';
export interface Level { id: LevelId; name: string; seconds: number; lowest: number; interestToBuy: number; hints: number; blurb: string }
export const LEVELS: Level[] = [
  { id: 'walkin', name: 'Walk-in', seconds: 180, lowest: 8, interestToBuy: 45, hints: 3, blurb: 'Time to talk, and a whisper if you stall.' },
  { id: 'floor', name: 'Floor rep', seconds: 120, lowest: 10, interestToBuy: 50, hints: 1, blurb: 'Busy people. One whisper per guest.' },
  { id: 'closer', name: 'Closer', seconds: 60, lowest: 12, interestToBuy: 50, hints: 0, blurb: 'No help. Guests give little away.' },
  { id: 'thirty', name: 'Thirty', seconds: 30, lowest: 12, interestToBuy: 40, hints: 0, blurb: 'One sharp question, then close.' },
];
export const levelById = (id: unknown) => LEVELS.find((l) => l.id === id);

/** The clock for a level on a plan: the session starts before the clock, so it must fit inside the cap. */
export const clockFor = (level: Level, capSeconds: number) => Math.min(level.seconds, Math.max(30, capSeconds - 20));

/** What the judge reads out of one thing the seller said. */
export interface Verdict {
  interest: number;          // how this line moved the guest, -25 to +25
  askedAboutNeed: boolean;   // a real question about the guest's life, work or need
  needUncovered: boolean;    // the seller now knows the real need
  pitchFits: boolean;        // the seller tied the pen to that need
  handledObjection: boolean;
  askedForSale: boolean;     // a clear ask: will you buy, shall I wrap it, deal?
  traded: boolean;           // gave a discount in exchange for something
  falseClaims: string[];     // claims the pen card does not support
  pressure: boolean;         // pushy, rude or manipulative
}

export interface Line { who: 'seller' | 'guest'; text: string; at: number }
export type Outcome = 'live' | 'sold' | 'walked' | 'time' | 'void';

export interface Round {
  guestId: string;
  motive: Motive;
  level: Level;
  outcome: Outcome;
  interest: number;
  offer: number | null;
  price: number | null;
  lines: Line[];
  needUncovered: boolean;
  needAskedFirst: boolean;
  pitched: boolean;
  fitPitches: number;
  objectionRaised: boolean;
  objectionHandled: boolean;
  askedForSale: boolean;
  haggled: boolean;
  traded: boolean;
  falseClaims: string[];
  pressure: number;
  read?: { motive: boolean; clue: boolean };
  score?: Scores;
  coach?: Coach;
}

export interface Coach { did: string; improve: string[]; best: string; worst: string }

export interface Scores { read: number; discovery: number; fit: number; objections: number; close: number; pricing: number; penalties: number; total: number }
export const SKILLS: { key: keyof Omit<Scores, 'penalties' | 'total'>; label: string; max: number; drill: string }[] = [
  { key: 'read', label: 'Reading the guest', max: 20, drill: 'Before you speak, name one thing the guest is carrying and what it tells you.' },
  { key: 'discovery', label: 'Discovery', max: 20, drill: 'Ask one question about their day before you mention the pen.' },
  { key: 'fit', label: 'Pitch fit', max: 20, drill: 'Use only the one fact that answers what they told you.' },
  { key: 'objections', label: 'Objections', max: 15, drill: 'Agree with the objection first, then answer it.' },
  { key: 'close', label: 'Closing', max: 15, drill: 'End with a direct ask: "Shall we say twenty?"' },
  { key: 'pricing', label: 'Pricing', max: 10, drill: 'Hold your price once before you discount, and get something in return.' },
];

export function newRound(guest: Guest, level: Level, pick = Math.random): Round {
  return {
    guestId: guest.id, motive: guest.motives[Math.floor(pick() * guest.motives.length)], level, outcome: 'live',
    interest: 20, offer: null, price: null, lines: [], needUncovered: false, needAskedFirst: false, pitched: false, fitPitches: 0,
    objectionRaised: false, objectionHandled: false, askedForSale: false, haggled: false, traded: false, falseClaims: [], pressure: 0,
  };
}

const shuffled = <T,>(list: T[], pick: () => number) => {
  const pool = [...list];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(pick() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
};

/** Three guests for a level: false clues only where the level promises them. */
export function pickGuests(level: Level, pick = Math.random): Guest[] {
  const open = shuffled(GUESTS.filter((g) => !g.falseClue), pick);
  const tricky = shuffled(GUESTS.filter((g) => g.falseClue), pick);
  const wanted = level.id === 'closer' ? 1 : level.id === 'thirty' ? 2 : 0;
  return shuffled([...tricky.slice(0, wanted), ...open.slice(0, 3 - wanted)], pick);
}

/** Pens in the sale: a bulk order only if the seller found out about it. */
export const quantityOf = (round: Round) => (round.needUncovered ? round.motive.quantity ?? 1 : 1);
/** What the sale earned. */
export const earned = (round: Round) => (round.price ?? 0) * quantityOf(round);

/** What the guest would pay now: their top price grows as they come to want it. */
export const topNow = (round: Round) => Math.round(round.motive.top * (0.8 + 0.2 * Math.min(round.interest, 100) / 100));

const WORDS: Record<string, number> = { eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, five: 5, six: 6, seven: 7, forty: 40, fifty: 50 };
const UNITS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };

/** The price in a line, if it names one: "$20", "20 bucks", "twenty-two dollars", "let's say eighteen". */
export function priceIn(text: string): number | null {
  const t = text.toLowerCase().replace(/-/g, ' ');
  const digits = t.match(/\$\s*(\d{1,3})|\b(\d{1,3})\s*(?:dollars?|bucks?)\b/);
  if (digits) return Number(digits[1] ?? digits[2]);
  const spoken = t.match(/\b(twenty|thirty)\s+(one|two|three|four|five|six|seven|eight|nine)\b/);
  if (spoken) return WORDS[spoken[1]] + UNITS[spoken[2]];
  const word = t.match(/\b(five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)\b(?:\s*(?:dollars?|bucks?))?/g);
  if (!word) return null;
  // A bare number word is a price only with money around it ("ten years" is not).
  const priced = /\b(dollars?|bucks?|price|pay|cost|for|deal|say|take|make it|how about|sell)\b/.test(t) && !/\b(years?|months?|days?|hours?|minutes?|pens|times)\b/.test(t);
  const money = word.find((w) => /dollars?|bucks?/.test(w));
  if (money) return WORDS[money.split(/\s+/)[0]];
  return priced ? WORDS[word[0]] : null;
}

export interface Step {
  refused?: number;          // an offer under the level's lowest price
  sold?: number;             // the sale just closed, at this price
  walked?: boolean;
  haggle?: boolean;          // the guest pushes back on the price once
  objection?: boolean;       // the guest should voice their objection now
  challenge?: string;        // a claim to challenge
  revealNeed?: boolean;      // a good question: let a piece of the need out
}

/** One seller line, as judged: updates the round and says what happens next. */
export function applyVerdict(round: Round, text: string, v: Verdict): Step {
  const step: Step = {};
  if (round.outcome !== 'live') return step;
  const price = priceIn(text);
  if (price !== null) {
    if (price < round.level.lowest) step.refused = price;
    else round.offer = price;
  }
  if (v.askedAboutNeed && !round.pitched) round.needAskedFirst = true;
  if (v.askedAboutNeed) step.revealNeed = true;
  if (v.needUncovered) round.needUncovered = true;
  if (v.pitchFits) { round.pitched = true; round.fitPitches++; } else if (!v.askedAboutNeed && !v.handledObjection && text.split(/\s+/).length > 8) round.pitched = true;
  if (v.handledObjection && round.objectionRaised) round.objectionHandled = true;
  if (v.traded) round.traded = true;
  if (v.pressure) round.pressure++;
  if (v.falseClaims.length) {
    round.falseClaims.push(...v.falseClaims);
    step.challenge = v.falseClaims[0];
  }
  // Charm without substance tops out: without a fitted pitch the guest stays short of buying.
  const cap = round.fitPitches ? 100 : Math.min(round.level.interestToBuy - 5, 45);
  const moved = Math.max(-25, Math.min(25, v.interest)) - (v.falseClaims.length ? 10 : 0) - (v.pressure ? 10 : 0);
  round.interest = Math.max(0, Math.min(Math.max(cap, round.interest), round.interest + moved));
  if (round.interest <= 0) {
    round.outcome = 'walked';
    step.walked = true;
    return step;
  }
  if (v.askedForSale) round.askedForSale = true;
  if (!round.objectionRaised && round.fitPitches && round.interest >= 30) {
    round.objectionRaised = true;
    step.objection = true;
  } else if (v.askedForSale && gateOpen(round)) {
    const offer = round.offer ?? LIST_PRICE;
    if (round.motive.haggles && !round.haggled) {
      round.haggled = true;
      step.haggle = true;
    } else {
      round.offer = offer;
      round.price = offer;
      round.outcome = 'sold';
      step.sold = offer;
    }
  }
  return step;
}

/** The guest may say yes: they want it, it fits, and the price is within reach. */
export function gateOpen(round: Round): boolean {
  const offer = round.offer ?? LIST_PRICE;
  return round.outcome === 'live' && round.fitPitches > 0 && round.interest >= round.level.interestToBuy
    && offer >= round.level.lowest && offer <= topNow(round);
}

export function moneyLeft(round: Round): number {
  return round.price === null ? 0 : Math.max(0, topNow(round) - round.price) * quantityOf(round);
}

export function score(round: Round): Scores {
  const read = (round.read?.motive ? 12 : 0) + (round.read?.clue ? 8 : 0);
  const discovery = (round.needUncovered ? 12 : 0) + (round.needAskedFirst ? 8 : 0);
  const fit = round.fitPitches ? Math.min(20, 12 + 4 * round.fitPitches) : 0;
  const objections = !round.objectionRaised ? 0 : round.objectionHandled ? 15 : 4;
  const close = round.outcome === 'sold' ? 15 : round.askedForSale ? 8 : 0;
  let pricing = 0;
  if (round.price !== null) {
    const span = Math.max(1, topNow(round) - round.level.lowest);
    pricing = Math.min(10, Math.round(8 * (round.price - round.level.lowest) / span) + (round.traded ? 2 : 0));
  }
  const penalties = round.falseClaims.length * 5 + round.pressure * 5;
  const total = Math.max(0, read + discovery + fit + objections + close + pricing - penalties);
  return { read, discovery, fit, objections, close, pricing, penalties, total };
}

/** How the seller talked, from the words alone. */
export function delivery(lines: Line[]) {
  const seller = lines.filter((l) => l.who === 'seller');
  const words = (ls: Line[]) => ls.reduce((n, l) => n + l.text.trim().split(/\s+/).filter(Boolean).length, 0);
  const said = words(seller);
  const heard = words(lines.filter((l) => l.who === 'guest'));
  return {
    talkShare: said + heard ? Math.round(100 * said / (said + heard)) : 0,
    questions: seller.filter((l) => l.text.includes('?')).length,
    fillers: seller.reduce((n, l) => n + (l.text.toLowerCase().match(/\b(um+|uh+|like|you know|basically|actually)\b/g)?.length ?? 0), 0),
  };
}

export interface Report {
  money: number; sold: number; left: number;
  skills: { label: string; score: number; max: number }[];
  drill: string;
  delivery: ReturnType<typeof delivery>;
  guests: { name: string; outcome: Outcome; did: string; improve: string[] }[];
}

export function report(rounds: Round[]): Report {
  const played = rounds.filter((r) => r.score);
  const n = Math.max(1, played.length);
  const skills = SKILLS.map((s) => ({ ...s, score: Math.round(played.reduce((sum, r) => sum + r.score![s.key], 0) / n) }));
  const weakest = [...skills].sort((a, b) => a.score / a.max - b.score / b.max)[0];
  return {
    money: rounds.reduce((sum, r) => sum + earned(r), 0),
    sold: rounds.filter((r) => r.outcome === 'sold').length,
    left: rounds.reduce((sum, r) => sum + moneyLeft(r), 0),
    skills: skills.map(({ label, score: s, max }) => ({ label, score: s, max })),
    drill: weakest.drill,
    delivery: delivery(rounds.flatMap((r) => r.lines)),
    guests: played.map((r) => ({ name: guestById(r.guestId)!.name, outcome: r.outcome, did: r.coach?.did ?? '', improve: r.coach?.improve ?? [] })),
  };
}

/** Feedback without a model: what the numbers alone can say. */
export function plainCoach(round: Round): Coach {
  const said = round.lines.filter((l) => l.who === 'seller').length;
  if (!said) return { did: 'You did not speak to the guest before time ran out.', improve: ['Open within the first few seconds, starting from something you can see.'], best: '', worst: '' };
  const scores = score(round);
  const weakest = [...SKILLS].sort((a, b) => scores[a.key] / a.max - scores[b.key] / b.max);
  const outcome = round.outcome === 'sold' ? `and sold at $${round.price}` : round.outcome === 'walked' ? 'and the guest walked away' : 'and the clock ran out';
  return { did: `You spoke ${said} ${said === 1 ? 'time' : 'times'} ${outcome}.`, improve: weakest.slice(0, 2).map((s) => s.drill), best: '', worst: '' };
}

/** The motive chips: the real one and the other guests' decoys, in a stable shuffled order. */
export function readOptions(round: Round) {
  const guest = guestById(round.guestId)!;
  const decoys = GUESTS.filter((g) => g.id !== guest.id).map((g) => g.motives[0].label).slice(0, 2);
  const motives = [round.motive.label, ...decoys].sort((a, b) => a.length - b.length);
  return { motives, clues: guest.clues.map((c) => ({ id: c.id, label: c.label })) };
}
