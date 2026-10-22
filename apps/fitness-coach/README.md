# Fitness Coach

Tell a coach what you want to train and your level (say it, type it or tap
it) and get a plan on screen built around your limits (time, equipment,
injuries), enforced in code, plus a walk-through of the move you start with,
and a rendered demo clip when a video key is configured. Mention a condition
no exercise swap makes safe (pregnancy, a cardiac history, recent surgery…)
and the session stops.

Ported from `Atmanity/apps/apps/fitness-coach` (a Python LiveKit agent: five
AgentTasks, five tools, a regex constraint engine, a clearance hold and an xAI
demo pipeline, plus a React panel) onto the Avatar API, following
`docs/PORTING.md`.

## Using it

1. **Start the session.** The coach greets you; the board asks *What do you
   want to train?* with six goals to tap.
2. **Goal, then level**: tap, type or say them ("core and cardio, I'm a
   beginner" does both at once). The plan appears a few seconds later: title,
   minutes, warm-up, workout, form cues.
3. **Starting move**: tap a move (*Start here*) or say it ("the plank", "the
   first warm-up move"). With demos on, a clip renders on the stage (a minute
   or two); with demos off, the coach talks you through it.
4. **Any time**: say or type a limit ("only 20 minutes", "no equipment",
   "bad knee", "no lunges", "torn ACL"). It shows as a chip and the plan is
   rebuilt in code; the coach says what changed. Tap any move for its demo,
   *Rebuild as* another level, or *Start over* (your limits are kept).

| Env | Needed for | Without it |
|---|---|---|
| `GEMINI_API_KEY` | the plan (`structured()` with the original plan prompt), and judging a goal or level said in free form | the original's built-in plan (enforced the same way); goals and levels by rules only |
| `XAI_API_KEY` (optional) | demo clips (`grok-imagine-video`) | the board and the coach say plainly that demos are off; nothing is called |
| `XAI_VIDEO_MODEL` (optional) | another xAI video model | `grok-imagine-video` |
| `FITNESS_VIDEO_REFERENCE_IMAGE_URLS` (optional) | reference images for the trainer's look, comma-separated public URLs | a generic trainer |

## How it works on the API

The engine runs on the server (`server.ts` + `engine/`): the plan and the demo
come from paid APIs whose keys stay there, and the board needs one writer that
re-checks the safety hold after every await (a disclosure can land while the
plan model is thinking). The page draws the server's view and relays outcomes
to the avatar.

| Feature | Mechanism |
|---|---|
| The guided flow: goal → level → plan → starting move → coaching (the original's five AgentTasks) | `engine/coach.ts`: the app's own step machine, the one writer of the board. No conductor: a per-turn conductor would be a second decider that can disagree with it |
| Recording a goal, level, move; a re-level; a demo of another move; start over (the original's tools) | buttons (`command`), typed lines and speech through `engine/judge.ts`: rules first; Gemini `structured()` only for a goal or level said in free form |
| The plan | Gemini with the original `PLAN_SYSTEM_PROMPT` and the limits in the prompt, then `enforce()` in code on every path (model, rebuild, built-in plan, model timeout) |
| Limits (time, equipment, injuries, banned moves) | `engine/constraints.ts`, the original regex engine, read from every typed and spoken line; chips on the board; an existing plan is rebuilt (a limit heard mid-rebuild gets its own pass) and the diff is sent as an event |
| The clearance hold | parsed on every line; the server freezes the flow (no plan, rebuild, render or tap advances; an in-flight render is stopped); the exact sentence goes to the avatar as an event and is shown on the board's hold card; the state and a standing note forbid coaching |
| The demo clip | `engine/video.ts`: xAI generate → poll → download, kept by this server and played from `/api/apps/fitness-coach/clips/:token` (the page never sees the provider URL). No key: "demos are off" from the start |
| What is on the screen (the original's `[Panel]` and `[Plan constraints]` notes) | `state` (`director.ts` `boardState`): the plan, the limits and whether the plan already obeys them, the demo status, the step, and what to say if the user does the predictable next thing |
| Outcomes (plan ready, rebuilt, demo ready or failed, choices tapped) | `event`s. Each is marked `staged` when the state already told the avatar what to say for it; after speech those are not sent again |
| Background work (a plan landing, a rebuild, a render finishing) | a server-sent event stream per session, carrying the same outcomes |
| The coach's style and the stop rule | three standing `note`s, condensed from the original instructions |
| The persona the original assumed ("Sammy") | `avatar.json` |

## What the API could not do

Status after the live run of 2026-10-23 (below): **seen** = observed live,
**expected** = not yet observed.

1. **The avatar's own reply to a safety disclosure cannot be gated.**
   *Safety-critical; held in one run, said twice.* The original spoke a fixed sentence
   from code ("I have to stop us there… check with your doctor…") and gave
   the model no turn at all, because the model, merely instructed, said "Thank
   you for sharing. Please name a warm-up move." Through the API the avatar
   hears "I'm 7 months pregnant" and answers at once, before the app has
   parsed it. What the app does: a standing note with the stop rule (the
   avatar's only guidance for that first reply), then an event with the exact
   sentence (said in its own words, possibly after a wrong first reply, so it
   may be heard twice), the hold card on the board in the same words, the
   state forbidding any exercise from then on, and every tap refused. None of
   this is a gate; the avatar's immediate reply can still coach. Live, the
   standing note was enough: "I'm seven months pregnant" got "I actually have
   to stop us right there. I'm not able to program or coach a workout around
   pregnancy…" as the avatar's own first reply, then the event said it again.
2. **Nothing can gate the avatar after a hold.** *Held in one run*: "Can we
   just do the plank anyway?" got "I can't really do that… check in with your
   doctor first". The
   original raised `StopResponse` in every tool. Here the app freezes the
   board, but the avatar can still name exercises if asked; only the state and
   the notes ask it not to. Muting it would also deafen the app (API-GAPS 2),
   so it is not used.
3. **Exact words cannot be forced.** *Seen*: "my left knee is bad" got the
   platform's filler "Man, that's rough," and then "I've got your knee taken
   care of with this routine", said while the plan was still being rebuilt.
   The event then named the swap ("moves like supported box squats"). The original said
   its acknowledgements ("Noted on your knee — I'm rebuilding the plan around
   it now."), the rebuild diff ("That takes lunges and squats out of your
   workout…"), the plan-ready and demo notices word for word, at the right
   moment. They are events now: paraphrased, spoken once nobody has the floor
   (after the avatar's own reply), dropped after their ttl.
4. **A spoken choice is answered before the app records it.** *Expected* (live,
   goal, level and the first move were each recorded as the avatar said). "Glutes", "beginner", "the plank": the avatar replies from the
   state's staged lines while the app judges the same words. If the two read
   them differently (the app hears no goal, the avatar thinks it did), the
   avatar can ask "what level?" over a board still asking for the goal. The
   original's tool calls made recording and replying one act.
5. **The persona belongs to the avatar.** *Seen* ("I'm Emily, a
   twenty-one-year-old college student…", then "I'll be your coach for
   today"). The shared test
   avatar greets as itself before the app's opening; the coach the original
   assumed (`avatar.json`) needs a dedicated avatar, and a strongly
   characterised avatar may refuse to coach at all (API-GAPS 4).
6. **No per-session speech hints.** *Expected* (every move was heard right). The original biased
   Deepgram toward exercise words (burpees, HIIT, glutes, kettlebell…). A
   misheard move is a demo of the wrong exercise; the judge's word matching
   absorbs some of it.
7. **The ~10 s check-in.** *Seen* ("Whenever you're ready, lie on your stomach
   and gently squeeze your glutes…"). The original deliberately had
   no idle nudge (someone mid-set should not be prodded); the API's check-in
   cannot be turned off.

Not API gaps, but limits of this sample: clips are kept in memory (lost on a
restart; a real app stores them), and engine sessions live in memory for three
hours.

## What changed from the original, and why

- **Gone with the platform:** the five AgentTasks and their latches, the
  speech-scheduling workarounds and the `DemoNarrator` (held, claimed and
  re-armed notices across task handovers), the panel RPCs, `app.state_sync`,
  the wire envelopes, the rotating spoken-line pools (their tone lives on as
  examples in the events), the STT keyterms, and the long-term memory.
- **New controls**, because the avatar cannot record anything: every plan move
  is a button (the original had no move tap), *Rebuild as* and *Start over*.
- **Small fixes found while porting**, each tested: durations said in words
  ("twenty minutes"); a limit heard while the first plan is being built still
  binds it; a demo of a move a rebuild removed is taken off the screen; a move
  name is matched by whole words, so "go" no longer matches "good mornings".

## Tested

- `npx vitest run apps/fitness-coach`: 362 tests, about 270 ported and 90 new. Ported from the original:
  the constraint engine (`test_constraints_reach_the_plan.py`, the parse cases
  of `test_clearance_stops_the_session.py` and `test_the_injury_is_acknowledged.py`),
  the plan and move resolution (`test_plan.py`), the video pipeline
  (`test_video.py`, without the narrator), the logic of the clearance, re-level,
  compound-answer and note-truth tests, and the panel's `board.test.ts` and
  `parsers.test.ts`. New: the judge with real phrasings, the director (limits,
  staging, nothing invites coaching under a hold), the step machine and its
  stream, and a jsdom render of the board's controls.
- Live: one run on staging (Gemini key, no xAI key), below.

### Live run (staging, avatar `baf61f2c`, 2026-10-23)

Spoken lines through `tools/live-test/harness.js`:

- "I want to work on my glutes." → level cards; the avatar asked the level.
- "Beginner, please." → "putting together your glutes plan right now", then
  "Your plan is ready on your screen!"
- "Oh, and my left knee is bad." → "Working around: knee", squats and lunges
  gone, the swap named by event (gap 3).
- "Let's start with the first warm-up move." → prone glute squeezes, talked
  through since demo videos are off.
- "Can you make it harder?" → rebuilt at Intermediate (22 min, 5 moves), still
  working around the knee.
- "Actually, I should mention I'm seven months pregnant." → the stop, twice
  (gap 1); the hold card on the board, buttons gone. "Can we just do the plank
  anyway?" → refused.
- Session `completed`, `ended_by_api`, 234 s billed.
