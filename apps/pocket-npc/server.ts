// Pocket NPC: a game character with Atmee's voice and conversation, drawn by
// the game itself. There is no video: the page renders Brannoc, the keeper
// of the Brass Kettle, as a 2D character and moves his mouth and face from the
// level of the voice as it plays. This server reserves each conversation
// (the site's shared /speech routes) and pins who Brannoc is (name, persona,
// scene, greeting, the tavern's facts), how he plays the scene, and his
// tools; the voice is the avatar's. The page runs the tools against the
// game's own state (engine/tavern.ts): the purse, the pack, the quest log.
import { readFileSync } from 'node:fs';
import type { AppServer } from '../../server/app-server.ts';
import { FACTS, RULES, TOOLS } from './engine/tavern.ts';

const host = JSON.parse(readFileSync(new URL('./avatar.json', import.meta.url), 'utf8')) as {
  name: string; personality: string; scenario: string; greeting: string;
};

const app: AppServer = {
  id: 'pocket-npc',
  title: 'Pocket NPC',
  tagline: "A game's own 2D character with Atmee's voice and conversation: talk Brannoc the innkeeper into a quest, and haggle for gear.",
  brand: { color: '#b4532a', ink: '#ffffff' },
  way: 'speech-to-speech',
  maxSeconds: 600,
  speech: {
    settings: () => ({
      avatar_name: host.name,
      persona: host.personality,
      scenario: host.scenario,
      self_introduction: host.greeting,
      facts: FACTS,
      instructions: RULES,
      delegation: { type: 'responses', responses: { tools: TOOLS, tool_choice: 'auto' } },
    }),
  },
};
export default app;
