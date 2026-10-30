# Math Club

Talk with Mochi, a cartoon otter, and solve it out loud. Each of the five
levels is a different game and a different way of teaching. Mochi stands inside
the game, hears the child, asks, hints, and hops when they get it.

| Level | Game | How it teaches |
| --- | --- | --- |
| 1 | Firefly Catch | Counting with a friend, no fear of being wrong |
| 2 | Block Builder | Socratic steps through carrying, with hints that climb |
| 3 | Mochi's Shop | Story problems: Mochi is the shopkeeper, the child helps |
| 4 | Teach Mochi | Mochi is wrong on purpose; the child corrects and explains |
| 5 | Cube Lab | A cube unfolds into a net, then surface area |

## How it works

| Part | What it does |
| --- | --- |
| `engine/games.ts` | The five games as ladders of steps; a wrong answer earns the next hint, never the answer |
| `engine/director.ts` | Mochi's instructions, tools and live state; a pending answer never reaches the host |
| `page/App.tsx` | The lobby, the game screen, what Mochi heard, and Mochi's jumps |
| `page/Cutout.tsx` | Keys the green out of the host's video so Mochi stands in the world |
| `page/Worlds.tsx` | The five worlds |

An answer from the host counts only after the child has spoken. The jump is the
page moving the cut-out; the avatar itself animates in place. There are no
buttons for the maths. Add `?type` to the address for a typing box with no
microphone (for testing).

## Host

Mochi (`1696fc81`) is on the production htchang account, so the site's staging
key cannot start it. Run locally with a key for that account and
`ATMEE_BASE_URL=https://api.atmanity.us`. The staging test account is at its
limit of 50 API avatars.

## Before this goes public

Children's voices reach the speech recogniser. Get a privacy review (COPPA,
GDPR-K) or put a parent gate on the front door first.
