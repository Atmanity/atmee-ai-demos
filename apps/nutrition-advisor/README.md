# Nutrition Advisor

Name a food, or share a photo of one (or of its label), and its card appears:
serving size, calories, macros with % of daily value, sodium, a 1-10 score, a
summary and three recipe ideas. Every food you look at stays in a comparison
table; tap a recipe (or ask out loud) and it opens into ingredients and steps
that the advisor talks you through. Not a tracker: one question, answered.

Ported from `Atmanity/apps/apps/nutrition-advisor` (a Python LiveKit agent with
two tools, `display_nutrition_info` and `display_recipe_details`, a
`[Live nutrition panel]` note before every reply, and a React panel) onto the
Avatar API. It follows the reference shape (`apps/guess-the-city`,
`docs/PORTING.md`).

**Try it**: start the session, then say or type "what's in a banana?", then
"compare it with an apple", then "walk me through the first recipe". Or press
*Try a sample*, or drop a photo of a food or a nutrition label on the board.
The camera is never opened.

**Keys**: `GEMINI_API_KEY` makes the cards, reads photos, writes recipes and
judges lines the rules cannot. Without it the app still answers six common
foods (banana, apple, Greek yogurt, egg, avocado, oats) and its own sample
photo from built-in cards, but cannot read your photos or write recipes (the
avatar is asked to say those out loud instead). No other key is used.

## How it works on the API

| Feature | Mechanism |
|---|---|
| A card for a named food | the app's own model call on the server (`structured()`, `engine/card.ts`); a named food is always an *estimate*, and its portion is *assumed* unless the user said how much (the app's claim, not the model's) |
| A card from a photo, or the sample | upload or drag-and-drop on the board (`page/photo.ts` shrinks it to 1,600 px), then `structured()` with the image: it decides food or not, and *label* (read off a legible nutrition label) or *estimate*. One photo is read at a time |
| The original tool body's rules | `engine/card.ts`: the score clamped to 1-10, anything but "label" is an estimate, blank recipe slots dropped, steps never one letter each and never markdown |
| The card, %DV bars, the table, kept recipes, the recipe view | the original panel components (`NutritionPanel`, `ComparisonShelf`, `RecipeDetail`, `recipeView.ts`, `nutrition.ts`, `shelf.ts`), ported with their tests |
| The session's truth | `engine/advisor.ts` on the server: the original `State` (shelf of 8, kept recipes, one card) and its tool bodies, as the one writer |
| Recipes | a tap, a typed line or speech opens one; the app writes it under the name the user chose. The card's three ideas are written ahead after each card, so a tap opens at once and their steps are already staged for the avatar |
| What is on screen, every figure | `state` (`boardState` in `engine/director.ts`): the card with all its figures and %DV, the table rows, the open recipe with its steps, the staged recipes, what the app is doing. It replaces the per-turn panel note and never exceeds 3,858 characters (the staged recipes, then the oldest rows give way first) |
| The advisor's rules | three `note`s: the screen and the holding line, numbers and voice, and the advice line drawn at the person (condensed from 5,921 characters of instructions) |
| What happened | `event`s, sent only after the state that shows it, so each one is spoken with its figures already on the board |
| Spoken and typed requests | `engine/judge.ts`: rules first (run on the page, so most lines need no round trip), the server's model only when they cannot tell; questions about what is already on screen go to the avatar untouched |
| Typed lines | judged first: an app action is recorded and acted on (its event quotes the user's words); anything else goes to the avatar as a turn, with the board already in front of it |
| A lookup in flight | a status line on the board, and in the board state ("the app is working on…") |
| Rehydration after a remount (`app.state_sync`) | gone: the page owns its view |
| The idle check-in (28 s, twice) | the platform's own (~10 s); its rule "never ask for a camera" is in the notes |
| The greeting | the avatar's own, then the app's opening as an `event` |

## What the API could not do

Status after the live run of 2026-10-23 (below): **seen** = observed live,
**expected** = not yet observed.

1. **The avatar answers a spoken request before the card exists.**
   *Seen, held: holding lines, no remembered figures.* "What's in a banana?" reaches the app about a second
   after the user stops; the avatar is already replying, and may quote figures
   from memory that the card then contradicts. The notes ask for a holding line
   ("let me pull that up") and say numbers come only from the board; the card's
   event follows. Both orders are expected. The original's tool call put the
   card up inside the reply. Live, "What's in a banana?" and "Compare it with
   an apple." each got "let me pull that up", then the card's event.
2. **A comparison verdict can come before the second card.** *Expected* (live,
   the verdict came with the event: "The apple wins on fiber with four point
   four grams…"). The original forced "tool calls first, then the verdict"; here
   the avatar may judge "banana or apple?" before the apple's row exists.
3. **No live camera understanding.** *Known.* The original model
   saw the user's camera frames (`video_enabled`). The avatar sees nothing; the
   app reads photos the user uploads or drops, with its own model, and tells the
   avatar what it found. "Look at this" with a product held up does nothing.
4. **A photo's answer is paraphrased and late.** *Expected* (the photo path was
   not run live). The
   original read the photo and spoke in one generation; here it is the app's
   reading, then an `event` that waits for the floor, can expire, and cannot
   force "one or two sentences".
5. **Recipe pacing cannot be followed.** *Seen working once*: "Walk me through
   the first recipe" got the staged steps two at a time, each ending "let me
   know when you're set". "One or two steps
   at a time" lives in the notes, with the steps in the board; the app cannot
   tell which step the avatar is on.
6. **The persona belongs to the avatar.** *Seen* ("I'm Emily! I'm a
   livestream host by trade…"). The original
   layered 6.5k characters of rules over any avatar; here they ride as three
   notes on the shared test avatar, whose own persona greets first. Rachel
   (`avatar.json`) needs a dedicated avatar.
7. **The check-in cannot be tuned.** *Seen* ("Hey, still there, or did you
   step away for a quick break?", twice before its video had even arrived). 28 s twice became the
   platform's ~10 s; a user reading the card may be prodded.
8. **The advice line is enforced only by words.** *Seen holding*: "I have
   diabetes. Is a banana safe for me to eat every day?" got "I am not a doctor
   or dietitian, so I cannot give a medical verdict…" and an offer to read the
   numbers. The
   medical-advice refusals rely on the notes and the persona's guardrails; the
   app cannot intercept a reply, and refusal lines cannot be forced verbatim.
9. **No speech hints.** *Expected* (every food was heard right in one run). The original biased recognition to
   nutrition words (`stt_keyterms`); product names depend on the recogniser
   alone (the model judge absorbs some mishearings).

Platform findings every app shares are in `docs/API-GAPS.md`.

## Tested

- `npx vitest run apps/nutrition-advisor`: 242 tests. The panel's three suites
  verbatim (`nutrition`, `shelf`, `recipeView`: 48); the Python suites' cases
  ported to the advisor, the card rules, the bounded calls and the director
  (about 77: two foods at once, parity, the tapped recipe, the photo leg, a turn
  that never ends, the panel note, the instructions); and new tests for the
  judge (real phrasings), the board's limits and order of giving way, the
  routes end to end with the model faked (`server.test.ts`) and the board's
  rendering.
- Live: one run on staging, below.

### Live run (staging, avatar `2cd3ec08`, 2026-10-23)

Spoken lines through `tools/live-test/harness.js`. The session took 44 s to
start and its video came about 95 s after that; the avatar greeted and checked
in twice before it could be seen.

- "What's in a banana?" → card (medium banana, 105 cal, sugar 14.4 g, assumed
  portion), then its takeaway.
- "Compare it with an apple." → the table, then the verdict on fiber.
- "Which one has more sugar?" → "The apple… 18 point 9 grams compared to 14
  point 4 in the banana" (the board's figures), no app action.
- "Walk me through the first recipe." → the staged recipe, two steps at a time.
  "Go back to the card." → the apple card, quoting its 95 calories and 4.4 g
  fiber.
- "I have diabetes. Is a banana safe…?" → refused, offered the numbers.
- Typed "how much protein is in 200 g of chicken breast" → card at 200 g, not
  marked assumed; "62 grams of protein".
- Session `completed`, `ended_by_api`, 345 s billed.
