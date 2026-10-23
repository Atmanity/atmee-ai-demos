# atmee-usecase-demos

Five sample apps built purely on the Atmee Avatar API (v2), one small Node server, no changes
to our platform. They are the "target app" checklist from the product thread: a recruiter
call, internal training, presence/companion, an interactive story, a live stream.

```
cp .env.example .env     # ATMEE_API_KEY, one AVATAR_<USECASE> per app, GEMINI_API_KEY for presence
npm install && npm start
open http://localhost:3333/
```

## How every app talks to the avatar

`server.js` holds the API key. Per use case it starts the avatar's session
(`POST /v1/session` → LiveKit room + one user token), sets the avatar's agenda when the use
case has one (`PUT /v1/avatars/{id}/conductor`), and runs what the app needs around the room
(a chatroom, a screen observer, a game log). The host page joins the room as the session's
**user participant** (`public/common.js`) and uses two room text streams:

| stream | meaning | used for |
|---|---|---|
| `lk.chat` | a typed user turn; the avatar answers it | questions, answers, anything the avatar must respond to |
| `atmee.app` `state` | the app's live context (replaces the last) | what is on screen, the score, the viewer count, who the player is |
| `atmee.app` `note` | context kept, never replaced | pinned facts |
| `atmee.app` `event` | something to comment on, spoken when the avatar has the floor, with a `ttl_s` | chat digests, game moves, screen changes |
| `atmee.app` `mute` / `unmute` | the user is heard as silence, or heard again | the narrator ignores the player except at the shrine |
| `lk.transcription` (in) | the avatar's words | captions and transcripts, echo to a chatroom (display only: no app state is read from them) |

`usecases/index.js` is the whole behaviour of all five apps: a conductor graph where the app
needs an agenda, the app tools it declares (`appTools`, below), and hooks (`onLinked`,
`onUser`/`onViewerChat`, `tick`, `onTool`) that return `say` / `app` messages for the host page
to relay.

## The apps as products

Each page is styled as a real product, with its own brand, a lobby, connection and error
states, and no protocol details on screen. Add `?debug` to any page to see what it relays into
the room.

| product | page | what the user sees |
|---|---|---|
| **Ledger Academy** | `training.html` | a course lobby, a slide deck that follows the trainer, Lesson → Q&A → Quiz progress, live score, completion screen |
| **Northwind Talent** | `recruiter.html` | a video-call pre-join with the job card, the recruiter on stage, a live agenda, the screening notes, transcript, call controls |
| **Kin** | `presence.html` | a companion welcome with privacy wording, the shared screen in a monitor frame, a "what Kin noticed" feed, Kin floating in a bubble |
| **Isle of Whispers** | `game.html` | a title screen, a fogged island map with keyboard moves, a framed narrator, a chronicle, satchel slots, the oracle's shrine, a victory screen |
| **Nightcap Live** | `livestream-host.html`, `livestream-viewer.html` | a creator studio with LIVE badge, viewer count and stream chat, and a branded chat pop-out for viewers |

Shared pieces: `public/common.js` (session, connection phases, warm-up retries, going live when
the avatar can talk, its face attached whenever it arrives, app tool calls dispatched by name,
microphone), `public/kit.js` and `public/kit.css` (stage overlay,
captions, transcript, countdown, mic button, typed turns held until the avatar finishes a
sentence).

## App tools

Text streams carry what the app tells the avatar; app tools carry what the avatar makes the
app do. A use case that has some declares them next to its policy in `usecases/index.js`
(`appTools: { instructions, tools }`, OpenAI's function shape plus `x-atmee` mode), `server.js`
sends them on `POST /v1/session`, and each call reaches the host page as the LiveKit RPC
`atmee.tool`. The page passes a handler per tool name to `Atmee.join({ tools })`; an unknown
name is answered with an error, `?debug` shows every call, and each call is also passed to the
server's `onTool` hook.

| app | tools | why |
|---|---|---|
| **Ledger Academy** | `show_slide {n: 1..4}`, `ask_quiz_question {n: 1..2}`, `grade_answer {question, correct, feedback?}`, all notify | the deck opens on slide 1; the trainer puts up slides 2–3 and the closing "Questions?" slide (4), shows each quiz question, and records each verdict, which is the score |
| **Northwind Talent** | `set_agenda_step {step}` notify, `record_answer {topic, summary}` notify | the live agenda and a "Screening notes" panel filled by the recruiter as the candidate answers |
| **Isle of Whispers** | `reveal_clue {seek}` **await**, `give_item {item}` notify | the oracle's powers, at the shrine only: the island's secrets are the game's, so the oracle asks where the key/chest/map lies and speaks from the answer while it glows on the map; it may gift a lantern (lights the tiles around you) or a charm |
| **Nightcap Live** | `pin_message {text}` notify, `start_poll {question, options[2..4]}` notify | the host pins lines and runs polls in the stream chat; the server shows them to the studio and every viewer, counts votes, and tells the host the result when the poll closes |
| **Kin** | none | information only flows from the app to the avatar (screen descriptions as `state`/`event`); the companion has nothing to make the app do |

Tools are the only way the avatar changes what the app shows: no app reads its captions for
state (captions and transcripts are display only), so a slide, a quiz card or an agenda step
that the avatar does not mark with its tool stays where it was. Tools are described in the
avatar's own role, and the conductors name the tool at each step: in testing the persona
outweighed the tool instructions.

Tools are required: they need session_service #182 and Causeur #121, on staging since
2026-10-23. To try them against a local stack instead, put a `.env.local` next to
`.env.example` (gitignored) with `ATMEE_BASE_URL` pointing at the local session_service (e.g.
`http://127.0.0.1:8091`), its API key and avatar ids, and run
`PORT=3334 node --env-file=.env.local server.js`. One avatar can serve all five apps: the server
sets each use case's conductor, or clears it, before the session starts (that needs a key
allowed to write the avatar; without it the conductor call is refused with 403 and the session
starts without an agenda).

## The five apps, as tested on staging (2026-10-22)

| app | page | avatar's job | how | verified |
|---|---|---|---|---|
| **Live stream** | `livestream-host.html` + `livestream-viewer.html` | one-way host that only reads the chatroom | user muted; questions → `lk.chat`, the rest → `event` digest every 20 s, `state` carries viewer count + recent chat; captions echoed to viewers | ✅ answered viewers by name, captions in the chatroom |
| **Recruiter screening** | `recruiter.html` | regular back-and-forth interview | conductor: greet → background → must-haves → logistics → questions → wrap; `state` = job description + candidate name; mic or typing | ✅ greeted, asked for the intro, followed up |
| **Internal training** | `training.html` | lecture, Q&A, quiz | conductor with `speak` edges: the trainer talks through 3 slides on its own, waits for questions, asks 2 quiz questions; `state` = slide + score; verdicts start with "Correct"/"Incorrect" (before app tools) | ✅ full module incl. "perfect score two out of two" |
| **Presence / companion** | `presence.html` | sits next to you, reacts to what you do | the page sends a frame when the screen changes; Gemini describes it (`usecases/observer.js`); description → `state`, anything noteworthy → `event`; share the real screen or run a simulated work session | ✅ "Oh, looks like that pytest run hit a snag! Was it that assertion error on the target silence duration?" |
| **Interactive story** | `game.html` | narrator that speaks only on events; conversation only at the oracle's shrine | user muted; each move → `event`; entering the shrine → `unmute` + `state` + `lk.chat` allowed; leaving → `mute` | ✅ narrated moves, answered the oracle question |

## What the API cannot do yet (found while building these)

1. **No audience in the room.** `POST /v1/session` gives exactly one user token for a room in
   Atmee's LiveKit project; there are no viewer tokens and no egress. A live stream must
   re-stream the avatar's tracks (OBS, or re-publish into the developer's own LiveKit room).
   The alternative, `POST /v1/avatars/{id}/avatar_sessions` (render into your own room), gives
   a face only: no persona, voice or text streams.
2. **Session length.** Capped by the plan (900 s on Free, up to 4 h); a longer stream chains
   sessions (new room, a visible cut). One live session per avatar at a time.
3. **The avatar speaks up on its own.** Causeur's check-in after ~10 s of silence is not
   tunable per session through the API, so an event-only narrator still says "Still there?"
   between events, and the companion comments on quiet stretches. A per-session knob
   (`checkin_after_s`, `pursuit_after_s`, greeting instructions) is the missing piece.
4. **A typed turn sent while the avatar is speaking is lost** (`lk.chat` is refused mid-turn
   and not queued; the training test had to repeat "start the quiz"). `event`s do queue.
5. **No transcript or reply feed outside the room.** The only way to know what was said is the
   room's transcription stream; every stream is attributed interim (`lk.transcription_final`
   is never `true`), so a completed stream is treated as a finished sentence.
6. **The persona is the avatar's, not the app's.** `state` steers behaviour but the avatar
   still introduces itself from its own persona (the test avatars here introduce themselves
   as "a test avatar"); a per-session persona/greeting override would let one avatar serve
   several apps.
7. **Observer and relay logic is the developer's.** The API has no hook for video/screen
   observation; the presence app runs its own VLM and sends descriptions — that is by design
   (per the product thread), and it works.
8. Staging only; a cold rendering pool answers `503 avatar_warming` for a few minutes.
