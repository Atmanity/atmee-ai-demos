// Speech comes in as finished runs of words; the avatar should start before a long sentence ends.
// So a run is cut at its last clause mark once enough has built up, and the rest waits for more.
const MIN_WEIGHT = 6;
const CJK = /[぀-ヿ㐀-鿿가-힯]/;
const CJK_ALL = new RegExp(CJK.source, 'g');
const UNSPACED = /[　-〿぀-ヿ㐀-鿿가-힯＀-￯]/;   // its characters and its punctuation
const MARK = /[,;:.!?，、；：。！？]/;
const SENTENCE_END = /[.!?。！？]/;

/** About how many words: spaces between Latin words, two characters a word in Chinese, Japanese and Korean. */
export function weight(text: string): number {
  const cjk = [...text].filter((c) => CJK.test(c)).length;
  const latin = text.replace(CJK_ALL, ' ').split(/\s+/).filter((w) => /\p{L}|\p{N}/u.test(w)).length;
  return latin + cjk / 2;
}

const join = (a: string, b: string) => {
  if (!a) return b;
  return UNSPACED.test(a.at(-1) ?? '') && UNSPACED.test(b[0] ?? '') ? a + b : `${a} ${b}`;
};

function lastCut(text: string, marks: RegExp): number {
  for (let i = text.length - 1; i > 0; i--) {
    const next = text[i + 1];
    // Not inside a number: 3,500 and 2.5 hold together.
    if (marks.test(text[i]) && (next === undefined || !/\d/.test(next)) && weight(text.slice(0, i + 1)) >= MIN_WEIGHT) return i + 1;
  }
  return 0;
}

/** `wholeSentences`: translating. Languages order a sentence differently, so half of one translates badly. */
export function createClauses({ wholeSentences = false } = {}) {
  const marks = wholeSentences ? SENTENCE_END : MARK;
  let held = '';
  const flush = (): string[] => {
    const out = held.trim();
    held = '';
    return out ? [out] : [];
  };
  return {
    /** A finished run of words; `ended` when the speaker paused. What is ready to voice, in order. */
    feed(text: string, ended: boolean): string[] {
      const words = text.trim();
      if (words) held = join(held, words);
      if (ended) return flush();
      const at = lastCut(held, marks);
      if (!at) return [];
      const clause = held.slice(0, at).trim();
      held = held.slice(at).trim();
      return [clause];
    },
    flush,
  };
}
