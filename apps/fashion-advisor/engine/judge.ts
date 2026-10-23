// Words, read by rules. Emery calls Notch's tools herself, so the old
// speech judge (names, styles, yes-to-an-offer, every command in words) is
// gone. What is left:
//   - the piece named in a try_on call, which arrives as the user said it
//     ("the second one", "a black fedora, please");
//   - the safety net under Emery (useToolNet): what the user's words clearly
//     ask for, among the actions that are safe to do twice;
//   - the name guard the stylist engine still uses.
import { cleanSingleLine, collapse, isNonGarmentSelfReference, itemMatchScore, itemTokens, normalizeItemToken } from './items.ts';
import { matchStyleKeyword } from './style.ts';

// -- names (the stylist engine's guard) ----------------------------------------------

export const MAX_NAME_ATTEMPTS = 2;
export const MAX_PHOTO_CONSENT_ASKS = 2;

const NON_NAMES = new Set(['jealous', 'stylish', 'style', 'fashion', 'casual', 'formal', 'business', 'yes', 'no', 'sure', 'hello', 'hi', 'hey']);

export function looksLikeNonName(value: string): boolean {
  const key = (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(' ');
  if (!key) return true;
  if (key.split(' ').length > 3) return true;
  return NON_NAMES.has(key);
}

// -- garments ------------------------------------------------------------------------

/** Garments and accessories, for telling "the blazer" from "something different". */
const GARMENT_WORDS = new Set([
  'hat', 'cap', 'beanie', 'fedora', 'beret', 'bucket', 'headband', 'scarf', 'tie', 'bowtie', 'necklace', 'chain', 'pendant',
  'choker', 'earring', 'glasses', 'sunglass', 'sunglasses', 'watch', 'bracelet', 'ring', 'belt', 'bag', 'tote', 'handbag', 'purse',
  'backpack', 'jacket', 'blazer', 'coat', 'topcoat', 'overcoat', 'trench', 'parka', 'vest', 'waistcoat', 'cardigan', 'sweater',
  'jumper', 'hoodie', 'sweatshirt', 'shirt', 'tee', 'tshirt', 'polo', 'blouse', 'top', 'tank', 'turtleneck', 'crewneck',
  'dress', 'gown', 'skirt', 'jean', 'jeans', 'trouser', 'pants', 'chino', 'shorts', 'jogger', 'legging', 'suit', 'sneaker',
  'sneakers', 'trainer', 'boot', 'shoe', 'loafer', 'heel', 'sandal', 'sock', 'glove', 'overshirt', 'shacket', 'bomber',
  'gilet', 'kimono', 'cufflink', 'brooch', 'clip', 'square', 'collar', 'pocket', 'loafers', 'oxford', 'derby', 'mule', 'clog',
  'denim', 'leather', 'cashmere', 'linen', 'silk', 'wool', 'knit', 'outfit', 'layer', 'accessory', 'jewelry', 'jewellery',
]);
const GARMENT_NORMALIZED = new Set([...GARMENT_WORDS].map(normalizeItemToken));

export const mentionsGarment = (text: string) => [...itemTokens(text)].some((t) => GARMENT_NORMALIZED.has(t) || GARMENT_WORDS.has(t));

// -- the piece in a try_on call --------------------------------------------------------

const TRAILING = /(?:\s+(?:on me|on|for me|please|now|instead|too|as well|next|first|then|real quick|quickly|again|today|tonight|to see\b.*|and see\b.*|so i can\b.*))+$/i;
const LEADING = /^(?:(?:the|a|an|some|my|that|this|those|these|your|one of (?:the|those|these)|pair of|a pair of)\s+)+/i;
const PRONOUN = /^(?:it|them|that|this|those|these|one|that one|this one|the one)$/i;
const ORDINAL = /^(?:the\s+)?(?<n>first|second|third|fourth|fifth|sixth|seventh|eighth|last|1st|2nd|3rd|4th|5th|6th|number\s+\w+|#?\d+)(?:\s+(?:one|suggestion|piece|item|pick|option|card))?$/i;
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

function ordinalItem(words: string, rail: string[]): string | null {
  const m = ORDINAL.exec(words.trim());
  if (!m?.groups || !rail.length) return null;
  const raw = m.groups.n.toLowerCase().replace(/^number\s+/, '').replace(/^#/, '');
  const n = raw === 'last' ? rail.length : ORDINALS[raw] ?? Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= rail.length ? rail[n - 1] : null;
}

export interface NamedPiece {
  item: string;
  /** It is (or loosely names) a piece on the rail. */
  onRail: boolean;
  /** It names a garment or an accessory. */
  garment: boolean;
}

/**
 * The piece in what was said: "the second one" is the second piece on the
 * rail; "a black fedora, please" is "black fedora". Null when it names no
 * piece at all ("it", "that one"): the host asks which.
 */
export function pieceFromWords(words: string, rail: string[] = []): NamedPiece | null {
  let said = collapse(words).replace(/[.?!,;:]+$/, '');
  for (let i = 0; i < 3; i++) said = said.replace(TRAILING, '').replace(/[.?!,;:]+$/, '').trim();
  const bare = said.replace(LEADING, '').trim();
  const ordinal = ordinalItem(said, rail) ?? ordinalItem(bare, rail);
  if (ordinal) return { item: ordinal, onRail: true, garment: true };
  if (!bare || PRONOUN.test(bare) || PRONOUN.test(said)) return null;
  if (isNonGarmentSelfReference(said) || isNonGarmentSelfReference(bare)) return { item: bare, onRail: false, garment: false };
  return { item: bare, onRail: rail.some((r) => itemMatchScore(bare, r) >= 0.55), garment: mentionsGarment(bare) };
}

// -- the safety net ------------------------------------------------------------------

export type NetCall = { name: 'rate_outfit'; arguments: { occasion?: string } } | { name: 'restore_photo'; arguments: Record<string, never> };

const norm = (text: string) => collapse(text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' -]+/g, ' '));

const OCCASION_WORDS = /\b(wedding|date|interview|party|work|office|dinner|gala|funeral|brunch|meeting|club|beach|concert|graduation|holiday|trip|travel|event|night out|birthday|ceremony|reception|conference|presentation|pitch|drinks|lunch|weekend|festival|opera|theatre|theater)\b/;
const RATE = '(?:rate|score|judge|grade|read)';
const IT = '(?:me|it|this|that|my look|my outfit|the look|the outfit|this look|this outfit)';
/** Words that name what they are dressing for, inside a request to be rated for it. */
const WHAT_ABOUT = /\b(?:what|how)\s+about\s+(?:for\s+)?(?<occ>.+)$/;
const FOR_OCCASION: RegExp[] = [
  new RegExp(`\\b${RATE}\\s+${IT}\\s+(?:for|as)\\s+(?<occ>.+)$`),
  WHAT_ABOUT,
  /\bhow\s+(?:would|does|will|is)\s+(?:it|this|that|my outfit|the outfit|this outfit|this look|my look)\s+(?:do|work|look|read|score|land)\s+(?:for|at)\s+(?<occ>.+)$/,
  /\b(?:i'?m|i am)\s+(?:dressing|dressed|getting dressed|getting ready)\s+(?:up\s+)?for\s+(?<occ>.+)$/,
  /\b(?:it'?s|this is|the outfit is|my outfit is)\s+for\s+(?<occ>.+)$/,
];
const AGAIN = new RegExp(`\\b${RATE}\\s+${IT}\\s+again\\b|\\bre-?rate\\b|\\b(?:fresh|new)\\s+(?:score|rating|verdict)\\b|^(?:can you |could you |please |now )*${RATE}\\s+${IT}(?:\\s+(?:now|please))*$`);
const RESTORE = /\bback to (?:my|the) (?:own |original |real |old )?(?:photo|picture|pic|look|outfit)\b|\b(?:take|get) (?:it all|them all|everything|all of (?:it|them)|the pieces|the try-?ons?) off\b|\bremove (?:the |all (?:the )?)?(?:try-?ons?|pieces)\b|\bundo (?:the |all (?:the )?)?try-?ons?\b/;

/** "a summer wedding instead, please" -> "summer wedding"; '' when the words name no occasion. */
function occasionIn(raw: string, styles: boolean): string {
  let occ = raw.replace(/\s+(?:instead|please|then|now|maybe|though|too)\b.*$/, '').replace(/^(?:an?|my|the|this|our)\s+/, '').trim();
  occ = occ.replace(/\s+(?:look|vibe|style|outfit)$/, '').trim();
  if (!occ || occ.split(' ').length > 6 || mentionsGarment(occ)) return '';
  return OCCASION_WORDS.test(occ) || (styles && matchStyleKeyword(occ)) ? cleanSingleLine(occ, 80) : '';
}

/**
 * The action the user's words clearly ask for, among those safe to do twice:
 * a rating (a second read of the same outfit for the same occasion changes
 * nothing, and the fitting waits for a running read rather than start
 * another) and going back to the own photo. More pieces (the rail would grow
 * twice) and try-ons (a paid render each) are left out.
 */
export function mustDo(text: string, opts: { tryOns: boolean }): NetCall | null {
  const t = norm(text);
  if (!t) return null;
  if (opts.tryOns && RESTORE.test(t)) return { name: 'restore_photo', arguments: {} };
  for (const pattern of FOR_OCCASION) {
    // "What about streetwear?" could as well ask for streetwear pieces: a style counts only when a rating is asked for.
    const occ = occasionIn(pattern.exec(t)?.groups?.occ ?? '', pattern !== WHAT_ABOUT);
    if (occ) return { name: 'rate_outfit', arguments: { occasion: occ } };
  }
  if (AGAIN.test(t)) return { name: 'rate_outfit', arguments: {} };
  return null;
}
