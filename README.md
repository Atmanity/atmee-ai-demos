# atmee-usecase-demos

Sample apps built purely on the Atmee Avatar API (v2), with no changes to the platform:

- **Five apps** on one small Node server (`server.js`). They cover the target-app checklist
  from the product thread: a recruiter call, internal training, a presence/companion, an
  interactive story and a live stream.
- **Fourteen mini-apps** from `Atmanity/apps` (games, tutors, advisors, a planetarium, a room
  planner), rebuilt as products (`server/`, `src/`). See
  [The fourteen mini-apps](#the-fourteen-mini-apps).
- **Two avatar-only apps** whose own agent speaks while the avatar is only its face, rendered
  into the site's own LiveKit room. See [Avatar-only apps](#avatar-only-apps).
- **Speech-to-speech apps**: voice calls with no video, whose server pins the conversation and
  whose page runs its tools. See [Speech-to-speech apps](#speech-to-speech-apps).

One site serves them all: `server/index.ts` runs the mini-apps and mounts `server.js` in
the same process, on one port, and the home page lists every app, says which of the
[three ways](#three-ways-to-build) each is built, and links to its code.

## Three ways to build

| way | Atmee runs | the app brings | API | here |
|---|---|---|---|---|
| **Full-stack** | listening, thinking (persona, knowledge, agenda), the voice and the face | what is on screen, events and its tools | `POST /v1/session` | nineteen apps |
| **Speech-to-speech** | one realtime voice model that hears and answers in the avatar's voice; voice only for now (a face today by handing its audio to an avatar-only render, or to a character of your own) | its own conversation over a WebSocket: the instructions, persona and tools its server pins, the tools run by its client, the audio | `POST /v1/speech_sessions` | [the speech apps](#speech-to-speech-apps) |
| **Avatar-only** | the face only | the whole agent (its model, tools and voice) or any audio, and its own LiveKit room | `POST /v1/avatars/{id}/avatar_sessions` | Waybill, Facecast |

Every app has its folder in `apps/<app>/` with its README.

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
cp .env.example .env     # ATMEE_BASE_URL, ATMEE_API_KEY, GEMINI_API_KEY for Kin and the avatar-only apps
npm install
npm run dev              # every app: http://localhost:5190/
```

`npm run dev` serves the mini-apps' pages through Vite; `npm run build && npm start` serves the
built pages, as the container does. `node --env-file=.env server.js` (or `npm run start:five`)
still runs the five on their own, on `PORT` (3333).

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

- The container runs every app on one server (`server/index.ts` on 3333, with the mini-apps'
  pages built into `dist/`) and takes its settings from the environment, the same names as
  `.env.example`. One `ATMEE_API_KEY` serves every app: the key's account holds all their
  avatars.
- **`DEMO_PASSWORD`**, when set, puts every page (the mini-apps' too), `/api` route and WebSocket behind one shared
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

**Every visitor gets a session of their own.** In training, recruiter, Kin and the game, each
visitor who starts the app gets their own session, state, agenda, notes and tool calls. The
start returns a random key that only that visitor's page holds. The page's WebSocket, its end
call and Kin's screen frames all carry that key, so one page cannot reach or end another
visitor's session. A session ends when its page ends it, when its socket closes (tab closed or
reloaded, page crashed, network lost; pings catch a page that disappeared silently), 30 s after
start if the page never connects, and one minute after its time limit at the latest. The live
stream is one-to-many: one streamer's page owns the session and any number of viewers share
its chatroom. A second would-be streamer is told "Someone is already streaming. Join as a
viewer." and offered the viewer page. If the API refuses a start because the avatar is busy
(409), the page says the demo is in use and when to try again: the time left on the session
holding the avatar when that session is ours, otherwise the API's `Retry-After`.

The page joins the room as the session's **user participant** (`public/common.js`) and uses
these channels:

| channel | meaning | used for |
|---|---|---|
| `lk.chat` | a typed user turn; the avatar answers it | questions, answers, anything the avatar must respond to |
| `atmee.app` `state` | the app's live context; each one replaces the last | what is on screen, the score, the viewer count, the player's situation |
| `atmee.app` `note` | context kept, never replaced | pinned facts |
| `atmee.app` `event` | something to comment on when the avatar has the floor, with a `ttl_s` | chat digests, game moves, screen changes, a poll result |
| `atmee.app` `mute` / `unmute` | the user is heard as silence, or heard again | the narrator ignores the player except at the shrine |
| `lk.transcription` (in) | the avatar's words, and the user's spoken words as recognised (sent under the user's identity) | captions and transcripts only; no app reads state from them |
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
  button, poll card, the "All apps" link and the CC button.

Every page, the mini-apps' too, has two more things in common:

- **"← All apps"**, first in its header, back to the home page. With a session live it asks in
  the page first ("End the lesson and go to all apps?") and ends the session before it goes.
- **CC** on the avatar's video shows or hides the captions over it. It starts off where the page
  already has a chat, transcript or log of the avatar's words, and on where the overlay is the
  only place they appear (Kin's speech bubble). The choice is kept per app in the browser
  (`localStorage` `atmee-captions:<app>`). It changes only what is on screen: the relay hold
  reads the caption streams themselves.

## The fourteen mini-apps

The mini-apps from `Atmanity/apps`, each rebuilt as a product with its own name, look and
host. The host acts through app tools; the app owns the rules, the facts and the screen.
Each was run live on staging; its README has the runs and what the API could not do.

| app | product | what it is | README |
|---|---|---|---|
| guess-the-city | **Postmark** | one photo, three clues: guess the city with Marco | [apps/guess-the-city](apps/guess-the-city/README.md) |
| chess-opponent | **Kibitz** | chess with Sasha, a club player who plays her own moves and says why | [apps/chess-opponent](apps/chess-opponent/README.md) |
| poker-table | **Blindside** | heads-up hold'em against Dex: say your move, he talks back | [apps/poker-table](apps/poker-table/README.md) |
| stroke-tutor | **Hanshi** | stroke order with Ren, a calligraphy teacher who watches every stroke | [apps/stroke-tutor](apps/stroke-tutor/README.md) |
| bls-tutor | **Bystander** | CPR and first-aid drills with Alex, a calm paramedic | [apps/bls-tutor](apps/bls-tutor/README.md) |
| quadratic-whiteboard | **Chalkline** | an equation's working, one exact line at a time, read out by Ada | [apps/quadratic-whiteboard](apps/quadratic-whiteboard/README.md) |
| trajectory-coach | **Arcwise** | a projectile range: aim, fire, and Theo explains where it landed | [apps/trajectory-coach](apps/trajectory-coach/README.md) |
| sky-guide | **Lodestar** | any sky on Earth at any hour, with Mira naming the stars | [apps/sky-guide](apps/sky-guide/README.md) |
| nutrition-advisor | **Morsel** | what is in any food, from Rachel, a nutritionist | [apps/nutrition-advisor](apps/nutrition-advisor/README.md) |
| fashion-advisor | **Notch** | Emery rates your outfit for the occasion and names the one fix | [apps/fashion-advisor](apps/fashion-advisor/README.md) |
| fitness-coach | **Spotter** | a workout built around you, coached by Sammy | [apps/fitness-coach](apps/fitness-coach/README.md) |
| market-desk | **Outcry** | call out a ticker; Reese reads the tape and never gives advice | [apps/market-desk](apps/market-desk/README.md) |
| travel-guide | **Yonder** | dream up a trip on a live map with Lumi | [apps/travel-guide](apps/travel-guide/README.md) |
| room-planner | **Planwright** | talk your home into shape with Iris, an architect who draws as you talk | [apps/room-planner](apps/room-planner/README.md) |

## Avatar-only apps

The app brings the speech; the avatar is the face that says it. The site's server mints two
LiveKit tokens with its own project (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`):
one for the page, which joins as the agent, and one for the avatar, which publishes on the
page's behalf. It starts the render with `POST /v1/avatars/{id}/avatar_sessions`
(`server/render.ts`, routes `/api/apps/<app>/render`). The page streams 16 kHz PCM to the
avatar on `lk.audio_stream`, answers `lk.playback_started` and `lk.playback_finished`, cuts with
`lk.clear_buffer`, and plays the avatar's synced video and voice (`src/avatar/render.ts`,
`useAvatarOnly` in the kit). A LiveKit Agents worker does the same with `livekit-plugins-atmee`.

| app | product | what it is | README |
|---|---|---|---|
| parcel-help-desk | **Waybill** | a parcel help desk: the app's own model, tools, voice and ears; Tess is the face | [apps/parcel-help-desk](apps/parcel-help-desk/README.md) |
| presenter-studio | **Facecast** | a script, a recording or your live voice, said to camera by Remy | [apps/presenter-studio](apps/presenter-studio/README.md) |

## Speech-to-speech apps

A voice call with no video: Atmee's speech server hears the user and answers in the avatar's
voice, over a WebSocket the page holds. The site's server reserves each call
(`POST /v1/speech_sessions`, routes `/api/apps/<app>/speech`) with the app's avatar and the
settings the app pins for it (`AppServer.speech.settings()`: who the avatar is in the call, its
instructions, its tools); the page gets only the WebSocket address and a token for one connection
within a minute, and cannot change anything pinned. The page streams the microphone as 24 kHz
PCM16 in 20 ms frames (silence too), plays the voice, and runs the
tools the model calls, answering each with `response.item.create`. End goes through the server
(`POST /v1/speech_sessions/{id}/end`), then the page closes the socket, so the session settles at
once; the page then reads what it cost. The page asks for playback control: each reply comes as
fast as the voice makes it, the page holds all of it and says when it began to play and how much
of it played, so a stall on the way is not heard as a gap. A server without it starts the session
paced, in real time, and the page plays it through a small jitter buffer. The code is shared: `src/speech/` (framework-free) and
`useSpeech` in the kit.

A speech app is off, and not listed, until its own `AVATAR_<APP_ID>` names an avatar **with a
voice** (never `AVATAR_DEFAULT`: the voice is the app's character's). Speech sessions need
session_service's `/v1/speech_sessions` and Causeur's speech server in public mode.

| app | product | what it is | README |
|---|---|---|---|
| front-desk | **Callwell** | a clinic's front desk on the phone: Rosa books, moves and cancels appointments in the clinic's own book | [apps/front-desk](apps/front-desk/README.md) |

### Run them

```
cp .env.example .env     # as above; the mini-apps also read GEMINI_API_KEY
npm install
npm run dev              # http://localhost:5190/ (every app on the home page)
npm test                 # engines, judges, directors, the kit
npm run typecheck
```

Node 22.9+ (for `--env-file-if-exists`). `npm run dev` and `npm start` read `.env`, then
`.env.local` if it exists, so a value there wins. Each app's host, the five's as much as the others', is the
`avatarId` in `apps/<app>/avatar.json` (`server/hosts.js` reads them for both servers), all in
one account, so one key serves all. `AVATAR_<APP_ID>` (for example `AVATAR_CHESS_OPPONENT`) overrides one app's host,
and `AVATAR_DEFAULT` serves an app with neither. The site runs on `SITE_PORT` (default 5190),
so `PORT` stays the five apps' own (3333) when `server.js` runs alone. The mini-apps own
`/apps/…` and `/api/apps/…`; every other path is `server.js`'s.

### How a mini-app is put together

```
server/              the site's server: the API key, sessions, each app's own routes
  index.ts             one port for every app: the mini-apps' paths here, the rest to server.js
  atmee.ts             the Avatar API (session, end, conductor, app tools)
  llm.ts               the apps' own model calls (structured JSON, images)
  api.ts               discovers apps/<app>/server.ts; /api/apps/<app>/session, /end, routes
src/avatar/          the room, framework-free: join, the app's messages, both sides' words,
                     the app-tool RPC
src/speech/          a speech-to-speech call, framework-free: the socket, the microphone and
                     voice worklets, the transcript, tool rounds
src/kit/             React: useAvatar(), the call parts (HostVideo, CallStatus, ChatPanel),
                     useToolNet() (the safety net for actions the host narrates),
                     BackToApps and useCaptionToggle() (the "All apps" link, the CC button)
apps/<app>/
  server.ts          the app's server side: its tools' instructions, secrets, model calls
  engine/            its rules and its "director" (tools, results, instructions), with tests
  page/              its screen
  avatar.json        its host: persona and avatarId
  host/portrait.jpg  the host's face, shown before the video plays
tools/live-test/     a synthetic microphone and helpers for live runs
tools/report/        the generator of docs/apps-report.html
```

The rule every app follows: **the app decides, the host performs.** The host acts through the
app's tools and says what their results say; results lead with the outcome; tool schemas are
lenient and the app normalises what arrives. `docs/PORTING.md` is the guide to building one,
`docs/API-GAPS.md` what the API still lacks, with each app's live results, and
`docs/apps-report.html` the report on all fourteen.

## What the API cannot do yet (found while building these)

For the five apps; the fourteen mini-apps' findings, with live evidence, are in
`docs/API-GAPS.md`.


1. **No audience in the room.** `POST /v1/session` gives exactly one user token for a room in
   Atmee's LiveKit project; there are no viewer tokens and no egress. The alternative,
   `POST /v1/avatars/{id}/avatar_sessions`, renders a face into your own room but has no
   persona, voice or text streams.
2. **Session length and concurrency.** Session length is capped by the plan, and the whole
   length is reserved at start. The API is documented as one live session per avatar
   (409 `avatar_busy`), which would cap each app at one visitor at a time. On staging on
   2026-10-23 it accepted two concurrent training sessions on the same avatar, and both
   trainees were taught at once.
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
