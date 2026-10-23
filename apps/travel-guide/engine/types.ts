// What the server and the page share. Nothing here is secret: the trip lives
// on the server because the lookups need a User-Agent, a request-a-second
// throttle and (for the news) a key that browsers cannot hold, not because the
// page must not see it.

export type Stage = 'welcome' | 'planning' | 'around';

/** The country on the map. */
export interface CountryMap {
  country: string;
  isoCode: string;
  city: string;
  /** [latitude, longitude], Nominatim's label point (already on the mainland). */
  center: [number, number] | null;
  /** [minLat, minLon, maxLat, maxLon] of the MAIN landmass, which is what the map fits to. */
  bbox: [number, number, number, number] | null;
  /** Closed rings of [lon, lat], drawn over the tiles. */
  outline: number[][][] | null;
  attribution: string;
}

export interface Headline {
  title: string;
  source: string;
  url: string;
  publishDate: string;
}

export interface NewsView {
  country: string;
  headlines: Headline[];
  /** On the board. Headlines are fetched as soon as the country is chosen and staged for the avatar, hidden until asked for. */
  shown: boolean;
  loading: boolean;
}

export interface Dish {
  name: string;
  description: string;
  imageUrl: string | null;
}

export interface FoodView {
  country: string;
  dishes: Dish[];
  shown: boolean;
  loading: boolean;
}

/** A nearby place, as the board and the avatar see it once it is the current one. */
export interface Spot {
  name: string;
  category: string;
  lat: number;
  lon: number;
  distance: string;
  mapsUrl: string;
  imageUrl: string | null;
  /** A sentence or two from Wikipedia, so the avatar talks about the real place. */
  summary: string;
}

/** Every spot in the queue, for the map's pins. */
export interface SpotPin {
  name: string;
  category: string;
  lat: number;
  lon: number;
}

export interface SpotView {
  place: string;
  origin: [number, number] | null;
  index: number;
  total: number;
  /** True when a provider failed, as opposed to the place being quiet. */
  lookupFailed: boolean;
  spot: Spot | null;
  pins: SpotPin[];
}

/** One country already on the trip, as the strip draws it. */
export interface TripStop {
  country: string;
  city: string;
  /** Dish names, once they have been shown. */
  dishes: string[];
  headlineCount: number;
  /** A tiny outline for the strip's chip, [lon, lat] rings. */
  silhouette: number[][][] | null;
}

export interface TripView {
  current: string;
  visited: TripStop[];
}

export interface Snapshot {
  /** Bumped by every change; the page never goes back to a lower one. */
  seq: number;
  stage: Stage;
  travelerName: string;
  continent: string;
  /** Something is still loading in the background (headlines, dishes, photos): the page polls. */
  pending: boolean;
  /** Whether a news source (WORLDNEWS_API_KEY) is configured at all. */
  newsAvailable: boolean;
  map: CountryMap | null;
  news: NewsView | null;
  food: FoodView | null;
  spot: SpotView | null;
  trip: TripView;
}

/** Everything that can be done to the board: a button, or a host's tool call (engine/tools.ts). */
export type Action =
  | { kind: 'name'; name: string }
  | { kind: 'destination'; country: string; city?: string; continent?: string }
  /** Free text from the destination box or "how about Bali": a country, or a place inside one. */
  | { kind: 'search'; query: string }
  | { kind: 'continent'; continent: string }
  /** "Surprise me": the app picks. (Asked out loud, the host picks and calls choose_destination.) */
  | { kind: 'pick' }
  | { kind: 'news' }
  | { kind: 'food' }
  | { kind: 'around'; place: string }
  /** "Use my location", or "what's around here" on the map. */
  | { kind: 'coords'; lat: number; lon: number }
  /** "Plan a trip here" on the map: the country under the click. */
  | { kind: 'destinationAt'; lat: number; lon: number }
  | { kind: 'next' }
  | { kind: 'previous' }
  | { kind: 'goto'; index: number }
  | { kind: 'revisit'; country: string }
  | { kind: 'show'; stage: 'planning' | 'around' };

export type ActionKind = Action['kind'];

/** What the server answers a tool call or a button with: the board as it now is, and what happened, in words the host speaks from ('' for nothing). */
export interface Outcome {
  snapshot: Snapshot;
  result: string;
}

/** The map tiles the page draws, configurable on the server. */
export interface MapConfig {
  tileUrl: string;
  attribution: string;
  maxZoom: number;
}
