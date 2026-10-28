// The control booth on speech-to-speech: when the guest is put through, and
// what the producer's cues become. The two avatars hear each other directly
// (the page feeds each one's voice to the other's session), so turn-taking is
// theirs; the booth only sees when each one speaks.
//
// Stages:
//   greeting  the host greets the viewers; the guest's session is not open yet
//   dialing   the greeting is over: the host is directed to introduce the guest,
//             and the guest's session opens (its first words reach the host)
//   on-air    both sessions are open and hear each other
//   closing   the host has wrapped up; the guest says goodbye
//   over      the show is done
//
// A cue is a directive on the host's session (causeur.directive.set): the host
// follows it in its next reply and never mentions it. It is cleared once the
// host has finished a turn that began after it. When the conversation has
// stalled (both quiet for IDLE_MS), a cue is spoken at once as commentary.
export type Role = 'host' | 'guest';
export type Stage = 'greeting' | 'dialing' | 'on-air' | 'closing' | 'over';

export type Delivery =
  | { to: Role; kind: 'directive'; text: string }   // '' clears it
  | { to: Role; kind: 'commentary'; text: string };

export const TURN_QUIET_MS = 1_500;     // quiet this long after speaking: the speaker's turn is over
export const IDLE_MS = 10_000;          // both quiet this long: the conversation has stalled
export const GREETING_WAIT_MS = 15_000; // a host that has not greeted by then gets on with the intro

export interface BoothOptions {
  deliver(delivery: Delivery): void;
  /** Opens the guest's session; the booth is told when it is up (guestLive). */
  dialGuest(): void;
  intro: string;
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
    setStage('dialing');
    direct(opts.intro);
    opts.dialGuest();
  };

  const watchIdle = () => {
    clearTimeout(idleTimer);
    if (stage !== 'on-air' || !waiting) return;
    idleTimer = setTimeout(() => {
      if (stage !== 'on-air' || !waiting) return;
      if (!quiet() || now() - lastSound < IDLE_MS) return watchIdle();
      // Stalled: the cue is spoken now, and the directive (if any) goes once the host has.
      opts.deliver({ to: 'host', kind: 'commentary', text: waiting });
      waiting = null;
    }, Math.max(0, lastSound + IDLE_MS - now()));
  };

  const turnOver = (role: Role) => {
    delete turnTimers[role];
    inTurn[role] = false;
    if (role === 'host') {
      if (stage === 'greeting') return greeted();
      if (directed && begun) {
        directed = false;
        waiting = null;
        opts.deliver({ to: 'host', kind: 'directive', text: '' });
        if (wrapping && stage === 'on-air') {
          setStage('closing');
          guestDirected = true;
          opts.deliver({ to: 'guest', kind: 'directive', text: opts.goodbye });
        }
      }
    } else if (stage === 'closing') {
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
      clearTimeout(turnTimers.host);
      clearTimeout(turnTimers.guest);
    },
  };
}
