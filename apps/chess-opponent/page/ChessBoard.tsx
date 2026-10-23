import { Component, Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Chessboard, type PieceDropHandlerArgs, type SquareHandlerArgs } from "react-chessboard";
/** A board coordinate ("e4"). A local alias: the page needs no chess library types. */
type Square = string;
export type { Square };

/**
 * The board itself. What this file decides is what a player can SEE at a
 * glance while they are listening to Sasha: whose turn it is (the frame),
 * what just moved (the tint), whether a king is under attack (the check
 * mark), and, for a tap-to-move player on a phone, which piece is picked up
 * and where it can go.
 */
interface ChessBoardProps {
  fen: string;
  boardOrientation: "white" | "black";
  draggable: boolean;
  lastMove?: { from: Square; to: Square } | null;
  inCheckSquare?: Square | null;
  /** Whose move it is, for the frame around the board. */
  turnState: "yours" | "theirs" | "over" | "none";
  onPieceDrop: (source: Square, target: Square) => boolean;
  /** Tap to move: a square was tapped. */
  onSquareClick?: (square: Square) => void;
  /** The piece picked up by a tap, and the squares it can go to. */
  selected?: Square | null;
  targets?: readonly Square[];
}

/** Maple and walnut: a club board on the felt. */
export const LIGHT_SQUARE = "#ecdcbf";
export const DARK_SQUARE = "#a2795a";

/**
 * The last move must survive a GLANCE: Sasha moves while the player is
 * looking at her, and this is the only cue that says what changed. Inset
 * overlays, so both square colours keep their own tone underneath, and the
 * DESTINATION is stronger than the origin.
 */
const LAST_MOVE_FROM = "inset 0 0 0 999px rgba(222, 176, 60, 0.30)";
const LAST_MOVE_TO = "inset 0 0 0 999px rgba(222, 176, 60, 0.48), inset 0 0 0 3px rgba(246, 214, 120, 0.95)";

/** A check is a filled radial on the king plus a solid ring: a hairline nobody notices is not a warning. */
const CHECK_STYLE: React.CSSProperties = {
  background:
    "radial-gradient(circle at 50% 50%, rgba(214, 62, 44, 0.92) 0%, rgba(190, 44, 30, 0.72) 62%, rgba(150, 30, 20, 0.35) 100%)",
  boxShadow: "inset 0 0 0 3px rgba(255, 130, 110, 0.95)",
};

const SELECTED_STYLE: React.CSSProperties = { boxShadow: "inset 0 0 0 999px rgba(29, 68, 54, 0.32), inset 0 0 0 3px #1d4436" };
const TARGET_STYLE: React.CSSProperties = {
  backgroundImage: "radial-gradient(circle at 50% 50%, rgba(29, 68, 54, 0.55) 0 17%, transparent 19%)",
  cursor: "pointer",
};

/**
 * Coordinates are load-bearing: a voice player maps "e4" to a square by
 * reading them. High-contrast, shadowed off the piece behind them, and small.
 */
const DARK_SQUARE_NOTATION: React.CSSProperties = { color: "#f8ecd4", textShadow: "0 1px 2px rgba(0, 0, 0, 0.85)" };
const LIGHT_SQUARE_NOTATION: React.CSSProperties = { color: "#5a3d24", textShadow: "0 1px 2px rgba(255, 255, 255, 0.75)" };
const ALPHA_NOTATION: React.CSSProperties = {
  fontSize: "9px", fontWeight: 700, position: "absolute", bottom: 1, right: 2, userSelect: "none", pointerEvents: "none",
};
const NUMERIC_NOTATION: React.CSSProperties = {
  fontSize: "9px", fontWeight: 700, position: "absolute", top: 1, left: 2, userSelect: "none", pointerEvents: "none",
};

/**
 * Whether this viewer asked for less motion. The stylesheet cannot reach the
 * board's JS-driven piece animation, so it is read here and turned off at the
 * source.
 */
export function usePrefersReducedMotion(): boolean {
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
  onSquareClick,
  selected = null,
  targets = [],
}: ChessBoardProps) {
  const reducedMotion = usePrefersReducedMotion();
  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (lastMove) {
      styles[lastMove.from] = { boxShadow: LAST_MOVE_FROM };
      styles[lastMove.to] = { boxShadow: LAST_MOVE_TO };
    }
    if (inCheckSquare) styles[inCheckSquare] = { ...CHECK_STYLE };
    if (selected) styles[selected] = { ...styles[selected], ...SELECTED_STYLE };
    for (const square of targets) styles[square] = { ...styles[square], ...TARGET_STYLE };
    return styles;
  }, [lastMove, inCheckSquare, selected, targets]);

  return (
    <div className={`kb-board kb-board--${turnState}`}>
      <BoardBoundary>
        <Chessboard
          options={{
            id: "kb-board",
            position: fen,
            boardOrientation,
            allowDragging: draggable,
            onPieceDrop: ({ sourceSquare, targetSquare }: PieceDropHandlerArgs) => {
              if (!targetSquare) return false;
              return onPieceDrop(sourceSquare as Square, targetSquare as Square);
            },
            onSquareClick: ({ square }: SquareHandlerArgs) => onSquareClick?.(square),
            boardStyle: { borderRadius: 4 },
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
 * square has no size (a board that is not laid out). The board shares a React
 * tree with Sasha's video, so a throw would take the whole screen down with
 * it. This catches it and remounts the board fresh: a fresh board has nothing
 * to animate, so it does not measure.
 */
export class BoardBoundary extends Component<{ children: ReactNode }, { mount: number; failures: number }> {
  state = { mount: 0, failures: 0 };

  static getDerivedStateFromError() {
    return null;
  }

  componentDidCatch(error: unknown) {
    console.warn("[chess-opponent] the board failed to draw; redrawing it", error);
    this.setState((s) => ({ mount: s.mount + 1, failures: s.failures + 1 }));
  }

  render() {
    if (this.state.failures > 3) return <div className="kb-board-error">The board could not be drawn. Reload the page to start a fresh game.</div>;
    return <Fragment key={this.state.mount}>{this.props.children}</Fragment>;
  }
}
