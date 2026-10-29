# Crate: a radio booth where the avatar is the DJ

**Internal demo.** Nova hosts a one-listener radio show: she digs through Spotify, picks
records, puts them on, lines up what is next and talks the listener in and out of every
track. The music is Spotify's own embed on the page; Nova works it through app tools.

## How it works

```
 page (React)                               server (apps/dj-booth/server.ts)
 ┌───────────────────────────────┐          ┌───────────────────────────────┐
 │ Spotify embed (iFrame API)    │  /search │ Spotify Web API search        │
 │ the deck: on air, queue, crate│ ───────▶ │ (client credentials: the app  │
 │ answers Nova's tool calls     │          │  signs in, never the listener)│
 └──────┬────────────────▲───────┘          └───────────────────────────────┘
  state │ event    tool  │ atmee.tool
        ▼                │
 ┌───────────────────────┴───────┐
 │ Nova (Causeur, LiveKit room)  │  POST /v1/session with appTools
 └───────────────────────────────┘
```

- **The deck** (`engine/deck.ts`) is the page's: the latest search ("the crate"), the
  record on, paused or not, and the queue. Every change is sent as Nova's `state`
  (`deckState`), so "what is this song?" needs no tool.
- **The tools** (`engine/director.ts`), all `await`, answered by the page:

  | tool | what the page does | Nova hears |
  |---|---|---|
  | `search_tracks(query)` | POST `/api/apps/dj-booth/search`, shows the results as the crate | up to 8 numbered tracks |
  | `play_track(number, when)` | plays crate track *number* now, or queues it (`when: "next"`) | now playing / queued |
  | `pause_music`, `resume_music` | the embed's pause / resume | paused / back on |
  | `skip_track` | the next queued record, or silence | what is on now |

  Nova picks by **number** from the latest results, never by Spotify id: a spoken model
  copies a 22-character id badly, and a number it read a moment ago well.
- **Nova runs the show.** She opens with her own pick, keeps two records lined up and
  introduces each one as it starts (the song, the artist, one fact). The page drives this
  with `event`s from the embed's `playback_update`: a queued record that starts ("introduce
  it; the line is short, queue more"), a record about 8 s from its end with nothing queued
  ("queue the next now"), and a record that ended with nothing queued ("the booth is silent").
  Every tool result for a record that starts also says when the line is short.
- **Push to talk.** The listener talks by holding a button (or the space bar); the mic is
  muted the rest of the time, so the music playing in the room never reaches Nova as speech.
  Typed requests go through the chat box.
- **The listener's hands.** Tapping a crate record, Pause or Skip acts at once and tells
  Nova as an `event` (she cannot see the screen).

## Run it

Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `.env` (any app from
developer.spotify.com/dashboard; search needs no user scopes), then `npm run dev` and open
http://localhost:5190/apps/dj-booth/. Without them the server says so at start and Nova
tells the listener the crate is out of reach.

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

## Live run

Not yet run live: waiting on the Spotify keys (see Run it).
