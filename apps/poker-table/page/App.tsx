// Blindside: heads-up hold'em against Dex. Dex calls the table's tools (the
// player's move, a deal, a rematch, their cards, the rankings chart) and
// speaks from the results. The page answers those calls by asking the server
// that owns the cards, plays Dex's own turns through the server's decider,
// keeps Dex's picture of the table current, and tells him about buttons.
//
// The page also keeps the player's words, each tagged with the table as it
// stood when it was said: the server plays a move only when those words
// contain it, so an invented move never lands and a bet never lands twice.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CallControls, ChatPanel, useAvatar, useToolNet, type ToolCall } from '../../../src/kit/index.ts';
import { HOST, pressed, RULES_NOTE, said, speak, tableState, type Line } from '../engine/director.ts';
import { mustDo } from '../engine/judge.ts';
import type { Heard, Intent, TableView } from '../engine/types.ts';
import { Controls, type Finished } from './Controls.tsx';
import { Felt } from './Felt.tsx';
import { HowToPlay } from './HowToPlay.tsx';
import { Lobby, Logo } from './Lobby.tsx';
import { isSoundMuted, primeAudio, setSoundMuted, sounds } from './sounds.ts';
import './blindside.css';

const API = '/api/apps/poker-table';
/** A beat before Dex acts, so the player sees their own move land first. */
const BEAT_MS = 700;
/** How long a move waits for the player's words to reach the page: a tool call can beat the transcript. */
const HEAR_WAIT_MS = 4000;
/** A recognised line reaches the page about this long after the words began; it speaks for the table as it was then. */
const SPOKEN_LAG_MS = 1500;
/** A turn of Dex's left unplayed this long (a failed request, a call that just came back) is played by the page. */
const STUCK_MS = 3000;

/** What the server answers for any action. */
interface Answer { view: TableView; changed: boolean; line?: Line; message?: string; unbacked?: boolean }
interface Done { text: string; changed: boolean; view: TableView | null }

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

/**
 * The move in Dex's call, read leniently: the words, or a near synonym of the
 * field; an amount given on its own is added to a bare raise. The table still
 * checks it against what the player said.
 */
export function moveWords(args: Record<string, unknown> | undefined): string {
  const a = args ?? {};
  const words = [a.words, a.move, a.text, a.action, a.said].find((v): v is string => typeof v === 'string' && v.trim() !== '') ?? '';
  const given = typeof a.amount === 'number' ? String(a.amount) : typeof a.amount === 'string' ? a.amount.replace(/,/g, '').trim() : '';
  const amount = /^\d+$/.test(given) ? given : '';
  return amount && !/\d/.test(words) && /\b(raise|bet)\b/i.test(words) ? `${words.trim()} to ${amount}` : words.trim();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(ready: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (!ready() && Date.now() < end) await sleep(100);
}

export function App() {
  const [view, setView] = useState<TableView | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [history, setHistory] = useState<Finished[]>([]);
  const [muted, setMuted] = useState(() => isSoundMuted());
  const [kick, setKick] = useState(0);
  const tableId = useRef<string | null>(null);
  const viewRef = useRef<TableView | null>(null);
  const seqLog = useRef<{ seq: number; at: number }[]>([]);
  const heard = useRef<(Heard & { at: number })[]>([]);
  const heardCount = useRef(0);
  const answers = useRef(new Map<string, Promise<string>>());
  const dexPlaying = useRef(0);
  const hostMet = useRef(false);   // a call went live, so the opening has been said
  // Which call the page is on. It moves on when a call starts and when one
  // ends or fails: anything started for an older call (its table setup, a
  // move waiting for words, Dex's next turn, an event about a button) stops
  // when it answers, instead of acting on a call it was not for.
  const call = useRef(0);
  const rulesShown = useRef(false);
  rulesShown.current = rulesOpen;

  // The table as the server last answered it, for the table it is about. Seqs
  // only grow at one table; a late answer about an older state of it, or about
  // a table the player has left (a fresh match), is not drawn.
  const show = useCallback((table: string, next: TableView, note?: string) => {
    if (table !== tableId.current) return;
    const now = viewRef.current;
    if (now && next.seq < now.seq) return;
    viewRef.current = next;
    const log = seqLog.current;
    if (log[log.length - 1]?.seq !== next.seq) log.push({ seq: next.seq, at: Date.now() });
    if (log.length > 200) log.splice(0, log.length - 200);
    setView(next);
    setMessage(note ?? '');
  }, []);

  /** The player's words, tagged with the table's seq when they were said. */
  const hear = (text: string, how: 'spoken' | 'typed') => {
    const now = Date.now();
    const at = now - (how === 'spoken' ? SPOKEN_LAG_MS : 0);
    const log = seqLog.current;
    let seq = -1;
    for (let i = log.length - 1; i >= 0; i--) if (log[i].at <= at) { seq = log[i].seq; break; }
    heard.current = [...heard.current.filter((h) => now - h.at < 90_000).slice(-11), { text, seq, at: now }];
    heardCount.current += 1;
  };
  const heardSoFar = (): Heard[] => heard.current.map(({ text, seq }) => ({ text, seq }));

  /** Dex's turns while the action is his: each a server decision, drawn as it lands. */
  const dexTurns = useCallback(async (): Promise<Line[]> => {
    const lines: Line[] = [];
    const mine = call.current;
    dexPlaying.current += 1;
    try {
      for (let i = 0; i < 4; i++) {
        const id = tableId.current;
        const v = viewRef.current;
        if (!id || !v || v.phase !== 'playing' || v.action_to !== 'agent') break;
        await sleep(BEAT_MS);
        // A hang-up during the beat leaves his turn for the next call (the stuck-turn check plays it then).
        if (call.current !== mine || tableId.current !== id) break;
        const res = await post<Answer>(`/tables/${id}/opponent`, { again: lines.length > 0 }).catch((err) => {
          setKick((k) => k + 1);   // the stuck-turn check tries again
          throw err;
        });
        show(id, res.view);
        if (call.current !== mine || tableId.current !== id) break;
        if (!res.line) break;   // not his turn after all, or another request played it
        lines.push(res.line);
      }
    } finally {
      dexPlaying.current -= 1;
    }
    return lines;
  }, [show]);

  /** The player's move, as Dex heard it: played only if their own words carry it. */
  const playMove = async (id: string, words: string): Promise<Done> => {
    const mine = call.current;
    const started = Date.now();
    let res = await post<Answer>(`/tables/${id}/move`, { words, heard: heardSoFar() });
    while (res.unbacked && Date.now() - started < HEAR_WAIT_MS) {
      const seen = heardCount.current;
      await until(() => heardCount.current > seen || call.current !== mine, HEAR_WAIT_MS - (Date.now() - started));
      // Words that arrive after the call ended speak for no call: nothing is played.
      if (call.current !== mine) return { text: 'Not played. The call ended before the move could be checked.', changed: false, view: viewRef.current };
      if (heardCount.current === seen) break;
      res = await post<Answer>(`/tables/${id}/move`, { words, heard: heardSoFar() });
    }
    show(id, res.view, res.message);
    const more = res.changed ? await dexTurns().catch(() => []) : [];
    return { text: speak([res.line, ...more]), changed: res.changed, view: res.view };
  };

  /** One of Dex's tools, run the way his call runs it (the safety net runs them the same way). */
  const act = async ({ name, arguments: args }: ToolCall): Promise<Done> => {
    if (name === 'show_hand_rankings') {
      const already = rulesShown.current;
      rulesShown.current = true;
      setRulesOpen(true);
      return { text: speak([said.rankings()]), changed: !already, view: viewRef.current };
    }
    const id = tableId.current;
    if (!id) throw new Error('the cards are still being shuffled; try again in a moment');
    if (name === 'play_move') return playMove(id, moveWords(args));
    const res = await post<Answer>(`/tables/${id}/tool`, { name });
    show(id, res.view, res.message);
    const more = res.changed ? await dexTurns().catch(() => []) : [];
    return { text: speak([res.line, ...more]), changed: res.changed, view: res.view };
  };
  const actRef = useRef(act);
  actRef.current = act;

  // Dex's tool calls. The same call delivered twice is answered once.
  const onToolCall = useCallback((call: ToolCall): Promise<string> => {
    let answer = answers.current.get(call.id);
    if (!answer) {
      answer = actRef.current(call).then((done) => done.text);
      answers.current.set(call.id, answer);
      if (answers.current.size > 100) answers.current.delete(answers.current.keys().next().value!);
    }
    return answer;
  }, []);

  // If Dex says "new hand!" without dealing it, the table deals and tells him.
  // Only for what is safe twice: never a move.
  const net = useToolNet({
    match: (text) => { const name = mustDo(text); return name ? { id: `net-${Date.now()}`, name, arguments: {} } : null; },
    run: async (call) => {
      const done = await actRef.current(call);
      // Already done another way (a button dealt it, the chart was open): nothing to tell him.
      if (call.name === 'read_my_cards' ? done.view?.phase !== 'playing' : !done.changed) throw new Error(`${call.name}: nothing to do`);
      return done.text;
    },
    avatar: () => avatarRef.current!,
  });
  const avatar = useAvatar('poker-table', {
    onToolCall: net.watch(onToolCall),
    onUserSaid: (text, how) => { hear(text, how); net.heard(text); },
  });
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;
  const live = avatar.phase === 'live';

  // A button acts at once; Dex cannot see the screen, so he is told, with his own answer if it is his turn.
  async function press(intent: Intent, label: string) {
    const id = tableId.current;
    if (!id || busy) return;
    const mine = call.current;
    primeAudio();
    setBusy(true);
    try {
      if (intent.kind === 'deal' || intent.kind === 'restart') {
        // A deal by button counts as the deal the player asked for out loud.
        void net.watch(async () => '')({ id: `button-${Date.now()}`, name: intent.kind === 'deal' ? 'deal_hand' : 'new_match', arguments: {} });
      }
      const res = await post<Answer>(`/tables/${id}/act`, { intent });
      show(id, res.view, res.message);
      if (!res.changed) return;
      const more = await dexTurns().catch(() => []);
      // Dex hears about the press only on the call it was made in.
      if (call.current === mine) avatar.event(pressed(label, speak([res.line, ...more])), 30);
    } catch (err) {
      console.warn(err);
      setMessage('That didn’t reach the table. Try again.');
    } finally {
      setBusy(false);
    }
  }

  // The table is dealt while Dex is on his way. A later call at the same table carries on.
  useEffect(() => {
    if (avatar.phase === 'live') hostMet.current = true;
    if (avatar.phase === 'ended' || avatar.phase === 'failed') call.current += 1;
    if (avatar.phase !== 'starting') return;
    // A new call starts from the table on screen, and from nothing the last one heard or answered.
    const mine = ++call.current;
    heard.current = [];
    answers.current.clear();
    avatar.note(RULES_NOTE);
    const now = viewRef.current;
    if (tableId.current && now) {
      // A call that never went live still has the opening waiting to be said.
      if (hostMet.current) avatar.event(speak([said.resume(now)]), 60);
      return;
    }
    void post<{ id: string; view: TableView; opening: string }>('/tables').then(({ id, view: first, opening }) => {
      // Set up for a call that has since failed or been placed again: the newer call has its own.
      if (mine !== call.current) return;
      tableId.current = id;
      viewRef.current = null;
      seqLog.current = [];
      heard.current = [];
      show(id, first);
      avatar.event(opening, 60);
    }).catch((err) => {
      console.warn(err);
      if (mine === call.current) setMessage('The table could not be set up. End the call and try again in a moment.');
    });
  }, [avatar.phase]);

  // Dex's picture of the table follows the table.
  useEffect(() => { if (view) avatar.state(tableState(view)); }, [view]);

  // A turn of Dex's that nothing is playing (a request failed, or the call came back mid-hand).
  useEffect(() => {
    if (!view || !live || view.phase !== 'playing' || view.action_to !== 'agent') return;
    const seq = view.seq;
    const timer = setTimeout(() => {
      const now = viewRef.current;
      if (dexPlaying.current > 0 || now?.seq !== seq || now.action_to !== 'agent') return;
      const mine = call.current;
      void dexTurns().then((lines) => { if (lines.length && mine === call.current) avatar.event(speak(lines), 30); }).catch((err) => console.warn(err));
    }, STUCK_MS);
    return () => clearTimeout(timer);
  }, [view, live, kick]);

  // The match's hands, for the summary at the end.
  useEffect(() => {
    if (!view) return;
    const played = view.session.hands_played;
    setHistory((h) => {
      if (played < h.length) return [];
      if (view.winner && view.phase !== 'playing' && played > h.length) return [...h, { hand: played, winner: view.winner }];
      return h;
    });
  }, [view]);

  useTableSounds(view);

  const closeRules = useCallback(() => setRulesOpen(false), []);
  const toggleSound = () => {
    const next = !muted;
    setMuted(next);
    setSoundMuted(next);
    if (!next) { primeAudio(); sounds.buttonTap(); }
  };
  const fresh = () => {
    tableId.current = null;   // answers about the old table are no longer drawn (show)
    viewRef.current = null;
    hostMet.current = false;
    setView(null);
    setHistory([]);
    setMessage('');
    void avatar.start({ mic: avatar.micOn });
  };

  if (avatar.phase === 'idle') return <Lobby onPlay={(mic) => void avatar.start({ mic })} />;

  const hand = view ? view.session.hands_played + (view.phase === 'playing' ? 1 : 0) : 0;
  const up = view?.session.chips_up_user ?? 0;
  const left = live && avatar.secondsLeft !== null && avatar.secondsLeft < 180 ? avatar.secondsLeft : null;

  return (
    <div className="bs-app">
      <header className="bs-top">
        <Logo />
        {view && hand > 0 && (
          <p className="bs-match">
            <span>Hand <b>{hand}</b></span>
            <span className={up > 0 ? 'is-up' : up < 0 ? 'is-down' : ''}>
              You <b>{up > 0 ? '+' : up < 0 ? '−' : '±'}{Math.abs(up).toLocaleString('en-US')}</b>
            </span>
          </p>
        )}
        <div className="bs-tools">
          {left !== null && <span className="bs-clock" role="timer">Table closes in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>}
          <button type="button" className="bs-tool" onClick={() => setRulesOpen(true)}>Rules</button>
          <button type="button" className="bs-icon-btn" onClick={toggleSound} aria-pressed={!muted} aria-label={muted ? 'Turn table sounds on' : 'Turn table sounds off'} title={muted ? 'Table sounds off' : 'Table sounds on'}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11 5 6 9H3v6h3l5 4z" />
              {muted ? <path d="M22 9l-6 6M16 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
            </svg>
          </button>
          <CallControls avatar={avatar} className="bs-call" />
        </div>
      </header>

      <main className="bs-main">
        <section className="bs-stage" aria-label="The table">
          <Felt view={view} avatar={avatar} message={message} />
        </section>

        <aside className="bs-side">
          <Controls
            view={view} phase={avatar.phase} detail={avatar.detail} busy={busy} history={history}
            onMove={(intent, label) => void press(intent, label)}
            onCallAgain={() => void avatar.start({ mic: avatar.micOn })}
            onFresh={fresh}
          />
          <section className="bs-talk" aria-label={`Table talk with ${HOST}`}>
            <h2 className="bs-talk-head">Table talk</h2>
            <ChatPanel
              avatar={avatar} name={HOST} className="bs-chat" placeholder="Type a move (“raise to 60”) or a word for Dex…"
              empty={<>Say your move out loud, type it here, or tap it above.</>}
            />
          </section>
        </aside>
      </main>

      {rulesOpen && <HowToPlay onClose={closeRules} />}
    </div>
  );
}

/** The table's sounds, from what changed between two views. They are off until the player turns them on. */
export function useTableSounds(view: TableView | null) {
  const prevRef = useRef<TableView | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = (ms: number, play: () => void) => {
    const id = setTimeout(() => { timers.current.delete(id); play(); }, ms);
    timers.current.add(id);
  };
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = view;
    if (!view || !prev || view.seq === prev.seq) return;
    const action = view.last_action;
    if (action && JSON.stringify(action) !== JSON.stringify(prev.last_action)) {
      if (action.kind === 'deal') sounds.deal();
      else if (action.kind === 'fold') sounds.fold();
      else if (action.kind === 'check') sounds.check();
      else if (action.kind === 'call') sounds.call();
      else if (action.kind === 'raise') (prev.current_bet === 0 ? sounds.bet : sounds.raise)();
    }
    if (view.board.length > prev.board.length) {
      const delay = action?.kind === 'fold' ? 80 : 280;
      for (let i = 0; i < Math.min(3, view.board.length - prev.board.length); i++) later(delay + i * 140, () => sounds.cardFlip());
    }
    // A chopped pot is nobody's win or loss.
    if (view.winner && !prev.winner) {
      const who = view.winner.who;
      later(400, () => (who === 'user' ? sounds.win() : who === 'agent' ? sounds.lose() : sounds.chip()));
    }
  }, [view]);
}
