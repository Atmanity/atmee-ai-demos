// The things the board can actually do, once. A button and the host's tool
// call both end up here (through engine/tools.ts), so they take exactly the
// same path.
//
// Every operation changes the state first and returns the line the host
// should base its next words on: an `await` tool's result, or the outcome of
// a button press told to the host as an event.
//
// The lookups are injected (server.ts passes the real ones from geo.ts), which
// is what keeps all of this testable with no network.
import { canonicalCountry, countriesIn, isCountryName, norm, pickCountry } from './countries.ts';
import { say } from './director.ts';
import { cleanText, distancePhrase, haversineM, mapsUrl, type GeoCountry, type GeoPlace, type RawSpot, type WikiSummary } from './geo.ts';
import { isAName } from './judge.ts';
import { countryOutline, MAX_SILHOUETTE_BYTES, primaryBbox } from './rings.ts';
import { spotOf, type QueuedSpot, type TravelState, type TripEntry } from './state.ts';
import type { Action, Headline } from './types.ts';

/** A dish the app may suggest; `wiki` names the Wikipedia article when the name alone would miss it. */
export interface DishIdea { name: string; description: string; wiki?: string }

export interface Lookups {
  country(name: string): Promise<GeoCountry | null>;
  place(query: string): Promise<GeoPlace | null>;
  reverse(lat: number, lon: number): Promise<GeoPlace | null>;
  nearby(lat: number, lon: number): Promise<RawSpot[] | null>;
  summary(title: string): Promise<WikiSummary | null>;
  headlines(isoCode: string): Promise<Headline[]>;
  dishes(country: string): Promise<DishIdea[]>;
}

const strip = (text: string) => text.replace(/^[\s.,!?;:]+|[\s.,!?;:]+$/g, '');
const clean = (value: unknown, limit: number) => strip(cleanText(value, limit));

/** A Wikipedia article about a spot must be about THAT spot: "Central Station" finds the generic article, miles away or nowhere. */
const SAME_PLACE_M = 5000;

// ─── the traveller ────────────────────────────────────────────────────────

export function rememberTraveler(state: TravelState, name: string): string {
  const cleaned = clean(name, 60);
  state.travelerName = isAName(cleaned) ? cleaned : '';
  state.bump();
  return state.travelerName ? say.named(state.travelerName) : say.noName();
}

// ─── planning a trip ──────────────────────────────────────────────────────

/**
 * Resolve a country, put it on the map, and start fetching its headlines and
 * dishes in the background. A continent alone is not a destination (it has no
 * bounding box worth drawing), so that case asks to narrow down instead of
 * drawing a map of half the planet.
 */
export async function chooseDestination(
  state: TravelState, lookups: Lookups, country: string,
  { city = '', continent = '', how = 'user', ticket = ++state.destinationTicket }: { city?: string; continent?: string; how?: 'user' | 'picked'; ticket?: number } = {},
): Promise<string> {
  country = clean(country, 80);
  city = clean(city, 80);
  continent = clean(continent, 60);

  if (!country) {
    if (continent && continent !== state.continent) {
      state.continent = continent;
      state.bump();
    }
    return state.continent ? say.continentOnly(state.continent) : say.noDestination();
  }

  const resolved = await lookups.country(country);
  if (ticket !== state.destinationTicket) return say.overtaken(country);
  if (!resolved) return say.notFound(country);

  // Fit the map to the main landmass, not to everything the country
  // administers (see rings.mainlandRings). The raw boundary is megabytes; only
  // the reduced outline and silhouette are kept.
  state.setDestination({
    country: resolved.country,
    isoCode: resolved.isoCode,
    center: resolved.center,
    bbox: primaryBbox(resolved.geojson, resolved.bbox),
    outline: countryOutline(resolved.geojson),
    silhouette: countryOutline(resolved.geojson, MAX_SILHOUETTE_BYTES),
  }, { city, continent });
  state.bump();
  prepareDetail(state, lookups, state.here!);
  console.info('[Travel] destination %s (%s) outline=%s', state.country, state.isoCode || '??', Boolean(state.here?.outline));
  return say.destination(state.country, { city, newsAvailable: state.newsAvailable, how });
}

/** The destination box and "how about Bali": a country, "Kyoto, Japan", or a place whose country we look up. */
export async function searchDestination(state: TravelState, lookups: Lookups, query: string): Promise<string> {
  const q = clean(query, 120);
  if (!q) return say.noDestination();
  const ticket = ++state.destinationTicket;
  const named = countriesIn(q);
  if (named.length) {
    const city = q.split(',').map((part) => part.trim()).find((part) => part && !countriesIn(part).length) ?? '';
    return chooseDestination(state, lookups, named[0], { city, ticket });
  }
  const located = await lookups.place(q);
  if (ticket !== state.destinationTicket) return say.overtaken(q);
  if (!located?.country) return say.notFound(q);
  return chooseDestination(state, lookups, located.country, { city: norm(located.place) === norm(located.country) ? '' : located.place, ticket });
}

/** "Plan a trip here" on the map: the country under the tap, and the town as the city. */
export async function destinationAt(state: TravelState, lookups: Lookups, lat: number, lon: number): Promise<string> {
  if (!validCoordinates(lat, lon)) return say.badCoordinates();
  const ticket = ++state.destinationTicket;
  const located = await lookups.reverse(lat, lon);
  if (ticket !== state.destinationTicket) return say.overtaken('the place they tapped');
  if (!located?.country) return say.noCountryThere();
  return chooseDestination(state, lookups, located.country, { city: norm(located.place) === norm(located.country) ? '' : located.place, ticket });
}

/** "Surprise me": the app picks within their continent, somewhere not yet on the trip. */
export async function pickForThem(state: TravelState, lookups: Lookups, random: () => number = Math.random): Promise<string> {
  const country = pickCountry(state.continent, state.visited.map((e) => e.country), random);
  return chooseDestination(state, lookups, country, { how: 'picked' });
}

/** Drop nameless dishes, clip the words, keep three. A dish with no photo is still a dish worth eating. */
export function cleanDishes(ideas: unknown): TripEntry['dishes'] {
  if (!Array.isArray(ideas)) return [];
  return ideas
    .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
    .map((d) => ({ name: cleanText(d.name, 80), description: cleanText(d.description, 160), imageUrl: null, ...(d.wiki ? { wiki: cleanText(d.wiki, 120) } : {}) }))
    .filter((d) => d.name)
    .slice(0, 3);
}

/**
 * Fetch a country's headlines and dishes (then the dishes' photos) in the
 * background, into ITS trip entry: if the user has moved on by the time they
 * land, they wait on that country's chip rather than landing on the new one.
 * Staged for the guide at once; shown on the board when asked for.
 */
export function prepareDetail(state: TravelState, lookups: Lookups, entry: TripEntry): void {
  if (state.detail.has(entry.country)) return;
  const done = () => state.bump();
  entry.headlinesLoading = state.newsAvailable && Boolean(entry.isoCode);
  entry.dishesLoading = true;
  const news = entry.headlinesLoading
    ? lookups.headlines(entry.isoCode).then((h) => { entry.headlines = h; }, () => undefined).finally(() => { entry.headlinesLoading = false; done(); })
    : Promise.resolve();
  const dishes = lookups.dishes(entry.country)
    .then((ideas) => { entry.dishes = cleanDishes(ideas); }, () => undefined)
    .finally(() => { entry.dishesLoading = false; entry.photosLoading = entry.dishes.length > 0; done(); });
  // Names first: the user reads them while the pictures arrive.
  const photos = dishes.then(async () => {
    await Promise.all(entry.dishes.map(async (dish) => {
      const found = await lookups.summary(dish.wiki || dish.name).catch(() => null);
      if (!found) return;
      dish.imageUrl = found.image;
      if (!dish.description && found.extract) dish.description = cleanText(found.extract, 160);
    }));
  }).finally(() => { entry.photosLoading = false; done(); });
  state.detail.set(entry.country, { news, dishes, photos });
}

/**
 * Put the latest headlines on the board, or an honest shrug. Deliberately
 * not "today's": no date filter is sent, so they are the newest five whatever
 * their age, and promising a freshness nobody checked is a claim with nothing
 * behind it.
 */
export async function showHeadlines(state: TravelState): Promise<string> {
  const entry = state.here;
  if (!entry) return say.noCountryForNews();
  await state.detail.get(entry.country)?.news;
  // They moved on while the headlines loaded: they were never on screen, and the host must not say they are.
  if (state.here !== entry) return say.overtaken(`${entry.country}'s headlines`);
  entry.headlinesShown = true;
  state.bump();
  if (!entry.headlines.length) return say.noNews(entry.country);
  console.info('[Travel] %d headlines for %s', entry.headlines.length, entry.isoCode);
  return say.news(entry.country, entry.headlines);
}

/** Put the dishes on the board (names at once; their photos follow). */
export async function showDishes(state: TravelState): Promise<string> {
  const entry = state.here;
  if (!entry) return say.noCountryForFood();
  await state.detail.get(entry.country)?.dishes;
  if (state.here !== entry) return say.overtaken(`${entry.country}'s dishes`);
  entry.dishesShown = true;
  state.bump();
  if (!entry.dishes.length) return say.noFood(entry.country);
  return say.food(entry.country, entry.dishes);
}

/**
 * Go back to a country already on the trip, with nothing re-fetched: the map,
 * the dishes and the headlines are all still in its entry.
 *
 * A country that is NOT on the trip is somewhere new, and goes on the map.
 * Found by playing the original: "now show me Italy" over a Japan board was
 * read as a return trip, the guide said "you're already looking at Japan", and
 * the map never moved.
 */
export async function revisitCountry(state: TravelState, lookups: Lookups, country: string): Promise<string> {
  const wanted = clean(country, 80);
  // Going back is a choice of destination too: a lookup still running for an earlier one must not undo it.
  const ticket = ++state.destinationTicket;
  if (!state.revisit(wanted)) {
    if (wanted && norm(wanted) === norm(state.country)) return say.alreadyHere(state.country);
    if (wanted) return chooseDestination(state, lookups, wanted, { ticket });
    if (!state.visited.length) return say.nothingToGoBack();
    return say.notOnTrip(state.visited.map((e) => e.country));
  }
  state.bump();
  console.info('[Travel] revisited %s', state.country);
  const here = state.here!;
  return say.revisited(state.country, here.dishesShown ? here.dishes.map((d) => d.name) : []);
}

// ─── what is around them ──────────────────────────────────────────────────

/** Coordinates the nearby-spots flow can use. */
export function validCoordinates(lat: unknown, lon: unknown): boolean {
  return typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/** What is worth seeing near a place the traveller NAMED ("Lisbon", "near Shibuya station"). */
export async function explorePlace(state: TravelState, lookups: Lookups, place: string): Promise<string> {
  const query = clean(place, 120);
  if (!query) return say.askPlace();
  if (isCountryName(query)) return say.countryNotTown(canonicalCountry(query));
  const ticket = ++state.exploreTicket;
  const located = await lookups.place(query);
  if (ticket !== state.exploreTicket) return say.overtaken(query);
  if (!located) return say.placeNotFound(query);
  return loadSpots(state, lookups, ticket, located.place, located.lat, located.lon);
}

/** The same from coordinates: "use my location", or "what's around here" on the map. */
export async function exploreCoordinates(state: TravelState, lookups: Lookups, lat: number, lon: number): Promise<string> {
  if (!validCoordinates(lat, lon)) return say.badCoordinates();
  const ticket = ++state.exploreTicket;
  const located = await lookups.reverse(lat, lon);
  return loadSpots(state, lookups, ticket, located?.place || 'your area', lat, lon);
}

/**
 * Replace the sights and describe the first, inside the same lock as next and
 * previous: a Next pressed while the first is still being described waits its
 * turn instead of moving the queue under it. The lookup runs outside the
 * lock; the first sight is described on a copy, off the board, and the queue
 * is published only if no later explore overtook this one during either wait.
 */
async function loadSpots(state: TravelState, lookups: Lookups, ticket: number, place: string, lat: number, lon: number): Promise<string> {
  const spots = await lookups.nearby(lat, lon);
  return state.spotTurn.run(async () => {
    if (ticket !== state.exploreTicket) return say.overtaken(place);
    const queue: QueuedSpot[] = (spots ?? []).map((s) => ({ ...s }));
    if (queue.length) await describeSpot(queue[0], [lat, lon], lookups);
    if (ticket !== state.exploreTicket) return say.overtaken(place);
    state.setSpots(place, [lat, lon], spots === null ? null : queue);
    state.bump();
    if (spots === null) return say.lookupDown(place);
    if (!queue.length) return say.quiet(place);
    console.info('[Travel] spot 1/%d near %s photo=%s', queue.length, place, Boolean(queue[0].imageUrl));
    return say.firstSpot(place, spotOf(queue[0]), queue.length);
  });
}

/**
 * `from` is the sight the safety net saw when the user asked: checked when
 * this move's turn comes (inside the lock), since a move queued behind the
 * host's own would otherwise pass the check and then move again.
 */
function movedSince(state: TravelState, from: number | undefined): string | null {
  if (from === undefined || !state.spots.length || from === state.spotIndex) return null;
  return say.alreadyMoved(state.spotIndex + 1, state.spots.length, state.spot!.name);
}

/** The next spot, from a button or "another one". Serialized: see TravelState.spotTurn. */
export function nextSpot(state: TravelState, lookups: Lookups, from?: number): Promise<string> {
  return state.spotTurn.run(async () => {
    const moved = movedSince(state, from);
    if (moved) return moved;
    if (!state.spots.length) return state.aroundPlace ? say.nothingQueued(state.aroundPlace) : say.askWhereToLook();
    if (!state.advanceSpot()) return say.lastSpot();
    return presentSpot(state, lookups);
  });
}

/** The spot before this one. Shares next's lock for the same reason. */
export function previousSpot(state: TravelState, lookups: Lookups, from?: number): Promise<string> {
  return state.spotTurn.run(async () => {
    const moved = movedSince(state, from);
    if (moved) return moved;
    if (!state.spots.length) return say.notLookedYet();
    if (!state.rewindSpot()) return say.firstAlready(state.aroundPlace);
    return presentSpot(state, lookups);
  });
}

/** A pin tapped on the map. '' (nothing to say) for the spot already showing. */
export function gotoSpot(state: TravelState, lookups: Lookups, index: number): Promise<string> {
  return state.spotTurn.run(async () => {
    if (!state.spots.length) return say.notLookedYet();
    if (!state.gotoSpot(index)) return '';
    return presentSpot(state, lookups);
  });
}

/**
 * Give the current spot its distance, a maps link, and (once) a photo and a
 * sentence from Wikipedia. Callers hold spotTurn; the spot, its place in the
 * queue and the place are taken before the Wikipedia wait, so what is said is
 * always the sight this call started with.
 */
async function presentSpot(state: TravelState, lookups: Lookups): Promise<string> {
  const spot = state.spot;
  if (!spot) return say.nothingToShow();
  const [place, position, total] = [state.aroundPlace, state.spotIndex + 1, state.spots.length];
  await describeSpot(spot, state.origin ?? [spot.lat, spot.lon], lookups);
  state.bump();
  console.info('[Travel] spot %d/%d near %s photo=%s', position, total, place, Boolean(spot.imageUrl));
  return say.anotherSpot(spotOf(spot), position, total);
}

/** A sight's distance from where they are looking, its maps link, and (once) its photo and a line from Wikipedia. */
async function describeSpot(spot: QueuedSpot, origin: [number, number], lookups: Lookups): Promise<void> {
  spot.distance = distancePhrase(haversineM(origin[0], origin[1], spot.lat, spot.lon));
  spot.mapsUrl = mapsUrl(spot.name, spot.lat, spot.lon);
  if (spot.imageUrl === undefined) {
    // The photo the source already had (Wikipedia's ranked sights have one), unless the article has a better one.
    spot.imageUrl = spot.image ?? null;
    spot.summary = '';
    const found = await lookups.summary(spot.wiki || spot.name).catch(() => null);
    const near = found?.coordinates && haversineM(found.coordinates[0], found.coordinates[1], spot.lat, spot.lon) <= SAME_PLACE_M;
    if (found && near) {
      spot.imageUrl = found.image ?? spot.imageUrl;
      spot.summary = found.extract;
    }
  }
}

// ─── one entry point ──────────────────────────────────────────────────────

/** Do one action and return what the guide should hear about it ('' for nothing). */
export async function apply(state: TravelState, lookups: Lookups, action: Action): Promise<string> {
  switch (action.kind) {
    case 'name': return rememberTraveler(state, action.name);
    case 'destination': return chooseDestination(state, lookups, action.country, { city: action.city, continent: action.continent });
    case 'search': return searchDestination(state, lookups, action.query);
    case 'continent': return chooseDestination(state, lookups, '', { continent: action.continent });
    case 'pick': return pickForThem(state, lookups);
    case 'news': return showHeadlines(state);
    case 'food': return showDishes(state);
    case 'around': return explorePlace(state, lookups, action.place);
    case 'coords': return exploreCoordinates(state, lookups, action.lat, action.lon);
    case 'destinationAt': return destinationAt(state, lookups, action.lat, action.lon);
    case 'next': return nextSpot(state, lookups);
    case 'previous': return previousSpot(state, lookups);
    case 'goto': return gotoSpot(state, lookups, action.index);
    case 'revisit': return revisitCountry(state, lookups, action.country);
    case 'show': {
      state.stage = action.stage;
      state.bump();
      return action.stage === 'planning' ? say.showPlanning(state.country) : say.showAround(state.aroundPlace, state.spotView()?.spot ?? null);
    }
  }
}
