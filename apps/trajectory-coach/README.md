# Arcwise

A projectile-motion practice range with a coach. The range is drawn to scale
on a chalkboard; Theo puts up a target, you aim (drag the arrow, nudge the
steppers, or tell him "forty degrees", "a bit more speed"), fire, and watch the
shot fly. When it lands, Theo tells you in the range's own numbers why it
fell where it did ("you were at 0.76 m going past 40 m, 2.24 m below the
top") and gives you one thing to change. Six challenges, each built to
disprove a piece of folklore about forty-five degrees; a logbook of every
lesson to keep. Rebuilt from the `trajectory-coach` mini-app as a standalone
product on the Avatar API.

Open it at `/apps/trajectory-coach/`; add `?challenge=moonshot` (or `wall40`,
`zone30`, `maxrange`, `headwind`, `ceiling`) to open on another challenge.

| Challenge | The point it makes |
|---|---|
| Clear the wall (3 m wall at 40 m) | 45° maximises range, and range is not what a wall asks for |
| Land in the zone (4 m zone at 30 m) | complementary angles land in the same place; the low one is twice as fast |
| Furthest on a capped launcher (≤ 18 m/s, past 32 m) | the one case where 45° really is the answer |
| Into the headwind (2 m wall at 35 m, −6 m/s) | wind costs range and leaves hang time alone: flatten and add speed |
| Under the roof (past 25 m, apex ≤ 6 m) | a roof caps sin θ; distance has to come from speed |
| On the Moon (g = 1.62, 6 m zone at 60 m) | range scales as 1/g: the same shot goes six times further |

## How it works

| Part | Where |
|---|---|
| The physics and the marking | `engine/flight.ts`, `engine/challenges.ts`: the original's closed-form model (no drag), ported line for line; `engine/golden.test.ts` pins every number and sentence to the Python engine's own output (`engine/golden/`). |
| The launcher and the range | `engine/launcher.ts` validates before it mutates, so a refused request leaves the range as it was and carries a sentence with the numbers. `engine/range.ts` is the one writer and owns the clock that lands each shot `play_s + 0.15 s` after it is fired. While a shot flies, the snapshot has its curve and no result, so nothing built from it (the screen, Theo's picture of the range) can announce one early. It runs in the page: nothing in it is secret. |
| Theo's actions | Four `await` tools (`engine/director.ts`): `aim(angle_deg, speed_ms, request, then_fire)`, `fire`, `choose_challenge(challenge)`, `start_over`. The page answers each `atmee.tool` call through `engine/controls.ts`, which acts on the range and returns the words Theo speaks from. `fire` resolves when the ball is down, with the range's verdict, so his first reply to "fire" is where it landed. |
| Aims in words | `aim` takes the numbers Theo heard, never clamped (the launcher refuses "ninety" with its limits). A change with no number ("a bit steeper", "more power") goes in `request` and through the range's own steps (`engine/judge.ts`: a bit = 3° or 1 m/s, plain = 5° or 2 m/s, a lot = 10° or 5 m/s); what the rules cannot read ("lob it like a mortar") goes to `POST /api/apps/trajectory-coach/interpret`, a validated model call. Without `GEMINI_API_KEY` Theo asks for a number instead. |
| Theo's rules | The tool `instructions`: the range moves only through a call; numbers exactly as given; never guess a shot in the air; never "aim first", never read the aim back, never ask whether to fire, never give away the answer. |
| What Theo sees | `state` (`rangeState`): the challenge and its conditions, the aim and the limits, the last shot's numbers and sentence, recent shots, the lesson once earned, the six challenges. Questions ("why did that miss?") are answered from it, no tool. |
| The screen's controls | The arrow, the angle and speed steppers, Fire, the challenge list, Next challenge and Start over act at once (`Controls.press`). Theo is told by an event: a new challenge at once, a shot when it lands, the aim not at all (the board shows it). |
| One account per landing | A shot is told once: as the result of the `fire` call waiting on it, or, when it came from the Fire button, as an event when it lands. A `fire` call while the button's shot is up joins it. |
| The safety net | `useToolNet` with `mustDo` (`engine/judge.ts`): when the student clearly says "fire", "start over" or names a challenge and Theo makes no such call within 7 s, the page does it and tells him. Fire uses the original's whole-utterance matcher, and is skipped if a shot already went up around the words; a challenge goes by its id ("next" is pinned when heard), and a late `choose_challenge("next")` within 15 s of the net's is the same request. Aims are left out: "a bit steeper" done twice would move twice. |
| The logbook | `engine/logbook.ts`, `page/Logbook.tsx`: every challenge, shots taken, the shot that cleared it with the range's sentence and the lesson, saved as a text file. It opens when the call ends and is a tab away during it. |
| The screens | The front door (`page/Lobby.tsx`), the range (`page/Board.tsx`, the chalkboard in `page/Field.tsx`), the logbook, Theo's frame and the conversation (kit parts), styled in `page/arcwise.css`. |

Keys: `GEMINI_API_KEY` (optional; the model for aim words the rules cannot
read). No other key is used.

## What the API could not do

Status before the first live run of this version (the run of 2026-10-23 was
of the earlier, tool-less port). **Expected**: not observed yet.

1. **Tools are called when the host decides.** *Expected.* Postmark's host
   occasionally narrated an action instead of calling it. Here the safety net
   catches "fire", "start over" and a named challenge; a narrated aim ("sure,
   steeper!") without a call changes nothing, and the arrow on screen shows
   the truth.
2. **Exact numbers cannot be forced.** *Expected.* Results are said in Theo's
   own words, so "2.24 m below the top" may come out as "about two metres". The
   sentence under the board is the exact source. (Before tools, both landing
   lines kept every figure.)
3. **One filler line while `fire` waits.** *Expected.* An `await` tool allows
   one filler line during the ~3 s flight, so "here it goes!" may come before
   the landing. The original wanted silence until the ball was down.
4. **The button's landing waits for the floor.** *Expected.* A shot fired with
   the Fire button is told as an event: it follows Theo's current sentence and
   expires after 20 s if he never gets the floor. Shots Theo fires carry the
   landing in the tool result.
5. **Aim and fire as two calls.** *Expected.* For "forty and fire" Theo should
   set `then_fire`; if he calls `aim` and `fire` together and the shot is
   handled first, the aim is refused ("still in the air") and the shot uses
   the old aim.
6. **The ~10 s check-in nags a student who is thinking.** *Expected* (seen
   before tools). The original nudged after 45 s of silence; the built-in one
   cannot be tuned.
7. **No per-session persona or greeting.** *Expected* (seen before tools: the
   test avatar greeted as itself before the opening). `avatar.json` is the
   host the product was designed for; the instructions say "keep your own
   name".
8. **No speech hints.** *Expected* (seen before tools: "Lob it" heard as
   "Lobbied"). The original biased recognition toward "degrees", "metres per
   second", "headwind". Theo passes the words he heard; the rules read number
   words, and the model reads the rest.

Fixed by tools, compared with the first port: the reply to "fire" no longer
says "let's watch it fly!" and leaves the result to a later event; the reply
to "make it steeper" knows the new angle; a request the range cannot read is
answered as such instead of "let's send it!" over a range that did nothing;
"try ninety" is refused once, from the range, instead of twice. The page's
speech and typing judges and the answers staged in the state are gone.

## Differences from the original (deliberate)

- Steppers for exact aims, beside the arrow (and its numbers while dragging,
  still no predicted arc).
- A challenge changed mid-flight cancels that shot's landing (the original's
  stale timer could bring the next shot down early).
- A refusal from any source is shown on the screen, not only spoken.
- "Why did that miss?" (the original's `explain_last`) is not a tool: the last
  shot's numbers and sentence are in Theo's picture of the range.
- The logbook is new. Progress and the logbook outlive a call: calling Theo
  again picks up where you were.
- Kept from the original as content: "Under the roof" starts aimed at 30° and
  20 m/s, which already clears it.

## Tested

- `npx vitest run apps/trajectory-coach` (278 tests): the physics against
  hand-worked numbers and the marking; the launcher's refusals and projection;
  the golden test against the Python engine (273 graded shots, the curves and
  trails, a scripted session's every snapshot and refusal); the range's
  landing clock; the judge's ~100 phrasings and the safety net's phrases; the
  tools and instructions against the API limits and the original's rules; the
  state's size and that it leaks no result in flight and no lesson early; every
  tool's result, the one-account-per-landing rule and the net's guards; the
  logbook; the board and the whole page with the call replaced by a recorder.
- `npx tsc --noEmit`: clean for this app.
- Live: not yet run as Arcwise.
