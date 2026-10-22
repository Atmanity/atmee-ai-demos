// The order of things on the API, tested without a browser: a change is
// applied, the avatar's state replaced, and THEN the event sent; words are
// judged by the rules before the model; nothing is told to an avatar that is
// not there yet.
import { describe, expect, test } from 'vitest';
import type { JudgeContext } from '../engine/judge.ts';
import type { Intent } from '../engine/types.ts';
import { HomeSession, type ServerPort } from './session.ts';

function harness({ live = true, judge = null as Awaited<ReturnType<ServerPort['judge']>>, photo = { intents: [], seen: '' } as Awaited<ReturnType<ServerPort['photo']>> } = {}) {
  const log: string[] = [];
  const asked: string[] = [];
  const refusals: string[] = [];
  let isLive = live;
  const server: ServerPort = {
    judge: async (text) => { asked.push(text); return judge; },
    photo: async () => photo,
  };
  const session = new HomeSession(
    { state: (t) => log.push(`state:${t.slice(0, 40)}`), event: (t) => log.push(`event:${t}`), live: () => isLive },
    server,
    ({ refusal }) => { if (refusal) refusals.push(refusal); },
  );
  return { session, log, asked, refusals, setLive: (v: boolean) => { isLive = v; } };
}

const events = (log: string[]) => log.filter((l) => l.startsWith('event:'));

describe('words', () => {
  test('a command the rules know is applied without asking the model, state first, then the event', async () => {
    const h = harness();
    const heard = await h.session.words('a two bed with a study', 'spoken');
    expect(heard).toEqual({ handled: true, refusal: null });
    expect(h.asked).toEqual([]);
    expect(h.session.snapshot().level.rooms.length).toBeGreaterThan(4);
    const last = h.log.slice(-2);
    expect(last[0]).toMatch(/^state:Home planner, live plan/);
    expect(last[1]).toMatch(/^event:The app has made the change the client asked for: the ground floor is laid out/);
  });

  test('what the rules cannot read goes to the model, and its intents are applied', async () => {
    const h = harness({ judge: { intents: [{ kind: 'generate', bedrooms: 3 }], ask: null } });
    await h.session.words('we are a family of five, mostly working from home', 'spoken');
    expect(h.asked).toEqual(['we are a family of five, mostly working from home']);
    expect([...h.session.planner.home.level.rooms.values()].filter((r) => r.kind.startsWith('bedroom')).length).toBe(3);
  });

  test('chat is not an action: a typed line goes to the avatar as it is', async () => {
    const h = harness({ judge: { intents: [], ask: null } });
    expect(await h.session.words('That looks lovely', 'typed')).toEqual({ handled: false, refusal: null });
    expect(events(h.log)).toEqual([]);
  });

  test('without a model the rules still work, and the rest is left to the avatar', async () => {
    const h = harness({ judge: null });
    expect((await h.session.words('undo', 'typed')).handled).toBe(true);   // refused: nothing to undo
    expect((await h.session.words('what do you think of the hall', 'typed')).handled).toBe(false);
  });

  test('a refusal is told as a refusal and shown on the plan', async () => {
    const h = harness();
    const heard = await h.session.words('undo', 'spoken');
    expect(heard).toEqual({ handled: true, refusal: "There's nothing to undo yet." });
    expect(h.refusals).toEqual(["There's nothing to undo yet."]);
    expect(events(h.log)[0]).toContain('do NOT describe it as done');
  });

  test('a request the model could not pin down becomes a question', async () => {
    const h = harness({ judge: { intents: [], ask: 'Which bedroom, the main one or the second?' } });
    await h.session.words('make the bedroom bigger', 'spoken');
    expect(events(h.log)).toEqual(['event:The client asked for a change, but the app could not tell exactly what. Ask them this, in your own words, in one short line: Which bedroom, the main one or the second?']);
  });

  test('utterances are handled one at a time, in the order they were said', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const order: string[] = [];
    const server: ServerPort = {
      judge: async (text) => { await gate; order.push(text); return { intents: [{ kind: 'set_unit', unit: 'ft2' } as Intent], ask: null }; },
      photo: async () => ({ error: 'none' }),
    };
    const session = new HomeSession({ state: () => {}, event: () => {}, live: () => true }, server, () => {});
    const first = session.words('first thing', 'spoken');
    const second = session.words('second thing', 'spoken');
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first thing', 'second thing']);
  });
});

describe('the panel', () => {
  test('a small edit by hand updates the state and is not narrated', () => {
    const h = harness();
    h.session.panel({ kind: 'generate', bedrooms: 1 });
    const before = events(h.log).length;
    const living = [...h.session.planner.home.level.rooms.values()].find((r) => r.kind === 'living')!;
    h.session.panel({ kind: 'select', id: living.id });
    expect(h.log[h.log.length - 1]).toMatch(/^state:/);
    expect(events(h.log).length).toBe(before);
  });

  test('a milestone by hand is told, since the avatar cannot see the click', () => {
    const h = harness();
    h.session.panel({ kind: 'generate', bedrooms: 1 });
    expect(events(h.log)[0]).toMatch(/^event:The client used the panel: the ground floor is laid out/);
  });

  test('a refused click is shown, not spoken', () => {
    const h = harness();
    expect(h.session.panel({ kind: 'clear' })).toEqual({ applied: false, reason: 'This floor is already empty.' });
    expect(events(h.log)).toEqual([]);
  });

  test('nothing is told to an avatar that is not there yet; the state still waits for it', () => {
    const h = harness({ live: false });
    h.session.panel({ kind: 'generate', bedrooms: 2 });
    expect(events(h.log)).toEqual([]);
    expect(h.log.some((l) => l.startsWith('state:'))).toBe(true);
  });
});

describe('photos', () => {
  test('pieces read from a photo are placed by the planner and told by what went in', async () => {
    const h = harness({ photo: { intents: [{ kind: 'add_item', type: 'sofa_3', room: null, near: 'center' }, { kind: 'add_item', type: 'piano', room: null, near: 'center' }], seen: 'a living room' } });
    h.session.panel({ kind: 'generate', bedrooms: 1 });
    const result = await h.session.photo('room', { sample: 'room' });
    expect(result).toEqual({ added: ['a 3-seat sofa in the living room'], refused: [expect.stringContaining('a piano')], seen: 'a living room' });
    expect(events(h.log).pop()).toContain('added to the plan, at real kit sizes: a 3-seat sofa in the living room');
  });

  test('a photo the server could not read is reported, and nothing changes', async () => {
    const h = harness({ photo: { error: 'no model' } });
    expect(await h.session.photo('piece', { sample: 'room' })).toEqual({ error: 'no model' });
  });
});

void ({} as JudgeContext);
