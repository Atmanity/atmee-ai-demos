# Spotter

A workout built around you, coached by Sammy. Tell her what you want to train,
your level and anything to work around (twenty minutes, no kit, a sore knee):
Spotter builds the plan, enforces every limit in code, and Sammy coaches your
first move. Mention a condition no exercise swap makes safe (pregnancy, a
cardiac history, recent surgery…) and Spotter pauses the workout at once and
sends you to your doctor first. Rebuilt from the `fitness-coach` mini-app as a
standalone product on the Avatar API.

Open it at `/apps/fitness-coach/`.

| Env | Needed for | Without it |
|---|---|---|
| `GEMINI_API_KEY` | the plan (`structured()` with the original plan prompt) | the built-in plan, enforced the same way |
| `XAI_API_KEY` (optional) | move videos (`grok-imagine-video`, 1 to 3 minutes each) | moves are coached in words; the screen never offers a video |
| `XAI_VIDEO_MODEL` (optional) | another xAI video model | `grok-imagine-video` |
| `FITNESS_VIDEO_REFERENCE_IMAGE_URLS` (optional) | reference images for the trainer's look, comma-separated public URLs | a generic trainer |

## How it works

| Part | Where |
|---|---|
| The session: goal → level → plan → first move → coaching, with the safety pause over all of it | `engine/coach.ts`, on the server: the one writer of the screen, which re-checks the pause after every await (a disclosure can land while the plan model is thinking). |
| Limits (time, equipment, injuries, banned moves) and the pause conditions | `engine/constraints.ts`, the original regex engine: parsed from the user's words, put in the plan prompt, then enforced in code on every plan (model, rebuild, built-in, timeout). |
| Sammy's actions | Six `await` tools (`engine/director.ts`): `set_goal(goal, level?)`, `set_level(level)` (also "easier"/"harder"), `add_limits(words)`, `start_move(move)`, `start_over`, `stop_for_safety(condition)`. The page answers each `atmee.tool` call by asking the server (`engine/actions.ts`), which acts and returns the words Sammy speaks from, each result opening with its plain outcome ("Done:", "Not yet:", "Refused:") and the stop sentence always first. |
| Tool arguments | Lenient schemas (plain strings, no enums or tight lengths, extra fields allowed): the platform drops a call that does not fit before the page sees it. The server reads what arrives: "Beginner", "a beginner", "a bit harder", a field named differently; an unusable value gets a short question back. |
| Waiting for the plan | A tool that builds or rebuilds a plan waits for it (up to 13 s, inside a 20 s tool timeout), so Sammy's first reply is the plan on the screen, or exactly what a limit changed ("That takes walking lunges and high knees out of your workout"). Past that, the result says it is still coming and the landing follows as an event. |
| The safety pause | Twice. The page reads every finished line (spoken or typed) itself: a condition freezes the screen at once and the server's plan with it (`/hold`). Sammy's `stop_for_safety` is the second path and returns the exact sentence to say; if she has not called it 4 s later, the page does and gives her the words. After that every tool and tap is refused and the screen shows no exercise. |
| What Sammy sees | `state` (`boardState`): the plan, the limits and whether the plan already obeys them, the move video's status, the step. Never the render prompt or a clip address. Questions about the screen are answered from it without a tool. |
| Buttons | Goal and level tiles, every plan move, "Rebuild as" a level, "Start over": they act at once and Sammy is told by an event (she cannot see the screen). |
| The safety net | `useToolNet` (kit): when the user clearly says "start over", gives a limit, says a level on its own while the level step is live ("Beginner, please.", "a bit harder" once there is a plan), or asks for a plan move once there is a plan, and Sammy does not call the tool within 7 s, the page does it and tells her. "Harder" goes out as the level it lands on, so a repeat changes nothing. Goals are left out. |
| Background work | A plan landing late, a rebuild, a move video finishing: the server's event stream (`/stream`), as an event for Sammy and a new screen. While a tool is waiting it claims those words, so nothing is said twice. |
| The screens | A front door (`page/Lobby.tsx`); the call: Sammy's frame, a step track, and one panel per step (goal tiles, levels, the plan being built, the plan sheet, "Now" coaching a move, the pause), with the plan to save as a text file when the call ends (`page/Workout.tsx`), styled in `page/spotter.css`. |
| The host the product was designed for | `avatar.json` (Sammy). |

## What the API could not do

Status after the live runs of 2026-10-23 on staging (own host, avatar
`06e55d2b`, two sessions). **Seen**: observed live. **Expected**: not observed
yet.

1. **A call whose arguments do not fit the schema never reaches the page.**
   *Seen*, 2 of 2 runs: "Beginner, please." (and the limits and the first
   move) arrived as no call at all while Sammy said "I've set you up for a
   beginner glute plan"; the screen stayed on the level step and only the
   Beginner card built the plan. "Harder" (a value the enum allowed) did
   arrive. The schemas are now lenient and the server normalises, and the
   safety net takes a lone level and a move request. *Expected* to be fixed.
2. **The host's own reply to a disclosure cannot be gated.** *Seen, held*:
   "I'm seven months pregnant" called `stop_for_safety` (4.9 s) and the first
   reply was the stop sentence; the screen paused by itself. Safety-critical:
   a model that ignored the rule could still coach for a sentence; the page
   gives her the words 4 s later if she has not called the tool.
3. **Nothing gates the host after the pause.** *Seen, held*: "Can we just do
   the plank anyway?" was refused. Only her instructions and the state forbid
   naming an exercise; muting her would also deafen the page (API-GAPS 2).
4. **The platform says a filler before an awaited result.** *Seen*: "Nah, I
   don't agree." opened the plank refusal. Every result now opens with its
   outcome, and the stop or refusal sentence comes first.
5. **Tools are called when the host decides.** *Seen*: besides item 1, she
   narrated "I can bump this up to intermediate" without a call. The
   instructions now say a one-word answer is a call too; the net covers
   limits, a lone level, a move, and starting over.
6. **Exact words cannot be forced.** *Seen*: the stop sentence came back
   nearly word for word; the screen shows the exact wording.
7. **A slow plan is silence.** *Expected.* While a tool waits (up to 13 s) she
   says at most one filler line.
8. **Tools need a Causeur session.** *Expected.* Elsewhere the tools are
   ignored; the buttons, the page's own pause and the safety net still work.
9. **The persona and the greeting belong to the avatar.** *Seen*: the host
   greets on her own ("Hey, I'm Sammy, your coach for today…"), so the
   opening no longer greets again. `avatar.json` holds the persona.
10. **No speech hints** for exercise words. *Expected.*
11. **The ~10 s check-in** prods someone mid-set. *Seen in the first port.*

Fixed by tools, compared with the first port: a spoken choice is no longer
answered before it is recorded, the "staged answers" in the state are gone,
and the plan announcement is one reply instead of "I'm building it" followed
by an event.

## Tested

- `npx vitest run apps/fitness-coach`: 414 tests. The engine as ported (the
  constraint engine, the plan and move resolution, the video pipeline, the
  step machine with its pause, rebuild and re-level guarantees); the tools end
  to end against a real coach (each result carries the real outcome, a tool
  waits for the plan and the stream does not repeat it, the pause wins from
  every path, an unknown condition still pauses and a sore joint does not);
  arguments as the host really sends them (capitalised, synonyms, unknown
  fields, a field named differently) and every result opening with its
  outcome; the instructions, tools (lenient schemas) and state against the
  API limits, with no render
  prompt or clip address in the state; the safety net's and the page's pause
  phrases; and the screens drawn from real coach views (every step's controls,
  nothing that advances a workout under the pause, no team words on screen).
- Live, 2026-10-23, two sessions through `tools/live-test/harness.js`:
  `set_goal` and `stop_for_safety` were called; the level, limits and moves
  were not (item 1, fixed since, not yet re-run). The pause, the stop
  sentence and the refusal held; the Beginner card built "Gentle Floor Glute
  Focus", 18 min, around the 20-minute cap and the knee, with no squats or
  lunges.
