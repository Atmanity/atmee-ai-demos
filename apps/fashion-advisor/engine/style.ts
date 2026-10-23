// Style targets: the look the user is going for, as a clean phrase. Ported
// from the original agent (core.py). The keyword map always returns its
// canonical label, never the raw utterance: storing the utterance once read
// "Nice, we are shaping this into Oh, fashion forward sounds good" back to a
// user.
import { cleanSingleLine, collapse } from './items.ts';

/**
 * Walked top to bottom, first match wins, so longer phrases come before the
 * words they contain ("smart casual" before "casual", "minimalist
 * professional" before "minimalist"). "minimalistic" is listed because
 * \bminimal\b does not match it.
 */
const STYLE_KEYWORDS: [string, string][] = [
  ['minimalistic professional', 'minimalist professional'],
  ['minimalist professional', 'minimalist professional'],
  ['tech startup casual', 'tech startup casual'],
  ['tech-startup casual', 'tech startup casual'],
  ['startup casual', 'tech startup casual'],
  ['creative casual', 'creative casual'],
  ['business professional', 'business professional'],
  ['business casual', 'business casual'],
  ['smart casual', 'smart casual'],
  ['smart-casual', 'smart casual'],
  ['fashion forward', 'fashion forward'],
  ['fashion-forward', 'fashion forward'],
  ['old money', 'old money'],
  ['clean athlete', 'clean athlete'],
  ['street wear', 'streetwear'],
  ['date night', 'date night'],
  ['rock star', 'rockstar'],
  ['rock-star', 'rockstar'],
  ['streetwear', 'streetwear'],
  ['minimalistic', 'minimalist'],
  ['minimalist', 'minimalist'],
  ['minimal', 'minimalist'],
  ['formal', 'formal'],
  ['preppy', 'preppy'],
  ['bohemian', 'boho'],
  ['boho', 'boho'],
  ['rockstar', 'rockstar'],
  ['punk', 'punk'],
  ['athleisure', 'athleisure'],
  ['athletic', 'athletic'],
  ['athlete', 'athletic'],
  ['sporty', 'athletic'],
  ['elegant', 'elegant'],
  ['edgy', 'edgy'],
  ['classic', 'classic'],
  ['vintage', 'vintage'],
  ['retro', 'retro'],
  // Occasions: the occasion is the target during onboarding.
  ['wedding', 'wedding'],
  ['gala', 'gala'],
  ['interview', 'interview'],
  ['funeral', 'funeral'],
  // Generic baselines last, so longer phrases win.
  ['professional', 'professional'],
  ['business', 'business'],
  ['casual', 'casual'],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const STYLE_PATTERNS = STYLE_KEYWORDS.map(([kw, label]) => [new RegExp(`\\b${escape(kw)}\\b`, 'i'), label] as const);

/** The canonical label of the first style named in the text, or ''. */
export function matchStyleKeyword(text: string): string {
  if (!text) return '';
  for (const [pattern, label] of STYLE_PATTERNS) if (pattern.test(text)) return label;
  return '';
}

/** The general direction ("business casual" counts as smart-casual, not strict business). */
export function normalizeStyleCategory(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/^[\s.,!?;:]+|[\s.,!?;:]+$/g, '');
  if (!value) return '';
  if ((value.includes('business') || value.includes('office')) && value.includes('casual')) return 'smart-casual';
  if (value.includes('business') || value.includes('office')) return 'business';
  if (value.includes('street')) return 'streetwear';
  if (value.includes('minimal')) return 'minimalist';
  if (value.includes('formal')) return 'formal';
  if (value.includes('smart')) return 'smart-casual';
  if (value.includes('casual')) return 'casual';
  return value;
}

export const stylePhraseKey = (value: string) => (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(' ');
export const cleanStylePhrase = (value: string) => collapse(value).replace(/^[\s.,!?;:]+|[\s.,!?;:]+$/g, '');

/** A short phrase to say back ("business casual", not "I want to go as business casual for work"). */
export function styleConfirmationPhrase(raw: string): string {
  const lowered = raw.trim().toLowerCase();
  if (!lowered) return '';
  for (const phrase of ['business casual', 'smart casual', 'streetwear', 'minimalist', 'formal', 'business', 'casual']) {
    if (lowered.includes(phrase)) return phrase;
  }
  const cleaned = cleanStylePhrase(raw);
  if (cleaned.split(' ').length > 8) return normalizeStyleCategory(cleaned) || 'that style';
  return cleaned;
}

/** The target as the prompts see it: the look, plus the direction when it says something more. */
export function targetStyleBrief(desiredLook: string, category: string): string {
  const parts: string[] = [];
  const desired = cleanStylePhrase(desiredLook);
  if (desired) parts.push(desired);
  const cat = cleanStylePhrase(normalizeStyleCategory(category));
  const desiredKey = stylePhraseKey(desired);
  const categoryKey = stylePhraseKey(cat);
  const duplicate = Boolean(categoryKey) && (
    categoryKey === desiredKey || desiredKey.split(' ').includes(categoryKey) || categoryKey.split(' ').includes(desiredKey)
  );
  if (cat && !duplicate) parts.push(cat);
  return parts.join(', ');
}

/** Filler around a name ("I'm Sam", "call me Sam") that says nothing about style. */
const NAME_REPLY_FILLER = /\b(i\s*am|i'm|im|my|name|is|it's|its|call|me|you|can|the|just|hi|hey|hello|please|thanks|and|a|an)\b/gi;

/**
 * The name-giving sentence, but only when it plainly says more than the name.
 * Live: "I'm Sam, going for smart casual for a work dinner" was answered
 * "Perfect, Sam, what style do you want people to feel?", for the style in
 * that very sentence. A bare "I'm Sam" must not suppress the style question,
 * so three remaining words is the bar; the style matcher has the final say.
 */
export function styleHintFromNameReply(reply: string, name: string): string {
  const cleaned = cleanSingleLine(reply, 160);
  if (!cleaned) return '';
  const withoutName = name ? cleaned.replace(new RegExp(escape(name), 'gi'), ' ') : cleaned;
  const remainder = withoutName.replace(NAME_REPLY_FILLER, ' ');
  const words = remainder.split(/[^\w'-]+/).filter(Boolean);
  return words.length >= 3 ? cleaned : '';
}

/** A few targets offered as chips on the style step. */
export const STYLE_CHIPS = ['smart casual', 'business casual', 'streetwear', 'minimalist', 'formal', 'date night', 'old money', 'athleisure', 'boho', 'wedding'];
