// Brannoc and his tavern, drawn by the game: no video stream, no Atmee
// renderer. Every frame the page reads the level of the voice as it plays
// (useSpeech().levels(), the same audio the speaker gets, after the jitter
// buffer) and moves his jaw, moustache, brows and head with it; he blinks on
// his own, perks up while the player talks, and beams for a moment when the
// game hands something over. A game engine would drive its own rig the same
// way, from the same 24 kHz audio.
import { useEffect, useRef } from 'react';

export type Mood = 'idle' | 'listening' | 'speaking' | 'thinking' | 'pleased';

/** How far the jaw opens for a voice level (RMS 0..1): speech sits around 0.05 to 0.25. */
export function jawFor(level: number): number {
  return Math.max(0, Math.min(1, (level - 0.008) * 6));
}

/** Smooths a target the way a jaw moves: it opens fast and closes a little slower. */
export function follow(current: number, target: number, attack = 0.55, release = 0.25): number {
  return current + (target - current) * (target > current ? attack : release);
}

export function Scene({ levels, mood }: { levels: () => { voice: number; mic: number }; mood: Mood }) {
  const jaw = useRef<SVGEllipseElement>(null);
  const tongue = useRef<SVGEllipseElement>(null);
  const tash = useRef<SVGGElement>(null);
  const brows = useRef<SVGGElement>(null);
  const lids = useRef<SVGGElement>(null);
  const head = useRef<SVGGElement>(null);
  const smile = useRef<SVGGElement>(null);
  const glow = useRef<SVGCircleElement>(null);
  const moodRef = useRef(mood);
  moodRef.current = mood;

  useEffect(() => {
    let raf = 0;
    let open = 0;
    let lift = 0;
    let blinkAt = performance.now() + 2500;
    const start = performance.now();
    const frame = (now: number) => {
      const { voice, mic } = levels();
      const m = moodRef.current;
      open = follow(open, jawFor(voice));
      // Brows rise on the louder words, when he is pleased, and while he listens.
      const browTarget = Math.min(1, open * 0.8 + (m === 'pleased' ? 0.9 : 0) + (m === 'listening' && mic > 0.02 ? 0.35 : 0));
      lift = follow(lift, browTarget, 0.2, 0.08);
      const t = (now - start) / 1000;
      jaw.current?.setAttribute('ry', String(2 + open * 15));
      tongue.current?.setAttribute('cy', String(258 + open * 9));
      tongue.current?.setAttribute('ry', String(open * 6));
      tash.current?.setAttribute('transform', `translate(0 ${-open * 4})`);
      brows.current?.setAttribute('transform', `translate(0 ${-lift * 9})`);
      // A breath, a nod with the words, and a tilt towards the player while they talk.
      const tilt = (m === 'listening' ? -3 : 0) + Math.sin(t * 1.3) * 1.2 + open * 2.5 * Math.sin(t * 7);
      head.current?.setAttribute('transform', `rotate(${tilt.toFixed(2)} 200 250) translate(0 ${(Math.sin(t * 1.6) * 1.5 - open * 2).toFixed(2)})`);
      smile.current?.setAttribute('opacity', m === 'pleased' ? '1' : '0');
      glow.current?.setAttribute('r', String(70 + Math.sin(t * 3.1) * 4 + Math.sin(t * 7.3) * 2));
      // A blink every few seconds, quicker when he is thinking.
      let lid = 0;
      if (now >= blinkAt) {
        const k = (now - blinkAt) / 140;
        lid = k < 1 ? k : k < 2 ? 2 - k : 0;
        if (k >= 2) blinkAt = now + (m === 'thinking' ? 900 : 2200 + Math.random() * 3000);
      }
      lids.current?.setAttribute('transform', `translate(0 ${(-30 + lid * 30).toFixed(2)})`);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [levels]);

  return (
    <svg className="npc-scene" viewBox="0 0 400 300" role="img" aria-label="Brannoc behind the counter of the Brass Kettle">
      <defs>
        <radialGradient id="npc-lamp" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#ffd38a" stopOpacity=".75" /><stop offset="1" stopColor="#ffd38a" stopOpacity="0" /></radialGradient>
        <linearGradient id="npc-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a2418" /><stop offset="1" stopColor="#24160f" /></linearGradient>
        <clipPath id="npc-eyes"><ellipse cx="176" cy="186" rx="11" ry="9" /><ellipse cx="224" cy="186" rx="11" ry="9" /></clipPath>
      </defs>
      {/* the tavern */}
      <rect width="400" height="300" fill="url(#npc-wall)" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => <rect key={i} x={i * 60 - 10} y="0" width="2" height="230" fill="#1b100a" opacity=".6" />)}
      <circle ref={glow} cx="330" cy="70" r="70" fill="url(#npc-lamp)" />
      <rect x="322" y="60" width="16" height="22" rx="4" fill="#ffcf6b" stroke="#6b4423" strokeWidth="3" />
      <rect x="326" y="50" width="8" height="12" fill="#6b4423" />
      <g className="npc-shelf">
        <rect x="20" y="92" width="110" height="7" fill="#6b4423" />
        <rect x="270" y="132" width="110" height="7" fill="#6b4423" />
        {[[28, '#3d6b4f'], [46, '#8c2f2f'], [62, '#c99a3b'], [82, '#3d6b4f'], [102, '#5a3d7a']].map(([x, c]) => (
          <g key={String(x)}><rect x={Number(x)} y="66" width="12" height="26" rx="3" fill={String(c)} /><rect x={Number(x) + 4} y="58" width="4" height="9" fill={String(c)} /></g>
        ))}
        {[[278, '#c99a3b'], [298, '#3d6b4f'], [318, '#8c2f2f'], [346, '#c99a3b']].map(([x, c]) => (
          <rect key={String(x)} x={Number(x)} y="110" width="14" height="22" rx="4" fill={String(c)} />
        ))}
      </g>
      {/* Brannoc, a little higher than his drawing so the counter hides only his apron */}
      <g transform="translate(0 -26)"><g ref={head}>
        <path d="M104 330c4-60 42-96 96-96s92 36 96 96z" fill="#2f4a3a" />
        <path d="M148 330c2-46 22-72 52-72s50 26 52 72z" fill="#e9dcc0" />
        <ellipse cx="200" cy="196" rx="52" ry="58" fill="#e7b088" />
        <path d="M168 146q32-14 64 0" stroke="#f0c39f" strokeWidth="6" strokeLinecap="round" fill="none" opacity=".7" />
        <path d="M150 200c-9-4-12-22 2-30M250 200c9-4 12-22-2-30" stroke="#cfc7b8" strokeWidth="12" strokeLinecap="round" fill="none" />
        <ellipse cx="150" cy="196" rx="8" ry="12" fill="#dc9a74" />
        <ellipse cx="250" cy="196" rx="8" ry="12" fill="#dc9a74" />
        <circle cx="168" cy="212" r="9" fill="#e48a78" opacity=".55" />
        <circle cx="232" cy="212" r="9" fill="#e48a78" opacity=".55" />
        {/* eyes, lids, the pleased squint */}
        <ellipse cx="176" cy="186" rx="11" ry="9" fill="#fff" />
        <ellipse cx="224" cy="186" rx="11" ry="9" fill="#fff" />
        <circle cx="178" cy="187" r="5" fill="#2b1a10" />
        <circle cx="222" cy="187" r="5" fill="#2b1a10" />
        <g clipPath="url(#npc-eyes)"><g ref={lids}><rect x="160" y="166" width="80" height="30" fill="#d99e78" /></g></g>
        <g ref={smile} opacity="0"><path d="M164 184q12-10 24 0M212 184q12-10 24 0" stroke="#2b1a10" strokeWidth="3" fill="none" strokeLinecap="round" /><rect x="162" y="185" width="76" height="10" fill="#e7b088" /></g>
        <g ref={brows}><path d="M162 170q14-10 28-2M210 168q14-8 28 2" stroke="#cfc7b8" strokeWidth="8" strokeLinecap="round" fill="none" /></g>
        <ellipse cx="200" cy="206" rx="12" ry="11" fill="#d98f6c" />
        {/* the beard, the mouth in it, the moustache over it */}
        <path d="M146 214c0 44 22 70 54 70s54-26 54-70c-10 14-26 22-54 22s-44-8-54-22z" fill="#d9d2c5" />
        <ellipse ref={jaw} cx="200" cy="252" rx="15" ry="2" fill="#4a1f17" />
        <ellipse ref={tongue} cx="200" cy="258" rx="8" ry="0" fill="#c4564b" />
        <g ref={tash}><path d="M170 238c10-10 22-12 30-4 8-8 20-6 30 4-8 8-20 8-30 2-10 6-22 6-30-2z" fill="#e6e0d4" /></g>
      </g></g>
      {/* the counter, in front of him */}
      <rect x="0" y="262" width="400" height="38" fill="#7a4a26" />
      <rect x="0" y="258" width="400" height="8" fill="#9a6235" />
      <g><rect x="292" y="232" width="26" height="30" rx="4" fill="#c9cfd4" opacity=".9" /><path d="M318 240q12 2 0 16" stroke="#c9cfd4" strokeWidth="4" fill="none" /><rect x="292" y="228" width="26" height="8" rx="3" fill="#fff8e6" /></g>
    </svg>
  );
}
