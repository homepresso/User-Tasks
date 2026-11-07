'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import * as controls from '@/lib/services/form-controls'

/*
 * Custom form controls (Extensibility → Form controls): thin wrappers over
 * lib/services/form-controls — permissions, package validation, version
 * immutability, usage checks and audit live there. Failures come back as
 * { ok: false, error }.
 */

type Ctx = Awaited<ReturnType<typeof fromSession>>

function run<T>(label: string, fallback: string, fn: (ctx: Ctx) => Promise<T>): Promise<ActionResult<T>> {
  return runAction(label, fallback, async () => fn(await fromSession()))
}

/** Upload: FormData with `file` (a .zip, or a .js / .mjs module) and, for a module, `manifest` (file or JSON text). */
export async function uploadFormControl(form: FormData): Promise<ActionResult<controls.SaveResult>> {
  return run('uploadFormControl', 'Could not upload the control.', async (ctx) => {
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) throw new Error('Choose a .zip package or an ES module')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const manifestField = form.get('manifest')
    const manifest = manifestField instanceof File ? await manifestField.text() : typeof manifestField === 'string' ? manifestField : undefined
    const isZip = /\.zip$/i.test(file.name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)
    return controls.uploadFormControl(ctx, isZip ? { zip: bytes } : { module: new TextDecoder().decode(bytes), manifest })
  })
}

export async function importFormControlFromUrl(input: { url: string; manifest_url?: string | null }) {
  return run('importFormControlFromUrl', 'Could not import the control.', (ctx) => controls.importFormControlFromUrl(ctx, input))
}

export async function updateFormControl(idOrTag: string, input: controls.FormControlUpdate) {
  return run('updateFormControl', 'Could not update the control.', async (ctx) => {
    let instanceAdmin = false
    if (input.trusted !== undefined) {
      const [{ getSessionDbWithUser }, { viewerCanSeeInfrastructure }] = await Promise.all([
        import('@/lib/providers/db/session'),
        import('@/lib/admin/infrastructure'),
      ])
      const { user } = await getSessionDbWithUser()
      instanceAdmin = await viewerCanSeeInfrastructure(user ? { id: user.id, email: user.email } : null)
    }
    return controls.updateFormControl(ctx, idOrTag, input, { instanceAdmin })
  })
}

export async function deleteFormControl(idOrTag: string, version?: string | null) {
  return run('deleteFormControl', 'Could not delete the control.', (ctx) => controls.deleteFormControl(ctx, idOrTag, { version }))
}

export async function exportFormControl(idOrTag: string) {
  return run('exportFormControl', 'Could not export the control.', (ctx) => controls.exportFormControl(ctx, idOrTag))
}

export async function importFormControl(json: string) {
  return run('importFormControl', 'Could not import the control.', (ctx) => controls.importFormControl(ctx, json))
}

/** Whether the signed-in user may mark controls trusted (instance admin). */
export async function canTrustFormControls(): Promise<boolean> {
  try {
    const [{ getSessionDbWithUser }, { viewerCanSeeInfrastructure }] = await Promise.all([
      import('@/lib/providers/db/session'),
      import('@/lib/admin/infrastructure'),
    ])
    const { user } = await getSessionDbWithUser()
    return viewerCanSeeInfrastructure(user ? { id: user.id, email: user.email } : null)
  } catch {
    return false
  }
}
