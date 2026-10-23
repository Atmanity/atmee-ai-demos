// What kinds of room there are, and what each one needs to be usable.
//
// The numbers are the app's opinions, not any country's building code, and
// that is a product decision: codes differ by country, by building type and by
// new-build versus refurbishment, and a plan that says "compliant" while
// quoting the wrong jurisdiction's clause has misled a client in a way silence
// never would. So the designer says "that bedroom is under seven square metres,
// which is tight for a double" and never cites a clause.
//
// They are good-practice minima drawn from what rooms have to hold, set at the
// point below which a room stops working rather than where a regulator objects.

export interface RoomKind {
  kind: string;
  label: string;
  /** Below this the room cannot hold what it is named for. */
  min_area_m2: number;
  /** The narrowest the shape may get anywhere: the sliver rule. */
  min_width_cm: number;
  /** A room people live in, so it wants daylight. */
  habitable: boolean;
  /** Plumbed. Wants to stack near other wet rooms to keep pipe runs sane. */
  wet: boolean;
  /** Space you pass through. Exempt from daylight, allowed to be narrower. */
  circulation: boolean;
  /** Roughly what a generated plan gives it, as a share of the others. */
  weight: number;
}

const kind = (k: string, label: string, minArea: number, minWidth: number, opts: Partial<Pick<RoomKind, 'habitable' | 'wet' | 'circulation' | 'weight'>> = {}): RoomKind => ({
  kind: k, label, min_area_m2: minArea, min_width_cm: minWidth,
  habitable: opts.habitable ?? false, wet: opts.wet ?? false, circulation: opts.circulation ?? false, weight: opts.weight ?? 1.0,
});

export const KINDS: Record<string, RoomKind> = Object.fromEntries([
  kind('living', 'Living room', 11.0, 260, { habitable: true, weight: 2.4 }),
  kind('kitchen', 'Kitchen', 5.0, 180, { wet: true, weight: 1.4 }),
  kind('dining', 'Dining room', 7.0, 220, { habitable: true, weight: 1.4 }),
  kind('bedroom', 'Bedroom', 6.5, 210, { habitable: true, weight: 1.8 }),
  kind('bedroom_single', 'Single bedroom', 5.0, 190, { habitable: true, weight: 1.2 }),
  kind('nursery', 'Nursery', 5.0, 190, { habitable: true, weight: 1.0 }),
  kind('office', 'Study', 5.0, 190, { habitable: true, weight: 1.1 }),
  kind('bathroom', 'Bathroom', 3.2, 150, { wet: true, weight: 0.9 }),
  kind('shower_room', 'Shower room', 2.4, 140, { wet: true, weight: 0.7 }),
  kind('wc', 'WC', 1.4, 90, { wet: true, weight: 0.4 }),
  kind('utility', 'Utility', 2.4, 140, { wet: true, weight: 0.6 }),
  kind('entry', 'Entrance hall', 2.4, 120, { circulation: true, weight: 0.8 }),
  kind('hall', 'Hall', 2.0, 100, { circulation: true, weight: 0.8 }),
  kind('corridor', 'Corridor', 1.5, 90, { circulation: true, weight: 0.6 }),
  kind('stairs', 'Stairs', 2.8, 90, { circulation: true, weight: 0.8 }),
  kind('storage', 'Storage', 0.8, 80, { weight: 0.4 }),
  kind('closet', 'Walk-in closet', 1.8, 120, { weight: 0.6 }),
  kind('balcony', 'Balcony', 2.0, 120, { weight: 0.6 }),
  kind('other', 'Room', 2.0, 150, { weight: 1.0 }),
].map((k) => [k.kind, k]));

/**
 * Spoken names that mean a kind. The model (or the client's own words) picks
 * the kind, but "the lounge" or "the loo" should not become a refusal.
 */
export const ALIASES: Record<string, string> = {
  'living room': 'living', lounge: 'living', 'sitting room': 'living',
  'front room': 'living', 'family room': 'living',
  kitchen: 'kitchen', galley: 'kitchen',
  'kitchen diner': 'kitchen', 'dining room': 'dining', diner: 'dining',
  bedroom: 'bedroom', 'master bedroom': 'bedroom', 'double bedroom': 'bedroom',
  'primary bedroom': 'bedroom', 'guest room': 'bedroom_single',
  'single bedroom': 'bedroom_single', 'box room': 'bedroom_single',
  nursery: 'nursery', 'baby room': 'nursery', 'kids room': 'bedroom_single',
  study: 'office', office: 'office', 'home office': 'office',
  bathroom: 'bathroom', 'family bathroom': 'bathroom', ensuite: 'shower_room',
  'en suite': 'shower_room', 'shower room': 'shower_room',
  wc: 'wc', toilet: 'wc', loo: 'wc', cloakroom: 'wc', 'powder room': 'wc',
  utility: 'utility', laundry: 'utility', 'utility room': 'utility',
  hall: 'hall', hallway: 'hall', landing: 'hall',
  entrance: 'entry', entry: 'entry', 'entrance hall': 'entry',
  foyer: 'entry', porch: 'entry',
  corridor: 'corridor', passage: 'corridor',
  stairs: 'stairs', staircase: 'stairs', stairwell: 'stairs',
  storage: 'storage', cupboard: 'storage', store: 'storage',
  closet: 'closet', 'walk in closet': 'closet', 'dressing room': 'closet',
  'wardrobe room': 'closet',
  balcony: 'balcony', terrace: 'balcony',
};

/** What the designer says she lays out, when asked for something she has not got. */
export const ROOM_FAMILIES = 'living and dining rooms, kitchens, bedrooms, bathrooms, halls, studies, utilities and storage';

const words = (text: string) => text.split(/\s+/).filter(Boolean).join(' ');

export function normalizeKind(value: unknown): string {
  return words(String(value || '').trim().toLowerCase().replaceAll('-', ' ').replaceAll('_', ' '));
}

/** The kind a spoken name means, or null when it is not a room at all. */
export function resolveKind(value: unknown): RoomKind | null {
  const key = normalizeKind(value);
  if (!key) return null;
  const underscored = key.replaceAll(' ', '_');
  if (KINDS[underscored]) return KINDS[underscored];
  if (ALIASES[key]) return KINDS[ALIASES[key]];
  // "the second bedroom", "a small study": the longest contained alias wins,
  // so "shower room" beats "room".
  let hit = '';
  for (const alias of Object.keys(ALIASES)) if (key.includes(alias) && alias.length > hit.length) hit = alias;
  return hit ? KINDS[ALIASES[hit]] : null;
}

export const kindOrOther = (value: unknown): RoomKind => resolveKind(value) ?? KINDS.other;
