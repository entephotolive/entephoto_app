// ─────────────────────────────────────────────────────────────────────────────
// constants/theme.ts — Public entry-point shim
//
// All theme tokens now live in src/constants/theme/ (the directory).
// This file is a transparent re-export so that existing imports like:
//
//   import { COLORS, useTheme } from '@/constants/theme'
//
// continue to resolve without any changes across the codebase.
// ─────────────────────────────────────────────────────────────────────────────

export * from './theme/index';
