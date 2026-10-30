# Trailmix

Every subject is an expedition. A child aged six to ten walks the Volcano Trail
with Mochi, a cartoon red panda, and the screen answers what they say: shout
"pump it!" and the magma rises until the volcano erupts. Mochi says silly things
on purpose so the child gets to catch them, and every stop ends with a sticker in
the backpack.

## How it works

| Part | What it does |
| --- | --- |
| `engine/trail.ts` | The four stops and every rule; a button and a tool call make the same move |
| `engine/director.ts` | Mochi's instructions, tools, live state and arrival lines |
| `engine/judge.ts` | The safety net's phrases for walking on |
| `page/Scenes.tsx` | The four playable scenes, drawn in SVG |
| `page/App.tsx` | The trail map, backpack, Mochi and hold to talk |

Children do not type: the call joins with the microphone shut, and a big button
opens it while held. Add `?type` to the address for a typing box (for testing).

## Host

`avatar.json` needs the `avatarId` of a host in the site's account. Until then,
`AVATAR_LEARNING_TRAIL` sets one.

## What the API could not do

- A typed line sent while the host is talking is dropped. Children hold to talk
  instead, and buttons reach the host as events, which wait their turn.

## Before this goes public

Children's voices reach the speech recogniser. Get a privacy review (COPPA,
GDPR-K) or put a parent gate on the front door first.
