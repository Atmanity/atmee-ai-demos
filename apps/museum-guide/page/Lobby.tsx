// The Meridian's front door: Edmund, what the tour does, and the way in.
// Beginning asks for the camera (the tour is the camera view) and then the microphone.
import { BackToApps } from '../../../src/kit/index.ts';
import type { Exhibit } from '../engine/catalogue.ts';
import type { CameraState } from './camera.ts';
import cutout from '../host/cutout.webp';

export function Wordmark() {
  return (
    <a className="mr-wordmark" href="./" aria-label="The Meridian home">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M12 2v20M2 12h20" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="12" cy="12" r="2.4" fill="var(--mr-brass)" />
      </svg>
      <span>The Meridian</span>
    </a>
  );
}

const CAMERA_TROUBLE: Partial<Record<CameraState, string>> = {
  blocked: 'The camera is blocked. Allow it for this site in your browser\'s settings, then begin again.',
  missing: 'No camera could be opened on this device.',
};

export function Lobby({ opening, camera, onBegin }: { opening: Exhibit | null; camera: CameraState; onBegin: () => void }) {
  return (
    <div className="mr-lobby">
      <header className="mr-lobby-top"><BackToApps /><Wordmark /></header>
      <main className="mr-lobby-main">
        <div className="mr-portrait" aria-hidden="true">
          <img src={cutout} alt="" width={320} height={320} />
        </div>
        <div className="mr-lobby-copy">
          <p className="mr-eyebrow">A private tour with the chairman</p>
          <h1>Every work has a story. Edmund knows them all.</h1>
          <p className="mr-lede">
            Hold up your phone in the galleries. Point it at a painting, or at the code on its label, and Edmund Hale,
            the Meridian's chairman, tells you what you're looking at. Ask him anything, out loud.
          </p>
          {opening && <p className="mr-opening">You're at <b>{opening.title}</b>, {opening.gallery}.</p>}
          <button type="button" className="mr-primary is-big" onClick={onBegin} disabled={camera === 'asking'}>
            {camera === 'asking' ? 'Opening the camera…' : 'Begin the tour'}
          </button>
          {CAMERA_TROUBLE[camera] && <p className="mr-trouble" role="alert">{CAMERA_TROUBLE[camera]}</p>}
          <p className="mr-small">Uses your camera and microphone while you're with Edmund. Earbuds are best in the galleries.</p>
          <p className="mr-small"><a href="?sheet">Not at the Meridian? Open the gallery labels on another screen</a> and point your phone at them.</p>
        </div>
      </main>
    </div>
  );
}
