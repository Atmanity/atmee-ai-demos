// The nutrition board, ported from the mini-app panel's AppPanel: the empty
// state, the card, the comparison table, the kept recipes and the recipe view.
// What changed is where its data comes from: the panel no longer talks to an
// agent over a bridge; App.tsx owns the session and hands everything down, so
// this file only renders and reports what the user did.
import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { View } from '../engine/types.ts';
import { ComparisonShelf, KeptRecipes, SHELF_ANCHOR_ID } from './ComparisonShelf.tsx';
import { NutritionPanel } from './NutritionPanel.tsx';
import { RecipeDetail } from './RecipeDetail.tsx';
import type { Chosen, RecipeView } from './recipeView.ts';

/** Something the app is doing right now: looking a food up, reading a photo. */
export interface Work {
  id: number;
  label: string;
  /** The photo being read, if it is one. */
  preview?: string;
}

interface Props {
  view: View | null;
  /** The session is live: the controls work. */
  live: boolean;
  recipeView: RecipeView;
  /** A card for another food arrived while a recipe was open. Its name. */
  superseder: string | null;
  working: Work[];
  notice: string | null;
  onRecipe: (chosen: Chosen) => void;
  onOpenKept: (name: string) => void;
  onBack: () => void;
  onDismissBanner: () => void;
  onDismissNotice: () => void;
  onPhoto: (file: File) => void;
  onSample: () => void;
}

const sentence = (label: string) => `${label.charAt(0).toUpperCase()}${label.slice(1)}…`;

export function AppPanel(props: Props) {
  const { view, live, recipeView, superseder, working, notice } = props;
  const nutrition = view?.nutrition ?? null;
  const shelf = view?.shelf;
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const reading = working.some((w) => w.preview);

  const choose = useCallback(() => picker.current?.click(), []);
  const input = (
    <input
      ref={picker} type="file" accept="image/*" hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) props.onPhoto(file);
      }}
    />
  );

  // A photo dropped anywhere on the board is read like an uploaded one.
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const drop = {
    onDragOver: (e: DragEvent) => {
      if (!live || !hasFiles(e)) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      const file = Array.from(e.dataTransfer.files)[0];
      if (live && file) props.onPhoto(file);
    },
  };

  const showShelfLink = (shelf?.items.length ?? 0) >= 2;
  const scrollToShelf = useCallback(() => {
    // `behavior: 'smooth'` is set here, not in CSS, so the reduced-motion
    // media query cannot reach it: hence the check.
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(SHELF_ANCHOR_ID)?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  }, []);

  // What the app is doing, so the board answers every turn: a lookup in flight
  // is a visible state, never the previous food left standing as if nothing
  // had been heard.
  const status = working.length ? (
    <div className="panel-working" role="status" aria-live="polite">
      {working.find((w) => w.preview) && <img className="panel-working__photo" src={working.find((w) => w.preview)!.preview} alt="The photo being read" />}
      <span className="app-spinner app-spinner--small" />
      <span className="panel-working__text">{working.map((w) => sentence(w.label)).join(' ')}</span>
    </div>
  ) : null;

  // Everything that went wrong, wherever the user happens to be looking: a
  // failed upload once rendered only in the empty state, so it was invisible
  // the moment a card was up.
  const notices = notice ? (
    <div className="panel-notices" role="status" aria-live="polite">
      <p className="nutrition-upload__error">
        {notice}
        <button type="button" className="panel-notices__dismiss" aria-label="Dismiss" onClick={props.onDismissNotice}>×</button>
      </p>
    </div>
  ) : null;

  let body: ReactNode;
  if (recipeView.selected) {
    body = (
      <>
        {status}
        {notices}
        {superseder && (
          <div className="supersede-banner" role="status">
            <span className="supersede-banner__text">New card: {superseder}</span>
            <button type="button" className="supersede-banner__view" onClick={props.onBack}>View</button>
            <button type="button" className="supersede-banner__dismiss" aria-label="Dismiss" onClick={props.onDismissBanner}>×</button>
          </div>
        )}
        <RecipeDetail recipe={recipeView.selected} details={recipeView.details} loading={recipeView.loading} onBack={props.onBack} />
      </>
    );
  } else if (!nutrition) {
    body = (
      <div className="nutrition-empty">
        {status}
        {notices}
        <div className="nutrition-empty-icon" aria-hidden="true">🍎</div>
        <h1 className="nutrition-title">Nutrition</h1>
        {/* Spoken first: speaking is the fastest way in and the one that works
            with hands in the food. The camera-only wording sent people away. */}
        <p className="nutrition-empty-lead">Just ask — “what's in a banana?”</p>
        <p className="nutrition-empty-sub">
          {live
            ? 'Whatever you name appears here, with its serving size and what the numbers mean. Or drop a photo of a food or its label anywhere on this board.'
            : 'Start the session on the left, then name any food, or share a photo of one.'}
        </p>
        {input}
        {/* The other two doors, not the front one. */}
        <div className="nutrition-empty-actions">
          <button type="button" className="nutrition-upload" disabled={!live || reading} onClick={choose}>
            {reading ? 'Reading it…' : 'Upload a photo'}
          </button>
          {/* Nothing in the fridge, still curious: and the one door a test can open. */}
          <button type="button" className="nutrition-upload nutrition-upload--ghost" disabled={!live || reading} onClick={props.onSample}>
            Try a sample
          </button>
        </div>
      </div>
    );
  } else {
    body = (
      <>
        {status}
        {notices}
        {input}
        {/* Keyed by the food AND its numbers, so a new card mounts rather than
            tweening its bars from the previous food's values while the digits
            already read the new food's (and a label reading of the same food
            is a new card too). */}
        <NutritionPanel
          key={`${nutrition.product_name}:${nutrition.calories}:${nutrition.source ?? ''}`}
          data={nutrition}
          onRecipeClick={live ? props.onRecipe : undefined}
        />
        <div className="nutrition-upload-row">
          <button type="button" className="nutrition-upload" disabled={!live || reading} onClick={choose}>
            {reading ? 'Reading it…' : 'Share a photo'}
          </button>
        </div>
        {/* The table sits below the fold, and "it rendered" is not "it is on screen". */}
        {showShelfLink && (
          <button type="button" className="shelf-jump" onClick={scrollToShelf}>
            Compared so far · {shelf!.items.length} foods ↓
          </button>
        )}
        {shelf && <ComparisonShelf shelf={shelf} />}
        {shelf && <KeptRecipes shelf={shelf} onOpen={live ? props.onOpenKept : () => {}} />}
      </>
    );
  }

  return (
    <section className={`nutrition-board${dragging ? ' is-dragging' : ''}`} aria-label="Nutrition board" {...drop}>
      {body}
      {dragging && <div className="nutrition-drop" aria-hidden="true">Drop a photo of a food or its label</div>}
    </section>
  );
}
