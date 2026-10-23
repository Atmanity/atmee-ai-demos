# Chalkline

A maths board a teacher drives by voice in front of a class. Say a quadratic
("put up x squared minus five x plus six"), pick a method (factoring,
completing the square or the quadratic formula), and say "next" for each line
of working; the parabola sits beside the derivation with its roots, vertex and
axis. Ada, the board's voice, puts each request on the board through its
tools and reads every new line out exactly as written: surds stay surds
(`2 + √3`, never 3.73). She does not teach, quiz or read ahead, and she cannot:
no line of working leaves the server until the board puts it up. Rebuilt from
the `quadratic-whiteboard` mini-app as a standalone product on the Avatar API.

Open it at `/apps/quadratic-whiteboard/`.

## How it works

| Part | Where |
|---|---|
| The engine: exact arithmetic, the three methods, the refusals | `engine/fraction.ts` (BigInt rationals), `solve.ts`, `methods.ts`, `board.ts`, ported from the original `solve.py`, `methods.py`, `board.py`. `parity.test.ts` checks every line and fact against the original engine's own output (`engine/fixtures/python-engine.json`) |
| The working stays on the server | `server.ts` holds each board (`engine/table.ts`). The page and Ada get the revealed lines and a count of the rest, nothing more. `next_line` reveals a line and hands it to Ada in the same call |
| Ada's actions | Eight `await` tools (`engine/director.ts`): `put_up_equation(equation, method?)`, `choose_method(method)`, `next_line`, `previous_line`, `show_all_working`, `show_graph`, `hide_graph`, `clear_board`. The page answers each `atmee.tool` call by asking the server, which acts and returns the words Ada speaks from: his first reply to "next" is the line that just went up |
| Reading an equation | Ada passes what she heard, in words or symbols. The server reads it with rules first (`engine/spoken.ts`: "x squared minus five x plus six", "x² − 4x + 3 = 0", "half x squared", "x^{2}", "1, -4, 3"), then a Gemini call capped at 8 s (`engine/judge.ts`) for brackets, "change c to five" and mishearings |
| Ada's rules | The session's tool `instructions`: the teacher leads, the screen changes only through the tools, every number is copied exactly, questions about the board are answered from it without a tool |
| What Ada sees | `state`: the equation, the exact facts, the method, the lines up and how many are to come; never a line that is not up |
| The keys | The tray under the board (Back, Next line, Show all, Hide/Show graph, Clear, and an equation box), the clean board's three example equations, the method choices and "Also try". They act at once and Ada is told by an event; showing or hiding the graph and clearing are not announced (a voice narrating every tap talks over the lesson), and Ada's live board says what happened |
| Repeated requests | Putting up the equation already there, or choosing the method already chosen, changes nothing, so saying it twice never wipes the lines the class has seen |
| The safety net | `useToolNet` (kit) with `mustDo` (`engine/judge.ts`): when the teacher clearly asks to put an equation up, pick a method, show it all, show or hide the graph or clear the board, and Ada makes no such call within 7 s, the page makes it and tells her. Never the next or previous line: a duplicate would move the board twice |
| Calling back | The board outlives the call (3 h on the server); calling Ada again resumes it as the teacher left it |
| The lesson notes | `page/notes.ts`: every equation the class saw, the lines shown for each method, and the answers reached. "Save lesson notes" during the call and the recap after it download them as a text file |
| The screens | The front door (`page/Lobby.tsx`); the board, its tray and the recap (`page/Board.tsx`); the graph (`page/Parabola.tsx`, `graph.ts`, with the canvas hook vendored in `canvas.ts`); styled in `page/chalkline.css` |

Keys: `GEMINI_API_KEY` (optional). Without it the rules still read every
plainly said or typed quadratic; brackets, coefficient changes and garbled
maths get "That didn't read as a quadratic" and Ada asks again.

## What the API could not do

Status: rebuilt with tools on 2026-10-23, not yet run live. **Expected**: not
observed with this build.

1. **Tools are called when the host decides.** *Expected.* Ada may narrate
   "next line" without calling `next_line`, or say one filler line ("putting
   that up") while an `await` call is pending. The safety net covers putting
   an equation up, the method, show all, the graph and clearing; the next and
   previous line are left out, so a missed "next" is one tap on Next line.
2. **"Never speak unprompted" cannot be met.** *Expected* (seen in the first
   port: "Whenever you are ready for the next line…", three times in one run).
   The ~10 s check-in cannot be turned off per session, so Ada may talk into
   the pauses while the teacher explains to the class.
3. **Exact narration is not guaranteed.** *Expected.* Results are said in
   Ada's own words, so "2 + √3" could still come out as a decimal despite the
   rules. The board is the source of truth.
4. **The persona belongs to the avatar.** *Expected* (seen in the first port:
   the shared test avatar introduced itself as a lighthouse keeper before the
   board's opening). `avatar.json` is the host this product was designed for;
   the instructions deliberately name no character.
5. **No speech hints.** *Expected.* The original biased the recogniser toward
   maths words; here "four x" can arrive as "for x" and "x" as "ex". The rules
   read both after an operator, and the model takes the rest.

Fixed by tools, compared with the first port:

- **The reply raced the board.** A spoken "next" was answered before the app
  heard it, so the first port staged the next line in the state. Now
  `next_line` reveals the line and returns it: the first reply reads the line
  that just went up, and a misheard word cannot make Ada read a line the board
  did not show.
- **One unrevealed line crossed the wire.** The staged line sat in the state
  and so in the page. Nothing beyond the revealed lines leaves the server now.
- **The read-back could contradict the board.** Ada's read-back of an
  equation is now `put_up_equation`'s result: what was written, not what she
  heard.
- Refusals ("Pick a method first…") are the tool's result, said in the first
  reply, and shown on the board too.

## Not ported

- `AdvanceWatch` (a bare "next" applied in code before the model spoke) and
  `ChangeSpeaker`'s `claim(seq)`: tools make the first and the single event
  source per key press makes the second unnecessary. Every change still bumps
  a version (`seq`), so the page never goes back to an older board.
- Two deliberate changes to the engine, each with a test: y = ax² factors as
  `x·x` (the original wrote "xx = 0"), and a discriminant too large to simplify
  quickly is refused ("Those numbers are too big for this board") instead of
  stalling the server.

## Tested

- `npx vitest run apps/quadratic-whiteboard`: 377 tests. The engine as ported
  (exact surds, every method ends on the same answer, never the same line
  twice, every refusal's sentence, the parity check, spoken maths); the tools
  against the API limits; the instructions keep the hard-won rules and name
  every tool; no unrevealed line in the state or the view, by any method at any
  point; each tool's result and refusal; repeated requests changing nothing;
  the safety net's phrases and what it never does; the keys' narration; the
  board, tray and recap rendered; and the page wired end to end with the
  engine as its server (Ada's calls moving the board, a key telling Ada, the
  net acting after 7 s, the recap, calling back to the same board).
- Live: not yet run with this build. The first port's run (staging, avatar
  `26cbe079`, 2026-10-23) had every spoken "next" answered with the right line
  while the board moved, and kept the surds for "what's that as a decimal?".
