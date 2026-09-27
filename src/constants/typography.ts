// ─────────────────────────────────────────────────────────────────────────────
// constants/typography.ts — Shim
//
// Typography tokens have been consolidated into src/constants/theme/typography.ts
// and are re-exported through '@/constants/theme'.
//
// This shim keeps existing imports working:
//   import { TYPOGRAPHY, FONTS } from '@/constants/typography'
//
// Prefer importing from '@/constants/theme' in new code.
// ─────────────────────────────────────────────────────────────────────────────

export { FONTS, TYPOGRAPHY } from './theme/typography';
