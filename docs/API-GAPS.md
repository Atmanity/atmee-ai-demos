# What the Avatar API could not do

Found while porting the fourteen mini-apps from `Atmanity/apps` onto the public
Avatar API (staging, October 2026), and while building `classic/`. Each item
says what was seen, why it matters, and what the apps do about it today. Every
app's README has its own live run and its gaps marked seen or expected.

Measured on staging Causeur sessions with the test harness in
`tools/live-test/` (a synthetic microphone fed from spoken WAV files), in three
rounds: before the apps used tools (one run per app, on three shared test
avatars); with tools (one run per app); and after fixing what that run found
(round 2, 23 October), each app on its own host in the testuser account.

## The live runs at a glance (round 2: tools, own hosts, after the fixes)

| App | What worked | Still seen (section) |
|---|---|---|
| Postmark (guess-the-city) | a guess, a clue, the reveal and the next city, each through its tool | the next photo blank for 8 s while Marco said it was up (fixed since: photos are fetched when the game is dealt) |
| Kibitz (chess-opponent) | a typed "Ra5" refused on the board; "Black, please." called `choose_side` in 2.6 s | "That's actually not right, we're flipping the board now!" before a switch that happened (1.2) |
| Blindside (poker-table) | "What beats what?" called `show_hand_rankings` and the chart opened | "Check." facing a bet and "New match" answered by Dex in words, no call (1.3; tightened since) |
| Hanshi (stroke-tutor) | a reversed stroke said in two fixed sentences; "Next." 4 of 5 calls, the safety net the fifth | "every stroke right on your first try", which was not true (1.4; fixed since) |
| Bystander (bls-tutor) | the tools, the red card and the 911 sentence itself | "Yeah, good call, but…" before a Not-yet verdict; a filler before the emergency line (1.2) |
| Chalkline (quadratic-whiteboard) | Ada's persona; a typed "Hide the graph." handled once in 1.1 s | short fillers, the check-in (6) |
| Arcwise (trajectory-coach) | "Fire!" during the greeting and "Start over." called their tools; aims named, never predicted | one tight-crop video frame (10) |
| Lodestar (sky-guide) | Kyoto refused with Tokyo offered; Vega marked, Cygnus drawn | "What does that mean, then?" before results (1.2) |
| Morsel (nutrition-advisor) | "Potassium isn't listed on this card", no number | a doubled filler before the first result (1.2) |
| Notch (fashion-advisor) | the occasion, "Rate it again." and "More streetwear." all called; the example photo noticed at once | the same outfit re-rated 7 then 5 (app; fixed since) |
| Spotter (fitness-coach) | every step called in 2.9–4.9 s (none in round 1); the plan built by voice; the safety stop | the 20-minute cap dropped from `add_limits` (1.4; fixed since); fillers before the safety lines (1.2) |
| Outcry (market-desk) | the closing sheet's time in English | "Pull up Tesla." never called, 2 of 2 (the safety net did it) (1.3); the live video framed on Reese's eyes (10) |
| Yonder (travel-guide) | São Jorge Castle and Lisbon Cathedral, with photos | fillers only (1.2) |
| Planwright (room-planner) | open plan as one room; the piano through `add_furniture`; an upstairs keeps the ground floor | a piano size invented before the plan's refusal (1.4; tightened since) |

## 1. Function calling: what it fixed, and what it still lacks

`POST /v1/session` takes `appTools` (session-service #182, Causeur #121, on
staging since 23 October): up to 30 function tools in the OpenAI shape plus
`instructions` (4,000 characters). The avatar calls a tool as a LiveKit RPC to
the page (`atmee.tool`, payload `{id, name, arguments}`); an `await` tool holds
the reply for the page's answer (1 to 28 s, default 8), a `notify` tool does
not. Only sessions that run on Causeur call tools.

It fixed the central problem of the first port: **the reply is grounded in
what the app did.** In round 2 requests became calls in 2.6–4.9 s and the
first reply carried the result: verdicts, clues, refusals with the legal
options, the plan's own numbers. Every app now uses tools. What it still
lacks:

### 1.1 A call whose arguments miss the schema never reaches the page

Causeur checks a call's arguments against the tool's JSON Schema before
sending it. One that does not fit is answered to the model as "error: invalid
arguments"; the page never hears of it, and the model often goes on as if the
action happened. In round 1, Spotter's "Beginner, please." never arrived in 2
of 2 runs (its `level` was an `enum` of lower-case words) while Sammy said
"I've set you up for a beginner plan"; `add_limits` and `start_move` were lost
the same way. Every app now uses lenient schemas (no `enum`,
`additionalProperties: false`, `pattern` or tight lengths) and normalises the
values itself; Spotter then called every step in round 2.

Wanted: deliver a rejected call to the page with the validation error (or an
`x-atmee` switch to turn validation off), and say in the docs that a call
that fails validation is invisible to the app.

### 1.2 The filler before an `await` result pre-judges it

While an `await` tool runs, the avatar says a filler of its own. It is chosen
before the result exists, so it guesses: "Yeah, good call, but…" before a
Not-yet verdict, "That's actually not right" before a side switch that
happened, "Of course, you can't…" before the table's refusal, "Well, I don't
agree, because…" before a doctor-clearance sentence, "Oh, that's difficult,"
before the emergency line. Results that begin with the outcome ("Not yet: …")
put the verdict second, never first. Where the words are safety lines
(Bystander, Spotter), the page's own card is the guarantee.

Wanted: a per-tool switch for no filler (silence, or a fixed neutral line), or
a way to have the result's first sentence spoken verbatim.

### 1.3 Some requests are narrated instead of called

Even with the user's own phrasings in the description, "Pull up Tesla." was
never called in 2 of 2 runs; one "Next." in five was narrated; Dex answered
"New match" mid-hand by refusing in his own words. For actions safe to repeat
the apps add a safety net: the page acts after 7 s and tells the host
(`src/kit/useToolNet.ts`). Actions with a cost if doubled cannot be covered
that way.

### 1.4 Hosts add numbers of their own around a result

"A grand piano takes up nearly four square metres" before the plan's refusal;
"Got your twenty-minute timer locked in" when the call carried only the knee;
"every stroke right on your first try" when one was not. Results now carry the
facts the host would otherwise reach for (the room's area, every limit said,
the first-try record) and the instructions forbid numbers that did not come
from a result.

### 1.5 Delivery

Calls go to the page in the room only: no server webhook, the page must be
open to answer, and it is the user's own client. A result is at most about
15 KB. The opening is the host's own greeting; an app's opening event that
greets again doubles it (seen in round 1, fixed in every app).

### Without tools

A behaviour-module session accepts `appTools` and never calls them. There the
avatar answers before the app can act: the user's final transcript reaches the
app about 1.0 s after they stop, while the reply is already being made, so a
`state` sent then shapes the next reply, not this one ("nor do I know any
secret number", then "Your secret number is 4417"). The first port of these
apps worked around it with standing notes, staged `state`, and events after
the fact; holding lines ("let's see") became promises only the app could keep,
and outcomes were invented then corrected.

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
opponent at a chessboard". So each app now has its own host: `avatar.json` is
its persona and the id of an avatar built from it (portrait, designed voice,
greeting that introduces the product). That is fourteen avatars to keep in step
with fourteen apps, and an app's persona change is a `PATCH` to its avatar, not
a code change. The host's greeting is spoken before the app can say anything,
so the app's opening must not greet again.

Long rule sets (2k–13k characters in the originals) fit only as several
`note`s (2,000 characters each); there is no per-session system prompt.

## 5. The agenda (conductor) belongs to the avatar too

A conductor is set per avatar, not per session. Apps that share an avatar must
put their own agenda back before each session (the server does this), and two
apps on one avatar at once would fight over it.

How it behaves, from `classic/`'s recruiter and training agendas (live, 23
October; none of the fourteen apps uses one). The recruiter ran every stage
once, in order; the training lecture spoke its three slides back to back with
no user input and stopped for questions, as designed. What went wrong follows
from one rule: a step does not move until the user has heard a turn written
under it.
- The training's Q&A step said "if they have none, start the quiz". The
  trainee's "No questions." was answered under that step, which held, so the
  model started a quiz it had no questions for: it invented one (quiz 2's
  topic), marked the next answer against quiz 1, and later made up a third
  question. The intro ("then go straight into slide 1") taught invented slide-1
  content before the real slide 1. A step's instructions must never ask for the
  next step's content; put the check on the asking step's edges, with an edge
  back to itself.
- The last step stays in force, so the idle check-in said the farewell again
  19 s after it ended. End the session after the last step.
- The quiz page kept score by a verdict's first word ("Correct"); the filler
  came first ("Aye, good choice, right right correct"), the score stayed 0 and
  the wrap read "nought of two". Score through a tool, not the transcript.
- The recruiter greeted twice: once on its own, once when the page's update
  with the candidate's name arrived, with no user turn between.

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
- **A third session at once on the shared test avatars hung**: `POST
  /v1/session` answered 524 (twice) after a long wait instead of 503
  `no_capacity`. On the dedicated hosts, four sessions at once worked.
- **Intermittent video artefacts on the v2 hosts.** Seen live, never in a
  host's seed clip: Theo's idle video showed large orange 3-D letters over his
  face (round 1) and later his plain grey backdrop turned into a rocky,
  sculpture-like scene; Reese's video sat on an eye-level close-up for a whole
  call (round 2). A repeat of both hosts, six screenshots, was framed normally,
  so they come and go. The page cannot tell or fix it.
- **Building the hosts:** the create-avatar skill's lip-sync contact sheet
  crops a fixed band that catches the chin, not the mouth, on a tight
  headshot; the hosts were judged on a mouth-centred crop instead.
- **A test avatar that never speaks** (`v2-e2e-test`): ready by the API, but in
  a session it never greeted or answered, and the session ended `user_left`
  after 90 s with no error the app could see.
- `lk.transcription_final` is now set on the avatar's captions (it was always
  interim on 2026-10-22); the user's interim transcripts are separate streams of
  one segment with the final flag on the last.
