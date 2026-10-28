# The Late Line: a talk show on speech-to-speech

Jada Monroe hosts a late-night talk show and invites a guest onto the studio's big screen; both are Atmee avatars. Unlike
[Nightcap Live](../tv-show/README.md), the two hear each other **directly**: each avatar has a
speech-to-speech session, and each one's voice is what the other one hears. Both faces are in
**one** LiveKit room, the studio's. The person at the page is the producer: they never speak; they
book the guest, write the rundown, and send Jada topics and notes, which she opens with the guest.

Built the speech-to-speech way (`POST /v1/speech_sessions`), with each face an avatar-only render
(`POST /v1/avatars/{id}/avatar_sessions`) of that voice. No platform changes.

## How it works

```
                         producer (types only)
                                │ topics, notes, wrap
                                ▼
┌──────────────────── page (apps/tv-show-live/page) ─────────────────────┐
│ booth (show/booth.ts): stages; cues → causeur.directive.set / commentary │
│                                                                          │
│  Jada's speech session ── her voice ──► Otto's session (what he hears)   │
│          ▲                     │                                         │
│          └──── his voice ──────┼──────── Otto's speech session           │
│                                ▼                     │                   │
│              Jada's face ◄─ 16 kHz pieces      pieces ─► Otto's face      │
└──────────────┬──────────────────────────────────────────────┬───────────┘
               │ WebSockets (token per seat)                  │ one LiveKit room, the site's own
       Atmee speech server                         two avatar-only renders, `face-host-…`, `face-guest-…`
               ▲                                              ▲
               └──── server.ts: /v1/speech_sessions × 2, /v1/avatars/{id}/avatar_sessions × 2 ────┘
```

- **Two speech sessions, wired to each other.** The server reserves each one (the API key stays
  there) and **pins its role**: `scenario` and `user_name`, so Jada's session knows the user is
  her guest and the guest's knows the user is Jada. The page connects to each WebSocket with its
  token, keeps its input fed in real time (a frame of silence whenever nothing else is due), and
  forwards every frame of each avatar's voice into the other's input. Turn-taking is theirs: they
  listen to each other as to a person.
- **The studio and its TV.** Jada's portrait is the studio, her whole body turned toward the big
  screen at her left. The page carries the set on past her square shot and hangs a flat-panel TV
  on the wall, angled toward her: thin bezel, glass glare, a faint pixel grid, the screen's light
  on the wall, the network's live tag and name strip on the guest's feed. The guests call in from
  home (their own portraits).
- **Showtime only when everyone is in place.** Both faces start backstage, behind one card; Jada's
  line opens, and the show starts, only once both are up. The guest's face waits with the TV on
  standby until Jada invites them on.
- **One room, two faces.** The server starts both renders into the show's room, each under its own
  identity; the page joins the room twice, once as each face's agent. Each avatar's whole voice is
  resampled from 24 kHz to 16 kHz and streamed to its face as **one** piece for the show, silence
  included, in 100 ms writes; the face publishes the face and the voice in sync. (Measured live
  against the raw voice: cutting it into a piece per stretch of speech lost 1.3 s of 13.8 s to
  dropouts, since every new piece starts the renderer cold; one stream lost 0.05 s of 13.4 s.)
  `show/voice.ts` also finds the stretches of speech, which tell the booth who is speaking. The
  page plays the faces' voices, not the raw speech.
- **The booth** (`show/booth.ts`, tested in `booth.test.ts`): Jada greets the viewers alone; then
  she is directed to say who tonight's guest is and invite them onto the big screen; once she has,
  the guest's line opens and the TV comes on, the guest's first words reach her, and she is
  directed to welcome them with a first question. A conversation that stalls (both quiet 10 s) gets
  a prompt for Jada to pick it back up, up to three times; a guest who never says goodbye does not
  keep the show open past 15 s. A
  producer's cue is a directive on Jada's session (`causeur.directive.set`), taken off once she
  has finished a turn that began after it; on a floor quiet for 10 s it is also spoken at once as
  commentary (`session.commentary.append`). The wrap directs Jada to close, then the guest to say
  goodbye, and the show ends itself.

## The API

| Call | What for |
|---|---|
| `POST /v1/speech_sessions` × 2 | each avatar's session, `maxDurationSeconds` 900, with `settings` pinning `scenario` and `user_name` |
| `POST /v1/avatars/{id}/avatar_sessions` × 2 | each face, into the show's room under its own identity (`face-host-…`, `face-guest-…`, fresh per attempt); a gateway timeout while the v2 pool starts a worker is retried as warming |
| `POST /v1/speech_sessions/{id}/end`, `POST /v1/avatar_sessions/{id}/end` | all four, at the end, from End the show, or when any one drops |

On each speech WebSocket: `session.start`, `session.input_audio.append` (what the avatar hears),
`session.output_audio.delta` and `session.output_transcript.delta` (what it says),
`causeur.directive.set` and `session.commentary.append` (the producer's cues).

Routes (`server.ts`): `POST /api/apps/tv-show-live/shows`, then per seat (`host`, `guest`)
`/show/<show>/<seat>/render` and `/show/<show>/<seat>/speech`, each with `/<id>/end`, and
`/show/<show>/end`. `server/render.ts`'s `startRender` gained a room and an avatar identity, so
several faces can share a room.

## The cast

All three are invented characters, made for this show (staging, the demo account):

- **Jada Monroe** `307b2aba`, the host: at the studio desk, her whole body turned toward her
  guest (generated facing her right, then mirrored), a designed voice.
- **Otto Brandt** `9b4228cf`, an inventor of magnificent, mostly useless machines.
- **Rosa Quintero** `8c20336d`, a big-wave surfer turned taco-stand owner.

Both sessions carry a pinned delivery instruction (plain words, no bracketed cues), since the
voices laughed far too often.

`AVATAR_TV_SHOW_LIVE` swaps the host; `AVATAR_TV_SHOW_LIVE_GUEST_<ID>` a guest.

## Running it

Needs the site's own LiveKit project (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, in
`.env.local` locally; the deployment reads the `livekit-demos` secret) and a key with the
`sessions` scope on an account whose avatars these are. Without LiveKit, booking a show answers
`livekit_not_configured`.

## Limitations

- **Four things bill at once**: two speech sessions and two renders.
- **The show plays about 4 s late**: each avatar hears the other's raw voice as it is made, while
  the viewer sees and hears it from the faces about 4 s later (both equally, like a broadcast delay).
- **Speech recognition sits between them**, so a misheard word or an overlap is still possible.
- **Check-ins stay on** (a public session may not change them), which is harmless while the two
  hear each other.
- **No audience yet**: the room holds the show, so a broadcast is a recording of that room
  (LiveKit egress); this app does not start one.
- **Staging only**: `/v1/speech_sessions` is not on prod yet.

## Live runs

2026-10-28, staging:

- Headless, two speech sessions piped into each other (the studio Nico and Lumi) held a natural
  back-and-forth for 75 s with no relay and no check-ins.
- The page, driven headless as the producer, with Otto: both faces in one room, Jada greeted on
  camera, introduced Otto and asked about the Singing Toaster; a topic (the Umbrella That
  Remembers) and a note ("which invention exploded": the butter churn that coated the ceiling)
  each landed on her next turn and were cleared after it; the wrap, Otto's goodbye ("Do mind the
  ceiling butter"), and the show ended itself at 206 s.
- With the TV and the invitation, Otto: Jada greeted the viewers alone, invited him onto the big
  screen, welcomed him; a topic and a note each landed on her next turn; the wrap and goodbyes; the
  show ended itself at 212 s. An earlier run stalled: Jada cut into a pause with "hold on", Otto's
  session took it as a request to wait and went quiet (the speech server's idle module, which a
  public session cannot turn off). Jada now waits through pauses, and a stall gets a prompt.
- Found and fixed live: two faces at once need a second v2 worker, whose start outlasted the
  gateway (524), so a gateway timeout is now retried as warming; and Jada said "my producers tell
  me", so her scenario no longer names who sends the topics.
