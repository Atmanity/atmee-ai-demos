// Hanshi's desk: the character menu, the lesson (the practice sheet with the
// stroke being asked for, the sheet's verdict and the actions), and the
// finished character. Everything here is drawn from the server's snapshot and
// the page's own marks: there is no character data in the page, so nothing
// here can show a stroke before it is earned.
import { firstTries, travelSentences } from '../engine/director.ts';
import { VERDICT_LABEL, type CatalogEntry, type Command, type Snapshot, type Verdict } from '../engine/types.ts';
import type { GridPoint } from './ink.ts';
import { markKey, markLabel, type Marks } from './marks.ts';
import { StrokeCanvas } from './StrokeCanvas.tsx';

export const HOST = 'Ren';

const strokes = (n: number) => `${n} stroke${n === 1 ? '' : 's'}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What a card on the menu is called: "Tree", "The letter A". */
export const titleOf = (entry: { meaning: string }) => capital(entry.meaning);

const isLatin = (glyph: string) => /^[A-Za-z]$/.test(glyph);

/** A character named in a sentence: "十 ten", "the letter A". */
function nameOf(entry: { glyph: string; meaning: string }) {
  return isLatin(entry.glyph) ? <>{entry.meaning}</> : <><span lang="ja">{entry.glyph}</span> {entry.meaning}</>;
}

/** The verdict's tag. A stroke shown after two misses says so, rather than "Shown to you" as if they had asked. */
export function verdictLabel(verdict: Verdict, attempts: number): string {
  if (verdict.kind === 'reveal' && attempts >= 2) return 'Missed twice, shown';
  return VERDICT_LABEL[verdict.kind];
}

const TAGS: Record<string, string> = { ichi: 'Start here', latin_a: 'Start here', ei: 'The classic' };

/** The character after this one on the menu, as "next character" picks it. */
export function nextOnMenu(view: Snapshot): CatalogEntry | null {
  const { catalog, character } = view;
  if (!catalog.length) return null;
  const i = catalog.findIndex((e) => e.id === character?.id);
  return catalog[(i + 1) % catalog.length];
}

/** Which stroke is where, for a screen reader: "Practice sheet for 木, tree. Stroke 2 of 4 to write; 1 on the sheet." */
function sheetLabel(view: Snapshot): string {
  const c = view.character;
  if (!c) return 'Practice sheet';
  const done = view.strokes.filter((s) => s.status === 'done').length;
  const what = view.phase === 'writing' ? `Stroke ${view.stroke_index + 1} of ${c.strokes_total} to write` : view.phase === 'debrief' ? 'Finished' : `Stroke ${view.stroke_index + 1} of ${c.strokes_total} done`;
  return `Practice sheet for ${c.glyph}, ${c.meaning}. ${what}; ${done} on the sheet.`;
}

export function StrokeDots({ view, marks }: { view: Snapshot; marks: Marks }) {
  const c = view.character;
  if (!c) return null;
  return (
    <ol className="hs-dots" aria-label={view.phase === 'debrief' ? `All ${strokes(c.strokes_total)} written` : `Stroke ${Math.min(view.stroke_index + 1, c.strokes_total)} of ${c.strokes_total}`}>
      {view.strokes.map((s) => {
        const how = view.results.find((r) => r.index === s.index)?.how ?? marks[markKey(c.id, s.index)]?.how;
        const state = s.status === 'done' ? (how === 'shown' ? 'is-shown' : 'is-drawn') : s.status === 'current' ? 'is-now' : '';
        return <li key={s.index} className={state}><span>{s.index + 1}</span></li>;
      })}
    </ol>
  );
}

function Head({ view, marks, eyebrow, title }: { view: Snapshot; marks: Marks; eyebrow?: string; title?: string }) {
  const c = view.character!;
  return (
    <header className="hs-head">
      <span className="hs-glyph" lang={c.script === 'kanji' ? 'ja' : undefined} aria-hidden="true">{c.glyph}</span>
      <div className="hs-head-text">
        <p className="hs-eyebrow">{eyebrow ?? (c.script === 'kanji' ? `Kanji · read ${c.reading} · ${strokes(c.strokes_total)}` : `Capital letter · ${strokes(c.strokes_total)}`)}</p>
        <h1>{title ?? titleOf(c)}</h1>
      </div>
      <StrokeDots view={view} marks={marks} />
    </header>
  );
}

// ------------------------------------------------------------------ menu

export function Picker({ view, busy, notice = '', onPick, onClose }: {
  view: Snapshot | null;
  busy: boolean;
  /** Why the learner is back at the menu, when it was not their choice. */
  notice?: string;
  onPick: (id: string) => void;
  /** Mid-lesson, the way back to the character on the sheet. */
  onClose?: () => void;
}) {
  if (!view) {
    return (
      <section className="hs-picker is-loading" aria-busy="true">
        <p className="hs-eyebrow">One moment</p>
        <h1>{HOST} is laying out your sheet…</h1>
        <ul className="hs-cards" aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <li key={i}><span className="hs-card is-ghost" /></li>)}</ul>
      </section>
    );
  }
  const current = view.phase === 'debrief' ? null : view.character?.id ?? null;
  return (
    <section className="hs-picker" aria-labelledby="hs-picker-title">
      <p className="hs-eyebrow">{onClose ? 'Change character' : 'Choose a character'}</p>
      <h1 id="hs-picker-title">What would you like to write?</h1>
      <p className="hs-lede">New to this? Start with 一 or A. You can also just tell {HOST} which one.</p>
      {notice && <p className="hs-notice" role="alert">{notice}</p>}
      <ul className="hs-cards">
        {view.catalog.map((entry) => (
          <li key={entry.id}>
            <button
              type="button" className={`hs-card${entry.id === current ? ' is-current' : ''}`} disabled={busy || entry.id === current}
              onClick={() => onPick(entry.id)} aria-label={`${titleOf(entry)}, ${strokes(entry.strokes_total)}${entry.id === current ? ', on your sheet now' : ''}`}
            >
              <span className="hs-card-glyph" lang={isLatin(entry.glyph) ? undefined : 'ja'} aria-hidden="true">{entry.glyph}</span>
              <span className="hs-card-name">{titleOf(entry)}</span>
              <span className="hs-card-count">{strokes(entry.strokes_total)}</span>
              {entry.id === current ? <span className="hs-card-tag">On your sheet</span> : TAGS[entry.id] ? <span className="hs-card-tag">{TAGS[entry.id]}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {onClose && view.character && (
        <button type="button" className="hs-quiet" onClick={onClose}>Back to {view.character.glyph}</button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- lesson

export function Lesson({ view, marks, busy, pending, miss, notice, onStroke, onCommand, onPick }: {
  view: Snapshot;
  marks: Marks;
  busy: boolean;
  pending: GridPoint[] | null;
  miss: GridPoint[] | null;
  /** The sheet's last refusal, shown until the next action. */
  notice: string;
  onStroke: (points: GridPoint[]) => void;
  onCommand: (command: Command) => void;
  onPick: () => void;
}) {
  const c = view.character!;
  const writing = view.phase === 'writing';
  const n = view.stroke_index + 1;
  const last = n >= c.strokes_total;
  const verdict = view.last_verdict;
  // A stroke being graded locks the sheet's buttons too: a reset racing it would have it graded against the fresh sheet.
  const locked = busy || pending !== null;
  return (
    <section className="hs-desk" aria-label="Your practice sheet">
      <Head view={view} marks={marks} />
      <div className="hs-paper">
        <div className="hs-sheet">
          <div className="hs-sheet-grid">
            <StrokeCanvas
              strokes={view.strokes} character={c.id} marks={marks} grid={view.grid}
              disabled={!writing || busy || pending !== null} onStroke={onStroke}
              pending={pending} miss={writing ? miss : null} label={sheetLabel(view)} resetKey={`${c.id}-${view.stroke_index}`}
            />
          </div>
        </div>
      </div>
      <div className="hs-side">
        <p className="hs-ask" role="status">
          {writing
            ? <>Write stroke <b>{n}</b> <span>of {c.strokes_total}</span></>
            : <>Stroke <b>{n}</b> <span>of {c.strokes_total}</span> is on your sheet</>}
        </p>
        {verdict ? (
          <div className={`hs-verdict is-${verdict.kind}`} role="status">
            <span className="hs-verdict-tag">{verdictLabel(verdict, view.attempts)}</span>
            <p>{verdict.travel ? travelSentences(verdict.travel) : verdict.note}</p>
          </div>
        ) : (
          <p className="hs-tip">Draw it in one movement, with your finger or mouse. Not sure how it goes? Ask {HOST}, or press Show me.</p>
        )}
        {notice && <p className="hs-notice" role="alert">{notice}</p>}
        <div className="hs-actions">
          {writing
            ? <button type="button" className="hs-secondary" disabled={locked} onClick={() => onCommand('show')}>Show me</button>
            : <button type="button" className="hs-primary" disabled={locked} onClick={() => onCommand('next')}>{last ? `Finish ${c.glyph}` : 'Next stroke'} <span aria-hidden="true">→</span></button>}
        </div>
        <div className="hs-more">
          <button type="button" className="hs-quiet" disabled={locked} onClick={() => onCommand('over')}>Start over</button>
          <button type="button" className="hs-quiet" disabled={locked} onClick={onPick}>Change character</button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------- the done moment

export function Finished({ view, marks, busy, notice = '', onCommand, onPick, onSave }: {
  view: Snapshot;
  marks: Marks;
  busy: boolean;
  notice?: string;
  onCommand: (command: Command) => void;
  onPick: () => void;
  onSave: () => void;
}) {
  const c = view.character!;
  const next = nextOnMenu(view);
  // The first-try record from the sheet, not the score: a stroke right on its second try is not a first try.
  const correct = firstTries(view);
  const total = view.results.length || c.strokes_total;
  return (
    <section className="hs-desk is-done" aria-label={`${titleOf(c)}, finished`}>
      <Head view={view} marks={marks} eyebrow="Character complete" title={`${titleOf(c)}, written`} />
      <div className="hs-paper">
        <div className="hs-sheet">
          <div className="hs-sheet-grid">
            <StrokeCanvas strokes={view.strokes} character={c.id} marks={marks} grid={view.grid} label={sheetLabel(view)} />
          </div>
          <div className={`hs-seal${correct === total ? ' is-clean' : ''}`} aria-hidden="true"><b>{correct}/{total}</b><span>first try</span></div>
        </div>
      </div>
      <div className="hs-side">
        <p className="hs-total"><b>{correct}</b> of {strokes(total)} right first try</p>
        <ol className="hs-summary">
          {view.strokes.map((s) => {
            const mark = view.results.find((r) => r.index === s.index) ?? marks[markKey(c.id, s.index)];
            return (
              <li key={s.index} className={mark?.how === 'shown' ? 'is-shown' : 'is-drawn'}>
                <span className="hs-summary-n">{s.index + 1}</span>
                <span className="hs-summary-name">{s.name ? capital(s.name.replace(/^the /, '')) : `Stroke ${s.index + 1}`}</span>
                <span className="hs-summary-how">{markLabel(mark)}</span>
              </li>
            );
          })}
        </ol>
        {notice && <p className="hs-notice" role="alert">{notice}</p>}
        <div className="hs-actions">
          {next && next.id !== c.id && (
            <button type="button" className="hs-primary" disabled={busy} onClick={() => onCommand('another')}>
              Next: {nameOf(next)} <span aria-hidden="true">→</span>
            </button>
          )}
          <button type="button" className="hs-secondary" disabled={busy} onClick={() => onCommand('over')}>Write {c.glyph} again</button>
        </div>
        <div className="hs-more">
          <button type="button" className="hs-quiet" disabled={busy} onClick={onPick}>Choose another</button>
          <button type="button" className="hs-quiet" onClick={onSave}>Save your sheet</button>
        </div>
      </div>
    </section>
  );
}
