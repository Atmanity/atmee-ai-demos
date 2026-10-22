# Chess Opponent

A real game of chess against the avatar: it moves on its own, says why it
played what it played, needles you a little and teaches a little. Drag a
piece, or say or type your move ("e4", "knight to f3", "castle"). Pick your
side, how hard it tries, resign or start over with the controls, or just ask.

Ported from `Atmanity/apps/apps/chess-opponent` (a Python LiveKit agent on
python-chess with five voice tools, plus a React panel on react-chessboard).

## How it works on the API

| Feature | Mechanism |
|---|---|
| The board (rules, legality, results) | `engine/game.ts`: chess.js for move generation and FEN, our layer on top: seating, strength, the spoken-move resolver, refusals, the snapshot. Runs **in the page**: chess has no secrets |
| The opponent's move | `engine/engine.ts`: the original one-ply heuristic (material, piece-square tables, one-exchange hang check), seeded tie-break, difficulty = how far down its own ranking it plays (full 0, casual 2, beginner 5; never declines a mate). Never the model |
| Reading moves from words | `engine/spoken.ts` (the conservative "is this a move?" gate) and `game.ts` (candidates, piece agreement, castle vs rook talk), with SAN/UCI read the way python-chess does (`engine/san.ts`): an ambiguous "knight to d2" is a question, never a guess |
| Side, difficulty, resign, new game | buttons (`page/GameControls.tsx`; a swap, a resignation or a reset mid-game asks for a second press), typed lines and speech |
| Typed and spoken lines | `engine/judge.ts`: the move gate and the side/strength parsers by rules; the doubtful ones ("Okay, e4.", "the dark pieces this time") go to `POST /api/apps/chess-opponent/judge` (Gemini `structured()`), bounded by the player's own words, and the board still judges the move |
| What happens when | `engine/table.ts`: one action at a time; the opponent replies after a 0.7 s beat; each change gives the avatar exactly one event |
| The opponent's rules | two standing `note`s (`engine/director.ts`), condensed from the original 5,070-character prompt |
| The board | `state`: seating, strength, whose move, last move, the moves so far, opening, material count, FEN, the player's legal moves (so "can I castle?" is answered from the board), and the staged answers to "can I play black?" and "go easier" |
| Its own move, refusals, results | `event`s: "The player played e4 … you replied e5 … say why", "The board REFUSED 'Rook to a5': …", the result line once |
| Panel | the original's components and styles (`ChessBoard`, `CapturedPieces`, `status`, `notices`, `sounds`), only the data layer changed |

Keys: `GEMINI_API_KEY` (optional). Without it, the rules still play every
clear move and command; lines only a model could read are left to the avatar
as conversation.

Deliberate differences from the original:

- **The exchange check can only cost.** `engine.py` scored "their queen takes
  our defended pawn, our rook takes the queen" as +800, so at full strength it
  answered 1.e4 with 1...h5 and 2.Nf3 with 2...a6 (the Python original does the
  same on the same position). The exchange is now clamped at zero gain.
- The seeded tie-break hashes with FNV-1a (the page has no synchronous
  blake2b): same contract (stable, only reorders equal scores), other digests.
- The opening table is one copy (the original had one in the agent, one in the panel).
- New controls for side, difficulty, resign and a mid-game new game (voice only before).
- The board is wrapped in a redraw boundary: react-chessboard throws when it
  cannot measure a square to animate a move, and here the board shares a React
  tree with the avatar's video.
- Not ported, and why: `RecentMove`/`claim` (there is one path per utterance, not
  a deterministic path plus a tool); `IdleNudge` (the platform's check-in);
  `stt_keyterms` and `instructionsExtra` (no API equivalent; see below).

## What the API could not do

Status after the live run of 2026-10-23 (below): **seen** = observed live,
**expected** = not yet observed.

1. **The avatar answers a spoken move before the board acts.** seen.
   The final transcript reaches the app about a second after the player stops,
   and the avatar is already replying. The original applied the move inside the
   model's turn (`llm_node`) so the reply knew the outcome. Mitigations: the
   player's legal moves are in `state`, the notes say "say a few words and wait",
   and the outcome follows as an event. Expect both orders, and an illegal
   spoken move may get a reaction before the refusal. Live, "E four." got "Did
   you mean e4? Okay, let's see." and then the opponent's reply; "Rook to a
   five." was refused twice, first from the staged legal moves ("your rooks
   are still tucked away on the back rank"), then by the event.
2. **Agreeing before doing.** seen, and true: "Can I play black instead?" got
   the staged answer ("flip the board and start a fresh game with you as
   Black") while the board reseated. "Can I play black?" is answered
   before the app can reseat. The answer is staged in `state` (what the board
   will do), so it should be true; if the app does not recognise the request,
   the avatar may still agree with nothing changed.
3. **No speech hints for squares.** expected ("e4", "f3", "a5" and "d4" were
   heard right in one run). The original gave Deepgram
   the 64 squares and the piece words as keyterms; "b4" can come back as
   "before", "e4" as "e for". The resolver de-spells ranks and the model judge is
   told about mishearings; the recogniser itself cannot be biased per session.
4. **The ~10 s check-in hurries a thinking player.** seen ("Take your time,…",
   "No rush at all, take your time…"). The
   original waited 45 s, nudged at most twice, and reset on any speech. Not tunable.
5. **Commentary can be dropped or doubled.** seen once: after the switch to
   Black, the opponent's first move (1.Nf3) was never named; the avatar said
   only "It's your turn as Black". Events are
   paraphrased and wait for the floor (ttl 45 s); a player who keeps talking can
   outlast one. A spoken mate can be answered twice (the avatar's own reply and
   the result event): there is no "claim".
6. **One persona per avatar.** seen ("I'm Emily, a twenty-one-year-old college
   student…"). The rules are two notes here
   (about 2,900 characters); the shared test avatar keeps its own name and
   greeting, so the board names it "Opponent". `avatar.json` is the dedicated persona.
7. **A model judgement adds latency.** expected. Lines the rules cannot
   read ("Okay, e4.") wait for one more model call (about a second) before the board moves.

## Tested

- `npx vitest run apps/chess-opponent`: 431 tests (about 290 ported, 140 new). Ported: the engine suite
  (`test_engine.py`), the board/resolver suite including the vocabulary class
  sweeps (`test_game_and_table.py`, proved to fail when the rules are broken),
  and the panel's pure tests plus `ChessGame.test.tsx` (new fake: props instead
  of the bridge). New: `judge.test.ts` (real phrasings for every route),
  `director.test.ts` (note and state limits on the busiest board, the honest
  strength, staging, no refusal in state), `table.test.ts` (each original
  wiring lesson restated: a refusal reaches screen and avatar, a mate by any
  route is conceded once, a resignation is thanked once, the new-game button is
  not silent), the controls, and `App.test.tsx`: the page's wiring with the
  avatar faked (typed, spoken and model-judged lines through to state and events).
- Live: one run on staging, below.

### Live run (staging, avatar `baf61f2c`, 2026-10-23)

Spoken lines through `tools/live-test/harness.js`. A first attempt never got
its board up: the dev server rebundled its libraries when another app opened,
and react-chessboard met a second copy of React. `vite.config.ts` now bundles
every page library at start.

- "E four." → e4, then the opponent's reply with its opening named.
- "Knight to f three." → Nf3. "Rook to a five." → refused twice, nothing moved,
  the refusal under the board.
- "Should I play d four?" → talk, no move.
- "Can I play black instead?" → board flipped; the opponent opened 1.Nf3 (not
  named). "Go easy on me, I'm a beginner." → Beginner, from the staged answer.
- "Can I take that back?" → kindly refused. "How strong are you?" → "one move
  ahead", no rating.
- Typed "d5" → played; the opponent answered 2.Ne5 ("Réti Opening").
- "I resign." → Opponent wins, one thank-you.
- Session `completed`, `ended_by_api`, 233 s billed.
