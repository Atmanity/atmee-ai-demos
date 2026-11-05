# The Stairs

A three-minute interactive film. It's late, and you are Sam, ten, standing in the kitchen doorway
while Mum and Dad fight. The argument is film. Then each parent, one at a time, turns to you and
talks with you live, by voice. What you tell them changes the bridge between the two conversations
and how the night ends.

## How it plays

| Time | Beat | Made of |
|---|---|---|
| 0:00 | The argument: a silent two-shot, then four close-ups, then Dad walks out | Clips |
| 0:28 | "The kitchen goes quiet. What do you do?" Step in, or stay in the doorway | Page choice |
| 0:37 | **Claire (Mum)** notices you and talks with you, about 50 s | Live call |
| 1:30 | Mark comes back; Claire tells him what you said (one of three lines), and goes upstairs | Clips |
| 1:45 | **Mark (Dad)** talks with you; he knows what you told Mum, about 50 s | Live call |
| 2:40 | The ending: Repair, Split or Silence | Clips |

- **Close-ups are the avatars themselves.** Each parent's lines were set as their avatar's preview
  message, and the build's own render of them (the same V2 HD model, framing and look as the live
  call) is cut into the close-ups and the holding shots. A cut from film to live lands on the same
  face. The clip model keeps only the silent two-shots: from a cropped close-up it kept walking the
  parent out of frame or cutting to a stranger, and naming that in the prompt made it worse.
- **Whose turn.** In a live scene a pill at the top says "Mum is talking…", then "Your turn: say
  something" once she stops, and "Mum is listening" with Sam's words as she hears them.
- **Handheld camera.** One gentle drift and tremor over the whole frame, carried through every cut.
- **Two shots, one face each.** Both parents share the frame only in silent two-shots, with motion
  from the prompt. Every spoken line is a close-up of one parent. In a two-shot with a voice, no
  face lip-synced reliably (tested 2026-11-05), so the film never asks for one.
- **One look.** Both portraits are cropped from the same generated two-shot (`host/portrait.jpg`),
  so the kitchen, light and faces match across clips and live calls.
- **Branching.** After each call the server reads Sam's lines (Gemini, or word rules) as
  `honest`, `side` or `silent` (`story.ts`). A side taken with either parent splits them, one
  honest talk repairs, nothing at all leaves silence. Mark's session is told what Sam said to Claire.

## Hiding the load

The viewer never waits for an avatar.

- Claire's call starts during the third clip of the argument, about 25 s before her scene. It joins
  **hidden, muted, with Sam's microphone closed** (`micMuted`), and on staging with `welcome: false`
  so she says nothing until cued.
- The page cuts to the live face only when its video plays. If it is not there yet, the page loops
  a silent **holding shot** of the same parent in the same kitchen (forward then backward, so the
  loop never jumps). The cut from that clip to the live face reads as an ordinary cut.
- At the cut the page opens the mic and sends one `event` ("Sam is in the doorway, speak first"),
  so the parent opens the scene.
- The account runs one session at a time, so Mark's call connects under the bridge clips (about
  15 s), with his holding shot behind it.
- Every clip is fetched as a blob before the film starts, and clips play on two alternating
  `<video>`s, so a cut never shows a blank frame.

## What the API could not do

- **No two-person lip sync in a clip**: see above.
- **Instructions that name a thing plant it.** "Do not send Sam to bed" made Mark send Sam to bed
  every turn; the instructions now say only what to do.
- **Clips invent camera moves.** Asking a close-up to talk "to someone off-camera" made the model
  pan to a new person, and an action shorter than the clip ends in an invented cut. Prompts now ask
  for a locked-off single take with nobody else in frame, and each clip is cut at the end of its line.
- **Greeting.** Production still greets on arrival (no `welcome: false` there): the greeting is
  spoken while the call is hidden and lost.
- **Uploads.** Each clip input is a one-time upload, and the account's cap on unused uploads
  (`429 upload_limit_reached`) stopped a batch of clips for up to an hour.

## Making the film

Everything is 16:9. The clips are in `film/`, made on staging with `atmee-staging generate clip` at
832x468 (0.3 credits up to 5 s), and the live faces are V2 HD at 864x480, so a cut from a clip to
the live call keeps the frame and nearly the same sharpness. Each parent's lines came
from one `design_voice` read of all of them, split at the pauses; the same read is that avatar's
voice sample, so the clips and the live calls sound alike.

Staging avatars: Claire `9f4682bc-5edc-4e06-a580-ef6e281fe904`, Mark
`3f0c69d8-b638-4659-b33f-c949b66675af` (V2 HD, 864x480). For another server set `THE_STAIRS_CLAIRE`
and `THE_STAIRS_MARK`.

## Run it locally

```bash
SITE_PORT=5241 HMR=0 node --env-file=../atmee-usecase-demos/.env --env-file=<staging key file> \
  --import tsx server/index.ts
```

The key file holds `ATMEE_API_KEY` for the staging account that owns the two avatars, and
`ATMEE_BASE_URL=https://staging.atmanity.us`. Open `http://localhost:5241/apps/the-stairs/`
(`?debug` shows the call's phase, `?script` exposes `window.__say(text)` to speak as Sam in text).
Tests: `npx vitest run apps/the-stairs`.
