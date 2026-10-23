# Postmark

A city-guessing game with a host. Marco deals you three mystery cities, each a
single photo on a postcard. Guess from the photo alone for 4 points, or open a
sealed clue when you're stuck (each costs a point). Say your guess out loud or
type it. Rebuilt from the `guess-the-city` mini-app as a standalone product on
the Avatar API.

Open it at `/apps/guess-the-city/`.

## How it works

| Part | Where |
|---|---|
| The game: three cities, clues, scoring, reveals | `engine/game.ts`, on the server. The page sees a masked view: no name, country or fun fact before the reveal. |
| The deck | A Gemini call per game (`engine/deck.ts`), avoiding recent cities; three built-in cities without a key. Photos are Wikipedia lead images served behind random tokens. |
| Marco's actions | Five `await` tools (`engine/director.ts`): `check_guess(place)`, `get_clue`, `reveal_answer`, `next_city`, `new_game`. The page answers each `atmee.tool` call by asking the server, which acts and returns the words Marco speaks from. His first reply to a guess carries the game's verdict. |
| Judging a guess | `engine/judge.ts`: the name itself, else the server's own model call (other names, spellings and mishearings count). |
| Marco's rules | The session's tool `instructions`: he never knows the city and acts only through the tools. |
| What Marco sees | `state`: round, score, clues so far, never the city before the reveal. |
| Buttons | Open a clue, give up, next city, play again: they act at once and Marco is told by an event (he cannot see the screen). |
| The safety net | `useToolNet` (kit): when the player clearly says "I give up", "next" or "new game" and Marco does not call the tool within 7 s, the page does it and tells him. Clues and guesses are left out: a duplicate would cost a point. |
| The screens | A front door (`page/Lobby.tsx`), the game (postcard, sealed clues, Marco's frame, the conversation) and the trip summary (`page/Board.tsx`), styled in `page/postmark.css`. |

## What the API could not do

Status after the live runs of 2026-10-23 on staging. **Seen**: observed live.
**Expected**: not observed yet.

1. **Tools are called when the host decides.** *Seen.* In two of three
   rounds Marco called every tool. In one, he answered "I give up" with "wait,
   didn't we just jump to the new city?" and no call; the safety net revealed
   the city 7 s later and he carried on ("Oh, fair enough! That second mystery
   city was actually Bangkok…"). Once, before the stronger rules, he named the
   city himself without calling `reveal_answer`. Once he started a new game on
   his own at the end, wiping the score card; `new_game` now says "only when
   the player asks".
2. **The persona and the greeting belong to the avatar.** *Seen.* On the shared
   test avatar, "Marco" introduces herself as Emily, a college student, before
   the game's welcome. `avatar.json` is the host the game was designed for.
3. **The ~10 s check-in** prods a player studying the photo. *Seen.*
4. **No speech hints for city names.** *Expected.* The model judge accepts
   mishearings ("sidney").

Fixed by tools, compared with the first port: the host no longer says "that's
not quite right" before the verdict, and never invents a clue (every clue in
the runs was the game's).

## Tested

- `npx vitest run apps/guess-the-city`: the game rules, the deck checks, the
  safety net's phrases, the tools and instructions against the API limits, and
  the board never naming the city early.
- Live on staging (avatar `baf61f2c`), spoken through
  `tools/live-test/harness.js`: a clue request called `get_clue` about 3 s after
  the words began and the clue was read in the first reply; "Is it Paris?"
  called `check_guess`; "I give up", "next city" and a typed "Is it Tokyo?"
  each went through their tools; "What is my score?" was answered from the
  board. A full three-city game reached the score card.
- Round 2, on Marco's own host in the testuser account (`efcd4a84`): one
  greeting; a guess, a clue, a reveal and the next city each went through
  their tools. Round 2's photo stayed an empty card for more than 8 s while
  Marco said it had "popped up": the photo was fetched only when the page
  first asked for it. Since then every round's photo starts downloading when
  the game is dealt, `next_city` waits up to 6 s for its photo before Marco
  announces it, and a photo that cannot be had becomes the no-photo card,
  with Marco told to start from the clues (not yet run live). Round 2's city
  was Paris, just guessed in round 1: a coincidence a three-city deck cannot
  rule out.
