# The Pen Test

"Sell me this pen", played for real. The seller studies a stranger's photo, opens the
conversation by voice and tries to earn as much as possible from three guests before the clock
runs out. Clues are in how each guest looks and talks. The seller learns from a red-pen reveal
after each guest, and a report card at the end.

## How it works

```
page (apps/pen-test/page)            server (server.ts)                 Atmee
  guest video, clock, offer  --->      run, guests' secrets      --->   POST /v1/session
  seller's lines (captions)  --->      judge + rules (engine/)          per guest, with secrets
  state / event to the guest <---      direction, sale, walk            in appTools.instructions
  atmee.tool decide          <---------------------------------------   the guest's call
```

- **The app decides, the guest acts.** `engine/rules.ts` holds levels, the sale gate, money and
  scores. `engine/judge.ts` reads each seller line (Gemini, or word rules when it fails).
  `engine/director.ts` turns the result into a `GUEST DIRECTION` state line.
- **A sale needs all of it:** a pitch fitted to the need, enough interest, an offer between the
  level's lowest price and what the guest would pay now, and a clear ask. A guest's own "yes" with
  the gate closed changes nothing, and the `decide` tool can only make a guest walk.
- **Prices:** list $25, lowest $8 to $12 by level. Each guest has a hidden top price that rises
  with interest. The reveal shows the money left on the table.
- **Each guest is one avatar and one session**, under `/api/apps/pen-test/run/<run>/<n>/session`.
  The page never holds a need or top price until the reveal.

## What the API could not do

- **The seller must speak first, and every avatar greets on arrival.** No session option turns the
  greeting off. The page keeps the guest behind their still photo, with the volume at zero,
  until the greeting has passed. That hidden time bills.
- **Check-ins can't be turned off.** After about 10 s of silence a guest says "Hm?", which fits.
- **Plan session cap.** On a 180 s plan Walk-in runs 2:40, so the clock ends inside the session.
  `PEN_TEST_SESSION_CAP` sets the cap for another plan.
- **No server-side transcript.** The page relays lines, so a score could be forged. Accepted until
  there is a public ranking.

## Guests leaving the frame (open)

v2 guests still leave the frame in this app's sessions, and strangers can appear in their place. The
same avatar held on its website chat in one short test. On 2026-11-02 Theo, through this app's API
session, gave these results by frame sheets:

| Session | Result |
|---|---|
| Full app text (reviewed takes) | Left in 4 of 4 |
| No instructions, tools or directions | Held in 1, a brief dip in 1 |
| No instructions or tools, directions on | Left, replaced by another man |
| Instructions and tools on, no directions | Left and returned repeatedly |
| No app text, 14 s pauses between seller lines | Left in 1, held in 1 |

App text and short replies make it more likely, but neither is required, and these are too few runs to
rank causes. Session instructions and directions do not reach `avatar2`'s persona input directly. Next
step: read `causeur.avatar.prompt` for a bad session and compare a website chat session's settings.

## Live runs, 2026-11-02 (local, production API)

- Good seller, Marisol: greeting hidden, seller spoke first, she haggled once, sold at $16, 85/100.
- Spec reciter: Walter walked after three lines (7/100), Ray likewise (8 and 12/100).
- Helen, Theo, Daniel on Thirty: all three reached the reveal and the report card; Helen challenged a false claim. The test mic reached only the first guest, so the later guests' sales are unproven.
- Not yet run live: a sale after the first guest, Floor rep and Closer, a false-clue guest being sold to.

## Run it locally

```bash
SITE_PORT=5231 HMR=0 ATMEE_BASE_URL=https://api.atmanity.us \
  node --env-file=../atmee-usecase-demos/.env --env-file=.env.local --import tsx server/index.ts
```

Open `http://localhost:5231/apps/pen-test/`. `PEN_TEST_FIRST=<guest>` puts one guest first for a
test. Rule tests: `npx vitest run apps/pen-test`.
