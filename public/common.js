// The client side every app shares: start the use case's session through our
// own server (the API key never reaches the browser), join the LiveKit room as
// the session's user, wait until the avatar can talk, relay what the server
// decides into the room, answer the avatar's app tool calls, and hand the
// avatar's words back.
//
//   const mic = await Atmee.requestMic();          // in the lobby, or null for typing only
//   const s = await Atmee.join({ usecase, video, audio, mic, tools,
//     onPhase(phase, detail), onCaption(text, final), onUserCaption(text, final, segmentId),
//     onSpeaking(bool), onVideo(bool), onMessage(msg), onRelay(topic, text), onEnd() });
//
// onCaption carries the avatar's words; onUserCaption the user's spoken words
// as recognised (interims of one utterance share a segment id, then a final).
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
  // The recogniser marks an utterance that cut into the avatar's turn, or a
  // short acknowledgement, with a tag in front of its text.
  const cleanUserText = (text) => text.replace(/^\s*\[(?:interruption|backchannel)\]\s*/i, '').trim();
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
    let linked = false, ended = false, micTrack = null;
    const stamp = () => new Date().toISOString().slice(11, 23);

    const floor = createFloor({
      send: (topic, text) => room.localParticipant.sendText(text, { topic }),
      onSent: (m, waited, forced) => {
        if (debug) console.log(`[atmee] ${stamp()} sent ${m.label} after ${waited} ms${forced ? ' (max wait, avatar still in turn)' : ''}`);
        opts.onRelay && opts.onRelay(m.label, `${m.topic === CHAT_TOPIC ? m.text : (JSON.parse(m.text).text || '')} [${stamp()}, held ${waited} ms]`);
      },
      onQueued: (m, inTurn) => { if (debug) console.log(`[atmee] ${stamp()} queued ${m.label}${inTurn ? ' (avatar in turn)' : ''}`); },
      onDropped: (m) => { if (debug) console.log(`[atmee] ${stamp()} dropped ${m.label} (scope ${m.scope} cancelled)`); },
    });
    const floorTimer = setInterval(floor.flush, 250);
    if (debug) window.__atmeeFloor = floor.snapshot;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/?usecase=${opts.usecase}&role=host`);
    const releaseMic = () => { if (opts.mic) opts.mic.getTracks().forEach((t) => t.stop()); };
    const endOnServer = () => fetch(`/api/${opts.usecase}/session/end`, { method: 'POST', keepalive: true }).catch(() => {});

    const api = {
      session: s, room, debug,
      say: (text, scope) => floor.enqueue(CHAT_TOPIC, text, 'lk.chat', null, scope),
      app: (message, scope) => floor.enqueue(APP_TOPIC, JSON.stringify(message), `atmee.app ${message.type}`, message, scope),
      user: (kind, text) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'user', kind, text })); },
      setMuted: async (muted) => { if (micTrack) { if (muted) await micTrack.mute(); else await micTrack.unmute(); } },
      hasMic: () => !!micTrack,
      end: async () => { ended = true; floor.close(); clearInterval(floorTimer); releaseMic(); await endOnServer(); ws.close(); room.disconnect(); },
    };

    ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'say') api.say(msg.text, msg.scope);
      else if (msg.type === 'app') api.app(msg.message, msg.scope);
      else if (msg.type === 'cancel') floor.cancel(msg.scope);
      else if (opts.onMessage) opts.onMessage(msg);
    };

    // The avatar has arrived when it can talk: its audio track, or its first
    // caption. Its face is not a gate (a stack without a renderer still talks).
    let arrived;
    const arrival = new Promise((resolve) => { arrived = resolve; });

    room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, async (reader, participant) => {
      const info = reader.info || {};
      if (participant && participant.identity === room.localParticipant.identity) return userCaption(reader, info);
      arrived();
      floor.captionStarted();
      let text = '';
      try { for await (const chunk of reader) { text += chunk; floor.captionProgress(); opts.onCaption && opts.onCaption(text, false); } } catch (e) {}
      floor.captionEnded();
      // One stream per sentence, and every stream is attributed interim, so a
      // completed stream is a finished sentence.
      if (!text.trim()) return;
      opts.onCaption && opts.onCaption(text, true);
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'caption', text, final: true, id: info.id }));
    });

    // The user's own words, as the agent's speech recognition heard them,
    // published under this participant's identity: each interim is a new
    // stream carrying the whole utterance so far, the last one is attributed
    // lk.transcription_final, and all of them share lk.segment_id. They are
    // never the avatar's turn, so they touch neither arrival nor the floor.
    async function userCaption(reader, info) {
      const attrs = info.attributes || {};
      const final = attrs['lk.transcription_final'] === 'true';
      const segment = attrs['lk.segment_id'] || info.id;
      let text = '';
      try { for await (const chunk of reader) text += chunk; } catch (e) {}
      text = cleanUserText(text);
      if (debug) console.log(`[atmee] ${stamp()} heard${final ? ' (final)' : ''} ${segment}: ${text}`);
      if (opts.onUserCaption && (text || final)) opts.onUserCaption(text, final, segment);
    }

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
      // Only the avatar's own speech counts: the user talking (a live mic) is
      // not the avatar's turn.
      const avatarSpeaking = speakers.some((p) => p.identity !== room.localParticipant.identity);
      floor.avatarSpeaking(avatarSpeaking);
      opts.onSpeaking && opts.onSpeaking(avatarSpeaking);
    });
    // The agent's own turn state (LiveKit agents: listening / thinking / speaking).
    room.on(RoomEvent.ParticipantAttributesChanged, (_changed, participant) => {
      if (!participant || participant.identity === room.localParticipant.identity) return;
      const st = participant.attributes && participant.attributes['lk.agent.state'];
      if (st !== undefined && floor.agentState(st) && debug) console.log(`[atmee] ${stamp()} agent ${st}`);
    });
    room.on(RoomEvent.Disconnected, () => { linked = false; floor.close(); clearInterval(floorTimer); if (!ended) { ended = true; releaseMic(); opts.onEnd && opts.onEnd(); } });

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
      ended = true; floor.close(); clearInterval(floorTimer); releaseMic(); room.disconnect(); ws.close(); await endOnServer();
      throw e.friendly ? e : failure(e.message, 'The connection failed. Check your network and try again.');
    }

    // The agent links the participant it listens to shortly after the avatar
    // arrives; what is sent before that is not heard, so it waits briefly.
    await sleep(2500);
    linked = true;
    floor.link();
    const sendLinked = () => ws.send(JSON.stringify({ type: 'linked' }));
    if (ws.readyState === 1) sendLinked(); else ws.addEventListener('open', sendLinked, { once: true });
    phase('live', { maxSeconds: s.maxSeconds, video: !!faceOn });
    addEventListener('pagehide', () => { if (!ended) navigator.sendBeacon(`/api/${opts.usecase}/session/end`); });
    return api;
  }

  // The floor: what the app relays waits for the avatar's turn to end. Staging
  // refuses a typed turn and drops commentary that lands in the middle of the
  // avatar's turn, so every lk.chat and atmee.app message is queued, in order,
  // until the turn has ended (and until the agent has linked this participant).
  //
  // - The turn has ended once the avatar has stopped speaking, no caption is
  //   streaming, and TURN_QUIET_MS has passed since its last speech or caption.
  //   Only the avatar's activity counts, never the user's. Its lk.agent.state
  //   counts too, once it has been seen to change.
  // - A flush between turns sends up to and including the first lk.chat, which
  //   starts the avatar's next turn; the rest waits for that one to end.
  // - The message at the head of the queue waits at most HOLD_MAX_MS, counted
  //   from when it became the head. When that runs out mid-turn, only that one
  //   is sent, and the next one starts its own wait.
  // - A newer state replaces a queued one. Messages can carry a scope; cancel(scope)
  //   drops what is still queued in it (the player left the shrine before its
  //   greeting was sent).
  function createFloor({ send, onSent = () => {}, onQueued = () => {}, onDropped = () => {}, now = () => Date.now() }) {
    const queue = [];
    let speaking = false, captions = 0, agent = '', agentLive = false, lastActivity = now(), headSince = now();
    let linked = false, closed = false, sending = false, lastState = null;
    const activity = () => { lastActivity = now(); };
    const inTurn = () => speaking || captions > 0 || (agentLive && (agent === 'speaking' || agent === 'thinking'));
    const newHead = () => { headSince = now(); };
    async function sendOne(m, forced) {
      if (m.state) { if (m.stateText === lastState) return false; lastState = m.stateText; }
      await send(m.topic, m.text);
      onSent(m, now() - m.at, forced);
      return true;
    }
    async function flush() {
      if (sending || !linked || closed || !queue.length) return;
      const free = !inTurn() && now() - lastActivity >= TURN_QUIET_MS;
      if (!free && now() - headSince < HOLD_MAX_MS) return;
      sending = true;
      try {
        if (!free) {
          // The head waited its full time: send it alone; the next one waits anew.
          const m = queue.shift(); newHead();
          await sendOne(m, true);
          if (m.topic === CHAT_TOPIC) activity();
          return;
        }
        while (queue.length) {
          const m = queue.shift(); newHead();
          await sendOne(m, false);
          if (m.topic === CHAT_TOPIC) { activity(); break; } // a turn starts: the rest waits for it
        }
      } finally { sending = false; }
    }
    return {
      enqueue(topic, text, label, message, scope) {
        const state = !!(message && message.type === 'state');
        if (state) for (let i = queue.length - 1; i >= 0; i--) if (queue[i].state) { queue.splice(i, 1); if (i === 0) newHead(); }
        if (!queue.length) newHead();
        const m = { topic, text, label, scope: scope || null, state, stateText: message && message.text, at: now() };
        queue.push(m);
        onQueued(m, inTurn());
        flush();
      },
      cancel(scope) {
        if (!scope) return;
        for (let i = queue.length - 1; i >= 0; i--) if (queue[i].scope === scope) { const [m] = queue.splice(i, 1); if (i === 0) newHead(); onDropped(m); }
      },
      avatarSpeaking(v) { if (v !== speaking) { speaking = v; activity(); } },
      captionStarted() { captions++; activity(); },
      captionProgress() { activity(); },
      captionEnded() { captions = Math.max(0, captions - 1); activity(); },
      agentState(st) { if (st === agent) return false; if (agent) agentLive = true; agent = st; activity(); return true; },
      link() { linked = true; newHead(); flush(); },
      close() { closed = true; },
      flush,
      snapshot: () => ({ speaking, agent, agentLive, captions, quietMs: now() - lastActivity, headWaitMs: now() - headSince, queued: queue.length }),
    };
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

  window.Atmee = { join, requestMic, clock, debug, createFloor };
})();
