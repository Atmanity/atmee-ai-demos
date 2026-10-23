// Nightcap's video relay: the studio forwards the avatar it sees to each
// viewer, browser to browser.
//
// The Avatar API gives one user token per session, so only the studio page is
// in the LiveKit room. It takes the avatar's remote video and audio tracks and
// sends them to every viewer over its own RTCPeerConnection; server.js only
// relays the offer, answer and ICE candidates between the two pages, keyed by
// the viewer's connection id. Public STUN only: this works where the browsers
// can reach each other directly (a LAN, a tailnet), not behind strict NATs.
//
//   const relay = StreamRelay.streamer({ room, key, onCount(watching, max) });  // studio, once live; key = its session's
//   relay.stop();
//
//   const watch = StreamRelay.viewer({ video, send, onState(state, detail) }); // viewer page
//   watch.connected();     the chat socket (re)opened: ask to watch
//   watch.handle(msg);     a message from the server; true when it was the relay's
//   watch.disconnected();  the chat socket closed
//
// Viewer states: offline (no stream) -> tuning (the stream is on, media not
// yet playing) -> playing; full (no free spot: max viewers already watch).
(function () {
  const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
  const wsUrl = (role) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/?usecase=livestream&role=${role}`;
  const newId = () => Math.random().toString(36).slice(2, 10);

  // ---------------------------------------------------------------------------
  // The studio: one sending peer connection per watching viewer.
  // ---------------------------------------------------------------------------
  function streamer({ room, key, onCount = () => {} }) {
    const { RoomEvent, Track } = LivekitClient;
    const peers = new Map(); // viewer id -> { pc, id, video, audio }
    let tracks = { video: null, audio: null }, max = 0, stopped = false, ws = null, retry = null;

    // The avatar's current tracks, from whichever remote participant publishes them.
    function current() {
      const out = { video: null, audio: null };
      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) {
          const t = pub.track && pub.track.mediaStreamTrack;
          if (!t || t.readyState === 'ended') continue;
          if (pub.kind === Track.Kind.Video && !out.video) out.video = t;
          if (pub.kind === Track.Kind.Audio && !out.audio) out.audio = t;
        }
      }
      return out;
    }
    // A track that arrives, leaves or is swapped later reaches every viewer by
    // replaceTrack on its sender: no new offer is needed.
    function refresh() {
      const next = current();
      if (next.video === tracks.video && next.audio === tracks.audio) return;
      tracks = next;
      for (const p of peers.values()) { p.video.replaceTrack(tracks.video).catch(() => {}); p.audio.replaceTrack(tracks.audio).catch(() => {}); }
    }
    const events = [RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackPublished, RoomEvent.ParticipantDisconnected];
    events.forEach((e) => room.on(e, refresh));
    const poll = setInterval(refresh, 2000);

    const send = (msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
    const count = () => onCount([...peers.values()].filter((p) => p.pc.connectionState === 'connected').length, max);

    function close(viewer) {
      const p = peers.get(viewer); if (!p) return;
      peers.delete(viewer); p.pc.close(); count();
    }
    async function open(viewer) {
      close(viewer);
      const pc = new RTCPeerConnection({ iceServers: ICE });
      const stream = new MediaStream();
      const video = pc.addTransceiver('video', { direction: 'sendonly', streams: [stream] }).sender;
      const audio = pc.addTransceiver('audio', { direction: 'sendonly', streams: [stream] }).sender;
      const p = { pc, id: newId(), video, audio, chain: Promise.resolve() };
      peers.set(viewer, p);
      if (tracks.video) video.replaceTrack(tracks.video).catch(() => {});
      if (tracks.audio) audio.replaceTrack(tracks.audio).catch(() => {});
      pc.onicecandidate = (e) => { if (e.candidate) send({ type: 'rtc', to: viewer, data: { pc: p.id, candidate: e.candidate.toJSON() } }); };
      pc.onconnectionstatechange = count;
      try {
        await pc.setLocalDescription(await pc.createOffer());
        send({ type: 'rtc', to: viewer, data: { pc: p.id, sdp: pc.localDescription.toJSON() } });
      } catch (e) { close(viewer); }
    }
    function answer(viewer, data) {
      const p = peers.get(viewer);
      if (!p || data.pc !== p.id) return; // for a connection this page no longer has
      p.chain = p.chain.then(() => (data.sdp ? p.pc.setRemoteDescription(data.sdp) : data.candidate ? p.pc.addIceCandidate(data.candidate) : null)).catch(() => {});
    }

    function connect() {
      if (stopped) return;
      ws = new WebSocket(`${wsUrl('streamer')}&key=${encodeURIComponent(key)}`); // the server binds it to this studio's session
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'watchers') { max = msg.max; msg.ids.forEach(open); count(); }
        else if (msg.type === 'watcher') open(msg.id);
        else if (msg.type === 'watcher-left') close(msg.id);
        else if (msg.type === 'rtc') answer(msg.from, msg.data);
      };
      // The server may restart under a live stream: reconnect, and the viewers
      // that still watch come back in the next watcher list.
      ws.onclose = () => { for (const id of [...peers.keys()]) close(id); if (!stopped) retry = setTimeout(connect, 1500); };
    }
    refresh();
    connect();

    return {
      stop() {
        if (stopped) return; stopped = true;
        clearTimeout(retry); clearInterval(poll);
        events.forEach((e) => room.off(e, refresh));
        for (const id of [...peers.keys()]) close(id);
        if (ws) ws.close();
      },
      stats: () => ({ tracks: { video: !!tracks.video, audio: !!tracks.audio }, peers: [...peers.entries()].map(([viewer, p]) => ({ viewer, state: p.pc.connectionState })) }),
    };
  }

  // ---------------------------------------------------------------------------
  // A viewer: one receiving peer connection, made anew for each offer.
  // ---------------------------------------------------------------------------
  function viewer({ video, send, onState = () => {} }) {
    let pc = null, pcId = null, chain = Promise.resolve(), state = '', live = false, recheck = null, fullRetry = null, turnedAway = false;
    const set = (s, d) => { if (s === state && !d) return; state = s; onState(s, d || {}); };

    video.muted = true; video.playsInline = true; video.autoplay = true;
    video.addEventListener('playing', () => { if (pc) set('playing'); });

    function drop() {
      if (pc) pc.close();
      pc = null; pcId = null; chain = Promise.resolve();
      video.srcObject = null;
      clearTimeout(recheck);
    }
    // When the media does not start, ask again: the studio makes a fresh offer.
    function watchSoon(ms) {
      clearTimeout(recheck);
      recheck = setTimeout(() => { if (live && state !== 'playing') send({ type: 'watch' }); }, ms);
    }

    function offer(data) {
      drop();
      pcId = data.pc;
      pc = new RTCPeerConnection({ iceServers: ICE });
      const stream = new MediaStream();
      pc.ontrack = (e) => {
        if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
        if (video.srcObject !== stream) video.srcObject = stream;
        video.play().catch(() => {});
      };
      pc.onicecandidate = (e) => { if (e.candidate) send({ type: 'rtc', data: { pc: pcId, candidate: e.candidate.toJSON() } }); };
      const mine = pc;
      pc.onconnectionstatechange = () => {
        if (mine !== pc) return;
        if (mine.connectionState === 'failed') { set('tuning'); watchSoon(1000); }
      };
      chain = chain.then(async () => {
        await mine.setRemoteDescription(data.sdp);
        await mine.setLocalDescription(await mine.createAnswer());
        send({ type: 'rtc', data: { pc: data.pc, sdp: mine.localDescription.toJSON() } });
      }).catch(() => { if (mine === pc) watchSoon(2000); });
      watchSoon(15000);
    }

    return {
      connected() { set(live ? 'tuning' : 'offline'); send({ type: 'watch' }); },
      disconnected() { drop(); clearTimeout(fullRetry); if (live) set('tuning'); },
      handle(msg) {
        if (msg.type === 'stream') {
          live = !!msg.live;
          if (!live) { drop(); set('offline'); } else if (state !== 'playing') set('tuning');
          if (live && turnedAway) send({ type: 'watch' }); // the cap counts again now: full, or a spot
          return true;
        }
        if (msg.type === 'watching') { turnedAway = false; clearTimeout(fullRetry); if (state === 'full') set(live ? 'tuning' : 'offline'); return true; }
        if (msg.type === 'watch-full') {
          // Full only matters while something is on: offline, the page says offline
          // and keeps asking, so it holds a spot once the stream starts.
          turnedAway = true; drop(); if (live) set('full', { max: msg.max }); else set('offline');
          clearTimeout(fullRetry); fullRetry = setTimeout(() => send({ type: 'watch' }), 10000);
          return true;
        }
        if (msg.type === 'rtc') {
          const d = msg.data || {};
          if (d.sdp && d.sdp.type === 'offer') { set('tuning'); offer(d); }
          else if (d.candidate && pc && d.pc === pcId) { const mine = pc; chain = chain.then(() => mine.addIceCandidate(d.candidate)).catch(() => {}); }
          return true;
        }
        return false;
      },
      // For the page's checks (and ?debug): the receiving connection.
      get pc() { return pc; },
    };
  }

  window.StreamRelay = { streamer, viewer };
})();
