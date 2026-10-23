/**
 * The drawing's colours, in one place.
 *
 * Shared by the plan, the lobby's sample and the comparison thumbnail so a
 * bedroom is the same colour in all of them. Two copies of this map is how the
 * drawing and the thing it is being compared against end up disagreeing about
 * which room is which — the one question a side-by-side view exists to answer.
 *
 * Planwright draws like a drafting table: graphite line work on white paper,
 * a non-photo-blue metre grid, highlighter yellow for what is picked, red
 * pencil for what is wrong; blueprint blue is the brand around it. Rooms are
 * pale tints by use, so the line work reads first.
 */
export const INK = "#22262a";
export const PAPER = "#fbfbf8";
export const BLUE = "#3f8fd2";
export const REDLINE = "#d9452b";
export const TRACE = "#f4ecb0";
export const BLUEPRINT = "#1f4e8c";
export const WOOD = "#d9c4a3";
export const WOOD_EDGE = "#8c7350";
export const GLASS = "#7cc0e8";

export const ROOM_FILL: Record<string, string> = {
  living: "#ece8df", dining: "#efe9dc", kitchen: "#e0edee",
  bedroom: "#e6ebf5", bedroom_single: "#e6ebf5", nursery: "#eee8f4",
  office: "#ebe8f3", bathroom: "#dceff2", shower_room: "#dceff2",
  wc: "#dceff2", utility: "#e4ecec", entry: "#f0f1ee", hall: "#f0f1ee",
  corridor: "#f0f1ee", stairs: "#e3e7e9", storage: "#ecece8",
  closet: "#ecece8", balcony: "#e3edf2", other: "#efefeb",
};
