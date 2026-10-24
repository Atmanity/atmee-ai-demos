// Types for hosts.js (plain JS, shared with the five apps' server.js).
/** The environment variable that overrides an app's host: AVATAR_CHESS_OPPONENT for chess-opponent. */
export declare function avatarEnvName(id: string): string;
/** The avatar an app runs: AVATAR_<APP_ID>, else apps/<id>/avatar.json's avatarId, else AVATAR_DEFAULT; "" when none. */
export declare function avatarFor(id: string): string;
/** The host's own voice in Fish Audio (cloned from the sample the host was made with), or "". */
export declare function fishVoiceOf(id: string): string;
/** The host's first name, for the home page, or null. */
export declare function hostNameOf(id: string): string | null;
