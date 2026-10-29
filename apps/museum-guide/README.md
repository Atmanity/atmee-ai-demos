# The Meridian

A museum tour on the visitor's own phone. The rear camera fills the top of the
screen, clear of anything laid over it; Edmund Hale, the museum's chairman,
talks from a video tile in the panel below, beside his subtitles.
The visitor points the phone at a painting, or at the QR code on its label, and
asks him about it out loud. He tells them its story from the museum's catalogue,
points at details he can see through their camera, and suggests where to go next.

Open it at `/apps/museum-guide/` on a phone. `?exhibit=<id>` opens the tour at a
work (that is what a label's code links to), and `?sheet` shows every work with
its label for a second screen or a printer, so the tour can be tried without a
museum.

## How it works

| Part | Where |
|---|---|
| The guide's tile | `page/App.tsx`: the camera is never overlaid. Edmund (and a guest) is a square video tile at the start of the panel, framed against their own backgrounds (Edmund in a softly lit gallery, the girl in Vermeer's darkness, the wanderer above the fog, Mona Lisa in her painted landscape), with their name on it and a brass ring while they speak. Both calls play in the same tile; the one on stage shows and the other stays in the page unseen so it keeps playing. An earlier version keyed Edmund out of a green screen over the camera; it was dropped as harder to read and cluttering the view. |
| The camera | `page/camera.ts`: the rear camera (`facingMode: environment`), full screen. Its track is also given to the session (`useAvatar.start({ camera })`, a kit option this app added): `joinAvatar` publishes a copy as the user's `camera` track, and Causeur's vision shows Edmund its latest frame (at most 5 s old) when he answers. The page keeps its own track, so hanging up leaves the preview running. |
| Which work is it | Two ways, both ending in that work's catalogue record in Edmund's state. **A label's QR code**, read in the page every 300 ms with `jsqr` (`useLabelScanner`, `engine/labels.ts`); the same label held in view is not a new arrival for 90 s. **A camera frame** (the "What is this?" button, or Edmund's `identify_exhibit` tool): a 768 px JPEG goes to `/api/apps/museum-guide/identify`, where Gemini picks an id from the catalogue or "none" (`engine/identify.ts`). The app believes only a high or medium-confidence pick of a real id. |
| Edmund's tools | `identify_exhibit` (await, 20 s): the page looks through the camera and returns "Identified: <record>", "Not identified: the camera shows …, which is not one of the Meridian's works", or "Not identified: not clear enough". `show_exhibit(title)` (await, 8 s): puts a work's card on screen and returns its record and room. Lenient schemas; results lead with the outcome. |
| Where facts come from | `engine/catalogue.ts`: eight works, each with its title, artist, date, medium, room, where the original hangs, a short story, details to look for and a work to see next. His instructions (`engine/director.ts`): every fact about a work from its record, never memory; the camera image is for pointing ("see the tiny mountain in the hollow of the wave"), not for facts. |
| The safety net | `useToolNet` (kit): when the visitor asks "what is this?", "who painted that?" and Edmund has not called `identify_exhibit` within 7 s, the page looks and tells him. |
| Edmund's picture of the tour | `state` (about 2,000 of 3,858 characters): whether the camera is on, the work they are at with its whole record, what they have seen, and the floor plan. Arrivals (a label scanned, a work found by the button) are `event`s asking him to tell its story; a second scan of the same label only asks what they would like to know. |
| Push to talk | `page/PushToTalk.tsx`: the call joins with the microphone muted (`micMuted`), and it opens only while the mic button (or the space bar) is held, plus 0.4 s after it is let go so the last word is not cut. A gallery is never quiet; nothing around the visitor is heard unless they press. Live: speech played with the button up was not heard; the same speech held was heard word for word. |
| The museum map | `page/MuseumMap.tsx` over `engine/floorplan.ts`: the four rooms, a numbered pin per work along the suggested route (from the entrance through rooms 1 and 2, up into 3 and on to 4), a tick on every work seen (a label scanned, a work found by the camera, or ticked by hand), a ring where the visitor is now, and the works by room below. A pin or row opens the work's whole entry: picture, date, medium, where the original hangs, its story, what to look for, the next work on the route, "Mark as seen", and "Ask Edmund about it" (a typed turn) while the call is live. The header's Map chip counts the works seen; the visit card opens the same map. Label scanning pauses while the map is open. |
| Guests | `engine/guests.ts`: at three works the figure from the painting comes to life: the girl from *Girl with a Pearl Earring* (avatar `cb84bed4`, her portrait restyled from the painting itself), the wanderer from *Wanderer above the Sea of Fog* (`2e7275e6`, an invented face: Friedrich never painted one) and the woman in the *Mona Lisa* (`63b1eb03`, the painting itself, reframed with her lips parted). Each has their own voice and a first-person persona, and gets their painting's record as state; Mona Lisa speaks as the painted figure and knows only what the record says of who she is thought to be. Edmund offers them once he has told the story, and hands over with `introduce_guest` (or the visitor presses "Meet …"). The guest's session is a second `useAvatar` on `/api/apps/museum-guide/guest/<id>/…` (the server starts it on the guest's avatar, with the guest's one tool, `call_host_back`). Edmund stays on the line, muted and out of sight, so "Call Edmund" (or asking the guest for him) brings him back at once with no second greeting, told whom the visitor met; then the guest's session ends. Live, a restarted session took 18 s and opened with his greeting from scratch; that is now only the fallback when his session has ended meanwhile. |
| A quick hand-over | A session takes about 20 s to join, so a guest's is started as soon as the visitor reaches their work (a label, the camera, or opening the tour there), hidden and muted while Edmund tells the story. "Meet …" then waits only for Edmund's goodbye (at most 6 s) and the guest is told the visitor has just arrived (their greeting on joining went unheard). Moving to a work without a guest, or 4 minutes unmet, ends the warm call so it does not bill unseen. Live: the girl was on screen 1 s after Meet (it was about 20 s). While a hand-over is under way, the tile shows who is coming with a turning ring, the panel's top edge shimmers, and the line above the subtitles says "The girl is on the way…" (or "Edmund is on the way back…"). |
| Hand-over rules | A label scanned while a guest talks: the guest says Edmund will tell them about it and calls him back, and his welcome back tells the new work (live: the girl called him back 2 s after the label, and he told The Starry Night). A guest who cannot come: Edmund says so and carries on (seen live after a staging 524). A guest's call that drops: Edmund comes back, still told whom the visitor met. Push-to-talk closes the microphone of the call it opened, even if the other one came on screen while it was held. End ends both calls, cancels a call-back under way, and a call still being placed is ended as soon as it connects (a kit change: `useAvatar.end()` during `start()`), so nothing bills unseen; the camera goes off with the tour. The guest safety net is the kit's `useToolNet` over `engine/judge.ts`'s phrases (a request for Edmund, not any mention of him). The server starts at most 4 guest sessions at once and takes only a JPEG for `/identify`. |
| A work's entry | `page/WorkInfo.tsx`: when a work is introduced (a label, the camera, Edmund identifying it), its whole entry opens over the camera, with "Back to camera" at the bottom; the panel stays under it, so his words and the mic still work. "You are at …" in the panel opens it again. A work with a guest shows "Meet …" there. The dock's Info button opens the entry of the work the visitor is at. Label scanning pauses while it is open. |
| The camera, on the visitor's terms | It opens only once Edmund is on the line (not while the call is placed) and is then shown to him with the kit's `setCamera`; the camera button in the top bar turns it off (taken from the calls, scanning paused, "What is this?" off, Edmund told he cannot see) and on again. The page sizes the video to cover its box itself: on iPhone Safari `object-fit: cover` left the live camera shrunk to fit, with black bars either side. |
| Subtitles | `page/Subtitles.tsx` over `page/subtitles.ts`: one phrase at a time (a sentence, a long one cut at its commas), never the raw stream, which arrived in pieces ("…looking at Leonardo da"); its words light up at about his speaking pace while his voice plays (2.7 words a second; the platform gives no word timings) and the rest wait dimmed, so nothing jumps. A fixed height keeps the panel, and the guide standing on it, still. |
| Languages | The nine the Atmee frontend offers: English, 繁體中文, 简体中文, 日本語, 한국어, Deutsch, Tiếng Việt, Español, Русский. Picked before the tour from a button in the front door's top bar that opens a sheet of all of them (kept for the next visit; the browser's language the first time). The session is started in it (`POST /v1/session` `language`, passed by the kit's `start({ language })` and the site's session route); the platform routes recognition and replies for `en`, `zh-TW` and `ja` and detects the others. Edmund and the guests get a standing note to speak only that language, with the museum's and his names and title as the screen gives them (`engine/lang.ts`), and every record in it. Everything in another language is data: `translations/<lang>.json` (the screen, the works, the floor plan, the guests, the names), read by `engine/translations.ts`. The Traditional Chinese and Japanese are hand-written; the other six were translated from the English by a model, checked mechanically (same keys, placeholders, list lengths) and read over, and `engine/translations.test.ts` keeps every language complete, its placeholders intact and its map labels clear of each other. Live (staging): Chinese, Japanese and Korean each guided, told The Starry Night from the record and answered a spoken question word for word; the platform's filler before an answer stays English ("Well", "Oh", "But"). |
| The screens | A front door with Edmund and the way in (`page/Lobby.tsx`); the tour: camera, Edmund bottom right (tap ⤡ to move him aside), his words beside him, the visitor's under them, the work's card at the top, the microphone and "What is this?" at the bottom, "Type" for a quiet chat when the gallery is loud; the visit card when the call ends (`page/Visit.tsx`); the labels (`page/Sheet.tsx`). Styled in `page/meridian.css`. On a wider screen the tour keeps a phone's column. |

## The catalogue

The Meridian is invented. So that anyone can try it, its rooms hold eight famous
public-domain works (images in `exhibits/`, 900 px WebP from Wikimedia Commons),
and every record says where the original really hangs:

| Room | Works |
|---|---|
| Gallery 1, Renaissance | Mona Lisa (Leonardo), The Birth of Venus (Botticelli) |
| Gallery 2, Dutch Golden Age | Girl with a Pearl Earring (Vermeer), The Night Watch (Rembrandt) |
| Gallery 3, Romantic and Modern | Wanderer above the Sea of Fog (Friedrich), The Starry Night (van Gogh), The Kiss (Klimt) |
| Gallery 4, Japanese prints | The Great Wave off Kanagawa (Hokusai) |

A real museum swaps `engine/catalogue.ts` for its own collection (and its own
label codes: `meridian:<id>` works as well as the link).

## Keys and setup

- The host is Edmund Hale (`avatar.json`, avatar `fc4ee25c`), on the demo
  account. His voice sample was sped up 1.2× (long pauses trimmed): v2 voices
  are Fish clones that copy the sample's pace, and there is no speed setting.
- `GEMINI_API_KEY` for `/identify`. Without it the "What is this?" button and
  `identify_exhibit` say recognition is not answering, and labels still work.
- The camera and microphone need a secure page: `https://`, or `localhost` on
  the machine itself. To try it on a phone, use the deployed site, or a tunnel
  to your local server.

## Tests

`npx vitest run apps/museum-guide`: the catalogue's lookups by every name a
visitor uses, label codes (and what is not a label), what the app believes of the
model's answer, what Edmund and the guests are told (instructions within the
limit, naming every tool), the safety net's phrases, the floor plan, the keyer's
screen colour, and the tour page itself with both calls stood in for
(`page/App.test.tsx`): a work's entry opening on arrival, the hand-over and the
call-back, a session that ran out, a guest who cannot come, and End.

## Live run (staging, 2026-10-29)

Two runs in a phone-sized Chromium (iPhone 14 viewport) on staging. The camera
was a canvas showing gallery scenes (a wall; The Starry Night with its label;
the Great Wave, The Kiss); the microphone was silence with recorded questions played into it.

- **A label scanned**: the card showed "You are at The Starry Night" within a
  second, and Edmund told its story from the record (Saint-Rémy, the east-facing
  window before sunrise, the village from imagination, the cypress like a flame).
- **"What is this one?" (typed) at the Great Wave**: he called `identify_exhibit`
  2 s later; the frame was matched in 4.5 s; he named it and pointed at Mount
  Fuji in the hollow of the wave, from the record.
- **Spoken questions** were heard word for word. "Where can I find the Mona
  Lisa?" called `show_exhibit`: its card came up, and he said Gallery 1, the
  Renaissance room.
- **"What is this?" button at The Kiss**: matched in 3.0 s (high confidence).
- **Server-side matching, offline checks**: a tilted, cropped photo of the Great
  Wave and a painting on a wall were found (high), Edmund's own portrait was "not
  in the catalogue", a dark blurred frame was "unclear".

What is not solved:

1. **The facts-only rule is an instruction.** Asked "why is the mountain so
   small?", he gave an interpretation the record does not hold, with one fact
   from memory ("Japan's tallest peak"). Nothing in the API stops it.
2. **The first opening said two welcomes.** He greets by himself on arrival,
   and the app's opening event asked for another. The opening now only adds the
   how-to ("without greeting again"); the second run had one welcome and then the how-to.
3. **One call dropped after 3.5 minutes.** LiveKit lost the page's connection,
   and re-publishing the tracks after the full reconnect failed, so the room
   closed (the page showed the visit card, as it should). Seen once; not yet
   known whether it was staging's network or the camera track.
4. **Recognition takes 3 to 6 s** (14 s for a frame too dark to read), heard as
   the platform's filler before the answer. A label's code is instant.
5. **The phone needs https** for the camera: the deployed site, or a tunnel.
