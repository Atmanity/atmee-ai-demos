const SUIT_SYMBOLS: Record<string, string> = {
  s: "\u2660",
  h: "\u2665",
  d: "\u2666",
  c: "\u2663",
};

const SUIT_COLORS: Record<string, string> = {
  s: "#1a1a2e",
  h: "#dc2626",
  d: "#dc2626",
  c: "#1a1a2e",
};

const RANK_DISPLAY: Record<string, string> = {
  A: "A",
  K: "K",
  Q: "Q",
  J: "J",
  T: "10",
  "9": "9",
  "8": "8",
  "7": "7",
  "6": "6",
  "5": "5",
  "4": "4",
  "3": "3",
  "2": "2",
};

interface CardViewProps {
  card?: string | null;
  faceDown?: boolean;
  small?: boolean;
}

export function CardView({ card, faceDown, small }: CardViewProps) {
  const size = small ? "card card--small" : "card";

  if (faceDown || !card) {
    return <div className={`${size} card--back`} />;
  }

  const rank = card[0] ?? "";
  const suit = card[1] ?? "";
  const symbol = SUIT_SYMBOLS[suit] ?? "?";
  const color = SUIT_COLORS[suit] ?? "#000";
  const display = RANK_DISPLAY[rank] ?? rank;

  return (
    <div className={size} style={{ color }}>
      <span className="card__rank">{display}</span>
      <span className="card__suit">{symbol}</span>
    </div>
  );
}
