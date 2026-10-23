// The fitting room: the mirror (the outfit photo, or a try-on of it), the
// verdict (the score on a tape measure, what works, the one fix), the
// occasion picker, and the rail of pieces. Each shows only what the view
// holds; every control is a button press the page passes to the server.
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { HOST } from '../engine/director.ts';
import { inferItemBodyZone, itemsMatch } from '../engine/items.ts';
import type { Analysis, Suggestion, View, Zone } from '../engine/types.ts';
import { useRetryableImageSrc } from './useRetryableImageSrc.ts';

export const OCCASIONS = ['Work day', 'Job interview', 'First date', 'Wedding guest', 'Dinner out', 'Night out', 'Weekend plans', 'Big presentation'];

const Spinner = () => <span className="nt-spinner" aria-hidden="true" />;
export const ArrowIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>;

function HangerIcon() {
  return (
    <svg className="nt-hanger" viewBox="0 0 64 40" width="72" height="45" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M28 9a4 4 0 1 1 6 3.5c-1.4.8-2 1.8-2 3.2V18" />
      <path d="M32 18 5 33a2.5 2.5 0 0 0 1.2 4.7h51.6A2.5 2.5 0 0 0 59 33z" />
    </svg>
  );
}

/** A line drawing of where a piece goes, for a piece with no catalogue shot. */
export function ZoneGlyph({ zone }: { zone: Zone }) {
  const paths: Record<Zone, ReactNode> = {
    head: <><path d="M8 30h32" /><path d="M13 30c0-9 4.5-15 11-15s11 6 11 15" /><path d="M17 24h14" /></>,
    neck: <><path d="M20 8h8l-2 5 4 20-6 7-6-7 4-20z" /></>,
    upper_body: <><path d="M17 8l7 6 7-6 9 6-4 10h-4v18H16V24h-4L8 14z" /><path d="M24 14v28" /></>,
    lower_body: <><path d="M14 7h20l2 35h-8l-4-22-4 22h-8z" /><path d="M14 12h20" /></>,
    wrist: <><circle cx="24" cy="24" r="8" /><path d="M24 20v4l3 2M19 10h10l1 6M19 38h10l1-6M19 10l-1 6M19 38l-1-6" /></>,
    feet: <><path d="M6 34v-9l10 2 7 5h12a6 6 0 0 1 6 6v1H6z" /><path d="M6 38h35" /></>,
  };
  return <svg className="nt-glyph" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[zone]}</svg>;
}

// -- the mirror ----------------------------------------------------------------------

function Veil({ children, spin = true }: { children: ReactNode; spin?: boolean }) {
  return <div className="nt-veil" role="status">{spin && <Spinner />}<p>{children}</p></div>;
}

/** Keyed by its URL, so a new picture starts unloaded. */
function MirrorImage({ url, alt, dim }: { url: string; alt: string; dim: boolean }) {
  const { src, onError, retriesExhausted } = useRetryableImageSrc(url);
  const [loaded, setLoaded] = useState(false);
  if (retriesExhausted) return <div className="nt-mirror-empty"><p className="nt-mirror-ask">This photo didn’t load</p><p className="nt-mirror-hint">Add it again with Change photo.</p></div>;
  return (
    <>
      <img src={src} alt={alt} className={`${dim ? 'is-dim' : ''} ${loaded ? '' : 'is-loading'}`} onLoad={() => setLoaded(true)} onError={onError}
        ref={(node) => { if (node?.complete && node.naturalWidth > 0) setLoaded(true); }} />
      {!loaded && <Veil>Hanging it up…</Veil>}
    </>
  );
}

export function Mirror({ view, preview, ready, notice, onFile, onExample, onRestore }: {
  view: View | null;
  /** The photo being uploaded, shown at once. */
  preview: string | null;
  /** The fitting room is open: its controls work. */
  ready: boolean;
  notice: string;
  onFile: (file: File) => void;
  onExample: () => void;
  onRestore: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = () => input.current?.click();
  const img = view?.image ?? null;
  const jobs = view?.jobs;

  let body: ReactNode;
  if (preview) {
    body = <><img src={preview} alt="Your outfit" /><Veil>Hanging it up…</Veil></>;
  } else if (!view) {
    body = <div className="nt-mirror-empty"><Spinner /><p className="nt-mirror-hint">Setting up your fitting room…</p></div>;
  } else if (!img) {
    body = (
      <div className="nt-mirror-empty">
        <HangerIcon />
        <p className="nt-mirror-ask">Add a photo of your outfit</p>
        <p className="nt-mirror-hint">Head to toe works best. Drag it onto the mirror, or</p>
        <button type="button" className="nt-primary" onClick={pick} disabled={!ready}>Upload a photo</button>
        <button type="button" className="nt-link" onClick={onExample} disabled={!ready}>Use an example outfit</button>
      </div>
    );
  } else {
    body = (
      <>
        <MirrorImage key={img.url} url={img.url} alt={img.kind === 'tryon' ? `Your outfit with the ${img.item}` : 'Your outfit'} dim={Boolean(jobs?.tryOn)} />
        {jobs?.tryOn ? (
          <Veil>Putting on the {jobs.tryOn}…<small>About 20 seconds{jobs.queued.length ? `, then the ${jobs.queued.join(' and the ')}` : ''}</small></Veil>
        ) : jobs?.photo ? <Veil>Checking the photo…</Veil> : null}
        <span className="nt-mirror-tag">{img.kind === 'tryon' ? `With the ${img.item}` : 'Your photo'}</span>
      </>
    );
  }

  return (
    <div className="nt-mirror">
      <div
        className={`nt-mirror-frame${over ? ' is-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (ready) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const file = e.dataTransfer.files?.[0]; if (file && ready) onFile(file); }}
      >
        {body}
        {over && <div className="nt-veil is-drop"><p>Drop it on the mirror</p></div>}
      </div>
      {img && !preview && (
        <div className="nt-mirror-foot">
          <button type="button" className="nt-quiet" onClick={pick} disabled={!ready}>Change photo</button>
          {img.kind === 'tryon' && <button type="button" className="nt-quiet" onClick={onRestore} disabled={!ready || Boolean(jobs?.analysing)}>Back to my photo</button>}
          {img.kind === 'tryon' && img.shop_links?.map((link) => (
            <a key={link.kind} className="nt-shop" href={link.url} target="_blank" rel="noreferrer" title={link.label}>
              {link.kind === 'exact' ? 'Shop this piece' : 'Shop similar'} <ArrowIcon />
            </a>
          ))}
        </div>
      )}
      {notice && <p className="nt-notice" role="status">{notice}</p>}
      <input
        ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label="Choose a photo of your outfit"
        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onFile(file); }}
      />
    </div>
  );
}

// -- the verdict -----------------------------------------------------------------------

/** The score as a tape measure: ten marks, filled to the score, with a pin at it. */
export function Tape({ score }: { score: number | null }) {
  return (
    <div className={`nt-tape${score === null ? ' is-empty' : ''}`} {...(score === null ? {} : { role: 'img', 'aria-label': `${score} out of 10` })}>
      <ol aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => <li key={i} className={score !== null && i < score ? 'is-in' : ''}><span>{i + 1}</span></li>)}
      </ol>
      {score !== null && <span className="nt-tape-pin" style={{ '--at': score * 10 } as CSSProperties} />}
    </div>
  );
}

/** A colour name as a CSS colour when the browser knows it ("navy blue" falls back to "blue"). */
function swatch(name: string): string | undefined {
  const supports = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' ? CSS.supports.bind(CSS) : null;
  if (!supports) return undefined;
  const words = name.toLowerCase().match(/[a-z]+/g) ?? [];
  return [words.join(''), words[words.length - 1]].find((c) => c && supports('color', c));
}

export function OccasionPicker({ current, onPick, onClose, autoFocus = false }: {
  current?: string;
  onPick: (occasion: string) => void;
  onClose?: () => void;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState('');
  return (
    <div className="nt-occasions">
      <div className="nt-chips" role="group" aria-label="Occasions">
        {OCCASIONS.filter((o) => o.toLowerCase() !== current?.toLowerCase()).map((o) => (
          <button key={o} type="button" className="nt-chip" onClick={() => onPick(o)}>{o}</button>
        ))}
      </div>
      <form className="nt-occasion-own" onSubmit={(e) => { e.preventDefault(); if (value.trim()) onPick(value.trim()); }}>
        <input
          className="nt-input" value={value} maxLength={80} autoFocus={autoFocus} aria-label="What are you dressing for?"
          placeholder="Or in your words: a rooftop birthday in July" onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose?.(); }}
        />
        <button type="submit" className="nt-primary" disabled={!value.trim()}>Set</button>
      </form>
    </div>
  );
}

export function Verdict({ view, failed, delta, ready, onRerate, onOccasion, onChangeOccasion }: {
  view: View | null;
  /** The last read did not come through. */
  failed: boolean;
  /** How the latest try-on moved the score, for this occasion. */
  delta: { by: number; item: string } | null;
  ready: boolean;
  onRerate: () => void;
  onOccasion: (occasion: string) => void;
  onChangeOccasion: () => void;
}) {
  const a: Analysis | null = view?.analysis ?? null;
  if (!view?.target) {
    return (
      <section className="nt-verdict is-ask" aria-label="What are you dressing for?">
        <p className="nt-eyebrow">{view?.image ? 'Got the photo' : 'Step one'}</p>
        <h2 className="nt-verdict-title">What are you dressing for?</h2>
        <p className="nt-verdict-lede">Pick one, type your own, or just tell {HOST}. The same outfit can be a 9 for brunch and a 4 for an interview.</p>
        {ready ? <OccasionPicker onPick={onOccasion} /> : <p className="nt-verdict-lede is-quiet">Opening your fitting room…</p>}
      </section>
    );
  }
  const head = (
    <p className="nt-eyebrow">
      The verdict <span aria-hidden="true">·</span> for <button type="button" className="nt-inline" onClick={onChangeOccasion} disabled={!ready} title="Change what you're dressing for">{view.target}</button>
    </p>
  );
  if (!view.image) {
    return (
      <section className="nt-verdict is-waiting" aria-label="Your verdict">
        {head}
        <h2 className="nt-verdict-title">Now, the outfit.</h2>
        <p className="nt-verdict-lede">Add a photo of what you’re wearing to the mirror and {HOST} scores it for {view.target.toLowerCase()}.</p>
        <Tape score={null} />
      </section>
    );
  }
  if (!a && failed) {
    return (
      <section className="nt-verdict is-waiting" aria-label="Your verdict">
        {head}
        <h2 className="nt-verdict-title">The verdict didn’t come through.</h2>
        <p className="nt-verdict-lede">It happens now and then. Ask again and it usually lands.</p>
        <div className="nt-verdict-actions"><button type="button" className="nt-primary" onClick={onRerate} disabled={!ready}>Rate it again</button></div>
      </section>
    );
  }
  if (!a) {
    return (
      <section className="nt-verdict is-reading" aria-label="Your verdict" aria-busy="true">
        {head}
        <h2 className="nt-verdict-title">{HOST} is reading your look…</h2>
        <p className="nt-verdict-lede">Fit, proportion, colour, and whether it says {view.target.toLowerCase()}.</p>
        <Tape score={null} />
      </section>
    );
  }
  const rereading = view.jobs.analysing;
  return (
    <section className={`nt-verdict${rereading ? ' is-stale' : ''}`} aria-label="Your verdict" aria-busy={rereading}>
      {head}
      <div className="nt-score" aria-live="polite">
        <b>{a.style_score}</b><span>/10</span>
        {delta && delta.by !== 0 && <em className={delta.by > 0 ? 'is-up' : 'is-down'}>{delta.by > 0 ? '+' : '−'}{Math.abs(delta.by)} with the {delta.item}</em>}
        {rereading && <em className="is-busy"><Spinner /> Re-reading</em>}
      </div>
      <Tape score={a.style_score} />
      <h2 className="nt-summary">{a.style_summary}</h2>
      {a.occasion && <p className="nt-reads">Reads as <b>{a.occasion}</b></p>}
      <div className="nt-tags">
        <article className="nt-hangtag is-works"><span className="nt-label">What works</span><p>{a.what_works}</p></article>
        <article className="nt-hangtag is-fix"><span className="nt-label">The one fix</span><p>{a.style_tip}</p></article>
      </div>
      <div className="nt-palette" aria-label="Colours in the outfit">
        {a.color_palette.map((c, i) => <span key={i} className="nt-swatch"><i style={swatch(c) ? { background: swatch(c) } : undefined} />{c}</span>)}
      </div>
      {a.tried_items.length > 0 && (
        <p className="nt-wearing"><span className="nt-label">Tried on</span> {a.tried_items.join(' · ')}</p>
      )}
      <div className="nt-verdict-actions">
        <button type="button" className="nt-secondary" onClick={onRerate} disabled={!ready || rereading}>Rate it again</button>
        <button type="button" className="nt-quiet" onClick={onChangeOccasion} disabled={!ready}>Rate it for something else</button>
      </div>
    </section>
  );
}

// -- the rail ------------------------------------------------------------------------

type PieceState = 'idle' | 'putting' | 'queued' | 'on' | 'tried';

const TRY_LABEL: Record<PieceState, string> = { idle: 'Try it on', putting: 'Putting it on…', queued: 'Up next', on: 'On you', tried: 'Tried' };

function pieceState(s: Suggestion, view: View): PieceState {
  const { jobs, analysis, image } = view;
  if (jobs.tryOn && itemsMatch(jobs.tryOn, s.item)) return 'putting';
  if (jobs.queued.some((q) => itemsMatch(q, s.item))) return 'queued';
  if (image?.kind === 'tryon' && itemsMatch(image.item, s.item)) return 'on';
  if (analysis?.tried_items.some((t) => itemsMatch(t, s.item))) return 'tried';
  return 'idle';
}

export function Rail({ view, ready, onTry, onMore }: {
  view: View | null;
  ready: boolean;
  onTry: (piece: string, why: string) => void;
  onMore: () => void;
}) {
  const a = view?.analysis;
  if (!view || !a) {
    return (
      <section className="nt-rail is-empty" aria-label="Pieces to add">
        <div className="nt-rail-head"><p className="nt-eyebrow">The rail</p><h2>Pieces to add</h2></div>
        <div className="nt-rod" aria-hidden="true" />
        <ul className="nt-rail-list" aria-hidden="true">{[0, 1, 2].map((i) => <li key={i} className="nt-piece is-ghost" />)}</ul>
        <p className="nt-rail-note">Pieces picked for your occasion hang here after the first verdict.</p>
      </section>
    );
  }
  const busy = Boolean(view.jobs.tryOn || view.jobs.queued.length);
  return (
    <section className="nt-rail" aria-label="Pieces to add">
      <div className="nt-rail-head">
        <p className="nt-eyebrow">The rail</p>
        <h2>Pieces for {view.target ? view.target.toLowerCase() : 'your look'}</h2>
        <span className="nt-rail-count">{a.suggestions.length} pieces</span>
      </div>
      <div className="nt-rod" aria-hidden="true" />
      <ul className="nt-rail-list">
        {a.suggestions.map((s, i) => {
          const state = pieceState(s, view);
          return (
            <li key={`${s.item}-${i}`} className={`nt-piece is-${state}`}>
              <span className="nt-piece-n">{String(i + 1).padStart(2, '0')}</span>
              <div className="nt-piece-shot">{s.image_url ? <img src={s.image_url} alt="" loading="lazy" /> : <ZoneGlyph zone={inferItemBodyZone(s.item)} />}</div>
              <h3>{s.item}</h3>
              <p>{s.text}</p>
              <div className="nt-piece-actions">
                {view.tryOnAvailable && (
                  <button type="button" className="nt-try" onClick={() => onTry(s.item, s.text)}
                    disabled={!ready || !view.image || state !== 'idle' || busy}
                    title={busy && state === 'idle' ? 'One piece at a time' : undefined}>
                    {state === 'putting' && <Spinner />}{TRY_LABEL[state]}
                  </button>
                )}
                {s.amazon_search_url && <a className="nt-shop" href={s.amazon_search_url} target="_blank" rel="noreferrer" aria-label={`Shop ${s.item}`}>Shop <ArrowIcon /></a>}
              </div>
            </li>
          );
        })}
        <li className="nt-piece is-more">
          {view.jobs.more ? (
            <div className="nt-more-wait" role="status"><Spinner /><p>{HOST} is pulling more pieces…</p></div>
          ) : view.canLoadMore ? (
            <button type="button" className="nt-more" onClick={onMore} disabled={!ready}><span aria-hidden="true">+</span>More pieces</button>
          ) : (
            <p className="nt-rail-note">The rail’s full. Try one of these first.</p>
          )}
        </li>
      </ul>
    </section>
  );
}
