# Pocket NPC

A game character with Atmee's voice and conversation, drawn by the game itself. Built the
**speech-to-speech** way, with a different setup from the full-stack apps: Atmee does not
render a face here. Brannoc, keeper of the Brass Kettle, is a 2D character in the game's own SVG,
and the page moves him from the voice as it plays. His mouth opens with each word, his brows
rise on the loud ones, he nods along, tilts towards you while you talk, blinks on his own, and
beams when the game hands something over. Talk to him out loud. He gossips, points you at the
quest board, and sells you gear for the silver in your purse. His tools change the quest log
and the pack beside the scene.

Open it at `/apps/pocket-npc/`. It is off (and not on the home page) until `AVATAR_POCKET_NPC`
names an avatar with a voice.

## How it works

```
the game's server ──► POST /v1/speech_sessions  (API key; avatarId = the voice; settings pinned:
   (server.ts)            Brannoc's name, persona, scene, greeting, the tavern's facts,
        │                 how he plays the scene, 4 tools)
        │ ◄── { url, token (one connection, 60 s), sessionId }
        ▼
the page ──► wss://…/v1/speech_sessions   subprotocols atmee-live, atmee-token.<jwt>
   input_audio.append  ───► the microphone, 24 kHz PCM16, every 20 ms
   output_audio.delta  ◄─── his voice ──► jitter buffer ──► speaker
                                                  └──► level (RMS) ──► jaw, moustache, brows, head
   a tool round        ◄─── give_quest, sell_item, give_item, look_at_player ──► engine/tavern.ts
   response.item.create ──► each result; response.create ──► he goes on
```

| Part | Where |
|---|---|
| Who he is | `server.ts` pins it per conversation (`speech.settings()`): `avatar_name`, `persona`, `scenario` and `self_introduction` from `avatar.json`, the tavern's `facts` (the shelf, the quest board, the gossip), the `instructions` for playing the scene, and the tools. The avatar gives only the **voice**: its own name and personality are replaced. That is how a game uses its own characters: one voiced avatar can play any of them. |
| The game's state and rules | `engine/tavern.ts`, run in the page: 12 silver and a cloak to start, Brannoc's shelf (six wares, prices, stock), three quests on the board, two at a time, one cheap thing on the house per visit. Results lead with the outcome (`Sold:`, `Not sold: it costs 8 silver and the player has only 4`, `Quest given:`, `Already on the log:`). Brannoc never moves silver himself, so a sale the player can't afford is refused before anything changes hands. |
| His face | `page/Brannoc.tsx`: the tavern and Brannoc as one SVG. Every animation frame reads `useSpeech().levels().voice`, the RMS of the audio the speaker is playing right now (after the jitter buffer, so it stays in sync), and sets the jaw's opening (fast to open, slower to close), lifts the moustache, raises the brows and nods the head. The page also sets his mood: `listening` (leaning in, brows up while your microphone is loud), `thinking` (quicker blinks), `pleased` for 2.5 s after a sale, gift or quest. There is no viseme data: the speech server sends audio and paced words, so this is level-driven, not phoneme-accurate lip sync. A game engine would do the same with its own rig (a jaw bone or blend shape per level). |
| The call | `src/speech/` and `useSpeech` (shared by the speech apps): the socket, the microphone and voice worklets, the transcript, tool rounds, End through the server. |
| The screen | `page/App.tsx`: the scene with his words in a speech bubble and yours under it, a toast for each thing handed over, Mute and End; the quest log, purse and pack, his shelf, and **Under the hood** with each tool's result. After the conversation: what you leave with, how long you talked, what was billed and what it cost. |

Routes, under `/api/apps/pocket-npc` (the site's shared speech routes): `POST /speech`,
`GET /speech/:id`, `POST /speech/:id/end`. End asks the server to end the session first, then
closes the socket, so it settles at once (see Callwell's README for the details and the failure
screens, which are the same here).

## Run it

`ATMEE_API_KEY` (the `sessions` scope) and `AVATAR_POCKET_NPC`: an avatar of the key's account
**with a voice** that suits an old innkeeper (a deep, warm male voice). Needs a deployment with
speech sessions: session_service's `/v1/speech_sessions` and Causeur's speech server in public
mode.

## Local run, 2026-10-27

Against a local stack (session_service #183, Causeur #122 in public mode, a fresh Supabase with
the speech-billing migrations). It was driven by Playwright Chromium with a fake microphone
playing a `say` recording, with microphone permission only:

- **Greeting.** "Well now, a new face, and soaked right through to the bone! Welcome to the Brass
  Kettle, friend, I'm Brannoc…"
- **The quest.** "Anything on the quest board?" got the three jobs. "The drowned bell, I'll take
  it" called `give_quest`: the quest went on the log and he told the player to see the ferryman.
- **The sale.** "How much is the storm lantern?" got "six silver". "Yes, I'll buy it" called
  `sell_item`: 12 silver became 6, the lantern went into the pack, the shelf stock dropped to 1,
  and the toast and his pleased squint showed while he handed it over.
- **The audio.** 4,761 voice frames arrived (2,950 with speech) and 4,763 microphone frames went
  out. The screenshot mid-sentence shows the jaw open with the tongue visible.
- **End.** It settled `completed` / `ended_by_api`, billed 96 s (1.6 credits), and the summary
  read "You leave with 6 silver, Worn travelling cloak, Storm lantern, and The Drowned Bell on
  your log".
- **Failures.** A blocked microphone and a third call past the speech server's limit (1013)
  showed their lines.

## Limitations

1. **Level-driven, not lip sync.** The speech session sends audio and paced words, no visemes
   or timings per phoneme, so the mouth follows loudness. That is fine for a cartoon. A realistic
   face would need phoneme timing, or the audio handed to an avatar-only render.
2. **Expressions come from the game, not the model.** The speech session's public profile has no
   emotion or gesture events, so Brannoc's moods are the page's (the call's state and the game's
   own events). A `set_mood` tool would cost a tool round, and a filler, each time.
3. **The persona is pinned in full.** The avatar's own persona is replaced, and only its voice
   carries over, so pick an avatar whose voice fits the character.
4. **Tools are the model's call.** He may offer a sale and wait for a yes, or skip
   `look_at_player`. The game refuses what the rules don't allow, so a slip is a refusal he
   says, never silver gone missing.
5. **One conversation per connection, and the state lives in the page.** A dropped connection
   starts over, and a reload resets the purse and the log.
