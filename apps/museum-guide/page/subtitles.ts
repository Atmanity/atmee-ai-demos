// Subtitles the way film does them: one phrase at a time, never a raw stream.
// A guide's words arrive as text ahead of his voice and in pieces ("…looking at
// Leonardo da"), so the page lays out the phrase he is on in full and lights
// its words up at about the pace he speaks them; the rest of the phrase waits,
// dimmed, so nothing jumps as more text arrives.

/** About how fast the guides speak (words a second); the light follows his voice roughly, not exactly. */
export const WORDS_PER_SECOND = 2.7;
/** A phrase longer than this is cut at its commas, so it fits three lines on a phone. */
const MAX_PHRASE_CHARS = 110;

export interface Phrase { words: string[]; first: number }

/** The text in phrases: sentences, and a long sentence cut at its commas, semicolons and dashes. */
export function phrases(text: string): Phrase[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: Phrase[] = [];
  let start = 0;
  const close = (end: number) => { if (end > start) out.push({ words: words.slice(start, end), first: start }); start = end; };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const length = words.slice(start, i + 1).join(' ').length;
    if (/[.!?…]["”’)]*$/.test(w)) close(i + 1);
    else if (length > MAX_PHRASE_CHARS * 0.55 && /[,;:—–]["”’)]*$/.test(w)) close(i + 1);
    else if (length > MAX_PHRASE_CHARS) close(i + 1);
  }
  close(words.length);
  return out;
}

/** The phrase holding word `spoken` (how many words he has said), and how many of its words are said. */
export function nowSaying(text: string, spoken: number): { phrase: Phrase; said: number } | null {
  const all = phrases(text);
  if (!all.length) return null;
  const at = Math.max(0, Math.min(Math.floor(spoken), all[all.length - 1].first + all[all.length - 1].words.length));
  // The phrase he is in; on its last word, it stays until the next word starts.
  const phrase = [...all].reverse().find((p) => p.first < at) ?? all[0];
  return { phrase, said: Math.min(phrase.words.length, at - phrase.first) };
}
