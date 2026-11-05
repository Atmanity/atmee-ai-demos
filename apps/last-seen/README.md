# Last Seen

A five-minute mystery that happens entirely on your phone. It's 1:12 a.m. and your sister Mia
hasn't come home. Two people call you. Each tells one lie, and one piece of evidence breaks it.
Find out where she went, then decide where to go.

| Beat | Made of |
|---|---|
| Mia's video voicemail, cut off | Mia's avatar render |
| **Theo** calls from his car: "I dropped her home at eleven." Mid-call a neighbour's doorbell clip lands; **Show Theo** and he gives up the footbridge | Live call, clip model (CCTV) |
| A map pin and a text from Mum, while the next call connects | Phone UI |
| **Jonah** calls from the party: "Haven't seen her since ten." A friend's text lands; **Show Jonah** and he admits the breakup | Live call |
| Where do you go? The old footbridge, or back to the party | Choice |
| Mia on FaceTime at the bridge, or her last voicemail | Mia's avatar renders |

## Why a phone

Every limit of the live avatar is part of the fiction: the call **rings while it connects**
(Answer lights the moment the face is ready), one face fills a video call, low audio and a dark
picture read as a poor connection, and the clip model only makes grainy doorbell footage, where
its invented motion and grain look right.

## How the plot stays on rails

- The page owns the plot: when evidence lands (14 s), when the caller wraps up (46 s), when the call
  ends (after their next line, by 60 s), and which ending plays (the place you chose).
- Each lie and its reveal are in the session instructions; the reveal is scripted word for word and
  unlocked only by the evidence (`EVIDENCE SHOWN` state plus an event). Once the caller has said it,
  the state changes so they talk honestly without repeating it.
- Suggested questions under each call give a viewer something to say; a quiet viewer gets a new
  question from the caller, never a repeat.
- The account runs one session at a time: the server ends any live session before ringing the next
  caller, and a closing tab ends its call (`sendBeacon`).

## Assets (staging)

Avatars, V2 at 384x672: Theo `20d3b8c4-d051-4c2e-b67b-26a520e1c397`, Jonah
`220fc83c-c3d3-4733-ba68-da716db8c30c`, Mia `b3021db9-e41d-47fa-89e0-89e6466d349a` (renders only).
`film/` holds Mia's three videos (cut from her avatar's preview renders), the doorbell clip, the
ringing-screen stills, a ringtone and a notification sound. For another server set
`LAST_SEEN_THEO` and `LAST_SEEN_JONAH`.

## Run it locally

```bash
SITE_PORT=5251 HMR=0 node --env-file=../atmee-usecase-demos/.env --env-file=.env.local --import tsx server/index.ts
```

Open `http://localhost:5251/apps/last-seen/` (`?debug` shows the scene and call phase). Tests:
`npx vitest run apps/last-seen`.
