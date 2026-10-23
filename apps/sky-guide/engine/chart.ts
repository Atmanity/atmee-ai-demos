// The sky as this app holds it: a place, an instant, a selection, a figure.
// Ported from the original `chart.py`, rule for rule.
//
// Pure rules, no clock of its own. The only thing this object holds is four
// small facts, and everything the page draws and the avatar is told is computed
// from them by `snapshot()`: one sky, never two.
//
// Two consequences worth stating because they surprise people:
// - The clock does not tick. `when` moves only when somebody moves it. A sky
//   that advanced in real time would mint a change every second, and the
//   guide's narration hangs off changes.
// - A selection or a figure that goes below the horizon is dropped, here, as
//   part of the change that pushed it down. The snapshot never names a star the
//   chart cannot draw.
import { BY_ID, CONSTELLATION_NAMES, factFor, FIGURES, findConstellation, findStar, STARS, starsIn, type Star } from './catalog.ts';
import { altAz, circumpolarity, clockLabel, epochForNight, findPlace, nextRise, nightOf, offsetForLongitude, PLACES, SkyError, spokenHour, tonight } from './sky.ts';
import type { Figure, FigureStatus, SkySnapshot, SkyView, VisibleStar } from './types.ts';

/** The brightest N above the horizon. The catalogue is smaller than this, so it
 *  never binds today; it guards the one list that grows with the catalogue. */
export const MAX_VISIBLE = 120;

/** Beyond these the sidereal formula is being extrapolated and the labels read
 *  as nonsense. A refusal, not a clamp: silently showing a different night than
 *  the one asked for is the failure this app exists to avoid. */
export const MIN_EPOCH = -2208988800;   // 1900-01-01
export const MAX_EPOCH = 4102444800;    // 2100-01-01

/** How far one time move may jump. A year is generous for "show me this in
 *  winter" and still refuses a mistyped epoch arriving as hours. */
export const MAX_SHIFT_HOURS = 24 * 400;

/** What "that bright one" means. The panel's own hint invites the phrase, and
 *  without this the guide answered its own suggestion with "I don't have any
 *  facts about that one": the app refusing the words it printed on screen. It
 *  resolves against what is UP, so it is a different star from Lisbon than
 *  from Taipei, which is the honest answer to the question. */
export const BRIGHTEST_WORDS = [
  'brightest', 'the brightest', 'brightest one', 'the brightest one',
  'brightest star', 'the brightest star', 'bright one', 'that bright one',
  'the bright one', 'that bright star', 'the bright star', 'brightest up',
];

const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;

function number(value: unknown, what: string): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) throw new SkyError(`I couldn't read ${value} as a ${what}.`);
  return n;
}

/** The guide's view of the sky. Validates before it mutates, always: a refused
 *  intent leaves the chart exactly as it was. */
export class SkyChart {
  placeLabel: string;
  lat: number;
  lon: number;
  tz: number;
  /** True when the user gave raw coordinates (the clock is then local solar time). */
  exact = false;
  epoch: number;
  selected: string | null = null;
  figureCon: string | null = null;

  constructor({ place = 'Taipei', epoch, now }: { place?: string; epoch?: number; now?: number } = {}) {
    const found = findPlace(place) ?? PLACES[0];
    this.placeLabel = found.label;
    this.lat = found.lat;
    this.lon = found.lon;
    this.tz = found.tz;
    const base = now ?? Date.now() / 1000;
    this.epoch = epoch === undefined ? tonight(base, this.tz) : Number(epoch);
  }

  // ─── the intents ──────────────────────────────────────────────────────

  /** Move the observer: a place name, or a latitude and longitude. */
  setPlace(label?: string | null, lat?: unknown, lon?: unknown): void {
    if (label) {
      const found = findPlace(label);
      if (!found) throw new SkyError(`I don't know ${label} — try a city, or give me a latitude and longitude.`);
      this.placeLabel = found.label; this.lat = found.lat; this.lon = found.lon; this.tz = found.tz;
      this.exact = false;
    } else if (lat !== undefined && lat !== null && lon !== undefined && lon !== null) {
      const latF = number(lat, 'latitude');
      const lonF = number(lon, 'longitude');
      if (!(latF >= -90 && latF <= 90)) throw new SkyError('A latitude has to be between minus ninety and ninety.');
      if (!(lonF >= -180 && lonF <= 180)) throw new SkyError('A longitude has to be between minus a hundred and eighty and a hundred and eighty.');
      this.lat = latF; this.lon = lonF;
      this.tz = offsetForLongitude(lonF);
      this.placeLabel = `${Math.abs(latF).toFixed(1)}°${latF >= 0 ? 'N' : 'S'} ${Math.abs(lonF).toFixed(1)}°${lonF >= 0 ? 'E' : 'W'}`;
      this.exact = true;
    } else {
      throw new SkyError('Tell me a city, or a latitude and longitude.');
    }
    this.settle();
  }

  /**
   * Move the instant: an absolute epoch, a relative shift, or a preset.
   * "Tonight" is the real evening at this place (the way back from any date);
   * "midnight" and "dawn" are on the night the chart already shows, so a night
   * picked on the strip or by date survives them.
   */
  setTime({ epoch, shiftHours, preset, now }: { epoch?: unknown; shiftHours?: unknown; preset?: string | null; now?: number } = {}): void {
    let target: number;
    if (preset) {
      const k = String(preset).trim().toLowerCase();
      const base = now ?? Date.now() / 1000;
      if (['tonight', 'now', 'this evening', 'evening'].includes(k)) target = tonight(base, this.tz);
      else if (['midnight', 'tonight midnight'].includes(k)) target = this.onThisNight(24);
      else if (['dawn', 'sunrise', 'before dawn'].includes(k)) target = this.onThisNight(29);
      else throw new SkyError(`I don't know when ${preset} is — try a time, or an hour from now.`);
    } else if (shiftHours !== undefined && shiftHours !== null) {
      const hours = number(shiftHours, 'shift');
      if (Math.abs(hours) > MAX_SHIFT_HOURS) throw new SkyError("That's further than a year away — pick something nearer.");
      target = this.epoch + hours * 3600;
    } else if (epoch !== undefined && epoch !== null) {
      target = number(epoch, 'time');
    } else {
      throw new SkyError('Tell me a time, or how many hours to move.');
    }
    if (!(target >= MIN_EPOCH && target <= MAX_EPOCH)) throw new SkyError('I only chart the sky between nineteen hundred and twenty-one hundred.');
    this.epoch = target;
    this.settle();
  }

  /** The lowest-magnitude star above the horizon right now. */
  brightestVisible(): VisibleStar | null {
    const up = this.visible();
    return up.length ? up.reduce((a, b) => (b.mag < a.mag ? b : a)) : null;
  }

  /** Point at a star: by id, by name, or as "that bright one". */
  select(star: string | null | undefined): void {
    const asked = String(star ?? '').trim().toLowerCase();
    if (BRIGHTEST_WORDS.includes(asked)) {
      const brightest = this.brightestVisible();
      if (!brightest) throw new SkyError(`nothing is above the horizon from ${this.placeLabel} right now`);
      this.selected = brightest.id;
      return;
    }
    const found = findStar(star ?? '');
    if (!found) throw new SkyError(`I don't have ${star} in the catalogue — it only carries the naked-eye stars.`);
    if (this.altAzOf(found)[0] <= 0) {
      throw new SkyError(`${found.name} is below the horizon from ${this.placeLabel} right now${this.riseClause(found)}.`);
    }
    this.selected = found.id;
  }

  clearSelection(): void { this.selected = null; }

  /** Light up a constellation's figure. */
  showConstellation(name: string | null | undefined): void {
    const abbr = findConstellation(name ?? '');
    if (!abbr) throw new SkyError(`I don't know a constellation called ${name}.`);
    const full = CONSTELLATION_NAMES[abbr] ?? abbr;
    if (!FIGURES[abbr]) throw new SkyError(`I don't have a figure drawn for ${full} — only its stars.`);
    // Drawable, not merely present: a constellation with one star clearing the
    // horizon has no LINE the chart can draw, so accepting it would light up a
    // figure that renders as nothing while the avatar says it is on screen.
    if (!this.linesFor(abbr, this.visibleIds()).length) {
      throw new SkyError(`${full} isn't up at this hour from ${this.placeLabel}${this.figureRiseClause(abbr)}.`);
    }
    this.figureCon = abbr;
  }

  clearFigure(): void { this.figureCon = null; }

  // ─── projection ───────────────────────────────────────────────────────

  /** Everything the chart draws and nothing else: only the stars above the
   *  horizon, positions worked out and rounded to a tenth of a degree. */
  snapshot(): SkySnapshot {
    const visible = this.visible();
    const ids = new Set(visible.map((s) => s.id));
    const selected = this.selected && ids.has(this.selected) ? this.selected : null;
    return {
      where: { label: this.placeLabel, lat: round(this.lat, 2), lon: round(this.lon, 2) },
      when: { epoch: Math.trunc(this.epoch), label: clockLabel(this.epoch, this.tz) },
      visible,
      figure: this.figure(ids),
      selected,
      fact: selected ? factFor(selected) : null,
      catalog_size: STARS.length,
    };
  }

  visibleIds(): Set<string> { return new Set(this.visible().map((s) => s.id)); }

  /**
   * New in this port: all eighteen figures as they stand now, for the avatar's
   * state (so "show me Orion" is answered from the chart, not from memory) and
   * the chart's constellation buttons. The same rules as `showConstellation`.
   */
  figures(): FigureStatus[] {
    const visible = this.visible();
    const ids = new Set(visible.map((s) => s.id));
    return Object.keys(FIGURES).map((con) => {
      const lines = this.linesFor(con, ids);
      const name = CONSTELLATION_NAMES[con] ?? con;
      if (!lines.length) return { con, name, up: false, anchor: null, rise: this.figureRiseClause(con).replace(/^ — /, '') };
      const own = new Set(lines.flat());
      const anchor = visible.filter((s) => own.has(s.id)).reduce((a, b) => (b.mag < a.mag ? b : a));
      return { con, name, up: true, anchor, rise: '' };
    });
  }

  /** The epoch `hours` after the local midnight that starts the night the chart
   *  shows (12 to 36: noon, through midnight at 24, to the next noon). */
  onThisNight(hours: number): number {
    return epochForNight(nightOf(this.epoch, this.tz).date, hours, this.tz)!;
  }

  /**
   * When the figure can next be drawn: the first moment one of its lines has
   * both ends above the horizon, or null if none ever does from here. Not the
   * brightest star's next rise: that star can already be up while its
   * companions are down (or the figure has just set), and its next rise is then
   * tomorrow's while the figure can be drawn later tonight.
   *
   * Exact rather than searched: two stars are both up for one stretch of each
   * sidereal day, and that stretch starts when one of them rises, so the first
   * time is now or one of the two next rises.
   */
  figureRise(abbr: string): number | null {
    const up = (star: Star, epoch: number) => altAz(star.raH, star.decDeg, this.lat, this.lon, epoch)[0] > 0;
    let first: number | null = null;
    for (const [a, b] of FIGURES[abbr] ?? []) {
      const [sa, sb] = [BY_ID.get(a)!, BY_ID.get(b)!];
      const candidates = [this.epoch, nextRise(sa.raH, sa.decDeg, this.lat, this.lon, this.epoch), nextRise(sb.raH, sb.decDeg, this.lat, this.lon, this.epoch)]
        .filter((t): t is number => t !== null)
        .map((t) => (t === this.epoch ? t : t + 30))   // just after the rise, when it is above the horizon
        .sort((x, y) => x - y);
      const both = candidates.find((t) => up(sa, t) && up(sb, t));
      if (both !== undefined && (first === null || both < first)) first = both;
    }
    return first;
  }

  /** "— it rises about two in the morning" for a figure, or that it never does from here. */
  figureRiseClause(abbr: string): string {
    const rise = this.figureRise(abbr);
    return rise === null ? ' — it never rises from that latitude' : ` — it rises ${spokenHour(rise, this.tz)}`;
  }

  /** "— it rises about two in the morning", or the honest alternative ("" when
   *  it never sets). For a star that is down. */
  riseClause(star: Star): string {
    if (circumpolarity(star.decDeg, this.lat) === 'never') return ' — it never rises from that latitude';
    const rise = nextRise(star.raH, star.decDeg, this.lat, this.lon, this.epoch);
    return rise === null ? '' : ` — it rises ${spokenHour(rise, this.tz)}`;
  }

  /** How the instant reads out loud at this place: "about 9 in the evening". */
  spokenWhen(): string { return spokenHour(this.epoch, this.tz); }

  /** Everything the page draws and the director tells, from this one chart. */
  view(): SkyView {
    return { snapshot: this.snapshot(), figures: this.figures(), spokenWhen: this.spokenWhen(), solarTime: this.exact, night: nightOf(this.epoch, this.tz) };
  }

  // ─── internals ────────────────────────────────────────────────────────

  altAzOf(star: Star): [number, number] {
    return altAz(star.raH, star.decDeg, this.lat, this.lon, this.epoch);
  }

  private visible(): VisibleStar[] {
    const out: VisibleStar[] = [];
    for (const star of STARS) {   // already brightest-first, so the cap keeps the best
      const [alt, az] = this.altAzOf(star);
      if (alt <= 0) continue;
      out.push({ id: star.id, name: star.name, alt: round(alt, 1), az: round(az, 1), mag: star.mag, con: star.con });
      if (out.length >= MAX_VISIBLE) break;
    }
    return out;
  }

  /** The lines of a figure the chart can actually draw: a line with an end below
   *  the horizon has no endpoint to draw to, so it is dropped rather than sent. */
  private linesFor(abbr: string, ids: Set<string>): [string, string][] {
    return (FIGURES[abbr] ?? []).filter(([a, b]) => ids.has(a) && ids.has(b)).map(([a, b]) => [a, b]);
  }

  private figure(ids: Set<string>): Figure | null {
    if (!this.figureCon) return null;
    const lines = this.linesFor(this.figureCon, ids);
    if (!lines.length) return null;
    return { con: this.figureCon, name: CONSTELLATION_NAMES[this.figureCon] ?? this.figureCon, lines };
  }

  /** Drop anything the new sky cannot show; called after every accepted move. */
  private settle(): void {
    if (this.selected !== null) {
      const star = BY_ID.get(this.selected);
      if (!star || this.altAzOf(star)[0] <= 0) this.selected = null;
    }
    if (this.figureCon !== null && !this.linesFor(this.figureCon, this.visibleIds()).length) this.figureCon = null;
  }
}
