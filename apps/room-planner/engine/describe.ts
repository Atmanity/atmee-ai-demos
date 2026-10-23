// How a home reads when it is said rather than drawn.
//
// Areas and compass directions, never coordinates. A model given x_cm=40,
// y_cm=30 reads them back wrong (it will say "the bedroom is by the window"
// because 30 is a small number). The page gets the exact geometry; the avatar
// gets the sentence a designer would say.

/**
 * Where something is, in the words a person uses. Thirds rather than halves:
 * "north-west" for a room in the corner, "centre" for one in the middle, and a
 * bare "north" for something along a wall but centred on it.
 */
export function cardinal(x: number, y: number, w: number, h: number, floorW: number, floorH: number): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const band = (value: number, size: number) => (value < size / 3 ? 0 : value > (size * 2) / 3 ? 2 : 1);
  const ns = ['north', '', 'south'][band(cy, Math.max(floorH, 1))];
  const ew = ['west', '', 'east'][band(cx, Math.max(floorW, 1))];
  if (ns && ew) return `${ns}-${ew}`;
  return ns || ew || 'centre';
}

/** "m²" or "ft²". */
export const unitLabel = (unit: 'm2' | 'ft2') => (unit === 'ft2' ? 'ft²' : 'm²');

/** A list as a person says it: "a, b and c". */
export function spoken(list: string[]): string {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}
