/**
 * The card's small judgements, in one place so they can be tested.
 *
 * `NutritionPanel.tsx` renders; this module decides. Ported unchanged from the
 * mini-app panel, plus `DAILY_VALUES` (moved here from the card), because the
 * avatar's board (director.ts) states the same %DV the bars draw: the card and
 * the voice must not disagree about one figure.
 */

/**
 * The daily values the %DV bars are measured against (a 2,000-calorie day).
 */
export const DAILY_VALUES: Record<string, number> = {
  protein_g: 50,
  carbs_g: 275,
  fat_g: 78,
  fiber_g: 28,
  // No %DV: the FDA's 50 g figure is for ADDED sugars, and this field is TOTAL
  // sugar. Dividing by it told a parent a banana's natural sugar was "28% DV"
  // of a limit that does not apply to it, and juice "48%" of one that partly
  // does. A wrong denominator in the most-mistrusted field on the card.
  // sugar_g intentionally absent — the bar renders without a percentage.
  sodium_mg: 2300,
};

/** Where a figure came from. Absent on payloads that predate the field. */
export type Source = 'label' | 'estimate';

export interface Provenance {
  /** What the chip says. Muted, not alarming — it is a fact, not a warning. */
  label: string;
  /** Suffix for the chip's class, so the two read differently. */
  tone: 'label' | 'estimate';
}

/**
 * The provenance chip.
 *
 * The brief's rule: "a figure that was read off a label and a figure recalled
 * from training are different claims, and the card must not render them
 * identically. Until the app can tell them apart it must not imply it can."
 * So an absent or unrecognised `source` renders NO chip — silence is the
 * honest answer, and a default of "estimated" would be a claim the payload did
 * not make.
 */
export function provenance(source: unknown): Provenance | null {
  if (source === 'label') return { label: 'read from your label', tone: 'label' };
  if (source === 'estimate') return { label: 'estimated', tone: 'estimate' };
  return null;
}

/**
 * The serving line, with an assumed portion marked as assumed.
 *
 * "A number without the portion it describes is not an answer" — and a portion
 * the model guessed is not the portion the user has. `portion_assumed` turns
 * "1 medium banana" into "assumed: 1 medium banana" rather than hiding the
 * guess behind the same words a stated portion would use.
 */
export function servingLine(servingSize: unknown, portionAssumed: unknown): string {
  const serving = typeof servingSize === 'string' ? servingSize.trim() : '';
  if (!serving) return portionAssumed === true ? 'portion assumed' : '';
  return portionAssumed === true ? `assumed: ${serving}` : serving;
}

export interface DailyValue {
  /** The figure printed beside the grams, unclamped. `null` when there is no DV. */
  pct: number | null;
  /** How much of the track to fill. The bar cannot draw past its own end. */
  barPct: number;
  /** Past the reference. The track says so rather than sitting there full. */
  over: boolean;
}

/**
 * A nutrient as a share of the daily value.
 *
 * The LABEL is not clamped — going over the reference is the whole point of
 * the figure. The BAR is, because it cannot draw past its track, which is
 * exactly why `over` exists: without it 117% and 300% are the same picture as
 * 100%, and the shape is read before the digits.
 */
export function dailyValue(value: number, dv: number | undefined): DailyValue {
  if (!dv) return { pct: null, barPct: 0, over: false };
  const pct = Math.round((value / dv) * 100);
  return { pct, barPct: Math.min(100, Math.max(0, pct)), over: pct > 100 };
}

/** What a `%DV` bar is measured against, said once under the bars. */
export const DV_REFERENCE_NOTE = '% DV is of a 2,000-calorie day.';

/**
 * Why an RPC rejected, as something a person can read.
 *
 * A failed call rejects with whatever it held — a string, an Error, an
 * object with a reason, or nothing at all. Every one of those has to become a
 * sentence, because the alternative shipped once already: `void
 * client.call(...)`, an unhandled rejection in the console, and a button that
 * looked like it did nothing.
 */
export function reasonFrom(err: unknown, fallback = 'it did not go through'): string {
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  if (typeof err === 'object' && err !== null) {
    const bag = err as Record<string, unknown>;
    for (const key of ['reason', 'message', 'error'] as const) {
      const value = bag[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return fallback;
}
