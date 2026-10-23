// The furniture kit, with real dimensions.
//
// Every piece the planner can draw is here, and nothing else may be drawn. The
// sizes are real (a queen bed is 152 x 203, a three-seat sofa 210 x 90): if a
// model supplied dimensions the plan would be fiction, an avatar confidently
// fitting a 210 cm sofa into a 180 cm alcove because it guessed 160.
//
// w_cm x h_cm is the footprint at rot = 0, width running east-west. A quarter
// turn swaps them; nothing else in the app resizes a piece.

export interface Piece {
  type: string;
  label: string;
  w_cm: number;
  h_cm: number;
  /** Free floor wanted in front of it beyond the walkway: a wardrobe needs room to open. */
  clearance_cm: number;
}

const piece = (type: string, label: string, w: number, h: number, clearance = 0): Piece => ({ type, label, w_cm: w, h_cm: h, clearance_cm: clearance });

export const CATALOG: Record<string, Piece> = Object.fromEntries([
  // beds
  piece('bed_single', 'Single bed', 90, 190),
  piece('bed_double', 'Double bed', 135, 190),
  piece('bed_queen', 'Queen bed', 152, 203),
  piece('bed_king', 'King bed', 193, 203),
  piece('bedside_table', 'Bedside table', 45, 40),
  // seating
  piece('sofa_2', '2-seat sofa', 160, 90),
  piece('sofa_3', '3-seat sofa', 210, 90),
  piece('sofa_corner', 'Corner sofa', 260, 200),
  piece('armchair', 'Armchair', 85, 85),
  piece('chair', 'Chair', 45, 45),
  piece('stool', 'Stool', 40, 40),
  // tables and desks
  piece('desk', 'Desk', 120, 60, 60),
  piece('dining_table', 'Dining table', 160, 90),
  piece('coffee_table', 'Coffee table', 110, 60),
  piece('side_table', 'Side table', 50, 50),
  // storage
  piece('wardrobe', 'Wardrobe', 120, 60, 60),
  piece('dresser', 'Dresser', 100, 45, 50),
  piece('bookshelf', 'Bookshelf', 80, 30),
  piece('tv_unit', 'TV unit', 140, 40),
  // soft furnishing
  piece('rug', 'Rug', 200, 140),
  piece('rug_small', 'Small rug', 120, 80),
  piece('plant', 'Plant', 40, 40),
  piece('floor_lamp', 'Floor lamp', 40, 40),
].map((p) => [p.type, p]));

/** What the designer says it stocks when asked for something it has not got. */
export const KIT_FAMILIES = 'beds, sofas, desks, chairs, tables, wardrobes, rugs and plants';

/** Spoken and typed names that mean a catalog type ("couch" through STT is a sofa). */
export const ALIASES: Record<string, string> = {
  bed: 'bed_queen',
  'queen bed': 'bed_queen',
  'king bed': 'bed_king',
  'double bed': 'bed_double',
  'single bed': 'bed_single',
  couch: 'sofa_3',
  sofa: 'sofa_3',
  settee: 'sofa_3',
  loveseat: 'sofa_2',
  'corner sofa': 'sofa_corner',
  table: 'dining_table',
  'dining table': 'dining_table',
  'coffee table': 'coffee_table',
  bedside: 'bedside_table',
  nightstand: 'bedside_table',
  'night stand': 'bedside_table',
  closet: 'wardrobe',
  wardrobe: 'wardrobe',
  'chest of drawers': 'dresser',
  shelf: 'bookshelf',
  bookcase: 'bookshelf',
  tv: 'tv_unit',
  television: 'tv_unit',
  lamp: 'floor_lamp',
  armchair: 'armchair',
  chair: 'chair',
  plant: 'plant',
  rug: 'rug',
  carpet: 'rug',
  desk: 'desk',
  // The sizes people say out loud, so the smaller piece is not swapped for the bigger one.
  'two seater': 'sofa_2', '2 seater': 'sofa_2', 'two seat': 'sofa_2', '2 seat': 'sofa_2',
  'three seater': 'sofa_3', '3 seater': 'sofa_3', 'three seat': 'sofa_3', '3 seat': 'sofa_3',
  'small rug': 'rug_small', 'end table': 'side_table', 'side table': 'side_table', 'tv stand': 'tv_unit',
};

/** A spoken or typed piece name, as a lookup key. */
export function normalizeType(value: unknown): string {
  return String(value || '').trim().toLowerCase().replaceAll('-', ' ').split(/\s+/).filter(Boolean).join(' ');
}

/**
 * Every name a piece answers to: the aliases, and each piece's own label and
 * type. The labels were missing, so a name in the kit could lose to a shorter
 * alias inside it: "a side table" became a dining table ("table"), "small rug"
 * the big rug, "2-seat sofa" a 3-seat sofa ("sofa").
 */
const NAMES: Record<string, string> = {
  ...Object.fromEntries(Object.values(CATALOG).flatMap((p) => [[normalizeType(p.label), p.type], [p.type.replaceAll('_', ' '), p.type]])),
  ...ALIASES,
};

/** The catalog entry a name means, or null if the kit has no such thing. */
export function resolveType(value: unknown): Piece | null {
  const key = normalizeType(value);
  if (!key) return null;
  const underscored = key.replaceAll(' ', '_');
  if (CATALOG[underscored]) return CATALOG[underscored];
  if (NAMES[key]) return CATALOG[NAMES[key]];
  // "a queen bed", "the small rug": the longest name contained in it, so
  // "coffee table" wins over "table".
  let hit = '';
  for (const name of Object.keys(NAMES)) if (key.includes(name) && name.length > hit.length) hit = name;
  return hit ? CATALOG[NAMES[hit]] : null;
}

/** Which drawer of the picker a piece sits in. */
export const FAMILY_OF: Record<string, string> = {
  bed_single: 'Beds', bed_double: 'Beds', bed_queen: 'Beds', bed_king: 'Beds', bedside_table: 'Beds',
  sofa_2: 'Seating', sofa_3: 'Seating', sofa_corner: 'Seating', armchair: 'Seating', chair: 'Seating', stool: 'Seating',
  desk: 'Tables', dining_table: 'Tables', coffee_table: 'Tables', side_table: 'Tables',
  wardrobe: 'Storage', dresser: 'Storage', bookshelf: 'Storage', tv_unit: 'Storage',
  rug: 'Soft', rug_small: 'Soft', plant: 'Soft', floor_lamp: 'Soft',
};

/**
 * The rooms a piece usually lives in, best first, for a piece asked for without
 * a room (and for a photo's pieces). Anything not listed goes to the living room.
 */
export const USUAL_ROOMS: Record<string, string[]> = {
  bed_single: ['bedroom_single', 'bedroom', 'nursery'], bed_double: ['bedroom', 'bedroom_single'], bed_queen: ['bedroom'], bed_king: ['bedroom'],
  bedside_table: ['bedroom', 'bedroom_single'], wardrobe: ['bedroom', 'bedroom_single', 'closet'], dresser: ['bedroom', 'bedroom_single'],
  desk: ['office', 'bedroom_single', 'bedroom'], dining_table: ['dining', 'kitchen', 'living'],
};

/** Drawer order, explicit rather than whatever order a map happens to keep. */
export const FAMILY_ORDER = ['Beds', 'Seating', 'Tables', 'Storage', 'Soft'] as const;

export interface CatalogEntry { type: string; label: string; w_cm: number; h_cm: number; family: string }

/**
 * The kit as the panel needs it. The panel carries no second copy of the kit:
 * two lists of furniture dimensions is two chances for the drawing and the
 * rules to disagree about how big a queen bed is.
 */
export function catalogView(): CatalogEntry[] {
  return Object.values(CATALOG).map((p) => ({ type: p.type, label: p.label, w_cm: p.w_cm, h_cm: p.h_cm, family: FAMILY_OF[p.type] ?? 'Soft' }));
}
