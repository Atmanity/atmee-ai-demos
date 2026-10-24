// Every app's host, the same way for all of them: AVATAR_<APP_ID> in the
// environment (to swap a host without a commit), else the avatarId in the
// app's apps/<id>/avatar.json, else AVATAR_DEFAULT. Plain JS, so the five
// apps' server.js and the site's TypeScript share it.
import { readFileSync, readdirSync } from "node:fs";

const HOSTS = new Map(); // app id -> { avatarId, name }
for (const dir of readdirSync("apps")) {
  try {
    const host = JSON.parse(readFileSync(`apps/${dir}/avatar.json`, "utf8"));
    HOSTS.set(dir, {
      avatarId: typeof host.avatarId === "string" ? host.avatarId : "",
      name: typeof host.name === "string" ? host.name : "",
    });
  } catch {
    // no avatar.json: the app has no host of its own
  }
}

/** The environment variable that overrides an app's host: AVATAR_CHESS_OPPONENT for chess-opponent. */
export const avatarEnvName = (id) => `AVATAR_${id.toUpperCase().replace(/-/g, "_")}`;

/** The avatar an app runs, or "" when it has none. */
export const avatarFor = (id) => process.env[avatarEnvName(id)] || HOSTS.get(id)?.avatarId || process.env.AVATAR_DEFAULT || "";

/** The host's first name, for the home page, or null. */
export const hostNameOf = (id) => HOSTS.get(id)?.name.split(" ")[0] || null;
