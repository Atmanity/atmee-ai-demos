// Garments: naming, matching, where on the body they go, and where to buy
// them. Ported from the original agent's core.py helpers, rule for rule;
// these decide which try-ons are refused and which suggestions are dropped,
// so a "small cleanup" here changes what the stylist does.
import type { Analysis, ShopLink, Suggestion, Zone } from './types.ts';

export const ALL_BODY_ZONES: readonly Zone[] = ['head', 'neck', 'upper_body', 'lower_body', 'wrist', 'feet'];
export const CURRENT_LOOK_LABEL = 'Current look';

export const collapse = (text: string) => (text || '').split(/\s+/).filter(Boolean).join(' ');
export const cleanSingleLine = (text: string, max: number) => {
  const cleaned = collapse(text);
  return cleaned.length > max ? cleaned.slice(0, max).trimEnd() : cleaned;
};
export function cleanParagraph(text: string, max: number) {
  const cleaned = collapse(text);
  if (cleaned.length <= max) return cleaned;
  let truncated = cleaned.slice(0, max).trimEnd();
  if (truncated.includes(' ')) truncated = truncated.slice(0, truncated.lastIndexOf(' '));
  return `${truncated}...`;
}
/** Python's str.title(), which the original used for the "Wearing now" chips. */
export const titleCase = (text: string) => text.replace(/[A-Za-z]+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

// -- matching one garment name against another --------------------------------

export const ITEM_GENERIC_TOKENS = new Set(['shirt', 'top', 'jacket', 'coat', 'hat', 'cap', 'glasses', 'pants', 'trousers', 'shoes', 'sneakers', 'watch', 'necklace', 'earrings']);

const ALIASES: Record<string, string> = {
  tee: 'shirt', tshirt: 'shirt', teeshirt: 'shirt', t: 'shirt',
  striped: 'stripe', stripes: 'stripe',
  sunglasses: 'glasses', spectacles: 'glasses',
  trouser: 'pants', trousers: 'pants', chinos: 'pants',
  sneaker: 'sneakers', trainers: 'sneakers',
};

export function normalizeItemToken(raw: string): string {
  const token = ALIASES[raw] ?? raw;
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith('es') && token !== 'glasses') return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('s') && token !== 'glasses' && token !== 'pants') return token.slice(0, -1);
  return token;
}

const ITEM_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'with', 'for', 'of', 'to', 'on', 'in', 'into', 'this', 'that', 'these', 'those', 'it',
  'one', 'ones', 'piece', 'item', 'look', 'me', 'my', 'please', 'try', 'add', 'put', 'show', 'wear', 'wearing', 'next',
]);

export function itemTokens(value: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of value.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const token = normalizeItemToken(raw);
    if (token && token.length > 1 && !ITEM_STOP_WORDS.has(token)) tokens.add(token);
  }
  return tokens;
}

export function itemMatchScore(candidate: string, reference: string): number {
  const a = itemTokens(candidate);
  const b = itemTokens(reference);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((t) => b.has(t));
  if (overlap.length === a.size && a.size === b.size) return 1;
  if (!overlap.length) return 0;
  const smaller = Math.min(a.size, b.size);
  const union = new Set([...a, ...b]).size;
  const subset = [...a].every((t) => b.has(t)) || [...b].every((t) => a.has(t));
  if (subset && (smaller >= 2 || !ITEM_GENERIC_TOKENS.has(overlap[0]))) return 0.95;
  if (overlap.length >= 2) return Math.max(overlap.length / union, overlap.length / Math.max(a.size, b.size));
  return 0;
}

export const itemsMatch = (candidate: string, reference: string) => itemMatchScore(candidate, reference) >= 0.55;

/** The suggestion a loosely named piece refers to ("the tie" -> "Slim Navy Silk Tie"), or the name as given. */
export function resolveSuggestionItemName(itemName: string, analysis: Pick<Analysis, 'suggestions'> | null | undefined): string {
  if (!analysis || !Array.isArray(analysis.suggestions)) return itemName;
  let best = '';
  let bestScore = 0;
  for (const suggestion of analysis.suggestions) {
    const name = collapse(String(suggestion?.item ?? ''));
    const text = collapse(String(suggestion?.text ?? ''));
    if (!name) continue;
    const score = Math.max(itemMatchScore(itemName, name), itemMatchScore(itemName, `${name} ${text}`));
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }
  return bestScore >= 0.55 ? best : itemName;
}

// -- where a garment goes ------------------------------------------------------

/**
 * Keyword-based, as upstream: "hat" and "cap" are head words, "fedora" alone is
 * not, so a bare "fedora" lands in the default. Changing that would change
 * which try-ons are refused; it is pinned in the tests as a decision.
 */
export function inferItemBodyZone(itemName: string): Zone {
  const item = itemName.toLowerCase();
  const has = (words: string[]) => words.some((w) => item.includes(w));
  if (has(['hat', 'beanie', 'cap', 'headband', 'hair clip', 'sunglass', 'glasses', 'goggle', 'earring'])) return 'head';
  if (has(['necklace', 'choker', 'scarf', 'tie', 'collar'])) return 'neck';
  if (has(['watch', 'bracelet', 'wristband'])) return 'wrist';
  if (has(['shoe', 'sneaker', 'boot', 'loafer', 'heel', 'sock'])) return 'feet';
  if (has(['pants', 'trouser', 'skirt', 'shorts', 'jeans', 'belt'])) return 'lower_body';
  return 'upper_body';
}

export const ZONE_WORDS: Record<Zone, string> = {
  head: 'head', neck: 'neckline', upper_body: 'upper body', lower_body: 'lower body', wrist: 'wrists', feet: 'feet',
};

/**
 * Phrases that mean the user or their current look, not a garment. Asked to
 * try on "my current look", the original rendered an endless "Adding current
 * look..." with nothing to add; these are refused instead.
 */
const NON_GARMENT_SELF_REFERENCES = new Set([
  'look', 'current look', 'my look', 'my current look', 'the look', 'the current look', 'this look', 'your look', 'new look',
  'outfit', 'current outfit', 'my outfit', 'my current outfit', 'the outfit', 'this outfit',
  'style', 'my style', 'current style', 'my current style', 'this style',
  'fit', 'my fit', 'this fit', 'clothes', 'my clothes', 'current clothes', 'these clothes',
  'self', 'myself', 'my self', 'me', 'my appearance', 'how i look', 'what i am wearing', "what i'm wearing", 'what im wearing',
]);

export function isNonGarmentSelfReference(itemName: string): boolean {
  const normalized = collapse(itemName).toLowerCase().replace(/^[\s.,!?"']+|[\s.,!?"']+$/g, '');
  return NON_GARMENT_SELF_REFERENCES.has(normalized);
}

// -- shopping ------------------------------------------------------------------

const CATEGORY_KEYWORDS: [string, string[]][] = [
  ['dress', ['dress', 'gown']],
  ['jacket', ['jacket', 'blazer', 'coat', 'outerwear', 'topcoat', 'parka']],
  ['jeans', ['jeans', 'denim']],
  ['trousers', ['trouser', 'pants', 'chino', 'slacks']],
  ['skirt', ['skirt']],
  ['shirt', ['shirt', 'blouse', 'tee', 't-shirt', 'polo']],
  ['hoodie', ['hoodie', 'sweatshirt']],
  ['sneakers', ['sneaker', 'trainer']],
  ['shoes', ['shoe', 'boot', 'loafer', 'heel', 'sandals']],
  ['bag', ['bag', 'handbag', 'tote', 'purse', 'backpack']],
  ['hat', ['hat', 'cap', 'beanie', 'fedora']],
  ['watch', ['watch']],
  ['necklace', ['necklace', 'choker', 'chain']],
  ['bracelet', ['bracelet', 'wristband']],
  ['sunglasses', ['sunglass', 'glasses', 'goggle']],
];

export function inferItemCategory(itemName: string): string {
  const item = itemName.toLowerCase();
  for (const [category, words] of CATEGORY_KEYWORDS) if (words.some((w) => item.includes(w))) return category;
  return '';
}

const COLORS = ['black', 'white', 'grey', 'gray', 'navy', 'blue', 'red', 'pink', 'green', 'olive', 'beige', 'brown', 'tan', 'camel', 'cream', 'burgundy', 'purple', 'yellow', 'orange', 'gold', 'silver'];
export const extractColorFromItem = (itemName: string) => COLORS.find((c) => itemName.toLowerCase().includes(c)) ?? '';

export interface AmazonConfig { domain?: string; tag?: string }

export function amazonDomain(config: AmazonConfig = {}) {
  const domain = (config.domain || 'amazon.com').toLowerCase().trim().replace(/^https?:\/\//, '').split('/')[0];
  return domain || 'amazon.com';
}

export function buildAmazonSearchUrl(query: string, config: AmazonConfig = {}): string {
  const params = new URLSearchParams({ k: collapse(query) || 'fashion' });
  if (config.tag) params.set('tag', config.tag);
  return `https://${amazonDomain(config)}/s?${params.toString()}`;
}

export interface ItemAttributes { item: string; category: string; brand: string; color: string; style: string }

export function buildItemAttributes(itemDescription: string, styleCategory: string, normalize: (s: string) => string): ItemAttributes {
  return {
    item: itemDescription.trim(),
    category: inferItemCategory(itemDescription),
    brand: '',
    color: extractColorFromItem(itemDescription),
    style: normalize(styleCategory),
  };
}

/** "Buy this look" (a specific piece) and "Shop similar" (its category), as the original sent with a try-on. */
export function buildAmazonShopLinks(attributes: ItemAttributes, config: AmazonConfig = {}): ShopLink[] {
  const { item, category, color, style } = attributes;
  const join = (terms: string[], fallback: string) => {
    const kept: string[] = [];
    for (const term of terms) {
      const clean = collapse(term);
      if (clean && !kept.some((k) => k.toLowerCase() === clean.toLowerCase())) kept.push(clean);
    }
    return kept.length ? kept.join(' ') : fallback;
  };
  const links: ShopLink[] = [];
  if (category && item.split(/\s+/).length >= 2) {
    links.push({ kind: 'exact', label: 'Buy this look on Amazon', url: buildAmazonSearchUrl(join([color, item, style], item || 'fashion'), config) });
  }
  const fallback = category || 'fashion apparel';
  links.push({ kind: 'category', label: 'Shop similar on Amazon', url: buildAmazonSearchUrl(join([color, fallback, style], fallback), config) });
  return links.slice(0, 2);
}

// -- tried items and thumbnails ------------------------------------------------

export const MAX_TRIED_ITEMS = 20;

/** Moves a re-tried piece to the end rather than listing it twice; keeps the last 20 (they ride in every prompt). */
export function markItemTried(tried: string[], itemName: string): string[] {
  const key = itemName.trim().toLowerCase();
  if (!key) return tried;
  const next = [...tried.filter((t) => !itemsMatch(key, t)), key];
  return next.length > MAX_TRIED_ITEMS ? next.slice(-MAX_TRIED_ITEMS) : next;
}

/**
 * Attach rendered catalogue shots to the suggestions they belong to. Returns
 * the same array when nothing changed, so a render can skip; matched however
 * the name was spaced or cased, since the same garment comes back from the
 * model written differently across re-analyses.
 */
export function withThumbnails(suggestions: Suggestion[], urlFor: (item: string) => string | undefined): Suggestion[] {
  let changed = false;
  const next = suggestions.map((s) => {
    const key = s.item.trim().toLowerCase();
    const url = key ? urlFor(key) : undefined;
    if (!url || s.image_url === url) return s;
    changed = true;
    return { ...s, image_url: url };
  });
  return changed ? next : suggestions;
}
