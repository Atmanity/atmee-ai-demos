// What the avatar is told, and when.
//
// The planner decides everything; the avatar is the architect who talks about
// it. On the API it cannot call the planner (no function calling) and it hears
// the client at the same moment the app does, so it learns what happened from
// three things:
// - NOTES: the standing rules (sent once), condensed from the original prompt,
//   with its hard-won "never" rules kept;
// - the STATE: the live plan in plain sentences, replaced after every change;
// - EVENTS: one per outcome ("the trade is done: the study is now 9.4 square
//   metres..."), which the avatar says in its own words.
import type { Issue } from './compliance.ts';
import { cardinal, spoken } from './describe.ts';
import { fmtG } from './num.ts';
import type { ApplyResult, Done, Intent, PlanSnapshot, RoomFact } from './types.ts';

/** The state's hard limit on the API. */
export const STATE_LIMIT = 3858;
/** Each note's hard limit on the API. */
export const NOTE_LIMIT = 2000;

/** Standing rules, sent once as notes. */
export const NOTES = [
  `You are an architect at a drawing board with a client, planning their whole home (up to two floors). Keep your own name and manner: the plan is the job, not your identity. Twenty years of laying out real homes: you think in square metres and say the numbers out loud. You are opinionated about what a drawing hides (getting to every room without walking through another, ninety centimetres to pass in a corridor, daylight in every room people sit in, a bathroom you can turn round in), warm and quick, and you make a call rather than offering three options; when a decision is a genuine trade, you show both sides and let them choose. The plan is on the client's screen beside you, and your state describes it: that is ground truth. Rooms are given by area and compass direction, because that is how you talk about a home. Never describe a room, door, window or piece that is not in it. Never say a plan is "compliant", "to code" or "meets regulations", and never name a building regulation, standard or clause: you are not checking one, and saying you are would mislead them. Your standards are good practice and you own them personally: "I'd want ninety centimetres there", not "the code requires". Sizes come from the kit and are real (a queen bed is 152 by 203); never invent a dimension.`,
  `You cannot change the plan yourself: the app changes it, from what the client says, types or clicks. When the client asks for a change (lay out the floor, its size, add or remove a room, trade area, move or knock out a wall, divide or swap rooms, a door or window, furniture, a second floor, save or compare a scheme, units, undo, the drawing sheet), say only a few words like "Let me draw that" and stop. The app makes the change and tells you the result a moment later, refusals included; then say it in a line. Never say a change is done, and never give its new sizes, before the app tells you, and never confirm a change the app refused: the client is looking straight at the drawing. If the app already told you, carry on from it. If only part of a request could be done, say which part. You never choose coordinates and never ask the client for x and y: say roughly where (by the window, the north wall, next to the kitchen) and the plan finds the spot. Every change can be taken back by saying "undo"; never redraw by hand what undo gives back. You may suggest a change ("shall I give bedroom two a metre off the hall?"); if they agree, the app makes it. Never invent a limit: do not tell the client something cannot be done unless the app said so; its refusals are written to be said out loud.`,
  `Getting started: do not interview. You need roughly how big the place is, how many bedrooms, and who lives there; ask in one or two turns, then the app sketches a whole floor. Say it is a starting point to argue with, not the answer; everything is changeable. A second floor comes with its stairs on both floors, lined up: you never place them. Negotiating: the trade is the conversation. When a room grows another shrinks, and you say which ("that gives bedroom two an extra three square metres, taken off the hall"). Talk in square metres, not centimetres, unless the client is precise. When they cannot decide, suggest saving this scheme, drawing the alternative and comparing them room by room. The app's checks ("worth knowing" in your state) are good practice, not a regulations check: raise one at a time, when it matters. Photos: the client can share a photo of a room or a piece; the app reads the furniture in it (never measurements) and tells you what it added. You do not see the photo. Speech: output only what you say aloud, no lists, labels or markdown. One short sentence by default, two when a trade needs explaining, under 30 words. Say numbers as a person would: "thirteen square metres", "a metre twenty". If asked whether you are real, say you are an AI avatar made by Atmee.`,
];

// ------------------------------------------------------------------ the state

const sq = (m2: number) => `${fmtG(m2)} square metres`;
const areaIn = (m2: number, unit: 'm2' | 'ft2') => (unit === 'ft2' ? `${Math.round(m2 * 10.7639)} square feet` : sq(m2));
const metres = (cm: number) => fmtG(cm / 100);

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
 * The live plan, as the avatar's state: what is on the client's screen and every
 * number the architect may be asked for. Never coordinates. At most 3,858
 * characters even at the app's own limits (twelve rooms, forty pieces, three
 * schemes, two floors, long names): sections are dropped from the least useful
 * end rather than cut mid-sentence.
 */
export function planState(snap: PlanSnapshot): string {
  const { level, schedule: table, unit } = snap;
  const floorWord = snap.levels.length > 1 ? `${level.name === 'ground' ? 'Ground' : 'Upper'} floor (of two)` : 'One floor';
  const head = `Home planner, live plan (what the client sees on screen; ground truth). ${floorWord}: ${metres(level.w_cm)} by ${metres(level.h_cm)} metres, ${sq(level.w_cm * level.h_cm / 10_000)}. Areas are shown to the client in ${unit === 'ft2' ? 'square feet' : 'square metres'}.`;
  if (!level.rooms.length) {
    const others = snap.others?.filter((o) => o.rooms.length).map((o) => `The ${o.name} floor has ${o.rooms.length} rooms.`).join(' ') ?? '';
    return `${head} This floor is empty: no rooms yet. To sketch one the app needs roughly how big the place is and how many bedrooms; ask, then the app lays the whole floor out.${others ? ` ${others}` : ''}${snap.can_undo && snap.last_change ? ` Last change: ${snap.last_change} (undo takes it back).` : ''}`;
  }

  const nameOf = new Map(level.rooms.map((r) => [r.id, r.name]));
  const byArea = [...table.rows].sort((a, b) => b.area_m2 - a.area_m2);
  const fact = (id: string) => {
    const room = level.rooms.find((r) => r.id === id)!;
    const next = level.walls.filter((w) => w.a === id || w.b === id).map((w) => nameOf.get(w.a === id ? w.b : w.a)!);
    const windows = level.openings.filter((o) => o.kind === 'window' && (o.a === id || o.b === id)).length;
    return `${room.name} ${areaIn(room.area_m2, unit)}, ${cardinal(room.bbox[0], room.bbox[1], room.bbox[2] - room.bbox[0], room.bbox[3] - room.bbox[1], level.w_cm, level.h_cm)}${next.length ? `, next to ${next.join(', ')}` : ''}${windows ? '' : ', no window'}`;
  };
  const rooms = `Rooms, biggest first: ${clip(byArea.map((row) => fact(row.id)), 1500)}.`;
  const totals = `Total ${areaIn(table.total_m2, unit)}; hall and circulation ${table.circulation_pct} percent${table.unassigned_m2 > 0 ? `; ${sq(table.unassigned_m2)} of the floor is in no room` : ''}.`;

  const doors = level.openings.filter((o) => o.kind === 'door');
  const front = doors.filter((o) => !o.a || !o.b).map((o) => nameOf.get(o.a ?? o.b ?? '') ?? 'a room');
  const way = level.name !== 'ground' ? 'the way up is the stairs' : front.length ? `the front door opens into the ${spoken(front)}` : 'no front door yet';
  const openings = `Doors and windows: ${doors.length} doors, ${level.openings.length - doors.length} windows; ${way}.`;

  const sections: string[] = [head, rooms, totals];
  const found = snap.issues;
  sections.push(found.length
    ? `Worth knowing (the app's own checks: good practice, not regulations; raise one at a time): ${clip(found.map((i) => i.note), 700)}.`
    : 'Worth knowing: nothing; the checks find no problem.');
  const selected = level.rooms.find((r) => r.id === snap.selected) ?? level.items.find((i) => i.id === snap.selected);
  if (selected) sections.push(`The client has the ${'name' in selected ? selected.name : selected.label} selected.`);
  if (snap.can_undo && snap.last_change) sections.push(`Last change: ${snap.last_change} (if they say undo, the app takes it back).`);
  sections.push(openings);
  if (snap.comparing) {
    const c = snap.comparing;
    const deltas = c.deltas.map((d) => `${d.name} ${d.delta_m2 > 0 ? '+' : ''}${fmtG(d.delta_m2)}`);
    sections.push(`The client is comparing the plan with saved scheme "${c.name}" (read-only): room by room, plan minus scheme, in square metres: ${clip(deltas, 300, ', ') || 'no difference'}; hall ${c.circulation_pct ?? 0} percent then, ${table.circulation_pct} now.`);
  }
  if (snap.schemes.length) sections.push(`Saved schemes (up to three): ${snap.schemes.map((s) => `"${s.name}" (${s.rooms} rooms, ${sq(s.total_m2)}, hall ${s.circulation_pct} percent)`).join('; ')}.`);
  for (const other of snap.others ?? []) {
    sections.push(`The ${other.name} floor (not on screen): ${other.rooms.length ? clip(other.rooms.map((r) => `${r.name} ${fmtG(r.area_m2)}`), 300, ', ') : 'empty'}. Stairs ${snap.stairs_aligned ? 'line up' : "do NOT line up"} between the floors.`);
  }
  const marked = level.walls.filter((w) => w.structural).map((w) => `${nameOf.get(w.a)} and ${nameOf.get(w.b)}`);
  if (marked.length) sections.push(`Load-bearing walls (never move): between the ${marked.join('; between the ')}.`);
  if (level.items.length) {
    const roomAt = (x: number, y: number) => level.rooms.find((r) => r.rects.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1))?.name;
    sections.push(`Furniture (real sizes): ${clip(level.items.map((i) => `${i.label} in the ${roomAt(i.x_cm + i.w_cm / 2, i.y_cm + i.h_cm / 2) ?? 'no room'}`), 600, ', ')}.`);
  }
  sections.push('The client can also do everything on the panel: drag walls and pieces, lay out the floor, add rooms, furniture, doors and windows, save and compare schemes, undo, and download the drawing sheet.');

  // Least useful sections go first if the whole is over the limit.
  let text = sections.join(' ');
  while (text.length > STATE_LIMIT && sections.length > 3) {
    sections.splice(sections.length - 1, 1);
    text = sections.join(' ');
  }
  return text.length > STATE_LIMIT ? `${text.slice(0, STATE_LIMIT - 1)}…` : text;
}

// ----------------------------------------------------------------- the events

/** What to say when the last change broke something: one issue, one line. */
export function issueCue(issue: Issue, totalNew = 1): string {
  const note = issue.note || 'something about the layout';
  const push = ({
    unreachable: 'Say it plainly and suggest where the door should go.',
    no_door: 'Say it plainly and suggest where the door should go.',
    through_room: 'Say it plainly and suggest where the door should go.',
    no_front_door: 'Say it plainly and suggest which room the front door should open into.',
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
  return `The change just made created a problem: ${note}. ${push} One short line, in character, under 25 words.${more}`;
}

const unitWords = (unit: 'm2' | 'ft2') => (unit === 'ft2' ? 'square feet' : 'square metres');
const roomLine = (r: RoomFact) => `the ${r.name.toLowerCase()} ${sq(r.area_m2)}`;
const NEAR: Record<string, string> = { window: 'by a window', door: 'by the door', north_wall: 'against the north wall', south_wall: 'against the south wall', east_wall: 'against the east wall', west_wall: 'against the west wall', center: '' };
const nearWords = (near?: string) => (near ? NEAR[near] ?? (near.startsWith('beside') ? 'beside the piece asked for' : '') : '');

/** One accepted change as facts and what to say about them. */
export function doneLine(done: Done, snap: PlanSnapshot): { fact: string; say: string } {
  const r = done.rooms ?? [];
  const table = snap.schedule;
  switch (done.kind) {
    case 'generate':
      if (snap.level.name !== 'ground') {
        // The typologies describe a ground floor; upstairs is bedrooms round a landing.
        return {
          fact: `the upper floor is laid out: ${spoken(snap.level.rooms.filter((room) => room.kind !== 'stairs').map((room) => room.name.toLowerCase()))}, ${sq(table.total_m2)} in all, with the stairs ${snap.stairs_aligned ? 'lined up with the ones below' : 'NOT lined up with the ones below'}`,
          say: 'Say one short line about how the bedrooms sit, as a starting point to argue with. Do not list every room.',
        };
      }
      return {
        fact: `the ${snap.level.name} floor is laid out as "${done.typology?.label}" (${done.typology?.note}): ${snap.level.rooms.length} rooms, ${sq(table.total_m2)} in all, ${table.circulation_pct} percent of it hall`,
        say: 'Say one short line naming the arrangement and why it suits them, as a starting point to argue with. Do not list every room.',
      };
    case 'set_envelope':
      return { fact: `the floor is now ${metres(done.size!.w_cm)} by ${metres(done.size!.h_cm)} metres, ${sq(done.size!.w_cm * done.size!.h_cm / 10_000)} in all`, say: 'Say one short line about what that gives them to work with.' };
    case 'add_room':
      return {
        fact: `the ${r[0].name.toLowerCase()} is on the plan, ${sq(r[0].area_m2)}, ${r[0].where}${done.takenFrom ? `, taken off the ${done.takenFrom.name.toLowerCase()} (now ${sq(done.takenFrom.area_m2)})` : ''}`,
        say: `Say one short line naming roughly where it went${done.takenFrom ? ' and whose floor it took' : ''}. No coordinates.`,
      };
    case 'remove_room':
      return { fact: `the ${done.removed!.name.toLowerCase()} is gone, which leaves ${sq(done.removed!.area_m2)} of floor in no room`, say: "Say one short line about what you'd do with that floor." };
    case 'rename_room': {
      const kind = snap.level.rooms.find((room) => room.id === r[0].id)?.kind;
      const use = (snap.room_kinds?.find((k) => k.kind === kind)?.label ?? 'room').toLowerCase();
      const renamed = done.was && done.was !== r[0].name;
      return { fact: renamed ? `the ${done.was!.toLowerCase()} is now called the ${r[0].name.toLowerCase()} (used as a ${use})` : `the ${r[0].name.toLowerCase()} is now used as a ${use}`, say: 'Say one short line about what it is now.' };
    }
    case 'swap_rooms':
      return { fact: `the ${r[0].name.toLowerCase()} and the ${r[1].name.toLowerCase()} have swapped over without moving a wall: now ${roomLine(r[0])} ${r[0].where}, ${roomLine(r[1])} ${r[1].where}`, say: 'Say one short line about why the new arrangement works better: light, noise, or how far it is from the door.' };
    case 'merge_rooms':
      return { fact: `the wall between the ${r[0].name.toLowerCase()} and the ${(done.was ?? 'other room').toLowerCase()} is out: one ${r[0].name.toLowerCase()} of ${sq(r[0].area_m2)} now`, say: 'Say one short line about what that gains them and what it costs.' };
    case 'split_room':
      return { fact: `the ${r[0].name.toLowerCase()} is divided in two: ${roomLine(r[0])} and the new ${r[1].name.toLowerCase()} ${sq(r[1].area_m2)}`, say: "Say both sizes in one short line, and offer to shift the wall if the split isn't right." };
    case 'move_wall':
      return { fact: `the wall moved: ${roomLine(r[0])} now, ${roomLine(r[1])}`, say: 'Say both new sizes in one short line.' };
    case 'trade_area':
      return { fact: `${sq(done.moved_m2 ?? 0)} moved from the ${r[1].name.toLowerCase()} to the ${r[0].name.toLowerCase()}: ${roomLine(r[0])} now, ${roomLine(r[1])}`, say: "Say both new sizes in one short line: that trade is the decision they're making." };
    case 'grow_room':
      return { fact: `the ${r[0].name.toLowerCase()} grew into spare floor: ${sq(r[0].area_m2)} now`, say: 'Say its new size and what it now fits, in one short line.' };
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
      return { fact: `the ${done.item!.label.toLowerCase()} is turned a quarter turn (it now takes ${done.item!.w_cm} by ${done.item!.h_cm} centimetres)`, say: 'Say one short line about how it sits now.' };
    case 'remove_item':
      return { fact: `the ${done.item!.label.toLowerCase()} is off the plan`, say: 'Say one short line about the floor that frees up.' };
    case 'add_level':
      return { fact: `there is an upper floor now and the client is looking at it; ${snap.level.rooms.some((room) => room.kind === 'stairs') ? 'the stairs are in on both floors' : 'the ground floor had no room to spare for stairs'}${snap.stairs_aligned ? ', lined up' : ', but they do not line up yet'}`, say: 'Say one short line; they can lay the upper floor out next (say how many bedrooms).' };
    case 'remove_level':
      return { fact: 'the upper floor is gone; the client is back on the ground floor', say: 'Say one short line.' };
    case 'go_to_level':
      return { fact: `the client is now looking at the ${done.level} floor: ${snap.level.rooms.length ? `${snap.level.rooms.length} rooms, ${sq(table.total_m2)}` : 'empty so far'}`, say: "Say one short line about what's on it." };
    case 'save_scheme':
      return { fact: `the plan is saved as scheme "${done.scheme}" (${snap.schemes.length} of three saved); the plan itself has not changed`, say: 'Say one short line and offer to try a different arrangement now that this one is safe.' };
    case 'load_scheme':
      return { fact: `the plan is back to scheme "${done.scheme}": ${snap.level.rooms.length} rooms, ${sq(table.total_m2)}`, say: "Say one short line about what's different about it." };
    case 'drop_scheme':
      return { fact: `scheme "${done.scheme}" is dropped`, say: 'Say one short line.' };
    case 'compare_scheme': {
      if (!done.scheme) return { fact: 'the comparison is closed; the plan is on its own again', say: 'Carry on.' };
      const c = snap.comparing;
      const deltas = (c?.deltas ?? []).slice(0, 6).map((d) => `${d.name} ${d.delta_m2 > 0 ? 'bigger' : 'smaller'} by ${sq(Math.abs(d.delta_m2))}`);
      return {
        fact: `scheme "${done.scheme}" is side by side with the plan; the plan against it: ${deltas.length ? spoken(deltas) : 'no difference room by room'}; hall ${c?.circulation_pct ?? 0} percent then, ${table.circulation_pct} now`,
        say: 'Say one short line about the trade: what one gains and what it takes it from.',
      };
    }
    case 'set_unit':
      return { fact: `areas now show in ${unitWords(done.unit ?? 'm2')}: ${areaIn(table.total_m2, done.unit ?? 'm2')} in all`, say: 'Say one short line with the total in the new unit.' };
    case 'undo':
      return { fact: `the last change (${done.undone}) is taken back`, say: 'Say one short line naming what the plan is back to. It is not a new change.' };
    case 'clear':
      return { fact: `the ${snap.level.name} floor is empty again`, say: 'Say one short line inviting them to start from the size of the place.' };
    case 'draw_sheet':
      return { fact: "the drawing sheet (plan, area schedule and notes) is up on the client's screen, with a button to download it", say: "Say one short line pointing at it, and mention it's design guidance rather than a building-regulations check." };
    case 'select':
      return { fact: `the client is looking at the ${r[0]?.name.toLowerCase() ?? 'selection'}`, say: 'Carry on with it.' };
    default:
      return { fact: done.label, say: 'Say one short line about it.' };
  }
}

/** What the client asked for, for a refusal: "move 2 square metres from the r3 to the r1" with names. */
export function asked(intent: Intent, snap: PlanSnapshot): string {
  const nameOf = (value: unknown) => {
    const id = String(value ?? '');
    const room = snap.level.rooms.find((r) => r.id === id);
    const item = snap.level.items.find((i) => i.id === id);
    return (room?.name ?? item?.label ?? id).toLowerCase();
  };
  switch (intent.kind) {
    case 'generate': return `lay the floor out with ${intent.bedrooms ?? 1} bedroom${intent.bedrooms === 1 ? '' : 's'}`;
    case 'set_envelope': return `make the floor ${metres(Number(intent.w))} by ${metres(Number(intent.h))} metres`;
    case 'add_room': return `add a ${String(intent.room_kind).replaceAll('_', ' ')}`;
    case 'remove_room': return `remove the ${nameOf(intent.id)}`;
    case 'rename_room': return `change the ${nameOf(intent.id)}`;
    case 'swap_rooms': return `swap the ${nameOf(intent.a)} and the ${nameOf(intent.b)}`;
    case 'merge_rooms': return `knock the ${nameOf(intent.a)} and the ${nameOf(intent.b)} together`;
    case 'split_room': return `divide the ${nameOf(intent.id)}`;
    case 'move_wall': return `move the wall between the ${nameOf(intent.a)} and the ${nameOf(intent.b)}`;
    case 'trade_area': return `move ${sq(Number(intent.m2))} from the ${nameOf(intent.from)} to the ${nameOf(intent.to)}`;
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
    case 'compare_scheme': return `compare with scheme ${intent.name}`;
    case 'drop_scheme': return `drop scheme ${intent.name}`;
    case 'undo': return 'undo the last change';
    case 'clear': return 'clear the floor';
    case 'draw_sheet': return 'draw up the sheet';
    case 'set_unit': return 'switch units';
    default: return 'change the plan';
  }
}

/** One step the app took for the client, and how it went. */
export interface Step { intent: Intent; result: ApplyResult }

export type Source = 'spoken' | 'typed' | 'panel';

/** Kinds that change nothing worth a word when they come from a click or a drag. */
const QUIET_FROM_PANEL = new Set(['select', 'move_item', 'move_wall', 'rotate_item', 'remove_item', 'add_item', 'set_unit', 'go_to_level', 'compare_scheme', 'undo', 'rename_room', 'trade_area', 'grow_room', 'split_room', 'merge_rooms', 'swap_rooms', 'mark_structural', 'add_door', 'add_window', 'add_front_door', 'remove_opening', 'add_room', 'remove_room', 'place_item', 'set_envelope', 'drop_scheme', 'remove_level']);

/**
 * The events for what just happened, in order. A spoken or typed request gets
 * one event: the outcome (or the refusal), with the problem it created folded
 * in, so one change gets one voice. A click or drag gets no outcome event for
 * small edits (the client did it with their own hand and can see it) and one for
 * the milestones (a floor laid out, a scheme saved, the sheet drawn), and the
 * critic speaks separately about anything the change just broke.
 */
export function eventsFor(source: Source, steps: Step[], fresh: Issue[], snap: PlanSnapshot): { text: string; ttl: number }[] {
  if (!steps.length) return [];
  const done = steps.filter((s): s is Step & { result: { applied: true } } => s.result.applied);
  const refused = steps.find((s) => !s.result.applied);
  const critic = fresh.length ? issueCue(fresh[0], fresh.length) : null;

  if (source === 'panel') {
    const out: { text: string; ttl: number }[] = [];
    const loud = done.filter((s) => !QUIET_FROM_PANEL.has(s.result.done.kind) || (s.result.done.kind === 'compare_scheme' && s.result.done.scheme));
    if (loud.length) {
      const last = doneLine(loud[loud.length - 1].result.done, snap);
      out.push({ text: `The client used the panel: ${loud.map((s) => doneLine(s.result.done, snap).fact).join('; ')}. ${last.say}`, ttl: 20 });
    }
    if (critic) out.push({ text: critic, ttl: 20 });
    return out;
  }

  const facts = done.map((s) => doneLine(s.result.done, snap));
  let text: string;
  if (refused && !refused.result.applied) {
    const what = asked(refused.intent, snap);
    const before = facts.length ? `First the app did this: ${facts.map((f) => f.fact).join('; ')}. Then the client asked to ${what}, ` : `The client asked to ${what}, `;
    text = `${before}and the plan refused it: "${refused.result.reason}" That part has NOT changed. Tell them so in one short line and suggest the fix; do NOT describe it as done.`;
  } else {
    const last = facts[facts.length - 1];
    text = `The app has made the change the client asked for: ${facts.map((f) => f.fact).join('; ')}. ${last.say}`;
  }
  if (critic) text += ` ${critic}`;
  return [{ text, ttl: 30 }];
}

export const say = {
  /** The app's opening, after the avatar's own greeting. */
  opening: (snap: PlanSnapshot) => snap.level.rooms.length
    ? `The client is at the drawing board with a plan already on screen (${snap.level.rooms.length} rooms). Welcome them in one short line and ask what they would change first.`
    : `The client has just sat down at the drawing board; the floor on their screen is empty (${metres(snap.level.w_cm)} by ${metres(snap.level.h_cm)} metres for now). In one short, warm line ask the two things you need to sketch something: roughly how big the place is, and how many bedrooms they need. Ask nothing else yet.`,
  /** A request the app could not pin down. */
  ask: (question: string) => `The client asked for a change, but the app could not tell exactly what. Ask them this, in your own words, in one short line: ${question}`,
  /** A photo read by the app. */
  photo: (purpose: 'room' | 'piece', added: string[], refused: string[], seen: string) => {
    const what = purpose === 'piece' ? 'a photo of a piece of furniture they own' : 'a photo of a room in their home';
    if (!added.length && !refused.length) return `The client shared ${what}; the app found no furniture from the kit in it${seen ? ` (it saw: ${seen})` : ''}. Say so in one short line and ask what they would like to add instead.`;
    return `The client shared ${what}. You cannot see it; the app read it${seen ? ` (it saw: ${seen})` : ''} and ${added.length ? `added to the plan, at real kit sizes: ${spoken(added)}` : 'added nothing'}${refused.length ? `; it could not place: ${spoken(refused)}` : ''}. Say in one or two short lines what went in and where; never guess a measurement from a photo.`;
  },
};
