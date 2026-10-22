interface ChipTier {
  value: number;
  className: string;
}

const TIERS: ChipTier[] = [
  { value: 1000, className: "chip chip--gold" },
  { value: 500, className: "chip chip--purple" },
  { value: 100, className: "chip chip--black" },
  { value: 25, className: "chip chip--green" },
  { value: 5, className: "chip chip--red" },
  { value: 1, className: "chip chip--white" },
];

const MAX_CHIPS_PER_STACK = 6;
const MAX_STACKS = 4;

function decompose(amount: number): { tier: ChipTier; count: number }[] {
  const stacks: { tier: ChipTier; count: number }[] = [];
  let remaining = Math.max(0, Math.floor(amount));
  for (const tier of TIERS) {
    if (remaining < tier.value) continue;
    const count = Math.floor(remaining / tier.value);
    remaining -= count * tier.value;
    stacks.push({ tier, count });
    if (stacks.length >= MAX_STACKS) break;
  }
  return stacks;
}

export interface ChipStackProps {
  amount: number;
  compact?: boolean;
  showLabel?: boolean;
}

export function ChipStack({
  amount,
  compact = false,
  showLabel = true,
}: ChipStackProps) {
  if (amount <= 0) return null;
  const stacks = decompose(amount);

  return (
    <div
      className={["chip-group", compact && "chip-group--compact"]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="chip-group__stacks">
        {stacks.map(({ tier, count }, si) => {
          const visible = Math.min(
            MAX_CHIPS_PER_STACK,
            Math.max(1, Math.ceil(Math.log2(count + 1))),
          );
          return (
            <div
              key={`${tier.value}-${si}`}
              className="chip-stack"
              title={`${count} × ${tier.value}`}
            >
              {Array.from({ length: visible }).map((_, i) => (
                <span
                  key={i}
                  className={tier.className}
                  style={{ bottom: `${i * (compact ? 9 : 11)}px`, zIndex: i }}
                />
              ))}
            </div>
          );
        })}
      </div>
      {showLabel && (
        <span className="chip-group__amount">${amount.toLocaleString()}</span>
      )}
    </div>
  );
}
