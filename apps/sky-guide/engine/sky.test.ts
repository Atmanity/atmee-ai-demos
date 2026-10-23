// The astronomy, pinned against things this file did not produce. Ported from
// the original `test_sky.py`.
//
// Wrong astronomy narrated confidently is this app's worst failure mode: a star
// drawn in the wrong place is obvious to anyone standing outside, but an avatar
// saying Orion is up when it set two hours ago sounds exactly like an avatar
// saying something true. So these assertions are against INDEPENDENT
// authorities rather than previous output of this module:
// - the IAU value of Greenwich mean sidereal time at J2000,
// - the closed form for the altitude of a star at upper transit (90 minus the
//   difference between latitude and declination), from spherical trigonometry,
// - from Taipei, Polaris sits at the latitude, due north,
// - the round trip: the epoch nextRise returns puts the star on the horizon.
// A regression in the sidereal constant, a sign flip on longitude or a swapped
// sine and cosine each break at least one of these.
import { describe, expect, test } from 'vitest';
import { BY_ID, STARS } from './catalog.ts';
import {
  altAz, circumpolarity, clockLabel, epochForNight, findPlace, GMST_RATE_HOURS_PER_DAY, gmstHours, localClock,
  lstHours, mod, nextRise, nextSet, nightOf, offsetForLongitude, spokenHour, tonight,
} from './sky.ts';

/** 2000-01-01 12:00:00 UTC: J2000.0 itself. */
const J2000_EPOCH = 946728000;
const TAIPEI = findPlace('Taipei')!;
const star = (id: string) => BY_ID.get(id)!;

/** The instant this star crosses the meridian at a longitude, after J2000. */
function transit(id: string, lon: number): number {
  const gap = mod(star(id).raH - lstHours(J2000_EPOCH, lon), 24);
  return J2000_EPOCH + (gap / GMST_RATE_HOURS_PER_DAY) * 24 * 3600;
}

describe('sidereal time', () => {
  test('at J2000 it matches the IAU value (the one constant everything else is built on)', () => {
    // Getting this wrong rotates the entire sky by a fixed amount, which looks
    // completely plausible on screen.
    expect(Math.abs(gmstHours(J2000_EPOCH) * 15 - 280.46061837)).toBeLessThan(0.01);
  });

  test('a sidereal day is about four minutes shorter than a solar day', () => {
    // A rate constant of 24.0 instead of 24.0657 would keep the sky still and
    // nobody would notice for a week.
    const gain = mod(gmstHours(J2000_EPOCH + 86400) - gmstHours(J2000_EPOCH), 24);
    expect(gain).toBeGreaterThan(3.5 / 60);
    expect(gain).toBeLessThan(4.5 / 60);
  });

  test('fifteen degrees of longitude is one hour, east positive (a sign flip mirrors the sky)', () => {
    const east = lstHours(J2000_EPOCH, 15);
    const greenwich = lstHours(J2000_EPOCH, 0);
    expect(Math.abs(mod(east - greenwich, 24) - 1)).toBeLessThan(1e-6);
  });
});

describe('altitude and azimuth', () => {
  test('Polaris sits at the latitude, due north, at every hour', () => {
    const polaris = star('polaris');
    for (let hour = 0; hour < 24; hour += 3) {
      const [alt, az] = altAz(polaris.raH, polaris.decDeg, TAIPEI.lat, TAIPEI.lon, J2000_EPOCH + hour * 3600);
      // Polaris is three-quarters of a degree off the true pole, so it circles by that much.
      expect(Math.abs(alt - TAIPEI.lat)).toBeLessThan(1);
      expect(Math.min(az, 360 - az)).toBeLessThan(2);
    }
  });

  test('the transit altitude matches the closed form, across hemispheres and the meridian flip', () => {
    // The azimuth branch (north of the zenith versus south of it) is the
    // easiest thing in this module to get backwards.
    for (const name of ['Taipei', 'Reykjavik', 'Sydney', 'Nairobi']) {
      const place = findPlace(name)!;
      for (const id of ['sirius', 'vega', 'arcturus', 'antares', 'acrux']) {
        const s = star(id);
        const [alt, az] = altAz(s.raH, s.decDeg, place.lat, place.lon, transit(id, place.lon));
        expect(Math.abs(alt - (90 - Math.abs(place.lat - s.decDeg))), `${name} ${id}`).toBeLessThan(0.05);
        if (alt > 0) expect(Math.min(az, 360 - az) < 0.5 || Math.abs(az - 180) < 0.5, `${name} ${id} az ${az}`).toBe(true);
      }
    }
  });

  test('azimuth is measured from north through east: a star at transit south of the zenith is at 180', () => {
    const s = star('sirius');
    const [, az] = altAz(s.raH, s.decDeg, TAIPEI.lat, TAIPEI.lon, transit('sirius', TAIPEI.lon));
    expect(Math.abs(az - 180)).toBeLessThan(0.5);
  });

  test('the altitude never leaves its range, even at the poles', () => {
    // asin of a value a hair over 1.0 is NaN, and it happens at the pole.
    for (const lat of [-89.9, -45, 0, 45, 89.9, 90, -90]) {
      for (const s of STARS.slice(0, 20)) {
        const [alt, az] = altAz(s.raH, s.decDeg, lat, 0, J2000_EPOCH);
        expect(alt).toBeGreaterThanOrEqual(-90);
        expect(alt).toBeLessThanOrEqual(90);
        expect(az).toBeGreaterThanOrEqual(0);
        expect(az).toBeLessThan(360);
        expect(Number.isNaN(az)).toBe(false);
      }
    }
  });
});

describe('rising and setting', () => {
  test('far southern stars never rise from Taipei (sampled over a day, not trusted to the helper)', () => {
    // Miaplacidus rather than Acrux on purpose: Acrux does technically clear
    // the horizon from Taipei, by under two degrees, which is exactly the kind
    // of thing an app that guessed would get wrong in the reassuring direction.
    const s = star('miaplacidus');
    expect(circumpolarity(s.decDeg, TAIPEI.lat)).toBe('never');
    for (let minutes = 0; minutes < 24 * 60; minutes += 20) {
      expect(altAz(s.raH, s.decDeg, TAIPEI.lat, TAIPEI.lon, J2000_EPOCH + minutes * 60)[0]).toBeLessThan(0);
    }
    expect(nextRise(s.raH, s.decDeg, TAIPEI.lat, TAIPEI.lon, J2000_EPOCH)).toBeNull();
  });

  test('Polaris never sets from Taipei', () => {
    expect(circumpolarity(star('polaris').decDeg, TAIPEI.lat)).toBe('always');
  });

  test('the rise time lands the star on the horizon, rising in the east (the round trip)', () => {
    for (const id of ['sirius', 'vega', 'antares', 'regulus', 'fomalhaut']) {
      const s = star(id);
      const rise = nextRise(s.raH, s.decDeg, TAIPEI.lat, TAIPEI.lon, J2000_EPOCH)!;
      expect(rise, id).not.toBeNull();
      expect(rise).toBeGreaterThanOrEqual(J2000_EPOCH);
      expect(rise).toBeLessThanOrEqual(J2000_EPOCH + 86400 * 1.01);
      const [alt, az] = altAz(s.raH, s.decDeg, TAIPEI.lat, TAIPEI.lon, rise);
      expect(Math.abs(alt), id).toBeLessThan(0.2);
      expect(az > 0 && az < 180, `${id} az ${az}`).toBe(true);
    }
  });

  test('setting is the mirror of rising: on the horizon, in the west', () => {
    for (const id of ['sirius', 'vega', 'regulus']) {
      const s = star(id);
      const drop = nextSet(s.raH, s.decDeg, TAIPEI.lat, TAIPEI.lon, J2000_EPOCH)!;
      const [alt, az] = altAz(s.raH, s.decDeg, TAIPEI.lat, TAIPEI.lon, drop);
      expect(Math.abs(alt)).toBeLessThan(0.2);
      expect(az > 180 && az < 360, `${id} az ${az}`).toBe(true);
    }
  });

  test('ten minutes after it rises, a star is higher, not lower (the direction of time itself)', () => {
    const s = star('sirius');
    const rise = nextRise(s.raH, s.decDeg, TAIPEI.lat, TAIPEI.lon, J2000_EPOCH)!;
    expect(altAz(s.raH, s.decDeg, TAIPEI.lat, TAIPEI.lon, rise + 600)[0]).toBeGreaterThan(0.5);
  });
});

describe('clocks', () => {
  test('"tonight" is the NEXT nine in the evening locally, from every hour of the day', () => {
    // Asking at ten at night must move the sky forward twenty-three hours, not
    // back one: "tonight" always means a sky that has not happened yet.
    for (let offset = 0; offset < 24; offset++) {
      const base = 1785935000 + offset * 3600;
      const target = tonight(base, TAIPEI.tz);
      expect(target).toBeGreaterThan(base);
      expect(localClock(target, TAIPEI.tz).hour).toBe(21);
      expect(target - base).toBeLessThanOrEqual(86400);
    }
  });

  test('a half-hour offset works too (Delhi is +5:30)', () => {
    const target = tonight(1785935000, 5.5, 0);
    expect(localClock(target, 5.5)).toMatchObject({ hour: 0, minute: 0 });
  });

  test("the clock label uses the place's offset, not the browser's", () => {
    const epoch = 1785886000;
    expect(clockLabel(epoch, 8)).not.toBe(clockLabel(epoch, 0));
    expect(clockLabel(1785931200, 8)).toBe('8:00 pm, Wed 5 Aug');
  });

  test('the spoken hour never has a colon in it (it is read out loud)', () => {
    for (let minute = 0; minute < 60; minute += 7) {
      const text = spokenHour(1785886000 + minute * 60, 8);
      expect(text).not.toContain(':');
      expect(text.startsWith('about ')).toBe(true);
    }
  });

  test('the spoken hour says midnight and noon rather than "12 in the morning" (new in this port)', () => {
    const midnight = tonight(1785935000, 8, 0);
    expect(spokenHour(midnight, 8)).toBe('about midnight');
    expect(spokenHour(midnight + 15 * 60, 8)).toBe('about quarter past midnight');
    expect(spokenHour(midnight - 15 * 60, 8)).toBe('about quarter to midnight');
    expect(spokenHour(midnight + 12 * 3600, 8)).toBe('about noon');
    expect(spokenHour(midnight + 2.5 * 3600, 8)).toBe('about half past 2 in the morning');
    expect(spokenHour(midnight - 3 * 3600, 8)).toBe('about 9 in the evening');
  });

  test('a bare longitude gets solar time, rounded as Python rounds (half to even)', () => {
    expect(offsetForLongitude(121.56)).toBe(8);
    expect(offsetForLongitude(-74)).toBe(-5);
    expect(offsetForLongitude(22.5)).toBe(2);   // 1.5 -> 2
    expect(offsetForLongitude(37.5)).toBe(2);   // 2.5 -> 2, not 3
  });
});

describe('the night, for the time control (new in this port)', () => {
  test('2 am belongs to the night before, and the hours run 12 to 36', () => {
    const evening = tonight(1785935000, 8);                // 9 pm local
    expect(nightOf(evening, 8)).toEqual({ date: nightOf(evening + 5 * 3600, 8).date, hours: 21 });
    expect(nightOf(evening + 5 * 3600, 8).hours).toBe(26); // 2 am, the same night
  });

  test('a night and an hour come back to the same instant', () => {
    const epoch = tonight(1785935000, -5) + 3 * 3600;
    const { date, hours } = nightOf(epoch, -5);
    expect(epochForNight(date, hours, -5)).toBe(epoch);
    expect(epochForNight('not a date', 21, 0)).toBeNull();
  });
});
