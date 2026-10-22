# Trajectory Coach

Learn projectile motion by shooting at things. A practice range drawn to scale:
the coach sets a challenge, you aim by dragging an arrow (or by saying "try
forty degrees", "a bit harder", "twenty-five at thirty"), fire, watch the shot
fly, and the coach explains in real numbers why it fell short and what to
change. Six challenges, each built to disprove a piece of folklore about
forty-five degrees.

Ported from `Atmanity/apps/apps/trajectory-coach` (a Python LiveKit agent with
five tools, a fire-word watcher and a lander, plus a React canvas panel) onto
the Avatar API. Open `/apps/trajectory-coach/`; add `?challenge=moonshot` (or
`wall40`, `zone30`, `maxrange`, `headwind`, `ceiling`) to open on another
challenge, as the original's `appParams.startChallenge` did.

| Challenge | The point it makes |
|---|---|
| Clear the wall (3 m wall at 40 m) | 45° maximises range, and range is not what a wall asks for |
| Land in the zone (4 m zone at 30 m) | complementary angles land in the same place; the low one is twice as fast |
| Furthest on a capped launcher (≤ 18 m/s, past 32 m) | the one case where 45° really is the answer |
| Into the headwind (2 m wall at 35 m, −6 m/s) | wind costs range and leaves hang time alone: flatten and add speed |
| Under the roof (past 25 m, apex ≤ 6 m) | a roof caps sin θ; distance has to come from speed |
| On the Moon (g = 1.62, 6 m zone at 60 m) | range scales as 1/g: the same shot goes six times further |

## How it works on the API

| Feature | Mechanism |
|---|---|
| Physics, grading, the coaching sentence | `engine/flight.ts`, `engine/challenges.ts`: the original's closed-form model, ported line for line; `engine/golden.test.ts` pins every number and sentence to the Python engine's own output (`engine/golden/`) |
| The launcher (limits, refusals, re-arming, history) | `engine/launcher.ts`. Validate before mutate: a refused request leaves the range exactly as it was and carries a sentence with the numbers |
| The verdict withheld while the shot flies | the snapshot projection: while flying it has the curve and `play_s` and no `range_m`, `cleared`, `miss_m` or note. The panel, the readout and the avatar's state are all built from it, so none of them can announce a result early |
| Landing the shot | `engine/range.ts`, in the page: the range's own timer lands each shot `play_s + 0.15 s` after it is fired (the animation reads the same `play_s`). Only the range can land a shot. The engine runs in the page because nothing in it is secret: the landing point is the last point of the curve the page draws |
| The range (drag to aim, Fire, challenges, start over) | `page/Field.tsx`, `page/RangePanel.tsx`, `page/scene.ts`: the original panel, with the data layer swapped for `page/useRange.ts`. No predicted arc while you drag, only the arrow (and its numbers) |
| "Fire" (spoken or typed) | `engine/judge.ts` `isFireRequest`: the original FireWatch matcher, whole utterance only ("should I fire flatter?" never fires), plus "again" / "same again" |
| Aims: "try forty degrees", "twenty-five at thirty", "a bit steeper", "more power" | rules in `engine/judge.ts`: number words, units, "X at Y", relative words with fixed steps (a bit = 3° or 1 m/s, plain = 5° or 2 m/s, a lot = 10° or 5 m/s). Never clamped: "try ninety" is refused with the numbers |
| What the rules cannot read ("lob it like a mortar", "give it some welly") | `server.ts` `POST /api/apps/trajectory-coach/interpret`: a `structured()` call (Gemini), validated by `commandFromModel`. Without `GEMINI_API_KEY` the rules alone run |
| Choosing a challenge by voice ("let's do the Moon", "the windy one", "next one") | rules (aliases per challenge); the model fallback for the rest |
| "Why did that miss?" (the original's `explain_last`) | not an action: the avatar answers from the state, which carries the last shot's numbers and the range's sentence verbatim |
| The coach's rules | three standing `note`s (`engine/director.ts`), condensed from `persona.py` with the hard-won rules kept: never "aim first", never read the aim back, never ask whether to fire, never guess a shot in the air, numbers exactly as written |
| The live range | `state` (`rangeState`, ≤ 3,858 characters): the challenge, the aim, the last shot. Staged for what the avatar answers before the app can act: the launcher's limits (so "try ninety" is refused at once) and the six challenges with the next one along (so "let's do the Moon" is set up correctly) |
| The landing line, a challenge put up, a typed aim, a refusal | `event`s (`lineFor`, `refusalFor`): one per change, and none for a change the student's own speech caused (the avatar is already answering it) |
| The opening | an `event` naming the challenge actually up, after the avatar's own greeting |
| Typed lines | judged first: an action is applied and recorded in the transcript; anything else goes to the avatar as a typed turn, with the state already current |

Keys: `GEMINI_API_KEY` (optional; the model fallback for unusual phrasings).
No other key is used.

## What the API could not do

Status after the live run of 2026-10-23 (below): **seen** = observed live,
**expected** = not yet observed.

1. **The avatar answers a spoken command before the range acts.** Seen. "Fire" and "try forty degrees" reach the app about a second after
   the student stops, while the avatar is already replying. The original's
   FireWatch applied the shot *before* its model generated, so the reply was
   grounded; through the API the reply to "fire" cannot know the shot is away,
   and the reply to "make it steeper" cannot name the new angle. The notes tell
   the avatar to say one line watching it go and never the result; the app
   sends the landing as an event. The original's worst live failure here ("you
   haven't taken a shot yet" over a panel showing the arc) may come back. And
   when the app does not recognise a request the avatar has already accepted
   ("sure, let's do the Moon"), the avatar's words and the panel disagree.
   Live: "Fire" got "let's watch it fly!" and then the landing line, as
   designed. But "Forty-five at twenty-four, and fire" got "let's watch this
   one fly right over!" before it landed (right that time, by luck). "Lob it
   like a mortar", heard as "Lobbied like a mortar.", got "let's send it!"
   while the range did nothing: the app's model had answered "none". Its
   prompt now covers shots described by their shape ("like a mortar", "like a
   laser", "some welly"), and both phrasings now aim at 70°.
2. **Exact numbers cannot be forced.** Expected (live, both landing lines kept
   every figure: "0.76 m going past 40 m, 2.24 m below the top"). The app's promise is
   that every figure is computed once and quoted. Events and state are said in
   the avatar's own words, so "2.24 m below the top" may come out as "about two
   metres". The panel's note under the drawing is the exact source.
3. **No silence on demand.** Seen, mildly: one launch line, then the landing. The original told its model to
   "say NOTHING further" after a fire it had already taken (one "fire" had been
   narrated five times). The app sends nothing at launch, but cannot stop the
   avatar commenting on the launch and then saying the landing line.
4. **A refusal may be said twice, or late.** Seen: "the range maxes out at
   eighty-five degrees!" from the staged limits, then the event: "90 is off
   the rail". "Try ninety
   degrees": the limits are staged, so the avatar can refuse at once; the app
   also sends the range's refusal ("if you have not already told them"). Both,
   or a confirmation followed by the refusal, are possible.
5. **The landing line waits for the floor.** Expected (both landed lines came
   straight after the launch line). The verdict is
   on the panel the moment the ball is down; the spoken line follows once the
   avatar has finished its current sentence, and expires after 20 s if it never
   gets the floor.
6. **The ~10 s check-in nags a student who is thinking.** Seen ("Just checking
   in—did you want to keep chatting, or are you taking a quick break?", before
   the app's opening had even been said).
   The original nudged after 45 s of silence, at most twice; the built-in
   check-in cannot be tuned.
7. **No per-session persona or greeting.** Seen (the livestream host's own
   greeting first). The original
   composed "a physics coach at a launcher" under whatever avatar was bound and
   greeted with the challenge actually up. Here the avatar greets as itself and
   the opening event follows; `avatar.json` is the persona for a dedicated
   avatar. The original's per-workspace `instructionsExtra` has no equivalent
   and was not ported.
8. **No speech hints.** Seen ("Lob it" heard as "Lobbied"; gap 1). The original biased Deepgram toward
   "degrees", "metres per second", "headwind", "the moon", "steeper". Number
   words generally survive recognition; the judge reads digits and words.

## Differences from the original (deliberate)

- Spoken "fire" also fires after a miss (the original's FireWatch fired only
  from "aiming" and left the rest to its model's tool, which no longer exists).
- "Forty-five at twenty-four and fire" aims and fires (the fire phrase must be
  the whole last clause); "again" / "same again" fire the same aim.
- A challenge changed mid-flight cancels that shot's landing (the original's
  stale timer could bring the next shot down early).
- A refusal from speech or typing is shown on the panel, not only spoken.
- A "Next challenge" button after a clear, and the aim's numbers beside the
  finger while dragging (numbers only, still no predicted arc).
- Kept from the original as content: "Under the roof" starts aimed at 30° and
  20 m/s, which already clears it.

## Tested

- `npx vitest run apps/trajectory-coach`: the physics against hand-worked
  numbers and the marking (from `test_flight.py`); the launcher's refusals and
  projection (from `test_launcher.py`); a golden test against the Python
  engine's output (273 graded shots, the curves and trails, a scripted session's
  every snapshot and refusal); the range's reducer and lander, and the one-line-
  per-change rules (from `test_table.py`, rewritten for events); the FireWatch
  cases and ~100 real phrasings for the judge; the director's limits and leaks;
  the panel (from `RangePanel.test.tsx`), including a real range landing a shot
  on the page's clock; the page's wiring with the kit mocked (what each input
  does, which events go out and which do not, typed lines kept or handed over,
  the model fallback).
- Live: one run on staging, below.

### Live run (staging, avatar `2cd3ec08`, 2026-10-23)

Spoken lines through `tools/live-test/harness.js`, on "Clear the wall":

- "Fire!" → "let's watch it fly!", then "You were at 0.76 m going past 40 m,
  2.24 m below the top. Plenty of range — 40.77 m…".
- "Why did that miss?" → from the last shot's numbers: enough distance, not
  enough height at the wall; try steeper.
- "Make it steeper." → 50°, no event. "Try ninety degrees." → refused twice
  (gap 4); the aim stayed.
- "Forty-five at twenty-four, and fire." → 45° at 24 m/s, then "Over with 9.75 m
  to spare, landing at 58.72 m after 3.46 s", and the teaching point.
- "Let's do the moon." → On the Moon, from the staged challenges. "Should I
  fire flatter?" → advice, nothing fired.
- "Lob it like a mortar." → misheard and not read (gap 1, fixed).
- Session `completed`, `ended_by_api`, 224 s billed.
