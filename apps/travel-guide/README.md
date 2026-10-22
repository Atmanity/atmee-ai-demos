# Travel Guide

Plan a trip on a live map, or find what is worth seeing near you, with a
well-travelled friend. Name a country (say it, type it, pick an idea, tap the
map, or let the guide choose) and it is outlined on an OpenStreetMap map, with
its latest local headlines and three dishes ready to show. Say where you are
("I'm near Shibuya station", "use my location", or a tap on the map) and the
nearby spots come one at a time, each with a photo, a sentence from
Wikipedia, a distance and a maps link. Every country stays on the trip strip,
and going back to one costs nothing.

Ported from `Atmanity/apps/apps/travel-guide` (a Python LiveKit agent with
eight tools plus a React panel in a sandboxed iframe) onto the Avatar API.

```
server.ts          the trip per session, the lookups, and the act route that judges what was said
engine/
  geo.ts           Nominatim, Overpass (+ mirrors), Wikipedia, WorldNews: thin fetchers + tested parsers
  rings.ts         a country's outline, fitted to its main landmass (from the original staticmap.py)
  state.ts         the trip: countries visited, the spot queue, what is shown (from state.py)
  trip.ts          the operations, one path for buttons, typing and speech (from trip.py)
  countries.ts     country names and aliases, continents, ideas, built-in dishes
  food.ts          the dish prompt and its checks
  judge.ts         words to board actions: rules first, the app's own model for the rest
  director.ts      NOTES, the state text, the event texts (the original's tool cues)
  messages.ts      the page's check on every snapshot (from the panel's messages.ts)
page/              App.tsx (kit wiring), Board.tsx (from AppPanel.tsx), TravelMap.tsx (Leaflet), outline.ts
```

## How it works on the API

| Feature | Mechanism |
|---|---|
| The trip (countries, spots, what is shown) | `engine/state.ts` on the server, one per page; the page polls a snapshot while anything loads in the background |
| Lookups (country outline, places, nearby spots, photos, headlines) | `server.ts` with `engine/geo.ts`: Nominatim needs a User-Agent and one request a second, so it cannot run in a browser |
| The map | Leaflet with OpenStreetMap tiles (attributed); the country's outline drawn over them and fitted to its main landmass (Norway without Svalbard, France without Polynesia) |
| Choosing a country | destination box ("Kyoto, Japan", "Bali"), idea chips, "Surprise me", a tap ("Plan a trip here"), typing, or speech through `engine/judge.ts` |
| "You choose", said out loud | the app reads the guide's own next lines for exactly one country and puts it on the map |
| Headlines and dishes | fetched as soon as the country is chosen and **staged** in `state` ("only if they ask"); shown on the board by a button, a typed line or a judged spoken request ("what should I eat?", or "yes please" to the guide's offer) |
| Around them | place box, "Use my location" (`navigator.geolocation`; the original's sealed seam is now a button), a tap ("What's around here?"), or speech |
| Next / previous spot, a pin | buttons, pins on the map, "another one" / "the one before" |
| The current spot's facts | in `state` (name, kind, distance, a Wikipedia sentence); the next spot's narration goes as an `event` |
| Going back | trip-strip chips, "back to Japan", "the first one" |
| Name | "my name is…", a bare name right after the guide asked, or the welcome card's field; shown as "Hello Sam" |
| The guide's rules | two standing `note`s (`engine/director.ts`, condensed from the original INSTRUCTIONS) |
| Outcomes the guide could not know | `event`s, worded from the original tool cues; none for what it already answered from `state` |
| Typed lines | judged first; a board action is recorded and acted on (its event quotes the line, so a question in it still gets answered); anything else goes to the guide as a typed turn |
| Before the guide arrives | the board already works; the guide's opening event is written from the board as it finds it |

### Keys and settings (server `.env`)

| Variable | Without it |
|---|---|
| `GEMINI_API_KEY` | dish ideas come from a built-in list (30 countries; others get none) and only the rules read speech (no model fallback for unusual phrasings) |
| `WORLDNEWS_API_KEY` | no headlines: the board says no news source is set up, and the guide offers the food instead. **Assumed absent here.** |
| `TRAVEL_USER_AGENT` | a default contact string for Nominatim/Overpass/Wikipedia (set your own in production) |
| `TRAVEL_TILE_URL`, `TRAVEL_TILE_ATTRIBUTION` | OpenStreetMap's own tiles, whose usage policy suits a demo, not heavy traffic |

## What the API could not do

Status after the live run of 2026-10-23 (below): **seen** = observed live,
**expected** = not yet observed.

1. **The guide answers a spoken request before the board moves.** The old
   model called `set_destination` and spoke from its result with the map
   already up. Now the guide replies first ("Portugal, lovely!") and the map
   lands a beat later with an event (prefixed "you may already have answered
   them; do not repeat yourself"). Expect a second, shorter comment, or the
   event waiting behind the guide's own turn. Same for "I'm near Shibuya
   station" and "another one": the guide says a holding line, the spot comes
   as an event. *Seen.* Live, "Another one, please" got the guide's own
   invention ("Just a quick step away is Miyashita Park, a vibrant open-air
   rooftop park…"), then the app's real next spot, a different place. And
   "Any news from there?" got "Let me pull that up for you right now!" with
   nothing after it: the "no news source" answer was staged, so the app sent
   no event. A spoken news request now always gets its outcome as an event.
2. **The guide choosing a country works only through its own words.** "You
   choose" makes the app read the guide's next two lines (45 s) for exactly one
   country. A paraphrase ("somewhere with great tapas") or a question back
   gives the app nothing to draw; the user can press "Surprise me".
   *Seen working*: "Somewhere else. You choose!" got "Let's go to Portugal!"
   and the map drew Portugal.
3. **The original's rhythm (map, then offer the news, then the food, one tool
   per turn) is now staging.** Headlines and dishes are fetched at once and
   staged in `state`; the guide answers from them when asked, and the board
   shows them when the app recognises the request. A spoken request the judge
   misses leaves the guide talking about dishes the board still hides behind
   its button. *Expected* (live, "What should I eat there?" was answered with
   dishes, okonomiyaki first; that they were the staged ones was not checked).
4. **Rules that lived at the decision point are notes now.** "Never promise
   the headlines as fresh" was on the news tool; "you cannot see where they
   are" was next to the location tool. Both are standing notes and the
   persona's guardrails, nothing more. *Expected.*
5. **The persona is the avatar's.** The original ran as whichever avatar was
   bound, with its rules layered on top; the shared test avatar greets as
   itself before the app's opening. Lumi (`avatar.json`) needs a dedicated
   avatar. *Seen* (the lighthouse keeper: "Aye, gladly!", "Sure thing,
   skipper!"; once it offered to "jump back to our Portugal plans" while the
   map was on Japan).
6. **No per-session speech hints.** The original biased the recogniser toward
   travel words (continents, "itinerary"); through the API rare place names
   rely on the recogniser alone. *Expected* ("Shibuya station" was heard
   right).
7. **The ~10 s check-in** can prod a user who is reading the map or a spot.
   *Seen* ("Still looking around, or shall we pick a country to…").

## What changed from the original, and what did not come across

- The map: the original panel could not load a tile (sandboxed iframe), so the
  agent fetched a static map image and stored it, with an outline drawn in the
  panel as the fallback. This page draws real tiles with Leaflet; the outline
  is drawn over them. `staticmap.py`'s image half (zoom fitting, endpoint
  template, storage mirroring, `media.py`) is gone with its tests; the
  mainland and outline logic is `engine/rings.ts`, tests ported. The panel's
  SVG projection (`outline.ts`) now draws the trip strip's silhouettes.
- Photos are linked from Wikimedia directly (the panel had no network, so the
  agent mirrored them into storage). A spot only takes a Wikipedia photo and
  sentence when the article's coordinates are within 5 km of it (a "Central
  Station" otherwise finds the generic article).
- Headlines and dishes are fetched as soon as the country is chosen (dishes by
  the app's own model, not the conversation model) and staged; see gap 3.
- `test_rpc.py` and `test_the_worst_board_fits.py` (the RPC surface and the
  32 KiB envelope cap) have no counterpart; the coordinate checks from
  `travel.share_location` are kept. The panel's `merge.ts` (a sync reply racing
  live envelopes) became a sequence number on every snapshot.
- New: the destination box, idea chips, "Surprise me", map taps, map pins,
  "Use my location", a name field, and the guide's own pick read from its words.
- No conductor: the app drives the conversation with events.

## Tested

- `npx vitest run apps/travel-guide`: 317 tests. Ported: the geo parsers and
  failure handling, the mainland/outline rules, the state and trip rules (the
  trip that used to evaporate, Niger/Nigeria, overlapping next-spot taps, the
  photo fetched once, "never today's"), the name filter, and the panel's
  parsers and projection. New: the judge on real phrasings, the director's
  limits and event policy, the staged detail, the guide's own pick, and the
  board's controls (rendered, with the map stubbed).
- A server smoke run against the live free services (no model key): Norway
  fitted to its mainland with built-in dishes and Wikipedia photos, "Kyoto,
  Japan" from the box, "back to Norway" restored with nothing refetched, a
  spoken "I'm near Shibuya station" answered from Wikipedia GeoSearch when
  every Overpass mirror was unreachable, "another one", and a map tap near
  Lisbon planning Portugal.
- Live on staging: one run, below.

### Live run (staging, avatar `26cbe079`, 2026-10-23)

Spoken lines through `tools/live-test/harness.js`:

- "My name is Sam." → "Hello Sam" on the board, no event.
- "I'm dreaming of Japan." → Japan outlined, then the event ("The autumn air in
  Kyoto…"), offering the food.
- "Somewhere else. You choose!" → the guide picked Portugal; the map followed.
  "Actually, take me back to Japan." → Japan restored.
- "I'm near Shibuya station." → every Overpass mirror failed (502 or
  unreachable); Wikipedia GeoSearch gave the spots. First spot by event.
  "Another one, please." → an invented spot, then the real one (gap 1).
- "Any news from there?" → a promise and no answer (gap 1, fixed).
- Typed "How about Bali?" → Indonesia, with an event about Bali.
- Session `completed`, `ended_by_api`, 313 s billed. The free spot sources
  are the weak part: GeoSearch offered a local news office as a sight.
