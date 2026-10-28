'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession, ServiceError } from '@/lib/services/context'
import * as uploads from '@/lib/services/uploads'

/*
 * File uploads (FormData with a `file` field). The browser no longer talks
 * to storage: these store the file server-side (lib/services/uploads) and
 * return its public URL. Limits and paths are documented there.
 */

async function readFile(formData: FormData): Promise<uploads.UploadInput> {
  const file = formData.get('file')
  if (!file || typeof file === 'string') throw ServiceError.validation('No file was uploaded')
  return { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }
}

export async function uploadIntegrationIcon(formData: FormData): Promise<ActionResult<uploads.StoredFile>> {
  return runAction('uploadIntegrationIcon', 'Upload failed.', async () =>
    uploads.uploadIntegrationIcon(await fromSession(), await readFile(formData)))
}

export async function uploadReferenceIcon(formData: FormData): Promise<ActionResult<uploads.StoredFile>> {
  return runAction('uploadReferenceIcon', 'Upload failed.', async () =>
    uploads.uploadReferenceIcon(await fromSession(), await readFile(formData)))
}

/** FormData: `file` and `table_id`. */
export async function uploadDataTableFile(formData: FormData): Promise<ActionResult<uploads.StoredFile>> {
  return runAction('uploadDataTableFile', 'Upload failed.', async () =>
    uploads.uploadDataTableFile(await fromSession(), String(formData.get('table_id') ?? ''), await readFile(formData)))
}

/**
 * FormData: `file`, `variant` (logo | logo-light | logo-dark | favicon) and
 * optionally `tenant_id` — the workspace whose folder it goes in (membership
 * and settings.edit there are checked, as the storage policy did).
 */
export async function uploadWorkspaceLogo(formData: FormData): Promise<ActionResult<uploads.StoredFile>> {
  return runAction('uploadWorkspaceLogo', 'Upload failed.', async () => {
    const tenantId = String(formData.get('tenant_id') ?? '').trim()
    const ctx = await fromSession(tenantId ? { tenantId } : {})
    return uploads.uploadWorkspaceLogo(ctx, String(formData.get('variant') ?? 'logo') as uploads.LogoVariant, await readFile(formData))
  })
}
