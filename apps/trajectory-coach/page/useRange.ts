// The range as React state. One Range and its Controls for the page's
// lifetime (they outlive a call: progress and the logbook carry over to the
// next one); every change, including the range's own landing off its timer,
// re-renders. The latest refusal, from any source, is the message the screen
// shows until the next change.
import { useEffect, useRef, useState } from 'react';
import { Controls, type Interpret } from '../engine/controls.ts';
import { Launcher } from '../engine/launcher.ts';
import { emptyLog, logChange } from '../engine/logbook.ts';
import { Range } from '../engine/range.ts';

export interface RangeOptions {
  /** Tell the host something it cannot see. */
  tell: (text: string, ttlS: number) => void;
  interpret?: Interpret;
}

export function useRange(startChallenge: string | null, opts: RangeOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const [message, setMessage] = useState('');
  // Made together, so a discarded first render never leaves a second listener on the range.
  const [{ range, controls }] = useState(() => {
    const range = new Range(new Launcher(startChallenge));
    const controls = new Controls(range, {
      tell: (text, ttl) => optsRef.current.tell(text, ttl),
      refused: setMessage,
      interpret: (text, ctx) => optsRef.current.interpret?.(text, ctx) ?? Promise.resolve(null),
    });
    return { range, controls };
  });
  const [view, setView] = useState(() => ({ state: range.snapshot(), seq: range.seq }));
  const [log, setLog] = useState(emptyLog);

  useEffect(() => range.subscribe((change) => {
    setView({ state: change.snapshot, seq: change.seq });
    setMessage('');
    setLog((l) => logChange(l, change));
  }), [range]);

  return { range, controls, state: view.state, seq: view.seq, message, log };
}
