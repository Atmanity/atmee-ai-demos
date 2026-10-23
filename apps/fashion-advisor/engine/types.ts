// What the server and the page share. The stylist (engine/stylist.ts) runs on
// the server, because the photos, the model keys and the try-on renders live
// there; the page sees a View, with images behind opaque URLs.
//
// The analysis and suggestion shapes keep the original agent's snake_case
// payloads.

export type Zone = 'head' | 'neck' | 'upper_body' | 'lower_body' | 'wrist' | 'feet';

/** Onboarding runs name -> style -> photo; then the styling loop. */
export type Step = 'name' | 'style' | 'photo' | 'styling';

export interface Suggestion {
  item: string;
  text: string;
  /** A rendered catalogue shot, once one exists (only with an image model). */
  image_url?: string;
  amazon_search_url?: string;
}

export interface Analysis {
  target_style: string;
  style_summary: string;
  occasion: string;
  style_score: number;          // 1-10, against the target style
  color_palette: string[];
  what_works: string;
  style_tip: string;
  suggestions: Suggestion[];
  tried_items: string[];        // Title Case, as the original panel shows them
}

export interface ShopLink { kind: 'exact' | 'category'; label: string; url: string }

/** What the image stage shows: the user's own photo, or a try-on of it. */
export interface StageImage {
  url: string;
  item: string;                 // "Current look", or the piece that was added
  kind: 'look' | 'tryon';
  shop_links?: ShopLink[];
}

export interface Jobs {
  photo: boolean;               // a new photo is being stored and checked
  analysing: boolean;           // a style read is running
  tryOn: string | null;         // the piece being rendered now
  queued: string[];             // try-ons waiting behind it
  more: boolean;                // more pieces are being found
}

export interface View {
  rev: number;                  // monotonic: the page ignores an older view
  step: Step;
  name: string;                 // '' when not given
  nameSkipped: boolean;
  target: string;               // the look they are going for ('' until given)
  category: string;             // a general direction that steers the next pieces
  photo: 'none' | 'present' | 'declined';
  describedOutfit: string;      // what they said they are wearing, in their words
  image: StageImage | null;
  analysis: Analysis | null;
  visibleZones: Zone[];
  latestItem: string;
  jobs: Jobs;
  notice: { kind: 'error' | 'info'; text: string } | null;
  tryOnAvailable: boolean;      // an image model is configured (XAI_API_KEY)
  thumbnailsPending: number;    // catalogue shots still rendering (the page polls meanwhile)
  canLoadMore: boolean;
  /** Onboarding counters, so the avatar's staged answers know when to stop asking. */
  nameAsks: number;
  photoAsks: number;
  wantsPhoto: boolean;          // the user asked for a new photo: the drop zone is up
}

/** Everything the user can do: from a control, a typed line or speech (judge.ts). */
export type Command =
  | { type: 'name'; name: string; style?: string }
  | { type: 'skipName' }
  | { type: 'style'; style: string }
  | { type: 'photoYes' }
  | { type: 'declinePhoto' }
  | { type: 'photo'; mime: string; data: string; source: 'upload' | 'sample' }
  | { type: 'tryOn'; item: string; text?: string }
  /** Quiet: loaded by scrolling to the end of the board, which the original never narrated. */
  | { type: 'more'; quiet?: boolean }
  | { type: 'rerate' }
  | { type: 'retarget'; style: string }
  | { type: 'steer'; style: string }
  | { type: 'retake' }
  | { type: 'reset' }
  /**
   * Not an app action, but worth knowing: it counts an onboarding non-answer,
   * keeps an outfit described in words, and remembers a piece asked for
   * before there was a photo to put it on.
   */
  | { type: 'chat'; outfit?: string; wish?: string };

export type Milestone = 'image' | 'done';

/** Something for the host to say in its own words: a tool's result, or an event. */
export interface SayEvent {
  text: string;
  ttl: number;
  /** The host is asked to offer this piece (a piece asked for before the photo is then forgotten once offered). */
  offer?: string;
}

export interface Outcome {
  view: View;
  /** Whether the command was an app action (a `chat` is not). */
  handled: boolean;
  events: SayEvent[];
  /** Work still running: wait for each milestone in turn (GET .../jobs/<id>/<milestone>). */
  job?: { id: string; milestones: Milestone[] };
}

export interface Img { mime: string; bytes: Uint8Array }
