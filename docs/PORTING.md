# Porting a mini-app onto the Avatar API

How the mini-apps from `Atmanity/apps` are rebuilt here, on the public Avatar
API only. `apps/guess-the-city/` is the reference: read it first; every other
app follows its shape.

## The shape of an app

```
apps/<id>/
  server.ts        AppServer (server/app-server.ts): id, title, tagline, optional conductor,
                   and the app's own routes under /api/apps/<id>/ (model calls, data, media,
                   anything that must not reach the browser)
  engine/          the app's truth, framework-free TypeScript, with *.test.ts beside it:
    types.ts         what the server and the page share
    <rules>.ts       the ported engine (game rules, physics, catalogue, planner…)
    judge.ts         turning words into actions: rules first, a model call only when needed
    director.ts      what the avatar is told: NOTES (standing rules), the state text, event texts
  index.html       loads ./page/main.tsx
  page/            React: App.tsx (wires the kit to the engine), the ported panel components, CSS
  avatar.json      the persona this app wants its avatar to have (see "The avatar" below)
  README.md        what the app does, how it maps to the API, and what the API could not do
```

The server discovers `apps/<id>/server.ts` by itself and the page is served at
`/apps/<id>/`. Nothing outside your folder needs editing.

## What the kit gives you (`src/kit`)

```tsx
const avatar = useAvatar('<id>', { onUserSaid(text, how) {}, onAvatarSaid(text) {}, onLive() {} });
avatar.state(text)        // what is true now; replaces the last; kept and re-sent on arrival
avatar.note(text)         // standing context (<= 2,000 chars each); call once per text
avatar.event(text, ttlS)  // something to say in its own words once it has the floor (ttl <= 60)
avatar.say(text)          // a typed user turn (held while the avatar has the floor)
avatar.record(text)       // show a typed line in the transcript without sending it
avatar.mute() / unmute()  // the avatar hears silence; NOTE: the app then gets no transcript either
<AvatarStage avatar name lobby />  <Composer avatar onSubmit />  <Transcript avatar names />
```

`onUserSaid(text, 'spoken')` is the user's speech as the avatar's recogniser
heard it (final utterances only). `onUserSaid(text, 'typed')` fires for
`avatar.say`. The avatar hears the user's microphone itself; you never forward
speech.

## Where truth lives

- **The engine decides; the avatar performs.** Rules, scores, legality, facts,
  plans: all engine code, never the avatar. The avatar is told results.
- **Secrets stay on the server.** If the page must not know something yet (an
  answer, a hidden card), the engine runs in `server.ts` and the page sees a
  masked view (guess-the-city). Otherwise the engine can run in the page.
- **No function calling.** The avatar cannot call your code or hand you data.
  Anything the old agent did with a tool call, your code does: from a button, a
  typed line, or the user's speech through `judge.ts`.

## The three inputs, and the order of things

1. **Buttons and controls** (best): act in the engine, then `state`, then
   `event`. The avatar's next words are grounded. Give every action a control.
2. **Typed lines**: judge first. If it was an app action, act and send an
   `event`, and `avatar.record(text)`; otherwise `avatar.say(text)` so the
   avatar answers it with the state you already sent.
3. **Speech**: `onUserSaid(text, 'spoken')` → judge → act → `state` + `event`.
   The avatar has ALREADY started its own reply to that utterance (the final
   transcript arrives ~1 s after the user stops; the reply was already being
   made). So the avatar's first reply cannot know the outcome:
   - put a standing rule in `NOTES`: "you do not decide X; when the user asks
     for X, say a few words like 'let's see' and stop; the app tells you the
     result a moment later. If it already told you, carry on from it."
   - send the outcome as an `event` (the avatar says it in its own words).
   - Expect both orders in practice (holding line then result, or result then
     holding line). That is a platform gap; note it, don't fight it.

### Pre-stage what the avatar may say next

Because the avatar answers a spoken request before your app can act, give it
the answer in advance when the request is predictable and the answer is not a
secret: put it in `state` with the rule "only when the user asks". Guess the
City stages the next clue ("If the player asks for a clue, give them this one,
in your own words: …"), so "can I have a clue?" gets the real clue at once;
the app then marks it given and sends no event for a spoken request (only for
a button press, which the avatar cannot see). Without staging, the avatar made
up clues ("home to the Burj Khalifa" for New York) in 2 of 3 live runs despite
a standing note forbidding it. Outcomes that depend on a secret (is this guess
right?) cannot be staged: that race stays.

### What the live runs taught

Fourteen apps run live on staging (each README has its run) settled these:

- **Staged answers work.** Whatever was in `state` or a note before the user
  spoke shaped the avatar's immediate reply in every app: Orion's rising time,
  the quadratic's next line, the pot, the no-advice refusal, the emergency
  line. Only what you send after the transcript is too late for that reply.
- **A holding line is a promise only the app can keep.** When the judge missed
  a line, the avatar had already said "let's see" or "let me pull that up", and
  nothing followed. The misses were the recogniser's variants ("Raise to five"
  heard as "Raised to five.", "Lob it" as "Lobbied"), so test the judge on
  variants, not only on the clean sentence.
- **Tell every refusal or "unavailable" as an event, even a staged one.** The
  travel guide had "no news source" staged and still answered "let me pull
  that up for you right now!". Prefix such events "You may already have
  answered them; do not repeat yourself." Then the worst case is the answer
  said twice, which beats never.
- **The avatar invents what it cannot know yet** (the next spot, how the shot
  will land, "putting ZQXWQ up"). Anything not staged comes back as an
  invention, then your event. Stage it if it is predictable; otherwise the
  screen is the truth.

### App tools: the avatar calls the app

Where a session runs on Causeur, the avatar can call the app instead of racing
it. Declare the functions on the app's server and answer them in the page:

```ts
// apps/<id>/server.ts
appTools: {
  instructions: 'When the player names a city, call check_guess and say only what it returns.',
  tools: [{ type: 'function', name: 'check_guess', description: 'Judges a guess.',
    parameters: { type: 'object', properties: { guess: { type: 'string' } }, required: ['guess'] },
    'x-atmee': { mode: 'await', timeoutSeconds: 8 } }],
},

// apps/<id>/page/App.tsx
useAvatar('<id>', { onToolCall: async ({ name, arguments: args }) => {
  if (name === 'check_guess') return (await act({ text: String(args.guess) })).verdict;
} });
```

`await` holds the avatar's reply (at most one filler line) until the page
answers; `notify` does not wait. A returned string goes back as it is, anything
else as JSON; a throw reaches the avatar as "error: …". Keep a control for
every action anyway: a tool is called only when the avatar decides to.

## Telling the avatar (director.ts)

- `NOTES`: the app's rules for the avatar, condensed from the old
  `persona.py`/`INSTRUCTIONS` (keep the hard-won "never do X" rules). Several
  notes are fine; each <= 2,000 characters; sent once per session.
- `state`: a plain-sentence description of what is on the user's screen and
  every fact the avatar may need to answer questions (scores, the current step,
  numbers it must not invent). <= 3,858 characters. Never put a secret the user
  must not hear yet into `state` or a note.
- `event` texts: one per outcome, written as an instruction about a fact: "The
  player asked for a clue. Give them exactly this clue in your own words: …".
  Short ttl for things that go stale (10–20 s), up to 60 for important ones.
- The opening: an `event` once the app is ready (the kit delivers events queued
  before the avatar arrives).
- The avatar keeps its own persona and greeting (per avatar, not per session).
  It greets as itself first; your opening event follows.

## Tests

- Port the old engine tests (Python `tests/` → vitest) and the panel's pure
  tests. Test `judge.ts` with real phrasings, `director.ts` for limits and for
  never leaking a secret.
- `npm test`, `npm run typecheck` must pass.
- Live test: `tools/live-test/harness.js`, imported into the app page, gives a
  synthetic microphone (with a real mic's noise floor) fed from WAV files made
  by `tools/live-test/say.sh <name> "<sentence>"`, plus `speak()`, `type()`,
  `click()` and `waitTurn()` (waits for the avatar to finish, like a person
  would). It never touches a real microphone or camera.

## The avatar (avatar.json)

The persona the app was designed for: `name`, `personality`, `scenario`,
`greeting`, `guardrails` (the API's persona fields). A developer creates or
updates their app's avatar with it. In this repo every app runs on a shared
test avatar (`AVATAR_DEFAULT`), whose own persona introduces itself first; the
app's role comes from `NOTES` and `state`.

## README.md (per app)

1. What it is (2 lines) and how to use it.
2. How it maps to the API (a short table: feature → mechanism).
3. **What the API could not do** — concrete, observed where possible (these
   feed docs/API-GAPS.md).
4. How it was tested (unit + the live run, with what the avatar said).
