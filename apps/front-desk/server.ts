// Callwell: a voice receptionist for a small clinic, built the speech-to-speech
// way. There is no video and no room: the caller's page holds a WebSocket to
// Atmee's speech server, which hears them and answers in the avatar's voice.
// This server reserves each call (the site's shared /speech routes) and pins
// what the call is: Rosa and the clinic (persona, facts, greeting), how she
// works the phone and the book (instructions), and her tools. The page cannot
// change any of it; it runs the tools over its own appointment book
// (engine/clinic.ts) and answers with their results.
import { readFileSync } from 'node:fs';
import type { AppServer } from '../../server/app-server.ts';
import { CLINIC, RULES, TOOLS, clinicFacts } from './engine/clinic.ts';

const host = JSON.parse(readFileSync(new URL('./avatar.json', import.meta.url), 'utf8')) as {
  name: string; personality: string; scenario: string; greeting: string;
};

const app: AppServer = {
  id: 'front-desk',
  title: 'Callwell',
  tagline: 'A voice receptionist for a small clinic: call Rosa to book, move or cancel an appointment. No video, just the call.',
  brand: { color: '#0f766e', ink: '#ffffff' },
  way: 'speech',
  maxSeconds: 600,
  speech: {
    settings: () => ({
      avatar_name: host.name,
      persona: host.personality,
      scenario: host.scenario,
      self_introduction: host.greeting,
      facts: clinicFacts(),
      instructions: RULES,
      // "Today" and "tomorrow" are the clinic's, as the book's days are.
      avatar_timezone: CLINIC.timeZone,
      delegation: { type: 'responses', responses: { tools: TOOLS, tool_choice: 'auto' } },
    }),
  },
};
export default app;
