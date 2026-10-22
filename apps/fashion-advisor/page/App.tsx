// Fashion Advisor: the avatar styles; the server's stylist owns the photo, the
// read, the pieces and the try-ons. Every action has a control on the board;
// the same actions typed or spoken go through the server's judge first. The
// page keeps the avatar's state in step with the board and passes outcomes on
// as events, so the avatar never claims a try-on or a score the app has not
// produced.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AvatarStage, Composer, Transcript, useAvatar } from '../../../src/kit/index.ts';
import { boardState, NOTES } from '../engine/director.ts';
import { CURRENT_LOOK_LABEL } from '../engine/items.ts';
import { consumes, extractTryOnOffer } from '../engine/judge.ts';
import { STYLE_CHIPS } from '../engine/style.ts';
import type { Command, Outcome, SayEvent, View } from '../engine/types.ts';
import { FashionPanel, type FashionImage } from './FashionPanel.tsx';
import { Onboarding, PhotoDrop } from './Onboarding.tsx';
import { preparePhoto } from './photo.ts';
import sampleUrl from './sample-outfit.jpg';
import './fashion.css';

const API = '/api/apps/fashion-advisor';
/** How long the avatar's offer of a piece stands for a bare "yes" (the original's 30 s). */
const OFFER_TTL_MS = 30_000;

type From = 'spoken' | 'typed' | 'button';

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

/** What the image stage shows: a try-on being rendered over the last image, the image on screen, or the photo just dropped. */
function stageImage(view: View | null, preview: string | null): FashionImage | null {
  if (preview) return { status: 'result', item: CURRENT_LOOK_LABEL, image_url: preview };
  if (!view) return null;
  if (view.jobs.tryOn) return { status: 'loading', item: view.jobs.tryOn, previous_image_url: view.image?.url };
  if (view.image) return { status: 'result', item: view.image.item, image_url: view.image.url, shop_links: view.image.shop_links };
  return null;
}

export function App() {
  const [view, setView] = useState<View | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [ready, setReady] = useState('');        // "<item> is ready." for a moment after a try-on lands
  const [picking, setPicking] = useState(false); // the target picker on the toolbar
  const studio = useRef<string | null>(null);
  const rev = useRef(-1);
  const offer = useRef<{ item: string; at: number } | null>(null);

  const avatar = useAvatar('fashion-advisor', {
    // The avatar hears the user too and answers at once; the app judges the
    // same words and acts, and the outcome follows as an event.
    onUserSaid: (text, how) => { if (how === 'spoken') void hear(text, 'spoken'); },
    // An offer the avatar makes on its own ("want to try the navy blazer?"), so a bare "yes" can act on it.
    onAvatarSaid: (text) => {
      const item = extractTryOnOffer(text);
      if (item) offer.current = { item, at: Date.now() };
    },
  });
  const live = avatar.phase === 'live';

  const apply = useCallback((v: View) => {
    if (v.rev < rev.current) return;   // an answer that overtook a newer one
    rev.current = v.rev;
    setView(v);
  }, []);

  const tell = useCallback((events: SayEvent[], from: From) => {
    for (const e of events) {
      // The avatar already answered a spoken request from its staged state; the acknowledgement would repeat it.
      if (e.ack && from === 'spoken') continue;
      avatar.event(e.text, e.ttl);
      if (e.offer) offer.current = { item: e.offer, at: Date.now() };
    }
  }, [avatar.event]);

  /** Follow a job through its milestones: each brings a newer board and, maybe, something to say. */
  async function follow(id: string, job: NonNullable<Outcome['job']>, command: Command, from: From) {
    for (const milestone of job.milestones) {
      const out = await call<Outcome>(`/studios/${id}/jobs/${job.id}/${milestone}`).catch(() => null);
      if (id !== studio.current) return;   // that session is over
      if (milestone === 'image' && command.type === 'photo') setPreview(null);
      if (!out) return;
      apply(out.view);
      tell(out.events, from);
      if (milestone === 'image' && command.type === 'tryOn' && out.view.image?.kind === 'tryon') {
        setReady(`${out.view.image.item} is ready.`);
        setTimeout(() => setReady(''), 2200);
      }
    }
  }

  async function run(command: Command, from: From): Promise<Outcome | null> {
    const id = studio.current;
    if (!id) return null;
    try {
      const out = await call<Outcome>(`/studios/${id}/act`, { command });
      if (id !== studio.current) return null;
      apply(out.view);
      tell(out.events, from);
      if (out.job) void follow(id, out.job, command, from);
      else if (command.type === 'photo') setPreview(null);
      return out;
    } catch (err) {
      console.warn('[fashion-advisor]', err);
      if (command.type === 'photo') setPreview(null);
      return null;
    }
  }

  /** A typed or spoken line: judged first; an app action is done, anything else is the avatar's to answer. */
  async function hear(text: string, from: 'spoken' | 'typed') {
    const id = studio.current;
    if (!id) {
      if (from === 'typed') avatar.say(text);
      return;
    }
    const pending = offer.current && Date.now() - offer.current.at < OFFER_TTL_MS ? offer.current.item : null;
    const verdict = await call<{ command: Command | null; clearOffer?: boolean }>(`/studios/${id}/judge`, { text, offer: pending }).catch(() => ({ command: null } as { command: Command | null; clearOffer?: boolean }));
    if (verdict.clearOffer || verdict.command?.type === 'tryOn') offer.current = null;
    const { command } = verdict;
    if (from === 'typed') {
      if (consumes(command)) {
        avatar.record(text);
        await run(command!, 'typed');
      } else {
        // Its state first (a described outfit, a question now closed), then the line itself, so the answer knows.
        const out = command ? await run(command, 'typed') : null;
        if (out) avatar.state(boardState(out.view));
        avatar.say(text);
      }
    } else if (command) {
      await run(command, 'spoken');
    }
  }

  async function sendPhoto(file: Blob, source: 'upload' | 'sample') {
    setPhotoError('');
    try {
      const photo = await preparePhoto(file);
      setPreview(photo.preview);
      await run({ type: 'photo', mime: photo.mime, data: photo.data, source }, 'button');
    } catch (err) {
      setPreview(null);
      setPhotoError((err as Error).message);
    }
  }
  const sendSample = () => void fetch(sampleUrl).then((r) => r.blob()).then((blob) => sendPhoto(blob, 'sample'));
  const press = (command: Command) => void run(command, 'button');

  // Each session gets its own studio, set up while the avatar is on its way (the rules, then the opening).
  useEffect(() => {
    if (avatar.phase !== 'starting') return;
    studio.current = null;
    offer.current = null;
    for (const note of NOTES) avatar.note(note);
    void call<{ id: string; outcome: Outcome }>('/studios', {}).then(({ id, outcome }) => {
      studio.current = id;
      rev.current = -1;
      apply(outcome.view);
      tell(outcome.events, 'button');
    }).catch((err) => console.warn('[fashion-advisor] could not open a studio', err));
  }, [avatar.phase]);

  // A dropped photo's local preview is let go once it is replaced.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // The avatar's picture of the board follows the board.
  useEffect(() => { if (view) avatar.state(boardState(view)); }, [view]);

  // Catalogue shots land in the background: look again while some are still rendering.
  useEffect(() => {
    const id = studio.current;
    if (!id || !view?.thumbnailsPending) return;
    const timer = setTimeout(() => { void call<{ view: View }>(`/studios/${id}`).then((r) => { if (id === studio.current) apply(r.view); }).catch(() => {}); }, 2500);
    return () => clearTimeout(timer);
  }, [view]);

  const busy = !live || !view;
  const jobs = view?.jobs;
  const statusText = jobs?.tryOn
    ? `Generating ${jobs.tryOn}...${jobs.queued.length ? ` Then ${jobs.queued.join(', ')}.` : ''}`
    : jobs?.queued.length ? `Queued ${jobs.queued.join(', ')}...`
      : ready || (view?.notice?.text ?? '');
  const onboarding = <Onboarding view={view} live={live} busy={busy} onCommand={press} onFile={(f) => void sendPhoto(f, 'upload')} onSample={sendSample} />;
  const hasPhoto = view?.photo === 'present' || Boolean(preview);

  return (
    <div className="kit-layout fashion-page">
      <div className="kit-side">
        <AvatarStage
          avatar={avatar}
          name="Your stylist"
          startLabel="Start styling"
          lobby={<><div className="kit-title">Fashion Advisor</div><div className="kit-detail">Tell your stylist the look you want, share one photo of your outfit, and get a rating, pieces to try, and try-ons on your own photo.</div></>}
        />
        <Composer avatar={avatar} placeholder='Type, or try "rate me for a wedding instead"…' onSubmit={(t) => { void hear(t, 'typed'); }} />
        <Transcript avatar={avatar} names={{ avatar: 'Stylist' }} />
      </div>

      <main className="fashion-app">
        <header className="fashion-app-header">
          <div>
            <span className="fashion-image-kicker">Fashion Advisor</span>
            <h1 className="fashion-app-title">{view?.name ? `Styling ${view.name}` : 'Your look'}</h1>
          </div>
          {view?.target && (
            <button type="button" className="fashion-target" disabled={busy} onClick={() => setPicking((p) => !p)} title="Change the look you are going for">
              For <strong>{view.target}</strong> <span aria-hidden="true">✎</span>
            </button>
          )}
        </header>

        {picking && view?.target && (
          <TargetPicker
            current={view.target}
            onPick={(style) => { setPicking(false); press({ type: view.photo === 'present' ? 'retarget' : 'style', style }); }}
            onClose={() => setPicking(false)}
          />
        )}

        {hasPhoto && view?.step === 'styling' && (
          <div className="fashion-toolbar">
            <button type="button" className="fashion-upload" disabled={busy || Boolean(jobs?.analysing)} onClick={() => press({ type: 'rerate' })}>Rate it again</button>
            <button type="button" className="fashion-upload" disabled={busy || Boolean(jobs?.more) || !view.canLoadMore} onClick={() => press({ type: 'more' })}>More ideas</button>
            <button type="button" className="fashion-upload" disabled={busy} onClick={() => press({ type: 'retake' })}>New photo</button>
          </div>
        )}

        {view?.wantsPhoto && hasPhoto && (
          <PhotoDrop onFile={(f) => void sendPhoto(f, 'upload')} onSample={sendSample} disabled={busy} compact label="Drop the new photo here, or upload it." />
        )}
        {photoError && <p className="fashion-upload__error" role="alert">{photoError}</p>}
        {!photoError && !view?.analysis && view?.notice?.kind === 'error' && <p className="fashion-upload__error" role="alert">{view.notice.text}</p>}

        <FashionPanel
          analysis={view?.analysis ?? null}
          analysisLoading={Boolean(jobs?.analysing || (jobs?.photo && view?.target))}
          fashionImage={stageImage(view, preview)}
          onTrySuggestion={(item, text) => press({ type: 'tryOn', item, text })}
          onLoadMoreSuggestions={(quiet) => press(quiet ? { type: 'more', quiet } : { type: 'more' })}
          tryOnStatusText={statusText}
          tryOnBusy={Boolean(jobs?.tryOn || jobs?.queued.length)}
          tryOnActiveItem={jobs?.tryOn ?? jobs?.queued[0] ?? ''}
          tryOnAvailable={view?.tryOnAvailable ?? false}
          canLoadMore={Boolean(view?.canLoadMore)}
          loadingMore={Boolean(jobs?.more)}
          onResetBaseImage={() => press({ type: 'reset' })}
          empty={onboarding}
          waiting={view && view.step !== 'styling' ? onboarding : (
            <div className="fashion-capture-cta">
              <p>{view?.notice?.text || 'The read of this photo did not come through.'}</p>
              <button type="button" className="fashion-upload" disabled={busy} onClick={() => press({ type: 'rerate' })}>Rate it again</button>
            </div>
          )}
        />
      </main>
    </div>
  );
}

function TargetPicker({ current, onPick, onClose }: { current: string; onPick: (style: string) => void; onClose: () => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="fashion-picker">
      <p className="fashion-capture-hint">Read it for something else. Now: <strong>{current}</strong></p>
      <div className="fashion-chips">
        {STYLE_CHIPS.filter((c) => c !== current).map((chip) => <button key={chip} type="button" className="fashion-chip" onClick={() => onPick(chip)}>{chip}</button>)}
      </div>
      <div className="fashion-field">
        <input className="kit-input" placeholder="Or type a style or occasion" value={value} maxLength={80} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) onPick(value.trim()); if (e.key === 'Escape') onClose(); }} />
        <button type="button" className="kit-btn kit-primary" disabled={!value.trim()} onClick={() => onPick(value.trim())}>Read it</button>
      </div>
    </div>
  );
}
