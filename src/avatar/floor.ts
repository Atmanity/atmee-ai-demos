// When a typed turn may go to the avatar.
//
// This works around today's platform: Causeur takes a typed turn (lk.chat)
// the moment it arrives. One that lands while the avatar speaks cuts it off,
// and one that lands as the avatar starts an event's reply is lost; the app's
// events, by contrast, wait for the floor. Once Causeur waits for the floor
// with typed turns too, delete this file and send lk.chat directly.
//
//   const floor = createFloor((text) => sendChat(text));
//   floor.speaking(true | false)   the avatar started or stopped speaking
//   floor.utterance()              a new avatar caption stream began
//   floor.event(ttlS)              the app is sending an event; returns a withdraw() for a failed send
//   floor.say(text)                the user typed a turn: sent now or held
//   floor.close()                  the session is over
export const QUIET_MS = 1_500;        // quiet this long = the avatar's turn is over (gaps inside a reply are under 1 s)
export const REPLY_WAIT_MS = 10_000;  // after a typed turn, how long the floor stays the avatar's if it never starts answering
const EVENT_TTL_S = 10;               // Causeur's default ttl_s

export interface Floor {
  speaking(now: boolean): boolean;
  utterance(): void;
  event(ttlS?: number): () => void;
  say(text: string): Promise<void>;
  close(): void;
}

export function createFloor(sendTurn: (text: string) => Promise<void> | void): Floor {
  let speaking = false, settled = true, closed = false;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  let events: number[] = [];    // deadlines of events the avatar has not started on (each dropped after its ttl)
  const held: string[] = [];    // typed turns waiting for the floor; sent together as one turn
  const eventTimers = new Set<ReturnType<typeof setTimeout>>();

  const settleAfter = (ms: number) => {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => { settled = true; flush(); }, ms);
  };
  const flush = async () => {
    events = events.filter((until) => until > Date.now());
    if (closed || !held.length || !settled || events.length) return;
    settled = false;             // the floor is the avatar's until it has answered,
    settleAfter(REPLY_WAIT_MS);  // or until it plainly isn't going to
    await sendTurn(held.splice(0).join('\n'));
  };

  return {
    // Returns whether this changed anything, for a speaking indicator.
    speaking(now: boolean) {
      if (now === speaking) return false;
      speaking = now;
      if (now) {
        clearTimeout(quietTimer);
        settled = false;
      } else {
        settleAfter(QUIET_MS);
      }
      return true;
    },
    // The oldest waiting event is being spoken, or will be next.
    utterance() { events.shift(); },
    event(ttlS?: number) {
      const ttlMs = (ttlS ?? EVENT_TTL_S) * 1000;
      const until = Date.now() + ttlMs;
      events.push(until);
      const timer = setTimeout(() => { eventTimers.delete(timer); flush(); }, ttlMs + 50);
      eventTimers.add(timer);
      return () => {
        const i = events.indexOf(until);
        if (i >= 0) events.splice(i, 1);
        clearTimeout(timer);
        eventTimers.delete(timer);
        flush();
      };
    },
    say(text: string) {
      held.push(text);
      return flush();
    },
    close() {
      closed = true;
      clearTimeout(quietTimer);
      eventTimers.forEach(clearTimeout);
    },
  };
}
