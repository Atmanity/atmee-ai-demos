// The launcher: what it refuses, and what it refuses to show (ported from
// test_launcher.py). Named after the symptom each one prevents. The projection
// tests matter most: a snapshot that carries the verdict while the ball is
// still in the air turns the animation into a formality played out under a
// result already on screen (and, here, would hand the result to the avatar
// before the ball is down).
import { expect, test } from 'vitest';
import { Launcher, LauncherRefusal, MAX_HISTORY, playSeconds } from './launcher.ts';

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof LauncherRefusal) return err.message;
    throw err;
  }
  throw new Error('expected a refusal');
}

const fireAndLand = (l: Launcher) => { l.fire(); return l.land(); };

test('a new range is aiming at the first challenge', () => {
  const s = new Launcher().snapshot();
  expect(s.phase).toBe('aiming');
  expect(s.challenge.id).toBe('wall40');
  expect(s.last_shot).toBeNull();
  expect(s.attempts).toBe(0);
  expect(s.best_miss_m).toBeNull();
});

test('a shot in the air shows its curve and not its verdict', () => {
  const l = new Launcher();
  l.fire();
  const shot = l.snapshot().last_shot!;
  expect(l.snapshot().phase).toBe('flying');
  expect(shot.path.length && shot.play_s && shot.flight_s).toBeTruthy();
  for (const spoiler of ['cleared', 'miss_m', 'range_m', 'apex_m', 'note']) expect(shot, `${spoiler} was visible mid-flight`).not.toHaveProperty(spoiler);
});

test('the verdict appears only once the shot is down', () => {
  const l = new Launcher();
  fireAndLand(l);
  const shot = l.snapshot().last_shot!;
  expect(shot.cleared).toBe(false);
  expect(shot.range_m).toBe(40.77);
  expect(shot.note).toContain('below the top');
  expect(l.snapshot().phase).toBe('scored');
});

test('landing cannot change the result the shot already had', () => {
  const l = new Launcher();
  const fired = l.fire();
  expect(l.land()).toEqual(fired);
});

test('clearing a challenge moves to debrief and earns the teaching point', () => {
  const l = new Launcher();
  l.setAim(45, 24);
  expect(l.snapshot().challenge).not.toHaveProperty('teach');
  fireAndLand(l);
  const s = l.snapshot();
  expect(s.phase).toBe('debrief');
  expect(s.last_shot!.cleared).toBe(true);
  expect(s.challenge.teach).toContain('Forty-five degrees maximises range');
  expect(s.catalog[0].cleared).toBe(true);
});

test('the teaching point stays hidden until the challenge is cleared', () => {
  const l = new Launcher();
  for (let i = 0; i < 3; i++) { l.setAim(45, 20); fireAndLand(l); }
  expect(l.snapshot().challenge).not.toHaveProperty('teach');
});

test('a speed past the launcher is refused with the numbers', () => {
  expect(refusal(() => new Launcher().setAim(45, 60))).toContain('5 to 40 metres a second');
});

test('a capped challenge refuses with its own cap', () => {
  const l = new Launcher('maxrange');
  expect(refusal(() => l.setAim(45, 30))).toContain('5 to 18 metres a second');
  l.setAim(45, 18); // the cap itself is allowed
});

test('an angle off the rail is refused with the numbers', () => {
  expect(refusal(() => new Launcher().setAim(95, 20))).toContain('5 and 85 degrees');
  expect(refusal(() => new Launcher().setAim(0, 20))).toContain('5 and 85 degrees');
});

test('aiming at nothing says what it wanted', () => {
  expect(refusal(() => new Launcher().setAim('steeper', null))).toContain('angle in degrees');
  expect(refusal(() => new Launcher().setAim(null, 'harder'))).toContain('metres a second');
});

test('changing only the angle leaves the speed alone', () => {
  const l = new Launcher();
  l.setAim(40, null);
  expect(l.snapshot().aim).toEqual({ angle_deg: 40, speed_ms: 20 });
  l.setAim(null, 26);
  expect(l.snapshot().aim).toEqual({ angle_deg: 40, speed_ms: 26 });
});

test('a refused aim leaves the launcher where it was pointing', () => {
  const l = new Launcher();
  const before = l.snapshot().aim;
  refusal(() => l.setAim(45, 99));
  expect(l.snapshot().aim).toEqual(before);
});

test('aiming while it is in the air is refused', () => {
  const l = new Launcher();
  l.fire();
  expect(refusal(() => l.setAim(40, 20))).toContain('still in the air');
});

test('firing twice in one turn is refused rather than doubled', () => {
  const l = new Launcher();
  l.fire();
  expect(refusal(() => l.fire())).toBe("It's already in the air.");
});

test('landing nothing is refused', () => {
  expect(refusal(() => new Launcher().land())).toBe('Nothing is in the air.');
});

test('aiming after a shot re-arms instead of being refused', () => {
  // The loop of the whole app: shoot, adjust, shoot again. Refusing the
  // adjustment would mean telling a student off for playing the game.
  const l = new Launcher();
  fireAndLand(l);
  l.setAim(50, 24);
  expect(l.snapshot().phase).toBe('aiming');
  l.fire();
});

test('the same shot can be repeated without re-aiming', () => {
  const l = new Launcher();
  fireAndLand(l);
  l.fire();
  expect(l.snapshot().phase).toBe('flying');
});

test('an unknown challenge is refused with the list', () => {
  const reason = refusal(() => new Launcher().startChallenge('the one with the dragon'));
  expect(reason).toContain('Clear the wall');
  expect(reason).toContain('On the Moon');
});

test('a challenge can be asked for by name or by id', () => {
  const l = new Launcher();
  l.startChallenge('On the Moon');
  expect(l.snapshot().challenge.id).toBe('moonshot');
  l.startChallenge('headwind');
  expect(l.snapshot().challenge.gravity).toBe(9.81);
});

test('the next challenge wraps rather than running out', () => {
  const l = new Launcher();
  for (let i = 0; i < 6; i++) l.nextChallenge();
  expect(l.snapshot().challenge.id).toBe('wall40');
});

test('a new challenge clears the scoreboard but not what was cleared', () => {
  const l = new Launcher();
  l.setAim(45, 24);
  fireAndLand(l);
  l.nextChallenge();
  const s = l.snapshot();
  expect(s.attempts).toBe(0);
  expect(s.history).toEqual([]);
  expect(s.last_shot).toBeNull();
  expect(s.catalog[0].cleared).toBe(true);
});

test('the scoreboard keeps the best miss, not the last', () => {
  const l = new Launcher();
  l.setAim(45, 20);
  fireAndLand(l);
  const good = l.snapshot().best_miss_m;
  l.setAim(45, 10);
  fireAndLand(l);
  expect(l.snapshot().best_miss_m).toBe(good);
});

test('history is capped, so the drawing and the state cannot grow without bound', () => {
  const l = new Launcher();
  for (let i = 0; i < MAX_HISTORY + 5; i++) fireAndLand(l);
  expect(l.snapshot().history).toHaveLength(MAX_HISTORY);
  expect(l.snapshot().attempts).toBe(MAX_HISTORY + 5);
});

test('the fullest snapshot stays small', () => {
  // There is no 32 KiB wire envelope here any more; the bound still matters
  // because the page re-renders the snapshot on every change. The worst case
  // is a full history of the longest flights with a shot in the air on top.
  const l = new Launcher('moonshot');
  for (let i = 0; i < MAX_HISTORY + 2; i++) { l.setAim(45, 40); fireAndLand(l); }
  l.fire();
  expect(JSON.stringify(l.snapshot()).length).toBeLessThan(12_000);
});

test('reset clears the trails and keeps the challenge', () => {
  const l = new Launcher();
  fireAndLand(l);
  l.reset();
  const s = l.snapshot();
  expect(s.history).toEqual([]);
  expect(s.attempts).toBe(0);
  expect(s.challenge.id).toBe('wall40');
});

test('a long lunar hang time still plays in a watchable animation', () => {
  // 49 seconds of hang time is physically right and unwatchable; the
  // animation and the lander must agree on the shortened play time, so it is
  // a number in the snapshot rather than a constant in either.
  const l = new Launcher('moonshot');
  l.setAim(45, 40);
  l.fire();
  const shot = l.snapshot().last_shot!;
  expect(shot.flight_s).toBeGreaterThan(30);
  expect(shot.play_s).toBe(2.5);
  expect(playSeconds(0.2)).toBe(0.8);
});

test('an unknown start challenge falls back to the first one', () => {
  expect(new Launcher('nope').snapshot().challenge.id).toBe('wall40');
  expect(new Launcher(null).snapshot().challenge.id).toBe('wall40');
  expect(new Launcher('moonshot').snapshot().aim).toEqual({ angle_deg: 45, speed_ms: 12 });
});
