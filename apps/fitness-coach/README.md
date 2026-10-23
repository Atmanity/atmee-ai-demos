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
| Sammy's actions | Six `await` tools (`engine/director.ts`): `set_goal(goal, level?)`, `set_level(level)` (also "easier"/"harder"), `add_limits(words)`, `start_move(move)`, `start_over`, `stop_for_safety(condition)`. The page answers each `atmee.tool` call by asking the server (`engine/actions.ts`), which acts and returns the words Sammy speaks from. |
| Waiting for the plan | A tool that builds or rebuilds a plan waits for it (up to 13 s, inside a 20 s tool timeout), so Sammy's first reply is the plan on the screen, or exactly what a limit changed ("That takes walking lunges and high knees out of your workout"). Past that, the result says it is still coming and the landing follows as an event. |
| The safety pause | Twice. The page reads every finished line (spoken or typed) itself: a condition freezes the screen at once and the server's plan with it (`/hold`). Sammy's `stop_for_safety` is the second path and returns the exact sentence to say; if she has not called it 4 s later, the page does and gives her the words. After that every tool and tap is refused and the screen shows no exercise. |
| What Sammy sees | `state` (`boardState`): the plan, the limits and whether the plan already obeys them, the move video's status, the step. Never the render prompt or a clip address. Questions about the screen are answered from it without a tool. |
| Buttons | Goal and level tiles, every plan move, "Rebuild as" a level, "Start over": they act at once and Sammy is told by an event (she cannot see the screen). |
| The safety net | `useToolNet` (kit): when the user clearly says "start over", or gives a limit, and Sammy does not call the tool within 7 s, the page does it and tells her. Goals, levels and moves are left out ("harder" twice is two levels). |
| Background work | A plan landing late, a rebuild, a move video finishing: the server's event stream (`/stream`), as an event for Sammy and a new screen. While a tool is waiting it claims those words, so nothing is said twice. |
| The screens | A front door (`page/Lobby.tsx`); the call: Sammy's frame, a step track, and one panel per step (goal tiles, levels, the plan being built, the plan sheet, "Now" coaching a move, the pause), with the plan to save as a text file when the call ends (`page/Workout.tsx`), styled in `page/spotter.css`. |
| The host the product was designed for | `avatar.json` (Sammy). |

## What the API could not do

Status before the live run of the rebuilt product. **Seen**: observed live.
**Expected**: not observed yet.

1. **The host's own reply to a disclosure cannot be gated.** *Expected.*
   Safety-critical. Sammy is told to call `stop_for_safety` before saying
   anything else, and the screen pauses by itself whatever she says; but her
   first reply is still hers, and a model that ignores the rule could coach
   for a sentence. If she does not call the tool, the page gives her the words
   4 s later. (In the first port, without tools, the standing note held: "I
   actually have to stop us right there…".)
2. **Nothing gates the host after the pause.** *Expected.* Every tool refuses
   and the screen shows no exercise, but she could still name one if asked;
   only her instructions and the state forbid it. Muting her would also deafen
   the page (API-GAPS 2).
3. **Tools are called when the host decides.** *Expected.* She may narrate
   "I've rebuilt it around your knee" without calling `add_limits`; the safety
   net does it 7 s later and she corrects herself. A goal, level or move she
   narrates without the call is not netted: the screen does not move until she
   calls it or the user taps.
4. **Exact words cannot be forced.** *Expected.* The stop sentence comes back
   in her own words; the screen shows the exact wording.
5. **A slow plan is silence.** *Expected.* While a tool waits (up to 13 s) she
   says at most one filler line.
6. **Tools need a Causeur session.** *Expected.* On a behaviour-module avatar
   the tools are ignored: the buttons, the page's own pause and the safety net
   still work.
7. **The persona belongs to the avatar.** *Seen in the first port* ("I'm Emily,
   a twenty-one-year-old college student…"). `avatar.json` is the coach the
   product was designed for.
8. **No speech hints** for exercise words (burpees, glutes, kettlebell).
   *Expected.* `start_move` matches moves by whole words and position.
9. **The ~10 s check-in** prods someone mid-set. *Seen in the first port.*

Fixed by tools, compared with the first port: a spoken choice is no longer
answered before it is recorded (the race the first port's gap 4 described),
the "staged answers" in the state are gone, and the plan announcement is one
reply instead of "I'm building it" followed by an event.

## Tested

- `npx vitest run apps/fitness-coach`: 380 tests. The engine as ported (the
  constraint engine, the plan and move resolution, the video pipeline, the
  step machine with its pause, rebuild and re-level guarantees); the tools end
  to end against a real coach (each result carries the real outcome, a tool
  waits for the plan and the stream does not repeat it, the pause wins from
  every path, an unknown condition still pauses and a sore joint does not);
  the instructions, tools and state against the API limits, with no render
  prompt or clip address in the state; the safety net's and the page's pause
  phrases; and the screens drawn from real coach views (every step's controls,
  nothing that advances a workout under the pause, no team words on screen).
- Live: not yet run since the rebuild.
