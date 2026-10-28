// Auto-advance: the show moves to the next topic when the conversation says
// the current one has run its course, not after a time or a number of turns.
// While the guest gives an answer, once it is EARLY_WORDS long and the topic
// has had MIN_ANSWERS (counting this one), a judge model reads the topic, the
// last lines and the answer so far, and says whether the topic is done; if so,
// the next topic of the rundown goes to the host as if the producer had sent
// it. Asking mid-answer has the verdict back before the host replies: asked
// after the answer, it landed as her reply began and waited a whole exchange.
// An answer too short to reach EARLY_WORDS is judged when it ends. The producer's own topics reset the count, and
// when the rundown is used up the booth is told once, to suggest the wrap.
import type { Role } from './booth.ts';

export const MIN_ANSWERS = 2;
export const EARLY_WORDS = 30;
export const WINDOW = 8;   // the lines the judge reads

export interface Line { who: Role; text: string }
export interface Verdict { done: boolean; reason: string }

export interface AdvanceOptions {
  judge(topic: string, lines: Line[]): Promise<Verdict>;
  /** The next unused topic of the rundown, or null when it is used up. */
  next(): string | null;
  /** Send this topic to the host, as the producer's would be (it comes back through topic()). */
  move(topic: string, reason: string): void;
  /** The rundown is used up: once. */
  exhausted(): void;
  /** Whether to judge now: auto-advance on, the guest on air, the wrap not asked for. */
  enabled(): boolean;
}

export interface Advancer {
  /** The host has been given a topic (the first, the producer's, or a move). */
  topic(topic: string): void;
  /** A line went on air. */
  line(line: Line): void;
  /** The guest's answer so far, as it is spoken. */
  hearing(text: string): void;
}

export function createAdvancer(opts: AdvanceOptions): Advancer {
  let current: string | null = null;
  let answers = 0;
  let asking = false;
  let told = false;
  let askedThisAnswer = false;
  const lines: Line[] = [];

  // `answered` counts the answer being judged; `partial` is its text so far, when it is not over.
  const ask = async (answered: number, partial?: string) => {
    if (!current || asking || told || answered < MIN_ANSWERS || !opts.enabled()) return;
    asking = true;
    if (partial) askedThisAnswer = true;   // this answer is judged; its end need not be
    const topic = current;
    const seen = partial ? [...lines.slice(-(WINDOW - 1)), { who: 'guest' as const, text: partial }] : lines.slice(-WINDOW);
    let verdict: Verdict;
    try {
      verdict = await opts.judge(topic, seen);
    } catch {
      return;   // no verdict: the conversation goes on, and the next answer asks again
    } finally {
      asking = false;
    }
    // A topic sent meanwhile, or the show moved on: this verdict is about the past.
    if (!verdict.done || current !== topic || !opts.enabled()) return;
    const next = opts.next();
    if (next) return opts.move(next, verdict.reason);
    told = true;
    opts.exhausted();
  };

  return {
    topic(topic) { current = topic; answers = 0; },
    line(line) {
      lines.push(line);
      if (lines.length > WINDOW * 2) lines.splice(0, lines.length - WINDOW);
      if (line.who !== 'guest') return;
      answers++;
      const asked = askedThisAnswer;
      askedThisAnswer = false;
      if (!asked) void ask(answers);
    },
    hearing(text) {
      if (askedThisAnswer || text.trim().split(/\s+/).length < EARLY_WORDS) return;
      void ask(answers + 1, text);
    },
  };
}
