// Stroke Tutor's server side: it owns every lesson (the reference strokes
// never reach the browser, so a learner cannot read the answer in devtools),
// grades each drawn stroke with geometry, and turns what the learner types or
// says into board actions: rules first, then the app's own model call for the
// lines the rules cannot place.
import { randomBytes } from 'node:crypto';
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { say } from './engine/director.ts';
import { INTENT_SCHEMA, intentFromModel, intentIn, intentPrompt, worthAsking } from './engine/judge.ts';
import { perform } from './engine/lesson.ts';
import { StrokeTutor } from './engine/tutor.ts';
import type { Intent, Outcome } from './engine/types.ts';

const ID = 'stroke-tutor';
/** A browser sends at most 40 points a stroke; anything far beyond that is not a drawing. */
const MAX_POINTS_ACCEPTED = 2000;

interface Lesson { tutor: StrokeTutor; at: number }
const lessons = new Map<string, Lesson>();

/** A typed or spoken line as a board action, or null for one the avatar simply answers. */
async function judge(lesson: Lesson, text: string): Promise<Intent | null> {
  const { tutor } = lesson;
  const current = tutor.character?.id ?? null;
  const ruled = intentIn(text, tutor.phase, current);
  if (ruled || !llmAvailable() || !worthAsking(text)) return ruled;
  try {
    const answer = await structured<{ action: string; character: string }>({
      system: 'You route one utterance of a learner in a stroke-order lesson to the board action they want, if any.',
      user: intentPrompt(tutor.snapshot(), text),
      schema: INTENT_SCHEMA,
      temperature: 0,
    });
    // The phase may have moved while the model thought; the intent is checked against it again.
    return intentFromModel(answer, tutor.phase, tutor.character?.id ?? null);
  } catch (err) {
    console.warn('[%s] routing failed (%s); leaving the line to the avatar', ID, (err as Error).message);
    return null;
  }
}

const app: AppServer = {
  id: ID,
  title: 'Stroke Tutor',
  tagline: 'A calligraphy teacher who grades your stroke order and direction, never your handwriting.',
  maxSeconds: 900,
  routes(router) {
    router.post('/lessons', (_req, res) => {
      const id = randomBytes(9).toString('hex');
      const tutor = new StrokeTutor();
      lessons.set(id, { tutor, at: Date.now() });
      for (const [key, l] of lessons) if (Date.now() - l.at > 3 * 3600_000) lessons.delete(key);
      res.json({ id, outcome: { view: tutor.snapshot(), handled: true, event: say.opening() } satisfies Outcome });
    });

    router.get('/lessons/:id', (req, res) => {
      const lesson = lessons.get(req.params.id);
      if (!lesson) return void res.status(404).json({ error: 'no_lesson' });
      res.json(lesson.tutor.snapshot());
    });

    // { intent } from the page's controls and canvas, or { text } the learner typed or said.
    router.post('/lessons/:id/act', async (req, res) => {
      const lesson = lessons.get(req.params.id);
      if (!lesson) return void res.status(404).json({ error: 'no_lesson' });
      lesson.at = Date.now();
      const { intent, text } = (req.body ?? {}) as { intent?: Intent; text?: string };
      if (intent && typeof intent === 'object') {
        const points = (intent as { points?: unknown }).points;
        if (Array.isArray(points) && points.length > MAX_POINTS_ACCEPTED) return void res.status(413).json({ error: 'too_many_points' });
        return void res.json(perform(lesson.tutor, intent, 'panel'));
      }
      const said = typeof text === 'string' ? text.trim() : '';
      if (!said) return void res.status(400).json({ error: 'nothing_to_do' });
      const judged = await judge(lesson, said);
      if (!judged) return void res.json({ view: lesson.tutor.snapshot(), handled: false } satisfies Outcome);
      res.json(perform(lesson.tutor, judged, 'words'));
    });
  },
};

export default app;
