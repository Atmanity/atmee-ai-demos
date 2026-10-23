// Kibitz's server side. Chess has no secrets, so the board, the rules and the
// opponent's move choice all run in the page (engine/*), which answers the
// host's tool calls itself. The server only declares those tools for the
// session: the host's rules and the five board actions.
import type { AppServer } from '../../server/app-server.ts';
import { INSTRUCTIONS, TOOLS } from './engine/director.ts';

const app: AppServer = {
  id: 'chess-opponent',
  title: 'Kibitz',
  tagline: 'Chess with a club player who talks back: Sasha plays her own moves and tells you why.',
  brand: { color: '#1d4436', ink: '#ffffff' },
  // A game by voice runs long; the original held the room for an hour.
  maxSeconds: 1500,
  appTools: { instructions: INSTRUCTIONS, tools: TOOLS },
};

export default app;
