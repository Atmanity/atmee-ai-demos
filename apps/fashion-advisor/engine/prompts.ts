// What the models are asked, and how their answers are cleaned up. The
// prompts are the original agent's (core.py), minus "return ONLY JSON":
// `structured()` hands Gemini a response schema instead. The normalisers keep
// the original's clamps and fallbacks, because a model answer is untrusted
// input that ends up on screen and in the avatar's state.
import { ALL_BODY_ZONES, cleanParagraph, cleanSingleLine } from './items.ts';
import type { Zone } from './types.ts';

// -- the style read ------------------------------------------------------------

export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    style_summary: { type: 'string', description: 'Very short, 2-5 words.' },
    occasion: { type: 'string' },
    style_score: { type: 'integer', description: '1-10: how well the look matches the desired style goal.' },
    color_palette: { type: 'array', items: { type: 'string' }, description: '3-5 colour names.' },
    what_works: { type: 'string', description: 'A vivid spoken stylist note, at most 2 short sentences.' },
    style_tip: { type: 'string', description: 'One precise fix, at most 2 short sentences.' },
  },
  required: ['style_summary', 'occasion', 'style_score', 'color_palette', 'what_works', 'style_tip'],
};

export function analysisPrompt(input: { userName: string; target: string; context: string }) {
  return 'You are a sharp but warm personal stylist and fitness-minded advisor. Analyze this outfit. '
    + 'Be candid, specific, and constructive, never cruel. '
    + 'Focus on fit, proportion, color harmony, styling coherence, confidence, and ease of movement. '
    + 'Keep style_summary very short (2-5 words). '
    + "Write what_works and style_tip as vivid, spoken stylist notes (max 2 short sentences each). Avoid generic phrases like 'nice outfit', 'improve your style', or 'add accessories'. "
    + "Score MUST measure how well this look matches the user's desired style goal. "
    + `User name: ${input.userName || 'unknown'}. `
    + `Desired style goal: ${input.target || 'not provided yet'}. `
    + `Context: ${input.context}.`;
}

export interface RawAnalysis {
  style_summary?: unknown; occasion?: unknown; style_score?: unknown; color_palette?: unknown; what_works?: unknown; style_tip?: unknown;
}

export interface CleanAnalysis {
  target_style: string; style_summary: string; occasion: string; style_score: number;
  color_palette: string[]; what_works: string; style_tip: string;
}

/** The model's read, clamped to what the board and the avatar can carry. */
export function analysisFrom(raw: RawAnalysis, target: string): CleanAnalysis {
  let score = Math.round(Number(raw.style_score));
  if (!Number.isFinite(score)) score = 5;
  let palette = Array.isArray(raw.color_palette) ? raw.color_palette.map((c) => String(c).trim()).filter(Boolean).slice(0, 5) : [];
  if (palette.length < 3) palette = [...palette, 'neutral', 'black', 'white'].slice(0, 3);
  const text = (value: unknown, fallback: string) => String(value ?? '').trim() || fallback;
  return {
    target_style: cleanSingleLine(target, 80),
    style_summary: cleanSingleLine(text(raw.style_summary, 'Style review'), 56),
    occasion: cleanSingleLine(String(raw.occasion ?? '').trim(), 48),
    style_score: Math.max(1, Math.min(10, score)),
    color_palette: palette,
    what_works: cleanParagraph(text(raw.what_works, 'Some elements are working.'), 260),
    style_tip: cleanParagraph(text(raw.style_tip, 'Refine fit and color balance.'), 260),
  };
}

// -- which body zones are in the photo ----------------------------------------

export const ZONES_SCHEMA = {
  type: 'object',
  properties: { visible_body_parts: { type: 'array', items: { type: 'string', enum: [...ALL_BODY_ZONES] } } },
  required: ['visible_body_parts'],
};
export const ZONES_PROMPT = 'Inspect this person image and return visible_body_parts: zero or more of head, neck, upper_body, lower_body, wrist, feet. Only include body parts that are actually visible enough for adding fashion items.';

/**
 * The zones a try-on may use. On any doubt, all of them: refusing a hat
 * because the model answered badly is worse than trying one. The neck sits
 * between the head and the upper body, so both visible means it is too:
 * Gemini sometimes dropped "neck" after a hat or glasses try-on, and a
 * necklace was then refused on a neckline in plain view.
 */
export function zonesFrom(raw: unknown): Set<Zone> {
  const list = (raw as { visible_body_parts?: unknown })?.visible_body_parts;
  if (!Array.isArray(list)) return new Set(ALL_BODY_ZONES);
  const zones = new Set<Zone>();
  for (const part of list) {
    const zone = String(part).trim().toLowerCase() as Zone;
    if ((ALL_BODY_ZONES as readonly string[]).includes(zone)) zones.add(zone);
  }
  if (zones.has('head') && zones.has('upper_body')) zones.add('neck');
  return zones.size ? zones : new Set(ALL_BODY_ZONES);
}

// -- recommended pieces --------------------------------------------------------

export const SUGGESTIONS_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'A specific product name, 2-6 words, Title Case.' },
          text: { type: 'string', description: 'One short sentence: why it pushes the look toward the target style.' },
        },
        required: ['item', 'text'],
      },
    },
  },
  required: ['suggestions'],
};

export function suggestionsPrompt(input: { zones: Iterable<Zone>; target: string; recent: string[] }) {
  const visible = [...input.zones].sort().join(', ') || 'head, upper_body';
  const recent = input.recent.slice(-8).join(', ') || 'none';
  return 'You are a stylist suggesting specific fashion items the user could try on in an AR try-on app.\n'
    + 'HARD RULES:\n'
    + "1. The 'item' field MUST be a concrete, named piece of clothing or accessory (examples: 'Slim Navy Silk Tie', 'Dark Wash Tapered Jeans', 'Black Tortoise-Shell Round Glasses', 'Camel Wool Topcoat').\n"
    + "2. NEVER put a body part, body zone, or category name in 'item'. Do NOT return 'neck', 'upper_body', 'upper body', 'head', 'wrist', 'feet', 'accessories', or similar generic words.\n"
    + '3. Produce exactly 6 DISTINCT suggestions. Each should target a different visible body zone when possible.\n'
    + `4. Each suggestion must be addable on ONE of these visible body zones only (this is a CONSTRAINT, not the item name): ${visible}.\n`
    + `5. Align every suggestion with the user's desired style goal: '${input.target || 'not specified'}'.\n`
    + `6. Avoid these recently tried items: ${recent}.\n`
    + "7. Keep 'text' under 90 characters and make it specific (mention fit, colour, fabric, or the effect on the silhouette).";
}

export function suggestionsFrom(raw: unknown): { item: string; text: string }[] {
  const list = (raw as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(list)) return [];
  const out: { item: string; text: string }[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const item = cleanSingleLine(String((entry as { item?: unknown }).item ?? '').trim(), 48);
    const text = cleanSingleLine(String((entry as { text?: unknown }).text ?? '').trim(), 90);
    if (item) out.push({ item, text });
  }
  return out;
}

/** The original's stand-ins when the model gives too few, one per zone. */
export const FALLBACK_SUGGESTIONS: [string, string, Zone][] = [
  ['Minimal black sunglasses', 'Adds definition around the face immediately.', 'head'],
  ['Statement sunglasses', 'Creates stronger visual character near the face.', 'head'],
  ['Layered necklace', 'Adds depth around the neckline and chest area.', 'neck'],
  ['Tailored blazer', 'Improves structure and silhouette on the upper body.', 'upper_body'],
  ['Slim-fit trousers', 'Balances proportions through the lower body.', 'lower_body'],
  ['Classic wrist watch', 'Adds polish and intentional detail at the wrist.', 'wrist'],
  ['Clean leather sneakers', 'Grounds the outfit with a sharper finish.', 'feet'],
];

// -- images: the try-on and the catalogue shots ---------------------------------

/** The try-on edit. Ends with the clause the original always required. */
export function tryOnPrompt(item: string, detail: string, styleDirection: string) {
  const styleClause = styleDirection ? `Keep the overall vibe aligned with a ${styleDirection} style direction. ` : '';
  const detailClause = detail.trim() ? `${detail.trim()} ` : '';
  return `Add ${item} to this person in a realistic, natural way. ${detailClause}${styleClause}Keep everything else — face, body, background — exactly the same.`;
}

/**
 * Upstream's thumbnail prompt (its `single-item-v2`), word for word. Every
 * clause was arrived at by watching the model get it wrong: without the
 * refusals it returns a whole styled outfit, or the garment on a mannequin,
 * which beside a real try-on of the user's own face reads as a second person.
 */
export function suggestionThumbnailPrompt(item: string) {
  return [
    `Square ecommerce catalog photo of exactly one fashion item: "${item}".`,
    'The image must contain only that single named item.',
    'Do not show an outfit, set, bundle, matching accessory, second garment, or styling suggestion.',
    'Center the single item on a simple dark neutral studio background.',
    'No person, no mannequin, no body parts, no props, no text, no logo, no watermark.',
  ].join(' ');
}

// -- retries -------------------------------------------------------------------

const TRANSIENT = ['deadline', '1011', 'timeout', 'timed out', 'connection', 'unavailable', 'internal error', '503', '504', '429', 'rate limit', 'reset', 'temporarily', 'fetch failed', 'aborted'];
export const isTransientError = (err: unknown) => TRANSIENT.some((m) => String((err as Error)?.message ?? err).toLowerCase().includes(m));

/**
 * Retries a model call on errors worth retrying (network blips, 5xx, 429),
 * 3 attempts with a growing pause, as the original did. Anything else, and
 * the last failure, is thrown: callers clear their loading state on it.
 */
export async function retryTransient<T>(fn: () => Promise<T>, opts: { attempts?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void>; onRetry?: (attempt: number, err: unknown) => void } = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 1200;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isTransientError(err)) throw err;
      opts.onRetry?.(attempt, err);
      await sleep(base * attempt);
    }
  }
}
