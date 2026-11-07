/**
 * Form system names: the friendly link of a reusable form
 * (`/form/<system_name>` on the workspace's address). Pure, client-safe.
 *
 * Same style as workspace subdomains: lowercase a–z, 0–9 and hyphens,
 * 3–60 characters, no leading, trailing or double hyphen. Unique per
 * workspace; a renamed form keeps its old names as redirects
 * (form_system_name_history, migration 20261223000000_workspace_subdomains.sql,
 * whose CHECK constraint matches SYSTEM_NAME_RE).
 */

export const SYSTEM_NAME_MIN = 3
export const SYSTEM_NAME_MAX = 60

const SYSTEM_NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

export function systemNameProblem(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return 'Enter a system name.'
  if (value !== value.toLowerCase()) return 'Use lowercase letters only.'
  if (value.length < SYSTEM_NAME_MIN) return `Use at least ${SYSTEM_NAME_MIN} characters.`
  if (value.length > SYSTEM_NAME_MAX) return `Use at most ${SYSTEM_NAME_MAX} characters.`
  if (!SYSTEM_NAME_RE.test(value)) {
    return /^-|-$/.test(value) ? 'It can\'t start or end with a hyphen.' : 'Use only letters a–z, numbers and hyphens.'
  }
  if (value.includes('--')) return 'It can\'t contain two hyphens in a row.'
  return null
}

export function isValidSystemName(value: unknown): value is string {
  return systemNameProblem(value) === null
}

/**
 * The system name suggested from a form name ("Employee onboarding!" →
 * "employee-onboarding"). Mirrors public.form_system_name_base() in the
 * migration: a name with nothing usable left becomes "form".
 */
export function suggestSystemName(name: string): string {
  let s = String(name ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SYSTEM_NAME_MAX).replace(/-+$/g, '')
  if (!s) s = 'form'
  if (s.length < SYSTEM_NAME_MIN) s = `form-${s}`
  return s
}

/** `base`, else `base-2`, `base-3`, … — the first not in `taken` (cut so the suffix fits). */
export function nextFreeSystemName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; n < 10_000; n++) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, SYSTEM_NAME_MAX - suffix.length).replace(/-+$/g, '')}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base.slice(0, SYSTEM_NAME_MAX - 9)}-${Date.now().toString(36).slice(-8)}`
}
