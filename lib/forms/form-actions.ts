/**
 * The icons in a form's top-right corner where a person fills it in (/f/<id>
 * pages and the Run dialog of a workflow that starts from the form):
 *
 *  - favourite (heart): add / remove the form from the person's favourites
 *    (form_favorites; Home → Favourite forms, the Forms menu);
 *  - save draft: keep the person's current answers on the server
 *    (form_drafts; offered back as "Resume your draft from <date>?").
 *
 * Both are ON by default — for every form, old ones included. The designer
 * turns them off in Buttons & header; only what is off is stored, in the
 * layout's own key (`layout.form_actions`), so the setting travels with
 * versions, export, packages and the API like the rest of the layout.
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'

/** Stored shape: only the icons turned off (absent = on). */
export interface FormActionsConfig {
  favorite?: false
  draft?: false
}

export interface ResolvedFormActions {
  favorite: boolean
  draft: boolean
}

/** Stored `layout.form_actions` → its clean form (null when everything is on). */
export function normalizeFormActions(raw: unknown): FormActionsConfig | null {
  if (!isPlainObject(raw)) return null
  const out: FormActionsConfig = {}
  if (raw.favorite === false) out.favorite = false
  if (raw.draft === false) out.draft = false
  return Object.keys(out).length ? out : null
}

/** Which icons the form shows (default: both). */
export function formActions(layout: unknown): ResolvedFormActions {
  const config = isPlainObject(layout) ? normalizeFormActions(layout.form_actions) : null
  return { favorite: config?.favorite !== false, draft: config?.draft !== false }
}

/** The layout with one icon turned on / off (the key is dropped when both are on). */
export function withFormAction<T extends { form_actions?: FormActionsConfig }>(layout: T, action: keyof ResolvedFormActions, on: boolean): T {
  const next: FormActionsConfig = { ...(normalizeFormActions(layout.form_actions) ?? {}) }
  if (on) delete next[action]
  else next[action] = false
  const out = { ...layout }
  if (Object.keys(next).length) out.form_actions = next
  else delete out.form_actions
  return out
}

/* ── Drafts ──────────────────────────────────────────────────────────── */

/** Largest draft the server keeps (values + parameters as JSON text); the table enforces the same. */
export const FORM_DRAFT_MAX_BYTES = 256 * 1024

/** A draft's size in bytes as stored (UTF-8 JSON). */
export function draftBytes(values: unknown, params: unknown = null): number {
  const text = JSON.stringify(values ?? {}) + (params ? JSON.stringify(params) : '')
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length
}

/** "Resume your draft from 3 Nov, 14:05?" — the date in the person's locale. */
export function draftPrompt(updatedAt: string, locale?: string): string {
  const d = new Date(updatedAt)
  const when = Number.isNaN(d.getTime()) ? 'earlier' : d.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return `Resume your draft from ${when}?`
}
