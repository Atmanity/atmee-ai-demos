// What the planner shows the page, and what an action says it did.
//
// The page draws a PlanSnapshot and decides nothing: there is no second
// opinion about whether a room may shrink. Two shapes are worth knowing before
// reading the drawing code:
// - A room travels as `rects` (fill) plus `edges` (stroke), not as cells.
// - A wall between two rooms is published in `walls` rather than derived in
//   the page, so the grips and the rules agree about which rooms a wall joins.
import type { CatalogEntry } from './catalog.ts';
import type { Delta, Issue, Schedule, ScheduleRow } from './compliance.ts';
import type { ItemView, LevelView, OpeningView, RoomView, WallView } from './home.ts';
import type { SchemeSummary, Thumb } from './schemes.ts';

export type { CatalogEntry, Delta, Issue, Schedule, ScheduleRow, SchemeSummary, Thumb };
/** x0, y0, x1, y1 in centimetres. */
export type Rect = [number, number, number, number];
export type Room = RoomView;
export type Opening = OpeningView;
export type Wall = WallView;
export type Item = ItemView;
export type Level = LevelView;
export type Unit = 'm2' | 'ft2';

export interface RoomKindView { kind: string; label: string; min_area_m2: number }
export interface TypologyView { key: string; label: string; note: string }

/** A saved scheme held up beside the live plan, with the room-by-room gap. */
export interface Comparing {
  name: string;
  rows: ScheduleRow[];
  deltas: Delta[];
  thumb?: Thumb;
  /** What the saved scheme spent on circulation: the number that separates two
   *  layouts of the same envelope when every room is within half a metre. */
  circulation_pct?: number;
}

/**
 * The drawing sheet. On the API the page renders it itself, so it carries the
 * SVG and is offered as a download; `failed` keeps a refusal visible.
 */
export interface SheetView { status: 'ready' | 'failed'; svg?: string; error?: string; floor?: string; pages?: { floor: string; svg: string }[] }

export interface PlanSnapshot {
  level: Level;
  levels: string[];
  active: number;
  selected: string | null;
  unit: Unit;
  schedule: Schedule;
  issues: Issue[];
  schemes: SchemeSummary[];
  stairs_aligned: boolean;
  can_undo?: boolean;
  catalog?: CatalogEntry[];
  room_kinds?: RoomKindView[];
  typologies?: TypologyView[];
  sheet?: SheetView;
  comparing?: Comparing;
  /** The floors not on screen, in brief: for the avatar, which sees no drawing. */
  others?: { name: string; w_cm: number; h_cm: number; rooms: { name: string; area_m2: number }[] }[];
  /** What the last change was, in plain words: what undo would take back. */
  last_change?: string | null;
}

/** A room as an outcome names it: after the change, with roughly where it is. */
export interface RoomFact { id: string; name: string; area_m2: number; where: string }

/** What an accepted action did, in facts the avatar can be told. */
export interface Done {
  kind: string;
  /** A plain phrase ("traded 2 m² from the study to the living room"). */
  label: string;
  rooms?: RoomFact[];
  removed?: { name: string; area_m2: number };
  /** The name a room had before (a rename), or the room absorbed by a merge. */
  was?: string;
  takenFrom?: RoomFact;
  item?: { id: string; label: string; room: string | null; w_cm: number; h_cm: number; near?: string };
  opening?: { kind: 'door' | 'window'; front?: boolean; rooms: string[]; wall?: string };
  typology?: { key: string; label: string; note: string };
  level?: string;
  scheme?: string;
  undone?: string;
  unit?: Unit;
  size?: { w_cm: number; h_cm: number };
  /** For a moved wall or a traded area: how much floor actually changed hands. */
  moved_m2?: number;
}

export type Intent = { kind: string } & Record<string, unknown>;

export type ApplyResult =
  | { applied: true; snapshot: PlanSnapshot; done: Done }
  | { applied: false; reason: string };
