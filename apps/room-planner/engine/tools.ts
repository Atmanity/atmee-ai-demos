// The architect's tool calls, answered by the planner.
//
// A call carries what the host heard ("the second bedroom", "two square
// metres", "by the window"), never a coordinate. Here it becomes the same
// intents a button sends: names are resolved against the plan by whole words
// (so "second bedroom" never lands on the main one), amounts are converted, and
// anything missing becomes a question rather than a guess. The planner then
// applies the intents in order, stopping at the first refusal, and the result
// is the text the architect speaks from: the real numbers, or the reason.
import { notDone, resultFor, TOOL_NAMES, type Step } from './director.ts';
import { contextOf, findItemIn, findRoomIn, roomSideCm, sizeForArea, stepsToIntents, type JudgeContext, type Step as Op } from './judge.ts';
import { isDrawn, type Critic, type Planner } from './planner.ts';
import { toNumber } from './num.ts';
import type { Intent, Level, PlanSnapshot } from './types.ts';

/** What a tool call did: the words for the host, and what the page needs to show. */
export interface ToolOutcome {
  text: string;
  steps: Step[];
  /** The planner's refusal, to show on the plan as well. */
  refusal: string | null;
  /** The drawing sheet was drawn, so the page opens it. */
  drew: boolean;
}

const FT2_PER_M2 = 10.7639;

type Built = { intents: Intent[] } | { ask: string } | { refuse: string; intent: Intent };

/** Run one tool call against the plan; never throws for a bad call. */
export function runTool(planner: Planner, critic: Critic, name: string, args: Record<string, unknown> = {}): ToolOutcome {
  const plan = planner.snapshot();
  const built = TOOL_NAMES.includes(name) ? intentsFor(name, args ?? {}, plan) : { refuse: "That isn't something the plan can do.", intent: { kind: name } };
  if ('ask' in built) return { text: notDone(built.ask), steps: [], refusal: null, drew: false };

  const steps: Step[] = [];
  if ('refuse' in built) {
    steps.push({ intent: built.intent, result: { applied: false, reason: built.refuse } });
  } else {
    for (const intent of built.intents) {
      const result = planner.apply(intent);
      steps.push({ intent, result });
      if (!result.applied) break;
    }
  }
  const last = [...steps].reverse().find((s) => s.result.applied)?.result;
  const snap = last?.applied ? last.snapshot : planner.snapshot();
  const fresh = steps.some((s) => s.result.applied) ? critic.look(snap.issues, { hasRooms: isDrawn(snap) }) : [];
  const refused = steps.find((s) => !s.result.applied)?.result;
  return {
    text: resultFor(steps, fresh, snap),
    steps,
    refusal: refused && !refused.applied ? refused.reason : null,
    drew: steps.some((s) => s.result.applied && s.result.done.kind === 'draw_sheet'),
  };
}

// --------------------------------------------------------------- the calls

const words = (value: unknown) => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '');
const amount = (value: unknown) => {
  const n = toNumber(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
};
const NEAR: Record<string, string> = {
  middle: 'center', centre: 'center', center: 'center', window: 'window', door: 'door',
  north: 'north_wall', south: 'south_wall', east: 'east_wall', west: 'west_wall',
};
/** Questions for a call whose required part is missing. */
const MISSING: Record<string, string> = {
  set_floor_size: 'Roughly how big is the place: how many metres by how many?',
  add_room: 'What kind of room should go in?',
  remove_room: 'Which room should come out?',
  rename_room: 'What should it be called, or what is it for now?',
  divide_room: 'Which room should be divided?',
  swap_rooms: 'Which two rooms should swap?',
  knock_together: 'Which two rooms should become one?',
  trade_area: 'Which room gives the floor up, which one gets it, and how much?',
  grow_room: 'Which room, and how much bigger: a square metre, two?',
  move_wall: 'Which wall, and how far?',
  mark_load_bearing: 'The wall between which two rooms?',
  add_door_or_window: 'Which room, and which wall or which room on the other side?',
  add_furniture: 'Which piece should go in?',
  move_furniture: 'Which piece, and where should it go?',
  remove_furniture: 'Which piece should come out?',
  use_scheme: 'Which scheme?',
  go_to_floor: 'Which floor: the ground or the upper one?',
};

/** A tool call as planner intents, or what to ask, or the reason it cannot be done. */
export function intentsFor(name: string, args: Record<string, unknown>, plan: PlanSnapshot): Built {
  const ctx = contextOf(plan);
  // A room or a piece, by whole words first; anything else goes to the planner
  // as it was said, which refuses it in its own words ("There's no gym…").
  const room = (value: unknown) => {
    const phrase = words(value);
    return phrase ? findRoomIn(ctx, phrase) ?? phrase : undefined;
  };
  const piece = (value: unknown) => {
    const phrase = words(value);
    return phrase ? findItemIn(ctx, phrase) ?? phrase : undefined;
  };
  const area = () => {
    const m2 = amount(args.m2);
    if (m2) return Math.abs(m2);
    const ft2 = amount(args.sq_ft);
    return ft2 ? Math.round((Math.abs(ft2) / FT2_PER_M2) * 10) / 10 : null;
  };
  const near = (value: unknown) => NEAR[words(value).toLowerCase()] ?? undefined;
  const op = (step: Op): Built => {
    const { intents, ask } = stepsToIntents([step], ctx);
    return intents.length ? { intents } : { ask: ask ?? MISSING[name] ?? 'What exactly should change?' };
  };

  switch (name) {
    case 'lay_out_floor': {
      const built = op({
        op: 'lay_out_floor', bedrooms: amount(args.bedrooms) ?? 1, style: words(args.style) || undefined,
        office: Boolean(args.study), dining: Boolean(args.dining), ensuite: Boolean(args.en_suite), wc: Boolean(args.wc), utility: Boolean(args.utility),
      });
      if (!('intents' in built)) return built;
      const size = sizeOf(args, ctx);
      if (size && 'ask' in size) return size;
      return { intents: [{ ...built.intents[0], ...(size ? { w: size.w, h: size.h } : {}) }] };
    }
    case 'set_floor_size': {
      const size = sizeOf(args, ctx);
      if (!size) return { ask: MISSING.set_floor_size };
      if ('ask' in size) return size;
      return { intents: [{ kind: 'set_envelope', w: size.w, h: size.h }] };
    }
    case 'add_upper_floor': return op({ op: 'add_upper_floor' });
    case 'go_to_floor': {
      const floor = words(args.floor).toLowerCase();
      if (!['ground', 'upper'].includes(floor)) return { ask: MISSING.go_to_floor };
      return op({ op: 'go_to_floor', floor });
    }

    case 'add_room': {
      if (!words(args.room)) return { ask: MISSING.add_room };
      const beside = room(args.next_to);
      return op({ op: 'add_room', room_kind: words(args.room), near: beside ? 'beside' : near(args.near), beside, m2: amount(args.size_m2) ?? undefined, name: words(args.name) || undefined });
    }
    case 'remove_room': return op({ op: 'remove_room', room: room(args.room) });
    case 'rename_room': return op({ op: 'rename_room', room: room(args.room), name: words(args.new_name) || undefined, room_kind: words(args.new_use) || undefined });
    case 'divide_room': return op({ op: 'divide_room', room: room(args.room), room_kind: words(args.new_use) || undefined });
    case 'swap_rooms': return op({ op: 'swap_rooms', room: room(args.room_a), other_room: room(args.room_b) });
    case 'knock_together': return op({ op: 'knock_together', room: room(args.room_a), other_room: room(args.room_b) });

    case 'trade_area': {
      const m2 = area();
      if (!m2) return { ask: 'How much floor should move: a square metre, two?' };
      return op({ op: 'trade_area', take_from: room(args.take_from), give_to: room(args.give_to), m2 });
    }
    case 'grow_room': {
      const m2 = area();
      if (!m2) return { ask: MISSING.grow_room };
      return op({ op: 'resize_room', room: room(args.room), m2, wall: words(args.towards).toLowerCase() || undefined });
    }
    case 'move_wall': return op({ op: 'move_wall', room: room(args.room_a), other_room: room(args.room_b), cm: amount(args.centimetres) ?? undefined });
    case 'mark_load_bearing': return op({ op: 'mark_wall_structural', room: room(args.room_a), other_room: room(args.room_b) });

    case 'add_door_or_window': {
      const kind = words(args.kind).toLowerCase();
      const where = room(args.room);
      if (!where) return { ask: MISSING.add_door_or_window };
      if (kind === 'door') {
        const other = room(args.other_room);
        return other ? op({ op: 'add_door', room: where, other_room: other }) : { ask: 'Which room should the door open into?' };
      }
      const wall = words(args.wall).toLowerCase() || onlyOutsideWall(ctx, where);
      if (kind === 'window') return wall ? op({ op: 'add_window', room: where, wall }) : { ask: 'Which wall should the window go in: north, south, east or west?' };
      if (kind === 'front_door') return op({ op: 'add_front_door', room: where, wall: wall || undefined });
      return { ask: 'A door, a window or the front door?' };
    }
    case 'remove_door_or_window': return openingFor(args, ctx, plan.level);

    case 'add_furniture': {
      if (!words(args.piece)) return { ask: MISSING.add_furniture };
      const beside = piece(args.next_to);
      return op({ op: 'add_furniture', piece: words(args.piece), room: room(args.room), near: beside ? 'beside' : near(args.near), beside });
    }
    case 'move_furniture': {
      const item = piece(args.piece);
      if (!item) return { ask: MISSING.move_furniture };
      const beside = piece(args.next_to);
      const moving = Boolean(beside || near(args.near) || words(args.room));
      const turns = amount(args.quarter_turns);
      const intents: Intent[] = [];
      if (moving) {
        const built = op({ op: 'move_furniture', item, room: room(args.room), near: beside ? 'beside' : near(args.near), beside });
        if (!('intents' in built)) return built;
        intents.push(...built.intents);
      }
      if (turns) intents.push({ kind: 'rotate_item', id: item, deg: Math.round(turns) * 90 });
      return intents.length ? { intents } : { ask: 'Where should it go, or should it turn?' };
    }
    case 'remove_furniture': return op({ op: 'remove_furniture', item: piece(args.piece) });

    case 'save_scheme': return op({ op: 'save_scheme', scheme: words(args.name) || undefined });
    case 'use_scheme': {
      const action = words(args.action).toLowerCase();
      if (action === 'stop_comparing') {
        return ctx.comparing ? op({ op: 'stop_comparing' }) : { refuse: 'No scheme is being compared right now.', intent: { kind: 'compare_scheme', name: 'off' } };
      }
      const kinds: Record<string, Op['op']> = { compare: 'compare_scheme', open: 'show_scheme', drop: 'drop_scheme' };
      if (!kinds[action]) return { ask: 'Compare it, open it, or drop it?' };
      if (!ctx.schemes.length) return { refuse: 'There are no saved schemes yet.', intent: { kind: kinds[action] === 'show_scheme' ? 'load_scheme' : kinds[action], name: words(args.scheme) } };
      // One saved scheme is the one they mean.
      const scheme = words(args.scheme) || (ctx.schemes.length === 1 ? ctx.schemes[0] : '');
      if (!scheme) return { ask: `Which scheme: ${ctx.schemes.join(' or ')}?` };
      return op({ op: kinds[action], scheme });
    }
    case 'switch_units': return op({ op: 'switch_units', unit: words(args.unit) === 'ft2' ? 'ft2' : 'm2' });
    case 'undo_change': return op({ op: 'undo' });
    case 'draw_sheet': return op({ op: 'draw_sheet' });
    case 'clear_floor': return op({ op: 'clear_floor' });
    default: return { refuse: "That isn't something the plan can do.", intent: { kind: name } };
  }
}

/** The floor size a call gave (width and depth, or an area), in centimetres; null if none. */
function sizeOf(args: Record<string, unknown>, ctx: JudgeContext): { w: number; h: number } | { ask: string } | null {
  const w = amount(args.width_m), d = amount(args.depth_m), total = amount(args.area_m2);
  if (w && d) return { w: roomSideCm(Math.abs(w)), h: roomSideCm(Math.abs(d)) };
  if (total && total > 0) return sizeForArea(total, ctx.size);
  if (w || d) return { ask: 'And the other side: how many metres by how many?' };
  return null;
}

/** The outside wall a room reaches, when it reaches exactly one. */
function onlyOutsideWall(ctx: JudgeContext, roomId: string): string {
  const outside = ctx.rooms.find((r) => r.id === roomId)?.outside ?? [];
  return outside.length === 1 ? outside[0] : '';
}

/** Which outside wall an opening is on, or null for an inside one. */
function sideOf(opening: Level['openings'][number], level: Level): string | null {
  if (opening.axis === 'h') return opening.line_cm <= 0 ? 'north' : opening.line_cm >= level.h_cm ? 'south' : null;
  return opening.line_cm <= 0 ? 'west' : opening.line_cm >= level.w_cm ? 'east' : null;
}

/** The door or window a call names, by its rooms and wall: never by a guess. */
function openingFor(args: Record<string, unknown>, ctx: JudgeContext, level: Level): Built {
  const kind = words(args.kind).toLowerCase();
  const nameOf = (id?: string | null) => (id ? ctx.rooms.find((r) => r.id === id)?.name.toLowerCase() ?? id : 'outside');
  const pick = (phrase: unknown) => {
    const said = words(phrase);
    return said ? { said, id: findRoomIn(ctx, said) } : null;
  };
  const here = pick(args.room), there = pick(args.other_room);
  const wall = words(args.wall).toLowerCase();
  const intent: Intent = { kind: 'remove_opening' };
  for (const named of [here, there]) if (named && !named.id) return { refuse: `There's no ${named.said.toLowerCase()} on this floor.`, intent };

  let found = level.openings.filter((o) => (kind === 'window' ? o.kind === 'window' : o.kind === 'door' && (kind === 'front_door' ? !o.a || !o.b : Boolean(o.a && o.b))));
  if (here) found = found.filter((o) => o.a === here.id || o.b === here.id);
  if (there) found = found.filter((o) => o.a === there.id || o.b === there.id);
  if (wall && kind !== 'door') found = found.filter((o) => sideOf(o, level) === wall);

  if (!found.length) {
    const what = kind === 'front_door' ? 'front door' : kind === 'window' ? 'window' : 'door';
    const where = there && here ? ` between the ${nameOf(here.id)} and the ${nameOf(there.id)}` : here ? ` in the ${nameOf(here.id)}` : '';
    return { refuse: `There's no ${what}${where}${wall && kind !== 'door' ? ` on the ${wall} side` : ''} to take out.`, intent };
  }
  if (found.length > 1) {
    const label = (o: Level['openings'][number]) => {
      const rooms = [o.a, o.b].filter((id): id is string => Boolean(id));
      if (o.kind === 'window' || rooms.length < 2) return `the ${nameOf(rooms[0])} one on the ${sideOf(o, level) ?? 'inside'}`;
      const others = rooms.filter((id) => id !== here?.id);
      return here ? `the one into the ${nameOf(others[0])}` : `the one between the ${nameOf(rooms[0])} and the ${nameOf(rooms[1])}`;
    };
    const options = [...new Set(found.map(label))];
    return { ask: options.length > 1 ? `Which one: ${options.slice(0, -1).join(', ')} or ${options[options.length - 1]}?` : 'Which one? Name the room it is in.' };
  }
  return { intents: [{ kind: 'remove_opening', id: found[0].id }] };
}

