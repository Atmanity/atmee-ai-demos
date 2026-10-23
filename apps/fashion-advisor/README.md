# Notch

A personal stylist on call. Tell Emery what you're dressing for (a job
interview, a summer wedding, a first date) and share one photo of your outfit:
upload it, drag it onto the mirror, or borrow the example outfit. Notch scores
it out of 10 for that occasion, says what works and the one fix, and hangs the
pieces that would finish it on a rail, each with a shop link. Ask for the same
outfit rated for another occasion, for more pieces, or (with an image model) to
see a piece on your own photo. The fitting ends with notes to download. Rebuilt
from the `fashion-advisor` mini-app as a standalone product on the Avatar API.

Open it at `/apps/fashion-advisor/`.

## Running it

The repo's `.env` (see the root README) plus, for this app:

| Variable | Needed | What for |
|---|---|---|
| `GEMINI_API_KEY` | yes (the repo's) | the verdict, the body zones in the photo and the pieces (`server/llm.ts`) |
| `XAI_API_KEY` | optional | try-ons (`grok-imagine-image` edits) and the pieces' catalogue shots. Without it Emery is not given the try-on tools and the rail shows drawn marks and shop links: the product is complete without them |
| `FASHION_IMAGE_MODEL` | optional | the xAI image model (default `grok-imagine-image`) |
| `FASHION_IMAGE_PROVIDER` | optional | `gemini` switches try-ons off (see the gaps) |
| `AMAZON_STORE_DOMAIN`, `AMAZON_ASSOCIATE_TAG` | optional | the shop links' store (default `amazon.com`) and affiliate tag |
| `AVATAR_FASHION_ADVISOR` | optional | a dedicated host made from `avatar.json` (or its `avatarId`; else `AVATAR_DEFAULT`) |

## How it works

| Part | Where |
|---|---|
| The fitting: the photo, the verdict, the pieces, the try-ons | `engine/stylist.ts` on the server (the images and the model keys live there), with the original's rules: body zones refuse a piece that is out of frame, suggestions are filtered and capped, a new photo is a new look, reads run on one serial queue. The page gets a view, every image behind an opaque URL. |
| The models | `models.ts`: Gemini (`structured()`) for the verdict, the zones and the pieces, with the original's prompts and clamps (`engine/prompts.ts`); xAI for the try-on and the catalogue shots (`engine/thumbnails.ts`). |
| Emery's actions | Tools (`engine/director.ts`), all `await`, with lenient schemas (no closed objects, enums or tight lengths: the platform rejects a call that does not fit before the page sees it); `engine/fitting.ts` reads the arguments loosely ("A Summer Wedding, please" is "summer wedding", "dressier" leans formal, "the second one" is the second piece). Each result starts with its outcome ("Done:", "Not yet:", "Refused:") so the platform's filler cannot pre-judge it: `rate_outfit(occasion?)` (25 s), `suggest_pieces(direction?)` (25 s), and with an image model `try_on(piece)` (10 s) and `restore_photo` (25 s). `engine/fitting.ts` turns a call into the stylist's action; the page answers the `atmee.tool` call with the result, so her first reply carries the verdict. |
| Slow work | A read takes a few seconds: the page waits up to 20 s for it, else answers "still working" and passes the verdict on as an event when it lands. A try-on is accepted or refused at once (that is `try_on`'s result); the picture (~20 s) and its new score follow as events. |
| Emery's rules | The session's tool `instructions`: she cannot see the photo, acts only through the tools, never gives a score herself, never says a piece is on before Notch says so; her voice. Without an image model the try-on rules are left out. |
| What Emery sees | `state`: the occasion, what is in the mirror, the verdict, the rail in order (for "the second one"), the next piece, work in progress. Never an image URL or a link. |
| Buttons | Upload, the example outfit, an occasion, Rate it again, More pieces, Try it on, Back to my photo: they act at once (`POST /act`, the same actions as the tools) and Emery is told by an event: what was pressed, then what came of it. |
| The safety net | `useToolNet` (kit) with `engine/judge.ts` `mustDo`: when the user clearly asks to be rated ("rate me for a wedding instead", "rate it again") or to go back to their own photo, and Emery calls no tool within 7 s, the page does it and tells her. More pieces and try-ons are left out (a duplicate grows the rail or pays for a render twice). It also stands down when she called any other tool for those words. |
| The opening | An event when Emery arrives, from where the fitting stands (the room opens while she connects, so the user may already have added a photo or picked an occasion). Her own greeting already introduced her, so it starts "You have just greeted them; do not greet or introduce yourself again." |
| A photo | Emery is told at once that it is in the mirror (and being read, or that she must ask the occasion); the verdict follows as a second event. |
| The screens | A front door (`page/Lobby.tsx`); the fitting room (`page/Fitting.tsx`: the mirror, the verdict on a tape measure, the occasion picker, the rail) with Emery framed beside it; the fitting notes with a download (`page/Notes.tsx`); styled in `page/notch.css`. On a phone Emery stays at the top of the screen. |

What changed from the first port: no name step and no onboarding steps (an
occasion and a photo, in either order, are a fitting); the old speech judge
(names, styles, "yes" to an offer, every command in words, with a model call
for loose words) is gone, since Emery passes what she heard to a tool; no
staged answers; the board works without a call (a failed call still leaves the
fitting usable), and calling Emery again keeps the fitting.

## What the API could not do

Status after the first live run of Notch (2026-10-23, staging). **Seen**: observed
live. **Expected**: not observed yet.

1. **Tools are called when the host decides.** *Seen* (live, 2026-10-23):
   the occasion, "Can you rate it again?" and "Make the pieces more
   streetwear" got no call from Emery ("I'm updating the rail…"). The first
   two were done by the safety net; the third was not (more pieces are left
   out of the net). Likely cause, now fixed: strict schemas (closed objects,
   `minLength`) that the platform enforces before the page sees a call; the
   instructions now also say a one-word answer is a call and nothing is said
   to have happened unless a result says so. *Expected* to improve.
2. **The example outfit went unnoticed.** *Seen*: "Take your time getting that
   photo added" after it was in the mirror (the only event came with the
   verdict). Fixed: an event at once that the photo is in.
3. **The greeting came twice.** *Seen*: the host's own greeting, then the
   opening's. Fixed: the opening does not greet.
4. **The host cannot see the outfit.** *Expected* (known). The original ran with
   video: "how do I look now?" was answered from the camera. Here Emery knows
   the look only as Notch's verdict, and a change in front of the camera needs
   a new photo.
5. **Slow work outlives a tool call.** *Expected.* An `await` holds at most
   28 s. A verdict usually lands in a few seconds, but with Gemini's retries it
   can take longer: then her first reply is "it's coming" and the verdict is an
   event, spoken when she has the floor. A try-on (~20 s) is always an event.
6. **No verbatim speech.** *Expected.* Results are paraphrased: she may restate
   a score or a piece's name loosely.
7. **Events are spoken when the host has the floor, and one wins.** *Expected.*
   A button press told while she is speaking waits, and is dropped after its
   ttl; an event and a user turn at the same moment: one is answered.
8. **Gemini cannot draw through `server/llm.ts`.** `structured()` asks Gemini
   for JSON only, so the original's Gemini try-on path is not available; with no
   `XAI_API_KEY` there are no try-ons. A `generateImage()` beside `structured()`
   would bring it back.
9. **The persona belongs to the avatar.** *Seen* in the first port (the shared
   test avatar introduced itself as someone else). `avatar.json` is Emery.
10. **The ~10 s check-in** prods a user who is still choosing a photo. *Expected.*
11. **No speech hints.** *Expected.* Occasions and garment names are passed as
   heard; `try_on` resolves loose names ("the navy tie", "the second one")
   against the rail.

Fixed by tools, compared with the first port: the host no longer answers a
spoken request before the app acts ("ooh, let's see it!" before the score: the
score is the result now); the onboarding gates that were approximate are gone
with the onboarding; "try-ons are turned off" no longer comes twice (once from
staged state, once from the event), since without an image model there is no
try-on tool at all.

## Tested

- `npx vitest run apps/fashion-advisor`: 167 tests. The engine as ported (body
  zones and item matching, refused try-ons, the refusal that stays refused,
  the suggestion cap, the thumbnail pool, the prompts and clamps, retries); the
  fitting (`engine/fitting.test.ts`: every tool and button, results versus
  button wording, no second read while one is pending, an occasion picked
  while a photo is checked, "the second one"); the director (the tools and
  instructions against the API limits with and without try-ons, the board
  under 3,858 characters at its fullest and without links, every offer waiting
  for a yes); the safety net's phrases; the screens in every state with no
  plumbing words on screen; and the page's wiring with the call faked and a
  real fitting behind a fake server (tool results, button events, a try-on's
  follow-up events, the notes at the end, the safety net acting and standing
  down).
- Live on staging, 2026-10-23 (own host, no xAI key): the verdict, a re-rate for a summer wedding (new score in the first reply), more pieces, a typed re-rate for a job interview and the fitting notes all worked; the misses are gaps 1 to 3 above.
