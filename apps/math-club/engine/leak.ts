// The host's model sometimes writes a tool call into its words instead of
// making it: give_answer{answer:<ctrl46>1000<ctrl46>}. The page keeps that off
// the screen and makes the call, so the game still moves.
const TOOL = 'give_answer|child_explained|next_round|set_level';

export function leakedCall(text: string): { name: string; arguments: Record<string, string> } | null {
  const found = text.match(new RegExp(`\\b(${TOOL})\\s*\\{([^}]*)\\}`));
  if (!found) return null;
  const [key, value] = found[2].replace(/<ctrl\d+>/g, '').split(':').map((part) => part.trim());
  return { name: found[1], arguments: key && value ? { [key]: value } : {} };
}

/** The words without any tool call, whole or still arriving. */
export function cleanSpeech(text: string): string {
  return text
    .replace(new RegExp(`\\b(${TOOL})\\s*\\{[^}]*\\}`, 'g'), ' ')
    .replace(new RegExp(`\\b(${TOOL})\\s*\\{.*$`), ' ')
    .replace(/<ctrl\d+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
