# Fashion Advisor

A stylist who reads your outfit. Tell her your name and the look you are going
for, share one photo of what you are wearing (drop it, upload it, or try the
sample: nothing opens your camera), and the app rates it out of 10 against
that look, says what works and the one fix, and lists pieces to add, each with
a shop link. With an image model configured it puts a piece on your photo (a
try-on) and re-rates the result. Say or type "try a black fedora hat", "more
ideas", "rate it again", "rate me for a wedding instead", "make it more
streetwear", "new photo" or "back to my own photo"; every one of them is also a
button. No photo? Say so, and the outfit is styled from your words.

Ported from `Atmanity/apps/apps/fashion-advisor` (a 6,000-line Python LiveKit
agent with eight tools, three onboarding AgentTasks, a narrator and a job
worker, plus a React panel) onto the Avatar API. It follows the shape of
`apps/guess-the-city` (see `docs/PORTING.md`).

## Running it

The repo's `.env` (see the root README) plus, for this app:

| Variable | Needed | What for |
|---|---|---|
| `GEMINI_API_KEY` | yes (the repo's) | the style read, the body zones in the photo, the pieces, and judging loose words (`server/llm.ts`) |
| `XAI_API_KEY` | optional | try-ons (`grok-imagine-image` edits) and the pieces' catalogue shots. Without it both are off, and the page and the avatar say so |
| `FASHION_IMAGE_MODEL` | optional | the xAI image model (default `grok-imagine-image`) |
| `FASHION_IMAGE_PROVIDER` | optional | the original also drew with Gemini (`gemini`); not available here (see the gaps), so `gemini` switches try-ons off |
| `AMAZON_STORE_DOMAIN`, `AMAZON_ASSOCIATE_TAG` | optional | the shop links' store (default `amazon.com`) and affiliate tag |
| `AVATAR_FASHION_ADVISOR` | optional | a dedicated avatar made from `avatar.json` (else `AVATAR_DEFAULT`) |

Open `http://localhost:5190/apps/fashion-advisor/`.

## How it works on the API

| Feature | Mechanism |
|---|---|
| The session's truth: photo, try-ons, read, pieces, what was tried | `engine/stylist.ts` on the server (the images and the model keys live there). The page gets a view, with every image behind an opaque URL |
| Slow work (a read, a try-on) | jobs on one serial queue, as the original worker: the page posts a command, gets an acknowledgement, then waits for each milestone (`image`, `done`); each brings a newer board and maybe an event |
| Onboarding: name, style, photo | steps on the board (a name field and "I'd rather not say"; style chips or your own words; a drop zone, "Upload a photo", "Try a sample", "Skip it") and the same answers spoken or typed through `engine/judge.ts`: the original's regexes first (name frames, the style keyword map, the decline table), a `structured()` call only for a bare name or a style in your own words |
| The original's onboarding guards (ask the name at most twice; never ask for the photo again after a no; don't ask for a style already given) | state the app keeps (counters, the sticky refusal) and staged lines in `state` ("you have asked already: if they don't give it this time, carry on without one") |
| The style read, body zones, pieces | Gemini through `structured()` with the photo, the original's prompts and clamps (`engine/prompts.ts`) |
| Try-on (tap, typed or spoken) | rules (`judge.ts`: "try X", "put X on me", "show me with X", "the second one", a "yes" to the piece the avatar just offered), the original's refusal rules (not a garment; the body zone not in the photo), then xAI image edit, then a re-read with the score change |
| Catalogue shots | rendered in the background (three at a time, each garment once, shared by all sessions); the page polls the view while some are pending |
| More ideas, rate again, a new target, a new direction, a new photo, back to the own photo | buttons, and rules for the spoken and typed forms (a `structured()` intent call only for loose words naming a garment or a style) |
| What the avatar is told | three `note`s (the stylist's voice, the truth rules, the taste) condensed from the original's 13k-character instructions; a `state` with the board and staged answers (the next piece, the score, what to say to "I have no camera"); `event`s for every outcome |
| The original's verbatim lines (openers, acks, briefs) | examples inside instructions ("say a short line like: ..."), since words cannot be forced |
| The avatar's own offers ("want to try the navy tie?") | the app asks for the offer in its read event (and remembers it), and also reads the avatar's captions for offers it makes itself, so a bare "yes" within 30 s puts the piece on |
| Superseded try-ons | the narration of a try-on overtaken by a newer request is dropped (the original narrator's epochs); its picture still shows |
| Shop links | per piece, and "buy this look" / "shop similar" under a try-on |

What changed from the original on purpose: the photo is a file, not a camera
frame (so "I have no camera" is no refusal: the staged answer explains
uploading); a new target re-reads the photo on screen instead of asking for a
new one; a new photo is a new look (its try-ons and pieces start over); a piece
counts as tried once its try-on rendered, not when it was asked for; "yes" and
"ok" are whole words (upstream matched substrings, so "look" read as "ok"); and
"I'm wearing black jeans" is no longer taken as a name.

## What the API could not do

Status after the live run of 2026-10-23 (below): **seen** = observed live,
**expected** = not yet observed.

1. **The avatar cannot see the outfit.** *Known.* The original ran
   with `video_enabled=True`: "how do I look now?" was answered from the live
   camera. Here the avatar knows the look only as the app's read in `state`; a
   change the user makes in front of the camera needs a new photo first.
2. **The avatar answers a spoken request before the app acts.** *Seen, held.*
   "Rate me for a wedding instead" got "ooh, let's see it!" and then the
   new score; the sample photo got "give me just a beat" and then the read.
   No result was claimed early. On "try the fedora" or "rate me for a wedding instead" the
   avatar replies at once (perhaps "here you are in the fedora!") while the
   10-20 s render or read is still running. A standing note says to hold, and
   `state` says what is rendering and that it is NOT on screen yet, but that
   state reaches it a turn late. The original's tools returned the line inside
   the reply; the API has nothing equivalent.
3. **No verbatim speech.** *Seen, mildly*: "try-ons are turned off in this
   demo" came twice for the fedora (the avatar's own reply from the state,
   then the event). The score, the score change and
   the next-piece offer go out as events, paraphrased, spoken only when the
   avatar has the floor, and dropped after their ttl. The avatar may restate a
   score wrongly or skip the offer that a bare "yes" depends on (the app
   remembers the offer it asked for either way). The order of the try-on's two
   events (intro, then rating) is likely but not guaranteed.
4. **Onboarding gates are approximate.** *Seen once*: told "I'm Sam, and I'm
   going for smart casual", the avatar still asked "What kind of vibe are you
   aiming for?" while the app had recorded both and moved to the photo. "Ask the name at
   most twice", "never ask for the photo again after a no" and "don't ask for a
   style already given" were tool-enforced. Here the app keeps the counters and
   the refusal, and stages the right reply in `state`; the avatar can still
   phrase an extra ask.
5. **Gemini cannot draw through `server/llm.ts`.** `structured()` asks Gemini
   for JSON text only (`responseMimeType: application/json`), so the original's
   Gemini image path (`gemini-3.1-flash-image`, `FASHION_IMAGE_PROVIDER=gemini`)
   is not available without code outside this folder. With no `XAI_API_KEY`,
   try-ons and catalogue shots are off: the Try on buttons are disabled with
   the reason, the cards show a quiet zone mark instead of a shot, and a
   spoken or typed try-on gets an event telling the avatar to say so and to
   describe the piece in words without claiming it is on. A `generateImage()`
   beside `structured()` would bring Gemini try-ons back.
6. **The persona belongs to the avatar.** *Seen* (the livestream host,
   describing its own test setup: "a fixed 400 millisecond prime lead and this
   6c68cadd voice profile"). The original's
   lines carried a runway backstory; that belongs to the avatar now
   (`avatar.json`, "Emery"). On the shared test avatar the app's role comes
   from the notes and `state`, after the avatar's own greeting.
7. **Idle check-ins.** *Expected* (one cut-off "We could…"). The original checked in after 90 s
   of quiet (120 s grace, at most twice) with an item-specific line. The
   platform's own ~10 s check-in replaces it and cannot be tuned; `state`
   stages "if things go quiet, offer the X" so it is at least the right piece.
8. **No speech hints.** *Expected.* Live, "Sure, I can share a photo" arrived
   in two pieces, "[backchannel] Sure, I." and "can share a photo."; the kit
   now strips the tag. The original biased the
   recogniser toward style words ("business casual" was heard as "casual"
   without them); the chips on the style step are the fallback.

No longer needed: the original's "can you hear me?" short-circuit and its TTS
sanitiser (the platform's), the shell's vision modal and storage, and the
chunked image transport (images are URLs).

## Tested

- `npx vitest run apps/fashion-advisor`: 226 tests. Ported from the original:
  the body zones and item matching (`test_parity.py`), the refused try-ons
  (`test_refused_panel_try_on.py`), the decline, outfit and name tables
  (`test_declining_the_camera.py`, `test_onboarding_lets_you_past.py`), the
  style already given (`test_style_already_given.py`), the thumbnail pool
  (`test_suggestion_thumbnails.py`), the suggestion cap
  (`test_rehydration_stays_in_one_envelope.py`) and the panel's thumbnail
  merge (`messages.test.ts`). New: the judge's commands, the stylist's jobs
  and milestones with fake models, the director's limits and staged answers,
  the board's controls (jsdom).
- Live: one run on staging (Gemini key, no xAI key), below.

### Live run (staging, avatar `2cd3ec08`, 2026-10-23)

Spoken lines through `tools/live-test/harness.js`:

- "Hi, I'm Sam, and I'm going for smart casual for a work dinner." → name and
  style recorded, the photo step shown (gap 4).
- "Sure, I can share a photo." → "drop or upload a photo… on the right".
  "Try a sample" → "give me just a beat", then 7/10 for smart casual with what
  works and the next piece.
- "Can you put white sneakers on me?" → "try-ons are actually turned off in this
  demo", with the sneakers described in words. "Try a black fedora hat." →
  the same, twice (gap 3).
- "Show me more ideas." → more pieces named (the tortoiseshell glasses).
- "Rate me for a wedding instead." → re-read, 3/10. "I look good now, right?"
  → answered from that score. Typed "rate it again" → re-read, 3/10.
- Session `completed`, `ended_by_api`, 326 s billed.
