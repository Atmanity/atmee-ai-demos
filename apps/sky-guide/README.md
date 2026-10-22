# Sky Guide

A chart of the sky above the horizon from one place at one held instant, and a
guide standing next to you naming it: 135 naked-eye stars, 18 joined-up
figures, and catalogue facts for the notable ones. Tap a star (or ask "where's
Vega?"), light a constellation ("show me Orion"), move the place ("the sky from
Lisbon", or the picker) and the clock ("show me midnight", "two hours later",
the steppers, the scrubber across the night, or a date). Start the chart
somewhere else with `?place=Lisbon`.

Ported from `Atmanity/apps/apps/sky-guide` (a Python LiveKit agent with five
tools, a narrator and a canvas panel) onto the Avatar API, following
`apps/guess-the-city` (see `docs/PORTING.md`).

## Where things are

| File | What |
|---|---|
| `engine/sky.ts` | The astronomy, ported formula for formula: sidereal time, RA/Dec to altitude and azimuth, rising and setting, 41 places with standard-time offsets, clock words |
| `engine/catalog.ts` | The content, ported row for row: 135 stars, 42 constellation names, 18 figures, 40 stars' facts, the finders |
| `engine/chart.ts` | `SkyChart`, the original's rules object: validate before mutate, refuse by name with when it rises, drop what sets |
| `engine/guide.ts` | Intents onto the chart, and who tells the avatar what (the original's reducer, tool cues and narrator claims) |
| `engine/judge.ts` | Typed and spoken words to intents, by rules over the catalogue's own names; the model's schema for the rest |
| `engine/director.ts` | The notes, the state builder and the event texts |
| `engine/narrator.ts` | One line per change made with the chart's controls, coalesced |
| `page/SkyDome.tsx`, `page/projection.ts` | The original canvas and its drawing arithmetic, unchanged (east on the left: you are looking up) |
| `page/SkyGuide.tsx` | The original panel, now with a place picker, a time control and constellation buttons |
| `server.ts` | One route, `POST /interpret`: a model reading of a command the rules could not place |

**The engine runs in the page.** Nothing in it is secret (the sky is public),
it is pure arithmetic over a static catalogue, and keeping it next to the
drawing keeps the original's one-sky rule: the chart on screen, the avatar's
state and every event are projections of the same `SkyChart`, so the guide can
never describe a sky the user is not looking at. The server holds only the
optional model call, because that needs the key.

## How it maps to the API

| Feature (original) | Mechanism here |
|---|---|
| The guide's persona and the one hard rule (facts only from the catalogue) | Two rule `note`s (`director.ts`); the persona the app assumed is in `avatar.json` (the original gave a job, never a name; the notes still tell the avatar to keep its own) |
| The catalogue's facts | Three more `note`s, all 40 stars' lines word for word, so "tell me about Vega" is answered from the catalogue at once |
| `[Live sky]` system note | `state` (at most 3,858 characters, worst case measured at about 3,550): place, hour in words, every star that is up grouped by where to look, the brightest six, which figures are up (with where to look) and which are down (with when they rise), the lit figure, the marked star with its fact verbatim |
| `look_from` / `look_at_time` / `point_out` / `show_constellation` tools | `judge.ts` rules over the catalogue's names (stars and common names, constellations and aliases, 41 places and coordinates, presets, clock hours, shifts, months, seasons), then `guide.ts`; a model (`server.ts`, Gemini) only for a command naming something the rules cannot place, and the chart validates what it returns |
| `whats_that` | No app action: the marked star's fact is in the state, so the avatar answers "tell me about it" itself |
| Tool cues and refusals ("Orion isn't up at this hour — it rises about half past 2") | `event`s: the risen/gone diff for a clock or place move, the fact for a star, the anchor star's direction for a figure, the refusal sentence (also shown on the chart) |
| Narrator for panel taps, with `claim(seq)` so nothing is said twice | `Narrator`: control changes coalesced into one event 1.2 s after the last; a typed or spoken request flushes it and carries its own event |
| Panel: tap, ±1h, Tonight, Clear | The same, plus Midnight, Before dawn, a scrubber across the night, a date, a place picker with coordinates, and a button per figure |
| Greeting naming the place and hour | The avatar greets as itself; the app's opening `event` names the place, the hour and the brightest stars |
| Deepgram keyterms for star names | Known mishearings mapped app-side ("beetle juice" is Betelgeuse; "serious" is Sirius only inside a command) |

**Spoken requests and staging.** The avatar starts its reply before the app
hears the words. So the state stages the predictable answers (every star that
is up and where; every figure, up with where to look or down with when it
rises), and the notes stage the facts. A spoken request the state could answer
(a star or figure that was up, said by its name) gets no second telling: the
chart just marks it. Everything the state could not answer is told as an
event: another place or hour, a refusal (always, even at the cost of "as I
said"), a star with only its catalogue row, a name the app mapped from a
mishearing. Typed lines are judged first: a chart request is recorded and told;
anything else goes to the avatar as a typed turn.

## Keys

- `GEMINI_API_KEY` (optional): `/interpret` reads commands the rules cannot
  place ("show me the sky in late March", odd phrasings). Without it the rules
  still handle every phrasing in `judge.test.ts`, and an unplaceable name is
  refused by name ("I don't have Zorblax in the catalogue").
- No other keys, and no network: the catalogue and the maths are in the bundle.

## What the API could not do

Status after the live run of 2026-10-23 (below): **seen** = observed live,
**expected** = not yet observed.

1. **The avatar answers a spoken request before the app can act** — seen,
   and staging made the first reply right. "Show me Orion" is answered from the avatar's own reply; the
   app's refusal ("isn't up at this hour — it rises about…") follows as an
   event. Staging the figures' standing in `state` should make the first reply
   right; if the model answers from memory anyway ("Orion's in the south"), the
   refusal event corrects it a beat later, and the chart shows the refusal line.
   A move to another place or hour cannot be staged: expect a holding line,
   then the event. The original's tools returned the outcome inside the reply.
   Live: "Show me Orion" got "Orion isn't up quite yet, but it'll rise low in
   the east at about quarter past nine" from the staged state, then the
   refusal event said it again. Every place and hour move got "let's have a
   look", then the event.
2. **The facts-only rule is only an instruction** — expected (the facts
   live were the catalogue's). Nothing
   gates the avatar's memory, and events are paraphrased: "eight and a half
   light years" may drift. The fact panel on the chart is the source of truth.
3. **No speech hints** — seen. "Betelgeuse" arrived as "Beetlejuice"; the
   mishearing table caught it and the star was marked. Star names are misheard ("beetle
   juice"). The app maps known mishearings and then tells the avatar (it heard
   the same garbled words); a mishearing not in the list reaches neither.
4. **The ~10 s check-in talks over the stargazing** — expected (none in one
   run with steady questions). The
   original deliberately had no idle nudge at all; the API's cannot be turned
   off or lengthened.
5. **No per-session greeting** — seen ("I'm Emily, a 21-year-old college
   student…", then the app's "sky over Taipei at about nine in the evening"). The original greeted with
   the place and hour; here the avatar greets as itself first and the app's
   opening event follows.
6. **Staged answers are not checked** — expected (design; live, "Where's
   Vega?" was answered right from the state: "about halfway up in the
   north-west"). A spoken "where's
   Vega?" sends no event; if the avatar ignored the state, only the chart
   (which marks Vega and prints "high up in the north-west") corrects it.

## Not ported, or changed

- The platform plumbing (StateStore, wire, envelopes, RPCs, `useAppState`):
  the chart is a local object. The original's 32 KiB envelope test became the
  state-size test.
- Two small fixes: the spoken hour says "midnight" and "noon" (it said "about
  12 in the morning"), and constellation names match without accents
  ("Bootes").
- Unchanged on purpose: a new place keeps the instant (Taipei at 8 pm is
  Lisbon at noon; the chart now says when it is daytime there), the clock does
  not tick, no refraction, no daylight saving, no Sun, Moon or planets.

## Tested

- `npx vitest run apps/sky-guide`: 225 tests. Ported: the closed-form astronomy
  (`test_sky.py`: IAU sidereal value, transit altitude, Polaris at the
  latitude, rise round trip), the catalogue's consistency (`test_catalog.py`),
  the chart's refusals and settling (`test_chart.py`), the cue and narrator
  rules (`test_table.py`), `projection.test.ts` and the panel test. New: the
  judge's phrasings, the staging rules, the state's limits (every place, every
  hour, four seasons), the narrator's coalescing, the new controls.
- Live: not yet run (the reviewer runs it).

## Live run (staging, avatar `baf61f2c`, 2026-10-23)

Spoken lines through `tools/live-test/harness.js`, Taipei at 9 pm on 23 Oct:

- "Show me Orion." → not up yet, rises about quarter past nine (gap 1).
- "Where's Vega?" → "halfway up in the north-west", no event.
- "Show me the sky from Lisbon." → the same instant, 1 pm there, with the
  daytime hint; the event named Arcturus and Vega.
- "Back to tonight." → Lisbon 9 pm on 22 Oct (the real evening there at the
  time of the run). "Show me midnight." → newly up Rigel, Procyon,
  Betelgeuse.
- "Where is Betelgeuse?" (heard "Beetlejuice") → marked low in the east, with
  its fact. "Where is Jupiter?" → "I don't do planets". "Show me the sky from
  Kyoto." → "doesn't recognise Kyoto, try a city or a latitude and longitude".
- Typed "the sky from Sydney at midnight" → one event: Sirius, Canopus.
- Session `completed`, `ended_by_api`, 211 s billed.
