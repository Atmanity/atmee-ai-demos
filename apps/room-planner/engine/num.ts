// The few places where Python and JavaScript arithmetic disagree, written
// once so the port of the engine stays faithful to the original numbers.
//
// - Python's round() is round-half-to-even ("banker's rounding"); Math.round
//   rounds halves up. A wall snapped to the 10 cm grid from 445 lands on 440 in
//   the original and would land on 450 here without this.
// - Python's // and % floor towards minus infinity; JS's / and % do not.
// - f"{x:g}" drops trailing zeros ("12" for 12.0, "4.5" for 4.5).

/** Python's round(x, ndigits): halves go to the even neighbour. */
export function pyRound(x: number, ndigits = 0): number {
  const m = 10 ** ndigits;
  const v = x * m;
  const f = Math.floor(v);
  if (v - f === 0.5) return (f % 2 === 0 ? f : f + 1) / m;
  return Math.round(v) / m;
}

/** Python's a // b. */
export const floorDiv = (a: number, b: number) => Math.floor(a / b);

/** Python's a % b (the sign of b). */
export const mod = (a: number, b: number) => ((a % b) + b) % b;

/** Python's format(x, 'g'): six significant digits, no trailing zeros. */
export function fmtG(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return '0';
  const exp = Math.floor(Math.log10(Math.abs(x)));
  if (exp < -4 || exp >= 6) {
    const [mantissa, power] = x.toExponential(5).split('e');
    const m = String(Number(mantissa));
    const p = Number(power);
    return `${m}e${p < 0 ? '-' : '+'}${String(Math.abs(p)).padStart(2, '0')}`;
  }
  return String(Number(x.toPrecision(6)));
}

/** A number from whatever arrived (a number, a numeric string), or NaN. */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

/** Python truthiness for the values intents carry. */
export const truthy = (value: unknown) => Boolean(value) && !(Array.isArray(value) && value.length === 0);

/** Lexicographic comparison of number tuples, as Python compares tuples. */
export function cmpTuple(a: readonly (number | string)[], b: readonly (number | string)[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

/** Python's default string ordering (code points), for sort(). */
export const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
