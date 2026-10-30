// Math Club's server side: nothing of its own. The games run in the page,
// which answers Mochi's tools.
import type { AppServer } from '../../server/app-server.ts';
import { INSTRUCTIONS, TOOLS } from './engine/director.ts';

const app: AppServer = {
  id: 'math-club',
  title: 'Math Club',
  tagline: 'Talk with Mochi the red panda: five levels, five maths games, and Mochi jumps when you get it.',
  brand: { color: '#213d33', ink: '#ffd166' },
  maxSeconds: 900,
  conductor: null,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
};

export default app;
