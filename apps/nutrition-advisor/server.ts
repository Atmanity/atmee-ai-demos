// Nutrition Advisor's server side: the app's own model calls (a card for a
// named food, a card from a photo, a recipe's steps, and what an utterance asks
// for) and each session's one writer (engine/advisor.ts). Nothing here is
// secret from the page; it runs on the server because the model key does.
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { Advisor, recipeKey, sameFood } from './engine/advisor.ts';
import { bounded, serial } from './engine/bounded.ts';
import { CARD_SCHEMA, CARD_SYSTEM, cardFrom, cardPrompt, PHOTO_PROMPT, PHOTO_SCHEMA, RECIPE_SCHEMA, RECIPE_SYSTEM, recipeFrom, recipePrompt } from './engine/card.ts';
import { SAMPLE_FAILED, say } from './engine/director.ts';
import { builtInCard, SAMPLE_CARD } from './engine/fallback.ts';
import { bareFood, contextFor, intentFrom, JUDGE_SCHEMA, JUDGE_SYSTEM, judgePrompt, ruleIntent, type JudgeContext } from './engine/judge.ts';
import type { ActRequest, FoodAsk, How, Image, Intent, NutritionData, Outcome, RecipeDetails, RecipeIdea, Screen } from './engine/types.ts';

const ID = 'nutrition-advisor';

// Every model call has a deadline (engine/bounded.ts says why).
const JUDGE_MS = 8_000;
const CARD_MS = 25_000;
const PHOTO_MS = 40_000;
const RECIPE_MS = 25_000;

const SAMPLE = new URL('./samples/meal.jpg', import.meta.url);
const SAMPLE_SEEN = 'grilled salmon with rice, broccoli and green beans';
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGE_BASE64 = 6 * 1024 * 1024;

interface Session {
  advisor: Advisor;
  /** Photos are read one at a time. */
  photos: ReturnType<typeof serial>;
  /** Recipes being made, so a tap during the make-ahead waits for it instead of paying twice. */
  recipes: Map<string, Promise<RecipeDetails | null>>;
  at: number;
}
const sessions = new Map<string, Session>();

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

function recipeJob(s: Session, idea: RecipeIdea, food: string): Promise<RecipeDetails | null> {
  const key = `${food.toLowerCase()}\u0000${recipeKey(idea.name)}`;
  let job = s.recipes.get(key);
  if (!job) {
    job = makeRecipe(idea, food);
    s.recipes.set(key, job);
    // A recipe that could not be made can be asked for again.
    void job.then((made) => { if (!made) s.recipes.delete(key); });
  }
  return job;
}

// -- what the user asked for ---------------------------------------------------------

function contextOf(advisor: Advisor, screen: Screen | undefined, lastAvatarLine: unknown): JudgeContext {
  const open = typeof screen?.recipe === 'string' ? screen.recipe.slice(0, 60) : null;
  return contextFor(advisor.view(), open, typeof lastAvatarLine === 'string' ? lastAvatarLine : '');
}

async function judge(text: string, how: How, ctx: JudgeContext): Promise<{ intent: Intent; by: string }> {
  const rule = ruleIntent(text, ctx);
  if (rule) return { intent: rule, by: 'rules' };
  if (llmAvailable()) {
    try {
      const raw = await bounded(structured({ system: JUDGE_SYSTEM, user: judgePrompt(text, ctx), schema: JUDGE_SCHEMA, temperature: 0 }), JUDGE_MS, 'the judge');
      return { intent: intentFrom(raw, ctx), by: 'model' };
    } catch (err) {
      warn('judging', err);
    }
  }
  return { intent: (how === 'typed' && bareFood(text)) || { kind: 'none' }, by: 'fallback' };
}

// -- acting on it ---------------------------------------------------------------------

async function lookup(s: Session, foods: FoodAsk[], said: string | undefined, how: How): Promise<Outcome> {
  const { advisor } = s;
  const before = new Set(advisor.shelf.map((r) => r.product_name.toLowerCase()));
  // A food already looked at comes back as it was (same figures, no second call), unless they said how much this time.
  const cards = await Promise.all(foods.map(async (f) => (f.quantity ? null : advisor.cardFor(f.name)) ?? cardForFood(f)));
  const put: string[] = [];
  const missing: string[] = [];
  cards.forEach((card, i) => {
    if (!card) return void missing.push(foods[i].name);
    advisor.show(card);
    put.push(card.product_name);
  });
  const notice = missing.length ? `Couldn't pull up ${missing.join(', ')} just now. Try again in a moment.` : undefined;
  if (!put.length) return { view: advisor.view(), kind: 'failed', event: say.lookupFailed(missing, said, how), ttl: 20, notice };
  const others = advisor.shelf.map((r) => r.product_name).filter((name) => !put.includes(name));
  const again = put.every((name) => before.has(name.toLowerCase()));
  return { view: advisor.view(), kind: 'card', card: true, event: say.card(put, others, said, how, again), ttl: 30, notice };
}

async function compare(s: Session, foods: FoodAsk[], said: string | undefined, how: How): Promise<Outcome> {
  const { advisor } = s;
  const before = advisor.nutrition?.product_name ?? '';
  // Only what the table lacks goes up: "compare it with an apple" is a request to display the apple.
  const needed = foods.filter((f) => f.quantity || !advisor.onShelf(f.name));
  const cards = await Promise.all(needed.map((f) => cardForFood(f)));
  const put: string[] = [];
  const missing: string[] = [];
  cards.forEach((card, i) => {
    if (!card) return void missing.push(needed[i].name);
    advisor.show(card);
    put.push(card.product_name);
  });
  const notice = missing.length ? `Couldn't pull up ${missing.join(', ')} just now. Try again in a moment.` : undefined;
  if (missing.length && !put.length) return { view: advisor.view(), kind: 'failed', event: say.lookupFailed(missing, said, how), ttl: 20, notice };
  // "It" is the card that was up; the foods named are the rest.
  const named = foods
    .map((f) => advisor.shelf.find((r) => sameFood(r.product_name, f.name))?.product_name ?? put.find((p) => sameFood(p, f.name)))
    .filter((name): name is string => Boolean(name));
  const compared = [...new Set([...(foods.length < 2 && before ? [before] : []), ...named, ...put])];
  if (advisor.shelf.length < 2) {
    // Nothing to compare against yet: it is a card like any other.
    return { view: advisor.view(), kind: 'card', card: put.length > 0, event: say.card(put, [], said, how), ttl: 30, notice };
  }
  return { view: advisor.view(), kind: 'compare', card: put.length > 0, event: say.compare(put, compared, advisor.shelf.length, said, how), ttl: 30, notice };
}

async function openRecipe(s: Session, name: string, description: string, said: string | undefined, how: How): Promise<Outcome> {
  const { advisor } = s;
  const kept = advisor.reopen(name, description);
  if (kept) return { view: advisor.view(), kind: 'kept', recipe: kept, event: say.kept(kept.recipe_name, said, how), ttl: 25 };
  const food = advisor.nutrition?.product_name ?? '';
  const idea = { name, description: description || advisor.suggestedDescription(name) };
  const made = advisor.preparedFor(name) ?? (await recipeJob(s, idea, food));
  if (!made) return { view: advisor.view(), kind: 'failed', event: say.recipeFailed(name), ttl: 25 };
  // Titled with the name the user chose, whatever the model called it.
  const opened = advisor.open({ ...made, recipe_name: name, description: idea.description });
  return { view: advisor.view(), kind: 'recipe', recipe: opened, event: say.recipe(name, said, how), ttl: 30 };
}

/** Make the card's recipe ideas ahead, so a spoken "how do I make the parfait?" gets the real recipe at once. */
async function prepare(s: Session): Promise<Outcome> {
  const { advisor } = s;
  const food = advisor.nutrition?.product_name ?? '';
  if (llmAvailable() && food) {
    await Promise.all(advisor.ideasToPrepare().map(async (idea) => {
      const made = await recipeJob(s, idea, food);
      if (made) advisor.prepare(food, made);
    }));
  }
  return { view: advisor.view(), kind: 'prepared' };
}

function photo(s: Session, image: Image, sample: boolean): Promise<Outcome> {
  return s.photos(async () => {
    const reading = await readPhoto(image, sample);
    const { advisor } = s;
    if ('card' in reading) {
      const others = advisor.show(reading.card);
      return { view: advisor.view(), kind: 'photo', card: true, event: say.photo(reading.card, reading.seen, sample, others), ttl: 45 };
    }
    if ('notFood' in reading) return { view: advisor.view(), kind: 'failed', event: say.notFood(reading.notFood), ttl: 20, notice: "That photo doesn't look like a food or a food label. Try another, or just name the food." };
    if ('noVision' in reading) return { view: advisor.view(), kind: 'failed', event: say.noVision(), ttl: 20, notice: 'Reading photos needs the app’s model (GEMINI_API_KEY is not set). Name the food instead.' };
    return { view: advisor.view(), kind: 'failed', event: say.photoFailed(), ttl: 20, notice: 'That photo could not be read. Try another, or just name the food.' };
  });
}

async function sample(s: Session): Promise<Outcome> {
  let bytes: Buffer;
  try {
    bytes = await readFile(SAMPLE);
  } catch (err) {
    warn('reading the sample photo', err);
    return { view: s.advisor.view(), kind: 'failed', notice: `The sample did not load — ${SAMPLE_FAILED}.` };
  }
  return photo(s, { mimeType: 'image/jpeg', base64: bytes.toString('base64') }, true);
}

// -- the request bodies, checked ------------------------------------------------------

const howOf = (value: unknown): How => (value === 'spoken' || value === 'typed' ? value : 'button');
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function foodsOf(value: unknown): FoodAsk[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((f) => ({ name: text(f?.name, 60), quantity: text(f?.quantity, 40) }))
    .filter((f) => f.name)
    .slice(0, 3);
}

function imageOf(value: unknown): Image | null {
  const v = value as Partial<Image> | null;
  if (!v || typeof v.mimeType !== 'string' || typeof v.base64 !== 'string') return null;
  if (!IMAGE_TYPES.has(v.mimeType) || !v.base64 || v.base64.length > MAX_IMAGE_BASE64) return null;
  return { mimeType: v.mimeType, base64: v.base64 };
}

const app: AppServer = {
  id: ID,
  title: 'Nutrition Advisor',
  tagline: 'Name a food or share a photo of one: its card, a side-by-side table, and recipes talked through.',
  maxSeconds: 900,
  routes(router) {
    router.post('/sessions', (_req, res) => {
      const id = randomBytes(9).toString('hex');
      const s: Session = { advisor: new Advisor(), photos: serial(), recipes: new Map(), at: Date.now() };
      sessions.set(id, s);
      for (const [key, old] of sessions) if (Date.now() - old.at > 3 * 3600_000) sessions.delete(key);
      res.json({ id, outcome: { view: s.advisor.view(), event: say.start(), ttl: 60 } satisfies Outcome });
    });

    // What an utterance asks for. Separate from acting on it, so the page can
    // show the user's line and what the app is doing while a card is made.
    router.post('/sessions/:id/judge', async (req, res) => {
      const s = sessions.get(req.params.id);
      if (!s) return void res.status(404).json({ error: 'no_session' });
      s.at = Date.now();
      const said = text(req.body?.text, 500);
      if (!said) return void res.json({ intent: { kind: 'none' }, by: 'rules' });
      const ctx = contextOf(s.advisor, req.body?.screen, req.body?.lastAvatarLine);
      res.json(await judge(said, howOf(req.body?.how), ctx));
    });

    router.post('/sessions/:id/act', async (req, res) => {
      const s = sessions.get(req.params.id);
      if (!s) return void res.status(404).json({ error: 'no_session' });
      s.at = Date.now();
      const body = req.body as Partial<ActRequest>;
      const action = body.action;
      const how = howOf(body.how);
      const said = text(body.said, 500) || undefined;
      switch (action?.kind) {
        case 'lookup':
        case 'compare': {
          const foods = foodsOf(action.foods);
          if (!foods.length) return void res.status(400).json({ error: 'no_food' });
          return void res.json(action.kind === 'lookup' ? await lookup(s, foods, said, how) : await compare(s, foods, said, how));
        }
        case 'recipe': {
          const name = text(action.name, 60);
          if (!name) return void res.status(400).json({ error: 'no_recipe' });
          return void res.json(await openRecipe(s, name, text(action.description, 200), said, how));
        }
        case 'photo': {
          const image = imageOf(action.image);
          if (!image) return void res.status(400).json({ error: 'bad_image' });
          return void res.json(await photo(s, image, false));
        }
        case 'sample':
          return void res.json(await sample(s));
        case 'prepare':
          return void res.json(await prepare(s));
        default:
          return void res.status(400).json({ error: 'nothing_to_do' });
      }
    });

    // The sample photo, so the panel can show what is being read.
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
