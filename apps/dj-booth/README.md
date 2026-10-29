# Crate: a radio booth where the avatar is the DJ

**Internal demo.** Nova hosts a one-listener radio show: she digs through Spotify, picks
records, puts them on, lines up what is next and talks the listener in and out of every
track. The music is Spotify's own embed on the page; Nova works it through app tools.

## How it works

```
 page (React)                               server (apps/dj-booth/server.ts)
 ┌───────────────────────────────┐ /search  ┌───────────────────────────────┐
 │ player: Spotify Premium via   │ ───────▶ │ Spotify Web API search        │
 │  the Web Playback SDK, else   │ /theme   │ (client credentials)          │
 │  the embed's previews         │ ───────▶ │ Gemini: the record's look     │
 │ the deck, the radio clock,    │          │ from its title and cover      │
 │ the stage, the mixer          │          └───────────────────────────────┘
 └──────┬────────────────▲───────┘
  state │ event    tool  │ atmee.tool
        ▼                │
 ┌───────────────────────┴───────┐
 │ Nova (Causeur, LiveKit room)  │  POST /v1/session with appTools
 └───────────────────────────────┘
```

- **Radio, not a chatbot.** Nova talks between records. About 10 s before a record ends,
  the booth calls her break (`event`): the music ducks under her, she back-announces the
  record and tells the story of the next (artist, song, era, a detail to listen for), and the
  next record waits until she has finished (`engine/booth.ts`). She keeps two records lined
  up and opens the show with her own pick.
- **Change-overs.** A request, a skip or a tap in the crate fades the record on out, Nova
  introduces the new one, and it fades in when she finishes.
- **Quiet over the music.** Causeur checks in after ~10 s of silence and a session cannot
  turn that off; over a playing record, anything Nova says unasked (not in a break, not an
  answer within 40 s of the listener) plays silent: no voice, no overlay, no dip (`heard`).
- **The tools** (all `await`, answered by the page): `search_tracks(query)` (numbered results
  into the crate), `play_track(number, when)`, `play_request(query, when)` (a listener's
  request in one step: search and play the best match), `pause_music`, `resume_music`,
  `skip_track`. Nova picks by number, never by Spotify id. The page refuses a record already
  on or in line, and a second "now" within 20 s of the last goes in line unless the listener
  asked for something since (`nowBecomesNext`): the opener is never cut off.
- **The look follows the record.** For each record the server asks Gemini, with the cover
  attached, for a palette, a display face, a backdrop (aurora, bokeh, pulse, grain) and a
  mood; `engine/theme.ts` validates it (dark page, WCAG contrast for text and accent, known
  fonts). Registered CSS properties fade every colour as the record changes.
- **The stage** shows the cover while music plays. When Nova talks over a record she appears
  as a small round overlay on it; her face fills the stage only when no music plays.
- **Push to talk.** The mic joins muted (`start({ micMuted })`) and opens only while the
  button or the space bar is held, so the music never reaches Nova as speech.
- **The mixer.** Nova's volume always; the music's only with Premium (Spotify's embed is
  another site's frame, whose volume no page can set).

## Run it

Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `.env`, then `npm run dev` (Node 22.9+)
and open http://127.0.0.1:5190/apps/dj-booth/. For whole tracks and a music volume, connect
Spotify Premium on the start page; the Spotify app needs that page's address as a Redirect URI
(`http://127.0.0.1:<port>/apps/dj-booth/`, and the deployed site's) and, while it is in
development mode, the listener's Spotify account under User Management. Without Premium the
booth plays 30-second previews through the embed.

The host is `apps/dj-booth/avatar.json` (staging avatar `4ce5be14…`, made 2026-10-29 from a
generated portrait and a designed voice).

## Limitations

- **Nova's face can only be steered, not set.** Her listening face is mapped from the
  session's emotion, which Causeur's judge estimates from the conversation; nothing in the
  room protocol or `POST /v1/session` sets it. The instructions ask her to match each
  record's energy as she introduces it (hyped for dance, mellow for soul), which moves the
  estimate and so the face. Causeur's `avatar2` module would do this properly (it writes the
  avatar's body language as text prompts from the conversation, refreshed every ~10 s), but
  it is enabled only on the Live API, not on `POST /v1/session`. *Platform gap:* a way for the
  app to set the avatar's mood or listening expression (a room message, or `avatar2` on full-stack
  sessions).
- **Check-ins.** Causeur speaks up after about 10 s of silence and that cannot be turned off
  per session; over a playing record that means extra DJ chatter. The instructions keep it short.
- **Previews.** The embed plays whole tracks only for a listener signed in to Spotify in the
  same browser; otherwise 30-second previews. Spotify developers also report that
  `play()` from code can start a preview even for a signed-in Premium listener. For the demo
  the short previews are a feature: a DJ break every 30 seconds.
- **No ducking.** The embed has no volume control, so Nova talks over the music at full level
  (or pauses it). The Web Playback SDK has volume, but needs Premium and a Spotify login per
  listener.
- **Nova never hears the music.** It mixes in the listener's browser; she knows a record only
  from the deck the page sends.
- **Not shippable as-is.** Spotify's Developer Policy forbids syncing recordings with visual
  media and overlapping Spotify content with other audio. A talking avatar over Spotify
  tracks is fine for an internal demo, not for a public product; a public version needs
  licensed music the app plays itself.
- Spotify's iFrame `play()` right after `loadUri` is sometimes dropped; the page tries once
  more if a record has not started after 2.5 s.

## Live runs (staging, 2026-10-29)

Driven in headless Chrome with a fake microphone playing a spoken request, previews only
(headless Chrome has no Widevine, so the Premium player is untested).

- Nova opens by herself, keeps two records lined up and introduces each in her break:
  "Thomas Bangalter of Daft Punk and Alan Braxe built it around a Chaka Khan guitar sample…
  Listen for that filtered guitar".
- The next record waits for her to finish (an ended record held 38 s until her intro ended).
- Push to talk: "Hey Nova, can you play some disco next?" was heard and answered.
- Unprompted check-ins over a record play silent (three in one run, logged by the page).
- The look changed with each record ("smoky lounge elegance" in Playfair Display,
  "interstellar disco euphoria" in Righteous, …); no sideways scroll at phone width.
- Not yet seen live: `play_request` and the change-over fade (the demo key hit its spend cap).
