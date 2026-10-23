// Live-test helpers, imported into an app page from the devtools (or a browser
// driver): a synthetic microphone fed from WAV files in tools/live-test/audio, typing,
// clicking, and a step log. Never touches a real microphone or camera.
//
//   const h = await import('/tools/live-test/harness.js');
//   h.install();                       // before pressing Start
//   await h.speak('clue');             // plays tools/live-test/audio/clue.wav into the "microphone"
//   h.type('Is it Rome?'); h.click('I give up');
//   await h.waitAvatar(1, 20000);      // until one more avatar line arrives
const ctx = new AudioContext();
const dest = ctx.createMediaStreamDestination();
const t0 = performance.now();
export const log = [];

// A real microphone is never digitally silent; neither is this one (about -60 dBFS
// of noise), or Opus DTX starves the uplink and the session is torn down.
function noiseFloor() {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.001;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.connect(dest);
  src.start();
}

export function install() {
  noiseFloor();
  navigator.mediaDevices.getUserMedia = async () => { await ctx.resume(); return dest.stream; };
  // Log each connection phase as the stage shows it, and the first caption.
  let last = '';
  new MutationObserver(() => {
    const title = document.documentElement.dataset.call || '';
    if (title && title !== last) { last = title; mark(`phase: ${title}`); }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-call'] });
}

export async function speak(name) {
  await ctx.resume();
  const buf = await ctx.decodeAudioData(await (await fetch(`/tools/live-test/audio/${name}.wav`)).arrayBuffer());
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(dest);
  src.start();
  mark(`speak ${name}`);
  return new Promise((r) => { src.onended = r; });
}

export function type(text) {
  const input = document.querySelector('.call-input, .kit-input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (input.form) input.form.requestSubmit();
  else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  mark(`type ${text}`);
}

export function click(label) {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase().includes(label.toLowerCase()) && !b.disabled);
  el?.click();
  mark(`click ${label}${el ? '' : ' (NOT FOUND)'}`);
  return Boolean(el);
}

// Every finished line, from the kit's window event: independent of the app's layout.
const said = [];
addEventListener('atmee:line', (e) => said.push(e.detail));
// Every tool call the host makes, in the log.
addEventListener('atmee:tool', (e) => mark(`TOOL ${e.detail.name} ${JSON.stringify(e.detail.arguments)}`));
export const lines = () => said.map((l) => `${l.who === 'avatar' ? 'AVATAR' : 'USER'}: ${l.text}`);
export const avatarCount = () => said.filter((l) => l.who === 'avatar').length;
export const live = () => document.documentElement.dataset.call === 'live';
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitLive(ms = 240000) {
  for (let i = 0; i < ms / 500 && !live(); i++) await wait(500);
  mark(live() ? 'live' : 'NOT LIVE');
  return live();
}

export const speaking = () => document.documentElement.dataset.speaking === 'true';

/** Until the avatar has said something new and then been quiet for `quietMs`, as a user would wait. */
export async function waitTurn(ms = 40000, quietMs = 2500) {
  const target = avatarCount() + 1;
  const until = Date.now() + ms;
  while (Date.now() < until && avatarCount() < target) await wait(250);
  let quietSince = Date.now();
  while (Date.now() < until) {
    if (speaking()) quietSince = Date.now();
    else if (Date.now() - quietSince >= quietMs) break;
    await wait(200);
  }
}

/** Until `more` avatar lines arrive after now (or the timeout), then a settle pause. */
export async function waitAvatar(more = 1, ms = 25000, settle = 2500) {
  const target = avatarCount() + more;
  for (let i = 0; i < ms / 250 && avatarCount() < target; i++) await wait(250);
  await wait(settle);
}

export function mark(label, extra) {
  log.push({ t: +((performance.now() - t0) / 1000).toFixed(1), label, ...(extra ? { extra } : {}) });
}

/** The log plus the conversation, for reading back. */
export const report = () => ({ log, lines: lines() });
