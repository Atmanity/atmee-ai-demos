# Quadratic Whiteboard

A whiteboard a **teacher** drives by talking, in front of a class. Name a
quadratic ("put up x squared minus four x plus three"), pick a method
(factoring, completing the square or the quadratic formula), and say "next"
for each line of working. The parabola sits beside the derivation with its
roots, vertex and axis of symmetry. Every number is exact: surds stay surds
(`2 + √3`, never 3.73). The avatar is the chalk hand: it reads each new line
out and answers direct questions about the board ("what's the discriminant?").
It does not teach, quiz, or read ahead.

Every spoken request has a control too: the method buttons, ‹ Back, Next line ›,
Show all, Hide/Show graph, Clear, and (new in this port) an equation box that
takes `x^2 - 4x + 3`, words, or `1, -4, 3`.

Ported from `Atmanity/apps/apps/quadratic-whiteboard` (a Python LiveKit agent
with eight tools, an exact-arithmetic engine and a React panel).

## How it works on the API

| Feature | Mechanism |
|---|---|
| The engine: exact arithmetic, the three methods, the refusals | `engine/fraction.ts` (BigInt rationals, standing in for Python's `Fraction`), `solve.ts`, `methods.ts`, `board.ts`: ported from `solve.py`, `methods.py`, `board.py`. `parity.test.ts` checks every line and fact against the original engine's own output (`engine/fixtures/python-engine.json`) |
| Unrevealed working never leaves the engine | The board lives on the server (`server.ts`). The page gets the revealed lines, a **count** of the rest, and the one sentence staged for the next "next" (below); nothing else |
| Putting an equation up | Speech or a typed line: rules first (`engine/spoken.ts` reads "x squared minus five x plus six", "half x squared", "x² − 4x + 3 = 0", "x squared equals five x minus six"), then a Gemini `structured()` call for what the rules cannot read (brackets, "change c to five", mishearings). The equation box does the same |
| Method, next, back, show all, graph, clear | Buttons; typed and spoken lines through `engine/judge.ts`: the original's bare-"next" detector first (exact phrases), then command rules, then the model. Questions are never board actions |
| Reading each line out | A spoken "next": the avatar's state already holds the next line's sentence ("only when the teacher asks for the next line"), so its own immediate reply reads the real line, and the app sends no event. A button or a typed "next": an `event` carrying the line's sentence |
| The operator's rules | Two `note`s (`engine/director.ts`), condensed from `persona.py` (3.3K characters) |
| Direct questions | Answered by the avatar from `state`: the equation, the exact facts, the lines up, what can and cannot be done next |
| Refusals ("Pick a method first…") | The board's sentence on the panel; for a typed line, also an `event`; for a spoken one the avatar already has it in its state (an equation's refusal is the exception: an `event`) |
| The original narrator (`ChangeSpeaker`) | `eventFor(view, source)`: buttons are narrated, except hiding the graph and clearing, which speak for themselves |
| The opening | An `event` once the board is set up |
| The graph | `page/Parabola.tsx` and `page/graph.ts`, ported unchanged; the platform's `useCanvas2D` is vendored in `page/canvas.ts` (the kit has no canvas helper) |

Keys: `GEMINI_API_KEY` (optional). Without it the rules still put up every
plainly said or typed quadratic and run every command; brackets, coefficient
changes ("change c to five") and garbled maths then get "I couldn't read that
equation" instead. No other key is used.

## What the API could not do

Status after the live run of 2026-10-23 (below): **seen** = observed live,
**expected** = not yet observed.

1. **The avatar answers a spoken request before the board moves.** *Seen, and
   staging made it right in one run.*
   The original applied a bare "next" in code before the model spoke
   (`AdvanceWatch`), so the reply narrated the line just revealed. Here the
   transcript reaches the app about a second after the avatar has started
   answering. Staging the next line's sentence in `state` lets that answer be
   the real line, but two failures remain possible: the avatar reads the staged
   line for something the app does not take as "next" (a misheard word), so
   the line is read but the board does not move; or it says something generic
   ("Sure!") and the line goes up unread, because a spoken "next" sends no
   event (one would make it read the line twice). The Next line button always
   works. Live, every spoken "next" and "go on" was answered with the right
   staged line while the board moved to match; neither failure was seen.
2. **Staging puts one unrevealed line within reach.** *Expected* (by design;
   no early read seen).
   The original's central property was that no unrevealed line crossed the
   wire. Here exactly one line's sentence does (into the avatar's state, and so
   into the page's JavaScript); the avatar is told never to say it before it
   is asked for, but it can. Every line after it stays on the server.
3. **The read-back can contradict the board.** *Expected* (live: "putting that
   up", then the app's read-back, twice). The avatar
   hears "x squared minus four x…" too, and may echo its own reading before
   the app's parse lands. A note tells it to say only "putting that up"; the
   app's `event` then reads back what was actually written.
4. **"Never speak unprompted" cannot be met.** *Seen* ("Whenever you are ready
   for the next line, just…", three times in one run). The ~10 s
   check-in cannot be turned off or lengthened per session, so the avatar will
   talk into the pauses while the teacher explains to the class.
5. **Exact narration is not guaranteed.** *Expected* (live, "What's that as a
   decimal?" got "I have the exact roots as two plus root three and two minus
   root three"). Events are said
   in the avatar's own words, so "2 + √3" can come out as a decimal despite the
   notes. The board on screen is the source of truth.
6. **No per-session persona.** *Seen* ("I'm the lighthouse keeper out here on
   the rugged Taitung coast…", then the board's opening). The original composed any
   avatar's identity with the board's rules per session (and took
   `instructionsExtra` from the workspace). Here the shared test avatar
   introduces itself first; the operator persona (`avatar.json`, "Chalk")
   needs a dedicated avatar.
7. **No speech hints.** *Expected* (every equation was heard right in one run). The original biased Deepgram toward
   maths words. Through the API, "four x" can arrive as "for x" and "x" as
   "ex"; the rules accept both after an operator, and the model takes the rest.

## Not ported

- `AdvanceWatch`'s turn-id guard and `ChangeSpeaker`'s `claim(seq)`: both
  stopped one change being narrated twice by a model and a narrator in the same
  process. Here there is one source of events (`eventFor`, by input source), and
  each change carries a version (`seq`) so the page never goes back to an older
  board.
- The 600-character model note (`render_summary`): the API's `state` holds
  3,858, so it carries every revealed line, not only the last.
- Two deliberate changes to the engine, each with a test: y = ax² factors as
  `x·x` (the original wrote "xx = 0"), and a discriminant too large to simplify
  quickly is refused ("Those numbers are too big for this board") instead of
  stalling the server.

## Tested

- `npx vitest run apps/quadratic-whiteboard`: 304 tests. Ported from the
  original's suites: `test_solve.py` (exact surds, every method ends on the same
  answer, never the same line twice, the vertex line's honest reading),
  `test_board.py` (every refusal's sentence, no unrevealed working anywhere in
  the snapshot, framing), `test_table.py` (the bare-"next" matrix, method
  aliases, refusals said out loud, the narrator never reading a hidden line and
  saying nothing for graph and clear), `graph.test.ts` and
  `BoardPanel.test.tsx`. New: the parity check against the Python engine,
  spoken-maths phrasings, the judge's rules, the model fallback (stubbed), the
  equation box, and the director's limits and leak checks.
- Live: one run on staging, below.

### Live run (staging, avatar `26cbe079`, 2026-10-23)

Spoken lines through `tools/live-test/harness.js`:

- "Put up x squared minus five x plus six." → "putting that up", then "We have
  y equals x squared minus five x plus six… factoring, completing the square, or
  the quadratic formula?"
- "By factoring." → Factoring, 0/6. "Next." → line 1 read and up (1/6). "Go
  on." → line 2 (2/6). The Next line button and a typed "next" → lines 3 and 4,
  each read once by event.
- "What's the discriminant?" → "1". "Show it all." → "x equals 3 or x
  equals 2".
- "Put up x squared minus four x plus one." → offered only completing the
  square and the formula. "By factoring." → refused ("it doesn't factor over
  the rationals"). "Use the quadratic formula.", then "Next." twice → lines 1
  and 2. "What's that as a decimal?" → kept the surds.
- Session `completed`, `ended_by_api`, 267 s billed.
