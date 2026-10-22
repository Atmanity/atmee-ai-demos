// BLS Tutor's server side: it owns each learner's drill, because the scenario
// content holds every step's answer (a step's label IS the answer to the
// question on screen) and the page must only ever see the stripped snapshot.
// No model calls and no keys: grading is substring matching against static
// AHA/ERC sequences, and which action a line is gets decided by rules.
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { act, viewOf } from './engine/drill.ts';
import { BlsTutor } from './engine/tutor.ts';
import type { Intent, Source } from './engine/types.ts';

const ID = 'bls-tutor';
const KEEP_MS = 3 * 3600_000;
const SOURCES: Source[] = ['button', 'typed', 'spoken'];
const KINDS: Intent['kind'][] = ['answer', 'reveal', 'next', 'start_scenario', 'leave_scenario', 'ack_safety', 'emergency_mode'];

interface Drill { tutor: BlsTutor; at: number }
const drills = new Map<string, Drill>();

/** A control from the page, checked for shape (the tutor checks the rest). */
function intentFrom(body: unknown): Intent | null {
  if (!body || typeof body !== 'object') return null;
  const intent = body as Record<string, unknown>;
  if (!KINDS.includes(intent.kind as Intent['kind'])) return null;
  if (intent.kind === 'answer') return { kind: 'answer', step_key: String(intent.step_key ?? '').slice(0, 64), text: String(intent.text ?? '').slice(0, 2000) };
  if (intent.kind === 'start_scenario') return { kind: 'start_scenario', id: String(intent.id ?? '').slice(0, 120) };
  return { kind: intent.kind } as Intent;
}

const app: AppServer = {
  id: ID,
  title: 'BLS Tutor',
  tagline: 'A calm paramedic walks you through CPR and first-aid scenarios, step by step, graded against the real algorithm.',
  maxSeconds: 900,
  routes(router) {
    router.post('/drills', (_req, res) => {
      const id = randomBytes(9).toString('hex');
      const tutor = new BlsTutor();
      drills.set(id, { tutor, at: Date.now() });
      for (const [key, d] of drills) if (Date.now() - d.at > KEEP_MS) drills.delete(key);
      res.json({ id, view: viewOf(tutor) });
    });

    router.get('/drills/:id', (req, res) => {
      const drill = drills.get(req.params.id);
      if (!drill) return void res.status(404).json({ error: 'no_drill' });
      res.json(viewOf(drill.tutor));
    });

    router.post('/drills/:id/act', (req, res) => {
      const drill = drills.get(req.params.id);
      if (!drill) return void res.status(404).json({ error: 'no_drill' });
      const body = (req.body ?? {}) as { intent?: unknown; text?: unknown; from?: unknown };
      const from = SOURCES.includes(body.from as Source) ? (body.from as Source) : 'typed';
      const intent = body.intent === undefined ? undefined : intentFrom(body.intent);
      if (body.intent !== undefined && !intent) return void res.status(400).json({ error: 'bad_intent' });
      const text = typeof body.text === 'string' ? body.text.slice(0, 2000) : undefined;
      if (!intent && !text?.trim()) return void res.status(400).json({ error: 'nothing_to_do' });
      drill.at = Date.now();
      const outcome = act(drill.tutor, { intent: intent ?? undefined, text, from });
      if (outcome.kind === 'emergency' && outcome.applied) console.warn('[%s] drill %s stopped by a real-emergency %s line', ID, req.params.id.slice(0, 6), from);
      res.json(outcome);
    });
  },
};

export default app;
