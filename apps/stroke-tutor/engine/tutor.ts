// The tutor's rules: pure, no I/O, SERVER ONLY.
//
// `StrokeTutor` is the truth the page projects. It holds which character is on
// the board, which stroke is live, how many attempts that stroke has taken,
// the score and the last verdict. Everything it refuses throws `TutorRefusal`,
// whose message IS the sentence the learner sees (and hears, when they asked
// in words).
//
// Two properties are what the app is:
//
// - A stroke's reference points are in the snapshot only once that stroke is
//   EARNED: answered correctly, or revealed on request. The live stroke and
//   every stroke after it carry `points: []` (and no name or teaching line).
//   Drawing the stroke the learner is being asked to draw is not a hint, it is
//   tracing, and tracing is the whole exercise failing. `strokesView` is that
//   rule, in one function, with one test per status.
// - Grading is deterministic and lives in strokes.ts. Order and direction are
//   decided by geometry against characters.ts; the avatar reads the note out
//   loud and never rules on whether a stroke was right.
import {
  catalog,
  DEFAULT_CHARACTER_ID,
  find,
  GRID,
  nextAfter,
  UNKNOWN_CHARACTER_REASON,
  type Character,
  type Stroke,
} from './characters.ts';
import { clean, decimate, grade, isDegenerate } from './strokes.ts';
import type { CharacterView, Phase, Snapshot, StrokeView, Verdict } from './types.ts';

/** A refusal whose message is shown (and said) to the learner verbatim. */
export class TutorRefusal extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'TutorRefusal';
  }
}

// The refusals, verbatim. Constants because the tests assert the exact
// sentence: a refusal the learner cannot act on is the same bug as no refusal,
// and rewording one silently is how that happens.
export const BETWEEN_STROKES = "We're between strokes — say next when you're ready.";
export const CHARACTER_FINISHED = "That character's finished; pick another when you're ready.";
export const STROKE_UNRESOLVED = 'Finish this stroke first.';
export const ALREADY_RESOLVED = "That one's already done.";
export const NOTHING_TO_CLEAR = "There's nothing to clear yet — draw the stroke when you're ready.";
export const UNKNOWN_CHARACTER = UNKNOWN_CHARACTER_REASON;
/** A drawn stroke that is a tap or a slip. Refused rather than graded, because "I couldn't match that" would read as a comment on their handwriting. */
export const DEGENERATE_STROKE = "That didn't come through as a stroke — draw it as one line.";

/** One learner writing one character at a time. */
export class StrokeTutor {
  private _character: Character | null = null;
  private strokeIndex = 0;
  private attempts = 0;
  private resolved = false;
  private correct = 0;
  private total = 0;
  private lastVerdict: Verdict | null = null;
  private _phase: Phase = 'intro';

  // ----------------------------------------------------------------- reads

  get phase(): Phase { return this._phase; }

  get character(): Character | null { return this._character; }

  currentStroke(): Stroke | null {
    if (!this._character || this.strokeIndex >= this._character.strokes.length) return null;
    return this._character.strokes[this.strokeIndex];
  }

  // ------------------------------------------------------------- mutations

  /** Put a character on the board, from scratch. Also how a learner starts the same one over (no id). */
  startCharacter(characterId?: string | null): void {
    let character: Character | null;
    if (characterId) {
      character = find(characterId);
      if (!character) throw new TutorRefusal(UNKNOWN_CHARACTER);
    } else {
      // No id is "start this one over", and at the very beginning it is
      // "start me somewhere": the easiest character, not a refusal the learner
      // cannot act on.
      character = this._character ?? find(DEFAULT_CHARACTER_ID);
    }
    this.begin(character!);
  }

  /**
   * Move on through the teaching order. Never refused: at the end of the set
   * it wraps, because "next" there is a learner who wants to keep going and a
   * dead end is a refusal with nothing to act on.
   */
  nextCharacter(): void {
    this.begin(nextAfter(this._character?.id ?? null));
  }

  /** Grade one drawn stroke against the live one. */
  stroke(points: unknown): Verdict {
    this.requireCharacter();
    if (this._phase !== 'writing') throw new TutorRefusal(this._phase === 'debrief' ? CHARACTER_FINISHED : BETWEEN_STROKES);
    const drawn = decimate(clean(points));
    // Refused, not graded: a slip is not an attempt, and counting it would
    // push the learner into the two-miss rescue for nothing.
    if (isDegenerate(drawn)) throw new TutorRefusal(DEGENERATE_STROKE);
    const verdict = grade(this._character!, this.strokeIndex, drawn);
    this.attempts += 1;
    this.lastVerdict = verdict;
    if (verdict.ok) {
      this.correct += 1;
      this.resolve();
    }
    return verdict;
  }

  /**
   * Show the stroke instead of grading it. Refused once the stroke is
   * resolved, which is what makes the two-miss rescue single-shot without
   * anything having to remember it.
   */
  reveal(): Verdict {
    this.requireCharacter();
    if (this._phase === 'debrief') throw new TutorRefusal(CHARACTER_FINISHED);
    if (this._phase !== 'writing') throw new TutorRefusal(ALREADY_RESOLVED);
    const stroke = this.currentStroke()!;
    const verdict: Verdict = { ok: false, kind: 'reveal', note: stroke.teach, revealed: true };
    this.lastVerdict = verdict;
    this.resolve();
    return verdict;
  }

  /** Move to the next stroke. Refused while this one is unresolved: not skipping a stroke is the entire point of the app. */
  nextStroke(): void {
    this.requireCharacter();
    if (this._phase === 'writing') throw new TutorRefusal(STROKE_UNRESOLVED);
    if (this._phase !== 'coaching') throw new TutorRefusal(this._phase === 'debrief' ? CHARACTER_FINISHED : BETWEEN_STROKES);
    const strokes = this._character!.strokes;
    this.strokeIndex += 1;
    this.attempts = 0;
    this.resolved = false;
    this.lastVerdict = null;
    if (this.strokeIndex >= strokes.length) {
      this.strokeIndex = strokes.length;
      this._phase = 'debrief';
      return;
    }
    this.total += 1;
    this._phase = 'writing';
  }

  /**
   * Wipe the attempt count and the verdict for the live stroke.
   *
   * Refused when there is nothing to clear. "Nothing" means the count and the
   * verdict, both of which this object owns. The ink on the canvas is view
   * state the server is never told about: the page wipes its own trail
   * alongside this, and that half needs no permission.
   */
  clearAttempt(): void {
    this.requireCharacter();
    if (this._phase !== 'writing') throw new TutorRefusal(this._phase === 'debrief' ? CHARACTER_FINISHED : BETWEEN_STROKES);
    if (this.attempts === 0 && this.lastVerdict === null) throw new TutorRefusal(NOTHING_TO_CLEAR);
    this.attempts = 0;
    this.lastVerdict = null;
  }

  // ------------------------------------------------------------- internals

  private begin(character: Character): void {
    this._character = character;
    this.strokeIndex = 0;
    this.attempts = 0;
    this.resolved = false;
    this.correct = 0;
    this.total = 1;
    this.lastVerdict = null;
    this._phase = 'writing';
  }

  private requireCharacter(): void {
    if (!this._character) throw new TutorRefusal(BETWEEN_STROKES);
  }

  private resolve(): void {
    this.resolved = true;
    this._phase = 'coaching';
  }

  // -------------------------------------------------------------- snapshot

  /**
   * The PUBLIC projection: what the page draws and the avatar is told.
   *
   * Small by construction: at most a handful of strokes per character, at
   * most `MAX_POINTS` points each, and points present only on the ones
   * already earned.
   */
  snapshot(): Snapshot {
    return {
      phase: this._phase,
      character: this.characterSummary(),
      stroke_index: this.strokeIndex,
      strokes: this.strokesView(),
      attempts: this.attempts,
      last_verdict: this.lastVerdict ? { ...this.lastVerdict } : null,
      score: { correct: this.correct, total: this.total },
      grid: GRID,
      catalog: catalog(),
    };
  }

  private characterSummary(): CharacterView | null {
    const c = this._character;
    if (!c) return null;
    return { id: c.id, glyph: c.glyph, meaning: c.meaning, reading: c.reading, script: c.script, strokes_total: c.strokes.length };
  }

  /**
   * The character so far, with every unearned stroke's shape withheld.
   *
   * The live stroke is withheld too: it is the question. Sending its points
   * beside "draw the second stroke" turns the exercise into tracing. A stroke
   * gets its points (and its name and lesson) when it resolves: drawn
   * correctly, or revealed on request.
   *
   * This is the leak the app is most exposed to, so it is one function with
   * one test per status.
   */
  private strokesView(): StrokeView[] {
    if (!this._character) return [];
    return this._character.strokes.map((stroke, index) => {
      let status: StrokeView['status'];
      if (index < this.strokeIndex) status = 'done';
      // "current" is unearned by definition: `resolved` promotes it to "done" the moment it is not.
      else if (index === this.strokeIndex) status = this.resolved ? 'done' : 'current';
      else status = 'hidden';
      if (status !== 'done') return { index, status, points: [] };
      return { index, status, points: stroke.points.map(([x, y]) => [x, y] as [number, number]), name: stroke.name, teach: stroke.teach };
    });
  }
}
