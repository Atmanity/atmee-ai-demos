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
// The page holds relays until the avatar's turn ends. Messages that only make
// sense together can share a scope, and cancel(scope) drops the ones still
// held: leaving the shrine before its greeting went out drops the greeting.
const inScope = (scope, messages) => messages.map((m) => ({ ...m, scope }));
const cancel = (scope) => ({ type: "cancel", scope });
// An app tool in OpenAI's function shape; mode notify (the avatar goes on at
// once) or await (it waits for the page's answer, within timeoutSeconds).
const tool = (name, description, properties, required = [], atmee = { mode: "notify" }) =>
  ({ type: "function", name, description, parameters: { type: "object", properties, required, additionalProperties: false }, "x-atmee": atmee });

// ---------------------------------------------------------------------------
// 1. Live stream: one-way talking to a chatroom the host reads but never hears.
// ---------------------------------------------------------------------------
const POLL_SECONDS = 45;
const livestream = {
  title: "Live stream host",
  page: "livestream-host.html",
  // One streamer's session, shared by every viewer in the chatroom; the other
  // apps give each visitor a session of their own.
  shared: true,
  appTools: {
    instructions: "You run this stream's chat as its host, and the chat only shows what your tools put there. When a viewer asks you to pin something, or writes something worth keeping on screen for everyone (a great question, the topic of the night, a recommendation people asked for), pin it with pin_message, in a few words. When a viewer asks for a poll, or the chat disagrees and you want the audience's opinion, call start_poll right away in that turn (two to four short options), then tell viewers to vote: do not offer a poll, or say you might start one, without starting it. A pin or a poll exists only once its tool is called, so call it before you speak of it. The result comes back to you as a chat event when the poll closes. One poll at a time.",
    tools: [
      tool("pin_message", "Pin a short line to the top of the stream chat for every viewer to see; it replaces the last pin.", { text: { type: "string", minLength: 1, maxLength: 140 } }, ["text"]),
      tool("start_poll", `Start a chat poll viewers vote on for ${POLL_SECONDS} seconds; you hear the result when it closes. Call it whenever you would run, start or launch a poll.`, {
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
// The candidate can drop their CV into the call. The host's runtime reads each
// file once, reacts to the drop on its own and is told the file's summary on
// every later reply, so the app sends no event about it (the recruiter would
// speak of it twice): only this note, kept all call, on how a screening uses a CV.
const CV_NOTE = "The candidate can share their CV with you during the call (a PDF, a photo of it or a text file). When it arrives, react as a recruiter would: thank them, name one or two things you read that matter for this job (their current role, their experience with Go), and carry on with the part of the call you are in. From then on, fit your questions to it: ask about the roles and projects it names, by name, the one closest to this job first; where it already speaks to a must-have, ask about what it says instead of asking from scratch (it lists Go at a company: was that in production, and for how long?). Say so when something comes from the CV (\"I see on your CV that…\"). Never say the CV shows anything it does not; for a must-have it does not mention, just ask. The screening notes are what the candidate tells you: confirm a detail from the CV with them before you record it. Until they share one, interview as usual and do not ask for it.";
const recruiter = {
  title: "Recruiter screening call",
  page: "recruiter.html",
  speakAfterS: 1.0,
  conductor: {
    start: "greet",
    nodes: [
      { id: "greet", instructions: "You are the recruiter on a first screening call. Mark this step with set_agenda_step greet. Greet the candidate by name if you know it, say the call takes about ten minutes, and ask them to introduce themselves briefly.", edges: [{ to: "background", when: "The candidate has introduced themselves." }, { to: "greet" }] },
      { id: "background", instructions: "Mark this step with set_agenda_step background, then ask about their current role and the most relevant project for the job. If they shared their CV, ask about a role and a project it names, by name, the one closest to this job first ('I see on your CV you led…'). One question at a time; follow up on specifics (scale, their own part, outcome).", edges: [{ to: "fit", when: "You have heard about their current role and one concrete project." }, { to: "background" }] },
      { id: "fit", instructions: "Mark this step with set_agenda_step fit, then check the must-haves of the job one by one in conversation: years of experience, production Go, PostgreSQL, on-call. Do not read the list; weave it in. Where their CV already speaks to one, ask about what it says instead of asking from scratch.", edges: [{ to: "logistics", when: "All four must-haves have been discussed." }, { to: "fit" }] },
      { id: "logistics", instructions: "Mark this step with set_agenda_step logistics, then ask about notice period, location/time zone and salary expectations, briefly.", edges: [{ to: "questions", when: "Logistics are covered." }, { to: "logistics" }] },
      { id: "questions", instructions: "Mark this step with set_agenda_step questions, then invite the candidate's questions about the role or the company. Answer only from the job description you were given; for anything it does not say (team size, interview process, benefits, tech beyond the list), say you do not have that in front of you and the hiring team will follow up. Never make up numbers or details.", edges: [{ to: "wrap", when: "The candidate has no more questions." }, { to: "questions" }] },
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
  onLinked(h) { return [state(`Job you are screening for: ${JOB} Candidate name: ${h.memo.candidate || "unknown"}.`), note(CV_NOTE)]; },
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
const COMPANION = "You are a quiet companion sitting next to the user while they work. You see their screen through short descriptions the app sends you. Speak only when something noteworthy happens or when spoken to; keep it to one or two sentences; never narrate routine activity.";
// The user can also hand the companion their screen as a picture (Show Kin this) or a
// file. The host's runtime reads each, speaks of it once by itself and is told of it on
// every later reply, so the app sends no event about it: only this note, kept all session.
const SHOWN_NOTE = "The user can also show you their screen as a picture (Show Kin this) or share a file with you (a stack trace, a log, code, a screenshot). Then you see it yourself, beyond the short descriptions: react to it once, briefly, in your own words, and when they ask about it, answer from what it actually shows, quoting the exact line, name or number that matters; look at the file itself for a detail your first look missed. Never say it shows anything it does not.";
const presence = {
  title: "Presence / companion (screen observer)",
  page: "presence.html",
  // A state replaces the one before, so each one carries the companion's role.
  onLinked(h) { return [state(COMPANION), note(SHOWN_NOTE)]; },
  onObservation(h, seen) {
    const out = [state(`${COMPANION} What the user's screen shows now: ${seen.description}`)];
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
    instructions: "You narrate this island, and at the oracle's shrine you also voice the oracle; these are the oracle's powers, used only while the player kneels there. The island's secrets belong to the game, not to your tale: when the player asks where something lies (the key, the chest, the map), call reveal_clue first and answer from what it tells you, cryptic but true; the place then glows on the player's map. When the player asks for help, light, luck or protection, grant a gift with give_item: the lantern for light (it lights the tiles around them), the charm for luck. Your tale and the player's satchel must agree: whenever your words hand over, bestow or grant anything, call give_item for it first, in that same turn, even for a second gift; if it answers that they already carry it, say so instead. Never use these powers away from the shrine.",
    tools: [
      tool("reveal_clue", "As the oracle, ask the island where something lies; it is marked on the player's map and you are told where it is.", { seek: { type: "string", enum: ["key", "chest", "map"] } }, ["seek"], { mode: "await", timeoutSeconds: 5 }),
      tool("give_item", "As the oracle, put a gift in the player's satchel: the lantern (light; lights the tiles around them) or the charm (luck, protection). The satchel only holds what this call puts there: call it every time the oracle hands, bestows or grants the player anything, before you speak of it.", { item: { type: "string", enum: ["lantern", "charm"] } }, ["item"]),
    ],
  },
  onLinked(h) { h.memo.talking = false; return [mute(), state("You are the narrator of a short treasure-hunt game on a 4x4 island map. You speak ONLY when the game tells you something happened, in one or two vivid sentences, and never ask the player questions, except at the oracle's shrine where the player may talk to you.")]; },
  onUser(h, msg) {
    if (msg.kind === "move") return [event(msg.text, 12)];
    if (msg.kind === "enter_shrine") { h.memo.talking = true; return inScope("shrine", [unmute(), state("The player is at the oracle's shrine and may now talk to you. Answer as the oracle: cryptic but helpful, two sentences at most. You can reveal where the key, the chest or the map lies (reveal_clue), and grant the lantern or the charm (give_item). When they leave, you go back to narrating only."), event("The player kneels at the oracle's shrine. Greet them as the oracle and invite one question.", 10)]); }
    if (msg.kind === "leave_shrine") { h.memo.talking = false; return [cancel("shrine"), mute(), state("The player left the shrine. Back to narrating only: speak only when the game tells you something happened.")]; }
    if (msg.kind === "typed" && h.memo.talking) return inScope("shrine", [say(msg.text)]);
    return [];
  },
};

// ---------------------------------------------------------------------------
// 6. Spellcraft (Silverfell): a private spell lesson with Draconia Malvane.
//    She reads the student's school of magic, teaches two of its spells and
//    sets a trial; the student casts on their screen, tracing a sigil and
//    saying its words. The grimoire is the page's: it holds the spellbook,
//    answers her tools with what to teach, judges every cast and reports it
//    here, and this turns it into the state she reads and the event she
//    reacts to.
// ---------------------------------------------------------------------------
const spellcraft = {
  title: "Spellcraft: a private spell lesson",
  page: "spellcraft.html",
  // Each step's edges carry its own check, with a loop back: a step's
  // instructions stay in force until the judge sees it done.
  conductor: {
    start: "appraise",
    nodes: [
      { id: "appraise", instructions: "This is a private spell lesson; the student's grimoire is on their screen and fills in as you use your tools. Greet the student (by name once you know it) and size them up: ask three short questions, one at a time, to read their affinity, for example what they would do with one afternoon of real power, what they are secretly afraid of, which hour of the day feels most like theirs. After their third answer, choose the school that fits them and reveal it with reveal_affinity, then tell them with a flourish what it says about them.", edges: [{ to: "lesson", when: "Draconia has revealed the student's school of magic." }, { to: "appraise" }] },
      { id: "lesson", instructions: "Teach the two spells of the student's school, one at a time, in the order the app gave you. For each: put it on their casting circle with teach_spell, say its words slowly, tell them to trace the sigil in one stroke from the bright dot and then say the words, and wait for them to cast. The app tells you how each cast went: react to that result, and let them try again after a fizzle. Teach the second spell only once the first has held (shaky or better).", edges: [{ to: "trial", when: "The student has cast both of their spells, and the second one held (shaky or better)." }, { to: "lesson" }] },
      { id: "trial", instructions: "Set the student's trial: invent one short, vivid situation that one of their two spells answers (a corridor gone pitch dark, a door that must be held shut), put it up with set_trial naming the spell that answers it, describe it, and ask them to choose and cast. Never name the answer. When the app tells you their trial cast, judge it: the right spell with a cast that held passes; otherwise say what went wrong and let them try once more.", edges: [{ to: "verdict", when: "Draconia has judged the student's trial cast." }, { to: "trial" }] },
      { id: "verdict", instructions: "Give your verdict. Decide their rank honestly from their casts and their trial (Novice, Apprentice, Adept, Spellwright or Magister; a first lesson rarely earns more than Adept) and write it on their certificate with award_rank, with a one-line remark in your voice. Then tell them, with a flash of real warmth under the frost, and bid them goodbye.", emotion: "proud" },
    ],
  },
  // Lenient schemas: Causeur refuses arguments that miss the schema before the
  // page sees them, so names are free text and the page matches them.
  appTools: {
    instructions: "You teach in the student's lesson app: their grimoire, casting circle and certificate are on their screen and change only when you use these. The moment you decide the student's school, reveal it with reveal_affinity, before you announce it; it tells you the two spells you will teach. Put each spell on their casting circle with teach_spell before you teach it, one at a time, in that order. Put the trial up with set_trial before you describe it, and write their rank with award_rank before you announce it. Casting is the student's: they trace and speak on their screen, and the app tells you each result as an event. Never pretend a cast happened or judge one before the app tells you; when the student says an incantation aloud, the result follows a moment later, so just wait for it. Never mention the tools or the app; stay in your world.",
    tools: [
      tool("reveal_affinity", "Reveal the student's school of magic in their grimoire, with your one-line reading of them. The app answers with the two spells of that school to teach, in order.", {
        school: { type: "string", description: "One of Ember, Tide, Gale, Thorn, Gloam, Lumen." },
        reading: { type: "string", description: "Your reading of the student in one short line, shown under the crest, e.g. 'Too stubborn to stay down.'" },
      }, ["school"], { mode: "await", timeoutSeconds: 5 }),
      tool("teach_spell", "Put one of the student's two spells on their casting circle so they can trace its sigil and say its words. The app answers with what to tell them.", {
        spell: { type: "string", description: "The spell's name, or 1 or 2 for its place in the order." },
      }, ["spell"], { mode: "await", timeoutSeconds: 5 }),
      tool("set_trial", "Put the student's trial on their screen: a short situation that one of their two spells answers.", {
        challenge: { type: "string", description: "The situation, in one or two sentences, e.g. 'The corridor ahead has gone pitch dark, and something is breathing in it.'" },
        answer: { type: "string", description: "The name of the spell that answers it." },
      }, ["challenge", "answer"], { mode: "await", timeoutSeconds: 5 }),
      tool("award_rank", "Write the student's rank on their certificate of rank, with your remark.", {
        rank: { type: "string", description: "Novice, Apprentice, Adept, Spellwright or Magister." },
        remark: { type: "string", description: "One line in your voice for the certificate." },
      }, ["rank", "remark"], { mode: "await", timeoutSeconds: 5 }),
    ],
  },
  onLinked(h) { return [state(spellcraftState(h))]; },
  onUser(h, msg) {
    // The page sends the student's name once, the whole grimoire after every change, and each cast.
    if (msg.kind === "student") { h.memo.student = String(msg.text || "").trim().slice(0, 40); return [note(studentNote(h.memo.student)), state(spellcraftState(h))]; }
    if (msg.kind === "book") { h.memo.book = safeJson(msg.text); return [state(spellcraftState(h))]; }
    if (msg.kind === "cast") { const c = safeJson(msg.text); return c ? [event(castEvent(c), 25)] : []; }
    if (msg.kind === "typed") return [say(msg.text)];
    return [];
  },
};
const safeJson = (text) => { try { return JSON.parse(text); } catch { return null; } };
function studentNote(name) {
  return name ? `The student's name is ${name}. Use it now and then, as a teacher would.` : "The student gave no name; call them darling until they tell you.";
}
function spellcraftState(h) {
  const b = h.memo.book || {};
  const spells = Array.isArray(b.spells) ? b.spells : [];
  const parts = [`Spell lesson app state. Student: ${h.memo.student || "unnamed"}.`];
  if (!b.school) parts.push("Their school: not revealed yet.");
  else {
    parts.push(`Their school: ${b.school}${b.reading ? ` (your reading: "${b.reading}")` : ""}.`);
    parts.push(`Its two spells, in teaching order: ${spells.map((s, i) => `${i + 1}) ${s.name}, sigil ${s.sigil}; it ${s.does}; ${s.taught ? (s.casts ? `taught, cast ${s.casts} time${s.casts === 1 ? "" : "s"}, best power ${s.best}` : "taught, not cast yet") : "not taught yet"}`).join("; ")}.`);
    if (b.active) parts.push(`On their casting circle now: ${b.active}.`);
  }
  if (b.trial) parts.push(`Trial set: "${b.trial.challenge}" (answered by ${b.trial.answer}); ${b.trial.cast ? `they cast ${b.trial.cast}, power ${b.trial.power}` : "not cast yet"}.`);
  if (b.rank) parts.push(`Rank awarded: ${b.rank}.`);
  parts.push("They talk to you by voice or by typing, and cast on their screen; the app tells you each cast's result.");
  return parts.join(" ");
}
const TIERS = {
  brilliant: "a brilliant cast: the spell blazed",
  solid: "a solid cast: the spell held",
  shaky: "a shaky cast: the spell sputtered and barely held",
  fizzled: "it fizzled into a puff of smoke",
};
function castEvent(c) {
  const heard = String(c.words || "").replace(/["\n]/g, " ").trim().slice(0, 60);
  const words = c.spoken ? "spoke its words clearly" : heard ? `said the wrong words ("${heard}")` : "never said its words, and a sigil alone is half a spell";
  const cast = `The student just cast ${c.spell}: their sigil was ${c.accuracy}% true and they ${words}. Power ${c.power} of 100, ${TIERS[c.tier] || c.tier}.`;
  if (c.trial) return `${cast} This was their trial cast. The trial is answered by ${c.answer}, so they chose ${c.rightSpell ? "the right spell" : "the wrong spell"}. Judge the trial now, in character, in two or three sentences.`;
  return `${cast} React in one or two sentences, in character: grudging, then real, praise for a strong cast; for a weak one, the one thing to fix (the sigil or the words, whichever was worse); after a fizzle, have them try again.`;
}

export const USECASES = { livestream, recruiter, training, presence, game, spellcraft };
