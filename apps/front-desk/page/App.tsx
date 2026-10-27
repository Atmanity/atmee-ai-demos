// Callwell: Juniper Family Clinic's front desk, as a phone call. The page is
// a call screen, not a video: the caller talks to Rosa (the avatar's voice on
// a speech session, src/kit/useSpeech), and the appointment book beside the
// call is the page's own (engine/clinic.ts). Rosa's tools run here, against
// that book, and each result is what she says: a booking lights up in the
// week as she confirms it. After the call: how long it was, what it cost,
// what changed in the book.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackToApps, END_WORDS, ToolReply, credits, minutes, useSpeech, type Speech, type SpeechLine, type ToolRun } from '../../../src/kit/index.ts';
import { CLINIC, CLINICIANS, FrontDesk, TIMES, dayLabel, timeLabel, type Appointment, type ToolResult } from '../engine/clinic.ts';
import host from '../avatar.json';
import './callwell.css';

const TOOL_NAMES = ['check_availability', 'book_appointment', 'cancel_appointment', 'find_appointments'] as const;
const TOOL_WORDS: Record<string, string> = {
  check_availability: 'Checked the book', book_appointment: 'Booked', cancel_appointment: 'Cancelled', find_appointments: 'Looked up',
};
const TRY = [
  'Book me a check-up on Thursday morning.',
  "I'm Maria Gomez. I need to cancel my appointment.",
  'Can I get a flu shot this week?',
  'Where are you, and is there parking?',
];

export function App() {
  const desk = useRef(new FrontDesk());
  const [, setVersion] = useState(0);
  const [offered, setOffered] = useState<ToolResult['offered']>([]);
  const [latest, setLatest] = useState<Appointment | null>(null);

  const run = useCallback((name: string, args: Record<string, unknown>) => {
    const result = desk.current.run(name, args);
    if (result.offered) setOffered(result.offered);
    if (result.appointment) { setLatest({ ...result.appointment }); setOffered([]); }
    setVersion((v) => v + 1);
    return new ToolReply(result.text, result.ok);
  }, []);
  const tools = useMemo(() => Object.fromEntries(TOOL_NAMES.map((name) => [name, (args: Record<string, unknown>) => run(name, args)])), [run]);
  const call = useSpeech('front-desk', { tools });
  const live = call.phase === 'live';
  const busy = call.phase === 'starting' || call.phase === 'connecting';

  function placeCall() {
    // Every call starts from the same week: a fresh book, nothing changed yet.
    desk.current = new FrontDesk();
    setOffered([]);
    setLatest(null);
    setVersion((v) => v + 1);
    void call.start();
  }

  const changed = desk.current.appointments.filter((a) => a.onCall);
  return (
    <div className="cw">
      <header className="cw-top">
        <BackToApps avatar={call} name={host.name} />
        <a className="cw-logo" href="#"><Mark />Callwell<small>{CLINIC.name}</small></a>
        <span className="cw-way" title="Atmee hears the caller and answers in the avatar's voice; the clinic's server pins the conversation and its page runs the tools">Speech-to-speech</span>
        {live && call.secondsLeft !== null && <span className="cw-clock" aria-label="Time left on the call">{minutes(call.secondsLeft)}</span>}
      </header>

      <main className="cw-main">
        <section className="cw-call" aria-label={`Your call with ${host.name}`}>
          {call.phase === 'idle' && <Lobby onCall={placeCall} />}
          {(busy || live || call.phase === 'failed') && (
            <CallCard call={call} busy={busy} onAgain={placeCall} />
          )}
          {call.phase === 'ended' && <Summary call={call} changed={changed} onAgain={placeCall} />}
          {(live || call.phase === 'ended') && <Transcript lines={call.lines} thinking={call.thinking} />}
        </section>

        <aside className="cw-side">
          {latest && <BookedCard appt={latest} />}
          <Week desk={desk.current} offered={offered ?? []} />
          <UnderTheHood runs={call.toolRuns} />
        </aside>
      </main>
    </div>
  );
}

function Lobby({ onCall }: { onCall: () => void }) {
  return (
    <div className="cw-lobby">
      <p className="cw-kicker">{CLINIC.name} · front desk</p>
      <h1>Call the front desk</h1>
      <p>{host.name} answers the phone: ask for an appointment, move or cancel one, or ask about the clinic. It is a voice call: no video, no typing. Her answers come from the clinic's own appointment book, on the right.</p>
      <button type="button" className="cw-dial" onClick={onCall}><PhoneIcon />Call {host.name}</button>
      <p className="cw-small">Your browser will ask for the microphone (audio only).</p>
      <h2>Things to try</h2>
      <ul className="cw-try">{TRY.map((t) => <li key={t}>“{t}”</li>)}</ul>
    </div>
  );
}

function CallCard({ call, busy, onAgain }: { call: Speech; busy: boolean; onAgain: () => void }) {
  const status = call.phase === 'failed' ? "Couldn't connect"
    : call.phase === 'starting' ? 'Calling…'
      : call.phase === 'connecting' ? 'Connecting…'
        : call.ending ? 'Hanging up…'
          : call.speaking ? `${host.name} is speaking`
            : call.thinking ? `${host.name} is checking…`
              : call.muted ? "You're muted" : 'Listening';
  return (
    <div className={`cw-card ${call.speaking ? 'is-speaking' : ''}`}>
      <div className="cw-who">
        <VoiceOrb call={call} />
        <div>
          <strong>{host.name}</strong>
          <span>Front desk, {CLINIC.name}</span>
          <em role="status" aria-live="polite">{status}</em>
        </div>
      </div>
      {call.phase === 'failed' && (
        <div className="cw-problem" role="alert">
          <p>{call.detail}</p>
          <button type="button" className="cw-dial" onClick={onAgain}><PhoneIcon />Try again</button>
        </div>
      )}
      {call.phase === 'live' && call.audioBlocked && <button type="button" className="cw-hear" onClick={call.resumeAudio}>Tap to hear {host.name}</button>}
      {(busy || call.phase === 'live') && (
        <div className="cw-controls">
          <button type="button" className={`cw-mute ${call.muted ? 'is-on' : ''}`} disabled={call.phase !== 'live' || call.ending} aria-pressed={call.muted} onClick={() => call.setMuted(!call.muted)}>
            {call.muted ? 'Unmute' : 'Mute'}
          </button>
          <button type="button" className="cw-end" disabled={call.phase !== 'live' || call.ending} onClick={() => void call.end()}>
            <PhoneIcon down />{call.ending ? 'Ending…' : 'End call'}
          </button>
        </div>
      )}
    </div>
  );
}

/** Rosa's voice as a ring that swells as she speaks, and the caller's as an inner one. */
function VoiceOrb({ call }: { call: Speech }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { levels, phase } = call;
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    let raf = 0;
    let voice = 0;
    let mic = 0;
    const draw = () => {
      const l = levels();
      voice += (Math.min(1, l.voice * 6) - voice) * 0.25;
      mic += (Math.min(1, l.mic * 8) - mic) * 0.25;
      const s = el.width;
      ctx.clearRect(0, 0, s, s);
      const c = s / 2;
      ctx.fillStyle = 'rgba(15, 118, 110, 0.16)';
      ctx.beginPath(); ctx.arc(c, c, s * (0.3 + voice * 0.18), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0f766e';
      ctx.beginPath(); ctx.arc(c, c, s * 0.27, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = s * 0.025;
      ctx.beginPath(); ctx.arc(c, c, s * (0.1 + mic * 0.12), 0, Math.PI * 2); ctx.stroke();
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [levels, phase]);
  return <canvas ref={canvas} className="cw-orb" width={168} height={168} aria-hidden="true" />;
}

function Transcript({ lines, thinking }: { lines: SpeechLine[]; thinking: boolean }) {
  const box = useRef<HTMLOListElement>(null);
  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; }, [lines, thinking]);
  return (
    <section className="cw-transcript" aria-label="Transcript">
      <h2>Transcript</h2>
      <ol ref={box} aria-live="polite">
        {lines.filter((l) => !l.backchannel).map((l) => (
          <li key={l.id} className={`is-${l.who} ${l.final ? '' : 'is-partial'} ${l.cut ? 'is-cut' : ''}`}>
            <b>{l.who === 'user' ? 'You' : host.name}</b>
            <span>{l.text}{l.cut && !/[.!?]["')]*$/.test(l.text) && <i> … (cut off)</i>}</span>
          </li>
        ))}
        {thinking && <li className="is-avatar is-thinking"><b>{host.name}</b><span className="cw-dots" aria-label="checking"><i /><i /><i /></span></li>}
      </ol>
    </section>
  );
}

function Summary({ call, changed, onAgain }: { call: Speech; changed: Appointment[]; onAgain: () => void }) {
  const sum = call.summary;
  const status = sum?.status;
  return (
    <div className="cw-card cw-summary" role="status">
      <h2>{END_WORDS[sum?.reason ?? 'ended'] ?? 'Call ended'}</h2>
      <dl>
        <div><dt>Call</dt><dd>{minutes(sum?.seconds ?? 0)}</dd></div>
        <div><dt>Billed</dt><dd>{status?.billedSeconds != null ? minutes(status.billedSeconds) : sum?.settling ? 'Settling…' : '–'}</dd></div>
        <div><dt>Cost</dt><dd>{status?.chargedMicrocredits != null ? `${credits(status.chargedMicrocredits)} credits` : sum?.settling ? 'Settling…' : '–'}</dd></div>
      </dl>
      <h3>On this call</h3>
      {changed.length ? (
        <ul className="cw-changes">{changed.map((a) => (
          <li key={a.ref} className={`is-${a.onCall}`}><b>{a.onCall === 'booked' ? 'Booked' : 'Cancelled'}</b> {a.patient}, {dayLabel(a.date)} at {timeLabel(a.time)} with {CLINICIANS.find((c) => c.id === a.clinician)?.short} <code>{a.ref}</code></li>
        ))}</ul>
      ) : <p className="cw-small">Nothing in the book changed.</p>}
      <button type="button" className="cw-dial" onClick={onAgain}><PhoneIcon />Call again</button>
    </div>
  );
}

function BookedCard({ appt }: { appt: Appointment }) {
  const c = CLINICIANS.find((x) => x.id === appt.clinician)!;
  return (
    <section className={`cw-booked is-${appt.status}`} aria-label="Your appointment" aria-live="polite">
      <header><span>{appt.status === 'booked' ? 'Booked on this call' : 'Cancelled on this call'}</span><code>{appt.ref}</code></header>
      <strong>{dayLabel(appt.date)} · {timeLabel(appt.time)}</strong>
      <p>{appt.patient} with {c.name}, for {appt.reason}</p>
    </section>
  );
}

/** The week in the book: each clinician's half hours, open, taken, offered on this call, or booked by it. */
function Week({ desk, offered }: { desk: FrontDesk; offered: NonNullable<ToolResult['offered']> }) {
  const isOffered = (date: string, time: string, id: string) => offered.some((o) => o.date === date && o.time === time && o.clinician === id);
  return (
    <section className="cw-week" aria-label="This week's appointment book">
      <header><h2>The book</h2><span className="cw-legend"><i className="is-open" />open <i className="is-offered" />offered <i className="is-mine" />this call</span></header>
      {desk.days.map((d) => (
        <div className="cw-day" key={d.date}>
          <h3>{d.label}</h3>
          {CLINICIANS.filter((c) => desk.works(c, d.date)).map((c) => (
            <div className="cw-row" key={c.id}>
              <span className="cw-doc">{c.short.replace('Nurse Practitioner', 'NP')}</span>
              <span className="cw-slots">{TIMES.map((t) => {
                const h = desk.holder(d.date, t, c.id);
                const mine = typeof h === 'object' && h.onCall === 'booked';
                const cls = mine ? 'is-mine' : typeof h === 'object' ? 'is-taken' : h === 'open' ? (isOffered(d.date, t, c.id) ? 'is-offered' : 'is-open') : `is-${h}`;
                return <i key={t} className={cls} title={`${timeLabel(t)}: ${mine ? 'booked on this call' : typeof h === 'object' ? 'taken' : h}`} />;
              })}</span>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

function UnderTheHood({ runs }: { runs: ToolRun[] }) {
  return (
    <section className="cw-hood" aria-label="How this call works">
      <h2>Under the hood</h2>
      <ol className="cw-pipe">
        <li className="is-atmee"><b>Hears and speaks</b><span>Atmee's speech server, in the avatar's voice</span></li>
        <li className="is-app"><b>Who Rosa is, the rules, the tools</b><span>pinned by the clinic's server: this page can't change them</span></li>
        <li className="is-app"><b>The appointment book</b><span>this page: it runs each tool and answers with the result</span></li>
      </ol>
      {runs.length > 0 && (
        <ul className="cw-runs">{runs.slice(-6).map((r) => (
          <li key={r.id} className={r.ok === false ? 'is-refused' : ''}>
            <b>{TOOL_WORDS[r.name] ?? r.name}</b>
            <span>{r.output === undefined ? '…' : brief(r.output)}</span>
          </li>
        ))}</ul>
      )}
    </section>
  );
}

/** A tool result without the lines meant for Rosa ("Offer two or three…"), at most a couple of lines. */
function brief(output: string): string {
  const said = output.replace(/\s+(Offer|Read|Ask|Say|Check)\b[^]*$/, '');
  return said.length > 150 ? `${said.slice(0, 147)}…` : said;
}

const Mark = () => (
  <svg className="cw-mark" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="8" /><path d="M14 7v14M7 14h14" /></svg>
);
const PhoneIcon = ({ down = false }: { down?: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" style={down ? { transform: 'rotate(135deg)' } : undefined}>
    <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" />
  </svg>
);
