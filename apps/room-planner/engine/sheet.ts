// The drawing sheet: the plan as something a designer would hand a client.
//
// Pure: a home in, SVG text out, so the sheet can be rendered and inspected in
// a test. In the original the agent rendered it and stored it, because the
// sandboxed panel could display a file but never hand one over. On the API the
// page renders it itself and offers it as a download.
import { issues as computeIssues, schedule, type Issue, type Schedule } from './compliance.ts';
import { areaM2, bbox, boundary, strips } from './geom.ts';
import type { Home, Level } from './home.ts';
import { fmtG, pyRound } from './num.ts';

export const WIDTH = 1680;
export const HEIGHT = 1120;
const MARGIN = 48;
const PLAN_W = 1080;
const TITLE_H = 96;

// Planwright's drafting look, readable in print: graphite line work on white
// paper, a non-photo-blue rule, redline for what is wrong, rooms as pale tints
// by use (the same as on screen, so the sheet and the plan agree).
const INK = '#22262a';
const PAPER = '#fbfbf8';
const RULE = '#cfd6d0';
const ACCENT = '#c23d24';
const FURNITURE = '#d9c4a3';
const FURNITURE_EDGE = '#8c7350';
const GLASS = '#7cc0e8';

export const ROOM_FILL: Record<string, string> = {
  living: '#e4eee8', dining: '#ebefe0', kitchen: '#e0edee',
  bedroom: '#e6ebf5', bedroom_single: '#e6ebf5', nursery: '#eee8f4',
  office: '#ebe8f3', bathroom: '#dceff2', shower_room: '#dceff2',
  wc: '#dceff2', utility: '#e4ecec', entry: '#f0f1ee',
  hall: '#f0f1ee', corridor: '#f0f1ee', stairs: '#e3e7e9',
  storage: '#ecece8', closet: '#ecece8', balcony: '#e2f0e7',
  other: '#efefeb',
};

/** XML text escaping, as xml.sax.saxutils.escape does it. */
export const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const titleCase = (text: string) => text.replace(/\b\w/g, (c) => c.toUpperCase());

/** The whole sheet: title block, plan, schedule, and what is wrong with it. */
export function render(home: Home, { title = 'Planwright', unit = 'm2' as 'm2' | 'ft2' } = {}): string {
  const level = home.level;
  const table = schedule(home, unit);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="Helvetica, Arial, sans-serif">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}"/>`,
    ...titleBlock(title, level, table),
    ...plan(level),
    ...scheduleBlock(table),
    ...issueBlock(computeIssues(home)),
    '</svg>',
  ];
  return parts.join('\n');
}

function titleBlock(title: string, level: Level, table: Schedule): string[] {
  const unitLabel = table.unit === 'ft2' ? 'ft²' : 'm²';
  return [
    `<text x="${MARGIN}" y="56" font-size="30" font-weight="700" fill="${INK}">${escape(title)}</text>`,
    `<text x="${MARGIN}" y="82" font-size="16" fill="${INK}" opacity="0.75">${escape(titleCase(level.name))} floor &#183; ${fmtG(level.w_cm / 100)} &#215; ${fmtG(level.h_cm / 100)} m &#183; ${level.rooms.size} rooms &#183; ${fmtG(table.total)} ${unitLabel} (${table.circulation_pct}% circulation)</text>`,
    `<line x1="${MARGIN}" y1="${TITLE_H}" x2="${WIDTH - MARGIN}" y2="${TITLE_H}" stroke="${RULE}" stroke-width="2"/>`,
  ];
}

function plan(level: Level): string[] {
  const top = TITLE_H + 40;
  const availH = HEIGHT - top - MARGIN - 60;
  const scale = Math.min(PLAN_W / Math.max(level.w_cm, 1), availH / Math.max(level.h_cm, 1));
  const ox = MARGIN, oy = top;
  const sx = (v: number) => pyRound(ox + v * scale, 1);
  const sy = (v: number) => pyRound(oy + v * scale, 1);
  const len = (v: number) => pyRound(v * scale, 1);

  const out: string[] = [];
  for (const room of level.rooms.values()) {
    const cells = level.cellsOf(room.id);
    const fill = ROOM_FILL[room.kind] ?? ROOM_FILL.other;
    for (const [x0, y0, x1, y1] of strips(cells)) {
      out.push(`<rect x="${sx(x0)}" y="${sy(y0)}" width="${len(x1 - x0)}" height="${len(y1 - y0)}" fill="${fill}"/>`);
    }
    for (const [x0, y0, x1, y1] of boundary(cells)) {
      out.push(`<line x1="${sx(x0)}" y1="${sy(y0)}" x2="${sx(x1)}" y2="${sy(y1)}" stroke="${INK}" stroke-width="3" stroke-linecap="square"/>`);
    }
    const [bx0, by0, bx1, by1] = bbox(cells);
    const cx = sx((bx0 + bx1) / 2), cy = sy((by0 + by1) / 2);
    out.push(`<text x="${cx}" y="${cy}" font-size="15" font-weight="700" fill="${INK}" text-anchor="middle">${escape(room.name)}</text>`);
    out.push(`<text x="${cx}" y="${pyRound(cy + 19, 1)}" font-size="13" fill="${INK}" opacity="0.7" text-anchor="middle">${fmtG(areaM2(cells))} m&#178;</text>`);
  }

  // Openings over the walls: a door is a gap plus its swing, a window a
  // coloured line. Without the swing the drawing hides what doors cost: floor.
  for (const opening of level.openings) {
    const [x0, y0, x1, y1] = opening.rect;
    const colour = opening.kind === 'door' ? PAPER : GLASS;
    out.push(`<line x1="${sx(x0)}" y1="${sy(y0)}" x2="${sx(x1)}" y2="${sy(y1)}" stroke="${colour}" stroke-width="5"/>`);
  }
  for (const [, [zx0, zy0, zx1, zy1]] of level.doorSwings()) {
    out.push(`<rect x="${sx(zx0)}" y="${sy(zy0)}" width="${len(zx1 - zx0)}" height="${len(zy1 - zy0)}" fill="none" stroke="${INK}" stroke-width="1" stroke-dasharray="4 4" opacity="0.5"/>`);
  }
  for (const item of level.items) {
    const [x0, y0, x1, y1] = item.rect;
    out.push(`<rect x="${sx(x0)}" y="${sy(y0)}" width="${len(x1 - x0)}" height="${len(y1 - y0)}" fill="${FURNITURE}" stroke="${FURNITURE_EDGE}" stroke-width="1" rx="2"/>`);
  }
  // A north arrow and a scale bar: a plan without either is a picture.
  out.push(...northArrow(MARGIN + PLAN_W - 60, top + 30));
  out.push(...scaleBar(MARGIN, oy + level.h_cm * scale + 34, scale));
  return out;
}

function northArrow(x: number, y: number): string[] {
  return [
    `<path d="M ${x} ${y + 26} L ${x + 9} ${y} L ${x + 18} ${y + 26} L ${x + 9} ${y + 19} Z" fill="${INK}"/>`,
    `<text x="${x + 9}" y="${y + 42}" font-size="12" fill="${INK}" text-anchor="middle">N</text>`,
  ];
}

function scaleBar(x: number, y: number, scale: number): string[] {
  const span = pyRound(100 * scale, 1);   // one metre
  const out = [`<text x="${x}" y="${y + 26}" font-size="12" fill="${INK}" opacity="0.7">0 &#8212; 5 m</text>`];
  for (let step = 0; step < 5; step++) {
    const fill = step % 2 === 0 ? INK : PAPER;
    out.push(`<rect x="${pyRound(x + step * span, 1)}" y="${y}" width="${span}" height="7" fill="${fill}" stroke="${INK}" stroke-width="1"/>`);
  }
  return out;
}

function scheduleBlock(table: Schedule): string[] {
  const x = MARGIN + PLAN_W + 40;
  let y = TITLE_H + 60;
  const unitLabel = table.unit === 'ft2' ? 'ft²' : 'm²';
  const out = [`<text x="${x}" y="${y}" font-size="18" font-weight="700" fill="${INK}">Area schedule</text>`];
  y += 26;
  for (const row of table.rows) {
    out.push(`<text x="${x}" y="${y}" font-size="14" fill="${INK}">${escape(row.name)}</text>`);
    out.push(`<text x="${WIDTH - MARGIN}" y="${y}" font-size="14" fill="${INK}" text-anchor="end">${fmtG(row.area)}</text>`);
    y += 22;
  }
  out.push(`<line x1="${x}" y1="${y - 12}" x2="${WIDTH - MARGIN}" y2="${y - 12}" stroke="${RULE}" stroke-width="1"/>`);
  out.push(`<text x="${x}" y="${y + 8}" font-size="14" font-weight="700" fill="${INK}">Total (${unitLabel})</text>`);
  out.push(`<text x="${WIDTH - MARGIN}" y="${y + 8}" font-size="14" font-weight="700" fill="${INK}" text-anchor="end">${fmtG(table.total)}</text>`);
  out.push(`<text x="${x}" y="${y + 30}" font-size="13" fill="${INK}" opacity="0.7">Circulation ${table.circulation_pct}%</text>`);
  return out;
}

function issueBlock(found: Issue[]): string[] {
  const x = MARGIN + PLAN_W + 40;
  let y = HEIGHT - MARGIN - 20 - Math.min(found.length, 8) * 20;
  const out = [`<text x="${x}" y="${y}" font-size="16" font-weight="700" fill="${INK}">Worth knowing</text>`];
  y += 22;
  if (!found.length) {
    out.push(`<text x="${x}" y="${y}" font-size="13" fill="${INK}" opacity="0.7">Nothing outstanding.</text>`);
    return out;
  }
  for (const issue of found.slice(0, 8)) {
    out.push(`<text x="${x}" y="${y}" font-size="13" fill="${ACCENT}">&#183; ${escape(String(issue.note ?? ''))}</text>`);
    y += 20;
  }
  // The sheet is advice, and saying so ON the sheet is the only place it
  // cannot be separated from the drawing it is about.
  out.push(`<text x="${x}" y="${y + 12}" font-size="11" fill="${INK}" opacity="0.55">Design guidance, not a building-regulations check.</text>`);
  return out;
}
