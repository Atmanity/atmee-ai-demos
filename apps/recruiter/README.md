# Northwind Talent: a first-round screening call with an AI recruiter

A ten-minute screening for a Senior Backend Engineer (Go) role. The recruiter follows a fixed
agenda, takes notes for the hiring team as the candidate answers, reads the CV the candidate
shares in the call and asks about it, and answers questions only from the job description.

- Page: [`public/recruiter.html`](../../public/recruiter.html)
- Behaviour: the `recruiter` section of [`usecases/index.js`](../../usecases/index.js) (about lines 107–148)
- Shared: [`server.js`](../../server.js) (API key, sessions, conductor, relay), [`public/common.js`](../../public/common.js) (room, tools, relay hold)

## Use case

For recruiting platforms that want structured first-round screens at any hour.

1. The candidate sees a pre-join screen with the job card, enters a name, and joins with a
   microphone or by typing.
2. The recruiter greets them by name and asks for a short introduction.
3. A "Your CV" box under the call takes the candidate's CV (a PDF, an image or a text file),
   dropped anywhere on the call or chosen, with an optional line. The recruiter takes a look,
   says what stands out, and from then on asks about the roles and projects on it.
4. The live agenda (Introductions → Your background → Must-haves → Logistics → Your
   questions → Next steps) moves as the recruiter goes, and a "Screening notes" panel fills
   with one line per answer (experience, project, Go, PostgreSQL, on-call, notice, location,
   salary, questions).
5. The candidate asks questions. Anything the job description doesn't cover, the recruiter
   says the hiring team will follow up on.
6. The recruiter wraps up (next step: a technical interview within a week). The candidate
   leaves to a thank-you screen.

## Architecture

```mermaid
flowchart LR
  P["recruiter.html<br/>(the session's user)"] <-- "WebSocket: name, typed turns, relays, tool calls" --> S["server.js<br/>holds ATMEE_API_KEY"]
  S -- "PUT /v1/avatars/{id}/conductor<br/>POST /v1/session (+appTools)<br/>POST /v1/session/{id}/end" --> A["Atmee Avatar API"]
  A --> R["LiveKit room + recruiter avatar"]
  P <-- "mic audio · lk.chat · atmee.app state, note · atmee.file (the CV) ➜<br/>⬅ lk.transcription · RPC atmee.tool · atmee.file.status" --> R
```

## How it uses the Atmee API

**1. Conductor** ([`server.js`](../../server.js) `ensureConductor`, about line 131). Every step except the last
moves on a judged condition and otherwise stays:

```http
PUT /v1/avatars/{avatarId}/conductor
{ "speakAfterS": 1.0, "graph": { "start": "greet", "nodes": [
  { "id": "greet",      "instructions": "Mark this step with set_agenda_step greet. Greet the candidate by name …",
    "edges": [{ "to": "background", "when": "The candidate has introduced themselves." }, { "to": "greet" }] },
  { "id": "background", "edges": [{ "to": "fit",       "when": "You have heard about their current role and one concrete project." }, { "to": "background" }] },
  { "id": "fit",        "edges": [{ "to": "logistics", "when": "All four must-haves have been discussed." }, { "to": "fit" }] },
  { "id": "logistics",  "edges": [{ "to": "questions", "when": "Logistics are covered." }, { "to": "logistics" }] },
  { "id": "questions",  "instructions": "… Answer only from the job description you were given; … Never make up numbers or details.",
    "edges": [{ "to": "wrap", "when": "The candidate has no more questions." }, { "to": "questions" }] },
  { "id": "wrap", "emotion": "warm", "instructions": "First mark this step with set_agenda_step wrap, then thank them …" }
] } }
```

Each step's instructions start with "Mark this step with set_agenda_step <step>", because the
page's agenda moves only through that tool.

**2. Session with app tools** ([`server.js`](../../server.js) `startSession`, about line 141):

```http
POST /v1/session
{ "avatarId": "<avatarId from apps/recruiter/avatar.json>", "maxDurationSeconds": 900,
  "appTools": { "instructions": "You keep the hiring team's screening notes in the call app while you talk. The candidate's agenda moves only when you mark it … always mark wrap before you thank the candidate and say goodbye. … never mention the agenda, the notes or marking them.",
    "tools": [
      { "type": "function", "name": "set_agenda_step", "parameters": { "type": "object", "properties": { "step": { "type": "string", "enum": ["greet","background","fit","logistics","questions","wrap"] } }, "required": ["step"] }, "x-atmee": { "mode": "notify" } },
      { "type": "function", "name": "record_answer",   "parameters": { "type": "object", "properties": { "topic": { "type": "string", "enum": ["current_role","project","years_experience","production_go","postgresql","on_call","notice_period","location","salary","candidate_questions","other"] }, "summary": { "type": "string", "maxLength": 160 } }, "required": ["topic","summary"] }, "x-atmee": { "mode": "notify" } } ] } }
```

**3. Room messages the page sends**:

| when | message |
|---|---|
| linked, and when the name is known | `atmee.app` `{"type":"state","text":"Job you are screening for: Senior backend engineer (Go), remote, payments team. Must-haves: … Candidate name: Alex Chen."}` |
| linked | `atmee.app` `{"type":"note","text":"The candidate can share their CV with you during the call …"}`, kept all call (see [The CV](#the-cv)) |
| the candidate types instead of speaking | `lk.chat` with the text |
| the candidate shares their CV | `atmee.file` to the agent alone, the files attached and their optional line as `caption`; the agent answers each file on `atmee.file.status` |

With a microphone, the candidate's voice goes straight to the avatar over the room's audio.

## App tools

Handlers: `const tools` in [`public/recruiter.html`](../../public/recruiter.html) (about line 209).

| tool | mode | what the page does |
|---|---|---|
| `set_agenda_step {step}` | notify | marks that step as current and earlier ones as done. It only moves forward; an unknown step is an error. |
| `record_answer {topic, summary}` | notify | adds a line to "Screening notes" under the topic's label; a second answer on the same topic is appended. |

Why these tools: the agenda and the notes are the product's own UI, filled by the recruiter as
it works. Without them the page would have to guess from the transcript. Both are `notify`, so
the conversation never waits on the page.

## The CV

The host's runtime does the reading. It reads each file once into a short summary, reacts to
the drop once on its own (a sentence or two, seeing the drop's images), is told every file's
summary on each later reply, and looks at the file itself, with a spoken filler, for a detail
the summary lacks. So the app sends no `event` about a CV: the recruiter would speak of it
twice.

What the app adds is how a screening uses a CV, as one standing `note` sent at link
(`CV_NOTE` in [`usecases/index.js`](../../usecases/index.js)): when it arrives, thank the
candidate, name one or two things that matter for this job and carry on with the current part
of the call; from then on ask about the roles and projects it names, and confirm the
must-haves it speaks to with specific questions; say when something comes from the CV; never
claim it shows what it doesn't; record in the notes only what the candidate confirms; and
never ask for one.

The page (`shareCv` in [`public/recruiter.html`](../../public/recruiter.html), about line 237):

- The box shows once the call is live and the recruiter takes files (`s.acceptsFiles()`,
  `onFilesAccepted`). If it stops taking them, the box stays, keeps its list and says so.
- A file dropped anywhere on the page is shared while the box is open (and does nothing
  otherwise, rather than the browser opening it in place of the call). The picker offers
  PDFs, images and text files; at most 10 files a drop.
- Each file shared in the call is listed with how far it got: Sending…, Received, Reading…,
  Read, or Not read with the reason ("too large to read", "a kind of file that can't be
  read"…). A Word file is refused, and the page asks for a PDF instead.
- The candidate's line, if any, goes as the drop's caption, and the transcript shows
  `Shared alex-cv.pdf: "…"`.

What the host reads: images (PNG, JPEG, WebP, HEIC, HEIF) and PDFs up to 20 MB (a PDF up to
100 pages), UTF-8 text up to 500 KB; at most 10 files and 50 MB a drop, 20 files and 100 MB a
call.

## Run it

```
ATMEE_BASE_URL=https://staging.atmanity.us
ATMEE_API_KEY=…            # scopes: sessions, and avatars:write (to set the conductor)
node --env-file=.env server.js   # the host: apps/recruiter/avatar.json (AVATAR_RECRUITER overrides it)
open http://localhost:3333/recruiter.html   # ?debug shows relays, held times and tool calls
```

Each app has its own avatar. The recruiter's name, role and voice come from the avatar's
persona, so make it a recruiter.

## Tested (staging, testuser account, 2026-10-23, avatar "Priya Raman")

Two full passes, each a typed candidate answering only after the recruiter finished:

| | pass 1 | pass 2 |
|---|---|---|
| conductor `PUT` | 200, 6 nodes | 200, 6 nodes |
| greetings | 1 | 1 |
| `set_agenda_step` | background → fit → logistics → questions → questions → wrap | same |
| agenda ends on "Next steps" | ✓ | ✓ |
| `record_answer` calls | 10 | 8 |
| unknown detail asked (team size) | "don't have it in front of me, the hiring team will follow up" | – |
| agenda or notes mentioned aloud | no | no |

Each step moved on at the first answer that met its condition; the second `questions` call
came when the candidate asked something, which is the expected stay. Causeur's logs show the
reply released about 1.1–1.2 s after each typed answer, and the tool calls landing about 1.5 s
after it. Before the relay hold (an earlier round on another account), one run greeted twice
and stayed on Background for four turns; neither has happened since.

The CV (added 2026-10-24) has not been run live yet.

## Limitations

- **The agenda can't react to tool calls.** The conductor moves on its judge's reading of the
  conversation; `set_agenda_step` only updates the page. The two agree because each step's
  instructions name the tool, not because one drives the other.
- **No live agenda state.** The API doesn't report the current step; the page shows what the
  recruiter marked.
- **Check-in after the last step.** About 10 s after the goodbye, Causeur speaks once more
  unprompted.
- **Mid-turn messages are dropped.** `common.js` holds typed turns and state until the
  recruiter's turn ends (at most 15 s).
- **One live session per avatar**: one candidate at a time per recruiter avatar.
- **Word CVs aren't read.** The host refuses `.docx`; the page asks for a PDF.
- **The CV doesn't change the job.** The job card, the must-haves the agenda checks and the
  notes' topics are fixed; the CV only shapes the questions.
- **A CV dropped during the greeting** can get its reaction before the note lands: the page
  holds the note, like everything it relays, until the recruiter's turn ends.
- **The CV stays in the call.** The page keeps no copy, and the screening notes hold what the
  candidate said, not what the CV says.
- **No server-side event stream.** The notes exist on the page only. A real product would post
  them to its backend from the tool handler (or from `onTool` on the server).
