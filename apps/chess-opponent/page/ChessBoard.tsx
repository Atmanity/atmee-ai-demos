import { Component, Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Chessboard, type PieceDropHandlerArgs } from "react-chessboard";
/** A board coordinate ("e4"). A local alias: the panel needs no chess library types. */
type Square = string;
export type { Square };

/**
 * The board itself. Ported from the source panel unchanged in substance:
 * react-chessboard renders its pieces as inline SVG, so nothing here reaches
 * the network — which is what makes it usable inside the panel sandbox at all.
 *
 * What this file decides is what a player can SEE at a glance while their eyes
 * are on the avatar rather than the panel: whose turn it is (the ring), what
 * just moved (the tint), and whether a king is under attack (the check mark).
 */
interface ChessBoardProps {
  fen: string;
  boardOrientation: "white" | "black";
  draggable: boolean;
  lastMove?: { from: Square; to: Square } | null;
  inCheckSquare?: Square | null;
  /** Whose move it is, for the ring around the board. */
  turnState: "yours" | "theirs" | "over" | "none";
  onPieceDrop: (source: Square, target: Square) => boolean;
}

const LIGHT_SQUARE = "#eadbc1";
const DARK_SQUARE = "#7f6045";

/**
 * The last move must survive a GLANCE: the opponent moves while the player is
 * looking at the avatar, and this is the only cue that says what changed.
 *
 * It used to REPLACE the square's colour with a 45% yellow, which on a light
 * square lands at #e8d9a2 against #eadbc1 — invisible. These are inset shadow
 * overlays instead, so both parities keep their own colour underneath and the
 * DESTINATION is stronger than the origin (where the piece now is matters more
 * than where it was).
 */
const LAST_MOVE_FROM = "inset 0 0 0 999px rgba(255, 205, 60, 0.30)";
const LAST_MOVE_TO =
  "inset 0 0 0 999px rgba(255, 205, 60, 0.46), inset 0 0 0 3px rgba(255, 226, 130, 0.95)";

/**
 * A check was a 4px inset of 50%-alpha red — a hairline on a 41px square at
 * 360px wide, on top of a sand-coloured square. It is now a filled radial
 * centred on the king plus a solid 3px ring, and the word "check" is said in
 * the status line as well, because a mark nobody notices is not a warning.
 */
const CHECK_STYLE: React.CSSProperties = {
  background:
    "radial-gradient(circle at 50% 50%, rgba(226, 58, 58, 0.92) 0%, rgba(196, 36, 36, 0.72) 62%, rgba(160, 24, 24, 0.35) 100%)",
  boxShadow: "inset 0 0 0 3px rgba(255, 120, 120, 0.95)",
};

/**
 * Coordinates are load-bearing here: a voice player maps "e4" to a square by
 * reading them. react-chessboard's defaults paint them in the opposite square
 * colour with no shadow, at 13px, in the corner — so at 360px the file letters
 * sit ON the black king and rooks and all but disappear. Explicit per-parity
 * styles: high-contrast, shadowed off the piece behind them, and small.
 */
const DARK_SQUARE_NOTATION: React.CSSProperties = {
  color: "#f6ead2",
  textShadow: "0 1px 2px rgba(0, 0, 0, 0.85)",
};
const LIGHT_SQUARE_NOTATION: React.CSSProperties = {
  color: "#4a3520",
  textShadow: "0 1px 2px rgba(255, 255, 255, 0.75)",
};
const ALPHA_NOTATION: React.CSSProperties = {
  fontSize: "9px",
  fontWeight: 700,
  position: "absolute",
  bottom: 1,
  right: 2,
  userSelect: "none",
  pointerEvents: "none",
};
const NUMERIC_NOTATION: React.CSSProperties = {
  fontSize: "9px",
  fontWeight: 700,
  position: "absolute",
  top: 1,
  left: 2,
  userSelect: "none",
  pointerEvents: "none",
};

/**
 * Whether this viewer asked for less motion. The stylesheet cannot reach the
 * board's JS-driven piece animation, so it is read here and turned off at the
 * source rather than left sliding pieces around under a `reduce` preference.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    // Safari below 14 has only the deprecated listener API.
    if (query.addEventListener) {
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }
    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, []);
  return reduced;
}

export function ChessBoardView({
  fen,
  boardOrientation,
  draggable,
  lastMove,
  inCheckSquare,
  turnState,
  onPieceDrop,
}: ChessBoardProps) {
  const reducedMotion = usePrefersReducedMotion();
  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (lastMove) {
      styles[lastMove.from] = { boxShadow: LAST_MOVE_FROM };
      styles[lastMove.to] = { boxShadow: LAST_MOVE_TO };
    }
    if (inCheckSquare) {
      styles[inCheckSquare] = { ...CHECK_STYLE };
    }
    return styles;
  }, [lastMove, inCheckSquare]);

  return (
    <div className={`chess-board-wrap chess-board-wrap--${turnState}`}>
      <BoardBoundary>
      <Chessboard
        options={{
          position: fen,
          boardOrientation,
          allowDragging: draggable,
          onPieceDrop: ({ sourceSquare, targetSquare }: PieceDropHandlerArgs) => {
            if (!targetSquare) return false;
            return onPieceDrop(sourceSquare as Square, targetSquare as Square);
          },
          boardStyle: { borderRadius: 8, boxShadow: "0 10px 40px rgba(0,0,0,0.45)" },
          darkSquareStyle: { backgroundColor: DARK_SQUARE },
          lightSquareStyle: { backgroundColor: LIGHT_SQUARE },
          darkSquareNotationStyle: DARK_SQUARE_NOTATION,
          lightSquareNotationStyle: LIGHT_SQUARE_NOTATION,
          alphaNotationStyle: ALPHA_NOTATION,
          numericNotationStyle: NUMERIC_NOTATION,
          squareStyles,
          animationDurationInMs: reducedMotion ? 0 : 180,
        }}
      />
      </BoardBoundary>
    </div>
  );
}

/**
 * react-chessboard measures a square to animate a move and throws when the
 * square has no size (a board that is not laid out). In this page the board
 * shares a React tree with the avatar's video, so a throw would take the
 * whole session's screen down with it. This catches it and remounts the board
 * fresh: a fresh board has nothing to animate, so it does not measure.
 */
class BoardBoundary extends Component<{ children: ReactNode }, { mount: number; failures: number }> {
  state = { mount: 0, failures: 0 };

  static getDerivedStateFromError() {
    return null;
  }

  componentDidCatch(error: unknown) {
    console.warn("[chess-opponent] the board failed to draw; redrawing it", error);
    this.setState((s) => ({ mount: s.mount + 1, failures: s.failures + 1 }));
  }

  render() {
    if (this.state.failures > 3) return <div className="chess-lobby">The board could not be drawn. Reload the page to carry on.</div>;
    return <Fragment key={this.state.mount}>{this.props.children}</Fragment>;
  }
}
