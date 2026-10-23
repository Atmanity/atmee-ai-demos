// The two sentences nobody may paraphrase on screen, and the emergency card
// built from them. They live apart from the scenario content because the page
// imports them, and the page must never import scenarios.ts: it holds every
// step's answer, and whatever the page imports ends up in the browser.
import type { Snapshot } from './types.ts';

/**
 * Said in the opening AND drawn permanently in the panel footer. Verbatim in
 * both places: a practice app that reads as clinical instruction is the
 * failure mode that matters here.
 */
export const SAFETY_LINE = 'This is CPR practice, not certification, and not medical advice. In a real emergency call 911.';

/**
 * The original spoke this word for word (`session.say`, no model in the path)
 * the moment a turn looked like a real emergency in progress. Through the API
 * the avatar can only be asked to say it; the card on screen carries it exactly.
 */
export const EMERGENCY_LINE =
  "Stop — if this is happening now, hang up and call 911 (or your local emergency number) and follow the dispatcher. I'm a practice app and I can't help with a real emergency.";

/** The card's headline: the numbers to dial, at a glance. */
export const EMERGENCY_TITLE = 'Call 911 / 112 now';

/**
 * The emergency projection, kept almost empty: there is nothing to practise on
 * that screen. The tutor builds its snapshot from this, and the page uses it to
 * put the card up the instant it reads an emergency, before the server answers.
 */
export function emergencySnapshot(from: Pick<Snapshot, 'scenario' | 'score' | 'safety_ack'> | null): Snapshot {
  return {
    phase: 'emergency',
    emergency_message: EMERGENCY_LINE,
    safety_notice: SAFETY_LINE,
    safety_ack: from?.safety_ack ?? false,
    scenario: from?.scenario ?? null,
    score: from?.score ?? { correct: 0, total: 0 },
  };
}
