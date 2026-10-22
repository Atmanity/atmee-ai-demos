// Shared by every host page: start the use case's session through our own
// server, join the LiveKit room as the user participant, relay what the server
// decides into the room, send the avatar's captions back.
//
//   const s = await Atmee.join({ usecase, video, audio, mic: false, onCaption, onRelay, onMessage });
//   s.say(text)            -> lk.chat        (a user turn)
//   s.app({type, text})    -> atmee.app      (state / note / event / mute / unmute)
//   s.user(kind, text)     -> tell the server what the page's user did (the policy decides)
//   s.end()
(function () {
  const { Room, RoomEvent, Track } = LivekitClient;
  const CHAT_TOPIC = 'lk.chat', APP_TOPIC = 'atmee.app', TRANSCRIPTION_TOPIC = 'lk.transcription', FINAL_ATTR = 'lk.transcription_final';

  async function join(opts) {
    const res = await fetch(`/api/${opts.usecase}/session`, { method: 'POST' });
    const s = await res.json();
    if (!res.ok) throw new Error(s.error || `session ${res.status}`);
    const room = new Room({ adaptiveStream: true, dynacast: true });
    let linked = false, lastState = null;
    const outbox = [];
    const sendToRoom = async (topic, text) => { if (!linked) { outbox.push([topic, text]); return; } await room.localParticipant.sendText(text, { topic }); };
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/?usecase=${opts.usecase}&role=host`);
    const api = {
      session: s, room, ws,
      say: (text) => sendToRoom(CHAT_TOPIC, text),
      app: (message) => { if (message.type === 'state') { if (message.text === lastState) return; lastState = message.text; } return sendToRoom(APP_TOPIC, JSON.stringify(message)); },
      user: (kind, text) => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'user', kind, text })),
      end: async () => { try { await fetch(`/api/${opts.usecase}/session/end`, { method: 'POST' }); } catch (e) {} room.disconnect(); },
    };
    ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'say') { opts.onRelay && opts.onRelay('lk.chat', msg.text); await api.say(msg.text); }
      else if (msg.type === 'app') { opts.onRelay && opts.onRelay(`atmee.app ${msg.message.type}`, msg.message.text || ''); await api.app(msg.message); }
      else if (opts.onMessage) opts.onMessage(msg);
    };
    room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, async (reader, participant) => {
      const info = reader.info || {}, attrs = info.attributes || {};
      if (participant && participant.identity === room.localParticipant.identity) return; // our own typed turns
      let text = '';
      try { for await (const chunk of reader) { text += chunk; opts.onCaption && opts.onCaption(text, false); } } catch (e) {}
      const final = attrs[FINAL_ATTR] !== 'false';
      opts.onCaption && opts.onCaption(text, final);
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'caption', text, final, id: info.id }));
    });
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Video && opts.video) track.attach(opts.video);
      if (track.kind === Track.Kind.Audio && opts.audio) track.attach(opts.audio);
    });
    room.on(RoomEvent.Disconnected, () => { linked = false; opts.onEnd && opts.onEnd(); });
    await room.connect(s.serverUrl, s.userToken);
    if (opts.mic) {
      try { await room.localParticipant.setMicrophoneEnabled(true); } catch (e) { console.warn('no microphone; typing only', e); await publishSilence(room); }
    } else {
      await publishSilence(room);
    }
    // The agent links the participant it listens to shortly after joining;
    // nothing sent before that is heard, so the opening state is sent then.
    await new Promise((r) => setTimeout(r, 4000));
    linked = true;
    while (outbox.length) { const [t, x] = outbox.shift(); await room.localParticipant.sendText(x, { topic: t }); }
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'linked' })); else ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'linked' })));
    return api;
  }

  async function publishSilence(room) {
    // No microphone: a silent track still marks this participant as the one
    // the agent listens to.
    const ctx = new AudioContext(); const dst = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator(); const gain = ctx.createGain(); gain.gain.value = 0; osc.connect(gain).connect(dst); osc.start();
    await room.localParticipant.publishTrack(dst.stream.getAudioTracks()[0], { name: 'silent-mic' });
  }

  window.Atmee = { join };
})();
