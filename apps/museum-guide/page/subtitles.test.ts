import { describe, expect, it } from 'vitest';
import { nowSaying, phrases } from './subtitles.ts';

const text = 'Ah, I see you are looking at Leonardo da Vinci\'s Mona Lisa, painted between about 1503 and 1519. Look at the corners of her mouth! That is where the smile lives.';

describe('subtitles', () => {
  it('cuts the text into sentences', () => {
    expect(phrases(text).map((p) => p.words.join(' '))).toEqual([
      'Ah, I see you are looking at Leonardo da Vinci\'s Mona Lisa, painted between about 1503 and 1519.',
      'Look at the corners of her mouth!',
      'That is where the smile lives.',
    ]);
  });

  it('cuts a long sentence at a comma, so a phrase fits three lines', () => {
    const long = 'He softened every edge with sfumato, thin glazes that melt light into shadow, which is why the smile seems to come and go, and why people have argued about it for five hundred years.';
    const parts = phrases(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.words.join(' ').length).toBeLessThanOrEqual(125);
    expect(parts.map((p) => p.words.join(' ')).join(' ')).toBe(long);
  });

  it('shows the phrase he is in, with the words said so far', () => {
    expect(nowSaying(text, 0)).toMatchObject({ phrase: { first: 0 }, said: 0 });
    expect(nowSaying(text, 3)).toMatchObject({ phrase: { first: 0 }, said: 3 });
    // On the last word of the first sentence, it stays up until the next word starts.
    expect(nowSaying(text, 18)).toMatchObject({ phrase: { first: 0 }, said: 18 });
    expect(nowSaying(text, 19)).toMatchObject({ phrase: { first: 18 }, said: 1 });
    // Past the end: the last phrase, all said.
    expect(nowSaying(text, 999)).toMatchObject({ phrase: { first: 25 }, said: 6 });
  });

  it('keeps the phrase steady as more text arrives in pieces', () => {
    const first = nowSaying('Ah, I see you are looking at Leonardo da', 4)!;
    const later = nowSaying(text, 4)!;
    expect(later.phrase.first).toBe(first.phrase.first);
    expect(later.said).toBe(first.said);
  });

  it('has nothing to show for no words', () => {
    expect(nowSaying('', 0)).toBeNull();
    expect(nowSaying('   ', 3)).toBeNull();
  });
});
