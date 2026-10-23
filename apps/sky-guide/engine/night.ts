// Your night: every star you marked and every figure you drew, with where to
// look for it from that place at that hour, to take outside. It is the
// product's "done" moment: the list is on screen during the call, and when
// the call ends it becomes a card to keep (a plain-text file to download).
//
// Built from the chart's own views, so a line here says exactly what the
// chart showed: a direction for that place and hour, and the catalogue's
// first line about the star.
import { FACTS } from './catalog.ts';
import type { SkyView } from './types.ts';
import { figureAnchor, whereInSky } from './words.ts';

export interface NightEntry {
  /** Unique per thing, place and hour: looking at Vega again later is a new line. */
  id: string;
  kind: 'star' | 'figure';
  name: string;
  place: string;
  /** The chart's clock label: "9:00 pm, Thu 23 Oct". */
  when: string;
  /** "high up in the north-west". */
  where: string;
  /** One line to remember it by. */
  note: string;
}

/** The longest list kept; the oldest go first. */
export const NIGHT_LIMIT = 40;

/** The marked star as a line for the list, or null if nothing is marked. */
export function seenStar(view: SkyView): NightEntry | null {
  const s = view.snapshot;
  const star = s.visible.find((v) => v.id === s.selected);
  if (!star || !s.fact) return null;
  // An authored line if there is one; otherwise the catalogue row ("In Lyra, at magnitude…").
  const note = FACTS[star.id]?.[0] ?? s.fact.lines[s.fact.lines.length - 1] ?? '';
  return { id: `star:${star.id}:${s.where.label}:${s.when.epoch}`, kind: 'star', name: star.name, place: s.where.label, when: s.when.label, where: whereInSky(star), note };
}

/** The drawn figure as a line for the list, or null if none is drawn. */
export function seenFigure(view: SkyView): NightEntry | null {
  const s = view.snapshot;
  const anchor = figureAnchor(s, s.figure);
  if (!s.figure || !anchor) return null;
  return {
    id: `figure:${s.figure.con}:${s.where.label}:${s.when.epoch}`, kind: 'figure', name: s.figure.name, place: s.where.label, when: s.when.label,
    where: whereInSky(anchor), note: `Find it by ${anchor.name}, its brightest star.`,
  };
}

/** The list with one more line (a repeat moves to the end rather than doubling). */
export function remember(list: NightEntry[], entry: NightEntry | null): NightEntry[] {
  if (!entry) return list;
  return [...list.filter((e) => e.id !== entry.id), entry].slice(-NIGHT_LIMIT);
}

/** The list grouped by place and hour, in the order first seen. */
export function byPlaceAndTime(list: NightEntry[]): { place: string; when: string; entries: NightEntry[] }[] {
  const groups: { place: string; when: string; entries: NightEntry[] }[] = [];
  for (const entry of list) {
    const group = groups.find((g) => g.place === entry.place && g.when === entry.when);
    if (group) group.entries.push(entry);
    else groups.push({ place: entry.place, when: entry.when, entries: [entry] });
  }
  return groups;
}

/** The list as a plain-text file to take outside. */
export function nightText(list: NightEntry[]): string {
  const lines = ['Lodestar: your night under the stars', ''];
  for (const group of byPlaceAndTime(list)) {
    lines.push(`${group.place}, ${group.when}`);
    for (const e of group.entries) lines.push(`  ${e.name}${e.kind === 'figure' ? ' (constellation)' : ''}: ${e.where}. ${e.note}`);
    lines.push('');
  }
  lines.push('Directions are for the place and hour above, looking up from the ground.');
  lines.push('Positions come from a catalogue of 135 naked-eye stars; the chart leaves out the Sun, the Moon and the planets.');
  return `${lines.join('\n')}\n`;
}

/** A file name for the download: "lodestar-taipei-23-oct.txt". */
export function nightFileName(list: NightEntry[]): string {
  const first = list[0];
  const slug = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const date = first ? first.when.split(', ')[1]?.split(' ').slice(1).join(' ') ?? '' : '';
  return `${['lodestar', first ? slug(first.place) : '', slug(date)].filter(Boolean).join('-')}.txt`;
}
