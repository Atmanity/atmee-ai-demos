// The order of things, tested without a browser: a change is applied, the
// architect's state replaced, and THEN she hears about it (her tool's result,
// or an event for a change by hand); nothing is told to her before she is
// there.
import { describe, expect, test } from 'vitest';
import type { Intent } from '../engine/types.ts';
import { HomeSession, type Change, type ServerPort } from './session.ts';

function harness({ live = true, photo = { intents: [], seen: '' } as Awaited<ReturnType<ServerPort['photo']>> } = {}) {
  const log: string[] = [];
  const changes: Change[] = [];
  let isLive = live;
  const session = new HomeSession(
    { state: (t) => log.push(`state:${t.slice(0, 40)}`), event: (t) => log.push(`event:${t}`), live: () => isLive },
    { photo: async () => photo },
    (change) => { changes.push(change); log.push(`change${change.refusal ? ':refused' : ''}${change.drew ? ':drew' : ''}`); },
  );
  return { session, log, changes, setLive: (v: boolean) => { isLive = v; } };
}

const events = (log: string[]) => log.filter((l) => l.startsWith('event:'));

describe("the architect's tools", () => {
  test('a call is applied and shown before its result goes back, and is not told twice', () => {
    const h = harness();
    const result = h.session.tool('lay_out_floor', { bedrooms: 2, study: true });
    expect(result).toMatch(/^Done: the ground floor is laid out/);
    expect(h.log).toEqual(['state:Planwright, live plan (what the client s', 'change']);
    expect(events(h.log)).toEqual([]);   // the result is her answer; no event repeats it
    expect(h.session.snapshot().level.rooms.length).toBeGreaterThan(4);
  });

  test('a refusal goes back as the reason, and is shown on the plan too', () => {
    const h = harness();
    expect(h.session.tool('undo_change')).toContain("There's nothing to undo yet.");
    expect(h.changes[0].refusal).toBe("There's nothing to undo yet.");
  });

  test('the sheet drawn by the architect opens on the page', () => {
    const h = harness();
    h.session.tool('lay_out_floor', { bedrooms: 1 });
    h.session.tool('draw_sheet');
    expect(h.changes[h.changes.length - 1]).toMatchObject({ drew: true, refusal: null });
    expect(h.changes[h.changes.length - 1].snapshot.sheet?.status).toBe('ready');
  });

  test('a question back changes nothing on the plan', () => {
    const h = harness();
    const before = JSON.stringify(h.session.snapshot().level);
    expect(h.session.tool('trade_area', { take_from: 'hall', give_to: 'kitchen' })).toMatch(/^Not yet: nothing changed/);
    expect(JSON.stringify(h.session.snapshot().level)).toBe(before);
  });

  test('the opening asks for the size and the bedrooms on an empty floor', () => {
    expect(harness().session.opening()).toContain('roughly how big the place is');
  });
});

describe('changes by hand', () => {
  test('a small edit updates the state and is not narrated', () => {
    const h = harness();
    h.session.panel({ kind: 'generate', bedrooms: 1 });
    const before = events(h.log).length;
    const living = [...h.session.planner.home.level.rooms.values()].find((r) => r.kind === 'living')!;
    h.session.panel({ kind: 'select', id: living.id });
    expect(h.log[h.log.length - 2]).toMatch(/^state:/);
    expect(events(h.log).length).toBe(before);
  });

  test('a milestone is told, since the architect cannot see the click', () => {
    const h = harness();
    h.session.panel({ kind: 'generate', bedrooms: 1 });
    expect(events(h.log)[0]).toMatch(/^event:The client changed the plan by hand: the ground floor is laid out/);
  });

  test('a refused click is shown, not spoken', () => {
    const h = harness();
    expect(h.session.panel({ kind: 'clear' })).toEqual({ applied: false, reason: 'This floor is already empty.' });
    expect(events(h.log)).toEqual([]);
  });

  test('nothing is told to an architect who is not there yet; the state still waits for her', () => {
    const h = harness({ live: false });
    h.session.panel({ kind: 'generate', bedrooms: 2 });
    expect(events(h.log)).toEqual([]);
    expect(h.log.some((l) => l.startsWith('state:'))).toBe(true);
  });

  test('the sheet drawn by hand opens too', () => {
    const h = harness();
    h.session.panel({ kind: 'generate', bedrooms: 1 });
    h.session.panel({ kind: 'draw_sheet' });
    expect(h.changes[h.changes.length - 1].drew).toBe(true);
  });
});

describe('photos', () => {
  test('pieces read from a photo are placed by the planner and told by what went in', async () => {
    const h = harness({ photo: { intents: [{ kind: 'add_item', type: 'sofa_3', room: null, near: 'center' }, { kind: 'add_item', type: 'piano', room: null, near: 'center' }] as Intent[], seen: 'a living room' } });
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
