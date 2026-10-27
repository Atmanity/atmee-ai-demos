// What Hester is told, and how she acts. The stores decide every count, price
// and stamp; Hester reaches them only through her tools and speaks from what
// they answer.
import type { AppTool } from '../../../server/app-server.ts';
import { listOf, type Check, type Stamp } from './stores.ts';
import { DEPARTMENTS, type Item, type Slip, type View } from './types.ts';

/** Hester's rules at the window: the session's tool instructions (at most 4,000 characters). */
export const INSTRUCTIONS = `You are Hester Pell at the Supply window of Silo 18. The person at your counter is a resident who wants something from the stores. The stores ledger, their chits and every slip are on their screen; you reach them only through your tools, and their screen changes only when you call one.
- Whenever they name something they want, or ask whether you have it, call check_shelves with the item in their words before you say anything about it: whether it is in, how many, the price, the shelf, who it is issued to. Never guess a count or a price, even one you think you remember.
- Nothing leaves Supply without a slip, a department and a reason. Once you know the item, how many, their department and what it is for, and you are willing to issue it, call stamp_slip. Only stamp_slip issues anything: never say it is stamped, handed over or "here you go" unless its result says "Stamped".
- Speak from the result. "Stamped" means it is theirs. "Not yet" means ask what it says, then call stamp_slip again. "Not stamped" or "Refused" means nothing was issued: say why in your own words and offer what the result offers.
- When you decide yourself to turn a request down (they are rude, it is for something you will not supply, the story does not add up), call refuse_slip with the item and your reason in a few words, then tell them.
- A short answer to your own question ("Hydroponics.", "Two.", "For the drip pump.") is part of the request: carry on with the tools.
- Departments: ${listOf([...DEPARTMENTS])} (their own household).
- Talk of going outside: go quiet, refuse, and change the subject.
- They pay in chits. You never take favours and never change a price.
Keep every reply to one to three short spoken sentences, no lists.`;

// Lenient on purpose: Causeur drops a call whose arguments miss the schema, and the host may
// then say it happened anyway. The stores normalise every value.
const text = (description: string) => ({ type: 'string', description });

export const TOOLS: AppTool[] = [
  {
    type: 'function', name: 'check_shelves',
    description: 'Looks an item up in the stores ledger: whether it is in, how many, the price in chits, the shelf and who it is issued to. Call it whenever the visitor names something they want or asks if you have it, before saying anything about it.',
    parameters: { type: 'object', properties: { item: text('The item in the visitor\'s words, e.g. "pump gasket", "forty-watt bulb", "thread".') }, required: ['item'] },
    'x-atmee': { mode: 'await', timeoutSeconds: 8 },
  },
  {
    type: 'function', name: 'stamp_slip',
    description: 'Writes and stamps a requisition slip. The stores check the stock, the department and the visitor\'s chits, and issue the item only if they hold. Call it once you know the item, how many, the department and what it is for.',
    parameters: {
      type: 'object',
      properties: {
        item: text('The item, as in the ledger or the visitor\'s words.'),
        quantity: { type: 'number', description: 'How many. 1 if they did not say.' },
        department: text(`The visitor's department: ${DEPARTMENTS.join(', ')}.`),
        purpose: text('What it is for, in a few words of theirs.'),
      },
      required: ['item'],
    },
    'x-atmee': { mode: 'await', timeoutSeconds: 8 },
  },
  {
    type: 'function', name: 'refuse_slip',
    description: 'Turns a request down on your own judgement and puts a refused slip on the visitor\'s screen. Not for anything the stores already refused.',
    parameters: { type: 'object', properties: { item: text('What they asked for.'), reason: text('Why, in a few words.') }, required: ['reason'] },
    'x-atmee': { mode: 'notify' },
  },
];

const chits = (n: number) => `${n} chit${n === 1 ? '' : 's'}`;
const issuedTo = (item: Item) => (item.only ? `, issued only to ${listOf(item.only)}` : '');
const known = (item: Item) => (item.note ? ` (${item.note})` : '');
const stock = (item: Item) => `${item.name}: ${item.count} on shelf ${item.shelf}, ${chits(item.chits)} ${item.unit === 'each' ? 'each' : `a ${item.unit}`}`;

/** The window as Hester knows it: the visitor's chits and slips, the ledger's items by name only (counts and prices come from check_shelves). */
export function windowState(v: View): string {
  const stamped = v.slips.filter((s) => s.status === 'stamped');
  const refused = v.slips.length - stamped.length;
  const last = v.slips.at(-1);
  return [
    `Supply window, Silo 18. The visitor has ${chits(v.purse)} of the ${v.startPurse} they came with.`,
    v.slips.length
      ? `Slips this visit: ${stamped.length} stamped, ${refused} refused. The last: ${slipLine(last!)}.`
      : 'No slips yet this visit.',
    `The ledger carries: ${v.ledger.map((i) => i.name).join('; ')}. For any count, price or shelf, call check_shelves.`,
    'On their screen: the stores ledger with every count and price, their chits, and the slips.',
  ].join(' ');
}

export const slipLine = (s: Slip) => s.status === 'stamped'
  ? `${s.no}, stamped: ${s.quantity} × ${s.item} for ${s.department}, ${chits(s.chits)}`
  : `${s.no}, refused: ${s.item} (${s.reason})`;

/** What a tool call did, in words Hester speaks from. Each leads with the outcome. */
export const said = {
  opening: (slips = 0) => `You have just greeted them; do not greet or introduce yourself again. ${slips ? 'They are back at your window, and their earlier slips are still on their screen.' : 'The stores ledger and their chits are on their screen.'} Let them say what they are after; if they hesitate, ask in a few words.`,

  check(c: Check): string {
    if (c.kind === 'unknown') return `Not a Supply item: "${c.words}" is not in the ledger. Say Supply does not carry it, and ask what the job is so you can suggest something that is.`;
    if (c.kind === 'in') return `In stock: ${stock(c.item)}${issuedTo(c.item)}${known(c.item)}. The row is lit on their ledger. Before you stamp anything you need how many, their department and what it is for.`;
    const sub = c.substitute;
    return `Out: no ${c.item.name.toLowerCase()} on the shelves${known(c.item)}. ${sub ? `The nearest thing is ${stock(sub)}${issuedTo(sub)}: offer it.` : 'Nothing on the shelves stands in for it.'}`;
  },

  stamp(s: Stamp, purse: number): string {
    switch (s.kind) {
      case 'stamped': {
        const { slip, item } = s;
        return `Stamped: slip ${slip.no}, ${slip.quantity} × ${slip.item} for ${slip.department}, ${chits(slip.chits)}. They have ${chits(purse)} left; ${item.count} left on the shelf. The stamped slip is on their screen: hand it over in a line, without reading it all out.`;
      }
      case 'repeat': return `Already stamped: slip ${s.slip.no} is on their screen. Do not stamp it again; ask if there is anything else.`;
      case 'ask': return s.need === 'item'
        ? 'Not yet: no item was named. Ask what they are after.'
        : s.need === 'department'
          ? `Not yet: no department. Ask which department it is for (${DEPARTMENTS.join(', ')}), then call stamp_slip again.`
          : 'Not yet: no reason given, and nothing leaves without one. Ask what it is for, then call stamp_slip again.';
      case 'unknown': return `Not stamped: "${s.words}" is not in the ledger. Call check_shelves for what they need first.`;
      case 'short': return `Not stamped: only ${s.item.count} on the shelf, and they asked for ${s.wanted}. Offer ${s.item.count}.`;
      case 'limit': return `Not stamped: Supply issues at most ${s.limit} of those on one slip. Offer ${s.limit}.`;
      case 'purse': return `Not stamped: that comes to ${chits(s.cost)} and they have ${chits(s.purse)}. Offer fewer, or something cheaper.`;
      case 'refused':
        if (s.why === 'outside') return 'Refused: Supply issues nothing for the outside. The refused slip is on their screen. Go quiet, refuse flatly, and change the subject.';
        if (s.why === 'restricted') return `Refused: ${s.item.name.toLowerCase()} is issued only to ${listOf(s.item.only ?? [])}, not ${s.slip.department}. The refused slip is on their screen. Tell them who has to ask for it.`;
        return `Refused: none on the shelf${known(s.item)}. The refused slip is on their screen. ${s.substitute ? `Offer ${stock(s.substitute)}.` : 'Nothing stands in for it.'}`;
    }
  },
};
