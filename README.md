# livestream-chat-demo

A chat-only livestream host on the Atmee Avatar API: the avatar never hears or sees
anyone, it only reads the chatroom.

```
cp .env.example .env   # ATMEE_API_KEY, AVATAR_ID
npm install && npm start
open http://localhost:3333/host.html     # the stream: click "Start the stream"
open http://localhost:3333/viewer.html   # the chatroom, as many tabs as you like
```

How it works: `server.js` holds the API key, starts the session (`POST /v1/session`) and
runs the chatroom websocket. `host.html` is the session's user participant: it joins the
LiveKit room with the returned token (no microphone, a silent track), relays what the
server decides into the room — a message that asks the host goes as `lk.chat` (a user
turn the host answers), the rest is summarised into an `atmee.app` `event` every 20 s,
and `atmee.app` `state` carries the viewer count and recent chat — and sends the avatar's
captions (`lk.transcription`) back to the server, which fans them out to every viewer.
