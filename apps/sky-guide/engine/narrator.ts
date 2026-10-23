// The guide being told that the chart changed under the user's hands, in one
// line. Ported from the original `attach_narrator`: it speaks only for changes
// nobody else is speaking for (the chart's own controls; a tool's change comes
// back as the tool's result), and only for material ones.
//
// New in this port: changes are COALESCED. The original's panel had three
// buttons; this one has a slider and steppers, and three quick +1h clicks or a
// drag across the night are one move, so the guide says one line about the
// sky as it ended up, diffed against the sky before the first change.
import { narration } from './guide.ts';
import type { SkyView } from './types.ts';

export class Narrator {
  private baseline: SkyView | null = null;
  private latest: SkyView | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private speak: (line: string) => void, private quietMs = 1200) {}

  /** A control moved the chart from `before` to `after`. */
  changed(before: SkyView, after: SkyView): void {
    this.baseline ??= before;
    this.latest = after;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.quietMs);
  }

  /** Say the pending line now (before a tool's result, so they come in order). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const [before, after] = [this.baseline, this.latest];
    this.baseline = this.latest = null;
    if (!before || !after) return;
    const line = narration(before, after);
    if (line) this.speak(line);
  }

  /** Forget the pending line (the session ended). */
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.baseline = this.latest = null;
  }
}
