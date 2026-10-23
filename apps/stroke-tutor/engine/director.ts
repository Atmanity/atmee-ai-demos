// What Ren is told, and how Ren acts. The sheet decides everything; Ren
// teaches. Ren reaches the sheet through its tools (show a stroke, move on,
// choose a character, start over) and speaks from each result; strokes the
// learner draws are graded by the sheet itself and told to Ren as events.
//
// Ren is never told what an unearned stroke looks like, so every text here is
// built from the public Snapshot only (this file imports nothing but types and
// runs in the page as well as on the server).
//
// Condensed from the original persona.py and the coach's cues. The rules that
// came from real failures are kept: never describe the stroke you are asking
// for; a question about the live stroke is a request to be SHOWN, never "I
// can't describe it"; say the note's claim without softening it.
import type { AppTool } from '../../../server/app-server.ts';
import { VERDICT_LABEL, type Snapshot } from './types.ts';

/** Ren's rules: the session's tool instructions (at most 4,000 characters). */
export const INSTRUCTIONS = `You are Ren, a calm calligraphy teacher giving one learner a stroke-order lesson in Hanshi. They write a character one stroke at a time on a practice sheet with a finger or mouse. The sheet grades each stroke's ORDER and DIRECTION, never neatness, and neither do you. You cannot see the sheet: you reach it only through its tools, and the live sheet is in your context.

The hard rule: NEVER describe a stroke the learner has not earned. Not its shape, where it sits, which way it travels, "the long one", "the one on the left". The sheet withholds unearned strokes from you on purpose; never guess them from your own knowledge of stroke order. Ask for a stroke by its number ("stroke three"), then stop and let them write.

Tools:
- show_stroke: any question about the stroke they are on ("which way does it go?", "where do I start?", "what shape is it?", "which comes first?"), "show me", being stuck, not knowing it. It draws the stroke on their sheet and gives you its teaching line. Never answer such a question yourself, and never say "I can't describe it".
- next_stroke: "next", "ready", "go on", once a stroke is done.
- choose_character: they ask for a character ("the tree one", "永", "eternity", "the letter A"). Pass what they called it.
- next_character: they want another character without naming one.
- start_over: they want this character again from its first stroke. Only when they ask.

How to act:
- Every request that changes the sheet is a tool call, even one word: "Next." on its own, or a "yes" to your own "shall we go on?", is next_stroke. The sheet changes only when you call: "let me show you" or "stroke three is ready" without the call changes nothing and leaves them waiting. Call first, every time, then speak from the result.
- Never say an action happened (a stroke is ready, a character is up, a stroke is shown) unless a tool's result said so. Never invent an outcome: whether a stroke was right, which comes next, what a stroke looks like. Only the sheet knows; call the tool even when you think you know.
- When a tool refuses, it gives you the sentence: say that calmly and never pretend anything happened.
- You cannot draw for them: drawing is theirs. The sheet grades every stroke they draw and tells you the verdict with a sentence to teach from. Say it in your own voice WITHOUT changing what it claims: "always left to right" never becomes "usually". When a stroke went the wrong way, say the sheet's two sentences in the order given: what they drew, then which way it goes.
- When they press a button on the sheet, the sheet tells you what happened; carry on from that.
- Questions about the score, which stroke they are on, what went wrong, or a stroke already earned: answer from the live sheet in your context, no tool.
- While they are writing, silence is fine: do not prompt them again unless they speak to you.

Your voice: unhurried and precise. Short sentences, one idea at a time, never more than two sentences before you stop. Praise the specific thing ("good, horizontal before vertical"); correct without blame. Never comment on neatness. Say a Japanese character by its meaning and reading ("永, eternity"), never by describing its parts. Output only what you say aloud: no lists, labels or markdown.
The characters, easiest first: 一 one, 十 ten, 川 river, 木 tree, 永 eternity (the classic five-stroke exercise), and the capitals A and E.`;

// Lenient on purpose: the platform rejects a call whose arguments do not fit
// the schema before the page sees it, and the host then tends to say the
// action happened. So no enum, no additionalProperties: false, no tight
// lengths, nothing required that the app can do without; the app normalises.
const noArgs = { type: 'object', properties: {} };
const awaits = { mode: 'await' as const, timeoutSeconds: 10 };

/** The sheet's tools. Each is answered by the server, which owns the lesson. */
export const TOOLS: AppTool[] = [
  { type: 'function', name: 'show_stroke', description: 'Draws the stroke the learner is on, on their sheet, and returns its teaching line. Call it for any question about that stroke (which way it goes, where it starts, its shape, which comes first), for "show me", or when they are stuck.', parameters: noArgs, 'x-atmee': awaits },
  { type: 'function', name: 'next_stroke', description: 'Moves the sheet on to the next stroke once the current one is done (drawn right or shown). Call it every time the learner says "next" (even that one word), "ready", "go on", "what\'s next", or yes to moving on: the sheet does not move until you call it. It refuses while the current stroke is unfinished, and finishes the character after its last stroke.', parameters: noArgs, 'x-atmee': awaits },
  { type: 'function', name: 'choose_character', description: 'Puts a character on the sheet, from its first stroke. Call it when the learner asks for a particular one. On offer: 一 one, 十 ten, 川 river, 木 tree, 永 eternity, and the capital letters A and E.',
    parameters: { type: 'object', properties: { character: { type: 'string', maxLength: 500, description: 'The character as the learner named it, in any form: "tree", "木", "Eternity", "the letter A".' } } },
    'x-atmee': awaits },
  { type: 'function', name: 'next_character', description: 'Puts the next character in the lesson order on the sheet. Call it when the learner wants another character without naming one.', parameters: noArgs, 'x-atmee': awaits },
  { type: 'function', name: 'start_over', description: 'Starts the character on the sheet again from its first stroke, wiping their progress on it. Only when the learner asks to start over; never on your own.', parameters: noArgs, 'x-atmee': awaits },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "十 (ten, read jū)" or "A (the capital letter)". */
function named(v: Snapshot): string {
  const c = v.character!;
  return c.script === 'latin' ? `${c.glyph} (the capital letter)` : `${c.glyph} ("${c.meaning}", read ${c.reading})`;
}

function menu(v: Snapshot): string {
  return v.catalog.map((e) => `${e.glyph} ${e.meaning} (${plural(e.strokes_total, 'stroke')})`).join(', ');
}

const TIMES = ['no', 'one', 'two', 'three', 'four', 'five'];

/** How many of the strokes so far were right on the first try. */
export const firstTries = (v: Snapshot) => v.results.filter((r) => r.how === 'drawn' && r.tries <= 1).length;

/**
 * The first-try record in plain words, from the sheet: "3 of 4 strokes right
 * on the first try; stroke 1 took two tries." Live, Ren praised "every single
 * stroke right on your first try" after a stroke drawn backwards first: praise
 * comes from this record, never from the impression of a lesson.
 */
export function firstTryRecord(v: Snapshot): string {
  const exceptions = v.results.filter((r) => !(r.how === 'drawn' && r.tries <= 1)).map((r) => r.how === 'drawn'
    ? `stroke ${r.index + 1} took ${TIMES[r.tries] ?? r.tries} tries`
    : `stroke ${r.index + 1} was shown to them ${r.tries >= 2 ? 'after two misses' : 'because they asked'}`);
  return `${firstTries(v)} of ${plural(v.results.length, 'stroke')} right on the first try${exceptions.length ? `; ${exceptions.join('; ')}` : ''}.`;
}

/** Which stroke, by number: the only way Ren may refer to an unearned one. */
const position = (v: Snapshot) => `stroke ${Math.min(v.stroke_index + 1, v.character?.strokes_total ?? 1)} of ${v.character?.strokes_total ?? 0}`;

/**
 * The live sheet, as Ren's state. Never an unearned stroke: the live stroke's
 * name and teaching line appear only once it is resolved (drawn correctly or
 * shown), and later strokes not at all.
 */
export function boardState(v: Snapshot): string {
  const parts = ['Hanshi stroke-order lesson, the live practice sheet. The sheet decides; you teach.'];
  if (!v.character) {
    parts.push(`No character is on the sheet yet; the learner sees the menu: ${menu(v)}. When they ask for one, call choose_character.`);
    return parts.join(' ');
  }
  const c = v.character;
  parts.push(`On the sheet: ${named(v)}, ${plural(c.strokes_total, 'stroke')}.`);
  const verdict = v.last_verdict;

  if (v.phase === 'writing') {
    parts.push(`${cap(position(v))} is live: they are writing it now. You have not been told what it looks like, where it starts or which way it travels; never describe it or guess it. Attempts on it so far: ${v.attempts}${v.attempts === 1 ? ' (a second miss and the sheet shows it to them)' : ''}.`);
    if (verdict) parts.push(`The sheet's last verdict on it: ${VERDICT_LABEL[verdict.kind]}: "${verdict.travel ? travelSentences(verdict.travel) : verdict.note}"`);
    parts.push('If they ask to be shown it, which way it goes, where it starts or what it looks like, or say they are stuck: call show_stroke and teach from its result.');
  } else if (v.phase === 'coaching') {
    const how = verdict?.revealed ? (v.attempts >= 2 ? 'shown to them after two misses' : 'shown to them because they asked') : 'drawn correctly';
    parts.push(`${cap(position(v))} is done: ${how}. It is on the sheet now. When they are ready they say "next" (call next_stroke) or tap Next stroke.`);
  } else if (v.phase === 'debrief') {
    parts.push(`The character is finished. Their record: ${firstTryRecord(v)} Their finished sheet and a summary are on screen. The menu: ${menu(v)}.`);
  }

  const earned = v.strokes.filter((s) => s.status === 'done' && s.teach);
  parts.push(earned.length
    ? `Strokes earned so far (yours to talk about): ${earned.map((s) => `stroke ${s.index + 1}, ${s.name}: "${s.teach}"`).join(' ')}`
    : 'None of its strokes is earned yet.');
  if (v.phase !== 'debrief') parts.push(v.results.length ? `Their record on this character so far: ${firstTryRecord(v)}` : 'No stroke of this character is finished yet.');
  return parts.join(' ');
}

/** A stroke drawn backwards, as two sentences that cannot be flipped: what they drew, then which way it goes. */
export const travelSentences = (travel: { drawn: string; right: string }) => `You drew it ${travel.drawn}. This stroke goes ${travel.right}.`;

/** Asking for the stroke that just became live, by number only. */
function ask(v: Snapshot): string {
  return `${cap(position(v))} of ${v.character!.glyph} is live. Ask them for it in ONE short line, then stop and wait. Do NOT say what shape it is, where it goes, or which way it travels: that is what they are practising.`;
}

/** You have just greeted them: Ren's own greeting introduces Ren in Hanshi and offers a first character. */
const GREETED = 'You have just greeted them; do not greet or introduce yourself again.';

/**
 * What each action did, in words Ren speaks from: tool results, and the events
 * for strokes drawn and buttons pressed. Each begins with the plain outcome
 * ("Done:", "Refused:", "Not right:"), so the first real words of Ren's reply
 * are the sheet's and a filler said while the tool ran cannot pre-judge them.
 */
export const say = {
  opening: () => `${GREETED} The character menu is on their sheet. In one short line, tell them they can tap a character on the menu or name one; do not repeat an offer you have just made. Put a character up only when they choose.`,

  /** A call started again on a lesson that was already under way. */
  resume: (v: Snapshot) => v.character
    ? `${GREETED} They are back at their sheet: ${named(v)} is up, ${position(v)}${v.phase === 'writing' ? ' is live' : v.phase === 'coaching' ? ' is done' : ''}${v.phase === 'debrief' ? '; the character is finished' : ''}. In one short line, carry on from there. Do not describe any stroke they have not earned.`
    : say.opening(),

  started: (v: Snapshot) => {
    const c = v.character!;
    const intro = c.script === 'latin'
      ? `Done: ${c.glyph}, the capital letter, is on the sheet, in ${plural(c.strokes_total, 'stroke')}.`
      : `Done: ${c.glyph} is on the sheet. It means "${c.meaning}" and reads ${c.reading}, in ${plural(c.strokes_total, 'stroke')}.`;
    return `${intro} Say that in one short line, then: ${ask(v)}`;
  },

  /** choose_character for the character already up: nothing changed. */
  alreadyUp: (v: Snapshot) => `Nothing changed: ${v.character!.glyph} is already on the sheet, ${position(v)}${v.phase === 'writing' ? ' is live' : ' is done'}. Tell them so in one short line and carry on; start it over only if they ask.`,

  /** choose_character for something not on the menu. */
  unknown: (asked: string, v: Snapshot) => `Refused: "${asked}" is not on the menu, so nothing changed. The menu: ${menu(v)}. Say that in one short line and ask which of these they would like.`,

  /** choose_character with nothing usable named. */
  unnamed: (v: Snapshot) => `Not yet: no character was named, so nothing changed. Ask them which one they would like: ${menu(v)}.`,

  restarted: (v: Snapshot) => `Done: the sheet is clear and back at the beginning of ${v.character!.glyph}. ${ask(v)}`,

  next: (v: Snapshot) => `Done: ${ask(v)}`,

  cleared: (v: Snapshot) => `Done: they cleared their attempt; the attempt count is back to zero. ${ask(v)}`,

  debrief: (v: Snapshot) => {
    const all = firstTries(v) === v.results.length;
    return `Done: that was the last stroke of ${v.character!.glyph}. Their record, from the sheet: ${firstTryRecord(v)} Their finished sheet with this summary is on screen. Give a short, warm debrief in two sentences that praises only what this record says${all ? '' : ': do NOT say every stroke was right first time, because it was not'}, then ask which character they would like next; put one up only when they choose.`;
  },

  /**
   * The coaching line after a verdict lands. The note is QUOTED rather than
   * summarised: it is the only place a claim about stroke order or direction
   * may come from, and a paraphrase is how "horizontals travel left to right"
   * becomes "usually left to right".
   */
  verdict: (v: Snapshot) => {
    const verdict = v.last_verdict!;
    const note = verdict.note;
    if (verdict.ok) {
      return `Right: the stroke they drew was correct. In two short sentences: confirm it, then say this teaching point in your own words WITHOUT changing what it claims: "${note}" Then tell them to say "next" when they are ready.`;
    }
    if (verdict.revealed) {
      // show_stroke, the Show me button and the two-miss rescue mint the SAME
      // verdict, so the story comes from the attempt count: a learner who
      // asked before drawing anything must not be told they missed twice.
      return v.attempts >= 2
        ? `Shown: they missed it twice, so the stroke has been drawn on the sheet for them. Teach it plainly and kindly, keeping the claim exactly as written: "${note}" No blame. Then tell them to say "next" when they are ready.`
        : `Done: they asked to be shown it, so the stroke is drawn on the sheet now. Teach it plainly and kindly, keeping the claim exactly as written: "${note}" No blame. Then tell them to say "next" when they are ready.`;
    }
    if (verdict.kind === 'order') return `Not right: wrong stroke ORDER, they drew a different stroke of this character. Say this in one short line: "${note}" and ask them to try the one we're on. Do NOT describe the stroke you want.`;
    if (verdict.kind === 'direction') {
      const lines = verdict.travel ? travelSentences(verdict.travel) : note;
      return `Not right: the stroke went the wrong DIRECTION. Say these two sentences first, in this order, keeping both directions exactly as written: "${lines}" Then ask them to draw it again.`;
    }
    if (verdict.kind === 'start') return `Not right: right shape and direction, but it began in the wrong place. Say this in one short line: "${note}" and invite another try.`;
    return `Not right: that was not the stroke. Do NOT tell them what it is. Give them this nudge in one short line: "${note}" and invite another try.`;
  },

  /** A stroke the learner drew, graded by the sheet: the verdict comes first. */
  drawn: (v: Snapshot) => `${say.verdict(v)} (This is the sheet's verdict on the stroke they just drew.)`,

  refused: (reason: string) => `Refused: ${reason} Say that to them in one calm line, in your own voice, and do not claim anything happened.`,
};

/** A button press, told to Ren: Ren cannot see the screen. */
export const pressed = (button: string, outcome: string) => `The learner pressed "${button}" on the sheet. ${outcome}`;

/** How long an event may wait for the floor: the opening matters more than a coaching line, which goes stale. */
export const TTL = { opening: 45, cue: 20 } as const;
