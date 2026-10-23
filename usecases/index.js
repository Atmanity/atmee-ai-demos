// The five sample use cases: what each one tells the avatar, and when.
//
// Every policy speaks to the avatar through two room text streams, relayed by
// the host page: `say` becomes an `lk.chat` message (a user turn the avatar
// answers), `app` becomes an `atmee.app` message (state the avatar knows,
// a note it keeps, an event it comments on when it has the floor, or
// mute/unmute of the user's audio). A conductor, set through the API, is the
// avatar's fixed agenda for the conversation.
//
// App tools go the other way: what the avatar makes the app do. A use case's
// `appTools` ({ instructions, tools }) is sent with POST /v1/session; each call
// the avatar makes arrives at the host page (LiveKit RPC `atmee.tool`), whose
// handler updates the screen, and is passed on to `onTool(h, call)` here when
// the server must react too. Tools are described in the avatar's own role: the
// persona outweighs the tool instructions.
const say = (text) => ({ type: "say", text });
const state = (text) => ({ type: "app", message: { type: "state", text } });
const note = (text) => ({ type: "app", message: { type: "note", text } });
const event = (text, ttl_s = 20) => ({ type: "app", message: { type: "event", text, ttl_s } });
const mute = () => ({ type: "app", message: { type: "mute" } });
const unmute = () => ({ type: "app", message: { type: "unmute" } });
// An app tool in OpenAI's function shape; mode notify (the avatar goes on at
// once) or await (it waits for the page's answer, within timeoutSeconds).
const tool = (name, description, properties, required = [], atmee = { mode: "notify" }) =>
  ({ type: "function", name, description, parameters: { type: "object", properties, required, additionalProperties: false }, "x-atmee": atmee });

// ---------------------------------------------------------------------------
// 1. Live stream: one-way talking to a chatroom the host reads but never hears.
// ---------------------------------------------------------------------------
const POLL_SECONDS = 45;
const livestream = {
  title: "Live stream host (chat-only)",
  page: "livestream-host.html",
  appTools: {
    instructions: "You run this stream's chat as its host. When a viewer writes something worth keeping on screen for everyone (a great question, the topic of the night, a recommendation people asked for), pin it with pin_message, in a few words. When the chat disagrees, or you want the audience's opinion, start a poll with start_poll (two to four short options) and tell viewers to vote in the chat; the result comes back to you as a chat event when it closes. One poll at a time.",
    tools: [
      tool("pin_message", "Pin a short line to the top of the stream chat for every viewer to see; it replaces the last pin.", { text: { type: "string", minLength: 1, maxLength: 140 } }, ["text"]),
      tool("start_poll", `Start a chat poll viewers vote on for ${POLL_SECONDS} seconds; you hear the result when it closes.`, {
        question: { type: "string", minLength: 1, maxLength: 120 },
        options: { type: "array", minItems: 2, maxItems: 4, items: { type: "string", minLength: 1, maxLength: 40 } },
      }, ["question", "options"]),
    ],
  },
  onLinked(h) { h.memo.lastDigest = Date.now(); return [mute(), streamState(h)]; },
  onViewerChat(h, entry) {
    // A message that asks the host is a user turn; the rest goes into the digest.
    if (/\?|^@?host\b/i.test(entry.text)) return [say(`${entry.name} asks: ${entry.text}`)];
    h.pending.push(entry);
    return [];
  },
  // The host's tool calls are shown to the whole chat: the server keeps the pin
  // and the poll, and counts the viewers' votes.
  onTool(h, call, broadcast) {
    if (call.error) return [];
    if (call.name === "pin_message") { h.memo.pinned = call.arguments.text; broadcast({ type: "pin", text: h.memo.pinned }); return [streamState(h)]; }
    if (call.name === "start_poll") {
      const { question, options } = call.arguments;
      h.memo.poll = { id: call.id, question, options, votes: options.map(() => 0), voters: new Map(), closesAt: Date.now() + POLL_SECONDS * 1000, open: true };
      broadcast(pollMessage(h.memo.poll));
      return [streamState(h)];
    }
    return [];
  },
  onEnd(h, broadcast) { const p = h.memo.poll; if (p && p.open) { p.open = false; broadcast(pollMessage(p)); } },
  snapshot(h) { return [...(h.memo.pinned ? [{ type: "pin", text: h.memo.pinned }] : []), ...(h.memo.poll ? [pollMessage(h.memo.poll)] : [])]; },
  onVote(h, name, option, broadcast) {
    const p = h.memo.poll;
    if (!p || !p.open || !Number.isInteger(option) || option < 0 || option >= p.options.length) return;
    const before = p.voters.get(name);
    if (before !== undefined) p.votes[before]--;
    p.voters.set(name, option); p.votes[option]++;
    broadcast(pollMessage(p));
  },
  tick(h, broadcast) {
    const out = [];
    const p = h.memo.poll;
    if (p && p.open && Date.now() >= p.closesAt) {
      p.open = false; broadcast(pollMessage(p));
      const total = p.votes.reduce((a, b) => a + b, 0);
      const result = p.options.map((o, i) => `"${o}" ${p.votes[i]}`).join(", ");
      out.push(event(`Your poll "${p.question}" closed with ${total} vote(s): ${result}. Tell the chat the result in a sentence.`, 30), streamState(h));
    }
    if (Date.now() - (h.memo.lastDigest || 0) < 20000 || !h.pending.length) return out;
    const batch = h.pending.splice(0, h.pending.length);
    h.memo.lastDigest = Date.now();
    const summary = batch.slice(-6).map((m) => `${m.name}: "${m.text}"`).join("; ");
    return [...out, event(`New chat messages (${batch.length}): ${summary}. React to the chat in a sentence or two.`, 30), streamState(h)];
  },
};
const pollMessage = (p) => ({ type: "poll", id: p.id, question: p.question, options: p.options, votes: p.votes, open: p.open, closesAt: p.closesAt });
function streamState(h) {
  const recent = h.transcript.filter((m) => m.role === "viewer").slice(-5).map((m) => `${m.name}: ${m.text}`).join(" | ");
  const pinned = h.memo.pinned ? ` Pinned in the chat: "${h.memo.pinned}".` : "";
  const poll = h.memo.poll && h.memo.poll.open ? ` A poll is open: "${h.memo.poll.question}".` : "";
  return state(`You are hosting a live stream. ${h.viewers.size} viewer(s) are watching and typing in the chatroom. You cannot hear or see them; you only read their chat. Address viewers by the name shown. Recent chat: ${recent || "(quiet so far)"}.${pinned}${poll}`);
}

// ---------------------------------------------------------------------------
// 2. Recruiter platform: a regular back-and-forth interview, with an agenda.
// ---------------------------------------------------------------------------
const JOB = "Senior backend engineer (Go), remote, payments team. Must-haves: 5+ years, production Go, PostgreSQL, on-call experience. Nice: Kubernetes, LiveKit/WebRTC.";
const AGENDA_STEPS = ["greet", "background", "fit", "logistics", "questions", "wrap"];
const NOTE_TOPICS = ["current_role", "project", "years_experience", "production_go", "postgresql", "on_call", "notice_period", "location", "salary", "candidate_questions", "other"];
const recruiter = {
  title: "Recruiter screening call",
  page: "recruiter.html",
  speakAfterS: 1.0,
  conductor: {
    start: "greet",
    nodes: [
      { id: "greet", instructions: "You are the recruiter on a first screening call. Mark this step with set_agenda_step greet. Greet the candidate by name if you know it, say the call takes about ten minutes, and ask them to introduce themselves briefly.", edges: [{ to: "background", when: "The candidate has introduced themselves." }, { to: "greet" }] },
      { id: "background", instructions: "Mark this step with set_agenda_step background, then ask about their current role and the most relevant project for the job. One question at a time; follow up on specifics (scale, their own part, outcome).", edges: [{ to: "fit", when: "You have heard about their current role and one concrete project." }, { to: "background" }] },
      { id: "fit", instructions: "Mark this step with set_agenda_step fit, then check the must-haves of the job one by one in conversation: years of experience, production Go, PostgreSQL, on-call. Do not read the list; weave it in.", edges: [{ to: "logistics", when: "All four must-haves have been discussed." }, { to: "fit" }] },
      { id: "logistics", instructions: "Mark this step with set_agenda_step logistics, then ask about notice period, location/time zone and salary expectations, briefly.", edges: [{ to: "questions", when: "Logistics are covered." }, { to: "logistics" }] },
      { id: "questions", instructions: "Mark this step with set_agenda_step questions, then invite the candidate's questions about the role or the company and answer from the job description; say you will check what you do not know.", edges: [{ to: "wrap", when: "The candidate has no more questions." }, { to: "questions" }] },
      { id: "wrap", instructions: "First mark this step with set_agenda_step wrap, then thank them, say the next step is a technical interview within a week, and close warmly.", emotion: "warm" },
    ],
  },
  appTools: {
    instructions: "You keep the hiring team's screening notes in the call app while you talk. The candidate's agenda moves only when you mark it: each time the call moves to a new part, mark it with set_agenda_step, every step in order (greet, background, fit, logistics, questions, wrap), and always mark wrap before you thank the candidate and say goodbye. Each time the candidate has told you something the hiring team needs (current role, a project, years of experience, production Go, PostgreSQL, on-call, notice period, location or time zone, salary expectations, their questions), write it down in one short line with record_answer. Keep the conversation natural: never mention the agenda, the notes or marking them.",
    tools: [
      tool("set_agenda_step", "Mark the part of the call you are in now on the candidate's agenda: greet (introductions), background (current role and a project), fit (the must-haves), logistics (notice, location, salary), questions (the candidate's questions), wrap (next steps).", { step: { type: "string", enum: AGENDA_STEPS } }, ["step"]),
      tool("record_answer", "Write one line in the hiring team's screening notes about what the candidate just told you.", {
        topic: { type: "string", enum: NOTE_TOPICS },
        summary: { type: "string", minLength: 1, maxLength: 160, description: "One short factual line, e.g. '6 years of Go, payments at a fintech'." },
      }, ["topic", "summary"]),
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
  // The lesson is the conductor's: each slide is a step the trainer speaks
  // through on its own (`speak` edges), then the closing questions slide waits
  // for the trainee. The quiz is one last step, and the course app runs it:
  // its tools answer the trainer (await) with the question on the screen and,
  // once an answer is graded, what comes next, so the question order and the
  // end of the module never depend on the judge seeing a tool call.
  conductor: {
    start: "intro",
    nodes: [
      { id: "intro", instructions: "You are the trainer for a 10-minute module on incident response. Welcome the trainee, say there are three short slides, then a quick Q&A and a two-question quiz. Slide 1 is already on their screen: go straight into it without waiting.", edges: [{ to: "slide1", speak: true }] },
      { id: "slide1", instructions: `Teach slide 1 (already on the screen) in about four sentences, in your own words: "${SLIDES[0].body}" Then move on.`, edges: [{ to: "slide2", speak: true }] },
      { id: "slide2", instructions: `Put slide 2 up with show_slide, then teach it in about four sentences: "${SLIDES[1].body}" Give one example of what goes wrong when one person takes two roles. Then move on.`, edges: [{ to: "slide3", speak: true }] },
      { id: "slide3", instructions: `Put slide 3 up with show_slide, then teach it in about four sentences: "${SLIDES[2].body}" That is the last lesson slide.`, edges: [{ to: "questions", speak: true }] },
      { id: "questions", instructions: "First put up slide 4, the closing questions slide, with show_slide (unless the app state says it is on screen already). Ask whether the trainee has any questions before the quiz, and answer the ones they ask about the three slides, briefly. Do not start the quiz until they say they have none or ask for it.", edges: [{ to: "quiz", when: "The trainee said they have no (more) questions, or asked to start the quiz." }, { to: "questions" }] },
      { id: "quiz", instructions: `Run the two-question quiz; the course app decides which question comes next. Call ask_quiz_question with n 1 and ask the question it returns, in its words, then wait for the trainee's answer. When they answer, judge it (the right answers: question 1, ${QUIZ[0].a}; question 2, ${QUIZ[1].a}; close enough counts), record it with grade_answer, and then do exactly what its result tells you. Grade only the trainee's own answer to the question on screen, given after you asked it; when you speak again on your own (they are quiet), never grade: repeat the question or ask whether they need a hint. Never ask a question again once it is graded.`, emotion: "warm" },
    ],
  },
  // The deck, the quiz and the score are the course app's: the trainer puts
  // each slide up and records each verdict, and the page shows them at once
  // and answers with what is on the screen now. The deck opens on slide 1.
  appTools: {
    instructions: "You teach from the course app's slide deck on the trainee's screen, and the app runs the quiz and keeps the score; the screen changes only when you use these. Slide 1 is already up when you start. Put slide 2 and slide 3 up with show_slide as you move on to them, and slide 4, the closing questions slide, when you invite questions. When the quiz starts, call ask_quiz_question and ask the question it returns. As soon as you have judged an answer, record it with grade_answer (the question number and whether it was right) before you tell the trainee, and follow its result: it gives you the next question, or the final score once the quiz is over.",
    tools: [
      tool("show_slide", "Put a slide on the trainee's screen as you move on to it: lesson slide 2 or 3, or 4, the closing questions slide before the quiz.", { n: { type: "integer", minimum: 1, maximum: 4 } }, ["n"]),
      tool("ask_quiz_question", "Put quiz question n (1 or 2) on the trainee's screen; the app answers with the question to ask, or the one to ask instead if n is already graded.", { n: { type: "integer", minimum: 1, maximum: 2 } }, ["n"], { mode: "await", timeoutSeconds: 5 }),
      tool("grade_answer", "Record your verdict on the trainee's answer to the quiz question on screen, so the course app counts their score; the app answers with what to do next (the next question, or the final score). Once per question.", {
        question: { type: "integer", minimum: 1, maximum: 2 },
        correct: { type: "boolean" },
        feedback: { type: "string", maxLength: 160, description: "One short line shown under the question, e.g. 'Only the incident commander decides.'" },
      }, ["question", "correct"], { mode: "await", timeoutSeconds: 5 }),
    ],
  },
  slides: SLIDES,
  onLinked(h) { h.memo.score = 0; h.memo.slide = h.memo.slide || 1; return [state(trainingState(h))]; },
  onUser(h, msg) {
    if (msg.kind === "slide") { h.memo.slide = Number(msg.text); return [state(trainingState(h))]; }
    // The page counts the score from grade_answer, and the state carries it.
    if (msg.kind === "score") { h.memo.score = Number(msg.text) || 0; return [state(trainingState(h))]; }
    // Which quiz question is on screen and how many are graded, as "<on>/<graded>".
    if (msg.kind === "quiz") { const [on, graded] = String(msg.text).split("/").map(Number); h.memo.quiz = { on, graded }; return [state(trainingState(h))]; }
    if (msg.kind === "typed") return [say(msg.text)];
    return [];
  },
};
function trainingState(h) {
  const s = SLIDES.find((x) => x.id === h.memo.slide);
  const q = h.memo.quiz;
  const screen = q ? (q.graded >= 2 ? "the quiz is over" : `quiz question ${q.on}`) : `slide ${s ? `${s.id} "${s.title}"` : h.memo.slide === 4 ? '4, the closing "Questions?" slide' : "1"}`;
  return `Training app state. On screen: ${screen}. Quiz questions graded: ${q ? q.graded : 0} of 2; score so far: ${h.memo.score || 0} of 2. The trainee answers by voice or by typing.`;
}

// ---------------------------------------------------------------------------
// 4. Presence / companion: the avatar watches the user's screen (through an
//    observer the app runs) and speaks up when something meaningful changes.
//    No app tools: here information only flows from the app to the avatar
//    (state and events); the companion has nothing to make the app do.
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
  // Only the oracle at the shrine uses them: the island's secrets are the
  // game's, so the oracle asks the game (await) instead of guessing.
  appTools: {
    instructions: "These are the oracle's powers, used only while the player kneels at the oracle's shrine. The oracle does not know the island's layout by heart: when the player asks where something lies (the key, the chest, the map), always consult the island with reveal_clue first and answer from what it tells you, cryptic but true; the place then glows on the player's map. When the player asks for help, light or a blessing, you may grant one gift with give_item: the lantern lights the tiles around them, the charm brings luck. A gift is real only once give_item has put it in the satchel: call it before you speak of giving anything. Never use these powers away from the shrine.",
    tools: [
      tool("reveal_clue", "As the oracle, ask the island where something lies; it is marked on the player's map and you are told where it is.", { seek: { type: "string", enum: ["key", "chest", "map"] } }, ["seek"], { mode: "await", timeoutSeconds: 5 }),
      tool("give_item", "As the oracle, put a gift in the player's satchel: the lantern (lights the tiles around them) or the charm (luck). Saying you give it is not enough: call this whenever you hand the player anything.", { item: { type: "string", enum: ["lantern", "charm"] } }, ["item"]),
    ],
  },
  onLinked(h) { h.memo.talking = false; return [mute(), state("You are the narrator of a short treasure-hunt game on a 4x4 island map. You speak ONLY when the game tells you something happened, in one or two vivid sentences, and never ask the player questions, except at the oracle's shrine where the player may talk to you.")]; },
  onUser(h, msg) {
    if (msg.kind === "move") return [event(msg.text, 12)];
    if (msg.kind === "enter_shrine") { h.memo.talking = true; return [unmute(), state("The player is at the oracle's shrine and may now talk to you. Answer as the oracle: cryptic but helpful, two sentences at most. You can reveal where the key, the chest or the map lies, and grant one gift. When they leave, you go back to narrating only."), event("The player kneels at the oracle's shrine. Greet them as the oracle and invite one question.", 10)]; }
    if (msg.kind === "leave_shrine") { h.memo.talking = false; return [mute(), state("The player left the shrine. Back to narrating only: speak only when the game tells you something happened.")]; }
    if (msg.kind === "typed" && h.memo.talking) return [say(msg.text)];
    return [];
  },
};

export const USECASES = { livestream, recruiter, training, presence, game };
