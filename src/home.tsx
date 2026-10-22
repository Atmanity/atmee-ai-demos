// The home page: every app under apps/, from the server's list.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './kit/kit.css';
import './home.css';

interface AppInfo { id: string; title: string; tagline: string; avatar: boolean }

function Home() {
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  useEffect(() => { fetch('/api/apps').then((r) => r.json()).then(setApps).catch(() => setApps([])); }, []);
  return (
    <main className="home">
      <header>
        <h1>Atmee sample apps</h1>
        <p>Apps built on the Atmee Avatar API: your app owns the logic and the screen, and the avatar talks with your user about it.</p>
      </header>
      <section className="home-grid">
        {apps?.map((app) => (
          <a key={app.id} className="home-card" href={`/apps/${app.id}/`}>
            <h2>{app.title}</h2>
            <p>{app.tagline}</p>
            {!app.avatar && <span className="home-warn">No avatar configured</span>}
          </a>
        ))}
      </section>
      <footer>The original five apps run with <code>npm run classic</code>.</footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Home /></StrictMode>);
