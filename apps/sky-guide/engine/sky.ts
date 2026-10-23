// The astronomy: sidereal time, altitude and azimuth, rising and setting.
// Ported from the original `sky.py`, closed forms unchanged.
//
// Pure functions and a table of places. No clock of its own: every function
// that needs "now" is handed an epoch (unix seconds). That is what makes the
// maths testable against closed forms, which matters more here than anywhere
// else in the app: wrong astronomy narrated confidently is this app's worst
// failure mode. A star drawn in the wrong place is obvious to anyone standing
// outside; an avatar that says Orion is up when it set two hours ago is not
// obviously wrong until the user has walked into the garden.
//
// Deliberately NOT modelled, so nobody mistakes the precision:
// - refraction (a star at the horizon is really about half a degree higher);
// - precession and proper motion (J2000 positions as they are; see catalog.ts);
// - daylight saving (places carry a fixed standard-time offset);
// - the Sun, the Moon and the planets (they need orbital elements, not a row).

/** Unix epoch as a Julian Date: 1970-01-01 00:00 UTC = JD 2440587.5. */
export const JD_UNIX_EPOCH = 2440587.5;
/** J2000.0 = 2000-01-01 12:00 TT, the origin every term below is measured from. */
export const JD_J2000 = 2451545.0;

/** Greenwich mean sidereal time at J2000, in hours, and its rate per day. These
 *  two constants are the whole of sidereal time; the tests check the first
 *  against the IAU value of 280.46061837 degrees. */
export const GMST0_HOURS = 18.697374558;
export const GMST_RATE_HOURS_PER_DAY = 24.06570982441908;

/** A latitude beyond this is inside a pole and every azimuth degenerates. */
export const MAX_LATITUDE = 89.9;

/** Something the sky cannot be asked for, with a sentence a user hears. */
export class SkyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkyError';
  }
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Python's `%`: the result has the divisor's sign. JavaScript's does not, and a
 *  negative hour angle would put a star on the wrong side of the meridian. */
export const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Python's round(): halves go to the even neighbour (round(2.5) == 2). */
export function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Unix seconds to Julian Date. */
export const julianDay = (epoch: number) => epoch / 86400 + JD_UNIX_EPOCH;

/** Greenwich mean sidereal time, in hours in [0, 24). */
export function gmstHours(epoch: number): number {
  const days = julianDay(epoch) - JD_J2000;
  return mod(GMST0_HOURS + GMST_RATE_HOURS_PER_DAY * days, 24);
}

/** Local mean sidereal time, in hours in [0, 24). East longitude positive, the
 *  convention every mapping service uses. Getting the sign wrong here mirrors
 *  the entire sky east-west, which looks plausible and is completely wrong. */
export function lstHours(epoch: number, lon: number): number {
  return mod(gmstHours(epoch) + lon / 15, 24);
}

/**
 * Where a star is in the sky: [altitude, azimuth] in degrees. Altitude is
 * degrees above the horizon (negative is below). Azimuth is measured from due
 * north through east, so 90 is east and 180 is south.
 */
export function altAz(raH: number, decDeg: number, lat: number, lon: number, epoch: number): [number, number] {
  const hourAngle = (lstHours(epoch, lon) - raH) * 15 * RAD;
  const dec = decDeg * RAD;
  const phi = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat)) * RAD;

  let sinAlt = Math.sin(dec) * Math.sin(phi) + Math.cos(dec) * Math.cos(phi) * Math.cos(hourAngle);
  sinAlt = Math.max(-1, Math.min(1, sinAlt));
  const alt = Math.asin(sinAlt);

  const cosAlt = Math.cos(alt);
  if (Math.abs(cosAlt) < 1e-9) return [alt * DEG, 0];   // straight overhead; azimuth is meaningless
  const cosAz = (Math.sin(dec) - Math.sin(alt) * Math.sin(phi)) / (cosAlt * Math.cos(phi));
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz))) * DEG;
  if (Math.sin(hourAngle) > 0) az = 360 - az;            // west of the meridian
  return [alt * DEG, mod(az, 360)];
}

/**
 * Does this star rise at all? "always", "never" or "sometimes". The two
 * extremes are not an edge case: half the catalogue is permanently invisible
 * from any given place, and telling somebody in Taipei that the Southern Cross
 * rises at two in the morning would be a confident lie.
 */
export function circumpolarity(decDeg: number, lat: number): 'always' | 'never' | 'sometimes' {
  const value = -Math.tan(lat * RAD) * Math.tan(decDeg * RAD);
  if (value < -1) return 'always';
  if (value > 1) return 'never';
  return 'sometimes';
}

/** The hour angle, in hours, at which a star crosses the horizon. */
function hourAngleAtHorizon(decDeg: number, lat: number): number | null {
  const value = -Math.tan(lat * RAD) * Math.tan(decDeg * RAD);
  if (Math.abs(value) > 1) return null;
  return (Math.acos(value) * DEG) / 15;
}

/**
 * The first instant at or after `after` when local sidereal time is
 * `targetLst`. Sidereal time runs linearly, so this is one subtraction rather
 * than a search, and being exactly linear is why the round-trip test (feed
 * the answer back into altAz and land on the horizon) checks both functions.
 */
function epochAtLst(targetLst: number, lon: number, after: number): number {
  const gap = mod(targetLst - lstHours(after, lon), 24);
  return after + (gap / GMST_RATE_HOURS_PER_DAY) * 24 * 3600;
}

/** When this star next clears the horizon (unix seconds), or null if it never
 *  does (or never sets) from there. */
export function nextRise(raH: number, decDeg: number, lat: number, lon: number, epoch: number): number | null {
  const h = hourAngleAtHorizon(decDeg, lat);
  return h === null ? null : epochAtLst(mod(raH - h, 24), lon, epoch);
}

/** When this star next drops below the horizon, or null. */
export function nextSet(raH: number, decDeg: number, lat: number, lon: number, epoch: number): number | null {
  const h = hourAngleAtHorizon(decDeg, lat);
  return h === null ? null : epochAtLst(mod(raH + h, 24), lon, epoch);
}

// ─── places and clocks ────────────────────────────────────────────────────

export interface Place { id: string; label: string; lat: number; lon: number; tz: number }

/** [id, label, latitude, longitude, standard-time offset in hours]. Offsets are
 *  STANDARD time, no daylight saving. A real offset per city rather than one
 *  derived from longitude matters: solar time in Madrid is an hour and a half
 *  off its clock, and "nine tonight" has to mean what the clock on the wall says. */
const ROWS: [string, string, number, number, number][] = [
  ['taipei', 'Taipei', 25.03, 121.56, 8.0],
  ['tokyo', 'Tokyo', 35.68, 139.65, 9.0],
  ['seoul', 'Seoul', 37.57, 126.98, 9.0],
  ['beijing', 'Beijing', 39.90, 116.41, 8.0],
  ['shanghai', 'Shanghai', 31.23, 121.47, 8.0],
  ['hong_kong', 'Hong Kong', 22.32, 114.17, 8.0],
  ['singapore', 'Singapore', 1.35, 103.82, 8.0],
  ['bangkok', 'Bangkok', 13.76, 100.50, 7.0],
  ['delhi', 'Delhi', 28.61, 77.21, 5.5],
  ['mumbai', 'Mumbai', 19.08, 72.88, 5.5],
  ['dubai', 'Dubai', 25.20, 55.27, 4.0],
  ['moscow', 'Moscow', 55.76, 37.62, 3.0],
  ['istanbul', 'Istanbul', 41.01, 28.98, 3.0],
  ['cairo', 'Cairo', 30.04, 31.24, 2.0],
  ['nairobi', 'Nairobi', -1.29, 36.82, 3.0],
  ['cape_town', 'Cape Town', -33.92, 18.42, 2.0],
  ['lagos', 'Lagos', 6.52, 3.38, 1.0],
  ['athens', 'Athens', 37.98, 23.73, 2.0],
  ['rome', 'Rome', 41.90, 12.50, 1.0],
  ['berlin', 'Berlin', 52.52, 13.40, 1.0],
  ['paris', 'Paris', 48.86, 2.35, 1.0],
  ['madrid', 'Madrid', 40.42, -3.70, 1.0],
  ['london', 'London', 51.51, -0.13, 0.0],
  ['lisbon', 'Lisbon', 38.72, -9.14, 0.0],
  ['reykjavik', 'Reykjavik', 64.15, -21.94, 0.0],
  ['new_york', 'New York', 40.71, -74.01, -5.0],
  ['toronto', 'Toronto', 43.65, -79.38, -5.0],
  ['chicago', 'Chicago', 41.88, -87.63, -6.0],
  ['mexico_city', 'Mexico City', 19.43, -99.13, -6.0],
  ['denver', 'Denver', 39.74, -104.99, -7.0],
  ['los_angeles', 'Los Angeles', 34.05, -118.24, -8.0],
  ['anchorage', 'Anchorage', 61.22, -149.90, -9.0],
  ['honolulu', 'Honolulu', 21.31, -157.86, -10.0],
  ['lima', 'Lima', -12.05, -77.04, -5.0],
  ['santiago', 'Santiago', -33.45, -70.67, -4.0],
  ['buenos_aires', 'Buenos Aires', -34.60, -58.38, -3.0],
  ['rio_de_janeiro', 'Rio de Janeiro', -22.91, -43.17, -3.0],
  ['sydney', 'Sydney', -33.87, 151.21, 10.0],
  ['melbourne', 'Melbourne', -37.81, 144.96, 10.0],
  ['perth', 'Perth', -31.95, 115.86, 8.0],
  ['auckland', 'Auckland', -36.85, 174.76, 12.0],
];

export const PLACES: readonly Place[] = ROWS.map(([id, label, lat, lon, tz]) => ({ id, label, lat, lon, tz }));
export const PLACE_LABELS: readonly string[] = PLACES.map((p) => p.label);

/** Lower-case, every separator collapsed to an underscore (the catalogue's key). */
export function key(text: unknown): string {
  return String(text ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
}

/** A place name to a place, or null. Exact match on the id or the label only: a
 *  near miss should be refused out loud, not silently rounded to whichever city
 *  sorts first. */
export function findPlace(query: unknown): Place | null {
  const k = key(query);
  if (!k) return null;
  return PLACES.find((p) => k === p.id || k === key(p.label)) ?? null;
}

/** A plausible clock offset for a bare latitude and longitude: solar time
 *  rounded to the hour (the app says "local solar time" rather than pretend). */
export const offsetForLongitude = (lon: number) => roundHalfEven(lon / 15);

/** The wall clock at a place, as UTC fields of a shifted Date. */
export function localClock(epoch: number, tzHours: number) {
  const d = new Date((epoch + tzHours * 3600) * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), weekday: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The instant as a person reads it off a clock: "9:00 pm, Fri 5 Aug". */
export function clockLabel(epoch: number, tzHours: number): string {
  const w = localClock(epoch, tzHours);
  const hour = w.hour % 12 || 12;
  const ampm = w.hour < 12 ? 'am' : 'pm';
  return `${hour}:${String(w.minute).padStart(2, '0')} ${ampm}, ${WEEKDAYS[w.weekday]} ${w.day} ${MONTHS[w.month]}`;
}

/**
 * A time the avatar can say out loud: "about half past two in the morning".
 * One change from the original: the hours either side of twelve say "midnight"
 * and "noon" (it said "about 12 in the morning" for midnight, which a voice
 * reads as noon).
 */
export function spokenHour(epoch: number, tzHours: number): string {
  const w = localClock(epoch, tzHours);
  const part = w.hour < 12 ? 'in the morning' : w.hour < 18 ? 'in the afternoon' : 'in the evening';
  // An hour on the clock face, as said: "2 in the morning", or "midnight".
  const named = (h24: number) => (h24 % 24 === 0 ? 'midnight' : h24 % 24 === 12 ? 'noon' : `${h24 % 12} ${part}`);
  if (w.minute < 8) return `about ${named(w.hour)}`;
  if (w.minute < 23) return `about quarter past ${named(w.hour)}`;
  if (w.minute < 38) return `about half past ${named(w.hour)}`;
  if (w.minute < 53) return `about quarter to ${named(w.hour + 1)}`;
  return `about ${named(w.hour + 1)}`;
}

/**
 * The next time the local clock reads `hour`, as an epoch. "Tonight" means nine
 * in the evening where the user is, not where the browser is, and it means the
 * NEXT nine, so asking at ten at night moves the sky forward twenty-three hours
 * rather than back one.
 */
export function tonight(epoch: number, tzHours: number, hour = 21): number {
  const local = Math.floor(epoch) + tzHours * 3600;
  let target = Math.floor(local / 86400) * 86400 + hour * 3600;
  if (target <= local) target += 86400;
  return target - tzHours * 3600;
}

// ─── the night as the time control shows it (new in this port) ───────────

/**
 * The night an instant belongs to, at a place: the local date of the evening
 * (2 am on the 6th belongs to the night of the 5th) and the hours since that
 * date's midnight, 12 to 36. This is what the time control's slider scrubs.
 */
export function nightOf(epoch: number, tzHours: number): { date: string; hours: number } {
  const local = epoch + tzHours * 3600;
  const evening = Math.floor((local - 12 * 3600) / 86400) * 86400;
  const d = new Date(evening * 1000);
  const date = `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { date, hours: (local - evening) / 3600 };
}

/** The epoch `hours` after local midnight starting `date` ("YYYY-MM-DD"), or null. */
export function epochForNight(date: string, hours: number, tzHours: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const midnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000;
  if (!Number.isFinite(midnight) || !Number.isFinite(hours)) return null;
  return midnight + hours * 3600 - tzHours * 3600;
}
