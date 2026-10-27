# Nightcap Live: a talk show with two avatars

Nico Vale hosts a late-night talk show and video-calls a guest; both are Atmee avatars. The person
at the page is the **producer**: they never speak. They book the guest, write the rundown, and send
Nico topics and notes from the booth; Nico opens each topic with the guest in his own words, and
the guest answers him. The page is the program picture as it goes out: Nico at the studio desk, the
guest on the studio's wall screen, the show's logo, the live tally, the lower-third, subtitles and a
ticker.

Built the full-stack way: two `POST /v1/session` conversations at once, Atmee running each one's
listening, thinking, voice and face. No platform changes.

## How it works

```
              producer (types only)
                     │ topics, notes, wrap
                     ▼
┌────────────── page (apps/tv-show/page) ──────────────┐
│  booth (show/booth.ts): stages, cues → state / event  │
│                                                        │
│  host room ◄── guest's voice as the host's mic ──┐     │
│  guest room ◄── host's voice as the guest's mic ─┘     │
└─────┬──────────────────────────────────────┬──────────┘
      │ LiveKit                              │ LiveKit
 Nico's session (Causeur)            the guest's session (Causeur)
      ▲                                      ▲
      └──── server.ts: POST /v1/session × 2 ─┘   (the API key stays here)
```

- **Two sessions, two rooms.** An Avatar API session has one avatar and one user, and the avatar
  listens only to that user. So each avatar gets its own session, and the page joins both rooms as
  their user.
- **They hear each other.** Once the guest is put through, the page plays Nico's voice into the
  guest's room as the user's microphone, and the guest's voice into Nico's (`feedMic` in the kit,
  through the page's own audio graph). Each takes the other for the person on the call, and they
  take turns the way they would with a person. That is also what stops the avatars' check-ins: an
  avatar in a silent room speaks up after about ten seconds, and a room that carries the other's
  voice is never silent while the other talks.
- **The booth** (`show/booth.ts`, tested in `booth.test.ts`) runs the show in stages: Nico's
  greeting with the guest off air (its own greeting is never heard), the guest put through, the
  intro cue, on air, the wrap, the guest's goodbye, off air.
- **The producer's cues** become a one-turn addition to Nico's `state` (a live directive he follows
  and never mentions): he reacts to what the guest just said, then moves on, in his next turn, and
  the directive comes off when that turn ends. On a floor quiet for 10 s (a stalled conversation), a cue goes out as an
  `event` and Nico speaks up at once.

## The API

| Call | What for |
|---|---|
| `POST /v1/session` (host) | Nico's conversation, `maxDurationSeconds` 900, metadata `seat: host` |
| `POST /v1/session` (guest) | the guest's, `seat: guest:<id>`; refused (409 `guest_has_agenda`) for a guest that carries a conductor |
| `GET /v1/avatars/{id}` | the guest's conductor, before it goes on air |
| `POST /v1/session/{id}/end` | both calls, after the goodbye, from End the show, or when either call drops |

Room messages, all on `atmee.app`: `state` for each avatar's framing (Nico: a TV show, the guest on
a video call, the producer's topics; the guest: on Nightcap Live with Nico), `state` again for each
one-turn directive and to take it off, and `event` for the intro and for cues on a quiet floor.
Both calls publish a silent microphone until the guest is put through. No app tools.

Routes (`server.ts`): `/api/apps/tv-show/host/session`, `/api/apps/tv-show/guest/<guest>/session`,
each with `/<id>/end`, and `GET /api/apps/tv-show/guests`.

## The cast

- **Host: Nico Vale (studio)**, `e3fd4f1d`, a v2 avatar made for this app from Nico Vale's voice
  sample and a studio portrait: Nico at the desk, turned toward screen right, where the guest's
  screen hangs. The portrait is the studio: v2 animates the whole picture and keeps the head turned
  the way the portrait has it (there is no gaze control in the API). The render is a 512 px square
  centre crop, and the build refuses a face under 18 % of its width, so the shot is a medium shot;
  the page carries the set on beyond it.
- **Guests** (`show/guests.ts`): Detective Frank Malone, Lumi Brook and Mira, demo avatars with no
  conductor. `AVATAR_TV_SHOW_GUEST_<ID>` swaps one; `AVATAR_TV_SHOW` swaps the host.

## Limitations

- **Two sessions bill at once**: the show costs twice a call's rate per minute.
- **Each avatar hears the other through speech recognition**, so a misheard word is possible, and
  so are overlaps when both start at once.
- **One show at a time.** Each avatar takes one conversation (`409 avatar_busy`), so a second
  producer waits.
- **No audience.** The program picture exists only on the producer's page; broadcasting it needs
  the page itself recorded and restreamed (LiveKit web egress), which this app does not do.
- **The guest's persona is its own**: its greeting and the role it was made for are steered by
  `state` only.
- **The head turn is the portrait's**: in some moments the take swings Nico back toward the camera.

## Live runs

See the PR for the dated runs on staging and what they showed.
