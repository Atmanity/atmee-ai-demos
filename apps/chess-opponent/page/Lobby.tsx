/**
 * The one thing the panel shows while there is no board yet. The original
 * had two of these (the handshake's and the first snapshot's) and the spinner
 * vanished halfway through a wait that was still going; here it is one
 * component again, with the spinner only while something is happening.
 */
export function Lobby({ text = "Setting up the board…", busy = true }: { text?: string; busy?: boolean }) {
  return (
    <div className="chess-lobby" role="status" aria-live="polite">
      <div className="chess-lobby-status">
        {busy && <span className="chess-spinner" aria-hidden="true" />}
        <span>{text}</span>
      </div>
    </div>
  );
}
