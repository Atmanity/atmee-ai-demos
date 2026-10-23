// Hanshi's server side: it owns every lesson (the reference strokes never
// reach the browser, so a learner cannot read the answer in devtools), grades
// each drawn stroke with geometry, and answers Ren's tool calls and the
// learner's buttons with one set of actions.
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { INSTRUCTIONS, pressed, say, TOOLS } from './engine/director.ts';
import { perform, runTool, TOOL_NAMES } from './engine/lesson.ts';
import { StrokeTutor } from './engine/tutor.ts';
import type { Command, Snapshot } from './engine/types.ts';

const ID = 'stroke-tutor';
/** A browser sends at most 40 points a stroke; anything far beyond that is not a drawing. */
const MAX_POINTS_ACCEPTED = 2000;

interface Lesson { tutor: StrokeTutor; at: number }
const lessons = new Map<string, Lesson>();
const TOOLS_BY_NAME = new Set<string>(TOOL_NAMES);

/** The page's buttons: each runs the tool Ren would call, under the label the learner pressed. */
const BUTTONS: Record<Command, [string, string]> = {
  show: ['show_stroke', 'Show me'],
  next: ['next_stroke', 'Next stroke'],
  another: ['next_character', 'Next character'],
  over: ['start_over', 'Start over'],
  choose: ['choose_character', ''],
};

const app: AppServer = {
  id: ID,
  title: 'Hanshi',
  tagline: 'Learn stroke order with Ren, a calligraphy teacher who watches every stroke.',
  brand: { color: '#1f2b2f', ink: '#fcfcfa' },
  maxSeconds: 900,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
  routes(router) {
    const lessonOf = (id: string) => {
      const lesson = lessons.get(id);
      if (lesson) lesson.at = Date.now();
      return lesson;
    };

    router.post('/lessons', (_req, res) => {
      const id = randomBytes(9).toString('hex');
      const tutor = new StrokeTutor();
      lessons.set(id, { tutor, at: Date.now() });
      for (const [key, l] of lessons) if (Date.now() - l.at > 3 * 3600_000) lessons.delete(key);
      res.json({ id, view: tutor.snapshot(), opening: say.opening() });
    });

    router.get('/lessons/:id', (req, res) => {
      const lesson = lessonOf(req.params.id);
      if (!lesson) return void res.status(404).json({ error: 'no_lesson' });
      res.json(lesson.tutor.snapshot());
    });

    // Ren's tool calls: the result is what Ren says next.
    router.post('/lessons/:id/tool', (req, res) => {
      const lesson = lessonOf(req.params.id);
      if (!lesson) return void res.status(404).json({ error: 'no_lesson' });
      const { name, arguments: args } = (req.body ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      if (!name || !TOOLS_BY_NAME.has(name)) return void res.status(400).json({ error: 'unknown_tool' });
      const done = runTool(lesson.tutor, name, args ?? {});
      res.json({ view: done.view, result: done.text } satisfies { view: Snapshot; result: string });
    });

    // The learner's buttons: Ren cannot see them, so Ren is told. A refusal is
    // shown on the sheet and not spoken: the button was simply not available.
    router.post('/lessons/:id/act', (req, res) => {
      const lesson = lessonOf(req.params.id);
      if (!lesson) return void res.status(404).json({ error: 'no_lesson' });
      const { command, character } = (req.body ?? {}) as { command?: Command; character?: string };
      const button = command && Object.hasOwn(BUTTONS, command) ? BUTTONS[command] : null;
      if (!button) return void res.status(400).json({ error: 'unknown_command' });
      const done = runTool(lesson.tutor, button[0], { character });
      const label = command === 'choose' ? `${done.view.character?.glyph ?? character}, on the menu` : button[1];
      res.json({ view: done.view, refused: done.refused, event: done.refused ? undefined : pressed(label, done.text) });
    });

    // A stroke drawn on the sheet, in grid units: graded here, never by Ren.
    router.post('/lessons/:id/stroke', (req, res) => {
      const lesson = lessonOf(req.params.id);
      if (!lesson) return void res.status(404).json({ error: 'no_lesson' });
      const points = (req.body as { points?: unknown } | undefined)?.points;
      if (!Array.isArray(points)) return void res.status(400).json({ error: 'no_points' });
      if (points.length > MAX_POINTS_ACCEPTED) return void res.status(413).json({ error: 'too_many_points' });
      const outcome = perform(lesson.tutor, { kind: 'stroke', points }, 'panel');
      res.json({ view: outcome.view, refused: outcome.refused, event: outcome.refused ? undefined : outcome.event });
    });
  },
};

export default app;
