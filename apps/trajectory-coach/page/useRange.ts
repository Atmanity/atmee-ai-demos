// The range as React state: the page's replacement for the panel SDK's
// `useAppState`. One Range for the page's lifetime; every change (including
// the range's own landing, off its timer) re-renders, and the latest refusal
// is kept as the message the panel shows.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Launcher } from '../engine/launcher.ts';
import { Range } from '../engine/range.ts';
import type { Change, Intent, Result, Source } from '../engine/types.ts';

export interface RangeHandlers {
  /** Every applied change, the landing included. */
  onChange?: (change: Change) => void;
  onRefused?: (intent: Intent, reason: string, by: Source) => void;
}

export function useRange(startChallenge: string | null, handlers: RangeHandlers = {}) {
  const [range] = useState(() => new Range(new Launcher(startChallenge)));
  const [view, setView] = useState(() => ({ state: range.snapshot(), seq: range.seq }));
  const [message, setMessage] = useState('');
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => range.subscribe((change) => {
    setView({ state: change.snapshot, seq: change.seq });
    handlersRef.current.onChange?.(change);
  }), [range]);

  /** Apply one intent. A refusal becomes the panel's message; any success clears it. */
  const dispatch = useCallback((intent: Intent, by: Source): Result => {
    const result = range.apply(intent, by);
    if (result.applied) {
      setMessage('');
    } else {
      setMessage(result.reason);
      handlersRef.current.onRefused?.(intent, result.reason, by);
    }
    return result;
  }, [range]);

  return { range, state: view.state, seq: view.seq, message, dispatch };
}
