# Home planner

Plan a whole home (up to two floors) by talking to an architect. Say roughly how
big the place is and how many bedrooms; the app sketches a whole floor, and you
argue with it: trade area between neighbours ("give the living room two metres
off the study"), move, knock out or add walls, doors and windows, furnish it at
real sizes, save up to three schemes and compare them, undo, and download the
drawing sheet. Everything also works by hand on the plan: drag a wall or a
piece, or use the controls. Start it at `/apps/room-planner/`, optionally with
the floor size: `?w=900&h=700` (centimetres; `?w=9&h=7` works too).

Ported from `Atmanity/apps/apps/room-planner` (a 3,300-line Python engine, 27
voice tools and a React panel; its folder name is historical, the product is
"Home planner") onto the Avatar API.

**The two ideas that carry over unchanged.** The words never pick coordinates:
they name a brief ("two bedrooms and a study") or a relation ("a queen bed by
the window", "two square metres off the hall"), and the engine finds the
geometry. And a cell has exactly one owner: the floor is a 10 cm grid, every
operator is a validated reassignment of cells, so rooms cannot overlap, gaps
cannot hide, and a refused change leaves the plan exactly as it was.

## How it works on the API

| Feature | Mechanism |
|---|---|
| The plan (rooms, walls, doors, windows, furniture, two floors, undo, schemes, checks, schedule) | `engine/` — the Python engine ported to TypeScript, run **in the page**: nothing about a plan is secret, every drag is an instant local change, undo is the page's own history (`engine/planner.ts`) |
| Every panel control, both drags | the original panel components (`page/`), sending the same intents to the local planner |
| Spoken and typed requests (the 27 tools) | `engine/judge.ts`: **rules first** (instant, deterministic trade direction: "give the X N metres off the Y", sizes, furniture, rooms, schemes, units, undo, multi-step "save this and try it open plan"); otherwise `POST /api/apps/room-planner/judge`, a Gemini `structured()` call that maps the utterance and the last eight transcript lines to the planner's operations **by room and piece id, never coordinates** (`server.ts`) |
| The architect's rules (no compliance claims, no coordinates, "the app makes changes, not you") | three standing `note`s (`engine/director.ts` `NOTES`) |
| The live plan (`[Live floor plan]` in the original) | `state`: every room by area and compass with its neighbours, totals, the checks, doors and windows, furniture, schemes, the comparison, the other floor, and the last change (so "undo" can be answered at once); at most 3,858 characters at the app's own limits |
| Outcomes (the tool cues) | an `event` per spoken or typed request, with the real numbers ("1.2 square metres moved from the study to the living room: the living room 25.2 square metres now…") |
| Refusals | an `event` ("the plan refused it: … do NOT describe it as done") and the reason on the plan |
| The critic (new problems only, one per change) | folded into the outcome event for words; its own `event` for a hand on the plan |
| Panel milestones (a floor laid out, a scheme saved or compared, the sheet) | an `event`, since the avatar cannot see the click; small edits by hand are not narrated |
| An ambiguous request ("make the bedroom bigger") | the model's `ask` becomes an `event`: the avatar asks the question |
| Photo of a room or a piece | upload (no camera) or "Try a sample" → `POST /photo`, Gemini with the image → kit types and rooms, never sizes → placed by the planner → an `event` saying what went in |
| Drawing sheet | `engine/sheet.ts` renders the SVG in the page: shown, and now **downloadable** (the sandboxed in-call panel could only display it) |
| Greeting | the avatar's own; the app's opening `event` asks the size and the bedrooms |

Keys: `GEMINI_API_KEY` (the judge and the photo reader). Without it the rules
still handle the common phrasings, everything else goes to the avatar as
conversation, and the photo buttons say they need the key. No other key.

## What the API could not do

Status after the live run of 2026-10-23 (below): **seen** = observed live,
**expected** = not yet observed.

1. **The avatar answers before the plan changes (the worst gap for this app).**
   The final transcript reaches the app about a second after the client stops;
   the avatar is already replying. "Give the living room two metres off the
   study" can get "Done, that's nicer" before the plan has moved, or before it
   *refuses* ("that leaves the living room 230 centimetres across"). The
   original's tool returned the refusal inside the reply. Mitigations: the
   notes ("say only 'let me draw that'; never confirm before the app tells
   you"), the rules applying instantly, and the outcome event. *Seen.* Live,
   "Give the study two square metres off the kitchen" got the avatar's own
   "That gives the study eight point three square metres" (made up), then the
   app's "eight point four… kitchen at five point seven". A trade the rules
   apply at once can beat the reply: the living-room trade's numbers came in
   the avatar's first sentence.
2. **No function calling, so every voice change costs a judge.** Rules are
   instant; anything else waits for the app's model (about one to two seconds
   on top of the transcript delay). *Expected.*
3. **Clarifying questions are not tied to the request.** The app can make the
   avatar ask "which bedroom?", but the answer comes back as a new utterance;
   the judge only connects them through the transcript it is sent. *Seen
   mildly*: "Add an upstairs" (heard "At an upstairs.") got the avatar's own
   "Are you thinking of adding a whole second floor…?" while the app had
   already added it; the event then answered its own question.
4. **The avatar does not see the photo.** It can only say what the app's reader
   extracted; "what do you think of my sofa?" about its look is lost. *Known*
   (the photo path was not run live).
5. **Exact sizes are paraphrased.** The event carries the numbers; the avatar
   may round them. *Seen, as units*: after "Can I see that in square feet?"
   switched the board to ft², a typed "What's the biggest room?" got "the
   stairs room… at thirty-nine square feet, leaving fifty-nine square metres":
   two units in one sentence, and only the floor on screen.
6. **No speech hints.** The original pinned 57 terms ("en suite", "load-bearing",
   "dual aspect"); through the API, "en suite" may arrive as "on sweet". *Seen
   mildly* ("Add an upstairs" as "At an upstairs."; the rules still read it).
7. **The check-in cannot be tuned.** The original waited 40 s and nudged at most
   twice ("a designer who does not fill every silence"); the API's ~10 s
   check-in prods a client who is studying the plan. *Seen* ("So, roughly how
   many square metres were…", "What are you thinking for our next move on the
   plan?").
8. **The persona is the avatar's.** The app gives a job, not a name; the test
   avatar greets as itself first. `avatar.json` ("Iris") needs a dedicated
   avatar, and there is no per-session instruction slot (`instructionsExtra`). *Seen*
   (the lighthouse keeper: "Aye, got that logged!").

## Changes from the original

- The engine runs in the page instead of an agent process; the snapshot no
  longer has a 32 KiB wire limit, so it also carries the other floor and the
  last change.
- Fixed while porting (each with a test): a room's strips no longer fill a
  fully empty row between two equal runs; restoring a capture (undo, loading a
  scheme) copies it, so editing after loading a scheme no longer edits the saved
  scheme; a piece asked for without a room lands inside one room (the original
  searched the whole floor and drew "a queen bed" across three rooms); upstairs
  the way in is the stairs (the original asked a new upper floor for a front
  door and drew an outside door on the landing); the critic ignores a floor
  that is not drawn yet; drawing the sheet of an empty floor is refused.
- Python's arithmetic is kept where it shows: halves round to even (`num.ts`),
  areas round as `round(x, 1)` did, numbers print as `:g`.

## Tested

- `npx vitest run apps/room-planner`: 238 tests (174 ported, 64 new).
  - Ported from the Python suites (geom, home, generate, compliance, table) and
    the panel's `RoomPlanner.test.tsx`: the hard-won cases are all there (the
    trade direction, "second bedroom" matching "Main bedroom", refused merges
    and swaps that left half a change, structural marks after a merge, undo
    swallowed by a scheme save, a five-bed brief wiping the plan, stairs on both
    floors, the size control sent before the layout).
  - New: the judge's rules on real phrasings and its schema (no coordinates;
    `take_from` "gets SMALLER"), the director (notes and state under their
    limits at the app's own caps, nothing about coordinates, events with real
    numbers, one voice per change), the photo reader's mapping, the session's
    order (apply → state → event; nothing sent before the avatar arrives),
    the sheet, and the whole page mounted with the real planner.
- `npx tsc --noEmit`: clean for this folder.
- Live: one run on staging, below.

### Live run (staging, avatar `26cbe079`, 2026-10-23)

Spoken lines through `tools/live-test/harness.js`:

- "It's about nine metres by seven, and we need two bedrooms and a study." → a
  63 m² seven-room plan, then the critic's first problem (the study has no
  daylight).
- "Give the study two square metres off the kitchen." → study 8.4, kitchen 5.7
  (gap 1). "Give the living room two square metres off the study." → living
  room 15.6, study 6.4 (allowed on this layout).
- "Put a queen bed in the main bedroom by the window." → placed, with the
  critic's note that it can be reached from one side only. "Undo that." → gone.
- "Save this one, and try it open plan." → scheme one saved, the kitchen wall
  opened, in one line.
- "Can I see that in square feet?" → the board switched to ft²; "about six
  hundred and seventy-eight square feet" (63 m² is 678 ft²).
- "Add an upstairs." → the upper floor with the stairs lined up.
- Typed "What's the biggest room?" → answered for the upper floor only, in two
  units (gap 5).
- Session `completed`, `ended_by_api`, 285 s billed.
