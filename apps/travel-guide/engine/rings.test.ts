// Ported from test_staticmap.py (the outline half) and test_mainland_map.py.
// The static-image tests (zoom, endpoint template, storage) are gone with the
// static image: the page draws real tiles and Leaflet fits the bounds itself.
import { describe, expect, test } from 'vitest';
import { countryOutline, mainlandRings, outerRings, primaryBbox } from './rings.ts';

const ring = (points: number, radius = 5): number[][] => [
  ...Array.from({ length: points }, (_, i) => [radius * Math.cos((2 * Math.PI * i) / points), radius * Math.sin((2 * Math.PI * i) / points)]),
  [radius, 0],
];

describe('outline', () => {
  test('a polygon becomes drawable rings', () => {
    const outline = countryOutline({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] });
    expect(outline![0][0]).toEqual([0, 0]);
    expect(outline).toHaveLength(1);
  });

  test('holes are dropped but islands are kept', () => {
    const outline = countryOutline({
      type: 'MultiPolygon',
      coordinates: [
        [ring(8), ring(8, 1)], // mainland with a lake
        [ring(6, 0.5)], // an island
      ],
    });
    expect(outline).toHaveLength(2); // the lake is not one of them
  });

  test('a huge coastline is shrunk to fit the budget', () => {
    // Norway-shaped: one enormous ring. Unsimplified this is far past any budget.
    const geojson = { type: 'Polygon', coordinates: [Array.from({ length: 40000 }, (_, i) => [i * 0.001, i * 0.0007])] };
    const outline = countryOutline(geojson, 4000);
    expect(outline).not.toBeNull();
    expect(JSON.stringify({ rings: outline }).length).toBeLessThanOrEqual(4000);
    expect(outline![0].length).toBeGreaterThanOrEqual(4); // still a shape, not a line
  });

  test('a simplified ring stays closed', () => {
    // Losing the last vertex draws a straight line across the country.
    const outline = countryOutline({ type: 'Polygon', coordinates: [ring(500)] }, 600);
    const r = outline![0];
    expect(r[r.length - 1]).toEqual([5, 0]);
  });

  test('a silhouette for the trip strip fits its tiny budget', () => {
    const outline = countryOutline({ type: 'Polygon', coordinates: [ring(3000)] }, 1200);
    expect(JSON.stringify({ rings: outline }).length).toBeLessThanOrEqual(1200);
  });

  test.each([null, {}, 'a string', { type: 'Point', coordinates: [1, 2] }, { type: 'Polygon', coordinates: [] }])('an outline it cannot draw is null: %j', (geojson) => {
    expect(countryOutline(geojson)).toBeNull();
  });
});

// "Asking for Norway must not draw the whole world." Found by playing the app:
// Norway's administrative bbox runs from Bouvet Island at -54.6° to Svalbard at
// +81.0°, France's from -178° to 172° (French Polynesia). The map fits the main
// landmass instead.
const box = (minLon: number, minLat: number, maxLon: number, maxLat: number) => [
  [minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat],
];
const detailed = (minLon: number, minLat: number, maxLon: number, maxLat: number, n = 200) => {
  const r = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [minLon + (maxLon - minLon) * t, minLat + (maxLat - minLat) * t];
  });
  r.push(r[0]);
  return r;
};

const NORWAY = {
  type: 'MultiPolygon',
  coordinates: [
    [detailed(4.6, 57.9, 31.1, 71.2)], // mainland
    [box(10.4, 76.4, 33.5, 80.8)], // Svalbard
    [box(3.2, -54.5, 3.5, -54.4)], // Bouvet Island
  ],
};
const FRANCE = {
  type: 'MultiPolygon',
  coordinates: [
    [detailed(-5.1, 41.3, 9.6, 51.1)], // metropolitan France
    [box(-178.4, -14.6, -176.1, -13.2)], // Wallis and Futuna
    [box(-54.6, 2.1, -51.6, 5.8)], // French Guiana
  ],
};

describe('the mainland', () => {
  test('Norway is not drawn as the whole world', () => {
    const administrative: [number, number, number, number] = [-54.654, -9.6846279, 81.0280176, 34.6889114];
    const [minLat, , maxLat] = primaryBbox(NORWAY, administrative)!;
    expect(minLat, 'Bouvet Island must not drag the box into the south Atlantic').toBeGreaterThan(50);
    expect(maxLat, 'Svalbard must not drag it to the pole').toBeLessThan(75);
  });

  test('France is not drawn as the whole world', () => {
    // Its real bbox wraps the dateline; it is the worst case.
    const [, minLon, , maxLon] = primaryBbox(FRANCE, [-50.2187169, -178.3873749, 51.3055721, 172.3057152])!;
    expect(maxLon - minLon, 'metropolitan France is about 15 degrees wide').toBeLessThan(30);
  });

  test('an island near the coast is still drawn', () => {
    const geojson = { type: 'MultiPolygon', coordinates: [[detailed(0, 0, 10, 10)], [box(10.5, 4, 11.5, 5)]] };
    expect(mainlandRings(outerRings(geojson))).toHaveLength(2);
    expect(primaryBbox(geojson)![3], 'the offshore island belongs inside the fitted box').toBeGreaterThan(10);
  });

  test('a country that is one piece is left alone', () => {
    const geojson = { type: 'Polygon', coordinates: [detailed(4.6, 57.9, 31.1, 71.2)] };
    expect(mainlandRings(outerRings(geojson))).toHaveLength(1);
    expect(primaryBbox(geojson)).toEqual([57.9, 4.6, 71.2, 31.1]);
  });

  test('no geometry falls back to the box we already had', () => {
    const fallback: [number, number, number, number] = [1, 2, 3, 4];
    expect(primaryBbox(null, fallback)).toEqual(fallback);
    expect(primaryBbox({ type: 'Point' }, fallback)).toEqual(fallback);
  });

  test('the drawn outline drops the far-flung pieces too', () => {
    // The outline takes its extent from the rings, so it had the same bug.
    const lats = countryOutline(NORWAY)!.flat().map(([, lat]) => lat);
    expect(Math.min(...lats)).toBeGreaterThan(50);
    expect(Math.max(...lats)).toBeLessThan(75);
  });

  test('a degenerate mainland still has a finite box', () => {
    const fitted = primaryBbox({ type: 'Polygon', coordinates: [[[5, 5], [5, 5], [5, 5]]] });
    expect(fitted!.every(Number.isFinite)).toBe(true);
  });
});
