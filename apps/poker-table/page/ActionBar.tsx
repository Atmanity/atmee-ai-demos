// Fold / Check / Call / Bet-Raise with a slider and presets: the original
// panel's ActionBar. One addition: `raiseAllowed` comes from the table's own
// `valid_actions`, so facing an all-in the bar no longer offers a raise the
// table would refuse.
import { useEffect, useState } from "react";

interface ActionBarProps {
  canCheck: boolean;
  callAmount: number;
  minBet: number;
  maxBet: number;
  minRaise: number;
  stack: number;
  raiseAllowed?: boolean;
  onFold: () => void;
  onCheck: () => void;
  onCall: () => void;
  onBet: (amount: number) => void;
  onRaise: (amount: number) => void;
  disabled?: boolean;
}

export function ActionBar({
  canCheck,
  callAmount,
  minBet,
  maxBet,
  minRaise,
  stack,
  raiseAllowed = true,
  onFold,
  onCheck,
  onCall,
  onBet,
  onRaise,
  disabled,
}: ActionBarProps) {
  const [betAmount, setBetAmount] = useState(minRaise || minBet);
  const hasBetToCall = callAmount > 0;
  const canRaise = minRaise > 0 && stack > callAmount;
  const showBetSlider = raiseAllowed && (!hasBetToCall ? minBet > 0 : canRaise);
  // `minRaise` is the table's own `min_raise_to`, and it is the floor whether
  // or not anything is owed: in the big blind after a limp nothing is to call,
  // yet the smallest legal bet is still a raise TO twice the blind. Taking the
  // floor from the big-blind constant offered "Bet 20" there, and the table
  // refused the button it had just enabled.
  const sliderMin = minRaise > 0 ? minRaise : minBet;
  const sliderMax = maxBet;
  const clampToBounds = (amount: number) =>
    Math.min(sliderMax, Math.max(sliderMin, amount));
  const safeBetAmount = clampToBounds(betAmount);

  useEffect(() => {
    if (!showBetSlider) return;
    const next = clampToBounds(betAmount);
    if (next !== betAmount) {
      setBetAmount(next);
    }
  }, [betAmount, showBetSlider, sliderMin, sliderMax]);

  return (
    <div className="action-bar">
      <div className="action-buttons">
        <button
          className="action-btn action-btn--fold"
          onClick={onFold}
          disabled={disabled}
        >
          Fold
        </button>

        {canCheck ? (
          <button
            className="action-btn action-btn--check"
            onClick={onCheck}
            disabled={disabled}
          >
            Check
          </button>
        ) : (
          <button
            className="action-btn action-btn--call"
            onClick={onCall}
            disabled={disabled}
          >
            Call {callAmount}
          </button>
        )}

        {showBetSlider && (
          <button
            className="action-btn action-btn--raise"
            onClick={() =>
              hasBetToCall ? onRaise(safeBetAmount) : onBet(safeBetAmount)
            }
            disabled={disabled}
          >
            {hasBetToCall ? "Raise" : "Bet"} {safeBetAmount}
          </button>
        )}
      </div>

      {showBetSlider && sliderMax > sliderMin && (
        <div className="bet-slider">
          <input
            type="range"
            aria-label="Bet size"
            min={sliderMin}
            max={sliderMax}
            step={Math.max(1, Math.floor((sliderMax - sliderMin) / 20))}
            value={safeBetAmount}
            onChange={(e) => setBetAmount(Number(e.target.value))}
            disabled={disabled}
          />
          <div className="bet-presets">
            <button onClick={() => setBetAmount(sliderMin)} disabled={disabled}>
              Min
            </button>
            <button
              onClick={() =>
                setBetAmount(clampToBounds(Math.floor(sliderMax / 3)))
              }
              disabled={disabled}
            >
              1/3
            </button>
            <button
              onClick={() =>
                setBetAmount(clampToBounds(Math.floor(sliderMax / 2)))
              }
              disabled={disabled}
            >
              1/2
            </button>
            <button onClick={() => setBetAmount(sliderMax)} disabled={disabled}>
              All-in
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
