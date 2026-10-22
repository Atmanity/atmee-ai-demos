// What the avatar is told, and when. The game decides everything; the avatar
// hosts. It never knows the city before the reveal, so these texts are the
// only way the answer reaches it, and only once the round is over.
import { hintCost, roundValue } from './game.ts';
import type { View } from './types.ts';

/** Standing rules, sent once as notes (each note at most 2,000 characters). */
export const NOTES = [
  `You are hosting "Guess the City" for one player. A photo of a mystery city is on the player's screen. You cannot see it and you are never told which city it is until the round is over. Never describe it, guess at it, or mention any landmark, feature or region: a made-up detail is a false clue. Clues come only from the game, which hands them to you word for word. Keep every reply to one or two short sentences, spoken aloud: no lists.`,
  `The game, not you, judges everything. You do not know the city, so when the player names one, any verdict from you is a guess: never say right, wrong, close, "not quite" or "correct". Say only a few words like "Ooh, let's see!" and stop; the game tells you the verdict a moment later. If the game has already told you the verdict for that guess, just carry on from it. The same goes for asking for a clue, giving up, the next city or a new game: acknowledge briefly and wait for the game. Scoring, if asked: a city guessed with no clues is worth 4 points, each clue costs one point, never below 1; a game is three cities.`,
];

/** The live board, as the avatar's state. Never the answer before the reveal. */
export function boardState(v: View): string {
  const parts = [`Guess the City, live board. Round ${Math.min(v.round, v.rounds)} of ${v.rounds}. Score ${v.score}.`];
  if (v.over) {
    parts.push(`The game is over: the player finished with ${v.score} of ${v.rounds * 4} points. Offer a new game.`);
  } else if (v.revealed && v.city) {
    parts.push(`This round is over: the city was ${v.city.name}, ${v.city.country}${v.correct ? ', and the player guessed it' : ', the player gave up'}. Fun fact: ${v.city.funFact} Next: the player can ask for the next city.`);
  } else {
    const clues = v.hints.length ? ` They are: ${v.hints.map((h, i) => `(${i + 1}) ${h}`).join(' ')}` : '';
    parts.push(`The city is still hidden from you. Clues given: ${v.hints.length} of ${v.hintsTotal}.${clues} A right guess now is worth ${roundValue(v.hints.length)} points${v.hints.length < v.hintsTotal ? `; the next clue costs ${hintCost(v.hints.length)}` : '; no clues are left'}.`);
    // The next clue is staged here so that the avatar's own, immediate answer to
    // "give me a clue" is the real one: the app's event would come too late.
    parts.push(v.nextHint
      ? `If the player asks for a clue, give them this one, in your own words and adding nothing: "${v.nextHint}". Never give it unasked, and never make up a clue of your own.`
      : `If the player asks for a clue, there are none left: say so. Never make up a clue of your own.`);
  }
  return parts.join(' ');
}

export const say = {
  start: (v: View) => `A new game of Guess the City starts: the first mystery city's photo is on the player's screen (round 1 of ${v.rounds}). Welcome them in one or two sentences and invite a first guess; they can ask for a clue any time.`,
  hint: (clue: string, v: View) => `The player asked for a clue. Give them exactly this clue in your own words, adding nothing: "${clue}". That is clue ${v.hints.length} of ${v.hintsTotal}; the city is now worth ${roundValue(v.hints.length)} points.`,
  noHint: () => `The player asked for another clue, but all of them are used. Say so briefly: they can guess or give up.`,
  wrong: (place: string) => `The player guessed ${place}, and that is not the city. Tell them kindly it isn't, and offer a clue if they would like one.`,
  right: (v: View, points: number) => `The player guessed right: it is ${v.city!.name}, ${v.city!.country}! They win ${points} point${points === 1 ? '' : 's'} (score ${v.score}). Celebrate briefly, share this fun fact in your own words: ${v.city!.funFact} Then offer the next city.`,
  skip: (v: View) => `The player gave up. Reveal that it was ${v.city!.name}, ${v.city!.country}, share this fun fact in your own words: ${v.city!.funFact} Then offer the next city.`,
  solved: () => `The player asked for a clue, but this city is already solved. Offer the next city.`,
  notRevealed: () => `The player asked for the next city, but this one is not solved yet. Say they can keep guessing, take a clue, or give up to see the answer.`,
  next: (v: View) => `Round ${v.round} of ${v.rounds}: a new mystery city's photo is on the player's screen. Invite a first guess in one line. Do not describe or name the city.`,
  over: (v: View) => `That was the last city: the player finished with ${v.score} of ${v.rounds * 4} points. Congratulate them warmly in a sentence and offer a new game.`,
  finished: () => `The game is over. Offer a new game.`,
};
