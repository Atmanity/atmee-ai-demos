// What the guide is told, and when. The app runs the board; the guide talks.
// NOTES are the standing rules (condensed from the original INSTRUCTIONS),
// boardState() is everything on the screen plus what is ready to show, and
// `say` holds the event texts: the original tool cues, now sent as events.
import type { ActionKind, Headline, Snapshot, Source, Spot } from './types.ts';

/** Standing rules, sent once as notes (each at most 2,000 characters). */
export const NOTES = [
  `You are a travel companion on a live video call. The screen beside you is a travel board: a map, the latest local headlines, a few dishes, and what is worth seeing near the user. Make travel feel inviting rather than intimidating, like a well-travelled friend sitting beside them while they figure it out. Talk about travel as atmosphere and rhythm: food, weather, neighbourhoods, trains, cafés, long walks, little side streets, ferry rides. At most one question per turn, and usually one or two short sentences. You are speaking aloud: no lists, no markdown, no emoji, and no colons. Never mention tools, models, apps or how the board works. You cannot see where the user is and must never claim to; you only know what they tell you. Warm is welcome; sexual content is not: decline kindly and steer back to travel or football.`,
  `The app runs the board, not you. You never put a country on the map, pull headlines, choose dishes or nearby spots, or move between spots yourself. When the user asks for one of those, say a few words like "let me pull that up" and stop: the app does it and tells you a moment later. If it has already told you, carry on from it. The board state lists what is on the screen and what is ready to show: use exactly those, only when the user asks, and never invent headlines, dishes, spots or distances. Headlines are the newest the source has and may be days old: never call them today's or fresh, and never put a date on them. Planning a trip: if they name only a continent, ask which country there draws them, or offer to choose one. If they want you to choose, name exactly one country plainly, like "Let's go to Portugal", and the app puts it on the map. Every country they look at stays on the trip strip, so nothing is lost when they move on; they can go back to any of them. What is around them: ask which town, neighbourhood or station they are near. One spot shows at a time; they can ask for the next one or the one before, and you never guess which comes next.`,
];

/** The limit on `state`. */
export const STATE_LIMIT = 3858;

const an = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);
const listOf = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const nextOffer = (newsAvailable: boolean) => (newsAvailable ? 'the latest local headlines' : 'to talk about what to eat there');
const headlineList = (hs: Headline[]) => hs.map((h, i) => `(${i + 1}) ${clip(h.title, 140)}`).join(' ');
const spotLine = (s: Spot) => `${s.name}, ${an(s.category)}, ${s.distance || 'nearby'}`;

/** The live board, as the guide's state: what is on screen, and what is ready to show when asked. */
export function boardState(s: Snapshot): string {
  const parts: string[] = ['Travel board, live.'];
  parts.push(s.travelerName ? `The traveller is called ${s.travelerName}; use it sparingly.` : 'You do not know their name yet.');

  if (s.stage === 'around') {
    const v = s.spot;
    if (!v) parts.push('The board is on "around me" and asks where they are: they have not said yet. Ask which town, neighbourhood or station they are near.');
    else if (v.lookupFailed) parts.push(`They are around ${v.place}, but the places service is not answering right now.`);
    else if (!v.spot) parts.push(`They are around ${v.place}, but nothing stands out right next to them.`);
    else {
      parts.push(`Around ${v.place}, spot ${v.index + 1} of ${v.total} is on screen: ${spotLine(v.spot)}.`);
      if (v.spot.summary) parts.push(`About it: ${clip(v.spot.summary, 300)}`);
      parts.push(v.index + 1 < v.total ? 'They can ask for the next one; never say which it is, the app tells you.' : 'It is the last one nearby.');
      if (v.index > 0) parts.push('They can also go back to the one before.');
    }
    if (s.map) parts.push(`Earlier they planned a trip to ${s.map.country}; it is still on the trip strip.`);
  } else if (!s.map) {
    parts.push('The board is on its welcome screen: no country on the map yet.');
    if (s.continent) parts.push(`They are drawn to ${s.continent} but have not picked a country.`);
  } else {
    const country = s.map.country;
    parts.push(`On the map: ${country}${s.map.city ? `. They mentioned ${s.map.city}` : ''}.`);

    const news = s.news;
    if (!s.newsAvailable) parts.push('No news source is set up: if they ask for local news, say you cannot pull it right now and offer the food instead.');
    else if (!news || news.loading) parts.push(`The latest headlines for ${country} are still loading.`);
    else if (!news.headlines.length) parts.push(`No headlines came back for ${country}: if they ask about the news, say you could not pull the local news and offer to talk about the food.`);
    else if (news.shown) parts.push(`On screen, the newest headlines the source has for ${country} (they may be days old, never call them today's): ${headlineList(news.headlines)}`);
    else parts.push(`Ready but not on screen yet, the newest headlines the source has for ${country} (they may be days old, never call them today's): ${headlineList(news.headlines)} Only if they ask about the news, tell them about these in your own words.`);

    const food = s.food;
    const dishes = (food?.dishes ?? []).map((d) => (d.description ? `${d.name} (${clip(d.description, 150)})` : d.name)).join('; ');
    if (!food || food.loading) parts.push(`Dish ideas for ${country} are still loading.`);
    else if (!food.dishes.length) parts.push(`No dish ideas are ready for ${country}; if asked about food, talk about it from what you know, in a sentence.`);
    else if (food.shown) parts.push(`On screen, dishes from ${country}: ${dishes}.`);
    else parts.push(`Ready but not on screen yet, dishes to recommend in ${country}: ${dishes}. Only if they ask what to eat, recommend these in your own words.`);
  }

  const stops = s.trip.visited.map((t) => (t.city ? `${t.country} (${t.city})` : t.country));
  if (stops.length >= 2) parts.push(`Their trip so far: ${listOf(stops.slice(-12))}. They can go back to any of them; nothing is lost.`);
  if (s.awaitingPick) parts.push('They asked you to choose a country: name exactly one, plainly, and the app puts it on the map.');

  let text = parts.join(' ');
  // The worst case (five long headlines, three long dishes, a long trip) is
  // kept under the limit by the clips above; this is the backstop.
  if (text.length > STATE_LIMIT) text = `${text.slice(0, STATE_LIMIT - 1)}…`;
  return text;
}

/** The event texts: one per outcome, written as an instruction about a fact. */
export const say = {
  opening(s: Snapshot) {
    const who = s.travelerName ? ` Greet ${s.travelerName} by name in a few words.` : ' In one short line, ask what they would like to be called.';
    if (s.stage === 'around' && s.spot?.spot) return `You are now the user's travel companion, and the travel board beside you is open.${who} They are looking around ${s.spot.place}, and ${s.spot.spot.name} is on screen: mention it in one short sentence.`;
    if (s.map) return `You are now the user's travel companion, and the travel board beside you is open.${who} They have already put ${s.map.country} on the map: say one warm, specific sentence about it and ask what they would like to explore there.`;
    return `You are now the user's travel companion, and the travel board beside you is open.${who} Then ask whether they want to dream up a trip, or hear what is worth seeing near where they are right now.`;
  },
  named: (name: string) => `They would like to be called ${name}. Use it sparingly, not every line.`,
  noName: () => 'No name given. Do not ask again; just carry on warmly.',
  continentOnly: (continent: string) => `They are drawn to ${continent} but have not picked a country. Ask which country there calls to them, or offer to choose one.`,
  noDestination: () => 'No destination yet. Ask which part of the world they are dreaming about, or offer to pick somewhere.',
  notFound: (place: string) => `Could not place ${place} on the map. Ask them to confirm the name or suggest somewhere nearby.`,
  destination(country: string, { city = '', newsAvailable = false, how = 'user' }: { city?: string; newsAvailable?: boolean; how?: 'user' | 'picked' | 'avatar' } = {}) {
    if (how === 'picked') return `They asked you to choose, and ${country} is your pick: it is on the map now. Present it as your own choice in one warm, specific sentence, then offer ${nextOffer(newsAvailable)}.`;
    if (how === 'avatar') return `${country}, the country you just chose for them, is on the map now. Do not introduce it again; say in a few words that it is up, then offer ${nextOffer(newsAvailable)}.`;
    const cityHint = city ? ` They mentioned ${city}.` : ' You can ask which city excites them, or offer to pick one.';
    return `${country} is on the map now.${cityHint} Say one warm, specific sentence about the country, then offer ${nextOffer(newsAvailable)}.`;
  },
  noCountryForNews: () => 'No country is chosen yet. Ask where they want to go before pulling up the news.',
  news: (country: string, headlines: Headline[]) => `${headlines.length} headline${headlines.length === 1 ? ' is' : 's are'} on screen from ${country}. The top one is about ${clip(headlines[0].title, 160)}. Mention it in one short sentence, then offer to recommend some local food.`,
  noNews: (country: string) => `No headlines came back for ${country}. Say briefly that you could not pull the local news, and offer to talk about the food.`,
  noCountryForFood: () => 'No country is chosen yet. Ask where they are dreaming of first.',
  food: (country: string, names: string[]) => `Local dishes for ${country} are on screen: ${listOf(names)}. Say something mouth-watering about one of them in a short sentence.`,
  noFood: (country: string) => `No dish ideas came back for ${country}. Talk about its food from what you know, in one short sentence.`,
  revisited: (country: string, dishes: string[]) => `${country} is back on the map, exactly as they left it${dishes.length ? `, with ${listOf(dishes)} still there` : ''}. Say one warm sentence welcoming them back to it.`,
  alreadyHere: (country: string) => `They are already looking at ${country}. Say so lightly.`,
  notOnTrip: (places: string[]) => `That is not on the trip yet. So far it has been ${listOf(places)}. Offer one of those, or to look somewhere new.`,
  nothingToGoBack: () => 'Nowhere has been looked at yet, so there is nothing to go back to. Ask where they are dreaming of.',
  askPlace: () => 'Ask them which town or neighbourhood they are in.',
  countryNotTown: (country: string) => `${country} is a whole country. Ask which town, neighbourhood or station there they are near.`,
  placeNotFound: (place: string) => `Could not find ${place} on the map. Ask them to name the town or the nearest city instead.`,
  lookupDown: (place: string) => `You can see they are around ${place}, but the places service is not answering right now. Say so plainly, and offer to try again or plan a trip instead.`,
  quiet: (place: string) => `They are around ${place}, but nothing stands out right next to them. Say so kindly and offer to plan a trip somewhere instead.`,
  firstSpot: (place: string, spot: Spot) => `They are around ${place}. Start with ${spotLine(spot)}.${spot.summary ? ` About it: ${clip(spot.summary, 240)}` : ''} Say it in one short sentence and mention they can tap it to open it in maps, or ask for the next spot.`,
  anotherSpot: (spot: Spot) => `Offer another one: ${spotLine(spot)}.${spot.summary ? ` About it: ${clip(spot.summary, 240)}` : ''} Say it in one short sentence and mention they can tap it to open it in maps, or ask for the next spot.`,
  lastSpot: () => 'That was the last standout spot nearby. Say so and offer to plan a trip somewhere instead.',
  firstAlready: (place: string) => `That is already the first spot near ${place}. Say so and offer the next one instead.`,
  nothingQueued: (place: string) => `There is nothing queued near ${place}. Offer to look again, or to plan a trip instead.`,
  askWhereToLook: () => 'Ask which town or neighbourhood they are in, and you will look around it.',
  notLookedYet: () => 'Nothing has been looked up nearby yet. Ask which town they are in.',
  nothingToShow: () => 'Nothing to show. Offer to look somewhere else.',
  noCountryThere: () => 'There is no country right where they tapped the map. Ask them to tap on land, or to name a country.',
  badCoordinates: () => 'Their location could not be read. Ask which town or neighbourhood they are in instead.',
  showPlanning: (country: string) => (country
    ? `They switched the board back to planning, with ${country} on the map. Carry on from there in one short line.`
    : 'They want to plan a trip. Ask which part of the world they are dreaming about, or offer to pick somewhere.'),
  showAround: (place: string, spot: Spot | null) => (spot
    ? `They switched the board back to what is around ${place}, with ${spot.name} on screen. Carry on from there in one short line.`
    : 'They want to see what is near them. Ask which town, neighbourhood or station they are near; they can also share their location or tap the map.'),
};

/** What the guide already answered from its state when it heard the request: telling it again would repeat it. */
const STAGED: ActionKind[] = ['food', 'name', 'continent', 'show', 'pick'];
/**
 * Spoken requests the guide may already have reacted to ("Portugal, lovely!") before the map moved.
 * News is here although its answer is staged: asked "any news from there?", the guide said "let me
 * pull that up for you right now!" live and ignored the staged "no news source", so the outcome is
 * always told.
 */
const REACTED: ActionKind[] = ['destination', 'search', 'revisit', 'destinationAt', 'news'];

/**
 * The event for an outcome, or null when the guide needs no telling.
 * - spoken: the guide heard it and is already answering, from the state; it
 *   needs the outcomes it could not know (the map moved, the next spot), and
 *   not the ones it already had (staged headlines and dishes).
 * - typed: the line was handled by the app and never reached the guide, so
 *   the event carries it ("what's it like in May?" deserves an answer too).
 * - button / avatar: the guide cannot see the board; tell it.
 */
export function eventFor(kind: ActionKind, cue: string, from: Source, said = ''): string | null {
  if (!cue) return null;
  if (from === 'spoken') {
    if (STAGED.includes(kind)) return null;
    if (REACTED.includes(kind)) return `You may already have answered them; do not repeat yourself. ${cue}`;
    return cue;
  }
  if (from === 'typed') return `They typed: "${clip(said, 300)}". ${cue} If their message also asked something else, answer that too.`;
  return cue;
}

/** How long an event stays worth saying. A spot goes stale as soon as they tap again. */
export function ttlFor(kind: ActionKind): number {
  if (['next', 'previous', 'goto', 'around', 'coords'].includes(kind)) return 20;
  if (['destination', 'search', 'revisit', 'destinationAt', 'pick'].includes(kind)) return 45;
  return 30;
}
