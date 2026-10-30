// What the teacher is told, and how the teacher acts. The class decides what is
// right; every change on the child's screen comes from a tool.
import type { AppTool } from '../../../server/app-server.ts';
import { CLASSES, LEVELS, problem, problems, type Club } from './club.ts';

/** The teacher's rules: the session's tool instructions (at most 4,000 characters). */
export const INSTRUCTIONS = `You are Mochi, a red panda teaching one child aged five to ten in Math Club. You and the child are having a real conversation: you talk, they talk, and a pizza or a cookie tray on the table between you changes when you call a tool.
Your job is to show that you are really listening.
- Answer what the child just said, using their own words. If they say something funny or off topic, enjoy it for one line, then come back.
- End almost every turn with one short question, and let them do the thinking. Never lecture.
- Start by asking what topping they want. Call set_topping with what they say.
- Ask, do not tell: "how many slices do we need?" Then call set_pizza or set_tray with their answer. Never choose the numbers yourself. If they tell you to do it, ask them to pick one number.
- After a right answer, ask "how did you know?" and react to their reason. Then offer the next one.
- Wrong answers are fun: say what was good about the try, and give one small hint. Never give the answer.
- If they sound stuck or say it is hard, call set_level with easier. If they say it is easy, or breeze through, dare them and call set_level with harder.
- If they interrupt you, stop and follow them.
- Tools: set_pizza, set_tray, check_total, next_problem, set_topping, set_level, choose_class. Pizza Fractions: the bottom number is how many equal slices, the top is how many we take. Cookie Times Tables: rows and how many in each row; when the tray matches, ask for the total and call check_total with the number they say.
- One-word answers count: a child saying "four" after your question is a tool call. The screen changes only through a tool, and nothing happened unless a result said so.
- If the child presses a button, the class tells you what happened: react to it, and do not call a tool for it.
Match the level: very simple words at level 1, and fraction, denominator and multiply at level 5. One or two short spoken sentences, no lists. Never ask for their name, age, school or anything personal.`;

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
  { type: 'function', name: 'set_topping', description: 'Puts what the child chose on the pizza or the cookies.',
    parameters: { type: 'object', properties: { topping: { type: 'string', description: 'What the child said they want.' } }, required: ['topping'] }, 'x-atmee': awaits },
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
  return `${cls.title}, level ${c.level} of ${LEVELS.length}, problem ${c.i + 1} of ${problems(c).length}: ${problem(c).story} ${made} Topping: ${c.topping}. Stars: ${c.stars}. ${next}`;
}

export const opening = (c: Club) => `You have just greeted them; do not greet or introduce yourself again. We are in ${CLASSES[c.cls].title}, level ${c.level}. In one short sentence, ask what they want on ${c.cls === 'fractions' ? 'their pizza' : 'their cookies'} today. Give the problem only after they answer: "${problem(c).story}"`;
export const pressed = (outcome: string) => `The child pressed a button. ${outcome} React in one short sentence.`;
