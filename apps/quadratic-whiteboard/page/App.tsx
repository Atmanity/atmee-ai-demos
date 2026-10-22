// Quadratic Whiteboard: the teacher drives the board; the avatar is the chalk
// hand that reads each line out. The server owns the board (the working the
// class has not seen never reaches this page) and judges every line the
// teacher says or types. The page draws the board, keeps the avatar's state in
// step with it, and passes on what happened as events.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AvatarStage, Composer, Transcript, useAvatar } from '../../../src/kit/index.ts';
import { boardState, NOTES } from '../engine/director.ts';
import type { Intent } from '../engine/table.ts';
import type { Outcome, View } from '../engine/types.ts';
import { BoardPanel } from './BoardPanel.tsx';
import './board.css';

const API = '/api/apps/quadratic-whiteboard';

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export function App() {
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const board = useRef<string | null>(null);
  const seen = useRef(-1);

  const avatar = useAvatar('quadratic-whiteboard', {
    // The avatar hears the teacher too and answers at once, from the state
    // (which stages the next line); the board moves when the line reaches the
    // server a second later.
    onUserSaid: (text, how) => {
      if (how === 'spoken') void act({ text, how: 'spoken' }, true);
    },
  });

  const show = useCallback((outcome: Outcome) => {
    // Replies can cross (a slow model reading, then a button): never go back to an older board.
    if (outcome.view.seq >= seen.current) {
      seen.current = outcome.view.seq;
      setView(outcome.view);
    }
    if (outcome.handled) setMessage(outcome.message ?? '');
    if (outcome.event) avatar.event(outcome.event, outcome.ttl ?? 25);
  }, [avatar.event]);

  async function act(body: Record<string, unknown>, quiet = false): Promise<Outcome | null> {
    if (!board.current) return null;
    if (!quiet) setBusy(true);
    try {
      const outcome = await post<Outcome>(`/boards/${board.current}/act`, body);
      show(outcome);
      return outcome;
    } catch (err) {
      console.warn(err);
      if (!quiet) setMessage('The board did not answer. Try again.');
      return null;
    } finally {
      if (!quiet) setBusy(false);
    }
  }

  // The board is set up while the avatar is on its way.
  useEffect(() => {
    if (avatar.phase !== 'starting' || board.current) return;
    for (const note of NOTES) avatar.note(note);
    post<{ id: string; outcome: Outcome }>('/boards')
      .then(({ id, outcome }) => {
        board.current = id;
        show(outcome);
      })
      .catch(() => setMessage('Could not set up the board. Is the app server running?'));
  }, [avatar.phase]);

  // The avatar's picture of the board follows the board.
  useEffect(() => {
    if (view) avatar.state(boardState(view));
  }, [view]);

  // A typed line is judged first; only what isn't a board request goes to the avatar.
  const onTyped = (text: string) => {
    void act({ text, how: 'typed' }).then((outcome) => {
      if (outcome?.handled) avatar.record(text);
      else avatar.say(text);
    });
  };

  const live = avatar.phase === 'live';

  return (
    <div className="kit-layout qw-app">
      <div className="kit-side">
        <AvatarStage
          avatar={avatar}
          name="Board"
          startLabel="Start the board"
          lobby={
            <>
              <div className="kit-title">Quadratic Whiteboard</div>
              <div className="kit-detail">
                Name a quadratic (“put up x squared minus four x plus three”), pick a method, and say “next” for each line. The avatar reads every line out; the buttons and the equation box do the same.
              </div>
            </>
          }
        />
        <Composer avatar={avatar} placeholder="Type “next”, an equation, or a question…" onSubmit={onTyped} />
        <Transcript avatar={avatar} names={{ avatar: 'Board', user: 'Teacher' }} />
      </div>
      <BoardPanel
        view={view}
        live={live}
        busy={busy}
        message={message}
        onIntent={(intent: Intent) => void act({ intent })}
        onEquation={async (equation) => {
          const outcome = await act({ equation });
          return Boolean(outcome && !outcome.message);
        }}
      />
    </div>
  );
}
