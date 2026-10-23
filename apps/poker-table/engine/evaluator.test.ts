// The 7-card evaluator that replaces pokerkit at the showdown.
import { describe, expect, test } from 'vitest';
import { spokenCard, spokenCards } from './cards.ts';
import { bestScore, compareScores, handRankLabel } from './evaluator.ts';

const cards = (text: string) => text.split(' ');
const beats = (a: string, b: string) => compareScores(bestScore(cards(a)), bestScore(cards(b)));

describe('labels, in the vocabulary users saw', () => {
  const cases: [string, string][] = [
    ['As Ks Qs Js Ts 2d 3c', 'Royal Flush'],
    ['9h 8h 7h 6h 5h Ad Ac', 'Straight Flush'],
    ['5d 4d 3d 2d Ad Kc Kh', 'Straight Flush'],
    ['7c 7d 7h 7s Kd 2c 3c', 'Four of a Kind'],
    ['Qc Qd Qh 4s 4d 2c 3h', 'Full House'],
    ['Ac 9c 7c 4c 2c Kd Kh', 'Flush'],
    ['Ad 2c 3h 4s 5d Kd Kh', 'Straight'],
    ['8c 8d 8h Ks 4d 2c 3h', 'Three of a Kind'],
    ['Jc Jd 4h 4s 9d 2c 3h', 'Two Pair'],
    ['Tc Td 6h 4s 9d 2c 3h', 'One Pair'],
    ['Ac Qd 9h 7s 5d 3c 2h', 'High Card'],
  ];
  for (const [hand, label] of cases) test(label, () => expect(handRankLabel(cards(hand))).toBe(label));
});

describe('who beats whom', () => {
  test('a flush beats a straight; a full house beats a flush', () => {
    expect(beats('Ac 9c 7c 4c 2c Kd Kh', 'Ad 2c 3h 4s 5d Kd Kh')).toBeGreaterThan(0);
    expect(beats('Qc Qd Qh 4s 4d 2c 3h', 'Ac 9c 7c 4c 2c Kd Kh')).toBeGreaterThan(0);
  });
  test('the wheel is the lowest straight, and an ace-high straight the highest', () => {
    expect(beats('6d 2c 3h 4s 5d Kd Qh', 'Ad 2c 3h 4s 5d Kd Qh')).toBeGreaterThan(0);
    expect(beats('Ad Kc Qh Js Td 2d 3h', '9d Kc Qh Js Td 2d 3h')).toBeGreaterThan(0);
  });
  test('kickers decide equal pairs; two pair compares the top pair first', () => {
    expect(beats('Ac Ad Kh 9s 5d 3c 2h', 'Ac Ad Qh 9s 5d 3c 2h')).toBeGreaterThan(0);
    expect(beats('Kc Kd 2h 2s 9d 3c 4h', 'Qc Qd Jh Js 9d 3c 4h')).toBeGreaterThan(0);
  });
  test('the full house with the bigger trips wins, whatever the pair', () => {
    expect(beats('9c 9d 9h 2s 2d 3c 4h', '8c 8d 8h As Ad 3c 4h')).toBeGreaterThan(0);
  });
  test('when the board plays, it is a tie', () => {
    expect(beats('2c 3d As Ks Qs Js Ts', '2h 3s As Ks Qs Js Ts')).toBe(0);
  });
  test('the best five of seven: a sixth and seventh card never count', () => {
    expect(beats('Ac Kc Qd Jh 9s 3c 2d', 'Ac Kc Qd Jh 9s 8c 7d')).toBe(0);
  });
});

test('cards are said as words, never as codes', () => {
  // A TTS voice read "As" as the word "as": "you have as and ten dee".
  expect(spokenCard('As')).toBe('ace of spades');
  expect(spokenCard('Td')).toBe('ten of diamonds');
  expect(spokenCard('??')).toBe('??');
  expect(spokenCards(['As', 'Td', '2c'])).toBe('ace of spades, ten of diamonds and two of clubs');
});
