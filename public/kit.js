// UI helpers every app shares: the stage overlay (connecting, errors), the
// transcript, the session countdown, the microphone button, icons, and the
// hidden debug log (?debug).
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const icon = {
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/></svg>',
    micOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 9.3V5a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 5 2.2M19 10a7 7 0 0 1-1.2 3.9M5 10a7 7 0 0 0 10.7 6M12 17v5M3 3l18 18"/></svg>',
    end: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.7 13.3a16 16 0 0 0 3.4 2.4l1.6-1.6a1.5 1.5 0 0 1 1.6-.3c1 .4 2 .6 3.1.7A1.5 1.5 0 0 1 21.7 16v3a1.5 1.5 0 0 1-1.6 1.5A18 18 0 0 1 3.5 3.9 1.5 1.5 0 0 1 5 2.3h3a1.5 1.5 0 0 1 1.5 1.3c.1 1.1.3 2.1.7 3.1a1.5 1.5 0 0 1-.3 1.6L8.3 9.9"/><path d="M22 2 2 22"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
    keyboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M8 16h8"/></svg>',
    retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    screen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  };

  // The stage overlay: one place that says what is happening before the
  // avatar is on screen, and what went wrong if it never is.
  // copy: { starting, warming, connecting, arriving } -> [title, detail]
  function stage(overlayEl, copy) {
    const order = ['starting', 'connecting', 'arriving'];
    function show(html) { overlayEl.hidden = false; overlayEl.innerHTML = `<div class="inner">${html}</div>`; }
    return {
      idle(html) { show(html); },
      phase(p, d) {
        if (p === 'live') { overlayEl.hidden = true; return; }
        let [title, detail] = copy[p] || ['Connecting…', ''];
        if (p === 'warming') detail = `${detail} ${d.waited ? `Waiting ${Math.round(d.waited / 60) ? Math.round(d.waited / 60) + ' min' : d.waited + ' s'} so far.` : ''}`;
        const at = p === 'warming' ? 0 : order.indexOf(p);
        const steps = order.map((_, i) => `<i class="${i < at ? 'done' : i === at ? 'now' : ''}"></i>`).join('');
        show(`<div class="spinner"></div><div class="title">${esc(title)}</div><div class="detail">${esc(detail.trim())}</div><div class="steps">${steps}</div>`);
      },
      error(message, retryLabel, onRetry) {
        show(`<div class="title">${esc(message)}</div>${onRetry ? `<button class="btn primary" type="button">${icon.retry}${esc(retryLabel || 'Try again')}</button>` : ''}`);
        const b = overlayEl.querySelector('button'); if (b) b.onclick = onRetry;
      },
      ended(html) { show(html); },
    };
  }

  // A chat-style transcript. avatar(text, final) grows one live bubble per
  // sentence and settles it when the sentence is complete. heard(text, final,
  // segment) does the same for the user's spoken words, one bubble per
  // segment. A typed turn comes back as a user transcription too; that echo
  // is not shown again.
  const ECHO_MS = 60000; // a typed turn can wait out a long avatar turn before it is sent
  const norm = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  function transcript(el, names) {
    let live = null, typed = [];
    const spoken = new Map(); // segment -> its live bubble
    const isEcho = (text, final) => {
      const n = norm(text), at = Date.now();
      typed = typed.filter((x) => at - x.at < ECHO_MS);
      const i = typed.findIndex((x) => (final ? x.n === n : x.n.startsWith(n)));
      if (i < 0) return false;
      if (final) typed.splice(i, 1);
      return true;
    };
    const stick = () => { el.scrollTop = el.scrollHeight; };
    function bubble(cls, who, text) {
      const d = document.createElement('div'); d.className = `bubble ${cls}`;
      d.innerHTML = `${who ? `<span class="who">${esc(who)}</span>` : ''}<span class="t"></span>`;
      d.querySelector('.t').textContent = text; el.appendChild(d); stick(); return d;
    }
    return {
      avatar(text, final) {
        if (!live) live = bubble('them live', names.avatar, text);
        live.querySelector('.t').textContent = text;
        if (final) { live.classList.remove('live'); live = null; }
        stick();
      },
      user(text, who) { typed.push({ n: norm(text), at: Date.now() }); bubble('me', who || names.user || 'You', text); },
      heard(text, final, segment) {
        let d = spoken.get(segment);
        if (!d && isEcho(text, final)) return;
        if (!text) { if (d) d.remove(); spoken.delete(segment); return; }
        if (!d) {
          // A new utterance settles one whose final never came.
          spoken.forEach((x) => x.classList.remove('live')); spoken.clear();
          d = bubble('me live', names.user || 'You', text); spoken.set(segment, d);
        }
        d.querySelector('.t').textContent = text;
        if (final) { d.classList.remove('live'); spoken.delete(segment); }
        stick();
      },
      other(text, who) { bubble('them', who, text); },
      note(text) { const d = document.createElement('div'); d.className = 'system-note'; d.textContent = text; el.appendChild(d); stick(); },
      clear() { el.innerHTML = ''; live = null; typed = []; spoken.clear(); },
    };
  }

  // Captions over the video: only the sentence being spoken (a stream can
  // carry a whole paragraph), at most two short lines, cleared after a pause.
  function tail(text, max = 110) {
    const parts = text.trim().split(/(?<=[.!?…])\s+/).filter(Boolean);
    let out = parts.pop() || '';
    if (out.length < 30 && parts.length) out = parts.pop() + ' ' + out;
    if (out.length > max) out = '…' + out.slice(out.length - max).replace(/^\S*\s/, '');
    return out;
  }
  function captions(el) {
    let t;
    return (text, final) => {
      clearTimeout(t); el.innerHTML = `<span>${esc(tail(text))}</span>`;
      if (final) t = setTimeout(() => { el.innerHTML = ''; }, 3500);
    };
  }

  // Counts down the session's time limit; onLow fires once near the end.
  function countdown(el, maxSeconds, onLow) {
    const until = Date.now() + maxSeconds * 1000; let warned = false;
    const tick = () => {
      const left = Math.max(0, Math.round((until - Date.now()) / 1000));
      el.textContent = Atmee.clock(left);
      if (!warned && left <= 60) { warned = true; onLow && onLow(); }
    };
    tick(); const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }

  // The microphone button: mutes and unmutes the user's mic in the session.
  function micButton(btn, session) {
    let muted = false;
    const paint = () => { btn.innerHTML = muted ? icon.micOff : icon.mic; btn.classList.toggle('off', muted); btn.title = muted ? 'Unmute' : 'Mute'; btn.setAttribute('aria-label', btn.title); };
    btn.hidden = !session.hasMic(); paint();
    btn.onclick = async () => { muted = !muted; paint(); await session.setMuted(muted); };
    return { set(m) { muted = m; paint(); } };
  }

  // ?debug: show what the app relays into the room.
  function debugLog() {
    if (!Atmee.debug) return () => {};
    const box = document.createElement('div'); box.className = 'debug'; document.body.appendChild(box);
    return (topic, text) => { const d = document.createElement('div'); d.innerHTML = `<b>${esc(topic)}</b> ${esc(text.slice(0, 220))}`; box.appendChild(d); box.scrollTop = 1e9; };
  }

  // Typed turns wait for the avatar to finish its sentence: a turn sent while
  // it speaks is dropped by the room, so the page holds it until it is quiet.
  function politeSender(getSession) {
    let speaking = false, timer = null; const queue = [];
    const flush = () => { while (queue.length && !speaking) { const [k, x] = queue.shift(); const s = getSession(); if (s) s.user(k, x); } };
    return {
      speaking(v) { speaking = v; clearTimeout(timer); if (!v) timer = setTimeout(flush, 700); },
      send(kind, text) { queue.push([kind, text]); if (!speaking) flush(); },
      get waiting() { return queue.length > 0 && speaking; },
    };
  }

  // A chat poll the host started (app tool start_poll): the question, a bar
  // per option, and, when onVote is given and the poll is open, a vote button.
  // msg: { question, options, votes, open, closesAt }
  function poll(el, msg, onVote, mine) {
    const total = msg.votes.reduce((a, b) => a + b, 0);
    const left = Math.max(0, Math.round((msg.closesAt - Date.now()) / 1000));
    el.hidden = false; el.className = `poll${msg.open ? '' : ' closed'}`;
    el.innerHTML = `<div class="q"><span>📊 ${esc(msg.question)}</span><small>${msg.open ? `${left} s left` : 'Final result'} · ${total} vote${total === 1 ? '' : 's'}</small></div>`
      + msg.options.map((o, i) => {
        const pct = total ? Math.round((msg.votes[i] / total) * 100) : 0;
        const tag = onVote && msg.open ? 'button type="button"' : 'div';
        return `<${tag} class="opt${mine === i ? ' mine' : ''}" data-i="${i}"><i style="width:${pct}%"></i><span>${esc(o)}</span><b>${pct}%</b></${tag.split(' ')[0]}>`;
      }).join('');
    if (onVote && msg.open) el.querySelectorAll('button.opt').forEach((b) => (b.onclick = () => onVote(Number(b.dataset.i))));
  }

  window.UI = { $, esc, icon, tail, stage, transcript, captions, countdown, micButton, debugLog, politeSender, poll };
})();
