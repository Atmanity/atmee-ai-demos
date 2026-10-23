// What the host is told, and how it acts. The board decides everything; the
// host is its voice: it calls the board's tools when the teacher asks for
// something, reads out what the board wrote, and answers direct questions
// from the live board. It never knows a line of working before the board puts
// it up: `next_line` reveals the line and hands it over in the same breath, so
// nothing unrevealed is ever in the state, a result or an event.
//
// Condensed from the original `persona.py` (the teacher leads; never a number
// that is not on the board) and the cues its `tools.py` returned.
import type { AppTool } from '../../../server/app-server.ts';
import { NOT_FACTORABLE } from './methods.ts';
import type { FactsView, MethodId, View } from './types.ts';

export const METHOD_IDS: MethodId[] = ['factoring', 'completing_square', 'quadratic_formula'];

export const METHOD_WORDS: Record<MethodId, string> = {
  factoring: 'factoring',
  completing_square: 'completing the square',
  quadratic_formula: 'the quadratic formula',
};

/** The host's rules: the session's tool instructions (at most 4,000 characters). */
export const INSTRUCTIONS = `You are the voice of Chalkline, a maths board a teacher is presenting to their class. The teacher leads the lesson; you work the board and read out what it writes. You are not a second teacher: never start a topic, set a question, quiz anyone, or explain something you were not asked to explain. If nothing was asked of you, say nothing. One or two short spoken sentences at most: the class is listening to the teacher.
The board changes only when you call one of its tools, and only the board knows the working. You never see a line before the board writes it: never work out, guess or describe a line yourself, even when you think you know it.
- The teacher names a quadratic ("put up x squared minus four x plus three", "let's do two x squared plus five"): call put_up_equation with it as they said it, in words or symbols, adding method if they named one in the same breath. To change one number of the equation on the board, pass the whole new equation. Then read back what the result says went up, so they can catch a mishearing.
- "By factoring", "complete the square", "use the formula": call choose_method. Changing method on the equation already up is just choose_method: it never needs the board cleared or the equation put up again.
- "Next", "go on", "and then?", "show them": call next_line, once per request, and read out the line it returns, once. This is the one you will use most. Never read a line the tool did not just give you, and never re-read one you already read.
- "Go back", "undo that": call previous_line. "Show it all", "just give them the answer": call show_all_working.
- "Show the graph", "hide the graph", "just the working": call show_graph or hide_graph.
- "Clear the board", "start fresh": call clear_board, and only when the teacher asks for it.
- Call the tool every time. Saying "next line" or "putting that up" without the call changes nothing on the screen and misleads the class. One tool per request, the smallest one that does it.
- A tool that refuses gives you the reason: say it in your own words and do not pretend anything happened.
- Questions about what is on the board (the roots, the vertex, the discriminant, which way it opens, which methods work, what a line says): answer from the live board in your context, with no tool. If it is not there, say you don't have it.
- When the teacher presses a button or writes on the board themselves, you are told what happened: carry on from that.
Numbers, the one hard rule: every number you say is copied from the board or a tool's result, exactly as written. Surds stay surds and fractions stay fractions: never round, never say "approximately", never turn 2 + √3 into a decimal; if they ask for a decimal, say you have the exact value and read that. Say "x squared" for x², "plus or minus" for ±, "root three" for √3. Say only what you would say aloud: no lists, labels or symbol names.`;

const noArgs = { type: 'object', properties: {}, additionalProperties: false };
const awaits = (timeoutSeconds = 8) => ({ mode: 'await' as const, timeoutSeconds });
const methodParam = { type: 'string', enum: METHOD_IDS };

/** The board's tools. Each is answered by the server, which owns the working. */
export const TOOLS: AppTool[] = [
  {
    type: 'function', name: 'put_up_equation',
    description: 'Writes a quadratic on the board with its graph, replacing what is there, and says what went up. Call it whenever the teacher names an equation to put up, or asks to change a number in the one on the board.',
    parameters: {
      type: 'object',
      properties: {
        equation: { type: 'string', minLength: 1, maxLength: 200, description: 'The equation as the teacher said or typed it, in words or symbols: "x squared minus four x plus three", "2x^2 + 5". For a change to the one on the board, the whole new equation.' },
        method: { ...methodParam, description: 'Only when the teacher named a method in the same breath.' },
      },
      required: ['equation'],
      additionalProperties: false,
    },
    // A misheard equation goes to the server's own model, which takes a few seconds.
    'x-atmee': awaits(15),
  },
  {
    type: 'function', name: 'choose_method',
    description: 'Sets the board up to solve the equation on it by one method; no working is revealed yet. Call it when the teacher picks or changes method ("by factoring", "complete the square", "use the formula").',
    parameters: { type: 'object', properties: { method: { ...methodParam, description: 'The method the teacher picked.' } }, required: ['method'], additionalProperties: false },
    'x-atmee': awaits(),
  },
  { type: 'function', name: 'next_line', description: 'Puts the next line of working on the board and returns it for you to read out. Call it once each time the teacher asks for the next line ("next", "go on", "and then?").', parameters: noArgs, 'x-atmee': awaits() },
  { type: 'function', name: 'previous_line', description: 'Takes the last line of working back off the board. Call it for "go back", "undo that", "back a step".', parameters: noArgs, 'x-atmee': awaits() },
  { type: 'function', name: 'show_all_working', description: 'Puts every remaining line of working up at once. Call it only when the teacher clearly asks for all of it ("show it all", "just show them the answer").', parameters: noArgs, 'x-atmee': awaits() },
  { type: 'function', name: 'show_graph', description: 'Puts the parabola back beside the working. Call it for "show the graph", "let\'s see the curve".', parameters: noArgs, 'x-atmee': awaits() },
  { type: 'function', name: 'hide_graph', description: 'Hides the parabola, leaving only the algebra. Call it for "hide the graph", "just the working".', parameters: noArgs, 'x-atmee': awaits() },
  { type: 'function', name: 'clear_board', description: 'Wipes the board clean. Only when the teacher asks for it ("clear the board", "start fresh"); never on your own.', parameters: noArgs, 'x-atmee': awaits() },
];

export type ToolName = 'put_up_equation' | 'choose_method' | 'next_line' | 'previous_line' | 'show_all_working' | 'show_graph' | 'hide_graph' | 'clear_board';

/** "a, b or c" */
const spokenList = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`);
const offer = (v: View) => spokenList(v.methods_available.map((m) => METHOD_WORDS[m]));

/** The answer as the last line of every method writes it. */
export function answerText(f: FactsView): string {
  if (f.nature === 'one_repeated') return `x = ${f.roots[0]} (repeated)`;
  return `x = ${f.roots[0]} or x = ${f.roots[1]}`;
}

function rootsText(f: FactsView): string {
  switch (f.nature) {
    case 'one_repeated': return `one repeated root, x = ${f.roots[0]}`;
    case 'two_complex': return `no real roots (the complex roots are ${f.roots[0]} and ${f.roots[1]})`;
    case 'two_rational': return `roots x = ${f.roots[0]} and x = ${f.roots[1]} (two rational roots)`;
    default: return `roots x = ${f.roots[0]} and x = ${f.roots[1]} (two irrational roots, kept as surds)`;
  }
}

/** The live board, as the host's state: what the class can see, and nothing of the working still to come. */
export function boardState(v: View): string {
  const parts = ['Chalkline board, live.'];
  if (!v.equation || !v.facts) {
    parts.push('The board is empty, waiting for the teacher to name an equation. Nothing can be revealed, taken back, graphed or cleared until then; if asked, say an equation needs to go up first.');
    return parts.join(' ');
  }
  const f = v.facts;
  parts.push(`On the board: ${v.equation.display}${v.graph_visible ? ', with its graph' : ' (graph hidden)'}.`);
  parts.push(`Exact facts, to say exactly as written and never as decimals: ${rootsText(f)}; vertex ${f.vertex_display}; axis of symmetry x = ${f.axis_display}; discriminant ${f.discriminant} (${f.discriminant_sign}); the parabola opens ${f.opens}.`);
  if (!v.method) {
    parts.push(`No method is chosen yet, so there is no working. Methods that work here: ${offer(v)}.`);
    if (!v.methods_available.includes('factoring')) parts.push(`Factoring is not offered: ${NOT_FACTORABLE}`);
    return parts.join(' ');
  }
  parts.push(`Method: ${v.method_label}. ${v.revealed} of ${v.total_steps} lines are up.`);
  if (v.steps.length) parts.push(`Lines up: ${v.steps.map((s) => `(${s.n}) ${s.working}`).join('; ')}.`);
  else parts.push('No line is up yet, so there is nothing to go back to.');
  if (v.remaining) {
    parts.push(`${v.remaining} more ${v.remaining === 1 ? 'line is' : 'lines are'} still to come. You do not know them: only next_line puts the next one up and tells you what it says.`);
  } else {
    parts.push(`Every line is up: the answer, ${answerText(f)}, is boxed on the board. Asked for the next line, say that was the last step.`);
  }
  const others = v.methods_available.filter((m) => m !== v.method).map((m) => METHOD_WORDS[m]);
  if (others.length) parts.push(`Other methods that work here: ${spokenList(others)}.`);
  else if (v.method !== 'factoring') parts.push(`Factoring is not offered: ${NOT_FACTORABLE}`);
  return parts.join(' ');
}

/** Shown on the board when an equation the teacher said could not be read. */
export const UNREADABLE = "That didn't read as a quadratic. Say it again, or write it in the box below the board.";

/** What a tool call (or a control) did, in words the host speaks from. */
export const said = {
  start: () =>
    'The board is ready and empty. Greet the teacher in ONE short line and say the board is ready whenever they want an equation on it. Do not teach anything, do not explain quadratics, and do not put anything on the board yourself.',
  resume: (v: View) => {
    if (!v.equation) return said.start();
    const where = v.method ? `${METHOD_WORDS[v.method]}, ${v.revealed} of ${v.total_steps} lines up` : 'no method chosen yet';
    return `The teacher called you back, and the board is as they left it: ${v.equation.display}, ${where}. Say in one short line that you are back and the board is as they left it. Do not read any working.`;
  },
  equation: (v: View, how: 'heard' | 'written') => {
    const up = `${v.equation!.display} is on the board${v.graph_visible ? ', with its graph' : ''}.`;
    const check = how === 'heard' ? 'Read the equation back in one short line so they can check it was heard right' : 'Say in one short line that it is up';
    if (v.method) return `${up} It is set up for ${METHOD_WORDS[v.method]}: ${v.total_steps} lines, none up yet. ${check}, say you're ready, and wait for them to ask for the first line. Do not start solving.`;
    return `${up} ${check}, then ask which method they want: ${offer(v)}. Do not start solving.`;
  },
  equationNotMethod: (v: View, reason: string) =>
    `${v.equation!.display} is on the board, but not the method: ${reason} Read the equation back in one short line, say that, and ask which method they want: ${offer(v)}.`,
  alreadyUp: (v: View) =>
    `${v.equation!.display} is already on the board, so nothing changed${v.method ? ` (${METHOD_WORDS[v.method]}, ${v.revealed} of ${v.total_steps} lines up)` : ''}. Say so in a few words.`,
  noEquation: () => 'No equation was given. Ask the teacher in one short line which equation to put up.',
  unreadable: (text: string) =>
    `The board could not read "${text}" as a quadratic, so nothing went up. Ask the teacher in one short line to say it again or write it in the box below the board. Do not guess the numbers.`,
  refused: (reason: string) => `The board refused that: ${reason} Say that to them in one short line, in your own voice, and do not claim anything happened.`,
  method: (v: View) =>
    `The board is set up for ${METHOD_WORDS[v.method!]}: ${v.total_steps} lines, none up yet. Say you're ready in one short line and wait for the teacher to ask for the first line. Do not read or describe any of the working.`,
  sameMethod: (v: View) =>
    `The board is already set up for ${METHOD_WORDS[v.method!]}, with ${v.revealed} of ${v.total_steps} lines up, so nothing changed. Say so in a few words.`,
  next: (v: View) => {
    const last = v.steps[v.steps.length - 1];
    const tail = v.remaining === 0 ? ' That was the last line: the answer is boxed on the board.' : ` ${v.remaining} more to come; wait to be asked.`;
    return `Line ${last.n} of ${v.total_steps} is now on the board: ${last.working}. Read it out once in your own words, keeping every number and symbol exactly as written: "${last.say}"${tail} Say nothing else.`;
  },
  revealAll: (v: View) => `Every line is up, and the answer is boxed on the board. In one short line, say the answer is ${answerText(v.facts!)}: those exact values, not decimals.`,
  back: (v: View) => {
    if (!v.revealed) return 'The working is back to blank. Say so in one very short line. Do not repeat any line you just took down.';
    const last = v.steps[v.steps.length - 1];
    return `The last line was taken down; ${v.revealed} ${v.revealed === 1 ? 'line is' : 'lines are'} still up, ending at ${last.working}. Say in one very short line that you've gone back a step, and nothing more.`;
  },
  graph: (v: View) => `The graph is ${v.graph_visible ? 'up' : 'hidden'}. Acknowledge it in a few words.`,
  clear: () => "The board is clean. Say so in one short line and ask what they'd like up next. Do not refer to the equation you just wiped.",
  failed: () => 'The board did not answer that. Ask the teacher in one short line to try again, and do not say anything changed.',
};

const pressed = (what: string, outcome: string) => `The teacher ${what} on the board themselves. ${outcome}`;

/**
 * What the host is told about a control the teacher used: it cannot see the
 * screen. Every change is narrated as the original panel's voice did, except
 * showing or hiding the graph and wiping the board, which speak for themselves
 * (a voice announcing every tap is a voice talking over a lesson); the live
 * board in the host's context still says what happened.
 */
export function eventFor(v: View): string | undefined {
  switch (v.last_action) {
    case 'equation': return pressed('wrote an equation', said.equation(v, 'written'));
    case 'method': return pressed(`picked ${METHOD_WORDS[v.method!]}`, said.method(v));
    case 'reveal': return pressed('put the next line up', said.next(v));
    case 'reveal_all': return pressed('put all the working up', said.revealAll(v));
    case 'back': return pressed('took the last line down', said.back(v));
    default: return undefined;
  }
}
