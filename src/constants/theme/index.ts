// ─────────────────────────────────────────────────────────────────────────────
// index.ts — Theme module barrel
// All theme tokens and the ThemeProvider/useTheme hook are exported from here.
// Import from '@/constants/theme' in your screens and components.
// ─────────────────────────────────────────────────────────────────────────────

export * from './colors';
export * from './typography';
export * from './spacing';
export * from './shadows';
export {
  ThemeProvider,
  useTheme,
  type Theme,
  type ThemeMode,
  type ThemeProviderProps,
} from './ThemeProvider';
