// Facecast: a presenter studio built the avatar-only way. The page has the
// audio and Remy is the face that says it (useAvatarOnly): a script read by a
// voice the user picks (voiced by the app's server), a recording the user
// drops in (decoded here), or the user's own microphone, streamed to Remy as
// they speak. Nothing decides what he says but the user.
import { useEffect, useRef, useState } from 'react';
import { BackToApps, decodeTo16k, fromBase64, useAvatarOnly, useMicTap, usePageDrop, SAMPLE_RATE, type Played, type SpeechWriter } from '../../../src/kit/index.ts';
import remy from '../host/portrait.jpg';
import './facecast.css';

const API = '/api/apps/presenter-studio';
const HOST = 'Remy';
const MAX_RECORDING_S = 120;

type Source = 'script' | 'recording' | 'live';
interface Voice { id: string; label: string; sound: string }
interface LogEntry { source: string; seconds: number; outcome: 'on air' | 'played' | 'cut' }

export const SAMPLES = [
  { title: 'Evening headlines', text: "Good evening. Tonight: the city's new night trains start running on Friday, the harbour festival returns after five years, and a heatwave is on its way for the weekend. Stay with us." },
  { title: 'Product launch', text: "Meet Lumen, the desk lamp that follows the sun. It shifts from cool morning light to a warm evening glow, all on its own. Lumen ships next month, and pre-orders open today." },
  { title: 'Safety notice', text: 'Attention please. The east entrance is closed for maintenance until six this evening. Please use the main doors on Station Road. Thank you for your patience.' },
];

export function App() {
  const face = useAvatarOnly('presenter-studio');
  const mic = useMicTap();
  const live = face.phase === 'live';
  const [source, setSource] = useState<Source>('script');
  const [voices, setVoices] = useState<Voice[]>([]);
  const [styles, setStyles] = useState<{ id: string; label: string }[]>([]);
  const [voice, setVoice] = useState('Charon');
  const [style, setStyle] = useState('anchor');
  const [script, setScript] = useState(SAMPLES[0].text);
  const [file, setFile] = useState<{ name: string; pcm: Int16Array } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [hearBack, setHearBack] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [onAir, setOnAir] = useState('');
  const writer = useRef<SpeechWriter | null>(null);
  const liveSamples = useRef(0);
  // Whether the talk button is down now: a press let go while the piece or the microphone was still opening ends there.
  const holding = useRef(false);

  useEffect(() => {
    void fetch(`${API}/voices`).then((r) => r.json()).then((d) => { setVoices(d.voices ?? []); setStyles(d.styles ?? []); }).catch(() => {});
  }, []);
  // Live from the microphone, Remy's voice is yours: heard back only when asked (headphones), or it feeds back.
  useEffect(() => {
    const el = face.audioRef.current;
    if (el) el.muted = source === 'live' && !hearBack;
  }, [source, hearBack, face.audioRef, live]);

  // A recording dropped anywhere on the page is the recording (the browser would otherwise open the
  // file in the tab and end the studio); not while the microphone is live.
  usePageDrop((files) => {
    if (writer.current || !files.length) return;
    setSource('recording');
    void pick(files[0]);
  });

  const note = (entry: LogEntry) => setLog((l) => [entry, ...l].slice(0, 8));
  async function air(label: string, pieces: Int16Array[]) {
    const seconds = pieces.reduce((n, p) => n + p.length, 0) / SAMPLE_RATE;
    setOnAir(label);
    const played: Played[] = await Promise.all(pieces.map((pcm) => face.say(pcm)));
    note({ source: label, seconds, outcome: played.some((p) => p.interrupted) ? 'cut' : 'played' });
    setOnAir('');
  }

  async function readScript() {
    const text = script.trim();
    if (!text || busy) return;
    setBusy(true); setProblem('');
    try {
      const res = await fetch(`${API}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice, style }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || (json.error === 'too_long' ? `Keep the script under ${json.max} characters.` : 'The voice could not read that.'));
      const pieces = await Promise.all((json.clips as string[]).map((b64) => decodeTo16k(fromBase64(b64))));
      setBusy(false);
      await air(`Script · ${voice}`, pieces);
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pick(chosen: File | undefined) {
    if (!chosen) return;
    setProblem('');
    try {
      const pcm = await decodeTo16k(await chosen.arrayBuffer());
      if (!pcm.length) throw new Error('empty');
      const limit = MAX_RECORDING_S * SAMPLE_RATE;
      setFile({ name: chosen.name, pcm: pcm.length > limit ? pcm.subarray(0, limit) : pcm });
      if (pcm.length > limit) setProblem(`Only the first ${MAX_RECORDING_S / 60} minutes go on air.`);
    } catch {
      setFile(null);
      setProblem("That file isn't audio the browser can play (try wav, mp3, m4a or ogg).");
    }
  }

  async function playRecording() {
    if (!file) return;
    // Several pieces of about ten seconds: the first is on air while the rest are still sending.
    const pieces: Int16Array[] = [];
    for (let at = 0; at < file.pcm.length; at += SAMPLE_RATE * 10) pieces.push(file.pcm.subarray(at, at + SAMPLE_RATE * 10));
    await air(`Recording · ${file.name}`, pieces);
  }

  async function liveStart() {
    if (!live || writer.current || holding.current) return;
    holding.current = true;
    setProblem('');
    const opened = await face.open();
    if (!opened) { holding.current = false; return; }
    writer.current = opened;
    liveSamples.current = 0;
    if (!holding.current) { await liveEnd(); return; }
    setOnAir('Live · your voice');
    const ok = await mic.begin((pcm) => { liveSamples.current += pcm.length; void writer.current?.write(pcm); });
    if (!ok) await liveEnd();
  }
  async function liveEnd() {
    holding.current = false;
    await mic.stop();
    const open = writer.current;
    if (!open) return;
    writer.current = null;
    const seconds = liveSamples.current / SAMPLE_RATE;
    const played = await open.end();
    if (seconds > 0.2) note({ source: 'Live · your voice', seconds, outcome: played.interrupted ? 'cut' : 'played' });
    setOnAir('');
  }

  const status = face.phase === 'warming' ? 'Remy is getting ready' : face.phase === 'arriving' ? 'Remy is taking his seat…' : 'Connecting to the studio…';
  const connecting = ['starting', 'warming', 'connecting', 'arriving'].includes(face.phase);

  return (
    <div className="fc">
      <header className="fc-top">
        <BackToApps avatar={face} name={HOST} />
        <span className="fc-logo"><i aria-hidden="true" />Facecast</span>
        <span className="fc-way" title="The app brings the audio; the avatar is the face">Avatar-only</span>
        {live && face.secondsLeft !== null && <span className="fc-clock">{Math.floor(face.secondsLeft / 60)}:{String(face.secondsLeft % 60).padStart(2, '0')}</span>}
      </header>

      <main className="fc-main">
        <section className="fc-monitor" aria-label="On air">
          <div className={`fc-screen ${live ? 'is-live' : ''}`}>
            <img className="fc-poster" src={remy} alt="" aria-hidden="true" />
            <video ref={face.videoRef} playsInline muted aria-label={`${HOST}'s video`} />
            <audio ref={face.audioRef} autoPlay />
            <span className={`fc-onair ${face.speaking ? 'is-on' : ''}`}>On air</span>
            {live && <div className="fc-third"><b>Remy Hart</b><span>{onAir || 'Standing by'}</span></div>}
            {face.phase === 'idle' && (
              <div className="fc-lobby">
                <h1>Any audio. A face that says it.</h1>
                <p>Write a script for a voice to read, drop in a recording, or talk live into your microphone: Remy says it to camera, lips in time. The audio is all this app's; Atmee renders only the face.</p>
                <button type="button" className="fc-go" onClick={() => void face.start()}>Open the studio</button>
              </div>
            )}
            {connecting && <div className="fc-status" role="status"><span className="fc-spin" aria-hidden="true" /><strong>{status}</strong>{face.detail && <span>{face.detail}</span>}</div>}
            {(face.phase === 'failed' || face.phase === 'ended') && (
              <div className="fc-status" role="status">
                <strong>{face.phase === 'failed' ? "Couldn't open the studio" : 'Studio closed'}</strong>
                {face.phase === 'failed' && <span>{face.detail}</span>}
                <button type="button" className="fc-go" onClick={() => void face.start()}>Open it again</button>
              </div>
            )}
            {live && face.audioBlocked && <button type="button" className="fc-hear" onClick={face.resumeAudio}>Tap to hear Remy</button>}
          </div>
          {log.length > 0 && (
            <ol className="fc-log" aria-label="On-air log">
              {log.map((e, i) => <li key={i}><span>{e.source}</span><em>{e.seconds.toFixed(1)} s</em><b className={`is-${e.outcome}`}>{e.outcome}</b></li>)}
            </ol>
          )}
        </section>

        <section className="fc-desk" aria-label="What Remy says">
          <div className="fc-tabs" role="tablist" aria-label="Where the audio comes from">
            {(['script', 'recording', 'live'] as const).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={source === s} className={source === s ? 'is-on' : ''} onClick={() => { if (!writer.current) setSource(s); }}>
                {s === 'script' ? 'Script' : s === 'recording' ? 'Recording' : 'Live mic'}
              </button>
            ))}
          </div>

          {source === 'script' && (
            <div className="fc-panel" role="tabpanel">
              <div className="fc-samples">{SAMPLES.map((s) => <button key={s.title} type="button" onClick={() => setScript(s.text)}>{s.title}</button>)}</div>
              <label className="fc-field"><span>Script</span>
                <textarea value={script} onChange={(e) => setScript(e.target.value)} maxLength={1200} rows={6} />
                <small>{script.length} / 1200</small>
              </label>
              <div className="fc-field"><span>Voice</span>
                <div className="fc-voices">{(voices.length ? voices : [{ id: 'Charon', label: 'Charon', sound: 'Informative, even' }]).map((v) => (
                  <button key={v.id} type="button" className={voice === v.id ? 'is-on' : ''} aria-pressed={voice === v.id} onClick={() => setVoice(v.id)}><b>{v.label}</b><span>{v.sound}</span></button>
                ))}</div>
              </div>
              <label className="fc-field"><span>Read it</span>
                <select value={style} onChange={(e) => setStyle(e.target.value)}>{(styles.length ? styles : [{ id: 'anchor', label: 'News anchor' }]).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
              </label>
              <button type="button" className="fc-go" disabled={!live || busy || !script.trim()} onClick={() => void readScript()}>{busy ? 'Voicing the script…' : 'Read it on air'}</button>
            </div>
          )}

          {source === 'recording' && (
            <div className="fc-panel" role="tabpanel">
              <label className="fc-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void pick(e.dataTransfer.files[0]); }}>
                <input type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
                <b>{file ? file.name : 'Drop a recording here'}</b>
                <span>{file ? `${(file.pcm.length / SAMPLE_RATE).toFixed(1)} s, ready` : 'or choose a file: a voice memo, an interview, a podcast clip (up to two minutes)'}</span>
              </label>
              <button type="button" className="fc-go" disabled={!live || !file} onClick={() => void playRecording()}>Play it on air</button>
            </div>
          )}

          {source === 'live' && (
            <div className="fc-panel" role="tabpanel">
              <p className="fc-help">Hold the button and talk: Remy says it with you, in your voice, a moment behind.</p>
              <button
                type="button" className={`fc-talk ${mic.on ? 'is-on' : ''}`} disabled={!live}
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); void liveStart(); }}
                onPointerUp={() => void liveEnd()} onPointerCancel={() => void liveEnd()}
                onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); void liveStart(); } }}
                onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); void liveEnd(); } }}
              >
                <span className="fc-meter" style={{ transform: `scale(${1 + mic.level * 0.35})` }} aria-hidden="true" />
                {mic.on ? 'On air: talking' : 'Hold to talk'}
              </button>
              <label className="fc-check"><input type="checkbox" checked={hearBack} onChange={(e) => setHearBack(e.target.checked)} /> Hear it back (use headphones)</label>
            </div>
          )}

          {face.speaking && <button type="button" className="fc-cut" onClick={() => void face.interrupt()}>Cut</button>}
          {(problem || mic.error) && <p className="fc-problem" role="alert">{problem || mic.error}</p>}
          <p className="fc-note">Avatar-only: the audio is this app's (a voice it chose, your file, your microphone). Atmee renders only the face, in the app's own LiveKit room.</p>
        </section>
      </main>
    </div>
  );
}
