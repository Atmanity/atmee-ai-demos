# Hanshi

Stroke-order lessons with a calligraphy teacher. Ren watches you write a
character one stroke at a time on a practice sheet, and tells you when a stroke
comes out of order, runs the wrong way or starts in the wrong place. Your
handwriting is never graded. Seven characters, from 一 (one stroke) to 永 (five,
the classic exercise), plus the capitals A and E. Draw with a finger, a stylus
or a mouse; talk to Ren or type. Rebuilt from the `stroke-tutor` mini-app as a
standalone product on the Avatar API.

Open it at `/apps/stroke-tutor/`.

## The thing that would be easy to break

**A stroke's reference points reach the page only once that stroke is
earned**: drawn correctly, or shown. The live stroke and every stroke after it
arrive with no points, name or teaching line, at the page and at Ren. Drawing
(or describing) the stroke the learner is asked for turns the exercise into
tracing. So the lesson runs on the server (`engine/tutor.ts`, `strokesView`),
the page never imports the character data (`engine/bundle.test.ts` follows its
imports; a production build of the page contains no teaching line or
reference point), Ren's `state` carries a stroke's lesson only once it is
earned, and no tool result names a stroke ahead of time (`lesson.test.ts`
sweeps every stroke of every character).

## How it works

| Part | Where |
|---|---|
| The lesson: characters, grading, attempts, the two-miss rescue, refusals | `engine/characters.ts`, `engine/strokes.ts` (geometry, no model; 12,000 random drawings got the Python original's verdicts, 120 replayed by `strokes.parity.test.ts`), `engine/tutor.ts`, `engine/lesson.ts`, all on the server. The page sees a masked `Snapshot`. |
| Ren's actions | Five `await` tools (`engine/director.ts`): `show_stroke`, `next_stroke`, `choose_character(character)`, `next_character`, `start_over`. The page answers each `atmee.tool` call by asking the server (`POST /lessons/:id/tool`), which acts through `runTool` and returns the words Ren speaks from. "Which way does it go?" draws the stroke, and Ren's first reply carries its teaching line. |
| Strokes | Drawn on the sheet (`page/StrokeCanvas.tsx`, `page/ink.ts`): one gesture is one `POST /lessons/:id/stroke`, graded by geometry. There is no tool for drawing and words never draw. The verdict reaches Ren as an event, one coaching line at a time, the newest only (`page/coach.ts`). |
| Ren's rules | The tool `instructions`: never describe a stroke the learner has not earned; a question about the live stroke is a request to be shown; the sheet changes only through a tool; never invent an outcome; say the sheet's note without softening it; silence while they write. |
| What Ren sees | `state`: the character, the live stroke by number only, attempts, the last verdict and its sentence, the lessons of earned strokes, the score, the menu. |
| Buttons | Show me, Next stroke, Start over, Change character, the menu's cards, Next character, Write again. They act at once through the same `runTool` and Ren is told by an event ("The learner pressed …"). A refusal is shown on the sheet, not spoken. |
| The safety net | `useToolNet` with `mustDo` (`engine/judge.ts`, page-safe): a plain "show me" or "which way does it go?" while a stroke is live, "next" once it is done, "start over", and a character off the menu. Each is safe twice (a second show or next is refused, a second start over lands in the same place). Left out: `next_character` (twice would skip one) and switching mid-character (it would wipe their progress). |
| Two inks | `page/marks.ts`: a stroke the learner drew right stays on the sheet in their own sumi ink; a stroke Ren showed is drawn in vermilion with a direction arrow, brushed in from start to end (`page/paint.ts`). Strokes are numbered as on a stroke-order chart. |
| The screens | The front door (`page/Lobby.tsx`); the menu, the lesson and the finished character with a summary, a seal and "Save your sheet" (a PNG, `page/save.ts`) in `page/Desk.tsx`; styled in `page/hanshi.css`. Calling Ren again carries on the same sheet, and the sheet keeps working while the call is down. |

## What the API could not do

Status before a live run of this version: every item is **Expected**. Where
the first port's live run (2026-10-23, staging) saw it, that is noted.

1. **Tools are called when the host decides.** *Expected.* Ren may narrate
   "let me show you" without calling `show_stroke` (the net shows the stroke
   7 s later), or describe the stroke from its own knowledge of stroke order:
   the leak this app exists to prevent, which nothing can take back once said.
   The instructions forbid it; the first port did not see it in one run.
2. **The persona and the greeting belong to the avatar.** *Expected* (seen in
   the first port: the shared test avatar greeted as "Emily, just a college
   student" first). `avatar.json` is the teacher Hanshi was designed for.
3. **The ~10 s check-in interrupts drawing.** *Expected* (seen twice in the
   first port: "Whenever you're ready, try stroke two!"). The instructions ask
   for silence while the learner writes; the check-in cannot be tuned.
4. **A drawn stroke's verdict can be reworded, even flipped.** *Seen* (live,
   2026-10-23): after an upward stroke the sheet said "Top to bottom." and Ren
   said "that one went top to bottom!". A stroke drawn backwards is now told as
   two plain sentences, in order, computed from the lines (`engine/travel.ts`):
   "You drew it from the bottom up. This stroke goes from the top down." The
   same sentences are on the sheet and in the state.
5. **Coaching can lag the drawing.** *Expected.* An event cannot be withdrawn
   once sent. The page holds cues while Ren speaks and keeps the newest, and a
   tool result drops any cue still waiting.
6. **No per-session speech hints.** *Expected.* The readings (ichi, jū, kawa,
   ki, ei) are likely misheard; `choose_character` takes meanings, glyphs and
   readings, and the net reads the meanings.
7. **The host can misread the state.** *Expected* (seen in the first port:
   "How am I doing?" after a stroke was shown got "We've got the first two
   down… give stroke three a try!").
8. **A spoken "Next." was not always a call.** *Seen* (2 of 5 across two runs:
   "I'll get that final stroke ready" with no `next_stroke`; the safety net
   moved the sheet 7 s later). The platform rejects a call whose arguments do
   not fit the schema before the page sees it, so every schema is now lenient
   (no `additionalProperties: false`, enums, patterns or tight lengths; the
   app normalises), `next_stroke` asks to be called for the one word, and the
   instructions say a single word that changes the sheet is a tool call.

Fixed by tools, compared with the first port: a spoken "which way does it
go?" no longer gets a holding line ("Let me show you; watch the board") with
the lesson a beat later, and "next", "start over" and character choices no
longer race the board ("Just a second while the board sets it up"). The
page's judge for spoken and typed lines, its model fallback and the standing
notes are gone: Ren calls the tools for spoken and typed lines alike.

## Tested

- `npx vitest run apps/stroke-tutor`: 264 tests in 13 files.
  - The engine, as ported: the grader and its parity with the Python
    original, the tutor's rules and refusals, the lesson.
  - The tools: each one's result and refusal, choosing by meaning, glyph or
    reading, the character already up never wiped, every action the net makes
    safe twice, and no tool result carrying an unearned stroke.
  - The director: the tools fit the API (names, count, sizes, timeouts,
    reserved names, no drawing tool), the instructions name every tool and
    keep the hard-won rules, the state stays under 3,858 characters and never
    carries a stroke ahead of time.
  - The safety net's phrases, with the recogniser's variants ("im stuck",
    "Next.", "OK, next one."), and what it leaves to Ren.
  - The page: one stroke per gesture in grid units, taps ignored, the menu,
    the lesson, the summary, no backstage words on any screen, and the whole
    page wired to the real server routes in memory (the opening, tool calls,
    strokes graded and told, buttons told, the net stepping in and staying out).
- `npx tsc --noEmit`: clean for this app.
- Live: not yet run. The plan:

### Live test

Draw without a hand from devtools; you pass grid points (origin top left,
1000 across):

```js
const h = await import('/tools/live-test/harness.js'); h.install();   // before Start
const d = await import('/apps/stroke-tutor/page/live-draw.ts');
d.draw([[130, 380], [870, 380]]);   // 木 stroke 1, the horizontal, left to right
```

Reference strokes for 木: 1 `[[130,380],[870,380]]`, 2 `[[500,120],[500,900]]`
(upwards is `[[500,900],[500,120]]`), 3 `[[490,430],[350,640],[200,860]]`, 4
`[[510,430],[660,640],[800,860]]`. For 十: 1 `[[150,450],[850,450]]`, 2
`[[500,120],[500,880]]`.

| Step | Say, type or do | Expected call | On screen |
|---|---|---|---|
| 1 | Start with your voice | none; the opening | the menu; Ren offers 一 or A |
| 2 | tree: "Let's do the tree one." | `choose_character` | Tree, write stroke 1 of 4 |
| 3 | draw 木 stroke 2 first | none; a verdict event | Wrong order |
| 4 | which: "Which way does this one go?" | `show_stroke` (first reply has the lesson) | stroke 1 brushed in vermilion |
| 5 | next: "Next." | `next_stroke` | write stroke 2 of 4 |
| 6 | draw stroke 2 upwards, twice | none | Wrong direction, then Missed twice, shown |
| 7 | score: "How am I doing?" | none (from the sheet) | unchanged |
| 8 | type "next"; draw stroke 3; say "next"; draw stroke 4; say "next" | `next_stroke` ×3 (the first typed) | Tree, written: a 2/4 seal and the summary |
| 9 | another: "Can we do eternity next?" | `choose_character` | Eternity, stroke 1 of 5 |
| 10 | stuck: "I'm stuck." | `show_stroke` (or the net at 7 s) | the dot shown |
| 11 | press Next stroke | none; a press event | stroke 2 of 5, asked by number only |
| 12 | leak: "Is it the long one down the middle?" | `show_stroke`, or no description | never a description of stroke 2 |
| 13 | over: "Let's start over." | `start_over` | Eternity, stroke 1 of 5 |
