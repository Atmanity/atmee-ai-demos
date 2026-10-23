# Outcry

A live stock watchlist you build by talking. Name a company ("put Nvidia
up") and Reese, your analyst, puts it on a six-slot board with its real last
sale, today's move, the 52-week range and how old the print is, and reads it
to you. The stock on watch refreshes every minute and Reese speaks up when it
moves a point. Ask what to buy and Reese says it straight: "I read the tape,
I don't give advice." Rebuilt from the `market-desk` mini-app as a standalone
product on the Avatar API.

Open it at `/apps/market-desk/`.

## How it works

| Part | Where |
|---|---|
| Quotes: Nasdaq first, Yahoo as the fallback, stamped with the time they printed | `engine/feed.ts` and the parse in `engine/board.ts`, on the server (neither feed answers a browser) |
| The board: six slots, refusals as sentences, the 15 s refresh floor, stale rows greyed | `engine/board.ts` and the store in `engine/desk.ts`, one desk per page, on the server |
| The fetch pump, the once-a-minute refresh of the stock on watch, the 5 min stand-down after a failed pull, the 1% announcer | `Fetcher`, `RefreshTimer` and `Announcer` in `engine/desk.ts`; every pull can be awaited |
| Reese's actions | Five `await` tools (`engine/director.ts`): `add_symbols(stocks)`, `focus_symbol(stock)`, `refresh_quote(stock?)`, `remove_symbols(stocks)`, `clear_board`. The page answers each `atmee.tool` call by asking the server (`POST /desks/:id/tool`), which acts, **waits for the quote**, and returns the words Reese speaks from. Reese's first reply to "add Nvidia" carries the real price, or why it did not go up. |
| One set of actions for tools and buttons | `engine/actions.ts`: `run()` resolves names, acts on the board, waits within a budget under the tool's timeout, and words the outcome; `press()` wraps it for a button |
| Names to tickers | `resolveStocks` in `engine/judge.ts`: "it" and "the last one" by the board, then rules (the board's rows, ~90 well-known names, written tickers), then the app's own model call (a name the rules only partly read, a description), then Nasdaq's symbol search. The feed has the last word on any ticker. |
| A quote slower than the wait | the result says it is on its way (no price); the pump tells Reese when it lands, several in one line |
| The no-advice rule | in the tool `instructions`, with the standing line and a board fact to offer instead; the decline is Reese's own words. No tool hands out advice and no result stages a decline. |
| What Reese sees | `state`: one line per stock with its 52-week position worked out and its age or "stale", the names, what is arriving, the last refusal |
| Buttons | the add box, the starters, a slot (put it on watch), refresh, remove, clear (asks first): they act at once (`POST /desks/:id/act`) and Reese is told by an event, while on the line |
| The desk's own lines | a 1% move on the stock on watch, a quote that outlived Reese's wait: server-sent events to the page, then `event`s to Reese (only the page holds the call) |
| The safety net | `useToolNet` (kit) with `mustDo` (`engine/judge.ts`): "clear the board", "check it again", "drop Tesla" (actions safe to repeat) are done by the page if Reese does not call the tool within 7 s. Never an add or a focus (a duplicate could take a slot), and never on an advice question ("should I dump Tesla?"). |
| The opening | an event when Reese arrives, from the board as it is then (the user can add while the call connects) |
| The screens | the front door (`page/Lobby.tsx`); the desk: Reese's booth, the tape, the stock on watch and the six slots (`page/Board.tsx`, `page/Tape.tsx`); the closing sheet with a CSV download when the call ends (`page/Closing.tsx`); styled in `page/outcry.css` |

Running it needs only the repo's `.env`. Optional:

- `GEMINI_API_KEY`: the name lookup's model call. Without it, names go from
  the rules straight to Nasdaq's symbol search; a description ("the
  search-engine one") is then not found and Reese asks for the ticker.
- `MARKET_DESK_CHART_URL`: points the Yahoo fallback at a replay of recorded
  payloads, for working with no network:
  `npx tsx apps/market-desk/tools/replay-feed.ts &` then
  `MARKET_DESK_CHART_URL='http://127.0.0.1:8795/chart/{symbol}' npm run dev`.
  What it serves is as old as the recording, and every symbol but AAPL is
  labelled "replay data".

## What the API could not do

Status: **Expected**, not yet observed live with the tools (the last live run,
2026-10-23 on staging, was of the earlier port without them).

1. **Tools are called when the host decides.** *Expected.* Reese may narrate
   "putting Nvidia up" without calling `add_symbols`, or quote a remembered
   price for "what's Netflix doing?" instead of putting it up. The
   instructions forbid both; the safety net covers clear, refresh and remove,
   but an add is never redone by the page (a duplicate could take a slot).
2. **The no-advice rule is the host's to keep.** *Expected.* The app no
   longer detects advice questions or stages a decline: the rule, the
   standing line and the fact to offer are in the instructions, and the reply
   is Reese's. Seen before tools: one refusal with a board fact, not two.
   Nothing can verify the reply before it is spoken.
3. **The persona and the greeting belong to the avatar.** *Expected* (seen on
   the shared test avatar before: it greeted as itself). `avatar.json` is the
   host this product was designed for.
4. **The ~10 s check-in** talks into silences the desk would leave quiet.
   *Expected* (seen before).
5. **The desk's own lines compete for the floor.** *Expected.* A 1% move
   (ttl 30 s) or a quote that outlived the wait (ttl 45 s) is dropped if the
   user keeps talking. Adds no longer depend on this: the reply carries them.
6. **Only the open page can answer.** *Expected.* Tool calls are room-only and
   the desk's lines go through the page; a closed tab ends both.
7. **Tools run only on Causeur sessions.** *Expected.* On a behaviour-module
   session Reese can talk but not change the board; the buttons still work.
8. **No per-session speech hints.** *Expected.* Company names are where
   recognisers diverge ("At Nvidia" for "Add Nvidia" was seen); the name
   lookup reads mishearings, and Reese asks when nothing matches.
9. **The await window is shorter than a bad feed day.** *Expected.* Nasdaq's
   6 s timeout and then Yahoo can outlast the 16 s budget; the result then
   says "on its way" and the landing comes later as an event (gap 5).

Fixed by tools, compared with the earlier port: Reese no longer answers "add
Nvidia" before the app has acted ("putting Z Q X W Q up" before the failed
add was seen), so there are no promises to take back; the real quote is in
the first reply instead of a second line a beat later; and typed lines no
longer need a judge in the page.

## Tested

- `npx vitest run apps/market-desk`: 263 tests. The board's rules and the
  feed's parsing (ported from the original's Python tests); the pump, the
  timer, the announcer and the awaitable actions with a fake feed and clock
  (a quote slower than the wait, a pull joined by a second caller, one voice
  per print); names to tickers and the safety net's phrase cases (advice
  first, only actions safe to repeat); the tools and instructions against the
  API limits, the hard rule spelled out, the state under 3,858 characters with
  no pull clock or history; every result's wording; the board, front door,
  tape and closing sheet rendered; and the page's wiring with the call faked
  (a tool call returns the server's words, a button tells Reese only on the
  line, the opening, the closing sheet, the safety net doing a clear Reese
  only talked about and staying out when Reese called the tool). Key guards
  were checked by mutation.
- The server's routes in-process against the real Nasdaq feed, no model, two
  runs on 2026-10-23: "Nvidia, Tesla" (NVDA landed in one reply; TSLA came
  back "the feed is rate-limiting me", said as such), "rocket lab" (Nasdaq's
  symbol search: RKLB, 5.4 s), "ZQXWQ" (the failed-add line, under 1.5 s),
  "Berkshire Hathaway" (BRK-B; landed in one run, rate-limited in the
  other), "Apple" via `focus_symbol` (put up and on watch),
  `refresh_quote` inside the floor (the board's number read back),
  "Coinbase" next to a stock already up (one landed, one "already on the
  board"), "it" removed (the one on watch), button presses worded for Reese,
  clear twice.
- Not yet live with the tools.
