// Morsel's server side: the app's own model calls (a card for a named food, a
// card from a photo, a recipe's steps) and each visit's one writer
// (engine/advisor.ts). The host's tool calls and the user's buttons run the
// same actions here; a tool gets back the words the host speaks from, a
// button the event the host is told. Nothing here is secret from the page; it
// runs on the server because the model key does.
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { Advisor, recipeKey, sameFood } from './engine/advisor.ts';
import { bounded, serial } from './engine/bounded.ts';
import { CARD_SCHEMA, CARD_SYSTEM, cardFrom, cardPrompt, PHOTO_PROMPT, PHOTO_SCHEMA, RECIPE_SCHEMA, RECIPE_SYSTEM, recipeFrom, recipePrompt } from './engine/card.ts';
import { started } from './engine/cook.ts';
import { INSTRUCTIONS, pressed, said, SAMPLE_FAILED, SERVER_TOOLS, TOOLS } from './engine/director.ts';

const list = (names: string[]) => names.map((n) => `“${n}”`).join(' and ');
import { builtInCard, SAMPLE_CARD } from './engine/fallback.ts';
import { asked, foodsFrom, resolveRecipe } from './engine/judge.ts';
import type { FoodAsk, Image, NutritionData, Outcome, RecipeDetails, RecipeIdea } from './engine/types.ts';

const ID = 'nutrition-advisor';

// Every model call has a deadline (engine/bounded.ts says why). A card or a
// recipe answers a tool the host waits on for at most 20 s, so it must land
// (or give up for the built-in card) well inside that.
const CARD_MS = 14_000;
const RECIPE_MS = 14_000;
const PHOTO_MS = 40_000;

const SAMPLE = new URL('./samples/meal.jpg', import.meta.url);
const SAMPLE_SEEN = 'grilled salmon with rice, broccoli and green beans';
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGE_BASE64 = 6 * 1024 * 1024;

interface Visit {
  advisor: Advisor;
  /** Photos are read one at a time. */
  photos: ReturnType<typeof serial>;
  /** Recipes being made, so a tap during the make-ahead waits for it instead of paying twice. */
  recipes: Map<string, Promise<RecipeDetails | null>>;
  at: number;
}
const visits = new Map<string, Visit>();

const warn = (what: string, err: unknown) => console.warn('[%s] %s failed: %s', ID, what, (err as Error)?.message ?? err);

// -- the model calls --------------------------------------------------------------

/** A card for a food the user named: the model, or a built-in card for a few common foods when it is absent or fails. */
async function cardForFood(food: FoodAsk): Promise<NutritionData | null> {
  const assumed = !food.quantity;
  if (llmAvailable()) {
    try {
      const raw = await bounded(structured({ system: CARD_SYSTEM, user: cardPrompt(food), schema: CARD_SCHEMA, temperature: 0.2 }), CARD_MS, 'the card');
      // A named food is always an estimate, and its portion is assumed unless the user said how much: the app's claim, not the model's.
      const card = cardFrom(raw, { source: 'estimate', portionAssumed: assumed });
      if (card) return card;
      console.warn('[%s] a card came back with no food in it', ID);
    } catch (err) {
      warn('a card', err);
    }
  }
  return assumed ? builtInCard(food.name) : null;
}

type Reading = { card: NutritionData; seen: string } | { notFood: string } | { failed: true } | { noVision: true };

async function readPhoto(image: Image, sample: boolean): Promise<Reading> {
  // The app knows its own sample, so it works without a model too.
  const known = (): Reading => ({ card: structuredClone(SAMPLE_CARD), seen: SAMPLE_SEEN });
  if (!llmAvailable()) return sample ? known() : { noVision: true };
  try {
    const raw = await bounded(structured<Record<string, unknown>>({ system: CARD_SYSTEM, user: PHOTO_PROMPT, schema: PHOTO_SCHEMA, images: [image], temperature: 0.2 }), PHOTO_MS, 'the photo');
    const seen = typeof raw?.seen === 'string' ? raw.seen.trim().slice(0, 120) : '';
    if (raw?.is_food === false) return { notFood: seen };
    const card = cardFrom(raw, { source: raw?.source, portionAssumed: raw?.portion_assumed });
    return card ? { card, seen } : { failed: true };
  } catch (err) {
    warn('a photo', err);
    return sample ? known() : { failed: true };
  }
}

async function makeRecipe(idea: RecipeIdea, food: string): Promise<RecipeDetails | null> {
  if (!llmAvailable()) return null;
  try {
    const raw = await bounded(structured({ system: RECIPE_SYSTEM, user: recipePrompt(idea, food), schema: RECIPE_SCHEMA, temperature: 0.4 }), RECIPE_MS, 'the recipe');
    return recipeFrom(raw, idea.name, idea.description);
  } catch (err) {
    warn('a recipe', err);
    return null;
  }
}

function recipeJob(v: Visit, idea: RecipeIdea, food: string): Promise<RecipeDetails | null> {
  const key = `${food.toLowerCase()}\u0000${recipeKey(idea.name)}`;
  let job = v.recipes.get(key);
  if (!job) {
    job = makeRecipe(idea, food);
    v.recipes.set(key, job);
    // A recipe that could not be made can be asked for again.
    void job.then((made) => { if (!made) v.recipes.delete(key); });
  }
  return job;
}

// -- the actions ------------------------------------------------------------------------

async function lookUp(v: Visit, foods: FoodAsk[]): Promise<Outcome> {
  const { advisor } = v;
  if (!foods.length) return { view: advisor.view(), kind: 'failed', text: said.noFood() };
  const ticket = advisor.begin();
  const before = new Set(advisor.shelf.map((r) => r.product_name.toLowerCase()));
  // A food already looked at comes back as it was (same figures, no second call), unless they said how much this time.
  const cards = await Promise.all(foods.map(async (f) => (f.quantity ? null : advisor.cardFor(f.name)) ?? cardForFood(f)));
  // Cleared while the cards were being made: they never come back.
  if (!advisor.current(ticket)) return { view: advisor.view(), kind: 'failed', text: said.clearedMeanwhile(list(foods.map(asked))) };
  const put: NutritionData[] = [];
  const missing: string[] = [];
  let front = false;
  cards.forEach((card, i) => {
    if (!card) return void missing.push(asked(foods[i]));
    // The card as the table now holds it: the one just shown, or the newer figures that kept their place.
    const placed = advisor.place(card, ticket);
    if (placed.front) front = true;
    put.push(placed.card);
  });
  const notice = missing.length ? `Couldn't find ${missing.join(' or ')} just now. Try again in a moment, or ask about another food.` : undefined;
  if (!put.length) return { view: advisor.view(), kind: 'failed', text: said.lookupFailed(missing), notice };
  // Overtaken by a card asked for later: these joined the table behind it (or
  // were that very food, whose newer figures stand).
  if (!front) {
    const shown = advisor.nutrition;
    const filed = put.filter((c) => c.product_name !== shown?.product_name);
    const text = filed.length || !shown ? said.filed(filed.length ? filed : put, shown?.product_name ?? '') : said.cards([shown], [], true);
    return { view: advisor.view(), kind: 'card', card: false, text, notice };
  }
  const names = put.map((c) => c.product_name);
  const others = advisor.shelf.map((r) => r.product_name).filter((name) => !names.includes(name));
  const again = names.every((name) => before.has(name.toLowerCase()));
  return { view: advisor.view(), kind: 'card', card: true, text: said.cards(put, others, again, missing), notice };
}

async function compare(v: Visit, foods: FoodAsk[]): Promise<Outcome> {
  const { advisor } = v;
  const ticket = advisor.begin();
  const before = advisor.nutrition?.product_name ?? '';
  // Only what the table lacks goes up: "compare it with an apple" is a request to display the apple.
  const needed = foods.filter((f) => f.quantity || !advisor.onShelf(f.name));
  const cards = await Promise.all(needed.map((f) => cardForFood(f)));
  if (!advisor.current(ticket)) return { view: advisor.view(), kind: 'failed', text: said.clearedMeanwhile(list(foods.map(asked))) };
  const put: string[] = [];
  const missing: string[] = [];
  let front = false;
  cards.forEach((card, i) => {
    if (!card) return void missing.push(asked(needed[i]));
    const placed = advisor.place(card, ticket);
    if (placed.front) front = true;
    put.push(placed.card.product_name);
  });
  const notice = missing.length ? `Couldn't find ${missing.join(' or ')} just now. Try again in a moment, or ask about another food.` : undefined;
  // "It" is the card that was up; the foods named are the rest. No foods named ("compare them"): the whole table.
  const named = foods
    .map((f) => advisor.shelf.find((r) => sameFood(r.product_name, f.name))?.product_name ?? put.find((p) => sameFood(p, f.name)))
    .filter((name): name is string => Boolean(name));
  const wanted = new Set(foods.length ? [...(foods.length < 2 && before ? [before] : []), ...named, ...put] : advisor.shelf.map((r) => r.product_name));
  let rows = advisor.shelf.filter((r) => wanted.has(r.product_name));
  if (rows.length < 2) {
    // A food that could not be found leaves nothing to compare it with: say so, never a verdict on something else.
    if (missing.length) return { view: advisor.view(), kind: 'failed', text: said.lookupFailed(missing), notice };
    const card = advisor.nutrition;
    if (!card) return { view: advisor.view(), kind: 'failed', text: said.noFood() };
    // Nothing to compare against yet: it is a card like any other.
    if (advisor.shelf.length < 2) return { view: advisor.view(), kind: 'card', card: front, text: said.cards([card], [], put.length === 0), notice };
    rows = advisor.shelf;
  }
  return { view: advisor.view(), kind: 'compare', card: front, text: said.compare(rows, put, advisor.shelf.length, missing), notice };
}

/** Open a recipe: the kept copy, the one made ahead, or a new one. `talk`: the host will walk it through (a tool), not a tap. */
async function openRecipe(v: Visit, idea: RecipeIdea, talk: boolean): Promise<Outcome> {
  const { advisor } = v;
  const ticket = advisor.begin();
  const food = advisor.nutrition?.product_name ?? '';
  const kept = advisor.reopen(idea.name, idea.description, ticket);
  let recipe = kept;
  if (!recipe) {
    const full = { name: idea.name, description: idea.description || advisor.suggestedDescription(idea.name) };
    const made = advisor.preparedFor(idea.name) ?? (await recipeJob(v, full, food));
    // Cleared, or overtaken by a newer card, while it was being made: it does not cover what is there now.
    if (!advisor.current(ticket)) return { view: advisor.view(), kind: 'failed', text: said.clearedMeanwhile(`the recipe “${idea.name}”`) };
    if (!made) return { view: advisor.view(), kind: 'failed', text: said.recipeFailed(idea.name), notice: `Couldn't open the recipe “${idea.name}” just now. Try again in a moment.` };
    // Titled with the name the user chose, whatever the model called it.
    recipe = advisor.open({ ...made, recipe_name: idea.name, description: full.description }, ticket);
    if (!recipe) return { view: advisor.view(), kind: 'failed', text: said.recipeOvertaken(idea.name, advisor.nutrition?.product_name ?? 'a newer card') };
  }
  const text = talk ? said.recipe(recipe, food, started(recipe.preparation_steps.length)) : said.recipeTapped(recipe);
  return { view: advisor.view(), kind: kept ? 'kept' : 'recipe', recipe, text };
}

/** Make the card's recipe ideas ahead, so opening one is instant. */
async function prepare(v: Visit): Promise<Outcome> {
  const { advisor } = v;
  const food = advisor.nutrition?.product_name ?? '';
  const ticket = advisor.begin();
  if (llmAvailable() && food) {
    await Promise.all(advisor.ideasToPrepare().map(async (idea) => {
      const made = await recipeJob(v, idea, food);
      if (made) advisor.prepare(food, made, ticket);
    }));
  }
  return { view: advisor.view(), kind: 'prepared', text: '' };
}

function photo(v: Visit, image: Image, sample: boolean): Promise<Outcome> {
  // The photo's place in line is when it was added, not when it is read.
  const ticket = v.advisor.begin();
  return v.photos(async () => {
    const reading = await readPhoto(image, sample);
    const { advisor } = v;
    if (!advisor.current(ticket)) return { view: advisor.view(), kind: 'failed', text: said.clearedMeanwhile('the photo') };
    if ('card' in reading) {
      const placed = advisor.place(reading.card, ticket);
      if (!placed.front) {
        const shown = advisor.nutrition;
        const text = shown && placed.card.product_name === shown.product_name ? said.cards([shown], [], true) : said.filed([placed.card], shown?.product_name ?? '');
        return { view: advisor.view(), kind: 'photo', card: false, text };
      }
      return { view: advisor.view(), kind: 'photo', card: true, text: said.photo(placed.card, reading.seen, sample, placed.others) };
    }
    if ('notFood' in reading) return { view: advisor.view(), kind: 'failed', text: said.notFood(reading.notFood), notice: "That photo doesn't look like a food or a food label. Try another, or just name the food." };
    if ('noVision' in reading) return { view: advisor.view(), kind: 'failed', text: said.noVision(), notice: "Photo reading isn't available right now. Name the food instead and its card comes up." };
    return { view: advisor.view(), kind: 'failed', text: said.photoFailed(), notice: "That photo couldn't be read. Try a sharper one, or just name the food." };
  });
}

async function sample(v: Visit): Promise<Outcome> {
  let bytes: Buffer;
  try {
    bytes = await readFile(SAMPLE);
  } catch (err) {
    warn('reading the sample photo', err);
    return { view: v.advisor.view(), kind: 'failed', text: '', notice: `Our salmon plate photo didn't load: ${SAMPLE_FAILED}.` };
  }
  return photo(v, { mimeType: 'image/jpeg', base64: bytes.toString('base64') }, true);
}

function startOver(v: Visit): Outcome {
  v.advisor.reset();
  return { view: v.advisor.view(), kind: 'cleared', text: said.cleared() };
}

/** The host's tools the server answers: what each did, as the words the host speaks from. */
async function run(v: Visit, name: string, args: Record<string, unknown>, open: string | null): Promise<Outcome> {
  switch (name) {
    case 'look_up_food': return lookUp(v, foodsFrom(foodsArg(args)));
    case 'compare_foods': return compare(v, foodsFrom(foodsArg(args)));
    case 'open_recipe': {
      const ctx = { ideas: v.advisor.nutrition?.recipes ?? [], kept: v.advisor.recipes.map((r) => r.recipe_name), openRecipe: open };
      const idea = resolveRecipe(text(args.recipe ?? args.name ?? args.dish ?? args.recipe_name, 80), ctx);
      if (!idea) return { view: v.advisor.view(), kind: 'failed', text: said.whichRecipe() };
      return openRecipe(v, idea, true);
    }
    case 'start_over': return startOver(v);
  }
  throw new Error(`unknown tool ${name}`);
}

// -- the request bodies, checked ------------------------------------------------------

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** The foods a call names, under whichever name the host gave them. */
const foodsArg = (args: Record<string, unknown>) => args.foods ?? args.food ?? args.items ?? args.name;

function imageOf(value: unknown): Image | null {
  const v = value as Partial<Image> | null;
  if (!v || typeof v.mimeType !== 'string' || typeof v.base64 !== 'string') return null;
  if (!IMAGE_TYPES.has(v.mimeType) || !v.base64 || v.base64.length > MAX_IMAGE_BASE64) return null;
  return { mimeType: v.mimeType, base64: v.base64 };
}

const app: AppServer = {
  id: ID,
  title: 'Morsel',
  tagline: 'Ask about any food: Rachel, a friendly nutritionist, shows you what is in it.',
  brand: { color: '#c8341e', ink: '#ffffff' },
  maxSeconds: 900,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
  routes(router) {
    router.post('/visits', (_req, res) => {
      const id = randomBytes(9).toString('hex');
      const v: Visit = { advisor: new Advisor(), photos: serial(), recipes: new Map(), at: Date.now() };
      visits.set(id, v);
      for (const [key, old] of visits) if (Date.now() - old.at > 3 * 3600_000) visits.delete(key);
      res.json({ id, view: v.advisor.view(), opening: said.start() });
    });

    // The host's tool calls: the result is what it says next.
    router.post('/visits/:id/tool', async (req, res) => {
      const v = visits.get(req.params.id);
      if (!v) return void res.status(404).json({ error: 'no_visit' });
      v.at = Date.now();
      // `open`: the recipe open on the page, which "walk me through it" means.
      const { name, arguments: args, open } = (req.body ?? {}) as { name?: string; arguments?: Record<string, unknown>; open?: unknown };
      if (!name || !SERVER_TOOLS.has(name)) return void res.status(400).json({ error: 'unknown_tool' });
      res.json(await run(v, name, args && typeof args === 'object' ? args : {}, text(open, 60) || null));
    });

    // The user's buttons: they act at once, and the host is told (it cannot see the screen).
    router.post('/visits/:id/act', async (req, res) => {
      const v = visits.get(req.params.id);
      if (!v) return void res.status(404).json({ error: 'no_visit' });
      v.at = Date.now();
      const body = (req.body ?? {}) as Record<string, unknown>;
      switch (body.command) {
        case 'lookup': {
          const foods = foodsFrom(body.food);
          if (!foods.length) return void res.status(400).json({ error: 'no_food' });
          const done = await lookUp(v, foods);
          return void res.json({ ...done, text: pressed(asked(foods[0]), done.text) });
        }
        case 'recipe': {
          const name = text(body.name, 60);
          if (!name) return void res.status(400).json({ error: 'no_recipe' });
          const done = await openRecipe(v, { name, description: text(body.description, 200) }, false);
          return void res.json({ ...done, text: pressed(`Open recipe: ${name}`, done.text) });
        }
        case 'photo': {
          const image = imageOf(body.image);
          if (!image) return void res.status(400).json({ error: 'bad_image' });
          return void res.json(await photo(v, image, false));
        }
        case 'sample':
          return void res.json(await sample(v));
        case 'prepare':
          return void res.json(await prepare(v));
        case 'start_over': {
          const done = startOver(v);
          return void res.json({ ...done, text: pressed('Start over', done.text) });
        }
        default:
          return void res.status(400).json({ error: 'unknown_command' });
      }
    });

    // The sample photo, so the board can show what is being read.
    router.get('/sample.jpg', async (_req, res) => {
      try {
        const bytes = await readFile(SAMPLE);
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.end(bytes);
      } catch {
        res.status(404).end();
      }
    });
  },
};

export default app;
