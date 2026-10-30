// What the teacher is told, and how the teacher acts. The class decides what is
// right; every change on the child's screen comes from a tool.
import type { AppTool } from '../../../server/app-server.ts';
import { CLASSES, LEVELS, problem, problems, type Club } from './club.ts';

/** The teacher's rules: the session's tool instructions (at most 4,000 characters). */
export const INSTRUCTIONS = `You are Mochi, a red panda teaching one child aged six to ten in Math Club. A pizza or a cookie tray is on their screen. You reach it only through the class's tools.
- The screen changes only when you call a tool, so call one for every action. Nothing happened unless a result said so.
- Pizza Fractions: when the child says how many slices to cut or take, call set_pizza. Explain that the bottom number is how many equal slices, and the top number is how many we take.
- Cookie Times Tables: when the child says how many rows or how many in each row, call set_tray. When the tray matches, ask for the total. When they say a number, call check_total.
- One-word answers count: a child saying "four" in reply to your question is a tool call.
- Never give the answer. If they are stuck, give one small hint.
- When a star is won, cheer in one line and ask if they want the next one. When they say yes, next or more, call next_problem.
- If they ask for the other class, call choose_class. If they ask for a level, or say it is too easy or too hard, call set_level.
- Match the level: from level 1 (age five) use very simple words, up to level 5 (age ten) where you can say fraction, denominator and multiply.
- If the child presses a button, the class tells you what happened: carry on from that and do not call a tool for it.
Talk like a friendly picture book: one or two short spoken sentences, everyday words, no lists. A wrong answer is never bad: laugh with them and try again. Never ask for their name, age, school or anything personal.`;

const awaits = { mode: 'await' as const, timeoutSeconds: 8 };
const num = (description: string) => ({ type: 'number', description });

// Lenient on purpose: a call that misses the schema never reaches the page. The class checks every value.
export const TOOLS: AppTool[] = [
  { type: 'function', name: 'set_pizza', description: 'Cuts the pizza and takes slices. Send only what the child changed.',
    parameters: { type: 'object', properties: { slices: num('How many equal slices to cut.'), taken: num('How many slices to take.') } }, 'x-atmee': awaits },
  { type: 'function', name: 'set_tray', description: 'Lays out the cookie tray. Send only what the child changed.',
    parameters: { type: 'object', properties: { rows: num('How many rows.'), each: num('How many cookies in each row.') } }, 'x-atmee': awaits },
  { type: 'function', name: 'check_total', description: 'Checks the total the child says for a finished cookie tray.',
    parameters: { type: 'object', properties: { total: num('The number the child said.') }, required: ['total'] }, 'x-atmee': awaits },
  { type: 'function', name: 'next_problem', description: 'Goes to the next problem once this one has its star.', parameters: { type: 'object', properties: {} }, 'x-atmee': awaits },
  { type: 'function', name: 'set_level', description: 'Changes the level, from 1 (easiest) to 5 (hardest).',
    parameters: { type: 'object', properties: { level: { type: 'string', description: 'A level number, or harder or easier.' } }, required: ['level'] }, 'x-atmee': awaits },
  { type: 'function', name: 'choose_class', description: 'Changes class: Pizza Fractions or Cookie Times Tables.',
    parameters: { type: 'object', properties: { class: { type: 'string', description: 'fractions or times.' } }, required: ['class'] }, 'x-atmee': awaits },
];

/** What is on the child's screen, as the teacher's state. Never a total the child has yet to find. */
export function clubState(c: Club): string {
  const cls = CLASSES[c.cls];
  if (c.done) return `${cls.title} level ${c.level} of ${LEVELS.length} is finished with ${c.stars} stars.`;
  const made = c.cls === 'fractions' ? `The pizza has ${c.a} slices with ${c.b} taken.` : `The tray has ${c.a} rows of ${c.b}.`;
  const next = c.solved ? 'Solved: ask if they want the next one.' : c.built ? 'The tray matches: ask for the total.' : 'Next: help them build it.';
  return `${cls.title}, level ${c.level} of ${LEVELS.length}, problem ${c.i + 1} of ${problems(c).length}: ${problem(c).story} ${made} Stars: ${c.stars}. ${next}`;
}

export const opening = (c: Club) => `You have just greeted them; do not greet or introduce yourself again. We are in ${CLASSES[c.cls].title}, level ${c.level}. In one short sentence, give the problem: "${problem(c).story}" and ask how they will start.`;
export const pressed = (outcome: string) => `The child pressed a button. ${outcome} React in one short sentence.`;
