// What the avatar is told, and how it acts. The game decides everything; the
// avatar hosts. It never knows the city before the reveal: it calls the
// game's tools, and every verdict, clue and reveal comes back as a tool
// result it speaks from.
import type { AppTool } from '../../../server/app-server.ts';
import { hintCost, roundValue } from './game.ts';
import type { View } from './types.ts';

/** The host's rules: the session's tool instructions (at most 4,000 characters). */
export const INSTRUCTIONS = `You are hosting "Guess the City" for one player. A photo of a mystery city is on the player's screen. You cannot see it and you do not know which city it is: the game does, and you reach it only through its tools.
- When the player names a place as their answer ("is it Lisbon?", "Paris!", "maybe Osaka"), call check_guess with that place before saying anything about it, and answer only from the result. Never say right, wrong, close or "not quite" on your own.
- When they ask for a clue or a hint, call get_clue and give that clue in your own words, adding nothing. Never make up a clue, describe the photo, or mention a landmark, feature or region yourself.
- "I give up", "tell me", "skip": call reveal_answer. "Next", "next city", "go on": call next_city. "New game", "play again": call new_game, and only then.
- Questions about the score, the round or the rules: answer from the live board in your context, no tool needed.
- The player's screen changes only when you call a tool. Saying "let's move on" or "it was Cairo" without the call changes nothing and misleads them: call the tool every time, even when you think you already know the answer. You never know the city; only check_guess and reveal_answer can tell you.
- If the player presses a button on screen, the game tells you what happened; carry on from that.
Scoring: a city guessed with no clues is worth 4 points, each clue costs one point, never below 1; a game is three cities. Keep every reply to one or two short spoken sentences: no lists.`;

// Lenient on purpose: Causeur answers a call whose arguments miss the schema with an error the
// page never sees, and the host may then say it happened anyway. The game checks every value.
const noArgs = { type: 'object', properties: {} };
const awaits = { mode: 'await' as const, timeoutSeconds: 12 };

/** The game's tools. Each is answered by the server, which owns the city. */
export const TOOLS: AppTool[] = [
  { type: 'function', name: 'check_guess', description: 'Judges the player\'s answer against the mystery city. Call it whenever the player names a place as their guess, before reacting to it.',
    parameters: { type: 'object', properties: { place: { type: 'string', maxLength: 500, description: 'The place the player named, as they said it.' } }, required: ['place'] },
    'x-atmee': awaits },
  { type: 'function', name: 'get_clue', description: 'Gives the next clue for the mystery city (it costs the player a point). Call it when the player asks for a clue or a hint.', parameters: noArgs, 'x-atmee': awaits },
  { type: 'function', name: 'reveal_answer', description: 'Reveals the city when the player gives up.', parameters: noArgs, 'x-atmee': awaits },
  { type: 'function', name: 'next_city', description: 'Moves on to the next mystery city once the current one is solved or revealed.', parameters: noArgs, 'x-atmee': awaits },
  { type: 'function', name: 'new_game', description: 'Starts a new game of three new cities. Only when the player asks for one; never on your own, not even at the end of a game.', parameters: noArgs, 'x-atmee': awaits },
];

/** The live board, as the avatar's state. Never the answer before the reveal. */
export function boardState(v: View): string {
  const parts = [`Guess the City, live board. Round ${Math.min(v.round, v.rounds)} of ${v.rounds}. Score ${v.score}.`];
  if (v.over) {
    parts.push(`The game is over: the player finished with ${v.score} of ${v.rounds * 4} points.`);
  } else if (v.revealed && v.city) {
    parts.push(`This round is over: the city was ${v.city.name}, ${v.city.country}${v.correct ? ', and the player guessed it' : ', the player gave up'}. Next: the next city.`);
  } else {
    const clues = v.hints.length ? ` They are: ${v.hints.map((h, i) => `(${i + 1}) ${h}`).join(' ')}` : '';
    parts.push(`The city is hidden, from you too. Clues given: ${v.hints.length} of ${v.hintsTotal}.${clues} A right guess now is worth ${roundValue(v.hints.length)} points${v.hints.length < v.hintsTotal ? `; the next clue costs ${hintCost(v.hints.length)}` : '; no clues are left'}.`);
  }
  return parts.join(' ');
}

// Whether the round's photo is up: one still downloading is "on its way", and
// a city whose photo could not be had is played from its clues. Marco never
// says there is a picture the player cannot see.
const onScreen = (v: View, which: string, coming = false) => !v.photo
  ? `there is no photo for the ${which} mystery city, so this one is played from the clues: offer the first clue`
  : coming
    ? `the ${which} mystery city's photo is on its way and will appear in a moment: say so`
    : `the ${which} mystery city's photo is on the player's screen`;

/** What a tool call (or a button) did, in words the host speaks from. */
export const said = {
  start: (v: View) => `You have just greeted them; do not greet or introduce yourself again. A new game starts: round 1 of ${v.rounds}, and ${onScreen(v, 'first')}. In one sentence, invite their first guess and say they can ask for a clue any time.`,
  right: (v: View, points: number) => `Correct: it is ${v.city!.name}, ${v.city!.country}. The player wins ${points} point${points === 1 ? '' : 's'} (score ${v.score}). Celebrate briefly, share this fun fact in your own words: ${v.city!.funFact} Then offer the next city.`,
  wrong: (place: string, v: View) => `${place} is not the city. Tell them kindly; ${v.hints.length < v.hintsTotal ? 'they can guess again or ask for a clue' : 'no clues are left: they can guess again or give up'}.`,
  clue: (clue: string, v: View) => `Clue ${v.hints.length} of ${v.hintsTotal}: "${clue}". Give it in your own words, adding nothing. A right guess is now worth ${roundValue(v.hints.length)} points.`,
  noClue: () => `No clues are left for this city. The player can guess again or give up.`,
  reveal: (v: View) => `The player gave up. It was ${v.city!.name}, ${v.city!.country}. Share this fun fact in your own words: ${v.city!.funFact} Then offer the next city.`,
  next: (v: View, photo: 'shown' | 'coming' = 'shown') => `Round ${v.round} of ${v.rounds}: ${onScreen(v, 'new', photo === 'coming')}. Invite a first guess in one line; do not describe or name the city.`,
  over: (v: View) => `That was the last city: the player finished with ${v.score} of ${v.rounds * 4} points, and their score card is on screen. Congratulate them in a sentence and ask whether they would like another game; start one only if they say so.`,
  notRevealed: () => `This city is not solved yet: the player can keep guessing, take a clue, or give up to see the answer.`,
  alreadyRevealed: (v: View) => `This round is already over (it was ${v.city!.name}). Offer the next city.`,
  finished: () => `The game is over and the score card is on screen. Ask whether they would like another game; start one only if they say so.`,
};

/** A button press, told to the host: it cannot see the screen. */
export const pressed = (button: string, outcome: string) => `The player pressed "${button}" on screen. ${outcome}`;
