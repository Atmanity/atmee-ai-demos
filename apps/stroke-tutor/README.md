# Stroke Tutor

A calligraphy teacher watches you write a character one stroke at a time and
grades the stroke **order** and **direction**, never the handwriting. Seven
characters, from 一 (one stroke) to 永 (five, the classic exercise), plus the
capitals A and E for a learner with no Japanese.

Pick a character (tap a card, or say "let's do the tree one"), then draw each
stroke on the board with a finger or mouse. A wrong stroke gets the reason
(wrong order, backwards, begun in the wrong place, not that stroke); a second
miss on the same stroke and the board draws it for you. Ask "which way does it
go?" or press **Show me** to be shown; say "next" or press **Next stroke** to
move on.

Ported from `Atmanity/apps/apps/stroke-tutor` (a Python LiveKit agent with four
tools and an on-change coach, plus a React panel) onto the Avatar API.

## The thing that would be easy to break

**A stroke's reference points reach the page only once that stroke is
earned**: drawn correctly, or revealed on request. The live stroke and every
stroke after it arrive with no points, name or teaching line, at the page and
at the avatar. Drawing (or describing) the stroke the learner is asked for
turns the exercise into tracing. So the lesson runs on the server
(`engine/tutor.ts`, `strokesView`), the page never imports the character data
(`engine/bundle.test.ts` follows its imports to prove it), and the avatar's
`state` carries a stroke's lesson only once it is earned.

## How it works on the API

| Feature | Mechanism |
|---|---|
| The characters (stroke points on a 1000-unit grid, four teaching sentences each) | `engine/characters.ts`, server only |
| Grading (order, direction, start, shape) | `engine/strokes.ts`: geometry, no model. A line-for-line port of `strokes.py`; 12,000 random drawings got identical verdicts from both, and 120 of them (the closest calls) are replayed by `strokes.parity.test.ts` |
| The lesson (phases, attempts, score, the two-miss rescue, refusals) | `engine/tutor.ts` + `engine/lesson.ts` on the server; the page sees a masked `Snapshot` |
| Drawing | `page/StrokeCanvas.tsx` + `page/ink.ts` (pixels to grid units, corner-keeping RDP to ≤ 40 points); one gesture = one `stroke` intent |
| Show me / Clear / Next stroke / Next character / switch / menu | buttons, each one intent through `POST /api/apps/stroke-tutor/lessons/:id/act` |
| Typed and spoken commands ("show me", "which way does it go?", "next", "start over", "let's do the tree one") | `engine/judge.ts` rules, phase-aware; lines the rules cannot place go to the app's own model call (`structured()`, server-side) when `GEMINI_API_KEY` is set. Words never draw a stroke |
| The teacher's rules | three `note`s (`engine/director.ts`), condensed from the 3,124-character `persona.py` |
| The board | `state`: the character, the live stroke by number only, attempts, the last verdict and its sentence, the lessons of earned strokes, the score, the menu |
| Verdicts, the rescue, "stroke N is live", the debrief, refusals | `event`s quoting the authored sentence ("say it WITHOUT changing what it claims") |
| One coaching line at a time | `page/coach.ts`: while the avatar speaks (or before it arrives) only the newest cue is held; it goes after 1.2 s of quiet. The original coach spoke once per state for the same reason |
| Typed lines | judged first: a board action is recorded and acted on; anything else goes to the avatar as a typed turn |

Keys: none required. `GEMINI_API_KEY` (already on the server) enables the
model fallback for unusual phrasings; without it the rules alone route words.

### Changes from the original

- Every input (button, stroke, typed, spoken) takes one path (`perform`) that
  returns one event, so the original's seq-claiming between tools and coach is
  gone; `page/coach.ts` does the coalescing instead.
- A spoken "show me" after the stroke is done is left to the avatar (its lesson
  is already in `state`) instead of the original's refusal "That one's already
  done." The **Show me** button still gets that refusal on screen.
- Views carry the name and lesson of earned strokes, so the page can build the
  avatar's `state` without the character data.
- Small panel fixes: "1 stroke" in the header too; a stroke shown after two
  misses is tagged "Missed twice, shown"; pointer capture is best-effort (a
  synthetic pointer, as the live-test helper sends, cannot be captured).

## What the API could not do

Status after the live run of 2026-10-23 (below): **seen** = observed live, **expected** = not yet observed.

1. **(seen: the holding line; the leak not seen in one run)** **A spoken "which way does it go?" is answered before the board reveals the
   stroke.** The original's `show_me` tool drew the stroke and handed back its
   lesson inside the reply. Now the avatar answers first; the notes and `state`
   tell it to say only "Let me show you", and the lesson follows as an event.
   If it answers from its own knowledge of stroke order instead, it describes
   the very stroke the app withholds: the leak this app exists to prevent. The
   lesson cannot be staged in `state` beforehand without making it that leak.
2. **(expected)** **The verdict's words can be softened.** Events are said in the avatar's own
   words, so "horizontals always travel left to right" can become "usually".
   The exact sentence is on the board.
3. **(expected)** **Coaching can lag the drawing.** An event cannot be withdrawn once sent; a
   cue sent just before the learner draws again is still spoken, stale. The
   page holds cues while the avatar speaks and keeps only the newest, which
   covers the common case.
4. **(seen)** **The ~10 s check-in interrupts drawing.** Twice in one run: "Whenever you're ready, try stroke two!" The learner draws in silence; the
   original was silent until a stroke landed. A note asks for silence; the
   check-in cannot be tuned.
5. **(seen)** **Spoken "next", "start over" and character choices depend on the
   transcript** (about a second late, and the avatar may say "let's move on"
   before the board has). The buttons always work.
6. **(expected)** **No per-session speech hints.** The original passed none either, but the
   Japanese readings (ichi, jū, kawa, ki, ei) are likely misheard; the rules
   accept the meanings (one, ten, river, tree, eternity).
7. **(seen)** **The persona is the avatar's.** The test avatar greeted as "Emily, just a college student" first. Ren (`avatar.json`) needs a dedicated
   avatar; on the shared test avatar the app's role comes from the notes.
8. **(seen)** **The avatar can misread the state.** Asked "How am I doing?"
   after stroke 2 had been missed twice and shown (the board waiting for
   "next"), it answered "We've got the first two down… give stroke three a
   try!". The state was right; its reading of it was not.

## Tested

- `npx vitest run apps/stroke-tutor`: 181 tests in 10 files.
  - Ported: `test_strokes.py` (17, into `strokes.test.ts`), `test_tutor.py`
    (22, into `tutor.test.ts`), `test_table.py` (its reducer, coach, cue and
    tool cases, into `lesson.test.ts` and `director.test.ts`), the panel's
    `ink.test.ts` (10) and `StrokeTutorPanel.test.tsx` (15).
  - New: grader parity with the Python original, the judge's phrasings and
    model-answer guard, the director's limits and per-stroke leak sweep (every
    stroke of every character, before and after a miss), the coach queue, and
    the bundle import guard.
- Live: not yet run (see below).

### Live test

Draw without a hand from devtools; you pass grid points (origin top left,
1000 across):

```js
const h = await import('/tools/live-test/harness.js'); h.install();   // before Start
const d = await import('/apps/stroke-tutor/page/live-draw.ts');
d.draw([[130, 380], [870, 380]]);   // 木 stroke 1, the horizontal, left to right
```

Reference strokes for a run on 木: 1 `[[130,380],[870,380]]`, 2
`[[500,120],[500,900]]` (upwards is `[[500,900],[500,120]]`), 3
`[[490,430],[350,640],[200,860]]`, 4 `[[510,430],[660,640],[800,860]]`. For 十:
1 `[[150,450],[850,450]]`, 2 `[[500,120],[500,880]]`.

### Live run (staging, avatar `baf61f2c`, 2026-10-23)

Spoken lines through `tools/live-test/harness.js`, strokes through
`page/live-draw.ts`:

- "Let's do the tree one." → "Of course, 木, tree it is! Just a second while the
  board sets it up" (holding line), then the app's event: "木, tree, read ki,
  takes four strokes… try stroke one!"
- "Which stroke comes first, and where do I start it?" → "let me show you; watch
  the board", the board revealed stroke 1, then the lesson: "Horizontal first,
  left to right — the branches before the trunk."
- "Next." → stroke 2. Stroke 2 drawn upwards twice: "WRONG DIRECTION / Top to
  bottom" ("Top to bottom. Give stroke two another shot!"), then "MISSED TWICE,
  SHOWN" with the trunk's lesson spoken.
- Typed "How am I doing?" → answered (misread, gap 8). Typed "let's start
  over" → the board went back to stroke 1.
- Session `completed`, `ended_by_api`, 151 s billed.
