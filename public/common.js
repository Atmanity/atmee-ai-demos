// The client side every app shares: start the use case's session through our
// own server (the API key never reaches the browser), join the LiveKit room as
// the session's user, wait until the avatar is actually on screen, relay what
// the server decides into the room, and hand the avatar's words back.
//
//   const mic = await Atmee.requestMic();          // in the lobby, or null for typing only
//   const s = await Atmee.join({ usecase, video, audio, mic,
//     onPhase(phase, detail), onCaption(text, final), onSpeaking(bool),
//     onMessage(msg), onRelay(topic, text), onEnd() });
//   s.user(kind, text)  tell the server what the user did (the use case decides)
//   s.setMuted(bool)    mute or unmute the user's microphone
//   s.end()
//
// Phases: starting -> warming (the rendering pool is cold; retried) ->
// connecting -> arriving (in the room, waiting for the avatar) -> live.
// join() rejects with an Error whose .friendly says what to tell the user.
(function () {
  const { Room, RoomEvent, Track } = LivekitClient;
  const CHAT_TOPIC = 'lk.chat', APP_TOPIC = 'atmee.app', TRANSCRIPTION_TOPIC = 'lk.transcription';
  const ARRIVAL_TIMEOUT_MS = 90000, WARMING_LIMIT_MS = 6 * 60000;
  const debug = new URLSearchParams(location.search).has('debug');

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function failure(message, friendly) { const e = new Error(message); e.friendly = friendly; return e; }

  async function requestMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw failure('no getUserMedia', 'This browser cannot use a microphone here.');
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      throw failure(e.message, e.name === 'NotAllowedError'
        ? 'Microphone access was blocked. Allow it in the address bar, or continue by typing.'
        : 'No microphone was found. You can continue by typing.');
    }
  }

  async function startSession(usecase, onPhase) {
    const started = Date.now();
    for (;;) {
      const res = await fetch(`/api/${usecase}/session`, { method: 'POST' }).catch(() => null);
      if (!res) throw failure('server unreachable', 'Could not reach the app server. Is it running?');
      const body = await res.json().catch(() => ({}));
      if (res.ok) return body;
      if (res.status === 503 && Date.now() - started < WARMING_LIMIT_MS) {
        const wait = Math.min(Math.max(body.retryAfter || 15, 5), 30);
        onPhase('warming', { retryIn: wait, waited: Math.round((Date.now() - started) / 1000) });
        await sleep(wait * 1000);
        continue;
      }
      if (res.status === 409) throw failure(body.error, 'This presenter is already in another session. Try again in a minute.');
      throw failure(body.error || `session ${res.status}`, 'The session could not be started. Please try again.');
    }
  }

  async function join(opts) {
    const phase = (p, d) => { if (debug) console.log('[atmee] phase', p, d || ''); opts.onPhase && opts.onPhase(p, d || {}); };
    phase('starting');
    const s = await startSession(opts.usecase, phase);
    phase('connecting');

    const room = new Room({ adaptiveStream: true, dynacast: true });
    let linked = false, ended = false, lastState = null, micTrack = null;
    const outbox = [];
    const sendToRoom = async (topic, text) => {
      if (!linked) { outbox.push([topic, text]); return; }
      await room.localParticipant.sendText(text, { topic });
    };
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/?usecase=${opts.usecase}&role=host`);
    const releaseMic = () => { if (opts.mic) opts.mic.getTracks().forEach((t) => t.stop()); };
    const endOnServer = () => fetch(`/api/${opts.usecase}/session/end`, { method: 'POST', keepalive: true }).catch(() => {});

    const api = {
      session: s, room, debug,
      say: (text) => sendToRoom(CHAT_TOPIC, text),
      app: (message) => {
        if (message.type === 'state') { if (message.text === lastState) return; lastState = message.text; }
        return sendToRoom(APP_TOPIC, JSON.stringify(message));
      },
      user: (kind, text) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'user', kind, text })); },
      setMuted: async (muted) => { if (micTrack) { if (muted) await micTrack.mute(); else await micTrack.unmute(); } },
      hasMic: () => !!micTrack,
      end: async () => { ended = true; releaseMic(); await endOnServer(); ws.close(); room.disconnect(); },
    };

    ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'say') { opts.onRelay && opts.onRelay('lk.chat', msg.text); await api.say(msg.text); }
      else if (msg.type === 'app') { opts.onRelay && opts.onRelay(`atmee.app ${msg.message.type}`, msg.message.text || ''); await api.app(msg.message); }
      else if (opts.onMessage) opts.onMessage(msg);
    };

    room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, async (reader, participant) => {
      const info = reader.info || {};
      if (participant && participant.identity === room.localParticipant.identity) return; // our own words
      let text = '';
      try { for await (const chunk of reader) { text += chunk; opts.onCaption && opts.onCaption(text, false); } } catch (e) {}
      // One stream per sentence, and every stream is attributed interim, so a
      // completed stream is a finished sentence.
      if (!text.trim()) return;
      opts.onCaption && opts.onCaption(text, true);
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'caption', text, final: true, id: info.id }));
    });

    // The avatar has arrived when its video is playing on the page.
    let arrived;
    const arrival = new Promise((resolve) => { arrived = resolve; });
    if (opts.video) {
      opts.video.muted = true; opts.video.playsInline = true;
      opts.video.addEventListener('playing', () => arrived(), { once: true });
    }
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Video) {
        if (opts.video) { track.attach(opts.video); opts.video.play().catch(() => {}); } else arrived();
      }
      if (track.kind === Track.Kind.Audio && opts.audio) track.attach(opts.audio);
    });
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const avatarSpeaking = speakers.some((p) => p.identity !== room.localParticipant.identity);
      opts.onSpeaking && opts.onSpeaking(avatarSpeaking);
    });
    room.on(RoomEvent.Disconnected, () => { linked = false; if (!ended) { ended = true; releaseMic(); opts.onEnd && opts.onEnd(); } });

    try {
      await room.connect(s.serverUrl, s.userToken);
      await room.startAudio().catch(() => {});
      if (opts.mic) {
        micTrack = (await room.localParticipant.publishTrack(opts.mic.getAudioTracks()[0], { source: Track.Source.Microphone, name: 'microphone' })).track;
      } else {
        await publishSilence(room);
      }
      phase('arriving');
      const timedOut = sleep(ARRIVAL_TIMEOUT_MS).then(() => 'timeout');
      if ((await Promise.race([arrival.then(() => 'ok'), timedOut])) === 'timeout') {
        throw failure('avatar did not arrive', 'The presenter did not arrive in time. This usually clears up on a second try.');
      }
    } catch (e) {
      ended = true; releaseMic(); room.disconnect(); ws.close(); await endOnServer();
      throw e.friendly ? e : failure(e.message, 'The connection failed. Check your network and try again.');
    }

    // The agent links the participant it listens to shortly after the avatar
    // appears; what is sent before that is not heard, so it waits briefly.
    await sleep(2500);
    linked = true;
    while (outbox.length) { const [t, x] = outbox.shift(); await room.localParticipant.sendText(x, { topic: t }); }
    const sendLinked = () => ws.send(JSON.stringify({ type: 'linked' }));
    if (ws.readyState === 1) sendLinked(); else ws.addEventListener('open', sendLinked, { once: true });
    phase('live', { maxSeconds: s.maxSeconds });
    addEventListener('pagehide', () => { if (!ended) navigator.sendBeacon(`/api/${opts.usecase}/session/end`); });
    return api;
  }

  async function publishSilence(room) {
    // Typing only: a silent track still marks this participant as the one the
    // agent listens to.
    const ctx = new AudioContext(); const dst = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator(); const gain = ctx.createGain(); gain.gain.value = 0; osc.connect(gain).connect(dst); osc.start();
    await room.localParticipant.publishTrack(dst.stream.getAudioTracks()[0], { name: 'silent-mic' });
  }

  // A minutes:seconds countdown for the session's time limit.
  function clock(seconds) { const m = Math.floor(seconds / 60), s = Math.max(0, seconds % 60); return `${m}:${String(s).padStart(2, '0')}`; }

  window.Atmee = { join, requestMic, clock, debug };
})();
