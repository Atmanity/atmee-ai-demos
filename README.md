# Atmee sample apps

Apps built on the public Atmee Avatar API: your app owns its logic and its
screen; the avatar talks with your user about it. Nothing here uses Atmee
internals: a server with an API key, a page in a LiveKit room, and the room's
text streams.

- `apps/`: the mini-apps from `Atmanity/apps` (chess, poker, tutors, advisors,
  a planetarium, a room planner…), rebuilt on the API. Each was run live on
  staging; its README has the run and what the API could not do.
- `classic/`: the first five apps (a live stream, a recruiter, a training
  module, a companion, a story game). See `classic/README.md`.
- `docs/API-GAPS.md`: everything the API could not do, found while building
  these, with what was seen live (a table per app at the top).
- `docs/PORTING.md`: how an app here is built, and how to add one.
- `docs/apps-report.html`: the report on all of them: what each app is for, how
  it is built, and what the API missed for it (open it in a browser).

## Run

```bash
cp .env.example .env    # ATMEE_API_KEY, AVATAR_DEFAULT (or AVATAR_<APP>), GEMINI_API_KEY
npm install
npm run dev             # http://localhost:5190/ (PORT to change it)
npm test                # engines, judges, directors, the typed-turn floor
npm run typecheck
npm run classic         # the classic five on :3333
```

Node 22.9+ (for `--env-file-if-exists`). `npm run dev` and `npm start` read
`.env`, then `.env.local` if it exists, so a key in `.env.local` wins: create one
without printing it with `atmee keys create --name mini-apps --scopes
avatars:read,avatars:write --out .env.local` (the account must own the hosts).

Each app has its own host: `apps/<id>/avatar.json` is its persona and its
`avatarId`, an avatar of that account. `AVATAR_<APP_ID>` (for example
`AVATAR_CHESS_OPPONENT`) overrides it, and `AVATAR_DEFAULT` serves an app with
neither.

## How an app is put together

```
server/              one Express server: the API key, sessions, each app's own routes
  atmee.ts             the Avatar API (start, end, conductor)
  llm.ts               the apps' own model calls (structured JSON, images)
  api.ts               discovers apps/<id>/server.ts; /api/apps/<id>/session, /end, routes
src/avatar/          the room, framework-free: join, wait for the avatar, the app's
                     messages (state/note/event/mute), both sides' words, the
                     typed-turn floor (floor.ts, the part to delete once the
                     platform queues typed turns itself)
src/kit/             React: useAvatar(), <AvatarStage>, <Composer>, <Transcript>
apps/<id>/
  server.ts          the app's server side (secrets, model calls, data)
  engine/            its rules and its "director" (what the avatar is told), with tests
  page/              its screen
tools/live-test/     a synthetic microphone and helpers for live runs
```

The rule every app follows: **the app decides, the avatar performs.** Rules,
scores, facts and plans live in the app's engine; the avatar is told what is
true (`state`), what happened (`event`) and its standing rules (`note`).
Because the avatar answers the user before the app has heard them, apps give
every action a control, judge typed lines first, and stage predictable answers
in `state` (see `docs/PORTING.md`).
