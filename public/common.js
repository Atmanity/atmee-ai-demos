// The client side every app shares: start the use case's session through our
// own server (the API key never reaches the browser), join the LiveKit room as
// the session's user, wait until the avatar can talk, relay what the server
// decides into the room, answer the avatar's app tool calls, and hand the
// avatar's words back.
//
//   const mic = await Atmee.requestMic();          // in the lobby, or null for typing only
//   const s = await Atmee.join({ usecase, video, audio, mic, tools,
//     onPhase(phase, detail), onCaption(text, final), onSpeaking(bool), onVideo(bool),
//     onMessage(msg), onRelay(topic, text), onEnd() });
//   s.user(kind, text)  tell the server what the user did (the use case decides)
//   s.setMuted(bool)    mute or unmute the user's microphone
//   s.end()
//
// tools: one function per app tool the use case declares (usecases/index.js),
// given the call's arguments and { id }. What it returns is the result an
// `await` tool gives the avatar (an object is sent as JSON, nothing as "ok");
// what it throws, the avatar hears as "error: <message>". A `notify` tool's
// answer is ignored, so it should return quickly. Every call is also passed to
// the server, which may react to it (the stream's chat shows a poll).
//
// Phases: starting -> warming (the rendering pool is cold; retried) ->
// connecting -> arriving (in the room, waiting for the avatar) -> live.
// The avatar has arrived when it can talk (its voice or its first caption);
// its face is attached whenever it comes, and until then the stage carries the
// class `no-face` (onVideo(false)). join() rejects with an Error whose
// .friendly says what to tell the user.
(function () {
  const { Room, RoomEvent, RpcError, Track } = LivekitClient;
  const CHAT_TOPIC = 'lk.chat', APP_TOPIC = 'atmee.app', TRANSCRIPTION_TOPIC = 'lk.transcription';
  const TOOL_METHOD = 'atmee.tool'; // an app tool call, as an RPC; the reply is its result
  const ARRIVAL_TIMEOUT_MS = 90000, WARMING_LIMIT_MS = 6 * 60000;
  // What the app relays waits for the avatar's turn to end: it is between turns
  // once it has stopped speaking, no caption is streaming, and that has lasted
  // TURN_QUIET_MS (a sentence boundary is shorter); the agent's own
  // lk.agent.state counts too, but only once it has been seen to change
  // (staging sets it to "speaking" once and leaves it). Nothing waits longer
  // than HOLD_MAX_MS.
  const TURN_QUIET_MS = 1500, HOLD_MAX_MS = 15000;
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
    const stamp = () => new Date().toISOString().slice(11, 23);

    // The floor. Staging refuses a typed turn and drops commentary that lands
    // in the middle of the avatar's turn, so every lk.chat and atmee.app message
    // is queued, in order, until the turn has ended (and until the agent has
    // linked this participant). A flush sends up to and including the first
    // lk.chat, which starts the avatar's next turn; the rest waits for that one
    // to end. A newer state replaces a queued one.
    let avatarSpeaking = false, agentState = '', agentStateLive = false, openCaptions = 0, lastActivity = Date.now(), sending = false;
    const queue = [];
    const inTurn = () => avatarSpeaking || openCaptions > 0 || (agentStateLive && (agentState === 'speaking' || agentState === 'thinking'));
    const activity = () => { lastActivity = Date.now(); };
    function enqueue(topic, text, label, message) {
      if (message && message.type === 'state') for (let i = queue.length - 1; i >= 0; i--) if (queue[i].state) queue.splice(i, 1);
      queue.push({ topic, text, label, state: !!(message && message.type === 'state'), stateText: message && message.text, at: Date.now() });
      if (debug) console.log(`[atmee] ${stamp()} queued ${label}${inTurn() ? ' (avatar in turn)' : ''}`);
      flush();
    }
    async function flush() {
      if (sending || !linked || !queue.length || ended) return;
      const now = Date.now(), held = now - queue[0].at;
      const free = !inTurn() && now - lastActivity >= TURN_QUIET_MS;
      if (!free && held < HOLD_MAX_MS) return;
      sending = true;
      try {
        while (queue.length) {
          const m = queue.shift();
          if (m.state) { if (m.stateText === lastState) continue; lastState = m.stateText; }
          await room.localParticipant.sendText(m.text, { topic: m.topic });
          const waited = Date.now() - m.at;
          if (debug) console.log(`[atmee] ${stamp()} sent ${m.label} after ${waited} ms${free ? '' : ' (max wait, avatar still in turn)'}`);
          opts.onRelay && opts.onRelay(m.label, `${m.topic === CHAT_TOPIC ? m.text : (JSON.parse(m.text).text || '')} [${stamp()}, held ${waited} ms]`);
          if (m.topic === CHAT_TOPIC) { activity(); break; } // a turn starts: the rest waits for it
        }
      } finally { sending = false; }
    }
    const floorTimer = setInterval(flush, 250);
    if (debug) window.__atmeeFloor = () => ({ avatarSpeaking, agentState, agentStateLive, openCaptions, quietMs: Date.now() - lastActivity, queued: queue.length });
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/?usecase=${opts.usecase}&role=host`);
    const releaseMic = () => { if (opts.mic) opts.mic.getTracks().forEach((t) => t.stop()); };
    const endOnServer = () => fetch(`/api/${opts.usecase}/session/end`, { method: 'POST', keepalive: true }).catch(() => {});

    const api = {
      session: s, room, debug,
      say: (text) => enqueue(CHAT_TOPIC, text, 'lk.chat'),
      app: (message) => enqueue(APP_TOPIC, JSON.stringify(message), `atmee.app ${message.type}`, message),
      user: (kind, text) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'user', kind, text })); },
      setMuted: async (muted) => { if (micTrack) { if (muted) await micTrack.mute(); else await micTrack.unmute(); } },
      hasMic: () => !!micTrack,
      end: async () => { ended = true; clearInterval(floorTimer); releaseMic(); await endOnServer(); ws.close(); room.disconnect(); },
    };

    ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'say') api.say(msg.text);
      else if (msg.type === 'app') api.app(msg.message);
      else if (opts.onMessage) opts.onMessage(msg);
    };

    // The avatar has arrived when it can talk: its audio track, or its first
    // caption. Its face is not a gate (a stack without a renderer still talks).
    let arrived;
    const arrival = new Promise((resolve) => { arrived = resolve; });

    room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, async (reader, participant) => {
      const info = reader.info || {};
      if (participant && participant.identity === room.localParticipant.identity) return; // our own words
      arrived();
      openCaptions++; activity();
      let text = '';
      try { for await (const chunk of reader) { text += chunk; activity(); opts.onCaption && opts.onCaption(text, false); } } catch (e) {}
      openCaptions--; activity();
      // One stream per sentence, and every stream is attributed interim, so a
      // completed stream is a finished sentence.
      if (!text.trim()) return;
      opts.onCaption && opts.onCaption(text, true);
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'caption', text, final: true, id: info.id }));
    });

    // App tool calls arrive as an RPC to this participant; registered before
    // connecting, so no call finds the page without a handler.
    if (opts.tools) {
      room.registerRpcMethod(TOOL_METHOD, async ({ payload }) => {
        const { id, name, arguments: args } = JSON.parse(payload);
        const run = Object.prototype.hasOwnProperty.call(opts.tools, name) ? opts.tools[name] : null;
        if (debug) console.log('[atmee] tool', name, args);
        opts.onRelay && opts.onRelay(`atmee.tool ${name}`, JSON.stringify(args || {}));
        if (typeof run !== 'function') throw new RpcError(1500, `the app has no tool ${name}`);
        let reply;
        try {
          const result = await run(args || {}, { id });
          reply = result === undefined || result === null ? 'ok' : typeof result === 'string' ? result : JSON.stringify(result);
        } catch (e) {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'tool', id, name, arguments: args, error: String(e.message || e) }));
          throw new RpcError(1500, String((e && e.message) || e).slice(0, 200));
        }
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'tool', id, name, arguments: args, result: reply }));
        return reply;
      });
    }

    // The face: attached whenever it arrives; until it plays the stage shows
    // a voice-only placeholder (class no-face).
    const stageEl = opts.video && opts.video.closest('.stage');
    let faceOn = null;
    const showFace = (on) => {
      if (on === faceOn) return; faceOn = on;
      if (stageEl) stageEl.classList.toggle('no-face', !on);
      opts.onVideo && opts.onVideo(on);
    };
    showFace(false);
    if (opts.video) {
      opts.video.muted = true; opts.video.playsInline = true;
      opts.video.addEventListener('playing', () => showFace(true));
    }
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Video) {
        if (opts.video) { track.attach(opts.video); opts.video.play().catch(() => {}); } else showFace(true);
      }
      if (track.kind === Track.Kind.Audio) { if (opts.audio) track.attach(opts.audio); arrived(); }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === Track.Kind.Video) { if (opts.video) track.detach(opts.video); showFace(false); }
    });
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      avatarSpeaking = speakers.some((p) => p.identity !== room.localParticipant.identity); activity();
      opts.onSpeaking && opts.onSpeaking(avatarSpeaking);
    });
    // The agent's own turn state (LiveKit agents: listening / thinking / speaking).
    room.on(RoomEvent.ParticipantAttributesChanged, (_changed, participant) => {
      if (!participant || participant.identity === room.localParticipant.identity) return;
      const st = participant.attributes && participant.attributes['lk.agent.state'];
      if (st !== undefined && st !== agentState) { if (agentState) agentStateLive = true; agentState = st; activity(); if (debug) console.log(`[atmee] ${stamp()} agent ${st}`); }
    });
    room.on(RoomEvent.Disconnected, () => { linked = false; clearInterval(floorTimer); if (!ended) { ended = true; releaseMic(); opts.onEnd && opts.onEnd(); } });

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
        throw failure('avatar did not join', 'The presenter did not arrive in time. This usually clears up on a second try.');
      }
    } catch (e) {
      ended = true; clearInterval(floorTimer); releaseMic(); room.disconnect(); ws.close(); await endOnServer();
      throw e.friendly ? e : failure(e.message, 'The connection failed. Check your network and try again.');
    }

    // The agent links the participant it listens to shortly after the avatar
    // arrives; what is sent before that is not heard, so it waits briefly.
    await sleep(2500);
    linked = true;
    flush();
    const sendLinked = () => ws.send(JSON.stringify({ type: 'linked' }));
    if (ws.readyState === 1) sendLinked(); else ws.addEventListener('open', sendLinked, { once: true });
    phase('live', { maxSeconds: s.maxSeconds, video: !!faceOn });
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
