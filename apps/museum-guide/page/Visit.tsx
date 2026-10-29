// After the tour: the works the visitor saw, to remember them by.
import type { Exhibit } from '../engine/catalogue.ts';
import { exhibitImage } from './images.ts';
import { Wordmark } from './Lobby.tsx';

export function Visit({ seen, onAgain }: { seen: Exhibit[]; onAgain: () => void }) {
  return (
    <div className="mr-lobby mr-visit">
      <header className="mr-lobby-top"><Wordmark /></header>
      <main className="mr-visit-main">
        <p className="mr-eyebrow">Thank you for visiting</p>
        <h1>{seen.length ? `Your visit: ${seen.length === 1 ? 'one work' : `${seen.length} works`}` : 'Come back soon'}</h1>
        {seen.length ? (
          <ol className="mr-seen">
            {seen.map((e) => (
              <li key={e.id}>
                <img src={exhibitImage(e)} alt="" />
                <div><b>{e.title}</b><span>{e.artist}, {e.date}</span><span>The original: {e.original}</span></div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mr-lede">You didn't stop at any work this time. Edmund will be here.</p>
        )}
        <button type="button" className="mr-primary is-big" onClick={onAgain}>Begin a new tour</button>
      </main>
    </div>
  );
}
