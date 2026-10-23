# Kibitz

Chess with a club player who talks back. Sasha plays her own moves, tells you
why she played each one, names the opening when she spots it and needles you a
little. Say your move, type it, drag the piece or tap it; ask for Black, for an
easier game, to resign or for a rematch. At the end, take the game away as a
PGN scoresheet. Rebuilt from the `chess-opponent` mini-app as a standalone
product on the Avatar API.

Open it at `/apps/chess-opponent/`.

## How it works

| Part | Where |
|---|---|
| The board: rules, legality, results | `engine/game.ts`: chess.js plus our layer (seating, strength, the spoken-move resolver, refusals, the snapshot). Runs **in the page**: chess has no secrets, so the page answers Sasha's tool calls itself. |
| Sasha's own move | `engine/engine.ts`: the original one-ply heuristic (material, piece-square tables, a one-exchange hang check), a seeded tie-break; strength = how far down her own ranking she plays (full 0, casual 2, beginner 5; she never declines a mate). Never the model. |
| Sasha's actions | Five `await` tools (`engine/director.ts`): `play_move(move)`, `choose_side(side)`, `set_strength(level)`, `resign`, `new_game`. The page answers each `atmee.tool` call through the board (`engine/table.ts`): `play_move` plays the player's move, waits a 0.7 s beat, plays Sasha's reply and returns both, so her first reply carries the board's ruling and her own move. |
| Reading a move | Sasha passes what she heard ("knight to f three", "Nf3"); `engine/spoken.ts`, `game.ts` and `san.ts` resolve it against the position. An ambiguous "knight to d2" is a question back, an unreadable phrase is "say it again", never "illegal". |
| Sasha's rules | The session's tool `instructions`: the board plays her moves, she acts only through the tools, no takebacks, an honest strength, the original's "never" rules. |
| What Sasha sees | `state`: seating, strength, whose move, last move, the moves so far, opening, material count, FEN, and the player's legal moves (for "can I castle?"). No staged answers: the tools give them. |
| Moves by hand and buttons | Drag or tap a piece; the side, strength, resign and new-game controls (a swap, a resignation or a reset mid-game asks for a second press). They act at once and Sasha is told by an event ("The player pressed "Resign" on screen. …"). |
| Typed lines | A line that is exactly a legal move as chess.js reads it ("Nf6", "exd5", "e2e4") is played at once like a move by hand, shown in the chat, and told to Sasha (`typedMove`, `engine/judge.ts`): typed text has no recognition errors. Anything else goes to Sasha as a chat turn. |
| The safety net | `useToolNet` (kit) with `mustDo` (`engine/judge.ts`): when the player clearly says "I resign", "new game", "go easy on me", or names a side before the first move, and Sasha does not call the tool within 7 s, the page does it and tells her. Never a move (a doubled move is two moves), and never a side swap that would throw a game away. A reset that names a side ("start over as Black") is a side request, and the net stands down when the same action, or any new game, was already taken since the words (by Sasha's other tool or a button). |
| The screens | The front door (`page/Lobby.tsx`), the table (`page/Game.tsx`: Sasha's side, the board, your side, refusals, the controls, the result), Sasha's frame and the conversation (`page/App.tsx`), the scoresheet with its PGN download (`page/Scoresheet.tsx`, `page/pgn.ts`), styled in `page/kibitz.css`. |

No keys needed: the board, the rules and Sasha's moves are local code.

Deliberate differences from the original engine, kept from the first port:

- **The exchange check can only cost.** `engine.py` scored "their queen takes
  our defended pawn, our rook takes the queen" as +800, so at full strength it
  answered 1.e4 with 1...h5. The exchange is clamped at zero gain.
- The seeded tie-break hashes with FNV-1a (the page has no synchronous
  blake2b): same contract, other digests.
- The board is wrapped in a redraw boundary: react-chessboard throws when it
  cannot measure a square to animate a move, and here the board shares a React
  tree with Sasha's video.

Gone with the tools: the page-side judging of spoken and typed lines, the
server's model judge (`/judge`, Gemini) for doubtful lines, and the answers
staged in `state` for "can I play black?" and "go easier".

## What the API could not do

Status after the first live run of the rebuild (2026-10-23, staging).
**Seen**: observed live. **Expected**: not observed yet.

1. **Tools are called when the host decides.** *Seen.* Spoken moves went
   through `play_move` within 2 to 3 s ("E four", "Knight to f three", and
   "Rook to a five", refused on screen), and so did resigning and a new game.
   But a typed "Nf6" was answered "Nice, developing your knight to f6!" with
   no call, and the board never moved. Fixed: a typed line that is exactly a
   legal move is now played by the page itself. A spoken move Sasha narrates
   without calling still leaves the board as it was (the net never plays
   moves); the player sees nothing moved and says it again or drags.
2. **The safety net can misread a request the host handled with another
   tool.** *Seen.* "Can I play black instead?" called `choose_side(black)`;
   the follow-up "Yes, start over as Black." called it again (refused: already
   Black), but the net had read "start over" as a new game, and 7 s later dealt
   one ("Oops, my bad, let me actually reset that board"). Fixed: such a line
   is a side request, a second `choose_side` for the side the player has says
   "nothing changed", and the net deals no game after any reset.
3. **Moves by hand and buttons reach Sasha as events.** *Expected* (seen once
   in the first port: after a switch to Black her first move was never named).
   A spoken move's reply is in the tool result; a dragged move's is an event,
   paraphrased once she has the floor (ttl 45 s), and a player who keeps
   talking can outlast it.
4. **One persona per avatar.** *Expected* (seen in the first port: "I'm Emily,
   a twenty-one-year-old college student…"). The screen names her Sasha;
   the shared test avatar keeps its own name and greeting. `avatar.json` is
   the dedicated persona.
5. **No speech hints for squares.** *Expected.* The original gave the
   recogniser the 64 squares as keyterms; "b4" can come back as "before". The
   resolver de-spells ranks ("e four"), and Sasha, who now reads the move
   before passing it on, may correct "e for" herself.
6. **The ~10 s check-in hurries a thinking player.** *Expected* (seen in the
   first port: "Take your time…"). The original waited 45 s. Not tunable.

Fixed by tools, compared with the first port: Sasha no longer answers a
spoken move before the board has ruled ("Did you mean e4? Okay, let's see."),
no longer agrees to a side or a strength before the board has changed it, and
her own move is in her first reply rather than an event that could be dropped.

## Tested

- `npx vitest run apps/chess-opponent`: 508 tests. The engine suites ported
  from the original (`test_engine.py`, `test_game_and_table.py`, with the
  vocabulary class sweeps), the board's table, and the panel's pure modules;
  the director against the API limits (names, sizes, timeouts, reserved
  names; instructions under 4,000 characters naming every tool; the busiest
  board's state under 3,858) and its "only when the player asks" wording;
  every tool's argument checks; the safety net's phrases, the recogniser's
  spellings, and what it must never do (a move, a swap mid-game, a second
  game after a side request); the typed-move reader; the PGN
  (read back by chess.js); the table (tap-to-move, refusals, the lock, the
  result, the controls); and the page with the call faked: each tool through
  to the board and its result, buttons, hand and typed moves as events, the
  net acting only when nothing has done it already. The two live failures
  above each have a test that fails with the fix taken out.
- Live on staging, 2026-10-23: spoken moves, a refusal, resigning and a new
  game all went through the tools; the typed move and the doubled game above
  were fixed after the run.
