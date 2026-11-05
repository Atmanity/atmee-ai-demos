// The Stairs: what is filmed, what each parent is told, and how the story branches.
// The film is fixed clips; the two conversations are live. What Sam says to each parent
// decides the bridge between the calls and the ending.

export type Parent = 'claire' | 'mark';
/** How Sam met a parent: said how they feel, took a side, or gave nothing. */
export type Stance = 'honest' | 'side' | 'silent';
export type Bridge = 'scared' | 'sides' | 'wonttalk';
export type Ending = 'repair' | 'split' | 'silence';
/** What Sam does when the kitchen goes quiet. */
export type Choice = 'step' | 'stay';

export interface Shot { id: string; caption?: string; speaker?: Parent }

/** Every clip in the film, with the line it speaks (the clip's own audio). */
export const SHOTS: Record<string, Shot> = Object.fromEntries(([
  { id: 'o0_black', caption: '(Voices from the kitchen. They are fighting again.)' },
  { id: 'o2_six', speaker: 'claire', caption: "You said you'd be home by six. Sam waited at the window for an hour, Mark." },
  { id: 'o3_working', speaker: 'mark', caption: 'I was working. Somebody has to pay for all of this.' },
  { id: 'o4_money', speaker: 'claire', caption: "Don't. Don't make this about money again." },
  { id: 'o5_tired', speaker: 'mark', caption: "Then what is it about, Claire? Tell me, because I'm tired." },
  { id: 'o6_air', speaker: 'mark', caption: 'I need some air.' },
  { id: 'h_claire' },
  { id: 'h_mark' },
  { id: 'b_scared', speaker: 'claire', caption: "Sam heard everything, Mark. Sam's scared. Go talk to our kid." },
  { id: 'b_sides', speaker: 'claire', caption: "Sam's been listening, and now Sam's picking sides. Go on, then." },
  { id: 'b_wonttalk', speaker: 'claire', caption: "Sam won't talk to me. Maybe you'll have better luck." },
  { id: 'b_goingup', speaker: 'claire', caption: "I'm going up. Talk to our kid." },
  { id: 'e_love', speaker: 'mark', caption: 'We love you, kiddo. Both of us. Okay?' },
  { id: 'e_sorry', speaker: 'claire', caption: "Come here, sweetheart. We're sorry. None of this is on you." },
  { id: 'e_split', speaker: 'mark', caption: "I'm going to stay at Uncle Joe's tonight. It's not because of you, okay? It's never because of you." },
  { id: 'e_goon', speaker: 'claire', caption: "Go on up, Sam. It's late." },
] as Shot[]).map((s) => [s.id, s]));

// Every shot is one parent, rendered by their own avatar: the same face, framing and light as the
// live call. The film opens on black, with the fight heard through the wall.
export const OPENING = ['o0_black', 'o2_six', 'o3_working', 'o4_money', 'o5_tired', 'o6_air'];
/** Between the calls: Claire tells Mark what Sam said, and goes up (her scared line already sends him). */
export const bridgeShots = (b: Bridge) => (b === 'scared' ? ['b_scared'] : [`b_${b}`, 'b_goingup']);
export const ENDINGS: Record<Ending, { shots: string[]; title: string; line: string }> = {
  repair: { shots: ['e_love', 'e_sorry'], title: 'Repair', line: 'Sam said how it felt, plainly, and both of them heard it.' },
  split: { shots: ['e_split'], title: 'Split', line: 'Sam was pulled into the middle, and carried it there.' },
  silence: { shots: ['e_goon'], title: 'Silence', line: 'Sam kept it inside, and so did they.' },
};

export interface Said { who: 'sam' | 'parent' | 'noticed'; text: string }

/** The one tool each parent has: what they noticed about Sam, as a hint for the branch. */
export const TOOLS = [{
  type: 'function' as const, name: 'noticed',
  description: 'Call this, silently and without mentioning it, when Sam tells you how they feel, blames one parent, or refuses to talk. Keep talking normally.',
  parameters: { type: 'object', properties: { what: { type: 'string', description: 'honest, side or silent' }, words: { type: 'string', description: "Sam's words, briefly" } }, required: ['what'] },
  'x-atmee': { mode: 'notify' as const },
}];
export interface Met { stance: Stance; summary: string }

const SHARED = [
  'This is an interactive film. You are on camera in your kitchen at night, standing still and facing the camera; you do not walk away.',
  'Tonight you are shaken and sad after the fight: keep a serious, tired, tender face, and do not laugh or grin.',
  'You are talking with your child Sam, who is ten. Speak like a real parent to a ten-year-old: one or two short, simple sentences per turn, then let Sam talk. No adult details (no sums of money, no blame words like divorce).',
  'Never blame Sam. Never threaten or describe violence. Never say you are an AI, an avatar or in a film.',
  'If Sam is quiet, wait, or say something new and gentle; never repeat a line you have already said, and never lecture.',
  "Sam is whoever is watching: never guess Sam's gender. Say Sam, sweetheart or kiddo, never boy, girl, son or daughter.",
  'Stay in this conversation with Sam: answer what Sam says, then ask one more question or share one honest feeling, so Sam keeps talking. Only APP STATE WRAP UP ends it.',
];

/** The secret part of each parent's scene, sent with the session so the page never holds it. */
export function instructions(who: Parent, run: { choice: Choice; claire?: Met; claireLines?: Said[] }): string {
  if (who === 'claire') {
    return [
      'You are Claire, Sam\'s mum. A minute ago you and your husband Mark had a loud argument here about him always coming home late. He went out to the back porch. Your eyes are still wet.',
      ...SHARED,
      'What you want, and know you should not: for Sam to be on your side. Once, early, you slip: something like "Your dad just... he doesn\'t get it, does he?" Then catch yourself and take it back.',
      'Find out what Sam heard and how Sam feels. If Sam tells you honestly, thank Sam and say it is grown-up stuff, not Sam\'s fault.',
      'When APP STATE says WRAP UP, tell Sam you need to go and talk to Dad, and ask Sam to wait right here.',
    ].join('\n');
  }
  const told = run.claire?.summary ? `What Sam told Claire just now, as she told you: ${run.claire.summary}` : 'Claire said Sam would not talk to her.';
  const quotes = (run.claireLines ?? []).filter((l) => l.who === 'sam').slice(-3).map((l) => `"${l.text}"`).join(' ');
  return [
    'You are Mark, Sam\'s dad. You argued with your wife Claire about always coming home late, went out to cool off, and just came back in. Claire has gone upstairs.',
    ...SHARED,
    told,
    quotes ? `Sam's own words to her: ${quotes}` : '',
    'Your habit: you dodge hard feelings with a small joke first. If Sam is honest with you, drop the joke and be honest back: you are sorry Sam heard that, you and Mum love Sam, and you will fix how you talk to each other.',
    run.claire?.stance === 'side' ? 'You heard Sam took a side, and it stings, but you never ask Sam to choose.' : '',
    'When APP STATE says WRAP UP, close the talk kindly in one or two sentences: you love Sam, and you will make this right with Mum.',
  ].filter(Boolean).join('\n');
}

/** The cue that makes the parent speak first, at the cut to the live shot. */
export function opening(who: Parent, choice: Choice): string {
  if (who === 'claire') {
    return choice === 'step'
      ? 'Sam has just walked into the kitchen in pyjamas and is looking at you. Speak first: notice Sam, try to sound calm, and ask how long Sam has been up.'
      : 'You hear the floor creak: Sam is standing silently in the kitchen doorway in pyjamas. Speak first: notice Sam, try to sound calm, and ask how long Sam has been standing there.';
  }
  return 'Sam is standing in the kitchen doorway in pyjamas. Speak first: a soft, slightly awkward hello, as if nothing happened, maybe a tiny joke, then ask Sam one question about how Sam is doing. This is the start of a real talk with Sam.';
}

export const WRAP = 'WRAP UP: this is your last turn. Close the conversation now, in one or two sentences, as your instructions say.';

// ---- branching

const SIDE = /\b(your fault|(dad|daddy|mum|mom|mommy|mummy)('s| is) (fault|wrong|mean|bad)|on your side|i hate (him|her|dad|mum|mom)|(he|she) (always|never) |(he|she)('s| is) (mean|wrong|the worst)|i('m| am) with you|leave (him|her))\b/i;
const FEELING = /\b(scared|sad|afraid|worried|upset|hurt|cry|crying|yell|yelling|shout|shouting|fight|fighting|feel|loud|stop|love|sorry|don't like|hate it|can't sleep)\b/i;

/** Without a model: what Sam's lines most look like. */
export function wordRules(lines: Said[]): Met {
  const sam = lines.filter((l) => l.who === 'sam').map((l) => l.text).join(' ').trim();
  const words = sam.split(/\s+/).filter(Boolean).length;
  if (words < 4) return { stance: 'silent', summary: '' };
  if (SIDE.test(sam)) return { stance: 'side', summary: `Sam took a side: "${sam.slice(0, 160)}"` };
  if (FEELING.test(sam)) return { stance: 'honest', summary: `Sam said how it felt: "${sam.slice(0, 160)}"` };
  return { stance: words < 10 ? 'silent' : 'honest', summary: words < 10 ? '' : `Sam said: "${sam.slice(0, 160)}"` };
}

export const JUDGE_SYSTEM = [
  'You read a short conversation between a parent and their ten-year-old child Sam, right after Sam overheard the parents fighting.',
  'Decide how Sam met this parent:',
  '- honest: Sam said how the fight made them feel or what they need (scared, sad, "please stop yelling"), without blaming one parent.',
  '- side: Sam blamed one parent, agreed with one against the other, or carried a message to hurt the other.',
  '- silent: Sam said little or nothing real (shrugs, "fine", "nothing", changed the subject).',
  'summary: one sentence the parent would tell their partner about what Sam said, in plain words, third person ("Sam said ..."); empty when silent.',
].join('\n');
export const JUDGE_SCHEMA = {
  type: 'object',
  properties: { stance: { type: 'string', enum: ['honest', 'side', 'silent'] }, summary: { type: 'string' } },
  required: ['stance', 'summary'],
};
export const judgePrompt = (who: Parent, lines: Said[]) => lines
  .map((l) => (l.who === 'noticed' ? `(${who === 'claire' ? 'Mum' : 'Dad'} noted: ${l.text})` : `${l.who === 'sam' ? 'Sam' : who === 'claire' ? 'Mum' : 'Dad'}: ${l.text}`)).join('\n') || '(nothing was said)';

export const normalise = (m: Partial<Met> | null | undefined): Met => ({
  stance: m?.stance === 'honest' || m?.stance === 'side' ? m.stance : 'silent',
  summary: typeof m?.summary === 'string' ? m.summary.slice(0, 300) : '',
});

export const bridgeFor = (claire: Met): Bridge => (claire.stance === 'honest' ? 'scared' : claire.stance === 'side' ? 'sides' : 'wonttalk');

/** Taking a side anywhere splits them; one honest talk with no side taken brings them back; nothing at all leaves silence. */
export function endingFor(claire: Met, mark: Met): Ending {
  if (claire.stance === 'side' || mark.stance === 'side') return 'split';
  if (claire.stance === 'honest' || mark.stance === 'honest') return 'repair';
  return 'silence';
}
