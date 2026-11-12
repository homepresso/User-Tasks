'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession, isServiceError } from '@/lib/services/context'
import * as forms from '@/lib/services/forms'
import { findRecentDuplicate } from '@/lib/recent-duplicate'
import type { SubmitFormInput, SubmitFormResult } from '@/lib/services/form-submissions'

/*
 * Reusable forms and form themes (Forms library page, form designer): thin
 * wrappers over lib/services/forms — permissions (forms.view / .edit /
 * .delete), validation, versioning, usage checks and audit live there.
 * Failures come back as { ok: false, error } (blocked deletes list usages).
 */

function run<T>(label: string, fallback: string, fn: (ctx: Awaited<ReturnType<typeof fromSession>>) => Promise<T>): Promise<ActionResult<T>> {
  return runAction(label, fallback, async () => fn(await fromSession()))
}

// A repeated create from the UI (double click, retry) reuses the record this
// user created with the same name moments ago. Only these UI actions dedupe:
// imports, duplicates and the REST / MCP callers keep plain create semantics.
async function recentByName<T>(ctx: Awaited<ReturnType<typeof fromSession>>, table: string, name: unknown, select: string): Promise<T | null> {
  if (!ctx.actorId) return null
  return findRecentDuplicate<T>(ctx.supabase, table, { tenant_id: ctx.tenantId, created_by: ctx.actorId, name: String(name ?? '').trim() }, { select })
}

export async function createForm(input: forms.FormInput) {
  return run('createForm', 'Could not save the form.', async (ctx) =>
    (await recentByName<forms.FormRow>(ctx, 'forms', input.name, '*')) ?? forms.createForm(ctx, input))
}

export async function updateForm(formId: string, input: forms.FormUpdateInput) {
  return run('updateForm', 'Could not save the form.', (ctx) => forms.updateForm(ctx, formId, input))
}

export async function duplicateForm(formId: string, name?: string) {
  return run('duplicateForm', 'Could not duplicate the form.', (ctx) => forms.duplicateForm(ctx, formId, name))
}

export async function deleteForm(formId: string) {
  return run('deleteForm', 'Could not delete the form.', (ctx) => forms.deleteForm(ctx, formId))
}

export async function createFormTheme(input: forms.FormThemeInput) {
  return run('createFormTheme', 'Could not save the form theme.', async (ctx) =>
    (await recentByName<forms.FormThemeRow>(ctx, 'form_themes', input.name, '*')) ?? forms.createFormTheme(ctx, input))
}

export async function updateFormTheme(themeId: string, input: Partial<forms.FormThemeInput>) {
  return run('updateFormTheme', 'Could not save the form theme.', (ctx) => forms.updateFormTheme(ctx, themeId, input))
}

export async function deleteFormTheme(themeId: string) {
  return run('deleteFormTheme', 'Could not delete the form theme.', (ctx) => forms.deleteFormTheme(ctx, themeId))
}

type SubmitActionResult = ActionResult<SubmitFormResult> & { fields?: Record<string, string> }

async function submitFrom(formId: string, input: SubmitFormInput, surface: 'page' | 'run_dialog', label: string): Promise<SubmitActionResult> {
  try {
    const { submitForm } = await import('@/lib/services/form-submissions')
    return { ok: true, data: await submitForm(await fromSession(), formId, input, { source: 'standalone', ...(surface === 'run_dialog' ? { surface } : {}) }) }
  } catch (error) {
    if (isServiceError(error)) {
      const details = error.details as { fields?: Record<string, string> } | undefined
      return { ok: false, error: error.message, ...(details?.fields ? { fields: details.fields } : {}) }
    }
    console.error(`[${label}]`, error)
    return { ok: false, error: 'Could not submit the form.' }
  }
}

/** Submit a form from its own page; field errors come back per field. */
export async function submitStandaloneForm(formId: string, input: SubmitFormInput): Promise<SubmitActionResult> {
  return submitFrom(formId, input, 'page', 'submitStandaloneForm')
}

/** Submit a workflow's trigger form from the Run dialog ({{submission.source}} = run_dialog; set here, never by the request). */
export async function submitRunDialogForm(formId: string, input: SubmitFormInput): Promise<SubmitActionResult> {
  return submitFrom(formId, input, 'run_dialog', 'submitRunDialogForm')
}

/** Header image upload (PNG, JPEG, SVG — sanitised — or WebP, ≤ 1 MB). */
export async function uploadFormHeaderImage(formData: FormData) {
  return run('uploadFormHeaderImage', 'Could not upload the image.', async (ctx) => {
    const file = formData.get('file')
    if (!(file instanceof File)) throw new Error('No file')
    const { uploadFormHeaderImage: upload } = await import('@/lib/services/uploads')
    return upload(ctx, { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })
  })
}

/** A picture for a form's layout (Display image, an Image field's default picture): PNG, JPEG, WebP or GIF, ≤ 2 MB. */
export async function uploadFormImage(formData: FormData) {
  return run('uploadFormImage', 'Could not upload the image.', async (ctx) => {
    const file = formData.get('file')
    if (!(file instanceof File)) throw new Error('No file')
    const { uploadFormImage: upload } = await import('@/lib/services/uploads')
    return upload(ctx, { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })
  })
}

/**
 * An in-form button's "Open link" to another host: the address when it is
 * allowed (an app page, the app's origin or a FORM_REDIRECT_ALLOWLIST host —
 * the redirect rule), else null. Reads nothing; safe for any visitor.
 */
export async function checkFormLink(url: string): Promise<string | null> {
  const { safeRedirectUrl } = await import('@/lib/forms/buttons')
  return safeRedirectUrl(typeof url === 'string' ? url.slice(0, 2000) : '', forms.redirectPolicy())
}

/** Save (replace) my draft of a reusable form: the Save draft icon (lib/services/form-drafts.ts). */
export async function saveFormDraft(formId: string, input: { values?: Record<string, unknown>; params?: Record<string, unknown> | null }) {
  return run('saveFormDraft', 'Could not save the draft.', async (ctx) => (await import('@/lib/services/form-drafts')).saveFormDraft(ctx, formId, input))
}

/** Delete my draft of a reusable form ("Start fresh"). */
export async function deleteFormDraft(formId: string) {
  return run('deleteFormDraft', 'Could not delete the draft.', async (ctx) => (await import('@/lib/services/form-drafts')).deleteFormDraft(ctx, formId))
}
