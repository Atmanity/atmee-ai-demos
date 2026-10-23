# Lodestar

A night-sky chart for anywhere on Earth, with a stargazing guide. Pick a city
(or type coordinates) and a night between 1900 and 2100; Mira tells you what is
up, where to look and what each star is, and moves the chart for you: "where's
Vega?", "show me Orion", "the sky from Lisbon at midnight", "two hours later".
Everything she says about the sky is what the chart worked out from its
catalogue of 135 naked-eye stars and 18 constellation figures; she never
answers from memory. What you looked at becomes your night's list, to download
and take outside. Rebuilt from the `sky-guide` mini-app as a standalone product
on the Avatar API.

Open it at `/apps/sky-guide/`. It opens on the city in your browser's time
zone (else one on the same clock, else Taipei); `?place=Lisbon` opens it
somewhere else.

## How it works

| Part | Where |
|---|---|
| The sky: sidereal time, altitude and azimuth, rising and setting, 41 places | `engine/sky.ts`, `engine/chart.ts` (one `SkyChart`: validate before mutate, refuse by name, drop what sets), `engine/catalog.ts`. All in the page: the sky is public and the maths is pure, so the chart on screen, Mira's picture of it and every tool result come from the same object. |
| Mira's actions | Four tools (`engine/director.ts`): `point_out(star)`, `show_constellation(name)` and `move_chart(place?, time?)` are `await` (10 to 15 s); `clear_chart(what)` is `notify`. The page answers each `atmee.tool` call with `engine/actions.ts`, which moves the chart and returns what it computed; her first reply carries it ("Vega is marked, high up in the north-east…", "Orion isn't up yet: it rises about half past 2; it's well up by quarter past 3"). |
| Reading what Mira heard | The tools take her words ("the north star", "beetle juice", "40.7 north 74 west", "December 21st", "two hours later"); `engine/judge.ts` reads them by rules over the catalogue's own names. A model (`server.ts`, Gemini) only for words the rules cannot place; the chart still validates its answer. |
| Mira's rules | The tool `instructions`: the screen changes only when she calls a tool; never say what is up, where or when before a result; facts about a star only from the catalogue; no Sun, Moon or planets; no degrees out loud; offers acted on only when asked. |
| What Mira sees | `state` (worst case 3,521 of 3,858 characters, measured over every place, hour and season): the place and hour, every star up grouped by where to look, the figures up (with where) and down (with when they rise), the drawn figure, the marked star and its catalogue lines. She answers "what's up in the south?" from it without a tool. |
| The chart's controls | Tap a star, the place picker, the night strip (noon to noon), an hour either way, Tonight / Midnight / Before dawn, a date, a button per figure. They act at once; Mira is told by an event, coalesced (`engine/narrator.ts`) so a drag across the night is one line. A refusal is shown on the chart and told at once. |
| "Show it then" | A refused star or figure that rises gets a one-tap "Show the sky at 3:15 am" (`engine/later.ts`: the first dark quarter hour it is well up), which moves the clock and draws it. Mira offers the same hour out loud and moves the clock only if asked. |
| A new place keeps the hour | "The sky from Lisbon" while the chart shows Taipei at 9 pm is Lisbon at 9 pm that night (`engine/guide.ts`), not the same instant (Lisbon at 1 pm), unless a time is asked for too. |
| The safety net | `useToolNet` (kit) with `engine/net.ts`: when the user clearly asks for a move that is safe to make twice (a named place, an absolute time, a constellation with "show" or "draw", a clear) and Mira does not call the tool within 7 s, the page makes the call and tells her. Never a relative move ("two hours later" twice is four hours) and never a star ("where's Vega?" is often answered rightly from `state`). |
| Your night | `engine/night.ts`: every star marked and figure drawn, with where to look from that place and hour. A tab beside the chart during the call; when the call ends, a card with a download (plain text). |
| The screens | A front door with tonight's real sky over your city (`page/Lobby.tsx`), the chart with Mira beside it (`page/Chart.tsx`, `page/SkyDome.tsx`), the night card (`page/NightCard.tsx`), styled in `page/lodestar.css`. Red light turns the whole app, the chart and Mira's picture torch-red for dark-adapted eyes. On a phone Mira rides along at the top while you scroll the sky. |

## Keys

- `GEMINI_API_KEY` (optional): `/interpret` reads words the rules cannot place
  ("Alpha Orionis", odd phrasings of a date). Without it the rules handle every
  phrasing in `judge.test.ts`, and an unknown name is refused by name ("I don't
  have Zorblax in the catalogue").
- No other keys, and no network: the catalogue and the maths are in the bundle.

## What the API could not do

Status before this rebuild's live run. **Seen**: observed live (in the first
port, where noted). **Expected**: not observed yet.

1. **Tools are called when the host decides.** *Expected.* Mira may narrate a
   move ("let's look at midnight!") without calling `move_chart`, or answer
   "where's Vega?" from the chart in her context without `point_out` (right,
   but nothing is marked). The safety net makes the safe moves after 7 s; a
   star asked about is left to her, since she will usually have said where it is.
2. **The facts-only rule is only an instruction.** *Expected.* Nothing gates the
   model's memory, and a result is paraphrased: "eight and a half light years"
   may drift. The catalogue's lines are on screen beside the chart as the source
   of truth. In the first port the facts said live were the catalogue's.
3. **No speech hints for star names.** *Seen in the first port*: "Betelgeuse"
   arrived as "Beetlejuice". The tools take the words the host passes and the
   app maps known mishearings; one not in the table reaches the model reader
   (with a key) or is refused by name.
4. **The ~10 s check-in talks over the stargazing.** *Expected.* The original
   had no idle nudge at all; the API's cannot be turned off or lengthened.
5. **The persona and the greeting belong to the avatar.** *Seen in the first
   port* ("I'm Emily, a 21-year-old college student…" before the chart's
   opening). `avatar.json` is the host this product was designed for; the
   opening event names the place and hour once she has greeted.

Fixed by tools, compared with the first port: the host no longer answers a
move before the app has made it ("let's have a look", then the sky a beat
later), and no answer is said twice (once from the staged state, once from the
event). Every outcome (marked, drawn, moved, refused, when it rises) is in her
first reply.

## Tested

- `npx vitest run apps/sky-guide`: 304 tests. The engine as ported (the
  closed-form astronomy, the catalogue, the chart's refusals and settling, the
  judge's phrasings, the narrator, the projection); the tools against the API
  limits and the instructions naming each; the state's worst case; every tool's
  outcome and wording (`actions.test.ts`); the safety net's phrases and that its
  calls are safe to repeat; "when is it up"; the night list and its file; the
  chart's screen (taps, the keyboard list, the strip, the picker, the figures,
  refusals); and the app's screens with the call stood in for (front door,
  tool calls moving the screen, a control told to the host, the night card).
- `npx tsc --noEmit`: clean for this app.
- Live: not yet run.
