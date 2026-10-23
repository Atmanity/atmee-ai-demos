// The 7-card hand evaluator: the best five of a player's two cards and the
// board, scored so that two hands compare with a plain array comparison.
//
// pokerkit decided showdowns in the original; this replaces it. The category
// names are the strings users saw (`@pokertools/engine`'s vocabulary), and the
// golden fixtures pin them.
import { RANK_ORDER } from './cards.ts';

export const CATEGORY_NAMES = [
  'High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush', 'Royal Flush',
] as const;

/** [category, ...tie-breakers], higher is better, compared left to right. */
export type HandScore = number[];

const rankOf = (card: string) => RANK_ORDER.indexOf(card[0].toUpperCase());

/** The score of exactly five cards. */
export function scoreFive(five: readonly string[]): HandScore {
  const ranks = five.map(rankOf).sort((a, b) => b - a);
  const flush = new Set(five.map((c) => c[1].toLowerCase())).size === 1;
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // By count, then by rank: [pair rank, kickers…], [trips, pair], and so on.
  const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = byCount.map(([, n]) => n).join('');
  const distinct = [...counts.keys()].sort((a, b) => b - a);
  let straightHigh: number | null = null;
  if (distinct.length === 5) {
    if (distinct[0] - distinct[4] === 4) straightHigh = distinct[0];
    else if (distinct.join() === '12,3,2,1,0') straightHigh = 3; // the wheel, A-5: five high
  }
  let category: number;
  if (straightHigh !== null && flush) category = straightHigh === 12 ? 9 : 8;
  else if (shape === '41') category = 7;
  else if (shape === '32') category = 6;
  else if (flush) category = 5;
  else if (straightHigh !== null) category = 4;
  else if (shape === '311') category = 3;
  else if (shape === '221') category = 2;
  else if (shape === '2111') category = 1;
  else category = 0;
  const tiebreak = straightHigh !== null && (category === 4 || category >= 8) ? [straightHigh] : byCount.map(([r]) => r);
  return [category, ...tiebreak];
}

export function compareScores(a: HandScore, b: HandScore): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

/** The best five-card score among any five to seven cards. */
export function bestScore(cards: readonly string[]): HandScore {
  if (cards.length < 5) throw new Error('a hand needs at least five cards');
  let best: HandScore | null = null;
  const pick = (start: number, chosen: string[]) => {
    if (chosen.length === 5) {
      const score = scoreFive(chosen);
      if (!best || compareScores(score, best) > 0) best = score;
      return;
    }
    for (let i = start; i <= cards.length - (5 - chosen.length); i++) pick(i + 1, [...chosen, cards[i]]);
  };
  pick(0, []);
  return best!;
}

/** The showdown label, in the vocabulary users saw: "One Pair", "Full House"… */
export function handRankLabel(cards: readonly string[]): string {
  return CATEGORY_NAMES[bestScore(cards)[0]];
}
