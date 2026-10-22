// What the avatar is told. Ported from the note tests of the original
// `test_table.py` (names not coordinates, the fact verbatim, no constant
// filler, the worst case measured rather than assumed), plus this port's
// limits: notes of at most 2,000 characters, a state of at most 3,858.
//
// Sky Guide has no secrets to keep (the sky is public); its equivalent of
// "never leak the answer" is "never tell the avatar a sky the chart is not
// showing": no star listed as up that is down, no number it could read out
// as a fact that is not in the catalogue.
import { describe, expect, test } from 'vitest';
import { FACTS, STARS } from './catalog.ts';
import { SkyChart } from './chart.ts';
import { NOTE_LIMIT, NOTES, say, skyState, STATE_LIMIT } from './director.ts';
import { PLACES } from './sky.ts';

const EPOCH = 1785931200;   // 2026-08-05, 8 pm in Taipei
const chart = (place = 'Taipei', epoch = EPOCH) => new SkyChart({ place, epoch });

/** The star with the longest catalogue fact that is up, marked; a figure lit. */
function heaviest(sky: SkyChart): SkyChart {
  const up = sky.snapshot().visible;
  const longest = [...up].sort((a, b) => (FACTS[b.id]?.join(' ').length ?? 0) - (FACTS[a.id]?.join(' ').length ?? 0))[0];
  if (longest) sky.select(longest.id);
  const lit = sky.figures().find((f) => f.up);
  if (lit) sky.showConstellation(lit.con);
  return sky;
}

describe('limits', () => {
  test('every note fits in 2,000 characters, and the facts are all in them, word for word', () => {
    for (const note of NOTES) expect(note.length).toBeLessThanOrEqual(NOTE_LIMIT);
    const all = NOTES.join('\n');
    for (const lines of Object.values(FACTS)) for (const line of lines) expect(all).toContain(line);
  });

  test('the worst-case state fits, measured across every place, every hour and four seasons', () => {
    // Measured rather than assumed, like the original's envelope test: the
    // longest fact marked, a figure lit, wherever the most stars are up.
    let worst = 0;
    let where = '';
    for (const place of PLACES) {
      for (let hour = 0; hour < 24; hour += 2) {
        for (const days of [0, 91, 182, 273]) {
          const text = skyState(heaviest(chart(place.label, EPOCH + hour * 3600 + days * 86400)).view());
          if (text.length > worst) [worst, where] = [text.length, `${place.label} +${hour}h +${days}d`];
        }
      }
    }
    expect(worst, where).toBeLessThanOrEqual(STATE_LIMIT);
    // And with room to spare at full detail, so the degradation below is a guard, not the norm.
    expect(worst, where).toBeLessThan(STATE_LIMIT - 200);
  });

  test('the poles and the equator fit too', () => {
    for (const lat of [90, -90, 0, 66.5]) {
      for (let hour = 0; hour < 24; hour += 3) {
        const sky = chart('Taipei', EPOCH + hour * 3600);
        sky.setPlace(null, lat, 0);
        expect(skyState(heaviest(sky).view()).length).toBeLessThanOrEqual(STATE_LIMIT);
      }
    }
  });

  test('if the catalogue ever outgrows the limit, the state degrades and still fits', () => {
    const view = heaviest(chart()).view();
    const bloated = { ...view, snapshot: { ...view.snapshot, fact: { title: 'X', lines: ['y'.repeat(2400)] } } };
    const text = skyState(bloated);
    expect(text.length).toBeLessThanOrEqual(STATE_LIMIT);
    expect(text).toContain('Every star that is up');
  });
});

describe('the state is the chart, in words', () => {
  test('it names stars and directions, never coordinates, degrees or the catalogue size key', () => {
    const text = skyState(heaviest(chart()).view());
    expect(text).not.toMatch(/\balt\b|\baz\b|degrees|°|catalog_size/);
    expect(text).toMatch(/high up|halfway up|low down|overhead/);
  });

  test('every star it lists as up is up, and every star that is up is listed (so "not listed" means "down")', () => {
    for (const place of ['Taipei', 'Sydney', 'Reykjavik']) {
      const sky = chart(place);
      const text = skyState(sky.view());
      const listed = text.slice(text.indexOf('Every star that is up'), text.indexOf('Constellation figures'));
      const up = new Set(sky.snapshot().visible.map((v) => v.name));
      for (const s of STARS) {
        const named = new RegExp(`(?:: |, )${s.name}(?:,|\\.)`).test(listed);
        expect(named, `${place}: ${s.name}`).toBe(up.has(s.name));
      }
    }
  });

  test('it stages "show me Orion": which figures are up with where to look, and which are down with when they rise', () => {
    const text = skyState(chart().view());
    expect(text).toContain('Scorpius about halfway up in the south (by Antares)');
    expect(text).toMatch(/Figures not up now: [^.]*Orion \(it rises about half past 2 in the morning\)/);
  });

  test('it carries the marked star\'s catalogue fact verbatim, and says when nothing is marked', () => {
    const sky = chart();
    expect(skyState(sky.view())).toContain('No star is marked.');
    sky.select('vega');
    const text = skyState(sky.view());
    for (const line of FACTS.vega) expect(text).toContain(line);
    expect(text).toContain('never change a number');
  });

  test('the place, the hour in words and the clock label are all there', () => {
    const text = skyState(chart().view());
    expect(text).toContain('The sky from Taipei, at about 8 in the evening (8:00 pm, Wed 5 Aug, local time)');
    const coords = chart();
    coords.setPlace(null, -33.9, 18.4);
    expect(skyState(coords.view())).toContain('local solar time');
  });
});

describe('the notes', () => {
  test('keep the hard rules: facts only from the catalogue, no planets, never degrees, never confirm a refusal', () => {
    const all = NOTES.join('\n');
    expect(all).toContain('THE ONE HARD RULE');
    expect(all).toContain('never change a number');
    expect(all).toMatch(/Sun, the Moon or the planets/);
    expect(all).toMatch(/never degrees/);
    expect(all).toContain('Never confirm a change that was refused');
  });

  test('tell the avatar it does not move the chart, and to hold for the app on another place or hour', () => {
    const all = NOTES.join('\n');
    expect(all).toContain('you cannot move the chart yourself');
    expect(all).toContain("let's have a look");
  });

  test('give the guide a job, never a name (the avatar keeps its own)', () => {
    expect(NOTES[0]).toContain('Keep whatever name and background you already have');
  });
});

describe('the opening', () => {
  test('names the place, the hour in words and the brightest stars actually up', () => {
    const sky = chart();
    const line = say.start(sky.view());
    expect(line).toContain('Taipei');
    expect(line).toContain('about 8 in the evening');
    for (const s of sky.snapshot().visible.slice(0, 3)) expect(line).toContain(s.name);
  });
});
