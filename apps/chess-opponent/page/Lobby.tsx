// Kibitz's front door: what it is, how a game goes, and the way in.
import { Chessboard } from 'react-chessboard';
import { BoardBoundary, DARK_SQUARE, LIGHT_SQUARE } from './ChessBoard.tsx';

export function Logo() {
  return (
    <a className="kb-logo" href="./" aria-label="Kibitz home">
      <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">
        <path d="M8 4h24a5 5 0 0 1 5 5v16a5 5 0 0 1-5 5H18l-8.5 6.5V30H8a5 5 0 0 1-5-5V9a5 5 0 0 1 5-5z" fill="currentColor" />
        <rect x="12" y="9" width="8" height="8" fill="var(--kb-brass)" />
        <rect x="20" y="17" width="8" height="8" fill="var(--kb-brass)" />
        <rect x="20" y="9" width="8" height="8" fill="var(--kb-paper)" />
        <rect x="12" y="17" width="8" height="8" fill="var(--kb-paper)" />
      </svg>
      <span>Kibitz</span>
    </a>
  );
}

const STEPS: [string, string][] = [
  ['Take a seat', 'You start as White. Ask Sasha for Black, or for an easier game, whenever you like.'],
  ['Make your move', 'Say it, type it, or move the piece: “e4”, “knight to f3”, “castle”. The board checks it’s legal.'],
  ['Hear her reply', 'Sasha answers with a move of her own and tells you why, names the opening, and needles you a little.'],
];

// After 1.e4 c5 2.Nf3 d6: a Sicilian, with Sasha's last move marked.
const DEMO_FEN = 'rnbqkbnr/pp2pppp/3p4/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3';
const DEMO_MARKS = {
  d7: { boxShadow: 'inset 0 0 0 999px rgba(222, 176, 60, 0.30)' },
  d6: { boxShadow: 'inset 0 0 0 999px rgba(222, 176, 60, 0.48), inset 0 0 0 3px rgba(246, 214, 120, 0.95)' },
};

function DemoBoard() {
  return (
    <figure className="kb-demo" aria-hidden="true">
      <div className="kb-demo-board">
        <BoardBoundary>
          <Chessboard
            options={{
              id: 'kb-demo', position: DEMO_FEN, allowDragging: false, showAnimations: false, showNotation: false,
              boardStyle: { borderRadius: 4 }, darkSquareStyle: { backgroundColor: DARK_SQUARE }, lightSquareStyle: { backgroundColor: LIGHT_SQUARE },
              squareStyles: DEMO_MARKS,
            }}
          />
        </BoardBoundary>
      </div>
      <figcaption className="kb-demo-note">
        <span className="kb-demo-move">2…d6</span>
        <span>“Keeps your knight off e5 and lets my bishop out. Sicilian, if you’re keeping score.”</span>
        <span className="kb-demo-who">Sasha</span>
      </figcaption>
      <p className="kb-demo-sheet">1. e4 c5 2. Nf3 d6</p>
    </figure>
  );
}

export function Lobby({ onPlay }: { onPlay: (mic: boolean) => void }) {
  return (
    <div className="kb-lobby">
      <header className="kb-top is-lobby"><Logo /></header>
      <main className="kb-hero">
        <div className="kb-hero-copy">
          <p className="kb-eyebrow">Chess with Sasha</p>
          <h1>A real game, with someone across the board.</h1>
          <p className="kb-lede">Sasha is a club player with a dry wit. She plays her own moves, explains every one, and names the opening when she spots it. Talk to her, type, or just move the pieces.</p>
          <div className="kb-cta">
            <button type="button" className="kb-primary is-big" onClick={() => onPlay(true)}>Play with your voice</button>
            <button type="button" className="kb-secondary is-big" onClick={() => onPlay(false)}>Play by typing</button>
          </div>
          <p className="kb-small">Voice play uses your microphone during the game. Sasha looks one move ahead: she punishes a loose piece, and a two-move trick will beat her.</p>
        </div>
        <DemoBoard />
      </main>
      <section className="kb-steps" aria-label="How a game goes">
        {STEPS.map(([title, text], i) => (
          <article key={title}><span className="kb-step-n">{String(i + 1).padStart(2, '0')}</span><h2>{title}</h2><p>{text}</p></article>
        ))}
      </section>
    </div>
  );
}
