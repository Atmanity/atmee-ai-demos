# What the Avatar API could not do

Found while porting the mini-apps from `Atmanity/apps` onto the public Avatar
API (staging, October 2026), and while building `classic/`. Each item says what
was seen, why it matters, and what the app does about it today. Per-app details
are in each app's README.

Measured on staging Causeur sessions with the test harness in
`tools/live-test/` (a synthetic microphone fed from spoken WAV files).

## 1. No function calling: the avatar answers before the app can act

The avatar hears the user and starts its reply at once. The user's final
transcript reaches the app about **1.0 s after they stop speaking**; the
avatar's reply was already being made (it starts speaking about 2.3 s after
the user stops). A `state` the app sends on that transcript does **not** shape
that reply; it shapes the next ones. Measured: state "the secret number is
4417" sent the moment the transcript arrived; the reply said "nor do I know any
secret number"; the next turn said "Your secret number is 4417".

So anything the old agents did with a tool call inside the reply ("is this
guess right?", "apply this chess move", "what does this cost?") now comes a
beat later, as an `event`, after the avatar has already said something. Seen:

- Asked "Is it Paris?", the host said "That's not quite right…" in every run
  before the app's verdict (it cannot know; a standing note forbids it).
- Asked for a clue, it invented one ("home to the Burj Khalifa" for New York)
  in 2 of 3 runs before the app's real clue arrived.
- Both orders occur: holding line then verdict, or verdict then "let's see".

What apps do: give every action a control; judge typed lines before sending
them; stage predictable, non-secret answers in `state` "for when the user
asks" (this fixed the invented clues); send outcomes as `event`s; tell the
avatar in a note to say only a holding line. None of this makes a spoken
command's reply grounded. **The fix is per-session tools** (the app tools
plan): the avatar calls the app and waits.

## 2. Muting the avatar also deafens the app

`atmee.app` `mute` makes the avatar hear silence, and **no user transcript
reaches the room either**. An app cannot let the avatar ignore the user while
it still listens itself (push-to-talk commands, a narrator that only hears at
certain moments). It would need its own speech recognition.

## 3. A client reconnect ends the session

A user whose connection blips is treated as gone: the client reconnects, the
platform records `user_left`, deletes the room and ends the session at once.
Seen through Opus DTX: a typing-only page that publishes digital silence (and a
synthetic test microphone) sends almost no packets, the server rates the
connection "lost", livekit-client forces a full reconnect (`local connection
quality lost while publishing, triggering full reconnect`), and the session
ends 75 to 125 s in. The kit now publishes its silent track with `dtx: false`,
which fixes that cause; a real network blip still ends the session with no
grace period.

## 4. The persona and the greeting belong to the avatar

There is no per-session persona or greeting. Every app here runs on a shared
test avatar that introduces itself first ("I'm Emily, a livestream host…")
before the app's opening `event`. A strongly characterised avatar refuses roles
outside its persona even when the app asks: the Rivendell storyteller answered
"move my knight to f3" with "you have mistaken me for an opponent at a
chessboard". Each app ships `avatar.json` (the persona it was designed for);
running it as designed needs a dedicated avatar per app.

Long rule sets (2k–13k characters in the originals) fit only as several
`note`s (2,000 characters each); there is no per-session system prompt.

## 5. The agenda (conductor) belongs to the avatar too

A conductor is set per avatar, not per session. Apps that share an avatar must
put their own agenda back before each session (the server does this), and two
apps on one avatar at once would fight over it.

## 6. The avatar speaks up on its own (~10 s check-in), untunably

After about 10 s of quiet it checks in ("Take your time, or just let me know if
you want another clue!"), including twice before the user saw its video in one
session. Apps that want silence (a narrator, a player who is thinking, a
classroom) cannot turn it off or lengthen it per session.

## 7. Speech starts before the video, and start-up time varies a lot

- `POST /v1/session` took 15 to 46 s; the avatar's video then appeared 3 s to
  60 s after joining. In the slow case the avatar had greeted and checked in
  twice before its video played: the user hears nothing of it (the page is
  still on "almost there").
- The avatar's captions can arrive whole, ahead of its audio; captions cannot
  time app logic.

## 8. Words cannot be forced

`event`s are spoken in the avatar's own words. Lines that must be exact (a
safety line, a refusal, a price, a clue) can only be shown on screen as the
source of truth.

## 9. Typed turns come back as speech

A typed `lk.chat` turn is echoed back on `lk.transcription` as if the user had
said it. The kit drops an echo of a line typed in the last 20 s; without that,
an app acting on speech acts twice on typed text.

## 10. Smaller things

- **No per-session speech hints** (the originals biased Deepgram toward
  square names, city names, star names). Rare words are misheard more.
- **One live session per avatar, one user token per session**, no viewers.
- **A test avatar that never speaks** (`v2-e2e-test`): ready by the API, but in
  a session it never greeted or answered, and the session ended `user_left`
  after 90 s with no error the app could see.
- `lk.transcription_final` is now set on the avatar's captions (it was always
  interim on 2026-10-22); the user's interim transcripts are separate streams of
  one segment with the final flag on the last.
