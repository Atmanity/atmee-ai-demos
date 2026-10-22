// @vitest-environment jsdom
//
// The page's half of the safety path, end to end in-process: the avatar kit is
// a recording fake, and fetch goes straight to the real engine (drill.ts) as
// the server would. What this pins: an emergency read in speech, in a typed
// line or in the answer box puts up the card and sends the line ONCE, even
// before (or without) the server; a typed emergency is never forwarded to the
// avatar as a turn to answer; and a spoken request the state already staged
// gets no second event.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act as drillAct } from '../engine/drill.ts';
import { EMERGENCY_LINE, SAFETY_LINE } from '../engine/lines.ts';
import { BlsTutor } from '../engine/tutor.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fake = vi.hoisted(() => ({
  phase: 'live' as string,
  events: [] as { text: string; ttl?: number }[],
  states: [] as string[],
  notes: [] as string[],
  says: [] as string[],
  records: [] as string[],
  handlers: {} as { onUserSaid?: (text: string, how: 'spoken' | 'typed') => void },
}));

vi.mock('../../../src/kit/index.ts', () => ({
  useAvatar: (_app: string, handlers: typeof fake.handlers) => {
    fake.handlers = handlers;
    return {
      phase: fake.phase,
      event: (text: string, ttl?: number) => fake.events.push({ text, ttl }),
      state: (text: string) => fake.states.push(text),
      note: (text: string) => fake.notes.push(text),
      say: (text: string) => fake.says.push(text),
      record: (text: string) => fake.records.push(text),
    };
  },
  AvatarStage: () => <div data-testid="stage" />,
  Transcript: () => null,
  Composer: ({ onSubmit }: { onSubmit: (text: string) => void }) => (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(((e.currentTarget.elements.namedItem('line') as HTMLInputElement).value)); }}>
      <input name="line" aria-label="composer" />
      <button type="submit">Send</button>
    </form>
  ),
}));

const { App } = await import('./App.tsx');

let tutor: BlsTutor;
let serverDown = false;

beforeEach(() => {
  fake.phase = 'live';
  for (const list of [fake.events, fake.states, fake.notes, fake.says, fake.records]) list.length = 0;
  serverDown = false;
  tutor = new BlsTutor();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (serverDown && !url.endsWith('/drills')) throw new TypeError('Failed to fetch');
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const json = url.endsWith('/drills') ? { id: 'd1', view: { ...tutor.snapshot(), staged: tutor.staged() } } : drillAct(tutor, body);
    return { ok: true, status: 200, json: async () => json } as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function ready() {
  render(<App />);
  await screen.findByText('Choose a scenario');
}
const spoken = (text: string) => act(async () => { fake.handlers.onUserSaid?.(text, 'spoken'); });
async function type(text: string) {
  fireEvent.change(screen.getByLabelText('composer'), { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
}
const emergencyEvents = () => fake.events.filter((e) => e.text.includes(EMERGENCY_LINE));

describe('the emergency path', () => {
  test('heard: the card, the exact line, one event, and the state', async () => {
    await ready();
    await spoken("he's not breathing");
    expect(screen.getByRole('alert').textContent).toContain(EMERGENCY_LINE);
    await waitFor(() => expect(tutor.phase).toBe('emergency'));
    expect(emergencyEvents()).toHaveLength(1);
    expect(emergencyEvents()[0].ttl).toBe(60);
    expect(fake.states.at(-1)).toContain('THE DRILL IS STOPPED');
  });

  test('typed: the card, and the line is recorded, never sent to the avatar as a turn', async () => {
    await ready();
    await type('my kid is not breathing');
    expect(screen.getByRole('alert')).toBeTruthy();
    await waitFor(() => expect(fake.records).toContain('my kid is not breathing'));
    expect(fake.says).toEqual([]);
    expect(emergencyEvents()).toHaveLength(1);
  });

  test('in the panel\'s answer box, before the grader', async () => {
    await ready();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Adult collapse/ })); });
    fireEvent.change(await screen.findByLabelText('What would you do?'), { target: { value: 'this is real, he collapsed' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Answer' })); });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(tutor.snapshot().phase).toBe('emergency');
    expect(emergencyEvents()).toHaveLength(1);
  });

  test('with the server unreachable, the card still goes up and the avatar is still told', async () => {
    await ready();
    serverDown = true;
    await spoken('she stopped breathing');
    expect(screen.getByRole('alert').textContent).toContain(EMERGENCY_LINE);
    expect(emergencyEvents()).toHaveLength(1);
    // ...and its button still takes it down.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Nobody is in danger/ })); });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('said once: a second report on the card sends nothing new', async () => {
    await ready();
    await spoken("he's not breathing");
    await spoken("he's still not breathing, what do I do");
    expect(emergencyEvents()).toHaveLength(1);
  });

  test('the way off: said plainly, the card goes and the avatar is told where practice resumes', async () => {
    await ready();
    await spoken("he's not breathing");
    await spoken("False alarm, nobody's hurt.");
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(fake.events.at(-1)!.text).toContain('glad everyone is safe');
    // A second, real report after that raises it again.
    await spoken('this is happening right now');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(emergencyEvents()).toHaveLength(2);
  });
});

describe('the drill', () => {
  test('the notes are queued, and each session opens with the safety line', async () => {
    fake.phase = 'idle';
    const { rerender } = render(<App />);
    await screen.findByText('Choose a scenario');
    expect(fake.notes.length).toBe(3);
    fake.phase = 'starting';
    rerender(<App />);
    await waitFor(() => expect(fake.events.some((e) => e.text.includes(SAFETY_LINE))).toBe(true));
  });

  test('a spoken "show me" was answered from the staged state: no second event; typed, it is said', async () => {
    await ready();
    await spoken("Let's do choking.");
    await waitFor(() => expect(tutor.phase).toBe('answering'));
    expect(fake.events).toEqual([]);   // the scene and first question were staged
    await spoken('Show me.');
    await waitFor(() => expect(tutor.phase).toBe('coaching'));
    expect(fake.events).toEqual([]);
    await spoken('next');
    await type('show me');
    await waitFor(() => expect(fake.events.length).toBe(1));
    expect(fake.records).toContain('show me');
  });

  test('typed talk goes to the avatar as a typed turn, and is not graded', async () => {
    await ready();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Adult collapse/ })); });
    await type('Can I have a hint?');
    await waitFor(() => expect(fake.says).toEqual(['Can I have a hint?']));
    expect(tutor.snapshot().attempts).toBe(0);
  });

  test('the avatar\'s state never carries the steps ahead', async () => {
    await ready();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Adult collapse/ })); });
    await waitFor(() => expect(fake.states.at(-1)).toContain('Step 1 of 7 is live'));
    expect(fake.states.join('\n')).not.toContain('Start chest compressions');
  });
});
