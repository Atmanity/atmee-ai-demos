// Turning words into actions. The avatar cannot call the app, so everything
// the original agent did through a tool call (record the name, the style, the
// photo answer; try a piece on; rate again; more ideas; a new target) is
// decided here from what the user typed or said: rules first, and a small
// model call (server.ts, `structured()`) only where rules cannot tell, such as
// a bare name or a style in the user's own words.
//
// Most tables below are the original's backstops, ported with the live
// failures that shaped them; the command rules for the styling loop are new
// (the original left those to the model's tool calls).
import { cleanSingleLine, collapse, isNonGarmentSelfReference, itemMatchScore, itemTokens, normalizeItemToken, resolveSuggestionItemName } from './items.ts';
import { matchStyleKeyword, styleHintFromNameReply } from './style.ts';
import type { Command, Step } from './types.ts';

// -- names ---------------------------------------------------------------------

export const MAX_NAME_ATTEMPTS = 2;
export const MAX_PHOTO_CONSENT_ASKS = 2;

const NON_NAMES = new Set(['jealous', 'stylish', 'style', 'fashion', 'casual', 'formal', 'business', 'yes', 'no', 'sure', 'hello', 'hi', 'hey']);

export function looksLikeNonName(value: string): boolean {
  const key = (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(' ');
  if (!key) return true;
  if (key.split(' ').length > 3) return true;
  return NON_NAMES.has(key);
}

/** Spoken intros that reliably frame a name. */
const NAME_INTRO = /^(?:i'?m|i\s+am|my\s+name'?s|my\s+name\s+is|the\s+name'?s|call\s+me|this\s+is|it'?s)\b[\s,.!?;:]+/i;
/** Leading filler, stripped repeatedly: "Yeah, okay, so I'm Joan" -> "I'm Joan". */
const NAME_GREETING = /^(?:hi|hello|hey|hi\s+there|hey\s+there|sup|yo|oh|okay|ok|yeah|yep|yes|sure|so|well|alright|right|um|uh|uhm|hmm|er|like)\b[\s,.!?;:]*/i;
/**
 * A word in the first three after the frame that means the sentence is about
 * something else ("I'm going for streetwear"). Upstream's list, plus the
 * outfit words: "I'm wearing black jeans" otherwise came out as a name
 * ("wearing black jeans") whenever the model's tool call did not win first.
 */
const NAME_TAIL_STOP_WORDS = new Set([
  'and', 'but', 'so', 'because', 'while', 'when', 'if', 'though', 'you', 'we', 'i',
  'going', 'want', 'wanted', 'trying', 'looking', 'thinking', 'for', 'to', 'with', 'from', 'about', 'of', 'at',
  'actually', 'really', 'kinda', 'kind',
  'wearing', 'in', 'dressed', 'rocking', 'a', 'an', 'the', 'not', 'here', 'ready', 'good', 'fine', 'just', 'very', 'sorry', 'new', 'no',
]);

const stripEdges = (s: string) => s.replace(/^[\s.,!?;:]+|[\s.,!?;:]+$/g, '');

/** The name from "I'm X" / "my name is X" / "call me X" at the start of the reply, or ''. */
export function extractNameFromTranscript(text: string): string {
  let cleaned = stripEdges(text || '');
  if (!cleaned) return '';
  for (;;) {
    const stripped = stripEdges(cleaned.replace(NAME_GREETING, ''));
    if (stripped === cleaned) break;
    cleaned = stripped;
  }
  const m = NAME_INTRO.exec(cleaned);
  if (!m) return '';
  const rest = stripEdges(cleaned.slice(m[0].length));
  const keep: string[] = [];
  for (const token of rest.split(/\s+/).slice(0, 3)) {
    const bare = token.toLowerCase().replace(/[,.!?;:'"]+$/, '');
    if (NAME_TAIL_STOP_WORDS.has(bare)) break;
    const word = token.replace(/^[,.!?;:'"]+|[,.!?;:'"]+$/g, '');
    if (word) keep.push(word);
    if (/[,.!?;]$/.test(token)) break;   // "I'm Sam, going for..." ends the name at the comma
  }
  return keep.join(' ');
}

const NOT_A_BARE_NAME = new Set([
  ...NON_NAMES, 'erm', 'um', 'uh', 'hmm', 'ok', 'okay', 'what', 'why', 'who', 'huh', 'sorry', 'pardon', 'nothing',
  'nobody', 'skip', 'pass', 'nope', 'nah', 'thanks', 'thank', 'yeah', 'yep', 'cool', 'great', 'nice', 'good', 'fine',
  'wait', 'hold', 'later', 'me', 'you', 'it', 'that', 'this', 'there', 'here', 'go', 'ready', 'right', 'alright',
  'morning', 'evening', 'afternoon', 'night', 'bye',
]);

/** A reply that is only a name ("Jonas.", "Mary Jane"): one or two words, none of them filler. */
export function bareName(text: string): string {
  let cleaned = stripEdges(text || '');
  for (;;) {
    const stripped = stripEdges(cleaned.replace(NAME_GREETING, ''));
    if (stripped === cleaned) break;
    cleaned = stripped;
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 2 || /\?/.test(text)) return '';
  if (!words.every((w) => /^[\p{L}][\p{L}'-]*$/u.test(w))) return '';
  if (words.some((w) => NOT_A_BARE_NAME.has(w.toLowerCase()))) return '';
  return words.join(' ');
}

export const normalizeUserNameCandidate = (value: string) => stripEdges(cleanSingleLine(value, 48));

/** "I'd rather not say", "skip the name": the name question is closed, warmly. */
const NAME_SKIP = /\b(rather not (say|tell|share|give)|skip( it| that| the name)?|no names?|don'?t (want to |wanna )?(give|tell|share|say) (you )?(my|a) name|doesn'?t matter|whatever you (like|want)|call me (whatever|anything)|pass)\b/i;
/** Naming oneself after onboarding: "call me Sam", "my name is Sam". */
const LATE_NAME = /\b(?:my name is|my name's|call me)\s+([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)?)/iu;

// -- yes, no, and the camera ---------------------------------------------------

/**
 * Upstream matched these as substrings, so "look" read as "ok" and
 * "yesterday" as "yes", and "how do I look?" could fire an offered try-on.
 * Whole words and phrases here; every phrase the tests use still counts.
 */
const AFFIRMATIVE = /\b(yes|yeah|yep|yup|sure|ok|okay|please do|go ahead|do it|ready|sounds good|of course|absolutely|let'?s do it|why not)\b/i;
export const isAffirmativeReply = (text: string) => AFFIRMATIVE.test(text.trim());

const NO_CAMERA = /\b(no|without|don'?t have|haven'?t got|broken|off)\b[^.?!]{0,20}\b(camera|webcam|video)\b|\b(camera|webcam|video)\s+(is\s+)?(off|broken|down|not working)\b/i;

/**
 * Every way a person refuses the photo, including the escape the stylist
 * offers herself ("or do you want to skip it?"). Live, typed: "skip it, just
 * give me general style advice" was answered "I can only record your photo
 * consent". Anchored, not substring-matched: a bare "no" in the text reads a
 * refusal out of "I have no idea".
 */
const PHOTO_DECLINE: RegExp[] = [
  /^\W*(no|nope|nah|negative)\b/i,
  /\bno\s+(thanks|thank you|photo|photos|pic|picture|pictures|camera)\b/i,
  /\bskip\b/i,
  /\b(rather|prefer)\s+not\b/i,
  /\bdon'?t\s+(want|like|feel)\b/i,
  /\b(not|isn'?t|im not|i'?m not)\s+comfortable\b/i,
  /\bwithout\s+(a\s+)?(photo|picture|camera)\b/i,
  /\bnot\s+now\b|\bmaybe later\b|\bdecline\b/i,
  NO_CAMERA,
  /\b(text|typing|type|words|describe|description)\b[^.?!]{0,20}\b(only|instead|alternative|version)\b/i,
];

/** A refusal of the photo: a terminal answer, not a maybe. One matcher for typed and spoken alike. */
export const isPhotoDecline = (text: string) => Boolean(text?.trim()) && PHOTO_DECLINE.some((p) => p.test(text));

/**
 * "I have no camera" is not a refusal here: the photo is uploaded or dropped,
 * and no camera is needed. (In the original it was, because the photo came
 * from the camera.) The staged answer says so.
 */
export const mentionsNoCamera = (text: string) => NO_CAMERA.test(text || '') || /\bi'?m\s+typing\b/i.test(text || '');

// -- outfits described in words ------------------------------------------------

const OUTFIT_WORDS = "t-?shirt|shirt|tee|hoodie|sweater|sweatshirt|crewneck|jumper|cardigan|jacket|coat|blazer|suit|vest|dress|skirt|jeans|trousers|pants|chinos|shorts|joggers|sweatpants|leggings|sneakers|trainers|boots|shoes|loafers|heels|sandals|hat|cap|beanie|scarf|belt|tie|glasses|watch|necklace|bracelet|socks|top|outfit|fit";

const OUTFIT_DESCRIPTION: RegExp[] = [
  /\b(i'?m|i am|im)\s+(wearing|in|rocking|dressed in)\b|\bi(?:'ve| have)\s+(?:got\s+)?on\b|\bi'?m\s+(?:currently\s+)?(?:got|got on)\b/i,
  new RegExp(`\\bwearing\\b[^.?!]{0,60}\\b(?:${OUTFIT_WORDS})\\b`, 'i'),
  // "black jeans, white tee and brown boots": a list of garments with no verb is still a look.
  new RegExp(`\\b(?:${OUTFIT_WORDS})\\b[^.?!]{0,40}\\b(?:${OUTFIT_WORDS})\\b`, 'i'),
];

/**
 * Has the user told us, in words, what they are wearing? Live, a user
 * described their outfit in detail in their first message and was answered
 * "I'm looking for your name right now": without a photo that description is
 * the only thing there is to style, so it is kept wherever it was said.
 */
export const describesOutfit = (text: string) => Boolean(text?.trim()) && OUTFIT_DESCRIPTION.some((p) => p.test(text));

export type Deflection = 'camera' | 'tryon' | 'outfit';

const EARLY_TRY_ON = /\b(show|see|put|add|try)\b[^.?!]{0,24}\b(me|it|on)\b|\btry[- ]?on\b/i;

/**
 * Something said instead of a name that deserves a real answer, not "that
 * doesn't sound like a name". Live, typed: "Show me with a hat" (the panel's
 * own example) got "you want to refer to an accessory rather than a name"; "I
 * have no camera, I'm typing" got "you're expressing a situation rather than a
 * name". The answers are staged in the avatar's state (director.ts).
 */
export function nameTurnDeflection(text: string): Deflection | null {
  if (mentionsNoCamera(text)) return 'camera';
  if (EARLY_TRY_ON.test(text || '')) return 'tryon';
  if (describesOutfit(text || '')) return 'outfit';
  return null;
}

// -- the avatar's own try-on offers ---------------------------------------------

/**
 * "Do you want to try on the X?" in the avatar's words, so that a bare "yes
 * please" next can put X on. The app also asks for the offer itself (the
 * analysis event names the piece), which is the reliable half; this reads the
 * avatar's captions for offers it makes on its own. The "I would try on X;
 * want to see it" form is first so its tail is not swallowed by the generic one.
 */
const TRY_ON_OFFER_PATTERNS = [
  /\bi\s+would\s+(?:try on|try)\s+(?:the\s+)?(?<item>.+?)(?:\s+(?:next|first))?\s*[;,]\s*(?:want to see it|want to see)\s*\??\s*$/i,
  /\b(?:do you want to|want to|wanna)\s+(?:try on|test|start with|swap to)\s+(?:the\s+)?(?<item>.+?)(?:\s+(?:next|first|for the fastest upgrade))?\s*\??\s*$/i,
];
/** Offer verbs without a named piece: a "yes" to these must not queue a garbage try-on. */
const TRY_ON_OFFER_REJECT_TOKENS = ['one try-on piece', 'another try-on', 'a try-on', 'something else', 'anything else', 'any of these', 'any of those'];
const TRY_ON_OFFER_REJECT_ITEMS = new Set(['it', 'that', 'this', 'them', 'those', 'these', 'one', 'another', 'another one', 'the one', 'any', 'anything']);
/** Disambiguation questions: their captured fragment is grammar, not a garment ("or add a specific item"). */
const TRY_ON_OFFER_CLARIFY_PREFIXES = ['do you mean', 'did you mean', 'just to check', 'to clarify', 'which one', 'which would you'];
/**
 * But a confirm that names a real piece ("Just to be clear, did you mean the
 * brown leather belt?") is an offer: without it the user said "yes" and the
 * model re-asked the same question in a loop. The article after "mean"
 * anchors a real noun phrase.
 */
const TRY_ON_CLARIFY_OFFER = /\b(?:did|do)\s+you\s+mean\b(?:\s+you(?:'d|\s+would)?\s+(?:like\s+to\s+)?(?:try\s+on|try|add|wear|put\s+on))?\s+(?:the|a|an)\s+(?<item>[\w][\w\s-]*?)\s*\??\s*$/i;

const usableOfferItem = (raw: string) => {
  const candidate = raw.trim().replace(/[,.?!;:]+$/, '');
  if (candidate.length < 3) return '';
  if (/^(?:or|and|nor)\b/i.test(candidate)) return '';
  if (TRY_ON_OFFER_REJECT_ITEMS.has(candidate.toLowerCase())) return '';
  return candidate;
};

export function extractClarifyOfferItem(sentence: string): string {
  const m = TRY_ON_CLARIFY_OFFER.exec(sentence);
  return m?.groups ? usableOfferItem(m.groups.item) : '';
}

/** The piece offered in the avatar's words, last sentence first, or ''. */
export function extractTryOnOffer(text: string): string {
  if (!text) return '';
  const sentences = text.trim().split(/(?<=[.!?])\s+/);
  for (const sentence of sentences.reverse()) {
    const clean = sentence.trim();
    if (!clean) continue;
    const lowered = clean.toLowerCase();
    if (TRY_ON_OFFER_REJECT_TOKENS.some((t) => lowered.includes(t))) continue;
    const clarify = extractClarifyOfferItem(clean);
    if (clarify) return clarify;
    if (TRY_ON_OFFER_CLARIFY_PREFIXES.some((p) => lowered.startsWith(p))) continue;
    for (const pattern of TRY_ON_OFFER_PATTERNS) {
      const m = pattern.exec(clean);
      const item = m?.groups ? usableOfferItem(m.groups.item) : '';
      if (item) return item;
    }
  }
  return '';
}

/**
 * Phrases that name a NEW try-on, not a "yes" to the offered one: "Okay. Now
 * I would like to test on the chunky gold chain necklace" starts with an
 * "okay" but names another piece, and firing the offered one would swap the
 * user's pick.
 */
const EXPLICIT_TRY_ON_REQUEST = [
  /\btry(?:ing)?\s+(?:on|out)\b/i,
  /\btest(?:ing)?\s+(?:on|out)\b/i,
  /\bput(?:ting)?\s+(?:on|the|a|an)\b/i,
  /\bshow\s+me\s+(?:the|a|an)\b/i,
  /\bsee\s+(?:the|a|an)\s+\w+/i,
  /\badd\s+(?:the|a|an)\b/i,
  /\bi\s+(?:would\s+like|want|wanna|wanted|'d\s+like)\s+to\s+(?:try|test|put|see|add|swap|change|switch)\b/i,
  /\blet'?s\s+(?:try|test|put|see|add|swap)\s+(?:the|a|an|on)\b/i,
  /\b(?:actually|instead|but|wait|hold on|hold up|hang on|no)\b[\s\S]{0,40}\b(?:try|test|put|see|add|swap|switch)\b/i,
];
export const containsExplicitTryOnRequest = (text: string) => Boolean(text) && EXPLICIT_TRY_ON_REQUEST.some((p) => p.test(text));

const NEGATIVE_TO_OFFER = /\b(no thanks|no thank you|not now|not really|not yet|maybe later|skip|nope|nah)\b|^\W*no\b/i;

// -- the styling loop: what the user is asking for ------------------------------

/** Garments and accessories, for telling "try the blazer" from "try something different". */
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

const RESET = [
  /\b(?:back to|go back to|return to|reset to|restore)\b[^.?!]{0,20}\b(?:live|original|own|first|real|old|base|starting|normal)?\s*(?:look|photo|picture|outfit|self)\b/i,
  /\b(?:take|get)\s+(?:it all|them all|it|that|them|everything|all of (?:it|that|them))\s+off\b/i,
  /\bremove\s+(?:the\s+|all\s+(?:the\s+)?)?(?:try-?ons?|pieces|items|everything)\b/i,
  /^\W*(?:undo|reset|start over)\W*$/i,
];
const RETAKE = /\b(?:retake|re-?take|new (?:photo|picture|pic)|another (?:photo|picture|pic)|different (?:photo|picture|pic)|take (?:a|another|my) (?:photo|picture|pic)|(?:upload|share|send|add|use) (?:a|another|new|my|the) (?:photo|picture|pic)|re-?upload|re-?scan|rescan|(?:do|let'?s do) the (?:photo|picture))\b/i;
const MORE = /\b(?:more|other|different|new|additional|extra|few more)\s+(?:ideas|suggestions|options|pieces|items|recommendations|picks|things)\b|\bwhat else\b|\bshow me more\b|\bload more\b|\banything else\b|\bsuggest (?:something|some) (?:else|more)\b/i;
const RATE_VERB = '(?:rate|score|judge|analy[sz]e|read|review|critique|grade)';
const RERATE = new RegExp(`\\b${RATE_VERB}\\b[^.?!]{0,16}\\bagain\\b|\\b(?:re-?rate|re-?analy[sz]e|re-?score|new (?:score|rating|read)|fresh (?:score|read|critique|rating|look)|refresh the (?:critique|rating|read|score)|rate (?:me|it|this|the look|my look|my outfit|the outfit|this outfit|this look)(?: now)?)\\W*$`, 'i');
const RETARGET = [
  new RegExp(`\\b${RATE_VERB}\\s+(?:me|it|this|the look|my look|the outfit|my outfit)?\\s*(?:for|as)\\s+(?:an?\\s+|my\\s+|the\\s+)?(?<style>[^.?!]+?)(?:\\s+(?:instead|look|vibe|style))?\\s*[.?!]*$`, 'i'),
  /\b(?:what|how)\s+about\s+(?:for\s+)?(?:an?\s+|my\s+|the\s+)?(?<style>[^.?!]+?)(?:\s+instead)?\s*[.?!]*$/i,
  /\b(?:i'?m\s+(?:now\s+)?going for|i'?m\s+aiming for|change (?:the|my) (?:target|style|goal) to|switch (?:the|my) (?:target|style|goal) to|make (?:the|my) (?:target|goal) )\s*(?:an?\s+)?(?<style>[^.?!]+?)\s*(?:instead|look|vibe|style)?\s*[.?!]*$/i,
];
const OCCASION_WORDS = /\b(look|vibe|occasion|wedding|date|interview|party|work|office|dinner|gala|funeral|brunch|meeting|club|beach|concert|graduation|holiday|trip|travel|event|night out)\b/i;
const STEER = /\b(?:more|lean|push (?:it|this)|go|make (?:it|this)|something|a bit|bit)\s+(?:more\s+|bit\s+more\s+)?(?:toward(?:s)?\s+|into\s+)?(?<style>street\s?wear|smart[- ]casual|business casual|business|casual|formal|minimal\w*|office)\b/i;

const TRY_PATTERNS: RegExp[] = [
  /\b(?:try|test)(?:ing)?\s+(?:on|out)\s+(?<item>.+)/i,
  /\bput\s+(?<item>.+?)\s+on(?:\s+(?:me|myself|for me))?\b/i,
  /\bput(?:ting)?\s+on\s+(?<item>.+)/i,
  /\bshow\s+me\s+(?:with|in|wearing)\s+(?<item>.+)/i,
  /\bshow\s+me\s+(?<item>(?:the|a|an|that|this)\s+.+?)(?:\s+on(?:\s+me)?)?\s*[.?!]*$/i,
  /\b(?:see|picture|imagine)\s+(?:me|myself)\s+(?:with|in|wearing)\s+(?<item>.+)/i,
  /\bsee\s+(?<item>(?:the|a|an|that|this)\s+.+?)\s+on(?:\s+me)?\b/i,
  /\bhow\s+would\s+(?:i|it|this|the look)\s+look\s+(?:with|in)\s+(?<item>.+)/i,
  /\badd(?:ing)?\s+(?<item>.+?)(?:\s+to\s+(?:me|my look|the look|this look|my outfit|the outfit|this|it))?\s*[.?!]*$/i,
  /\b(?:swap|switch|change)\s+(?:in(?:to)?|to)\s+(?<item>.+)/i,
  /\b(?:wear|throw on|slip on)\s+(?<item>.+)/i,
  /\b(?:try|test)\s+(?<item>.+)/i,
];
/** Asking for advice, not for a render: "should I try a hat?" is the avatar's to answer. */
const ADVICE_QUESTION = /^\W*(?:should|do you think|is it|does|what if)\b/i;
const NOT_NOW = /\b(?:later|not now|another time|some other time|never|tomorrow)\b|\b(?:don'?t|do not)\s+(?:try|put|add|show|want|need)\b/i;
const TRAILING = /(?:\s+(?:on me|on|for me|please|now|instead|too|as well|next|first|then|real quick|quickly|again|today|tonight|for (?:the|a|an|my|this|that|work|tonight|today)\b.*|to (?:work|the|a|my|dinner|see)\b.*|at (?:the|a|work)\b.*|over (?:it|this|that|my)\b.*|so i can\b.*|and see\b.*|to see\b.*|and (?:rate|score|tell)\b.*))+$/i;
const LEADING_ARTICLE = /^(?:(?:the|a|an|some|my|that|this|those|these|your|one of (?:the|those|these)|pair of|a pair of)\s+)+/i;
const PRONOUN_ITEM = /^(?:it|them|that|this|those|these|one|that one|this one|the one|her|him)$/i;
const ORDINAL = /^(?:the\s+)?(?<n>first|second|third|fourth|fifth|sixth|seventh|eighth|last|1st|2nd|3rd|4th|5th|6th|number\s+\w+|#?\d)(?:\s+(?:one|suggestion|piece|item|pick|option|card))?$/i;
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

function cleanItem(raw: string): string {
  let item = collapse(raw).replace(/[.?!,;:]+$/, '');
  for (let i = 0; i < 3; i++) item = item.replace(TRAILING, '').replace(/[.?!,;:]+$/, '').trim();
  return item;
}

function ordinalItem(item: string, suggestions: string[]): string | null {
  const m = ORDINAL.exec(item.trim());
  if (!m?.groups || !suggestions.length) return null;
  const raw = m.groups.n.toLowerCase().replace(/^number\s+/, '').replace(/^#/, '');
  const n = raw === 'last' ? suggestions.length : ORDINALS[raw] ?? Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= suggestions.length ? suggestions[n - 1] : null;
}

export interface TryOnRequest { item: string; pronoun: boolean }

/** The piece in "try a black fedora" / "put a tie on me" / "show me with a hat", or null. */
export function extractTryOnRequest(text: string, suggestions: string[] = []): TryOnRequest | null {
  const said = collapse(text);
  if (!said || ADVICE_QUESTION.test(said) || NOT_NOW.test(said)) return null;
  for (const pattern of TRY_PATTERNS) {
    const m = pattern.exec(said);
    if (!m?.groups) continue;
    const item = cleanItem(m.groups.item);
    const bare = item.replace(LEADING_ARTICLE, '').trim();
    const ordinal = ordinalItem(item, suggestions) ?? ordinalItem(bare, suggestions);
    if (ordinal) return { item: ordinal, pronoun: false };
    if (!bare || PRONOUN_ITEM.test(bare) || PRONOUN_ITEM.test(item)) return { item: '', pronoun: true };
    if (isNonGarmentSelfReference(item) || isNonGarmentSelfReference(bare)) return null;
    // A named piece: a garment word, or one of the pieces on screen.
    const onScreen = suggestions.some((s) => itemMatchScore(bare, s) >= 0.55);
    if (!mentionsGarment(bare) && !onScreen) return null;
    return { item: bare, pronoun: false };
  }
  return null;
}

// -- the verdict ----------------------------------------------------------------

export interface JudgeContext {
  step: Step;
  /** The names of the pieces on screen, in order (for "the second one"). */
  suggestions: string[];
  /** The piece the avatar was last asked to offer (or offered itself), if still fresh. */
  offer: string | null;
  hasPhoto: boolean;
  photoDeclined: boolean;
  hasName: boolean;
  hasTarget: boolean;
}

/** What to ask the model when rules cannot tell. */
export type ModelQuestion = 'name' | 'style' | 'styleHint' | 'intent';

export interface Verdict {
  command: Command | null;
  /** Ask the model, then complete `command` (fromModel). */
  ask?: ModelQuestion;
  /** The text the model should read (the whole line, or the style hint inside a name reply). */
  askText?: string;
  /** The user turned the offered piece down. */
  clearOffer?: boolean;
}

const words = (text: string) => collapse(text).split(' ').filter(Boolean).length;
const isQuestion = (text: string) => /\?\s*$/.test(text.trim()) || /^\W*(?:what|why|how|who|where|when|can|could|do|does|is|are|will|would|should)\b/i.test(text);
/** A style named with intent ("going for", "I want … look"), not a word inside an outfit description. */
const STYLE_FRAME = /\b(going for|go for|aiming|aim for|target|want|wanna|like to look|look like|looking for|vibe|style|for an?|something|make it|actually|instead|thinking)\b/i;

function onboardingStyle(text: string): string {
  const style = matchStyleKeyword(text);
  if (!style) return '';
  // "I'm wearing a casual tee" describes the outfit; it does not set the target.
  if (describesOutfit(text) && !STYLE_FRAME.test(text)) return '';
  return style;
}

/** A turn that is not an app action, with what is worth keeping from it. */
export function chat(text: string, wish?: string): Command {
  const command: Command = { type: 'chat' };
  if (describesOutfit(text)) command.outfit = cleanSingleLine(text, 400);
  if (wish) command.wish = wish;
  return command;
}

/** A piece asked for before there is a photo to put it on ("show me with a hat"): kept, and offered first once there is one. */
const earlyWish = (text: string) => extractTryOnRequest(text)?.item || '';

/**
 * The rules. A null command means "just conversation": a typed line goes to
 * the avatar as it is, a spoken one needs nothing.
 */
export function judgeRules(text: string, ctx: JudgeContext): Verdict {
  const said = collapse(text);
  if (!said) return { command: null };

  if (ctx.step === 'name') {
    if (NAME_SKIP.test(said)) return { command: { type: 'skipName' } };
    const framed = normalizeUserNameCandidate(extractNameFromTranscript(said));
    const name = framed || normalizeUserNameCandidate(bareName(said));
    if (name && !looksLikeNonName(name)) {
      const hint = styleHintFromNameReply(said, name);
      const style = hint ? onboardingStyle(hint) : '';
      const command: Command = style ? { type: 'name', name, style } : { type: 'name', name };
      // "I'm Sam" is a name; "I'm excited" is not, and only the capital tells them
      // apart (recognisers capitalise names). A bare word or a lower-case one is
      // checked by the model when there is one; without a model the rule stands.
      if (!framed || !/^\p{Lu}/u.test(name)) return { command, ask: 'name', askText: said };
      if (hint && !style) return { command, ask: 'styleHint', askText: hint };
      return { command };
    }
    const style = onboardingStyle(said);
    if (style) return { command: { type: 'style', style } };
    if (words(said) <= 6 && !isQuestion(said) && !nameTurnDeflection(said)) return { command: chat(said), ask: 'name', askText: said };
    return { command: chat(said, earlyWish(said)) };
  }

  if (ctx.step === 'style') {
    const style = onboardingStyle(said);
    if (style) return { command: { type: 'style', style } };
    if (isPhotoDecline(said) && /\b(photo|picture|pic|camera)\b/i.test(said)) return { command: { type: 'declinePhoto' } };
    if (words(said) <= 20 && !isQuestion(said) && !describesOutfit(said) && !nameTurnDeflection(said)) {
      return { command: chat(said), ask: 'style', askText: said };
    }
    return { command: chat(said, earlyWish(said)) };
  }

  if (ctx.step === 'photo') {
    // A no is checked before a yes: upstream asked "yes?" first, so "no, not ready" counted as consent ("ready").
    if (mentionsNoCamera(said)) return { command: chat(said) };
    if (isPhotoDecline(said)) return { command: { type: 'declinePhoto' } };
    if (isAffirmativeReply(said) && !containsExplicitTryOnRequest(said)) return { command: { type: 'photoYes' } };
    const style = matchStyleKeyword(said);
    if (style && /\b(actually|instead|make it|change|switch|rather)\b/i.test(said)) return { command: { type: 'style', style } };
    return { command: chat(said, earlyWish(said)) };
  }

  // The styling loop.
  if (RESET.some((p) => p.test(said)) && ctx.hasPhoto) return { command: { type: 'reset' } };
  if (RETAKE.test(said)) return { command: { type: 'retake' } };
  if (MORE.test(said)) return { command: { type: 'more' } };
  for (const pattern of RETARGET) {
    const m = pattern.exec(said);
    const raw = m?.groups ? cleanSingleLine(m.groups.style, 80).replace(/^(?:a|an|my|the)\s+/i, '') : '';
    if (!raw) continue;
    const style = matchStyleKeyword(raw) || (OCCASION_WORDS.test(raw) || pattern === RETARGET[0] ? raw : '');
    if (style && !mentionsGarment(raw)) return { command: { type: 'retarget', style } };
  }
  if (RERATE.test(said)) return { command: { type: 'rerate' } };
  const steer = STEER.exec(said);
  if (steer?.groups && !mentionsGarment(said) && !isQuestion(said)) return { command: { type: 'steer', style: steer.groups.style } };

  const request = extractTryOnRequest(said, ctx.suggestions);
  if (request) {
    if (!request.pronoun) return { command: { type: 'tryOn', item: request.item } };
    if (ctx.offer) return { command: { type: 'tryOn', item: ctx.offer } };
    return { command: null };
  }

  if (ctx.offer) {
    if (NEGATIVE_TO_OFFER.test(said)) return { command: null, clearOffer: true };
    // A "yes" to the piece the avatar just offered, unless the turn pivots to a new request.
    if (isAffirmativeReply(said) && !containsExplicitTryOnRequest(said) && words(said) <= 8) {
      return { command: { type: 'tryOn', item: ctx.offer } };
    }
  }

  const late = LATE_NAME.exec(said);
  if (late && !looksLikeNonName(late[1])) return { command: { type: 'name', name: normalizeUserNameCandidate(late[1]) } };

  if (describesOutfit(said)) return { command: chat(said) };

  // Rules found nothing. A model reads the lines that might still be a request.
  const maybeRequest = mentionsGarment(said) || Boolean(matchStyleKeyword(said)) || /\b(try|put|add|wear|rate|score|swap|switch|change|photo|picture|more|instead|again|undo|remove|take off|on me)\b/i.test(said);
  if (words(said) >= 2 && maybeRequest) return { command: null, ask: 'intent', askText: said };
  return { command: null };
}

// -- the model's half -----------------------------------------------------------

export const NAME_SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string', description: 'The name or nickname the user gave, as they said it; empty if none.' } },
  required: ['name'],
};
export const namePrompt = (reply: string) => `The stylist asked the user what name to call them. The user's spoken reply was:
"${cleanSingleLine(reply, 160)}"
If the reply gives a person's name or nickname, return only that name (strip filler like "I'm", "my name is", "call me" or "nice to meet you"; keep natural capitalization; at most 3 words). If it does not give a name at all (a question, a greeting, a style or mood word, panic, or something unrelated), return an empty name.`;

export const STYLE_SCHEMA = {
  type: 'object',
  properties: { style: { type: 'string', description: 'The style, look, vibe, occasion or persona, as a short lowercase phrase of at most 6 words; empty if none.' } },
  required: ['style'],
};
export const stylePrompt = (reply: string) => `The stylist asked the user what style they want for their outfit. The user's reply was:
"${cleanSingleLine(reply, 160)}"
If the reply names a style, look, vibe, occasion, archetype or persona (any phrasing, including "modern sleek", "old money", "boho", "wedding", "rockstar", "the German soccer guy"), return only that style as a short lowercase phrase, at most 6 words, without filler like "I want" or "something like". If it does not name a style at all (a question, panic, or something unrelated), return an empty style.`;

export const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['try_on', 'more', 'rerate', 'retarget', 'steer', 'retake', 'reset', 'chat'] },
    item: { type: 'string', description: 'For try_on: the specific garment or accessory, as a short product name; else empty.' },
    style: { type: 'string', description: 'For retarget or steer: the style or occasion; else empty.' },
  },
  required: ['intent', 'item', 'style'],
};
export const intentPrompt = (line: string, suggestions: string[], offer: string | null) => `A user is talking to a stylist in a styling app. The app can: put a specific garment or accessory on the user's photo (try_on), find more recommended pieces (more), rate the current look again (rerate), rate it for a different target style or occasion (retarget), steer the next recommendations toward a general direction such as streetwear or formal (steer), take a new photo (retake), or go back to the user's original photo (reset).
Pieces on screen: ${suggestions.length ? suggestions.join('; ') : 'none yet'}.${offer ? `\nThe stylist just offered to try on: ${offer}.` : ''}
The user said: "${cleanSingleLine(line, 300)}"
Which app action is the user explicitly asking for? Reassurance ("I look good now, right?", "isn't it better?"), questions, opinions, small talk and advice questions ("should I wear a hat?") are chat. Only call it try_on when they ask to see, add, put on or try a specific named piece (or the offered one).`;

export function fromNameModel(r: { name?: string }): string {
  const name = normalizeUserNameCandidate(String(r?.name ?? ''));
  return name && name.toUpperCase() !== 'NONE' && !looksLikeNonName(name) ? name : '';
}

export function fromStyleModel(r: { style?: string }): string {
  const style = cleanSingleLine(String(r?.style ?? ''), 80).replace(/^[\s.,!?;:"']+|[\s.,!?;:"']+$/g, '').toLowerCase();
  return style && style !== 'none' ? style : '';
}

export function fromIntentModel(r: { intent?: string; item?: string; style?: string }, ctx: Pick<JudgeContext, 'suggestions' | 'offer'>): Command | null {
  const item = cleanSingleLine(String(r?.item ?? ''), 60);
  const style = fromStyleModel({ style: r?.style });
  switch (r?.intent) {
    case 'try_on': {
      const named = item || ctx.offer || '';
      if (!named || isNonGarmentSelfReference(named)) return null;
      return { type: 'tryOn', item: resolveSuggestionItemName(named, { suggestions: ctx.suggestions.map((s) => ({ item: s, text: '' })) }) };
    }
    case 'more': return { type: 'more' };
    case 'rerate': return { type: 'rerate' };
    case 'retarget': return style ? { type: 'retarget', style } : null;
    case 'steer': return style ? { type: 'steer', style } : null;
    case 'retake': return { type: 'retake' };
    case 'reset': return { type: 'reset' };
    default: return null;
  }
}

/** Whether a command is an app action (a typed one is recorded, not sent to the avatar). */
export const consumes = (command: Command | null) => Boolean(command && command.type !== 'chat');

/** A command as it arrives over the network, checked field by field; null when it is not one. */
export function parseCommand(raw: unknown): Command | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const str = (key: string, max = 200) => (typeof c[key] === 'string' ? cleanSingleLine(c[key] as string, max) : '');
  switch (c.type) {
    case 'name': return str('name') ? { type: 'name', name: str('name', 48), ...(str('style') ? { style: str('style', 140) } : {}) } : null;
    case 'style': case 'retarget': case 'steer': return str('style') ? { type: c.type, style: str('style', 140) } : null;
    case 'tryOn': return str('item') ? { type: 'tryOn', item: str('item', 80), ...(str('text') ? { text: str('text', 160) } : {}) } : null;
    case 'photo':
      if (typeof c.data !== 'string' || typeof c.mime !== 'string') return null;
      return { type: 'photo', mime: c.mime, data: c.data, source: c.source === 'sample' ? 'sample' : 'upload' };
    case 'chat': {
      const command: Command = { type: 'chat' };
      if (str('outfit')) command.outfit = str('outfit', 400);
      if (str('wish')) command.wish = str('wish', 80);
      return command;
    }
    case 'more': return c.quiet === true ? { type: 'more', quiet: true } : { type: 'more' };
    case 'skipName': case 'photoYes': case 'declinePhoto': case 'rerate': case 'retake': case 'reset':
      return { type: c.type };
    default: return null;
  }
}
