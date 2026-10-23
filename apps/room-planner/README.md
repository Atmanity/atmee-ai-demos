# Planwright

A home planner you talk to. Tell Iris, an architect, roughly how big your place
is and who lives there; she lays out a whole floor in seconds, and then you
argue with it: give the bedroom a metre off the hall, knock the kitchen and
dining room together, put a window on the north wall and a queen bed by it,
add an upstairs, save three schemes and compare them room by room, undo, and
take the drawing sheet away. Every change she makes comes back with the plan's
real numbers, or the reason it won't work. Dragging walls and furniture still
works by hand, and every change has a control. Rebuilt from the
`room-planner` mini-app (its folder name is historical) as a standalone product
on the Avatar API.

Open it at `/apps/room-planner/`, optionally with the floor's starting size:
`?w=900&h=700` (centimetres; `?w=9&h=7` works too).

## How it works

| Part | Where |
|---|---|
| The plan: rooms, walls, doors, windows, furniture, two floors, undo, schemes, checks, the area schedule | `engine/` (the original 3,300-line Python engine, ported), run **in the page**: nothing about a plan is secret and every drag is an instant local change. A floor is a 10 cm grid where every cell has one owner, so rooms cannot overlap and a refused change leaves the plan exactly as it was. |
| Iris's actions | 25 `await` tools (`engine/director.ts` `TOOLS`): `lay_out_floor`, `set_floor_size`, `add_upper_floor`, `go_to_floor`, `add_room`, `remove_room`, `rename_room`, `divide_room`, `swap_rooms`, `knock_together`, `trade_area`, `grow_room`, `move_wall`, `mark_load_bearing`, `add_door_or_window`, `remove_door_or_window`, `add_furniture`, `move_furniture`, `remove_furniture`, `save_scheme`, `use_scheme`, `switch_units`, `undo_change`, `draw_sheet`, `clear_floor`. The page answers each `atmee.tool` call from its planner (`page/session.ts` → `engine/tools.ts`) and returns the words she speaks from. |
| A tool call | Arguments are what she heard ("the second bedroom", "two square metres", "by the window"), never coordinates. `engine/tools.ts` resolves names by whole words (so "second bedroom" never lands on the main one), converts square feet, turns a missing part into a question ("How much floor should move?"), applies the intents in order and stops at the first refusal. |
| Her results | `resultFor`: "Done: 1.2 square metres moved from the study to the living room: the living room 25.2 square metres now, the study 22.8. Say both new sizes…", or "Refused; nothing has changed… the plan says: …", in the unit the client reads. The problem a change created (the critic) is folded into the same result, one issue at a time. |
| Her rules | The session's tool `instructions`: the plan changes only through the tools; never invent a size or confirm a refusal; never coordinates; never "compliant" or a named regulation; destructive changes (redraw, clear, remove a room, open or drop a scheme) only when the client asks; suggestions are made only if the client says yes. |
| What she sees | `state` (`planState`): every room by area and compass with its neighbours, totals, the checks, doors and windows, furniture, schemes and the comparison, the other floor, what is selected and what undo would take back. Never coordinates; at most 3,858 characters at the app's own limits. |
| By hand | Drags and controls send the same intents. Milestones (a floor laid out, a scheme saved or opened, the sheet drawn) are told to her as an event; small edits only update her picture of the plan; a problem a change by hand created is told on its own. |
| The safety net | `useToolNet` (kit) with `mustDo` (`engine/judge.ts`, built on the original phrase rules): when the client clearly asks to switch units, show a floor, stop comparing, draw the sheet or add the upper floor and Iris does not call the tool within 7 s, the page does it and tells her. Never undo, a trade, a scheme, a layout or clearing the floor: doubled, those are a second change. |
| Photos | "Bring your own": a photo of a room or a piece (upload, no camera), or ours. `POST /api/apps/room-planner/photo` reads it with Gemini into kit types and rooms, never sizes; the planner places them and Iris is told what went in. Without `GEMINI_API_KEY` the buttons say photos aren't switched on. |
| The drawing sheet | `engine/sheet.ts` renders the plan, the schedule and the notes as SVG in the page, opened over the plan and downloadable. |
| The screens | The front door with a real plan laid out and traded by the planner (`page/Lobby.tsx`, `page/sample.ts`); the studio: the sheet, the tools tray (lay out, the selected room or piece, furniture), the schedule, notes and schemes, with Iris and the conversation beside it (`page/Studio.tsx`, `page/App.tsx`); styled in `page/planwright.css`. |

## What the API could not do

Status after the live run of 2026-10-23 on staging (own host, avatar
`eeba4d67`). **Seen**: observed live. **Expected**: not observed yet.

1. **Tools are called when the host decides.** *Seen.* Eleven of twelve
   requests went through their tools with the real numbers in the first reply
   ("eight point four… five point seven"). "Add a grand piano to the living
   room" got no call and a made-up "nearly four square metres". The
   instructions and `add_furniture` now say to call the tool even for a piece
   the plan may lack, so the refusal comes from the plan. The safety net covers
   only the actions that are safe to repeat.
2. **The persona and the greeting belong to the avatar.** *Seen, and solved
   by its own host.* On the shared test avatar a lighthouse keeper ran the
   plan; on its own host built from `avatar.json`, Iris greeted as herself and
   asked the size and the bedrooms. The opening event no longer greets again.
3. **The ~10 s check-in cannot be tuned.** *Expected* (seen in the first port:
   "What are you thinking for our next move on the plan?"). The original waited
   40 s and nudged at most twice, for a client studying the drawing.
4. **No speech hints.** *Expected.* The original pinned 57 terms ("en suite",
   "load-bearing", "dual aspect"); "en suite" may arrive as "on sweet". Room
   names resolve by whole words and room kinds, so most mishearings still land.
5. **Iris does not see a photo.** *Expected.* She can only say what the app's
   reader put in; "what do you think of my sofa?" about its look is lost.
6. **A call that does not fit its schema never arrives.** *Seen in other
   apps.* The platform answers it "invalid arguments" and the host may say it
   happened. The schemas are lenient (no enums, no length or range limits,
   nothing required); the accepted words are in the descriptions and
   normalised in `engine/tools.ts` ("Open Plan", "Square Feet", "the north
   wall"), and an unreadable value comes back as a question.
7. **The platform's filler can pre-judge a result.** *Seen* ("What does that
   mean? ummm…"). Every result now starts with its outcome: "Done:",
   "Refused:", "Not yet:".

Fixed after the live run: open plan really is one room (the kitchen, dining
and living were three rooms under an "open plan" name while Iris described one);
adding an upstairs keeps the ground floor's layout, gives the stairs a door and
says which room they came from; the drawing sheet has a page for every floor
that has rooms (it drew the empty upstairs); the opening no longer greets a
second time; room names sit above the furniture.

Fixed by tools, compared with the first port: Iris no longer answers before the
plan changes ("eight point three square metres" before the real 8.4); there is
no second model judging the client's words (the server's `/judge` route is
gone, and with it a second or two per change); and a request the app cannot
pin down becomes her question, tied to her next call, instead of a separate
event racing her reply. Areas come in the client's unit only (the first port
mixed square feet and square metres in one sentence).

## The engine

Ported from the Python with its tests and kept as it was, with one addition: a
layout can carry the size of the place (`generate` with `w`, `h`), applied in
the same step, so redrawing at a smaller size is one undo instead of a refused
shrink followed by a layout at the old size. Fixed in the first port (each with
a test): strips no longer fill an empty row between two equal runs; undo and
loading a scheme copy their capture; a piece asked for without a room lands in
one room; upstairs the way in is the stairs; the critic ignores a floor not
drawn yet; drawing the sheet of an empty floor is refused. Python's arithmetic
is kept where it shows (halves round to even, `round(x, 1)`, `:g`).

## Tested

- `npx vitest run apps/room-planner`: 299 tests. The engine suites ported from
  the Python (geometry, home, layouts, checks, planner, sheet) and the original
  phrase rules; the tools against the real planner (real numbers, refusals with
  the plan's reasons, "the second bedroom", square feet, questions for missing
  parts, doors by the rooms they join); the tools and instructions against the
  API limits; the state at the app's own limits; the safety net's phrases; the
  studio (every control sends an intent and never a coordinate; the wall drag's
  sign); and the whole page with the kit's parts and a faked call (the front
  door, connecting, a tool call changing the plan, a refusal marked on it, the
  sheet, a typed line, the safety net firing and holding back, the end of the
  call).
- `npx tsc --noEmit`: clean for this folder.
- Live: one run on staging (above), before the fixes; the plan below is what it followed.

### Live test plan

Typing works as well as speaking for every step; each line should reach a tool.

1. "It's about nine metres by seven, and we need two bedrooms and a study." →
   `lay_out_floor` (bedrooms 2, study, 9 × 7); a whole floor on screen, her
   first reply names the arrangement.
2. "Give the study two square metres off the kitchen." → `trade_area`
   (take_from Kitchen, give_to Study, 2); both new sizes in her first reply.
3. "Add a grand piano to the living room." → `add_furniture`, refused with the
   plan's reason ("I don't have a grand piano in my kit…"), nothing moved, the
   reason marked on the plan.
4. "Put a queen bed in the main bedroom by the window." → `add_furniture`.
   "Turn it round." → `move_furniture` (quarter_turns). "Undo that." →
   `undo_change`.
5. "Save this one, and try it open plan." → `save_scheme`, then
   `lay_out_floor` (open_plan). "How does that compare with the first one?" →
   `use_scheme` compare.
6. "Can I see that in square feet?" → `switch_units`; the safety net if not.
7. "Add an upstairs." → `add_upper_floor`. "What's the biggest room?" →
   answered from the plan, no tool, in square feet only.
8. "Can I have the drawing to keep?" → `draw_sheet`; the sheet opens.
