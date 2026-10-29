// The Meridian's front door: Edmund, what the tour does, and the way in.
// Beginning asks for the camera (the tour is the camera view) and then the microphone.
import { BackToApps } from '../../../src/kit/index.ts';
import type { Exhibit } from '../engine/catalogue.ts';
import { localize } from '../engine/catalogue.i18n.ts';
import { LANGS, type Lang } from '../engine/lang.ts';
import { useLang, type StringKey } from './i18n.ts';
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

const CAMERA_TROUBLE: Partial<Record<CameraState, StringKey>> = { blocked: 'cameraBlocked', missing: 'cameraMissing' };

/** The tour's language, picked before it starts (each name written in its own language). */
function LanguagePicker({ value, onChange }: { value: Lang; onChange: (lang: Lang) => void }) {
  const { t } = useLang();
  return (
    <div className="mr-langs" role="radiogroup" aria-label={t('language')}>
      <span className="mr-langs-label">{t('language')}</span>
      {LANGS.map((l) => (
        <button key={l.id} type="button" role="radio" aria-checked={value === l.id} lang={l.id}
          className={value === l.id ? 'is-on' : ''} onClick={() => onChange(l.id)}>{l.name}</button>
      ))}
    </div>
  );
}

export function Lobby({ opening, camera, onLang, onBegin }: { opening: Exhibit | null; camera: CameraState; onLang: (lang: Lang) => void; onBegin: () => void }) {
  const { lang, t } = useLang();
  const at = opening && localize(opening, lang);
  return (
    <div className="mr-lobby">
      <header className="mr-lobby-top"><BackToApps /><Wordmark /></header>
      <main className="mr-lobby-main">
        <div className="mr-portrait" aria-hidden="true">
          <img src={cutout} alt="" width={320} height={320} />
        </div>
        <div className="mr-lobby-copy">
          <p className="mr-eyebrow">{t('eyebrow')}</p>
          <h1>{t('headline')}</h1>
          <p className="mr-lede">{t('lede')}</p>
          {at && <p className="mr-opening">{t('opening', { title: at.title, gallery: at.gallery })}</p>}
          <LanguagePicker value={lang} onChange={onLang} />
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
