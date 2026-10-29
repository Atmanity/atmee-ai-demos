// After the tour: the works the visitor saw, to remember them by, and the map
// with them ticked (each work's full entry a tap away).
import { useState } from 'react';
import type { Exhibit } from '../engine/catalogue.ts';
import { exhibitImage } from './images.ts';
import { Wordmark } from './Lobby.tsx';
import { MuseumMap } from './MuseumMap.tsx';
import { localize } from '../engine/catalogue.i18n.ts';
import { useLang } from './i18n.ts';

export function Visit({ seen, onAgain }: { seen: Exhibit[]; onAgain: () => void }) {
  const [map, setMap] = useState(false);
  const { lang, t } = useLang();
  return (
    <div className="mr-lobby mr-visit">
      <header className="mr-lobby-top"><Wordmark /></header>
      <main className="mr-visit-main">
        <p className="mr-eyebrow">{t('thanks')}</p>
        <h1>{seen.length ? (seen.length === 1 ? t('visitOne') : t('visitMany', { n: seen.length })) : t('comeBack')}</h1>
        {seen.length ? (
          <ol className="mr-seen">
            {seen.map((work) => localize(work, lang)).map((e) => (
              <li key={e.id}>
                <img src={exhibitImage(e)} alt="" />
                <div><b>{e.title}</b><span>{e.artist}, {e.date}</span><span>{t('theOriginal', { where: e.original })}</span></div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mr-lede">{t('noneSeen')}</p>
        )}
        <button type="button" className="mr-primary is-big" onClick={onAgain}>{t('newTour')}</button>
        <button type="button" className="mr-link" onClick={() => setMap(true)}>{t('seeMap')}</button>
      </main>
      {map && <MuseumMap seen={seen} current={null} onClose={() => setMap(false)} />}
    </div>
  );
}
