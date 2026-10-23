// What the architect is told, and how she acts.
//
// The planner decides everything; the architect talks about it. She changes
// the plan only by calling the app's tools (TOOLS): every call is answered by
// the planner in the page with what it did, in real numbers, or why it
// refused, and her first reply is spoken from that. Three things reach her:
// - INSTRUCTIONS: the session's tool instructions, her job and the hard-won
//   "never" rules of the original prompt;
// - the STATE: the live plan in plain sentences, replaced after every change,
//   so questions about it are answered without a tool;
// - tool RESULTS (resultFor), and EVENTS for what the client does by hand.
import type { AppTool } from '../../../server/app-server.ts';
import type { Issue } from './compliance.ts';
import { cardinal, spoken } from './describe.ts';
import { fmtG } from './num.ts';
import type { ApplyResult, Done, Intent, PlanSnapshot, RoomFact, Unit } from './types.ts';

/** The state's hard limit on the API. */
export const STATE_LIMIT = 3858;
/** The tool instructions' hard limit on the API. */
export const INSTRUCTIONS_LIMIT = 4000;

// ----------------------------------------------------------- the instructions

/** The architect's rules: the session's tool instructions (at most 4,000 characters). */
export const INSTRUCTIONS = `You are the architect in Planwright, planning a client's home with them at a drawing board, up to two floors. The plan is on their screen. You cannot see it; the live plan in your context describes it exactly (rooms by area and compass direction, neighbours, doors, windows, furniture, schemes, checks) and is ground truth. Never describe a room, door or piece that is not in it.
- The plan changes only when you call a tool. Every request that changes the screen is a tool call, even a single word answering your own question (a size, a number of bedrooms, a yes). Saying "done" without the call changes nothing and misleads a client who is looking at the drawing: never say a change happened unless the tool's result said so. Call the tool FIRST and say nothing about the request until it returns: no size, no fit, no "shall I try…", only a few words that claim nothing ("let me look"). Then speak only from the result: its numbers, or its refusal and the reason. Never invent or estimate a size or an outcome, never confirm a refused change, and if part of a request failed say which part. Call the tool even when you think you know, and even for a piece or room you think the plan lacks (a piano, a gym): only the plan knows whether it fits, and a refusal must come from it.
- The tools. Whole floor: lay_out_floor (a whole floor from a brief, with the size if they gave it), set_floor_size, add_upper_floor, go_to_floor. Rooms: add_room, remove_room, rename_room, divide_room, swap_rooms, knock_together. Sizes: trade_area (take_from gets SMALLER, give_to gets BIGGER: in "give the study two metres off the kitchen" the study is give_to), grow_room (free floor), move_wall (exact centimetres), mark_load_bearing. Openings: add_door_or_window, remove_door_or_window. Furniture: add_furniture, move_furniture (also turns), remove_furniture. Schemes: save_scheme, use_scheme. Also switch_units, undo_change, draw_sheet, clear_floor.
- Name rooms, pieces and schemes as the live plan names them. Tools act on the floor on screen. Several requests in one sentence are several calls, in order. Asked again for something already done (the drawing, a floor), call the tool again: it redoes it with the plan as it is now. Never offer to do it later.
- Questions about the plan (sizes, what is where, what undo would take back): answer from the live plan, no tool. When the client changes something by hand you are told; carry on from that.
- Only when the client asks: lay_out_floor over a floor that has rooms, clear_floor, remove_room, opening or dropping a scheme. You may suggest a change ("shall I give bedroom two a metre off the hall?"); make it only if they say yes.
- Never choose or ask for coordinates: say roughly where (by the window, the north wall, next to the kitchen) and the plan finds the spot. Furniture comes from the kit at real sizes; never invent a dimension or guess one from a photo. You never place the stairs: a second floor comes with them, lined up.
- Never say a plan is compliant, to code or meets regulations, and never name a regulation, standard or clause: the checks are good practice and you own them ("I'd want ninety centimetres there"). Raise one at a time, when it matters.
- Getting started: do not interview. You need roughly how big the place is and how many bedrooms; ask in one or two turns, then lay out the floor and call it a starting point to argue with.
- You are warm, quick and opinionated about what a drawing hides (reaching every room without walking through another, ninety centimetres to pass, daylight where people sit); you make a call rather than offering three options. Talk in the plan's unit, numbers as words ("thirteen square metres"). One or two short spoken sentences, under 30 words, no lists or markdown. If asked whether you are real, say you are an AI.`;

// ----------------------------------------------------------------- the tools

const awaits = { mode: 'await' as const, timeoutSeconds: 10 };
// Lenient on purpose: the platform checks a call against these schemas before
// the page sees it, and a call that does not fit never arrives (the host then
// tends to say it happened). So no enums, no length or range limits beyond a
// generous cap, nothing required but what the call cannot do without; the
// accepted words are listed in the descriptions and normalised in tools.ts,
// and an unusable value comes back as a question.
const text = (description: string) => ({ type: 'string', maxLength: 500, description });
const number = (description: string) => ({ type: 'number', description });
const flag = (description: string) => ({ type: 'boolean', description });
const params = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const ROOM = text('A room as the live plan names it ("Main bedroom", "Kitchen").');
const WALL = (what: string) => text(`${what}: north, south, east or west.`);
const WHERE_ROOM = text('Roughly where on the floor: middle, north, south, east or west.');
const WHERE_PIECE = text('Roughly where in the room: window, door, middle, or a wall (north, south, east, west).');
const AREA = { m2: number('Square metres ("metres" about a room means square metres).'), sq_ft: number('Square feet, if the client gave square feet instead.') };

/** The plan's tools. Each call is answered by the planner in the page. */
export const TOOLS: AppTool[] = [
  // ------------------------------------------------------------ the floor
  {
    type: 'function', name: 'lay_out_floor',
    description: 'Draws a whole floor from a brief, replacing everything on the floor on screen. Call it once you know roughly how big the place is and how many bedrooms, or when the client asks for a redraw or another arrangement. Pass the size too if they gave it. You never place rooms: the layout is worked out for you.',
    parameters: params({
      bedrooms: number('How many bedrooms, 1 to 5 (a couple 1, with a baby 2, a family with two children 3; a studio 1).'),
      style: text('The arrangement: day_night (living at the entry end, bedrooms at the far end; the default), open_plan (kitchen, dining and living as one room), dual_aspect (hall down the middle, every room gets a window) or compact (no hall at all).'),
      study: flag('Include a study.'), dining: flag('A separate dining room.'), en_suite: flag('An en suite.'), wc: flag('A separate WC.'), utility: flag('A utility room.'),
      width_m: number('The size of the place, east-west, as the client said it.'), depth_m: number('North-south, as the client said it.'), area_m2: number('The total floor area, when they gave an area instead of two sides.'),
    }),
    'x-atmee': awaits,
  },
  {
    type: 'function', name: 'set_floor_size',
    description: 'Sets the outside size of the floor ("it\'s nine metres by seven", "about seventy square metres"). Pass the numbers the client said; metres and centimetres are both understood. A floor with rooms cannot shrink into them.',
    parameters: params({ width_m: number('East-west.'), depth_m: number('North-south.'), area_m2: number('The total area, when they gave an area instead.') }),
    'x-atmee': awaits,
  },
  {
    type: 'function', name: 'add_upper_floor',
    description: 'Adds a second storey and shows it, with the stairs put in on both floors, lined up; the ground floor keeps its layout. When the client says there is an upstairs or wants bedrooms above.',
    parameters: params({}), 'x-atmee': awaits,
  },
  {
    type: 'function', name: 'go_to_floor',
    description: 'Shows the ground or the upper floor. Every other tool acts on the floor on screen, so switch first to work on the other one.',
    parameters: params({ floor: text('ground or upper.') }), 'x-atmee': awaits,
  },
  // ------------------------------------------------------------ the rooms
  {
    type: 'function', name: 'add_room',
    description: 'Adds one room to the floor on screen ("we need a utility", "put a study in"), sized sensibly unless the client gave a size, taking spare floor or a neighbour\'s. Roughly where, never a position. For a whole floor use lay_out_floor.',
    parameters: params({
      room: text('What it is: bedroom, single bedroom, nursery, study, bathroom, shower room, en suite, WC, utility, dining room, storage, walk-in closet, hall, balcony, or the client\'s own word.'),
      near: WHERE_ROOM, next_to: text('A room to put it beside, as the live plan names it.'),
      size_m2: number('Its size, only if the client gave one.'), name: text('A name for it, only if the client gave one.'),
    }),
    'x-atmee': awaits,
  },
  {
    type: 'function', name: 'remove_room',
    description: 'Takes a room off the plan with its furniture and doors, leaving bare floor to give to another room. Only when the client asks.',
    parameters: params({ room: ROOM }), 'x-atmee': awaits,
  },
  {
    type: 'function', name: 'rename_room',
    description: 'Renames a room or changes what it is used for ("call that the snug", "make the study a nursery"). The walls stay.',
    parameters: params({ room: ROOM, new_name: text('The new name, if they gave one.'), new_use: text('What it is for now (bedroom, study, nursery, dining room…), if that changes.') }),
    'x-atmee': awaits,
  },
  {
    type: 'function', name: 'divide_room',
    description: 'Puts a wall across a room to make two ("we could get a study out of that"), cut in half across its long side; trade_area evens it out after.',
    parameters: params({ room: ROOM, new_use: text('What the new half is for, if they said.') }), 'x-atmee': awaits,
  },
  {
    type: 'function', name: 'swap_rooms',
    description: 'Swaps what two rooms are without moving a wall ("put the bedroom where the study is"). Furniture stays where it stands.',
    parameters: params({ room_a: ROOM, room_b: ROOM }), 'x-atmee': awaits,
  },
  {
    type: 'function', name: 'knock_together',
    description: 'Takes out the wall between two neighbouring rooms to make one ("knock the kitchen and dining room together"). A load-bearing wall stays.',
    parameters: params({ room_a: ROOM, room_b: ROOM }), 'x-atmee': awaits,
  },
  // ------------------------------------------------------------ the sizes
  {
    type: 'function', name: 'trade_area',
    description: 'Moves floor from one room to a neighbour: the main verb of the negotiation ("give the living room two metres off the study"). take_from gets SMALLER, give_to gets BIGGER: read who ends up with the space, not which room was said first. The two rooms must share a wall; the wall is moved for you.',
    parameters: params({ take_from: text('The room that gives floor up (gets smaller).'), give_to: text('The room that gets the floor (gets bigger).'), ...AREA }),
    'x-atmee': awaits,
  },
  {
    type: 'function', name: 'grow_room',
    description: 'Makes a room bigger into free floor that is in no room ("the kitchen needs another couple of metres" when nothing has to give it up). To take it off a named neighbour, use trade_area.',
    parameters: params({ room: ROOM, ...AREA, towards: WALL('Which way to grow, if they said') }),
    'x-atmee': awaits,
  },
  {
    type: 'function', name: 'move_wall',
    description: 'Slides the wall between two neighbouring rooms by an exact distance the client said ("move that wall twenty centimetres"). Positive centimetres give the floor to room_a. For "a bit bigger", use trade_area.',
    parameters: params({ room_a: ROOM, room_b: ROOM, centimetres: number('How far; positive gives floor to room_a, negative to room_b.') }),
    'x-atmee': awaits,
  },
  {
    type: 'function', name: 'mark_load_bearing',
    description: 'Records that the wall between two rooms is load-bearing, so it never moves or comes out ("the surveyor says that wall stays").',
    parameters: params({ room_a: ROOM, room_b: ROOM }), 'x-atmee': awaits,
  },
  // ------------------------------------------------------------ openings
  {
    type: 'function', name: 'add_door_or_window',
    description: 'Puts in a door between two rooms, a window on an outside wall, or the front door. Where along the wall is worked out for you.',
    parameters: params({
      kind: text('door, window or front door.'), room: ROOM,
      other_room: text('For a door: the room on the other side.'), wall: WALL('For a window or the front door, the outside wall'),
    }),
    'x-atmee': awaits,
  },
  {
    type: 'function', name: 'remove_door_or_window',
    description: 'Takes a door, a window or the front door back out ("block that doorway up"). Name the room, and the other room for a door or the wall for a window when there are several.',
    parameters: params({
      kind: text('door, window or front door.'), room: ROOM,
      other_room: text('For a door: the room on the other side.'), wall: WALL('For a window, which outside wall'),
    }),
    'x-atmee': awaits,
  },
  // ----------------------------------------------------------- furniture
  {
    type: 'function', name: 'add_furniture',
    description: 'Puts a new piece in at its real size from the kit. Call it FIRST for ANY piece the client asks for, before saying anything about it (its size, whether it fits), even one you think the kit lacks (a piano, a hot tub): the plan answers with its own numbers. The kit: single, double, queen or king bed, bedside table, 2-seat, 3-seat or corner sofa, armchair, chair, stool, desk, dining, coffee or side table, wardrobe, dresser, bookshelf, TV unit, rug, plant, floor lamp.',
    parameters: params({ piece: text('What it is, as the client said it.'), room: ROOM, near: WHERE_PIECE, next_to: text('A piece already on the plan to stand it beside.') }),
    'x-atmee': awaits,
  },
  {
    type: 'function', name: 'move_furniture',
    description: 'Moves or turns a piece already on the plan ("put the sofa under the window", "turn the bed round"). Never remove and re-add a piece to move it: if the new spot does not fit, it stays where it was.',
    parameters: params({ piece: text('The piece, as the live plan names it.'), room: ROOM, near: WHERE_PIECE, next_to: text('Another piece to stand it beside.'), quarter_turns: number('To turn it: quarter turns, 1 to 3 ("round" is 2).') }),
    'x-atmee': awaits,
  },
  {
    type: 'function', name: 'remove_furniture',
    description: 'Takes a piece off the plan ("get rid of the armchair").',
    parameters: params({ piece: text('The piece, as the live plan names it.') }), 'x-atmee': awaits,
  },
  // ------------------------------------------------------------- schemes
  {
    type: 'function', name: 'save_scheme',
    description: 'Keeps the plan as a scheme to come back to or compare against, up to three ("save this one"). The plan itself does not change.',
    parameters: params({ name: text('A name, if the client gave one.') }), 'x-atmee': awaits,
  },
  {
    type: 'function', name: 'use_scheme',
    description: 'Works with a saved scheme: compare (side by side, room by room, read-only), stop_comparing, open (replaces the plan with it; undo brings the plan back) or drop. Open and drop only when the client asks.',
    parameters: params({ action: text('compare, stop_comparing, open or drop.'), scheme: text('The scheme, as the live plan names it.') }),
    'x-atmee': awaits,
  },
  // ---------------------------------------------------------------- misc
  {
    type: 'function', name: 'switch_units',
    description: 'Shows areas in square metres or square feet.',
    parameters: params({ unit: text('m2 (square metres) or ft2 (square feet).') }), 'x-atmee': awaits,
  },
  {
    type: 'function', name: 'undo_change',
    description: 'Takes back the last change to the plan ("undo", "put it back", "I preferred it before"), one step per call.',
    parameters: params({}), 'x-atmee': awaits,
  },
  {
    type: 'function', name: 'draw_sheet',
    description: 'Draws up the sheet (the plan, the area schedule and the notes for every floor that has rooms) on the client\'s screen, ready to download. Call it every time they ask for the drawing, something to keep or print, even if a sheet is already up: it redraws the plan as it is now.',
    parameters: params({}), 'x-atmee': awaits,
  },
  {
    type: 'function', name: 'clear_floor',
    description: 'Empties the floor on screen: rooms, doors, windows and furniture. Only when the client asks to start over; undo brings it back.',
    parameters: params({}), 'x-atmee': awaits,
  },
];

export const TOOL_NAMES = TOOLS.map((tool) => tool.name);

// ------------------------------------------------------------------ the state

const metres = (cm: number) => fmtG(cm / 100);
/** An area as the client reads it on screen. */
export const areaIn = (m2: number, unit: Unit) => {
  if (unit === 'ft2') {
    const ft2 = Math.round(m2 * 10.7639);
    return `${ft2} square ${ft2 === 1 ? 'foot' : 'feet'}`;
  }
  return `${fmtG(m2)} square ${m2 === 1 ? 'metre' : 'metres'}`;
};

/** A check's note in the client's unit: "1.5 square metres of the floor isn't in any room" in square feet. */
export const noteIn = (note: string, unit: Unit) => (unit === 'ft2' ? note.replace(/(\d+(?:\.\d+)?) square metres?/g, (_, n: string) => areaIn(Number(n), 'ft2')) : note);

/** A list that stops before `max` characters, saying how many it left out. */
function clip(items: string[], max: number, sep = '; '): string {
  let out = '';
  for (let i = 0; i < items.length; i++) {
    const next = out ? `${out}${sep}${items[i]}` : items[i];
    const more = items.length - i - 1;
    if (next.length + (more ? 14 : 0) > max) return `${out}${out ? sep : ''}and ${items.length - i} more`;
    out = next;
  }
  return out;
}

/**
 * The live plan, as the architect's state: what is on the client's screen and
 * every number she may be asked for. Never coordinates. At most 3,858
 * characters even at the app's own limits (twelve rooms, forty pieces, three
 * schemes, two floors, long names): sections are dropped from the least useful
 * end rather than cut mid-sentence.
 */
export function planState(snap: PlanSnapshot): string {
  const { level, schedule: table, unit } = snap;
  const floorWord = snap.levels.length > 1 ? `${level.name === 'ground' ? 'Ground' : 'Upper'} floor (of two)` : 'One floor';
  const head = `Planwright, live plan (what the client sees on screen; ground truth). ${floorWord}: ${metres(level.w_cm)} by ${metres(level.h_cm)} metres, ${areaIn(level.w_cm * level.h_cm / 10_000, unit)}. Areas are shown to the client in ${unit === 'ft2' ? 'square feet' : 'square metres'}.`;
  if (!level.rooms.length) {
    const others = snap.others?.filter((o) => o.rooms.length).map((o) => `The ${o.name} floor has ${o.rooms.length} rooms.`).join(' ') ?? '';
    return `${head} This floor is empty: no rooms yet. To lay it out you need roughly how big the place is and how many bedrooms.${others ? ` ${others}` : ''}${snap.can_undo && snap.last_change ? ` Last change: ${snap.last_change} (undo takes it back).` : ''}`;
  }

  const nameOf = new Map(level.rooms.map((r) => [r.id, r.name]));
  const byArea = [...table.rows].sort((a, b) => b.area_m2 - a.area_m2);
  const arrangement = level.name === 'ground' ? snap.typologies?.find((t) => t.key === level.style)?.label : undefined;
  const fact = (id: string) => {
    const room = level.rooms.find((r) => r.id === id)!;
    const next = level.walls.filter((w) => w.a === id || w.b === id).map((w) => nameOf.get(w.a === id ? w.b : w.a)!);
    const windows = level.openings.filter((o) => o.kind === 'window' && (o.a === id || o.b === id)).length;
    return `${room.name} ${areaIn(room.area_m2, unit)}, ${cardinal(room.bbox[0], room.bbox[1], room.bbox[2] - room.bbox[0], room.bbox[3] - room.bbox[1], level.w_cm, level.h_cm)}${next.length ? `, next to ${next.join(', ')}` : ''}${windows ? '' : ', no window'}`;
  };
  const rooms = `Rooms, biggest first: ${clip(byArea.map((row) => fact(row.id)), 1500)}.`;
  const totals = `Total ${areaIn(table.total_m2, unit)}; hall and circulation ${table.circulation_pct} percent${table.unassigned_m2 > 0 ? `; ${areaIn(table.unassigned_m2, unit)} of the floor is in no room` : ''}.`;

  const doors = level.openings.filter((o) => o.kind === 'door');
  const front = doors.filter((o) => !o.a || !o.b).map((o) => nameOf.get(o.a ?? o.b ?? '') ?? 'a room');
  const way = level.name !== 'ground' ? 'the way up is the stairs' : front.length ? `the front door opens into the ${spoken(front)}` : 'no front door yet';
  const openings = `Doors and windows: ${doors.length} doors, ${level.openings.length - doors.length} windows; ${way}.`;

  const sections: string[] = [arrangement ? `${head} Laid out as "${arrangement}".` : head, rooms, totals];
  const found = snap.issues;
  sections.push(found.length
    ? `Worth knowing (the app's own checks: good practice, not regulations; raise one at a time): ${clip(found.map((i) => noteIn(i.note, unit)), 700)}.`
    : 'Worth knowing: nothing; the checks find no problem.');
  const selected = level.rooms.find((r) => r.id === snap.selected) ?? level.items.find((i) => i.id === snap.selected);
  if (selected) sections.push(`The client has the ${'name' in selected ? selected.name : selected.label} selected.`);
  if (snap.can_undo && snap.last_change) sections.push(`Last change: ${snap.last_change} (undo_change takes it back).`);
  sections.push(openings);
  if (snap.comparing) {
    const c = snap.comparing;
    const deltas = c.deltas.map((d) => `${d.name} ${d.delta_m2 > 0 ? '+' : ''}${fmtG(d.delta_m2)}`);
    sections.push(`The client is comparing the plan with saved scheme "${c.name}" (read-only): room by room, plan minus scheme, in square metres: ${clip(deltas, 300, ', ') || 'no difference'}; hall ${c.circulation_pct ?? 0} percent then, ${table.circulation_pct} now.`);
  }
  if (snap.schemes.length) sections.push(`Saved schemes (up to three): ${snap.schemes.map((s) => `"${s.name}" (${s.rooms} rooms, ${areaIn(s.total_m2, unit)}, hall ${s.circulation_pct} percent)`).join('; ')}.`);
  for (const other of snap.others ?? []) {
    sections.push(`The ${other.name} floor (not on screen): ${other.rooms.length ? clip(other.rooms.map((r) => `${r.name} ${areaIn(r.area_m2, unit)}`), 300, ', ') : 'empty'}. Stairs ${snap.stairs_aligned ? 'line up' : 'do NOT line up'} between the floors.`);
  }
  const marked = level.walls.filter((w) => w.structural).map((w) => `${nameOf.get(w.a)} and ${nameOf.get(w.b)}`);
  if (marked.length) sections.push(`Load-bearing walls (never move): between the ${marked.join('; between the ')}.`);
  if (level.items.length) {
    const roomAt = (x: number, y: number) => level.rooms.find((r) => r.rects.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1))?.name;
    sections.push(`Furniture (real sizes): ${clip(level.items.map((i) => `${i.label} in the ${roomAt(i.x_cm + i.w_cm / 2, i.y_cm + i.h_cm / 2) ?? 'no room'}`), 600, ', ')}.`);
  }
  sections.push('The client can also change the plan by hand: drag walls and pieces, lay out the floor, add rooms, furniture, doors and windows, save and compare schemes, undo, and download the drawing sheet.');

  // Least useful sections go first if the whole is over the limit.
  let out = sections.join(' ');
  while (out.length > STATE_LIMIT && sections.length > 3) {
    sections.splice(sections.length - 1, 1);
    out = sections.join(' ');
  }
  return out.length > STATE_LIMIT ? `${out.slice(0, STATE_LIMIT - 1)}…` : out;
}

// --------------------------------------------------------------- the results

/** What to say about a problem the last change created: one issue, one line. */
export function issueCue(issue: Issue, totalNew = 1, lead = 'It also created a problem', unit: Unit = 'm2'): string {
  const note = noteIn(issue.note || 'something about the layout', unit);
  const push = ({
    unreachable: 'Say it plainly and suggest where a door could go.',
    no_door: 'Say it plainly and suggest where a door could go.',
    through_room: 'Say it plainly and suggest where a door could go.',
    no_front_door: 'Say it plainly and suggest which room the front door could open into.',
    corridor: 'Say it plainly, give the number, and suggest what to take the width from.',
    daylight: 'Say it plainly and suggest which wall could take a window.',
    stairs: 'Say it plainly: the two floors do not connect until this is fixed.',
    straddles: 'Say it plainly and offer to move that piece back into a room.',
    stranded: 'Say it plainly and offer to move that piece back into a room.',
    turning: 'Say it plainly and suggest what to take out or where to find the width.',
    door: 'Say it plainly and suggest moving that piece clear of the swing.',
    reach: 'Say it plainly and suggest pulling the bed off the wall.',
    dead_floor: 'Say it plainly and offer to give it to whichever room needs it most.',
  } as Record<string, string>)[issue.kind] ?? 'Say it plainly, give the number, and suggest what you would change.';
  const more = totalNew > 1 ? ' There are others, but mention only this one.' : '';
  return `${lead}: ${note}. ${push} Change it only if they agree. One short line, under 25 words.${more}`;
}

const NEAR: Record<string, string> = { window: 'by a window', door: 'by the door', north_wall: 'against the north wall', south_wall: 'against the south wall', east_wall: 'against the east wall', west_wall: 'against the west wall', center: '' };
const nearWords = (near?: string) => (near ? NEAR[near] ?? (near.startsWith('beside') ? 'beside the piece asked for' : '') : '');

/** One accepted change as facts (in the client's unit) and what to say about them. */
export function doneLine(done: Done, snap: PlanSnapshot): { fact: string; say: string } {
  const r = done.rooms ?? [];
  const table = snap.schedule;
  const area = (m2: number) => areaIn(m2, snap.unit);
  const roomLine = (room: RoomFact) => `the ${room.name.toLowerCase()} ${area(room.area_m2)}`;
  switch (done.kind) {
    case 'generate': {
      const size = done.size ? `the floor is ${metres(done.size.w_cm)} by ${metres(done.size.h_cm)} metres; ` : '';
      if (snap.level.name !== 'ground') {
        // The typologies describe a ground floor; upstairs is bedrooms round a landing.
        return {
          fact: `${size}the upper floor is laid out: ${spoken(snap.level.rooms.filter((room) => room.kind !== 'stairs').map((room) => room.name.toLowerCase()))}, ${area(table.total_m2)} in all, with the stairs ${snap.stairs_aligned ? 'lined up with the ones below' : 'NOT lined up with the ones below'}`,
          say: 'Say one short line about how the bedrooms sit, as a starting point to argue with. Do not list every room.',
        };
      }
      return {
        fact: `${size}the ${snap.level.name} floor is laid out as "${done.typology?.label}" (${done.typology?.note}): ${snap.level.rooms.length} rooms, ${area(table.total_m2)} in all, ${table.circulation_pct} percent of it hall`,
        say: 'Say one short line naming the arrangement and why it suits them, as a starting point to argue with. Do not list every room.',
      };
    }
    case 'set_envelope':
      return { fact: `the floor is now ${metres(done.size!.w_cm)} by ${metres(done.size!.h_cm)} metres, ${area(done.size!.w_cm * done.size!.h_cm / 10_000)} in all`, say: 'Say one short line about what that gives them to work with.' };
    case 'add_room':
      return {
        fact: `the ${r[0].name.toLowerCase()} is on the plan, ${area(r[0].area_m2)}, ${r[0].where}${done.takenFrom ? `, taken off the ${done.takenFrom.name.toLowerCase()} (now ${area(done.takenFrom.area_m2)})` : ''}`,
        say: `Say one short line naming roughly where it went${done.takenFrom ? ' and whose floor it took' : ''}. No coordinates.`,
      };
    case 'remove_room':
      return { fact: `the ${done.removed!.name.toLowerCase()} is gone, which leaves ${area(done.removed!.area_m2)} of floor in no room`, say: "Say one short line about what you'd do with that floor." };
    case 'rename_room': {
      const kind = snap.level.rooms.find((room) => room.id === r[0].id)?.kind;
      const use = (snap.room_kinds?.find((k) => k.kind === kind)?.label ?? 'room').toLowerCase();
      const renamed = done.was && done.was !== r[0].name;
      return { fact: renamed ? `the ${done.was!.toLowerCase()} is now called the ${r[0].name.toLowerCase()} (used as a ${use})` : `the ${r[0].name.toLowerCase()} is now used as a ${use}`, say: 'Say one short line about what it is now.' };
    }
    case 'swap_rooms':
      return { fact: `the ${r[0].name.toLowerCase()} and the ${r[1].name.toLowerCase()} have swapped over without moving a wall: now ${roomLine(r[0])} ${r[0].where}, ${roomLine(r[1])} ${r[1].where}`, say: 'Say one short line about why the new arrangement works better: light, noise, or how far it is from the door.' };
    case 'merge_rooms':
      return { fact: `the wall between the ${r[0].name.toLowerCase()} and the ${(done.was ?? 'other room').toLowerCase()} is out: one ${r[0].name.toLowerCase()} of ${area(r[0].area_m2)} now`, say: 'Say one short line about what that gains them and what it costs.' };
    case 'split_room':
      return { fact: `the ${r[0].name.toLowerCase()} is divided in two: ${roomLine(r[0])} and the new ${r[1].name.toLowerCase()} ${area(r[1].area_m2)}`, say: "Say both sizes in one short line, and offer to shift the wall if the split isn't right." };
    case 'move_wall':
      return { fact: `the wall moved: ${roomLine(r[0])} now, ${roomLine(r[1])}`, say: 'Say both new sizes in one short line.' };
    case 'trade_area':
      return { fact: `${area(done.moved_m2 ?? 0)} moved from the ${r[1].name.toLowerCase()} to the ${r[0].name.toLowerCase()}: ${roomLine(r[0])} now, ${roomLine(r[1])}`, say: "Say both new sizes in one short line: that trade is the decision they're making." };
    case 'grow_room':
      return { fact: `the ${r[0].name.toLowerCase()} grew into spare floor: ${area(r[0].area_m2)} now`, say: 'Say its new size and what it now fits, in one short line.' };
    case 'mark_structural':
      return { fact: `the wall between the ${r[0].name.toLowerCase()} and the ${r[1].name.toLowerCase()} is marked load-bearing and will not move again`, say: 'Say one short line about designing around it.' };
    case 'add_door':
      return { fact: `there is a door between the ${done.opening!.rooms.map((x) => x.toLowerCase()).join(' and the ')} now`, say: 'Say one short line about how the floor flows now.' };
    case 'add_window':
      return { fact: `the ${(done.opening!.rooms[0] ?? 'room').toLowerCase()} has a window on the ${done.opening!.wall} side now`, say: 'Say one short line about the light it gets.' };
    case 'add_front_door':
      return { fact: `the front door is in the ${(done.opening!.rooms[0] ?? 'room').toLowerCase()}, on the ${done.opening!.wall} side`, say: 'Say one short line about what you walk into.' };
    case 'remove_opening':
      return { fact: `${done.label.replace(/^took out /, '')} is out of the wall`, say: 'Say one short line about what it changes: light, or how you get around.' };
    case 'add_item': {
      const item = done.item!;
      const near = nearWords(item.near);
      return { fact: `a ${item.label.toLowerCase()} (${item.w_cm} by ${item.h_cm} centimetres, its real size) is in ${item.room ? `the ${item.room.toLowerCase()}` : 'the plan'}${near ? `, ${near}` : ''}`, say: 'Say one short line naming where it went. No coordinates.' };
    }
    case 'place_item':
    case 'move_item': {
      const item = done.item!;
      const near = nearWords(item.near);
      return { fact: `the ${item.label.toLowerCase()} has moved; it is in ${item.room ? `the ${item.room.toLowerCase()}` : 'no room'}${near ? `, ${near}` : ''}`, say: 'Say one short line naming where it is now. No coordinates.' };
    }
    case 'rotate_item':
      return { fact: `the ${done.item!.label.toLowerCase()} is turned (it now takes ${done.item!.w_cm} by ${done.item!.h_cm} centimetres)`, say: 'Say one short line about how it sits now.' };
    case 'remove_item':
      return { fact: `the ${done.item!.label.toLowerCase()} is off the plan`, say: 'Say one short line about the floor that frees up.' };
    case 'add_level': {
      const stairs = snap.level.rooms.some((room) => room.kind === 'stairs');
      const took = done.takenFrom ? `; the ground floor keeps its layout, and the stairs took their floor off the ${done.takenFrom.name.toLowerCase()} (now ${area(done.takenFrom.area_m2)})` : '';
      return { fact: `there is an upper floor now and the client is looking at it; ${stairs ? 'the stairs are in on both floors' : 'the ground floor had no room to spare for stairs'}${snap.stairs_aligned ? ', lined up' : ', but they do not line up yet'}${took}`, say: 'Say one short line, including where the stairs came from; they can lay the upper floor out next (ask how many bedrooms go up there).' };
    }
    case 'remove_level':
      return { fact: 'the upper floor is gone; the client is back on the ground floor', say: 'Say one short line.' };
    case 'go_to_level':
      return { fact: `the client is now looking at the ${done.level} floor: ${snap.level.rooms.length ? `${snap.level.rooms.length} rooms, ${area(table.total_m2)}` : 'empty so far'}`, say: "Say one short line about what's on it." };
    case 'save_scheme':
      return { fact: `the plan is saved as scheme "${done.scheme}" (${snap.schemes.length} of three saved); the plan itself has not changed`, say: 'Say one short line, and ask whether they want to try a different arrangement now that this one is safe.' };
    case 'load_scheme':
      return { fact: `the plan is back to scheme "${done.scheme}": ${snap.level.rooms.length} rooms, ${area(table.total_m2)} (undo brings back the plan it replaced)`, say: "Say one short line about what's different about it." };
    case 'drop_scheme':
      return { fact: `scheme "${done.scheme}" is dropped`, say: 'Say one short line.' };
    case 'compare_scheme': {
      if (!done.scheme) return { fact: 'the comparison is closed; the plan is on its own again', say: 'Say a few words and carry on.' };
      const c = snap.comparing;
      const deltas = (c?.deltas ?? []).slice(0, 6).map((d) => `${d.name} ${d.delta_m2 > 0 ? 'bigger' : 'smaller'} by ${area(Math.abs(d.delta_m2))}`);
      return {
        fact: `scheme "${done.scheme}" is side by side with the plan; the plan against it: ${deltas.length ? spoken(deltas) : 'no difference room by room'}; hall ${c?.circulation_pct ?? 0} percent then, ${table.circulation_pct} now`,
        say: 'Say one short line about the trade: what one gains and what it takes it from.',
      };
    }
    case 'set_unit':
      return { fact: `areas now show in ${done.unit === 'ft2' ? 'square feet' : 'square metres'}: ${areaIn(table.total_m2, done.unit ?? 'm2')} in all`, say: 'Say one short line with the total in the new unit.' };
    case 'undo':
      return { fact: `the last change (${done.undone}) is taken back`, say: 'Say one short line naming what the plan is back to. It is not a new change.' };
    case 'clear':
      return { fact: `the ${snap.level.name} floor is empty again (undo brings it back)`, say: 'Say one short line inviting them to start from the size of the place.' };
    case 'draw_sheet': {
      const floors = (snap.sheet?.pages ?? []).map((page) => `the ${page.floor} floor`);
      return { fact: `the drawing sheet (plan, area schedule and notes${floors.length ? ` for ${spoken(floors)}` : ''}) is up on the client's screen, with a button to download it`, say: "Say one short line pointing at it, and mention it's design guidance rather than a building-regulations check." };
    }
    case 'select':
      return { fact: `the client is looking at the ${r[0]?.name.toLowerCase() ?? 'selection'}`, say: 'Carry on with it.' };
    default:
      return { fact: done.label, say: 'Say one short line about it.' };
  }
}

/** What the client asked for, for a refusal: "move 2 square metres from the study to the living room". */
export function asked(intent: Intent, snap: PlanSnapshot): string {
  const nameOf = (value: unknown) => {
    const id = String(value ?? '');
    const room = snap.level.rooms.find((r) => r.id === id);
    const item = snap.level.items.find((i) => i.id === id);
    return (room?.name ?? item?.label ?? id).toLowerCase();
  };
  switch (intent.kind) {
    case 'generate': return `lay the floor out with ${intent.bedrooms ?? 1} bedroom${intent.bedrooms === 1 ? '' : 's'}${intent.w && intent.h ? ` at ${metres(Number(intent.w))} by ${metres(Number(intent.h))} metres` : ''}`;
    case 'set_envelope': return `make the floor ${metres(Number(intent.w))} by ${metres(Number(intent.h))} metres`;
    case 'add_room': return `add a ${String(intent.room_kind).replaceAll('_', ' ')}`;
    case 'remove_room': return `remove the ${nameOf(intent.id)}`;
    case 'rename_room': return `change the ${nameOf(intent.id)}`;
    case 'swap_rooms': return `swap the ${nameOf(intent.a)} and the ${nameOf(intent.b)}`;
    case 'merge_rooms': return `knock the ${nameOf(intent.a)} and the ${nameOf(intent.b)} together`;
    case 'split_room': return `divide the ${nameOf(intent.id)}`;
    case 'move_wall': return `move the wall between the ${nameOf(intent.a)} and the ${nameOf(intent.b)}`;
    case 'trade_area': return `move ${areaIn(Number(intent.m2), 'm2')} from the ${nameOf(intent.from)} to the ${nameOf(intent.to)}`;
    case 'grow_room': return `make the ${nameOf(intent.id)} bigger`;
    case 'mark_structural': return `mark the wall between the ${nameOf(intent.a)} and the ${nameOf(intent.b)} load-bearing`;
    case 'add_door': return `put a door between the ${nameOf(intent.a)} and the ${nameOf(intent.b)}`;
    case 'add_window': return `put a window in the ${nameOf(intent.id)} on the ${intent.wall} side`;
    case 'add_front_door': return `put the front door in the ${nameOf(intent.id)}`;
    case 'remove_opening': return 'take a door or window out';
    case 'add_item': return `add a ${String(intent.type).replaceAll('_', ' ')}${intent.room ? ` to the ${nameOf(intent.room)}` : ''}`;
    case 'place_item': case 'move_item': return `move the ${nameOf(intent.id)}`;
    case 'rotate_item': return `turn the ${nameOf(intent.id)}`;
    case 'remove_item': return `remove the ${nameOf(intent.id)}`;
    case 'add_level': return 'add an upper floor';
    case 'go_to_level': return `go to the ${intent.id} floor`;
    case 'save_scheme': return 'save the plan as a scheme';
    case 'load_scheme': return `go back to scheme ${intent.name}`;
    case 'compare_scheme': return intent.name === 'off' ? 'close the comparison' : `compare with scheme ${intent.name}`;
    case 'drop_scheme': return `drop scheme ${intent.name}`;
    case 'undo': return 'undo the last change';
    case 'clear': return 'clear the floor';
    case 'draw_sheet': return 'draw up the sheet';
    case 'set_unit': return 'switch units';
    default: return 'change the plan';
  }
}

/**
 * For a piece that was refused, the room's own numbers, so the architect has
 * nothing to estimate (live, she guessed "nearly four square metres" for a
 * grand piano before the refusal arrived).
 */
function roomNumbers(intent: Intent, snap: PlanSnapshot): string {
  if (intent.kind !== 'add_item' && intent.kind !== 'place_item') return '';
  const level = snap.level;
  const inRoom = (room: { rects: number[][] }, x: number, y: number) => room.rects.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
  const ref = String(intent.room ?? '').trim().toLowerCase();
  const item = intent.kind === 'place_item' ? level.items.find((i) => i.id === intent.id) : undefined;
  const room = level.rooms.find((r) => ref && (r.id.toLowerCase() === ref || r.name.toLowerCase() === ref))
    ?? (item ? level.rooms.find((r) => inRoom(r, item.x_cm + item.w_cm / 2, item.y_cm + item.h_cm / 2)) : undefined);
  if (!room) return '';
  const pieces = level.items.filter((i) => inRoom(room, i.x_cm + i.w_cm / 2, i.y_cm + i.h_cm / 2));
  const clear = Math.max(0, Math.round((room.area_m2 - pieces.reduce((sum, i) => sum + i.w_cm * i.h_cm, 0) / 10_000) * 10) / 10);
  return ` The plan's own numbers, if they help: the ${room.name.toLowerCase()} is ${areaIn(room.area_m2, snap.unit)}, ${pieces.length ? `${pieces.length} piece${pieces.length === 1 ? '' : 's'} in it, ` : ''}about ${areaIn(clear, snap.unit)} of it clear. Give no other size.`;
}

/** One step the planner took, and how it went. */
export interface Step { intent: Intent; result: ApplyResult }

/**
 * A tool's result: what it did in real numbers and how to say it, or the
 * refusal and its reason. The problem the change created (the critic) is
 * folded in, so one change gets one voice.
 */
export function resultFor(steps: Step[], fresh: Issue[], snap: PlanSnapshot): string {
  const facts = steps.flatMap((s) => (s.result.applied ? [doneLine(s.result.done, snap)] : []));
  const refused = steps.find((s) => !s.result.applied);
  let out: string;
  if (refused && !refused.result.applied) {
    const what = asked(refused.intent, snap);
    out = facts.length
      ? `Done: ${facts.map((f) => f.fact).join('; ')}. The rest was refused and has NOT changed: they asked to ${what}, and the plan says: "${refused.result.reason}" Say in one or two short lines which part worked and which did not, and suggest a fix for the refused part; make it only if they agree.`
      : `Refused: nothing has changed. They asked to ${what}, and the plan says: "${refused.result.reason}"${roomNumbers(refused.intent, snap)} Tell them so in one short line in your own words and suggest a fix; make it only if they agree. Never describe it as done.`;
  } else if (facts.length) {
    out = `Done: ${facts.map((f) => f.fact).join('; ')}. ${facts[facts.length - 1].say}`;
  } else {
    out = 'Not yet: nothing changed.';
  }
  if (fresh.length) out += ` ${issueCue(fresh[0], fresh.length, undefined, snap.unit)}`;
  return out;
}

/** A call that could not be pinned down: the architect asks rather than guesses. */
export const notDone = (question: string) => `Not yet: nothing changed. ${question} Ask the client that in one short line, then call the tool again with their answer.`;

/** Kinds that change nothing worth a word when the client does them by hand. */
const QUIET_BY_HAND = new Set(['select', 'move_item', 'move_wall', 'rotate_item', 'remove_item', 'add_item', 'set_unit', 'go_to_level', 'compare_scheme', 'undo', 'rename_room', 'trade_area', 'grow_room', 'split_room', 'merge_rooms', 'swap_rooms', 'mark_structural', 'add_door', 'add_window', 'add_front_door', 'remove_opening', 'add_room', 'remove_room', 'place_item', 'set_envelope', 'drop_scheme', 'remove_level']);

/**
 * The events for a change the client made by hand (a button, a drag). The
 * architect cannot see the click, so the milestones are told (a floor laid
 * out, a scheme saved or opened, the sheet drawn); a small edit is not
 * narrated, since the client did it and can see it (the state carries it).
 * A problem it created is told on its own: there is no request behind a drag,
 * so the critic is the only voice there is.
 */
export function byHand(steps: Step[], fresh: Issue[], snap: PlanSnapshot): { text: string; ttl: number }[] {
  const out: { text: string; ttl: number }[] = [];
  const loud = steps.filter((s) => s.result.applied && (!QUIET_BY_HAND.has(s.result.done.kind) || (s.result.done.kind === 'compare_scheme' && s.result.done.scheme)));
  if (loud.length) {
    const lines = loud.map((s) => doneLine((s.result as { done: Done }).done, snap));
    out.push({ text: `The client changed the plan by hand: ${lines.map((l) => l.fact).join('; ')}. ${lines[lines.length - 1].say}`, ttl: 20 });
  }
  if (fresh.length) out.push({ text: issueCue(fresh[0], fresh.length, "The client's change by hand created a problem", snap.unit), ttl: 20 });
  return out;
}

export const say = {
  /** The opening, once the architect is on her way (after her own greeting). */
  opening: (snap: PlanSnapshot) => snap.level.rooms.length
    ? `You have just greeted them; do not greet or introduce yourself again. Their plan is on screen: ${snap.level.rooms.length} rooms, ${areaIn(snap.schedule.total_m2, snap.unit)}. In one short line ask what they would change first.`
    : `You have just greeted them; do not greet or introduce yourself again. The floor on their screen is empty (${metres(snap.level.w_cm)} by ${metres(snap.level.h_cm)} metres for now). To sketch you need roughly how big the place is and how many bedrooms they need: if your greeting already asked, do not ask again, just wait for their answer; otherwise ask it in one short line. Ask nothing else yet.`,
  /** A photo read by the app. */
  photo: (purpose: 'room' | 'piece', added: string[], refused: string[], seen: string) => {
    const what = purpose === 'piece' ? 'a photo of a piece of furniture they own' : 'a photo of a room in their home';
    if (!added.length && !refused.length) return `The client shared ${what}; the app found no furniture from the kit in it${seen ? ` (it saw: ${seen})` : ''}. Say so in one short line and ask what they would like to add instead.`;
    return `The client shared ${what}. You cannot see it; the app read it${seen ? ` (it saw: ${seen})` : ''} and ${added.length ? `added to the plan, at real kit sizes: ${spoken(added)}` : 'added nothing'}${refused.length ? `; it could not place: ${spoken(refused)}` : ''}. Say in one or two short lines what went in and where; never guess a measurement from a photo.`;
  },
};
