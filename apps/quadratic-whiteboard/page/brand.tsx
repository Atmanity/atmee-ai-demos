// Chalkline's name, mark and host: a parabola in chalk on a board, its vertex
// marked in yellow, the board's tray beneath.

/** The board's voice (avatar.json). */
export const HOST = 'Ada';

export function Logo() {
  return (
    <a className="cl-logo" href="./" aria-label="Chalkline home">
      <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">
        <rect x="3" y="4" width="34" height="27" rx="3" fill="var(--cl-board)" />
        <path d="M10 11 Q20 35 30 11" fill="none" stroke="var(--cl-chalk)" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="20" cy="23" r="2.6" fill="var(--cl-yellow)" />
        <rect x="7" y="33.5" width="26" height="2.6" rx="1.3" fill="currentColor" />
      </svg>
      <span>Chalkline</span>
    </a>
  );
}
