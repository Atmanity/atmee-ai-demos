// The scoresheet: every move so far, numbered the way a club sheet is, the
// opening once it has a name, and the game to take away as a PGN file.
import { useEffect, useRef } from 'react';
import type { ChessSnapshot } from '../engine/types.ts';
import { downloadPgn } from './pgn.ts';

export function Scoresheet({ state, host, className = '' }: { state: ChessSnapshot | null; host: string; className?: string }) {
  const list = useRef<HTMLOListElement>(null);
  const history = state?.history ?? [];
  useEffect(() => { list.current?.scrollTo?.({ top: list.current.scrollHeight }); }, [history.length]);
  const rows = Math.ceil(history.length / 2);
  const white = state?.user_color === 'black' ? host : 'You';
  const black = state?.user_color === 'black' ? 'You' : host;
  return (
    <section className={`kb-sheet ${className}`} aria-label="Scoresheet">
      <header className="kb-sheet-head">
        <h2>Scoresheet</h2>
        {state && history.length > 0 && (
          <button type="button" className="kb-link" onClick={() => downloadPgn(state, host)}>Download PGN</button>
        )}
      </header>
      <p className="kb-sheet-opening">{state?.opening ?? (history.length ? 'Opening not named yet' : 'A new game')}</p>
      <div className="kb-sheet-cols" aria-hidden="true"><span /><span>{white}</span><span>{black}</span></div>
      {rows === 0 ? (
        <p className="kb-sheet-empty">No moves yet. White starts.</p>
      ) : (
        <ol className="kb-sheet-moves" ref={list}>
          {Array.from({ length: rows }, (_, i) => {
            const w = history[i * 2];
            const b = history[i * 2 + 1];
            const lastIndex = history.length - 1;
            return (
              <li key={i}>
                <span className="kb-sheet-n">{i + 1}.</span>
                <span className={lastIndex === i * 2 ? 'is-last' : ''}>{w}</span>
                <span className={lastIndex === i * 2 + 1 ? 'is-last' : ''}>{b ?? ''}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
