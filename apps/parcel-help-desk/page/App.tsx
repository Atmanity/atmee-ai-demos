// Waybill: a parcel help desk built the avatar-only way. Every turn goes to the
// app's own agent (POST /desks/:id/turn: its model, its tools over its own
// parcels, its voice); the answer's audio goes to Tess, who is only the face
// that says it (useAvatarOnly). Held-down speech is recorded here and heard by
// the app's own model. The page shows what each part took.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackToApps, decodeTo16k, fromBase64, joinPcm, toBase64, useAvatarOnly, useMicTap, wavFile } from '../../../src/kit/index.ts';
import tess from '../host/portrait.jpg';
import './waybill.css';

const API = '/api/apps/parcel-help-desk';
const HOST = 'Tess';

export interface ParcelView {
  tracking: string; recipient: string; from: string; to: string; status: string; statusWords: string;
  eta: string | null; events: { at: string; where: string; what: string }[];
  issue: string | null; claim: string | null; pickupPoint: string | null;
}
interface Step { name: string; args: Record<string, unknown>; ok: boolean }
interface Line { who: 'you' | 'tess'; text: string }
/** What a turn took: the app's ears, brain and voice, then the face starting to move. */
export interface Timings { hear?: number; think?: number; voice?: number; face?: number }

const TOOL_WORDS: Record<string, string> = {
  lookup_parcel: 'Looked up the parcel', reschedule_delivery: 'Booked a redelivery', send_to_pickup_point: 'Sent it to a pickup point',
  add_flat_number: 'Completed the address', open_claim: 'Opened a claim',
};

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.message || json.error || `${path}: ${res.status}`), { code: json.error });
  return json as T;
}

export function App() {
  const [desk, setDesk] = useState<string | null>(null);
  const [samples, setSamples] = useState<{ tracking: string; hint: string }[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [parcel, setParcel] = useState<ParcelView | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [timings, setTimings] = useState<Timings | null>(null);
  const [thinking, setThinking] = useState(false);
  const [problem, setProblem] = useState('');
  const [text, setText] = useState('');
  const face = useAvatarOnly('parcel-help-desk');
  const mic = useMicTap();
  const recording = useRef<Int16Array[]>([]);
  const turn = useRef(0);
  const live = face.phase === 'live';
  const say = (who: Line['who'], line: string) => setLines((l) => [...l, { who, text: line }]);

  // The agent's answer, voiced, goes to Tess; the face's part is how long until she starts saying it.
  const handedAt = useRef<number | null>(null);
  const speak = useCallback(async (clips: string[], base: Timings) => {
    const pieces = await Promise.all(clips.map((b64) => decodeTo16k(fromBase64(b64))));
    setTimings(base);
    handedAt.current = performance.now();
    // Handed over together: they go out in order and Tess says them back to back.
    await Promise.all(pieces.map((pcm) => face.say(pcm)));
  }, [face]);
  useEffect(() => {
    if (!face.speaking || handedAt.current === null) return;
    const took = Math.round(performance.now() - handedAt.current);
    handedAt.current = null;
    setTimings((t) => ({ ...t, face: took }));
  }, [face.speaking]);

  // Start: Tess's face (the render) and the app's desk (its agent, and the greeting voiced) together.
  const greeting = useRef<{ text: string; audio: string[]; timings: Timings } | null>(null);
  async function begin() {
    setProblem('');
    const opened = post<{ id: string; greeting: string; audio: string[]; samples: typeof samples; timings: Timings }>('/desks').catch((err) => err as Error);
    await face.start();
    const d = await opened;
    if (d instanceof Error) { setProblem(d.message); return; }
    greeting.current = { text: d.greeting, audio: d.audio, timings: d.timings };
    setDesk(d.id);
    setSamples(d.samples);
  }
  // Tess greets once her face is up and the desk is open.
  useEffect(() => {
    const hello = greeting.current;
    if (!live || !desk || !hello) return;
    greeting.current = null;
    say('tess', hello.text);
    void speak(hello.audio, hello.timings);
  }, [live, desk, speak]);

  async function ask(body: { text?: string; audio?: string }) {
    if (!desk || thinking) return;
    const mine = ++turn.current;
    if (body.text) say('you', body.text);
    setThinking(true);
    // A new question cuts Tess off, as it would at a desk.
    if (face.speaking) void face.interrupt();
    try {
      const r = await post<{ heard?: string; reply: string | null; steps?: Step[]; parcel?: ParcelView | null; audio?: string[]; timings: Timings }>(`/desks/${desk}/turn`, body);
      if (mine !== turn.current) return;
      if (body.audio) {
        if (!r.heard) { setProblem("Tess's ears didn't catch anything. Hold the button while you speak."); return; }
        say('you', r.heard);
      }
      if (!r.reply) return;
      say('tess', r.reply);
      setSteps(r.steps ?? []);
      if (r.parcel) setParcel(r.parcel);
      setThinking(false);
      if (r.audio) await speak(r.audio, r.timings);
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      if (mine === turn.current) setThinking(false);
    }
  }

  async function holdStart() {
    if (!live || thinking) return;
    setProblem('');
    recording.current = [];
    if (face.speaking) void face.interrupt();
    await mic.begin((pcm) => recording.current.push(pcm));
  }
  async function holdEnd() {
    // Always stopped: a press let go while the microphone was still starting must not start it.
    await mic.stop();
    const pcm = joinPcm(recording.current);
    recording.current = [];
    if (!pcm.length) return;
    if (pcm.length < 16_000 * 0.4) { setProblem('Hold the button while you speak, then let go.'); return; }
    await ask({ audio: toBase64(wavFile(pcm)) });
  }

  const transcript = useRef<HTMLOListElement>(null);
  // The newest line in view, inside the conversation's own box (the page itself stays put).
  useEffect(() => { const box = transcript.current; if (box) box.scrollTop = box.scrollHeight; }, [lines, thinking]);

  return (
    <div className="wb">
      <header className="wb-top">
        <BackToApps avatar={face} name={HOST} />
        <a className="wb-logo" href="#"><span className="wb-mark" aria-hidden="true" />Waybill<small>Help desk</small></a>
        <span className="wb-way" title="The app's own agent speaks; the avatar is its face">Avatar-only</span>
        {live && face.secondsLeft !== null && <span className="wb-clock">{Math.floor(face.secondsLeft / 60)}:{String(face.secondsLeft % 60).padStart(2, '0')}</span>}
      </header>

      <main className="wb-main">
        <section className="wb-desk" aria-label={`Talk with ${HOST}`}>
          <div className={`wb-face ${face.speaking ? 'is-speaking' : ''} ${live ? 'is-live' : ''}`}>
            <img className="wb-poster" src={tess} alt="" aria-hidden="true" />
            <video ref={face.videoRef} playsInline muted aria-label={`${HOST}'s video`} />
            <audio ref={face.audioRef} autoPlay />
            {face.phase === 'idle' && (
              <div className="wb-lobby">
                <h1>Where's my parcel?</h1>
                <p>Ask Tess about a delivery. Waybill's own agent answers: its model, its parcel records, its voice. Tess is the face it speaks through.</p>
                <button type="button" className="wb-start" onClick={() => void begin()}>Talk to Tess</button>
              </div>
            )}
            {(face.phase === 'starting' || face.phase === 'warming' || face.phase === 'connecting' || face.phase === 'arriving') && (
              <div className="wb-status" role="status"><span className="wb-spin" aria-hidden="true" />
                <strong>{face.phase === 'warming' ? 'Tess is getting ready' : face.phase === 'arriving' ? 'Tess is joining…' : 'Connecting…'}</strong>
                {face.detail && <span>{face.detail}</span>}
              </div>
            )}
            {(face.phase === 'failed' || face.phase === 'ended') && (
              <div className="wb-status" role="status">
                <strong>{face.phase === 'failed' ? "Couldn't reach Tess" : 'Chat ended'}</strong>
                {face.phase === 'failed' && <span>{face.detail}</span>}
                <button type="button" className="wb-start" onClick={() => { setDesk(null); setLines([]); setParcel(null); setSteps([]); setTimings(null); void begin(); }}>Start again</button>
              </div>
            )}
            {live && face.audioBlocked && <button type="button" className="wb-hear" onClick={face.resumeAudio}>Tap to hear Tess</button>}
          </div>

          <ol className="wb-lines" ref={transcript} aria-live="polite">
            {lines.map((l, i) => <li key={i} className={`wb-line is-${l.who}`}><b>{l.who === 'you' ? 'You' : HOST}</b>{l.text}</li>)}
            {thinking && <li className="wb-line is-tess is-thinking"><b>{HOST}</b><span className="wb-dots" aria-label="thinking"><i /><i /><i /></span></li>}
          </ol>

          <form className="wb-ask" onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (!t) return; setText(''); void ask({ text: t }); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={live ? 'Type your question, or hold the mic…' : 'Start the chat first'} disabled={!live} maxLength={500} aria-label="Your question" />
            <button type="submit" className="wb-send" disabled={!live || !text.trim() || thinking}>Send</button>
            <button
              type="button" className={`wb-mic ${mic.on ? 'is-on' : ''}`} disabled={!live || thinking}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); void holdStart(); }}
              onPointerUp={() => void holdEnd()} onPointerCancel={() => void holdEnd()}
              onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); void holdStart(); } }}
              onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); void holdEnd(); } }}
              aria-label="Hold to talk" title="Hold to talk"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
              {mic.on && <span className="wb-level" style={{ transform: `scaleY(${0.2 + mic.level * 0.8})` }} />}
            </button>
            {face.speaking && <button type="button" className="wb-stop" onClick={() => void face.interrupt()}>Stop</button>}
          </form>
          {(problem || mic.error) && <p className="wb-problem" role="alert">{problem || mic.error}</p>}
        </section>

        <aside className="wb-side">
          {parcel ? <ParcelCard parcel={parcel} /> : (
            <section className="wb-card wb-try">
              <h2>Try a tracking number</h2>
              <p>Five parcels, each with its own story. Say or type one:</p>
              <ul>{(samples.length ? samples : PLACEHOLDER).map((s) => (
                <li key={s.tracking}><button type="button" disabled={!live || thinking} onClick={() => void ask({ text: `My tracking number is ${s.tracking}` })}><code>{s.tracking}</code><span>{s.hint}</span></button></li>
              ))}</ul>
            </section>
          )}
          <UnderTheHood steps={steps} timings={timings} />
        </aside>
      </main>
    </div>
  );
}

const PLACEHOLDER = [
  { tracking: 'WB-4821-7730', hint: 'out for delivery' }, { tracking: 'WB-1907-2264', hint: 'a problem' },
  { tracking: 'WB-6650-0193', hint: 'a problem' }, { tracking: 'WB-3302-5518', hint: 'delivered' }, { tracking: 'WB-7714-9046', hint: 'a problem' },
];

export function ParcelCard({ parcel }: { parcel: ParcelView }) {
  return (
    <section className="wb-card wb-parcel" aria-label="Your parcel">
      <header>
        <code>{parcel.tracking}</code>
        <span className={`wb-chip is-${parcel.status}`}>{parcel.statusWords}</span>
      </header>
      <p className="wb-route"><span>{parcel.from}</span><i aria-hidden="true" /><span>{parcel.to}</span></p>
      <dl>
        <div><dt>For</dt><dd>{parcel.recipient}</dd></div>
        {parcel.eta && <div><dt>Arrives</dt><dd>{parcel.eta}</dd></div>}
        {parcel.pickupPoint && <div><dt>Pickup</dt><dd>{parcel.pickupPoint}</dd></div>}
        {parcel.claim && <div><dt>Claim</dt><dd><code>{parcel.claim}</code></dd></div>}
      </dl>
      {parcel.issue && <p className="wb-issue">{parcel.issue}</p>}
      <ol className="wb-events">
        {parcel.events.map((e, i) => <li key={i}><time>{e.at}</time><span>{e.what}</span><small>{e.where}</small></li>)}
      </ol>
    </section>
  );
}

const ms = (n?: number) => (n === undefined ? '…' : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);

export function UnderTheHood({ steps, timings }: { steps: Step[]; timings: Timings | null }) {
  return (
    <section className="wb-card wb-hood" aria-label="How this answer was made">
      <h2>Under the hood</h2>
      <ol className="wb-pipe">
        <li className="is-app"><b>Ears</b><span>Waybill's model hears you</span><em>{timings?.hear !== undefined ? ms(timings.hear) : 'typed'}</em></li>
        <li className="is-app"><b>Brain</b><span>Waybill's agent and its parcel tools</span><em>{timings ? ms(timings.think) : '–'}</em></li>
        <li className="is-app"><b>Voice</b><span>Waybill's text-to-speech</span><em>{timings ? ms(timings.voice) : '–'}</em></li>
        <li className="is-atmee"><b>Face</b><span>Atmee renders Tess saying it</span><em>{timings ? (timings.face !== undefined ? `starts in ${ms(timings.face)}` : '…') : '–'}</em></li>
      </ol>
      {steps.length > 0 && (
        <ul className="wb-steps">{steps.map((s, i) => <li key={i} className={s.ok ? 'is-ok' : 'is-refused'}>{TOOL_WORDS[s.name] ?? s.name}{s.ok ? '' : ' (refused)'}</li>)}</ul>
      )}
      <p>Only the face is Atmee's. The rest is this app's own, so it can be any model, any tools and any voice.</p>
    </section>
  );
}
