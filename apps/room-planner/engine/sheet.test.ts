// The drawing sheet is pure, so it can be inspected without a browser. (The
// original had no sheet tests of its own; these pin what the sheet promises.)
import { expect, test } from 'vitest';
import { briefFor, generate } from './generate.ts';
import { Home } from './home.ts';
import { escape, render } from './sheet.ts';

function drawn(): Home {
  const home = new Home(900, 700);
  generate(home.level, briefFor(2, { office: true }));
  const bedroom = [...home.level.rooms.values()].find((r) => r.kind === 'bedroom')!;
  home.level.addItem('queen bed', bedroom);
  return home;
}

test('the sheet is one well-formed SVG with every room, its area and the schedule', () => {
  const home = drawn();
  const svg = render(home);
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg.trim().endsWith('</svg>')).toBe(true);
  for (const room of home.level.rooms.values()) expect(svg).toContain(`>${room.name}</text>`);
  expect(svg).toContain('Area schedule');
  expect(svg).toContain('Ground floor &#183; 9 &#215; 7 m');
  expect((svg.match(/<svg/g) ?? []).length).toBe(1);
});

test('the sheet says it is guidance, not a regulations check, whenever it lists issues', () => {
  const home = drawn();
  home.level.openings = home.level.openings.filter((o) => o.kind !== 'window');
  expect(render(home)).toContain('Design guidance, not a building-regulations check.');
});

test('a room name cannot break the drawing', () => {
  const home = drawn();
  [...home.level.rooms.values()][0].name = 'Tom & Jo <studio>';
  const svg = render(home);
  expect(svg).toContain('Tom &amp; Jo &lt;studio&gt;');
  expect(escape('a<b>&c')).toBe('a&lt;b&gt;&amp;c');
});

test('the schedule on the sheet follows the unit the client reads in', () => {
  expect(render(drawn(), { unit: 'ft2' })).toContain('Total (ft²)');
});
