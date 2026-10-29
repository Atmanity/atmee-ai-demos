import { describe, expect, it } from 'vitest';
import { nowSaying, phrases, unitsPerSecond } from './subtitles.ts';

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

  it('cuts Chinese and Japanese, written without spaces, by characters at their own sentence marks', () => {
    const zh = '這是梵谷的《星夜》，畫於1889年6月。他從朝東的窗戶望出去，看見日出前的景色！';
    const parts = phrases(zh);
    expect(parts.map((p) => p.words.join(''))).toEqual(['這是梵谷的《星夜》，畫於1889年6月。', '他從朝東的窗戶望出去，看見日出前的景色！']);
    expect(parts[0].spaced).toBe(false);
    expect(nowSaying(zh, 3)).toMatchObject({ phrase: { first: 0 }, said: 3 });
    const ja = 'ゴッホは療養院に滞在していたときにこの絵を描きました。東向きの窓から見た、夜明け前の眺めです。';
    expect(phrases(ja).map((p) => p.words.join(''))).toEqual(['ゴッホは療養院に滞在していたときにこの絵を描きました。', '東向きの窓から見た、夜明け前の眺めです。']);
    expect(unitsPerSecond(zh)).toBeGreaterThan(unitsPerSecond('in English'));
  });

  it('cuts a long Chinese sentence at its commas, so it fits three lines', () => {
    const long = '他以暈塗法柔化每一道輪廓，用薄薄的釉層讓光線融入陰影，所以她的微笑若隱若現，好像會隨著你看的角度出現又消失，這也是幾百年來大家一直爭論的原因。';
    for (const p of phrases(long)) expect(p.words.join('').length).toBeLessThanOrEqual(56);
    expect(phrases(long).map((p) => p.words.join('')).join('')).toBe(long);
  });

  it('has nothing to show for no words', () => {
    expect(nowSaying('', 0)).toBeNull();
    expect(nowSaying('   ', 3)).toBeNull();
  });
});
