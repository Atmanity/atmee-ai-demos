// The Meridian's front door: Edmund, what the tour does, and the way in.
// Beginning asks for the camera (the tour is the camera view) and then the microphone.
import { useEffect, useRef, useState } from 'react';
import { BackToApps } from '../../../src/kit/index.ts';
import type { Exhibit } from '../engine/catalogue.ts';
import { localize } from '../engine/catalogue.i18n.ts';
import { LANGS, type Lang } from '../engine/lang.ts';
import { useLang, type StringKey } from './i18n.ts';
import type { CameraState } from './camera.ts';
import portrait from '../host/portrait.jpg';

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

const CAMERA_TROUBLE: Partial<Record<CameraState, StringKey>> = { blocked: 'cameraBlocked', missing: 'cameraMissing' };

const GlobeIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9S14.6 18.4 12 21c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" />
  </svg>
);

/**
 * The tour's language, picked before it starts: one button in the front door's
 * top bar (its current language in its own script) opening a sheet of all of
 * them, each in its own script with its English name beside it. Nine pills in
 * a row pushed "Begin the tour" off a phone's first screen.
 */
function LanguageButton({ value, onChange }: { value: Lang; onChange: (lang: Lang) => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const current = LANGS.find((l) => l.id === value)!;
  const chosen = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    chosen.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button type="button" className="mr-lang" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${t('language')}: ${current.name}`}>
        <GlobeIcon /><span lang={current.id}>{current.name}</span><span className="mr-lang-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="mr-lang-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="mr-lang-sheet" role="dialog" aria-modal="true" aria-label={t('language')}>
            <div className="mr-lang-head">
              <b>{t('language')}</b>
              <button type="button" className="mr-link" onClick={() => setOpen(false)}>{t('close')}</button>
            </div>
            <ul role="radiogroup" aria-label={t('language')}>
              {LANGS.map((l) => (
                <li key={l.id}>
                  <button type="button" role="radio" aria-checked={value === l.id} ref={value === l.id ? chosen : undefined}
                    className={value === l.id ? 'is-on' : ''} onClick={() => { onChange(l.id); setOpen(false); }}>
                    <span className="mr-lang-name" lang={l.id}>{l.name}</span>
                    {l.english !== l.name && <span className="mr-lang-en">{l.english}</span>}
                    <span className="mr-lang-tick" aria-hidden="true">{value === l.id ? '✓' : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

export function Lobby({ opening, camera, onLang, onBegin }: { opening: Exhibit | null; camera: CameraState; onLang: (lang: Lang) => void; onBegin: () => void }) {
  const { lang, t } = useLang();
  const at = opening && localize(opening, lang);
  return (
    <div className="mr-lobby">
      <header className="mr-lobby-top"><BackToApps /><span className="mr-lobby-end"><Wordmark /><LanguageButton value={lang} onChange={onLang} /></span></header>
      <main className="mr-lobby-main">
        {/* Edmund as a portrait on the wall: a gilt frame round his own photograph. */}
        <figure className="mr-portrait" aria-hidden="true">
          <img src={portrait} alt="" width={320} height={320} />
        </figure>
        <div className="mr-lobby-copy">
          <p className="mr-eyebrow">{t('eyebrow')}</p>
          <h1>{t('headline')}</h1>
          <p className="mr-lede">{t('lede')}</p>
          {at && <p className="mr-opening">{t('opening', { title: at.title, gallery: at.gallery })}</p>}
          <button type="button" className="mr-primary is-big" onClick={onBegin} disabled={camera === 'asking'}>
            {camera === 'asking' ? t('starting') : t('begin')}
          </button>
          {CAMERA_TROUBLE[camera] && <p className="mr-trouble" role="alert">{t(CAMERA_TROUBLE[camera]!)}</p>}
          <p className="mr-small">{t('uses')}</p>
          <p className="mr-small"><a href="?sheet">{t('sheetLink')}</a>{t('sheetAfter')}</p>
        </div>
      </main>
    </div>
  );
}
