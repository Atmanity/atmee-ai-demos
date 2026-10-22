// The five sample use cases: what each one tells the avatar, and when.
//
// Every policy speaks to the avatar through two room text streams, relayed by
// the host page: `say` becomes an `lk.chat` message (a user turn the avatar
// answers), `app` becomes an `atmee.app` message (state the avatar knows,
// a note it keeps, an event it comments on when it has the floor, or
// mute/unmute of the user's audio). A conductor, set through the API, is the
// avatar's fixed agenda for the conversation.
const say = (text) => ({ type: "say", text });
const state = (text) => ({ type: "app", message: { type: "state", text } });
const note = (text) => ({ type: "app", message: { type: "note", text } });
const event = (text, ttl_s = 20) => ({ type: "app", message: { type: "event", text, ttl_s } });
const mute = () => ({ type: "app", message: { type: "mute" } });
const unmute = () => ({ type: "app", message: { type: "unmute" } });

// ---------------------------------------------------------------------------
// 1. Live stream: one-way talking to a chatroom the host reads but never hears.
// ---------------------------------------------------------------------------
const livestream = {
  title: "Live stream host (chat-only)",
  page: "livestream-host.html",
  onLinked(h) { h.memo.lastDigest = Date.now(); return [mute(), streamState(h)]; },
  onViewerChat(h, entry) {
    // A message that asks the host is a user turn; the rest goes into the digest.
    if (/\?|^@?host\b/i.test(entry.text)) return [say(`${entry.name} asks: ${entry.text}`)];
    h.pending.push(entry);
    return [];
  },
  tick(h) {
    if (Date.now() - (h.memo.lastDigest || 0) < 20000 || !h.pending.length) return [];
    const batch = h.pending.splice(0, h.pending.length);
    h.memo.lastDigest = Date.now();
    const summary = batch.slice(-6).map((m) => `${m.name}: "${m.text}"`).join("; ");
    return [event(`New chat messages (${batch.length}): ${summary}. React to the chat in a sentence or two.`, 30), streamState(h)];
  },
};
function streamState(h) {
  const recent = h.transcript.filter((m) => m.role === "viewer").slice(-5).map((m) => `${m.name}: ${m.text}`).join(" | ");
  return state(`You are hosting a live stream. ${h.viewers.size} viewer(s) are watching and typing in the chatroom. You cannot hear or see them; you only read their chat. Address viewers by the name shown. Recent chat: ${recent || "(quiet so far)"}`);
}

// ---------------------------------------------------------------------------
// 2. Recruiter platform: a regular back-and-forth interview, with an agenda.
// ---------------------------------------------------------------------------
const JOB = "Senior backend engineer (Go), remote, payments team. Must-haves: 5+ years, production Go, PostgreSQL, on-call experience. Nice: Kubernetes, LiveKit/WebRTC.";
const recruiter = {
  title: "Recruiter screening call",
  page: "recruiter.html",
  speakAfterS: 1.0,
  conductor: {
    start: "greet",
    nodes: [
      { id: "greet", instructions: "You are the recruiter on a first screening call. Greet the candidate by name if you know it, say the call takes about ten minutes, and ask them to introduce themselves briefly.", edges: [{ to: "background", when: "The candidate has introduced themselves." }, { to: "greet" }] },
      { id: "background", instructions: "Ask about their current role and the most relevant project for the job. One question at a time; follow up on specifics (scale, their own part, outcome).", edges: [{ to: "fit", when: "You have heard about their current role and one concrete project." }, { to: "background" }] },
      { id: "fit", instructions: "Check the must-haves of the job one by one in conversation: years of experience, production Go, PostgreSQL, on-call. Do not read the list; weave it in.", edges: [{ to: "logistics", when: "All four must-haves have been discussed." }, { to: "fit" }] },
      { id: "logistics", instructions: "Ask about notice period, location/time zone and salary expectations, briefly.", edges: [{ to: "questions", when: "Logistics are covered." }, { to: "logistics" }] },
      { id: "questions", instructions: "Invite the candidate's questions about the role or the company and answer from the job description; say you will check what you do not know.", edges: [{ to: "wrap", when: "The candidate has no more questions." }, { to: "questions" }] },
      { id: "wrap", instructions: "Thank them, say the next step is a technical interview within a week, and close warmly.", emotion: "warm" },
    ],
  },
  onLinked(h) { return [state(`Job you are screening for: ${JOB} Candidate name: ${h.memo.candidate || "unknown"}.`)]; },
  onUser(h, msg) {
    if (msg.kind === "name") { h.memo.candidate = msg.text; return [state(`Job you are screening for: ${JOB} Candidate name: ${msg.text}.`)]; }
    if (msg.kind === "typed") return [say(msg.text)];
    return [];
  },
};

// ---------------------------------------------------------------------------
// 3. Internal training: lecture segments the avatar speaks through on its own,
//    a Q&A, then a quiz. The app keeps the slide and the score in state.
// ---------------------------------------------------------------------------
const SLIDES = [
  { id: 1, title: "Why incident response", body: "Every minute of an outage costs trust. Incident response is a practiced routine, not heroics." },
  { id: 2, title: "Roles", body: "Incident commander runs the call. Communications lead updates stakeholders. Operators fix. Nobody does two roles." },
  { id: 3, title: "The first ten minutes", body: "Declare, assign roles, open the channel, post the first status update within ten minutes, even if it says 'investigating'." },
];
const QUIZ = [
  { q: "Who is the only person allowed to decide to roll back during an incident?", a: "the incident commander" },
  { q: "By when should the first status update go out?", a: "within ten minutes" },
];
const training = {
  title: "Internal training: lesson, Q&A, quiz",
  page: "training.html",
  speakAfterS: 1.5,
  conductor: {
    start: "intro",
    nodes: [
      { id: "intro", instructions: "You are the trainer for a 10-minute module on incident response. Welcome the trainee, say there are three short slides, then a quick Q&A and a two-question quiz. Then go straight into slide 1 without waiting.", edges: [{ to: "slide1", speak: true }] },
      { id: "slide1", instructions: `Teach slide 1 in about four sentences, in your own words: "${SLIDES[0].body}" Then move on.`, edges: [{ to: "slide2", speak: true }] },
      { id: "slide2", instructions: `Teach slide 2 in about four sentences: "${SLIDES[1].body}" Give one example of what goes wrong when one person takes two roles. Then move on.`, edges: [{ to: "slide3", speak: true }] },
      { id: "slide3", instructions: `Teach slide 3 in about four sentences: "${SLIDES[2].body}" Then ask whether the trainee has questions before the quiz.`, edges: [{ to: "qna" }] },
      { id: "qna", instructions: "Answer the trainee's questions about the three slides. If they have none, say so and start the quiz.", edges: [{ to: "quiz1", when: "The trainee has no more questions, or asked to start the quiz." }, { to: "qna" }] },
      { id: "quiz1", instructions: `Quiz question 1: "${QUIZ[0].q}" Wait for the answer. Begin your verdict with the word "Correct" or "Incorrect" (the answer is: ${QUIZ[0].a}), then say why in one sentence.`, edges: [{ to: "quiz2", when: "The trainee has answered question 1 and you have told them whether it was right." }, { to: "quiz1" }] },
      { id: "quiz2", instructions: `Quiz question 2: "${QUIZ[1].q}" Wait for the answer. Begin your verdict with the word "Correct" or "Incorrect" (the answer is: ${QUIZ[1].a}).`, edges: [{ to: "wrap", when: "The trainee has answered question 2 and you have told them whether it was right." }, { to: "quiz2" }] },
      { id: "wrap", instructions: "Give the score out of two from the app state, one sentence of encouragement, and close the module.", emotion: "warm" },
    ],
  },
  slides: SLIDES,
  onLinked(h) { h.memo.score = 0; return [state(trainingState(h))]; },
  onUser(h, msg) {
    if (msg.kind === "slide") { h.memo.slide = Number(msg.text); return [state(trainingState(h))]; }
    if (msg.kind === "typed") return [say(msg.text)];
    return [];
  },
  onAvatarSaid(h, text) {
    // The app keeps score from what the trainer says, and shows it in state.
    if (/^\W*(correct|spot on|that'?s right|exactly right|well done)/i.test(text) && (h.memo.score || 0) < 2) { h.memo.score = (h.memo.score || 0) + 1; return [state(trainingState(h))]; }
    return [];
  },
};
function trainingState(h) {
  const s = SLIDES.find((x) => x.id === h.memo.slide);
  return `Training app state. Slide on screen: ${s ? `${s.id} "${s.title}"` : "title slide"}. Quiz score so far: ${h.memo.score || 0} of 2. The trainee answers by voice or by typing.`;
}

// ---------------------------------------------------------------------------
// 4. Presence / companion: the avatar watches the user's screen (through an
//    observer the app runs) and speaks up when something meaningful changes.
// ---------------------------------------------------------------------------
const presence = {
  title: "Presence / companion (screen observer)",
  page: "presence.html",
  onLinked(h) { return [state("You are a quiet companion sitting next to the user while they work. You see their screen through short descriptions the app sends you. Speak only when something noteworthy happens or when spoken to; keep it to one or two sentences; never narrate routine activity.")]; },
  onObservation(h, seen) {
    const out = [state(`What the user's screen shows now: ${seen.description}`)];
    if (seen.noteworthy) out.push(event(`Something changed on the user's screen: ${seen.noteworthy}. React briefly if it deserves a word; otherwise stay quiet.`, 15));
    return out;
  },
  onUser(h, msg) { return msg.kind === "typed" ? [say(msg.text)] : []; },
};

// ---------------------------------------------------------------------------
// 5. Interactive game / story: the narrator speaks only on game events, and
//    conversation is allowed only in certain places (the oracle's shrine).
// ---------------------------------------------------------------------------
const game = {
  title: "Interactive story (event-driven narrator)",
  page: "game.html",
  onLinked(h) { h.memo.talking = false; return [mute(), state("You are the narrator of a short treasure-hunt game on a 4x4 island map. You speak ONLY when the game tells you something happened, in one or two vivid sentences, and never ask the player questions, except at the oracle's shrine where the player may talk to you.")]; },
  onUser(h, msg) {
    if (msg.kind === "move") return [event(msg.text, 12)];
    if (msg.kind === "enter_shrine") { h.memo.talking = true; return [unmute(), state("The player is at the oracle's shrine and may now talk to you. Answer as the oracle: cryptic but helpful, two sentences at most. When they leave, you go back to narrating only."), event("The player kneels at the oracle's shrine. Greet them as the oracle and invite one question.", 10)]; }
    if (msg.kind === "leave_shrine") { h.memo.talking = false; return [mute(), state("The player left the shrine. Back to narrating only: speak only when the game tells you something happened.")]; }
    if (msg.kind === "typed" && h.memo.talking) return [say(msg.text)];
    return [];
  },
};

export const USECASES = { livestream, recruiter, training, presence, game };
