// Bystander's server side: it owns each learner's drill, because the scenario
// content holds every step's answer (a step's label IS the answer to the
// question on screen) and the page must only ever see the stripped snapshot.
// Alex's tool calls and the learner's buttons go through one set of actions
// (engine/drill.ts). No model calls and no keys: grading is substring
// matching against static AHA/ERC lay-rescuer sequences.
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { BUTTON, INSTRUCTIONS, pressed, said, TOOLS } from './engine/director.ts';
import { isAction, run, viewOf } from './engine/drill.ts';
import { find } from './engine/scenarios.ts';
import { BlsTutor } from './engine/tutor.ts';
import type { Action, ActReply, Command, ToolReply, View } from './engine/types.ts';

const ID = 'bls-tutor';
const KEEP_MS = 3 * 3600_000;

interface Drill { tutor: BlsTutor; at: number }
const drills = new Map<string, Drill>();

const ACTION_OF: Record<Command, Action> = {
  start: 'start_scenario', reveal: 'show_step', hint: 'give_hint', next: 'next_step', leave: 'leave_scenario', resume: 'resume_practice', emergency: 'stop_for_emergency',
};

function drillFor(id: string): Drill | null {
  const drill = drills.get(id);
  if (drill) drill.at = Date.now();
  return drill ?? null;
}

const app: AppServer = {
  id: ID,
  title: 'Bystander',
  tagline: 'CPR and first-aid drills with Alex, a calm paramedic: practise the minutes before help arrives.',
  brand: { color: '#0f7a4f', ink: '#ffffff' },
  maxSeconds: 900,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
  routes(router) {
    // A new drill, started on the scenario chosen at the front door (or at the list).
    router.post('/drills', (req, res) => {
      const id = randomBytes(9).toString('hex');
      const tutor = new BlsTutor();
      const wanted = String((req.body as { scenario?: unknown } | undefined)?.scenario ?? '').slice(0, 120);
      if (wanted && find(wanted)) tutor.startScenario(find(wanted)!.id);
      drills.set(id, { tutor, at: Date.now() });
      for (const [key, d] of drills) if (Date.now() - d.at > KEEP_MS) drills.delete(key);
      const view = viewOf(tutor);
      res.json({ id, view, opening: said.opening(view) } satisfies { id: string; view: View; opening: string });
    });

    // Where a drill is, and the opening for a learner calling Alex again.
    router.get('/drills/:id', (req, res) => {
      const drill = drillFor(req.params.id);
      if (!drill) return void res.status(404).json({ error: 'no_drill' });
      const view = viewOf(drill.tutor);
      res.json({ view, opening: said.opening(view) });
    });

    // Alex's tool calls (and the page's safety net): the result is what he says next.
    router.post('/drills/:id/tool', (req, res) => {
      const drill = drillFor(req.params.id);
      if (!drill) return void res.status(404).json({ error: 'no_drill' });
      const { name, arguments: args } = (req.body ?? {}) as { name?: unknown; arguments?: Record<string, unknown> };
      if (!isAction(name)) return void res.status(400).json({ error: 'unknown_tool' });
      const done = run(drill.tutor, name, args && typeof args === 'object' ? args : {});
      if (done.emergency) console.warn('[%s] drill %s stopped for a possible real emergency (host)', ID, req.params.id.slice(0, 6));
      res.json({ view: viewOf(drill.tutor), result: done.text, hint: done.hint, emergency: done.emergency } satisfies ToolReply);
    });

    // The learner's buttons: they act at once, and Alex is told (he cannot see them).
    router.post('/drills/:id/act', (req, res) => {
      const drill = drillFor(req.params.id);
      if (!drill) return void res.status(404).json({ error: 'no_drill' });
      const body = (req.body ?? {}) as { command?: Command; scenario?: unknown };
      const action = ACTION_OF[body.command as Command];
      if (!action || !Object.hasOwn(ACTION_OF, body.command as string)) return void res.status(400).json({ error: 'unknown_command' });
      const scenario = String(body.scenario ?? '').slice(0, 120);
      const done = run(drill.tutor, action, { scenario });
      const view = viewOf(drill.tutor);
      // The page's own emergency watch tells Alex itself, with the learner's words.
      if (body.command === 'emergency') {
        console.warn('[%s] drill %s stopped for a possible real emergency (page)', ID, req.params.id.slice(0, 6));
        return void res.json({ view, applied: done.applied } satisfies ActReply);
      }
      const label = body.command === 'start' ? find(scenario)?.title ?? 'a drill' : BUTTON[body.command as Exclude<Command, 'start' | 'emergency'>];
      res.json({ view, applied: done.applied, reason: done.reason, hint: done.hint, event: done.applied ? pressed(label, done.text) : undefined } satisfies ActReply);
    });
  },
};

export default app;
