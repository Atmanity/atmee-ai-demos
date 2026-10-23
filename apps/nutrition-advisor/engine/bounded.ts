// Two small guards from the original's hardest-won bugs, as plain functions.
//
// * One photo at a time. Two quick uploads ran two overlapping reads, each
//   writing the card, so the card could end up showing the first photo while
//   the shelf and the spoken answer described the second.
// * Every model call has a deadline. Nothing under the original's tool body had
//   one, so a call that never settled did not fail the turn, it SUSPENDED it,
//   and every later turn queued behind it: accepting the avatar's own offer of
//   a recipe once ended the conversation, four messages and ninety seconds of
//   nothing. A card that has not arrived by the deadline has lost the moment;
//   the conversation is worth more than the card.

/**
 * A queue that runs its tasks one at a time, in the order they were given.
 * The queue outlives each task (a fresh one per task would exclude nobody), and
 * a task that fails does not stop the next one: a lock released only on the
 * happy path is a leg that stops after its first failure.
 */
export function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

export class TimedOut extends Error {
  constructor(what: string, ms: number) {
    super(`${what} did not answer within ${Math.round(ms / 1000)} s`);
  }
}

/** `work`, or a `TimedOut` rejection once `ms` have passed. Never hangs. */
export function bounded<T>(work: Promise<T>, ms: number, what = 'the call'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TimedOut(what, ms)), ms); });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
