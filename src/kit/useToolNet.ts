// A safety net under the host's tool calls. The host decides when to call a
// tool, and live it sometimes narrates an action instead ("let's move on!")
// without calling it, so the screen never moves. For actions that are safe
// to do twice (give up, next, new game), an app names what the player's words
// clearly ask for; if no call of that tool arrives soon after, the app does
// it itself and tells the host, who corrects whatever it said meanwhile.
import { useCallback, useRef } from 'react';
import type { ToolCall } from '../avatar/room.ts';
import type { Avatar } from './useAvatar.ts';

/** How long after the player's words a missing call is made by the app. */
const WAIT_MS = 7000;
/** A call of the same tool this long before the words still counts: the host can act before the transcript arrives. */
const EARLY_MS = 6000;
/**
 * Any other call from this long before the words on means the host acted on
 * them its own way (Kibitz, live: "Yes, start over as Black" was a side
 * change, and the net's own "new game" seven seconds later dealt a second
 * one). Doing nothing then beats doing it twice.
 */
const ANY_EARLY_MS = 3000;

export function useToolNet(opts: {
  /** The tool call the player's words clearly ask for, or null. Only for actions that are safe to repeat. */
  match: (text: string) => ToolCall | null;
  /** Runs a call the way the host's call would run; its result is what the host is told. Null or undefined: nothing to do now (stand down quietly). */
  run: (call: ToolCall) => Promise<string | null | undefined>;
  avatar: () => Avatar;
  waitMs?: number;
}) {
  const calls = useRef<{ name: string; at: number }[]>([]);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  /** Wraps the page's onToolCall so the net knows which calls the host made. */
  const watch = useCallback(<R,>(handler: (call: ToolCall) => Promise<R>) => async (call: ToolCall) => {
    calls.current = [...calls.current.filter((c) => Date.now() - c.at < 60_000), { name: call.name, at: Date.now() }];
    return handler(call);
  }, []);

  /** Feed it every finished thing the player said (spoken or typed). */
  const heard = useCallback((text: string) => {
    const wanted = optsRef.current.match(text);
    if (!wanted) return;
    const at = Date.now();
    setTimeout(() => {
      if (calls.current.some((c) => c.at >= at - (c.name === wanted.name ? EARLY_MS : ANY_EARLY_MS))) return;
      calls.current.push({ name: wanted.name, at: Date.now() });
      void optsRef.current.run(wanted).then((result) => {
        if (result === null || result === undefined) return;
        optsRef.current.avatar().event(`You did not call ${wanted.name}, so the app did it for the player just now: ${result} Carry on from this, and if you said something different a moment ago, correct it briefly.`, 30);
      }).catch((err) => console.warn('[tools] safety net failed:', err));
    }, optsRef.current.waitMs ?? WAIT_MS);
  }, []);

  return { watch, heard };
}
