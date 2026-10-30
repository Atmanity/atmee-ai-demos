import { describe, expect, test } from 'vitest';
import { jawFor, follow } from '../page/Brannoc.tsx';
import { FACTS, QUESTS, RULES, START_SILVER, TOOLS, Tavern, WARES, pick } from './tavern.ts';

describe('what Brannoc and the player call things', () => {
  test('a ware or a quest by its distinctive words', () => {
    expect(pick(WARES, 'a coil of rope')?.id).toBe('rope');
    expect(pick(WARES, 'the lantern')?.id).toBe('lantern');
    expect(pick(WARES, 'lamp oil')?.id).toBe('oil');
    expect(pick(WARES, 'healing potion')?.id).toBe('tonic');
    expect(pick(QUESTS, 'the drowned bell')?.id).toBe('bell');
    expect(pick(QUESTS, 'the wolves')?.id).toBe('wolves');
    expect(pick(WARES, 'a sword')).toBeNull();
    expect(pick(WARES, '')).toBeNull();
  });
});

describe('the game owns the silver, the shelf and the log', () => {
  test('a sale takes the silver and the stock, and leads with its outcome', () => {
    const t = new Tavern();
    const r = t.sell_item({ item: 'storm lantern' });
    expect(r).toMatchObject({ ok: true, event: { kind: 'sold', label: 'Storm lantern' } });
    expect(r.text).toBe(`Sold: Storm lantern for 6 silver. The player has ${START_SILVER - 6} silver left.`);
    expect(t.pack).toContain('Storm lantern');
    expect(t.wares.find((w) => w.id === 'lantern')!.stock).toBe(1);
  });

  test('nothing changes hands when the player cannot pay, or the shelf has none', () => {
    const t = new Tavern();
    t.sell_item({ item: 'tonic' });
    const r = t.sell_item({ item: 'tonic' });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/^Not sold: it costs 8 silver and the player has only 4 silver/);
    expect(t.silver).toBe(4);
    t.silver = 50;
    t.sell_item({ item: 'map' });
    expect(t.sell_item({ item: 'map' }).text).toMatch(/^Not sold: only 0 map of the fen left, none at all/);
    expect(t.sell_item({ item: 'a dragon' }).text).toMatch(/^Not sold: there is no "a dragon" on the shelf\. The shelf has /);
  });

  test('one cheap thing on the house per visit, never a dear one', () => {
    const t = new Tavern();
    expect(t.give_item({ item: 'lantern' }).text).toMatch(/too dear to give away/);
    expect(t.give_item({ item: 'stew' })).toMatchObject({ ok: true, text: 'Given: Bowl of hot stew, on the house.' });
    expect(t.give_item({ item: 'oil' }).text).toMatch(/already given one thing/);
    expect(t.silver).toBe(START_SILVER);
  });

  test('quests come from the board, once each, two at a time', () => {
    const t = new Tavern();
    expect(t.give_quest({ quest: 'the drowned bell' }).text).toMatch(/^Quest given: The Drowned Bell, for the chapel warden\. .* Reward: 40 silver\. Start at the ferry landing/);
    expect(t.give_quest({ quest: 'drowned bell' }).text).toBe('Already on the log: The Drowned Bell.');
    expect(t.give_quest({ quest: 'slay the dragon' }).ok).toBe(false);
    t.give_quest({ quest: 'wolves' });
    expect(t.give_quest({ quest: 'courier' }).text).toMatch(/two at a time/);
    expect(t.quests.map((q) => q.id)).toEqual(['bell', 'wolves']);
  });

  test('sizing the player up tells what they have', () => {
    const t = new Tavern();
    expect(t.look_at_player().text).toBe('The player has 12 silver; carries Worn travelling cloak; on their quest log: no quest yet.');
  });
});

describe('what the server pins', () => {
  test('within the speech API limits, and every tool is one the game runs', () => {
    expect(RULES.length).toBeLessThan(8000);
    expect(FACTS.length).toBeLessThan(4000);
    expect(new TextEncoder().encode(JSON.stringify(TOOLS)).length).toBeLessThan(24_576);
    const t = new Tavern();
    for (const tool of TOOLS) expect(t.run(tool.name, {}).text).not.toMatch(/no tool named/);
  });
});

describe('his face, from the voice', () => {
  test('the jaw is shut in silence and opens with speech, never past fully', () => {
    expect(jawFor(0)).toBe(0);
    expect(jawFor(0.005)).toBe(0);
    expect(jawFor(0.08)).toBeGreaterThan(0.3);
    expect(jawFor(0.5)).toBe(1);
  });
  test('it opens faster than it closes', () => {
    expect(follow(0, 1)).toBeGreaterThan(1 - follow(1, 0));
  });
});
