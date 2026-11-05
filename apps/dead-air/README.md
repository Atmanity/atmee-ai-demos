# Dead Air

A three-minute horror told through two phones. Jake, closing a mall alone, video-calls you because
he's bored. The lights flicker, someone screams, and a man is standing at the far end of the food
court. Then Maya, driving slowly to pick Jake up, calls you from the car.

## The rule: every frame is one of two phones

| Beat | Camera |
|---|---|
| Jake chats, the lights flicker, a distant scream | Jake's front camera (live) |
| "Hang on, let me turn the camera": the man at the far end, then he charges | Jake's back camera, the same food court |
| The phone hits the floor face up: the ceiling, and a shadow leans over the lens | the dropped phone |
| Maya's text, then her call while driving, phone on the dash mount | Maya's front camera (live), streetlights sweeping |
| "There are people on the road... look": the road ahead, then the crash | Maya's back camera, then black and the horn |
| "Jake is calling..." | breathing |

A camera changes only when the caller says so or the phone falls. Back-camera views are generated
with the same description as the caller's own background (the BURGER stall, grey shutters, wooden
tables, strip lights), so the reverse angle is the same room. No security cameras: nobody in the
story holds them.

## How it works

- The page owns every beat: at fixed times it tells the caller what just happened, as an `event`
  (waits for a pause) or `interrupt` (cuts in: the scream, the charge, the road, the crash).
- Each call connects hidden behind the screen before it and rings until the face is ready; a call
  that drops before the face arrives is redialled quietly while the phone keeps ringing.
- The live face moves like a phone in a hand (Jake) or in a dash mount (Maya); camera flips spin the
  picture edge-on and back. Every clip is pre-rendered from a single image, so each is one take.

## Assets (staging)

Avatars, V2 at 384x672: Jake `b2c29951-36bd-4a68-bc64-8eed366e905d`, Maya
`bb64ce62-5f82-4223-a1b4-633ba6e0d31f`. `film/` holds the five phone-camera clips (figure, charge,
ceiling, road, crash), the ringing stills and the sounds (drone, flicker, distant scream, shriek,
thud, drop, skid, impact, horn, tinnitus, breathing, ring, ding).

## Run it locally

```bash
SITE_PORT=5261 HMR=0 node --env-file=../atmee-usecase-demos/.env --env-file=.env.local --import tsx server/index.ts
```

Open `http://localhost:5261/apps/dead-air/`. Tests: `npx vitest run apps/dead-air`.
