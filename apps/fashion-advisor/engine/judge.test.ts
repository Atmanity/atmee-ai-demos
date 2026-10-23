// What words still mean to Notch: the piece named in a try_on call (as the
// user said it, passed on by Emery), the name guard the stylist keeps, and
// the safety net's phrases, which must fire only for the actions safe to do
// twice.
import { describe, expect, test } from 'vitest';
import { looksLikeNonName, mentionsGarment, mustDo, pieceFromWords } from './judge.ts';

const RAIL = ['Slim Navy Silk Tie', 'Black Tortoise-Shell Round Glasses', 'Camel Wool Topcoat', 'Dark Wash Tapered Jeans'];

describe('the piece in a try_on call', () => {
  test.each([
    ['a black fedora', 'black fedora'],
    ['the camel topcoat, please', 'camel topcoat'],
    ['a silver watch on me', 'silver watch'],
    ['white oxford shirt now', 'white oxford shirt'],
    ['Camel Wool Topcoat', 'Camel Wool Topcoat'],
  ])('"%s" is the %s', (said, item) => {
    expect(pieceFromWords(said, RAIL)?.item).toBe(item);
  });

  test('"the second one" is the second piece on the rail; "the last one" the last', () => {
    expect(pieceFromWords('the second one', RAIL)).toEqual({ item: RAIL[1], onRail: true, garment: true });
    expect(pieceFromWords('the last one', RAIL)?.item).toBe(RAIL[3]);
    expect(pieceFromWords('number 3', RAIL)?.item).toBe(RAIL[2]);
    expect(pieceFromWords('the fifth one', RAIL)?.item).toBe('fifth one');   // there is no fifth: not a piece on the rail
  });

  test('a loose name of a piece on the rail is that piece', () => {
    expect(pieceFromWords('the navy tie', RAIL)).toMatchObject({ onRail: true, garment: true });
    expect(pieceFromWords('the topcoat', RAIL)).toMatchObject({ onRail: true });
  });

  test('a pronoun names no piece: the host asks which', () => {
    for (const said of ['it', 'that one', 'this', 'them please']) expect(pieceFromWords(said, RAIL), said).toBeNull();
  });

  test('words that are no garment are told apart', () => {
    expect(pieceFromWords('something different', RAIL)).toMatchObject({ onRail: false, garment: false });
    expect(pieceFromWords('some colour', RAIL)).toMatchObject({ onRail: false, garment: false });
    expect(pieceFromWords('my current look', RAIL)).toMatchObject({ item: 'current look', garment: false });
    expect(mentionsGarment('a chunky gold chain')).toBe(true);
    expect(mentionsGarment('a bit more edge')).toBe(false);
  });
});

test('adjectives, greetings and style words are not names (the stylist keeps this guard)', () => {
  for (const said of ['jealous', 'stylish', 'Casual', 'yes', 'hey', 'a b c d']) expect(looksLikeNonName(said), said).toBe(true);
  expect(looksLikeNonName('Sam')).toBe(false);
});

describe('the safety net', () => {
  const on = { tryOns: true };
  test('what it does when Emery does not, and only the actions safe to do twice', () => {
    const cases: [string, ReturnType<typeof mustDo>][] = [
      ['Rate me for a wedding instead.', { name: 'rate_outfit', arguments: { occasion: 'wedding' } }],
      ['Can you rate my outfit for a job interview?', { name: 'rate_outfit', arguments: { occasion: 'job interview' } }],
      ['What about for a first date?', { name: 'rate_outfit', arguments: { occasion: 'first date' } }],
      ['How about a summer wedding?', { name: 'rate_outfit', arguments: { occasion: 'summer wedding' } }],
      ['How would this do for a dinner party?', { name: 'rate_outfit', arguments: { occasion: 'dinner party' } }],
      ["I'm dressing for a gala tonight", { name: 'rate_outfit', arguments: { occasion: 'gala tonight' } }],
      ["It's for a job interview.", { name: 'rate_outfit', arguments: { occasion: 'job interview' } }],
      ['Rate it as streetwear', { name: 'rate_outfit', arguments: { occasion: 'streetwear' } }],
      ['Can you rate it again?', { name: 'rate_outfit', arguments: {} }],
      ['rate my outfit again please', { name: 'rate_outfit', arguments: {} }],
      ['Rate it.', { name: 'rate_outfit', arguments: {} }],
      ['Give me a fresh score', { name: 'rate_outfit', arguments: {} }],
      ['Back to my own photo, please', { name: 'restore_photo', arguments: {} }],
      ['Take it all off', { name: 'restore_photo', arguments: {} }],
      ['remove the try-ons', { name: 'restore_photo', arguments: {} }],
    ];
    for (const [said, expected] of cases) expect(mustDo(said, on), said).toEqual(expected);
  });

  test('never for more pieces or a try-on (a doubled one grows the rail or pays twice), nor for chat', () => {
    for (const said of [
      'More ideas please', 'What else could I add?', 'Make it more streetwear', 'Try the topcoat', 'Put the second one on me', 'Yes please',
      'What about the blazer?', 'What about you?', 'What about streetwear?', 'How do I look?', 'What is my score?', "I'd rate it a ten",
      "I'm going for a run later", 'It is for you', 'Is the tie better?', '',
    ]) expect(mustDo(said, on), said).toBeNull();
  });

  test('without try-ons there is nothing to take off', () => {
    expect(mustDo('Back to my own photo', { tryOns: false })).toBeNull();
    expect(mustDo('Rate me for a wedding', { tryOns: false })).toEqual({ name: 'rate_outfit', arguments: { occasion: 'wedding' } });
  });
});
