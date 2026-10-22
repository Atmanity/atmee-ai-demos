/**
 * Room colours, in one place.
 *
 * Shared by the plan and the comparison thumbnail so a bedroom is the same
 * colour in both. Two copies of this map is how the drawing and the thing it is
 * being compared against end up disagreeing about which room is which — the one
 * question a side-by-side view exists to answer.
 */
export const ROOM_FILL: Record<string, string> = {
  living: "#eaf2f8", dining: "#f9f3e6", kitchen: "#eef6f0",
  bedroom: "#f6efe4", bedroom_single: "#f6efe4", nursery: "#fcf0f1",
  office: "#f1eef7", bathroom: "#e9f2f5", shower_room: "#e9f2f5",
  wc: "#e9f2f5", utility: "#edf1f1", entry: "#f3f3f0", hall: "#f3f3f0",
  corridor: "#f3f3f0", stairs: "#e8eef3", storage: "#efeeec",
  closet: "#efeeec", balcony: "#eaf7f1", other: "#f1f1ee",
};
