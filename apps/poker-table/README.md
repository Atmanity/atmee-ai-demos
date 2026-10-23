# Blindside

Heads-up no-limit hold'em against Dex, a sharp, talkative opponent on a live
video call. 1,000 chips each, blinds 10 and 20, the button alternates, and the
match runs until one stack is empty. Say your move, type it or tap it; the
table rules on it, then plays Dex's hand, and Dex speaks from what landed. The
dealer keeps Dex's cards face down even from him, so his table talk is bluff by
construction. Rebuilt from the `poker-table` mini-app (a Python LiveKit agent
on pokerkit, with a move parser, a separate decider and a React panel) as a
standalone product on the Avatar API.

Open it at `/apps/poker-table/`.

## How it works

| Part | Where |
|---|---|
| The table: blinds, betting rounds, min-raise, all-ins, showdowns, the match | `engine/holdem.ts`, `engine/evaluator.ts`, `engine/match.ts`, on the server. The seven golden hands recorded from the engine users played against replay exactly. |
| Dex's hidden cards | Never leave the server. The page's view (`TableView`) carries the player's own two cards and Dex's only at a real showdown; Dex's state is built from that same view, so he never knows his hand. |
| Dex's actions | Five tools (`engine/director.ts`): `play_move(words)` (await, 26 s), `deal_hand` (await, 15 s), `new_match` (await, 15 s, only when the player asks), `read_my_cards` (await, 8 s) and `show_hand_rankings` (await, 8 s: it opens the chart and hands Dex the rankings to speak from). The page answers each `atmee.tool` call by asking the server, and returns the words Dex speaks from. Every result opens with its plain outcome ("Done.", "Refused.", "Not played.") so the platform's filler line cannot pre-judge it. The schemas are lenient (no enums, no tight lengths, extra fields accepted): a call that missed a strict schema would be refused by the platform before the page saw it, so the page reads the move leniently (capitals, quotes, a `move` field, an `amount` on its own) and asks again when nothing usable came. |
| The player's move, said or typed | Dex calls `play_move` with their words. The server reads them with the original's parser (`engine/judge.ts`: clauses, hedges, negated contractions, number words; no model ever decides what the player did) and plays the move only if the player's **own** words, heard at this point in the hand, contain that very move (`backs`). A move Dex invented ("purple banana forty seven?" as a raise to 47) is refused. |
| A bet never lands twice | Each line the page hears is tagged with the table's `seq` when it was said (a recognised line about 1.5 s before it arrived; a typed one at once). Words only count at the seq they were said at, so once a move lands the words that asked for it are spent: a second `play_move` for the same sentence, a tap plus the same move said aloud, or a late duplicate on the next street all play nothing ("Their call already landed"). A tool call delivered twice with one id is answered once. There is no safety net for moves. |
| Dex's own moves | `engine/decide.ts` on the server: a `structured()` call (Gemini) with the original's loose-aggressive prompt and the legal actions as an enum, an 8 s budget, then `normalizeDecision`; no key, a timeout, an error or an illegal answer plays the safe action (check, else call), and the server logs why. The page plays Dex's turn right after the player's move, deal or rematch, so the **same** tool result carries both ("The table played their call of 10… The table played your move: you raised to 60"). |
| Buttons | Fold, check or call, a sized bet or raise (Min, ½ pot, Pot, All in, a slider), Deal next hand, Rematch: exact intents, applied at once (`POST /tables/:id/act`). Dex cannot see the screen, so he is told with one event that includes his own answer. |
| The safety net | `useToolNet` (kit) with `mustDo`: when the player clearly asks to deal, for a rematch, for their cards or what beats what, and Dex does not call the tool within 7 s, the page does it and tells him. A deal, rematch or chart the table no longer needs (a button already did it, the chart is open) is dropped silently. Never a move. |
| Dex's rules | The session's tool `instructions` (the hard-won "never" rules of the original kept), a standing rules note for teaching (`RULES_NOTE`, the same text as the How to play sheet), and `state`: the live table with the only chip figures he may say. |
| A turn of Dex's nothing played | If a request fails, or a call comes back mid-hand with the action on Dex, the page plays his turn after 3 s and tells him. |
| The screens | The front door (`page/Lobby.tsx`); the felt with Dex's live video as his seat at the head of the table, his words in a bubble beside it, the board, the pot and the player's seat (`page/Felt.tsx`); the moves and the table talk beside it (`page/Controls.tsx`, the kit's `ChatPanel`); the rules sheet; a paused table after a call (resume, or start fresh); the match summary. Styled in `page/blindside.css`. |

Keys: `GEMINI_API_KEY` (Dex's decisions). Without it Dex only checks and calls.

## What changed from the original, on purpose

- **A split pot is a split.** pokerkit's `[0, 0]` payoffs were read as a win
  for the first seat ("Opponent wins 0"); now `winner.who` is `split`.
- **A free fold is played and said as a check**, and a call with nothing to
  call is said as the check it is.
- **"What are my cards?" is matched tightly** (the original's pattern also
  matched "what's my stack?" and "I fold my hand").
- **A model raise outside the legal range is pulled into it**; in the original
  the table refused it and Dex's turn stalled.
- **A rematch only after a finished match** (a restart between hands would
  reset both stacks).
- **The move tool is gated on the player's own words.** The original's
  `player_move` tool survived only as a fallback gated on the turn's text;
  here the host's call is the path, and the same gate is what makes it safe.

## What the API could not do

**Seen**: observed in the live run of this design (2026-10-23, Dex's own
avatar `04cb3e11`). **Expected**: not observed yet.

The live run: "I call" → `play_move` in 2.8 s with Dex's two checks and the
flop in the same reply; "What are my cards?" → `read_my_cards`, both right; a
raise below the minimum refused with nothing moved; "Purple banana forty
seven?" moved no chips; a typed "all in" → `play_move`, and the match ended at
the showdown; "Can we start a new match?" → `new_match`; "What are you
holding?" named no card; a call-again brought back the same hand.

Seen in that run, and fixed since:

- **"What beats what?" got no chart.** Dex recited the rankings and offered
  to open the chart. Now `show_hand_rankings` is an await tool whose result
  carries the rankings, the instructions say to open it rather than offer it,
  and the safety net opens it after 7 s.
- **A second greeting.** Dex's own greeting plays at every call (again on a
  call-back); the opening and the welcome-back now begin "You have just
  greeted them; do not greet or introduce yourself again."
- **Fillers pre-judged results** ("That's incorrect. oh…" before a refusal).
  Results now open with the outcome.

Round 2 (2026-10-23, Dex's new host `d8b5f834`, after those fixes): one
greeting, then the table's prompt; "What beats what?" called
`show_hand_rankings` in 2.6 s and the chart opened while Dex walked the order;
"I call." called `play_move` and the one reply carried the call, Dex's check,
the flop and his bet of 30; "What are my cards?" called `read_my_cards`, both
right. Seen, and fixed since:

- **"Check." facing a bet got no `play_move`**: Dex needled instead. The
  instructions, the tool's description and the state now say every move goes
  to `play_move`, legal or not, and a refused move's result names the
  player's options ("They can fold, call 30 or raise to…").
- **"New match" mid-hand got no `new_match`**: Dex refused it himself (the
  outcome was right, the judgement was his). Now he calls it even mid-hand and
  the table answers ("Not started. The match is still on…").
- **Dex's move fell back once** ("Dex played check (fallback)"), the first
  decision of the run; the next, same prompt and schema, came from the model.
  The likeliest cause is the first call's latency against the original 4.5 s
  budget. The budget is now 8 s (`play_move` waits 26 s, enough for two of
  Dex's decisions), and every decision is logged with its time, every
  fallback with its reason (no key, no answer within the budget, the call's
  error, an empty or illegal answer).

Still open:

1. **Tools are called when the host decides.** *Expected.* Dex may narrate a
   move ("you call, nice") without calling `play_move`; then nothing moves on
   the table. No safety net covers it, on purpose: a net that played the move
   too could land a bet twice. The instructions push hard, the state says
   "their move reaches the table only through play_move", and every move has a
   button.
2. **A tool call can beat the player's words to the page.** *Expected.* The page
   waits up to 4 s for the line before the table rules; a move whose words
   never arrive is refused ("the table did not hear…") and Dex asks again.
3. **A very quick answer can count against the previous decision.** *Expected.*
   A recognised line is dated 1.5 s before it arrives. A player who answers
   within about a second of Dex's move landing may have to say it again.
4. **No per-session speech hints.** *Expected* (seen in the first port: "Raise
   to five" heard as "Raised to five."; the parser reads both). Amounts are what
   the recogniser heard: "fourteen" for "forty" is refused (below the minimum),
   never rounded.
5. **The ~10 s check-in prods a player sizing a bet.** *Expected* (seen in the
   first port); it cannot be tuned.
6. **The persona and the greeting belong to the avatar.** *Expected* (seen in
   the first port: the test avatar opened with its own self-description).
   `avatar.json` is the host Blindside was written for.
7. **An event and a user turn at the same moment: one wins.** *Expected.* Fewer
   events now (a button press is one event with Dex's answer in it), but the
   safety net's and the stuck-turn events can still meet a turn.
8. **Dex cannot reason about his own hand.** By design: it would need his
   cards in his context. His moves come from the decider, which sees them.

Fixed by tools, compared with the first port: no more "let's see" holding
lines (the ruling is in Dex's first reply); refusals and their legal range come
back in that reply instead of a later event; Dex's own move is spoken in the
same reply as the player's, instead of a second event that could expire; typed
moves take the same path as spoken ones.

## Tested

- `npx vitest run apps/poker-table`: 204 tests.
  - The engine, kept from the port: the seven golden hands and parity cases,
    the hand evaluator, all-ins, split pots, the decider, the parser's live
    phrasings and the rules text.
  - The tools against the API limits (names, descriptions, schemas, modes,
    timeouts, 4,000-character instructions naming every tool, the 3,858
    state, the rules note), and no result or state ever naming Dex's live cards.
  - The table through `play_move`: questions, hedges and gibberish never move
    chips; the host's wording may differ but the move must be the player's;
    a bet never lands twice (repeat calls, a tap plus the same words, a late
    duplicate on the next street); Dex's turns; the session tally.
  - The safety net's phrases, moves excluded.
  - The screens, rendered: the front door, the felt (Dex's cards face down
    until a showdown), the moves and the sizer, between hands, paused, the
    match summary, the rules sheet.
  - The page and the server together, in memory (`page/App.test.tsx`): a
    spoken move and Dex's reply in one result, a tap plus the same move said
    aloud landing once (proved by mutation: without the 1.5 s dating it plays
    a check on the flop), an invented move refused, a typed move, the safety
    net dealing (and never playing a move), the chart and the other tools;
    and that nothing started for one call acts on another: a table set up for
    a failed call never replaces the next call's, a late answer about the old
    table is never drawn over a fresh match, a button's answer after hang-up
    tells nobody, a move still waiting for words when the call ends is never
    played, one call's words never back a move in the next, Dex's interrupted
    turn is played once the next call is live, and no table sound outlives
    the page.
- `npx tsc --noEmit`: clean for this app.
- Live: two runs on staging, 2026-10-23 (above).
