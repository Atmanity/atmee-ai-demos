// The table: everything the user sees besides Rachel. An empty table that says
// what to ask, a label being looked up, the card with its recipe ideas, the
// foods side by side, a recipe being cooked, the files on their way to Rachel,
// and the two notices the page puts up on its own (an emergency; a question
// about the user's own health).
import { useState, type DragEvent, type ReactNode } from 'react';
import { fileWords, type SharedFile } from '../../../src/kit/index.ts';
import type { Cook } from '../engine/cook.ts';
import type { RecipeIdea, View } from '../engine/types.ts';
import { Ideas, Label } from './Label.tsx';
import { Recipe } from './Recipe.tsx';
import type { RecipeView } from './recipeView.ts';
import { OpenedRecipes, SideBySide, TABLE_ANCHOR_ID } from './SideBySide.tsx';

/** Something the app is doing right now: looking a food up, reading a photo. */
export interface Work {
  id: number;
  label: string;
  /** The photo being read, if it is one. */
  preview?: string;
}

/** Foods the app can answer at once, even without its model. */
export const QUICK_PICKS = ['Banana', 'Greek yogurt', 'Oats', 'Avocado', 'Egg'];

export interface BoardProps {
  host: string;
  /** The call is live and the table is set: the controls work. */
  ready: boolean;
  /** The call is on its way. */
  connecting: boolean;
  /** Rachel takes files in this call: a drop is photos, a menu, a food log, not one photo. */
  takesFiles: boolean;
  /** The files of the drop on its way to Rachel, each with its progress. */
  files: SharedFile[];
  view: View | null;
  recipeView: RecipeView;
  cook: Cook;
  working: Work[];
  notice: string | null;
  concern: 'emergency' | 'medical' | null;
  onQuickPick: (food: string) => void;
  onIdea: (idea: RecipeIdea) => void;
  onOpenKept: (name: string) => void;
  onBack: () => void;
  onNext: () => void;
  onPickStep: (step: number) => void;
  onRetryRecipe: () => void;
  onChoosePhoto: () => void;
  /** Everything dropped on the table; the app decides what reads it. */
  onFiles: (files: File[]) => void;
  onSample: () => void;
  onClear: () => void;
  onDismissNotice: () => void;
  onDismissConcern: () => void;
}

const sentence = (label: string) => `${label.charAt(0).toUpperCase()}${label.slice(1)}…`;

export function Board(props: BoardProps) {
  const { host, ready, takesFiles, files, view, recipeView, working, notice, concern } = props;
  const card = view?.nutrition ?? null;
  const shelf = view?.shelf;
  const [dragging, setDragging] = useState(false);
  const busyPhoto = working.some((w) => w.preview);

  // Whatever is dropped anywhere on the table goes the way an added photo or file does.
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const drop = {
    onDragOver: (e: DragEvent) => {
      if (!ready || !hasFiles(e)) return;
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
      const dropped = Array.from(e.dataTransfer.files);
      if (ready && dropped.length) props.onFiles(dropped);
    },
  };

  const photoBeingRead = working.find((w) => w.preview)?.preview;
  // What the app is doing, so the table answers every request: a lookup in
  // flight is visible, never the previous food left standing as if nothing was heard.
  const status = working.length && (card || recipeView.selected) ? (
    <div className="ms-status" role="status" aria-live="polite">
      {photoBeingRead ? <img src={photoBeingRead} alt="The photo being read" /> : <span className="ms-spinner" aria-hidden="true" />}
      <span>{working.map((w) => sentence(w.label)).join(' ')}</span>
    </div>
  ) : null;

  let body: ReactNode;
  if (recipeView.selected) {
    body = (
      <Recipe
        chosen={recipeView.selected} details={recipeView.details} loading={recipeView.loading} cook={props.cook}
        food={recipeView.forProduct} host={host} live={ready}
        onBack={props.onBack} onNext={props.onNext} onPick={props.onPickStep} onRetry={props.onRetryRecipe}
      />
    );
  } else if (card) {
    body = (
      <>
        <div className="ms-card-row">
          {/* Keyed by the food and its numbers, so a new card mounts fresh rather than tweening the last one's bars. */}
          <Label key={`${card.product_name}:${card.calories}:${card.source ?? ''}`} data={card} />
          <div className="ms-card-side">
            <Ideas food={card.product_name} ideas={card.recipes} onOpen={props.onIdea} disabled={!ready} />
            {(shelf?.items.length ?? 0) >= 2 && (
              <a className="ms-jump" href={`#${TABLE_ANCHOR_ID}`}>See all {shelf!.items.length} foods side by side <span aria-hidden="true">↓</span></a>
            )}
          </div>
        </div>
        {shelf && <SideBySide shelf={shelf} onClear={props.onClear} disabled={!ready} />}
        {shelf && <OpenedRecipes shelf={shelf} onOpen={props.onOpenKept} disabled={!ready} />}
      </>
    );
  } else if (working.length) {
    body = (
      <div className="ms-skeleton" role="status" aria-live="polite">
        {photoBeingRead && <img className="ms-skeleton-photo" src={photoBeingRead} alt="The photo being read" />}
        <div className="ms-skeleton-label" aria-hidden="true">
          <i className="is-title" /><i /><i className="is-thick" /><i /><i /><i /><i />
        </div>
        <p><span className="ms-spinner" aria-hidden="true" /> {working.map((w) => sentence(w.label)).join(' ')}</p>
      </div>
    );
  } else {
    body = (
      <div className="ms-empty">
        <p className="ms-eyebrow">{ready ? `${host} is listening` : props.connecting ? `${host} is on the way` : 'Your table'}</p>
        <h2>Ask about any food.</h2>
        <p className="ms-empty-say">Say <q>What's in a banana?</q> or <q>How much protein is in 200 g of chicken?</q></p>
        <div className="ms-picks" role="group" aria-label="Look one up now">
          <span className="ms-picks-label">Or tap one</span>
          {QUICK_PICKS.map((food) => (
            <button key={food} type="button" className="ms-tag" onClick={() => props.onQuickPick(food)} disabled={!ready}>{food}</button>
          ))}
        </div>
        <div className="ms-photo-door">
          <button type="button" className="ms-secondary" onClick={props.onChoosePhoto} disabled={!ready || busyPhoto}>
            <CameraIcon /> {takesFiles ? 'Add a photo, a menu or your food log' : 'Add a photo of a food or its label'}
          </button>
          <button type="button" className="ms-link" onClick={props.onSample} disabled={!ready || busyPhoto}>No food handy? Use our salmon plate photo</button>
          <p className="ms-hint">{takesFiles ? 'You can also drop them anywhere on this table, several labels at once to compare them.' : 'You can also drop a photo anywhere on this table.'}</p>
        </div>
      </div>
    );
  }

  return (
    <section className={`ms-board${dragging ? ' is-dragging' : ''}`} aria-label="Your table" {...drop}>
      {concern === 'emergency' && (
        <div className="ms-alert" role="alert">
          <strong>If this is an emergency, call your local emergency number now.</strong>
          <span>Trouble breathing, a swelling throat, tongue or lips, or choking need help right away: 911 in the US, 112 in Europe, 999 in the UK. If an adrenaline auto-injector has been prescribed, use it.</span>
          <button type="button" className="ms-dismiss" aria-label="Dismiss the emergency notice" onClick={props.onDismissConcern}>×</button>
        </div>
      )}
      {concern === 'medical' && (
        <aside className="ms-health" role="status">
          <strong>About your own health</strong>
          <span>{host} can tell you what's in a food and what a nutrient does, but not what's right for you. For a condition, a medicine, a pregnancy or an allergy, ask your doctor or a registered dietitian.</span>
          <button type="button" className="ms-dismiss" aria-label="Dismiss" onClick={props.onDismissConcern}>×</button>
        </aside>
      )}
      {status}
      {files.length > 0 && (
        <ul className="ms-files" aria-label={`On their way to ${host}`} aria-live="polite">
          {files.map((file, i) => (
            <li key={i} className={`is-${file.status}`}><span>{file.name}</span><span>{fileWords(file)}</span></li>
          ))}
        </ul>
      )}
      {notice && (
        <p className="ms-notice" role="status">
          {notice}
          <button type="button" className="ms-dismiss" aria-label="Dismiss" onClick={props.onDismissNotice}>×</button>
        </p>
      )}
      {body}
      {dragging && <div className="ms-drop" aria-hidden="true">{takesFiles ? 'Drop photos, a menu or your food log' : 'Drop a photo of a food or its label'}</div>}
    </section>
  );
}

export const CameraIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
  </svg>
);
