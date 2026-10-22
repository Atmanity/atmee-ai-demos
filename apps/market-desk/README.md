# Market Desk

A live stock watchlist you build by talking. Put up to six stocks on the board
by saying or typing a company or a ticker; the analyst reads the tape off the
board (last sale, day move, 52-week range, how old each print is) and never
gives advice.

Ported from `Atmanity/apps/apps/market-desk` (a Python LiveKit agent with six
tools, a fetch pump, a refresh timer and a ±1% announcer, plus a React panel)
onto the Avatar API. It follows the shape of `apps/guess-the-city`
(see `docs/PORTING.md`).

**Use it.** The board is live as soon as the page opens: tap a starter or type a
ticker into the box. Press **Call the analyst** (or **Type instead**) and talk:

- "Add Nvidia", "put Apple, Nvidia and Tesla up", "what's Netflix doing?",
  "pull up Microsoft", "check it again", "drop Tesla", "lose the last one",
  "clear the board";
- "what's it at?", "which moved more today?", "what does Nvidia make?" are
  answered from the board;
- "should I buy it?", in any phrasing, gets the standing line, "I read the
  tape, I don't give advice.", plus one fact from the board.

Every card: click to focus (the focused card is refreshed every minute and the
analyst speaks when it moves a point), ⟳ to refresh, ✕ to remove; "Sort by
move" (view only) and a two-tap "Clear".

## How it works on the API

| Feature | Mechanism |
|---|---|
| Quotes: Nasdaq first, Yahoo as the fallback; stamped with the time they printed | `engine/feed.ts` + the parse in `engine/board.ts`, **on the app server** (neither answers a browser: CORS, a browser User-Agent, per-IP rate limits) |
| The board: six rows, refusals as sentences, the 15 s refresh floor, stale rows grey | `engine/board.ts` + the store in `engine/desk.ts`, one desk per page, on the server |
| The fetch pump, the 60 s refresh of the focused card, the 5 min stand-down after a failed pull | `Fetcher` and `RefreshTimer` in `engine/desk.ts`, on the server; the timer runs while the page is connected |
| The page's view of the board | server-sent events (`GET /api/apps/market-desk/desks/:id/stream`); every action's reply carries the board too |
| The ±1% line, a failed add, a quote the user asked for landing | the server's `Announcer`/`Fetcher` → the stream → the page → `event` (the server cannot speak into the room: only the page holds the user token) |
| Name to ticker ("add Nvidia", "put the search-engine one up") | `engine/judge.ts` on the server: rules (verbs, names on the board, ~90 well-known names, `$TSLA`, spelled-out letters) → the app's own `structured()` call → Nasdaq's symbol search; the feed has the last word on any ticker |
| add / remove / focus / refresh / clear | a control for each, and the same actions from speech and typed lines through the judge |
| The analyst (desk style, the board is ground truth, the app changes the board, the hard rule) | three `note`s (`engine/director.ts`, each ≤ 2,000 chars). `buildNotes(extra)` puts any extra instructions before a re-assertion of the hard rule, as the original did with workspace text |
| The live board | `state`: one line per row with its age or "(stale)", the names, what is ARRIVING (adds only, never a background refresh), the last refusal, and the staged refusal: the standing line plus a board fact the app words (price and move, 52-week position, or the biggest mover, rotating so a second refusal is not the first one again) |
| No advice (the original's `decline_advice` tool) | held by the app: rules (and the model) detect an advice question before anything else. Typed: recorded, never forwarded, answered by a decline event. Spoken: the avatar answers from the refusal staged in `state` (an event would make it refuse twice). The panel draws the refusal either way |
| Typed lines | judged first: a desk action or an advice question is recorded and acted on; anything else goes to the avatar as a typed turn |
| The opening | an `event` on arrival: "ask which ticker", or, if the board was built while the avatar was on its way, "read the focused one" |
| Conductor | none |

Running it needs only the repo's `.env`. Optional:

- `GEMINI_API_KEY`: the judge's model call. Without it the judge uses its rules
  and Nasdaq's symbol search; descriptions ("the search-engine one") and new
  phrasings of an advice question are then missed (the rules still catch the
  usual ones: "should I buy", "is it cheap", "price target", "what would you do"…).
- `MARKET_DESK_CHART_URL`: points the Yahoo fallback at a replay of the
  recorded payloads, for working with no network:
  `npx tsx apps/market-desk/tools/replay-feed.ts &` then
  `MARKET_DESK_CHART_URL='http://127.0.0.1:8795/chart/{symbol}' npm run dev`.
  A dev escape hatch: what it serves is as old as the recording, and every
  symbol but AAPL is labelled "replay data".
- No market-data key: Nasdaq and Yahoo are keyless (and rate-limit by IP).

## What the API could not do

Status after the live run of 2026-10-23 (below): **seen** = observed live,
**expected** = not yet observed.

1. **A spoken add is not the avatar's own act.** The original's model called
   `add_symbol` inside its reply and said "NVDA is going up" truthfully. Here the
   avatar answers "add Nvidia" before the app has judged it (the transcript
   arrives about a second after the user stops; a model call adds about a
   second more). If the judge misses, or maps the name to a different ticker,
   the avatar has already said "putting Nvidia up". The app follows with the
   landing ("NVDA is on the board now at…", naming what the user called it when
   that differs) or takes the promise back ("ZQXWQ did NOT go up…"). Typed
   requests are judged before the avatar hears anything. *seen*: "Add Z Q X W
   Q" got "Aye, sure, putting Z Q X W Q up for you now", then the app's "I
   couldn't find a listing for ZQXWQ — check the ticker." "Add Nvidia and
   Tesla" (heard "At Nvidia and Tesla") still went up, both rows.
2. **A remembered price before the row lands.** Between "what's Tesla doing?"
   and the state showing TSLA arriving, only the standing note stops the avatar
   quoting a price from memory; the original's tool cue ("you do not have the
   number yet") landed in the same generation. *expected* (live, every add got
   a holding line with no price, then the real move).
3. **The no-advice rule is not the app's to enforce for speech.** The avatar
   answers "should I buy it?" before the app hears the question. The app stages
   the refusal in `state` and the rule in a note, but cannot hold or verify the
   reply. The original re-asserted the rule after any workspace text on every
   generation; notes go once, and the avatar's own persona and guardrails come
   before them. *seen holding*: "Should I buy Nvidia?" got one refusal with a
   board fact ("I read the tape, I don't give advice. Nvidia is sitting at
   two hundred twelve dollars and fifty-five cents…"), not two. A typed "is
   apple cheap right now?" was declined with a fact about Nvidia, the staged
   one, since Apple was not on the board.
4. **Unprompted chatter.** The design is "speak only on a ±1% move"; the
   platform's ~10 s check-in talks into every silence (grounded by `state`,
   but it is the chatter this app removed). *seen* ("Which of these two would
   you like to focus on…", "Would you like me to run through what Nvidia
   actually does…").
5. **Announcements compete for the floor.** A move line (ttl 30 s) is dropped
   if the user keeps talking; a failed add (ttl 45 s) may never be said. The
   panel shows both. *expected*
6. **The server cannot speak into the room.** The desk's lines reach the
   avatar only through the open page. *known*
7. **No per-session speech hints.** Company names (Alphabet, ASML, Nintendo)
   are where recognisers diverge; the original passed no hints either, but its
   model read the name inside its own turn. *expected*
8. **Words cannot be forced.** The standing line is said in the avatar's
   words; the panel prints it verbatim. *seen holding*: the failed add was said
   word for word.
9. **The persona is the avatar's.** The test avatar greets as itself; the
   analyst ("Reese", `avatar.json`) needs a dedicated avatar. *seen* (the
   lighthouse keeper: "Aye, sure…").

## Differences from the original

- The board and its timers run on the app server and stream to the page (the
  original's agent held them and broadcast snapshots to a sandboxed panel).
- New: a quote the user asked for is read when it lands, several in one line;
  a refresh the user asked for that fails is owned up to (the timer's own
  failures stay silent); the panel draws the advice refusal; the focused card is
  badged "on watch"; the day's move is labelled "today".
- Fixed while porting: Nasdaq writes share classes `BRK.B` and called the
  board's `BRK-B` unknown (so Berkshire could never go up); a row is keyed on
  the ticker the board claimed, whatever spelling the feed answers in; a board
  cleared while an add was in flight no longer gets the row back; a "Closed at
  …" print stamp is read as the print time.
- Not ported: the RPC manifest test (no RPCs here). `Sort by move` is still view
  state only.

## Tested

- `npx vitest run apps/market-desk`: 208 tests. Ported (121): `test_board.py`
  (all 30, 45 cases), `test_feed.py` (all 12, 14 cases), `test_table.py` (35 of
  36: the pump, the timer and its stand-down, the announcer's guards, the
  state, the old tool bodies; the RPC manifest test has no equivalent),
  `test_persona.py` (2), and the panel's `MarketDesk.test.tsx` (24). New (87):
  the judge with real phrasings (advice first, commands, names, the model and
  the search), the director's limits and the staged refusal, what the avatar is
  told per input, the fixes above, and the offline replay.
- A server run without an avatar or a model, against the real Nasdaq feed:
  buttons, "Put Nvidia and Tesla up" (one landing line for both), "Should I buy
  it?" (spoken: no event, the staged refusal), "Is Apple cheap right now?"
  (typed: decline event with the 52-week position), "add rocket lab" (the symbol
  search: RKLB), "add $ZQXWQ" (the failed-add line), "Add Berkshire" (BRK-B),
  a seventh symbol refused, "drop Tesla" typed.
- Live: one run on staging, below.

### Live run (staging, avatar `26cbe079`, 2026-10-23, after the close)

Spoken lines through `tools/live-test/harness.js`:

- "Add Nvidia and Tesla." → "Putting Nvidia and Tesla up for you now", then
  "Nvidia is up zero point one six percent, and Tesla is down zero point two
  seven percent" (the board: +0.16%, −0.27%).
- "What's Netflix doing?" → NFLX added, then its move.
- "Should I buy Nvidia?" → one refusal with a board fact (gap 3).
- "What does Nvidia make?" → a plain answer, no refusal. "Drop Tesla." → the
  card went.
- "Add Z Q X W Q." → promised, then taken back (gap 1).
- Typed "is apple cheap right now?" → recorded, declined.
- Session `completed`, `ended_by_api`, 209 s billed.
