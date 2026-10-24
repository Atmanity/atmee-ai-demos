# Waybill

A parcel help desk built the **avatar-only** way. Ask Tess where your parcel is, and fix what
went wrong: book a redelivery, send it to a pickup point, add a missing flat number, open a
claim. Every answer comes from **Waybill's own agent**: its model, its tools over its own
parcel records, its voice and its ears. Tess is only the face that says it.

Open it at `/apps/parcel-help-desk/`.

## How it works

```
you type, or hold the mic ──► Waybill's server
                                ├─ ears   Gemini hears the recording (engine/agent.ts: transcribe)
                                ├─ brain  Gemini with Waybill's tools (engine/agent.ts: answer)
                                │          lookup_parcel, reschedule_delivery, send_to_pickup_point,
                                │          add_flat_number, open_claim  ──►  engine/parcels.ts
                                └─ voice  Fish Audio in Tess's own voice, a sentence at a time (server/speech.ts)
the page ──► 16 kHz audio ──► Tess (Atmee renders the face, in the site's LiveKit room)
```

| Part | Where |
|---|---|
| The parcels and the rules | `engine/parcels.ts`: five sample parcels, each with its own problem (out for delivery, a missed delivery, held for a flat number, delivered to a neighbour, delayed by weather), and the fixes the desk allows. Each visitor gets their own copy. Delivery days are the next five working days. |
| The agent | `engine/agent.ts`: Gemini function calling over the desk's tools, up to four model calls a turn; the model's own turns go back as they came (thought signatures). It states nothing about a parcel that a tool did not return. `WAYBILL_MODEL` (default `gemini-3.5-flash-lite`: about 1.5 s a call). |
| The voice | `server/speech.ts`: Fish Audio in Tess's own voice (`fishVoiceId` in `avatar.json`, cloned from the sample she was made with), the sentences voiced side by side and handed to Tess in order. A v2 face is captured with its own voice and its lips follow that voice; another can leave them still. |
| The face | `useAvatarOnly` (the kit): the page joins the site's own LiveKit room as the agent and streams each answer to Tess; a new question cuts her off (`lk.clear_buffer`). |
| The screen | `page/App.tsx`: Tess, the conversation, a hold-to-talk mic, the parcel card the tools fill in, and **Under the hood**: what each part of the answer took (ears, brain, voice, then how soon the face started). |

Routes, under `/api/apps/parcel-help-desk`: `POST /desks` (a visitor's desk and Tess's greeting,
voiced), `POST /desks/:id/turn` (`{ text }` or `{ audio }`, a WAV of the held mic → the answer,
the steps, the parcel, the answer's audio and timings). The render itself goes through the
site's shared `/render` routes.

## Run it

`GEMINI_API_KEY` (the agent and its ears), `FISH_API_KEY` (its voice) and the site's LiveKit project
(`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`). The host is Tess, `avatar.json`.

## Staging, 2026-10-24

Played live, typed and spoken: "WB 1907 2264, where is it?" → the lookup, the missed delivery,
the days and pickup points offered; "deliver it again on Wednesday" → booked, the card updated;
a held-mic recording of a held parcel → heard, looked up, asked for the flat number. A turn takes
about 2.5 s to think, 3 s to voice, and Tess starts 1 s after she is handed the audio.
