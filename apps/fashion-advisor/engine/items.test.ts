// Ported from the original's test_parity.py (the pure cases) and the panel's
// messages.test.ts (the thumbnail merge), plus the shopping links.
import { describe, expect, test } from 'vitest';
import {
  ALL_BODY_ZONES, buildAmazonSearchUrl, buildAmazonShopLinks, buildItemAttributes, inferItemBodyZone, isNonGarmentSelfReference,
  itemsMatch, markItemTried, MAX_TRIED_ITEMS, resolveSuggestionItemName, titleCase, withThumbnails,
} from './items.ts';
import { normalizeStyleCategory } from './style.ts';
import type { Suggestion } from './types.ts';

test('the body zones are all six', () => {
  // A missing zone makes every piece in it "not visible", so the stylist
  // silently refuses hats, or shoes, and never says why.
  expect([...ALL_BODY_ZONES].sort()).toEqual(['feet', 'head', 'lower_body', 'neck', 'upper_body', 'wrist']);
});

test.each([
  ['wide-brim black fedora hat', 'head'],
  ['gold layered necklace', 'neck'],
  ['leather jacket', 'upper_body'],
  ['dark trousers', 'lower_body'],
  ['silver watch', 'wrist'],
  ['white sneakers', 'feet'],
])('%s goes on the %s', (item, zone) => {
  expect(inferItemBodyZone(item)).toBe(zone);
});

test('a bare garment name with no keyword falls back to the upper body (inherited, pinned as a decision)', () => {
  // "hat" and "cap" are head words, "fedora" alone is not. Changing it would
  // change which try-ons are refused: a parity break dressed up as a fix.
  expect(inferItemBodyZone('fedora')).toBe('upper_body');
});

test('tried items do not grow without bound (they ride along in every prompt)', () => {
  let tried: string[] = [];
  for (let i = 0; i < 40; i++) tried = markItemTried(tried, `item number ${i}`);
  expect(tried.length).toBeLessThanOrEqual(MAX_TRIED_ITEMS);
});

test('trying the same item again moves it rather than duplicating it', () => {
  let tried = markItemTried([], 'brown leather belt');
  tried = markItemTried(tried, 'white sneakers');
  tried = markItemTried(tried, 'Brown Leather Belt');
  expect(tried.filter((t) => t === 'brown leather belt')).toHaveLength(1);
  expect(tried.at(-1)).toBe('brown leather belt');
});

describe('matching a loosely named piece to the one on screen', () => {
  const analysis = { suggestions: [{ item: 'Slim Navy Silk Tie', text: 'Sharpens the neckline.' }, { item: 'Dark Wash Tapered Jeans', text: 'Cleaner leg line.' }] };

  test('the tie is the tie on screen', () => {
    expect(resolveSuggestionItemName('navy tie', analysis)).toBe('Slim Navy Silk Tie');
    expect(resolveSuggestionItemName('the tapered jeans', analysis)).toBe('Dark Wash Tapered Jeans');
  });

  test('a piece that is not on screen keeps its own name', () => {
    expect(resolveSuggestionItemName('black fedora hat', analysis)).toBe('black fedora hat');
  });

  test('one generic word in common is not a match', () => {
    // "shirt" alone would otherwise match every shirt on the board.
    expect(itemsMatch('shirt', 'white oxford shirt')).toBe(false);
    expect(itemsMatch('oxford shirt', 'white oxford shirt')).toBe(true);
    expect(itemsMatch('tee', 'graphic t-shirt')).toBe(false);
  });

  test('plurals and aliases match', () => {
    expect(itemsMatch('black sunglasses', 'Black Glasses')).toBe(true);
    expect(itemsMatch('white trainers', 'white sneakers')).toBe(true);
  });
});

test('the current look is not a garment to add', () => {
  // The original rendered an endless "Adding current look..." for these.
  for (const said of ['current look', 'My Current Look', 'my outfit.', 'myself', "what i'm wearing"]) expect(isNonGarmentSelfReference(said), said).toBe(true);
  for (const said of ['black hat', 'look book tote']) expect(isNonGarmentSelfReference(said), said).toBe(false);
});

test('the "Wearing now" chips are title-cased as the original did', () => {
  expect(titleCase('gold layered necklace')).toBe('Gold Layered Necklace');
  expect(titleCase('t-shirt')).toBe('T-Shirt');
});

describe('shopping links', () => {
  test('a search link per piece, with the store and the associate tag when configured', () => {
    expect(buildAmazonSearchUrl('Slim Navy Silk Tie')).toBe('https://amazon.com/s?k=Slim+Navy+Silk+Tie');
    expect(buildAmazonSearchUrl('tie', { domain: 'https://www.amazon.co.uk/', tag: 'atmee-21' })).toBe('https://www.amazon.co.uk/s?k=tie&tag=atmee-21');
  });

  test('a specific piece gets "buy this look" and "shop similar"; a vague one only "shop similar"', () => {
    const exact = buildAmazonShopLinks(buildItemAttributes('black leather jacket', 'streetwear', normalizeStyleCategory));
    expect(exact.map((l) => l.kind)).toEqual(['exact', 'category']);
    // Colour, piece, style, as upstream joined them (it only drops exact repeats, so "black" leads twice).
    expect(exact[0].url).toBe('https://amazon.com/s?k=black+black+leather+jacket+streetwear');
    const vague = buildAmazonShopLinks(buildItemAttributes('something shiny', '', normalizeStyleCategory));
    expect(vague.map((l) => l.kind)).toEqual(['category']);
    expect(vague[0].url).toContain('fashion+apparel');
  });
});

// The panel's messages.test.ts: rendered catalogue shots land after the board,
// one per piece, so the merge must find the right card and leave the rest alone.
describe('attaching rendered thumbnails', () => {
  const pieces = (): Suggestion[] => [{ item: 'Navy Blue Corduroy Cap', text: 'a' }, { item: 'Grey Cashmere Beanie', text: 'b' }];
  const shots = (map: Record<string, string>) => (key: string) => map[key];

  test('attaches the url to the item it belongs to', () => {
    const next = withThumbnails(pieces(), shots({ 'grey cashmere beanie': 'https://s/x.jpg' }));
    expect(next[1].image_url).toBe('https://s/x.jpg');
    expect(next[0].image_url).toBeUndefined();
  });

  test('matches regardless of case and surrounding space', () => {
    const next = withThumbnails([{ item: '  navy blue CORDUROY cap ', text: 'a' }], shots({ 'navy blue corduroy cap': 'https://s/c.jpg' }));
    expect(next[0].image_url).toBe('https://s/c.jpg');
  });

  test('returns the same array when nothing changed, so a render can skip', () => {
    const before = pieces();
    expect(withThumbnails(before, shots({ 'not on this board': 'https://s/x.jpg' }))).toBe(before);
    const once = withThumbnails(before, shots({ 'grey cashmere beanie': 'https://s/x.jpg' }));
    expect(withThumbnails(once, shots({ 'grey cashmere beanie': 'https://s/x.jpg' }))).toBe(once);
  });

  test('ignores an empty url rather than blanking a card, and is safe on an empty board', () => {
    const before = pieces();
    expect(withThumbnails(before, shots({ 'grey cashmere beanie': '' }))).toBe(before);
    expect(withThumbnails([], shots({}))).toEqual([]);
  });
});
