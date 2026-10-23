# Morsel

A nutritionist you can talk to. Ask Rachel about any food (say it, type it, or
add a photo of the food or its label) and its nutrition label lands on your
table: serving, calories, macros against a 2,000-calorie day, a 1 to 10 score
and Rachel's plain-words takeaway. Every food you ask about stays side by side;
open a recipe and Rachel talks you through it two steps at a time, the steps
she is on lit up on screen. At the end you take your notes home. Rebuilt from
the `nutrition-advisor` mini-app as a standalone product on the Avatar API.

Open it at `/apps/nutrition-advisor/`.

**Keys**: `GEMINI_API_KEY` makes the cards, reads photos and writes recipes.
Without it Morsel still answers six common foods (banana, apple, Greek yogurt,
egg, avocado, oats) and its own salmon-plate photo from built-in cards; it
cannot read your photos or write recipes, and Rachel says so.

## How it works

| Part | Where |
|---|---|
| A food's card | The server's own model call (`engine/card.ts`, bounded at 14 s): a named food is always an *estimate*, its portion *assumed* unless the user said how much (the app's claim, not the model's). Six common foods have built-in cards. A food already looked at comes back as it was, with no second call. |
| The table's truth | `engine/advisor.ts`, one writer per visit on the server: the card, the side-by-side rows (8 at most), the opened recipes, the recipes made ahead for the card's ideas (so opening one is instant). |
| Rachel's actions | Six `await` tools (`engine/director.ts`): `look_up_food(foods)` and `compare_foods(foods)` (20 s) return the card's or the rows' real figures; `open_recipe(recipe)` (20 s) returns the ingredients and the first two steps, lit up; `next_steps`, `close_recipe` and `start_over` (8 s). The page answers each `atmee.tool` call: the server for the first four (`/visits/:id/tool`), the page itself for the recipe's place. Her first reply to "what's in a banana?" carries the card's figures. |
| Where you are in a recipe | `engine/cook.ts`, on the page: two steps at a time; `next_steps` (or the "Next steps" button) lights the next two and returns them, so the voice and the screen agree. Tapping a step says "I'm here". |
| Photos | The app's own, never a tool: the user adds or drops a photo (`page/photo.ts` shrinks it to 1,600 px), the server reads it with its model (food or not, *label* or *estimate*), the card goes up and Rachel is told what was found, with the figures, as an event. One photo is read at a time. |
| Rachel's rules | The session's tool `instructions` (3,120 characters): the screen changes only through a tool, never a figure of her own, answer what is on screen from the board, never ask for a camera, voice rules, the advice line and the emergency line. Plus one standing note: the advice line in full (the original's hard-won wording). |
| What Rachel sees | `state` (`boardState`): the card with every figure and %DV, the side-by-side rows, the open recipe with its steps and which are lit, what the app is doing, the notices on screen. Never over 3,858 characters (the oldest rows give way first). |
| Buttons | Quick picks, recipe ideas, opened-recipe chips, the photo, the salmon plate, "Next steps", "Start over": they act at once and Rachel is told by an event (`pressed(...)`). "Back to the card", ticking an ingredient and tapping a step only change the screen (and the board). |
| The safety net | `useToolNet` (kit) with `mustDo` (`engine/judge.ts`): when the user clearly asks for a food's facts ("what's in a banana?"), to go back to the card, or to start over, and Rachel does not call the tool within 7 s, the page does it and tells her. All three are safe twice (a food already looked at returns as it was). A `compare_foods` call counts as a lookup. Never for next steps (a duplicate skips two), a recipe, a food already on screen, or a line about the user's health. |
| The safety line | `concernIn` (`engine/judge.ts`), on the page, on every line the user says or types: a possible emergency (an allergic reaction, trouble breathing, choking) puts an emergency notice at the top of the table at once and tells Rachel to send them to their emergency number; a question about their own health (a condition, a medicine, a pregnancy, "is it safe for me?") shows a note that it belongs with their doctor. Rachel's own refusal comes from her rules. |
| The screens | A front door (`page/Lobby.tsx`); the table (`page/Board.tsx`: empty with quick picks, a label being filled in, the label and its recipe ideas, side by side, a recipe cooking); the notes at the end of a call with a download (`page/Notes.tsx`, `engine/notes.ts`). Rachel sits in the left column in a framed tile with her nameplate and the call controls; on a phone she stays pinned at the top. Styled in `page/morsel.css`. |

## What the API could not do

Status after the two live runs of this version (2026-10-23, below).
**Expected**: not observed on this version. Notes from the previous port's
live run are marked as such.

1. **Tools are called when the host decides.** *Expected.* Rachel may say
   "let me pull that up" without calling `look_up_food`; the safety net puts
   the card up 7 s later and tells her. It does not cover a comparison, a
   recipe or the next steps, which have only the instructions and the buttons.
   She may also read the next steps from the board instead of calling
   `next_steps`, leaving the highlight behind.
2. **A lookup waits on a model call.** *Expected.* `look_up_food` holds Rachel
   up to 20 s while the card is made (the server gives up at 14 s: a built-in
   card, or "couldn't find it"); she may say one filler line first.
3. **No live camera understanding.** *Expected.* The original model saw the
   user's camera frames. Rachel sees nothing; the app reads photos the user
   adds, with its own model, and tells her. "Look at this" with a product held
   up does nothing.
4. **A photo's answer is paraphrased and late.** *Expected.* The photo is read
   by the app, then told to Rachel as an event that waits for the floor, can
   expire, and cannot force "one or two sentences".
5. **The persona belongs to the avatar.** *Seen on the previous port* ("I'm
   Emily! I'm a livestream host by trade…"): the shared test avatar greets as
   itself before Morsel's welcome. `avatar.json` is the host Morsel was
   designed for.
6. **The check-in cannot be tuned.** *Seen on the previous port* ("Hey, still
   there?", twice before its video arrived). A user reading a label may be
   prodded after ~10 s.
7. **The advice line is held by words.** *Expected* (the previous port's run
   saw it hold: "I am not a doctor or dietitian…"). The app shows its own note
   and emergency notice, but cannot stop a reply.
8. **No speech hints.** *Expected.* Product and food names depend on the
   recogniser alone; the tools take the food as Rachel heard it.

Fixed by tools, compared with the previous port: Rachel no longer answers a
spoken request before the card exists or quotes figures from memory first (the
card's figures come back in her tool result); a comparison verdict can no
longer come before the second food is on screen (`compare_foods` returns both
rows); and recipe pacing is the app's (`next_steps`), not a hope. The page-side
judge of every spoken and typed line, the staged recipes in the board and the
"say only a holding line" rule are gone.

## Tested

- `npx vitest run apps/nutrition-advisor`: 300 tests. The engine's suites kept
  (the card rules, the advisor, %DV and provenance, the table's coercion, the
  bounded calls, the recipe view's races); the tools and instructions against
  the API limits and the rules learned live; the board and every tool result
  (real figures, never over the limit); the safety net's and the safety line's
  phrase cases; where you are in a recipe; the notes; the routes end to end
  with the model faked (`server.test.ts`); and the screens rendered (front
  door, empty table, lookup in flight, label, side by side, recipe, notices,
  notes), none of them saying "session", "avatar", "sample" or the like; and the page with the call faked: nothing started for one call acts on the next.
### Live runs (staging, 2026-10-23)

Spoken through `tools/live-test/harness.js`, one typed line.

- **Round 1** (shared test avatar `26cbe079`, then a smoke pass on Rachel's own
  host `0c52a66c`): all ten steps went through the right tool, or none, on the
  first try. "What's in a banana?" called `look_up_food` about 2.5 s after the
  words and the reply carried the card's 105 calories. "Compare it with an
  apple." called `compare_foods` and the table showed both foods. "Which one
  has more sugar?" was answered from the board (18.9 g against 14.4 g). The
  first recipe opened with `open_recipe`, and "Done, what's next?" called
  `next_steps`. "Go back to the card." called `close_recipe`. "200 grams of
  chicken breast" gave a stated-portion card with 62 g protein. A typed Big
  Mac went through `look_up_food`, and "Let's start over." through
  `start_over`. "I have diabetes…" called no tool: the health note appeared at
  once and Rachel declined and offered the numbers. Found: the banana reply
  added "potassium", which is not on the label (on both hosts); the
  instructions and every card result now say to speak only of what is on the
  card.
- **Round 2** (Rachel's host `c075f5ff`, after the fixes): one greeting, no
  second welcome. "What's in a banana?" called `look_up_food` (2.7 s), with no
  safety net needed. "How much potassium is in it?" got "potassium actually
  isn't listed with a specific number on this card", with no number: fixed.
  "Which one has more sugar?" with one food up got a fair "which food are you
  comparing the banana to?". Still seen: the platform's filler before the
  first result was said twice ("Sure, I can, let me pull up the info for a
  banana for you right now!" twice), and a filler opener "What do you mean?".
  Both are platform-side.
