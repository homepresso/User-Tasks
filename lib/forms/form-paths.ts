/**
 * Form page paths: pure string helpers with no imports, so the dashboard
 * shell (the Forms menu, nav, Home) can link to forms without pulling the
 * form-field engine (workflow-start-form → task-field-schema → form rules,
 * expression functions, fonts …) into every route's client bundle.
 */

/** The standalone page of a form (/f/<id>), the address people share. */
export function formPagePath(formId: string): string {
  return `/f/${encodeURIComponent(formId)}`
}

export function formPageUrl(origin: string, formId: string): string {
  return `${origin.replace(/\/+$/, '')}${formPagePath(formId)}`
}

/** The in-app page of a form: inside the dashboard shell (/fill/<id>). */
export function formAppPath(formId: string): string {
  return `/fill/${encodeURIComponent(formId)}`
}

/**
 * Where an in-app link to a form goes (the Forms menu, Home favourites,
 * search): the form inside the app, /fill/<id>. Links people share
 * (/f/<id>, /form/<system name>) open the form on its own page, without the
 * shell (docs/changes/standalone-forms.md).
 */
export function formHref(form: { id: string; system_name?: string | null }): string {
  return formAppPath(form.id)
}
