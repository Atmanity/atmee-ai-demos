// How to play, in one place, for the table's How to play sheet and for the
// avatar. Ported from the original's `rules.py` (the avatar's text) and the
// panel's `rules.ts` (the sheet), which had to be kept in step by a test that
// read one from the other; here they are one module.
//
// The app had no rules anywhere at first. Asked, cold, "I've never played
// poker before. How do I play?", the avatar answered "you can fold, call the
// bet of 10, or raise to at least 40": the legal actions, which is the one
// thing a beginner can already read off the buttons. Asked "what beats what?"
// it said "a high card beats nothing, while a royal flush beats everything!"
// and stopped.
//
// Two rules about this module:
// * The numbers come from the table, not from here: the blinds and the stack
//   are the engine's constants, so changing them changes what is taught.
// * The avatar is handed this text to deliver, not asked to recall it (it goes
//   out as standing notes; see director.ts).
import { BIG_BLIND, SMALL_BLIND, STARTING_STACK } from './types.ts';

export interface RankingRow { name: string; shape: string }

/** Strongest first: the order IS the answer to "what beats what". */
export const HAND_RANKINGS: RankingRow[] = [
  { name: 'Royal flush', shape: 'A K Q J 10, all one suit' },
  { name: 'Straight flush', shape: 'five in a row, all one suit' },
  { name: 'Four of a kind', shape: 'four cards of the same rank' },
  { name: 'Full house', shape: 'three of a kind plus a pair' },
  { name: 'Flush', shape: 'any five of one suit' },
  { name: 'Straight', shape: 'five in a row, mixed suits' },
  { name: 'Three of a kind', shape: 'three cards of the same rank' },
  { name: 'Two pair', shape: 'two pairs' },
  { name: 'One pair', shape: 'two cards of the same rank' },
  { name: 'High card', shape: 'none of the above — highest card wins' },
];

// ---- for the avatar: finished sentences to say ---------------------------------

export const basics = () =>
  "Heads-up Texas Hold'em: just the two of us. You each get two private cards. Before any of them are dealt one of us " +
  `posts a small blind of ${SMALL_BLIND} and the other a big blind of ${BIG_BLIND} — forced bets, so there is always something ` +
  'to play for. Then five shared cards come out in three rounds: three at once, then one, then one. You bet after each. ' +
  'Your hand is the best five cards you can make out of your two and the five on the table. Win by having the better hand ' +
  'at the end, or by betting enough that the other one gives up.';

export const actions = () =>
  'Four things you can ever do. Fold: throw the hand away and lose what you have already put in. Check: pass, only when ' +
  'nothing has been bet at you. Call: match what has been bet. Raise: put in more than they did, which they then have to ' +
  'match or fold to. The buttons only ever offer you the ones that are legal right now.';

export const rankings = () =>
  `Strongest to weakest: ${HAND_RANKINGS.map((r) => r.name.toLowerCase()).join(', then ')}. Ties are broken by the highest cards involved.`;

export const blinds = () =>
  `The blinds are forced bets posted before the cards: ${SMALL_BLIND} for the small blind, ${BIG_BLIND} for the big. They ` +
  'alternate every hand, so neither of us can just sit and wait for aces. The dealer button marks who is on the small blind ' +
  'and acts first before the flop.';

export const winning = () =>
  `You both start with ${STARTING_STACK} chips. Chips move at the end of each hand and the match runs until one of us has ` +
  'none left. Nothing carries in from outside — it is one table, one stack each.';

// ---- for the How to play sheet --------------------------------------------------

export interface RuleSection { heading: string; body: string }

export const RULE_SECTIONS: RuleSection[] = [
  {
    heading: 'The shape of a hand',
    body: 'You each get two private cards. Five shared cards come out in three rounds — three, then one, then one — and you bet after each. Your hand is the best five cards out of your two and the five on the table.',
  },
  {
    heading: 'Your four moves',
    body: 'Fold gives up the hand. Check passes, and is only offered when nothing has been bet at you. Call matches the bet. Raise puts in more, which they then have to match or fold to. The buttons only show what is legal right now.',
  },
  {
    heading: 'Blinds',
    body: `Before any cards, one of you posts ${SMALL_BLIND} and the other ${BIG_BLIND}. They are forced, and they alternate, so neither of you can sit and wait for aces. The dealer button marks who posts the small one.`,
  },
  {
    heading: 'Winning',
    body: `You each start with ${STARTING_STACK} chips. Win a hand by showing the better five cards, or by betting enough that the other one folds. The match ends when someone runs out.`,
  },
  {
    heading: 'Saying your move',
    body: 'Say or type it: "check", "call", "I fold", "raise to 60", "all in". A raise is the total you raise TO. Questions ("should I fold?") are never taken as moves, and a number on its own is not a bet.',
  },
];
