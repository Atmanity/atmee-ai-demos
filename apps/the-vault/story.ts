// The Vault: a three-minute negotiation. Walter Reyes, a bank's night guard, has locked himself in
// the vault, alone and unarmed. You are the negotiator on the intercom; the team goes in at 3:00.
// The whole film is the conversation. What you say moves his trust, trust unlocks what he tells
// you, and trust decides the ending. The server owns trust; the live avatar only acts it.

export const DEADLINE_S = 180;
export const START_TRUST = 3;
export const MAX_TRUST = 10;

/** What Walter is hiding, in layers. Each opens at a trust level and never before. */
export interface Layer { id: string; unlock: number; secret: string; note: string; said: RegExp }
export const LAYERS: Layer[] = [
  {
    id: 'three', unlock: 0, said: /three|3:00|o'clock/i,
    secret: "You are waiting for something that happens at three o'clock, behind you in the vault. You won't say what it is yet.",
    note: "He's waiting for something at 3:00.",
  },
  {
    id: 'mother', unlock: 5, said: /mother|mom|mum|rosa|house|elm/i,
    secret: 'Your mother, Rosa, lived in the same little house on Elm Street for forty-one years. Last year this bank foreclosed on it over a loan she never signed. She died in March, in a rented room.',
    note: "The bank took his mother's house over a loan she never signed. She died in March.",
  },
  {
    id: 'box', unlock: 8, said: /box|eleven|1147|forty-seven|file|signature/i,
    secret: "Box 1147 behind you is the bank's own records box. Its time lock opens at three o'clock for the morning audit. Inside is your mother's loan file, with her signature forged. By morning it will be gone. You want one honest person to see it with you.",
    note: "Box 1147 opens at 3:00. Inside: the loan file, her signature forged.",
  },
];

export const unlocked = (trust: number) => LAYERS.filter((l) => trust >= l.unlock);

/** How Walter reads the negotiator right now. */
export const readOf = (trust: number) => (trust <= 1 ? 'Shutting you out' : trust < 5 ? 'Guarded' : trust < 8 ? 'Listening' : 'Trusts you');

export function instructions(): string {
  return [
    "You are Walter Reyes, 58, night guard at Harlow Savings for twenty years. Tonight you locked yourself inside the bank vault, alone and unarmed. You are not dangerous and you are not stealing. You are tired, polite, dryly funny and very sad.",
    'You are talking over the vault intercom with the police negotiator outside. You sit facing the intercom camera and stay there.',
    'Speak like a real tired man: one to three short sentences, then let the negotiator talk. Ask them small questions back: their name, whether they have parents, whether they believe a bank can lie.',
    "Your secret has layers. APP STATE says which layers you may share now; share only those, a little at a time, when it fits. If asked about anything still locked, deflect kindly with a small detail about your night shifts or the building.",
    'If the negotiator threatens you, rushes you or lies to you, you get quieter and shorter. If they are curious about you and honest, you open up.',
    'Never mention weapons, never threaten anyone, never say you are an AI or in a film.',
  ].join('\n');
}

export function stateFor(trust: number, lies: number): string {
  const open = unlocked(trust);
  return [
    `APP STATE. Your trust in the negotiator: ${readOf(trust).toLowerCase()} (${trust}/10).`,
    `You may share: ${open.map((l) => l.secret).join(' ')}`,
    lies ? 'You caught the negotiator in a lie once. You are wary.' : '',
    trust >= 8 ? 'If the negotiator asks you to come out, you are willing to, as long as they promise to look at box 1147 with you.' : '',
  ].filter(Boolean).join('\n');
}

export const TOOLS = [{
  type: 'function' as const, name: 'noted',
  description: 'Call this, without mentioning it, when you share something new about why you are here. Keep talking normally.',
  parameters: { type: 'object', properties: { what: { type: 'string', description: 'What you shared, briefly' } }, required: [] },
  'x-atmee': { mode: 'notify' as const },
}];

// ---- reading the negotiator

export interface Verdict { warmth: number; lie: boolean; asksOut: boolean }
export const JUDGE_SYSTEM = [
  'You judge one line a police negotiator just said, over an intercom, to Walter: a gentle, unarmed night guard who locked himself in a bank vault for a reason he has not fully told yet.',
  'warmth, from -2 to 2: +2 for genuine curiosity about Walter or his reasons, empathy, or honesty about what the negotiator can and cannot do; +1 for calm, respectful talk; 0 for neutral or procedural; -1 for pressure, rushing or orders; -2 for threats or contempt.',
  'lie: true only for a promise the negotiator obviously cannot keep (no charges, money, a pardon, "nobody is out here") or a plain falsehood.',
  'asksOut: true if the negotiator asks or invites Walter to open the door and come out.',
].join('\n');
export const JUDGE_SCHEMA = {
  type: 'object',
  properties: { warmth: { type: 'integer' }, lie: { type: 'boolean' }, asksOut: { type: 'boolean' } },
  required: ['warmth', 'lie', 'asksOut'],
};

const WARM = /\b(why|tell me|what happened|your (mother|mom|mum|family|name)|i'm listening|i hear you|that must|i'm sorry|i understand|help me understand|walter)\b/i;
const COLD = /\b(come out now|or else|we will|force|breach|arrest|you have no choice|last chance|shut up|stop)\b/i;
const LIE = /\b(no charges|won't be charged|nobody('s| is) (here|out here)|i promise you'll go free|we'll give you|pardon)\b/i;
const OUT = /\b(come out|open the door|open up|step out)\b/i;
/** Without a model. */
export function wordVerdict(text: string): Verdict {
  return { warmth: COLD.test(text) ? -1 : WARM.test(text) ? 1 : 0, lie: LIE.test(text), asksOut: OUT.test(text) };
}
export const normalise = (v: Partial<Verdict> | null | undefined): Verdict => ({
  warmth: Math.max(-2, Math.min(2, Math.round(Number(v?.warmth) || 0))),
  lie: Boolean(v?.lie), asksOut: Boolean(v?.asksOut),
});

export type Ending = 'open' | 'off' | 'breach';
export interface Run { trust: number; lies: number; ended: Ending | null; at: number }

/** One line of the negotiator: the new trust, and an ending if it decides one. */
export function step(run: Run, v: Verdict): Ending | null {
  run.trust = Math.max(0, Math.min(MAX_TRUST, run.trust + v.warmth - (v.lie ? 3 : 0)));
  if (v.lie) run.lies += 1;
  if (run.lies >= 2 || run.trust === 0) return 'off';
  if (run.trust >= 8 && v.asksOut) return 'open';
  return null;
}
/** At three o'clock the box opens: he comes out to someone he trusts; otherwise the team goes in. */
export const atDeadline = (run: Run): Ending => (run.trust >= 8 ? 'open' : 'breach');

export const ENDINGS: Record<Ending, { title: string; line: string }> = {
  open: { title: 'The door opens', line: 'Walter came out to you. Box 1147 was open on the table between you.' },
  off: { title: 'Camera off', line: 'He asked for someone who would listen. The intercom stayed dark.' },
  breach: { title: '3:00', line: 'The team went in. Nobody looked inside box 1147.' },
};
