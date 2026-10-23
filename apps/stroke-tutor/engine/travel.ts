// Which way a line travels, in plain words, for a verdict that must not be
// flipped. Live, a stroke drawn upwards met the sheet's "Top to bottom." and
// Ren said "that one went top to bottom!": a bare direction reads as either
// what they did or what is right. So a backwards stroke is told as two
// separate sentences, what they drew and which way it goes, each computed
// from the line itself ("You drew it from the bottom up. This stroke goes
// from the top down.").

/** "from the top down", "from right to left", "from the top down to the left"…: the line's overall travel, start to end. */
export function travelOf(points: readonly (readonly [number, number])[]): string {
  const [x0, y0] = points[0];
  const [x1, y1] = points[points.length - 1];
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (Math.abs(dy) >= 2 * Math.abs(dx)) return dy >= 0 ? 'from the top down' : 'from the bottom up';
  if (Math.abs(dx) >= 2 * Math.abs(dy)) return dx >= 0 ? 'from left to right' : 'from right to left';
  const side = dx < 0 ? 'left' : 'right';
  return dy >= 0 ? `from the top down to the ${side}` : `from the bottom up to the ${side}`;
}

/** What the learner drew and which way the stroke goes, never the same words. */
export function travelPair(drawn: readonly (readonly [number, number])[], reference: readonly (readonly [number, number])[]): { drawn: string; right: string } {
  const right = travelOf(reference);
  const theirs = travelOf(drawn);
  return { drawn: theirs === right ? 'the other way round' : theirs, right };
}
