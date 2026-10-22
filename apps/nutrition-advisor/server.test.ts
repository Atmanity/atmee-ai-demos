// The server's routes end to end, with the model call replaced by a fake: what
// goes on the board, what the avatar is told, how many model calls each step
// costs, and what happens without a model or when it fails. No network beyond
// this machine.
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
import { JUDGE_SCHEMA } from './engine/judge.ts';
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

let judged: unknown = { kind: 'none', foods: [], recipe: '' };
let photoJson: Record<string, unknown> = {};

function model(req: { user: string; schema: unknown }): unknown {
  if (req.schema === CARD_SCHEMA) return cardJson(/asked about: "([^"]+)"/.exec(req.user)![1]);
  if (req.schema === RECIPE_SCHEMA) return { ingredients: ['1 banana', '200 ml milk'], preparation_steps: ['1. **Peel** it', 'Blend it'] };
  if (req.schema === PHOTO_SCHEMA) return photoJson;
  if (req.schema === JUDGE_SCHEMA) return judged;
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
  judged = { kind: 'none', foods: [], recipe: '' };
  photoJson = { is_food: true, seen: 'a carton of oat milk', source: 'label', portion_assumed: false, ...cardJson('oat milk', { product_name: 'Oat milk', serving_size: '240 ml' }) };
});

async function post<T = Outcome>(path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
}

async function open() {
  const { body } = await post<{ id: string; outcome: Outcome }>('/sessions');
  const act = (action: unknown, how = 'button', said?: string) => post(`/sessions/${body.id}/act`, { action, how, said });
  const judge = (text: string, how = 'spoken', screen = { recipe: null as string | null }, lastAvatarLine = '') =>
    post<{ intent: unknown; by: string }>(`/sessions/${body.id}/judge`, { text, how, screen, lastAvatarLine });
  return { id: body.id, start: body.outcome, act, judge };
}

const lookup = (name: string, quantity = '') => ({ kind: 'lookup', foods: [{ name, quantity }] });

describe('a session', () => {
  it('opens on an empty board, with the opening for the avatar', async () => {
    const { start } = await open();
    expect(start.view.nutrition).toBeNull();
    expect(start.view.shelf.items).toEqual([]);
    expect(start.event).toMatch(/name any food, or share a photo/);
  });

  it('an unknown session or an empty request is refused, not guessed at', async () => {
    const { act } = await open();
    expect((await post('/sessions/nope/act', { action: lookup('banana') })).status).toBe(404);
    expect((await act({ kind: 'lookup', foods: [] })).status).toBe(400);
    expect((await act({ kind: 'photo', image: { mimeType: 'text/html', base64: 'eA==' } })).status).toBe(400);
    expect((await act({ kind: 'dance' })).status).toBe(400);
  });
});

describe('naming foods', () => {
  it('puts a card up, an estimate for an assumed portion, and tells the avatar what was asked', async () => {
    const { act } = await open();
    const { body } = await act(lookup('banana'), 'typed', "what's in a banana?");
    expect(body.kind).toBe('card');
    expect(body.card).toBe(true);
    expect(body.view.nutrition).toMatchObject({ product_name: 'Medium banana', source: 'estimate', portion_assumed: true });
    expect(body.event).toContain('The user typed: "what\'s in a banana?"');
    expect(calls(CARD_SCHEMA)).toBe(1);
  });

  it('a stated quantity is not an assumed portion', async () => {
    const { act } = await open();
    const { body } = await act(lookup('chicken breast', '200 g'), 'spoken', 'how much protein in 200 g of chicken breast');
    expect(body.view.nutrition?.portion_assumed).toBe(false);
    expect(fake.calls[0].user).toMatch(/exactly that quantity/);
  });

  it('a food already looked at comes back without a second model call', async () => {
    const { act } = await open();
    await act(lookup('banana'));
    await act(lookup('apple'));
    const { body } = await act(lookup('banana'));
    expect(body.view.nutrition?.product_name).toBe('Medium banana');
    expect(body.view.shelf.items.map((r) => r.product_name)).toEqual(['Medium banana', 'Medium apple']);
    expect(calls(CARD_SCHEMA)).toBe(2);
    // Back, not new: it does not "join" a table it was already in.
    expect(body.event).toMatch(/"Medium banana" back on their screen; it was already in the comparison table/);
  });

  it('compare: only what the table lacks goes up, and the verdict names both', async () => {
    const { act } = await open();
    await act(lookup('banana'));
    const { body } = await act({ kind: 'compare', foods: [{ name: 'apple', quantity: '' }] }, 'spoken', 'compare it with an apple');
    expect(body.kind).toBe('compare');
    expect(body.view.shelf.items.map((r) => r.product_name)).toEqual(['Medium banana', 'Medium apple']);
    expect(body.view.shelf.current).toBe('Medium apple');
    expect(body.event).toMatch(/"Medium banana" and "Medium apple" side by side/);
    expect(calls(CARD_SCHEMA)).toBe(2);
    const again = await act({ kind: 'compare', foods: [{ name: 'banana', quantity: '' }, { name: 'apple', quantity: '' }] });
    expect(again.body.event).toMatch(/Those foods were already on screen/);
    expect(calls(CARD_SCHEMA)).toBe(2);
  });

  it('a card the model could not make is said out loud, with a notice, never silence', async () => {
    const { act } = await open();
    fake.respond = () => { throw new Error('quota'); };
    const { body } = await act(lookup('dragon fruit'));
    expect(body.kind).toBe('failed');
    expect(body.event).toMatch(/OUT LOUD/);
    expect(body.notice).toMatch(/Couldn't pull up dragon fruit/);
    // A common food still gets the app's own card.
    const banana = await act(lookup('banana'));
    expect(banana.body.view.nutrition?.product_name).toBe('Medium banana');
  });
});

describe('recipes', () => {
  it('are made ahead for the card, then open at once under the name tapped', async () => {
    const { act } = await open();
    await act(lookup('banana'));
    const prepared = await act({ kind: 'prepare' });
    expect(prepared.body.view.prepared.map((r) => r.recipe_name)).toEqual(['banana smoothie', 'banana bread', 'banana oats']);
    expect(calls(RECIPE_SCHEMA)).toBe(3);
    const { body } = await act({ kind: 'recipe', name: 'banana smoothie', description: 'Blend it.' });
    expect(body.kind).toBe('recipe');
    expect(body.recipe).toMatchObject({ recipe_name: 'banana smoothie', description: 'Blend it.', preparation_steps: ['Peel it', 'Blend it'] });
    expect(body.event).toMatch(/tapped the recipe "banana smoothie"/);
    expect(calls(RECIPE_SCHEMA)).toBe(3);
    expect(body.view.shelf.recipes).toEqual([{ recipe_name: 'banana smoothie' }]);
  });

  it('a recipe opened again is the kept copy, said out loud', async () => {
    const { act } = await open();
    await act(lookup('banana'));
    await act({ kind: 'recipe', name: 'banana bread', description: '' });
    await act(lookup('apple'));
    const { body } = await act({ kind: 'recipe', name: 'banana bread', description: '' });
    expect(body.kind).toBe('kept');
    expect(body.recipe?.description).toBe('Bake it.');
    expect(body.event).toMatch(/re-opened the recipe "banana bread"/);
    expect(calls(RECIPE_SCHEMA)).toBe(1);
  });

  it('a tap while the recipe is being made ahead waits for it instead of paying twice', async () => {
    const { act } = await open();
    await act(lookup('banana'));
    fake.delay = 40;
    const [, tapped] = await Promise.all([act({ kind: 'prepare' }), act({ kind: 'recipe', name: 'banana oats', description: '' })]);
    expect(tapped.body.kind).toBe('recipe');
    expect(calls(RECIPE_SCHEMA)).toBe(3);
  });

  it('a recipe that could not be made is said out loud instead', async () => {
    const { act } = await open();
    await act(lookup('banana'));
    fake.respond = (req) => { if (req.schema === RECIPE_SCHEMA) throw new Error('quota'); return model(req); };
    const { body } = await act({ kind: 'recipe', name: 'banana bread', description: '' }, 'spoken', 'walk me through the banana bread');
    expect(body.kind).toBe('failed');
    expect(body.event).toMatch(/Give them the recipe OUT LOUD/);
  });
});

describe('photos', () => {
  const image = { mimeType: 'image/jpeg', base64: 'aGVsbG8=' };

  it('a label is read as a label, for the label’s own serving', async () => {
    const { act } = await open();
    const { body } = await act({ kind: 'photo', image });
    expect(body.kind).toBe('photo');
    expect(body.view.nutrition).toMatchObject({ product_name: 'Oat milk', source: 'label', portion_assumed: false });
    expect(body.event).toMatch(/read from its nutrition label/);
    expect(fake.calls[0].images).toEqual([image]);
  });

  it('a photo that is not food is said kindly, with a notice', async () => {
    const { act } = await open();
    photoJson = { ...photoJson, is_food: false, seen: 'a cat on a sofa' };
    const { body } = await act({ kind: 'photo', image });
    expect(body.kind).toBe('failed');
    expect(body.event).toMatch(/it looks like a cat on a sofa/);
    expect(body.notice).toMatch(/doesn't look like a food/);
    expect(body.view.nutrition).toBeNull();
  });

  it('two photos at once are read one at a time, and both are read', async () => {
    const { act } = await open();
    fake.delay = 30;
    const [a, b] = await Promise.all([act({ kind: 'photo', image }), act({ kind: 'photo', image })]);
    expect(fake.maxLive).toBe(1);
    expect([a.body.kind, b.body.kind]).toEqual(['photo', 'photo']);
  });

  it('the sample is the app’s own photo, read like any other', async () => {
    const { act } = await open();
    photoJson = { ...cardJson('plate', { product_name: 'Salmon plate' }), is_food: true, seen: 'salmon and rice', source: 'estimate', portion_assumed: true };
    const { body } = await act({ kind: 'sample' });
    expect(body.view.nutrition?.product_name).toBe('Salmon plate');
    expect(body.event).toMatch(/tried the sample photo/);
    expect((fake.calls[0].images as { base64: string }[])[0].base64.length).toBeGreaterThan(1000);
  });

  it('serves the sample so the board can show what is being read', async () => {
    const res = await fetch(`${base}/sample.jpg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });
});

describe('judging what the user said', () => {
  it('the rules answer the phrasings they know, without a model call', async () => {
    const { act, judge } = await open();
    await act(lookup('banana'));
    const { body } = await judge('Compare it with an apple');
    expect(body).toEqual({ intent: { kind: 'compare', foods: [{ name: 'apple', quantity: '' }] }, by: 'rules' });
    expect(calls(JUDGE_SCHEMA)).toBe(0);
  });

  it('the model reads the rest, with the screen in front of it', async () => {
    const { judge } = await open();
    judged = { kind: 'lookup', foods: [{ name: 'Big Mac', quantity: '' }], recipe: '' };
    const { body } = await judge("I'm eating a Big Mac right now");
    expect(body).toEqual({ intent: { kind: 'lookup', foods: [{ name: 'big mac', quantity: '' }] }, by: 'model' });
    expect(fake.calls[0].user).toContain('no card yet');
  });

  it('knows which recipe is open on the page', async () => {
    const { act, judge } = await open();
    await act(lookup('banana'));
    expect((await judge('go back', 'spoken', { recipe: 'banana bread' })).body.intent).toEqual({ kind: 'back' });
    expect((await judge('walk me through it', 'spoken', { recipe: 'banana bread' })).body.intent).toEqual({ kind: 'none' });
  });
});

describe('without a model', () => {
  beforeEach(() => { fake.available = false; });

  it('common foods still get a card, and nothing calls a model', async () => {
    const { act } = await open();
    const { body } = await act(lookup('banana'));
    expect(body.view.nutrition?.product_name).toBe('Medium banana');
    expect((await act(lookup('dragon fruit'))).body.kind).toBe('failed');
    expect(fake.calls).toEqual([]);
  });

  it('the sample still works; a photo of the user’s own says the app cannot read it', async () => {
    const { act } = await open();
    expect((await act({ kind: 'sample' })).body.view.nutrition?.product_name).toBe('Grilled salmon with rice and greens');
    const photo = await act({ kind: 'photo', image: { mimeType: 'image/png', base64: 'aGVsbG8=' } });
    expect(photo.body.notice).toMatch(/GEMINI_API_KEY/);
  });

  it('a recipe is said out loud, and a typed food name is still a lookup', async () => {
    const { act, judge } = await open();
    await act(lookup('banana'));
    expect((await act({ kind: 'recipe', name: 'Banana oat smoothie', description: '' })).body.event).toMatch(/OUT LOUD/);
    expect((await judge('greek yogurt', 'typed')).body).toEqual({ intent: { kind: 'lookup', foods: [{ name: 'greek yogurt', quantity: '' }] }, by: 'fallback' });
    expect((await judge('greek yogurt', 'spoken')).body.intent).toEqual({ kind: 'none' });
  });
});
