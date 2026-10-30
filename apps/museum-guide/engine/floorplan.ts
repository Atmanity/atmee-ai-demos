// The Meridian's floor plan, for the map: its rooms and where each work hangs,
// in one portrait drawing (a phone's screen) of 320 by 360 units. The numbers
// on the pins follow the catalogue, which is also the suggested route, from the
// entrance at the bottom through the Renaissance and Dutch rooms and up.
import { EXHIBITS, type Exhibit } from './catalogue.ts';

export interface Room {
  n: number;
  name: string;
  /** The name as drawn in a narrow room, one line each. */
  lines?: string[];
  x: number; y: number; w: number; h: number;
}

export const PLAN = { width: 320, height: 360, entrance: { x: 160, y: 334 } };

export const ROOMS: Room[] = [
  { n: 1, name: 'Renaissance', x: 10, y: 184, w: 145, h: 126 },
  { n: 2, name: 'Dutch Golden Age', x: 165, y: 184, w: 145, h: 126 },
  { n: 3, name: 'Romantic and Modern', x: 105, y: 14, w: 205, h: 160 },
  { n: 4, name: 'Japanese prints', lines: ['Japanese', 'prints'], x: 10, y: 14, w: 85, h: 160 },
];

// Where each work hangs, and its name short enough to sit under its pin. The
// route runs one way: through rooms 1 and 2, up into room 3 from the right, and
// on to room 4 (live, long names ran into each other and the route crossed itself).
const PINS: Record<string, { x: number; y: number; short: string }> = {
  'mona-lisa': { x: 52, y: 254, short: 'Mona Lisa' },
  'birth-of-venus': { x: 116, y: 254, short: 'Venus' },
  'pearl-earring': { x: 205, y: 254, short: 'Pearl Earring' },
  'night-watch': { x: 270, y: 254, short: 'Night Watch' },
  wanderer: { x: 272, y: 100, short: 'Wanderer' },
  'starry-night': { x: 207, y: 100, short: 'Starry Night' },
  'the-kiss': { x: 142, y: 100, short: 'The Kiss' },
  'great-wave': { x: 52, y: 100, short: 'Great Wave' },
};

/** The room a work hangs in (its gallery's number). */
export function roomOf(e: Exhibit): Room {
  const n = Number(/Gallery (\d+)/.exec(e.gallery)?.[1]);
  const room = ROOMS.find((r) => r.n === n);
  if (!room) throw new Error(`no room for ${e.id}`);
  return room;
}

export interface Pin { exhibit: Exhibit; number: number; x: number; y: number; short: string; room: Room }

/** Every work's pin, numbered along the route. */
export const pins = (): Pin[] => EXHIBITS.map((exhibit, i) => ({ exhibit, number: i + 1, ...PINS[exhibit.id], room: roomOf(exhibit) }));
