// What a child's words clearly ask for, for the safety net. Only walking on:
// it is refused unless the stop is cleared, so doing it twice costs nothing.
export function mustDo(text: string): 'walk_on' | null {
  const said = text.toLowerCase();
  return /\b(let'?s go|next stop|walk on|keep going|move on|go on)\b/.test(said) ? 'walk_on' : null;
}
