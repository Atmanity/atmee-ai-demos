// Nutrition Advisor: the avatar advises; the app's server makes the cards,
// the recipes and the readings of photos, and decides what each line the user
// says asks for. The page shows the board, keeps the avatar's picture of it in
// step (the board state, with every figure it may quote), and tells it what
// happened as events, always after the state that shows it.
import { useEffect, useRef, useState } from 'react';
import { AvatarStage, Composer, Transcript, useAvatar } from '../../../src/kit/index.ts';
import { boardState, NOTES, SAMPLE_FAILED, type Screen } from '../engine/director.ts';
import { contextFor, ruleIntent } from '../engine/judge.ts';
import { reasonFrom } from '../engine/nutrition.ts';
import { parseShelf } from '../engine/shelf.ts';
import type { ActRequest, FoodAsk, How, Intent, Outcome, View } from '../engine/types.ts';
import { AppPanel, type Work } from './AppPanel.tsx';
import { imageFrom } from './photo.ts';
import { arrived, closed, failed, initialRecipeView, requested, superseded, timedOut, type Chosen, type RecipeView } from './recipeView.ts';
import './styles.css';

const ID = 'nutrition-advisor';
const API = `/api/apps/${ID}`;

/**
 * How long a recipe may sit spinning before the panel admits it is not coming,
 * and falls through to a door ("tap the recipe again"), not an error. Longer
 * than a healthy generation, far shorter than forever.
 */
const RECIPE_WAIT_MS = 20_000;

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

const named = (foods: FoodAsk[]) => foods.map((f) => `"${[f.quantity, f.name].filter(Boolean).join(' ')}"`).join(' and ');

export function App() {
  const [view, setView] = useState<View | null>(null);
  const [recipeView, setRecipeViewState] = useState<RecipeView>(initialRecipeView);
  const [superseder, setSuperseder] = useState<string | null>(null);
  const [working, setWorking] = useState<Work[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const session = useRef<string | null>(null);
  const lastAvatarLine = useRef('');
  // Events wait for the state that shows what they are about.
  const queued = useRef<{ text: string; ttl?: number }[]>([]);
  // Read by async code that resolves long after it started: the state variables
  // there would be the values from when it started.
  const viewRef = useRef(view);
  const recipeViewRef = useRef(recipeView);
  const supersederRef = useRef(superseder);
  supersederRef.current = superseder;
  const workId = useRef(0);

  // Never inside a state updater: StrictMode runs those twice.
  const setRecipeView = (next: RecipeView) => {
    recipeViewRef.current = next;
    setRecipeViewState(next);
  };

  const avatar = useAvatar(ID, {
    // The avatar hears the user too and answers at once; the app acts on what
    // was said and tells it the outcome a moment later.
    onUserSaid: (text, how) => { if (how === 'spoken') void heard(text, 'spoken'); },
    onAvatarSaid: (text) => { lastAvatarLine.current = text; },
  });
  const live = avatar.phase === 'live';

  function apply(outcome: Outcome) {
    // A reply that was overtaken by a newer one keeps its event, not its screen.
    const stale = Boolean(viewRef.current && outcome.view.seq < viewRef.current.seq);
    const next: View = stale ? viewRef.current! : { ...outcome.view, shelf: parseShelf(outcome.view.shelf) };
    viewRef.current = next;
    setView(next);
    const food = next.nutrition?.product_name ?? '';
    // A card for another food while a recipe is open: say so, rather than
    // leaving the user reading a recipe while the answer hides behind it.
    if (outcome.card && food && superseded(recipeViewRef.current, food, supersederRef.current ?? '')) setSuperseder(food);
    // Details for a tap, or a recipe opened by voice: which one is `arrived`'s decision.
    if (outcome.recipe) setRecipeView(arrived(recipeViewRef.current, outcome.recipe, food));
    if (outcome.notice) setNotice(outcome.notice);
    // Normally after the state that shows it; a stale reply's screen is already out.
    if (outcome.event && stale) avatar.event(outcome.event, outcome.ttl);
    else if (outcome.event) queued.current.push({ text: outcome.event, ttl: outcome.ttl });
    // Make the new card's recipes ahead, so they are staged before anyone asks.
    if (outcome.card) void act({ action: { kind: 'prepare' }, how: 'button' });
  }

  async function act(request: ActRequest, label?: string, preview?: string): Promise<Outcome | null> {
    const id = session.current;
    if (!id) return null;
    const work = label ? { id: ++workId.current, label, preview } : null;
    if (work) setWorking((w) => [...w, work]);
    try {
      const outcome = await post<Outcome>(`/sessions/${id}/act`, request);
      apply(outcome);
      return outcome;
    } catch (err) {
      console.warn('[nutrition-advisor]', err);
      if (label) setNotice(`That did not go through (${reasonFrom(err)}). Try again in a moment.`);
      return null;
    } finally {
      if (work) setWorking((w) => w.filter((x) => x.id !== work.id));
    }
  }

  function lookUp(intent: Extract<Intent, { kind: 'lookup' | 'compare' }>, how: How, said?: string) {
    const current = viewRef.current?.nutrition?.product_name;
    const label = intent.kind === 'compare' && current ? `putting ${named(intent.foods)} beside "${current}"` : `looking up ${named(intent.foods)}`;
    return act({ action: intent, how, said }, label);
  }

  async function openRecipe(chosen: Chosen, how: How, said?: string) {
    const next = requested(recipeViewRef.current, chosen, viewRef.current?.nutrition?.product_name ?? '');
    setRecipeView(next);
    setSuperseder(null);
    const outcome = await act({ action: { kind: 'recipe', ...chosen }, how, said });
    if (!outcome || outcome.kind === 'failed') setRecipeView(failed(recipeViewRef.current, next.requestId));
  }

  function goBack() {
    setRecipeView(closed(recipeViewRef.current));
    setSuperseder(null);
  }

  async function sharePhoto(file: File) {
    setNotice(null);
    try {
      const image = await imageFrom(file);
      await act({ action: { kind: 'photo', image: { mimeType: image.mimeType, base64: image.base64 } }, how: 'button' }, 'reading the photo you shared', image.preview);
    } catch (err) {
      setNotice(`That photo could not be opened: ${reasonFrom(err, 'try a JPEG or PNG')}.`);
    }
  }

  async function trySample() {
    setNotice(null);
    const outcome = await act({ action: { kind: 'sample' }, how: 'button' }, 'reading the sample photo', `${API}/sample.jpg`);
    if (!outcome) setNotice(`The sample did not load — ${SAMPLE_FAILED}.`);
  }

  /** A line the user said or typed: the rules at once, the server's model only when they cannot tell. */
  async function heard(text: string, how: 'spoken' | 'typed') {
    const id = session.current;
    const openName = recipeViewRef.current.selected?.name ?? null;
    let intent = ruleIntent(text, contextFor(viewRef.current, openName, lastAvatarLine.current));
    if (!intent && id) {
      try {
        ({ intent } = await post<{ intent: Intent }>(`/sessions/${id}/judge`, { text, how, screen: { recipe: openName }, lastAvatarLine: lastAvatarLine.current }));
      } catch (err) {
        console.warn('[nutrition-advisor] judging failed', err);
      }
    }
    if (!intent || intent.kind === 'none' || !id) {
      // Not an app action: a typed line goes to the avatar as a turn, with the board already in front of it.
      if (how === 'typed') avatar.say(text);
      return;
    }
    // An app action: shown in the transcript, acted on, and its outcome told as an event.
    if (how === 'typed') avatar.record(text);
    setNotice(null);
    if (intent.kind === 'back') goBack();
    else if (intent.kind === 'sample') void trySample();
    else if (intent.kind === 'recipe') void openRecipe({ name: intent.name, description: intent.description }, how, text);
    else void lookUp(intent, how, text);
  }

  // The session is opened while the avatar is on its way (both take a while).
  useEffect(() => {
    if (avatar.phase !== 'starting' || session.current) return;
    for (const note of NOTES) avatar.note(note);
    post<{ id: string; outcome: Outcome }>('/sessions')
      .then(({ id, outcome }) => {
        session.current = id;
        apply(outcome);
      })
      .catch((err) => {
        console.warn('[nutrition-advisor] no session', err);
        setNotice('The app server did not answer. Is it running?');
      });
  }, [avatar.phase]);

  // The avatar's picture of the screen follows the screen; then the events
  // about what changed, so each one is spoken with its figures already there.
  useEffect(() => {
    if (!view) return;
    const screen: Screen = {
      recipe: recipeView.selected && recipeView.details ? recipeView.details : null,
      loadingRecipe: recipeView.selected && !recipeView.details ? recipeView.selected.name : null,
      working: working.length ? working.map((w) => w.label).join('; ') : null,
    };
    avatar.state(boardState(view, screen));
    for (const e of queued.current.splice(0)) avatar.event(e.text, e.ttl);
  }, [view, recipeView, working]);

  // The spinner's deadline, keyed on the ticket so a tap that replaces another
  // restarts the clock rather than inheriting the old tap's remainder.
  useEffect(() => {
    if (!recipeView.loading) return;
    const ticket = recipeView.requestId;
    const timer = setTimeout(() => setRecipeView(timedOut(recipeViewRef.current, ticket)), RECIPE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [recipeView.loading, recipeView.requestId]);

  return (
    <div className="kit-layout nutrition-layout">
      <div className="kit-side">
        <AvatarStage
          avatar={avatar} name="Your advisor" startLabel="Start talking"
          lobby={<><div className="kit-title">Nutrition Advisor</div><div className="kit-detail">Name any food, or share a photo of one or its label: its card appears on the right, with what the numbers mean, a side-by-side table and recipe ideas talked through.</div></>}
        />
        <Composer avatar={avatar} placeholder="Name a food, or ask to compare…" onSubmit={(t) => { void heard(t, 'typed'); }} />
        <Transcript avatar={avatar} names={{ avatar: 'Advisor' }} />
      </div>
      <AppPanel
        view={view} live={live} recipeView={recipeView} superseder={superseder} working={working} notice={notice}
        onRecipe={(chosen) => void openRecipe(chosen, 'button')}
        onOpenKept={(name) => void openRecipe({ name, description: '' }, 'button')}
        onBack={goBack}
        onDismissBanner={() => setSuperseder(null)}
        onDismissNotice={() => setNotice(null)}
        onPhoto={(file) => void sharePhoto(file)}
        onSample={() => void trySample()}
      />
    </div>
  );
}
