// Words and controls, checked. The host decides what the user's words mean
// and calls the board's tools; the app only checks what it is handed:
//  - isAName: whether what the host (or a field) says is a name at all;
//  - actionIn: a control's action, field by field;
//  - mustDo: the safety net's reading of the user's words, for the few
//    actions that are safe to do twice, when the host forgets the call.
import { countriesIn, norm } from './countries.ts';
import type { Action, Snapshot, Stage } from './types.ts';

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
 * accepting a wrong one is printed on the trip for the rest of the call.
 */
export function isAName(value: string): boolean {
  if (!value || value.includes('_') || /\d/.test(value)) return false;
  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 3) return false;
  return !words.some((word) => NOT_IN_A_NAME.has(word.replace(/^[\s.,!?;:'"]+|[\s.,!?;:'"]+$/g, '').toLowerCase()));
}

/** "mei lin" as "Mei Lin". */
export const titleCase = (text: string) => text.replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());

// ─── the safety net ───────────────────────────────────────────────────────

/** What the net needs to know about the board: whether the action would do anything at all. */
export interface NetContext {
  stage: Stage;
  /** The country on the map, '' if none. */
  current: string;
  /** Every country on the route, oldest first. */
  visited: string[];
  newsAvailable: boolean;
  foodShown: boolean;
  newsShown: boolean;
  /** The sight on screen (0-based) and how many there are, or null when none is. */
  sight: { index: number; total: number } | null;
}

/** The net's view of a snapshot. */
export const netContext = (s: Snapshot): NetContext => ({
  stage: s.stage,
  current: s.map?.country ?? '',
  visited: s.trip.visited.map((v) => v.country),
  newsAvailable: s.newsAvailable,
  foodShown: Boolean(s.food?.shown),
  newsShown: Boolean(s.news?.shown),
  sight: s.spot?.spot ? { index: s.spot.index, total: s.spot.total } : null,
});

export type NetTool = 'choose_destination' | 'show_food' | 'show_news' | 'next_sight' | 'previous_sight';
export interface NetCall { name: NetTool; arguments: Record<string, unknown> }

const FOOD = /\b(eat|eating|food|foods|dish|dishes|cuisine|hungry|meal|meals|snacks?|delicac(y|ies)|specialit(y|ies)|specialt(y|ies))\b/;
const NEWS = /\b(news|headlines?|what'?s happening (there|in)|what is happening (there|in)|going on (there|in))\b/;
const NEXT = /^((ok(ay)?|sure|yes|yeah|great|lovely|nice|cool|and) )*(the )?(next|another)( one| sight| spot| place)?( please)?$|\b(next (one|sight|spot|place)|another (one|sight|spot|place)|one more|what else|anything else|show me (another|more|the next)|skip (it|this one))\b/;
const PREVIOUS = /\b(previous( one| sight| spot| place)?|the one before|one before( that)?|back one)\b|^((ok(ay)?|no|wait) )*go back( please)?$/;
const BACK_TO = /\b(?:back to|return to|revisit)\s+(.+)$/;
const GO_TO = /\b(?:let'?s go to|let'?s do|take me to|show me|i want to go to|i'?d love to go to|i'?m dreaming of|dreaming of|how about|what about|plan a trip to|fly me to|go to|going to|off to)\s+(.+)$/;
const NEGATED = /\b(don'?t|do not|never|not|no|isn'?t|wasn'?t)\b/;

/**
 * The tool the user's words clearly ask for, among those safe to do twice:
 * putting a named country on the map (or going back to one), showing the
 * food or the news, and the next or previous sight (guarded by the sight it
 * starts from, so a late second call cannot skip one). Exploring a place is
 * left to the host: the place is the host's to read, and the lookup is slow.
 * Null when the words ask for nothing, or for something already on screen.
 */
export function mustDo(text: string, ctx: NetContext): NetCall | null {
  const t = norm(text);
  if (!t) return null;
  const call = (name: NetTool, args: Record<string, unknown> = {}): NetCall => ({ name, arguments: args });

  // Back to a country on the route ("back to Japan"): safe, it is the same entry.
  const back = BACK_TO.exec(t);
  const backTo = back ? countriesIn(back[1])[0] : undefined;
  if (backTo && ctx.visited.includes(backTo)) {
    return backTo === ctx.current && ctx.stage !== 'around' ? null : call('choose_destination', { place: backTo });
  }
  // A country named plainly as where to go ("let's go to Portugal"); never a negated one.
  const go = NEGATED.test(t) ? null : GO_TO.exec(t);
  const goTo = go ? countriesIn(go[1])[0] : undefined;
  if (goTo && goTo !== ctx.current) return call('choose_destination', { place: goTo });

  const sight = ctx.stage === 'around' ? ctx.sight : null;
  if (sight && PREVIOUS.test(t)) return sight.index > 0 ? call('previous_sight', { from: sight.index }) : null;
  if (sight && NEXT.test(t)) return sight.index + 1 < sight.total ? call('next_sight', { from: sight.index }) : null;

  // Food or news for the country on the map, unless they are on screen already or another country is named.
  const elsewhere = countriesIn(text).some((c) => c !== ctx.current);
  if (ctx.current && !elsewhere) {
    if (NEWS.test(t)) return ctx.newsAvailable && !ctx.newsShown ? call('show_news') : null;
    if (FOOD.test(t)) return ctx.foodShown ? null : call('show_food');
  }
  return null;
}

/**
 * Whether the net's call still has something to do on the board as it is now,
 * seven seconds after the words: the host (or a button) may have done it its
 * own way meanwhile, and then the net stands down quietly.
 */
export function stillNeeded(call: NetCall, ctx: NetContext): boolean {
  switch (call.name) {
    case 'show_food': return Boolean(ctx.current) && !ctx.foodShown;
    case 'show_news': return Boolean(ctx.current) && ctx.newsAvailable && !ctx.newsShown;
    case 'next_sight':
    case 'previous_sight': return ctx.stage === 'around' && ctx.sight?.index === call.arguments.from;
    case 'choose_destination': return call.arguments.place !== ctx.current || ctx.stage === 'around';
  }
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
