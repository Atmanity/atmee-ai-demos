// What some words ask of the chart, by rules over the catalogue's OWN names:
// its 135 stars, 42 constellations (18 with figures), 41 places, and the time
// presets. Two callers: the host's tools pass the words they heard ("the
// north star", "two hours later", "40.7 north 74 west") and `actions.ts` turns
// them into intents here; and the safety net (`net.ts`) reads what the user
// said to see whether they clearly asked for a move the host then never made.
// A model is asked only when the words name something the rules cannot place
// (server.ts, optional), and whatever it says is still validated by the chart.
//
// Not an action, so nothing here: questions ("why is it orange?", "what's
// up?", "tell me about it"), the planets, the Moon and the Sun.
import { CONSTELLATION_ALIASES, CONSTELLATION_NAMES, STARS } from './catalog.ts';
import { PLACES } from './sky.ts';
import type { Intent } from './types.ts';

export interface Parsed {
  /** In the order they apply: place, time, figure, star (or the clears). */
  intents: Intent[];
  /** Every name was said as the catalogue (or common usage) says it; false when
   *  a known mishearing was mapped ("beetle juice"), so the avatar, which heard
   *  the same words, may not have understood them. */
  exact: boolean;
  /** A command whose target the rules could not place: ask the model, or apply
   *  the fallback (which the chart refuses by name). */
  unresolved?: { target: string; frame: 'place' | 'thing'; fallback: Intent };
}

/** Lower case, accents off, "3 p.m." as "3 pm", only words, numbers and signs. */
export function normalize(text: string): string {
  return ` ${text} `
    .toLowerCase()
    .normalize('NFKD').replace(/\p{M}+/gu, '')
    .replace(/[’‘`]/g, "'").replace(/[−–—]/g, (c) => (c === '−' ? '-' : ' '))
    .replace(/°/g, ' degrees ')
    .replace(/\b([ap])\.?\s?m\b\.?/g, ' $1m ')
    .replace(/[^a-z0-9'.:\- ]+/g, ' ')
    .replace(/(?<!\d)[.:]|[.:](?!\d)/g, ' ')       // a dot or colon only inside a number or a time
    .replace(/(?<=[a-z0-9])-|-(?!\d)/g, ' ')         // a hyphen only as a minus sign
    .replace(/\s+/g, ' ')
    .trim();
}

/** For name matching: possessives and apostrophes off ("orion's belt" -> "orion belt"). */
const plain = (t: string) => t.replace(/'s\b/g, '').replace(/'/g, '');

const has = (t: string, phrase: string) => ` ${t} `.includes(` ${phrase} `);

interface Name { phrase: string; target: string; exact: boolean }

/** Longest first, so "ursa minor" is found before anything shorter inside it. */
const byLength = (a: Name, b: Name) => b.phrase.length - a.phrase.length;
const phrase = (s: string) => plain(normalize(s.replace(/_/g, ' ')));

// ─── the names ────────────────────────────────────────────────────────────

/** Common names for stars (exact: the avatar knows them too) and the known
 *  mishearings of the rarer ones (not exact). The original biased the
 *  recogniser toward these; the API cannot, so the app maps what comes out. */
const STAR_ALIASES: [string, string, boolean][] = [
  ['north star', 'polaris', true], ['the pole star', 'polaris', true], ['pole star', 'polaris', true],
  ['dog star', 'sirius', true], ['demon star', 'algol', true], ['alpha centauri', 'rigil_kentaurus', true],
  ['rigel kentaurus', 'rigil_kentaurus', true], ['pleiades', 'alcyone', false], ['seven sisters', 'alcyone', false],
  ['beetle juice', 'betelgeuse', false], ['beetlejuice', 'betelgeuse', false], ['betelguese', 'betelgeuse', false],
  ['betelgeuze', 'betelgeuse', false], ['beetle geuse', 'betelgeuse', false], ['betel geuse', 'betelgeuse', false],
  ['betel juice', 'betelgeuse', false], ['arturus', 'arcturus', false], ['antaris', 'antares', false],
  ['aldebaron', 'aldebaran', false], ['fomalhout', 'fomalhaut', false], ['formalhaut', 'fomalhaut', false],
  ['foamalhaut', 'fomalhaut', false], ['denab', 'deneb', false], ['alt air', 'altair', false],
  ['spika', 'spica', false], ['capela', 'capella', false], ['procion', 'procyon', false],
  ['canopis', 'canopus', false], ['akernar', 'achernar', false], ['albiero', 'albireo', false],
  ['al nilam', 'alnilam', false], ['al nitak', 'alnitak', false], ['polux', 'pollux', false],
];

const STAR_NAMES: Name[] = [
  ...STARS.map((s) => ({ phrase: phrase(s.name), target: s.id, exact: true })),
  ...STAR_ALIASES.map(([p, target, exact]) => ({ phrase: phrase(p), target, exact })),
].sort(byLength);

/** "Sirius" is often heard as "serious"; only inside a command does it mean the star. */
const SERIOUS = /\b(?:where'?s|where is|show me|point out|point to|find|mark|which (?:one )?is|what about|how about|tell me about)\s+(?:the\s+)?serious\b/;

/** Names people use for the figures, beyond the catalogue's own aliases. */
const FIGURE_ALIASES: [string, string][] = [
  ['scorpio', 'Sco'], ['orion belt', 'Ori'], ['belt of orion', 'Ori'], ['great bear', 'UMa'], ['little bear', 'UMi'],
  ['the dipper', 'UMa'], ['the archer', 'Sgr'], ['the eagle', 'Aql'], ['great square', 'Peg'], ['the herdsman', 'Boo'],
  ['the centaur', 'Cen'], ['northern cross', 'Cyg'], ['big dog', 'CMa'], ['great dog', 'CMa'], ['the lyre', 'Lyr'],
  ['winged horse', 'Peg'],
];

const FIGURE_NAMES: Name[] = [
  ...Object.entries(CONSTELLATION_NAMES).map(([con, name]) => ({ phrase: phrase(name), target: con, exact: true })),
  ...Object.entries(CONSTELLATION_ALIASES).map(([alias, con]) => ({ phrase: phrase(alias), target: con, exact: true })),
  ...FIGURE_ALIASES.map(([alias, con]) => ({ phrase: phrase(alias), target: con, exact: true })),
].sort(byLength);

const PLACE_ALIASES: [string, string][] = [
  ['new york city', 'New York'], ['nyc', 'New York'], ['hongkong', 'Hong Kong'], ['capetown', 'Cape Town'],
  ['rio', 'Rio de Janeiro'], ['mexico city', 'Mexico City'], ['l a', 'Los Angeles'], ['reykjavík', 'Reykjavik'],
];

const PLACE_NAMES: Name[] = [
  ...PLACES.map((p) => ({ phrase: phrase(p.label), target: p.label, exact: true })),
  ...PLACE_ALIASES.map(([alias, label]) => ({ phrase: phrase(alias), target: label, exact: true })),
].sort(byLength);

/** The first name found in the text, and the text with it blanked out. */
function take(t: string, names: Name[]): { name: Name | null; rest: string } {
  for (const name of names) {
    if (has(t, name.phrase)) return { name, rest: ` ${t} `.replace(` ${name.phrase} `, ' · ').trim() };
  }
  return { name: null, rest: t };
}

export const PLANETS = /\b(mercury|venus|mars|jupiter|saturn|uranus|neptune|pluto|planets?|the moon|moon|the sun|sun)\b/;

// ─── time ─────────────────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, 'twenty four': 24, thirty: 30, forty: 40, fifty: 50,
};
const AMOUNT = String.raw`(\d+(?:\.\d+)?|half an?|an?|a couple of|a couple|a few|several|twenty four|${Object.keys(NUMBER_WORDS).join('|')})`;
// Hours and longer: "a few minutes ago I saw…" is a story, not a request.
// "Ago" is left out for the same reason; "two hours before dawn" is kept.
const UNIT = String.raw`(hours?|hrs?|h|days?|nights?|weeks?|months?|years?)`;
const FORWARD = String.raw`(later|from now|ahead|forward|forwards|on|after|into the future)`;
const BACKWARD = String.raw`(earlier|before|back|backwards|backward|in the past)`;

function amountOf(word: string): number {
  if (/^\d/.test(word)) return Number(word);
  if (/^half/.test(word)) return 0.5;
  if (word === 'a' || word === 'an') return 1;
  if (word.startsWith('a couple')) return 2;
  if (word === 'a few' || word === 'several') return 3;
  return NUMBER_WORDS[word] ?? NaN;
}

function hoursIn(unit: string): number {
  if (/^(h|hr|hour)/.test(unit)) return 1;
  if (/^(day|night)/.test(unit)) return 24;
  if (/^week/.test(unit)) return 168;
  if (/^month/.test(unit)) return 730.5;
  return 8766;   // a year
}

/** "two hours later", "back an hour", "in three days", "tomorrow". */
function shiftIn(t: string): number | null {
  let m = new RegExp(String.raw`\b${AMOUNT} ${UNIT} (?:${FORWARD}|${BACKWARD})\b`).exec(t);
  if (m) return amountOf(m[1]) * hoursIn(m[2]) * (m[3] ? 1 : -1);
  m = new RegExp(String.raw`\b(forward|forwards|ahead|on|back|backward|backwards)(?: by)? ${AMOUNT} ${UNIT}\b`).exec(t);
  if (m) return amountOf(m[2]) * hoursIn(m[3]) * (/^back/.test(m[1]) ? -1 : 1);
  m = new RegExp(String.raw`\bin ${AMOUNT} ${UNIT}\b`).exec(t);
  if (m) return amountOf(m[1]) * hoursIn(m[2]);
  if (/\b(tomorrow|the next night|next night)\b/.test(t)) return 24;
  if (/\byesterday\b/.test(t)) return -24;
  if (/\bnext week\b/.test(t)) return 168;
  if (/\blast week\b/.test(t)) return -168;
  if (/\bnext month\b/.test(t)) return 730.5;
  if (/\bnext year\b/.test(t)) return 8766;
  if (/^(?:(?:a )?(?:bit|little) )?later(?: on)?(?: please)?$|\ba (?:bit|little) later\b/.test(t)) return 1;
  if (/^(?:(?:a )?(?:bit|little) )?earlier(?: please)?$|\ba (?:bit|little) earlier\b/.test(t)) return -1;
  return null;
}

const HOUR_WORDS: Record<string, number> = { ...NUMBER_WORDS, noon: 12, midday: 12 };
const HOUR = String.raw`(\d{1,2}(?::\d{2})?|${['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'].join('|')})`;
const SUFFIX = String.raw`(am|pm|o'?clock|in the morning|in the afternoon|in the evening|at night|tonight)`;

/** "3 am", "10:30 pm", "nine in the evening", "half past two in the morning". */
function clockHourIn(t: string): number | null {
  const m = new RegExp(String.raw`\b(?:(half past|quarter past|quarter to) )?${HOUR} ?${SUFFIX}\b`).exec(t);
  if (!m) return null;
  const [hh, mm] = m[2].split(':');
  let hour = /^\d/.test(hh) ? Number(hh) : HOUR_WORDS[hh];
  let minutes = mm ? Number(mm) : 0;
  if (!(hour >= 0 && hour <= 23) || minutes > 59) return null;
  const suffix = m[3];
  if (hour === 12) {
    hour = suffix === 'pm' || suffix === 'in the afternoon' ? 12 : 0;   // "12 am", "12 tonight", "12 o'clock": midnight
  } else if (hour < 12) {
    // A bare "o'clock" in a night-sky app: 6 to 11 are the evening, 1 to 5 the small hours.
    const pm = suffix === 'pm' || suffix === 'in the afternoon' || suffix === 'in the evening' || suffix === 'tonight'
      || (suffix === 'at night' && hour >= 6) || (/o'?clock/.test(suffix) && hour >= 6);
    if (pm) hour += 12;
  }
  if (m[1] === 'half past') minutes = 30;
  if (m[1] === 'quarter past') minutes = 15;
  if (m[1] === 'quarter to') { minutes = 0; hour = (hour + 23) % 24; return hour + 0.75; }
  return hour + minutes / 60;
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH = MONTH_NAMES.join('|');

/** "in December", "December 21st", "the 3rd of March", "in winter". "May" and
 *  "March" are also words, so they count only after "in", "for" and the like,
 *  or with a day; seasons always need one ("the summer triangle" is a shape). */
function calendarIn(t: string): Intent | null {
  let m = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)? of (${MONTH})\b`).exec(t);
  if (m) return { kind: 'set_time', month: MONTH_NAMES.indexOf(m[2]) + 1, day: Number(m[1]) };
  m = new RegExp(String.raw`\b(${MONTH}) (\d{1,2})(?:st|nd|rd|th)?\b`).exec(t);
  if (m) return { kind: 'set_time', month: MONTH_NAMES.indexOf(m[1]) + 1, day: Number(m[2]) };
  m = new RegExp(String.raw`\b(?:in|for|during|show me|what about|how about|until|till|to) (?:early |mid |late )?(${MONTH})\b`).exec(t)
    ?? new RegExp(String.raw`\b(${MONTH_NAMES.filter((n) => n !== 'may' && n !== 'march').join('|')})\b`).exec(t);
  if (m) return { kind: 'set_time', month: MONTH_NAMES.indexOf(m[1]) + 1 };
  m = /\b(?:in|during|for|this|next|show me|what about|how about) (?:the )?(winter|spring|summer|autumn|fall)\b/.exec(t);
  if (m) return { kind: 'set_time', season: m[1] === 'fall' ? 'autumn' : (m[1] as 'winter' | 'spring' | 'summer' | 'autumn') };
  return null;
}

const TONIGHT = /\b(?:back to|go back to|return to|reset to|show me|take me to|switch to|jump to)\s+(?:tonight|this evening|the evening|now|the present|the start)\b|^(?:tonight|this evening)(?: please)?$|\breset the (?:clock|time)\b/;

/** The time moves in an utterance, in order (a clock or preset, then a shift). */
function timesIn(t: string): Intent[] {
  const out: Intent[] = [];
  if (/\bmidnight\b/.test(t)) out.push({ kind: 'set_time', preset: 'midnight' });
  else if (/\b(?:before dawn|dawn|daybreak|sunrise|first light)\b/.test(t)) out.push({ kind: 'set_time', preset: 'dawn' });
  else if (/\b(?:dusk|sunset|nightfall|twilight)\b/.test(t)) out.push({ kind: 'set_time', clockHour: 19 });
  else if (TONIGHT.test(t)) out.push({ kind: 'set_time', preset: 'tonight' });
  else {
    const hour = clockHourIn(t);
    if (hour !== null) out.push({ kind: 'set_time', clockHour: hour });
  }
  const calendar = calendarIn(t);
  if (calendar) out.push(calendar);
  const shift = shiftIn(t);
  if (shift !== null && Number.isFinite(shift)) out.push({ kind: 'set_time', shiftHours: Math.round(shift * 100) / 100 });
  return out;
}

// ─── place ────────────────────────────────────────────────────────────────

const NUM = String.raw`(-?\d+(?:\.\d+)?)`;
const signed = (n: string, minus?: string) => (minus ? -Math.abs(Number(n)) : Number(n));

/** Coordinates as people say them, or null. */
function coordinatesIn(t: string): { lat: number; lon: number } | null {
  // "40.7 north 74 west", "33.9 degrees south, 18.4 degrees east"
  let m = new RegExp(String.raw`${NUM} (?:degrees )?(north|south|n|s)\b,? (?:and |by )?${NUM} (?:degrees )?(east|west|e|w)\b`).exec(t);
  if (m) return { lat: Math.abs(Number(m[1])) * (m[2].startsWith('s') ? -1 : 1), lon: Math.abs(Number(m[3])) * (m[4].startsWith('w') ? -1 : 1) };
  // "latitude 40 longitude -74", "latitude minus 33.9, longitude 18.4"
  const lat = new RegExp(String.raw`\blatitude (?:of |is )?(minus |negative )?${NUM}(?: degrees)?(?: (north|south))?`).exec(t);
  const lon = new RegExp(String.raw`\blongitude (?:of |is )?(minus |negative )?${NUM}(?: degrees)?(?: (east|west))?`).exec(t);
  if (lat && lon) {
    return {
      lat: lat[3] ? Math.abs(Number(lat[2])) * (lat[3] === 'south' ? -1 : 1) : signed(lat[2], lat[1]),
      lon: lon[3] ? Math.abs(Number(lon[2])) * (lon[3] === 'west' ? -1 : 1) : signed(lon[2], lon[1]),
    };
  }
  // "coordinates 40.7, -74"
  m = new RegExp(String.raw`\bcoordinates? (minus )?${NUM},? (minus )?${NUM}`).exec(t);
  if (m) return { lat: signed(m[2], m[1]), lon: signed(m[4], m[3]) };
  return null;
}

/** Frames that only ever introduce a place: "the sky from X", "I'm in X". */
const PLACE_FRAME = /\b(?:(?:sky|stars|view|night) (?:from|over|above|in)|(?:what|how) about from|i'?m in|i am in|we'?re in|we are in|i live in|we live in|i'?m at|i am at|i'?m standing in|look(?:ing)? from|take (?:me|us) to|move (?:me |us )?to|fly (?:me |us )?to|travel to|change the place to|set the place to)\s+(.+)$/;
/** A bare "from X?" or "in X?" counts only for a capitalised name. */
const BARE_PLACE = /^(?:and |so |ok |okay |now )?(?:from|in)\s+(.+)$/;
/** Frames for a thing to show or find: "show me X", "where's X". */
const THING_FRAME = /\b(?:show me|show us|where'?s|where is|where are|point out|point to|point at|find|which (?:one )?is|mark|highlight|light up|draw|what about|how about|tell me about|look at|take me to|go to)\s+(.+)$/;

/** Words that never start a name: "show me the sky", "tell me about it". */
const NOT_A_NAME = /^(?:the )?(?:it|that|this|them|those|these|there|here|me|you|we|us|our|my|your|something|anything|everything|more|another|other|around|what|which|how|why|where|who|sky|skies|stars?|constellations?|chart|night|tonight|now|a star|a constellation|one|some|any|all|best|way|up|out|over|again|everything|january|february|march|april|may|june|july|august|september|october|november|december|winter|spring|summer|autumn|fall)\b/;

const TRAILING = /\s+(?:please|instead|right now|now|for me|for us|then|again|too|as well)$/;
/** Where a time phrase starts, the name has ended: "Kyoto at midnight". */
const TIME_TAIL = /(?:^|\s+)(?:(?:at|by|around|about|on|in|for|before|after)\s+)?(?:midnight|dawn|sunrise|sunset|dusk|tonight|tomorrow|yesterday|this evening|next \w+|\d.*|an? (?:hour|day|week)s?.*|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (?:hour|day|am|pm|o'?clock|in the).*)$/;

function targetOf(rest: string): string {
  let target = rest.replace(/^(?:the|a|an) /, '').replace(/[?!.,]+$/, '').trim();
  target = target.replace(TIME_TAIL, '').trim();
  for (let i = 0; i < 3; i++) target = target.replace(TRAILING, '').trim();
  return target;
}

/** Was this word capitalised where it was said? Recognisers capitalise proper
 *  nouns, so "Zorblax" is a name worth refusing and "the best place" is not. */
function capitalised(raw: string, word: string): boolean {
  const first = word.split(' ')[0];
  return raw.split(/[^\p{L}\p{N}']+/u).some((w, i) => i > 0 && w.toLowerCase() === first && /^\p{Lu}/u.test(w));
}

// ─── clearing ─────────────────────────────────────────────────────────────

function clearsIn(t: string): Intent[] | null {
  if (/^(?:unmark|deselect)(?: it| that| the star)?(?: please)?$/.test(t)) return [{ kind: 'clear_selection' }];
  if (/^(?:clear|clear it|clear that|clear the chart|reset|reset the chart|start over|clear everything|clear all)(?: please)?$/.test(t) || /\bclear (?:everything|it all|the chart)\b/.test(t)) {
    return /\b(everything|all|chart|reset|start over)\b/.test(t) ? [{ kind: 'clear_selection' }, { kind: 'clear_figure' }] : [{ kind: 'clear_selection' }];
  }
  const m = /\b(?:clear|remove|hide|turn off|switch off|unmark|deselect|get rid of)\b(?: the)? (selection|marker|mark|star|figure|constellation|lines|shape|outline|drawing)\b/.exec(t);
  if (m) return /figure|constellation|lines|shape|outline|drawing/.test(m[1]) ? [{ kind: 'clear_figure' }] : [{ kind: 'clear_selection' }];
  return null;
}

// ─── the judge ────────────────────────────────────────────────────────────

/**
 * What the utterance asks of the chart, or null when it asks nothing of it.
 * `here` is the chart's longitude, for "the sky from the equator".
 */
export function parse(raw: string, here: { lon: number } = { lon: 0 }): Parsed | null {
  const t = normalize(raw);
  if (!t) return null;
  const clears = clearsIn(t);
  if (clears) return { intents: clears, exact: true };

  const intents: Intent[] = [];
  let exact = true;
  let rest = plain(t);

  // Place: coordinates, the special latitudes, a city, or an unknown one in a place frame.
  const coords = coordinatesIn(t);
  let unresolvedPlace: string | null = null;
  if (coords) intents.push({ kind: 'set_place', lat: coords.lat, lon: coords.lon });
  else if (/\b(?:the )?equator\b/.test(t)) intents.push({ kind: 'set_place', lat: 0, lon: here.lon });
  else if (/\bnorth pole\b/.test(t)) intents.push({ kind: 'set_place', lat: 90, lon: here.lon });
  else if (/\bsouth pole\b/.test(t)) intents.push({ kind: 'set_place', lat: -90, lon: here.lon });
  else {
    const found = take(rest, PLACE_NAMES);
    if (found.name) {
      intents.push({ kind: 'set_place', label: found.name.target });
      rest = found.rest;
    } else {
      const strong = PLACE_FRAME.exec(plain(t));
      const bare = strong ? null : BARE_PLACE.exec(plain(t));
      const target = targetOf((strong ?? bare)?.[1] ?? '');
      if (target && !NOT_A_NAME.test(target) && !PLANETS.test(target) && target.split(' ').length <= 3
        && !take(target, FIGURE_NAMES).name && !take(target, STAR_NAMES).name && !timesIn(target).length
        && (strong || capitalised(raw, target))) unresolvedPlace = target;
    }
  }

  intents.push(...timesIn(t));

  const figure = take(rest, FIGURE_NAMES);
  if (figure.name) {
    intents.push({ kind: 'show_constellation', name: CONSTELLATION_NAMES[figure.name.target] });
    rest = figure.rest;
  }

  const star = take(rest, STAR_NAMES);
  if (star.name) {
    intents.push({ kind: 'select', star: star.name.target });
    exact &&= star.name.exact;
  } else if (SERIOUS.test(t)) {
    intents.push({ kind: 'select', star: 'sirius' });
    exact = false;
  } else if (/\b(?:that|the|this) (?:very )?bright(?:est)? (?:one|star)\b|\bbrightest\b/.test(t)) {
    intents.push({ kind: 'select', star: 'brightest' });
  }

  if (unresolvedPlace) {
    const fallback: Intent = { kind: 'set_place', label: unresolvedPlace.replace(/\b\w/g, (c) => c.toUpperCase()) };
    return { intents, exact, unresolved: { target: unresolvedPlace, frame: 'place', fallback } };
  }
  if (intents.length) return { intents, exact };

  // Nothing known was named. A command frame around a capitalised name is a
  // request for something the catalogue does not have: refuse it by name,
  // rather than let the avatar answer it from memory.
  if (PLANETS.test(t)) return null;
  const m = THING_FRAME.exec(t);
  const target = m ? plain(targetOf(m[1])) : '';
  if (!target || NOT_A_NAME.test(target) || target.split(' ').length > 3 || !capitalised(raw, target)) return null;
  const name = raw.split(/[^\p{L}\p{N}']+/u).filter((w) => target.split(' ').includes(w.toLowerCase().replace(/'s$/, ''))).join(' ') || target;
  return { intents: [], exact: false, unresolved: { target, frame: 'thing', fallback: { kind: 'select', star: name } } };
}

// ─── the model, when the rules cannot ─────────────────────────────────────

/** What the server asks a model for (Gemini's responseSchema subset). */
export const INTERPRET_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', description: 'none | place | coordinates | time | star | constellation' },
    place: { type: 'string', description: 'A city name exactly as listed, or the name the user said; empty if none.' },
    latitude: { type: 'number', description: 'Only if the user said coordinates; north positive.' },
    longitude: { type: 'number', description: 'Only if the user said coordinates; east positive.' },
    preset: { type: 'string', description: 'tonight | midnight | dawn, or empty.' },
    hoursFromNow: { type: 'number', description: 'A relative clock move in hours (negative is earlier), or 0.' },
    date: { type: 'string', description: 'YYYY-MM-DD if the user named a date or a month, else empty.' },
    star: { type: 'string', description: 'A star name exactly as listed, or the name the user said; empty if none.' },
    constellation: { type: 'string', description: 'A constellation name exactly as listed, or the name the user said; empty if none.' },
  },
  required: ['action'],
};

export interface Interpretation {
  action: string; place?: string; latitude?: number; longitude?: number; preset?: string;
  hoursFromNow?: number; date?: string; star?: string; constellation?: string;
}

export function interpretPrompt(utterance: string, today: string): string {
  return `Someone looking at a star chart said: "${utterance}"
Speech recognition may have misheard star names. Map it onto the chart's own vocabulary, or "none" if it asks nothing of the chart (a question, small talk, the Moon, the Sun or a planet).
Stars: ${STARS.map((s) => s.name).join(', ')}.
Constellations: ${Object.values(CONSTELLATION_NAMES).join(', ')}; also the Plough, the Big Dipper, the Little Dipper, the Southern Cross, the Teapot.
Cities: ${PLACES.map((p) => p.label).join(', ')}.
Times: tonight, midnight, dawn, or a number of hours from now, or a date (today is ${today}).
Never look up coordinates for a place: give coordinates only if the user said numbers. If they name a city that is not listed, put its name in "place" anyway.`;
}

/** The model's answer as intents (the chart still validates every one). */
export function fromModel(r: Interpretation | null | undefined): Intent[] {
  if (!r || !r.action || r.action === 'none') return [];
  const out: Intent[] = [];
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  if (Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && r.action === 'coordinates') out.push({ kind: 'set_place', lat: r.latitude, lon: r.longitude });
  else if (text(r.place)) out.push({ kind: 'set_place', label: text(r.place) });
  if (['tonight', 'midnight', 'dawn'].includes(text(r.preset))) out.push({ kind: 'set_time', preset: text(r.preset) });
  else if (/^\d{4}-\d{2}-\d{2}$/.test(text(r.date))) out.push({ kind: 'set_time', date: text(r.date) });
  if (Number.isFinite(r.hoursFromNow) && r.hoursFromNow) out.push({ kind: 'set_time', shiftHours: r.hoursFromNow });
  if (text(r.constellation)) out.push({ kind: 'show_constellation', name: text(r.constellation) });
  if (text(r.star)) out.push({ kind: 'select', star: text(r.star) });
  return out;
}
