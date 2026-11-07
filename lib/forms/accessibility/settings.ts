/**
 * The workspace's pre-publish accessibility check for forms, stored in
 * `tenants.settings.forms.accessibility`:
 *   mode       off   — no check when saving
 *              warn  — the designer warns below min_score ("Save anyway")
 *              block — the designer and the forms service refuse to save /
 *                      publish a reusable form below min_score
 *   min_score  0–100 (default 80)
 * Client-safe.
 */

export type FormAccessibilityMode = 'off' | 'warn' | 'block'

export interface FormAccessibilitySettings {
  mode: FormAccessibilityMode
  min_score: number
}

export const DEFAULT_FORM_ACCESSIBILITY: FormAccessibilitySettings = { mode: 'warn', min_score: 80 }

/** Stored value (anything) → settings with defaults. */
export function parseFormAccessibilitySettings(raw: unknown): FormAccessibilitySettings {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const mode = obj.mode === 'off' || obj.mode === 'warn' || obj.mode === 'block' ? obj.mode : DEFAULT_FORM_ACCESSIBILITY.mode
  const n = Number(obj.min_score)
  const min = Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : DEFAULT_FORM_ACCESSIBILITY.min_score
  return { mode, min_score: min }
}

/** The settings from a tenants.settings value. */
export function formAccessibilityFromTenantSettings(settings: unknown): FormAccessibilitySettings {
  const forms = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).forms : undefined
  const raw = forms && typeof forms === 'object' ? (forms as Record<string, unknown>).accessibility : undefined
  return parseFormAccessibilitySettings(raw)
}
