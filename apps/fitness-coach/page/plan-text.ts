// The plan as a file to keep: what "Save plan" downloads. Plain text, so it
// opens anywhere and prints cleanly. Only what the board showed: the moves
// that survived the user's limits, and the limits they were built around.
import { constraintChips, type FitnessConstraints, type FitnessPlan } from './parsers.ts';

export function planText(plan: FitnessPlan, constraints: FitnessConstraints, coach: string, date = new Date()): string {
  const rule = '-'.repeat(Math.min(48, Math.max(12, plan.plan_title.length)));
  const lines = [plan.plan_title.toUpperCase(), rule];
  const meta = [plan.goal, plan.level, plan.duration_minutes ? `${plan.duration_minutes} min` : ''].filter(Boolean).join(' · ');
  if (meta) lines.push(meta);
  const chips = constraintChips(constraints);
  if (chips.length) lines.push(`Built around: ${chips.join(' · ')}`);
  const section = (title: string, steps: string[], numbered: boolean) => {
    if (!steps.length) return;
    lines.push('', title.toUpperCase(), ...steps.map((step, i) => `${numbered ? `${String(i + 1).padStart(2, ' ')}. ` : '  - '}${step}`));
  };
  section('Warm-up', plan.warmup_steps, false);
  section('Workout', plan.workout_steps, true);
  section('Form cues', plan.coaching_cues, false);
  lines.push('', `Built with ${coach} on Spotter, ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
    'Stop if anything feels sharp, and check with a health professional before training through pain.');
  return `${lines.join('\n')}\n`;
}

/** A file name from the plan's title: "spotter-glute-bridge-builder.txt". */
export function planFileName(plan: FitnessPlan): string {
  const slug = plan.plan_title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return `spotter-${slug || 'plan'}.txt`;
}
