import { useState } from 'react';

/**
 * Putting a stock on the board without saying a word (ported from the
 * original panel). It takes a ticker or a company name; the desk decides
 * which listing it is and refuses the rest with a sentence the board prints.
 * A short single word is taken as a ticker and sent in capitals.
 */
export function AddSymbol({ full, onAdd }: {
  /** The board is at its limit: adding is refused, so do not invite it. */
  full: boolean;
  onAdd: (symbol: string) => void;
}) {
  const [text, setText] = useState('');

  const submit = () => {
    const typed = text.trim();
    if (!typed) return;
    setText('');
    onAdd(/^\$?[a-z]{1,5}(?:[.-][a-z]{1,2})?$/i.test(typed) ? typed.toUpperCase() : typed);
  };

  return (
    <form className="oc-add" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <label className="oc-visually-hidden" htmlFor="oc-add-input">Ticker or company to add</label>
      <input
        id="oc-add-input"
        className="oc-add-input"
        value={text}
        disabled={full}
        maxLength={40}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={full ? 'Board full: drop one first' : 'Ticker or company'}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" className="oc-add-go" disabled={full || !text.trim()}>Add</button>
    </form>
  );
}
