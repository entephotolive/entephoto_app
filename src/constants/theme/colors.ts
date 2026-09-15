// ─────────────────────────────────────────────────────────────────────────────
// colors.ts — Single source of truth for all color tokens
// ─────────────────────────────────────────────────────────────────────────────

// ── Structured interface used by ThemeProvider / useTheme() ──────────────────

export interface ThemeColors {
  // Backgrounds / Surfaces
  background: string;
  surface: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerElevated: string;
  surfaceContainerLow: string;
  surfaceElevated: string; // alias → surfaceContainerElevated

  // Primary & Accents
  primary: string; // alias → primaryContainer
  primaryContainer: string;
  primaryBright: string;
  primaryPressed: string; // alias → primaryBright
  primaryMuted: string;

  // Semantic accents
  secondary: string;
  tertiary: string;

  // Typography
  textHighContrast: string;
  textMuted: string;
  textDim: string;
  textPrimary: string; // alias → textHighContrast
  textSecondary: string; // alias → textMuted
  textTertiary: string; // alias → textDim
  text: string; // alias → textHighContrast
  textInverse: string;

  // Borders
  borderSubtle: string;
  borderStrong: string;
  border: string; // alias → borderSubtle

  // Status
  success: string;
  error: string;
  warning: string;
  statusMint: string; // alias → success
  statusAmber: string; // alias → warning
  statusRed: string; // alias → error

  // Badge backgrounds (contextual)
  badgeSecure: string;
  badgeSimple: string;
  badgeFast: string;

  // Card
  card: string; // alias → surface

  // Pure
  black: string;
  white: string;
}

// ── Dark theme (app default — coral/neo-brutalist) ───────────────────────────

export const darkColors: ThemeColors = {
  // Backgrounds / Surfaces
  background: '#131315',
  surface: '#131315',
  surfaceContainer: '#222226',
  surfaceContainerHigh: '#32323A',
  surfaceContainerElevated: '#2A2A30',
  surfaceContainerLow: '#1A1A1E',
  surfaceElevated: '#2A2A30',

  // Primary & Accents
  primary: '#FF5E3A',
  primaryContainer: '#FF5E3A',
  primaryBright: '#FF6F4E',
  primaryPressed: '#FF6F4E',
  primaryMuted: '#3D1F18',

  // Semantic accents
  secondary: '#45DFA4',
  tertiary: '#F9BD22',

  // Typography
  textHighContrast: '#F4F4F5',
  textMuted: '#A1A1AA',
  textDim: '#71717A',
  textPrimary: '#F4F4F5',
  textSecondary: '#A1A1AA',
  textTertiary: '#71717A',
  text: '#F4F4F5',
  textInverse: '#131315',

  // Borders
  borderSubtle: '#2E2E36',
  borderStrong: '#3F3F46',
  border: '#2E2E36',

  // Status
  success: '#45DFA4',
  error: '#EF4444',
  warning: '#F9BD22',
  statusMint: '#45DFA4',
  statusAmber: '#F9BD22',
  statusRed: '#EF4444',

  // Badge backgrounds
  badgeSecure: '#1E2A20',
  badgeSimple: '#1A1F2E',
  badgeFast: '#2A1A10',

  // Card
  card: '#222226',

  // Pure
  black: '#000000',
  white: '#FFFFFF',
};

// ── Light theme ───────────────────────────────────────────────────────────────

export const lightColors: ThemeColors = {
  // Backgrounds / Surfaces
  background: '#F4F4F5',
  surface: '#FFFFFF',
  surfaceContainer: '#F1F1F3',
  surfaceContainerHigh: '#E4E4E8',
  surfaceContainerElevated: '#EBEBEF',
  surfaceContainerLow: '#F8F8FA',
  surfaceElevated: '#EBEBEF',

  // Primary & Accents
  primary: '#FF5E3A',
  primaryContainer: '#FF5E3A',
  primaryBright: '#FF6F4E',
  primaryPressed: '#E04A28',
  primaryMuted: '#FFE0D9',

  // Semantic accents
  secondary: '#1BB87A',
  tertiary: '#D4960A',

  // Typography
  textHighContrast: '#131315',
  textMuted: '#52525B',
  textDim: '#A1A1AA',
  textPrimary: '#131315',
  textSecondary: '#52525B',
  textTertiary: '#A1A1AA',
  text: '#131315',
  textInverse: '#FFFFFF',

  // Borders
  borderSubtle: '#D4D4D8',
  borderStrong: '#A1A1AA',
  border: '#D4D4D8',

  // Status
  success: '#16A34A',
  error: '#DC2626',
  warning: '#D97706',
  statusMint: '#16A34A',
  statusAmber: '#D97706',
  statusRed: '#DC2626',

  // Badge backgrounds
  badgeSecure: '#DCFCE7',
  badgeSimple: '#DBEAFE',
  badgeFast: '#FEF3C7',

  // Card
  card: '#FFFFFF',

  // Pure
  black: '#000000',
  white: '#FFFFFF',
};

// ── Flat COLORS constant — used by components that import directly ─────────────
// Always points to the dark (default) palette. For dynamic theming use useTheme().

export const COLORS = darkColors;

// Default export for ThemeProvider internals
export const colors = darkColors;
