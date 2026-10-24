// Morsel: ask about any food and Rachel, a friendly nutritionist, puts its
// label on your table, lines foods up side by side and talks you through a
// recipe. Rachel acts through the app's tools (look a food up, compare, open a
// recipe, next steps); the page answers each call (the server for anything
// that needs a model, itself for the recipe's place), updates the table and
// returns the words she speaks from. Buttons act at once and she is told.
// Photos and files the user shares she sees herself; the app's own reader
// still makes every photo's card.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CallControls, CallStatus, ChatPanel, FileError, HostVideo, MAX_FILES, REFUSED_WORDS, useAvatar, useToolNet, BackToApps, useCaptionToggle, type FileOutcome, type FileProgress, type SharedFile, type ToolCall } from '../../../src/kit/index.ts';
import { recipeKey } from '../engine/advisor.ts';
import { nextBatch, pick, started, unstarted, type Cook } from '../engine/cook.ts';
import { boardState, NOTES, photosTold, pressed, said, SERVER_TOOLS, type Screen } from '../engine/director.ts';
import { concernIn, mustDo } from '../engine/judge.ts';
import { hasNotes } from '../engine/notes.ts';
import { reasonFrom } from '../engine/nutrition.ts';
import { EMPTY_SHELF, parseShelf } from '../engine/shelf.ts';
import type { Outcome, RecipeDetails, RecipeIdea, View } from '../engine/types.ts';
import portrait from '../host/portrait.jpg';
import { Board, CameraIcon, type Work } from './Board.tsx';
import { Lobby, Logo } from './Lobby.tsx';
import { downloadNotes, Notes } from './Notes.tsx';
import { imageFrom, type Picked } from './photo.ts';
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

/** What the picker offers while Rachel takes files: photos, a menu, a food log. */
const FILE_TYPES = 'image/*,.pdf,.csv,.txt';

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

/** An answer that came back for a call that is over: dropped, never applied, never told. */
class Superseded extends Error {
  constructor() { super('that call is over'); }
}

export function App() {
  const [view, setViewState] = useState<View | null>(null);
  const [recipeView, setRecipeViewState] = useState<RecipeView>(initialRecipeView);
  const [cook, setCookState] = useState<Cook>(unstarted);
  const [working, setWorking] = useState<Work[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [concern, setConcernState] = useState<'emergency' | 'medical' | null>(null);
  const [opened, setOpened] = useState<RecipeDetails[]>([]);
  // The drop on its way to Rachel: a later one replaces it on the table.
  const [shared, setShared] = useState<SharedFile[]>([]);
  const drops = useRef(0);
  const visit = useRef<string | null>(null);
  // Which call the table belongs to. Bumped when a call is placed and when it
  // ends, so anything started for one call (its table, a lookup, a button)
  // that answers later is dropped instead of acting on the next.
  const generation = useRef(0);
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

  /** One request for this call's table; throws Superseded if the call is over by the time it answers. */
  async function call(path: string, body: unknown, label?: string | null, preview?: string, mine = generation.current): Promise<Outcome> {
    if (mine !== generation.current || !visit.current) throw new Superseded();
    const work = label ? { id: ++workId.current, label, preview } : null;
    if (work) setWorking((w) => [...w, work]);
    try {
      const outcome = await post<Outcome>(`/visits/${visit.current}${path}`, body);
      if (mine !== generation.current) throw new Superseded();
      return outcome;
    } finally {
      if (work && mine === generation.current) setWorking((w) => w.filter((x) => x.id !== work.id));
    }
  }

  function keep(recipe: RecipeDetails) {
    setOpened((list) => [...list.filter((r) => recipeKey(r.recipe_name) !== recipeKey(recipe.recipe_name)), recipe].slice(-8));
  }

  /** An action's outcome on the table. `via`: Rachel's tool, or the user's own button. */
  function apply(outcome: Outcome, via: 'tool' | 'button') {
    const current = viewRef.current;
    // A reply overtaken by a newer one keeps its words (they are still said), never
    // its screen: no card, no recipe, no clearing over what came after it.
    if (current && outcome.view.seq < current.seq) {
      if (outcome.notice) setNotice(outcome.notice);
      return;
    }
    setView({ ...outcome.view, shelf: parseShelf(outcome.view.shelf) });
    const food = outcome.view.nutrition?.product_name ?? '';
    if (outcome.kind === 'cleared') {
      setRecipeView(closed(recipeViewRef.current));
      setCook(unstarted());
      setOpened([]);
    }
    // A new card is what the user just asked for: it comes forward, even over an open recipe.
    if (outcome.card && recipeViewRef.current.selected) {
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
    if (outcome.card) void call('/act', { command: 'prepare' }).then((done) => apply(done, 'button'), () => {});
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
      if (!(err instanceof Superseded)) setNotice("That didn't go through. Ask again in a moment.");
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

  // The host's words over the video: off by default, since the chat carries them.
  const cc = useCaptionToggle(ID, false);

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
  const takesFiles = live && avatar.filesAccepted;

  // Every call sets a fresh table, while Rachel is on her way. A call that
  // ends or fails takes its pending work with it: what it started is dropped
  // when it answers, and nothing it left half done carries over.
  useEffect(() => {
    if (avatar.phase === 'ended' || avatar.phase === 'failed') {
      generation.current += 1;
      setWorking([]);
      setShared([]);
      if (recipeViewRef.current.loading) setRecipeView(failed(recipeViewRef.current, recipeViewRef.current.requestId));
      return;
    }
    if (avatar.phase !== 'starting') return;
    const mine = ++generation.current;
    visit.current = null;
    setView(null);
    // The new call starts from an empty table, not the last call's board.
    avatar.state(boardState({ seq: 0, nutrition: null, shelf: EMPTY_SHELF, prepared: [] }));
    setRecipeView(closed(recipeViewRef.current));
    setCook(unstarted());
    setWorking([]);
    setShared([]);
    setNotice(null);
    setConcern(null);
    setOpened([]);
    for (const note of NOTES) avatar.note(note);
    post<{ id: string; view: View; opening: string }>('/visits')
      .then(({ id, view: first, opening }) => {
        // Only the newest call's table: one set for a call that failed and was placed again can answer last.
        if (mine !== generation.current) return;
        visit.current = id;
        setView({ ...first, shelf: parseShelf(first.shelf) });
        avatar.event(opening, 60);
      })
      .catch((err) => {
        if (mine !== generation.current) return;
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

  // The tapped recipe's deadline, keyed on its ticket so a newer tap restarts
  // the clock, and only while the call is on: hanging up clears it.
  const callOn = avatar.phase !== 'ended' && avatar.phase !== 'failed';
  useEffect(() => {
    if (!recipeView.loading || !callOn) return;
    const ticket = recipeView.requestId;
    const timer = setTimeout(() => setRecipeView(timedOut(recipeViewRef.current, ticket)), RECIPE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [recipeView.loading, recipeView.requestId, callOn]);

  const didNotGoThrough = (err: unknown) => {
    if (err instanceof Superseded) return;
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
      if (err instanceof Superseded) return;
      setRecipeView(failed(recipeViewRef.current, ticket.requestId));
      didNotGoThrough(err);
    }
  }

  function nextPressed() {
    const label = cookRef.current.shown ? 'Next steps' : 'Start the steps';
    avatar.event(pressed(label, stepOn()), 30);
  }

  /**
   * Photos read by the app's own reader, all at once (the server reads them in
   * turn), each card on the table as it comes. One line on the table for them
   * all, showing the first. The outcomes that came back, in the order they did.
   */
  async function readPhotos(files: File[], mine: number): Promise<Outcome[]> {
    const pictures = await Promise.all(files.map((file) => imageFrom(file).catch((err): null => {
      if (mine === generation.current) setNotice(`That photo couldn't be opened: ${reasonFrom(err, 'try a JPEG or PNG')}.`);
      return null;
    })));
    const images = pictures.filter((image): image is Picked => image !== null);
    if (!images.length || mine !== generation.current) return [];
    const label = images.length > 1 ? `reading your ${images.length} photos` : 'reading your photo';
    const work = { id: ++workId.current, label, preview: images[0].preview };
    setWorking((w) => [...w, work]);
    const read: Outcome[] = [];
    try {
      await Promise.all(images.map(async (image) => {
        try {
          const done = await call('/act', { command: 'photo', image: { mimeType: image.mimeType, base64: image.base64 } }, null, undefined, mine);
          apply(done, 'button');
          read.push(done);
        } catch (err) {
          didNotGoThrough(err);
        }
      }));
    } finally {
      if (mine === generation.current) setWorking((w) => w.filter((x) => x.id !== work.id));
    }
    return read;
  }

  /** One photo, read by the app alone, and Rachel told what it found. */
  async function addPhoto(file: File) {
    if (!visit.current) return;
    setNotice(null);
    const [done] = await readPhotos([file], generation.current);
    if (done?.text) avatar.event(done.text, 45);
  }

  /** The words for a drop's files Rachel could not read. */
  const refusedWords = (refused: FileOutcome[]) =>
    `Not read by ${HOST}: ${refused.map((file) => `${file.name} (${REFUSED_WORDS[file.reason ?? ''] ?? REFUSED_WORDS.failed})`).join(', ')}.`;

  /**
   * Photos and files the user adds or drops. While Rachel takes files, every
   * one goes to her in one drop: she sees them, and reacts to the drop once
   * on her own. The photos go to the app's own reader as well, which makes
   * their cards; once both are done she is told what the app made of them, in
   * one event and after her own reaction. A menu or a food log goes to her
   * alone. When she takes no files, the first photo is read as it always was.
   */
  async function addFiles(files: File[]) {
    if (!visit.current || !files.length) return;
    if (!(avatar.phase === 'live' && avatar.filesAccepted)) return void addPhoto(files[0]);
    if (files.length > MAX_FILES) return void setNotice(`At most ${MAX_FILES} files at a time.`);
    const mine = generation.current;
    const drop = ++drops.current;
    // Still this call's newest drop: only it shows on the table.
    const showing = () => mine === generation.current && drop === drops.current;
    const photos = files.filter((file) => file.type.startsWith('image/'));
    setNotice(null);
    setShared(files.map((file) => ({ name: file.name, status: 'sending' })));
    const onStatus = ({ index, status, reason }: FileProgress) => {
      if (showing()) setShared((now) => now.map((file, i) => (i === index ? { ...file, status, ...(reason ? { reason } : {}) } : file)));
    };
    const sent = avatar.sendFiles(files, { onStatus }).then(
      (outcome) => {
        if (!showing()) return outcome;
        setShared([]);
        const refused = outcome.filter((file) => file.status === 'refused');
        if (refused.length) setNotice(refusedWords(refused));
        return outcome;
      },
      (err): null => {
        if (showing()) {
          setShared([]);
          setNotice(err instanceof FileError && err.code === 'files_unsupported' ? `${HOST} can't take files in this call.` : "The files couldn't be sent. Try again.");
        }
        return null;
      },
    );
    const [read, outcome] = await Promise.all([readPhotos(photos, mine), sent]);
    if (mine !== generation.current) return;
    // Whether she saw the photos herself decides what she is told: their cards, not their arrival.
    const seen = Boolean(outcome?.some((file, i) => file.status === 'ready' && files[i].type.startsWith('image/')));
    const told = photosTold(read, photos.length, seen);
    if (told) avatar.event(told, 45);
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
        <BackToApps avatar={avatar} name={HOST} /><Logo />
        <div className="ms-top-actions">
          <button type="button" className="ms-tool" onClick={() => picker.current?.click()} disabled={!ready}>
            <CameraIcon /><span>{takesFiles ? 'Add a photo or file' : 'Add a photo'}</span>
          </button>
          <button type="button" className="ms-tool" onClick={() => downloadNotes(shelf, opened, HOST)} disabled={!anything}>
            <DownloadIcon /><span>Save notes</span>
          </button>
        </div>
        <input
          ref={picker} type="file" accept={takesFiles ? FILE_TYPES : 'image/*'} multiple={takesFiles} hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void addFiles(files);
          }}
        />
      </header>

      <main className="ms-main">
        <div className="ms-side">
          <aside className="ms-host" aria-label={`${HOST}, your nutritionist`}>
            {/* Rachel's face fills the frame while the call connects, instead of a dark box. */}
            <HostVideo avatar={avatar} captions={cc.on} onToggleCaptions={cc.toggle} name={HOST} poster={portrait} className="ms-host-video">
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
              host={HOST} ready={ready} connecting={!live} takesFiles={takesFiles} files={shared} view={view} recipeView={recipeView} cook={cook}
              working={working} notice={notice} concern={concern}
              onQuickPick={(food) => void quickPick(food)}
              onIdea={(idea: RecipeIdea) => void tapRecipe(idea)}
              onOpenKept={(name) => void tapRecipe({ name, description: '' })}
              onBack={() => void closeRecipe()}
              onNext={nextPressed}
              onPickStep={(step) => setCook(pick(step, recipeViewRef.current.details?.preparation_steps.length ?? 0))}
              onRetryRecipe={() => { const chosen = recipeViewRef.current.selected; if (chosen) void tapRecipe(chosen); }}
              onChoosePhoto={() => picker.current?.click()}
              onFiles={(files) => void addFiles(files)}
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
