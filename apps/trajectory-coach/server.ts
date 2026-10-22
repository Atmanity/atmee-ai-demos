// Trajectory Coach's server side: one route, for the lines the rules cannot
// read ("lob it like a mortar"). The range itself runs in the page:
// nothing about it is secret (the landing point is the last point of the curve
// the page animates, and the teaching points ship in challenges.ts), and the
// page is the one place that animates the shot and lands it.
import type { AppServer } from '../../server/app-server.ts';
import { llmAvailable, structured } from '../../server/llm.ts';
import { BY_ID, limitsOf } from './engine/challenges.ts';
import { INTERPRET_SCHEMA, commandFromModel, interpretPrompt, type JudgeContext } from './engine/judge.ts';

const ID = 'trajectory-coach';

/** The page's description of the range, checked: it is only ever used to word a prompt. */
function contextFrom(body: unknown): JudgeContext | null {
  const b = (body ?? {}) as { aim?: { angle_deg?: unknown; speed_ms?: unknown }; challengeId?: unknown };
  const challenge = BY_ID.get(String(b.challengeId ?? ''));
  const angle = Number(b.aim?.angle_deg);
  const speed = Number(b.aim?.speed_ms);
  if (!challenge || !Number.isFinite(angle) || !Number.isFinite(speed)) return null;
  return { aim: { angle_deg: angle, speed_ms: speed }, limits: limitsOf(challenge), challengeId: challenge.id };
}

const app: AppServer = {
  id: ID,
  title: 'Trajectory Coach',
  tagline: 'Shoot at things on a range drawn to scale; a coach explains, in real numbers, why it fell short.',
  maxSeconds: 900,
  routes(router) {
    // What a line asks the range to do, by the app's model, validated. Null
    // when there is no model or it is unsure: the line then goes to the avatar.
    router.post('/interpret', async (req, res) => {
      const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 300) : '';
      const ctx = contextFrom(req.body);
      if (!text || !ctx) return void res.status(400).json({ error: 'bad_request' });
      if (!llmAvailable()) return void res.json({ command: null, reason: 'no_model' });
      try {
        const raw = await structured({ system: 'You turn what a student says at a projectile-motion practice range into an action for the range, or none.', user: interpretPrompt(text, ctx), schema: INTERPRET_SCHEMA, temperature: 0 });
        res.json({ command: commandFromModel(raw, ctx) });
      } catch (err) {
        console.warn('[%s] interpreting failed (%s)', ID, (err as Error).message);
        res.json({ command: null, reason: 'model_failed' });
      }
    });
  },
};

export default app;
