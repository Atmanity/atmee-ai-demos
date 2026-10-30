// A call's transcript as lines, from the two streams the speech server sends:
// the user's whole message so far (replaced as recognition goes, then final)
// and the avatar's words as their audio goes out. The user's open message
// and the avatar's open line are kept by id, because neither waits for the
// other: the user's message can turn final after the avatar's answer has
// begun, and the avatar's last words can arrive after the user started.

export interface SpeechLine {
  id: number;
  who: 'avatar' | 'user';
  text: string;
  /** The user's message is over, or the avatar's line closed (the user spoke next, or the call ended). */
  final: boolean;
  /** The avatar was cut off by the user's next words. */
  cut?: boolean;
  /** Listener feedback ("mm-hm") the avatar talked on through: no turn of its own. */
  backchannel?: boolean;
}

/** A line that counts as said: the user's once final, the avatar's once closed. */
export interface Said { who: SpeechLine['who']; text: string }

export class CallLines {
  lines: SpeechLine[] = [];
  private next = 0;
  private userOpen: number | null = null;
  private avatarOpen: number | null = null;
  private lastAvatar: number | null = null;

  constructor(private readonly keep = 120) {}

  /** The user's current message; returns what now counts as said. */
  user(text: string, final: boolean, tags: { interruption?: boolean; backchannel?: boolean } = {}): Said[] {
    if (!text) return [];
    if (tags.backchannel) {
      this.add({ who: 'user', text, final: true, backchannel: true });
      return [];
    }
    const said: Said[] = [];
    if (tags.interruption && this.lastAvatar !== null) this.patch(this.lastAvatar, (l) => ({ ...l, cut: true }));
    if (this.userOpen === null) {
      said.push(...this.closeAvatar());
      this.userOpen = this.add({ who: 'user', text, final });
    } else {
      this.patch(this.userOpen, (l) => ({ ...l, text, final }));
    }
    if (final) {
      this.userOpen = null;
      said.push({ who: 'user', text });
    }
    return said;
  }

  /** The avatar's next words. */
  avatar(delta: string): void {
    if (this.avatarOpen === null) {
      if (!delta.trim()) return;
      this.avatarOpen = this.lastAvatar = this.add({ who: 'avatar', text: delta.trimStart(), final: false });
    } else {
      this.patch(this.avatarOpen, (l) => ({ ...l, text: l.text + delta }));
    }
  }

  /** The call is over: every open line is as final as it will be. */
  close(): Said[] {
    const said = this.closeAvatar();
    if (this.userOpen !== null) this.patch(this.userOpen, (l) => ({ ...l, final: true }));
    this.userOpen = null;
    return said;
  }

  private closeAvatar(): Said[] {
    const id = this.avatarOpen;
    this.avatarOpen = null;
    const line = this.lines.find((l) => l.id === id);
    if (!line) return [];
    this.patch(line.id, (l) => ({ ...l, final: true }));
    return [{ who: 'avatar', text: line.text.trim() }];
  }

  private add(line: Omit<SpeechLine, 'id'>): number {
    const id = ++this.next;
    this.lines = [...this.lines, { ...line, id }].slice(-this.keep);
    return id;
  }

  private patch(id: number, change: (l: SpeechLine) => SpeechLine): void {
    this.lines = this.lines.map((l) => (l.id === id ? change(l) : l));
  }
}
