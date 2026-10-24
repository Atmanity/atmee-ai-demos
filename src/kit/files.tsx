// Handing the host files in the call: a button and a drop area that send what
// the user picks (or drags onto it) to the host, and each file's progress in
// the product's words. The host reads every file, says something about the
// drop once, and answers questions from it for the rest of the call.
//
// It is offered only while the host takes files (Avatar.filesAccepted). An app
// that reads the files itself too (a scorer of its own) gets them in onFiles
// before they go.
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { FileError, MAX_FILES, type FileOutcome, type FileProgress, type FileStatus } from '../avatar/files.ts';
import type { Avatar } from './useAvatar.ts';
import './files.css';

/** What a refusal reason means to the user. */
export const REFUSED_WORDS: Record<string, string> = {
  too_large: 'too large to read',
  unsupported_type: "a kind of file that can't be read",
  unsafe: 'not read',
  too_many_files: 'one file too many',
  unreadable: "couldn't be read",
  failed: "couldn't be read",
};

const STATUS_WORDS: Record<FileStatus | 'sending', string> = {
  sending: 'Sending…', received: 'Received', reading: 'Reading…', ready: 'Read', refused: 'Not read',
};

export interface SharedFile { name: string; status: FileStatus | 'sending'; reason?: string }

/** The words for one file's progress: "Reading…", "Read", "Not read: too large to read". */
export function fileWords(file: SharedFile): string {
  if (file.status !== 'refused') return STATUS_WORDS[file.status];
  return `${STATUS_WORDS.refused}: ${REFUSED_WORDS[file.reason ?? ''] ?? REFUSED_WORDS.failed}`;
}

export function FileDrop({ avatar, name = 'your host', accept, label = 'Share files', hint, caption, onFiles, onShared, className = '', children }: {
  avatar: Avatar;
  /** The host's name, for the words around the drop. */
  name?: string;
  /** What the picker offers (an input's accept): image/*,.pdf,… The host reads images, PDFs, text, audio and video. */
  accept?: string;
  label?: string;
  /** A line under the button: what to drop here. */
  hint?: string;
  /** What the user says with the drop, as the host reads it beside the files. */
  caption?: string | ((files: File[]) => string | undefined);
  /** Before the files go: an app that reads them itself too (its own scorer) takes them here. */
  onFiles?: (files: File[]) => void;
  /** Every file is ready or refused. */
  onShared?: (files: File[], outcome: FileOutcome[]) => void;
  className?: string;
  /** Laid inside the drop area, under the button. */
  children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [shared, setShared] = useState<SharedFile[]>([]);
  const [problem, setProblem] = useState('');
  const [over, setOver] = useState(false);
  // The drop on show: a later one replaces it, and the earlier one's answers no longer show.
  const current = useRef(0);
  const live = avatar.phase === 'live';
  const open = live && avatar.filesAccepted;
  const note = open ? hint : live ? `${name} can't take files in this call.` : hint && `Once you're in the call with ${name}.`;

  const share = async (picked: File[]) => {
    if (!open || !picked.length) return;
    setProblem('');
    if (picked.length > MAX_FILES) {
      setProblem(`At most ${MAX_FILES} files at a time.`);
      return;
    }
    onFiles?.(picked);
    const id = ++current.current;
    setShared(picked.map((file) => ({ name: file.name, status: 'sending' })));
    const onStatus = ({ index, status, reason }: FileProgress) => {
      if (id !== current.current) return;
      setShared((now) => now.map((file, i) => (i === index ? { ...file, status, ...(reason ? { reason } : {}) } : file)));
    };
    try {
      const said = typeof caption === 'function' ? caption(picked) : caption;
      const outcome = await avatar.sendFiles(picked, { caption: said, onStatus });
      onShared?.(picked, outcome);
    } catch (err) {
      if (id !== current.current) return;
      setShared([]);
      const code = err instanceof FileError ? err.code : '';
      setProblem(code === 'files_unsupported' ? `${name} can't take files in this call.` : "The files couldn't be sent. Try again.");
    }
  };

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    void share([...event.dataTransfer.files]);
  };

  return (
    <div
      className={`call-files ${over ? 'is-over' : ''} ${open ? '' : 'is-closed'} ${className}`}
      onDragOver={(event) => { if (open) { event.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <input
        ref={input} type="file" multiple hidden accept={accept} aria-label={label}
        onChange={(event) => { void share([...(event.target.files ?? [])]); event.target.value = ''; }}
      />
      <button type="button" className="call-files-button" disabled={!open} onClick={() => input.current?.click()}>
        {label}
      </button>
      {note && <span className="call-files-hint">{note}</span>}
      {children}
      {problem && <p className="call-files-problem" role="alert">{problem}</p>}
      {shared.length > 0 && (
        <ul className="call-files-list" aria-label="Shared files">
          {shared.map((file, i) => (
            <li key={i} className={`call-file is-${file.status}`}>
              <span className="call-file-name">{file.name}</span>
              <span className="call-file-status">{fileWords(file)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
