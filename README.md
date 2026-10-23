# atmee-usecase-demos

Five sample apps built purely on the Atmee Avatar API (v2), with one small Node server and no
changes to the platform. They cover the target-app checklist from the product thread: a
recruiter call, internal training, a presence/companion, an interactive story and a live
stream.

| app | product | what it shows | README |
|---|---|---|---|
| training | **Ledger Academy** | a trainer that teaches a slide deck on its own (conductor) and runs a quiz the page owns (await tools) | [apps/training](apps/training/README.md) |
| recruiter | **Northwind Talent** | a screening call on a fixed agenda, with a live agenda and screening notes filled by tools | [apps/recruiter](apps/recruiter/README.md) |
| presence | **Kin** | a companion that reacts to the user's screen through the app's own observer; no tools | [apps/presence](apps/presence/README.md) |
| game | **Isle of Whispers** | an event-driven narrator, and an oracle whose powers are app tools | [apps/game](apps/game/README.md) |
| livestream | **Nightcap Live** | a host that reads a chatroom, pins lines and runs polls viewers vote in | [apps/livestream](apps/livestream/README.md) |

Each app README covers its use case, architecture, the exact API calls and room messages, its
tools, how to run it, today's staging results and its limitations. The code stays where it
is: pages in `public/`, behaviour in `usecases/index.js`, shared server code in `server.js`.

## Setup

```
cp .env.example .env     # ATMEE_BASE_URL, ATMEE_API_KEY, one AVATAR_<APP> per app, GEMINI_API_KEY for Kin
npm install
node --env-file=.env server.js
open http://localhost:3333/
```

- **`ATMEE_API_KEY`** needs the `sessions` scope, plus `avatars:write` for the two apps with a
  conductor (training, recruiter). Without that scope the conductor call returns 403 and those
  sessions start without an agenda.
- **One avatar per app.** Its persona (name, role, voice) is the app's character, so it must
  fit the role; `.env.example` lists the staging demo avatars. Pointing several apps at one
  avatar also works: before each start the server sets that app's conductor, or clears another
  app's.
- **`MAX_SECONDS`** sets the requested session length (default 900). `PORT` defaults to 3333.
- **Local stack.** Point `ATMEE_BASE_URL` at a local session_service (e.g.
  `http://127.0.0.1:8091`), with a `.env.local` (gitignored), and run
  `PORT=3334 node --env-file=.env.local server.js`.
- **Slow networks.** Where IPv6 is unreachable and IPv4 connects are slow, Node's `fetch` can
  fail with `ETIMEDOUT` while curl works; add `--network-family-autoselection-attempt-timeout=2000`
  to the node command.

## Deployment

Staging runs the apps on the tailnet only, at https://atmee-demos.taild36ab5.ts.net (GKE
`gcp-us-central1`, manifests in argocd-app-config `apps/atmee-ai-demos`). A push to `main` builds the `Dockerfile`, pushes it
to Artifact Registry and bumps the tag there (`.github/workflows/publish.yml`).

- The container takes its settings from the environment, the same names as `.env.example`.
- **`DEMO_PASSWORD`**, when set, puts every page, `/api` route and WebSocket behind one shared
  password (the browser's basic-auth prompt, any user name); after that a cookie carries it.
  Unset, as locally, nothing asks for it.
- `GET /healthz` answers without the password, for the probes.

## How every app talks to the avatar

`server.js` holds the API key. Per app it:

- sets the avatar's conductor (`PUT /v1/avatars/{id}/conductor`) when the app has an agenda;
- starts the session (`POST /v1/session`, with the app's `appTools`), which returns a LiveKit
  room and one user token;
- ends it (`POST /v1/session/{id}/end`);
- runs what the app needs around the room (a chatroom, a screen observer, a game log).

The page joins the room as the session's **user participant** (`public/common.js`) and uses
these channels:

| channel | meaning | used for |
|---|---|---|
| `lk.chat` | a typed user turn; the avatar answers it | questions, answers, anything the avatar must respond to |
| `atmee.app` `state` | the app's live context; each one replaces the last | what is on screen, the score, the viewer count, the player's situation |
| `atmee.app` `note` | context kept, never replaced | pinned facts |
| `atmee.app` `event` | something to comment on when the avatar has the floor, with a `ttl_s` | chat digests, game moves, screen changes, a poll result |
| `atmee.app` `mute` / `unmute` | the user is heard as silence, or heard again | the narrator ignores the player except at the shrine |
| `lk.transcription` (in) | the avatar's words | captions and transcripts only; no app reads state from them |
| RPC `atmee.tool` (in) | an app tool call; the handler's return value is the result | everything the avatar makes the app do |

`usecases/index.js` holds the behaviour of all five apps: a conductor graph where the app needs
an agenda, the app tools it declares, and hooks (`onLinked`, `onUser`/`onViewerChat`, `tick`,
`onTool`) that return `say` / `app` messages for the page to relay.

### App tools

A use case declares `appTools: { instructions, tools }` (OpenAI's function shape, plus `x-atmee`
with `mode` notify or await and `timeoutSeconds`). `server.js` sends them on `POST /v1/session`,
and each call reaches the page as the LiveKit RPC `atmee.tool`. The page passes one handler per
tool name to `Atmee.join({ tools })`. An unknown name is answered with an error; a thrown error
reaches the avatar as `error: …`. Every call is also passed to the server's `onTool` hook, and
`?debug` shows it.

Tools are the only way the avatar changes what an app shows. Describe them in the avatar's own
role ("put the next slide on the trainee's screen"): in testing, the persona outweighed generic
tool instructions. Tools need session_service #182 and Causeur #121, both on staging since
2026-10-23.

### The relay hold

Staging refuses a typed turn, and drops commentary, that arrives while the avatar is mid-turn
(Causeur: "Append commentary between turns"). So `common.js` queues every `lk.chat` and
`atmee.app` message in order and sends them once the turn has ended. The turn has ended when
the avatar has stopped speaking, no caption is streaming, and 1.5 s have passed. A queued
message waits at most 15 s. A typed turn starts the next turn, so whatever follows it waits for
that one. A newer `state` replaces a queued one. Under `?debug` each relay shows when it was
sent and how long it was held.

The agent's `lk.agent.state` attribute counts only once it has been seen to change, because
staging sets it to `speaking` once and never updates it. Typed turns are additionally held in
the page until the avatar finishes its sentence (`kit.js` `politeSender`).

## The apps as products

Each page is styled as a real product, with its own brand, a lobby, connection and error
states, and no protocol details on screen. The app goes live as soon as the avatar can talk,
and its face appears whenever video arrives. Add `?debug` to any page to see relays, hold times
and tool calls.

Shared pieces:

- `public/common.js`: session, connection phases, warm-up retries, tool dispatch, the relay
  hold, the microphone.
- `public/kit.js` and `public/kit.css`: stage overlay, captions, transcript, countdown, mic
  button, poll card.

## What the API cannot do yet (found while building these)

1. **No audience in the room.** `POST /v1/session` gives exactly one user token for a room in
   Atmee's LiveKit project; there are no viewer tokens and no egress. The alternative,
   `POST /v1/avatars/{id}/avatar_sessions`, renders a face into your own room but has no
   persona, voice or text streams.
2. **Session length and concurrency.** Session length is capped by the plan, and the whole
   length is reserved at start; there is one live session per avatar at a time.
3. **The avatar speaks up on its own.** Causeur's check-in after about 10 s of silence isn't
   tunable per session, and it continues after a conductor's final step.
4. **Mid-turn messages are refused, not queued.** The apps work around it with the relay hold
   above.
5. **The agenda can't react to tool calls, and isn't observable.** The conductor judges the
   conversation only, and the API doesn't report the current step; apps keep their own state
   from tool calls.
6. **No server-side event stream.** Transcripts, tool calls and session state exist only in the
   room; there is no webhook or feed for the app's backend. Every transcription stream is also
   attributed interim (`lk.transcription_final` is never `true`), so a completed stream is
   treated as a finished sentence.
7. **The persona is the avatar's, not the session's.** `state` steers behaviour, but the avatar
   introduces itself from its own persona, hence one purpose-made avatar per app.
8. **No screen or video input.** A companion that watches the screen runs its own observer and
   sends text, which works.
