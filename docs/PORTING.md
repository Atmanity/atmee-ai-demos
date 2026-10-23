# Building an app on the Avatar API

How every app here is built, on the public Avatar API only. `apps/guess-the-city/`
(Postmark) is the reference: read it first.

Two goals hold for every app. It is **a real product**: a name, a brand, a
front door, a screen for every state and a phone layout, never a demo shell.
And its **host acts through tools**: every action the host takes in
conversation is a call into the app, so the host's first reply carries the
app's real outcome.

## The shape of an app

```
apps/<id>/
  server.ts        AppServer (server/app-server.ts): id, title, tagline, appTools
                   (instructions + tools), and the app's routes under /api/apps/<id>/
                   (secrets, model calls, data, media)
  engine/          the app's truth, framework-free TypeScript, with *.test.ts beside it:
    <rules>.ts       game rules, physics, catalogue, planner…
    director.ts      what the host is told: INSTRUCTIONS, TOOLS, the state text, result
                     and event texts
    judge.ts         what words mean, where the app still needs it: the safety net's
                     phrases, a model check of a guess, safety detection
  index.html       the product's title and fonts; loads ./page/main.tsx
  page/            the product's screens (front door, main screen, done moment) and CSS
  avatar.json      the host persona the product was designed for
  README.md        the product, how it works, what the API could not do, the live run
```

The server discovers `apps/<id>/server.ts` and serves the page at `/apps/<id>/`.

## The kit (`src/kit`)

```tsx
const avatar = useAvatar('<id>', { onToolCall, onUserSaid, onAvatarSaid, onLive, onEnded });
avatar.start({ mic })      // call the host; mic false: typing only
avatar.state(text)         // what is on the user's screen; replaces the last (<= 3,858 chars)
avatar.event(text, ttlS)   // something to say in its own words once it has the floor (ttl <= 60)
avatar.note(text)          // standing context (<= 2,000 chars each)
avatar.say(text)           // a typed turn (ChatPanel does this)

<HostVideo avatar name>    // the host's video, captions, speaking ring, "tap to hear"
  <CallStatus avatar name/>  // "Calling Marco…", "Call ended", friendly errors, call again
</HostVideo>
<CallControls avatar />    // microphone and hang up, while live
<ChatPanel avatar name />  // the conversation as bubbles, with a box to type into
useToolNet({ match, run, avatar })   // the safety net (below)
```

Theme the parts with `--call-accent`, `--call-bg`, `--call-font` and friends
(`src/kit/parts.css`) and arrange them in the product's own layout. The kit
speaks of calling a host by name, never of sessions or avatars. `<html>`
carries `data-call` (the phase) and `data-speaking`; every finished line is a
window `atmee:line` event (the live-test harness uses both).

## Where truth lives

- **The app decides; the host performs.** Rules, scores, legality, facts and
  plans are engine code. The host is told results, through tool results and
  events.
- **Secrets stay on the server.** If the page must not know something yet (an
  answer, a hidden card, the next line of working), the engine runs in
  `server.ts` and the page sees a masked view. Otherwise it can run in the page.

## Tools: the host calls the app

Declare them on the server; answer them in the page:

```ts
// apps/<id>/server.ts
appTools: { instructions: INSTRUCTIONS, tools: TOOLS },

// engine/director.ts
{ type: 'function', name: 'check_guess', description: 'Judges the player\'s answer. Call it whenever the player names a place as their guess.',
  parameters: { type: 'object', properties: { place: { type: 'string' } }, required: ['place'] },
  'x-atmee': { mode: 'await', timeoutSeconds: 12 } }

// page/App.tsx
useAvatar('<id>', { onToolCall: async ({ name, arguments: args }) => (await post('/tool', { name, args })).result });
```

- `await` holds the host's reply (at most one filler line) until the page
  answers, 1 to 28 s; `notify` sends the call and goes on. Slow work is
  `notify`, or `await` returning "started", then an event when it lands.
- Results are short facts plus how to say them. A result never asks the host
  to act on its own initiative: "ask whether they want another game; start one
  only if they say so". Resetting tools say "only when the user asks".
- Instructions (<= 4,000 characters): the host's role, and that the screen
  changes only when it calls a tool; it never invents an outcome, even one it
  thinks it knows.
- Buttons act at once and the host is told by an event ("The player pressed
  …"). Typed lines go to the host, which calls the tools for them too.
- Tools are called only on sessions that run on Causeur; a behaviour-module
  session accepts them and never calls them.

### The safety net

Live, the host sometimes narrates an action ("let's move on!") without calling
the tool. For actions that are safe to repeat (give up, next, start over), give
`useToolNet` the phrases that clearly ask for them; if the host makes no such
call within 7 s, the page does it and tells the host, who corrects itself.
Never for actions with a cost if doubled (a clue that costs a point, a bet, an
add to a list).

### Safety-critical detection

Where a missed moment could hurt someone (a real emergency in a first-aid
drill, an unsafe condition in a workout), the page detects it itself, at once,
and shows its screen; a tool the host may call is a second path, not the only
one.

## What the live runs taught

- **Tools ground the first reply.** Asked for a secret only the page knew, the
  host called the tool and said it in its first reply; through `state` alone the
  same question failed. Postmark's verdicts, clues and reveals all came from
  the game.
- **The host decides when to call.** Most requests became calls within about
  3 s; some were narrated instead. The safety net covers the repeatable ones;
  the rest rely on the instructions and the screen.
- **What was in `state` before the user spoke shapes the reply too**: a board,
  a score, a rising time. Questions about the screen need no tool.
- **The recogniser varies.** "Raise to five" arrived as "Raised to five.",
  "Lob it" as "Lobbied". Phrase matchers (the safety net, safety detection)
  must read the variants.

## Product standards

- A distinctive product name, tagline and logo mark; the host's name from
  `avatar.json` throughout.
- Its own palette and type (Google Fonts linked in `index.html`), specific to
  the subject. Not the generic looks: cream and serif, near-black and neon,
  purple gradients, emoji icons, every block a rounded card.
- A front door (what it is, how it works, voice and typing calls to action),
  the main screen with the host part of the layout, empty, loading, ended and
  failed states, and the product's own "done" moment.
- Copy for users: never session, avatar, API, demo or sample on screen.
- Works at phone width; visible focus; reduced motion respected.

## Tests

- The engine's own tests, ported with their hard cases.
- The director: tools fit the API (names, count, sizes, timeouts, reserved
  names), instructions <= 4,000 and name every tool, state <= 3,858 and no
  secret in it.
- The safety net's phrases, including the recogniser's variants.
- `npm test` and `npm run typecheck` stay green.

## README.md (per app)

The product in a paragraph; "How it works" as a table; "What the API could not
do", each item seen or expected after the live run; "Tested" with the live run
record.
