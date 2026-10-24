# Facecast

A presenter studio built the **avatar-only** way: any audio, and a face that says it. Write a
script for Remy to read in his own voice, drop in a recording, or hold the mic and talk: Remy Hart says it to
camera, lips in time. There is no conversation and no model deciding what he says; the audio is
all the app's, and Atmee renders only the face.

Open it at `/apps/presenter-studio/`.

## How it works

| Source | What happens |
|---|---|
| Script | The server voices it with Fish Audio in Remy's own voice (`fishVoiceId` in `avatar.json`, cloned from the sample he was made with), a sentence at a time (`POST /read`); the page hands the clips to Remy in order. His face was captured with that voice, so his lips follow it; other voices can leave them still. |
| Recording | The page decodes the file (wav, mp3, m4a, ogg…) to 16 kHz mono and sends it in ten-second pieces: the first is on air while the rest are still going. Up to two minutes. |
| Live mic | While the button is held, the microphone streams to Remy as it comes (one open piece of speech, `useAvatarOnly().open()`); he says it in your voice, a moment behind. His audio is muted then, unless you choose to hear it back with headphones. |

The page joins the site's own LiveKit room as the agent (`useAvatarOnly`); **Cut** clears what
Remy is saying (`lk.clear_buffer`). The on-air log lists each piece, how long, and whether it
played through or was cut.

Routes, under `/api/apps/presenter-studio`: `GET /voice` (whether scripts can be voiced),
`POST /read` (`{ text }` → the script as WAV clips, in order).

## Run it

`FISH_API_KEY` (for scripts; recordings and the mic need none) and the site's LiveKit project
(`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`). The host is Remy Hart, `avatar.json`.

## Staging, 2026-10-24

All three sources went on air and played through: a 22 s script in Kore read calmly, a 33 s
recording sent as four pieces, 6 s of live microphone (Remy's own audio muted meanwhile).
