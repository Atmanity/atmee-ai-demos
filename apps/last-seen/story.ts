// Last Seen: a five-minute mystery on your phone. Mia, your younger sister, hasn't come home.
// Two people call you. Each tells one lie, and one piece of evidence breaks it. The page owns the
// plot (when evidence lands, when a call ends, which ending plays); the live callers act it.

export type Caller = 'theo' | 'jonah';
export type Destination = 'bridge' | 'party';

export interface Evidence {
  id: string;
  caller: Caller;
  /** The notification: who sent it and what it says. */
  from: string;
  text: string;
  /** A clip the viewer can watch (film/<media>.mp4), or none for a text. */
  media?: string;
  /** What the caller claimed, and the truth it proves. */
  lie: string;
  truth: string;
  /** The caller's words once shown it, scripted so the plot cannot leak or drift. */
  reveal: string;
  /** Words that show the reveal was said. */
  said: RegExp;
}

export const EVIDENCE: Record<Caller, Evidence> = {
  theo: {
    id: 'doorbell', caller: 'theo', from: 'Mrs. Patel, next door',
    text: "Saw this on our doorbell camera just now. Isn't that Mia getting into a car? 12:40",
    media: 'doorbell',
    lie: 'Theo said he dropped Mia home at eleven.',
    truth: 'Theo drove Mia to the old footbridge at 12:40.',
    said: /footbridge|bridge/i,
    reveal: "Okay. Okay. She asked me to drop her at the old footbridge. She made me promise not to tell anyone. She was crying, something about Jonah.",
  },
  jonah: {
    id: 'priya', caller: 'jonah', from: 'Priya',
    text: 'omg Mia dumped Jonah at the party like an hour ago. she was crying. is she ok??',
    lie: "Jonah said he hadn't seen Mia since ten.",
    truth: 'Mia broke up with Jonah tonight and talked about the bridge.',
    said: /broke up|bridge/i,
    reveal: "Fine. Fine. We had a fight. She broke up with me, okay? She said she wanted to go somewhere nobody would find her. The bridge, maybe.",
  },
};

export interface Person { name: string; where: string; who: string; lie: string; opening: string; chips: [string[], string[]] }

export const CAST: Record<Caller, Person> = {
  theo: {
    name: 'Theo', where: 'in his car',
    who: "You are Theo, 18, Mia's best friend since primary school. It is 1 a.m. and you are sitting in your parked car, guilty and scared. Mia made you promise to keep a secret, and now nobody can reach her. You are calling Sam, Mia's older sibling. You talk fast, laugh nervously when you are uncomfortable, and keep asking Sam questions instead of answering.",
    lie: "If Sam asks where Mia is or when you last saw her, you say you dropped her home at eleven and she was fine. You stick to that story.",
    opening: "Sam just answered your call. Speak first: a nervous hello, then ask whether Mia has texted Sam tonight.",
    chips: [["When did you last see her?", "Where did you drop her?", "Why are you calling me?"], ["Why did you lie to me?", "What happened with Jonah?"]],
  },
  jonah: {
    name: 'Jonah', where: 'outside the party',
    who: "You are Jonah, 19, Mia's boyfriend until tonight. You are outside a loud house party, a little drunk and too cheerful, hiding that you are hurt. Sam, Mia's older sibling, is calling you. You talk loud, laugh easily, call Sam 'man' or 'dude', and try to brush everything off.",
    lie: "If Sam asks about Mia, you say you haven't seen her since about ten and she's probably asleep. You stick to that story and change the subject.",
    opening: "Sam just answered. Speak first, loud and cheerful over the party noise: say hey, and ask what's up this late.",
    chips: [["Have you seen Mia?", "Did something happen tonight?"], ["Where would she go?", "Why didn't you tell me?"]],
  },
};

const SHARED = [
  'This is a phone video call, part of an interactive film. You hold the phone at arm\'s length, facing the camera, and you stay on the call.',
  'Speak like a real person on a late-night call: one or two short sentences per turn, then let Sam talk or ask Sam a question.',
  'Never say you are an AI, an avatar or in a film. Mia is safe in the story; nothing violent or frightening happens to anyone.',
  'Stay in this conversation with Sam: answer, then ask one more question or share one feeling. Only APP STATE WRAP UP ends it.',
];

/** The secret part of a caller's scene, sent with the session so the page never holds it. */
export function instructions(caller: Caller, known: string[]): string {
  const c = CAST[caller];
  const e = EVIDENCE[caller];
  return [
    c.who,
    ...SHARED,
    c.lie,
    `The truth you are hiding: ${e.truth}`,
    `When APP STATE says EVIDENCE SHOWN, you are caught: give up the truth, in these words: "${e.reveal}" Then answer honestly.`,
    known.length ? `Sam already knows: ${known.join(' ')}` : '',
    'Call the tool admitted, quietly, the moment you tell Sam the truth.',
  ].filter(Boolean).join('\n');
}

export const TOOLS = [{
  type: 'function' as const, name: 'admitted',
  description: 'Call this, without mentioning it, at the moment you tell Sam the truth you were hiding. Keep talking normally.',
  parameters: { type: 'object', properties: { what: { type: 'string', description: 'What you admitted, briefly' } }, required: [] },
  'x-atmee': { mode: 'notify' as const },
}];

export const shownState = (caller: Caller) => `EVIDENCE SHOWN: Sam just showed you this: "${EVIDENCE[caller].text}" You are caught.`;
export const shownEvent = (caller: Caller) => `Sam is showing you proof you lied: "${EVIDENCE[caller].text}" Give up the truth now, in the words your instructions give.`;
export const WRAP = 'WRAP UP: end the call now, in one sentence: you have to go, and Sam should call you if Mia turns up.';
/** After the confession: the caller stays honest without saying it again. */
export const toldState = (caller: Caller) => `You have already told Sam the truth: ${EVIDENCE[caller].truth} Now talk honestly, in your own new words; your confession is said and stays said.`;
export const QUIET = "Sam has gone quiet. Say something new and short: a worried question, or a small detail about tonight. Do not repeat anything you already said.";

/** Mia's pre-rendered videos (film/<id>.mp4), with their words for the captions. */
export const MIA: Record<string, string> = {
  m_voicemail: "Hey, it's me. If you get this, don't call Mum yet, okay? I'm fine, I just... I need a minute.",
  m_bridge: "You came. You actually came. I didn't want Mum to see me like this. Can we tell her together?",
  m_party: "I waited at the bridge. You didn't come. It's fine. I'm going home.",
};

export interface Outcome { video: string; title: string; line: string }
/** Where you go decides the night; what you found decides whether you knew. */
export function ending(destination: Destination, truths: number): Outcome {
  if (destination === 'bridge') {
    return { video: 'm_bridge', title: 'Found', line: truths === 2 ? 'You caught both lies and went straight to her.' : truths === 1 ? 'One lie broke, and it was enough.' : 'You guessed, and guessed right.' };
  }
  return { video: 'm_party', title: 'Missed', line: truths ? 'You knew about the bridge, and went to the party anyway.' : 'Nobody told you the truth tonight, and you never made them.' };
}
