'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession, isServiceError } from '@/lib/services/context'
import * as forms from '@/lib/services/forms'
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

export async function createForm(input: forms.FormInput) {
  return run('createForm', 'Could not save the form.', (ctx) => forms.createForm(ctx, input))
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
  return run('createFormTheme', 'Could not save the form theme.', (ctx) => forms.createFormTheme(ctx, input))
}

export async function updateFormTheme(themeId: string, input: Partial<forms.FormThemeInput>) {
  return run('updateFormTheme', 'Could not save the form theme.', (ctx) => forms.updateFormTheme(ctx, themeId, input))
}

export async function deleteFormTheme(themeId: string) {
  return run('deleteFormTheme', 'Could not delete the form theme.', (ctx) => forms.deleteFormTheme(ctx, themeId))
}

/** Submit a form from its own page; field errors come back per field. */
export async function submitStandaloneForm(formId: string, input: SubmitFormInput): Promise<ActionResult<SubmitFormResult> & { fields?: Record<string, string> }> {
  try {
    const { submitForm } = await import('@/lib/services/form-submissions')
    return { ok: true, data: await submitForm(await fromSession(), formId, input, { source: 'standalone' }) }
  } catch (error) {
    if (isServiceError(error)) {
      const details = error.details as { fields?: Record<string, string> } | undefined
      return { ok: false, error: error.message, ...(details?.fields ? { fields: details.fields } : {}) }
    }
    console.error('[submitStandaloneForm]', error)
    return { ok: false, error: 'Could not submit the form.' }
  }
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
