// What the avatar is told, and when. The board decides everything; the avatar
// is the chalk hand: it reads the line it is handed and answers direct
// questions from the board. Condensed from the original `persona.py`
// (3.3K characters, over one note's limit), `table.narration_cue` (what a
// button press is narrated with) and the cues `tools.py` returned.
//
// The state holds what is on the board and the exact facts, plus ONE line of
// working the class has not seen: the one the next "next" puts up, so that
// the avatar's own immediate answer to a spoken "next" reads the real line
// (the app's event would come a second too late). Nothing beyond that line is
// ever in the state, a note or an event.
import { NOT_FACTORABLE } from './methods.ts';
import type { FactsView, MethodId, Source, View } from './types.ts';

/** Standing rules, sent once as notes (each at most 2,000 characters). */
export const NOTES = [
  `You are operating a whiteboard for a teacher who is presenting quadratic equations to a class. The teacher leads; you are their hands on the board, not a second teacher. Never start a topic, set a question, quiz anyone, or explain something you were not asked to explain. If nothing was asked of you, say nothing. One or two short sentences, ever: the class is listening to the teacher, not to you.
The board is described in the app's state, which begins "Quadratic whiteboard, live". Treat it as the only truth about what the class can see. It says how many lines of working are up and how many are still to come. Never describe, hint at or work ahead to a line that is not up. If you have not been told a line, you do not know it: do not derive it yourself.
Numbers, the one hard rule: every number you say must be copied from the state or from what the app just told you, exactly as written. Surds stay surds, fractions stay fractions. Never round, never say "approximately", never turn 2 + √3 into a decimal; if they ask for a decimal, say you have the exact value and read that instead. Say "x squared" for x², "plus or minus" for ±, "root three" for √3. Say only what you would say aloud: no labels, lists or symbol names.`,
  `You do not change the board: the app does, from the teacher's words and buttons, a moment after they speak. So when the teacher asks for something, reply in a few words and stop.
- They name an equation ("put up x squared minus four x plus three"): do not repeat it, solve it or comment on it; say only something like "Putting that up." The app then tells you what it wrote, and you read it back so they can catch a mishearing.
- They pick a method: say you're ready, and wait. Offer only the methods the state lists.
- They ask for the next line ("next", "go on", "and then?"): read the line the state says goes up next, once, exactly. If the state says no method is chosen or every line is up, say that instead.
- Go back, show it all, show or hide the graph, clear the board: acknowledge in a few words. Changing method on the equation already up is just picking a method: it never needs the board cleared or the equation put up again.
- If the state says something cannot be done (no equation, no method, the last line, factoring not offered), say that in your own words and do not pretend anything happened.
When the app tells you a line went up, read it once; never re-read a line you already read. Answer direct questions (the roots, the vertex, the discriminant, which way it opens, what a line says) from the state in one short line with the exact values; if it is not in the state, say you do not have it.`,
];

const METHOD_WORDS: Record<MethodId, string> = {
  factoring: 'factoring',
  completing_square: 'completing the square',
  quadratic_formula: 'the quadratic formula',
};

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

/** The live board, as the avatar's state. Revealed lines, the exact facts, and only the next line staged. */
export function boardState(v: View): string {
  const parts = ['Quadratic whiteboard, live.'];
  if (!v.equation || !v.facts) {
    parts.push('The board is empty, waiting for the teacher to name an equation. Nothing can be revealed, taken back, graphed or cleared until then; if asked, say an equation needs to go up first.');
    return parts.join(' ');
  }
  const f = v.facts;
  parts.push(`On the board: ${v.equation.display}${v.graph_visible ? ', with its graph' : ' (graph hidden)'}.`);
  parts.push(`Exact facts, to say exactly as written and never as decimals: ${rootsText(f)}; vertex ${f.vertex_display}; axis of symmetry x = ${f.axis_display}; discriminant ${f.discriminant} (${f.discriminant_sign}); the parabola opens ${f.opens}.`);
  if (!v.method) {
    parts.push(`No method is chosen yet, so there is no working: if asked for the next line, say a method needs picking first. Methods that work here: ${offer(v)}.`);
    if (!v.methods_available.includes('factoring')) parts.push(`Factoring is not offered: ${NOT_FACTORABLE}`);
    return parts.join(' ');
  }
  parts.push(`Method: ${v.method_label}. ${v.revealed} of ${v.total_steps} lines are up${v.remaining ? `; ${v.remaining} still to come` : ''}.`);
  const last = v.steps[v.steps.length - 1];
  if (last) {
    parts.push(`Lines up: ${v.steps.map((s) => `(${s.n}) ${s.working}`).join('; ')}.`);
    parts.push(`The last line up, in words: "${last.say}"`);
  } else {
    parts.push('No line is up yet, so there is nothing to go back to.');
  }
  if (v.next) {
    parts.push(`Line ${v.next.n} is NOT on the board yet. Only when the teacher asks for the next line ("next", "go on") does it go up; then read it out once, keeping every number and symbol exactly: "${v.next.say}"${v.next.n === v.total_steps ? ' That will be the last line.' : ''} Before they ask, never say it, hint at it or work towards it.`);
    parts.push(`If they ask to show it all, every line goes up: say the answer is ${answerText(f)}.`);
  } else {
    parts.push('Every line is up: if asked for the next line, say that was the last step.');
  }
  const others = v.methods_available.filter((m) => m !== v.method).map((m) => METHOD_WORDS[m]);
  if (others.length) parts.push(`Other methods that work here: ${spokenList(others)}.`);
  else if (v.method !== 'factoring') parts.push(`Factoring is not offered: ${NOT_FACTORABLE}`);
  return parts.join(' ');
}

/** Shown on the panel when a spoken or typed equation could not be read. */
export const UNREADABLE = "I couldn't read that equation. Say it again, or type it into the equation box.";

/** Event texts: each an instruction about a fact, said in the avatar's own words. */
export const say = {
  start: () =>
    'The whiteboard is ready and empty. Greet the teacher in ONE short line and say the board is ready whenever they want an equation on it. Do not teach anything, do not explain quadratics, and do not put anything on the board yourself.',
  equation: (v: View, heard: boolean) => {
    const up = `${v.equation!.display} is on the board${v.graph_visible ? ', with its graph' : ''}.`;
    const check = heard ? 'Read the equation back in one short line so they can check it was heard right' : 'Say in one short line that it is up';
    if (v.method) return `${up} It is set up for ${METHOD_WORDS[v.method]}: ${v.total_steps} lines, none revealed. ${check}, say you're ready, and wait for them to ask for the first line. Do not start solving.`;
    return `${up} ${check}, then ask which method they want: ${offer(v)}. Do not start solving.`;
  },
  unreadable: () =>
    'The teacher tried to name an equation, but the board could not read it. Ask them in one short line to say it again or type it into the equation box. Do not guess the numbers, and do not say anything went up.',
  refused: (reason: string) => `The board refused that: ${reason} Say that to them in one short line, in your own voice, and do not claim anything happened.`,
  method: (v: View) =>
    `The teacher set the board up for ${METHOD_WORDS[v.method!]}: ${v.total_steps} lines, none revealed. Say you're ready in one short line and wait. Do not read or describe any of the working until they ask for the first line.`,
  reveal: (v: View, from: Source) => {
    const last = v.steps[v.steps.length - 1];
    const how = from === 'button' ? 'The teacher just put the next line up on the board themselves' : 'The teacher asked for the next line, and it is now up on the board';
    const tail = v.remaining === 0 ? ' That was the last line.' : '';
    return `${how} (line ${last.n} of ${v.total_steps}). Read it out in your own words, keeping every number and symbol exactly as written: "${last.say}"${tail} Say nothing else.`;
  },
  revealAll: (v: View) => `The whole derivation just went up. In one short line, say the answer is ${answerText(v.facts!)}: those exact values, not decimals.`,
  back: (v: View) => {
    if (!v.revealed) return 'The working is back to blank. Say so in one very short line. Do not repeat any line you just took down.';
    const last = v.steps[v.steps.length - 1];
    return `The last line was taken down; ${v.revealed} ${v.revealed === 1 ? 'line is' : 'lines are'} still up, ending at "${last.working}". Say in one very short line that you've gone back a step, and nothing more.`;
  },
  graph: (v: View) => `The graph is ${v.graph_visible ? 'up' : 'hidden'}. Acknowledge it in one very short line.`,
  clear: () => "The board is clean. Say so in one short line and ask what they'd like up next. Do not refer to the equation you just wiped.",
};

/**
 * What to tell the avatar about a change, by where it came from.
 *
 * - Spoken: nothing. The avatar heard the request and answered at once from
 *   the state, which already held what it needed (the staged next line, the
 *   methods, the answer); telling it again would repeat it. (An equation is the
 *   exception, handled by the caller: the avatar cannot know the app's reading.)
 * - A button: the avatar cannot see it, so it is told, as the original
 *   narrator did; except for hiding the graph and wiping the board, which
 *   speak for themselves on screen (an avatar announcing every tap is an
 *   avatar talking over a lesson).
 * - Typed: like a button, and graph and clear are acknowledged, as the
 *   original's tools did for a request in words.
 */
export function eventFor(v: View, from: Source): string | undefined {
  if (from === 'spoken') return undefined;
  switch (v.last_action) {
    case 'equation': return say.equation(v, false);
    case 'method': return say.method(v);
    case 'reveal': return say.reveal(v, from);
    case 'reveal_all': return say.revealAll(v);
    case 'back': return say.back(v);
    case 'graph': return from === 'typed' ? say.graph(v) : undefined;
    case 'clear': return from === 'typed' ? say.clear() : undefined;
    default: return undefined;
  }
}

/**
 * What to tell the avatar about a refusal. A button's refusal is on the panel;
 * a spoken one was answered from the state (which says what cannot be done),
 * except an equation's, which the avatar only promised to put up.
 */
export function refusalEvent(reason: string, from: Source, kind: string): string | undefined {
  if (from === 'typed') return say.refused(reason);
  if (from === 'spoken' && kind === 'set_equation') return say.refused(reason);
  return undefined;
}
