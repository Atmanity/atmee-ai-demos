// The control booth on speech-to-speech: when the guest is put through, and
// what the producer's cues become. The two avatars hear each other directly
// (the page feeds each one's voice to the other's session), so turn-taking is
// theirs; the booth only sees when each one speaks.
//
// Stages:
//   greeting     the host greets the viewers; the guest's session is not open yet
//   introducing  the greeting is over: the host is directed to introduce tonight's
//                film and roll its trailer
//   trailer      the trailer plays (the page tells the booth when it is over)
//   inviting     back in the studio, the host speaks up on her own (commentary) to
//                react to the trailer and invite the guest onto the screen
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
export type Stage = 'greeting' | 'introducing' | 'trailer' | 'inviting' | 'dialing' | 'on-air' | 'closing' | 'over';

export type Delivery =
  | { to: Role; kind: 'directive'; text: string }   // '' clears it
  | { to: Role; kind: 'commentary'; text: string };

export const TURN_QUIET_MS = 1_500;     // quiet this long after speaking: the speaker's turn is over
export const IDLE_MS = 10_000;          // both quiet this long: the conversation has stalled
export const GREETING_WAIT_MS = 15_000; // a host that has not greeted by then gets on with the intro
export const GOODBYE_WAIT_MS = 15_000;  // a guest that has not said goodbye by then: the show is over anyway
export const NUDGES = 3;                // prompts to pick a stalled conversation back up, before the booth gives up
export const SPEAK_UP_MS = 6_000;
// A host turn that starts this soon after a directive was already being made
// before it arrived: it does not count as the turn that follows it. (Live, a
// wrap landed as a reply was starting; that reply was taken for the wrap and
// the show closed with no goodnight.)
export const DIRECTIVE_LEAD_MS = 2_500;       // after the trailer: no word from the host this long, ask again (it may have been refused)

export interface BoothOptions {
  deliver(delivery: Delivery): void;
  /** Opens the guest's session; the booth is told when it is up (guestLive). */
  dialGuest(): void;
  /** The host's direction after the greeting: introduce the film, roll the trailer. */
  film: string;
  /** Plays the trailer; the page calls trailerDone() when it is over. */
  rollTrailer(): void;
  /** Spoken by the host after the trailer: react, then invite the guest on. */
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
  /** The trailer has finished playing. */
  trailerDone(): void;
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
  let directedAt = 0;        // when, and how long a turn must wait after it to count (0 for commentary)
  let lead = 0;
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
    directedAt = now();
    lead = DIRECTIVE_LEAD_MS;
    opts.deliver({ to: 'host', kind: 'directive', text });
  };

  const greeted = () => {
    if (stage !== 'greeting') return;
    clearTimeout(greetingTimer);
    setStage('introducing');
    direct(opts.film);
  };

  // After the trailer nobody has spoken, so the host speaks up on her own. The
  // commentary is refused while a turn is open (a check-in during the trailer),
  // so it is sent again until she starts speaking, three tries in all.
  let speakUpTimer: ReturnType<typeof setTimeout> | undefined;
  const speakUp = (text: string, tries = 3) => {
    directed = true;
    begun = false;
    // Commentary makes her speak at once: the very next turn is hers.
    directedAt = now();
    lead = 0;
    opts.deliver({ to: 'host', kind: 'commentary', text });
    clearTimeout(speakUpTimer);
    if (tries > 1) speakUpTimer = setTimeout(() => { if (stage === 'inviting' && !begun) speakUp(text, tries - 1); }, SPEAK_UP_MS);
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
        if (stage === 'introducing') {
          setStage('trailer');
          return opts.rollTrailer();
        }
        if (stage === 'inviting') {
          clearTimeout(speakUpTimer);
          return dial();
        }
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
    trailerDone() {
      if (stage !== 'trailer') return;
      setStage('inviting');
      speakUp(opts.invite);
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
        if (role === 'host' && directed && now() - directedAt >= lead) begun = true;
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
      clearTimeout(speakUpTimer);
      clearTimeout(turnTimers.host);
      clearTimeout(turnTimers.guest);
    },
  };
}
