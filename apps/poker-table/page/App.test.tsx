// @vitest-environment jsdom
// The page and the server together, in memory: the real App against the real
// routes (server.ts) on a fake router, with the call itself faked (no room,
// no network, no model: Dex's decisions take the safe action). What is
// proven here is the part only the page can get wrong: Dex's tool calls
// answered from the table, his own turns played in the same reply, the
// player's words tagged so a move lands once, and the safety net.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  // No model key in a test, ever: Dex's decisions take the safe action.
  delete process.env.GEMINI_API_KEY;
  return {
    handlers: null as null | {
      onToolCall?: (call: { id: string; name: string; arguments: Record<string, unknown> }) => unknown;
      onUserSaid?: (text: string, how: 'spoken' | 'typed') => void;
    },
    setPhase: (_: string) => undefined as void,
    events: [] as string[],
    states: [] as string[],
    notes: [] as string[],
  };
});

vi.mock('../../../src/kit/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/kit/index.ts')>();
  const React = await import('react');
  return {
    ...real,
    useAvatar: (_app: string, handlers: NonNullable<typeof harness.handlers>) => {
      const [phase, setPhase] = React.useState('idle');
      harness.handlers = handlers;
      harness.setPhase = setPhase as (p: string) => void;
      const noop = () => undefined;
      return {
        phase, detail: '', speaking: false, caption: '', heard: '', lines: [], secondsLeft: null, micOn: false, audioBlocked: false,
        videoRef: { current: null }, audioRef: { current: null },
        start: async () => setPhase('starting'), end: async () => setPhase('ended'),
        say: (text: string) => handlers.onUserSaid?.(text, 'typed'), record: noop,
        state: (text: string) => { harness.states.push(text); }, note: (text: string) => { harness.notes.push(text); },
        event: (text: string) => { harness.events.push(text); }, mute: noop, unmute: noop, setMic: noop, resumeAudio: noop,
      };
    },
  };
});

const { default: server } = await import('../server.ts');
const { RULES_NOTE } = await import('../engine/director.ts');
const { App } = await import('./App.tsx');

type Handler = (req: { params: Record<string, string>; body: unknown }, res: unknown) => unknown;
const routes: [RegExp, string[], Handler][] = [];
server.routes!({
  post(path: string, handler: Handler) {
    const keys: string[] = [];
    routes.push([new RegExp(`^${path.replace(/:(\w+)/g, (_, key) => { keys.push(key); return '([^/]+)'; })}$`), keys, handler]);
  },
} as never);

/** Requests a test holds back, by path, until it releases them (a slow server). */
const held: { re: RegExp; waiting: (() => void)[] }[] = [];
function hold(re: RegExp) {
  const gate = { re, waiting: [] as (() => void)[] };
  held.push(gate);
  return {
    get count() { return gate.waiting.length; },
    /** Lets the nth held request (oldest first) through. */
    release(n = 0) { const [go] = gate.waiting.splice(n, 1); go?.(); },
    open() { held.splice(held.indexOf(gate), 1); gate.waiting.splice(0).forEach((go) => go()); },
  };
}
const requests: string[] = [];

/** The server's routes, behind fetch. Anything else (a model call included) fails. */
async function fakeFetch(url: string, init?: { body?: string }) {
  const path = String(url).replace('/api/apps/poker-table', '');
  requests.push(path);
  const gate = held.find((g) => g.re.test(path));
  if (gate) await new Promise<void>((go) => gate.waiting.push(go));
  for (const [re, keys, handler] of routes) {
    const m = re.exec(path);
    if (!m) continue;
    let status = 200;
    let payload: unknown;
    const res = { status(code: number) { status = code; return res; }, json(body: unknown) { payload = body; } };
    await handler({ params: Object.fromEntries(keys.map((k, i) => [k, m[i + 1]])), body: JSON.parse(init?.body ?? '{}') }, res);
    return { ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(payload)) };
  }
  throw new Error(`no route for ${url}`);
}

const settle = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const tool = (id: string, name: string, args: Record<string, unknown> = {}) => harness.handlers!.onToolCall!({ id, name, arguments: args }) as Promise<string>;
const say = (text: string, how: 'spoken' | 'typed' = 'spoken') => harness.handlers!.onUserSaid!(text, how);

/** At the table, hand 1 dealt, the action on the player, a couple of seconds after the deal. */
async function sitDown() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Play by typing' }));
  await settle();
  act(() => harness.setPhase('live'));
  await settle(2000);
}

/** Runs a tool call while time passes, and returns its answer. */
async function answer(call: Promise<string>, ms: number) {
  let text = '';
  void call.then((t) => { text = t; });
  await settle(ms);
  return text;
}

// jsdom draws nothing, so it cannot scroll the conversation.
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  harness.events.length = 0;
  harness.states.length = 0;
  harness.notes.length = 0;
  held.length = 0;
  requests.length = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('opens the table while Dex is on his way: the rules note, the opening, the live table', async () => {
  await sitDown();
  expect(harness.notes).toContain(RULES_NOTE);
  expect(harness.events[0]).toContain('Hand 1 is dealt');
  expect(harness.events[0]).toContain('never ask them to deal');
  expect(harness.states.at(-1)).toContain('Action is on them');
  expect(screen.getByRole('button', { name: 'Call 10' })).toBeTruthy();
});

it("a spoken move lands once, and Dex's own moves come back in the same reply", async () => {
  await sitDown();
  say('I call.');
  const first = await answer(tool('c1', 'play_move', { words: 'I call' }), 3000);
  expect(first).toContain('The table played their call of 10.');
  expect(first).toContain('The table played your move: you checked.');
  expect(first).toContain('The flop is out');
  expect(first).toContain('Then the table played your next move: you checked.');
  expect(first).toMatch(/name your own move as done/);
  expect(screen.getAllByRole('img').filter((el) => el.closest('.bs-board'))).toHaveLength(3);

  // The same call delivered twice is answered once, from the first answer.
  expect(await tool('c1', 'play_move', { words: 'I call' })).toBe(first);
  // A second call of the move with nothing new said: it already landed; on
  // the flop it would have been a check the player never made.
  const table = harness.states.at(-1);
  const second = await answer(tool('c2', 'play_move', { words: 'I call' }), 4500);
  expect(second).toContain('Their call already landed');
  expect(harness.states.at(-1)).toBe(table);
});

it('a tapped call and the same call said aloud land once', async () => {
  await sitDown();
  fireEvent.click(screen.getByRole('button', { name: 'Call 10' }));
  // The player says "I call" as they tap. Dex answers fast (two checks, the
  // flop, back to the player) and only then does the recogniser's line
  // arrive, with the host's call after it. Read at the table as it now is,
  // "call" would be a check on the flop they never made.
  await settle(1600);
  say('I call');
  const voiced = await answer(tool('v1', 'play_move', { words: 'I call' }), 6000);
  expect(voiced).toContain('Their call already landed');
  const told = harness.events.at(-1)!;
  expect(told).toContain('The player pressed "Call 10" on screen. Done. The table played their call of 10.');
  expect(told).toContain('The table played your move: you checked.');
  expect(screen.getAllByRole('img').filter((el) => el.closest('.bs-board'))).toHaveLength(3);
  expect(screen.getByRole('button', { name: 'Check' })).toBeTruthy();
});

it('the safety net opens the chart when Dex only recites the rankings', async () => {
  // Live: "What beats what?" was answered from memory with an offer to open the chart.
  await sitDown();
  say('What beats what?');
  await settle(7500);
  expect(screen.getByRole('dialog', { name: 'How to play' })).toBeTruthy();
  expect(harness.events.at(-1)).toContain('You did not call show_hand_rankings');
  expect(harness.events.at(-1)).toContain('Done. The hand-rankings chart is open');
});

it('a lenient call: an extra field, a synonym field and capitals all reach the table', async () => {
  await sitDown();
  say('I call.');
  const called = await answer(tool('l1', 'play_move', { words: 'I CALL', confidence: 0.9 }), 3000);
  expect(called).toContain('The table played their call of 10.');
  say('Bet sixty.');
  const bet = await answer(tool('l2', 'play_move', { move: 'Bet', amount: 60 }), 3000);
  expect(bet).toContain('The table played their bet of 60.');
});

it('an invented move never lands: the words decide', async () => {
  await sitDown();
  say('purple banana forty seven?');
  const result = await answer(tool('x1', 'play_move', { words: 'raise to 47' }), 5000);
  expect(result).toContain('NOTHING was applied');
  expect(screen.getByRole('button', { name: 'Call 10' })).toBeTruthy();
});

it('a typed move goes to Dex, who calls the tool for it too', async () => {
  await sitDown();
  fireEvent.change(screen.getByRole('textbox', { name: 'Message Dex' }), { target: { value: 'raise to 60' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  const result = await answer(tool('t1', 'play_move', { words: 'raise to 60' }), 2000);
  expect(result).toContain('The table played their raise to 60.');
  expect(result).toContain('you called 40');
});

it('the safety net deals the next hand when Dex only talks about it, and never plays a move', async () => {
  await sitDown();
  fireEvent.click(screen.getByRole('button', { name: 'Fold' }));
  await settle(500);
  expect(screen.getByRole('button', { name: 'Deal next hand' })).toBeTruthy();
  say('Deal me another one.');
  await settle(9000);
  const dealt = harness.events.at(-1)!;
  expect(dealt).toContain('You did not call deal_hand');
  expect(dealt).toContain('Hand 2 is dealt');
  // Hand 2: Dex has the button and acts first; his move came back with the deal.
  expect(dealt).toContain('The table played your move: you called 10.');

  const told = harness.events.length;
  const table = harness.states.at(-1);
  say('I check');   // a move Dex does not act on is never the net's to play
  await settle(9000);
  expect(harness.events.length).toBe(told);
  expect(harness.states.at(-1)).toBe(table);
  expect(screen.getByRole('button', { name: 'Check' })).toBeTruthy();
});

it("Dex's chart tool opens the rankings and gives him them to speak from; his other tools read the table", async () => {
  await sitDown();
  let chart = '';
  await act(async () => { chart = await tool('r1', 'show_hand_rankings'); });
  expect(screen.getByRole('dialog', { name: 'How to play' })).toBeTruthy();
  expect(chart.startsWith('Done. The hand-rankings chart is open on their screen.')).toBe(true);
  expect(chart).toContain('royal flush, then straight flush');
  const cards = await answer(tool('k1', 'read_my_cards'), 100);
  expect(cards).toMatch(/Their two hole cards are the \w+ of \w+ and the \w+ of \w+\./);
  expect(await answer(tool('d1', 'deal_hand'), 100)).toContain('A hand is already in play');
  expect(await answer(tool('m1', 'new_match'), 100)).toContain('The match is still on');
});

// ---- nothing started for one call acts on another ----------------------------

const hangUp = () => act(() => harness.setPhase('ended'));
const callAgain = async () => { act(() => harness.setPhase('starting')); await settle(); act(() => harness.setPhase('live')); await settle(); };
const tableIds = () => [...new Set(requests.map((r) => /^\/tables\/([^/]+)\//.exec(r)?.[1]).filter(Boolean))];

it("a table dealt for a call that failed never replaces the next call's table", async () => {
  const tables = hold(/^\/tables$/);
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Play by typing' }));
  await settle();
  act(() => harness.setPhase('failed'));   // the first call fails while its table is being set up
  await callAgain();
  expect(tables.count).toBe(2);
  tables.release(1);                        // the second call's table answers first…
  await settle();
  tables.release(0);                        // …and the failed call's, late
  await settle(2000);
  expect(harness.events.filter((e) => e.includes('Hand 1 is dealt'))).toHaveLength(1);
  say('I call.');
  await answer(tool('a1', 'play_move', { words: 'I call' }), 3000);
  // Every request after setup went to one table: the second call's.
  expect(tableIds()).toHaveLength(1);
});

it("a late answer about the old table is never drawn over a fresh match's table", async () => {
  await sitDown();
  const moves = hold(/\/move$/);
  say('Raise to sixty.');
  void tool('m1', 'play_move', { words: 'raise to 60' });
  await settle();
  await hangUp();
  fireEvent.click(screen.getByRole('button', { name: 'Start a fresh match' }));
  await settle();
  act(() => harness.setPhase('live'));
  await settle(2000);
  moves.open();                             // the old table's raise lands, late
  await settle(3000);
  // The fresh table is on screen: its first hand, the player to call the blind.
  expect(screen.getByRole('button', { name: 'Call 10' })).toBeTruthy();
});

it("a button's answer that lands after hang-up tells nobody", async () => {
  await sitDown();
  fireEvent.click(screen.getByRole('button', { name: 'Call 10' }));
  await settle(100);                        // Dex's beat: the call ends before he plays
  const told = harness.events.length;
  await hangUp();
  await settle(5000);
  expect(harness.events.length).toBe(told);
  expect(requests.filter((r) => r.endsWith('/opponent'))).toHaveLength(0);
});

it("Dex's turn left by a hang-up is played once the next call is live, and told to it", async () => {
  await sitDown();
  fireEvent.click(screen.getByRole('button', { name: 'Call 10' }));
  await settle(100);
  await hangUp();
  await settle(5000);
  await callAgain();
  await settle(5000);
  expect(harness.events.at(-1)).toContain('The table played your move: you checked.');
});

it('a move still waiting for the player\'s words when the call ends is never played', async () => {
  await sitDown();
  let result = '';
  void tool('w1', 'play_move', { words: 'raise to 60' }).then((t) => { result = t; });
  await settle(500);
  await hangUp();
  say('Raise to sixty.');                   // a transcript that arrives after the hang-up
  await settle(5000);
  expect(requests.filter((r) => r.endsWith('/move'))).toHaveLength(1);
  expect(result).toMatch(/^Not played/);
  expect(screen.queryByText('Dex to act…')).toBeNull();
});

it("one call's words never back a move in the next call", async () => {
  await sitDown();
  say('Raise to sixty.');                   // said, but the call drops before Dex acts on it
  await hangUp();
  await callAgain();
  await settle(2000);
  const result = await answer(tool('n1', 'play_move', { words: 'raise to 60' }), 5000);
  expect(result).toMatch(/^Not played/);
  expect(screen.getByRole('button', { name: 'Call 10' })).toBeTruthy();
});

it('a table sound still pending when the page goes is never played', async () => {
  const { sounds } = await import('./sounds.ts');
  const flip = vi.spyOn(sounds, 'cardFlip');
  await sitDown();
  say('I call.');
  void tool('s1', 'play_move', { words: 'I call' });
  await settle(1450);                       // Dex's checks land and the flop appears; its flips are 280 ms out
  cleanup();
  await settle(2000);
  expect(flip).not.toHaveBeenCalled();
});
