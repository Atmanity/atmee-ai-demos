// The control booth: when the guest goes on air, and what the producer's
// cues become.
//
// The host and the guest are each in a call of their own with the page. Once
// the guest is put through, the page plays each avatar's voice into the
// other's call as its microphone, so they hear each other and take turns as
// they would with a person. Hearing each other is also what keeps them from
// speaking up into a silence that is really the other one talking (the
// avatars check in after about ten seconds of quiet).
//
// The show runs in stages:
//   greeting  the host says its own greeting to the viewers; the guest is off air
//   dialing   the greeting is done and the guest's call is not up yet
//   on-air    the guest is put through and the host is cued to introduce them
//   closing   the host has wrapped up; the guest says goodbye
//   over      the show is done
//
// The producer's cues: while the two are talking, a cue becomes a one-turn
// addition to the host's state (a live directive it follows and never
// mentions), so the host reacts to the guest and then moves on, in its next
// turn; the directive is taken off once that turn is over. When the floor has
// been quiet for IDLE_MS (a stall), the cue goes out as an event instead and the host
// speaks up on its own.
export type Role = 'host' | 'guest';
export type Stage = 'greeting' | 'dialing' | 'on-air' | 'closing' | 'over';

export type Delivery =
  | { to: Role; kind: 'event'; text: string }
  | { to: Role; kind: 'state'; text: string };

export const QUIET_MS = 1_500;         // an avatar quiet this long after its last words has finished its turn
// Both quiet this long: nobody is about to answer and the conversation has stalled. An
// avatar can take several seconds to start a reply, so it is long; a shorter one
// spoke a cue over the reply that was on its way.
export const IDLE_MS = 10_000;
export const GREETING_WAIT_MS = 12_000; // a host that says nothing this long after arriving has no greeting coming

export interface BoothOptions {
  deliver(delivery: Delivery): void;
  /** The guest goes on screen and the two hear each other. */
  patchIn(): void;
  /** Each avatar's standing state, which a one-turn directive is added to. */
  states: Record<Role, string>;
  intro: string;
  wrap: string;
  goodbye: string;
  onStage?(stage: Stage): void;
  now?: () => number;
  quietMs?: number;
  idleMs?: number;
  greetingWaitMs?: number;
}

export interface Booth {
  readonly stage: Stage;
  hostLive(): void;
  guestLive(): void;
  /** A finished utterance of one avatar. */
  said(role: Role, text: string): void;
  speaking(role: Role, now: boolean): void;
  /** A producer's cue for the host's next turn. */
  cue(text: string): void;
  /** Wrap the segment up: the host closes, the guest says goodbye. */
  wrap(): void;
  close(): void;
}

export const directed = (state: string, directive: string) => `${state}\n\nFor your next turn only: ${directive}`;

export function createBooth(opts: BoothOptions): Booth {
  const now = opts.now ?? Date.now;
  const quietMs = opts.quietMs ?? QUIET_MS;
  const idleMs = opts.idleMs ?? IDLE_MS;
  const greetingWaitMs = opts.greetingWaitMs ?? GREETING_WAIT_MS;

  let stage: Stage = 'greeting';
  const speakingNow: Record<Role, boolean> = { host: false, guest: false };
  const pending: Record<Role, boolean> = { host: false, guest: false };  // words heard, the turn not yet over
  const turnTimers: Partial<Record<Role, ReturnType<typeof setTimeout>>> = {};
  let lastSound = now();               // when either one last spoke
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let greetingTimer: ReturnType<typeof setTimeout> | undefined;
  let guestReady = false;
  let greeted = false;
  // The cue waiting for the host's next turn, and whether that turn has begun.
  let directive: string | null = null;
  let directing = false;   // the host's state carries the directive now
  let begun = false;       // the host started its directed turn
  let wrapping = false;

  const setStage = (next: Stage) => {
    if (stage === next) return;
    stage = next;
    opts.onStage?.(next);
  };

  const quiet = () => !speakingNow.host && !speakingNow.guest && !pending.host && !pending.guest;

  const tryPatch = () => {
    if (stage !== 'dialing' || !guestReady) return;
    setStage('on-air');
    opts.patchIn();
    // The guest hears the intro live: it is cued only once the two hear each other.
    opts.deliver({ to: 'host', kind: 'event', text: opts.intro });
    lastSound = now();
    watchIdle();
  };

  const greetingDone = () => {
    if (greeted) return;
    greeted = true;
    clearTimeout(greetingTimer);
    setStage('dialing');
    tryPatch();
  };

  // A waiting cue goes out as an event once the floor has been quiet for idleMs.
  const watchIdle = () => {
    clearTimeout(idleTimer);
    if (stage !== 'on-air' || !directive || directing) return;
    const wait = Math.max(0, lastSound + idleMs - now());
    idleTimer = setTimeout(() => {
      if (stage !== 'on-air' || !directive || directing) return;
      if (!quiet() || now() - lastSound < idleMs) return watchIdle();
      const text = directive;
      directive = null;
      opts.deliver({ to: 'host', kind: 'event', text });
      // The wrap's turn is the next one the host starts, now from the event.
      if (wrapping) { directing = true; begun = false; }
    }, wait);
  };

  const direct = () => {
    if (!directive || directing) return;
    directing = true;
    begun = false;
    opts.deliver({ to: 'host', kind: 'state', text: directed(opts.states.host, directive) });
  };

  const turnOver = (role: Role) => {
    delete turnTimers[role];
    pending[role] = false;
    if (role === 'host') {
      if (stage === 'greeting') return greetingDone();
      if (directing && begun) {
        // The directed turn is over: the directive comes off, and a wrap hands over to the guest's goodbye.
        directing = false;
        directive = null;
        opts.deliver({ to: 'host', kind: 'state', text: opts.states.host });
        if (wrapping && stage === 'on-air') {
          setStage('closing');
          opts.deliver({ to: 'guest', kind: 'state', text: directed(opts.states.guest, opts.goodbye) });
        }
      }
    } else if (stage === 'closing') {
      setStage('over');
    }
    watchIdle();
  };

  const scheduleTurnOver = (role: Role) => {
    clearTimeout(turnTimers[role]);
    if (speakingNow[role] || !pending[role]) return;
    turnTimers[role] = setTimeout(() => turnOver(role), quietMs);
  };

  return {
    get stage() { return stage; },
    hostLive() {
      clearTimeout(greetingTimer);
      greetingTimer = setTimeout(() => { if (stage === 'greeting' && !speakingNow.host && !pending.host) greetingDone(); }, greetingWaitMs);
    },
    guestLive() {
      guestReady = true;
      tryPatch();
    },
    said(role, text) {
      if (stage === 'over' || !text.trim()) return;
      // Off air, the guest's words (its own greeting, a check-in) are nobody's turn.
      if (role === 'guest' && (stage === 'greeting' || stage === 'dialing')) return;
      pending[role] = true;
      lastSound = now();
      scheduleTurnOver(role);
    },
    speaking(role, isSpeaking) {
      if (speakingNow[role] === isSpeaking) return;
      speakingNow[role] = isSpeaking;
      if (role === 'guest' && (stage === 'greeting' || stage === 'dialing')) return;
      lastSound = now();
      if (isSpeaking) {
        clearTimeout(turnTimers[role]);
        delete turnTimers[role];
        pending[role] = true;
        if (role === 'host' && directing) begun = true;
        return;
      }
      scheduleTurnOver(role);
    },
    cue(text) {
      if (stage === 'closing' || stage === 'over' || wrapping || !text.trim()) return;
      if (directing) {
        // A second cue before the first was spoken: both go into the one directive.
        directive = `${directive} ${text.trim()}`;
        opts.deliver({ to: 'host', kind: 'state', text: directed(opts.states.host, directive) });
        return;
      }
      directive = directive ? `${directive} ${text.trim()}` : text.trim();
      if (stage !== 'on-air') return;
      // Mid-conversation the cue rides on the host's next turn; on a quiet floor it is spoken at once.
      if (quiet() && now() - lastSound >= idleMs) return watchIdle();
      direct();
    },
    wrap() {
      if (wrapping || stage === 'closing' || stage === 'over') return;
      wrapping = true;
      // Before the guest is on, there is nothing to wrap: the show is simply over.
      if (stage !== 'on-air') return setStage('over');
      directive = opts.wrap;
      if (directing) {
        opts.deliver({ to: 'host', kind: 'state', text: directed(opts.states.host, directive) });
        return;
      }
      if (quiet() && now() - lastSound >= idleMs) return watchIdle();
      direct();
    },
    close() {
      setStage('over');
      clearTimeout(idleTimer);
      clearTimeout(greetingTimer);
      clearTimeout(turnTimers.host);
      clearTimeout(turnTimers.guest);
    },
  };
}
