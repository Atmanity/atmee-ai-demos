// The original's onboarding (three AgentTasks: the name, the style target,
// the photo consent) as steps on the board. Each answer has a control here,
// and the same answers spoken or typed go through judge.ts; the avatar asks
// the questions, from what its state says is still open.
import { useRef, useState, type DragEvent } from 'react';
import { STYLE_CHIPS } from '../engine/style.ts';
import type { Command, View } from '../engine/types.ts';

const STEPS: { key: View['step']; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'style', label: 'Style' },
  { key: 'photo', label: 'Photo' },
];

export function PhotoDrop({ onFile, onSample, disabled, compact = false, label = 'Drop a photo of your outfit here' }: {
  onFile: (file: File) => void;
  onSample: () => void;
  disabled: boolean;
  compact?: boolean;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && !disabled) onFile(file);
  };
  return (
    <div
      className={`fashion-drop${over ? ' is-over' : ''}${compact ? ' fashion-drop--compact' : ''}${disabled ? ' is-disabled' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      {!compact && <div className="fashion-drop-icon" aria-hidden="true">📸</div>}
      <p className="fashion-drop-label">{label}</p>
      <div className="fashion-upload-row">
        <button type="button" className="fashion-upload" disabled={disabled} onClick={() => input.current?.click()}>Upload a photo</button>
        {/* No camera, or not dressed for a style review: and the door an automated test can open. */}
        <button type="button" className="fashion-upload" disabled={disabled} onClick={onSample}>Try a sample</button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

export function Onboarding({ view, live, busy, onCommand, onFile, onSample }: {
  view: View | null;
  live: boolean;
  busy: boolean;
  onCommand: (command: Command) => void;
  onFile: (file: File) => void;
  onSample: () => void;
}) {
  const [name, setName] = useState('');
  const [style, setStyle] = useState('');

  if (!view || !live) {
    return (
      <div className="fashion-onboarding">
        <div className="fashion-empty-icon">👗</div>
        <h3>Your Fashion Advisor</h3>
        <ol className="fashion-empty-steps">
          <li>You are asked your name and the look you are going for.</li>
          <li>You share one photo of your outfit: drop it, upload it, or try the sample. The rating and the try-ons need it.</li>
          <li>Then say things like <em>"try a black fedora"</em> or <em>"rate me for a wedding instead"</em>.</li>
        </ol>
        <p className="fashion-capture-hint">No photo? Say so, and the outfit gets talked through instead.</p>
        <p className="fashion-capture-hint">{live ? 'Getting the board ready…' : 'Start the session on the left to begin.'}</p>
      </div>
    );
  }

  const index = STEPS.findIndex((s) => s.key === view.step);
  const stepper = (
    <ol className="fashion-steps" aria-label="Getting started">
      {STEPS.map((s, i) => (
        <li key={s.key} className={i < index || view.step === 'styling' ? 'is-done' : i === index ? 'is-current' : ''}>{s.label}</li>
      ))}
    </ol>
  );

  if (view.step === 'name') {
    const submit = () => { if (name.trim()) onCommand({ type: 'name', name: name.trim() }); };
    return (
      <div className="fashion-onboarding">
        {stepper}
        <h3>Who am I styling?</h3>
        <p className="fashion-capture-hint">Say it out loud, or type it here.</p>
        <div className="fashion-field">
          <input className="kit-input" placeholder="Your name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
          <button type="button" className="kit-btn kit-primary" disabled={!name.trim() || busy} onClick={submit}>Continue</button>
        </div>
        <button type="button" className="fashion-link" disabled={busy} onClick={() => onCommand({ type: 'skipName' })}>I'd rather not say</button>
      </div>
    );
  }

  if (view.step === 'style') {
    const submit = (value: string) => { if (value.trim()) onCommand({ type: 'style', style: value.trim() }); };
    return (
      <div className="fashion-onboarding">
        {stepper}
        <h3>{view.name ? `What look are you going for, ${view.name}?` : 'What look are you going for?'}</h3>
        <p className="fashion-capture-hint">A style or an occasion: say it, tap one, or type your own.</p>
        <div className="fashion-chips">
          {STYLE_CHIPS.map((chip) => <button key={chip} type="button" className="fashion-chip" disabled={busy} onClick={() => submit(chip)}>{chip}</button>)}
        </div>
        <div className="fashion-field">
          <input className="kit-input" placeholder="e.g. old money, first date, job interview" value={style} maxLength={80} onChange={(e) => setStyle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(style); }} />
          <button type="button" className="kit-btn kit-primary" disabled={!style.trim() || busy} onClick={() => submit(style)}>Continue</button>
        </div>
      </div>
    );
  }

  if (view.step === 'photo') {
    return (
      <div className="fashion-onboarding">
        {stepper}
        <h3>One photo of your outfit</h3>
        <p className="fashion-capture-hint">It is read for <strong>{view.target}</strong>: a score, what works, one fix, and pieces to try. Nothing opens your camera.</p>
        <PhotoDrop onFile={onFile} onSample={onSample} disabled={busy} />
        <button type="button" className="fashion-link" disabled={busy} onClick={() => onCommand({ type: 'declinePhoto' })}>Skip it, I'll describe my outfit</button>
      </div>
    );
  }

  // Styling with no photo: the refusal stands, in words.
  return (
    <div className="fashion-onboarding">
      <div className="fashion-empty-icon">🗣️</div>
      <h3>Styling from your words</h3>
      <p className="fashion-capture-hint">For <strong>{view.target || 'your look'}</strong>. Tell your stylist what you are wearing; there is no rating or try-on without a photo.</p>
      {view.describedOutfit && <blockquote className="fashion-described">{view.describedOutfit}</blockquote>}
      <PhotoDrop onFile={onFile} onSample={onSample} disabled={busy} compact label="Changed your mind? Drop a photo any time." />
    </div>
  );
}
