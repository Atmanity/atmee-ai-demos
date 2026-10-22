// What an utterance means to the board. The old agent had the model call
// eight tools; the Avatar API has no function calling, so the app reads the
// user's words itself: rules first (they are instant, free and testable), and
// the app's own model call only for what the rules cannot place.
//
// Context matters, so every rule sees it: "go back" is the previous spot while
// looking around and nothing at all while planning; a bare "Sam" is a name
// only right after the guide asked what to call them.
import { canonicalCountry, continentsIn, countriesIn, isCountryName, norm } from './countries.ts';
import type { Action, Stage } from './types.ts';

export interface JudgeContext {
  stage: Stage;
  /** The country on the map, '' if none. */
  current: string;
  /** Every country on the trip strip, oldest first. */
  visited: string[];
  /** Whether there are nearby spots to move between. */
  hasSpots: boolean;
  /** The guide's last finished line, for answers like "Sam" or "yes please". */
  lastAvatarLine?: string;
  /** Speech: a place after "how about" must be a proper noun (the recogniser capitalises them), or "how about a beach" geocodes to a random Beach. */
  spoken?: boolean;
}

// ─── names ────────────────────────────────────────────────────────────────

/**
 * Words that appear in what people SAY FIRST and never in a name. The board
 * invites "tell me where you are dreaming of", so the first message is often
 * "I'm dreaming of Japan": three words, no digits, no underscore, and accepted
 * by shape rules alone. The board then greeted the user as "Hello dreaming of
 * Japan" for the rest of the session.
 */
const NOT_IN_A_NAME = new Set([
  // intent
  'dreaming', 'dream', 'want', 'wanted', 'like', 'love', 'thinking', 'going', 'go', 'visit', 'visiting', 'travel', 'travelling', 'traveling',
  'trip', 'holiday', 'vacation', 'plan', 'planning', 'show', 'take', 'see', 'looking', 'look', 'help', 'tell', 'know', 'day', 'days',
  'week', 'weeks', 'night', 'nights',
  // glue that a name never contains
  'of', 'to', 'in', 'at', 'on', 'for', 'about', 'from', 'with', 'and', 'the', 'a', 'an', 'please', 'thanks', 'hello', 'hi', 'hey', 'yes',
  'no', 'not', 'sure', 'okay', 'ok', 'maybe', 'somewhere', 'anywhere', 'there', 'here', 'we', 'us', 'you', 'it', 'is', 'are', 'was',
  // the branch words the opener asks about
  'around', 'near', 'nearby', 'camera', 'microphone',
]);

/**
 * Whether this is plausibly what someone asked to be called. Refuses an
 * underscore or a digit ("remember_traveler", "3 day trip to Kyoto"), four or
 * more words (a sentence), and any word that belongs to a request rather than
 * to a person. Refusing is cheap (the guide carries on without a name);
 * accepting a wrong one is printed in the header for the rest of the call.
 */
export function isAName(value: string): boolean {
  if (!value || value.includes('_') || /\d/.test(value)) return false;
  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 3) return false;
  return !words.some((word) => NOT_IN_A_NAME.has(word.replace(/^[\s.,!?;:'"]+|[\s.,!?;:'"]+$/g, '').toLowerCase()));
}

const titleCase = (text: string) => text.replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());

/** What "I'm ..." says when it is not a name. */
const NOT_A_NAME_REPLY = /^(hungry|tired|fine|good|great|ok|okay|well|ready|here|back|excited|so excited|sorry|lost|bored|curious|new|sure|not sure|happy|sad|busy|free|cold|hot|good thanks|great thanks|doing well|all good)$/i;

const ASKED_FOR_NAME = /\b(call you|your name|who am i (talking|speaking) (to|with)|what should i call|what can i call|what do i call|how should i address)\b/;

/** A name the user gave: "my name is Sam", "call me Mei Lin", or a bare "Sam" right after being asked. */
export function nameIn(text: string, lastAvatarLine = ''): string | null {
  const t = text.trim().replace(/[.!?]+$/, '');
  const explicit = /\b(?:my name is|my name's|call me|i'm called|i am called|people call me|they call me|name's)\s+(.+)$/i.exec(t);
  let candidate = explicit?.[1] ?? null;
  if (!candidate && ASKED_FOR_NAME.test(norm(lastAvatarLine))) {
    candidate = t.replace(/^(?:(?:hi|hello|hey|oh|um|uh|well|yeah|yes|sure|ok|okay|it's|it is|i'm|i am|just|so)[\s,]+)+/i, '');
  }
  if (!candidate) return null;
  // The name ends where the sentence goes on: "Sam, and I'm dreaming of Japan".
  const name = candidate.split(/[,;]|\s+(?:and|but|so|i'm|i am|i)\s+/i)[0]
    .replace(/(?:[\s,]+(?:please|thanks|thank you|here))+$/i, '')
    .trim().replace(/[.!?'"]+$/, '');
  // Asked for a name, "I'm hungry" is still not one; nor is a bare "Japan" after "what should I call you, and where to?".
  if (!explicit && (NOT_A_NAME_REPLY.test(name) || isCountryName(name) || continentsIn(name).length)) return null;
  return isAName(name) ? titleCase(name) : null;
}

// ─── places ───────────────────────────────────────────────────────────────

const NOT_A_PLACE_STATEMENT = /^(the mood|mood|love|need|a hurry|trouble|the middle of|charge|favour|favor|two minds)\b/;
const NO_PLACE = /^(home|work|the office|school|bed|the car|a meeting|me|here|this place|the moment|my area)$/;
const NEAR_ME = /\b(near me|around me|around here|nearby|close by|near where i am|where i am now|my location|my area)\b/;

/**
 * Where the user says they are: "I'm near Shibuya station", "we're in Lisbon
 * for a week", "what's worth seeing around the Louvre". `place` is '' for
 * "what's near me" (where is still to be asked); null when nothing was said.
 */
export function placeIn(text: string): { place: string } | null {
  const t = norm(text);
  const patterns = [
    /\b(?:i'm|im|i am|we're|we are)\s+(?:(?:currently|right now|staying|now|just|actually|still)\s+)*(?:in|at|near|by|around|close to|next to|outside|staying in|staying at)\s+(.+)$/,
    /^(?:near|around)\s+(.+)$/,
    /\bwhat(?:'s| is)?\s+(?:there\s+)?(?:to see\s+|to do\s+|worth seeing\s+|good\s+)?(?:near|around|close to)\s+(.+)$/,
    /\b(?:things|places|something|anything)\s+(?:to see|to do|to visit|worth seeing)\s+(?:near|around)\s+(.+)$/,
  ];
  for (const pattern of patterns) {
    const m = pattern.exec(t);
    if (!m) continue;
    let place = m[1]
      .replace(/\b(?:and|but|so|can you|could you|tell me|what|any ideas|right now|now|at the moment|today|tonight|tomorrow|this (?:week|weekend|summer|month)|next (?:week|month|year)|soon|for (?:a|the|two|three|few)|dreaming|thinking|planning|wondering|looking)\b.*$/, '')
      .replace(/\b(?:please|thanks)\b/g, '')
      .trim();
    if (NOT_A_PLACE_STATEMENT.test(place)) return null;
    if (NO_PLACE.test(place)) place = '';
    return { place };
  }
  return NEAR_ME.test(t) ? { place: '' } : null;
}

// ─── the rules ────────────────────────────────────────────────────────────

const words = (t: string) => (t ? t.split(' ').length : 0);
const TRAVEL_CUE = /\b(go|going|goes|visit|visiting|travel|travelling|traveling|trip|dream|dreaming|fly|flying|holiday|vacation|how about|what about|show me|take me|let's|lets|instead|try|maybe|plan|planning|explore|head|heading|off to|love to|like to|want to|wanna|thinking|consider|interested|or|about|then)\b/;
const PREVIOUS = /\b(previous( one| spot| place)?|the one before|one before|go back|back one|earlier one|the other one)\b/;
const NEXT = /\b(next( one| spot| place)?|another( one| spot| place)?|one more|something else|anything else|what else|else nearby|skip( it| this one)?|show me more)\b/;
const NEWS = /\b(news|headlines?|what'?s happening|what is happening|going on (there|in))\b/;
const FOOD = /\b(eat|eating|food|foods|dish|dishes|cuisine|hungry|meal|meals|snacks?|delicac(y|ies)|specialit(y|ies)|specialt(y|ies))\b/;
const PICK = /\b(you (choose|pick|decide)|surprise me|up to you|you tell me|dealer'?s choice|(pick|choose) (one|something|somewhere|a country|for me|anywhere)|anywhere is fine|i don'?t (know|mind|care) where|wherever you)\b/;
const PLAN = /\b(plan (a|my|our|the) (trip|holiday|vacation)|dream up a trip|plan something|let'?s plan|trip planning)\b/;
const SEARCH = /\b(?:go(?:ing)? to|visit(?:ing)?|travel(?:l?ing)? to|trip to|dreaming of|dream of|fly(?:ing)? to|holiday in|vacation in|how about|what about|take me to|show me|off to|head(?:ing)? to)\s+(.{2,60}?)\s*(?:,?\s*(?:instead|please|maybe|then|perhaps))?[.!?]*$/i;
const NOT_A_DESTINATION = /^(a|an|some|something|somewhere|anything|anywhere|you|it|that|this|them|me|us|more|the|food|news|there|here|home|back|be|my|your|our|their)\b/i;
const YES = /^(yes|yeah|yep|yup|sure|please|ok|okay|go on|go ahead|why not|absolutely|definitely|of course|sounds (good|great|lovely|nice)|i'?d love (that|to|it)|love to|let'?s (do it|see|go)|show me|do it|that would be (great|lovely|nice))\b/;

/** "Yes please" to what the guide just offered: a country it proposed, the headlines, the food, the next spot, or to choose for them. */
function acceptedOffer(t: string, ctx: JudgeContext): Action | null {
  if (!YES.test(t) || words(t) > 6) return null;
  const offer = norm(ctx.lastAvatarLine ?? '');
  const offered: Action[] = [];
  const proposed = avatarPick(ctx.lastAvatarLine ?? '', ctx.current);
  const proposing = /\?\s*$/.test(ctx.lastAvatarLine ?? '') || /\b(how about|what about|shall we|should we|let's|lets|why not|try|fancy|consider)\b/.test(offer);
  if (proposed && proposing) {
    offered.push(ctx.visited.includes(proposed) ? { kind: 'revisit', country: proposed } : { kind: 'destination', country: proposed });
  }
  if (NEWS.test(offer)) offered.push({ kind: 'news' });
  if (FOOD.test(offer)) offered.push({ kind: 'food' });
  if (ctx.hasSpots && /\b(next|another)( one| spot| place)?\b/.test(offer)) offered.push({ kind: 'next' });
  if (/\b(shall|should|can|could|want) (i|me to) (choose|pick)\b/.test(offer)) offered.push({ kind: 'pick' });
  // "The headlines or the food?" answered "yes" is no answer at all.
  return offered.length === 1 ? offered[0] : null;
}

/** The country to go back to for "the first one" / "the previous country", if the trip has one. */
function ordinalStop(t: string, ctx: JudgeContext): string | null {
  if (ctx.visited.length < 2) return null;
  if (/\bthe first (one|country|place|stop)\b/.test(t)) return ctx.visited[0] !== ctx.current ? ctx.visited[0] : null;
  if (/\b(previous|last|other) (country|place|stop)\b|\bwhere we were\b/.test(t)) {
    const at = ctx.visited.indexOf(ctx.current);
    const others = ctx.visited.filter((v) => v !== ctx.current);
    return at > 0 ? ctx.visited[at - 1] : others[others.length - 1] ?? null;
  }
  return null;
}

/** A board action named in the utterance, or null (then maybe the model, then the avatar alone). */
export function ruleAction(text: string, ctx: JudgeContext): Action | null {
  const t = norm(text);
  if (!t) return null;

  const name = nameIn(text, ctx.lastAvatarLine);
  if (name) return { kind: 'name', name };

  // Where they are, when they named it ("what's near me" waits: "I'm at home dreaming of Japan" is about Japan).
  const where = placeIn(text);
  if (where?.place) return { kind: 'around', place: where.place };

  // A country they are not already looking at: back to it if it is on the trip, else somewhere new.
  const named = countriesIn(text).find((c) => c !== ctx.current);
  if (named) {
    if (ctx.visited.includes(named)) return { kind: 'revisit', country: named };
    if (TRAVEL_CUE.test(t) || words(t) <= 4) {
      const continent = continentsIn(text)[0];
      return continent ? { kind: 'destination', country: named, continent } : { kind: 'destination', country: named };
    }
  }
  const stop = ordinalStop(t, ctx);
  if (stop) return { kind: 'revisit', country: stop };

  const accepted = acceptedOffer(t, ctx);
  if (accepted) return accepted;
  if (NEWS.test(t)) return { kind: 'news' };
  if (FOOD.test(t)) return { kind: 'food' };
  if (ctx.stage === 'around' && ctx.hasSpots) {
    if (PREVIOUS.test(t)) return { kind: 'previous' };
    if (NEXT.test(t)) return { kind: 'next' };
  }
  if (PICK.test(t)) return { kind: 'pick' };
  if (!named) {
    const continent = continentsIn(text)[0];
    if (continent) return { kind: 'continent', continent };
  }
  if (where) return { kind: 'show', stage: 'around' };
  if (PLAN.test(t)) return { kind: 'show', stage: 'planning' };

  // "How about Bali?": a place that is not a country; the server finds its country.
  const search = SEARCH.exec(text.trim());
  if (search && !named) {
    const object = search[1].trim().replace(/[.!?,]+$/, '');
    const properNoun = /^\p{Lu}/u.test(object);
    const justTheCurrentCountry = isCountryName(object) && canonicalCountry(object) === ctx.current;
    if ((properNoun || (!ctx.spoken && !NOT_A_DESTINATION.test(object))) && !justTheCurrentCountry) return { kind: 'search', query: object };
  }
  return null;
}

/** Whether a line is worth the model's time: rules found nothing, and it is more than a word of small talk. */
export const worthAsking = (text: string) => words(norm(text)) >= 2;

// ─── the model, for what rules cannot place ───────────────────────────────

export const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['none', 'name', 'destination', 'continent', 'pick', 'news', 'food', 'around', 'next', 'previous', 'revisit', 'plan', 'nearby'],
      description: 'What the user is asking the travel board to do; none for small talk, questions and anything else.',
    },
    name: { type: 'string', description: 'name: what they would like to be called.' },
    country: { type: 'string', description: 'destination/revisit: the country, in English.' },
    city: { type: 'string', description: 'destination: a city or region in it they named, if any.' },
    continent: { type: 'string', description: 'continent: the continent or region they named.' },
    place: { type: 'string', description: 'around: the town, neighbourhood, station or landmark they say they are at or near.' },
  },
  required: ['action'],
};

export interface ModelIntent { action: string; name?: string; country?: string; city?: string; continent?: string; place?: string }

export const intentPrompt = (text: string, ctx: JudgeContext) => `A user is talking to a travel companion beside a travel board (a map, local headlines, dishes, and spots near where the user is).
Board now: ${ctx.current ? `the map shows ${ctx.current}` : 'no country on the map yet'}; ${ctx.stage === 'around' ? 'it is showing what is near the user' : 'it is in trip-planning mode'}.
Countries already on their trip: ${ctx.visited.join(', ') || 'none'}.
The companion just said: "${ctx.lastAvatarLine ?? ''}"
The user said (speech recognition, may mishear names): "${text}"

Pick the one action the user is asking for:
- name: they say what they want to be called.
- destination: they settle on a country to plan a trip to (or accept one the companion proposed); give the country, and the city if they named one. A city alone counts: give its country.
- continent: they name only a continent or region, no country yet.
- pick: they want the companion to choose a destination for them.
- news: they want the latest local headlines for the country on the map (including "yes" to an offer of headlines).
- food: they want to know what to eat there (including "yes" to an offer of food).
- around: they say where they are now, to see what is nearby; give the place.
- nearby: they want to see what is near them but have not said where.
- next / previous: the next nearby spot, or the one before.
- revisit: go back to a country already on their trip.
- plan: they want to plan a trip (no country yet).
- none: anything else (small talk, questions about the current country, opinions).`;

/** The model's answer as a board action, or null; checked against the same context as the rules. */
export function actionFrom(intent: ModelIntent | null | undefined, ctx: JudgeContext): Action | null {
  if (!intent || typeof intent.action !== 'string') return null;
  const clean = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/[.!?]+$/, '') : '');
  const country = clean(intent.country);
  switch (intent.action) {
    case 'name': {
      const name = clean(intent.name);
      return isAName(name) ? { kind: 'name', name: titleCase(name) } : null;
    }
    case 'destination': {
      const city = clean(intent.city);
      if (!country) return city ? { kind: 'search', query: city } : null;
      const known = countriesIn(country)[0] ?? country;
      if (ctx.visited.includes(known) && known !== ctx.current) return { kind: 'revisit', country: known };
      if (known === ctx.current && !city) return null;
      return city ? { kind: 'destination', country: known, city } : { kind: 'destination', country: known };
    }
    case 'revisit': {
      const known = countriesIn(country)[0] ?? country;
      return known ? { kind: 'revisit', country: known } : null;
    }
    case 'continent': {
      const continent = clean(intent.continent);
      return continent ? { kind: 'continent', continent: continentsIn(continent)[0] ?? continent } : null;
    }
    case 'around': {
      const place = clean(intent.place);
      return place ? { kind: 'around', place } : { kind: 'show', stage: 'around' };
    }
    case 'nearby': return { kind: 'show', stage: 'around' };
    case 'plan': return { kind: 'show', stage: 'planning' };
    case 'next': return ctx.hasSpots ? { kind: 'next' } : null;
    case 'previous': return ctx.hasSpots ? { kind: 'previous' } : null;
    case 'news': return { kind: 'news' };
    case 'food': return { kind: 'food' };
    case 'pick': return { kind: 'pick' };
    default: return null;
  }
}

/**
 * The country the guide chose, read from its own words after the user asked
 * it to choose: exactly one country it is not already showing. "Portugal or
 * maybe Greece?" is a question back, not a choice, so it waits for the next line.
 */
export function avatarPick(line: string, current: string): string | null {
  const named = countriesIn(line).filter((c) => c !== current);
  return named.length === 1 ? named[0] : null;
}

// ─── controls ─────────────────────────────────────────────────────────────

/** An action sent by a control on the page, checked field by field (it is input like any other), or null. */
export function actionIn(value: unknown): Action | null {
  if (typeof value !== 'object' || value === null) return null;
  const a = value as Record<string, unknown>;
  const text = (key: string, max = 120) => (typeof a[key] === 'string' ? (a[key] as string).trim().slice(0, max) : '');
  const number = (key: string) => (typeof a[key] === 'number' && Number.isFinite(a[key]) ? (a[key] as number) : null);
  switch (a.kind) {
    case 'name': return { kind: 'name', name: text('name', 60) };
    case 'destination': return text('country') ? { kind: 'destination', country: text('country'), city: text('city'), continent: text('continent') } : null;
    case 'search': return text('query') ? { kind: 'search', query: text('query') } : null;
    case 'continent': return text('continent') ? { kind: 'continent', continent: text('continent') } : null;
    case 'around': return { kind: 'around', place: text('place') };
    case 'revisit': return text('country') ? { kind: 'revisit', country: text('country') } : null;
    case 'coords':
    case 'destinationAt': {
      const lat = number('lat');
      const lon = number('lon');
      return lat === null || lon === null ? null : { kind: a.kind, lat, lon };
    }
    case 'goto': {
      const index = number('index');
      return index === null ? null : { kind: 'goto', index };
    }
    case 'show': return a.stage === 'planning' || a.stage === 'around' ? { kind: 'show', stage: a.stage } : null;
    case 'pick': case 'news': case 'food': case 'next': case 'previous': return { kind: a.kind };
    default: return null;
  }
}
