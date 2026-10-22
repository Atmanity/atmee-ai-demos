# Poker Table

Heads-up no-limit Texas Hold'em against the avatar: 1,000 chips each, blinds
10/20, the button alternates, and the match runs until one stack is empty.
Play with the buttons, or say or type your move ("call", "raise to 60",
"I fold", "all in"); the avatar plays its own hand and needles you about yours.
"How to play" opens the hand rankings; ask the avatar anything about the rules.

Ported from `Atmanity/apps/apps/poker-table` (a Python LiveKit agent on
pokerkit, with a parser for the player's moves, a separate decider for the
avatar's, and a React panel) onto the Avatar API.

## Where the table runs, and why

On the server (`server.ts` + `engine/`). The avatar's hole cards are a secret,
so the deck and both hands never leave the server: the page gets the masked
view the original panel got (its own two cards; the opponent's only at a real
showdown), and the avatar gets a state built from that same view. The avatar
does not know its own cards either: its moves are decided by the app's own
model call on the server, the way the original's `Decider` did it.

```
engine/holdem.ts     one hand's rules: blinds, betting rounds, min-raise, all-ins, uncalled bets
                     (the subset of pokerkit's NoLimitTexasHoldem that engine.py used, for two seats)
engine/evaluator.ts  the 7-card hand evaluator (pokerkit decided showdowns before)
engine/match.ts      the match: stacks, button, session tally, the masked view (engine.py)
engine/judge.ts      the player's words -> a move, rules only (moves.py)
engine/decide.ts     the avatar's move: prompt, schema, safe fallback, normalising (decide.py)
engine/table.ts      the reducer, the player's turn and the opponent's turn (table.py, apply_user_turn)
engine/director.ts   the notes, the state, the event texts (instructions.py, state.py, the cues)
engine/rules.ts      the teaching text and the How to play sheet (rules.py + the panel's rules.ts)
page/                the original panel (felt, cards, chips, action bar, How to play, sounds)
```

## How it works on the API

| Feature | Mechanism |
|---|---|
| The table (dealing, betting, showdown, session tally) | `engine/` on the server; the 7 golden hands recorded from the engine users played against replay exactly |
| The page | the masked view only; `user_hand` is the player's own cards, `revealed_hands` appears at a showdown |
| The avatar's move | `POST /tables/:id/opponent`: a `structured()` call (Gemini) with the original's loose-aggressive prompt, the legal actions as an enum, a 4.5 s budget, then `normalizeDecision`; no key, a timeout or an error plays the original's safe action (check, else call) |
| Fold / Check / Call / Bet-Raise, Deal Again, Restart | buttons -> `POST /tables/:id/act {intent}` |
| Spoken and typed moves ("raise to forty", "I'm out", "all in") | `engine/judge.ts` (the original's parser: clauses, hedges, negated contractions, number words); no model is ever asked what the player did |
| "Deal", "another hand", "play again" | the same parser; deals, or restarts after a finished match |
| "What are my cards?" | parser -> an event with both cards in words |
| "How do I play?", "what beats what?" | two standing `note`s carry the rules text (the original's `explain_the_game`), and the How to play sheet |
| "Who's winning?", "what's the pot?" | `state`: the chip-facts line ("NEVER state a number not in this line") and the session line |
| The table rules for the avatar (4,250 chars originally) | four `note`s, each under 2,000 characters |
| "Action is on you" while the avatar's move is being decided | `state` |
| The ruling on the player's spoken/typed move | an `event` (applied / refused with the legal range / could not read) |
| The avatar's commentary on its own move, hand results, showdowns | `event`s naming only what the table already applied |
| The opening ("the cards are out; don't ask them to deal") | an `event` once the table is dealt |
| Typed lines | judged first; a table action is recorded and acted on, anything else goes to the avatar as a typed turn |

Keys: `GEMINI_API_KEY` (the avatar's decisions). Without it the avatar only
checks and calls. No other key is used.

## What changed from the original, on purpose

- **A split pot is a split.** pokerkit's `[0, 0]` payoffs were read as a win
  for the first seat ("Opponent wins 0"); now `winner.who` is `split`, the
  pot is shared, and neither seat is credited a hand.
- **A free fold is reported as the check it became** (the original kept the
  courtesy but still called it a fold).
- **"What are my cards?" is matched tightly.** The original pattern (never
  acted on there) also matched "what's my stack?" and "I fold my hand".
- **A model raise outside the legal range is pulled into it**; in the
  original the table refused it and the avatar's turn stalled.
- **A rematch only after a finished match** (the engine allowed a restart
  between hands, which resets both stacks).
- **The action bar follows `valid_actions`**: facing an all-in it no longer
  offers a raise the table refuses.
- **The avatar's commentary names the amount that landed** ("your raise to
  60"): the original kept figures out because its line was built from the
  decision, not the applied move. This one is built after the table applied it.
- **No model fallback for the player's moves.** The original's `player_move`
  tool was gated so it could only re-apply what the parser had already found;
  there is nothing for it to do here.

## What the API could not do

Status after the live run of 2026-10-23 (below): **seen** = observed live,
**expected** = not yet observed.

1. **The ruling arrives after the avatar's own reply** — seen (the holding
   line held; the worst case not seen).
   The original applied "I fold" before the model wrote a word and handed it a
   `[Table ruling]`. Here the avatar answers a spoken move on its own turn
   while the app is still reading it, so "you're checking? cute" over a
   refused check (the app's named worst failure) can come back despite a
   standing note. Typed moves are ruled before the avatar hears anything, and
   buttons are always exact. Live, every spoken move got "Right, copy that,
   let's see." and then the ruling. When the line was not read at all
   ("Raised to five.", see 6) the avatar said "let's see" and nothing
   followed: a holding line is a promise only the app can keep.
2. **Rulings and refusals are paraphrased and wait for the floor** — expected
   (the rulings live kept their numbers). "The minimum raise is 100" may follow an improvised reply; the
   table's message line shows the exact range.
3. **Back-to-back events can be dropped or late** — seen once. A call and
   the opponent's raise were both spoken live. But a typed "what beats what?"
   that met the opponent's call event got only the event, and no answer in
   that turn. A
   spoken call then the avatar's own raise produce two events within seconds;
   each waits for the floor and expires (15–30 s), so a commentary line can go
   unsaid while the chips move on screen. The page softens it: the avatar's
   move waits while the avatar is still speaking (up to 6 s), so its
   commentary usually meets a free floor.
4. **The ~10 s check-in prods a player who is sizing a bet** — seen ("Still
   thinking over that forty to call, or are…"); it cannot be tuned.
5. **The persona and greeting belong to the avatar** — seen. The livestream
   test avatar opened with its own self-description ("I run on a test avatar
   setup with a fixed four hundred millisecond prime lead…"), and the table's
   opening was cut off by the player's first question. The
   test avatar greets as itself before the table's opening; the 4,250
   characters of table rules travel as four notes. `avatar.json` is the
   dedicated opponent ("Dex") the app was written for.
6. **No per-session speech hints** — seen. "Raise to five" arrived as
   "Raised to five.", which the parser did not take as a raise (fixed: it now
   does, with a test). Amounts are what the
   avatar's recogniser heard ("fourteen" for "forty" becomes a refused raise
   rather than a wrong one, since the table checks every amount).
7. **The avatar cannot reason about its own hand.** By design here (it would
   need the cards in its context, which the page and state must never carry);
   its table talk is bluff by construction, while its moves come from the
   server-side decider that does see them.

## Tested

- `npx vitest run apps/poker-table`: 157 tests. Ported (about 89): the seven
  golden hands and the engine parity cases, the parser cases from
  `test_user_turn_moves.py`, the table and session cases from `test_table.py`
  and `test_rules_and_session.py`, `test_decide.py`, the note cases from
  `test_agent_note.py`, and the panel's `rules`, `ChipStack` and `PokerGame`
  tests (the last against the props-driven component). New (about 68): the
  hand evaluator, short-stack and uncalled-bet all-ins, split pots, the
  opponent's turn (timeouts, races, stale decisions), the director's limits
  and leak checks, and the tightened card question.
- Not ported: the `llm_node` seam tests (there is no generation hook on the
  API; the ruling is an event), the wire/envelope tests (no bridge), the
  `player_move` gate tests (no tool), the panel's auto-deal tests (the server
  deals), and `App.test.tsx` (the bridge handshake).
- Live: one run on staging, below.

### Live run (staging, avatar `2cd3ec08`, 2026-10-23)

Spoken lines through `tools/live-test/harness.js`:

- "I've never played poker before. How do I play?" → the rules from the state
  (two private cards, blinds of 10 and 20, five shared cards…).
- "I call." → "let's see", then "You're in for twenty…", then the opponent's
  raise: "Bumped it up to 60, back on you now!" (pot 80).
- "What's the pot right now?" → "80". "What are my cards?" → "the four of clubs
  and the nine of clubs" (right). "Who's winning?" → "no hands have finished
  yet".
- "Raise to five." → heard as "Raised to five.", not read (gap 6, fixed).
- "I fold. Can we start a new hand?" → "Fold accepted, that one goes to me for
  40 chips! Cards are dealt for hand two…" (right: the uncalled 40 goes back).
- Session `completed`, `ended_by_api`, 198 s billed.
