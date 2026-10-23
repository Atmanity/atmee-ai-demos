// What the host is told. The tools and instructions against the API's limits;
// the live chart (state) against its size limit and against the chart itself;
// the results' wording. Ported from the note tests of the original
// `test_table.py`: names not coordinates, the fact verbatim, the worst case
// measured rather than assumed.
//
// Lodestar has no secrets to keep (the sky is public); its equivalent of
// "never leak the answer" is "never tell the host a sky the chart is not
// showing": no star listed as up that is down, no fact that is not the
// catalogue's, no direction that is not the chart's.
import { describe, expect, test } from 'vitest';
import { FACTS, STARS } from './catalog.ts';
import { SkyChart } from './chart.ts';
import { INSTRUCTIONS, said, skyState, STATE_LIMIT, TOOLS } from './director.ts';
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

describe('the tools fit the API', () => {
  test('names, descriptions, schemas, modes and timeouts', () => {
    expect(TOOLS.length).toBeLessThanOrEqual(30);
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of TOOLS) {
      expect(tool.type).toBe('function');
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
      expect(['web_search', 'lookup']).not.toContain(tool.name);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeLessThanOrEqual(500);
      expect(tool.parameters.type).toBe('object');
      expect(JSON.stringify(tool.parameters).length).toBeLessThanOrEqual(4096);
      expect(['await', 'notify']).toContain(tool['x-atmee']?.mode);
      expect(tool['x-atmee']?.timeoutSeconds ?? 8).toBeLessThanOrEqual(28);
    }
    expect(JSON.stringify(TOOLS).length).toBeLessThanOrEqual(24576);
  });

  test('every tool waits for the chart, so the host speaks from its outcome', () => {
    const mode = Object.fromEntries(TOOLS.map((t) => [t.name, t['x-atmee']?.mode]));
    expect(mode).toEqual({ point_out: 'await', show_constellation: 'await', move_chart: 'await', clear_chart: 'await' });
  });

  test('the schemas are lenient: a call that does not fit never reaches the page', () => {
    // Causeur answers "invalid arguments" to the model for a call that breaks
    // the schema, and the host then often says the action happened anyway.
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      for (const banned of ['enum', 'pattern', 'format', 'minLength', 'additionalProperties']) expect(o, banned).not.toHaveProperty(banned);
      if (typeof o.maxLength === 'number') expect(o.maxLength).toBeGreaterThanOrEqual(500);
      Object.values(o).forEach(walk);
    };
    for (const tool of TOOLS) walk(tool.parameters);
    const required = Object.fromEntries(TOOLS.map((t) => [t.name, (t.parameters as { required?: string[] }).required ?? []]));
    expect(required).toEqual({ point_out: ['star'], show_constellation: ['name'], move_chart: [], clear_chart: [] });
  });

  test('the instructions fit, name every tool, and keep the hard rules', () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(4000);
    for (const tool of TOOLS) expect(INSTRUCTIONS).toContain(tool.name);
    expect(INSTRUCTIONS).toContain('FACTS, THE HARD RULE');
    expect(INSTRUCTIONS).toContain('never change a number');
    expect(INSTRUCTIONS).toMatch(/no Sun, Moon or planets/);
    expect(INSTRUCTIONS).toMatch(/never degrees/);
    expect(INSTRUCTIONS).toContain('never claim the change happened');
    expect(INSTRUCTIONS).toContain('The chart changes only when you call a tool');
    expect(INSTRUCTIONS).toContain('Every request that changes the chart is a tool call, even a single word answering your own question');
    expect(INSTRUCTIONS).toContain("never say a change happened unless the tool's result says so");
    expect(INSTRUCTIONS).toContain('never of a system, an app or a tool');
    expect(INSTRUCTIONS).toContain('call the tool only if they say yes');
    expect(INSTRUCTIONS).toMatch(/clear_chart, and only then/);
  });

  test('the guide is given a job, never a name (the host keeps its own persona)', () => {
    expect(INSTRUCTIONS).not.toMatch(/\bMira\b/);
  });
});

describe('the live chart fits', () => {
  test('the worst case, measured across every place, every hour and four seasons', () => {
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
    expect(worst, where).toBeLessThan(STATE_LIMIT - 150);
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

describe('the live chart is the chart, in words', () => {
  test('it names stars and directions, never coordinates, degrees or field names', () => {
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

  test('which figures are up with where to look, and which are down with when they rise', () => {
    const text = skyState(chart().view());
    expect(text).toContain('Scorpius about halfway up in the south (by Antares)');
    expect(text).toMatch(/Figures not up now: [^.]*Orion \(it rises about quarter past 2 in the morning\)/);
  });

  test('the marked star\'s catalogue fact verbatim, or that nothing is marked', () => {
    const sky = chart();
    expect(skyState(sky.view())).toContain('No star is marked.');
    sky.select('vega');
    const text = skyState(sky.view());
    for (const line of FACTS.vega) expect(text).toContain(line);
    expect(text).toContain('never change a number');
  });

  test('the place, the hour in words and the clock; solar time for coordinates; daytime said', () => {
    expect(skyState(chart().view())).toContain('The sky from Taipei, at about 8 in the evening (8:00 pm, Wed 5 Aug, local time)');
    const coords = chart();
    coords.setPlace(null, -33.9, 18.4);
    expect(skyState(coords.view())).toContain('local solar time');
    expect(skyState(chart().view())).not.toContain('daytime');
    expect(skyState(chart('Taipei', EPOCH - 8 * 3600).view())).toContain('It is daytime there');
  });
});

describe('the results', () => {
  test('the opening names the place, the hour in words and the brightest stars actually up', () => {
    const sky = chart();
    const line = said.opening(sky.view());
    expect(line).toMatch(/^You have just greeted them; do not greet or introduce yourself again\. /);
    expect(line).not.toMatch(/[Ww]elcome/);
    expect(line).toContain('Taipei');
    expect(line).toContain('about 8 in the evening');
    for (const s of sky.snapshot().visible.slice(0, 3)) expect(line).toContain(s.name);
  });

  test('a marked star carries the catalogue\'s words and where to look, never degrees', () => {
    const sky = chart();
    sky.select('vega');
    const text = said.marked(sky.view(), false);
    expect(text).toContain(FACTS.vega[0]);
    expect(text).toContain('changing no number');
    expect(text).toMatch(/^Marked: Vega, (?:high up|almost straight overhead|about halfway up|low down) in the/);
    expect(text).not.toContain('degrees');
  });

  test('a drawn figure says where it actually is (Scorpius, by Antares, halfway up in the south)', () => {
    // Symptom in the original: "show me Scorpius" and the guide said low in the
    // north-west while the chart drew it halfway up in the south.
    const sky = chart();
    sky.showConstellation('Scorpius');
    const text = said.drawn(sky.view());
    expect(text).toContain('Antares');
    expect(text).toContain('halfway up in the south');
    expect(text).toContain('using that direction and no other');
  });

  test('no result asks the host to act on its own: an offer is made, and acted on only if they ask', () => {
    const sky = chart();
    sky.select('vega');
    const texts = [
      said.opening(sky.view()), said.marked(sky.view(), true), said.starDown('X is below the horizon.', ['A line.'], 'by about 3 in the morning'),
      said.unknownStar('I don\'t have X.', 'Vega'), said.notAStar('Jupiter', 'Vega'), said.figureDown('Orion isn\'t up.', 'by about 3 in the morning'),
      said.noFigure('No figure.'), said.moved(sky.view(), sky.view()), said.unchanged(sky.view()), said.daytime(sky.view()),
      said.refused('no'), said.unreadTime('whenever'), said.nothingToMove(), said.noName('star'), said.cleared('everything'),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/\b(?:call|calling) (?:point_out|show_constellation|move_chart|clear_chart)\b/);
      if (/\boffer to show\b|offer tonight/.test(text)) expect(text).toContain('only if they ask');
    }
  });

  test('a refusal is to be said, and never confirmed', () => {
    expect(said.refused('Kyoto is not a place I know')).toBe('Refused: Kyoto is not a place I know. Say that in one short line, in your own voice, and do not claim it happened.');
  });
});
