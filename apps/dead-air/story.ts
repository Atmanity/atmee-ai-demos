// Dead Air: a three-minute horror on your phone. It starts as a bored video call from a friend
// closing a mall, goes wrong a little at a time, and then something comes for him. The page owns
// every beat (it tells the caller what happens, when); the live callers only act it.

export type Friend = 'jake' | 'maya';

/**
 * A timed beat in a call: at `at` seconds the page tells the caller what just happened. An urgent
 * beat cuts the caller off mid-sentence (it cannot wait for a pause); the rest wait their turn.
 */
export interface Beat { at: number; id: string; event: string; sound?: 'flicker' | 'scream' | 'thud'; urgent?: boolean }

export interface Caller {
  name: string;
  where: string;
  who: string;
  opening: string;
  beats: Beat[];
  chips: string[][];
}

const SHARED = [
  'This is a phone video call in an interactive film. You hold the phone close, facing the camera, and you stay on the call.',
  'Speak like a real person on a late-night call: one or two short sentences per turn, then let Sam talk or ask Sam something.',
  'Never say you are an AI, an avatar or in a film. Nothing is described in gory detail.',
  'APP EVENTS tell you what is happening around you right now. React to each the moment it comes, in your own words, and stay in that moment.',
];

export const CALLERS: Record<Friend, Caller> = {
  jake: {
    name: 'Jake', where: 'Westfield Mall',
    who: "You are Jake, 20, Sam's best friend. You are closing the mall alone tonight, standing in the empty food court with the shutters down. You are bored and you called Sam to kill time: you joke, complain about your manager, and ask what Sam is up to. Nothing is wrong when the call starts, and you do not expect anything to be.",
    opening: 'Sam just picked up your video call. Speak first, relaxed and bored: say hey, and that you are stuck closing the mall alone again.',
    beats: [
      { at: 18, id: 'flicker', sound: 'flicker', event: 'The lights in the food court just flickered off and on. Mention it, half laughing, and carry on chatting.' },
      { at: 33, id: 'scream', sound: 'scream', urgent: true, event: 'You just heard a scream from somewhere deeper in the mall, far away. Go quiet. Ask Sam, quietly, if Sam heard that too.' },
      { at: 47, id: 'figure', urgent: true, event: "You can see a man standing at the far end of the food court, not moving, facing the wall. He was not there before. Whisper: 'hang on, let me turn the camera so you can see', then ask Sam, quietly, if you should go and check on him." },
      { at: 66, id: 'coming', sound: 'thud', urgent: true, event: 'The man just turned around and he is running at you, fast, wrong. Panic: tell Sam he is coming, he is coming, in a few broken words, then stop talking.' },
    ],
    chips: [],
  },
  maya: {
    name: 'Maya', where: 'driving',
    who: "You are Maya, 20, Sam and Jake's friend. You are driving slowly through empty streets at night to pick Jake up from the mall after his shift, your phone in its holder on the dashboard. Jake stopped answering a few minutes ago and you are uneasy. You call Sam to ask if Sam has heard from him. You keep your eyes on the road and glance at the phone.",
    opening: "Sam just answered. Speak first, uneasy: you're driving to the mall to get Jake and he isn't answering; ask if Sam has heard from him.",
    beats: [
      { at: 20, id: 'road', event: "Up ahead, people are walking along the edge of the road in the dark, slowly, strangely, more and more of them. Whisper: 'Sam, there are people on the road... look', and keep driving very slowly." },
      { at: 40, id: 'crash', urgent: true, event: 'People just stepped out into the road right in front of your headlights. Scream, swerve, and stop talking.' },
    ],
    chips: [],
  },
};

/** The secret part of a caller's scene, sent with the session so the page never holds it. */
export function instructions(friend: Friend): string {
  const c = CALLERS[friend];
  return [
    c.who,
    ...SHARED,
    'Keep the conversation going with Sam until something happens.',
    'Call the tool noticed, quietly, whenever Sam tells you what to do. Keep talking normally.',
  ].join('\n');
}

export const TOOLS = [{
  type: 'function' as const, name: 'noticed',
  description: 'Call this, without mentioning it, whenever Sam tells you what to do. Keep talking normally.',
  parameters: { type: 'object', properties: { advice: { type: 'string', description: 'What Sam told you to do, briefly' } }, required: [] },
  'x-atmee': { mode: 'notify' as const },
}];

export interface Outcome { title: string; line: string }
export const OUTCOME: Outcome = { title: 'Dead Air', line: 'You were on the line for both of them.' };
