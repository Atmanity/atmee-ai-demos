# Yonder

Dream up your next trip on a live map with Lumi, a friend who has been. Name
a country (or a city in one, or "you choose") and it lands on the map with its
outline. Ask what to eat there and three local dishes appear with their
photos; ask what is worth seeing around a street, a station or a square and
the sights come one at a time, each with a photo, a line from Wikipedia, a
distance and a maps link. Every country stays on your route, and the trip
downloads as notes at the end. Rebuilt from the `travel-guide` mini-app as a
standalone product on the Avatar API.

Open it at `/apps/travel-guide/`.

## How it works

| Part | Where |
|---|---|
| The trip: countries on the route, what each showed, the sights around a place | `engine/state.ts` and `engine/trip.ts` on the server, one trip per page (the lookups need a User-Agent, a request-a-second throttle and, for the news, a key a browser cannot hold) |
| The lookups | `engine/geo.ts`: Nominatim (countries, places); for sights, a Wikipedia GeoSearch ranked for a traveller (only articles with a lead photo; scored by article length, recent pageviews, a landmark's kind and distance; districts, stations, people and lists dropped), topped up from Overpass (plaques dropped, 14 s budget) only when Wikipedia knows fewer than three; Wikipedia summaries (photos, one line each); WorldNews (headlines, with a key). Dishes: the app's own model, or a built-in list (`engine/food.ts`) |
| Lumi's actions | Six `await` tools and one `notify` (`engine/director.ts`): `choose_destination(place)`, `show_food`, `show_news` (only with a news key), `explore_near(place)`, `next_sight`, `previous_sight`, and `remember_name(name)`. The page answers each `atmee.tool` call by asking the server (`engine/tools.ts`, one runner for tools and buttons), which acts and returns the words Lumi speaks from. Her first reply carries the board's real outcome. |
| Slow lookups | A tool still running 4 s before its timeout answers "still looking"; the outcome follows as an event when it lands. |
| Tool schemas and results | Lenient on purpose (no enums, closed objects, tight lengths or required fields): the platform refuses a call that does not fit before the page sees it. The app reads the arguments widely ("place", or "country", "city"…), and every result starts with the plain outcome ("Done:", "Not yet:", "Not found:") so the host's filler cannot pre-judge it. The opening never greets again: Lumi's own greeting already did. |
| Lumi's rules | The session's tool `instructions`: she reaches the map only through the tools, and never names a sight, dish, headline or distance a tool did not give her. |
| What Lumi sees | `state`: what is on the screen (the country, the dishes and headlines once shown, the sight and its facts, the route). Never the next sight, and never dishes or headlines before they are shown, so she has to call for them. |
| Buttons | Search, Surprise me, idea chips, the route, Eat / News / Wander, a place box, Use my location, next and previous, pins and map taps: they act at once and Lumi is told by an event. Switching a tab only moves the board; Lumi just gets the new state. |
| The safety net | `useToolNet` (kit) with `mustDo` (`engine/judge.ts`): when the user plainly asks for a country by name ("let's go to Portugal", "back to Japan"), the food, the news, or the next or previous sight, and Lumi does not call the tool within 7 s, the page does it and tells her. If the move was made meanwhile (by Lumi her own way, or a button), it stands down quietly; the sight moves also carry the sight they started from, so a late call cannot skip one. Exploring a place is left to Lumi (her reading of the place, and a slow lookup). |
| The screens | The front door (`page/Lobby.tsx`); the map with Lumi's tile in its corner and the place plate at its foot (`page/App.tsx`, `page/TravelMap.tsx`); the guidebook beside it (`page/Guidebook.tsx`); the trip and its notes (`page/Summary.tsx`, `page/notes.ts`), shown when the call ends. Styled in `page/yonder.css`. |

```
server.ts          trips, the lookups, the /tool and /act routes
engine/
  tools.ts         one runner for Lumi's tools and the buttons
  director.ts      Lumi's instructions, the tools, the live board, the result texts
  judge.ts         the name filter, the control check, the safety net's matcher
  trip.ts          the operations (from trip.py)
  state.ts         the trip and its snapshot (from state.py)
  geo.ts           the open-data fetchers and their tested parsers
  rings.ts         a country's outline, fitted to its main landmass (from staticmap.py)
  countries.ts     country names and aliases, continents, ideas, built-in dishes
  food.ts          the dish prompt and its checks
  messages.ts      the page's check on every snapshot
page/              App, Lobby, Guidebook, Summary, TravelMap (Leaflet), notes, outline, yonder.css
```

### Keys and settings (server `.env`)

| Variable | Without it |
|---|---|
| `GEMINI_API_KEY` | dish ideas come from a built-in list (30 countries; others get none) |
| `WORLDNEWS_API_KEY` | no news: no `show_news` tool, no News tab, and Lumi says there is no local news here |
| `TRAVEL_USER_AGENT` | a default contact string for Nominatim, Overpass and Wikipedia (set your own in production) |
| `TRAVEL_TILE_URL`, `TRAVEL_TILE_ATTRIBUTION` | OpenStreetMap's own tiles, whose usage policy suits light traffic |

## What the API could not do

Status after the live runs of 2026-10-23 on staging (below). **Seen**:
observed live. **Expected**: not observed yet.

1. **Tools are called when the host decides.** *Seen working.* Every step
   called the right tool once, 2.7 to 4.1 s after the words; "Which dishes
   did you show me?" was answered from the board with exactly the three on
   screen. The safety net (a country named plainly, the food, the news, the
   sight moves) was never needed.
2. **Slow open data against the 28 s ceiling.** *Seen*, and fixed in the app.
   Every Overpass mirror failed in both runs; `explore_near`'s first line came
   ~25 s after the words (51 s on the second run), and GeoSearch's nearest
   articles were obscure and photo-less (a "Júlio de Castilho memorial", an
   "S. Vicente artwork", shown as a letter). Sights now come from Wikipedia
   first, ranked for a traveller, in one fast request; Overpass only tops up,
   and a sight without a photo shows a designed card.
3. **A call the schema refuses never reaches the page.** *Expected* (seen in
   another app: the host then said the action had happened). The schemas are
   lenient and the app asks back for anything unusable.
4. **The filler while a tool runs** can pre-judge the result. *Expected.*
   Results lead with the outcome.
5. **The persona and the greeting belong to the avatar.** *Seen.* On the
   shared test avatar the host introduced herself as someone else; on Lumi's
   own host the greeting fits, so the opening no longer greets again.
6. **No per-session speech hints.** *Seen harmless:* "Alfama" was first
   captioned "Alfa Min"; the final transcript and the tool's place were right.
7. **The ~10 s check-in** can prod a user reading a sight. *Expected.*

Also seen: Lumi's flavour lines ("old wooden trams", "bamboo groves") are her
own, not the app's; harmless, and never a sight, a dish or a distance.

Fixed by tools, compared with the first port: Lumi no longer answers before
the map moves, no longer invents the next sight while the app fetches the
real one, and no longer promises news that never comes. "You choose" no
longer depends on the app reading a country out of her words: she picks and
calls the tool. Nothing is staged in her state any more.

## Tested

- `npx vitest run apps/travel-guide`: 350 tests. The engine's ported tests
  (geo parsers and failures, the mainland and outline rules, the state and
  trip rules, the name filter, the snapshot parsers, the strip's projection);
  the tools and instructions against the API limits, with and without a news
  source; the board never holding the next sight or unshown dishes; the sights ranked for a traveller (Alfama's castle,
  cathedral and miradouro first; no photo, a district or a station, out); the
  tool runner (any case, other field names and extra fields accepted, a city finding its country, a country on the route coming back with
  nothing refetched, food and news bringing the country's page back, a stale
  safety-net move doing nothing); the safety net's phrases; the guidebook,
  the trip summary and its notes rendered; and the page's wiring with the call
  faked (a tool call answered from the server, a button told to Lumi, the net
  acting when she forgets and standing down when it was done meanwhile, the
  trip on screen when the call ends).
- A server smoke run (2026-10-23, no model or news key) through the routes
  against the live free services: Portugal outlined with its built-in dishes
  and Wikipedia lines, "Alfama, Lisbon" explored (every Overpass mirror failed;
  GeoSearch gave eight sights), next and previous, a stale net move refused,
  "Portugal" from its sights back to its page, "Kyoto" placing Japan with the
  city, back to Portugal with nothing refetched, "somewhere in Asia" narrowing
  the ideas, Surprise me picking India.
- Live on staging (2026-10-23): a full run on the shared test avatar
  (`2cd3ec08`, session `98d5f1fd`) and a smoke pass on Lumi's own host
  (`99ab5a47`, session `772c15f6`): name, Portugal, its food, Alfama's sights,
  next and previous, "you choose", Kyoto, back to Portugal, a question about
  the screen, hang-up to the trip notes. The fixes since (ranked sights, the
  no-photo card, lenient schemas, outcome-first results, no second greeting)
  are not yet run live.
