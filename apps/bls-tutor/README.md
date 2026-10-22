# BLS Tutor

A calm paramedic instructor runs a Basic Life Support practice drill: an adult
collapse, a child pulled from a pool, choking at dinner, or someone
unresponsive but breathing, one step at a time. Say or type what you would do;
the drill grades it against the AHA/ERC sequence, teaches each step with the
exact numbers, and reviews what you got and what you were shown. If what you
say sounds like a real emergency, the drill stops and a red **Call 911 / 112**
card covers the screen.

Ported from `Atmanity/apps/apps/bls-tutor` (a Python LiveKit agent with six
tools, a coach and an emergency watch, plus a React panel) onto the Avatar API.
Practice only: *This is CPR practice, not certification, and not medical
advice. In a real emergency call 911.*

**Use it:** start the drill, pick a scenario (a card, or say "let's do
choking"), and answer each question out loud, in the composer, or in the
panel's answer box. "Show me" or "I don't know" teaches the step; "next" moves
on; "go back" or "this is too hard" returns to the menu. Two misses and the
drill shows you the step. Compression steps have a 110 bpm metronome.

## Where things run

| | |
|---|---|
| `engine/scenarios.ts` | The content: four scenarios, every clinical number in the app. **Server only.** |
| `engine/tutor.ts` | The rules: phases, grading (substring matching, forbidden-before-expected), the stripped snapshot, what is staged. Server only. |
| `engine/safety.ts` | The real-emergency and resume watch. Pure; the page runs it too. |
| `engine/judge.ts` | Which action a typed or spoken line is (rules, no model). Server only. |
| `engine/drill.ts` | One input in, one outcome out: the old reducer, tools and coach in one place. |
| `engine/director.ts` | The notes, the state text, the event texts. Reads only the view. |
| `engine/lines.ts` | The safety line and the emergency line, and the emergency card's snapshot. |
| `server.ts` | `POST /drills`, `GET /drills/:id`, `POST /drills/:id/act` (`{intent}` from a control, or `{text}`, with `from`). |
| `page/` | `App.tsx` (the kit, the inputs, the emergency raise), the ported `TutorPanel`, `metronome.ts`, `bls.css`. |

The drill runs on the server because a step's label is the answer to the
question on screen: the page only ever sees the stripped snapshot.
`page/imports.test.ts` checks that nothing the page imports reaches
`scenarios.ts`, `tutor.ts`, `judge.ts` or `drill.ts`.

No model calls and no keys: grading was deterministic in the original and
stays so, and the judge is rules. `GEMINI_API_KEY` is not used.

## How it maps to the API

| Feature | Mechanism |
|---|---|
| The instructor's rules (no numbers from memory, never grade, never teach ahead, emergencies) | three `note`s, condensed from the 3.2k-character persona (`director.ts NOTES`) |
| The opening, with the safety line word for word | an `event` once per session (the avatar greets as itself first); the line is also on screen permanently |
| The drill (scenario, step, attempts, score, verdict, steps done) | `state`, rebuilt from the view on every change |
| A spoken "show me", hint, "next", or scenario choice | **staged in `state`** so the avatar's own immediate reply is the real one: the live step's model answer, teaching line and hint ("only if they ask"); between steps, the next question; at the menu, each scenario's scene and first question. The app then acts and sends no event for that spoken request |
| Verdicts, the two-miss rescue, a button's or typed command's result | `event`s (ttl 30 s), worded as the original's cues ("keep every number exactly as written") |
| Typed lines (composer) | judged on the server first; a drill action is recorded and acted on, talk ("can I have a hint?", "what's the rate again?") goes to the avatar as a typed turn |
| Spoken lines | `onUserSaid(text, 'spoken')` → emergency watch → judge → act → `state` + `event` |
| Panel controls | the original panel's intents, unchanged (`answer`, `reveal`, `next`, `start_scenario`, `leave_scenario`, `ack_safety`); a refusal shows on the panel |
| Real emergency (spoken, typed, or in the answer box) | the page runs `isRealEmergency` the instant the words arrive: the red card goes up (fixed over the whole page, with the exact line), and an `event` (ttl 60) asks the avatar to say the line word for word; the server stops the drill too. Said once per card |
| Clearing the card | its button, or a plain "false alarm, nobody's hurt" (rules); "…let's do choking" goes straight into it; never left to the avatar |
| Metronome, ladder, review, safety footer | the page only |

## What the API could not do

Status after the live run of 2026-10-23 (below): **seen** = observed live,
**expected** = not yet observed.

1. **The emergency line cannot be forced word for word.** *seen: said twice,
   with a filler in front*
   This is the safety-critical gap. The original spoke `EMERGENCY_LINE` through
   `session.say`, text-to-speech with no model in the path, interrupting
   whatever was playing. Through the API the line reaches the avatar three
   ways, none of them binding: a standing note gives it the exact sentence in
   advance, the emergency state repeats it, and an `event` asks for it "word for
   word, and nothing else". Events are spoken in the avatar's own words, wait
   until it has the floor, and can expire. For a *spoken* emergency the avatar
   has already started its own reply before the app hears the transcript; as an
   instructor it may begin coaching CPR. Expect the line paraphrased, delayed,
   or said twice (its own reply, then the event). **The guarantee is the screen:**
   the red card carries the exact sentence and the numbers to dial, covers
   everything, and goes up the moment the words arrive, even with the server
   unreachable.
   Live: the avatar's own reply to "my dad just collapsed and he's not
   breathing" did carry the line, from the standing note, but behind its
   filler: "Man, that's rough, Stop — if this is happening now, hang up and
   call 911…". The event then made it say the line a second time. The card was
   up as soon as the transcript arrived.
2. **Spoken emergencies are only as good as the recogniser's transcript.**
   *seen (a different line)* The app reads the avatar's own speech recognition,
   about a second after the learner stops. A misheard "he's not breathing"
   is not caught. Typed text is certain. Live, "This is too hard, can I pick a
   different scenario?" arrived as "I pick a different scenario?" (it still
   worked).
3. **No verdict before the reply.** *seen: holding lines; no wrong verdict in one run* The original's
   `answer_step` made the model wait for the grade. Now the avatar answers a
   spoken answer at once; a note tells it to say only a neutral holding line,
   but expect it to judge anyway sometimes ("that's right!" to a wrong answer),
   then relay the drill's verdict. Live, both answers got "let's see what the
   drill says" and then the right verdict; it did not pre-judge.
4. **Clinical numbers can be paraphrased.** *expected* Every event
   quotes the teaching line and says "without changing any number", but the
   avatar words events itself ("at least 2 inches" could become "about two
   inches"). The exact text is on the panel.
5. **Staging puts the live step's answer in the avatar's state.** *seen
   working; no leak in one run* The original kept every unresolved label away from the model.
   Without function calling, a spoken "show me" or "a hint?" would otherwise get
   an invented step or a number from memory, so the live step's model answer,
   teaching line and hint are staged, fenced by "never say, hint at or use it
   unless they ask". Expect an occasional leak. Steps ahead are never in the
   state (tested), and the staged block is never drawn. Live, "I don't know,
   show me" was answered at once from the staged answer ("encourage her to
   keep coughing…").
6. **The ~10 s check-in prods a learner who is thinking**, and may offer the
   staged next question before the learner said "next" (the drill has not
   moved, so their answer is taken as talk and not graded). *seen* (three
   times in one run: "Still thinking it…", "Take your time—what do you…").
   The original had no nudges.
7. **The persona and the greeting belong to the avatar.** *seen* ("Hi! I'm
   Emily, I'm twenty-one and navigating college…", then the app's opening
   with the safety line).
   The original greeting had to contain the safety line verbatim. Here a shared
   test avatar greets as itself, and the app's opening event asks for the line
   after. `avatar.json` is the instructor for a dedicated avatar.
8. **The app, not a model, decides what a line is.** *expected* (none seen) The
   original's model chose a tool; here rules do (`judge.ts`). Expect edge cases:
   chit-chat graded as a wrong answer, or the avatar setting the scene of a
   scenario the app did not start (a spoken choice the rules did not
   recognise). Every action also has a button.
9. **Mute deafens the app**, so there is no push-to-answer (answering only
   when the learner chooses). *known (docs/API-GAPS.md)*
10. **No per-session speech hints** for "AED", "defib", "Heimlich",
    "paediatric". *expected*

## Changes from the original

- **More emergency phrasings, all towards stopping:** curly apostrophes, a
  spoken "nine one one", 112 alongside 911, and first-person reports ("my dad
  collapsed", "my baby is choking"), which the original caught only with a
  second phrase. Its own patterns and hypothetical suppressions are unchanged.
- **Clearing the card by voice** used the original model's judgement
  (`resume_practice`); here it is a phrase list plus "nothing left in the line
  still reads as an emergency", so "false alarm… no wait, he's not breathing"
  keeps it up.
- **"next" variants** ("okay, next", "let's move on") and, between steps, a
  bare "yes" count as next; talk ("okay", "can I have a hint?", wh-questions)
  is not graded, so it cannot use up the two attempts.
- **Staged facts** (`BlsTutor.staged()`), see gap 5.
- The emergency card covers the whole page (it covered the panel; the avatar
  was elsewhere in the old shell).

## Tested

`npx vitest run apps/bls-tutor`: 245 tests, 121 ported or re-expressed from
the original (`test_safety.py`, `test_tutor.py`, the relevant
`test_table.py` cases, `TutorPanel.test.tsx`) and 124 new (the judge's
phrasings, the director's limits and leaks across every step of every
scenario, staging, the page's emergency path end to end with the server up and
down, the import guard).

### Live run (staging, avatar `baf61f2c`, 2026-10-23)

Spoken lines through `tools/live-test/harness.js`:

- Opening: the avatar's own greeting, then the app's: "This is CPR practice,
  not certification, and not medical advice. In a real emergency call 911.
  Which would you like…".
- "Let's do choking." → the board went to the choking scene (0/6) and the
  avatar set it ("Mid-meal, the woman opposite you stands up suddenly…").
- "I'd give her back blows." → "let's see what the drill says", then the drill:
  "Find out how bad it is first…". Board stayed at step 1.
- "I'd ask if she's choking and can cough." → "That's it, exactly right…";
  board 1/6. "Next." → step 2 read. "I don't know, show me." → the staged
  answer.
- "This is too hard, can I pick a different scenario?" → the menu.
  "Let's do the one where someone collapsed." → the café scene (0/7).
- "Wait, my dad just collapsed and he's not breathing." → the red card, and the
  emergency line twice (gap 1). "False alarm, nobody's hurt." → card down,
  practice back at the same step.
- Session `completed`, `ended_by_api`, 300 s billed.
