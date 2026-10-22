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
| `lk.transcription` (in) | the avatar's words | captions, scoring, echo to a chatroom |

`usecases/index.js` is the whole behaviour of all five apps: a conductor graph where the app
needs an agenda, and three hooks (`onLinked`, `onUser`/`onViewerChat`, `tick`/`onAvatarSaid`)
that return `say` / `app` messages for the host page to relay.

## The five apps, as tested on staging (2026-10-22)

| app | page | avatar's job | how | verified |
|---|---|---|---|---|
| **Live stream** | `livestream-host.html` + `livestream-viewer.html` | one-way host that only reads the chatroom | user muted; questions → `lk.chat`, the rest → `event` digest every 20 s, `state` carries viewer count + recent chat; captions echoed to viewers | ✅ answered viewers by name, captions in the chatroom |
| **Recruiter screening** | `recruiter.html` | regular back-and-forth interview | conductor: greet → background → must-haves → logistics → questions → wrap; `state` = job description + candidate name; mic or typing | ✅ greeted, asked for the intro, followed up |
| **Internal training** | `training.html` | lecture, Q&A, quiz | conductor with `speak` edges: the trainer talks through 3 slides on its own, waits for questions, asks 2 quiz questions; `state` = slide + score; verdicts start with "Correct"/"Incorrect" | ✅ full module incl. "perfect score two out of two" |
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
