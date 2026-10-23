// A playing card: the table's code ("As", "Td") drawn on card stock, a face
// down back, or an empty slot on the board.
import { spokenCard } from '../engine/cards.ts';

// U+FE0E asks for the text glyph: some phones draw the bare suits as emoji.
const SUITS: Record<string, string> = { s: '♠︎', h: '♥︎', d: '♦︎', c: '♣︎' };
const RANKS: Record<string, string> = { T: '10' };

export type CardSize = 'sm' | 'md' | 'lg';

export function CardView({ card, faceDown = false, size = 'md', className = '' }: {
  card?: string | null;
  faceDown?: boolean;
  size?: CardSize;
  className?: string;
}) {
  if (faceDown) return <span className={`bs-card is-back is-${size} ${className}`} role="img" aria-label="A face-down card" />;
  if (!card) return <span className={`bs-card is-slot is-${size} ${className}`} aria-hidden="true" />;
  const rank = card[0]?.toUpperCase() ?? '';
  const suit = card[1]?.toLowerCase() ?? '';
  const red = suit === 'h' || suit === 'd';
  return (
    <span className={`bs-card is-${size} ${red ? 'is-red' : ''} ${className}`} role="img" aria-label={spokenCard(card)}>
      <span className="bs-card-rank" aria-hidden="true">{RANKS[rank] ?? rank}</span>
      <span className="bs-card-suit" aria-hidden="true">{SUITS[suit] ?? '?'}</span>
      <span className="bs-card-pip" aria-hidden="true">{SUITS[suit] ?? '?'}</span>
    </span>
  );
}
