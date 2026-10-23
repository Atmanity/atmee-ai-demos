// Everything the guide knows that she did not make up: the open-data lookups.
// Server-side only: Nominatim and Overpass want a descriptive User-Agent (a
// browser cannot set one) and Nominatim one request a second from one client;
// the news needs a key the page must never hold.
//
// Four providers, all keyless except the last:
//  - Nominatim: a country to a centre, a bounding box and an outline; a place
//    (or a pair of coordinates) to a human place. An anonymous or bursty client
//    gets 403/429, which from here looks exactly like "that country does not
//    exist". Hence USER_AGENT and the throttle.
//  - Wikipedia: the sights around a place, first. A GeoSearch ranked for a
//    traveller (an article with a lead photo, some prominence, a landmark
//    rather than a district or a station), and the REST summary for a real
//    photo and a sentence about a place or a dish.
//  - Overpass: nearby points of interest, only to top up a place Wikipedia
//    knows little about. The main instance is regularly rate-limited or 504s
//    under load (live, every mirror failed in both runs), so the mirrors are
//    tried in order within a time budget.
//  - WorldNews: the latest local headlines. The only one that needs a key
//    (WORLDNEWS_API_KEY). No key means no headlines and a session that runs
//    exactly as well otherwise; never a crash.
//
// Every fetcher is split in two: a thin async half that does the request, and
// a pure parse* half that turns a decoded body into our own shape. The parsers
// are where the bugs live, so they carry the tests. Every fetcher swallows its
// own failures and returns an empty/null result: a guide with no map is a
// worse conversation; a session that died because Overpass had a bad minute
// is a broken product.
import type { Headline } from './types.ts';

export const USER_AGENT = process.env.TRAVEL_USER_AGENT || 'atmee-usecase-demos/0.2 travel-guide (https://atmee.ai; engineering@atmee.ai)';
export const HTTP_TIMEOUT_MS = 12_000;

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
/** One request per second, per the Nominatim usage policy, with a margin. */
export const NOMINATIM_MIN_INTERVAL_MS = 1100;

export const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const WORLDNEWS_SEARCH = 'https://api.worldnewsapi.com/search-news';

export const POI_SEARCH_RADIUS_M = 1500;
/** How far Wikipedia looks for sights: a long walk, or a short ride. */
export const SIGHT_RADIUS_M = 3000;
/** With this many good sights from Wikipedia, Overpass is not asked at all. */
export const ENOUGH_SIGHTS = 3;
/** The most time the Overpass mirrors get, together: each attempt gets only what is left of it. */
export const OVERPASS_BUDGET_MS = 14_000;
/** Less time than this left in the budget, and another mirror is not worth starting: Overpass rarely answers that fast. */
export const OVERPASS_MIN_ATTEMPT_MS = 3_000;

/** What the fetchers use to make requests: `fetch`, or a scripted double in tests. `timeoutMs` (default HTTP_TIMEOUT_MS) is how long this one request may take. */
export type Http = (url: string, init?: RequestInit & { timeoutMs?: number }) => Promise<Response>;
export const defaultHttp: Http = (url, { timeoutMs = HTTP_TIMEOUT_MS, ...init } = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });

export interface GeoCountry {
  country: string;
  isoCode: string;
  center: [number, number];
  bbox: [number, number, number, number] | null;
  geojson: unknown;
}

export interface GeoPlace {
  place: string;
  country: string;
  isoCode: string;
  lat: number;
  lon: number;
}

export interface RawSpot {
  name: string;
  category: string;
  lat: number;
  lon: number;
  /** The Wikipedia article, when the name shown is not its exact title ("Igreja de Santo Estêvão (Lisbon)"). */
  wiki?: string;
  /** Its lead photo, when the source already has one. */
  image?: string | null;
}

export interface WikiSummary {
  title: string;
  /** [lat, lon] for an article about a place; null for a dish or a person. */
  coordinates: [number, number] | null;
  /** A photo to show (a larger rendition of the thumbnail when the original is big enough), or null. */
  image: string | null;
  extract: string;
}

// ─── small pure helpers ───────────────────────────────────────────────────

/** Collapse whitespace and clip. Everything from a provider goes through it. */
export function cleanText(value: unknown, limit = 160): string {
  return String(value || '').split(/\s+/).filter(Boolean).join(' ').slice(0, limit);
}

/** Great-circle distance in metres. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dPhi = (lat2 - lat1) * rad;
  const dLambda = (lon2 - lon1) * rad;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLambda / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

/** A distance the guide can say out loud. No digits-with-units, no colons. */
export function distancePhrase(meters: number): string {
  // From the place they named, which is not always where they are: "a few steps away", never "next to you".
  if (meters < 120) return 'a few steps away';
  // Walking pace, roughly 80 m/min.
  if (meters < 1000) return `about a ${Math.max(1, Math.round(meters / 80))} minute walk away`;
  return `about ${(meters / 1000).toFixed(1)} kilometres away`;
}

/** A Google Maps deep link, anchored to the coordinates so the right "Central Park" opens. */
export function mapsUrl(name: string, lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${lat},${lon}`).replace(/%20/g, '+')}`;
}

/** A number, or a numeric string; null for anything else (null, '', booleans, NaN). */
function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const isObject = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);

// ─── parsers (the tested half) ────────────────────────────────────────────

/**
 * A Nominatim /search body to {country, isoCode, center, bbox, geojson}.
 * `bbox` is [minLat, minLon, maxLat, maxLon]. Nominatim's own `boundingbox`
 * is [south, north, west, east] as STRINGS, which is a different order as
 * well as a different type, and getting that wrong draws a map of the sea.
 */
export function parseCountry(results: unknown): GeoCountry | null {
  if (!Array.isArray(results) || !results.length) return null;
  const top = results[0];
  if (!isObject(top)) return null;
  const lat = num(top.lat);
  const lon = num(top.lon);
  if (lat === null || lon === null) return null;

  let bbox: GeoCountry['bbox'] = null;
  const raw = Array.isArray(top.boundingbox) ? top.boundingbox.map(num) : [];
  if (raw.length === 4 && raw.every((v: number | null) => v !== null)) {
    const [south, north, west, east] = raw as number[];
    bbox = [south, west, north, east];
  }

  const address = isObject(top.address) ? top.address : {};
  const name = address.country || String(top.display_name || top.name || '').split(',')[0];
  return {
    country: cleanText(name, 80),
    isoCode: String(address.country_code || '').toUpperCase(),
    center: [lat, lon],
    bbox,
    geojson: isObject(top.geojson) ? top.geojson : null,
  };
}

/**
 * A Nominatim /reverse (or a /search top hit) to a spoken place name. Nominatim
 * answers /reverse with an object and /search with a list, and the caller
 * should not have to care which endpoint produced it.
 */
export function parsePlace(data: unknown): GeoPlace | null {
  if (Array.isArray(data)) data = data.length ? data[0] : null;
  if (!isObject(data)) return null;
  const address = isObject(data.address) ? data.address : {};
  let place = '';
  for (const key of ['city', 'town', 'village', 'suburb', 'municipality', 'county', 'state']) {
    if (address[key]) {
      place = cleanText(address[key], 80);
      break;
    }
  }
  if (!place) place = cleanText(String(data.display_name || '').split(',')[0], 80);
  const lat = num(data.lat);
  const lon = num(data.lon);
  if (lat === null || lon === null || !place) return null;
  return {
    place,
    country: cleanText(address.country || '', 80),
    isoCode: String(address.country_code || '').toUpperCase(),
    lat,
    lon,
  };
}

/** `historic=*` values that mark something small rather than a place to visit. */
const MINOR_HISTORIC = new Set(['memorial', 'plaque', 'boundary_stone', 'milestone', 'wayside_cross', 'wayside_shrine', 'stone', 'tomb', 'grave', 'yes']);

/**
 * Overpass elements to named spots, closest first, de-duplicated by name.
 * Ways and relations carry their position under `center` rather than at the
 * top level; dropping those loses every museum that is a building outline
 * rather than a single node, which is most of them. The English name wins
 * when OSM has one: the guide says it aloud and Wikipedia is looked up by it.
 */
export function parseOverpassPois(data: unknown, lat: number, lon: number): RawSpot[] {
  if (!isObject(data)) return [];
  const spots: RawSpot[] = [];
  const seen = new Set<string>();
  for (const element of Array.isArray(data.elements) ? data.elements : []) {
    if (!isObject(element)) continue;
    const tags = isObject(element.tags) ? element.tags : {};
    const name = cleanText(tags['name:en'] || tags.name || '', 80);
    if (!name || seen.has(name.toLowerCase())) continue;
    const where = 'lat' in element && 'lon' in element ? element : isObject(element.center) ? element.center : {};
    const pLat = num(where.lat);
    const pLon = num(where.lon);
    if (pLat === null || pLon === null) continue;
    // A plaque or a boundary stone is history, not a sight anyone crosses a city for.
    if (!tags.tourism && MINOR_HISTORIC.has(String(tags.historic))) continue;
    seen.add(name.toLowerCase());
    const category = tags.tourism || tags.historic || 'place';
    spots.push({ name, category: cleanText(String(category).replace(/_/g, ' '), 40), lat: pLat, lon: pLon });
  }
  spots.sort((a, b) => haversineM(lat, lon, a.lat, a.lon) - haversineM(lat, lon, b.lat, b.lon));
  return spots.slice(0, 8);
}

/** What a traveller would cross a street for, read from the head of a Wikipedia short description ("cathedral in Lisbon, Portugal"). */
const SIGHT_WORDS = /\b(castle|cathedral|basilica|church|chapel|monastery|convent|abbey|cloister|mosque|synagogue|temple|shrine|pagoda|palace|fortress|fort|citadel|tower|museum|gallery|monument|viewpoint|miradouro|belvedere|lookout|park|gardens?|square|plaza|piazza|market|bridge|gate|arch|aqueduct|ruins|amphitheatre|theatre|theater|opera house|lighthouse|beach|waterfall|zoo|aquarium|fountain|cemetery|library|observatory|statue|crossing|stadium|arena|skyscraper|landmark)\b/i;
/** What is near a place but is not a sight: the district itself, a station, a school, a company, a person. */
const NOT_A_SIGHT = /\b(station|stop|airport|port|school|college|university|hospital|clinic|company|corporation|business|bank|embassy|consulate|hotel|office|newspaper|magazine|club|team|parish|municipality|district|neighbou?rhood|quarter|borough|street|road|avenue|motorway|highway|line|constituency|settlement|village|town|city|capital|organi[sz]ation|association|party|band|album|film|ship|event|battle|earthquake|writer|poet|politician|painter|actor|singer|footballer|architect|people|family|ward|prefecture|region|area|think tank|institute|coup|murder|assassination|incident|confrontation|attack|massacre|riot|protest|rebellion|uprising|war|siege|bombing|fire|disaster|election|treaty|crisis)\b/i;
/** "1936 coup d'état attempt", "1908 murder of the king": a head that starts with a year is something that happened, not somewhere to go. */
const AN_EVENT = /^\d{3,4}s?\b/;

/** "cathedral in Lisbon, Portugal" -> "cathedral": what the thing is, before where it is. */
const headOf = (description: string) => description.split(/\s(?:in|of|at|on|near|located|from)\s|[,(;]/)[0].trim();

/**
 * A Wikipedia GeoSearch (with lead images, page sizes, short descriptions and
 * recent pageviews) ranked for a traveller. GeoSearch alone is nearest first,
 * and live that meant a "Júlio de Castilho memorial" and an "S. Vicente
 * artwork" with no photo, two minutes from Lisbon's castle and cathedral. So:
 * no photo, no sight; a district, a station or a person is not one either;
 * and the rest are scored by prominence (article length and pageviews), a
 * landmark's kind, and distance. The best come first, at most eight.
 */
export function parseRankedSights(data: unknown, lat: number, lon: number): RawSpot[] {
  if (!isObject(data)) return [];
  const pages = isObject(data.query) && Array.isArray(data.query.pages) ? data.query.pages : [];
  const scored: { spot: RawSpot; score: number }[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    if (!isObject(page)) continue;
    const title = cleanText(page.title || '', 120);
    const image = isObject(page.thumbnail) && typeof page.thumbnail.source === 'string' ? page.thumbnail.source : '';
    const where = Array.isArray(page.coordinates) && isObject(page.coordinates[0]) ? page.coordinates[0] : {};
    const pLat = num(where.lat);
    const pLon = num(where.lon);
    if (!title || !image || pLat === null || pLon === null || /^list of\b|disambiguation/i.test(title)) continue;
    const head = headOf(cleanText(page.description || '', 160));
    if (head && ((NOT_A_SIGHT.test(head) && !SIGHT_WORDS.test(head)) || AN_EVENT.test(head))) continue;
    const name = title.replace(/\s*\([^)]*\)\s*$/, '');
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const views = isObject(page.pageviews) ? Object.values(page.pageviews).map(num).filter((v): v is number => v !== null) : [];
    const daily = views.length ? views.reduce((a, b) => a + b, 0) / views.length : 0;
    const kind = head.match(SIGHT_WORDS)?.[1]?.toLowerCase() ?? '';
    const km = haversineM(lat, lon, pLat, pLon) / 1000;
    const score = Math.log10(Math.max(num(page.length) ?? 0, 100)) + 0.8 * Math.log10(1 + daily) + (kind ? 1 : 0) - 0.4 * km;
    scored.push({ spot: { name, category: kind || 'landmark', lat: pLat, lon: pLon, ...(name !== title ? { wiki: title } : {}), image }, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 8).map((s) => s.spot);
}

/** A WorldNews body to at most five headlines the board can list. */
export function parseHeadlines(data: unknown): Headline[] {
  if (!isObject(data) || !Array.isArray(data.news)) return [];
  const out: Headline[] = [];
  for (const item of data.news.slice(0, 5)) {
    if (!isObject(item)) continue;
    const title = cleanText(item.title || '', 180);
    if (!title) continue;
    const url = String(item.url || '');
    out.push({ title, source: domain(url) || 'news', url, publishDate: cleanText(item.publish_date || '', 40) });
  }
  return out;
}

/**
 * The lead photo URL out of a Wikipedia REST summary, thumbnail first: the
 * original is regularly several megabytes.
 */
export function parseSummaryImage(data: unknown): string | null {
  if (!isObject(data)) return null;
  for (const key of ['thumbnail', 'originalimage']) {
    const block = data[key];
    if (isObject(block) && block.source) return String(block.source);
  }
  return null;
}

/**
 * The thumbnail at 960 px when the original is at least that wide: the REST
 * summary hands out a 330 px one, which is blurry on a wide card. 960 is one
 * of Wikimedia's standard thumbnail widths (arbitrary widths are throttled).
 */
export function largerImage(thumbnail: string, originalWidth: unknown): string {
  const width = num(originalWidth);
  return width !== null && width >= 960 && /\/\d+px-/.test(thumbnail) ? thumbnail.replace(/\/\d+px-/, '/960px-') : thumbnail;
}

/** A summary's photo and its first sentence or two; null for a disambiguation page. */
export function parseSummary(data: unknown): WikiSummary | null {
  if (!isObject(data) || data.type === 'disambiguation') return null;
  const thumb = parseSummaryImage(data);
  const image = thumb && isObject(data.thumbnail) && data.thumbnail.source === thumb ? largerImage(thumb, data.originalimage?.width) : thumb;
  const lat = num(data.coordinates?.lat);
  const lon = num(data.coordinates?.lon);
  return {
    title: cleanText(data.title || '', 120),
    coordinates: lat !== null && lon !== null ? [lat, lon] : null,
    image,
    extract: firstSentences(cleanText(data.extract || '', 1200), 280),
  };
}

/** Whole sentences up to `limit` characters (at least one, clipped). */
export function firstSentences(text: string, limit: number): string {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [];
  let out = '';
  for (const sentence of sentences) {
    const next = (out + sentence).trim();
    if (next.length > limit) break;
    out = `${next} `;
  }
  out = out.trim();
  return out || (text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text);
}

function domain(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return '';
  }
}

// ─── transport ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Least-effort rate limit: never start two calls closer than `interval` ms. */
export class Throttle {
  private last = 0;
  private chain: Promise<void> = Promise.resolve();
  constructor(public interval: number) {}
  wait(): Promise<void> {
    const turn = this.chain.then(async () => {
      const gap = this.interval - (Date.now() - this.last);
      if (gap > 0) await sleep(gap);
      this.last = Date.now();
    });
    this.chain = turn;
    return turn;
  }
}

/** Shared by every Nominatim call in this process. Tests set its interval to 0. */
export const nominatimThrottle = new Throttle(NOMINATIM_MIN_INTERVAL_MS);

const headers = { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' };

/** GET and decode, or null. Never throws. */
async function getJson(http: Http, url: string, params?: Record<string, string>): Promise<unknown> {
  const full = params ? `${url}?${new URLSearchParams(params)}` : url;
  try {
    const res = await http(full, { headers });
    if (res.status !== 200) {
      console.warn('[Travel] GET %s returned %d', url, res.status);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[Travel] GET %s failed: %s', url, (err as Error).message);
    return null;
  }
}

/**
 * A country to a centre, a bounding box and a coarse outline. polygon_threshold
 * asks Nominatim to simplify the outline: the unsimplified geometry for
 * somewhere like Norway is megabytes.
 */
export async function lookupCountry(name: string, http: Http = defaultHttp): Promise<GeoCountry | null> {
  await nominatimThrottle.wait();
  const body = await getJson(http, `${NOMINATIM_BASE}/search`, {
    q: name, format: 'jsonv2', polygon_geojson: '1', polygon_threshold: '0.05', addressdetails: '1', limit: '1',
  });
  return parseCountry(body);
}

/** Forward-geocode whatever the user SAID they were near ("Kyoto", "near Shibuya station"). */
export async function lookupPlace(query: string, http: Http = defaultHttp): Promise<GeoPlace | null> {
  await nominatimThrottle.wait();
  return parsePlace(await getJson(http, `${NOMINATIM_BASE}/search`, { q: query, format: 'jsonv2', addressdetails: '1', limit: '1' }));
}

/** Coordinates to a human place name: "use my location" and a tap on the map. */
export async function reversePlace(lat: number, lon: number, http: Http = defaultHttp): Promise<GeoPlace | null> {
  await nominatimThrottle.wait();
  return parsePlace(await getJson(http, `${NOMINATIM_BASE}/reverse`, { lat: `${lat}`, lon: `${lon}`, format: 'jsonv2', addressdetails: '1', zoom: '14' }));
}

export const overpassQuery = (lat: number, lon: number, radius = POI_SEARCH_RADIUS_M) => `
[out:json][timeout:25];
(
  node["tourism"~"attraction|museum|viewpoint|artwork|gallery|zoo|theme_park|aquarium"](around:${radius},${lat},${lon});
  way["tourism"~"attraction|museum|viewpoint|gallery|zoo|theme_park"](around:${radius},${lat},${lon});
  node["historic"](around:${radius},${lat},${lon});
);
out center 40;
`;

/** Overpass across its mirrors. null means every mirror failed. */
async function overpass(lat: number, lon: number, http: Http): Promise<RawSpot[] | null> {
  const body = new URLSearchParams({ data: overpassQuery(lat, lon) });
  const started = Date.now();
  for (const url of OVERPASS_URLS) {
    // Each mirror gets only what is left of the budget: a first 12 s timeout must not let a second full one start.
    const left = OVERPASS_BUDGET_MS - (Date.now() - started);
    if (left < OVERPASS_MIN_ATTEMPT_MS) break;
    try {
      const res = await http(url, { method: 'POST', body, headers: { 'User-Agent': USER_AGENT }, timeoutMs: Math.min(left, HTTP_TIMEOUT_MS) });
      if (res.status !== 200) {
        console.warn('[Travel] overpass %s returned %d', url, res.status);
        continue;
      }
      return parseOverpassPois(await res.json(), lat, lon);
    } catch (err) {
      console.warn('[Travel] overpass %s failed: %s', url, (err as Error).message);
    }
  }
  return null;
}

/** Wikipedia's sights around a point, ranked; null when Wikipedia did not answer. */
async function wikipediaSights(lat: number, lon: number, http: Http): Promise<RawSpot[] | null> {
  const body = await getJson(http, WIKIPEDIA_API, {
    action: 'query', format: 'json', formatversion: '2',
    generator: 'geosearch', ggscoord: `${lat}|${lon}`, ggsradius: String(SIGHT_RADIUS_M), ggslimit: '50',
    prop: 'coordinates|pageimages|info|description|pageviews', colimit: '50', piprop: 'thumbnail', pithumbsize: '640', pilimit: '50', pvipdays: '7',
  });
  return body === null ? null : parseRankedSights(body, lat, lon);
}

/**
 * Sights near a point, best first. Wikipedia's ranked sights, and when it
 * knows fewer than three, Overpass's points of interest after them. Three
 * outcomes, and the caller needs all three: sights, an empty list (a provider
 * answered and the place really is quiet), or null (every provider failed).
 * Collapsing the last two makes the guide tell someone looking at central
 * Rome that there is nothing to see.
 */
export async function nearbySpots(lat: number, lon: number, http: Http = defaultHttp): Promise<RawSpot[] | null> {
  const ranked = await wikipediaSights(lat, lon, http);
  if (ranked && ranked.length >= ENOUGH_SIGHTS) return ranked;
  const fromOverpass = await overpass(lat, lon, http);
  if (ranked === null && fromOverpass === null) return null;
  const seen = new Set((ranked ?? []).map((s) => s.name.toLowerCase()));
  return [...(ranked ?? []), ...(fromOverpass ?? []).filter((s) => !seen.has(s.name.toLowerCase()))].slice(0, 8);
}

/** A real photo and a sentence about a place or a dish, or null. */
export async function wikipediaSummary(title: string, http: Http = defaultHttp): Promise<WikiSummary | null> {
  const safe = encodeURIComponent(title.replace(/ /g, '_'));
  try {
    const res = await http(`${WIKIPEDIA_SUMMARY}/${safe}`, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
    if (res.status !== 200) return null;
    return parseSummary(await res.json());
  } catch (err) {
    console.info('[Travel] wikipedia summary miss for %s: %s', JSON.stringify(title), (err as Error).message);
    return null;
  }
}

/** The configured news key, read when used (absent is a normal state). */
export const newsKey = () => (process.env.WORLDNEWS_API_KEY || '').trim();

/**
 * The newest headlines for a country, or an empty list. No date filter is sent,
 * so they are the newest five whatever their age: never "today's".
 */
export async function localHeadlines(isoCode: string, http: Http = defaultHttp, apiKey = newsKey()): Promise<Headline[]> {
  if (!apiKey || !isoCode) {
    console.info('[Travel] no WORLDNEWS_API_KEY or country; skipping headlines');
    return [];
  }
  const params = new URLSearchParams({ 'source-country': isoCode.toLowerCase(), language: 'en', number: '5', sort: 'publish-time', 'sort-direction': 'desc' });
  try {
    const res = await http(`${WORLDNEWS_SEARCH}?${params}`, { headers: { 'x-api-key': apiKey, 'User-Agent': USER_AGENT } });
    if (res.status !== 200) {
      console.warn('[Travel] worldnews returned %d', res.status);
      return [];
    }
    return parseHeadlines(await res.json());
  } catch (err) {
    console.warn('[Travel] worldnews failed: %s', (err as Error).message);
    return [];
  }
}
