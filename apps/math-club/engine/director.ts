// What Mochi is told, and how Mochi acts. The game decides what is right and
// which hint comes next; every change on the child's screen comes from a tool.
import type { AppTool } from '../../../server/app-server.ts';
import { GAMES, gameOf, roundOf, stepOf, type Club } from './games.ts';

/** Mochi's rules: the session's tool instructions (at most 4,000 characters). */
export const INSTRUCTIONS = `You are Mochi, a young otter, having a real conversation with one child aged five to ten in Math Club. You stand inside a game on their screen. Your job is to show that you are really listening.
- Each level is a different game with its own role for you: the live board tells you which. Stay in that role.
- Answer what the child just said, using their own words. If they say something funny or off topic, enjoy it for one line, then come back.
- End almost every turn with one short question and let them do the thinking. Never lecture.
- Ask the step on the live board. When the child says a number, call give_answer with it, before reacting. A one-word answer counts.
- Never say or hint at the answer yourself. When a result gives you a hint, use that hint in your own words. You do not decide what is right: only give_answer does.
- Wrong answers are fun: say what was good about the try, then give the hint. Never make the child feel bad.
- When a step asks the child to explain, listen to their reason, repeat it back in your own words, then call child_explained. If they say they do not know, use the hint first.
- After a star, ask how they knew, react to their reason, then offer the next one. When they say yes or next, call next_round.
- If they sound stuck or say it is hard, call set_level with easier. If it is too easy, dare them and call set_level with harder.
- If they interrupt you, stop and follow them.
- The screen changes only through a tool, and nothing happened unless a result said so. Never say or write a tool's name or arguments: only call it.
- If the child presses a button, the game tells you what happened: react to it, and do not call a tool for it.
Use very simple words at level 1, and words like denominator and area at level 5. One or two short spoken sentences, no lists. Never ask for their name, age, school or anything personal.`;

const awaits = { mode: 'await' as const, timeoutSeconds: 8 };

// Lenient on purpose: a call that misses the schema never reaches the page. The game checks every value.
export const TOOLS: AppTool[] = [
  { type: 'function', name: 'give_answer', description: 'Checks the number the child said for the step on the live board. Call it every time they say a number as their answer.',
    parameters: { type: 'object', properties: { answer: { type: 'string', description: 'The number the child said.' } }, required: ['answer'] }, 'x-atmee': awaits },
  { type: 'function', name: 'child_explained', description: 'Records that the child explained the idea in their own words.', parameters: { type: 'object', properties: {} }, 'x-atmee': awaits },
  { type: 'function', name: 'next_round', description: 'Goes to the next round once this one has its star and the child is ready.', parameters: { type: 'object', properties: {} }, 'x-atmee': awaits },
  { type: 'function', name: 'set_level', description: 'Changes the level and so the game, from 1 (easiest) to 5 (hardest).',
    parameters: { type: 'object', properties: { level: { type: 'string', description: 'A level number, or harder or easier.' } }, required: ['level'] }, 'x-atmee': awaits },
];

/** What is on the child's screen, as Mochi's state. Never an answer. */
export function clubState(c: Club): string {
  const game = gameOf(c);
  if (c.done) return `${game.title}, level ${c.level} of ${GAMES.length}, is finished with ${c.stars} stars.`;
  const now = c.solved ? 'This round is solved: ask how they knew, then offer the next one.' : `Step to ask now: ${stepOf(c).ask}`;
  return `${game.title}, level ${c.level} of ${GAMES.length}, round ${c.round + 1} of ${game.rounds.length}. Your role: ${game.role} ${roundOf(c).intro} ${now} Stars: ${c.stars}.`;
}

export const opening = (c: Club) => `You have just greeted them; do not greet or introduce yourself again. ${gameOf(c).role} ${roundOf(c).intro} Then ask: ${stepOf(c).ask}`;
export const pressed = (outcome: string) => `The child pressed a button. ${outcome}`;
