// Math Club's server side: nothing of its own. The class has no secrets the
// page must not know, so it runs in the page, which answers the teacher's tools.
import type { AppServer } from '../../server/app-server.ts';
import { INSTRUCTIONS, TOOLS } from './engine/director.ts';

const app: AppServer = {
  id: 'math-club',
  title: 'Math Club',
  tagline: 'Cut pizzas and bake cookies to learn fractions and times tables with Mochi the red panda.',
  brand: { color: '#213d33', ink: '#ffd166' },
  maxSeconds: 900,
  conductor: null,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
};

export default app;
