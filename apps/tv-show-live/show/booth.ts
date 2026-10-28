// The control booth on speech-to-speech: when the guest is put through, and
// what the producer's cues become. The two avatars hear each other directly
// (the page feeds each one's voice to the other's session), so turn-taking is
// theirs; the booth only sees when each one speaks.
//
// Stages:
//   greeting  the host greets the viewers; the guest's session is not open yet
//   inviting  the greeting is over: the host is directed to tell the viewers who
//             tonight's guest is and to invite them onto the big screen
//   dialing   the invitation is over: the guest's session opens (its first words
//             reach the host) and the host is directed to welcome them
//   on-air    both sessions are open and hear each other
//   closing   the host has wrapped up; the guest says goodbye
//   over      the show is done
//
// A cue is a directive on the host's session (causeur.directive.set): the host
// follows it in its next reply and never mentions it. It is cleared once the
// host has finished a turn that began after it. When the conversation has
// stalled (both quiet for IDLE_MS), a cue is spoken at once as commentary.
export type Role = 'host' | 'guest';
export type Stage = 'greeting' | 'inviting' | 'dialing' | 'on-air' | 'closing' | 'over';

export type Delivery =
  | { to: Role; kind: 'directive'; text: string }   // '' clears it
  | { to: Role; kind: 'commentary'; text: string };

export const TURN_QUIET_MS = 1_500;     // quiet this long after speaking: the speaker's turn is over
export const IDLE_MS = 10_000;          // both quiet this long: the conversation has stalled
export const GREETING_WAIT_MS = 15_000; // a host that has not greeted by then gets on with the intro
export const GOODBYE_WAIT_MS = 15_000;  // a guest that has not said goodbye by then: the show is over anyway
export const NUDGES = 3;                // prompts to pick a stalled conversation back up, before the booth gives up

export interface BoothOptions {
  deliver(delivery: Delivery): void;
  /** Opens the guest's session; the booth is told when it is up (guestLive). */
  dialGuest(): void;
  /** The host's direction after the greeting: invite the guest on. */
  invite: string;
  /** The host's direction once the guest is dialled: welcome them, first question. */
  welcome: string;
  /** Spoken by the host when the conversation has stalled with nothing waiting. */
  nudge: string;
  wrap: string;
  goodbye: string;
  onStage?(stage: Stage): void;
  now?: () => number;
}

export interface Booth {
  readonly stage: Stage;
  hostLive(): void;
  guestLive(): void;
  speaking(role: Role, on: boolean): void;
  cue(text: string): void;
  wrap(): void;
  close(): void;
}

export function createBooth(opts: BoothOptions): Booth {
  const now = opts.now ?? Date.now;
  let stage: Stage = 'greeting';
  const talking: Record<Role, boolean> = { host: false, guest: false };
  const turnTimers: Partial<Record<Role, ReturnType<typeof setTimeout>>> = {};
  const inTurn: Record<Role, boolean> = { host: false, guest: false };   // spoke, the turn not yet over
  let lastSound = now();
  let greetingTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let directed = false;      // the host carries a directive now
  let begun = false;         // the host started a turn after it
  let waiting: string | null = null;   // a cue for a stalled floor
  let wrapping = false;
  let guestDirected = false;
  let nudges = 0;            // prompts in this stall; any voice resets it
  let goodbyeTimer: ReturnType<typeof setTimeout> | undefined;

  const setStage = (next: Stage) => {
    if (stage === next) return;
    stage = next;
    opts.onStage?.(next);
  };
  const quiet = () => !talking.host && !talking.guest && !inTurn.host && !inTurn.guest;

  const direct = (text: string) => {
    directed = true;
    begun = false;
    opts.deliver({ to: 'host', kind: 'directive', text });
  };

  const greeted = () => {
    if (stage !== 'greeting') return;
    clearTimeout(greetingTimer);
    setStage('inviting');
    direct(opts.invite);
  };

  // The invitation is spoken: the guest comes on, and the host's next turn welcomes them.
  const dial = () => {
    setStage('dialing');
    direct(opts.welcome);
    opts.dialGuest();
  };

  // A stalled conversation (both quiet for IDLE_MS on air): the waiting cue is spoken
  // now, or else the host is prompted to pick it back up. A prompt can be refused (the
  // session may be mid-turn) or come to nothing (a guest that went quiet when asked to
  // wait), so it is tried again after each further IDLE_MS of quiet, NUDGES times.
  const watchIdle = () => {
    clearTimeout(idleTimer);
    if (stage !== 'on-air' || nudges >= NUDGES) return;
    const since = Math.max(lastSound, lastNudge);
    idleTimer = setTimeout(() => {
      if (stage !== 'on-air') return;
      if (!quiet() || now() - Math.max(lastSound, lastNudge) < IDLE_MS) return watchIdle();
      opts.deliver({ to: 'host', kind: 'commentary', text: waiting ?? opts.nudge });
      waiting = null;
      nudges++;
      lastNudge = now();
      watchIdle();
    }, Math.max(0, since + IDLE_MS - now()));
  };
  let lastNudge = 0;

  const turnOver = (role: Role) => {
    delete turnTimers[role];
    inTurn[role] = false;
    if (role === 'host') {
      if (stage === 'greeting') return greeted();
      if (directed && begun) {
        directed = false;
        waiting = null;
        opts.deliver({ to: 'host', kind: 'directive', text: '' });
        if (stage === 'inviting') return dial();
        if (wrapping && stage === 'on-air') {
          setStage('closing');
          guestDirected = true;
          opts.deliver({ to: 'guest', kind: 'directive', text: opts.goodbye });
          goodbyeTimer = setTimeout(() => { if (stage === 'closing') setStage('over'); }, GOODBYE_WAIT_MS);
        }
      }
    } else if (stage === 'closing') {
      clearTimeout(goodbyeTimer);
      if (guestDirected) opts.deliver({ to: 'guest', kind: 'directive', text: '' });
      setStage('over');
    }
    watchIdle();
  };

  return {
    get stage() { return stage; },
    hostLive() {
      clearTimeout(greetingTimer);
      greetingTimer = setTimeout(() => { if (stage === 'greeting' && quiet()) greeted(); }, GREETING_WAIT_MS);
    },
    guestLive() {
      if (stage === 'dialing') setStage('on-air');
      watchIdle();
    },
    speaking(role, on) {
      if (talking[role] === on) return;
      talking[role] = on;
      lastSound = now();
      nudges = 0;
      if (on) {
        clearTimeout(turnTimers[role]);
        delete turnTimers[role];
        inTurn[role] = true;
        if (role === 'host' && directed) begun = true;
        return;
      }
      clearTimeout(turnTimers[role]);
      turnTimers[role] = setTimeout(() => turnOver(role), TURN_QUIET_MS);
    },
    cue(text) {
      if (stage === 'closing' || stage === 'over' || wrapping || !text.trim()) return;
      const t = text.trim();
      if (stage !== 'on-air') return direct(t);
      direct(t);
      // Also spoken at once if the floor has gone quiet, so a stalled show moves on.
      waiting = t;
      watchIdle();
    },
    wrap() {
      if (wrapping || stage === 'closing' || stage === 'over') return;
      wrapping = true;
      if (stage !== 'on-air') return setStage('over');
      direct(opts.wrap);
      waiting = opts.wrap;
      watchIdle();
    },
    close() {
      setStage('over');
      clearTimeout(greetingTimer);
      clearTimeout(idleTimer);
      clearTimeout(goodbyeTimer);
      clearTimeout(turnTimers.host);
      clearTimeout(turnTimers.guest);
    },
  };
}
