// The chart's rules: what it refuses, and what its projection does and does
// not carry. Ported from the original `test_chart.py`, named after the symptom
// each one prevents. The astronomy itself is pinned in sky.test.ts.
import { describe, expect, test } from 'vitest';
import { BY_ID, FACTS, factFor, FIGURES, STARS } from './catalog.ts';
import { MAX_VISIBLE, SkyChart } from './chart.ts';
import { altAz, PLACES, SkyError, spokenHour } from './sky.ts';

// 2026-08-05, 8 pm in Taipei. Fixed so nothing here depends on when the suite
// runs: a sky test with a live clock passes for months and then fails on the
// night the star it asserted about happens to be down.
const EPOCH = 1785931200;

const chart = (place = 'Taipei', epoch = EPOCH) => new SkyChart({ place, epoch });

function refusal(fn: () => void): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof SkyError) return err.message;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('only what is above the horizon travels', () => {
  test('the snapshot carries the stars that are up, with positions worked out and nothing to work them out from', () => {
    const snapshot = chart().snapshot();
    const ids = new Set(snapshot.visible.map((s) => s.id));
    expect(ids.size).toBeGreaterThan(0);
    expect(ids.size).toBeLessThan(STARS.length);
    for (const s of snapshot.visible) {
      expect(s.alt).toBeGreaterThan(0);
      expect(Object.keys(s).sort()).toEqual(['alt', 'az', 'con', 'id', 'mag', 'name']);
    }
  });

  test('the visible list is capped and keeps the brightest', () => {
    // A cap that dropped Sirius to keep a fourth-magnitude filler would be worse than no cap.
    const mags = chart().snapshot().visible.map((s) => s.mag);
    expect(mags.length).toBeLessThanOrEqual(MAX_VISIBLE);
    expect(mags).toEqual([...mags].sort((a, b) => a - b));
  });

  test('positions are rounded to a tenth of a degree (no refraction, no precession: no more accuracy than that)', () => {
    for (const s of chart().snapshot().visible) {
      expect(Math.round(s.alt * 10) / 10).toBe(s.alt);
      expect(Math.round(s.az * 10) / 10).toBe(s.az);
    }
  });
});

describe('refusals, each by the sentence the user hears', () => {
  test('an unknown place is refused by name', () => {
    const message = refusal(() => chart().setPlace('Rivendell'));
    expect(message).toContain('Rivendell');
    expect(message).toContain('latitude');
  });

  test('a latitude or longitude off the globe is refused', () => {
    expect(refusal(() => chart().setPlace(null, 120, 20))).toContain('minus ninety');
    expect(refusal(() => chart().setPlace(null, 20, 400))).toContain('hundred and eighty');
  });

  test('a star that is down is refused with when it rises', () => {
    // "Sirius is below the horizon" on its own leaves the user with nothing to do about it.
    const sky = chart();
    const down = STARS.find((s) => sky.altAzOf(s)[0] <= 0 && s.decDeg > -30)!;
    const message = refusal(() => sky.select(down.name));
    expect(message).toContain(down.name);
    expect(message).toContain('below the horizon');
    expect(message).toContain('rises');
  });

  test('a star that never rises says so rather than inventing a time', () => {
    // From Taipei, Miaplacidus does not rise at two in the morning; it does not rise.
    expect(refusal(() => chart().select('Miaplacidus'))).toContain('never rises');
  });

  test('an unknown star is refused rather than guessed', () => {
    const message = refusal(() => chart().select('Vogsphere'));
    expect(message).toContain('Vogsphere');
    expect(message).toContain('catalogue');
  });

  test('a constellation that is down says when it rises', () => {
    // Orion is a winter constellation; in August at eight in the evening it is
    // firmly below the horizon from Taipei.
    const message = refusal(() => chart().showConstellation('Orion'));
    expect(message).toContain('Orion');
    expect(message.includes('rises') || message.includes('never')).toBe(true);
  });

  test('a constellation with no figure is refused rather than drawn empty', () => {
    expect(refusal(() => chart().showConstellation('Hydra'))).toContain('figure');
  });

  test('an unknown constellation is refused', () => {
    expect(refusal(() => chart().showConstellation('Sagitta'))).toContain('Sagitta');
  });

  test('a time outside the charted range is refused, not clamped', () => {
    // Silently showing a different night than the one asked for is the failure this app exists to avoid.
    expect(refusal(() => chart().setTime({ epoch: 99999999999 }))).toContain('nineteen hundred');
  });

  test('an absurd shift is refused', () => {
    expect(refusal(() => chart().setTime({ shiftHours: 100000 }))).toContain('year');
  });

  test('an unknown time word is refused by name', () => {
    expect(refusal(() => chart().setTime({ preset: 'yesterday' }))).toContain('yesterday');
  });

  test('a star that is not in the catalogue is still refused by name', () => {
    expect(refusal(() => chart().select('Zorblax'))).toContain('Zorblax');
  });
});

describe('the sky settling after a change', () => {
  test('a selection that sets is dropped rather than left pointing at the ground', () => {
    const sky = chart();
    const up = sky.snapshot().visible[0];
    sky.select(up.id);
    expect(sky.snapshot().selected).toBe(up.id);
    sky.setTime({ shiftHours: 12 });
    const snapshot = sky.snapshot();
    expect(snapshot.selected === null || snapshot.visible.some((s) => s.id === snapshot.selected)).toBe(true);
  });

  test('a figure is drawn with only the lines the chart can draw', () => {
    const sky = chart();
    for (const abbr of Object.keys(FIGURES)) {
      try {
        sky.showConstellation(abbr);
      } catch (err) {
        if (err instanceof SkyError) continue;
        throw err;
      }
      const snapshot = sky.snapshot();
      expect(snapshot.figure).not.toBeNull();
      const ids = new Set(snapshot.visible.map((s) => s.id));
      for (const [a, b] of snapshot.figure!.lines) expect(ids.has(a) && ids.has(b)).toBe(true);
    }
  });

  test('moving the observer keeps the instant', () => {
    // An instant is an instant: Taipei to London re-labels the same moment
    // rather than jumping the sky twelve hours.
    const sky = chart();
    const before = sky.snapshot().when.epoch;
    sky.setPlace('London');
    const after = sky.snapshot();
    expect(after.when.epoch).toBe(before);
    expect(after.where.label).toBe('London');
    expect(after.when.label).toMatch(/(am|pm),/);
  });

  test('raw coordinates get a readable label', () => {
    const sky = chart();
    sky.setPlace(null, -33.9, 18.4);
    expect(sky.snapshot().where.label).toBe('33.9°S 18.4°E');
    expect(sky.exact).toBe(true);
  });

  test('a refused intent leaves the sky untouched (validate before mutate)', () => {
    const sky = chart();
    const before = sky.snapshot();
    for (const call of [
      () => sky.setPlace('Rivendell'),
      () => sky.select('Vogsphere'),
      () => sky.showConstellation('Sagitta'),
      () => sky.setTime({ shiftHours: 1e9 }),
      () => sky.setPlace(null, 'north', 20),
    ]) {
      try { call(); } catch (err) { if (!(err instanceof SkyError)) throw err; }
    }
    expect(sky.snapshot()).toEqual(before);
  });
});

describe('facts', () => {
  test('selecting carries the catalogue fact and nothing invented', () => {
    const sky = chart();
    const s = sky.snapshot().visible.find((v) => FACTS[v.id])!;
    sky.select(s.id);
    const fact = sky.snapshot().fact!;
    expect(fact.title).toBe(s.name);
    expect(fact.lines).toContain(FACTS[s.id][0]);
  });

  test('every star has a fact even without an authored one (an empty fact is a silence the model fills)', () => {
    for (const s of STARS) expect(factFor(s.id)?.lines.length, s.id).toBeGreaterThan(0);
  });

  test('clearing the selection clears the fact', () => {
    const sky = chart();
    sky.select(sky.snapshot().visible[0].id);
    sky.clearSelection();
    expect(sky.snapshot().fact).toBeNull();
  });

  test('"that bright one" marks the brightest star actually UP instead of dead-ending', () => {
    // Found in live testing: the panel printed 'Or just say it: "what's that
    // bright one"' and saying exactly that got "I don't have any specific facts
    // about that one". The app was refusing the words it printed on screen.
    const sky = chart();
    for (const phrase of ['that bright one', 'brightest', 'the brightest star']) {
      sky.clearSelection();
      sky.select(phrase);
      const snapshot = sky.snapshot();
      expect(snapshot.fact, phrase).not.toBeNull();
      const up = snapshot.visible;
      expect(sky.selected).toBe(up.reduce((a, b) => (b.mag < a.mag ? b : a)).id);
    }
  });
});

describe('the figures at a glance (new in this port: the state and the buttons read it)', () => {
  test('every figure is listed, up with its brightest star on the chart, or down with when it rises', () => {
    const sky = chart();
    const figures = sky.figures();
    expect(figures.map((f) => f.con)).toEqual(Object.keys(FIGURES));
    for (const f of figures) {
      if (f.up) {
        expect(sky.snapshot().visible.some((v) => v.id === f.anchor!.id)).toBe(true);
        expect(f.rise).toBe('');
      } else {
        expect(f.anchor).toBeNull();
        expect(() => sky.showConstellation(f.con)).toThrow(SkyError);
      }
    }
    const orion = figures.find((f) => f.con === 'Ori')!;
    expect(orion.up).toBe(false);
    expect(orion.rise).toMatch(/^it rises about /);
    const scorpius = figures.find((f) => f.con === 'Sco')!;
    expect(scorpius).toMatchObject({ up: true, anchor: { id: 'antares' } });
  });

  test('"up" means the same thing to the list and to showConstellation', () => {
    for (const place of ['Taipei', 'Sydney', 'Reykjavik', 'Singapore']) {
      for (let hour = 0; hour < 24; hour += 3) {
        const sky = chart(place, EPOCH + hour * 3600);
        for (const f of sky.figures()) {
          let accepted = true;
          try { sky.showConstellation(f.con); } catch { accepted = false; }
          expect(accepted, `${place} +${hour}h ${f.con}`).toBe(f.up);
        }
      }
    }
  });

  test('a figure rises when one of its lines can first be drawn, not when its brightest star next rises', () => {
    // The brightest star can already be up while its companions are still
    // down (or the figure has just set): its NEXT rise is then tomorrow's,
    // while the figure can be drawn later tonight. Checked against a minute-
    // by-minute search of when a line first has both ends above the horizon.
    const firstDrawable = (sky: SkyChart, con: string) => {
      const up = (id: string, t: number) => { const s = BY_ID.get(id)!; return altAz(s.raH, s.decDeg, sky.lat, sky.lon, t)[0] > 0; };
      for (let t = sky.epoch; t < sky.epoch + 26 * 3600; t += 60) if (FIGURES[con].some(([a, b]) => up(a, t) && up(b, t))) return t;
      return null;
    };
    let brightestAlreadyUp = 0;
    for (const place of PLACES.filter((_, i) => i % 2 === 0)) {
      for (let hour = 0; hour < 24; hour += 3) {
        const sky = chart(place.label, EPOCH + hour * 3600);
        const ids = sky.visibleIds();
        for (const f of sky.figures().filter((x) => !x.up)) {
          const brightest = STARS.find((s) => s.con === f.con)!;
          if (!ids.has(brightest.id)) continue;   // the case the brightest star's rise got wrong
          brightestAlreadyUp++;
          const t = firstDrawable(sky, f.con);
          const said = f.rise;
          const near = t === null ? ['it never rises from that latitude'] : [t - 420, t, t + 420].map((x) => `it rises ${spokenHour(x, sky.tz)}`);
          expect(near, `${place.label} +${hour}h ${f.name}: "${said}"`).toContain(said);
        }
      }
    }
    expect(brightestAlreadyUp, 'the fixture must exercise the case').toBeGreaterThan(5);
  });

  test('a figure never seen from a latitude says so', () => {
    const crux = chart('Reykjavik').figures().find((f) => f.con === 'Cru')!;
    expect(crux.rise).toBe('it never rises from that latitude');
    expect(BY_ID.get('acrux')).toBeTruthy();
  });
});
