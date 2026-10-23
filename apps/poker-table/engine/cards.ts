// Cards as the table writes them ("As", "Td"), the deck, and how a card is
// said out loud.

export const RANK_ORDER = '23456789TJQKA';
export const SUITS = 'shdc';

/** A fresh 52-card deck, shuffled with `random` (Fisher-Yates). */
export function newDeck(random: () => number = secureRandom): string[] {
  const deck: string[] = [];
  for (const r of RANK_ORDER) for (const s of SUITS) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** A float in [0, 1) from the platform's cryptographic generator: the deck must not be guessable. */
export function secureRandom(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

// Card codes are wire shorthand. Said aloud they have to be words: a TTS voice
// reads "As" as the word "as", and a player who asked what they were holding
// heard "you have as and ten dee".
const RANK_WORDS: Record<string, string> = {
  A: 'ace', K: 'king', Q: 'queen', J: 'jack', T: 'ten',
  '9': 'nine', '8': 'eight', '7': 'seven', '6': 'six', '5': 'five',
  '4': 'four', '3': 'three', '2': 'two',
};
const SUIT_WORDS: Record<string, string> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };

/** "As" -> "ace of spades". Unknown shapes pass through unchanged. */
export function spokenCard(card: string): string {
  const text = String(card ?? '').trim();
  if (text.length !== 2) return text;
  const rank = RANK_WORDS[text[0].toUpperCase()];
  const suit = SUIT_WORDS[text[1].toLowerCase()];
  return rank && suit ? `${rank} of ${suit}` : text;
}

/** "ace of spades, ten of hearts and two of clubs". */
export function spokenCards(cards: readonly string[]): string {
  const words = cards.map(spokenCard);
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
