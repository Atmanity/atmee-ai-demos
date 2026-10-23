# Bystander

CPR and first-aid practice for ordinary people. Alex, a calm paramedic
instructor, runs you through a scene (an adult collapse in a café, a child by a
pool, choking at dinner, someone unresponsive but breathing) one step at a
time. Say or type what you would do; the drill grades it against the AHA/ERC
lay-rescuer sequence, teaches each step with the exact numbers, and ends with a
review of what you got and what you were shown. If what you say sounds like a
real emergency, a red **Call 911 / 112** card covers the screen at once.
Practice only: *This is CPR practice, not certification, and not medical
advice. In a real emergency call 911.* Rebuilt from the `bls-tutor` mini-app
as a standalone product on the Avatar API.

Open it at `/apps/bls-tutor/`.

## How it works

| Part | Where |
|---|---|
| The drill: four scenarios, one step at a time, the two-miss rescue, the review | `engine/scenarios.ts` (the content, every clinical number) and `engine/tutor.ts` (the rules), on the server. The page sees a stripped view: a step's words appear only once it is answered or shown. `page/imports.test.ts` keeps the content out of the page bundle. |
| Grading | `tutor.ts grade()`: substring matching against each step's expected and forbidden phrases, forbidden first. No model and no keys. |
| Alex's actions | Eight `await` tools (`engine/director.ts`): `check_answer(answer)`, `show_step`, `give_hint`, `next_step`, `start_scenario(scenario)`, `leave_scenario`, `stop_for_emergency`, `resume_practice`. The page answers each `atmee.tool` call by asking the server, which acts (`engine/drill.ts run()`) and returns the words Alex speaks from. His first reply to an answer carries the drill's verdict; a second miss comes back already taught. |
| Naming a drill | Alex passes what he heard ("the pool one", "you pick"); `engine/judge.ts` decides which of the four it is, or none. |
| Alex's rules | The tool `instructions`: never grade on his own, never a number from memory, never teach ahead, call the tool every time, real emergencies first. |
| What Alex sees | `state`: the screen (the scene, the question, tries, the nudge, a hint once asked for, the steps done, the score), never the live step's answer or anything after it. |
| Buttons | Show me this step, Give me a hint, Next step, Choose another drill, the drill cards, Run this drill again: they act at once and Alex is told by an event. |
| The safety net | `useToolNet` (kit) with `engine/net.ts mustDo`: when the learner clearly says "show me", "next", "go back", names a drill, or says it was a false alarm, and Alex does not call the tool within 7 s, the page does it and tells him. It stands down if the drill moved since the words. Never for answers or hints (a second grade would use up an attempt). |
| Real emergencies | The page reads every spoken and typed line (`engine/safety.ts`) and the red card goes up the moment one reads like a real emergency, before and without the server. A typed one is never sent to Alex as a turn; he is told at once. A spoken one he heard himself: if he has not called `stop_for_emergency` within 3 s, the page tells him. His own `stop_for_emergency`, and `check_answer` screening every answer, are second ways to the same card. |
| The way off the card | Its button, or `resume_practice`, which the page honours only when the learner's own words since the card went up say plainly that nobody is in danger (`net.ts clearedBy`). Alex cannot talk anyone off it. |
| The screens | The front door (`page/Lobby.tsx`); the drill sheet (`page/Sheet.tsx`): the scene, the question, the nudge or hint, the teaching point, the compression beat, the protocol rail, the review; the red card (`page/Emergency.tsx`); styles in `page/bystander.css`. A resolved step's pictogram and the metronome appear only after it is resolved: beside an open question they gave the answer away. |

## What the API could not do

Status after the live runs of 2026-10-23 (shared host, then Alex's own host
twice).
**Seen**: observed live. **Expected**: not observed yet.

1. **The emergency line cannot be forced word for word.** *Seen, a platform
   gap.* While an `await` tool runs, the platform has the host speak a filler
   of its own, and it is spoken before the result arrives, so no wording of the
   result can remove it: round 1 "Heavy stuff, ok I know, but stop — if this is
   happening now…", round 2 (after the line was moved to the very start of the
   result) still "Oh, that's difficult, Stop — if this is happening now…". The
   sentence itself was word for word both times. Needed from the API: a
   per-tool "no filler" switch, or a way to have a line spoken verbatim. The
   original spoke it through text-to-speech with no model in the path. Here
   `stop_for_emergency` returns it with "word for word, and nothing else", and
   the page's event says the same, but Alex words results himself and an event
   waits for the floor. The first port saw it said behind a filler ("Man,
   that's rough, Stop — if this is happening now…") and twice. **The guarantee
   is the screen:** the card carries the exact sentence and tap-to-call numbers,
   covers everything, and goes up as soon as the words arrive.
2. **Spoken emergencies are only as good as the transcript.** *Expected.* The
   page reads the recogniser's text about a second after the learner stops; a
   misheard "he's not breathing" is not caught by the rules. Alex's own
   judgement (`stop_for_emergency`) is the second chance. Typed text is certain.
3. **Tools are called when Alex decides, and the filler speaks first.** *Seen,
   the filler a platform gap.* Every verdict came from `check_answer`, but the
   platform's filler praised a wrong answer before the verdict: round 1 "Good
   choice, okay but…", round 2 (with outcome-first results and a rule against
   judging while a tool runs) still "Yeah, good call, but find out how bad it
   is first…". The filler is spoken before the result exists, so the app cannot
   reach it; the verdict itself was always the drill's, and the sheet shows
   "Not yet" with the nudge at once. "This is too hard, can we do the one where someone collapsed
   instead?" called `leave_scenario`, not `start_scenario`; the instructions now
   say to start a named drill, and the safety net does. He may narrate ("let's
   move on") without the call, or judge an answer aloud before `check_answer`.
   The safety net covers show me, next, leaving, choosing a drill and the false
   alarm; an answer he never passes on stays ungraded, and the learner can type
   it again or use the buttons.
4. **Clinical numbers can be paraphrased.** *Expected.* Every result quotes the
   teaching line "without changing any number", but Alex speaks in his own
   words ("at least 2 inches" could become "about two inches"). The exact text
   is on the sheet.
5. **The ~10 s check-in prods a learner who is thinking.** *Seen in the first
   port* ("Still thinking it…"). It can no longer offer the next question early:
   that question is not in Alex's state until `next_step` returns it.
6. **The persona and the greeting belong to the avatar.** *Seen in the first
   port* ("Hi! I'm Emily…" on the shared test avatar, then the opening with the
   safety line). `avatar.json` is Alex, for a dedicated host.
7. **Mute deafens the app**, so the emergency watch hears nothing while the
   learner is muted. *Known (docs/API-GAPS.md).*
8. **No speech hints** for "AED", "defib", "Heimlich", "paediatric".
   *Expected.*

Fixed by tools, compared with the first port: Alex's reply to an answer now
carries the drill's verdict (before, a holding line and then an event); the
live step's answer, teaching line and hint are no longer staged in his state
for "show me" (they come only from `show_step` and `give_hint`); rules no
longer decide what every line means, so chit-chat cannot be graded as a wrong
answer; and a spoken "show me" or scenario choice is no longer narrated twice.

## Tested

- `npx vitest run apps/bls-tutor`: 601 tests. The engine's own
  (scenarios, grading, phases, the review, the emergency watch and its
  suppressions; only the staging tests went, with staging), plus, for every
  step of every drill, a table of the answers people give (`engine/answers.test.ts`:
  right ones in several phrasings, first person, "30:2", "thirty two", "30 to
  two"; wrong ones and near misses, such as keeping 30:2 with two rescuers or a
  rescue breath for a breathing check), which grading must take whole, through
  one normaliser for answers and phrases (`tutor.ts answerForm`); `run()` for every
  tool and refusal; the tools and
  instructions against the API limits, and the state and every result never
  reaching a step the learner has not resolved, across every scenario; the
  safety net's phrases per phase and the way off the card; the page end to end
  against the real server routes (the front door, a drill driven by tool calls
  and buttons, the review, the red card from speech, typing, Alex and an
  answer, the card's button with the server down, the net doing and not
  doing); one call at a time (a set-up, a tool or button answer, or the 911
  reminder from a call that ended or was replaced never reaches the screen or
  Alex; a new call with the red card up opens with the 911 sentence); and the
  sheet's controls per phase.
- Live on staging, 2026-10-23 (shared host `baf61f2c`, then Alex's own host
  `35cd3138`), spoken through `tools/live-test/harness.js`: every step went
  through its tool (`check_answer`, `next_step`, `give_hint`, `show_step`,
  `start_scenario`); "my dad just collapsed and he's not breathing" put the red
  card up from the page's own watch before Alex's `stop_for_emergency`, the line
  was said once, and practice resumed only after "false alarm, nobody's hurt".
  Since then: outcome-first results, lenient tool schemas, no second greeting.
- Round 2 on Alex's new host (`ea5aab54`, 119 s): one greeting, then the
  safety line and the choking scene; Alex's face on the front door badge and in
  his frame. A wrong answer, "my dad just collapsed and he's not breathing" and
  "false alarm, nobody's hurt" went through `check_answer`, `stop_for_emergency`
  and `resume_practice`: the Not-yet card, the red card, the 911 sentence word
  for word, and back to the same step. The platform's filler still came first
  ("Yeah, good call, but…", "Oh, that's difficult, Stop —"; gaps 1 and 3). What
  the app does about it: the red card is the guarantee. It goes up from the
  page's own watch the moment the words arrive, with the exact sentence and
  tap-to-call numbers, whatever the host says before it.
