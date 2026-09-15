// ─────────────────────────────────────────────────────────────────────────────
// spacing.ts — Spacing scale & border-radius tokens
// ─────────────────────────────────────────────────────────────────────────────

// ── Spacing scale ─────────────────────────────────────────────────────────────

export const SPACING = {
  '2xs': 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 40,
  '3xl': 48,
  '4xl': 64,
} as const;

// Alias used by ThemeProvider
export const spacing = SPACING;

// ── Border-radius scale ───────────────────────────────────────────────────────

export const RADII = {
  none: 0,
  xs: 4,
  sm: 8,
  standard: 8,
  md: 12,
  card: 16,
  lg: 16,
  modal: 16,
  xl: 24,
  sheet: 24,
  '2xl': 32,
  pill: 9999,
  full: 9999,
} as const;

// Aliases used by ThemeProvider
export const radius = RADII;
export const radii = RADII;

// ── Types ─────────────────────────────────────────────────────────────────────

export type Spacing = typeof SPACING;
export type Radius = typeof RADII;
export type Radii = typeof RADII;
