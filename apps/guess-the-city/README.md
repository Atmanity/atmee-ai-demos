# Guess the City

A photo of a mystery city, three clues, and a host who never knows the answer.
Say or type a guess, ask for a clue (each costs a point), give up, move on.
Three cities a game; a city guessed cold is worth 4 points.

Ported from `Atmanity/apps/apps/guess-the-city` (a Python LiveKit agent with
five tools plus a React panel) onto the Avatar API. It is the reference app:
the others follow its shape (see `docs/PORTING.md`).

## How it works on the API

| Feature | Mechanism |
|---|---|
| The deck (3 cities, clues, fun facts) | `server.ts`: a Gemini call per game (a random starting region and the recent cities to avoid keep games varied); the original three as a fallback |
| The game (scoring, rounds, reveal) | `engine/game.ts` on the server. The page only ever sees a masked view: no name, country or fun fact before the reveal |
| The photo | Wikipedia's lead image, served by the app from a random token (the file name would give the city away) |
| Clue / give up / next / new game | buttons, typed lines and speech, all through one `act` route; command words by rules (`engine/judge.ts`) |
| Guesses (spoken or typed) | the app's own model call on the server judges "is this a guess, and is it the city", misheard names included ("sidney" counts) |
| The host's rules | two standing `note`s (`engine/director.ts`) |
| The board | `state`: round, score, clues so far, and the next clue, staged so a spoken "can I have a clue?" gets the real one at once |
| Outcomes (verdict, reveal, next round, game over) | `event`s, which the avatar says in its own words |
| Typed lines | judged first; a game action is recorded and acted on, anything else goes to the avatar as a typed turn |

## What the API could not do (seen in live runs)

1. **The avatar answers a spoken guess before the app can judge it.** The
   user's final transcript reaches the app about a second after they stop
   speaking; the avatar's reply is already being made. Despite a standing note
   ("you do not know the city; never say right or wrong"), it said "That's not
   quite right…" to "Is it Paris?" in every run, then repeated the app's
   verdict. Both orders happened (holding line then verdict, verdict then
   "let's see"). A function call (the original `guess_city` tool) returned the
   verdict inside the reply; the API has no equivalent.
2. **Without staging, the avatar invents clues.** Before the next clue was put
   in `state`, a spoken "can I have a clue?" got a made-up clue ("home to the
   Burj Khalifa" for New York; "it is the capital of France") in 2 of 3 runs,
   before the app's real one arrived.
3. **The persona is the avatar's.** The test avatar greets as itself ("I'm
   Emily, a livestream host…") before the app's welcome; the app's host
   ("Marco", `avatar.json`) needs a dedicated avatar.
4. **No per-session speech hints.** City names come from a model per game; the
   original biased Deepgram toward them. Through the API, rare names depend on
   the recogniser alone (the model judge absorbs some mishearings).
5. **The ~10 s check-in** prods a player who is looking at the photo ("Take your
   time, or just let me know if you want another clue!"); it cannot be tuned.

Platform findings from these runs that every app shares are in `docs/API-GAPS.md`.

## Tested

- `npm test`: game rules, deck validation, the judge's command words, the
  director (never leaks the city, stages the next clue, stays under the limits).
- Live on staging (avatar `2cd3ec08`, 2026-10-23), spoken and typed, with
  `.test-audio/harness.js`: a spoken clue request answered with the real clue;
  "Is it Paris?" judged wrong by the app (and pre-judged by the avatar, gap 1);
  "I give up" revealed Bangkok with its fun fact; a spoken "next city" moved to
  round 2 with the host's intro; a typed "What is my score?" answered from the
  board ("You're at zero points right now…"); the session ended `ended_by_api`.
