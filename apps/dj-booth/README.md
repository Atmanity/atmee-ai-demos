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
- **The cues.** The embed's `playback_update` drives two `event`s: about 8 s before a record
  ends ("back-announce it, tease the next; nothing queued: queue one now"), and, when a
  record ends with nothing queued, "the booth is silent: play the next". A queued record
  starts by itself when the one before ends.
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
