// What the guide and the board both believe, with no network anywhere near it.
// The server owns one per trip; the page only draws its snapshot.
//
// One change from the original's TravelState: each country's detail (its map,
// headlines, dishes and whether they have been shown) lives in its trip entry,
// and the "current" fields read through to the entry for the country on the
// map. The original kept a second copy and synced it into the entry on every
// publish; with the headlines and dishes now loading in the background (and
// possibly landing after the user moved on), one home per country is what
// keeps a late answer from landing on the wrong one.
import { norm } from './countries.ts';
import type { CountryMap, Dish, Headline, Snapshot, Spot, SpotView, Stage, TripView } from './types.ts';

/** Every country this session has looked at, with what it gathered. */
export interface TripEntry {
  country: string;
  isoCode: string;
  city: string;
  center: [number, number] | null;
  bbox: [number, number, number, number] | null;
  outline: number[][][] | null;
  silhouette: number[][][] | null;
  headlines: Headline[];
  headlinesShown: boolean;
  headlinesLoading: boolean;
  /** `wiki`: the Wikipedia article for the photo, when the name alone would miss it. */
  dishes: (Dish & { wiki?: string })[];
  dishesShown: boolean;
  dishesLoading: boolean;
  photosLoading: boolean;
}

/** A resolved country, ready for the map. */
export interface Destination {
  country: string;
  isoCode: string;
  center: [number, number] | null;
  bbox: [number, number, number, number] | null;
  outline: number[][][] | null;
  silhouette?: number[][][] | null;
}

/** A spot in the queue. Its distance, link, photo and summary are filled in the first time it is shown. */
export interface QueuedSpot {
  name: string;
  category: string;
  lat: number;
  lon: number;
  distance?: string;
  mapsUrl?: string;
  /** undefined: not looked up yet; null: looked up, no photo. */
  imageUrl?: string | null;
  summary?: string;
}

/** Runs one task at a time, in arrival order. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

const ATTRIBUTION = '© OpenStreetMap contributors';
/** How long, and for how many of its lines, the app reads the guide's words for the country it picks. */
export const PICK_WINDOW_MS = 45_000;
export const PICK_WINDOW_LINES = 2;

export class TravelState {
  /** Bumped by every change, so the page never goes back to an older snapshot. */
  seq = 0;
  travelerName = '';
  stage: Stage = 'welcome';
  continent = '';
  /** The country on the map ('' for none); its detail is `here`. */
  country = '';
  /**
   * Every country this session has looked at, oldest first. Before this
   * existed, switching from Japan to Peru wiped Japan's city and dishes with no
   * history and nothing to go back to: changing your mind was destructive.
   */
  visited: TripEntry[] = [];

  aroundPlace = '';
  origin: [number, number] | null = null;
  spots: QueuedSpot[] = [];
  spotIndex = 0;
  /** A lookup provider failed, as opposed to genuinely finding nothing: different words, a different board. */
  lookupFailed = false;
  /** The user asked the guide to choose: its next lines are read for the country. */
  awaitingPick: { until: number; lines: number } | null = null;

  /**
   * Moving through the spots is reachable from a button and from speech at
   * once, and the photo lookup in between is an await a second caller slips
   * through: advancing twice, describing once, skipping a spot nobody can see
   * is missing. Lives as long as the state: a fresh lock per queue would not
   * exclude anyone still holding the old one.
   */
  readonly spotTurn = new Mutex();
  /** Background lookups per country, so "show me the news" can wait for its headlines. */
  readonly detail = new Map<string, { news: Promise<void>; dishes: Promise<void>; photos: Promise<void> }>();

  constructor(public newsAvailable = false) {}

  bump() { this.seq += 1; }

  // ── the country on the map ──

  get here(): TripEntry | null { return this.country ? this.visited.find((e) => e.country === this.country) ?? null : null; }
  get isoCode() { return this.here?.isoCode ?? ''; }
  get city() { return this.here?.city ?? ''; }
  get headlines(): Headline[] { return this.here?.headlines ?? []; }
  set headlines(value: Headline[]) { if (this.here) this.here.headlines = value; }
  get dishes(): TripEntry['dishes'] { return this.here?.dishes ?? []; }
  set dishes(value: TripEntry['dishes']) { if (this.here) this.here.dishes = value; }

  /**
   * Adopt a resolved country. A new country starts a new trip entry and the
   * one being left keeps everything it had, so going back costs nothing. A
   * country already on the trip (by name or code) is the same entry: its
   * detail is kept, and a call that names no city keeps the city they said.
   */
  setDestination(geo: Destination, { city = '', continent = '' }: { city?: string; continent?: string } = {}): void {
    let entry = this.visited.find((e) => e.country === geo.country || (geo.isoCode && e.isoCode === geo.isoCode));
    if (!entry) {
      entry = {
        country: geo.country, isoCode: geo.isoCode, city: '', center: null, bbox: null, outline: null, silhouette: null,
        headlines: [], headlinesShown: false, headlinesLoading: false,
        dishes: [], dishesShown: false, dishesLoading: false, photosLoading: false,
      };
      this.visited.push(entry);
    }
    entry.isoCode = geo.isoCode || entry.isoCode;
    entry.center = geo.center ?? entry.center;
    entry.bbox = geo.bbox ?? entry.bbox;
    entry.outline = geo.outline ?? entry.outline;
    entry.silhouette = geo.silhouette ?? entry.silhouette;
    if (city) entry.city = city;
    this.country = entry.country;
    this.continent = continent || this.continent;
    this.stage = 'planning';
  }

  /**
   * Put a country the traveller already looked at back on the board, exactly
   * as they left it. Exact names and country codes are checked across the
   * WHOLE trip before any partial match: one predicate per entry let a partial
   * hit on an earlier stop beat the exact name of a later one, and "back to
   * Niger" landed on Nigeria.
   */
  revisit(country: string): boolean {
    const wanted = norm(country || '');
    if (!wanted) return false;
    const entry = this.visited.find((e) => norm(e.country) === wanted || norm(e.isoCode) === wanted)
      ?? this.visited.find((e) => norm(e.country).includes(wanted));
    if (!entry || entry.country === this.country) return false;
    this.country = entry.country;
    this.stage = 'planning';
    return true;
  }

  /** The trip strip: names, what was shown there, and a tiny shape. Never the full outlines. */
  tripView(): TripView {
    return {
      current: this.country,
      visited: this.visited.map((e) => ({
        country: e.country,
        city: e.city,
        dishes: e.dishesShown ? e.dishes.map((d) => d.name) : [],
        headlineCount: e.headlinesShown ? e.headlines.length : 0,
        silhouette: e.silhouette,
      })),
    };
  }

  // ── what is around them ──

  /** A fresh queue of nearby places. `null` means the lookup failed. */
  setSpots(place: string, origin: [number, number], spots: QueuedSpot[] | null): void {
    this.stage = 'around';
    this.aroundPlace = place;
    this.origin = origin;
    this.spots = (spots ?? []).map((s) => ({ ...s }));
    this.spotIndex = 0;
    this.lookupFailed = spots === null;
  }

  get spot(): QueuedSpot | null { return this.spots.length ? this.spots[Math.min(this.spotIndex, this.spots.length - 1)] : null; }
  get hasMoreSpots() { return this.spots.length > 0 && this.spotIndex + 1 < this.spots.length; }
  get hasPreviousSpot() { return this.spots.length > 0 && this.spotIndex > 0; }

  /** The next spot, or null when the queue is spent. Clamped, never wrapped: a queue that quietly starts over shows the same museum while the guide calls it another one. */
  advanceSpot(): QueuedSpot | null {
    if (!this.hasMoreSpots) return null;
    this.spotIndex += 1;
    return this.spot;
  }

  /** The spot before, or null at the first. The queue used to run forwards only; a spot you liked and passed was gone. */
  rewindSpot(): QueuedSpot | null {
    if (!this.hasPreviousSpot) return null;
    this.spotIndex -= 1;
    return this.spot;
  }

  /** A spot picked on the map, or null for one that is not in the queue (or already showing). */
  gotoSpot(index: number): QueuedSpot | null {
    if (!Number.isInteger(index) || index < 0 || index >= this.spots.length || index === this.spotIndex) return null;
    this.spotIndex = index;
    return this.spot;
  }

  // ── "you choose" ──

  awaitPick(now = Date.now()) { this.awaitingPick = { until: now + PICK_WINDOW_MS, lines: PICK_WINDOW_LINES }; }
  isAwaitingPick(now = Date.now()) { return Boolean(this.awaitingPick && now < this.awaitingPick.until && this.awaitingPick.lines > 0); }

  // ── the page's view ──

  /** Everything the page needs to redraw itself from nothing. */
  snapshot(now = Date.now()): Snapshot {
    const here = this.here;
    const map: CountryMap | null = here && (here.center || here.bbox || here.outline)
      ? { country: here.country, isoCode: here.isoCode, city: here.city, center: here.center, bbox: here.bbox, outline: here.outline, attribution: ATTRIBUTION }
      : null;
    return {
      seq: this.seq,
      stage: this.stage,
      travelerName: this.travelerName,
      continent: this.continent,
      awaitingPick: this.isAwaitingPick(now),
      pending: this.visited.some((e) => e.headlinesLoading || e.dishesLoading || e.photosLoading),
      newsAvailable: this.newsAvailable,
      map,
      news: here ? { country: here.country, headlines: here.headlines, shown: here.headlinesShown, loading: here.headlinesLoading } : null,
      food: here ? { country: here.country, dishes: here.dishes.map(({ name, description, imageUrl }) => ({ name, description, imageUrl })), shown: here.dishesShown, loading: here.dishesLoading } : null,
      spot: this.spotView(),
      trip: this.tripView(),
    };
  }

  /**
   * The current nearby spot, positioned within its queue. Returned even when
   * the queue is empty: "I looked and there is nothing", "I have not looked
   * yet" and "the lookup service is down" are three different screens.
   */
  spotView(): SpotView | null {
    if (!this.aroundPlace) return null;
    const s = this.spot;
    const spot: Spot | null = s
      ? { name: s.name, category: s.category, lat: s.lat, lon: s.lon, distance: s.distance ?? '', mapsUrl: s.mapsUrl ?? '', imageUrl: s.imageUrl ?? null, summary: s.summary ?? '' }
      : null;
    return {
      place: this.aroundPlace,
      origin: this.origin,
      index: this.spotIndex,
      total: this.spots.length,
      lookupFailed: this.lookupFailed,
      spot,
      pins: this.spots.map(({ name, category, lat, lon }) => ({ name, category, lat, lon })),
    };
  }
}
