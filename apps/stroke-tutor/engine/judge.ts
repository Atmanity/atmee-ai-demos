// What a learner's words mean to the sheet. Ren reaches the sheet through its
// tools and decides for itself which one a line asks for; these rules are what
// the app still needs words for:
//
// - the safety net (`mustDo`): when the learner clearly asks for something safe
//   to do twice (show me, next, start over, a character off the menu) and Ren
//   does not call the tool, the page does it;
// - reading the character Ren passes to `choose_character` ("the tree one",
//   "永", "capital A") as one of the seven (`characterIn`).
//
// The page loads this file (the net runs there), so it holds no stroke data:
// only the characters' ids, glyphs and spoken names. `judge.test.ts` checks
// those against the server's character set.
//
// Words never produce a stroke: drawing is the hand's (lesson.ts refuses one).
import type { Intent, Phase } from './types.ts';

/** Lower case, accents off, punctuation to spaces; CJK glyphs are matched before this. */
export const norm = (text: string) => text.toLowerCase().replace(/[’‘`]/g, "'").normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------- characters

/** The kanji by glyph (the Latin capitals are matched as words). Must match characters.ts. */
export const GLYPHS: readonly [string, string][] = [['ichi', '一'], ['juu', '十'], ['kawa', '川'], ['ki', '木'], ['ei', '永']];

/** Spoken names of each character, as people say them (the ids and glyphs are matched too). */
export const SPOKEN: readonly [string, RegExp][] = [
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
  for (const [id, glyph] of GLYPHS) if (text.includes(glyph)) return id;
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

const RESTART = /\b(start (it |this |this one |the character |the whole thing )?(over|again)|from the (top|beginning|start)|wipe (it|the board|the sheet|everything|it all)|begin again|redo (it|this|the (whole )?character)|reset( the (board|sheet))?|start from scratch)\b/;
const AGAIN = /^(ok(ay)? )?((do it|let'?s do it|let'?s go|go) )?(again|once more|one more time)( please)?$|\b(do (it|that one) again|same one again|one more time)\b/;
const CLEAR = /^(please )?(clear|erase|undo)( it| that| this| the board| the sheet| my (ink|attempt|stroke|drawing))?( please)?$|\b(clear|erase|rub out) (it|that|this|the board|the sheet|my (ink|attempt|stroke|drawing))\b/;
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
 * The sheet action a line asks for, or null for one Ren simply answers.
 * Phase-aware, because the same words mean different things: "next" is the
 * next stroke mid-character and the next character on the menu; "show me" is
 * a reveal only while a stroke is live (once it is done Ren already has its
 * teaching line).
 */
export function intentIn(text: string, phase: Phase, current: string | null): Intent | null {
  const t = norm(text);
  if (!t && !GLYPHS.some(([, glyph]) => text.includes(glyph))) return null;
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

// --------------------------------------------------------- the safety net

/**
 * The net's stricter reading of "show me": only lines that plainly ask about
 * the live stroke. "I don't know", "help" or "a hint" are left to Ren, who
 * hears the whole sentence ("I don't know what eternity means" is not one).
 */
const SURELY_SHOW = /\bshow (me|us)\b|\b(which|what) way (does|do|should|is|will)\b|\bwhich direction\b|\bwhere (do|should|shall|can) i (start|begin)\b|\bhow (do|should|can) i (draw|write) (it|this|that|this one|the stroke)\b|\bwhat shape\b|\b(which|what) (stroke|one) (comes |goes )?(first|next)\b|\bi'?m stuck\b|\bi am stuck\b|\bdraw it for me\b/;
/** The net's "next": the word itself, or plain readiness, never a bare "yes" or "ok" (an answer to some other question). */
const SURELY_NEXT = /\b(what'?s next|i'?m ready|go on|carry on|keep going|let'?s continue|the next one)\b/;

export type NetCall = { name: 'show_stroke' | 'next_stroke' | 'start_over' | 'choose_character'; arguments: Record<string, unknown> };

/**
 * The tool the learner's words clearly ask for, among those safe to do
 * twice: a second show or next is refused by the sheet, a second start over
 * lands where the first did, and a character off the menu is not chosen
 * again once it is up. Moving on to the next character is not here: done
 * twice it would skip one.
 */
export function mustDo(text: string, phase: Phase, current: string | null): NetCall | null {
  const intent = intentIn(text, phase, current);
  if (!intent) return null;
  const t = norm(text);
  switch (intent.kind) {
    case 'reveal':
      return phase === 'writing' && SURELY_SHOW.test(t) ? { name: 'show_stroke', arguments: {} } : null;
    case 'next_stroke':
      // While a stroke is live "next" is refused; Ren says so from the sheet without a call.
      return phase === 'coaching' && (NEXT_EXPLICIT.test(t) || SURELY_NEXT.test(t)) ? { name: 'next_stroke', arguments: {} } : null;
    case 'start_character':
      if (intent.id) return phase === 'intro' || phase === 'debrief' ? { name: 'choose_character', arguments: { character: intent.id } } : null;
      return phase === 'intro' ? null : { name: 'start_over', arguments: {} };
    default:
      return null;
  }
}
