// Morsel: ask about any food and Rachel, a friendly nutritionist, puts its
// label on your table, lines foods up side by side and talks you through a
// recipe. Rachel acts through the app's tools (look a food up, compare, open a
// recipe, next steps); the page answers each call (the server for anything
// that needs a model, itself for the recipe's place), updates the table and
// returns the words she speaks from. Buttons act at once and she is told.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CallControls, CallStatus, ChatPanel, HostVideo, useAvatar, useToolNet, type ToolCall } from '../../../src/kit/index.ts';
import { recipeKey } from '../engine/advisor.ts';
import { nextBatch, pick, started, unstarted, type Cook } from '../engine/cook.ts';
import { boardState, NOTES, pressed, said, SERVER_TOOLS, type Screen } from '../engine/director.ts';
import { concernIn, mustDo } from '../engine/judge.ts';
import { hasNotes } from '../engine/notes.ts';
import { reasonFrom } from '../engine/nutrition.ts';
import { EMPTY_SHELF, parseShelf } from '../engine/shelf.ts';
import type { Outcome, RecipeDetails, RecipeIdea, View } from '../engine/types.ts';
import portrait from '../host/portrait.jpg';
import { Board, CameraIcon, type Work } from './Board.tsx';
import { Lobby, Logo } from './Lobby.tsx';
import { downloadNotes, Notes } from './Notes.tsx';
import { imageFrom } from './photo.ts';
import { arrived, closed, failed, initialRecipeView, requested, timedOut, type Chosen, type RecipeView } from './recipeView.ts';
import './morsel.css';

const ID = 'nutrition-advisor';
const API = `/api/apps/${ID}`;
const HOST = 'Rachel';

/**
 * How long a tapped recipe may spin before the table admits it is not coming
 * and offers "Try again". Longer than a healthy recipe, far shorter than forever.
 */
const RECIPE_WAIT_MS = 20_000;

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

/** What the table says the app is doing while one of Rachel's tools runs. */
export function workLabel(name: string, args: Record<string, unknown>): string | null {
  const given = args.foods ?? args.food;
  const foods = (Array.isArray(given) ? given : [given])
    .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    .map((f) => f.trim().slice(0, 40));
  const named = foods.join(' and ');
  if (name === 'look_up_food') return named ? `looking up ${named}` : 'looking it up';
  if (name === 'compare_foods') return named ? `putting ${named} side by side` : 'lining the foods up';
  if (name === 'open_recipe') return 'opening the recipe';
  return null;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function App() {
  const [view, setViewState] = useState<View | null>(null);
  const [recipeView, setRecipeViewState] = useState<RecipeView>(initialRecipeView);
  const [cook, setCookState] = useState<Cook>(unstarted);
  const [working, setWorking] = useState<Work[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [concern, setConcernState] = useState<'emergency' | 'medical' | null>(null);
  const [opened, setOpened] = useState<RecipeDetails[]>([]);
  const visit = useRef<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const workId = useRef(0);
  // Read by async code that resolves long after it started.
  const viewRef = useRef(view);
  const recipeViewRef = useRef(recipeView);
  const cookRef = useRef(cook);
  const concernRef = useRef(concern);
  // Never inside a state updater: StrictMode runs those twice.
  const setView = (next: View | null) => { viewRef.current = next; setViewState(next); };
  const setRecipeView = (next: RecipeView) => { recipeViewRef.current = next; setRecipeViewState(next); };
  const setCook = (next: Cook) => { cookRef.current = next; setCookState(next); };
  const setConcern = (next: 'emergency' | 'medical' | null) => { concernRef.current = next; setConcernState(next); };

  async function call(path: string, body: unknown, label?: string | null, preview?: string): Promise<Outcome> {
    const work = label ? { id: ++workId.current, label, preview } : null;
    if (work) setWorking((w) => [...w, work]);
    try {
      return await post<Outcome>(`/visits/${visit.current}${path}`, body);
    } finally {
      if (work) setWorking((w) => w.filter((x) => x.id !== work.id));
    }
  }

  function keep(recipe: RecipeDetails) {
    setOpened((list) => [...list.filter((r) => recipeKey(r.recipe_name) !== recipeKey(recipe.recipe_name)), recipe].slice(-8));
  }

  /** An action's outcome on the table. `via`: Rachel's tool, or the user's own button. */
  function apply(outcome: Outcome, via: 'tool' | 'button') {
    const current = viewRef.current;
    // A reply overtaken by a newer one keeps its words, not its screen.
    const stale = Boolean(current && outcome.view.seq < current.seq);
    if (!stale) setView({ ...outcome.view, shelf: parseShelf(outcome.view.shelf) });
    const food = (stale ? current : outcome.view)?.nutrition?.product_name ?? '';
    if (outcome.kind === 'cleared') {
      setRecipeView(closed(recipeViewRef.current));
      setCook(unstarted());
      setOpened([]);
    }
    // A new card is what the user just asked for: it comes forward, even over an open recipe.
    if (outcome.card && !stale && recipeViewRef.current.selected) {
      setRecipeView(closed(recipeViewRef.current));
      setCook(unstarted());
    }
    if (outcome.recipe) {
      const recipe = outcome.recipe;
      keep(recipe);
      if (via === 'tool') {
        // Rachel opened it to talk it through: it opens over whatever is there, its first steps lit.
        const asked = requested(recipeViewRef.current, { name: recipe.recipe_name, description: recipe.description ?? '' }, food);
        setRecipeView(arrived(asked, recipe, food));
        setCook(started(recipe.preparation_steps.length));
      } else {
        // The answer to a tap: shown only if that tap is still the one on screen.
        setRecipeView(arrived(recipeViewRef.current, recipe, food));
      }
    }
    if (outcome.notice) setNotice(outcome.notice);
    // Make the new card's recipes ahead, so opening one is instant.
    if (outcome.card && !stale) void call('/act', { command: 'prepare' }).then((done) => apply(done, 'button'), () => {});
  }

  /** Rachel's next_steps, and the "Next steps" button: the next batch, lit up. */
  function stepOn(): string {
    const { selected, details } = recipeViewRef.current;
    if (!selected || !details) return said.noRecipe();
    const next = nextBatch(cookRef.current, details.preparation_steps.length);
    if (!next) return said.stepsDone(details);
    setCook(next);
    return said.steps(details, next);
  }

  /** Rachel's close_recipe, and the "Back to the card" button. */
  function closeRecipe(): string {
    const food = viewRef.current?.nutrition?.product_name ?? null;
    if (!recipeViewRef.current.selected) return said.notOpen(food);
    setRecipeView(closed(recipeViewRef.current));
    setCook(unstarted());
    return said.closed(food);
  }

  // Rachel's tool calls: the table changes, and the result is what she says.
  const onToolCall = useCallback(async ({ name, arguments: args }: ToolCall): Promise<string> => {
    if (name === 'next_steps') return stepOn();
    if (name === 'close_recipe') return closeRecipe();
    if (!SERVER_TOOLS.has(name)) throw new Error(`there is no tool called ${name}`);
    if (!visit.current) throw new Error('the table is still being set up; try again in a moment');
    setNotice(null);
    try {
      const outcome = await call('/tool', { name, arguments: args, open: recipeViewRef.current.selected?.name ?? null }, workLabel(name, args ?? {}));
      apply(outcome, 'tool');
      return outcome.text;
    } catch (err) {
      setNotice("That didn't go through. Ask again in a moment.");
      throw err;
    }
  }, []);

  // If Rachel narrates "here it is" without the call, the app does it and tells her.
  const net = useToolNet({
    match: (text) => {
      const v = viewRef.current;
      const found = mustDo(text, { card: v?.nutrition?.product_name ?? null, shelf: v?.shelf.items.map((r) => r.product_name) ?? [], openRecipe: recipeViewRef.current.selected?.name ?? null });
      return found ? { id: `net-${Date.now()}`, ...found } : null;
    },
    run: async (c) => String(await onToolCall(c)),
    avatar: () => avatarRef.current!,
  });
  const watched = net.watch(onToolCall);
  const markLookup = net.watch(async () => undefined);
  const handle = (c: ToolCall) => {
    // A comparison puts foods up too, so it answers "what about an apple?" as well as a lookup does.
    if (c.name === 'compare_foods') void markLookup({ ...c, name: 'look_up_food' });
    return watched(c);
  };

  /** What the page shows at once, whatever Rachel says: an emergency, or a question about the user's own health. */
  function watchFor(text: string) {
    const found = concernIn(text);
    if (found === 'emergency') {
      setConcern('emergency');
      avatarRef.current?.event(said.emergency(), 20);
    } else if (found === 'medical' && concernRef.current !== 'emergency') {
      setConcern('medical');
    }
  }

  const avatar = useAvatar(ID, {
    onToolCall: handle,
    onUserSaid: (text) => {
      watchFor(text);
      net.heard(text);
    },
  });
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';
  const ready = live && Boolean(view);

  // Every call sets a fresh table, while Rachel is on her way.
  useEffect(() => {
    if (avatar.phase !== 'starting') return;
    visit.current = null;
    setView(null);
    setRecipeView(closed(recipeViewRef.current));
    setCook(unstarted());
    setWorking([]);
    setNotice(null);
    setConcern(null);
    setOpened([]);
    for (const note of NOTES) avatar.note(note);
    post<{ id: string; view: View; opening: string }>('/visits')
      .then(({ id, view: first, opening }) => {
        visit.current = id;
        setView({ ...first, shelf: parseShelf(first.shelf) });
        avatar.event(opening, 60);
      })
      .catch((err) => {
        console.warn('[morsel] no table', err);
        setNotice("Morsel couldn't set your table. Check your connection, then call again.");
      });
  }, [avatar.phase]);

  // Rachel's picture of the table follows the table.
  useEffect(() => {
    if (!view) return;
    const open = recipeView.selected && recipeView.details ? recipeView.details : null;
    const screen: Screen = {
      recipe: open,
      cook: open ? cook : null,
      loadingRecipe: recipeView.selected && !recipeView.details && recipeView.loading ? recipeView.selected.name : null,
      working: working.length ? working.map((w) => w.label).join('; ') : null,
      concern,
    };
    avatar.state(boardState(view, screen));
  }, [view, recipeView, cook, working, concern]);

  // The tapped recipe's deadline, keyed on its ticket so a newer tap restarts the clock.
  useEffect(() => {
    if (!recipeView.loading) return;
    const ticket = recipeView.requestId;
    const timer = setTimeout(() => setRecipeView(timedOut(recipeViewRef.current, ticket)), RECIPE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [recipeView.loading, recipeView.requestId]);

  const didNotGoThrough = (err: unknown) => {
    console.warn('[morsel]', err);
    setNotice("That didn't go through. Check your connection, then try again.");
  };

  async function quickPick(food: string) {
    if (!visit.current) return;
    setNotice(null);
    try {
      const done = await call('/act', { command: 'lookup', food }, `looking up ${food.toLowerCase()}`);
      apply(done, 'button');
      avatar.event(done.text, 30);
    } catch (err) {
      didNotGoThrough(err);
    }
  }

  async function tapRecipe(chosen: Chosen) {
    if (!visit.current) return;
    const ticket = requested(recipeViewRef.current, chosen, viewRef.current?.nutrition?.product_name ?? '');
    setRecipeView(ticket);
    setCook(unstarted());
    setNotice(null);
    try {
      const done = await call('/act', { command: 'recipe', name: chosen.name, description: chosen.description });
      apply(done, 'button');
      if (done.kind === 'failed') {
        // The recipe view offers "Try again" itself.
        setRecipeView(failed(recipeViewRef.current, ticket.requestId));
        setNotice(null);
      }
      avatar.event(done.text, 30);
    } catch (err) {
      setRecipeView(failed(recipeViewRef.current, ticket.requestId));
      didNotGoThrough(err);
    }
  }

  function nextPressed() {
    const label = cookRef.current.shown ? 'Next steps' : 'Start the steps';
    avatar.event(pressed(label, stepOn()), 30);
  }

  async function addPhoto(file: File) {
    if (!visit.current) return;
    setNotice(null);
    let image: Awaited<ReturnType<typeof imageFrom>>;
    try {
      image = await imageFrom(file);
    } catch (err) {
      setNotice(`That photo couldn't be opened: ${reasonFrom(err, 'try a JPEG or PNG')}.`);
      return;
    }
    try {
      const done = await call('/act', { command: 'photo', image: { mimeType: image.mimeType, base64: image.base64 } }, 'reading your photo', image.preview);
      apply(done, 'button');
      if (done.text) avatar.event(done.text, 45);
    } catch (err) {
      didNotGoThrough(err);
    }
  }

  async function tryPlate() {
    if (!visit.current) return;
    setNotice(null);
    try {
      const done = await call('/act', { command: 'sample' }, 'reading the salmon plate photo', `${API}/sample.jpg`);
      apply(done, 'button');
      if (done.text) avatar.event(done.text, 45);
    } catch (err) {
      didNotGoThrough(err);
    }
  }

  async function clearTable() {
    if (!visit.current) return;
    try {
      const done = await call('/act', { command: 'start_over' });
      apply(done, 'button');
      avatar.event(done.text, 20);
    } catch (err) {
      didNotGoThrough(err);
    }
  }

  if (avatar.phase === 'idle') return <Lobby host={HOST} onStart={(mic) => void avatar.start({ mic })} />;

  const shelf = view?.shelf ?? EMPTY_SHELF;
  const anything = hasNotes(shelf.items, opened);
  const over = avatar.phase === 'ended' || avatar.phase === 'failed';
  const again = () => void avatar.start({ mic: avatar.micOn });

  return (
    <div className="ms-app">
      <header className="ms-top">
        <Logo />
        <div className="ms-top-actions">
          <button type="button" className="ms-tool" onClick={() => picker.current?.click()} disabled={!ready}>
            <CameraIcon /><span>Add a photo</span>
          </button>
          <button type="button" className="ms-tool" onClick={() => downloadNotes(shelf, opened, HOST)} disabled={!anything}>
            <DownloadIcon /><span>Save notes</span>
          </button>
        </div>
        <input
          ref={picker} type="file" accept="image/*" hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void addPhoto(file);
          }}
        />
      </header>

      <main className="ms-main">
        <div className="ms-side">
          <aside className="ms-host" aria-label={`${HOST}, your nutritionist`}>
            {/* Rachel's face fills the frame while the call connects, instead of a dark box. */}
            <HostVideo avatar={avatar} name={HOST} poster={portrait} className="ms-host-video">
              <CallStatus avatar={avatar} name={HOST} again={`Call ${HOST} again`} />
            </HostVideo>
            <div className="ms-nameplate">
              <p><b>{HOST}</b><span>Nutritionist</span></p>
              {live && avatar.secondsLeft !== null && avatar.secondsLeft <= 120 && <span className="ms-left">{clock(avatar.secondsLeft)} left</span>}
              {live && <span className="ms-live">Live</span>}
              <CallControls avatar={avatar} className="ms-controls" />
            </div>
          </aside>
          <ChatPanel
            avatar={avatar} name={HOST} className="ms-chat"
            placeholder="Ask about a food, or say “compare it with…”"
            empty={<>Talk out loud, or type here. Try <q>What's in a banana?</q></>}
          />
        </div>

        <div className="ms-stage">
          {over ? (
            <Notes shelf={shelf} recipes={opened} host={HOST} failed={avatar.phase === 'failed' && !anything} onAgain={again} />
          ) : (
            <Board
              host={HOST} ready={ready} connecting={!live} view={view} recipeView={recipeView} cook={cook}
              working={working} notice={notice} concern={concern}
              onQuickPick={(food) => void quickPick(food)}
              onIdea={(idea: RecipeIdea) => void tapRecipe(idea)}
              onOpenKept={(name) => void tapRecipe({ name, description: '' })}
              onBack={() => void closeRecipe()}
              onNext={nextPressed}
              onPickStep={(step) => setCook(pick(step, recipeViewRef.current.details?.preparation_steps.length ?? 0))}
              onRetryRecipe={() => { const chosen = recipeViewRef.current.selected; if (chosen) void tapRecipe(chosen); }}
              onChoosePhoto={() => picker.current?.click()}
              onPhoto={(file) => void addPhoto(file)}
              onSample={() => void tryPlate()}
              onClear={() => void clearTable()}
              onDismissNotice={() => setNotice(null)}
              onDismissConcern={() => setConcern(null)}
            />
          )}
        </div>
      </main>
    </div>
  );
}

const DownloadIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);
