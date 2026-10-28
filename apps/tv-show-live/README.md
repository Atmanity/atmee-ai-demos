# The Gilded Reel: a late-night show on the art of film, on speech-to-speech

Jada Monroe hosts a late-night show about how films are designed and made. She introduces tonight's
film, rolls its trailer, then invites its costume and production designer onto the screen in the
studio wall; the two talk craft. Both are Atmee avatars and they hear each other **directly**: each
has a speech-to-speech session, and each one's voice is what the other hears. The person at the
page is the producer: they never speak; they write the rundown, send Jada topics and notes, cut
between her cameras if they want, and wrap the show.

Everything is invented: the show, the host, the film **AMBERFALL** (a desert epic of amber dunes
and salt-glass monoliths) and its designer, Inès Valcour.

Built the speech-to-speech way (`POST /v1/speech_sessions`), with every face an avatar-only render
(`POST /v1/avatars/{id}/avatar_sessions`) of a voice, all in one LiveKit room of the site's own.
No platform changes.

## How it works

```
                        producer (types only): topics, notes, camera, wrap
                                       │
┌────────────────────── page (apps/tv-show-live/page) ──────────────────────┐
│ booth (show/booth.ts): greeting → film → trailer → invite → on air → wrap   │
│                                                                             │
│  Jada's speech session ── her voice ──► Inès's session (what she hears)     │
│        ▲                      │ └──────► Jada's face (two framings)         │
│        └─── Inès's voice ─────┼────────── Inès's speech session             │
│                               └────────► Inès's face (the studio screen)    │
└──────────────┬───────────────────────────────────────────┬────────────────┘
               │ WebSockets (token per seat)               │ one LiveKit room, two renders
        Atmee speech server                             face-front-…, face-guest-…
```

- **One studio, with a TV on the wall.** The set (`studio/wall.jpg`) was outpainted from Jada's
  own camera still: her desk runs on to the right, under a wall TV where the film's key art waits
  and the guest then appears (its screen measured from a pure-green screen in the generated
  picture). Jada's whole render lies exactly over her still in the set (her place measured by
  matching the two), never cropped: her desk leaves through the bottom of the frame and the edges
  inside the frame fade, so when the v2 renderer drifts there is no hard line to slip against.
  The front of the desk (`studio/desk.webp`, cut from the set) lies over her render: the renderer
  zooms in on its own during a show (about 1.25x, measured live), and then her arms go behind a
  desk that stays put instead of the desk breaking off. The set is softened slightly to match the
  renderer's softer background. An earlier version cropped her render into a studio photograph
  and showed the seam.
- **The cameras are the page's**: cuts between moves on that one set, wide (Jada and the TV), in
  on Jada from the chest up, or in on the TV. One render has one pose, so Jada faces the lens in
  every shot. A shot keeps part of every face in frame: LiveKit's adaptive stream stops sending
  video to an element outside the viewport.
- **The director** (`show/director.ts`, tested in `director.test.ts`): Jada's medium shot until the
  guest is on; then it follows the speaker (Jada's close-up, the guest, both when they talk over
  each other), holding each shot at least 3 s; the two-shot for the goodbyes. The booth can take
  over: Auto, Jada, the guest, or both.
- **Showtime only when everyone is in place.** Both faces start backstage behind one card;
  Jada's line opens, and the show starts, only once all are up.
- **The trailer**: after Jada introduces AMBERFALL, the program cuts full frame to the trailer:
  five generated stills, each held and pushed in on with a dissolve between, cards over them,
  letterbox bars (about 26 s). No video model is available on the site's Gemini key, so it is a
  still-based trailer. The studio is muted while it plays.
- **Two speech sessions, wired to each other.** The server reserves each one and pins its role
  (`scenario`, `user_name`, and a plain-delivery `instructions`). The page keeps each input fed in
  real time and forwards every frame of each avatar's voice to the other. Each face gets its voice
  as one unbroken stream, resampled to 16 kHz (a piece per stretch of speech lost 1.3 s of 13.8 s
  to dropouts; one stream lost 0.05 s).
- **The booth** (`show/booth.ts`, tested in `booth.test.ts`): Jada greets the viewers; she is
  directed to introduce the film and roll the trailer; once the trailer is over she speaks up on
  her own (commentary, retried until she does) to react and invite Inès on; Inès's line opens, her
  first words reach Jada, and Jada welcomes her with the first topic. Producer cues are a one-turn
  `causeur.directive.set` on Jada's next turn; a conversation stalled for 10 s gets a prompt to
  pick it back up (three tries); the wrap has Jada close and Inès say goodbye, and the show ends
  even if she does not.

## The API

| Call | What for |
|---|---|
| `POST /v1/speech_sessions` × 2 | Jada's and Inès's sessions, `settings` pinning `scenario`, `user_name`, `instructions` |
| `POST /v1/avatars/{id}/avatar_sessions` × 2 | Jada's face and Inès's, into the show's room under fresh identities; a gateway timeout while the v2 pool starts a worker is retried as warming |
| `POST /v1/speech_sessions/{id}/end`, `POST /v1/avatar_sessions/{id}/end` | all four, at the end, from End the show, or when one drops |

On each speech WebSocket: `session.start`, `session.input_audio.append`, `session.output_audio.delta`,
`session.output_transcript.delta`, `causeur.directive.set`, `session.commentary.append`.

## The cast (staging, the demo account)

- **Jada Monroe** `307b2aba` (her speech session) and **Jada Monroe (camera 1)** `bdaf5bd3` (her
  face, facing the lens, at a calm walnut desk); a designed voice.
- **Inès Valcour** `5190aed1`, AMBERFALL's costume and production designer, centred and facing
  the lens in a studio dressed for the film.

## Limitations

- **Four things bill at once**: two speech sessions and two renders.
- **The show plays about 4 s late** (both renders equally, like a broadcast delay); each avatar
  hears the other's raw voice as it is made.
- **The camera is the renderer's**: it zooms and drifts on its own, and there is no setting for a
  locked-off camera or a fixed render prompt per avatar (checked in the renderer's code). Whole
  shots in boxes keep that from showing.
- **Check-ins and the speech server's idle mode stay on** (a public session may not change them).
- **No audience**: the room holds the faces; a broadcast would record this page.
- **Staging only**: `/v1/speech_sessions` is not on prod yet.
