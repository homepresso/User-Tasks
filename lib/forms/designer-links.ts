/**
 * Where the form designer lives. A reusable form opened from the Forms
 * library (or a search result, the ⌘K palette, an Agent link) is edited on
 * its own full page, /automations/forms/<id> — like a workflow at
 * /automations/<id>. A new form starts at /automations/forms/new. The
 * workflow builder keeps the designer dialog for a step's own form and a
 * workflow's start form. Client-safe (no server imports).
 */

export const FORMS_LIBRARY_HREF = '/automations/forms'
export const NEW_FORM_HREF = '/automations/forms/new'

/** The full-page designer of a saved form. */
export function formDesignerHref(id: string): string {
  return `${FORMS_LIBRARY_HREF}/${encodeURIComponent(id)}`
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams

function param(params: Params, key: string): string | null {
  if (params instanceof URLSearchParams) return params.get(key)
  const v = params[key]
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

/**
 * Old deep links into the library's designer dialog, as the page they now
 * mean: `?open=<id>` → the form's designer page, `?new=1` (⌘K "Create
 * form") → the new-form page. Anything else stays on the library (null):
 * `?q=`, `?submissions=`, `?details=` are still the library's own.
 */
export function legacyFormsRedirect(params: Params): string | null {
  const open = param(params, 'open')?.trim()
  if (open) return formDesignerHref(open)
  if (param(params, 'new') === '1') return NEW_FORM_HREF
  return null
}
