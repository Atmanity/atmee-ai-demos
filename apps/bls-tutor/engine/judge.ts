// Which drill the learner named. The host passes start_scenario what it heard
// ("choking", "the pool one", "you pick", "the second one", or a title); the
// server decides which of the four that is, or none.
//
// Server only: it reads scenarios.ts, where every step's answer is.
import { clean, LEAVES_IT_TO_YOU, ORDINALS, TITLE_WORDS } from './net.ts';
import { DEFAULT_SCENARIO_ID, find, SCENARIOS } from './scenarios.ts';

/** A scenario named anywhere in the words: its id, or null. */
export function scenarioNamedIn(text: string): string | null {
  const t = clean(text);
  if (!t) return null;
  const found = find(t);
  if (found) return found.id;
  for (const [pattern, id] of TITLE_WORDS) if (pattern.test(t)) return id;
  for (const [pattern, index] of ORDINALS) if (pattern.test(t)) return SCENARIOS[index].id;
  if (LEAVES_IT_TO_YOU.test(t)) return DEFAULT_SCENARIO_ID;
  return null;
}

/**
 * The drill start_scenario's words ask for, or null. The host has already
 * judged that the learner is choosing ("how about choking?" included), so
 * only the name is read here.
 */
export function resolveScenario(words: string): string | null {
  return scenarioNamedIn(String(words ?? '').slice(0, 200));
}
