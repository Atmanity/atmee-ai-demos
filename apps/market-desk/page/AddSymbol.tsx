import { useState } from 'react';

/**
 * Putting something on the board without saying a word (ported from the
 * original panel).
 *
 * A ticker box, and, while the board is empty, six one-tap starters, so the
 * first thing a newcomer sees is something they can press. Turning a company
 * NAME into a ticker is the judge's job (say it, or type it into the chat);
 * this box takes a ticker. There is no validation here beyond trimming: the
 * board decides what a ticker is and refuses the rest with a sentence the
 * panel already prints, and a second opinion here could disagree with it.
 */

/** Shown only on an empty board: a first move, not a recommendation list. */
export const STARTERS = ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'GOOGL'];

export function AddSymbol({ empty, full, busy, onAdd }: {
  /** Nothing on the board yet: show the starters. */
  empty: boolean;
  /** The board is at its limit: adding is refused, so do not invite it. */
  full: boolean;
  busy: boolean;
  onAdd: (symbol: string) => void;
}) {
  const [text, setText] = useState('');

  const submit = () => {
    const symbol = text.trim();
    if (!symbol) return;
    setText('');
    onAdd(symbol);
  };

  return (
    <section className="desk-add">
      <form className="desk-add__row" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <input
          className="desk-add__input"
          value={text}
          disabled={busy || full}
          maxLength={12}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Ticker — AAPL"
          aria-label="Ticker to add"
          onChange={(event) => setText(event.target.value.toUpperCase())}
        />
        <button type="submit" className="desk-add__go" disabled={busy || full || !text.trim()}>Add</button>
      </form>

      {full ? (
        <p className="desk-add__full">The board is full — drop one first.</p>
      ) : empty ? (
        <div className="desk-add__starters">
          {STARTERS.map((symbol) => (
            <button key={symbol} type="button" className="desk-add__starter" disabled={busy} onClick={() => onAdd(symbol)}>{symbol}</button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
