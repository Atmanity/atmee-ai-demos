// Subtitles the way film does them: one phrase at a time, never a raw stream.
// A guide's words arrive as text ahead of his voice and in pieces ("…looking at
// Leonardo da"), so the page lays out the phrase he is on in full and lights
// its words up at about the pace he speaks them; the rest of the phrase waits,
// dimmed, so nothing jumps as more text arrives.

/**
 * About how fast the guides speak; the light follows the voice roughly, not exactly. English
 * goes by words; Chinese and Japanese, written without spaces, by characters.
 */
export const WORDS_PER_SECOND = 2.7;
export const CHARS_PER_SECOND = 5;
/** A phrase longer than this is cut at its commas, so it fits three lines on a phone. */
const MAX_PHRASE_CHARS = { spaced: 110, unspaced: 48 };

/** A phrase's units: words (shown with spaces) or, for unspaced scripts, characters. */
export interface Phrase { words: string[]; first: number; spaced: boolean }

const UNSPACED = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;
const ENDS = /[.!?…。！？]["”’)」』）]*$/;
const BREAKS = /[,;:—–，、；：]["”’)」』）]*$/;

/** The text in phrases: sentences, and a long sentence cut at its commas, semicolons and dashes. */
export function phrases(text: string): Phrase[] {
  const spaced = !UNSPACED.test(text);
  const units = spaced ? text.split(/\s+/).filter(Boolean) : Array.from(text.replace(/\s+/g, ' ').trim());
  const max = spaced ? MAX_PHRASE_CHARS.spaced : MAX_PHRASE_CHARS.unspaced;
  const out: Phrase[] = [];
  let start = 0;
  const close = (end: number) => {
    const words = units.slice(start, end);
    if (words.join('').trim()) out.push({ words, first: start, spaced });
    start = end;
  };
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const length = units.slice(start, i + 1).join(spaced ? ' ' : '').length;
    if (ENDS.test(unit) && (spaced || !ENDS.test(units[i + 1] ?? ''))) close(i + 1);
    else if (length > max * 0.55 && BREAKS.test(unit)) close(i + 1);
    else if (length > max) close(i + 1);
  }
  close(units.length);
  return out;
}

/** How fast `spoken` advances for this text, in units a second. */
export const unitsPerSecond = (text: string) => (UNSPACED.test(text) ? CHARS_PER_SECOND : WORDS_PER_SECOND);

/** The phrase holding word `spoken` (how many words he has said), and how many of its words are said. */
export function nowSaying(text: string, spoken: number): { phrase: Phrase; said: number } | null {
  const all = phrases(text);
  if (!all.length) return null;
  const at = Math.max(0, Math.min(Math.floor(spoken), all[all.length - 1].first + all[all.length - 1].words.length));
  // The phrase he is in; on its last word, it stays until the next word starts.
  const phrase = [...all].reverse().find((p) => p.first < at) ?? all[0];
  return { phrase, said: Math.min(phrase.words.length, at - phrase.first) };
}
