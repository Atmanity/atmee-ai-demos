// What the Stand-in desk offers, shared by the page and the server (which accepts only these).
export const HEARD = [
  { id: 'multi', label: 'Auto-detect' },
  { id: 'en', label: 'English' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
] as const;

export const TARGETS = [
  { id: 'same', label: 'The language you speak' },
  { id: 'English', label: 'English' },
  { id: 'Traditional Chinese', label: '繁體中文' },
  { id: 'Japanese', label: '日本語' },
  { id: 'Korean', label: '한국어' },
  { id: 'Spanish', label: 'Español' },
  { id: 'French', label: 'Français' },
  { id: 'German', label: 'Deutsch' },
] as const;

export const TONES = [
  { id: 'professional', label: 'Professional' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'faithful', label: 'As I said it' },
] as const;

export const isHeard = (id: unknown) => HEARD.some((h) => h.id === id);
export const isTarget = (id: unknown) => TARGETS.some((t) => t.id === id);
export const isTone = (id: unknown) => TONES.some((t) => t.id === id);
