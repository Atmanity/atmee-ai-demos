# The Meridian

A museum tour on the visitor's own phone. The rear camera fills the screen and
Edmund Hale, the museum's chairman, stands in it, keyed out of a green screen.
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
| Edmund on a green screen | His portrait was generated on a flat chroma-key green (about RGB 12, 151, 53), and the v2 render keeps it: over a 6 s clip the background drifted by at most 5 levels with a spread under 2. `page/chroma.ts` keys it in WebGL per video frame: distance from the screen's colour in CbCr (so light and shadow on the screen key alike), a soft band between "screen" and "him", green spill clamped out of his edges, and a fade where the frame cuts him off at the bottom and sides. The screen's colour is re-read once a second from the video's top corners (`estimateKey`), since the stream's encoding shifts it. His video plays in an element the visitor never sees; `page/Keyed.tsx` draws each new frame into a canvas over the camera. Without WebGL he shows unkeyed. |
| The camera | `page/camera.ts`: the rear camera (`facingMode: environment`), full screen. Its track is also given to the session (`useAvatar.start({ camera })`, a kit option this app added): `joinAvatar` publishes a copy as the user's `camera` track, and Causeur's vision shows Edmund its latest frame (at most 5 s old) when he answers. The page keeps its own track, so hanging up leaves the preview running. |
| Which work is it | Two ways, both ending in that work's catalogue record in Edmund's state. **A label's QR code**, read in the page every 300 ms with `jsqr` (`useLabelScanner`, `engine/labels.ts`); the same label held in view is not a new arrival for 90 s. **A camera frame** (the "What is this?" button, or Edmund's `identify_exhibit` tool): a 768 px JPEG goes to `/api/apps/museum-guide/identify`, where Gemini picks an id from the catalogue or "none" (`engine/identify.ts`). The app believes only a high or medium-confidence pick of a real id. |
| Edmund's tools | `identify_exhibit` (await, 20 s): the page looks through the camera and returns "Identified: <record>", "Not identified: the camera shows …, which is not one of the Meridian's works", or "Not identified: not clear enough". `show_exhibit(title)` (await, 8 s): puts a work's card on screen and returns its record and room. Lenient schemas; results lead with the outcome. |
| Where facts come from | `engine/catalogue.ts`: eight works, each with its title, artist, date, medium, room, where the original hangs, a short story, details to look for and a work to see next. His instructions (`engine/director.ts`): every fact about a work from its record, never memory; the camera image is for pointing ("see the tiny mountain in the hollow of the wave"), not for facts. |
| The safety net | `useToolNet` (kit): when the visitor asks "what is this?", "who painted that?" and Edmund has not called `identify_exhibit` within 7 s, the page looks and tells him. |
| Edmund's picture of the tour | `state` (about 2,000 of 3,858 characters): whether the camera is on, the work they are at with its whole record, what they have seen, and the floor plan. Arrivals (a label scanned, a work found by the button) are `event`s asking him to tell its story; a second scan of the same label only asks what they would like to know. |
| Push to talk | `page/PushToTalk.tsx`: the call joins with the microphone muted (`micMuted`), and it opens only while the mic button (or the space bar) is held, plus 0.4 s after it is let go so the last word is not cut. A gallery is never quiet; nothing around the visitor is heard unless they press. Live: speech played with the button up was not heard; the same speech held was heard word for word. |
| The museum map | `page/MuseumMap.tsx` over `engine/floorplan.ts`: the four rooms, a numbered pin per work along the suggested route (from the entrance through rooms 1 and 2, up into 3 and on to 4), a tick on every work seen (a label scanned, a work found by the camera, or ticked by hand), a ring where the visitor is now, and the works by room below. A pin or row opens the work's whole entry: picture, date, medium, where the original hangs, its story, what to look for, the next work on the route, "Mark as seen", and "Ask Edmund about it" (a typed turn) while the call is live. The header's Map chip counts the works seen; the visit card opens the same map. Label scanning pauses while the map is open. |
| Guests | `engine/guests.ts`: at two works the figure from the painting comes to life: the girl from *Girl with a Pearl Earring* (avatar `cb84bed4`, her portrait restyled from the painting itself) and the wanderer from *Wanderer above the Sea of Fog* (`2e7275e6`, an invented face: Friedrich never painted one). Each has a green-screen portrait, their own voice and a first-person persona, and gets their painting's record as state. Edmund offers them once he has told the story, and hands over with `introduce_guest` (or the visitor presses "Meet the girl"). The guest's session is a second `useAvatar` on `/api/apps/museum-guide/guest/<id>/…` (the server starts it on the guest's avatar, with the guest's one tool, `call_host_back`). Edmund stays on the line, muted and out of sight, so "Call Edmund back" (or asking the guest for him) brings him back at once with no second greeting, told whom the visitor met; then the guest's session ends. Live, a restarted session took 18 s and opened with his greeting from scratch; that is now only the fallback when his session has ended meanwhile. Only figures who are not real, identifiable people: the artists, and named sitters such as Lisa Gherardini, would need a real person's likeness, which the portrait tools are not for. |
| A work's entry | `page/WorkInfo.tsx`: when a work is introduced (a label, the camera, Edmund identifying it), its whole entry opens over the camera, with "Back to camera" at the bottom; the panel stays under it, so his words and the mic still work. "You are at …" in the panel opens it again. A work with a guest shows "Meet …" there. Label scanning pauses while it is open. |
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
  account. A replacement host needs the same: a portrait on a flat green screen,
  nothing green on the person.
- `GEMINI_API_KEY` for `/identify`. Without it the "What is this?" button and
  `identify_exhibit` say recognition is not answering, and labels still work.
- The camera and microphone need a secure page: `https://`, or `localhost` on
  the machine itself. To try it on a phone, use the deployed site, or a tunnel
  to your local server.

## Tests

`npx vitest run apps/museum-guide`: the catalogue's lookups by every name a
visitor uses, label codes (and what is not a label), what the app believes of the
model's answer, what Edmund is told, and the keyer's screen colour.

## Live run (staging, 2026-10-29)

Two runs in a phone-sized Chromium (iPhone 14 viewport) on staging. The camera
was a canvas showing gallery scenes (a wall; The Starry Night with its label;
the Great Wave, The Kiss); the microphone was silence with recorded questions played into it.

- **Edmund in the camera view**: keyed cleanly, no green left at his edges, and
  stays keyed as the stream plays.
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
