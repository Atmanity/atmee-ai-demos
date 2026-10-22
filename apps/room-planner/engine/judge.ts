// Turning words into plan operations.
//
// The original avatar had 27 tools and called them itself. The Avatar API has
// no function calling: the avatar talks, and the app hears the client's words
// a second later. So the app decides what was asked, here:
//
// 1. Rules first, for the phrasings that have one meaning ("undo", "nine by
//    seven", "give the living room two metres off the study", "a queen bed in
//    the main bedroom"). Instant, free, and the trade direction is exact.
// 2. A model second, server-side (server.ts), for everything else: it maps the
//    utterance to one or more of the planner's operations, by room and piece
//    ids taken from the plan, and NEVER to coordinates. Its answer is checked
//    and converted here (stepsToIntents), so the planner sees the same intents
//    a button sends.
//
// Either way the planner is the judge of whether the change is possible; this
// file only decides what was asked.
import { resolveType } from './catalog.ts';
import { cardinal } from './describe.ts';
import { TYPOLOGIES } from './generate.ts';
import { MAX_SIDE_CM, MIN_SIDE_CM } from './home.ts';
import { cmpStr, toNumber } from './num.ts';
import { normalizeKind, resolveKind } from './rooms.ts';
import type { Intent, PlanSnapshot } from './types.ts';

// --------------------------------------------------------------- the context

/** What the judge knows about the plan: names, ids and neighbours, no geometry. */
export interface JudgeContext {
  floor: string;
  floors: string[];
  size: { w_cm: number; h_cm: number };
  unit: 'm2' | 'ft2';
  rooms: { id: string; name: string; kind: string; area_m2: number; where: string; next_to: string[]; outside: string[] }[];
  items: { id: string; label: string; type: string; room: string | null }[];
  openings: { id: string; kind: 'door' | 'window'; front: boolean; rooms: string[] }[];
  schemes: string[];
  comparing: string | null;
  selected: string | null;
}

export function contextOf(snap: PlanSnapshot): JudgeContext {
  const level = snap.level;
  const nameOf = new Map(level.rooms.map((r) => [r.id, r.name]));
  const roomOfItem = (x: number, y: number) => level.rooms.find((r) => r.rects.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1))?.id ?? null;
  return {
    floor: level.name,
    floors: snap.levels,
    size: { w_cm: level.w_cm, h_cm: level.h_cm },
    unit: snap.unit,
    rooms: level.rooms.map((r) => ({
      id: r.id, name: r.name, kind: r.kind, area_m2: r.area_m2,
      where: cardinal(r.bbox[0], r.bbox[1], r.bbox[2] - r.bbox[0], r.bbox[3] - r.bbox[1], level.w_cm, level.h_cm),
      next_to: level.walls.filter((w) => w.a === r.id || w.b === r.id).map((w) => (w.a === r.id ? w.b : w.a)),
      outside: [
        ...(r.rects.some((q) => q[1] <= 0) ? ['north'] : []), ...(r.rects.some((q) => q[3] >= level.h_cm) ? ['south'] : []),
        ...(r.rects.some((q) => q[2] >= level.w_cm) ? ['east'] : []), ...(r.rects.some((q) => q[0] <= 0) ? ['west'] : []),
      ],
    })),
    items: level.items.map((i) => ({ id: i.id, label: i.label, type: i.type, room: roomOfItem(i.x_cm + i.w_cm / 2, i.y_cm + i.h_cm / 2) })),
    openings: level.openings.map((o) => ({
      id: o.id, kind: o.kind, front: o.kind === 'door' && (!o.a || !o.b),
      rooms: [o.a, o.b].filter((id): id is string => Boolean(id)).map((id) => nameOf.get(id) ?? id),
    })),
    schemes: snap.schemes.map((s) => s.name),
    comparing: snap.comparing?.name ?? null,
    selected: snap.selected,
  };
}

// ---------------------------------------------------------------- the words

const UNITS = ['m2', 'sqm', 'square', 'metre', 'metres', 'meter', 'meters', 'm', 'cm', 'centimetre', 'centimetres', 'centimeter', 'centimeters', 'foot', 'feet', 'ft', 'by', 'x', 'bed', 'beds', 'bedroom', 'bedrooms', 'percent', 'degrees'];
const ONES: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/**
 * Number words become digits where they are amounts ("two square metres",
 * "nine by seven", "a two bed", "two and a half metres"), and only there: "save
 * this one" keeps its "one".
 */
export function digitize(text: string): string {
  const tokens = text.split(' ');
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const [value, used] = numberAt(tokens, i);
    if (used) {
      const next = tokens[i + used] ?? '';
      const prev = out[out.length - 1] ?? '';
      if (UNITS.includes(next) || prev === 'by' || prev === 'x' || /^\d/.test(next)) {
        out.push(String(value));
        i += used - 1;
        continue;
      }
    }
    // "a metre", "a square metre", "half a metre", "a couple of metres"
    if (tokens[i] === 'a' && ['metre', 'meter', 'square'].includes(tokens[i + 1] ?? '')) { out.push('1'); continue; }
    if (tokens[i] === 'half' && tokens[i + 1] === 'a' && ['metre', 'meter', 'square'].includes(tokens[i + 2] ?? '')) { out.push('0.5'); i += 1; continue; }
    if (tokens[i] === 'a' && tokens[i + 1] === 'couple' && tokens[i + 2] === 'of') { out.push('2'); i += 2; continue; }
    out.push(tokens[i]);
  }
  return out.join(' ');
}

/** A number spelled out from tokens[i]: its value and how many tokens it took. */
function numberAt(tokens: string[], i: number): [number, number] {
  let j = i;
  let value: number | null = null;
  const t = tokens[j];
  if (t !== undefined && /^\d+(\.\d+)?$/.test(t)) { value = Number(t); j++; }
  else if (t !== undefined && t in TENS) {
    value = TENS[t]; j++;
    const u = tokens[j];
    if (u !== undefined && u in ONES && ONES[u] < 10 && ONES[u] > 0) { value += ONES[u]; j++; }
  } else if (t !== undefined && t in ONES) { value = ONES[t]; j++; }
  if (value === null) return [0, 0];
  // "nine point five"
  if (tokens[j] === 'point' && tokens[j + 1] !== undefined && tokens[j + 1] in ONES && ONES[tokens[j + 1]] < 10) {
    value = Number(`${value}.${ONES[tokens[j + 1]]}`); j += 2;
  }
  // "two and a half"
  if (tokens[j] === 'and' && tokens[j + 1] === 'a' && tokens[j + 2] === 'half') { value += 0.5; j += 3; }
  return [value, j - i];
}

const FILLERS = /^(?:(?:ok(?:ay)?|right|so|alright|um+|uh+|er+|erm|well|yes|yeah|yep|no|nope|actually|please|hey|and|now|then|just|maybe|perhaps|also|great|cool|lovely|perfect|fine|hmm+|oh|ah|can you|could you|would you|will you|can we|could we|let'?s|lets|i'?d like you to|i want you to|go ahead and|i think|i'?d like to|we'?d like to|i want to|we want to)\s+)+/;
const TAIL = /\s+(?:please|for me|thanks|thank you|then|now|instead|as well|too)$/;

/** Lower case, words only, numbers as digits, fillers off both ends. */
export function normalizeUtterance(text: string): string {
  let t = text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'").replace(/²/g, '2').replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/(\d)\.(\d)/g, '$1§$2').replace(/(\d)\s*(m2|cm|m|ft)\b/g, '$1 $2')
    .replace(/[^a-z0-9§' ]+/g, ' ').replace(/§/g, '.').replace(/\s+/g, ' ').trim();
  t = digitize(t);
  for (let i = 0; i < 3; i++) t = t.replace(FILLERS, '').replace(TAIL, '').trim();
  return t;
}

// ------------------------------------------------------------- finding things

type Ctx = JudgeContext;
const hasWords = (text: string, words: string) => ` ${text} `.includes(` ${words} `);
const stripArticle = (phrase: string) => phrase.replace(/^(?:the|a|an|my|our|this|that|your)\s+/, '').trim();

/** The room a phrase names, by the same rules as Level.findRoom; null if none or unsure. */
export function findRoomIn(ctx: Ctx, phrase: string): string | null {
  const raw = stripArticle(phrase);
  if (['it', 'this room', 'that room', 'this one', 'that one', 'here', 'there'].includes(raw)) {
    return ctx.rooms.some((r) => r.id === ctx.selected) ? ctx.selected : null;
  }
  const key = normalizeKind(raw);
  if (!key) return null;
  for (const r of ctx.rooms) if (r.id.toLowerCase() === key.replaceAll(' ', '')) return r.id;
  for (const r of ctx.rooms) if (r.name.toLowerCase() === key) return r.id;
  // Containment by whole words, unlike the planner's: "bed" must not find the
  // bedroom here, because a rule that guesses is worse than asking the model.
  const named = ctx.rooms
    .filter((r) => hasWords(r.name.toLowerCase(), key) || hasWords(key, r.name.toLowerCase()))
    .sort((p, q) => Math.abs(p.name.length - key.length) - Math.abs(q.name.length - key.length));
  if (named.length) return named[0].id;
  const spec = resolveKind(key);
  if (spec && normalizeKind(key).split(' ').length <= 3) {
    const ofKind = ctx.rooms.filter((r) => r.kind === spec.kind);
    if (ofKind.length) return ofKind[0].id;
  }
  return null;
}

/** The piece on the plan a phrase names (the latest match, as Level.findItem); null if none. */
export function findItemIn(ctx: Ctx, phrase: string): string | null {
  const raw = stripArticle(phrase);
  if (['it', 'that', 'this', 'this one', 'that one', 'that piece'].includes(raw)) {
    return ctx.items.some((i) => i.id === ctx.selected) ? ctx.selected : null;
  }
  const key = raw.replace(/-/g, ' ');
  for (const i of ctx.items) if (i.id === key) return i.id;
  const piece = resolveType(key);
  const named = ctx.items.filter((i) => i.label.toLowerCase() === key || (piece && i.type === piece.type) || i.label.toLowerCase().includes(key));
  return named.length ? named[named.length - 1].id : null;
}

const WALL = '(north|south|east|west)';
const RELATIONS: [RegExp, string][] = [
  [/^(?:the )?windows?$/, 'window'], [/^(?:the )?(?:front )?door(?:way)?$/, 'door'],
  [/^(?:the )?(north|south|east|west)(?: wall| side)?$/, '$1_wall'], [/^(?:the )?(?:middle|centre|center)$/, 'center'],
];

function relationOf(phrase: string | undefined): string | null {
  if (!phrase) return 'center';
  for (const [pattern, relation] of RELATIONS) {
    const m = pattern.exec(phrase.trim());
    if (m) return relation.replace('$1', m[1] ?? '');
  }
  return null;
}

// ---------------------------------------------------------------- the rules

/** The size of a floor side the client said, in centimetres, whichever unit they used. */
export function roomSideCm(value: number): number {
  // "make it nine metres wide" arriving as 9 became a 9 cm floor, refused with a
  // sentence about centimetres: the app rejected the very phrase it gives as an
  // example. A side below the 2 m minimum read as metres lands inside the
  // drawable range exactly when it was metres all along; anything still out of
  // range falls through untouched, so the plan's own refusal is what is heard.
  if (value <= 0 || value >= MIN_SIDE_CM) return value;
  return MIN_SIDE_CM <= value * 100 && value * 100 <= MAX_SIDE_CM ? value * 100 : value;
}

/** A floor of the given area, keeping the current proportions, on the 10 cm grid. */
export function sizeForArea(areaM2: number, current: { w_cm: number; h_cm: number }): { w: number; h: number } {
  const ratio = current.w_cm / Math.max(current.h_cm, 1);
  const w = Math.round(Math.sqrt(areaM2 * 10_000 * ratio) / 10) * 10;
  const h = Math.round((areaM2 * 10_000) / Math.max(w, 1) / 10) * 10;
  return { w, h };
}

const N = '(\\d+(?:\\.\\d+)?)';
const AREA = `${N}(?: square)?(?: metres?| meters?| m2| m| sqm)?`;
const R = '(.+?)';

const BEDROOM_KINDS = ['bedroom', 'bedroom_single', 'nursery'];
const STYLE_WORDS: [RegExp, string][] = [
  [/\bopen plan\b/, 'open_plan'], [/\bdual aspect\b|\brooms? on both sides\b|\bhall down the middle\b/, 'dual_aspect'],
  [/\bcompact\b|\bno (?:wasted )?(?:hall|corridor)\b|\bwithout a (?:hall|corridor)\b/, 'compact'], [/\bday (?:end|and night)\b|\bday night\b/, 'day_night'],
];

function styleIn(text: string): string | null {
  for (const [pattern, style] of STYLE_WORDS) if (pattern.test(text)) return style;
  return null;
}

function briefExtras(text: string) {
  return {
    office: /\b(?:study|office|work(?:ing)? from home|wfh)\b/.test(text),
    dining: /\bdining\b/.test(text),
    ensuite: /\ben ?suite\b|\bensuite\b/.test(text),
    wc: /\b(?:wc|cloakroom|downstairs (?:loo|toilet)|separate (?:loo|toilet)|powder room)\b/.test(text),
    utility: /\b(?:utility|laundry)\b/.test(text),
  };
}

/** The brief already on the floor, so "try it open plan" keeps the rooms they have. */
function currentBrief(ctx: Ctx) {
  const kinds = ctx.rooms.map((r) => r.kind);
  return {
    bedrooms: Math.max(1, kinds.filter((k) => BEDROOM_KINDS.includes(k)).length),
    office: kinds.includes('office'), dining: kinds.includes('dining'),
    ensuite: kinds.includes('shower_room'), wc: kinds.includes('wc'), utility: kinds.includes('utility'),
  };
}

type Rule = (t: string, ctx: Ctx) => Intent | Intent[] | null;

const titled = (name: string) => stripArticle(name).replace(/^\w/, (c) => c.toUpperCase());

const RULES: Rule[] = [
  // undo: "undo", "take that back", "put it back", "I preferred it before"
  (t) => (/^(?:undo(?: that| it| the last (?:change|one|thing)| please)?|take (?:that|it) back|put (?:it|that|them) back(?: how (?:it|they) w(?:as|ere)| the way (?:it|they) w(?:as|ere))?|go back(?: a step| one step)?|step back|revert(?: that| it)?|i (?:preferred|liked) it (?:better )?before|change it back)$/.test(t) ? { kind: 'undo' } : null),

  // units, never with numbers in the clause (those are sizes or trades)
  (t) => (!/\d/.test(t) && /\b(?:in|into|to|use|show) (?:square )?(?:feet|foot|ft)\b|\bimperial\b/.test(t) ? { kind: 'set_unit', unit: 'ft2' } : null),
  (t) => (!/\d/.test(t) && /\b(?:in|into|to|use|show) (?:square )?(?:metres|meters|m2)\b|\bmetric\b/.test(t) ? { kind: 'set_unit', unit: 'm2' } : null),

  // a second storey, and moving between them
  (t) => (/\b(?:add|put in|build|we need|there'?s|there is|it has|give (?:me|us)|have) (?:an? )?(?:upstairs|upper floor|second (?:floor|storey|story)|floor above|another floor|first floor)\b|^it'?s a house\b/.test(t) ? { kind: 'add_level' } : null),
  (t, ctx) => {
    const m = /^(?:go|head|switch|take me|show me|look at|back|move|over)(?: back)?(?: (?:up|down))?(?: (?:to|onto))?(?: the)? (upstairs|downstairs|upper(?: floor)?|ground(?: floor)?|first floor|top floor|bottom floor)$/.exec(t);
    if (!m) return null;
    const id = /up|first|top/.test(m[1]) ? 'upper' : 'ground';
    return ctx.floors.includes(id) ? { kind: 'go_to_level', id } : null;
  },

  // the sheet
  (t) => (/\b(?:drawing sheet|draw (?:it |this |that |the plan )?up|draw up the (?:plan|sheet)|the sheet|a sheet|something to take away|print(?:able)?(?: it| this| version| the plan)?|download(?: it| the plan)?)\b/.test(t) ? { kind: 'draw_sheet' } : null),

  // start over
  (t) => (/^(?:clear|empty|wipe)(?: out)? (?:the |this )?(?:whole )?(?:floor|plan)$|^start (?:over|again)(?: from scratch)?$|^(?:from scratch|blank (?:floor|plan))$/.test(t) ? { kind: 'clear' } : null),

  // schemes
  (t) => {
    const m = /^(?:save|keep|store) (?:this|it|that|the plan|the current plan|the layout)(?: one| plan| version| layout| scheme)?(?: as(?: the)? (.+?))?$/.exec(t);
    return m ? { kind: 'save_scheme', name: m[1] ? titled(m[1]) : '' } : null;
  },
  (t) => (/^(?:stop comparing|close the comparison|compare off|hide the comparison|no more comparison|just the one plan)$/.test(t) ? { kind: 'compare_scheme', name: 'off' } : null),
  (t, ctx) => {
    const m = /^(?:compare(?: (?:it|this|that))?|how does (?:this|it|that) compare|put (?:it|this) side by side) (?:with|to|against) (?:the )?(.+?)(?: scheme| version| one| plan)?$/.exec(t);
    const scheme = m ? schemeIn(ctx, m[1]) : null;
    return scheme ? { kind: 'compare_scheme', name: scheme } : null;
  },
  (t, ctx) => {
    const m = /^(?:go back to|show me|switch to|load|bring back|restore|back to)(?: the)? (.+?)(?: scheme| version| one| plan| layout)?(?: again)?$/.exec(t);
    const scheme = m ? schemeIn(ctx, m[1]) : null;
    return scheme ? { kind: 'load_scheme', name: scheme } : null;
  },

  // the size of the place: "nine by seven", "it's 9 metres by 7"
  (t) => {
    const m = new RegExp(`^(?:(?:it'?s|it is|the (?:place|flat|floor|house|apartment) is|make (?:it|the floor)|set (?:it|the floor) to|change (?:it|the size) to|about|around|roughly|approximately|maybe|we have|we'?ve got)\\s+)*${N}(?: metres?| meters?| m)?(?: wide)? (?:by|x) ${N}(?: metres?| meters?| m)?(?: deep)?$`).exec(t);
    return m ? { kind: 'set_envelope', w: roomSideCm(Number(m[1])), h: roomSideCm(Number(m[2])) } : null;
  },
  (t, ctx) => {
    const m = new RegExp(`^(?:(?:it'?s|it is|the (?:place|flat|floor|house|apartment|home) is|we have|we'?ve got|about|around|roughly|approximately)\\s+)+${N} (?:square )?(?:metres?|meters?|m2|sqm)(?: in total| total| altogether)?$`).exec(t);
    if (!m) return null;
    const { w, h } = sizeForArea(Number(m[1]), ctx.size);
    return { kind: 'set_envelope', w, h };
  },

  // "try it open plan": the same rooms, another arrangement
  (t, ctx) => {
    if (!ctx.rooms.length) return null;
    const m = /^(?:try|redraw|lay out|do)(?: it| this| the floor| the plan| that)?(?: as| in)?(?: an?)? (open plan|dual aspect|compact|day (?:end )?night)(?: (?:version|layout|style|instead))?$/.exec(t);
    return m ? { kind: 'generate', style: styleIn(m[1]) ?? 'day_night', ...currentBrief(ctx) } : null;
  },

  // a brief: "a two bed with a study", "two bedrooms and an en suite" (with a
  // layout verb, or on an empty floor where there is nothing to replace)
  (t, ctx) => {
    const m = /\b(\d+) (?:bed(?:room)?s?)\b|\b(studio)\b/.exec(t);
    if (!m) return null;
    const verb = /\b(?:lay (?:it |the floor |the place |that )?out|re ?draw|sketch|draw (?:it|the floor|a floor|a plan|me)|new layout|start again with|let'?s see|show me)\b/.test(t);
    if (ctx.rooms.length && !verb) return null;
    if (/\b(?:how many|can i fit|could i fit|would fit|is there room)\b/.test(t)) return null;
    const bedrooms = m[2] ? 1 : Math.min(5, Math.max(1, Number(m[1])));
    const brief: Intent = { kind: 'generate', bedrooms, style: styleIn(t) ?? 'day_night', ...briefExtras(t) };
    // "about seventy square metres, two bedrooms": the size goes in first, or
    // the floor is laid out in the old envelope.
    const dims = new RegExp(`${N}(?: metres?| meters?| m)? (?:by|x) ${N}`).exec(t);
    if (dims) return [{ kind: 'set_envelope', w: roomSideCm(Number(dims[1])), h: roomSideCm(Number(dims[2])) }, brief];
    const area = new RegExp(`${N} (?:square )?(?:metres?|meters?|m2|sqm)\\b`).exec(t);
    if (area && Number(area[1]) >= 15) {
      const { w, h } = sizeForArea(Number(area[1]), ctx.size);
      return [{ kind: 'set_envelope', w, h }, brief];
    }
    return brief;
  },

  // the trade, both ways round. take_from loses, give_to gains.
  (t, ctx) => {
    const m = new RegExp(`^(?:give|let) (?:the )?${R} (?:an extra |another )?${AREA}(?: more)? (?:off|from|out of) (?:the )?${R}$`).exec(t);
    return m ? trade(ctx, m[3], m[1], m[2]) : null;
  },
  (t, ctx) => {
    const m = new RegExp(`^(?:take|steal|borrow|move|shift) ${AREA} (?:off|from|out of) (?:the )?${R} (?:and give (?:it|them|that) to|and add (?:it|them|that) to|and put (?:it|them|that) in(?:to)?|to give to|into|for|to) (?:the )?${R}$`).exec(t);
    return m ? trade(ctx, m[2], m[3], m[1]) : null;
  },
  (t, ctx) => {
    const m = new RegExp(`^make (?:the )?${R} ${AREA} bigger(?:,)? (?:by )?(?:taking (?:it |them )?|take (?:it |them )?|and take (?:it |them )?)?(?:from|off|out of) (?:the )?${R}$`).exec(t);
    return m ? trade(ctx, m[3], m[1], m[2]) : null;
  },
  (t, ctx) => {
    const m = new RegExp(`^make (?:the )?${R} ${AREA} smaller (?:and give (?:it|that|them) to|to give to|for) (?:the )?${R}$`).exec(t);
    return m ? trade(ctx, m[1], m[3], m[2]) : null;
  },
  // growing into free floor: "make the kitchen two square metres bigger" (no donor named)
  (t, ctx) => {
    const m = new RegExp(`^(?:make|grow) (?:the )?${R} ${AREA} bigger$`).exec(t);
    const room = m ? findRoomIn(ctx, m[1]) : null;
    return room ? { kind: 'grow_room', id: room, m2: Number(m![2]) } : null;
  },

  // rooms by name: swap, knock together, divide, structural, doors, windows
  (t, ctx) => {
    const m = /^swap (?:the )?(.+?) (?:and|with) (?:the )?(.+?)(?: over| round| around)?$/.exec(t);
    return m ? pair(ctx, 'swap_rooms', m[1], m[2]) : null;
  },
  (t, ctx) => {
    const m = /^(?:knock|join|combine|merge|open up) (?:the )?(.+?) (?:and|with|into) (?:the )?(.+?)(?: together| into one(?: room)?| through)?$/.exec(t);
    return m ? pair(ctx, 'merge_rooms', m[1], m[2]) : null;
  },
  (t, ctx) => {
    const m = /^(?:the )?wall between (?:the )?(.+?) and (?:the )?(.+?) is (?:structural|load bearing|holding (?:the roof|it|everything) up)$|^(?:mark|make) (?:the )?wall between (?:the )?(.+?) and (?:the )?(.+?) (?:as )?(?:structural|load bearing)$/.exec(t);
    return m ? pair(ctx, 'mark_structural', m[1] ?? m[3], m[2] ?? m[4]) : null;
  },
  (t, ctx) => {
    const m = /^(?:divide|split|cut) (?:the )?(.+?)(?: in (?:two|half|2))?(?: (?:into|to make|for|to get) (?:a |an )?(.+?))?$/.exec(t);
    if (!m) return null;
    const room = findRoomIn(ctx, m[1]);
    if (!room) return null;
    const kind = m[2] ? resolveKind(m[2]) : null;
    if (m[2] && !kind) return null;
    return { kind: 'split_room', id: room, room_kind: kind?.kind ?? 'other' };
  },
  (t, ctx) => {
    const m = /^(?:put|add|make|knock|cut) (?:a )?door(?:way)? (?:between|from) (?:the )?(.+?) (?:and|to|into) (?:the )?(.+?)$/.exec(t);
    return m ? pair(ctx, 'add_door', m[1], m[2]) : null;
  },
  (t, ctx) => {
    const m = new RegExp(`^(?:put|add|cut|give) (?:a |another )?window (?:in|into|to) (?:the )?(.+?) (?:on|facing|in) (?:the |its )?${WALL}(?: side| wall)?$|^(?:put|add|cut) (?:a |another )?window (?:on|in) (?:the )?${WALL} (?:wall|side) of (?:the )?(.+?)$`).exec(t);
    if (!m) return null;
    const room = findRoomIn(ctx, m[1] ?? m[4]);
    return room ? { kind: 'add_window', id: room, wall: m[2] ?? m[3] } : null;
  },
  (t, ctx) => {
    const m = new RegExp(`^(?:put|move|add|have) (?:the |a )?(?:front|main|entrance) door (?:in|on|into|through) (?:the )?(.+?)(?: on the ${WALL}(?: side| wall)?)?$`).exec(t);
    if (!m) return null;
    const room = findRoomIn(ctx, m[1]);
    const wall = m[2] ?? ctx.rooms.find((r) => r.id === room)?.outside[0];
    return room && wall ? { kind: 'add_front_door', id: room, wall } : null;
  },

  // renaming and changing use
  (t, ctx) => {
    const m = /^make (?:the )?(.+?) (?:a|an|into a|into an|the) (.+?)(?: instead)?$/.exec(t);
    if (!m) return null;
    const room = findRoomIn(ctx, m[1]);
    const kind = resolveKind(m[2]);
    return room && kind && !resolveType(m[2]) ? { kind: 'rename_room', id: room, room_kind: kind.kind } : null;
  },
  (t, ctx) => {
    const m = /^rename (?:the )?(.+?) (?:to|as) (?:the )?(.{2,30})$/.exec(t) ?? /^(?:call|name) (?:the )?(.+) (?:the|a) (.{2,30})$/.exec(t);
    const room = m ? findRoomIn(ctx, m[1]) : null;
    return room ? { kind: 'rename_room', id: room, name: titled(m![2]) } : null;
  },

  // rooms in and out
  (t, ctx) => {
    const m = /^(?:add|put in|we need|i need|i want|we want|have|give (?:me|us)|we'?d like|i'?d like|squeeze in|fit in) (?:a|an|another) (.+?)(?: (?:by|near|next to|beside|on|along|against|at) (?:the )?(.+?))?(?: too| as well)?$/.exec(t);
    if (!m) return null;
    const kind = resolveKind(m[1]);
    if (!kind || resolveType(m[1]) || normalizeKind(m[1]).split(' ').length > 3) return null;
    let near: string | null = 'center';
    if (m[2]) {
      const rel = relationOf(m[2]);
      const nextTo = findRoomIn(ctx, m[2]);
      near = rel && rel !== 'window' && rel !== 'door' ? rel : nextTo ? `beside:${nextTo}` : null;
    }
    return near ? { kind: 'add_room', room_kind: kind.kind, near } : null;
  },
  (t, ctx) => {
    const m = /^(?:remove|get rid of|take out|lose|delete|bin|ditch|we don'?t need) (?:the )?(.+?)(?: (?:altogether|completely|anymore|any more))?$/.exec(t);
    if (!m) return null;
    const item = findItemIn(ctx, m[1]);
    const room = findRoomIn(ctx, m[1]);
    if (item && !room) return { kind: 'remove_item', id: item };
    if (room && !item && !resolveType(m[1])) return { kind: 'remove_room', id: room };
    return null;
  },

  // furniture: "a queen bed in the main bedroom by the window"
  (t, ctx) => {
    const m = /^(?:(add|put|place|get|have|i want|we want|i'?d like|we'?d like|we need|i need|stick|pop|fit) )?(?:a|an|another|one more|the) (.+?)(?: (?:in|into|to) (?:the )?(.+?))?(?: (?:by|near|next to|under|against|beside|along|on|at) (?:the )?(.+?))?$/.exec(t);
    if (!m) return null;
    const piece = resolveType(m[2]);
    if (!piece || resolveKind(m[2]) || normalizeKind(m[2]).split(' ').length > 3) return null;
    if (!m[1] && !m[3]) return null;   // a bare "a sofa" is not an instruction
    const room = m[3] ? findRoomIn(ctx, m[3]) : ctx.rooms.some((r) => r.id === ctx.selected) ? ctx.selected : null;
    if (m[3] && !room) return null;
    if (!ctx.rooms.length) return null;
    let near = relationOf(m[4]);
    if (m[4] && !near) {
      const beside = findItemIn(ctx, m[4]);
      near = beside ? `beside:${beside}` : null;
    }
    if (!near) return null;
    // "put the sofa by the window" moves the one there is; "a sofa" adds one.
    const existing = /^the /.test(t.replace(/^(?:put|place|move|stick) /, '')) ? findItemIn(ctx, m[2]) : null;
    if (existing) return { kind: 'place_item', id: existing, near, ...(room ? { room } : {}) };
    return { kind: 'add_item', type: piece.type, room, near };
  },
  (t, ctx) => {
    const m = /^(?:move|put|shift|slide) (?:the )?(.+?) (?:by|near|next to|under|against|beside|along|to|over to|onto) (?:the )?(.+?)$/.exec(t);
    if (!m) return null;
    const item = findItemIn(ctx, m[1]);
    const near = relationOf(m[2]);
    return item && near ? { kind: 'place_item', id: item, near } : null;
  },
  (t, ctx) => {
    const m = /^(?:turn|rotate|spin|swing) (?:the )?(.+?)(?: round| around| 90 degrees| a quarter turn| sideways| the other way)?$/.exec(t);
    const item = m ? findItemIn(ctx, m[1]) : null;
    return item ? { kind: 'rotate_item', id: item, deg: 90 } : null;
  },

  // pointing at a room
  (t, ctx) => {
    const m = /^(?:work on|look at|select|focus on|show me|zoom (?:in )?on|over to) (?:the )?(.+?)$/.exec(t);
    const room = m ? findRoomIn(ctx, m[1]) : null;
    return room ? { kind: 'select', id: room } : null;
  },
];

function schemeIn(ctx: Ctx, phrase: string): string | null {
  const key = stripArticle(phrase).replace(/ (?:scheme|version|one|plan)$/, '').trim();
  if (!key) return null;
  return ctx.schemes.find((s) => s.toLowerCase() === key) ?? ctx.schemes.find((s) => s.toLowerCase().includes(key) || key.includes(s.toLowerCase())) ?? null;
}

function trade(ctx: Ctx, fromPhrase: string, toPhrase: string, m2: string): Intent | null {
  const from = findRoomIn(ctx, fromPhrase), to = findRoomIn(ctx, toPhrase);
  const amount = Number(m2);
  if (!from || !to || from === to || !(amount > 0)) return null;
  return { kind: 'trade_area', from, to, m2: amount };
}

function pair(ctx: Ctx, kind: string, aPhrase: string, bPhrase: string): Intent | null {
  const a = findRoomIn(ctx, aPhrase), b = findRoomIn(ctx, bPhrase);
  return a && b && a !== b ? { kind, a, b } : null;
}

const CLAUSE_SPLIT = / (?:and then|and also|then|and|after that|also) /;

/**
 * The operations an utterance asks for when the rules can tell, in order; null
 * when they cannot (a question, chat, or wording only a model can read). Every
 * clause must be understood, or none is acted on: half an instruction applied
 * is worse than the whole one judged by the model.
 */
export function rulesFor(text: string, ctx: Ctx): Intent[] | null {
  // A question, or a "don't", is for the avatar or the model, never a rule.
  if (QUESTION.test(text.trim().toLowerCase())) return null;
  const t = normalizeUtterance(text);
  if (!t || NEGATION.test(t)) return null;
  const whole = ruleFor(t, ctx);
  if (whole) return whole;
  const clauses = t.split(CLAUSE_SPLIT).map((c) => normalizeUtterance(c)).filter(Boolean);
  if (clauses.length < 2) return null;
  const out: Intent[] = [];
  for (const clause of clauses) {
    const intents = ruleFor(clause, ctx);
    if (!intents) return null;
    out.push(...intents);
  }
  return out;
}

function ruleFor(t: string, ctx: Ctx): Intent[] | null {
  for (const rule of RULES) {
    const intent = rule(t, ctx);
    if (intent) return Array.isArray(intent) ? intent : [intent];
  }
  return null;
}

const QUESTION = /^(?:what|what's|whats|how|where|why|which|who|whose|when|is|are|isn't|aren't|does|do|did|doesn't|should|shall i|would it|would that|could it|will it|was|were|have we|has it)\b.*\?\s*$|^(?:what|how|where|why|which|who)\b/;
const NEGATION = /\b(?:don'?t|do not|never|not yet|no need|shouldn'?t|wouldn'?t|not now|leave it)\b/;

// ------------------------------------------------------------------ the model

/** The operations the model may pick, named as the original tools were. */
export const OPS = [
  'lay_out_floor', 'set_floor_size', 'add_upper_floor', 'go_to_floor',
  'add_room', 'remove_room', 'rename_room', 'resize_room', 'trade_area', 'move_wall', 'swap_rooms', 'knock_together',
  'divide_room', 'mark_wall_structural', 'add_door', 'add_window', 'add_front_door', 'remove_door_or_window',
  'add_furniture', 'move_furniture', 'turn_furniture', 'remove_furniture',
  'save_scheme', 'show_scheme', 'compare_scheme', 'stop_comparing', 'drop_scheme',
  'switch_units', 'undo', 'clear_floor', 'draw_sheet', 'select',
] as const;
export type Op = typeof OPS[number];

/** One operation as the model returns it. Every field but `op` is optional. */
export interface Step {
  op: Op;
  room?: string; other_room?: string; take_from?: string; give_to?: string;
  m2?: number; cm?: number; room_kind?: string; name?: string;
  near?: string; beside?: string; piece?: string; item?: string; wall?: string; opening?: string;
  bedrooms?: number; style?: string; office?: boolean; dining?: boolean; ensuite?: boolean; wc?: boolean; utility?: boolean;
  width_m?: number; depth_m?: number; area_m2?: number; quarter_turns?: number; unit?: string; floor?: string; scheme?: string;
}

const s = (description: string) => ({ type: 'string', description });
const n = (description: string) => ({ type: 'number', description });
const b = (description: string) => ({ type: 'boolean', description });

/**
 * The answer's shape. No field takes a position: only `cm` (an exact wall
 * movement the client said out loud) and the floor size are measurements, the
 * same bet the original tools made.
 */
export const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      description: 'The plan changes the client is asking for right now, in order. Empty for a question, small talk, an answer, thinking aloud, or a change you are unsure they want.',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: [...OPS] },
          room: s('The room acted on, by its id from the plan (r3). For move_wall, mark_wall_structural, swap_rooms, knock_together and add_door, the first of the two rooms.'),
          other_room: s('The second room, by id: move_wall, mark_wall_structural, swap_rooms, knock_together, add_door.'),
          take_from: s('trade_area only: the room that gets SMALLER (gives the floor up), by id.'),
          give_to: s('trade_area only: the room that gets BIGGER (receives the floor), by id.'),
          m2: n('Square metres: trade_area, resize_room, or the size of a new room if they gave one.'),
          cm: n('move_wall only: exact centimetres the client said; positive gives the floor to `room`.'),
          room_kind: s('add_room, divide_room (what the new half is for) and rename_room (a change of use): living, kitchen, dining, bedroom, bedroom_single, nursery, office, bathroom, shower_room, wc, utility, hall, corridor, stairs, storage, closet, balcony, or the client\'s own word.'),
          name: s('rename_room: the new name; add_room: a name if they gave one.'),
          near: { type: 'string', enum: ['center', 'north_wall', 'south_wall', 'east_wall', 'west_wall', 'window', 'door', 'beside'], description: 'Roughly where, never a position: add_room (not window or door), add_furniture, move_furniture.' },
          beside: s('With near=beside: the room id (add_room) or the piece id (furniture) to be next to.'),
          piece: s('add_furniture: the kit type (bed_single, bed_double, bed_queen, bed_king, bedside_table, sofa_2, sofa_3, sofa_corner, armchair, chair, stool, desk, dining_table, coffee_table, side_table, wardrobe, dresser, bookshelf, tv_unit, rug, rug_small, plant, floor_lamp), or the client\'s own word if it is not in the kit.'),
          item: s('A piece already on the plan, by id (i4): move_furniture, turn_furniture, remove_furniture, select.'),
          wall: { type: 'string', enum: ['north', 'south', 'east', 'west'], description: 'add_window, add_front_door: the outside wall; resize_room: which way to grow.' },
          opening: s('remove_door_or_window: the opening id (o3).'),
          bedrooms: n('lay_out_floor: how many bedrooms (a couple is 1, a couple with a baby 2, a family with two kids 3).'),
          style: { type: 'string', enum: TYPOLOGIES.map((t) => t.key), description: 'lay_out_floor: day_night (living at the entry end, bedrooms at the far end), open_plan (kitchen, dining and living as one room), dual_aspect (hall down the middle, every room gets a window), compact (no hall at all).' },
          office: b('lay_out_floor: include a study.'), dining: b('lay_out_floor: a separate dining room.'), ensuite: b('lay_out_floor: an en suite.'),
          wc: b('lay_out_floor: a separate WC.'), utility: b('lay_out_floor: a utility room.'),
          width_m: n('set_floor_size: east-west, the number the client said (metres or centimetres).'),
          depth_m: n('set_floor_size: north-south, the number the client said.'),
          area_m2: n('set_floor_size: the total floor area, when they gave an area instead of two sides.'),
          quarter_turns: n('turn_furniture: 1, 2 or 3.'),
          unit: { type: 'string', enum: ['m2', 'ft2'], description: 'switch_units.' },
          floor: { type: 'string', enum: ['ground', 'upper'], description: 'go_to_floor.' },
          scheme: s('save_scheme (a name, or empty), show_scheme, compare_scheme, drop_scheme: the scheme name.'),
        },
        required: ['op'],
      },
    },
    ask: s('Only when the client clearly asked for a change that cannot be pinned down (which bedroom? how much?): one short question to ask them. Otherwise empty.'),
  },
  required: ['steps'],
} as const;

export const JUDGE_SYSTEM = 'You turn what a client says to their architect into operations on a floor-plan app. You never invent rooms or pieces, and you never give coordinates.';

export interface Line { who: 'client' | 'architect'; text: string }

/** The model's prompt: the utterance, the conversation so far, and the plan by id. */
export function judgePrompt(text: string, ctx: Ctx, recent: Line[] = []): string {
  const nameOf = new Map(ctx.rooms.map((r) => [r.id, r.name]));
  const rooms = ctx.rooms.map((r) => `${r.id} ${r.name} (${r.kind}, ${r.area_m2} m², ${r.where}; shares a wall with ${r.next_to.map((id) => `${id} ${nameOf.get(id)}`).join(', ') || 'nothing'}; outside walls: ${r.outside.join(', ') || 'none'})`);
  const items = ctx.items.map((i) => `${i.id} ${i.label} in ${i.room ? `${i.room} ${nameOf.get(i.room)}` : 'no room'}`);
  const openings = ctx.openings.map((o) => `${o.id} ${o.front ? 'front door' : o.kind} (${o.rooms.join(' / ')})`);
  const said = recent.slice(-8).map((l) => `${l.who === 'client' ? 'Client' : 'Architect'}: ${l.text}`).join('\n');
  return `The client is planning their home with an architect. The client just said: "${text}"
${said ? `\nThe conversation so far (oldest first):\n${said}\n` : ''}
The plan, ${ctx.floor} floor of ${ctx.floors.length} (${ctx.size.w_cm / 100} x ${ctx.size.h_cm / 100} m), areas shown in ${ctx.unit}:
Rooms: ${rooms.join('; ') || 'none yet (an empty floor)'}
Furniture: ${items.join('; ') || 'none'}
Doors and windows: ${openings.join('; ') || 'none'}
Saved schemes: ${ctx.schemes.join(', ') || 'none'}${ctx.comparing ? ` (comparing with ${ctx.comparing})` : ''}
Selected on screen: ${ctx.selected ?? 'nothing'}

Which plan operations is the client asking for right now?
- Only what they ask for now. A question about the plan, an answer to a question, or thinking aloud is no operation.
- If they agree ("yes", "do it", "go on") to a change the architect just proposed, that change is the operation.
- Use the ids above. Never name a room, piece or opening that is not listed.
- trade_area: take_from is the room that gets SMALLER, give_to the room that gets BIGGER. In "give the study two metres off the kitchen", give_to is the study and take_from the kitchen. Read who ends up with the space, not which room was said first.
- "metres" about a room means square metres. To make a room bigger at a named neighbour's expense use trade_area; resize_room only uses free floor.
- Describing the household or asking for a layout is lay_out_floor (it replaces the floor); if they also gave the size of the place, set_floor_size comes first.
- To move a piece that is already on the plan use move_furniture, never remove and add.
- Several requests in one sentence ("save this and try it open plan") are several steps, in order.`;
}

const IDS = (ctx: Ctx) => new Set([...ctx.rooms.map((r) => r.id), ...ctx.items.map((i) => i.id), ...ctx.openings.map((o) => o.id)]);
const ref = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const num = (value: unknown) => {
  const v = toNumber(value);
  return Number.isFinite(v) ? v : null;
};

/**
 * The model's steps as planner intents, or a question when a required part is
 * missing. Names the planner can resolve pass through (it refuses the rest in
 * its own words); nothing here takes a coordinate.
 */
export function stepsToIntents(steps: Step[] | undefined, ctx: Ctx): { intents: Intent[]; ask: string | null } {
  const intents: Intent[] = [];
  let ask: string | null = null;
  const known = IDS(ctx);
  const beside = (step: Step) => (step.near === 'beside' && ref(step.beside) ? `beside:${ref(step.beside)}` : step.near && step.near !== 'beside' ? step.near : 'center');
  for (const step of (steps ?? []).slice(0, 4)) {
    const room = ref(step.room), other = ref(step.other_room);
    switch (step.op) {
      case 'lay_out_floor':
        intents.push({
          kind: 'generate', bedrooms: Math.min(5, Math.max(1, Math.round(num(step.bedrooms) ?? 1))),
          style: TYPOLOGIES.some((t) => t.key === step.style) ? step.style! : 'day_night',
          office: Boolean(step.office), dining: Boolean(step.dining), ensuite: Boolean(step.ensuite), wc: Boolean(step.wc), utility: Boolean(step.utility),
        });
        break;
      case 'set_floor_size': {
        const w = num(step.width_m), d = num(step.depth_m), area = num(step.area_m2);
        if (w && d) intents.push({ kind: 'set_envelope', w: roomSideCm(w), h: roomSideCm(d) });
        else if (area && area > 0) {
          const size = sizeForArea(area, ctx.size);
          intents.push({ kind: 'set_envelope', w: size.w, h: size.h });
        } else ask ??= 'Roughly how big is the place: how many metres by how many?';
        break;
      }
      case 'add_upper_floor': intents.push({ kind: 'add_level' }); break;
      case 'go_to_floor': intents.push({ kind: 'go_to_level', id: step.floor === 'upper' ? 'upper' : 'ground' }); break;
      case 'add_room':
        intents.push({ kind: 'add_room', room_kind: ref(step.room_kind) ?? 'other', near: beside(step), ...(num(step.m2) ? { area_m2: num(step.m2) } : {}), ...(ref(step.name) ? { name: ref(step.name) } : {}) });
        break;
      case 'remove_room': if (room) intents.push({ kind: 'remove_room', id: room }); break;
      case 'rename_room':
        if (room && (ref(step.name) || ref(step.room_kind))) intents.push({ kind: 'rename_room', id: room, name: ref(step.name), room_kind: ref(step.room_kind) });
        break;
      case 'resize_room': {
        const m2 = num(step.m2);
        if (room && m2 && m2 > 0) intents.push({ kind: 'grow_room', id: room, m2, towards: step.wall ?? '' });
        else if (room) ask ??= 'How much bigger: a square metre, two?';
        break;
      }
      case 'trade_area': {
        const from = ref(step.take_from), to = ref(step.give_to);
        const m2 = Math.abs(num(step.m2) ?? 1) || 1;
        if (from && to && from !== to) intents.push({ kind: 'trade_area', from, to, m2 });
        else ask ??= 'Which room should give the space up, and which one gets it?';
        break;
      }
      case 'move_wall': {
        const cm = num(step.cm);
        if (room && other && cm) intents.push({ kind: 'move_wall', a: room, b: other, delta: cm });
        else ask ??= 'Which wall, and how far?';
        break;
      }
      case 'swap_rooms': if (room && other) intents.push({ kind: 'swap_rooms', a: room, b: other }); break;
      case 'knock_together': if (room && other) intents.push({ kind: 'merge_rooms', a: room, b: other }); break;
      case 'divide_room': if (room) intents.push({ kind: 'split_room', id: room, room_kind: ref(step.room_kind) ?? 'other' }); break;
      case 'mark_wall_structural': if (room && other) intents.push({ kind: 'mark_structural', a: room, b: other }); break;
      case 'add_door': if (room && other) intents.push({ kind: 'add_door', a: room, b: other }); break;
      case 'add_window': if (room && step.wall) intents.push({ kind: 'add_window', id: room, wall: step.wall }); break;
      case 'add_front_door': {
        const wall = step.wall ?? ctx.rooms.find((r) => r.id === room)?.outside[0];
        if (room && wall) intents.push({ kind: 'add_front_door', id: room, wall });
        break;
      }
      case 'remove_door_or_window': {
        const which = ref(step.opening);
        if (which) intents.push({ kind: 'remove_opening', id: which });
        break;
      }
      case 'add_furniture': {
        const piece = ref(step.piece);
        if (piece) intents.push({ kind: 'add_item', type: piece, room, near: beside(step) });
        break;
      }
      case 'move_furniture': {
        const item = ref(step.item);
        if (item) intents.push({ kind: 'place_item', id: item, room, near: beside(step) });
        break;
      }
      case 'turn_furniture': {
        const item = ref(step.item);
        const turns = Math.round(num(step.quarter_turns) ?? 1) || 1;
        if (item) intents.push({ kind: 'rotate_item', id: item, deg: turns * 90 });
        break;
      }
      case 'remove_furniture': { const item = ref(step.item); if (item) intents.push({ kind: 'remove_item', id: item }); break; }
      case 'save_scheme': intents.push({ kind: 'save_scheme', name: ref(step.scheme) ?? ref(step.name) ?? '' }); break;
      case 'show_scheme': if (ref(step.scheme)) intents.push({ kind: 'load_scheme', name: ref(step.scheme) }); break;
      case 'compare_scheme': if (ref(step.scheme)) intents.push({ kind: 'compare_scheme', name: ref(step.scheme) }); break;
      case 'stop_comparing': intents.push({ kind: 'compare_scheme', name: 'off' }); break;
      case 'drop_scheme': if (ref(step.scheme)) intents.push({ kind: 'drop_scheme', name: ref(step.scheme) }); break;
      case 'switch_units': intents.push({ kind: 'set_unit', unit: step.unit === 'ft2' || /f/i.test(step.unit ?? '') ? 'ft2' : 'm2' }); break;
      case 'undo': intents.push({ kind: 'undo' }); break;
      case 'clear_floor': intents.push({ kind: 'clear' }); break;
      case 'draw_sheet': intents.push({ kind: 'draw_sheet' }); break;
      case 'select': { const id = ref(step.item) ?? room; if (id && known.has(id)) intents.push({ kind: 'select', id }); break; }
      default: break;
    }
  }
  return { intents, ask: intents.length ? null : ask };
}

/** Every room id in a context, sorted, for tests and logs. */
export const roomIds = (ctx: Ctx) => ctx.rooms.map((r) => r.id).sort(cmpStr);
