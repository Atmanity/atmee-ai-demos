// The student's logbook: every challenge, how many shots it took, the shot
// that cleared it with the range's own sentence, and the lesson it taught.
// Built from the range's landings only, so it holds nothing the screen did
// not already show; a lesson appears only once its challenge is cleared.
// It outlives a challenge's "start over" (which clears the range's trails,
// not the student's record) and a call ending.
import { CHALLENGES } from './challenges.ts';
import type { Change } from './types.ts';

export interface ClearingShot { angle_deg: number; speed_ms: number; note: string; shot: number }

export interface Entry {
  id: string;
  name: string;
  blurb: string;
  /** Shots that landed on this challenge, across any starting over. */
  shots: number;
  /** The first shot that cleared it, or null. */
  cleared: ClearingShot | null;
  /** The teaching point, once cleared. */
  lesson: string | null;
}

export const emptyLog = (): Entry[] => CHALLENGES.map((c) => ({ id: c.id, name: c.name, blurb: c.blurb, shots: 0, cleared: null, lesson: null }));

/** The log after one change of the range: only a landing writes to it. */
export function logChange(log: Entry[], change: Change): Entry[] {
  if (change.intent.kind !== 'land') return log;
  const shot = change.snapshot.last_shot;
  const id = change.snapshot.challenge.id;
  if (!shot || shot.cleared === undefined) return log;
  return log.map((e) => {
    if (e.id !== id) return e;
    const shots = e.shots + 1;
    if (e.cleared || !shot.cleared) return { ...e, shots };
    const lesson = CHALLENGES.find((c) => c.id === id)?.teach ?? null;
    return { ...e, shots, cleared: { angle_deg: shot.angle_deg, speed_ms: shot.speed_ms, note: shot.note ?? '', shot: shots }, lesson };
  });
}

export const clearedCount = (log: Entry[]) => log.filter((e) => e.cleared).length;
export const shotCount = (log: Entry[]) => log.reduce((n, e) => n + e.shots, 0);

/** The logbook as a plain-text file the student keeps. */
export function logbookText(log: Entry[], when: Date): string {
  const date = when.toISOString().slice(0, 10);
  const lines = [
    `ARCWISE LOGBOOK, ${date}`,
    `${clearedCount(log)} of ${log.length} challenges cleared in ${shotCount(log)} shots.`,
    '',
  ];
  log.forEach((e, i) => {
    lines.push(`${i + 1}. ${e.name}: ${e.blurb}`);
    if (e.cleared) {
      lines.push(`   Cleared on shot ${e.cleared.shot} of ${e.shots}, at ${e.cleared.angle_deg} degrees and ${e.cleared.speed_ms} m/s.`);
      lines.push(`   ${e.cleared.note}`);
      if (e.lesson) lines.push(`   The lesson: ${e.lesson}`);
    } else if (e.shots) {
      lines.push(`   Not cleared yet: ${e.shots} shot${e.shots === 1 ? '' : 's'}.`);
    } else {
      lines.push('   Not tried yet.');
    }
    lines.push('');
  });
  lines.push('Every number was computed exactly: launched from the ground, constant gravity, wind on the horizontal only, no drag.');
  return lines.join('\n');
}
