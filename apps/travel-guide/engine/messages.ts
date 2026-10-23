// The page's check on what the server sends: every snapshot is parsed before
// it is drawn. Everything returns null (or a safe default) rather than
// throwing: a board that throws on one bad field stops rendering for the rest
// of the session.
//
// The nullable fields are nullable on purpose, and each has a story:
//  - `imageUrl` on a spot or a dish: every picture comes from the open
//    internet and may simply not exist. Rejecting the dish would drop it with
//    its missing photo.
//  - `outline`: a shape that would not fit its budget is dropped. The map is
//    still drawable from the centre and the bounding box.
//  - `spot` inside a spot view: "I looked and found nothing" is a screen of
//    its own, and it is not the same as "I have not looked".
import type { CountryMap, Dish, FoodView, Headline, NewsView, Snapshot, Spot, SpotPin, SpotView, Stage, TripStop, TripView } from './types.ts';

const STAGES: Stage[] = ['welcome', 'planning', 'around'];

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown) => (typeof value === 'string' ? value : '');
const nullableStr = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function parsePair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [a, b] = value;
  return finite(a) && finite(b) ? [a, b] : null;
}

function parseBbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(finite)) return null;
  return value as [number, number, number, number];
}

/** Closed rings of [lon, lat]. Fewer than three points is not a shape; drawing it puts a stray hairline across the map. */
export function parseRings(value: unknown): number[][][] | null {
  if (!Array.isArray(value)) return null;
  const rings: number[][][] = [];
  for (const ring of value) {
    if (!Array.isArray(ring)) continue;
    const points = ring.map(parsePair).filter((p): p is [number, number] => p !== null);
    if (points.length >= 3) rings.push(points);
  }
  return rings.length ? rings : null;
}

export function parseMap(value: unknown): CountryMap | null {
  if (!isPlainObject(value)) return null;
  const country = str(value.country);
  const center = parsePair(value.center);
  const bbox = parseBbox(value.bbox);
  const outline = parseRings(value.outline);
  // A map with a name but no geometry at all cannot be drawn as anything.
  if (!country || (!center && !bbox && !outline)) return null;
  return { country, isoCode: str(value.isoCode), city: str(value.city), center, bbox, outline, attribution: str(value.attribution) || '© OpenStreetMap contributors' };
}

export function parseNews(value: unknown): NewsView | null {
  if (!isPlainObject(value) || !Array.isArray(value.headlines)) return null;
  const headlines: Headline[] = [];
  for (const item of value.headlines) {
    if (!isPlainObject(item)) continue;
    const title = str(item.title);
    if (!title) continue;
    headlines.push({ title, source: str(item.source) || 'news', url: str(item.url), publishDate: str(item.publishDate) });
  }
  // An empty list is a real answer ("no headlines came back"): the board has to be able to stop waiting.
  return { country: str(value.country), headlines, shown: value.shown === true, loading: value.loading === true };
}

export function parseFood(value: unknown): FoodView | null {
  if (!isPlainObject(value) || !Array.isArray(value.dishes)) return null;
  const dishes: Dish[] = [];
  for (const item of value.dishes) {
    if (!isPlainObject(item)) continue;
    const name = str(item.name);
    if (!name) continue;
    // An empty image url renders a broken-image glyph AND suppresses the placeholder: the worst of both.
    dishes.push({ name, description: str(item.description), imageUrl: nullableStr(item.imageUrl) });
  }
  return { country: str(value.country), dishes, shown: value.shown === true, loading: value.loading === true };
}

function parseSpot(value: unknown): Spot | null {
  if (!isPlainObject(value)) return null;
  const name = str(value.name);
  if (!name || !finite(value.lat) || !finite(value.lon)) return null;
  return {
    name,
    category: str(value.category) || 'place',
    lat: value.lat,
    lon: value.lon,
    distance: str(value.distance),
    mapsUrl: str(value.mapsUrl),
    imageUrl: nullableStr(value.imageUrl),
    summary: str(value.summary),
  };
}

function parsePins(value: unknown): SpotPin[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlainObject).flatMap((p) => (str(p.name) && finite(p.lat) && finite(p.lon) ? [{ name: str(p.name), category: str(p.category) || 'place', lat: p.lat, lon: p.lon }] : []));
}

export function parseSpotView(value: unknown): SpotView | null {
  if (!isPlainObject(value)) return null;
  const place = str(value.place);
  if (!place) return null;
  return {
    place,
    origin: parsePair(value.origin),
    index: finite(value.index) ? value.index : 0,
    total: finite(value.total) ? value.total : 0,
    lookupFailed: value.lookupFailed === true,
    spot: parseSpot(value.spot),
    pins: parsePins(value.pins),
  };
}

/**
 * Everywhere this session has been. An EMPTY `visited` list is a real answer
 * ("nowhere yet"), so it parses to a view; the strip decides not to render.
 */
export function parseTrip(value: unknown): TripView | null {
  if (!isPlainObject(value) || !Array.isArray(value.visited)) return null;
  const visited: TripStop[] = [];
  for (const item of value.visited) {
    if (!isPlainObject(item)) continue;
    const country = str(item.country);
    if (!country) continue;
    const dishes = Array.isArray(item.dishes) ? item.dishes.map(str).filter((d) => d !== '') : [];
    const headlineCount = finite(item.headlineCount) && item.headlineCount > 0 ? Math.round(item.headlineCount) : 0;
    visited.push({ country, city: str(item.city), dishes, headlineCount, silhouette: parseRings(item.silhouette) });
  }
  return { current: str(value.current), visited };
}

/** A whole snapshot, or null when it is not one. Every section is optional: a session that has only said hello has none yet. */
export function parseSnapshot(value: unknown): Snapshot | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.stage !== 'string' || !STAGES.includes(value.stage as Stage)) return null;
  return {
    seq: finite(value.seq) ? value.seq : 0,
    stage: value.stage as Stage,
    travelerName: str(value.travelerName),
    continent: str(value.continent),
    pending: value.pending === true,
    newsAvailable: value.newsAvailable === true,
    map: parseMap(value.map),
    news: parseNews(value.news),
    food: parseFood(value.food),
    spot: parseSpotView(value.spot),
    trip: parseTrip(value.trip) ?? { current: '', visited: [] },
  };
}

/**
 * Whether a snapshot may replace the one on screen. Replies can arrive out of
 * order (a slow poll after a fast button press); an older one must never drag
 * the board back — the original board jumped from the spot being described to
 * the welcome screen, mid-sentence, whenever a stale sync reply won the race.
 */
export const isNewer = (held: Snapshot | null, next: Snapshot) => !held || next.seq >= held.seq;
