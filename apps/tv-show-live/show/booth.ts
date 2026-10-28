// The control booth on speech-to-speech: when the guest is put through, and
// what the producer's cues become. The two avatars hear each other directly
// (the page feeds each one's voice to the other's session), so turn-taking is
// theirs; the booth only sees when each one speaks.
//
// Stages:
//   greeting     the host greets the viewers; the guest's session is not open yet
//   introducing  the greeting is over: the host speaks up on her own (commentary)
//                to introduce tonight's film and roll its trailer
//   trailer      the trailer plays (the page tells the booth when it is over)
//   holding      the trailer is over but the guest is not ready yet (invented, still
//                being built): the host keeps the viewers company, speaking up on
//                her own every HOLD_MS, until the page says the guest is ready
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
// A handover to a new guest runs as a real show's would: the host says goodbye
// to the guest on air (a directive on her next turn); the guest says goodbye
// back (a directive on theirs; GOODBYE_WAIT_MS at most); the page retires
// them; the host turns to the viewers and introduces the next guest
// (commentary); and once she has, the page puts the new guest through.
//
// The texts may be functions, read when they are used: an invented guest's
// name is only known once it has been written, after the show has begun.
export type Role = 'host' | 'guest';
export type Stage = 'greeting' | 'introducing' | 'trailer' | 'holding' | 'inviting' | 'dialing' | 'on-air' | 'closing' | 'over';
export type Text = string | (() => string);
const read = (t: Text) => (typeof t === 'function' ? t() : t);

export type Delivery =
  | { to: Role; kind: 'directive'; text: string }   // '' clears it
  | { to: Role; kind: 'commentary'; text: string };

export const TURN_QUIET_MS = 1_500;     // quiet this long after speaking: the speaker's turn is over
export const IDLE_MS = 10_000;          // both quiet this long: the conversation has stalled
export const GREETING_WAIT_MS = 15_000; // a host that has not greeted by then gets on with the intro
export const GOODBYE_WAIT_MS = 15_000;  // a guest that has not said goodbye by then: the show is over anyway
export const NUDGES = 3;                // prompts to pick a stalled conversation back up, before the booth gives up
export const SPEAK_UP_MS = 6_000;
export const HOLD_MS = 40_000;          // while holding for the guest: the host fills this often (25 s was a filler a breath)
// A host turn that starts this soon after a directive was already being made
// before it arrived: it does not count as the turn that follows it. (Live, a
// wrap landed as a reply was starting; that reply was taken for the wrap and
// the show closed with no goodnight.)
export const DIRECTIVE_LEAD_MS = 2_500;       // after the trailer: no word from the host this long, ask again (it may have been refused)

export interface BoothOptions {
  deliver(delivery: Delivery): void;
  /** Opens the guest's session; the booth is told when it is up (guestLive). */
  dialGuest(): void;
  /** Spoken by the host after the greeting: introduce the film, roll the trailer. */
  film: string;
  /** Plays the trailer; the page calls trailerDone() when it is over. */
  rollTrailer(): void;
  /** Spoken by the host after the trailer: react, then invite the guest on. */
  invite: Text;
  /** Whether the guest can be put through now; absent, always. */
  guestReady?(): boolean;
  /** Spoken after the trailer when the guest is not ready: react, say they join in a moment. */
  hold?: Text;
  /** Spoken while still holding, every HOLD_MS. */
  holdMore?: Text;
  /** Spoken once the guest is ready after a hold: bring them on now. */
  inviteNow?: Text;
  /** The host's direction once the guest is dialled: welcome them, first question. */
  welcome: Text;
  /** Spoken by the host when the conversation has stalled with nothing waiting. */
  nudge: Text;
  wrap: Text;
  goodbye: string;
  onStage?(stage: Stage): void;
  now?: () => number;
}

export interface HandoverSteps {
  /** The host's goodbye to the guest on air. */
  farewell: string;
  /** The guest's goodbye back. */
  goodbye: string;
  /** The host to the viewers: a word, then the next guest introduced (not greeted). */
  bridge: string;
  /** The guest has said goodbye: end their line and face. */
  retire(): void;
  /** The host has introduced the next guest: put them through. */
  bringOn(): void;
}

export interface Booth {
  readonly stage: Stage;
  hostLive(): void;
  guestLive(): void;
  /** The trailer has finished playing. */
  trailerDone(): void;
  /** The guest the booth was holding for is ready to be put through. */
  guestReady(): void;
  /** On air: hand over to the next guest, step by step (see the top of this file). */
  handover(steps: HandoverSteps): void;
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
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  // A handover under way: its steps, and which one it is at.
  let handing: { steps: HandoverSteps; at: 'farewell' | 'goodbye' | 'bridge' } | null = null;
  let handTimer: ReturnType<typeof setTimeout> | undefined;
  const afterGoodbye = () => {
    if (!handing || handing.at !== 'goodbye') return;
    clearTimeout(handTimer);
    opts.deliver({ to: 'guest', kind: 'directive', text: '' });
    handing.at = 'bridge';
    handing.steps.retire();
    speakUp(handing.steps.bridge);
  };

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

  // After her greeting, as after the trailer, nobody else has spoken, so the host
  // speaks up on her own: a directive would wait for a next turn that only her
  // session's check-in brings, a long silence on air. The commentary is refused
  // while a turn is open, so it is sent again until she starts speaking, three
  // tries in all.
  let speakUpTimer: ReturnType<typeof setTimeout> | undefined;
  const speakUp = (text: string, tries = 3) => {
    const at = stage;
    directed = true;
    begun = false;
    // Commentary makes her speak at once: the very next turn is hers.
    directedAt = now();
    lead = 0;
    opts.deliver({ to: 'host', kind: 'commentary', text });
    clearTimeout(speakUpTimer);
    if (tries > 1) speakUpTimer = setTimeout(() => { if (stage === at && !begun) speakUp(text, tries - 1); }, SPEAK_UP_MS);
  };

  const greeted = () => {
    if (stage !== 'greeting') return;
    clearTimeout(greetingTimer);
    setStage('introducing');
    speakUp(opts.film);
  };

  // The invitation is spoken: the guest comes on, and the host's next turn welcomes them.
  const dial = () => {
    setStage('dialing');
    direct(read(opts.welcome));
    opts.dialGuest();
  };

  // Holding for a guest still being made: a line now, and another every HOLD_MS of it.
  const hold = () => {
    setStage('holding');
    speakUp(read(opts.hold ?? opts.invite));
    const more = () => {
      holdTimer = setTimeout(() => {
        if (stage !== 'holding') return;
        if (quiet()) speakUp(read(opts.holdMore ?? opts.hold ?? opts.invite), 1);
        more();
      }, HOLD_MS);
    };
    more();
  };
  const invite = (text: string) => {
    clearTimeout(holdTimer);
    setStage('inviting');
    speakUp(text);
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
      opts.deliver({ to: 'host', kind: 'commentary', text: waiting ?? read(opts.nudge) });
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
          clearTimeout(speakUpTimer);
          setStage('trailer');
          return opts.rollTrailer();
        }
        if (stage === 'inviting') {
          clearTimeout(speakUpTimer);
          return dial();
        }
        if (handing && stage === 'on-air') {
          if (handing.at === 'farewell') {
            handing.at = 'goodbye';
            opts.deliver({ to: 'guest', kind: 'directive', text: handing.steps.goodbye });
            handTimer = setTimeout(afterGoodbye, GOODBYE_WAIT_MS);
          } else if (handing.at === 'bridge') {
            clearTimeout(speakUpTimer);
            const steps = handing.steps;
            handing = null;
            steps.bringOn();
          }
        }
        if (wrapping && stage === 'on-air') {
          setStage('closing');
          guestDirected = true;
          opts.deliver({ to: 'guest', kind: 'directive', text: opts.goodbye });
          goodbyeTimer = setTimeout(() => { if (stage === 'closing') setStage('over'); }, GOODBYE_WAIT_MS);
        }
      }
    } else if (handing?.at === 'goodbye') {
      return afterGoodbye();
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
      if (opts.guestReady && !opts.guestReady()) return hold();
      invite(read(opts.invite));
    },
    guestReady() {
      if (stage === 'holding') invite(read(opts.inviteNow ?? opts.invite));
    },
    handover(steps) {
      if (stage !== 'on-air' || wrapping || handing) return;
      handing = { steps, at: 'farewell' };
      direct(steps.farewell);
      waiting = steps.farewell;
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
      if (handing?.at === 'farewell') handing = null;   // not yet begun: the wrap takes its place
      direct(read(opts.wrap));
      waiting = read(opts.wrap);
      watchIdle();
    },
    close() {
      setStage('over');
      clearTimeout(greetingTimer);
      clearTimeout(idleTimer);
      clearTimeout(goodbyeTimer);
      clearTimeout(speakUpTimer);
      clearTimeout(holdTimer);
      clearTimeout(handTimer);
      clearTimeout(turnTimers.host);
      clearTimeout(turnTimers.guest);
    },
  };
}
