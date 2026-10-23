// @vitest-environment jsdom
//
// The page end to end, in-process: the real server routes (server.ts) behind a
// stubbed fetch, the kit's real safety net, and a recording fake for the call.
// What this pins: the front door, a drill driven by Alex's tool calls and by
// buttons, the screen never answering its own question, the red card going up
// the instant the words arrive (and Alex told exactly once), the card coming
// down only on the learner's own words or button, and the safety net doing
// what Alex forgot without ever doubling what he did.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { EMERGENCY_LINE, SAFETY_LINE } from '../engine/lines.ts';
import { ADULT_CARDIAC_ARREST, CHOKING_ADULT, RECOVERY_POSITION } from '../engine/scenarios.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handlers = { onUserSaid?: (text: string, how: 'spoken' | 'typed') => void; onToolCall?: (call: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<unknown> };
const fake = vi.hoisted(() => ({
  phase: 'idle' as string,
  events: [] as { text: string; ttl?: number }[],
  states: [] as string[],
  says: [] as string[],
  records: [] as string[],
  starts: [] as unknown[],
  handlers: {} as Handlers,
}));

vi.mock('../../../src/kit/index.ts', async () => {
  const { useToolNet } = await vi.importActual<typeof import('../../../src/kit/useToolNet.ts')>('../../../src/kit/useToolNet.ts');
  return {
    ...(await vi.importActual<typeof import('../../../src/kit/nav.tsx')>('../../../src/kit/nav.tsx')),
    useToolNet,
    useAvatar: (_app: string, handlers: Handlers) => {
      fake.handlers = handlers;
      return {
        phase: fake.phase, caption: '', micOn: false, lines: [], heard: '',
        start: async (opts: unknown) => { fake.starts.push(opts); },
        event: (text: string, ttl?: number) => fake.events.push({ text, ttl }),
        state: (text: string) => fake.states.push(text),
        say: (text: string) => { fake.says.push(text); handlers.onUserSaid?.(text, 'typed'); },
        record: (text: string) => fake.records.push(text),
        note: () => {},
      };
    },
    HostVideo: ({ poster }: { poster?: string }) => <div data-testid="host" data-poster={poster ?? ''} />,
    CallStatus: () => null,
    CallControls: () => null,
    ChatPanel: ({ onSubmit }: { onSubmit: (text: string) => void }) => (
      <form onSubmit={(e) => { e.preventDefault(); onSubmit((e.currentTarget.elements.namedItem('line') as HTMLInputElement).value); }}>
        <input name="line" aria-label="Message Alex" />
        <button type="submit">Send</button>
      </form>
    ),
  };
});

// No model in these tests: open answers stay "Not yet", as with no key.
vi.mock('../../../server/llm.ts', () => ({ llmAvailable: () => false, structured: vi.fn() }));

const { App } = await import('./App.tsx');
const server = (await import('../server.ts')).default;

// The server's routes, reached through fetch without a network.
type Handler = (req: { params: Record<string, string>; body: unknown }, res: unknown) => void | Promise<void>;
const routes: { method: string; re: RegExp; keys: string[]; handler: Handler }[] = [];
const add = (method: string) => (path: string, handler: Handler) => {
  const keys: string[] = [];
  routes.push({ method, keys, handler, re: new RegExp(`^${path.replace(/:(\w+)/g, (_, k: string) => { keys.push(k); return '([^/]+)'; })}$`) });
};
server.routes!({ post: add('POST'), get: add('GET') } as never);

let serverDown = false;
let drillId: string | null = null;
// Requests the test holds back until it releases them: an answer that arrives late.
let hold: ((path: string, method: string) => boolean) | null = null;
const held: (() => void)[] = [];
const release = () => act(async () => { for (const go of held.splice(0)) go(); await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  fake.phase = 'idle';
  for (const list of [fake.events, fake.states, fake.says, fake.records, fake.starts]) list.length = 0;
  serverDown = false;
  drillId = null;
  hold = null;
  held.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (serverDown) throw new TypeError('Failed to fetch');
    const path = url.replace('/api/apps/bls-tutor', '');
    const method = init?.method ?? 'GET';
    if (hold?.(path, method)) await new Promise<void>((go) => held.push(go));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    for (const r of routes) {
      const m = r.method === method ? r.re.exec(path) : null;
      if (!m) continue;
      let status = 200;
      let json: unknown;
      const res = { status(c: number) { status = c; return res; }, json(b: unknown) { json = b; } };
      await r.handler({ params: Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]])), body }, res);
      if (path === '/drills') drillId = (json as { id: string }).id;
      return { ok: status < 400, status, json: async () => json } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

/** The front door, a drill picked, "Start by typing", Alex on his way, then live. */
async function begin(drill: RegExp = /Adult collapse in a café/, firstQuestion = ADULT_CARDIAC_ARREST.steps[0].prompt) {
  const view = render(<App />);
  fireEvent.click(screen.getByLabelText(drill));
  fireEvent.click(screen.getByRole('button', { name: 'Start by typing' }));
  expect(fake.starts).toEqual([{ mic: false }]);
  fake.phase = 'starting';
  view.rerender(<App />);
  await screen.findByText(firstQuestion);
  fake.phase = 'live';
  view.rerender(<App />);
  return view;
}

let calls = 0;
const tool = (name: string, args: Record<string, unknown> = {}) =>
  act(async () => String(await fake.handlers.onToolCall!({ id: `t${++calls}`, name, arguments: args })));
const spoken = (text: string) => act(async () => { fake.handlers.onUserSaid!(text, 'spoken'); });
async function type(text: string) {
  fireEvent.change(screen.getByLabelText('Message Alex'), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
}
const press = (name: string | RegExp) => act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
const lineEvents = () => fake.events.filter((e) => e.text.includes(EMERGENCY_LINE));
const pageText = () => document.body.textContent ?? '';
/** Words that never belong on screen in a product. */
const BACKSTAGE = /\b(session|avatar|api|atmee|demo|sample|mini-app|tool|event|state)\b/i;

describe('the front door', () => {
  test('what it is, how it works, the drills, the way in, the numbers to call, and that it is practice', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Be the bystander who knows what to do.');
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Start with your voice' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start by typing' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Practice, not certification' })).toBeTruthy();
    expect(pageText()).toContain(SAFETY_LINE);
    expect(document.querySelector('a[href="tel:911"]')).toBeTruthy();
    expect(document.querySelector('a[href="tel:112"]')).toBeTruthy();
    expect(pageText()).not.toMatch(BACKSTAGE);
  });

  test('the visitor sees who they will talk to: Alex\'s face beside his name', () => {
    render(<App />);
    const tag = document.querySelector('.by-host-tag')!;
    expect(tag.textContent).toBe('Your instructor Alex · paramedic');
    const img = tag.querySelector('img')!;
    expect(img.getAttribute('src')).toMatch(/portrait/);
    expect(img.getAttribute('alt')).toBe('');   // the name sits beside it
  });

  test('the voice button asks for the microphone', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Start with your voice' }));
    expect(fake.starts).toEqual([{ mic: true }]);
  });
});

describe('a drill', () => {
  test('the chosen drill is ready while Alex is on his way; he opens with the safety line and its first question', async () => {
    await begin(/Choking at a dinner table/, CHOKING_ADULT.steps[0].prompt);
    const opening = fake.events[0];
    expect(opening.text.startsWith('You have just greeted them')).toBe(true);
    expect(opening.text).toContain(SAFETY_LINE);
    expect(opening.text).toContain(CHOKING_ADULT.steps[0].prompt);
    expect(opening.ttl).toBe(60);
    expect(fake.states.at(-1)).toContain('Step 1 of 6, waiting for their answer');
    // Alex's face fills the frame while the call connects.
    expect(screen.getByTestId('host').getAttribute('data-poster')).toMatch(/portrait/);
    expect(pageText()).toContain(SAFETY_LINE);
    expect(pageText()).not.toMatch(BACKSTAGE);
  });

  test('Alex grades a spoken answer with check_answer: the result carries the verdict, the screen follows', async () => {
    await begin();
    const result = await tool('check_answer', { answer: 'make sure the scene is safe' });
    expect(result).toContain('RIGHT');
    expect(result).toContain(ADULT_CARDIAC_ARREST.steps[0].teach);
    expect(screen.getByText('You got it')).toBeTruthy();
    expect(screen.getAllByText(ADULT_CARDIAC_ARREST.steps[0].label).length).toBeGreaterThan(0);
    expect(fake.states.at(-1)).toContain('Step 1 of 7 is done');
  });

  test('a wrong answer shows the nudge and the tries left, never the step', async () => {
    await begin();
    await tool('check_answer', { answer: 'I would phone his wife' });
    expect(screen.getByText('Not yet')).toBeTruthy();
    expect(screen.getByText(ADULT_CARDIAC_ARREST.steps[0].hint)).toBeTruthy();
    expect(pageText()).toContain('1 of 2 tries');
    expect(pageText()).not.toContain(ADULT_CARDIAC_ARREST.steps[0].label);
  });

  test('buttons act at once and Alex is told: a hint, then the next step', async () => {
    await begin();
    await press('Give me a hint');
    expect(screen.getByText(ADULT_CARDIAC_ARREST.steps[0].hint)).toBeTruthy();
    expect(fake.events.at(-1)!.text).toContain('pressed "Give me a hint"');
    expect(fake.states.at(-1)).toContain(ADULT_CARDIAC_ARREST.steps[0].hint);
    await tool('show_step');
    await press(/Next step/);
    expect(screen.getByText(ADULT_CARDIAC_ARREST.steps[1].prompt)).toBeTruthy();
    expect(fake.events.at(-1)!.text).toContain('pressed "Next step"');
    expect(fake.events.at(-1)!.text).toContain(ADULT_CARDIAC_ARREST.steps[1].prompt);
  });

  test('the screen never shows the answer to the question it asks, nor anything ahead', async () => {
    await begin();
    for (let i = 0; i < ADULT_CARDIAC_ARREST.steps.length - 1; i++) {
      for (const step of ADULT_CARDIAC_ARREST.steps.slice(i)) {
        expect(pageText(), step.key).not.toContain(step.label);
        expect(pageText(), step.key).not.toContain(step.teach);
      }
      expect(fake.states.at(-1)).not.toContain(ADULT_CARDIAC_ARREST.steps[i].label);
      await tool('show_step');
      await tool('next_step');
    }
  });

  test('the beat appears only once the compressions step is taught', async () => {
    await begin();
    for (let i = 0; i < 3; i++) { await tool('show_step'); await tool('next_step'); }
    expect(screen.getByText(ADULT_CARDIAC_ARREST.steps[3].prompt)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Practise to the beat/ })).toBeNull();
    await tool('show_step');
    expect(screen.getByRole('button', { name: /Practise to the beat · 110 a minute/ })).toBeTruthy();
  });

  test('the review names every step and how it went, and offers the next drill', async () => {
    await begin(/Unresponsive but breathing/, RECOVERY_POSITION.steps[0].prompt);
    await tool('check_answer', { answer: 'tap and shout and check his breathing' });
    await tool('next_step');
    for (let i = 1; i < RECOVERY_POSITION.steps.length; i++) { await tool('show_step'); await tool('next_step'); }
    expect(screen.getByText('Drill complete · Unresponsive but breathing')).toBeTruthy();
    for (const step of RECOVERY_POSITION.steps) expect(screen.getByText(step.label)).toBeTruthy();
    expect(screen.getAllByText('Shown to you')).toHaveLength(4);
    expect(screen.getAllByText('Got it')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Run this drill again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Choking at a dinner table/ })).toBeTruthy();
  });

  test('leaving goes back to the list of drills; picking one there starts it and tells Alex', async () => {
    await begin();
    await press('Choose another drill');
    expect(screen.getByRole('heading', { name: 'Choose a drill' })).toBeTruthy();
    await press(/Choking at a dinner table/);
    expect(screen.getByText(CHOKING_ADULT.steps[0].prompt)).toBeTruthy();
    expect(fake.events.at(-1)!.text).toContain('pressed "Choking at a dinner table"');
  });
});

describe('the red card', () => {
  test('heard: up at once; when Alex calls stop_for_emergency himself, the page adds no second line', async () => {
    await begin();
    vi.useFakeTimers();
    await spoken("he's not breathing");
    expect(screen.getByRole('alert').textContent).toContain(EMERGENCY_LINE);
    expect(document.querySelector('.by-emergency a[href="tel:911"]')).toBeTruthy();
    expect(await tool('stop_for_emergency')).toContain(EMERGENCY_LINE);
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    expect(lineEvents()).toHaveLength(0);
    expect(fake.states.at(-1)).toContain('THE DRILL IS STOPPED');
  });

  test('heard, and Alex does not act: the page tells him after a moment, once', async () => {
    await begin();
    vi.useFakeTimers();
    await spoken('she stopped breathing');
    expect(screen.getByRole('alert')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    expect(lineEvents()).toHaveLength(1);
    expect(lineEvents()[0].ttl).toBe(60);
    await spoken("she's still not breathing");
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    expect(lineEvents()).toHaveLength(1);
  });

  test('typed: the card, the line kept in the conversation but never sent as a turn, Alex told at once', async () => {
    await begin();
    await type('my kid is not breathing');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(fake.records).toEqual(['my kid is not breathing']);
    expect(fake.says).toEqual([]);
    expect(lineEvents()).toHaveLength(1);
    expect(lineEvents()[0].text).toContain('typed "my kid is not breathing"');
  });

  test('Alex\'s own judgement is a second way to the card', async () => {
    await begin();
    expect(await tool('stop_for_emergency')).toContain(EMERGENCY_LINE);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(await tool('show_step')).toContain('call 911 now');
  });

  test('an answer that reads as an emergency puts it up through the drill too', async () => {
    await begin();
    expect(await tool('check_answer', { answer: 'this is real, he collapsed' })).toContain(EMERGENCY_LINE);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  test('Alex cannot talk anyone off it: resume_practice needs the learner\'s own plain words', async () => {
    await begin();
    await spoken("he's not breathing");
    expect(await tool('resume_practice')).toContain('Refused: the red card stays up');
    expect(screen.getByRole('alert')).toBeTruthy();
    await spoken("False alarm, nobody's hurt.");
    expect(await tool('resume_practice')).toContain('glad everyone is safe');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(ADULT_CARDIAC_ARREST.steps[0].prompt)).toBeTruthy();
  });

  test('its own button takes it down, even with the server unreachable', async () => {
    await begin();
    await spoken('this is happening right now');
    serverDown = true;
    await press(/Nobody is in danger/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('typed practice that only sounds clinical goes to Alex as a turn', async () => {
    await begin();
    await type("I'd check if he's breathing");
    expect(fake.says).toEqual(["I'd check if he's breathing"]);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the safety net', () => {
  test('"show me" with no call from Alex: after a moment the page shows the step and tells him', async () => {
    await begin();
    vi.useFakeTimers();
    await spoken('Show me.');
    await act(async () => { await vi.advanceTimersByTimeAsync(7500); });
    expect(screen.getByText(ADULT_CARDIAC_ARREST.steps[0].label, { selector: '.by-label' })).toBeTruthy();
    expect(fake.events.at(-1)!.text).toContain('You did not call show_step');
  });

  test('it stands down when Alex made the call', async () => {
    await begin();
    vi.useFakeTimers();
    await spoken('Show me.');
    await tool('show_step');
    await act(async () => { await vi.advanceTimersByTimeAsync(7500); });
    expect(fake.events.some((e) => e.text.includes('You did not call'))).toBe(false);
  });

  test('it stands down when the drill moved some other way since the words', async () => {
    await begin();
    vi.useFakeTimers();
    await spoken("I don't know");
    await tool('check_answer', { answer: 'look in his wallet' });   // Alex graded it instead: an attempt was used
    await act(async () => { await vi.advanceTimersByTimeAsync(7500); });
    expect(fake.events.some((e) => e.text.includes('You did not call'))).toBe(false);
    expect(screen.getByText('Not yet')).toBeTruthy();
  });

  test('the way off the card, said plainly, works even when Alex forgets resume_practice', async () => {
    await begin();
    vi.useFakeTimers();
    await spoken("he's not breathing");
    await tool('stop_for_emergency');
    // The host talks for a few seconds before the next words: a call that long ago is the last turn's, not a reply to them.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await spoken("Sorry, false alarm, nobody's hurt.");
    await act(async () => { await vi.advanceTimersByTimeAsync(7500); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fake.events.at(-1)!.text).toContain('You did not call resume_practice');
  });

  test('answers are never the net\'s: an unanswered "I\'d check the scene" stays ungraded', async () => {
    await begin();
    vi.useFakeTimers();
    await spoken("I'd check the scene is safe");
    await act(async () => { await vi.advanceTimersByTimeAsync(7500); });
    expect(screen.getByText(ADULT_CARDIAC_ARREST.steps[0].prompt)).toBeTruthy();
    expect(fake.events.some((e) => e.text.includes('You did not call'))).toBe(false);
  });
});

test('calling Alex again picks up the same drill where it was', async () => {
  const view = await begin();
  await tool('show_step');
  await tool('next_step');
  const first = drillId;
  fake.phase = 'ended';
  view.rerender(<App />);
  fake.phase = 'starting';
  view.rerender(<App />);
  await waitFor(() => expect(fake.events.at(-1)!.text).toContain(ADULT_CARDIAC_ARREST.steps[1].prompt));
  expect(drillId).toBe(first);
  expect(fake.events.at(-1)!.text).toContain(SAFETY_LINE);
});

// Nothing started for one call acts on another: a late answer, a timer or a
// flag from a call that ended (or was replaced) never reaches the screen or Alex.
describe('one call at a time', () => {
  /** The front door, a drill picked, the call placed; the set-up is held back. */
  function placeCall() {
    hold = (path, method) => path === '/drills' && method === 'POST';
    const view = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Start by typing' }));
    fake.phase = 'starting';
    view.rerender(<App />);
    return view;
  }

  test('a set-up that answers after the call failed is dropped: no drill on screen, no opening', async () => {
    const view = placeCall();
    fake.phase = 'failed';
    view.rerender(<App />);
    await release();
    expect(fake.events).toEqual([]);
    expect(screen.queryByText(ADULT_CARDIAC_ARREST.steps[0].prompt)).toBeNull();
    expect(screen.getByText(/Call Alex again to start your drill/)).toBeTruthy();
  });

  test('a set-up that answers after a newer call began is dropped: one opening, the newer call\'s', async () => {
    const view = placeCall();
    fake.phase = 'ended';
    view.rerender(<App />);
    fake.phase = 'starting';
    view.rerender(<App />);   // the second call's set-up is held too
    await release();
    expect(fake.events.filter((e) => e.text.startsWith('You have just greeted them'))).toHaveLength(1);
  });

  test('a tool answer that arrives after the call ended does not move the screen', async () => {
    const view = await begin();
    hold = (path) => path.endsWith('/tool');
    let result: Promise<unknown> | null = null;
    await act(async () => { result = fake.handlers.onToolCall!({ id: 'late', name: 'show_step', arguments: {} }); });
    fake.phase = 'ended';
    view.rerender(<App />);
    await release();
    await result;
    expect(screen.queryByText('Shown to you')).toBeNull();
    expect(screen.getByText(ADULT_CARDIAC_ARREST.steps[0].prompt)).toBeTruthy();
  });

  test('a button answer that arrives after the call ended is not told to Alex', async () => {
    const view = await begin();
    hold = (path) => path.endsWith('/act');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Give me a hint' })); });
    fake.phase = 'ended';
    view.rerender(<App />);
    const before = fake.events.length;
    await release();
    expect(fake.events.length).toBe(before);
    expect(screen.queryByText(ADULT_CARDIAC_ARREST.steps[0].hint)).toBeNull();
  });

  test('the page\'s 911 reminder belongs to its call: a hang-up cancels it', async () => {
    const view = await begin();
    vi.useFakeTimers();
    await spoken("he's not breathing");
    fake.phase = 'ended';
    view.rerender(<App />);
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    expect(lineEvents()).toHaveLength(0);
    // The card itself stays: someone may have hung up to call 911.
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  test('a new call starts from the screen: with the red card up, it opens with the 911 sentence, not the drill', async () => {
    const view = await begin();
    serverDown = true;
    await spoken("he's not breathing");   // the drill never heard the stop
    serverDown = false;
    fake.phase = 'ended';
    view.rerender(<App />);
    fake.phase = 'starting';
    view.rerender(<App />);
    await waitFor(() => expect(fake.events.at(-1)!.text.startsWith(EMERGENCY_LINE)).toBe(true));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(await tool('show_step')).toContain('call 911 now');   // the drill is stopped too
  });
});
