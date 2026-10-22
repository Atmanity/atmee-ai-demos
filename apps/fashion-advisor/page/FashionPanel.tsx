// The fashion board, ported from the original panel (FashionPanel.tsx): the
// image stage ("Style target"), the analysis card (score ring, palette,
// "Wearing now", what works, the tip) and "Recommended pieces", with the
// resizable grid, the floating image on scroll and the drag. What changed is
// the data underneath: images are plain URLs from the app server (no chunked
// base64), the item matcher is the engine's, and the board gained what the
// original left to voice alone: a More ideas button, and an honest state for
// cards and try-ons when no image model is configured.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, UIEvent } from 'react';
import { inferItemBodyZone, itemsMatch } from '../engine/items.ts';
import type { Analysis, ShopLink, Suggestion, Zone } from '../engine/types.ts';
import { useRetryableImageSrc } from './useRetryableImageSrc.ts';

export interface FashionImage {
  status: 'loading' | 'result' | 'error';
  item: string;
  image_url?: string;
  shop_links?: ShopLink[];
  /** While loading, the image shown before, kept dimmed under the spinner. */
  previous_image_url?: string;
}

function styleScoreColor(score: number): string {
  if (score >= 8) return '#ec4899';
  if (score >= 6) return '#a855f7';
  if (score >= 4) return '#8b5cf6';
  if (score >= 2) return '#6366f1';
  return '#94a3b8';
}

/** Shown where a catalogue shot would be when there is none (no image model): the zone it goes on. */
const ZONE_GLYPH: Record<Zone, string> = { head: '🧢', neck: '🧣', upper_body: '🧥', lower_body: '👖', wrist: '⌚', feet: '👟' };

export function FashionPanel({
  analysis,
  analysisLoading,
  fashionImage,
  onTrySuggestion,
  onLoadMoreSuggestions,
  tryOnStatusText,
  tryOnBusy,
  tryOnActiveItem,
  tryOnAvailable,
  canLoadMore,
  loadingMore,
  onResetBaseImage,
  empty,
  waiting,
}: {
  analysis: Analysis | null;
  analysisLoading: boolean;
  fashionImage: FashionImage | null;
  onTrySuggestion: (item: string, text: string) => void;
  /** quiet: loaded by scrolling (the original's panel never narrated that), not asked for. */
  onLoadMoreSuggestions: (quiet: boolean) => void;
  tryOnStatusText: string;
  tryOnBusy: boolean;
  tryOnActiveItem: string;
  tryOnAvailable: boolean;
  canLoadMore: boolean;
  loadingMore: boolean;
  onResetBaseImage?: () => void;
  /** The board before there is anything on it (onboarding). */
  empty: ReactNode;
  /** Beside the photo while there is no read yet. */
  waiting: ReactNode;
}) {
  const hasContent = Boolean(fashionImage || analysis || analysisLoading);
  const [isImageFloating, setIsImageFloating] = useState(false);
  const [leftColumnWidth, setLeftColumnWidth] = useState<number | null>(null);
  const [topRowHeight, setTopRowHeight] = useState<number | null>(null);
  const columnResizeStartRef = useRef({ x: 0, width: 0, containerWidth: 0 });
  const rowResizeStartRef = useRef({ y: 0, height: 0, containerHeight: 0 });

  const canResizeColumns = Boolean(fashionImage && (analysis || analysisLoading));
  const canResizeRows = Boolean(analysis?.suggestions.length && (fashionImage || analysis || analysisLoading));

  const handleColumnResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const grid = event.currentTarget.parentElement as HTMLElement | null;
      const imagePane = grid?.querySelector<HTMLElement>('.fashion-image-view');
      const gridRect = grid?.getBoundingClientRect();
      columnResizeStartRef.current = {
        x: event.clientX,
        width: leftColumnWidth ?? imagePane?.getBoundingClientRect().width ?? 320,
        containerWidth: gridRect?.width ?? 720,
      };
    },
    [leftColumnWidth],
  );

  const handleColumnResizePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const { x, width, containerWidth } = columnResizeStartRef.current;
    const maxWidth = Math.max(260, containerWidth - 300);
    setLeftColumnWidth(Math.max(220, Math.min(maxWidth, width + event.clientX - x)));
  }, []);

  const handleResizePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const handleRowResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const grid = event.currentTarget.parentElement as HTMLElement | null;
      const imagePane = grid?.querySelector<HTMLElement>('.fashion-image-view');
      const analysisPane = grid?.querySelector<HTMLElement>('.fashion-analysis-card, .fashion-analysis-loading, .fashion-analysis-waiting');
      const currentHeight = topRowHeight ?? Math.max(imagePane?.getBoundingClientRect().height ?? 0, analysisPane?.getBoundingClientRect().height ?? 0, 260);
      rowResizeStartRef.current = { y: event.clientY, height: currentHeight, containerHeight: grid?.parentElement?.getBoundingClientRect().height ?? 720 };
    },
    [topRowHeight],
  );

  const handleRowResizePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const { y, height, containerHeight } = rowResizeStartRef.current;
    const maxHeight = Math.min(900, Math.max(260, containerHeight - 180));
    setTopRowHeight(Math.max(220, Math.min(maxHeight, height + event.clientY - y)));
  }, []);

  const gridStyle = {
    ...(leftColumnWidth ? { '--fashion-left-column-width': `${leftColumnWidth}px` } : {}),
    ...(topRowHeight ? { '--fashion-top-row-height': `${topRowHeight}px` } : {}),
  } as CSSProperties;

  // Scrolled down, the image floats (and can be dragged); near the bottom, more pieces load, as in the original.
  const handleFashionScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const shouldFloat = target.scrollTop > 80;
    setIsImageFloating((current) => (current === shouldFloat ? current : shouldFloat));
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceFromBottom < 180 && analysis?.suggestions.length && canLoadMore && !loadingMore) onLoadMoreSuggestions(true);
  };

  if (!hasContent) return <div className="fashion-empty">{empty}</div>;

  return (
    <div className={`fashion-combined-view${isImageFloating ? ' fashion-combined-view--scrolled' : ''}`} onScroll={handleFashionScroll}>
      <div
        className={`fashion-review-grid${canResizeColumns ? ' fashion-review-grid--resizable-columns' : ''}${canResizeRows ? ' fashion-review-grid--resizable-rows' : ''}`}
        style={gridStyle}
      >
        {fashionImage && (
          <FashionImageView
            fashionImage={fashionImage}
            styleTarget={analysis?.target_style || analysis?.style_summary || ''}
            compact={isImageFloating}
            onResetBaseImage={onResetBaseImage}
          />
        )}
        {canResizeColumns && (
          <div
            className="fashion-column-resize-handle"
            onPointerDown={handleColumnResizePointerDown}
            onPointerMove={handleColumnResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerUp}
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize image and analysis"
          />
        )}
        {analysis ? (
          <>
            <StyleAnalysisCard analysis={analysis} loading={analysisLoading} />
            {canResizeRows && (
              <div
                className="fashion-row-resize-handle"
                onPointerDown={handleRowResizePointerDown}
                onPointerMove={handleRowResizePointerMove}
                onPointerUp={handleResizePointerUp}
                onPointerCancel={handleResizePointerUp}
                role="separator"
                aria-orientation="horizontal"
                title="Drag to resize analysis and recommendations"
              />
            )}
            {analysis.suggestions.length > 0 && (
              <RecommendedPieces
                suggestions={analysis.suggestions}
                triedItems={analysis.tried_items ?? []}
                onTrySuggestion={onTrySuggestion}
                onLoadMore={() => onLoadMoreSuggestions(false)}
                tryOnStatusText={tryOnStatusText}
                tryOnBusy={tryOnBusy}
                tryOnActiveItem={tryOnActiveItem}
                tryOnAvailable={tryOnAvailable}
                canLoadMore={canLoadMore}
                loadingMore={loadingMore}
              />
            )}
          </>
        ) : analysisLoading ? (
          <div className="fashion-analysis-loading">
            <div className="spinner spinner--fashion" />
            <p>Analysing your current look...</p>
          </div>
        ) : (
          <div className="fashion-analysis-waiting">{waiting}</div>
        )}
      </div>
    </div>
  );
}

function StyleAnalysisCard({ analysis, loading }: { analysis: Analysis; loading: boolean }) {
  return (
    <div className={`fashion-card fashion-analysis-card${loading ? ' fashion-analysis-card--stale' : ''}`}>
      <div className="fashion-card-top">
        <div className="fashion-header">
          <span className="fashion-image-kicker">{loading ? 'Re-reading your look…' : 'Current style analysis'}</span>
          <h2 className="fashion-summary">{analysis.style_summary}</h2>
          {analysis.occasion && <span className="fashion-occasion">{analysis.occasion}</span>}
        </div>
        <div className="fashion-score-ring" style={{ borderColor: styleScoreColor(analysis.style_score) }}>
          <span className="fashion-score-number">{analysis.style_score}</span>
          <span className="fashion-score-of">/10</span>
        </div>
      </div>

      <div className="fashion-score-row">
        <div className="fashion-palette">
          {analysis.color_palette.map((colour, i) => <span key={i} className="palette-chip">{colour}</span>)}
        </div>
      </div>

      {analysis.tried_items?.length ? (
        <section className="fashion-worn-items fashion-worn-items--analysis">
          <div className="fashion-worn-header">
            <span className="fashion-image-kicker">Already on this look</span>
            <h3 className="fashion-worn-title">Wearing now</h3>
          </div>
          <div className="fashion-worn-list">
            {analysis.tried_items.map((item) => <span key={item} className="fashion-worn-chip">{item}</span>)}
          </div>
        </section>
      ) : null}

      <div className="fashion-feedback">
        <div className="feedback-block feedback-block--positive">
          <span className="feedback-label">What's working</span>
          <p>{analysis.what_works}</p>
        </div>
        <div className="feedback-block feedback-block--tip">
          <span className="feedback-label">Style tip</span>
          <p>{analysis.style_tip}</p>
        </div>
      </div>
    </div>
  );
}

function RecommendedPieces({
  suggestions, triedItems, onTrySuggestion, onLoadMore, tryOnStatusText, tryOnBusy, tryOnActiveItem, tryOnAvailable, canLoadMore, loadingMore,
}: {
  suggestions: Suggestion[];
  triedItems: string[];
  onTrySuggestion: (item: string, text: string) => void;
  onLoadMore: () => void;
  tryOnStatusText: string;
  tryOnBusy: boolean;
  tryOnActiveItem: string;
  tryOnAvailable: boolean;
  canLoadMore: boolean;
  loadingMore: boolean;
}) {
  const triedItemNames = useMemo(() => triedItems.map((item) => item.trim()).filter(Boolean), [triedItems]);
  const activeTryOnItem = tryOnActiveItem.trim();

  return (
    <section className="fashion-recommendations">
      <div className="fashion-recommendations-header">
        <span className="fashion-image-kicker">Next upgrades</span>
        <h3 className="suggestions-heading">Recommended pieces</h3>
        {!tryOnAvailable && <p className="fashion-capture-hint">Try-ons are off in this demo (no image model is configured), so pieces can be shopped and talked through, not put on.</p>}
      </div>
      <div className="fashion-suggestions">
        {suggestions.map((s, i) => {
          const alreadyTried = triedItemNames.some((item) => itemsMatch(item, s.item));
          const isActiveTryOn = Boolean(activeTryOnItem) && itemsMatch(activeTryOnItem, s.item);
          return (
            <SuggestionCard
              key={`${s.item}-${i}`}
              suggestion={s}
              isSelected={alreadyTried || isActiveTryOn}
              isApplying={tryOnBusy && isActiveTryOn}
              tryOnBusy={tryOnBusy}
              tryOnAvailable={tryOnAvailable}
              animationDelayMs={Math.min(i * 70, 240)}
              onTry={() => onTrySuggestion(s.item, s.text)}
            />
          );
        })}
      </div>
      {loadingMore ? (
        <div className="fashion-more-suggestions-loading" aria-label="Loading more suggestions">
          <div className="spinner spinner--fashion suggestion-thumb-spinner" />
        </div>
      ) : canLoadMore ? (
        <div className="fashion-more-row">
          <button type="button" className="fashion-upload" onClick={onLoadMore}>More ideas</button>
        </div>
      ) : null}
      {tryOnStatusText && <p className="fashion-job-status" role="status">{tryOnStatusText}</p>}
    </section>
  );
}

function SuggestionCard({ suggestion, isSelected, isApplying, tryOnBusy, tryOnAvailable, animationDelayMs, onTry }: {
  suggestion: Suggestion;
  isSelected: boolean;
  isApplying: boolean;
  tryOnBusy: boolean;
  tryOnAvailable: boolean;
  animationDelayMs: number;
  onTry: () => void;
}) {
  const imageSrc = suggestion.image_url ?? '';
  return (
    <div
      className={`suggestion-card${isSelected ? ' suggestion-card--tried' : ''}${isApplying ? ' suggestion-card--applying' : ''}`}
      style={{ animationDelay: `${animationDelayMs}ms` } as CSSProperties}
    >
      {/* No spinner, as in the original: shots render in the background and
          land one at a time, so an empty slot means "not yet", not "broken".
          With no image model there will be none: a quiet zone mark instead. */}
      <div className={`suggestion-thumb${imageSrc || tryOnAvailable ? '' : ' suggestion-thumb--placeholder'}`} aria-hidden={!imageSrc}>
        {isSelected && <span className="suggestion-state-badge" aria-label="Tried on" />}
        {imageSrc ? <img src={imageSrc} alt={suggestion.item} loading="lazy" /> : !tryOnAvailable && <span className="suggestion-glyph">{ZONE_GLYPH[inferItemBodyZone(suggestion.item)]}</span>}
      </div>
      <div className="suggestion-body">
        <span className="suggestion-item">{suggestion.item}</span>
        <p className="suggestion-text">{suggestion.text}</p>
        <div className="suggestion-actions">
          <button
            className={`suggestion-action suggestion-action--try${isSelected ? ' suggestion-action--tried' : ''}${isApplying ? ' suggestion-action--applying' : ''}`}
            type="button"
            onClick={onTry}
            disabled={tryOnBusy || isSelected || !tryOnAvailable}
            title={tryOnAvailable ? undefined : 'Try-ons need an image model (XAI_API_KEY on the server)'}
          >
            {isApplying && <span className="suggestion-button-spinner spinner--fashion" aria-hidden="true" />}
            {isApplying ? 'Applying...' : isSelected ? 'Tried on' : 'Try on'}
          </button>
          <a
            className="suggestion-action suggestion-action--buy"
            href={suggestion.amazon_search_url || `https://amazon.com/s?k=${encodeURIComponent(suggestion.item)}`}
            target="_blank"
            rel="noreferrer"
          >
            Buy
          </a>
        </div>
      </div>
    </div>
  );
}

function FashionImageView({ fashionImage, styleTarget, compact, onResetBaseImage }: {
  fashionImage: FashionImage;
  styleTarget: string;
  compact: boolean;
  onResetBaseImage?: () => void;
}) {
  const isLoading = fashionImage.status === 'loading';
  const imageTitle = styleTarget.trim() || fashionImage.item;
  const loadingText = fashionImage.item.trim() ? `Adding ${fashionImage.item.trim()}...` : 'Adding your next piece...';
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  // Only reveal an image once it is fully downloaded and decoded, so it never paints in row by row.
  const [imgReady, setImgReady] = useState(false);
  // The cached-image race: the load can finish before React attaches onLoad.
  const handleImgRef = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth > 0) setImgReady(true);
  }, []);
  const dragStartRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    if (!compact) {
      setDragOffset({ x: 0, y: 0 });
      setIsDragging(false);
      dragStartRef.current = null;
    }
  }, [compact]);

  useEffect(() => { setImgReady(false); }, [fashionImage.image_url]);

  const { src: retryableImageSrc, onError: onRetryableImageError, retriesExhausted } = useRetryableImageSrc(fashionImage.image_url ?? '');

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!compact || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: dragOffset.x, originY: dragOffset.y };
    setIsDragging(true);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragStart = dragStartRef.current;
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    setDragOffset({ x: dragStart.originX + event.clientX - dragStart.startX, y: dragStart.originY + event.clientY - dragStart.startY });
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragStart = dragStartRef.current;
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragStartRef.current = null;
    setIsDragging(false);
  };

  const dragStyle = compact ? ({ '--fashion-image-drag-x': `${dragOffset.x}px`, '--fashion-image-drag-y': `${dragOffset.y}px` } as CSSProperties) : undefined;

  return (
    <div
      className={`fashion-image-view fashion-image-view--inline${compact ? ' fashion-image-view--compact' : ''}${isDragging ? ' fashion-image-view--dragging' : ''}`}
      style={dragStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="fashion-image-heading">
        <span className="fashion-image-kicker">{isLoading ? 'Generating style target' : 'Style target'}</span>
        <h3 className="fashion-image-title">{imageTitle}</h3>
      </div>

      {isLoading && (fashionImage.previous_image_url ? (
        <div className="fashion-image-result fashion-image-result--loading">
          <img src={fashionImage.previous_image_url} alt="Previous look" className="fashion-generated-img fashion-generated-img--dim" />
          <div className="fashion-image-loading-overlay">
            <div className="spinner spinner--fashion" />
            <p>{loadingText}</p>
          </div>
        </div>
      ) : (
        <div className="fashion-image-loading">
          <div className="spinner spinner--fashion" />
          <p>{loadingText}</p>
        </div>
      ))}

      {fashionImage.status === 'result' && fashionImage.image_url && (retriesExhausted ? (
        <div className="fashion-image-error"><p>This photo didn't render. Drop it in again, or try another.</p></div>
      ) : (
        <div className={`fashion-image-result${imgReady ? '' : ' fashion-image-result--loading'}`}>
          <img
            ref={handleImgRef}
            src={retryableImageSrc}
            alt={fashionImage.item === 'Current look' ? 'Your outfit' : `You wearing ${fashionImage.item}`}
            className={`fashion-generated-img${imgReady ? '' : ' fashion-generated-img--pending'}`}
            onLoad={() => setImgReady(true)}
            onError={onRetryableImageError}
          />
          {!imgReady && (
            <div className="fashion-image-loading-overlay">
              <div className="spinner spinner--fashion" />
            </div>
          )}
        </div>
      ))}

      {fashionImage.status === 'error' && (
        <div className="fashion-image-error"><p>Couldn't generate this look. Try again.</p></div>
      )}

      {fashionImage.status === 'result' && fashionImage.shop_links?.length ? (
        <div className="fashion-shop-links">
          {fashionImage.shop_links.map((link) => (
            <a key={link.kind} className="suggestion-action suggestion-action--buy" href={link.url} target="_blank" rel="noreferrer">{link.label}</a>
          ))}
        </div>
      ) : null}

      {/* Back to the user's own photo, every try-on off. */}
      {fashionImage.status === 'result' && fashionImage.item !== 'Current look' && onResetBaseImage && (
        <button type="button" className="fashion-reset-btn" onClick={onResetBaseImage}>Back to my own photo</button>
      )}
    </div>
  );
}
