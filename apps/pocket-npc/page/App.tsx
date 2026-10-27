// Pocket NPC: talk to Brannoc, the keeper of the Brass Kettle. The game draws
// him (Brannoc.tsx) and moves him from the voice as it plays; Atmee brings the
// voice and the conversation over a speech session (src/kit/useSpeech). His
// tools run here, against the game's state (engine/tavern.ts): a sale takes
// the player's silver, a quest is pinned to their log, and he beams.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackToApps, END_WORDS, ToolReply, credits, minutes, useSpeech, type Speech, type SpeechLine, type ToolRun } from '../../../src/kit/index.ts';
import { QUESTS, Tavern, type Result } from '../engine/tavern.ts';
import host from '../avatar.json';
import { Scene, type Mood } from './Brannoc.tsx';
import './pocket-npc.css';

const TOOL_NAMES = ['give_quest', 'sell_item', 'give_item', 'look_at_player'] as const;
const TOOL_WORDS: Record<string, string> = { give_quest: 'Gave a quest', sell_item: 'Sold', give_item: 'On the house', look_at_player: 'Sized you up' };
const TRY = ['What work is there for a traveller?', 'Tell me about the drowned bell.', 'I’ll take it. What will I need?', 'How much for the lantern?'];

export function App() {
  const tavern = useRef(new Tavern());
  const [, setVersion] = useState(0);
  const [toast, setToast] = useState<Result['event'] | null>(null);
  const [pleasedUntil, setPleasedUntil] = useState(0);

  const run = useCallback((name: string, args: Record<string, unknown>) => {
    const result = tavern.current.run(name, args);
    if (result.event) {
      setToast(result.event);
      setPleasedUntil(Date.now() + 2500);
    }
    setVersion((v) => v + 1);
    return new ToolReply(result.text, result.ok);
  }, []);
  const tools = useMemo(() => Object.fromEntries(TOOL_NAMES.map((name) => [name, (args: Record<string, unknown>) => run(name, args)])), [run]);
  const talk = useSpeech('pocket-npc', { tools });
  const live = talk.phase === 'live';
  const busy = talk.phase === 'starting' || talk.phase === 'connecting';

  // His face: pleased for a moment after the game hands something over; otherwise what the call is doing.
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (pleasedUntil <= Date.now()) return; const id = setTimeout(() => setNow(Date.now()), pleasedUntil - Date.now()); return () => clearTimeout(id); }, [pleasedUntil]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 3200); return () => clearTimeout(id); }, [toast]);
  const mood: Mood = pleasedUntil > now ? 'pleased' : talk.speaking ? 'speaking' : talk.thinking ? 'thinking' : live ? 'listening' : 'idle';

  function enter() {
    tavern.current = new Tavern();
    setToast(null);
    setVersion((v) => v + 1);
    void talk.start();
  }

  const t = tavern.current;
  const said = lastLine(talk.lines, 'avatar');
  const heard = lastLine(talk.lines, 'user');
  return (
    <div className="npc">
      <header className="npc-top">
        <BackToApps avatar={talk} name={host.name} />
        <a className="npc-logo" href="#">Pocket NPC<small>The Brass Kettle</small></a>
        <span className="npc-way" title="Atmee voices the character and holds the conversation; the game draws him and owns the state">Speech-to-speech</span>
        {live && talk.secondsLeft !== null && <span className="npc-clock" aria-label="Time left">{minutes(talk.secondsLeft)}</span>}
      </header>

      <main className="npc-main">
        <section className="npc-stage" aria-label={`The Brass Kettle, with ${host.name}`}>
          <div className={`npc-frame is-${mood}`}>
            <Scene levels={talk.levels} mood={mood} />
            {live && said && <p className={`npc-bubble ${said.final ? '' : 'is-saying'}`} aria-live="polite">{said.text}</p>}
            {live && heard && <p className={`npc-you ${heard.final ? '' : 'is-saying'}`}><b>You</b>{heard.text}</p>}
            {toast && <p className={`npc-toast is-${toast.kind}`} role="status">{toast.kind === 'quest' ? 'New quest' : toast.kind === 'gift' ? 'On the house' : 'Bought'}: {toast.label}</p>}
            {talk.phase === 'idle' && <Lobby onEnter={enter} />}
            {(busy || talk.phase === 'failed') && (
              <div className="npc-overlay" role="status">
                {busy ? <><span className="npc-spin" aria-hidden="true" /><strong>{talk.phase === 'starting' ? 'Pushing open the door…' : 'Brannoc looks up…'}</strong></> : (
                  <><strong>The door won't open</strong><span role="alert">{talk.detail}</span><button type="button" className="npc-go" onClick={enter}>Try again</button></>
                )}
              </div>
            )}
            {live && talk.audioBlocked && <button type="button" className="npc-hear" onClick={talk.resumeAudio}>Tap to hear {host.name}</button>}
          </div>
          {live && <Controls talk={talk} mood={mood} />}
          {talk.phase === 'ended' && <Summary talk={talk} tavern={t} onAgain={enter} />}
        </section>

        <aside className="npc-side">
          <section className="npc-card npc-log" aria-label="Quest log">
            <h2>Quest log</h2>
            {t.quests.length ? t.quests.map((q) => (
              <article key={q.id} className="npc-quest"><h3>{q.title}</h3><p>{q.objective}</p><p><b>Start:</b> {q.start}. <b>Reward:</b> {q.reward}.</p></article>
            )) : <p className="npc-muted">Empty. The board by the door has {QUESTS.length} quests: ask Brannoc.</p>}
          </section>
          <section className="npc-card npc-pack" aria-label="Purse and pack">
            <h2>Purse &amp; pack</h2>
            <p className="npc-silver"><Coin /> {t.silver} silver</p>
            <ul>{t.pack.map((item, i) => <li key={`${item}-${i}`}>{item}</li>)}</ul>
          </section>
          <section className="npc-card npc-wares" aria-label="Brannoc's shelf">
            <h2>Brannoc's shelf</h2>
            <ul>{t.wares.map((w) => <li key={w.id} className={w.stock ? '' : 'is-gone'}><span>{w.name}</span><em>{w.price} s</em><small>×{w.stock}</small></li>)}</ul>
          </section>
          <UnderTheHood runs={talk.toolRuns} />
        </aside>
      </main>
    </div>
  );
}

function lastLine(lines: SpeechLine[], who: SpeechLine['who']) {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].who === who && !lines[i].backchannel) return lines[i];
  return null;
}

function Lobby({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="npc-overlay npc-lobby">
      <h1>The Brass Kettle</h1>
      <p>Rain on the reeds, a fire in the grate, and Brannoc behind the counter. Talk to him out loud: he's drawn by this game, and voiced, live, by Atmee.</p>
      <button type="button" className="npc-go" onClick={onEnter}>Talk to {host.name}</button>
      <small>Your browser will ask for the microphone (audio only). Try: {TRY.map((x) => `“${x}”`).join(' ')}</small>
    </div>
  );
}

function Controls({ talk, mood }: { talk: Speech; mood: Mood }) {
  const words: Record<Mood, string> = { idle: '', listening: talk.muted ? "You're muted" : 'Listening', speaking: `${host.name} is talking`, thinking: `${host.name} is thinking…`, pleased: `${host.name} is talking` };
  return (
    <div className="npc-controls">
      <span className={`npc-state is-${mood}`} role="status">{talk.ending ? 'Leaving…' : words[mood]}</span>
      <button type="button" className={`npc-btn ${talk.muted ? 'is-on' : ''}`} aria-pressed={talk.muted} disabled={talk.ending} onClick={() => talk.setMuted(!talk.muted)}>{talk.muted ? 'Unmute' : 'Mute'}</button>
      <button type="button" className="npc-btn npc-leave" disabled={talk.ending} onClick={() => void talk.end()}>{talk.ending ? 'Leaving…' : 'End'}</button>
    </div>
  );
}

function Summary({ talk, tavern, onAgain }: { talk: Speech; tavern: Tavern; onAgain: () => void }) {
  const sum = talk.summary;
  const status = sum?.status;
  return (
    <div className="npc-card npc-summary" role="status">
      <h2>{sum?.reason === 'ended' ? 'You step back out into the rain' : END_WORDS[sum?.reason ?? 'ended'] ?? 'The conversation ended'}</h2>
      <p>You leave with {tavern.silver} silver, {tavern.pack.join(', ')}{tavern.quests.length ? `, and ${tavern.quests.map((q) => q.title).join(' and ')} on your log` : ''}.</p>
      <dl>
        <div><dt>Talked</dt><dd>{minutes(sum?.seconds ?? 0)}</dd></div>
        <div><dt>Billed</dt><dd>{status?.billedSeconds != null ? minutes(status.billedSeconds) : sum?.settling ? 'Settling…' : '–'}</dd></div>
        <div><dt>Cost</dt><dd>{status?.chargedMicrocredits != null ? `${credits(status.chargedMicrocredits)} credits` : sum?.settling ? 'Settling…' : '–'}</dd></div>
      </dl>
      <button type="button" className="npc-go" onClick={onAgain}>Walk back in</button>
    </div>
  );
}

function UnderTheHood({ runs }: { runs: ToolRun[] }) {
  return (
    <section className="npc-card npc-hood" aria-label="How this works">
      <h2>Under the hood</h2>
      <ol>
        <li className="is-atmee"><b>Voice and conversation</b><span>Atmee's speech server, in the avatar's voice</span></li>
        <li className="is-game"><b>Who Brannoc is, the rules, the tools</b><span>pinned by the game's server</span></li>
        <li className="is-game"><b>His face</b><span>drawn by this page: mouth, brows and head follow the voice's level as it plays</span></li>
        <li className="is-game"><b>Silver, pack, quest log</b><span>this page: it runs each tool and answers with the result</span></li>
      </ol>
      {runs.length > 0 && (
        <ul className="npc-runs">{runs.slice(-5).map((r) => (
          <li key={r.id} className={r.ok === false ? 'is-refused' : ''}><b>{TOOL_WORDS[r.name] ?? r.name}</b><span>{r.output === undefined ? '…' : r.output.length > 140 ? `${r.output.slice(0, 137)}…` : r.output}</span></li>
        ))}</ul>
      )}
    </section>
  );
}

const Coin = () => <svg viewBox="0 0 20 20" aria-hidden="true" className="npc-coin"><circle cx="10" cy="10" r="8" /><circle cx="10" cy="10" r="5" fill="none" /></svg>;
