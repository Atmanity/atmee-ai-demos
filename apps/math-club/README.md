# Math Club

Maths you can eat. A child aged six to ten learns fractions by cutting a pizza
and times tables by filling a cookie tray, with Mochi the red panda as teacher.
The point is the conversation: Mochi fills the screen, the microphone stays open,
the child's words appear as Mochi hears them, and Mochi asks, reacts and adapts
while the pizza changes the way the child says. Chalkline's front door links here for younger classes.

## How it works

| Part | What it does |
| --- | --- |
| `engine/club.ts` | The two classes and every rule; a button and a tool call make the same move |
| `engine/director.ts` | Mochi's instructions, tools and live state; a times total never reaches the host |
| `page/App.tsx` | The class picker, pizza, tray, star chart and hold to talk; a total from the host counts only after the child has spoken |

Each class has five levels, for ages five to ten and up. Both classes share one
call, so Mochi can change class or level when asked. Add `?type`
to the address for a typing box (for testing).

## Host

Mochi (`1696fc81`) is on the production htchang account, so the site's staging
key cannot start it. Run locally with a key for that account and
`ATMEE_BASE_URL=https://api.atmanity.us`. The staging test account is at its
limit of 50 API avatars.

## Before this goes public

Children's voices reach the speech recogniser. Get a privacy review (COPPA,
GDPR-K) or put a parent gate on the front door first.
