// Files the user drops into the call, for the host to read and talk about.
//
// A drop is one message on atmee.file to the host's agent alone, its caption as
// text and each file attached as a stream of its own. The agent answers each
// file on atmee.file.status as it goes: received, reading, then ready or
// refused (with a reason). The agent says it takes files with its atmee.files
// attribute; an avatar whose runtime takes none never sets it.
import type { Participant, Room } from 'livekit-client';

export const FILE = 'atmee.file';               // a drop, to the agent alone; never lk.chat, which drops attachments
export const FILE_STATUS = 'atmee.file.status';  // the agent's answers, one per file and status
export const FILES_ATTRIBUTE = 'atmee.files';    // "1" on an agent that takes files
export const MAX_FILES = 10;                     // in one drop; the agent checks types and sizes
export const MAX_CAPTION = 500;                  // characters; the agent reads no more of a caption
export const FILE_WAIT_MS = 120_000;             // a sent drop this long without an answer is refused (failed)

export type FileStatus = 'received' | 'reading' | 'ready' | 'refused';
/** Why a file was refused: too_large, unsupported_type, unsafe, too_many_files, unreadable, failed. */
export type RefusedReason = string;
/** One file's progress, as the agent answers it. */
export interface FileProgress { index: number; name: string; status: FileStatus; reason?: RefusedReason }
/** How one file of a drop ended. */
export interface FileOutcome { name: string; status: 'ready' | 'refused'; reason?: RefusedReason }
/** What the agent sends on atmee.file.status. */
export interface FileAnswer { batchId: string; index: number; name?: string; status: FileStatus; reason?: RefusedReason }

const withReason = <T extends object>(fields: T, reason?: string) => (reason ? { ...fields, reason } : fields);

export class FileError extends Error {
  constructor(public code: 'too_many_files' | 'files_unsupported' | 'no_agent' | 'no_call', message?: string) { super(message || code); }
}

export interface Drop {
  files: File[];
  /** Every file's outcome, in order, once each is ready or refused; rejects when the drop could not go at all. */
  done: Promise<FileOutcome[]>;
  batchId: string | null;
  over: boolean;
  answer(answer: Omit<FileAnswer, 'batchId'>): void;
  /** Answers every file still open, on the page's behalf. */
  refuse(reason: RefusedReason): void;
  fail(err: Error): void;
  /** Every file is out: from now on the drop waits FILE_WAIT_MS at most for each answer. */
  sent(batchId: string): void;
}

/** One drop of files, each answered once. */
export function openDrop(files: File[], onStatus: (progress: FileProgress) => void = () => {}): Drop {
  const outcome: (FileOutcome | null)[] = files.map(() => null);
  let resolve!: (outcome: FileOutcome[]) => void;
  let reject!: (err: Error) => void;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<FileOutcome[]>((res, rej) => { resolve = res; reject = rej; });
  const close = () => { drop.over = true; clearTimeout(timer); };
  // The agent reads files in turn, so a drop may wait long between answers:
  // it fails only after FILE_WAIT_MS without any.
  const wait = () => {
    clearTimeout(timer);
    timer = setTimeout(() => drop.refuse('failed'), FILE_WAIT_MS);
  };
  const drop: Drop = {
    files, done, batchId: null, over: false,
    answer({ index, name, status, reason }) {
      if (drop.over || !Number.isInteger(index) || !files[index] || outcome[index]) return;
      const named = name || files[index].name;
      onStatus(withReason({ index, name: named, status }, reason));
      if (status === 'ready' || status === 'refused') outcome[index] = withReason({ name: named, status }, reason);
      if (outcome.every(Boolean)) {
        close();
        resolve(outcome as FileOutcome[]);
      } else if (drop.batchId) {
        wait();
      }
    },
    refuse(reason) {
      files.forEach((file, index) => drop.answer({ index, name: file.name, status: 'refused', reason }));
    },
    fail(err) { close(); reject(err); },
    sent(batchId) {
      drop.batchId = batchId;
      if (!drop.over) wait();
    },
  };
  return drop;
}

/**
 * The drops not yet answered in full. LiveKit resolves sendText, and so tells
 * the page a drop's batchId, only once every file is out, so the agent's first
 * answers can come before it: they wait while a drop is still uploading.
 */
export function createDrops() {
  const open = new Set<Drop>();
  let early: FileAnswer[] = [];
  const uploading = () => [...open].some((drop) => !drop.batchId);
  return {
    add(drop: Drop) {
      open.add(drop);
      drop.done.finally(() => open.delete(drop)).catch(() => {});
    },
    answer(answer: FileAnswer) {
      const drop = [...open].find((d) => d.batchId === answer.batchId);
      if (drop) drop.answer(answer);
      else if (uploading()) early.push(answer);
    },
    sent(drop: Drop, batchId: string) {
      drop.sent(batchId);
      const mine = early.filter((answer) => answer.batchId === batchId);
      early = early.filter((answer) => answer.batchId !== batchId);
      if (!uploading()) early = [];
      mine.forEach((answer) => drop.answer(answer));
    },
    /** Refuses what is not answered yet, in every drop (the call ended). */
    refuse(reason: RefusedReason) { open.forEach((drop) => drop.refuse(reason)); },
    /** Refuses the drops still uploading (a reconnect cut their streams). */
    refuseUploading(reason: RefusedReason) { open.forEach((drop) => { if (!drop.batchId) drop.refuse(reason); }); },
  };
}

/**
 * The conversation's agent. The renderer publishes the host on its behalf and
 * names it in lk.publish_on_behalf; with no renderer, it is the agent
 * participant that publishes on nobody's behalf.
 */
export function agentIn(room: Pick<Room, 'remoteParticipants'>): Participant | undefined {
  const others = [...room.remoteParticipants.values()];
  const named = others.map((p) => p.attributes?.['lk.publish_on_behalf']).find(Boolean);
  return (named ? room.remoteParticipants.get(named) : undefined)
    ?? others.find((p) => p.isAgent && !p.attributes?.['lk.publish_on_behalf']);
}

/** A drop's caption as the agent reads it: at most MAX_CAPTION characters. */
export function cutCaption(caption: string | undefined): string | undefined {
  return caption == null ? undefined : Array.from(String(caption)).slice(0, MAX_CAPTION).join('');
}
