// Telling a drill apart from an emergency.
//
// This is the only part of the app where a wrong answer is not a teaching
// moment. If someone is kneeling next to a person who is not breathing and
// talking to an avatar instead of a dispatcher, nothing else this app does
// matters, so the check runs on EVERY user turn (typed, spoken, and the
// panel's answer box), before the tutor sees it, and it is deliberately biased
// towards stopping.
//
// Two things keep it from firing on ordinary practice speech:
//
// - the patterns are *in-progress* phrasings ("he's not breathing", "right
//   now", "this is happening"), not protocol vocabulary: a learner answering
//   "I'd check if he's breathing" says "breathing", not "he's not breathing";
// - an explicitly hypothetical framing ("I would…", "I'd…", "in this
//   scenario") suppresses it, because that is a learner narrating the drill.
//
// The suppression list is short on purpose. A false positive costs one red
// card and a sentence; a false negative costs a life.
//
// Pure: the page imports it too, so the card goes up the instant the words
// arrive, without waiting for the server.

/** Phrases that read as an emergency happening while the user is speaking. */
export const EMERGENCY_PATTERNS: readonly string[] = [
  'not breathing',
  "isn't breathing",
  'isnt breathing',
  'is not breathing',
  'stopped breathing',
  'no pulse',
  'right now',
  'happening now',
  'happening right now',
  'actually happening',
  'real emergency',
  'this is real',
  'for real',
  "i'm with him",
  'im with him',
  "i'm with her",
  'im with her',
  'he collapsed',
  'she collapsed',
  'someone collapsed',
  'just collapsed',
  'call 911?',
  'should i call 911',
  'do i call 911',
  'help me now',
  "he's dying",
  'shes dying',
  "she's dying",
  'unconscious in front of me',
  // Added in the port: 112 is the emergency number across Europe (and works
  // from most mobiles elsewhere). The original listed 911 only.
  'call 112?',
  'should i call 112',
  'do i call 112',
];

/**
 * Framings that mark the turn as narration of the drill rather than a report.
 * Checked first: "I would call 911 right now" is an answer, not a 911 call.
 */
export const HYPOTHETICAL_MARKERS: readonly string[] = [
  'i would',
  "i'd ",
  'id ',
  'would you',
  'in this scenario',
  'in the scenario',
  'hypothetic',
  'for practice',
  'practising',
  'practicing',
  'pretend',
  'role play',
  'roleplay',
  // Picking something off the menu. The scenario list is literally titled
  // "Adult collapse in a café" and "Choking at a dinner table", so choosing
  // one out loud ("let's do the one where someone collapsed") hit "someone
  // collapsed" and replaced the whole app with a red 911 card within a minute
  // of arriving. These phrasings are a person browsing, and nobody standing
  // over a collapsed body opens with "let's try the one where".
  //
  // Deliberately NOT suppressed by phase instead: intro is precisely when a
  // frightened person might arrive and type the real thing, so the watch has
  // to stay armed there.
  "let's do",
  'lets do',
  "let's try",
  'lets try',
  "let's start",
  'lets start',
  'can we do',
  'can we try',
  'the one where',
  'the one with',
  'give me the',
  'scenario',
];

/** What the user says to come back after a real-emergency stop. */
export const RESUME_MARKERS: readonly string[] = [
  'practising again',
  'practicing again',
  'practice again',
  'just practising',
  'just practicing',
  'not a real emergency',
  'not real',
  'no emergency',
  'nobody is hurt',
  'no one is hurt',
  'new scenario',
  'another scenario',
  'start a scenario',
  'keep practising',
  'keep practicing',
];

/**
 * More ways of saying it, from the original's `resume_practice` tool, whose
 * model decided this ("false alarm", "sorry, nobody is hurt", "I was only
 * asking", "can we go back to practising"). The port has no model in that
 * loop, so the phrasings are listed.
 */
export const RESUME_MARKERS_SPOKEN: readonly string[] = [
  'false alarm',
  "nobody's hurt",
  "no one's hurt",
  'nobody is in danger',
  'no one is in danger',
  "nobody's in danger",
  "no one's in danger",
  'nobody is injured',
  'everyone is fine',
  "everyone's fine",
  'everyone is ok',
  "everyone's ok",
  'everyone is okay',
  "everyone's okay",
  'everybody is fine',
  "everybody's fine",
  'i was only asking',
  'i was just asking',
  'only asking',
  'just asking',
  'back to practice',
  'back to practising',
  'back to practicing',
  "it's just practice",
  'it was a test',
  'just testing',
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The markers, anchored to a word start. A bare substring test made "id "
 * (the apostrophe-less "I'd") match inside "kid ", "said " and "did ", so "my
 * kid is not breathing" was read as a learner narrating the drill and the stop
 * never fired. A suppression that swallows the one sentence this app exists to
 * catch is worse than no suppression at all.
 */
const HYPOTHETICAL = new RegExp(`\\b(?:${HYPOTHETICAL_MARKERS.map(escape).join('|')})`);

/**
 * Lower-cased, single-spaced. Punctuation is KEPT: "call 911?" is a question
 * to a dispatcher and "call 911" is an answer to a drill.
 *
 * Two additions in the port, both towards catching more: curly apostrophes
 * (phone keyboards type "he’s not breathing") become straight ones, and a
 * spoken "nine one one" or "9-1-1" becomes "911".
 */
export function normalize(text: string): string {
  return (text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[‘’ʼ′`]/g, "'")
    .replace(/\bnine[\s-]+one[\s-]+one\b/g, '911')
    .replace(/\b9[\s-]+1[\s-]+1\b/g, '911')
    .replace(/\bone[\s-]+one[\s-]+two\b/g, '112')
    .replace(/\b1[\s-]+1[\s-]+2\b/g, '112')
    .replace(/\s+/g, ' ');
}

/**
 * Added in the port: someone of the speaker's own in a bad way ("my dad
 * collapsed", "my baby is choking"). Learners narrate the drill as "he", "she"
 * or "the man"; "my wife is unconscious" is a report. The original's list
 * caught these only when a second phrase ("not breathing", "right now") came
 * with them.
 */
const FIRST_PERSON_REPORT = /\b(?:my|our) (?:[a-z']+ ){0,2}(?:is |has |just |suddenly )*(?:collapsed|choking|unconscious|unresponsive|passed out|turning blue|not moving|fitting|having a seizure)\b/;

/** Does this turn look like an emergency in progress? */
export function isRealEmergency(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) return false;
  if (HYPOTHETICAL.test(normalized)) return false;
  return EMERGENCY_PATTERNS.some((pattern) => normalized.includes(pattern)) || FIRST_PERSON_REPORT.test(normalized);
}

/** Has the user said they are practising again? (The original's markers.) */
export function isPracticeResume(text: string): boolean {
  const normalized = normalize(text);
  return Boolean(normalized) && RESUME_MARKERS.some((marker) => normalized.includes(marker));
}

/**
 * Does this turn clear the emergency card? It must say plainly that nobody is
 * in danger, and nothing else in it may still read as an emergency: "false
 * alarm… no wait, he's not breathing" keeps the card up. The resume phrases are
 * taken out before that second check, because "it's not a real emergency"
 * contains "real emergency".
 */
export function clearsEmergency(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) return false;
  const markers = [...RESUME_MARKERS, ...RESUME_MARKERS_SPOKEN];
  if (!markers.some((marker) => normalized.includes(marker))) return false;
  let rest = normalized;
  for (const marker of [...markers].sort((a, b) => b.length - a.length)) rest = rest.split(marker).join(' ');
  return !isRealEmergency(rest);
}
