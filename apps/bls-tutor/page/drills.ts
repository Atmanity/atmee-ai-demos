// The four drills as the front door sells them. Product copy only: titles and
// scenes, never a step (the scenario content stays on the server; a test keeps
// the ids, titles and step counts in step with it).
export interface DrillCard { id: string; title: string; who: string; steps: number; teaser: string }

export const DRILLS: readonly DrillCard[] = [
  { id: 'adult_cardiac_arrest', title: 'Adult collapse in a café', who: 'Adult', steps: 7, teaser: 'A man slumps off his chair and stops moving. You are the closest person.' },
  { id: 'child_cardiac_arrest', title: 'Child unresponsive by a pool', who: 'Child', steps: 7, teaser: 'A seven-year-old has just been pulled from the water, and you are alone with her.' },
  { id: 'choking_adult', title: 'Choking at a dinner table', who: 'Adult', steps: 6, teaser: 'Mid-meal, the woman opposite you stands up with both hands at her throat.' },
  { id: 'recovery_position', title: 'Unresponsive but breathing', who: 'Adult', steps: 5, teaser: 'A man is slumped at a bus stop, but his chest rises and falls steadily.' },
];

export const drillCard = (id: string | undefined) => DRILLS.find((d) => d.id === id);

/** The front door's preview: the compressions step of the café drill, taught, word for word from the drill. */
export const PREVIEW = {
  title: 'Adult collapse in a café',
  step: 4,
  of: 7,
  label: 'Start chest compressions',
  teach: 'Heel of one hand on the centre of the chest, other hand on top. Push hard and fast: at least 2 inches — 5 centimetres — deep, 100 to 120 a minute, and let the chest come all the way back up each time.',
  bpm: 110,
} as const;
