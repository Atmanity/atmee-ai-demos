# Callwell

A voice receptionist for a small clinic, built the **speech-to-speech** way. Call Juniper
Family Clinic's front desk and Rosa answers: book a check-up, move or cancel an appointment,
ask where the clinic is. It is a phone call: no video, no typing. Rosa hears you and answers in
the avatar's voice over a WebSocket; the clinic's server decides who she is and what she may do,
and the clinic's page runs her tools against its own appointment book, which fills in beside the
call as she confirms.

Open it at `/apps/front-desk/`. It is off (and not on the home page) until `AVATAR_FRONT_DESK`
names an avatar with a voice.

## How it works

```
the clinic's server ──► POST /v1/speech_sessions  (API key; avatarId; settings pinned:
   (server.ts)            Rosa, the clinic's facts, the booking rules, 4 tools)
        │ ◄── { url, token (one connection, 60 s), sessionId }
        ▼
the page ──► wss://…/v1/speech_sessions   subprotocols atmee-live, atmee-token.<jwt>
   session.start            { model: causeur, input_transcript, playback_control }   (nothing pinned can be set)
   input_audio.append  ───► the microphone, 24 kHz PCM16, a frame every 20 ms, silence too
   playback.*          ◄─── Rosa's voice, each reply as fast as it is made  ──► held whole ──► speaker
   playback.ack        ───► when each reply began to play, and how much of it played
   transcripts         ◄─── her words as they are said; yours as they are recognised
   a tool round        ◄─── check_availability, book_appointment, …  ──► engine/clinic.ts
   response.item.create ──► each result; response.create ──► she goes on
End ──► the clinic's server ──► POST /v1/speech_sessions/{id}/end, then session.close
```

| Part | Where |
|---|---|
| What the call is | `server.ts` pins it per call (`speech.settings()`): `avatar_name`, `persona`, `scenario`, `self_introduction` from `avatar.json`, the clinic's `facts`, the booking `instructions`, the tools (`delegation.responses.tools`, `tool_choice: auto`) and the clinic's time zone (`avatar_timezone`, so "today" is Portland's). The voice is always the avatar's. A page that tried to set any of it would be refused, naming the field. |
| The book and its rules | `engine/clinic.ts`, run in the page: three clinicians on their own days, half-hour slots for the next five working days, most taken by other patients, two named ones (Maria Gomez, Daniel Kim) to find or cancel. Each visitor gets a fresh week. Every result leads with its outcome (`Open:`, `Booked:`, `Refused, nothing is booked:`, `Cancelled:`, `Not found:`) and says what to ask next. Arguments are what Rosa heard ("Thursday", "the nurse", "10:30 AM") and are read leniently; a missing name, a taken slot or a day off comes back as a refusal she must say. |
| The call | `src/speech/` (shared by the speech apps): `session.ts` places the call (our server, then the socket, `session.start`), streams the microphone, plays the voice, runs a tool round and answers it, and ends through our server; `audio.ts` holds the two AudioWorklets (the microphone resampled to 24 kHz frames; the voice in a 24 kHz context the browser resamples to the speaker, each reply held whole and acknowledged by its samples, or, on a server without playback control, through a 100 ms jitter buffer); `lines.ts` assembles the transcript. `src/kit/useSpeech.ts` is the React hook. |
| Interruptions | The speech server owns turn-taking: its voice detection pauses Rosa as you start talking and drops the reply once your words are recognised. The page keeps at most a few hundred ms of her voice queued and drops it when your words arrive marked `[interruption]`; her line is marked cut off. |
| The screen | `page/App.tsx`: the call (Rosa's voice as a ring that swells, yours inside it, Mute, End), the live transcript, the booking as it is confirmed, the week (open, offered on this call, booked on this call), and **Under the hood**: who does what and each tool's result. After the call: how long it was, what was billed and what it cost (read back from the API once it settled), and what changed in the book. |

Routes, under `/api/apps/front-desk` (the site's shared speech routes, `server/api.ts`):
`POST /speech` (reserve a call → `{ sessionId, url, token, tokenExpiresAt, maxSeconds }`),
`GET /speech/:id` (its state; once ended, `endReason`, `billedSeconds`, `chargedMicrocredits`),
`POST /speech/:id/end`. The API key never reaches the page; neither does anything pinned.

### Ending, and what it costs

End asks the server to end the session first (`POST …/end`: with the page's connection open the
API records the end and answers `active` with `endRequestedAt`), then the page sends
`session.close`. The speech server reports the close and the session settles at once,
`completed` / `ended_by_api`, billed to that moment. Without the close it would settle at the
connection's next usage report, up to 30 s later. Closing the tab ends it too (the socket closes,
and a beacon ends a call that never connected).

### When it can't connect

| What happened | What the page says |
|---|---|
| the microphone is blocked | "The microphone is blocked: allow it in the address bar, then call again." |
| `422 avatar_has_no_voice` | "This app's avatar has no voice yet, so it can't take calls." |
| `503 no_avatar` (no `AVATAR_FRONT_DESK`) | "This app isn't switched on yet: it needs an avatar with a voice." |
| the speech server is full (accepts, then closes 1013) | "Every line is busy right now. Try again in a minute." |
| the token expired before the page connected | "The call took too long to connect. Call again." |
| the session is held by another connection (409) | "That line was picked up elsewhere. Call again for a new one." |
| `402` (credits, spend cap, concurrency) | "Calls are paused right now" / "Every line is busy right now" |

A browser never sees a refused handshake's status, so after a failed connect the page reads the
session (`GET /speech/:id`) and the token's expiry to tell these apart, then ends the session so
nothing stays reserved.

## Run it

`ATMEE_API_KEY` (a key with the `sessions` scope) and `AVATAR_FRONT_DESK`: an avatar of the key's
account **with a voice** that suits Rosa (the persona is pinned, so any voiced avatar works; its
name and personality are replaced for the call). Needs a deployment with speech sessions:
session_service's `/v1/speech_sessions` and Causeur's speech server in public mode.

## Local run, 2026-10-27

Against a local stack (session_service #183, Causeur #122 in public mode, a fresh Supabase with
the speech-billing migrations), driven by Playwright Chromium with a fake microphone playing a
`say` recording (microphone permission only):

- **Booking.** "A check-up with one of the doctors on Thursday morning" → `check_availability`
  (day Thursday, morning, a check-up) → Rosa offered 9:00 or 9:30 with Dr. Okafor, 9:30 with
  Dr. Patel → "the first time you said works, I'm Jordan Lee" → `book_appointment` → the slot
  turned teal in the week and the booking card appeared as she read back "J F C 4 1 0 1". 4,274
  frames of her voice arrived (half of them speech) and 4,278 microphone frames went out.
  End: settled `completed` / `ended_by_api` 0.3 s after the end request, billed 86 s, 144
  microcredits, shown in the summary.
- **Cancelling.** "This is Maria Gomez, I need to cancel" → `find_appointments` → "Friday at two
  with Dr. Okafor, shall I cancel it?" → "yes" → `cancel_appointment`; billed 65 s.
- **Failures.** Microphone blocked, a token held past its minute, a token presented by a second
  page while the first held the session (409), a third call with the speech server's limit at two
  (1013), and an avatar with no voice (422): each showed its line above, and each session it
  reserved was ended (none billed).

## Limitations

1. **Voice only.** A speech session has no video. For a face, its audio would go to an
   avatar-only render in the app's own room (as Waybill does); that is not done here.
2. **The model decides when to call a tool.** The rules say never to offer or confirm a time the
   book did not just return, and the book refuses what it cannot do, so a slip shows as a
   refusal she must say rather than a wrong booking. A turn waits on at most four tool rounds,
   30 s each.
3. **One connection per call.** A dropped connection cannot resume; the caller calls again, on a
   new session.
4. **Her transcript is paced, not aligned.** The speech server sends her words at about three a
   second of audio; a reply cut short shows roughly what was heard.
5. **The book lives in the page.** Each visitor gets a fresh week; nothing is saved.
6. **The public profile is fixed.** A speech session cannot tune the check-in after a silence,
   the welcome or the speech hints (no `modules`), so names are recognised as heard, and Rosa
   speaks up after about ten silent seconds.
