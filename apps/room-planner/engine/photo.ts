// A photo of a room, or of one piece, becomes furniture on the plan.
//
// The original showed the photo to the avatar's model, which then called
// add_furniture per piece. Here the app's own model reads it (server.ts, with
// the image) into kit TYPES and a room, never measurements: a photo cannot say
// how big a room is, and centimetres invented from perspective would be wrong
// in a way the plan draws confidently. The kit supplies the real sizes, and the
// planner finds the spot. The architect does not see these photos; one the
// client shares with her in the call goes to her host instead, to look at and
// talk about, and is not read into furniture here.
import { CATALOG, KIT_FAMILIES, USUAL_ROOMS } from './catalog.ts';
import type { Intent } from './types.ts';

export type Purpose = 'room' | 'piece';

export const PHOTO_SCHEMA = {
  type: 'object',
  properties: {
    seen: { type: 'string', description: 'In a few words, what the photo shows (e.g. "a small living room with a grey sofa").' },
    pieces: {
      type: 'array',
      description: 'The furniture you can actually see that matches the kit, one entry per piece (two armchairs is two entries). Empty if none.',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: Object.keys(CATALOG) },
          room: { type: 'string', description: 'Which room of the plan it belongs in, by id from the list; empty if none fits.' },
        },
        required: ['type'],
      },
    },
  },
  required: ['seen', 'pieces'],
} as const;

export interface PhotoReading { seen: string; pieces: { type: string; room?: string }[] }

export const PHOTO_SYSTEM = 'You identify furniture in a photo for a floor-plan app. You name only what you can see, from a fixed kit, and you never estimate sizes.';

export function photoPrompt(purpose: Purpose, rooms: { id: string; name: string; kind: string }[]): string {
  const list = rooms.map((r) => `${r.id} ${r.name} (${r.kind})`).join('; ') || 'no rooms yet';
  const ask = purpose === 'piece'
    ? 'The client shared a photo of ONE piece of furniture they own. Identify that one piece (the most prominent one) as a kit type, and the room it most likely belongs in.'
    : 'The client shared a photo of a room in their home. List the furniture you can actually see that matches the kit, and the room of the plan it belongs in (the room in the photo is most likely the plan room of the same kind).';
  return `${ask}
The kit (types and real sizes are fixed): ${Object.values(CATALOG).map((p) => `${p.type} (${p.label})`).join(', ')}. In families: ${KIT_FAMILIES}.
The plan's rooms: ${list}.
Only pieces you are confident about. Never guess a dimension. If it is not furniture you can place, return no pieces.`;
}

/**
 * The reading as add_item intents. A room the model named is kept when it is on
 * the plan; otherwise the piece goes to the room of the kind it usually lives in,
 * then the living room, then the one the client has selected. At most eight
 * pieces: a photo is a starting point, not an inventory.
 */
export function photoIntents(reading: PhotoReading, purpose: Purpose, rooms: { id: string; kind: string }[], selected: string | null): Intent[] {
  const ids = new Set(rooms.map((r) => r.id));
  const pieces = (reading.pieces ?? []).filter((p) => p && CATALOG[p.type]).slice(0, purpose === 'piece' ? 1 : 8);
  return pieces.map((p) => {
    const named = p.room && ids.has(p.room) ? p.room : null;
    const usual = (USUAL_ROOMS[p.type] ?? ['living']).map((kind) => rooms.find((r) => r.kind === kind)?.id).find(Boolean) ?? null;
    const room = named ?? usual ?? rooms.find((r) => r.kind === 'living')?.id ?? (selected && ids.has(selected) ? selected : null);
    return { kind: 'add_item', type: p.type, room, near: 'center' };
  });
}
