// The server's routes, in-process, with the answer judge held back: an answer
// is graded only against the drill it was given for. While the judge is out,
// the learner (or the safety net) can start another drill, or the same one
// again; the late grade must change nothing.
import { beforeEach, expect, test, vi, type Mock } from 'vitest';

vi.mock('../../server/llm.ts', () => ({ llmAvailable: () => true, structured: vi.fn() }));
const { structured } = await import('../../server/llm.ts');
const server = (await import('./server.ts')).default;

type Handler = (req: { params: Record<string, string>; body: unknown }, res: unknown) => void | Promise<void>;
const routes: { method: string; re: RegExp; keys: string[]; handler: Handler }[] = [];
const add = (method: string) => (path: string, handler: Handler) => {
  const keys: string[] = [];
  routes.push({ method, keys, handler, re: new RegExp(`^${path.replace(/:(\w+)/g, (_, k: string) => { keys.push(k); return '([^/]+)'; })}$`) });
};
server.routes!({ post: add('POST'), get: add('GET') } as never);

async function call(method: string, path: string, body?: unknown): Promise<any> {
  for (const r of routes) {
    const m = r.method === method ? r.re.exec(path) : null;
    if (!m) continue;
    let json: unknown;
    const res = { status() { return res; }, json(b: unknown) { json = b; } };
    await r.handler({ params: Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]])), body }, res);
    return json;
  }
  throw new Error(`no route ${method} ${path}`);
}
const tool = (id: string, name: string, args: Record<string, unknown> = {}) => call('POST', `/drills/${id}/tool`, { name, arguments: args });

let release: (verdict: unknown) => void;
beforeEach(() => {
  (structured as Mock).mockReset().mockImplementation(() => new Promise((resolve) => { release = resolve; }));
});

/** A café drill at step 2, with an open answer sent to the judge and not yet back. */
async function pendingAnswer() {
  const { id } = await call('POST', '/drills', { scenario: 'adult_cardiac_arrest' });
  await tool(id, 'show_step');
  await tool(id, 'next_step');
  const late = tool(id, 'check_answer', { answer: 'watch his chest for breathing' });
  await vi.waitFor(() => expect(structured).toHaveBeenCalledOnce());
  return { id, late };
}

test('a judged answer is graded when its drill is still on screen', async () => {
  const { late } = await pendingAnswer();
  release({ correct: true, reason: 'the chest check' });
  expect((await late).result.startsWith('Right')).toBe(true);
});

test('another drill started while the judge is out gets no late grade', async () => {
  const { id, late } = await pendingAnswer();
  await tool(id, 'start_scenario', { scenario: 'choking' });
  release({ correct: true, reason: 'x' });
  const reply = await late;
  expect(reply.result.startsWith('Not graded')).toBe(true);
  expect(reply.view.scenario.id).toBe('choking_adult');
  expect(reply.view).toMatchObject({ phase: 'answering', step_index: 0, attempts: 0 });
});

test('the same drill started again and walked back to the same step: still no late grade', async () => {
  const { id, late } = await pendingAnswer();
  await tool(id, 'start_scenario', { scenario: 'adult' });
  await tool(id, 'show_step');
  await tool(id, 'next_step');
  release({ correct: true, reason: 'x' });
  const reply = await late;
  expect(reply.result.startsWith('Not graded')).toBe(true);
  expect(reply.view).toMatchObject({ phase: 'answering', step_index: 1, attempts: 0 });
});

test('leaving the drill while the judge is out: no late grade', async () => {
  const { id, late } = await pendingAnswer();
  await tool(id, 'leave_scenario');
  release({ correct: true, reason: 'x' });
  const reply = await late;
  expect(reply.result.startsWith('Not graded')).toBe(true);
  expect(reply.view.phase).toBe('intro');
});
