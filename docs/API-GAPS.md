# What the Avatar API could not do

Found while porting the fourteen mini-apps from `Atmanity/apps` onto the public
Avatar API (staging, October 2026), and while building `classic/`. Each item
says what was seen, why it matters, and what the apps do about it today. Every
app's README has its own live run and its gaps marked seen or expected.

Measured on staging Causeur sessions with the test harness in
`tools/live-test/` (a synthetic microphone fed from spoken WAV files), one run
per app, on three shared test avatars.

## The live runs at a glance

| App | What the API carried well | Worst thing seen |
|---|---|---|
| guess-the-city | clues staged in `state` | "That's not quite right…" before the app's verdict (1) |
| stroke-tutor | the hold-then-lesson two beats | check-ins over drawing (6); a right state misread |
| bls-tutor | staged answers, the emergency card | the emergency line twice, behind a filler (1, 8) |
| poker-table | rulings; pot and cards from `state` | a missed "Raised to five." left "let's see" hanging (1, fixed) |
| quadratic-whiteboard | the staged next line read on "next" | check-ins into the class's pauses (6) |
| sky-guide | Orion's rising time from `state`; "Beetlejuice" mapped | answers said twice, its own and the event (1) |
| trajectory-coach | landing lines with every number exact | "let's send it!" with nothing done (1, fixed) |
| market-desk | one refusal with a board fact | "putting ZQXWQ up", then taken back (1) |
| nutrition-advisor | the board's figures, staged recipe steps | 139 s from Start to video (7) |
| travel-guide | the guide's own pick drove the map | an invented next spot; news promised, never told (1, fixed) |
| chess-opponent | an illegal move refused from `state` | the opponent's first move never named (10) |
| room-planner | rule-based trades applied instantly | a made-up area before the real one (1) |
| fashion-advisor | no result claimed early | asked the style it had just been told (1) |
| fitness-coach | the pregnancy stop held, from a note | the stop said twice (1) |

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
beat later, as an `event`, after the avatar has already said something. Across
the fourteen runs:

- **What was there before the user spoke worked.** Answers staged in `state`
  and rules in standing notes shaped the immediate reply in every app: Orion
  "rises low in the east at about quarter past nine", the quadratic's next
  line, the pot, "I read the tape, I don't give advice", the pregnancy stop and
  the emergency line. Staging fixed invented clues too.
- **A holding line is a promise only the app can keep.** When the app's judge
  missed a line, the avatar had said "let's see" or "let me pull that up" and
  nothing followed: "Raised to five." (poker), "Lobbied like a mortar."
  ("let's send it!", trajectory), and a news request whose "no source" answer
  was staged but ignored (travel). All three are fixed in the apps; the
  pattern remains.
- **What could not be staged was invented, then corrected.** "That's not quite
  right…" before the verdict (every guess-the-city run), "Miyashita Park" before
  the real next spot, "eight point three square metres" before the real 8.4,
  "let's watch this one fly right over!" before the landing, "putting Z Q X W Q
  up" before the failed add.
- **Staged answers come twice** when the app also sends the event: Orion's
  refusal, the emergency line, "90 is off the rail", "try-ons are turned off".

What apps do: give every action a control; judge typed lines before sending
them; stage predictable, non-secret answers in `state` "for when the user
asks"; send outcomes and every refusal as `event`s; tell the avatar in a note
to say only a holding line. None of this makes a spoken command's reply
grounded. **The fix is per-session tools** (the app tools plan): the avatar
calls the app and waits.

## 2. Muting the avatar also deafens the app

`atmee.app` `mute` makes the avatar hear silence, and **no user transcript
reaches the room either**. An app cannot let the avatar ignore the user while
it still listens itself (push-to-talk commands, a narrator that only hears at
certain moments). It would need its own speech recognition. (No app here mutes
for this reason; BLS and fitness wanted it and could not.)

## 3. A client reconnect ends the session

A user whose connection blips is treated as gone: the client reconnects, the
platform records `user_left`, deletes the room and ends the session at once.
Seen through Opus DTX: a typing-only page that publishes digital silence (and a
synthetic test microphone) sends almost no packets, the server rates the
connection "lost", livekit-client forces a full reconnect (`local connection
quality lost while publishing, triggering full reconnect`), and the session
ends 75 to 125 s in. The kit now publishes its silent track with `dtx: false`,
which fixes that cause; a real network blip still ends the session with no
grace period. Every run after the fix ended `ended_by_api`, except one chess
attempt whose page had crashed (`user_left`).

## 4. The persona and the greeting belong to the avatar

There is no per-session persona or greeting. Every app greets with the shared
test avatar's own introduction first, then the app's opening `event`: a
lighthouse keeper ran the market desk ("Aye, sure, putting Z Q X W Q up"), a
college student taught CPR. Two test avatars introduced their own test setup
("I run on a test avatar setup with a fixed four hundred millisecond prime
lead…", "this 6c68cadd voice profile"). A strongly characterised avatar
refuses roles outside its persona even when the app asks: the Rivendell
storyteller answered "move my knight to f3" with "you have mistaken me for an
opponent at a chessboard". Each app ships `avatar.json` (the persona it was
designed for); running it as designed needs a dedicated avatar per app.

Long rule sets (2k–13k characters in the originals) fit only as several
`note`s (2,000 characters each); there is no per-session system prompt.

## 5. The agenda (conductor) belongs to the avatar too

A conductor is set per avatar, not per session. Apps that share an avatar must
put their own agenda back before each session (the server does this), and two
apps on one avatar at once would fight over it.

## 6. The avatar speaks up on its own (~10 s check-in), untunably

After about 10 s of quiet it checks in. Seen in nearly every run: over a
learner drawing a stroke, a class pausing at the whiteboard, a player sizing a
bet ("Still thinking over that forty to call, or are…"), before the app's
opening was said ("Just checking in—did you want to keep chatting…"), and
twice before the avatar's video had even appeared. Several originals had no
idle nudge on purpose (a narrator, a planetarium, someone mid-set). Apps can
stage what a check-in should offer; they cannot turn it off or lengthen it.

## 7. Speech starts before the video, and start-up time varies a lot

- `POST /v1/session` took 15 to 46 s; the avatar's video then appeared 3 s to
  95 s after joining. Worst seen: 44 s to start and 95 s more for video, 139 s
  from Start to a visible avatar, which had greeted and checked in twice
  meanwhile (the page is still on "almost there", so the user hears nothing of
  it).
- The avatar's captions can arrive whole, ahead of its audio; captions cannot
  time app logic.

## 8. Words cannot be forced

`event`s are spoken in the avatar's own words, and the platform puts a filler
in front of most replies ("Right, gotcha,", "Yeah, totally, I can,", "ok yeah
ummm"). In front of a safety line it is wrong in tone: "Man, that's rough, Stop
— if this is happening now, hang up and call 911…", and "Man, that's rough" for
a bad knee. Lines that must be exact (a safety line, a refusal, a price, a
clue) can only be shown on screen as the source of truth. Numbers inside
events mostly survived: every landing figure, price move and nutrient figure
was said as given. The avatar's own numbers did not (an invented area before
the real one; square feet and square metres in one sentence).

## 9. Typed turns come back as speech

A typed `lk.chat` turn is echoed back on `lk.transcription` as if the user had
said it. The kit drops an echo of a line typed in the last 20 s; without that,
an app acting on speech acts twice on typed text.

## 10. Smaller things

- **No per-session speech hints** (the originals biased Deepgram toward
  square names, city names, star names). Seen: "Raise to five" as "Raised to
  five.", "Lob it" as "Lobbied", "Betelgeuse" as "Beetlejuice", "Add Nvidia" as
  "At Nvidia", "Add an upstairs" as "At an upstairs.". App judges must read the
  recogniser's variants, not only the clean sentence.
- **The transcript carries tags.** A turn started over the avatar's speech
  begins "[interruption]"; words it did not take as a turn come as
  "[backchannel] Sure, I." with the rest ("can share a photo.") as a separate
  utterance. The kit strips both tags.
- **An event and a user turn at the same moment: one wins.** A typed "what beats
  what?" met the opponent's move event; only the event was said. After a side
  switch, the opponent's first move was never named.
- **One live session per avatar, one user token per session**, no viewers.
- **A test avatar that never speaks** (`v2-e2e-test`): ready by the API, but in
  a session it never greeted or answered, and the session ended `user_left`
  after 90 s with no error the app could see.
- `lk.transcription_final` is now set on the avatar's captions (it was always
  interim on 2026-10-22); the user's interim transcripts are separate streams of
  one segment with the final flag on the last.
