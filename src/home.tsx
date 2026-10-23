// The index: every product under apps/, from the server's list, shown under
// its own brand and grouped by what it is for.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './home.css';

interface AppInfo { id: string; title: string; tagline: string; brand?: { color: string; ink: string }; avatar: boolean }

const SHELVES: [string, string, string[]][] = [
  ['Play', 'Games with a host across the table.', ['guess-the-city', 'chess-opponent', 'poker-table']],
  ['Learn', 'A teacher who watches what you do and answers from the lesson.', ['stroke-tutor', 'bls-tutor', 'quadratic-whiteboard', 'trajectory-coach', 'sky-guide']],
  ['Plan and decide', 'An expert who works the numbers with you.', ['nutrition-advisor', 'fashion-advisor', 'fitness-coach', 'market-desk', 'travel-guide', 'room-planner']],
];

function Tile({ app }: { app: AppInfo }) {
  const brand = app.brand ?? { color: '#2b3150', ink: '#ffffff' };
  return (
    <a className="home-tile" href={`/apps/${app.id}/`} style={{ '--brand': brand.color, '--brand-ink': brand.ink } as React.CSSProperties}>
      <span className="home-mark" aria-hidden="true">{app.title.slice(0, 1)}</span>
      <span className="home-name">{app.title}</span>
      <span className="home-line">{app.tagline}</span>
      {!app.avatar && <span className="home-warn">Needs a host: set AVATAR_DEFAULT</span>}
      <span className="home-open" aria-hidden="true">Open →</span>
    </a>
  );
}

function Home() {
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  useEffect(() => { fetch('/api/apps').then((r) => r.json()).then(setApps).catch(() => setApps([])); }, []);
  const byId = new Map((apps ?? []).map((a) => [a.id, a]));
  const shelved = new Set(SHELVES.flatMap(([, , ids]) => ids));
  const others = (apps ?? []).filter((a) => !shelved.has(a.id));
  return (
    <main className="home">
      <header className="home-head">
        <p className="home-kicker">Built on the Atmee Avatar API</p>
        <h1>Apps with a live host</h1>
        <p className="home-lede">Fourteen products where a real-time, talking host plays, teaches and advises inside the app, and acts on it: every verdict, clue and number it gives comes from the app itself.</p>
      </header>
      {apps === null && <p className="home-loading">Loading the apps…</p>}
      {apps?.length === 0 && <p className="home-loading">The app server did not answer. Start it with <code>npm run dev</code>.</p>}
      {SHELVES.map(([name, line, ids]) => {
        const items = ids.map((id) => byId.get(id)).filter((a): a is AppInfo => Boolean(a));
        if (!items.length) return null;
        return (
          <section key={name} className="home-shelf" aria-labelledby={`shelf-${name}`}>
            <div className="home-shelf-head"><h2 id={`shelf-${name}`}>{name}</h2><p>{line}</p></div>
            <div className="home-grid">{items.map((app) => <Tile key={app.id} app={app} />)}</div>
          </section>
        );
      })}
      {others.length > 0 && (
        <section className="home-shelf"><div className="home-shelf-head"><h2>More</h2></div><div className="home-grid">{others.map((app) => <Tile key={app.id} app={app} />)}</div></section>
      )}
      <footer className="home-foot">Five earlier apps (a live stream, a recruiter, a training course, a companion, a story game) run with <code>npm run classic</code>.</footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Home /></StrictMode>);
