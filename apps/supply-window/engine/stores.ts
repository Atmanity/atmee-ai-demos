// The stores: what Supply holds, how a spoken item name finds its ledger row,
// and the rules a slip must pass. Hester performs; this decides.
import { DEPARTMENTS, type Department, type Item, type Slip, type View } from './types.ts';

export const START_PURSE = 30;
export const MAX_PER_SLIP = 4;
/** A second stamp_slip for the same thing this soon is the host repeating itself, not a new request. */
export const REPEAT_MS = 45_000;

export const LEDGER: Item[] = [
  { id: 'pump-gasket', name: 'Pump gasket', aliases: ['gasket', 'pump seal', 'seal', 'rubber ring', 'o ring', 'pump washer'], unit: 'each', shelf: 'C-4', count: 2, chits: 12, only: ['Hydroponics', 'Mechanical', 'Farms'], limit: 2, note: 'Hydroponics has been eyeing both' },
  { id: 'bulb-40', name: 'Bulb, 40-watt', aliases: ['40 watt bulb', '40 watt', 'light bulb', 'bulb', 'lamp bulb'], unit: 'each', shelf: 'A-1', count: 0, chits: 4, substitute: 'bulb-25', note: 'none until the next salvage run' },
  { id: 'bulb-25', name: 'Bulb, 25-watt', aliases: ['25 watt bulb', '25 watt', 'small bulb', 'dim bulb'], unit: 'each', shelf: 'A-1', count: 6, chits: 3 },
  { id: 'grow-tube', name: 'Grow-light tube', aliases: ['grow light', 'grow lamp', 'grow tube', 'light tube', 'grow bulb'], unit: 'each', shelf: 'A-3', count: 1, chits: 20, only: ['Hydroponics', 'Farms'], limit: 1 },
  { id: 'thread', name: 'Thread, grey spool', aliases: ['thread', 'spool', 'spool of thread', 'sewing thread', 'cotton'], unit: 'spool', shelf: 'B-2', count: 14, chits: 2 },
  { id: 'patch-kit', name: 'Coverall patch kit', aliases: ['patch kit', 'patch', 'coverall patch', 'mending kit'], unit: 'kit', shelf: 'B-2', count: 5, chits: 3 },
  { id: 'gloves', name: 'Work gloves', aliases: ['glove', 'work glove'], unit: 'pair', shelf: 'B-4', count: 4, chits: 5 },
  { id: 'boot-soles', name: 'Boot soles', aliases: ['sole', 'boot sole', 'shoe sole', 'resoling'], unit: 'pair', shelf: 'B-5', count: 3, chits: 8, limit: 1 },
  { id: 'cloth-tape', name: 'Cloth tape, roll', aliases: ['tape', 'duct tape', 'cloth tape', 'gaffer tape', 'roll of tape'], unit: 'roll', shelf: 'C-1', count: 3, chits: 7 },
  { id: 'bearing', name: 'Bearing, size 608', aliases: ['bearing', 'ball bearing', '608'], unit: 'each', shelf: 'C-2', count: 4, chits: 6, only: ['Mechanical'] },
  { id: 'rail-bracket', name: 'Stair-rail bracket', aliases: ['bracket', 'rail bracket', 'stair bracket', 'railing bracket', 'handrail bracket'], unit: 'each', shelf: 'C-6', count: 2, chits: 10, only: ['Porters', 'Mechanical'] },
  { id: 'copper-wire', name: 'Copper wire, 2 m', aliases: ['copper wire', 'copper', 'wire', 'electrical wire'], unit: 'length', shelf: 'D-1', count: 9, chits: 5, only: ['Mechanical', 'IT'] },
  { id: 'network-cable', name: 'Network cable, 10 m', aliases: ['network cable', 'data cable', 'ethernet', 'patch cable', 'cable'], unit: 'length', shelf: 'D-2', count: 1, chits: 15, only: ['IT'], limit: 1, note: 'IT signs for every metre' },
  { id: 'battery', name: 'Battery cell', aliases: ['battery', 'cell'], unit: 'each', shelf: 'D-4', count: 0, chits: 9, note: 'none since spring; IT takes every one' },
  { id: 'seeds', name: 'Tomato seed, packet', aliases: ['seed', 'tomato seed', 'seed packet', 'packet of seeds'], unit: 'packet', shelf: 'F-3', count: 20, chits: 1, only: ['Farms', 'Hydroponics'] },
  { id: 'soap', name: 'Soap, bar', aliases: ['soap', 'bar of soap', 'soap bar'], unit: 'bar', shelf: 'E-1', count: 25, chits: 2 },
  { id: 'paper', name: 'Paper, 5 sheets', aliases: ['paper', 'sheet', 'sheet of paper', 'writing paper', 'drawing paper'], unit: 'bundle', shelf: 'E-3', count: 8, chits: 6, limit: 1, note: 'paper is rationed' },
  { id: 'pencil', name: 'Pencil', aliases: ['pencil', 'graphite'], unit: 'each', shelf: 'E-3', count: 30, chits: 1 },
];

// Spoken numbers, as the recogniser or the host may write them.
const SPOKEN_NUMBERS: [string, string][] = [
  ['twenty five', '25'], ['six oh eight', '608'], ['forty', '40'], ['two', '2'], ['three', '3'], ['four', '4'],
  ['five', '5'], ['six', '6'], ['seven', '7'], ['eight', '8'], ['nine', '9'], ['ten', '10'],
];
// Words that ask rather than name: "do you have any of those pump gaskets" is "pump gasket".
const FILLER = new Set([
  'a', 'an', 'the', 'some', 'any', 'of', 'for', 'my', 'me', 'i', 'need', 'want', 'got', 'have', 'you', 'do', 'please',
  'new', 'spare', 'few', 'couple', 'one', 'those', 'them', 'it', 'kind', 'type', 'can', 'could', 'get', 'is', 'there',
  'are', 'your', 'with', 'and', 'to', 'on', 'in', 'pair', 'piece',
]);

/** Lowercase words, spoken numbers as digits, light plurals folded: "Forty-watt bulbs" -> "40 watt bulb". */
export function normal(words: string): string {
  let s = ` ${words.toLowerCase().replace(/[-–_/]/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  for (const [word, digits] of SPOKEN_NUMBERS) s = s.replaceAll(` ${word} `, ` ${digits} `);
  s = s.replace(/ (\d+) ?w(att)?s? /g, ' $1 watt ');
  return s.trim().split(' ').map(stem).join(' ');
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

const tokens = (s: string) => s.split(' ').filter((w) => w && !FILLER.has(w));
// What tells two rows of one kind apart: a wattage, a part number. A plain "2" is a quantity.
const specsIn = (s: string) => [...` ${s} `.matchAll(/ (\d+ watt|\d{3,}) /g)].map((m) => m[1]);

/** How well the words name the item: 0 is not at all. */
function score(item: Item, asked: string[]): number {
  const q = asked.join(' ');
  const names = [item.name, ...item.aliases].map((n) => tokens(normal(n)).join(' '));
  const specs = specsIn(q);
  if (specs.length && !specs.some((spec) => names.some((name) => ` ${name} `.includes(` ${spec} `)))) return 0;
  if (names.includes(q)) return 100;
  let best = 0;
  for (const name of names) {
    const whole = name && ` ${q} `.includes(` ${name} `) ? 50 + name.length : 0;
    const words = name.split(' ').filter(Boolean);
    const shared = words.filter((w) => asked.includes(w)).length;
    const overlap = words.length ? (shared / words.length) * 30 + (shared / asked.length) * 10 : 0;
    best = Math.max(best, whole, overlap);
  }
  return best;
}

/** The ledger row the words name, or null: the earliest row wins a tie, so a plain "bulb" is the 40-watt. */
export function findItem(ledger: Item[], words: string): Item | null {
  const asked = tokens(normal(words));
  if (!asked.length) return null;
  let found: Item | null = null;
  let top = 19;
  for (const item of ledger) {
    const s = score(item, asked);
    if (s > top) { top = s; found = item; }
  }
  return found;
}

const DEPARTMENT_WORDS: [RegExp, Department][] = [
  [/\bmech|\bengine|generator|down deep/, 'Mechanical'],
  [/\bhydro|grow room/, 'Hydroponics'],
  [/information tech|\bservers?\b/, 'IT'],
  [/\bfarm/, 'Farms'],
  [/\bkitchen|\bcook|canteen|cafeteria/, 'Kitchens'],
  [/\binfirm|doctor|\bmedic|\bnurse|clinic/, 'Infirmary'],
  [/\bporter/, 'Porters'],
  [/\bdeput|sheriff|security/, 'Deputies'],
  [/\bresiden|\bhome\b|household|\bfamily|personal|myself|my own|\bme\b|own use/, 'Residence'],
];

/** One of the silo's departments, from what was said; null when it names none. */
export function department(words: unknown): Department | null {
  const raw = String(words ?? '').trim();
  if (!raw) return null;
  const s = raw.toLowerCase();
  const exact = DEPARTMENTS.find((d) => d.toLowerCase() === s);
  if (exact) return exact;
  // "IT" only as the capitals: the word "it" is everywhere.
  if (/\bI\.?T\b/.test(raw)) return 'IT';
  for (const [pattern, dept] of DEPARTMENT_WORDS) if (pattern.test(s)) return dept;
  return null;
}

/** A whole number of at least 1 from 2, "2", "two" or "a couple"; 1 when none was given. */
export function quantity(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, Math.round(value));
  const s = normal(String(value ?? ''));
  if (/couple/.test(s)) return 2;
  const n = s.split(' ').find((w) => /^\d+$/.test(w));
  return n ? Math.max(1, Number(n)) : 1;
}

/** Going outside: the one request Supply never fills, whatever the item. */
export const OUTSIDE = /\b(go|get|walk|step|head)(ing)?\s+outside\b|\bthe outside\b|\boutside the silo\b|\b(leave|leaving|out of) the silo\b|\bairlock\b|\bcleaning (the )?(lens|sensor)/i;

export type Check =
  | { kind: 'in'; item: Item }
  | { kind: 'out'; item: Item; substitute: Item | null }
  | { kind: 'unknown'; words: string };

export type Stamp =
  | { kind: 'stamped'; slip: Slip; item: Item }
  | { kind: 'repeat'; slip: Slip }
  | { kind: 'ask'; need: 'item' | 'department' | 'purpose' }
  | { kind: 'unknown'; words: string }
  | { kind: 'short'; item: Item; wanted: number }
  | { kind: 'limit'; item: Item; limit: number }
  | { kind: 'purse'; item: Item; cost: number; purse: number }
  | { kind: 'refused'; slip: Slip; item: Item; why: 'out' | 'restricted' | 'outside'; substitute: Item | null };

export interface StampRequest { item?: unknown; quantity?: unknown; department?: unknown; purpose?: unknown }

export class Stores {
  ledger: Item[];
  purse: number;
  slips: Slip[] = [];
  lit: string | null = null;
  private next: number;
  private now: () => number;
  private stampedAt = 0;

  constructor(opts: { ledger?: Item[]; purse?: number; firstSlip?: number; now?: () => number } = {}) {
    this.ledger = structuredClone(opts.ledger ?? LEDGER);
    this.purse = opts.purse ?? START_PURSE;
    this.next = opts.firstSlip ?? 417;
    this.now = opts.now ?? Date.now;
  }

  item(id: string | undefined): Item | null {
    return this.ledger.find((i) => i.id === id) ?? null;
  }

  /** What the shelves say about the words: in, out (with what stands in for it), or not a Supply item. */
  check(words: unknown): Check {
    const said = String(words ?? '').trim().slice(0, 120);
    const item = findItem(this.ledger, said);
    if (!item) return { kind: 'unknown', words: said };
    this.lit = item.id;
    if (item.count > 0) return { kind: 'in', item };
    return { kind: 'out', item, substitute: this.standIn(item) };
  }

  /** A slip, if the rules allow it. The item, the department and the reason are all required. */
  stamp(req: StampRequest): Stamp {
    const said = String(req.item ?? '').trim().slice(0, 120);
    if (!said) return { kind: 'ask', need: 'item' };
    const item = findItem(this.ledger, said);
    if (!item) return { kind: 'unknown', words: said };
    this.lit = item.id;
    const qty = quantity(req.quantity);
    const purpose = String(req.purpose ?? '').trim().slice(0, 200);
    const dept = department(req.department);

    const last = this.slips.at(-1);
    if (last?.status === 'stamped' && last.itemId === item.id && last.quantity === qty && this.now() - this.stampedAt < REPEAT_MS) {
      return { kind: 'repeat', slip: last };
    }
    if (OUTSIDE.test(purpose) || OUTSIDE.test(said)) return this.refuse(item, qty, dept ?? String(req.department ?? '').slice(0, 40), purpose, 'outside');
    if (!dept) return { kind: 'ask', need: 'department' };
    if (purpose.length < 3) return { kind: 'ask', need: 'purpose' };
    if (item.only && !item.only.includes(dept)) return this.refuse(item, qty, dept, purpose, 'restricted');
    if (item.count === 0) return this.refuse(item, qty, dept, purpose, 'out');
    const limit = item.limit ?? MAX_PER_SLIP;
    if (qty > limit) return { kind: 'limit', item, limit };
    if (qty > item.count) return { kind: 'short', item, wanted: qty };
    const cost = qty * item.chits;
    if (cost > this.purse) return { kind: 'purse', item, cost, purse: this.purse };

    item.count -= qty;
    this.purse -= cost;
    this.stampedAt = this.now();
    const slip: Slip = { no: this.number(), status: 'stamped', itemId: item.id, item: item.name, quantity: qty, department: dept, purpose, chits: cost };
    this.slips.push(slip);
    return { kind: 'stamped', slip, item };
  }

  /** Hester turns a request down herself: a refused slip with her reason. */
  turnDown(words: unknown, reason: unknown): Slip {
    const said = String(words ?? '').trim().slice(0, 120) || 'Request';
    const item = findItem(this.ledger, said);
    if (item) this.lit = item.id;
    const slip: Slip = {
      no: this.number(), status: 'refused', itemId: item?.id ?? null, item: item?.name ?? said, quantity: 1,
      department: '', purpose: '', chits: 0, reason: String(reason ?? '').trim().slice(0, 160) || 'Refused at the window',
    };
    this.slips.push(slip);
    return slip;
  }

  view(): View {
    return { purse: this.purse, startPurse: START_PURSE, ledger: structuredClone(this.ledger), slips: structuredClone(this.slips), lit: this.lit };
  }

  private standIn(item: Item): Item | null {
    const sub = this.item(item.substitute);
    return sub && sub.count > 0 ? sub : null;
  }

  private refuse(item: Item, qty: number, dept: string, purpose: string, why: 'out' | 'restricted' | 'outside'): Stamp {
    const reason = why === 'out' ? 'None on the shelf'
      : why === 'restricted' ? `Issued only to ${listOf(item.only ?? [])}`
      : 'Supply issues nothing for the outside';
    const slip: Slip = { no: this.number(), status: 'refused', itemId: item.id, item: item.name, quantity: qty, department: dept, purpose, chits: 0, reason };
    this.slips.push(slip);
    return { kind: 'refused', slip, item, why, substitute: why === 'out' ? this.standIn(item) : null };
  }

  private number(): string {
    return `18-${String(this.next++).padStart(4, '0')}`;
  }
}

/** "IT", "Farms and Hydroponics", "Porters, Mechanical and IT". */
export function listOf(words: string[]): string {
  return words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
