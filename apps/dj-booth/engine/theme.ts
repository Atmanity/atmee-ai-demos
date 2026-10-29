// The booth's look for each record, written by a model from the record and its
// cover: a palette, a display face, a backdrop and a mood. Whatever comes
// back is checked here, so a bad answer can never make the page unreadable.
import type { Track } from './types.ts';

/** The display faces the page loads (index.html): the model picks one by name. */
export const FONTS = ['Archivo Black', 'DM Serif Display', 'Syne', 'Unbounded', 'Fraunces', 'Space Grotesk', 'Righteous', 'Playfair Display'] as const;
/** How the backdrop moves: slow drifting colour, soft lights, a beat-like pulse, or still grain. */
export const BACKDROPS = ['aurora', 'bokeh', 'pulse', 'grain'] as const;

export interface Theme {
  mood: string;
  /** Page background, panels, text, quiet text, the accent and a second accent for the backdrop. */
  bg: string; surface: string; ink: string; dim: string; accent: string; glow: string;
  font: (typeof FONTS)[number];
  backdrop: (typeof BACKDROPS)[number];
}

export const DEFAULT_THEME: Theme = {
  mood: 'late-night radio', bg: '#120f0e', surface: '#1f1a17', ink: '#f6efe7', dim: '#a8998c', accent: '#ffb547', glow: '#ff5a4e',
  font: 'Archivo Black', backdrop: 'aurora',
};

const COLOR = { type: 'string', description: 'A colour as #rrggbb.' };

export const THEME_SCHEMA = {
  type: 'object',
  properties: {
    mood: { type: 'string', description: 'Two to four words for the record\'s feel, e.g. "sunlit disco strut".' },
    bg: { ...COLOR, description: 'The page background: deep and dark enough for light text, tinted with the record\'s world.' },
    surface: { ...COLOR, description: 'Panels on the background: a little lighter than bg, same hue family.' },
    ink: { ...COLOR, description: 'Main text: very light, readable on bg.' },
    dim: { ...COLOR, description: 'Secondary text: muted, still readable on bg.' },
    accent: { ...COLOR, description: 'The signature colour: buttons, progress, highlights. Vivid, from the cover.' },
    glow: { ...COLOR, description: 'A second vivid colour for the moving backdrop, distinct from accent.' },
    font: { type: 'string', enum: [...FONTS], description: 'The display face that fits the record.' },
    backdrop: { type: 'string', enum: [...BACKDROPS], description: 'aurora: slow drifting colour (dreamy, soulful); bokeh: soft floating lights (romantic, jazzy, night); pulse: a breathing beat (dance, house, hip-hop); grain: still, textured (folk, rock, lo-fi, classical).' },
  },
  required: ['mood', 'bg', 'surface', 'ink', 'dim', 'accent', 'glow', 'font', 'backdrop'],
};

export const THEME_SYSTEM = 'You are the art director of a live radio show\'s web page. For each record you restyle the page so it feels like that record: its era, genre, mood and cover art. Keep it tasteful and readable: a dark background with light text.';

export const themePrompt = (t: Track) =>
  `Style the page for "${t.title}" by ${t.artist}${t.album ? `, from ${t.album}` : ''}${t.year ? ` (${t.year})` : ''}. The cover art is attached when available: draw the accent and glow from it.`;

const HEX = /^#[0-9a-f]{6}$/i;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `hex` moved toward white (amount > 0) or black (< 0), by a share of the way. */
export function mix(hex: string, amount: number): string {
  const target = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  return `#${[1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(c + (target - c) * k).toString(16).padStart(2, '0');
  }).join('')}`;
}

/** Nudges `fg` lighter until it reads on `bg` at `ratio` (white at worst). */
function readable(fg: string, bg: string, ratio: number): string {
  let c = fg;
  for (let i = 0; i < 10 && contrast(c, bg) < ratio; i++) c = mix(c, 0.25);
  return contrast(c, bg) >= ratio ? c : '#ffffff';
}

/** A model's answer as a theme the page can trust: valid colours, a dark page, readable text, known names. */
export function themeFrom(raw: any): Theme {
  if (!raw || typeof raw !== 'object') return DEFAULT_THEME;
  const color = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);
  let bg = color(raw.bg, DEFAULT_THEME.bg);
  // The page is always dark: a light background is darkened until light text reads on it.
  for (let i = 0; i < 10 && luminance(bg) > 0.05; i++) bg = mix(bg, -0.3);
  const surface = color(raw.surface, mix(bg, 0.08));
  return {
    mood: typeof raw.mood === 'string' && raw.mood.trim() ? raw.mood.trim().slice(0, 40) : DEFAULT_THEME.mood,
    bg,
    surface: contrast(surface, bg) > 2 ? mix(bg, 0.08) : surface,
    ink: readable(color(raw.ink, DEFAULT_THEME.ink), bg, 7),
    dim: readable(color(raw.dim, DEFAULT_THEME.dim), bg, 4.5),
    accent: readable(color(raw.accent, DEFAULT_THEME.accent), bg, 3),
    glow: color(raw.glow, DEFAULT_THEME.glow),
    font: (FONTS as readonly string[]).includes(raw.font) ? raw.font : DEFAULT_THEME.font,
    backdrop: (BACKDROPS as readonly string[]).includes(raw.backdrop) ? raw.backdrop : DEFAULT_THEME.backdrop,
  };
}
