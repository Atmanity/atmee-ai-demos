// The snapshot as the server projects it (engine/tutor.ts snapshot()), and the
// picture for each step. Ported from the original panel's snapshot.ts.
//
// Every field is READ. The page has no scenario content and no grading: a step
// it has not been told about has an empty `label`, and that is deliberate.
export type { CatalogEntry, Intent, Phase, ScenarioView, Snapshot, StepOutcome, StepStatus, StepView, Verdict } from '../engine/types.ts';

/** The picture for a step, chosen by the step's `visual` key. Emoji: no assets to load. */
export const VISUALS: Record<string, { glyph: string; caption: string }> = {
  scene: { glyph: '⚠️', caption: 'Look at the scene' },
  victim_face: { glyph: '🫥', caption: 'Response and breathing' },
  phone_aed: { glyph: '📞', caption: 'Call for help' },
  torso_hands: { glyph: '🫸', caption: 'Chest compressions' },
  child_torso: { glyph: '🧒', caption: 'Child compressions' },
  airway: { glyph: '🌬️', caption: 'Airway and breaths' },
  aed_pads: { glyph: '⚡', caption: 'AED pads' },
  handover: { glyph: '🚑', caption: 'Until help takes over' },
  choking_person: { glyph: '😰', caption: 'Choking' },
  back_blows: { glyph: '🤲', caption: 'Back blows' },
  abdo_thrusts: { glyph: '🫂', caption: 'Abdominal thrusts' },
  side_position: { glyph: '🛌', caption: 'Recovery position' },
};

export function visualFor(key: string | undefined) {
  return VISUALS[key ?? 'scene'] ?? VISUALS.scene;
}
