// The Brass Kettle: a tavern in a small 2D game, and its keeper's dealings
// with the player. This is the game's own state and rules, run in the page:
// Brannoc (the avatar's voice on a speech session) calls these as tools and
// says what they return. He cannot hand over a quest the board does not
// have, sell what is not on his shelf, or take silver the player lacks.

export interface Ware { id: string; name: string; price: number; stock: number; blurb: string }
export interface Quest { id: string; title: string; giver: string; objective: string; reward: string; start: string }

export const WARES: Ware[] = [
  { id: 'stew', name: 'Bowl of hot stew', price: 1, stock: 9, blurb: 'mutton and barley, the house pot' },
  { id: 'oil', name: 'Flask of lamp oil', price: 2, stock: 4, blurb: 'burns six hours' },
  { id: 'rope', name: 'Coil of rope', price: 3, stock: 3, blurb: 'fifty feet of good hemp' },
  { id: 'map', name: 'Map of the Fen', price: 5, stock: 1, blurb: 'the only one in Fennick, drawn by the old ferryman' },
  { id: 'lantern', name: 'Storm lantern', price: 6, stock: 2, blurb: 'stays lit in rain and wind' },
  { id: 'tonic', name: 'Healing tonic', price: 8, stock: 2, blurb: 'tastes of nettles, closes a cut' },
];

export const QUESTS: Quest[] = [
  {
    id: 'bell', title: 'The Drowned Bell', giver: 'the chapel warden',
    objective: 'Find the chapel bell that sank in Mirror Lake when the old bridge fell, and tell the warden where it lies.',
    reward: '40 silver', start: 'the ferry landing at the south end of Mirror Lake',
  },
  {
    id: 'wolves', title: 'Wolves at Harrow Farm', giver: 'Widow Harrow',
    objective: 'Find out what has been taking sheep from Harrow Farm, two hours north along the cart road.',
    reward: '25 silver and a wheel of cheese', start: 'the sheepfold at Harrow Farm',
  },
  {
    id: 'courier', title: 'The Missing Courier', giver: 'the post-master',
    objective: 'Find the courier who left for Greywater three days ago with the town letters and never arrived.',
    reward: '30 silver', start: 'the milestone where the Greywater road leaves the Fen',
  },
];

/** Silver the player walks in with, and what they carry. */
export const START_SILVER = 12;
export const START_PACK = ['Worn travelling cloak'];
/** At most this many quests at once, and this many things on the house per visit. */
export const MAX_QUESTS = 2;
export const MAX_GIFTS = 1;

export interface Result {
  ok: boolean;
  /** What Brannoc reads, its outcome first. */
  text: string;
  /** What changed, for the page to show (a coin falling, an item arriving, a quest pinned). */
  event?: { kind: 'sold' | 'gift' | 'quest'; label: string };
}

const words = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
const STOP = new Set(['a', 'an', 'the', 'of', 'some', 'one', 'bowl', 'flask', 'coil', 'please', 'quest', 'job']);

/** The thing a player or Brannoc means by name ("rope", "a lantern", "the map"), by its distinctive words. */
export function pick<T extends { id: string; name?: string; title?: string }>(list: T[], input: unknown): T | null {
  const asked = words(input).filter((w) => !STOP.has(w));
  if (!asked.length) return null;
  let best: T | null = null;
  let score = 0;
  for (const item of list) {
    const own = words(`${item.id} ${item.name ?? ''} ${item.title ?? ''}`).filter((w) => !STOP.has(w));
    const hits = asked.filter((w) => own.some((o) => o === w || (w.length > 3 && (o.startsWith(w) || w.startsWith(o))))).length;
    if (hits > score) { best = item; score = hits; }
  }
  return best;
}

const silver = (n: number) => `${n} silver`;

/** One player's visit: their purse, their pack, their quest log, and Brannoc's shelf. */
export class Tavern {
  silver = START_SILVER;
  pack: string[] = [...START_PACK];
  quests: Quest[] = [];
  gifts = 0;
  wares: Ware[] = WARES.map((w) => ({ ...w }));

  /** What the player has now, in Brannoc's words. */
  look_at_player(): Result {
    const quests = this.quests.length ? this.quests.map((q) => q.title).join(' and ') : 'no quest yet';
    return { ok: true, text: `The player has ${silver(this.silver)}; carries ${this.pack.join(', ')}; on their quest log: ${quests}.` };
  }

  sell_item(args: Record<string, unknown>): Result {
    const ware = pick(this.wares, args.item);
    if (!ware) return { ok: false, text: `Not sold: there is no "${String(args.item ?? '')}" on the shelf. The shelf has ${this.shelf()}.` };
    const count = Math.max(1, Math.min(5, Math.round(Number(args.quantity) || 1)));
    if (ware.stock < count) return { ok: false, text: `Not sold: only ${ware.stock} ${ware.name.toLowerCase()} left${ware.stock ? '' : ', none at all'}.` };
    const cost = ware.price * count;
    if (cost > this.silver) return { ok: false, text: `Not sold: ${count > 1 ? `${count} of them cost` : 'it costs'} ${silver(cost)} and the player has only ${silver(this.silver)}. Nothing changed hands.` };
    this.silver -= cost;
    ware.stock -= count;
    for (let i = 0; i < count; i++) this.pack.push(ware.name);
    const label = `${count > 1 ? `${count} × ` : ''}${ware.name}`;
    return { ok: true, event: { kind: 'sold', label }, text: `Sold: ${label} for ${silver(cost)}. The player has ${silver(this.silver)} left.` };
  }

  give_item(args: Record<string, unknown>): Result {
    const ware = pick(this.wares, args.item);
    if (!ware) return { ok: false, text: `Not given: there is no "${String(args.item ?? '')}" on the shelf.` };
    if (this.gifts >= MAX_GIFTS) return { ok: false, text: 'Not given: Brannoc has already given one thing on the house this visit; anything else is sold.' };
    if (ware.price > 2) return { ok: false, text: `Not given: the ${ware.name.toLowerCase()} is worth ${silver(ware.price)}, too dear to give away; offer to sell it.` };
    if (!ware.stock) return { ok: false, text: `Not given: none left.` };
    ware.stock -= 1;
    this.gifts += 1;
    this.pack.push(ware.name);
    return { ok: true, event: { kind: 'gift', label: ware.name }, text: `Given: ${ware.name}, on the house.` };
  }

  give_quest(args: Record<string, unknown>): Result {
    const quest = pick(QUESTS, args.quest);
    if (!quest) return { ok: false, text: `Not given: the quest board has ${QUESTS.map((q) => q.title).join(', ')}; none is called "${String(args.quest ?? '')}".` };
    if (this.quests.some((q) => q.id === quest.id)) return { ok: false, text: `Already on the log: ${quest.title}.` };
    if (this.quests.length >= MAX_QUESTS) return { ok: false, text: `Not given: the player already carries ${this.quests.map((q) => q.title).join(' and ')}; two at a time.` };
    this.quests.push(quest);
    return {
      ok: true, event: { kind: 'quest', label: quest.title },
      text: `Quest given: ${quest.title}, for ${quest.giver}. ${quest.objective} Reward: ${quest.reward}. Start at ${quest.start}.`,
    };
  }

  shelf(): string {
    return this.wares.filter((w) => w.stock).map((w) => `${w.name.toLowerCase()} (${silver(w.price)})`).join(', ');
  }

  run(name: string, args: Record<string, unknown>): Result {
    switch (name) {
      case 'sell_item': return this.sell_item(args);
      case 'give_item': return this.give_item(args);
      case 'give_quest': return this.give_quest(args);
      case 'look_at_player': return this.look_at_player();
      default: return { ok: false, text: `error: the game has no tool named ${name}` };
    }
  }
}

// ── what the game's server pins for every conversation ──────────────────────

const text = (description: string) => ({ type: 'string', description });

/** Brannoc's tools (OpenAI function shape), lenient: the game reads what arrives. */
export const TOOLS = [
  {
    type: 'function' as const,
    name: 'give_quest',
    description: "Pin a quest from the board onto the traveller's quest log, once they have agreed to take it.",
    parameters: { type: 'object', properties: { quest: text('The quest, by name ("the drowned bell", "the wolves").') } },
  },
  {
    type: 'function' as const,
    name: 'sell_item',
    description: 'Sell the traveller something from your shelf, once they have said they will buy it. The game takes their silver.',
    parameters: { type: 'object', properties: { item: text('What they are buying ("rope", "a lantern").'), quantity: text('How many, if more than one.') } },
  },
  {
    type: 'function' as const,
    name: 'give_item',
    description: 'Give the traveller something cheap from your shelf on the house (a stew, a flask of oil): once a visit.',
    parameters: { type: 'object', properties: { item: text('What you are giving.') } },
  },
  {
    type: 'function' as const,
    name: 'look_at_player',
    description: "Size up the traveller: how much silver they have, what they carry, and the quests on their log. Do this before you talk about what they can afford.",
    parameters: { type: 'object', properties: {} },
  },
];

/** How Brannoc plays the scene. */
export const RULES = `You are a character in a game, speaking aloud to the player, a traveller who has just walked into your tavern. Stay in character: never mention being an AI, a game, tools or a model. Keep every reply to one to three short spoken sentences, with the warmth and grumble of an old innkeeper. Use the tools only for what the traveller asks or agrees to: greeting them needs none.

The game keeps the truth about silver, the shelf and the quest log, through your tools. Nothing changes hands, and no quest is given, unless a tool said so: never say you sold, gave or handed over anything before its tool answered, and never make up an item, a price or a quest. Each result starts with its outcome ("Sold:", "Not sold:", "Given:", "Quest given:", "Already on the log:"): say what happened in your own words, and when it failed, say why.

Steer the traveller towards a quest from the board, gossip about it if asked, and let them choose. Give a quest with give_quest only once they agree to take it. Sell with sell_item only once they say they will buy; check what they can afford with look_at_player when it matters. You may give one cheap thing on the house per visit with give_item.`;

export const FACTS = [
  'The Brass Kettle is the only tavern in Fennick, a fen town of reed roofs and boardwalks. Brannoc has kept it for thirty years.',
  `Brannoc's shelf: ${WARES.map((w) => `${w.name.toLowerCase()}, ${silver(w.price)} (${w.blurb})`).join('; ')}.`,
  `The quest board by the door: ${QUESTS.map((q) => `${q.title}, for ${q.giver}: ${q.objective} Reward ${q.reward}.`).join(' ')}`,
  'Gossip: the old bridge over Mirror Lake fell in the spring floods; the ferryman swears he hears the bell ring under the water at night. Widow Harrow blames wolves, but there are no wolf tracks. The courier, young Tamsin, never once missed a delivery.',
].join('\n');
