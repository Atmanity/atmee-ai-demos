// @vitest-environment jsdom
// The page's wiring, with the call faked and the server played by a real
// fitting over fake models: Emery's tool calls come back as the words she
// speaks from, buttons act at once and she is told, a try-on's picture and
// new score follow as events, the safety net acts only when she does not, and
// the photos the user adds reach her too when she takes files.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Fitting, intentOfButton, intentOfTool } from '../engine/fitting.ts';
import { ALL_BODY_ZONES } from '../engine/items.ts';
import type { CleanAnalysis } from '../engine/prompts.ts';
import { Stylist, type Models, type ReadInput } from '../engine/stylist.ts';
import type { Img, Milestone, Zone } from '../engine/types.ts';

const PHOTO = Buffer.alloc(400, 7).toString('base64');

const fake = vi.hoisted(() => ({
  states: [] as string[],
  events: [] as string[],
  starts: [] as unknown[],
  /** Whether the host takes files in the call, and the drops the page made. */
  filesAccepted: false,
  drops: [] as { names: string[]; caption?: string }[],
  handlers: {} as {
    onToolCall?: (call: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
    onUserSaid?: (text: string, how: 'spoken' | 'typed') => void;
    onLive?: () => void;
    onEnded?: () => void;
  },
  setPhase: undefined as undefined | ((phase: string) => void),
}));

vi.mock('../../../src/kit/index.ts', async () => {
  const { useToolNet } = await vi.importActual<typeof import('../../../src/kit/useToolNet.ts')>('../../../src/kit/useToolNet.ts');
  return {
    ...(await vi.importActual<typeof import('../../../src/kit/nav.tsx')>('../../../src/kit/nav.tsx')),
    ...(await vi.importActual<typeof import('../../../src/avatar/files.ts')>('../../../src/avatar/files.ts')),
    ...(({ REFUSED_WORDS, usePageDrop }) => ({ REFUSED_WORDS, usePageDrop }))(await vi.importActual<typeof import('../../../src/kit/files.tsx')>('../../../src/kit/files.tsx')),
    useToolNet,
    useAvatar: (_app: string, handlers: typeof fake.handlers) => {
      const [phase, setPhase] = useState('idle');
      fake.setPhase = setPhase;
      fake.handlers = handlers;
      return {
        phase, secondsLeft: null, micOn: false, speaking: false, caption: '',
        start: (opts: unknown) => { fake.starts.push(opts); setPhase('starting'); return Promise.resolve(); },
        state: (t: string) => fake.states.push(t),
        event: (t: string) => fake.events.push(t),
        say: () => {},
        filesAccepted: fake.filesAccepted,
        sendFiles: (files: File[], options?: { caption?: string }) => {
          fake.drops.push({ names: files.map((f) => f.name), caption: options?.caption });
          return Promise.resolve(files.map((f) => ({ name: f.name, status: 'ready' })));
        },
      };
    },
    HostVideo: ({ children }: { children?: ReactNode }) => <div className="host">{children}</div>,
    CallStatus: () => null,
    CallControls: () => null,
    ChatPanel: () => null,
    MicIcon: () => null,
  };
});

// The photo is prepared in the browser with a canvas, which jsdom has not got. Each file is its
// own picture (its bytes from its name), so the looks are told apart.
vi.mock('./photo.ts', async () => ({
  ...(await vi.importActual<typeof import('./photo.ts')>('./photo.ts')),
  preparePhoto: async (file: File) => {
    const bytes = new Uint8Array(400).fill([...file.name].reduce((n, c) => n + c.charCodeAt(0), 0) % 256);
    return { mime: 'image/jpeg', data: Buffer.from(bytes).toString('base64'), preview: `blob:${file.name}`, blob: new Blob([bytes], { type: 'image/jpeg' }) };
  },
}));

class FakeModels implements Models {
  tryOnAvailable = true;
  reads: ReadInput[] = [];
  scores: number[] = [];
  /** While set, a read waits for it: a slow model call the test lets go of. */
  hold: Promise<void> | null = null;
  async analyze(_image: Img, input: ReadInput): Promise<CleanAnalysis | null> {
    this.reads.push(input);
    if (this.hold) await this.hold;
    return { target_style: input.target, style_summary: 'Clean base', occasion: 'Dinner', style_score: this.scores.shift() ?? 6, color_palette: ['navy', 'white'], what_works: 'The navy layer frames you.', style_tip: 'Ground it with sharper shoes.' };
  }
  async zones(): Promise<Set<Zone>> { return new Set(ALL_BODY_ZONES); }
  async suggest() { return [{ item: 'Slim Navy Silk Tie', text: 'Sharpens the neckline.' }, { item: 'Camel Wool Topcoat', text: 'Adds structure.' }]; }
  async tryOn(): Promise<Img | null> { return { mime: 'image/jpeg', bytes: new Uint8Array(300).fill(1) }; }
}

/** The server's routes, over a real fitting. */
let models: FakeModels;
let fitting: Fitting;
let toolsSeen: string[];
let pressed: Record<string, unknown>[];   // the button presses that reached the server
// A look whose answer the network holds back (the server has done it, in order): released by the test.
let holdLook: { n: number; until: Promise<void> } | null;
async function server(input: unknown, init?: RequestInit) {
  const url = String(input);
  const reply = (data: unknown, status = 200) => ({ ok: status < 300, status, json: async () => data, blob: async () => new Blob([new Uint8Array(400)], { type: 'image/jpeg' }) });
  if (!url.startsWith('/api/apps/fashion-advisor')) return reply({});   // the example outfit's file
  const path = url.slice('/api/apps/fashion-advisor'.length);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (path === '/studios') {
    const stylist = new Stylist(models, { imageUrl: (t) => `/img/${t}` });
    stylist.nameSkipped = true;
    fitting = new Fitting(stylist);
    return reply({ id: 's1', view: fitting.view() });
  }
  if (path === '/studios/s1/tool') { toolsSeen.push(body.name); return reply(fitting.do(intentOfTool(body.name, body.arguments)!, { by: 'host' })); }
  if (path === '/studios/s1/act') {
    pressed.push(body);
    const b = intentOfButton(body)!;
    const done = fitting.do(b.intent, { by: 'user', pressed: b.pressed });
    if (holdLook && body.look?.n === holdLook.n) await holdLook.until;
    return reply(done);
  }
  const job = /^\/studios\/s1\/jobs\/([^/]+)\/([^/]+)$/.exec(path);
  if (job) return reply(await fitting.step(job[1], job[2] as Milestone));
  if (path === '/studios/s1') return reply({ view: fitting.view() });
  return reply({ error: 'not_found' }, 404);
}

import { App } from './App.tsx';

const lastState = () => fake.states[fake.states.length - 1] ?? '';
const tool = (name: string, args: Record<string, unknown> = {}) => act(() => fake.handlers.onToolCall!({ id: `t-${name}`, name, arguments: args })) as Promise<unknown>;

/** The front door, then a call by voice: the fitting room opens while Emery is on her way, and she arrives. */
async function inTheRoom() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /Talk to Emery/ }));
  await waitFor(() => expect(screen.getByText('Add a photo of your outfit')).toBeTruthy());
  act(() => fake.setPhase!('live'));
  act(() => fake.handlers.onLive!());
}

beforeEach(() => {
  fake.states.length = 0;
  fake.events.length = 0;
  fake.starts.length = 0;
  fake.drops.length = 0;
  fake.filesAccepted = false;
  models = new FakeModels();
  toolsSeen = [];
  pressed = [];
  holdLook = null;
  vi.stubGlobal('fetch', vi.fn(server));
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a fitting', () => {
  test('opens while Emery is on her way; in an empty room her own greeting is the opening (no second question)', async () => {
    await inTheRoom();
    expect(fake.starts).toEqual([{ mic: true }]);
    expect(fake.events).toEqual([]);
    expect(lastState()).toContain('The mirror is empty');
  });

  test('an occasion picked while she connects: her opening confirms it and asks for the photo, without greeting again', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Talk to Emery/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dinner out' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Dinner out' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Dressing for Dinner out/ })).toBeTruthy());
    expect(fake.events).toEqual([]);   // not in the call yet: nothing is told
    act(() => { fake.setPhase!('live'); fake.handlers.onLive!(); });
    expect(fake.events.at(-1)).toMatch(/^You have just greeted them; do not greet or introduce yourself again\..*confirm in a few words that they're dressing for Dinner out/);
  });

  test("Emery's rate_outfit: the occasion is set on screen and her result asks for the photo", async () => {
    await inTheRoom();
    const result = await tool('rate_outfit', { occasion: 'dinner out' });
    expect(result).toMatch(/^Done: the occasion is set to dinner out/);
    expect(screen.getByRole('button', { name: /Dressing for dinner out/ })).toBeTruthy();
    expect(lastState()).toContain('Dressing for: dinner out.');
  });

  test('the example outfit: a button, so Emery is told what was pressed and the verdict that came of it', async () => {
    await inTheRoom();
    await tool('rate_outfit', { occasion: 'dinner out' });
    fireEvent.click(screen.getByRole('button', { name: 'Use an example outfit' }));
    await waitFor(() => expect(screen.getByRole('img', { name: '6 out of 10' })).toBeTruthy());
    // At once: the photo is in the mirror. Then the verdict, once it is read.
    await waitFor(() => expect(fake.events).toContainEqual(expect.stringMatching(/^The user chose the example outfit on screen\. Done: the example outfit is in the mirror now, and Notch is reading it for dinner out/)));
    await waitFor(() => expect(fake.events.at(-1)).toMatch(/^The photo now in the mirror has been read\. Done: the verdict is 6 out of 10 for dinner out/));
    // Emery takes no files in this call: the example is not shown to her, and the board says so.
    expect(fake.drops).toEqual([]);
    expect(lastState()).toContain("You haven't seen it: don't describe it.");
    expect(screen.getByText('Ground it with sharper shoes.')).toBeTruthy();
    expect(lastState()).toContain('Your verdict: 6 out of 10');
  });

  test('a tool that reads: her result is the verdict itself, not a promise of one', async () => {
    await inTheRoom();
    fireEvent.click(screen.getByRole('button', { name: 'Use an example outfit' }));
    await waitFor(() => expect(lastState()).toContain('In the mirror: their own photo.'));
    const result = await tool('rate_outfit', { occasion: 'job interview' });
    expect(result).toMatch(/^Done: the verdict is 6 out of 10 for job interview/);
  });

  test('a try-on: started at once in her result; the picture and its new score follow as events', async () => {
    models.scores = [5, 7];
    await inTheRoom();
    await tool('rate_outfit', { occasion: 'dinner out' });
    fireEvent.click(screen.getByRole('button', { name: 'Use an example outfit' }));
    await waitFor(() => expect(screen.getByRole('img', { name: '5 out of 10' })).toBeTruthy());
    const result = await tool('try_on', { piece: 'the second one' });
    expect(result).toMatch(/^Started: putting the Camel Wool Topcoat on their photo now/);
    await waitFor(() => expect(fake.events.some((e) => e.includes('Done: the Camel Wool Topcoat is on their photo now'))).toBe(true));
    await waitFor(() => expect(fake.events.at(-1)).toContain('Done: with the Camel Wool Topcoat on, the outfit scores 7 out of 10'));
    expect(screen.getByText('+2 with the Camel Wool Topcoat')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to my photo' })).toBeTruthy();
  });

  test('a button with nothing to do yet still answers: Emery is told, nothing breaks', async () => {
    await inTheRoom();
    fireEvent.click(screen.getByRole('button', { name: 'Job interview' }));
    await waitFor(() => expect(fake.events.at(-1)).toMatch(/^The user picked "Job interview" as what they're dressing for on screen\. Done: the occasion is set to Job interview/));
  });

  test('the call ends: the notes open once there is a verdict', async () => {
    await inTheRoom();
    await tool('rate_outfit', { occasion: 'dinner out' });
    fireEvent.click(screen.getByRole('button', { name: 'Use an example outfit' }));
    await waitFor(() => expect(screen.getByRole('img', { name: '6 out of 10' })).toBeTruthy());
    act(() => { fake.setPhase!('ended'); fake.handlers.onEnded!(); });
    expect(screen.getByRole('dialog', { name: 'Your look for dinner out' })).toBeTruthy();
    expect(screen.getByText('Your fitting is done')).toBeTruthy();
    // Called back: the same fitting, and Emery is told so.
    fireEvent.click(screen.getByRole('button', { name: 'Back to the fitting room' }));
    act(() => { fake.setPhase!('live'); fake.handlers.onLive!(); });
    expect(fake.events.at(-1)).toMatch(/^You have just greeted them; do not greet or introduce yourself again\. They called you back to carry on the same fitting/);
    expect(screen.getByRole('img', { name: '6 out of 10' })).toBeTruthy();
  });
});

describe('photos Emery sees', () => {
  const photo = (name: string) => new File(['x'], name, { type: name.endsWith('.png') ? 'image/png' : 'image/jpeg' });
  const dropOnMirror = (files: File[]) => act(async () => { fireEvent.drop(document.querySelector('.nt-mirror-frame')!, { dataTransfer: { files } }); });
  const photoPresses = () => pressed.filter((b) => b.button === 'photo');
  const look = (n: number) => screen.getByRole('button', { name: new RegExp(`^Look ${n}`) });

  test('a few photos dropped on the mirror: all go to Emery in one drop, the first to Notch, the rest wait under the mirror; only the verdict is told', async () => {
    fake.filesAccepted = true;
    await inTheRoom();
    await tool('rate_outfit', { occasion: 'dinner out' });
    const told = fake.events.length;
    await dropOnMirror([photo('navy.jpg'), photo('camel.png'), photo('black.jpg')]);
    await waitFor(() => expect(screen.getByRole('img', { name: '6 out of 10' })).toBeTruthy());
    // One drop, each photo as the mirror shows it, with what the user is after.
    expect(fake.drops).toEqual([{ names: ['navy.jpg', 'camel.jpg', 'black.jpg'], caption: "3 outfits I'm choosing between for dinner out." }]);
    await waitFor(() => expect(screen.getByText('Emery has seen your 3 photos.')).toBeTruthy());
    // Notch reads the one in the mirror only.
    expect(photoPresses()).toEqual([expect.objectContaining({ look: { n: 1, of: 3, name: 'navy.jpg', picked: false }, shared: 'now' })]);
    expect(models.reads).toHaveLength(1);
    // She reacts to the drop herself: the page tells her the verdict alone, never that a photo came in.
    await waitFor(() => expect(fake.events).toHaveLength(told + 1));
    expect(fake.events.at(-1)).toMatch(/^Notch has read look 1 of 3 \("navy\.jpg"\), the one in the mirror\. Done: the verdict is 6 out of 10 for dinner out/);
    // The others wait under the mirror, and the board says what she has seen.
    expect(look(1).getAttribute('aria-pressed')).toBe('true');
    expect(look(1).textContent).toContain('6/10');
    expect(look(3)).toBeTruthy();
    expect(lastState()).toContain('In the mirror: their own photo (look 1). You have seen it');
    expect(lastState()).toContain('1. "navy.jpg" (in the mirror): 6/10; 2. "camel.jpg"; 3. "black.jpg".');
    expect(lastState()).not.toContain("You haven't seen");
  });

  test('another look into the mirror: Notch scores it, she is not shown it twice, and each look keeps its score', async () => {
    fake.filesAccepted = true;
    models.scores = [6, 8];
    await inTheRoom();
    await tool('rate_outfit', { occasion: 'dinner out' });
    await dropOnMirror([photo('navy.jpg'), photo('camel.jpg')]);
    await waitFor(() => expect(screen.getByRole('img', { name: '6 out of 10' })).toBeTruthy());
    fireEvent.click(look(2));
    await waitFor(() => expect(screen.getByRole('img', { name: '8 out of 10' })).toBeTruthy());
    expect(fake.drops).toHaveLength(1);
    // She saw it in the drop: told it is in, then its verdict.
    expect(fake.events).toContainEqual(expect.stringMatching(/^The user put look 2 of 2 \("camel\.jpg"\) in the mirror on screen\. Done: .*you saw it when they shared it, but never guess its score/));
    await waitFor(() => expect(fake.events.at(-1)).toMatch(/^The photo now in the mirror has been read\. Done: the verdict is 8 out of 10 for dinner out/));
    expect(look(1).textContent).toContain('6/10');
    // Back to the first: the same picture keeps its verdict, with no second read.
    const reads = models.reads.length;
    fireEvent.click(look(1));
    await waitFor(() => expect(screen.getByRole('img', { name: '6 out of 10' })).toBeTruthy());
    expect(models.reads).toHaveLength(reads);
    await waitFor(() => expect(lastState()).toContain('1. "navy.jpg" (in the mirror): 6/10; 2. "camel.jpg": 8/10.'));
  });

  test('a new set dropped while a look is on its way: the late answer for the old look is let go, never shown or told', async () => {
    fake.filesAccepted = true;
    models.scores = [6, 8, 7];
    await inTheRoom();
    await tool('rate_outfit', { occasion: 'dinner out' });
    await dropOnMirror([photo('navy.jpg'), photo('camel.jpg')]);
    await waitFor(() => expect(screen.getByRole('img', { name: '6 out of 10' })).toBeTruthy());
    let release!: () => void;
    holdLook = { n: 2, until: new Promise<void>((resolve) => { release = resolve; }) };
    fireEvent.click(look(2));
    await waitFor(() => expect(pressed.at(-1)).toMatchObject({ look: { n: 2, name: 'camel.jpg' } }));
    holdLook = { n: 99, until: holdLook.until };   // only that one answer is held
    await dropOnMirror([photo('linen.jpg'), photo('denim.jpg')]);
    await waitFor(() => expect(look(1).textContent).toContain('In the mirror'));
    await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(look(1).textContent).toContain('In the mirror');
    expect(fake.events.join('\n')).not.toMatch(/camel\.jpg/);
  });

  test('photos dropped anywhere on the page go to the mirror as on it, and the browser never opens them', async () => {
    fake.filesAccepted = true;
    models.scores = [7];
    await inTheRoom();
    await tool('rate_outfit', { occasion: 'dinner out' });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [photo('navy.jpg')] } });
    await act(async () => { document.querySelector('.nt-looks, .nt-verdict, main')!.dispatchEvent(drop); });
    expect(drop.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.getByRole('img', { name: '7 out of 10' })).toBeTruthy());
    expect(pressed.some((body) => body.button === 'photo')).toBe(true);
    expect(fake.drops).toHaveLength(1);
  });

  test('the example outfit is shown to her too, and only its verdict is told', async () => {
    fake.filesAccepted = true;
    await inTheRoom();
    await tool('rate_outfit', { occasion: 'dinner out' });
    const told = fake.events.length;
    fireEvent.click(screen.getByRole('button', { name: 'Use an example outfit' }));
    await waitFor(() => expect(fake.events).toHaveLength(told + 1));
    expect(fake.drops).toEqual([{ names: ['example-outfit.jpg'], caption: 'The example outfit for dinner out.' }]);
    expect(fake.events.at(-1)).toMatch(/^Notch has read the example outfit, the one in the mirror\. Done: the verdict is 6 out of 10/);
    expect(screen.queryByRole('region', { name: 'Your looks' })).toBeNull();   // one photo is no choice
  });

  test('when Emery takes no files: nothing goes to her; the photos still go to the mirror, told as what was pressed', async () => {
    await inTheRoom();
    await tool('rate_outfit', { occasion: 'dinner out' });
    await dropOnMirror([photo('navy.jpg'), photo('camel.jpg')]);
    await waitFor(() => expect(screen.getByRole('img', { name: '6 out of 10' })).toBeTruthy());
    expect(fake.drops).toEqual([]);
    expect(fake.events).toContainEqual(expect.stringMatching(/^The user added 2 outfit photos to choose between on screen\. Done: look 1 of 2 \("navy\.jpg"\) is in the mirror now.*don't guess anything about it/));
    expect(lastState()).toContain("You haven't seen it: don't describe it.");
    expect(lastState()).toContain("You haven't seen looks 1, 2.");
    expect(screen.queryByRole('button', { name: 'Show it to Emery' })).toBeNull();
    // The looks still change places, through Notch alone.
    fireEvent.click(look(2));
    await waitFor(() => expect(photoPresses()).toHaveLength(2));
    expect(photoPresses()[1]).not.toHaveProperty('shared');
    expect(fake.drops).toEqual([]);
  });

  test('more than a drop holds: nothing goes anywhere, and the user is told', async () => {
    fake.filesAccepted = true;
    await inTheRoom();
    await dropOnMirror(Array.from({ length: 11 }, (_, i) => photo(`look${i}.jpg`)));
    expect(screen.getByText('At most 10 photos at a time.')).toBeTruthy();
    expect(fake.drops).toEqual([]);
    expect(photoPresses()).toEqual([]);
  });

  test('the invitation goes to Emery alone: never to the mirror or to Notch', async () => {
    fake.filesAccepted = true;
    await inTheRoom();
    fireEvent.change(screen.getByLabelText('Share the invitation'), { target: { files: [new File(['%PDF'], 'invite.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(screen.getByText('Emery has seen the invitation.')).toBeTruthy());
    expect(fake.drops).toEqual([{ names: ['invite.pdf'], caption: "The invitation: it says what I'm dressing for." }]);
    expect(pressed).toEqual([]);
    expect(screen.getByText('Add a photo of your outfit')).toBeTruthy();
    expect(fake.events).toEqual([]);
  });
});

describe('the safety net', () => {
  async function rated() {
    await inTheRoom();
    await tool('rate_outfit', { occasion: 'dinner out' });
    fireEvent.click(screen.getByRole('button', { name: 'Use an example outfit' }));
    await waitFor(() => expect(screen.getByRole('img', { name: '6 out of 10' })).toBeTruthy());
    toolsSeen.length = 0;
    // A while later: Emery's last call is old news, and the net's 7 s are counted on a fake clock.
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    await act(() => vi.advanceTimersByTimeAsync(20_000));
  }

  test('"rate me for a wedding" with no call from Emery: the fitting rates it and tells her', async () => {
    await rated();
    act(() => fake.handlers.onUserSaid!('Rate me for a wedding instead.', 'spoken'));
    await act(() => vi.advanceTimersByTimeAsync(7100));
    expect(toolsSeen).toEqual(['rate_outfit']);
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(fake.events.at(-1)).toMatch(/^You did not call rate_outfit, so the app did it for the player just now: Done: the verdict is 6 out of 10 for wedding/);
  });

  test('Emery called it herself: nothing twice', async () => {
    await rated();
    act(() => fake.handlers.onUserSaid!('Rate me for a wedding instead.', 'spoken'));
    await tool('rate_outfit', { occasion: 'wedding' });
    await act(() => vi.advanceTimersByTimeAsync(7100));
    expect(toolsSeen).toEqual(['rate_outfit']);
  });

  test('Emery acted on the words her own way (another tool): the net leaves it', async () => {
    await rated();
    act(() => fake.handlers.onUserSaid!('How would this do for a dinner party?', 'spoken'));
    await tool('suggest_pieces', { direction: 'dressier' });
    await act(() => vi.advanceTimersByTimeAsync(7100));
    expect(toolsSeen).toEqual(['suggest_pieces']);
  });

  test('never for more pieces or a try-on', async () => {
    await rated();
    act(() => fake.handlers.onUserSaid!('More ideas please', 'spoken'));
    act(() => fake.handlers.onUserSaid!('Put the topcoat on me', 'spoken'));
    await act(() => vi.advanceTimersByTimeAsync(7100));
    expect(toolsSeen).toEqual([]);
  });
});

describe("one call's work stays in that call", () => {
  /** A fitting with its verdict, then a read that is held until the test lets go. */
  async function heldRead() {
    await inTheRoom();
    await tool('rate_outfit', { occasion: 'dinner out' });
    fireEvent.click(screen.getByRole('button', { name: 'Use an example outfit' }));
    await waitFor(() => expect(screen.getByRole('img', { name: '6 out of 10' })).toBeTruthy());
    let release!: () => void;
    models.hold = new Promise<void>((r) => { release = r; });
    models.scores = [3];
    return () => { models.hold = null; release(); };
  }
  /** Hang up, then call Emery again: the same fitting, a new call. */
  function callAgain() {
    act(() => { fake.setPhase!('ended'); fake.handlers.onEnded!(); });
    act(() => fake.setPhase!('starting'));
    act(() => { fake.setPhase!('live'); fake.handlers.onLive!(); });
  }

  test("a tool's late result from the last call is not told in the next one; the board still follows", async () => {
    const release = await heldRead();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const answer = fake.handlers.onToolCall!({ id: 't-late', name: 'rate_outfit', arguments: { occasion: 'wedding' } });
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(await answer).toMatch(/^Not yet: still working/);
    callAgain();
    const told = fake.events.length;
    release();
    vi.useRealTimers();
    await waitFor(() => expect(screen.getAllByRole('img', { name: '3 out of 10' }).length).toBeGreaterThan(0));   // the fitting's screen is current
    expect(fake.events.slice(told).join(' ')).not.toMatch(/just landed|3 out of 10/);
  });

  test("a button's verdict started between calls is not told in the next call (its opening covers the screen)", async () => {
    const release = await heldRead();
    act(() => { fake.setPhase!('ended'); fake.handlers.onEnded!(); });
    fireEvent.click(screen.getByRole('button', { name: 'Back to the fitting room' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rate it for something else' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wedding guest' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Dressing for Wedding guest/ })).toBeTruthy());
    act(() => fake.setPhase!('starting'));
    act(() => { fake.setPhase!('live'); fake.handlers.onLive!(); });
    const told = fake.events.length;
    release();
    await waitFor(() => expect(screen.getByRole('img', { name: '3 out of 10' })).toBeTruthy());
    expect(fake.events.slice(told).join(' ')).not.toMatch(/The user picked "Wedding guest"/);
  });

  test('a tool waiting on slow work leaves no timer behind when the call ends, or when the page goes', async () => {
    const release = await heldRead();
    const set = vi.spyOn(globalThis, 'setTimeout');
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    /** The id of the newest 20 s wait for a verdict, once it is set. */
    const waitTimer = async (after: number) => {
      await waitFor(() => expect(set.mock.calls.slice(after).some((c) => c[1] === 20_000)).toBe(true));
      const i = set.mock.calls.findIndex((c, n) => n >= after && c[1] === 20_000);
      return set.mock.results[i].value;
    };
    void fake.handlers.onToolCall!({ id: 't-wait', name: 'rate_outfit', arguments: { occasion: 'wedding' } });
    const first = await waitTimer(0);
    act(() => { fake.setPhase!('ended'); fake.handlers.onEnded!(); });
    expect(clear).toHaveBeenCalledWith(first);
    act(() => fake.setPhase!('starting'));
    act(() => { fake.setPhase!('live'); fake.handlers.onLive!(); });
    const before = set.mock.calls.length;
    void fake.handlers.onToolCall!({ id: 't-wait-2', name: 'rate_outfit', arguments: { occasion: 'job interview' } });
    const second = await waitTimer(before);
    cleanup();
    expect(clear).toHaveBeenCalledWith(second);
    release();
  });
});
