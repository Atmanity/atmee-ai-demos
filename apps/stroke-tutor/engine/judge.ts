// What a typed or spoken line means to the board. SERVER ONLY (it knows the
// character list). The original agent's model read every line and chose a
// tool (choose_character, show_me, next_stroke, start_over); here rules do
// that for the phrasings people actually use, and the app's own model call
// (server.ts, `structured()`) takes only the lines the rules cannot place,
// above all a question about the live stroke worded some other way, which
// must become a reveal rather than the avatar describing the stroke itself.
//
// Words never produce a stroke: drawing is the hand's (lesson.ts refuses one).
import { CHARACTERS, find } from './characters.ts';
import type { Intent, Phase, Snapshot } from './types.ts';

/** Lower case, accents off, punctuation to spaces; CJK glyphs are matched before this. */
export const norm = (text: string) => text.toLowerCase().replace(/[’‘`]/g, "'").normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------- characters

/** Spoken names of each character, as people say them (the ids and glyphs are matched too). */
const SPOKEN: [string, RegExp][] = [
  ['ichi', /\b(ichi|(character|kanji|sign|symbol|one) for one|single stroke( one)?|one stroke one|number one character)\b/],
  ['juu', /\b(ten|juu|ju|jyu)\b/],
  ['kawa', /\b(river|kawa|rivers)\b/],
  ['ki', /\b(tree|wood|trees|ki)\b/],
  ['ei', /\b(eternity|eternal|forever|ei)\b/],
  ['latin_a', /\b(letter|capital|uppercase|big) a\b/],
  ['latin_e', /\b(letter|capital|uppercase|big) e\b/],
];

/** A choosing verb: without one, mid-character, a name in passing ("this takes forever") is not a request. */
const CHOOSE = /\b(let'?s|let us|can we|could we|shall we|i'?d like|i would like|i want|i wanna|switch|change|try|practi[cs]e|write|learn|start|go with|pick|choose|how about|what about|give me|teach me|move to|go to)\b|^do\b/;

/** Filler around a bare name ("the tree one please" is just the name). */
const FILLER = /\b(ok(ay)?|please|the|one|character|kanji|for|let'?s|do|how|about|what|um+|uh+|so|then|now|maybe|can|we|i|want|to|try|go|with|switch|letter|capital)\b/g;

/**
 * The character named in a line, or null. Glyphs first (a typed 永), then
 * spoken names. A bare "one" counts only on the menu (`menu`): mid-character
 * it is far more likely a number than 一.
 */
export function characterIn(text: string, menu = true): string | null {
  for (const c of CHARACTERS) if (c.script === 'kanji' && text.includes(c.glyph)) return c.id;
  const t = norm(text);
  for (const [id, pattern] of SPOKEN) if (pattern.test(t)) return id;
  // A bare "A" or "E" (typed, or as the recogniser writes a letter): only when it is the whole request.
  const bare = t.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  if (bare === 'a' || bare === 'ay') return 'latin_a';
  if (bare === 'e') return 'latin_e';
  if (menu && /^(the )?one( please)?$/.test(t)) return 'ichi';
  return null;
}

/** The name is (nearly) all that was said: "永", "tree please", "the letter A". */
function onlyAName(text: string): boolean {
  const t = norm(text).replace(/\b(the|letter|capital|uppercase|big|one|character|kanji|please|ok(ay)?|um+|uh+|so|let'?s|do|how about|what about|then|now|maybe)\b/g, ' ');
  return t.replace(/\b(ichi|ten|juu|ju|jyu|river|kawa|tree|wood|ki|eternity|eternal|forever|ei|a|e)\b/g, ' ').trim() === '';
}

// ---------------------------------------------------------------- commands

const RESTART = /\b(start (it |this |this one |the character |the whole thing )?(over|again)|from the (top|beginning|start)|wipe (it|the board|everything|it all)|begin again|redo (it|this|the (whole )?character)|reset( the board)?|start from scratch)\b/;
const AGAIN = /^(ok(ay)? )?((do it|let'?s do it|let'?s go|go) )?(again|once more|one more time)( please)?$|\b(do (it|that one) again|same one again|one more time)\b/;
const CLEAR = /^(please )?(clear|erase|undo)( it| that| this| the board| my (ink|attempt|stroke|drawing))?( please)?$|\b(clear|erase|rub out) (it|that|this|the board|my (ink|attempt|stroke|drawing))\b/;
const NEXT_CHARACTER = /\b(next|another|different|new|other) (character|letter|kanji|glyph|sign|symbol)\b|\bsomething (else|different)\b|\banother one\b|\ba different one\b/;
const MENU_NEXT = /^(ok(ay)? )?(next|next one|another|another one|go on|keep going|more|onwards|ready|i'?m ready|let'?s go|let'?s start|let'?s begin)( please)?$/;

/** A question about the live stroke, or being stuck: a request to be SHOWN it (only while one is live). */
const SHOW = new RegExp([
  /\bshow (me|us|it)\b/,
  /\b(which|what) way\b/,
  /\bwhich direction\b/,
  /\bwhere (do|does|should|shall|would|can) (i|it|we|you) (start|begin|go|put)\b/,
  /\bwhere (is|does) (it|the stroke|this one|that one) (go|start|begin)\b/,
  /\bwhere('s| is) the (start|beginning)\b/,
  /\bhow (do|does|should|shall|would|can) (i|it|we|you) (draw|write|do|go|make|start)\b/,
  /\bhow does (it|this one|this stroke) go\b/,
  /\bwhat (does|should|would) (it|this one|the stroke) look like\b/,
  /\bwhat shape\b/,
  /\b(which|what) (stroke|one|line) (comes |goes |is )?(first|next|now)\b/,
  /\bwhat('s| is) (the |this )?(first|next|current) (stroke|one|line)\b/,
  /\bi (don'?t|do not|dont) know\b/,
  /\bno idea\b/,
  /\bi'?m stuck\b|\bi am stuck\b/,
  /\bi (can'?t|cannot|can not|don'?t) remember\b/,
  /\bi forgot\b/,
  /\b(help me|can you help|need help|help please)\b|^help$/,
  /\b(hint|clue)\b/,
  /\b(demonstrate|draw it for me|draw it first|can you draw)\b/,
].map((r) => r.source).join('|'));

/** An explicit move on. In the writing phase this is refused ("Finish this stroke first"), which is the answer. */
const NEXT_EXPLICIT = /^(ok(ay)? )?(next|next one|next stroke|skip|skip it|skip this( one)?|move on)( please)?$|\b(next stroke|move on|skip (it|this|this one|this stroke))\b/;
/** Readiness words that only mean "move on" once the stroke is done. */
const NEXT_READY = /^(ok(ay)?|yes|yep|yeah|sure|got it|ready|i'?m ready|go on|go ahead|continue|keep going|onwards|carry on|let'?s go|let'?s continue|what'?s next|and now|then what)( please| then| next)?$|\b(what'?s next|i'?m ready|go on|carry on|keep going|the next one|let'?s continue)\b/;

/**
 * The board action a line asks for, or null for one the avatar should simply
 * answer. Phase-aware, because the same words mean different things: "next"
 * is the next stroke mid-character and the next character on the menu; "show
 * me" is a reveal only while a stroke is live (once it is done the avatar
 * already has its teaching line).
 */
export function intentIn(text: string, phase: Phase, current: string | null): Intent | null {
  const t = norm(text);
  if (!t && !CHARACTERS.some((c) => text.includes(c.glyph))) return null;
  const named = characterIn(text, phase === 'intro' || phase === 'debrief');
  const chooses = named !== null && named !== current && (phase === 'intro' || phase === 'debrief' || CHOOSE.test(t) || onlyAName(text));

  if (phase === 'intro' || phase === 'debrief') {
    if (chooses) return { kind: 'start_character', id: named! };
    if (phase === 'debrief' && (RESTART.test(t) || AGAIN.test(t))) return { kind: 'start_character' };
    if (NEXT_CHARACTER.test(t) || MENU_NEXT.test(t)) return { kind: 'next_character' };
    if (phase === 'intro' && RESTART.test(t)) return { kind: 'start_character' };
    return null;
  }

  // A different character named outright wins: "start over with the tree" is the tree.
  if (chooses) return { kind: 'start_character', id: named! };
  if (RESTART.test(t)) return { kind: 'start_character' };
  if (NEXT_CHARACTER.test(t)) return { kind: 'next_character' };
  if (CLEAR.test(t)) return { kind: 'clear_attempt' };
  if (phase === 'writing') {
    if (SHOW.test(t)) return { kind: 'reveal' };
    if (NEXT_EXPLICIT.test(t)) return { kind: 'next_stroke' };
    return null;
  }
  // coaching: the stroke is done and drawn; "next" and readiness move on.
  if (NEXT_EXPLICIT.test(t) || NEXT_READY.test(t)) return { kind: 'next_stroke' };
  return null;
}

/** Whether a line the rules could not place is worth the model's time: a word or two of small talk is not. */
export const worthAsking = (text: string) => norm(text).split(' ').filter(Boolean).length >= 2;

// ---------------------------------------------------------- the model's turn

export type ModelAction = 'show' | 'next_stroke' | 'next_character' | 'start_over' | 'clear' | 'choose' | 'none';

export const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['show', 'next_stroke', 'next_character', 'start_over', 'clear', 'choose', 'none'] },
    character: { type: 'string', description: 'For "choose": the id of the character they asked for (or what they called it if it is not on the list); otherwise empty.' },
  },
  required: ['action', 'character'],
};

function boardInWords(v: Snapshot): string {
  if (!v.character) return 'No character is on the board yet; the menu is showing.';
  const where = `${v.character.glyph} (${v.character.meaning}) is on the board`;
  if (v.phase === 'writing') return `${where}; the learner is drawing stroke ${v.stroke_index + 1} of ${v.character.strokes_total} right now.`;
  if (v.phase === 'coaching') return `${where}; stroke ${v.stroke_index + 1} of ${v.character.strokes_total} is done and drawn, and the next one waits for them to say "next".`;
  return `${where}; the character is finished and the menu is showing.`;
}

export const intentPrompt = (v: Snapshot, utterance: string) => `A learner in a stroke-order lesson said: "${utterance}"
(Speech recognition may have misheard words.) ${boardInWords(v)}
The characters on offer: ${CHARACTERS.map((c) => `${c.id} (${c.glyph}, ${c.meaning})`).join(', ')}.
What do they want the board to do?
- show: they ask how to write the stroke they are drawing now (which way it goes, where it starts, what shape it is, which stroke comes first or next), say they don't know or are stuck, or ask to be shown it.
- next_stroke: move on to the next stroke ("next", "ready", "go on").
- next_character: move on to another character without naming it.
- start_over: start this character again from its first stroke.
- clear: clear their last attempt.
- choose: they ask for a particular character; put its id in "character".
- none: anything else: small talk, thanks, a question about a stroke already done, about the score or about the lesson.`;

/** The model's answer as an intent, held to what the phase allows. */
export function intentFromModel(answer: { action?: string; character?: string } | null | undefined, phase: Phase, current: string | null): Intent | null {
  switch (answer?.action) {
    case 'show': return phase === 'writing' ? { kind: 'reveal' } : null;
    case 'next_stroke': return phase === 'coaching' || phase === 'writing' ? { kind: 'next_stroke' } : { kind: 'next_character' };
    case 'next_character': return { kind: 'next_character' };
    case 'start_over': return { kind: 'start_character' };
    case 'clear': return phase === 'writing' ? { kind: 'clear_attempt' } : null;
    case 'choose': {
      const asked = (answer.character ?? '').trim();
      if (!asked) return null;
      const known = find(asked);
      if (known?.id === current) return null;
      // An unknown name goes to the tutor anyway: its refusal lists what there is.
      return { kind: 'start_character', id: known?.id ?? asked };
    }
    default: return null;
  }
}
