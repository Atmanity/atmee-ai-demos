// The server's routes end to end, with the model call replaced by a fake: what
// each tool puts on the table and returns for the host to speak from, what a
// button tells the host, how many model calls each step costs, and what
// happens without a model or when it fails. No network beyond this machine.
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  available: true,
  calls: [] as { system: string; user: string; schema: unknown; images?: unknown[] }[],
  respond: (_req: { user: string; schema: unknown }): unknown => null,
  delay: 0,
  live: 0,
  maxLive: 0,
}));

vi.mock('../../server/llm.ts', () => ({
  llmAvailable: () => fake.available,
  structured: async (req: { system: string; user: string; schema: unknown; images?: unknown[] }) => {
    fake.calls.push(req);
    fake.live += 1;
    fake.maxLive = Math.max(fake.maxLive, fake.live);
    try {
      if (fake.delay) await new Promise((r) => setTimeout(r, fake.delay));
      return fake.respond(req);
    } finally {
      fake.live -= 1;
    }
  },
}));

import { CARD_SCHEMA, PHOTO_SCHEMA, RECIPE_SCHEMA } from './engine/card.ts';
import type { Outcome } from './engine/types.ts';
import app from './server.ts';

const cardJson = (name: string, over: Record<string, unknown> = {}) => ({
  product_name: `Medium ${name}`,
  serving_size: '1 medium',
  calories: name === 'apple' ? 95 : 105,
  protein_g: 1, carbs_g: 25, fat_g: 0.3, fiber_g: 3, sugar_g: 14, sodium_mg: 1,
  health_score: 9,
  health_summary: `A ${name}.`,
  recipes: [
    { name: `${name} smoothie`, description: 'Blend it.' },
    { name: `${name} bread`, description: 'Bake it.' },
    { name: `${name} oats`, description: 'Stir it in.' },
  ],
  ...over,
});

let photoJson: Record<string, unknown> = {};

function model(req: { user: string; schema: unknown }): unknown {
  if (req.schema === CARD_SCHEMA) return cardJson(/asked about: "([^"]+)"/.exec(req.user)![1]);
  if (req.schema === RECIPE_SCHEMA) return { ingredients: ['1 banana', '200 ml milk'], preparation_steps: ['1. **Peel** it', 'Blend it', 'Pour it'] };
  if (req.schema === PHOTO_SCHEMA) return photoJson;
  throw new Error('unexpected schema');
}

const calls = (schema: unknown) => fake.calls.filter((c) => c.schema === schema).length;

let server: Server;
let base = '';

beforeAll(async () => {
  const web = express();
  web.use(express.json({ limit: '8mb' }));
  const router = express.Router();
  app.routes!(router);
  web.use('/api', router);
  server = web.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => { server.close(); });

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // the failures below are on purpose
  Object.assign(fake, { available: true, calls: [], respond: model, delay: 0, live: 0, maxLive: 0 });
  photoJson = { is_food: true, seen: 'a carton of oat milk', source: 'label', portion_assumed: false, ...cardJson('oat milk', { product_name: 'Oat milk', serving_size: '240 ml' }) };
});

async function post<T = Outcome>(path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
}

async function open() {
  const { body } = await post<{ id: string; view: Outcome['view']; opening: string }>('/visits');
  const tool = (name: string, args: Record<string, unknown> = {}, openRecipe: string | null = null) => post(`/visits/${body.id}/tool`, { name, arguments: args, open: openRecipe });
  const act = (command: string, more: Record<string, unknown> = {}) => post(`/visits/${body.id}/act`, { command, ...more });
  return { id: body.id, first: body, tool, act };
}

describe('a visit', () => {
  it('opens on an empty table, with the opening for the host', async () => {
    const { first } = await open();
    expect(first.view.nutrition).toBeNull();
    expect(first.view.shelf.items).toEqual([]);
    expect(first.opening).toMatch(/name any food, or to add a photo/);
  });

  it('an unknown visit, tool or command is refused, not guessed at', async () => {
    const { tool, act } = await open();
    expect((await post('/visits/nope/tool', { name: 'look_up_food', arguments: { foods: ['banana'] } })).status).toBe(404);
    expect((await tool('next_steps')).status).toBe(400);   // the page answers that one itself
    expect((await tool('dance')).status).toBe(400);
    expect((await act('dance')).status).toBe(400);
    expect((await act('lookup', { food: 'it' })).status).toBe(400);
    expect((await act('photo', { image: { mimeType: 'text/html', base64: 'eA==' } })).status).toBe(400);
  });
});

describe('look_up_food', () => {
  it('puts a card up, an estimate for an assumed portion, and returns its figures', async () => {
    const { tool } = await open();
    const { body } = await tool('look_up_food', { foods: ['a banana'] });
    expect(body.kind).toBe('card');
    expect(body.card).toBe(true);
    expect(body.view.nutrition).toMatchObject({ product_name: 'Medium banana', source: 'estimate', portion_assumed: true });
    expect(body.text).toMatch(/^Done: on screen now, the nutrition card for "Medium banana"/);
    expect(body.text).toContain('105 calories');
    expect(calls(CARD_SCHEMA)).toBe(1);
  });

  it('a stated quantity is not an assumed portion', async () => {
    const { tool } = await open();
    const { body } = await tool('look_up_food', { foods: ['200 g of chicken breast'] });
    expect(body.view.nutrition?.portion_assumed).toBe(false);
    expect(fake.calls[0].user).toMatch(/asked about: "chicken breast", and said how much: "200 g"/);
  });

  it('a food already looked at comes back without a second model call, back rather than new', async () => {
    const { tool } = await open();
    await tool('look_up_food', { foods: ['banana'] });
    await tool('look_up_food', { foods: ['apple'] });
    const { body } = await tool('look_up_food', { foods: ['banana'] });
    expect(body.view.nutrition?.product_name).toBe('Medium banana');
    expect(body.view.shelf.items.map((r) => r.product_name)).toEqual(['Medium banana', 'Medium apple']);
    expect(calls(CARD_SCHEMA)).toBe(2);
    expect(body.text).toMatch(/^Done: back on screen, [^]*It was already in the comparison table, with "Medium apple"/);
  });

  it('a stated amount of a food already on screen is said with its own figures, not the earlier portion\'s', async () => {
    const { tool } = await open();
    fake.respond = (req) => /said how much: "large"/.test(req.user)
      ? cardJson('banana', { product_name: 'Large banana', serving_size: '1 large (136 g)', calories: 121 })
      : model(req);
    await tool('look_up_food', { foods: ['banana'] });
    const { body } = await tool('look_up_food', { foods: ['a large banana'] });
    expect(body.view.nutrition?.product_name).toBe('Large banana');
    expect(body.text).toContain('the nutrition card for "Large banana"');
    expect(body.text).toContain('121 calories');
    expect(body.text).not.toContain('105 calories');
  });

  describe('a card is a food at a portion', () => {
    const chicken = (req: { user: string; schema: unknown }) => {
      if (req.schema !== CARD_SCHEMA || !/chicken/.test(req.user)) return model(req);
      return /said how much: "200 g"/.test(req.user)
        ? cardJson('chicken', { product_name: 'Chicken breast', serving_size: '200 g', calories: 330 })
        : cardJson('chicken', { product_name: 'Chicken breast', serving_size: '1 breast (120 g)', calories: 198 });
    };
    const rows = (body: Outcome) => body.view.shelf.items.map((r) => [r.product_name, r.serving_size, r.calories]);

    it('two portions are two rows; a later plain ask brings back the usual one with no model call', async () => {
      const { tool } = await open();
      fake.respond = chicken;
      await tool('look_up_food', { foods: ['chicken breast'] });
      const { body } = await tool('look_up_food', { foods: ['200 g chicken breast'] });
      expect(body.text).toContain('330 calories');
      expect(body.text).not.toContain('198 calories');
      expect(rows(body)).toEqual([['Chicken breast', '1 breast (120 g)', 198], ['Chicken breast', '200 g', 330]]);
      expect(body.view.shelf).toMatchObject({ current: 'Chicken breast', current_serving: '200 g' });
      const plain = await tool('look_up_food', { foods: ['chicken breast'] });
      expect(plain.body.view.nutrition?.calories).toBe(198);
      expect(calls(CARD_SCHEMA)).toBe(2);
    });

    it('the stated portion first: the plain ask after it is looked up once, then reused', async () => {
      const { tool } = await open();
      fake.respond = chicken;
      await tool('look_up_food', { foods: ['200 g chicken breast'] });
      await tool('look_up_food', { foods: ['chicken breast'] });
      const again = await tool('look_up_food', { foods: ['chicken breast'] });
      expect(again.body.view.nutrition?.calories).toBe(198);
      expect(calls(CARD_SCHEMA)).toBe(2);
    });

    it('comparing a stated portion with another food is those two rows, not every portion', async () => {
      const { tool } = await open();
      fake.respond = chicken;
      await tool('look_up_food', { foods: ['chicken breast'] });
      const { body } = await tool('compare_foods', { foods: ['200 g chicken breast', 'an apple'] });
      expect(body.kind).toBe('compare');
      expect(body.text).toContain('Chicken breast, 200 g: 330 cal');
      expect(body.text).toContain('Medium apple, 1 medium: 95 cal');
      expect(body.text).not.toContain('198 cal');
    });

    it('comparing two portions of one food is exactly those two', async () => {
      const { tool } = await open();
      fake.respond = chicken;
      await tool('look_up_food', { foods: ['apple'] });
      await tool('look_up_food', { foods: ['chicken breast'] });
      const { body } = await tool('compare_foods', { foods: ['chicken breast', '200 g chicken breast'] });
      expect(body.text).toContain('Chicken breast, 1 breast (120 g): 198 cal');
      expect(body.text).toContain('Chicken breast, 200 g: 330 cal');
      expect(body.text).not.toMatch(/Side by side[^]*Medium apple, 1 medium: 95 cal[^]*Give a one-line verdict/);
    });
  });

  it('two foods at once: both up, each with its figures', async () => {
    const { tool } = await open();
    const { body } = await tool('look_up_food', { foods: ['a banana and an apple'] });
    expect(body.view.shelf.items).toHaveLength(2);
    expect(body.text).toMatch(/cards for "Medium banana" and "Medium apple"/);
  });

  it('a card the model could not make is said, with a notice, never silence; a common food still has its own', async () => {
    const { tool } = await open();
    fake.respond = () => { throw new Error('quota'); };
    const { body } = await tool('look_up_food', { foods: ['dragon fruit'] });
    expect(body.kind).toBe('failed');
    expect(body.text).toMatch(/could not pull up "dragon fruit"/);
    expect(body.notice).toMatch(/Couldn't find dragon fruit/);
    const banana = await tool('look_up_food', { foods: ['banana'] });
    expect(banana.body.view.nutrition?.product_name).toBe('Medium banana');
  });

  it('takes the call however the host words it: any case, "food" for "foods", a lone string, extra fields', async () => {
    const { tool } = await open();
    const capital = await tool('look_up_food', { food: 'A BANANA', mood: 'hungry' });
    expect(capital.body.kind).toBe('card');
    expect(capital.body.view.nutrition?.product_name).toBe('Medium banana');
    const lone = await tool('compare_foods', { foods: 'An Apple', reason: 'sugar' });
    expect(lone.body.kind).toBe('compare');
    const recipe = await tool('open_recipe', { name: 'The First One', why: 'dinner' });
    expect(recipe.body.kind).toBe('recipe');
    expect(recipe.body.recipe?.recipe_name).toBe('apple smoothie');
  });

  it('only a pointer is no food: nothing changes, and the host asks', async () => {
    const { tool } = await open();
    const { body } = await tool('look_up_food', { foods: ['it'] });
    expect(body.kind).toBe('failed');
    expect(body.text).toMatch(/Ask which food they mean/);
    expect(fake.calls).toEqual([]);
  });
});

describe('compare_foods', () => {
  it('only what the table lacks goes up, and the rows come back side by side', async () => {
    const { tool } = await open();
    await tool('look_up_food', { foods: ['banana'] });
    const { body } = await tool('compare_foods', { foods: ['an apple'] });
    expect(body.kind).toBe('compare');
    expect(body.view.shelf.items.map((r) => r.product_name)).toEqual(['Medium banana', 'Medium apple']);
    expect(body.view.shelf.current).toBe('Medium apple');
    expect(body.text).toContain('Medium banana, 1 medium: 105 cal');
    expect(body.text).toContain('Medium apple, 1 medium: 95 cal');
    expect(body.text).toContain('Looked up for this: "Medium apple"');
    expect(calls(CARD_SCHEMA)).toBe(2);
    const again = await tool('compare_foods', { foods: ['banana', 'apple'] });
    expect(again.body.text).not.toContain('Looked up for this');
    expect(calls(CARD_SCHEMA)).toBe(2);
  });

  it('with nothing to compare against yet, it is a card', async () => {
    const { tool } = await open();
    const { body } = await tool('compare_foods', { foods: ['an apple'] });
    expect(body.kind).toBe('card');
    expect(body.text).toContain('the nutrition card for "Medium apple"');
  });

  it('a food that could not be found is said, never a verdict on something else', async () => {
    const { tool } = await open();
    await tool('look_up_food', { foods: ['banana', 'apple'] });
    fake.respond = () => { throw new Error('quota'); };
    const { body } = await tool('compare_foods', { foods: ['dragon fruit'] });
    expect(body.kind).toBe('failed');
    expect(body.text).toMatch(/could not pull up "dragon fruit"/);
    expect(body.text).not.toMatch(/verdict/);
  });

  it('"compare them" with the table full compares the table', async () => {
    const { tool } = await open();
    await tool('look_up_food', { foods: ['banana', 'apple'] });
    const { body } = await tool('compare_foods', { foods: ['them'] });
    expect(body.kind).toBe('compare');
    expect(body.text).toMatch(/Medium banana[^]*Medium apple/);
  });
});

describe('recipes', () => {
  it('are made ahead for the card, then open at once under the name the card gives, first steps lit', async () => {
    const { tool, act } = await open();
    await tool('look_up_food', { foods: ['banana'] });
    const prepared = await act('prepare');
    expect(prepared.body.view.prepared.map((r) => r.recipe_name)).toEqual(['banana smoothie', 'banana bread', 'banana oats']);
    expect(calls(RECIPE_SCHEMA)).toBe(3);
    const { body } = await tool('open_recipe', { recipe: 'the first one' });
    expect(body.kind).toBe('recipe');
    expect(body.recipe).toMatchObject({ recipe_name: 'banana smoothie', description: 'Blend it.', preparation_steps: ['Peel it', 'Blend it', 'Pour it'] });
    expect(body.text).toContain('steps 1 and 2 are lit up: (1) Peel it. (2) Blend it.');
    expect(body.text).not.toContain('Pour it');
    expect(calls(RECIPE_SCHEMA)).toBe(3);
    expect(body.view.shelf.recipes).toEqual([{ recipe_name: 'banana smoothie' }]);
  });

  it('a tap opens it for the user, and the host is told to offer the walkthrough', async () => {
    const { tool, act } = await open();
    await tool('look_up_food', { foods: ['banana'] });
    const { body } = await act('recipe', { name: 'banana bread', description: 'Bake it.' });
    expect(body.kind).toBe('recipe');
    expect(body.text).toMatch(/^The user pressed "Open recipe: banana bread" on screen\./);
    expect(body.text).toMatch(/ask whether they would like you to talk them through it/);
  });

  it('"walk me through it" means the recipe open on the page', async () => {
    const { tool, act } = await open();
    await tool('look_up_food', { foods: ['banana'] });
    await act('recipe', { name: 'banana oats', description: '' });
    const { body } = await tool('open_recipe', { recipe: 'it' }, 'banana oats');
    expect(body.kind).toBe('kept');
    expect(body.recipe?.recipe_name).toBe('banana oats');
    expect(calls(RECIPE_SCHEMA)).toBe(1);
  });

  it('a recipe opened again is the kept copy, even after the card moved on', async () => {
    const { tool } = await open();
    await tool('look_up_food', { foods: ['banana'] });
    await tool('open_recipe', { recipe: 'banana bread' });
    await tool('look_up_food', { foods: ['apple'] });
    const { body } = await tool('open_recipe', { recipe: 'banana bread' });
    expect(body.kind).toBe('kept');
    expect(body.recipe?.description).toBe('Bake it.');
    expect(calls(RECIPE_SCHEMA)).toBe(1);
  });

  it('a tap while the recipe is being made ahead waits for it instead of paying twice', async () => {
    const { tool, act } = await open();
    await tool('look_up_food', { foods: ['banana'] });
    fake.delay = 40;
    const [, tapped] = await Promise.all([act('prepare'), act('recipe', { name: 'banana oats', description: '' })]);
    expect(tapped.body.kind).toBe('recipe');
    expect(calls(RECIPE_SCHEMA)).toBe(3);
  });

  it('"the first one" with no card opens nothing, and the host asks which dish', async () => {
    const { tool } = await open();
    const { body } = await tool('open_recipe', { recipe: 'the first one' });
    expect(body.kind).toBe('failed');
    expect(body.text).toMatch(/Ask which dish they would like/);
    expect(fake.calls).toEqual([]);
  });

  it('a recipe that could not be made is said out loud instead', async () => {
    const { tool } = await open();
    await tool('look_up_food', { foods: ['banana'] });
    fake.respond = (req) => { if (req.schema === RECIPE_SCHEMA) throw new Error('quota'); return model(req); };
    const { body } = await tool('open_recipe', { recipe: 'banana bread' });
    expect(body.kind).toBe('failed');
    expect(body.text).toMatch(/out loud from what you know/);
  });
});

describe('start_over', () => {
  it('clears the table and the recipes, and the view still moves on', async () => {
    const { tool, act } = await open();
    await tool('look_up_food', { foods: ['banana', 'apple'] });
    await tool('open_recipe', { recipe: 'apple bread' });
    const before = (await tool('look_up_food', { foods: ['banana'] })).body.view.seq;
    const { body } = await tool('start_over');
    expect(body.kind).toBe('cleared');
    expect(body.view.seq).toBeGreaterThan(before);
    expect(body.view.nutrition).toBeNull();
    expect(body.view.shelf).toEqual({ current: '', items: [], recipes: [] });
    expect(body.text).toMatch(/the screen is empty/);
    expect((await act('start_over')).body.text).toMatch(/^The user pressed "Start over" on screen\./);
  });
});

describe('work that finishes after something newer', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** The model, with each food's card taking its own time. */
  const slow = (ms: Record<string, number>) => async (req: { user: string; schema: unknown }) => {
    const name = /asked about: "([^"]+)"/.exec(req.user)?.[1] ?? '';
    await sleep(ms[name] ?? (req.schema === RECIPE_SCHEMA ? ms.recipe ?? 0 : 0));
    return model(req);
  };

  it('a lookup that finishes after "start over" leaves the table clear', async () => {
    const { tool } = await open();
    fake.respond = slow({ kiwi: 40 });
    const lookup = tool('look_up_food', { foods: ['kiwi'] });
    await sleep(5);
    const cleared = await tool('start_over');
    expect(cleared.body.kind).toBe('cleared');
    const { body } = await lookup;
    expect(body.view.nutrition).toBeNull();
    expect(body.view.shelf.items).toEqual([]);
    expect(body.card).toBeFalsy();
    expect(body.text).toMatch(/^Not done: the table was cleared while/);
  });

  it('a slow lookup never covers a card asked for after it: it joins the table instead', async () => {
    const { tool } = await open();
    fake.respond = slow({ kiwi: 40, pear: 0 });
    const kiwi = tool('look_up_food', { foods: ['kiwi'] });
    await sleep(5);
    const pear = await tool('look_up_food', { foods: ['pear'] });
    expect(pear.body.view.nutrition?.product_name).toBe('Medium pear');
    const { body } = await kiwi;
    expect(body.view.nutrition?.product_name).toBe('Medium pear');
    expect(body.view.shelf.items.map((r) => r.product_name)).toEqual(['Medium pear', 'Medium kiwi']);
    expect(body.card).toBeFalsy();
    expect(body.text).toMatch(/^Done: "Medium kiwi" joined the comparison table; the card on screen stays "Medium pear"/);
  });

  it('a slow lookup of the same food never replaces the newer figures in the table or the cache', async () => {
    const { tool } = await open();
    let calls = 0;
    fake.respond = async (req) => {
      const first = ++calls === 1;
      await sleep(first ? 40 : 0);
      return { ...(model(req) as object), calories: first ? 50 : 100 };
    };
    const slowKiwi = tool('look_up_food', { foods: ['kiwi'] });
    await sleep(5);
    await tool('look_up_food', { foods: ['kiwi'] });
    const { body } = await slowKiwi;
    expect(body.view.nutrition?.calories).toBe(100);
    expect(body.view.shelf.items.map((r) => r.calories)).toEqual([100]);
    // Rachel is told the figures on screen, not the late ones.
    expect(body.text).toContain('100 calories');
    expect(body.text).not.toContain('50 calories');
    const again = await tool('look_up_food', { foods: ['kiwi'] });
    expect(again.body.view.nutrition?.calories).toBe(100);
    expect(calls).toBe(2);
  });

  it('a recipe still being made when a newer card goes up is not opened over it', async () => {
    const { tool } = await open();
    await tool('look_up_food', { foods: ['banana'] });
    fake.respond = slow({ recipe: 40 });
    const recipe = tool('open_recipe', { recipe: 'banana bread' });
    await sleep(5);
    await tool('look_up_food', { foods: ['apple'] });
    const { body } = await recipe;
    expect(body.kind).toBe('failed');
    expect(body.recipe).toBeUndefined();
    expect(body.view.nutrition?.product_name).toBe('Medium apple');
    expect(body.view.shelf.recipes).toEqual([]);
    expect(body.text).toMatch(/^Not done: the recipe "banana bread" was not opened, because "Medium apple" was put on screen after it was asked for/);
  });

  it('a recipe still being made when the table is cleared is not opened', async () => {
    const { tool } = await open();
    await tool('look_up_food', { foods: ['banana'] });
    fake.respond = slow({ recipe: 40 });
    const recipe = tool('open_recipe', { recipe: 'banana bread' });
    await sleep(5);
    await tool('start_over');
    const { body } = await recipe;
    expect(body.recipe).toBeUndefined();
    expect(body.view.shelf.recipes).toEqual([]);
    expect(body.text).toMatch(/^Not done: the table was cleared while/);
  });

  it('a photo read after "start over" leaves the table clear', async () => {
    const { act } = await open();
    fake.delay = 40;
    const photo = act('photo', { image: { mimeType: 'image/jpeg', base64: 'aGVsbG8=' } });
    await sleep(5);
    fake.delay = 0;
    await act('start_over');
    const { body } = await photo;
    expect(body.view.nutrition).toBeNull();
    expect(body.text).toMatch(/^Not done: the table was cleared while/);
  });
});

describe('buttons', () => {
  it('a quick pick looks the food up and tells the host what was pressed, with the figures', async () => {
    const { act } = await open();
    const { body } = await act('lookup', { food: 'Greek yogurt' });
    expect(body.kind).toBe('card');
    expect(body.text).toMatch(/^The user pressed "greek yogurt" on screen\. Done: on screen now, the nutrition card/);
  });
});

describe('photos', () => {
  const image = { mimeType: 'image/jpeg', base64: 'aGVsbG8=' };

  it('a label is read as a label, for the label’s own serving', async () => {
    const { act } = await open();
    const { body } = await act('photo', { image });
    expect(body.kind).toBe('photo');
    expect(body.view.nutrition).toMatchObject({ product_name: 'Oat milk', source: 'label', portion_assumed: false });
    expect(body.text).toMatch(/read from its nutrition label/);
    expect(fake.calls[0].images).toEqual([image]);
  });

  it('a photo that is not food is said kindly, with a notice', async () => {
    const { act } = await open();
    photoJson = { ...photoJson, is_food: false, seen: 'a cat on a sofa' };
    const { body } = await act('photo', { image });
    expect(body.kind).toBe('failed');
    expect(body.text).toMatch(/it looks like a cat on a sofa/);
    expect(body.notice).toMatch(/doesn't look like a food/);
    expect(body.view.nutrition).toBeNull();
  });

  it('two photos at once are read one at a time, and both are read', async () => {
    const { act } = await open();
    fake.delay = 30;
    const [a, b] = await Promise.all([act('photo', { image }), act('photo', { image })]);
    expect(fake.maxLive).toBe(1);
    expect([a.body.kind, b.body.kind]).toEqual(['photo', 'photo']);
  });

  it('the salmon plate is the app’s own photo, read like any other', async () => {
    const { act } = await open();
    photoJson = { ...cardJson('plate', { product_name: 'Salmon plate' }), is_food: true, seen: 'salmon and rice', source: 'estimate', portion_assumed: true };
    const { body } = await act('sample');
    expect(body.view.nutrition?.product_name).toBe('Salmon plate');
    expect(body.text).toMatch(/tried the sample plate/);
    expect((fake.calls[0].images as { base64: string }[])[0].base64.length).toBeGreaterThan(1000);
  });

  it('serves the plate photo so the table can show what is being read', async () => {
    const res = await fetch(`${base}/sample.jpg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });
});

describe('without a model', () => {
  beforeEach(() => { fake.available = false; });

  it('common foods still get a card, and nothing calls a model', async () => {
    const { tool } = await open();
    expect((await tool('look_up_food', { foods: ['banana'] })).body.view.nutrition?.product_name).toBe('Medium banana');
    expect((await tool('look_up_food', { foods: ['dragon fruit'] })).body.kind).toBe('failed');
    expect(fake.calls).toEqual([]);
  });

  it('the plate photo still works; a photo of the user’s own says photos cannot be read now', async () => {
    const { act } = await open();
    expect((await act('sample')).body.view.nutrition?.product_name).toBe('Grilled salmon with rice and greens');
    const photo = await act('photo', { image: { mimeType: 'image/png', base64: 'aGVsbG8=' } });
    expect(photo.body.notice).toMatch(/Photo reading isn't available right now/);
  });

  it('a recipe is said out loud instead', async () => {
    const { tool } = await open();
    await tool('look_up_food', { foods: ['banana'] });
    expect((await tool('open_recipe', { recipe: 'the first one' })).body.text).toMatch(/out loud from what you know/);
  });
});
