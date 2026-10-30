// The Volcano Trail: four stops, each a small game with a sticker at the end.
// The trail decides what is right and when a stop is cleared; Mochi performs.
// Every move returns the new trail, the outcome in plain words and what the
// screen should celebrate, so a button and a host's tool call do the same thing.

export type StopId = 'boom' | 'layers' | 'silly' | 'rocks';
export type Fx = 'pump' | 'erupt' | 'right' | 'wrong' | 'sticker' | 'hop' | 'finish';

export interface Stop { id: StopId; title: string; game: string; sticker: string; teach: string }

export const STOPS: Stop[] = [
  { id: 'boom', title: 'Rumble Peak', game: 'Pump the volcano', sticker: 'Lava Burst', teach: 'Gas gets trapped in hot melted rock, called magma. When enough gas pushes up, the volcano erupts, just like shaking a fizzy drink.' },
  { id: 'layers', title: 'The Big Dig', game: 'Stack the Earth', sticker: 'Deep Digger', teach: 'The Earth has layers like a giant egg: a hot inner core, a liquid outer core, a thick mantle, and the thin crust we walk on.' },
  { id: 'silly', title: 'Silly Bridge', game: 'Catch Mochi', sticker: 'Fact Checker', teach: 'Good explorers check what they hear, even from a red panda.' },
  { id: 'rocks', title: 'Rock Camp', game: 'Rock detective', sticker: 'Rock Sleuth', teach: 'When lava cools it turns into rock, and how fast it cools changes what the rock looks like.' },
];

export const LAYERS = [
  { id: 'inner', name: 'Inner core', says: 'a ball of solid metal, as hot as the surface of the Sun' },
  { id: 'outer', name: 'Outer core', says: 'liquid metal, swirling around the middle' },
  { id: 'mantle', name: 'Mantle', says: 'thick, hot rock that moves very, very slowly' },
  { id: 'crust', name: 'Crust', says: 'the thin outside, where we walk' },
];

export const CLAIMS = [
  { line: 'Lava is made of hot tomato soup.', truth: false, fact: 'Lava is melted rock.' },
  { line: 'Some volcanoes are hiding under the sea.', truth: true, fact: 'Most of the eruptions on Earth happen under the ocean.' },
  { line: 'Volcanoes erupt because they are grumpy.', truth: false, fact: 'They erupt because trapped gas pushes the magma up.' },
];

export const ROCKS = [
  { id: 'pumice', name: 'Pumice', clue: 'I am so full of tiny bubbles that I can float on water.' },
  { id: 'obsidian', name: 'Obsidian', clue: 'I am smooth, black and shiny, like dark glass.' },
  { id: 'basalt', name: 'Basalt', clue: 'I am dark and heavy, and I make most of the ocean floor.' },
];

export const PUMPS = 3;

export interface Trail {
  stop: number;           // index into STOPS; STOPS.length once the trail is finished
  pressure: number;       // pumps so far at Rumble Peak
  erupted: boolean;
  layers: number;         // layers stacked, from the middle out
  claim: number;          // the claim Mochi is on
  caught: number;         // claims the child judged right
  rock: number;           // the rock being looked for
  stickers: StopId[];
}

export interface Move { trail: Trail; ok: boolean; outcome: string; fx: Fx[] }

export const newTrail = (): Trail => ({ stop: 0, pressure: 0, erupted: false, layers: 0, claim: 0, caught: 0, rock: 0, stickers: [] });

const here = (t: Trail): Stop | undefined => STOPS[t.stop];
export const finished = (t: Trail) => t.stop >= STOPS.length;
export const cleared = (t: Trail) => { const s = here(t); return !!s && t.stickers.includes(s.id); };

const wrongStop = (t: Trail, ok = false): Move => ({ trail: t, ok, outcome: finished(t) ? 'Not now: the trail is finished.' : `Not here: we are at ${here(t)!.title}, playing ${here(t)!.game}.`, fx: [] });
const award = (t: Trail): Trail => ({ ...t, stickers: [...t.stickers, here(t)!.id] });

const clean = (word: unknown) => String(word ?? '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

/** One pump of gas into the volcano; the last one sets it off. */
export function pump(t: Trail): Move {
  if (here(t)?.id !== 'boom') return wrongStop(t);
  if (t.erupted) return { trail: t, ok: false, outcome: 'Not needed: the volcano has already erupted.', fx: [] };
  const pressure = t.pressure + 1;
  if (pressure < PUMPS) return { trail: { ...t, pressure }, ok: true, outcome: `Done: pressure is ${pressure} of ${PUMPS} and the magma is rising.`, fx: ['pump'] };
  const next = award({ ...t, pressure, erupted: true });
  return { trail: next, ok: true, outcome: `Done: the volcano erupted! The ${here(t)!.sticker} sticker went into the backpack.`, fx: ['pump', 'erupt', 'sticker'] };
}

/** The next layer of the Earth, from the middle out. The child may name it any way they like. */
export function addLayer(t: Trail, name: unknown): Move {
  if (here(t)?.id !== 'layers') return wrongStop(t);
  const next = LAYERS[t.layers];
  if (!next) return { trail: t, ok: false, outcome: 'Not needed: the Earth is already finished.', fx: [] };
  const said = clean(name);
  const named = LAYERS.find((l) => said && (said.includes(l.id) || said.includes(clean(l.name))));
  if (named && named.id !== next.id) return { trail: t, ok: false, outcome: `Not that one yet: the ${named.name} does not go there. Give them a hint that the next layer sits right around what is already built.`, fx: ['wrong'] };
  const layers = t.layers + 1;
  const done = layers === LAYERS.length;
  const after = { ...t, layers };
  return {
    trail: done ? award(after) : after, ok: true,
    outcome: `Right: the ${next.name} is on, ${next.says}.${done ? ` The Earth is complete and the ${here(t)!.sticker} sticker went into the backpack.` : ''}`,
    fx: done ? ['right', 'sticker'] : ['right'],
  };
}

/** The child's verdict on what Mochi just claimed: true, or silly. */
export function judge(t: Trail, verdict: unknown): Move {
  if (here(t)?.id !== 'silly') return wrongStop(t);
  const claim = CLAIMS[t.claim];
  if (!claim) return { trail: t, ok: false, outcome: 'Not needed: every claim has been checked.', fx: [] };
  const said = clean(verdict);
  const saysSilly = /silly|nope|\bno\b|false|wrong|not true/.test(said);
  const saysTrue = !saysSilly && /true|yes|right|correct/.test(said);
  if (!saysSilly && !saysTrue) return { trail: t, ok: false, outcome: 'Not clear: ask whether that was true or silly.', fx: [] };
  const right = saysSilly !== claim.truth;
  const after = { ...t, claim: t.claim + 1, caught: t.caught + (right ? 1 : 0) };
  const done = after.claim === CLAIMS.length;
  const said1 = right ? `Right: ${claim.truth ? 'that one was true' : 'you caught Mochi'}. ${claim.fact}` : `Not quite: ${claim.truth ? 'that one was really true' : 'Mochi was being silly'}. ${claim.fact}`;
  return {
    trail: done ? award(after) : after, ok: right,
    outcome: done ? `${said1} All checked, ${after.caught} of ${CLAIMS.length} right, and the ${here(t)!.sticker} sticker went into the backpack.` : said1,
    fx: done ? [right ? 'right' : 'wrong', 'sticker'] : [right ? 'right' : 'wrong'],
  };
}

/** The rock the child thinks Mochi is describing. */
export function pickRock(t: Trail, name: unknown): Move {
  if (here(t)?.id !== 'rocks') return wrongStop(t);
  const wanted = ROCKS[t.rock];
  if (!wanted) return { trail: t, ok: false, outcome: 'Not needed: every rock has been found.', fx: [] };
  const said = clean(name);
  const named = ROCKS.find((r) => said.includes(r.id));
  if (!named) return { trail: t, ok: false, outcome: `Not clear: ask which rock it is, ${ROCKS.map((r) => r.name).join(', ')}.`, fx: [] };
  if (named.id !== wanted.id) return { trail: t, ok: false, outcome: `Not that one: that was ${named.name}. Say the clue another way, without naming the rock.`, fx: ['wrong'] };
  const rock = t.rock + 1;
  const done = rock === ROCKS.length;
  const after = { ...t, rock };
  return {
    trail: done ? award(after) : after, ok: true,
    outcome: `Right: it was ${named.name}.${done ? ` Every rock is found and the ${here(t)!.sticker} sticker went into the backpack.` : ''}`,
    fx: done ? ['right', 'sticker'] : ['right'],
  };
}

/** Walk on to the next stop; a stop is left only once its sticker is won. */
export function walkOn(t: Trail): Move {
  if (finished(t)) return { trail: t, ok: false, outcome: 'Not now: the trail is finished.', fx: [] };
  if (!cleared(t)) return { trail: t, ok: false, outcome: `Not yet: finish ${here(t)!.game} first.`, fx: [] };
  const trail = { ...t, stop: t.stop + 1 };
  if (finished(trail)) return { trail, ok: true, outcome: `Done: the trail is finished with all ${STOPS.length} stickers.`, fx: ['finish'] };
  return { trail, ok: true, outcome: `Done: we are at ${here(trail)!.title}.`, fx: ['hop'] };
}
