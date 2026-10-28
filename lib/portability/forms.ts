// Reusable forms in manifests (config as code, GitHub sync, packages). Pure.
//
// A form travels as { id, name, description, tags, fields, layout, theme };
// its version number is per environment and never travels. Workflow drafts
// link forms by form_id (remapped on import). `form_version` pins only exist
// inside published workflow versions, so one found in an imported workflow
// draft is removed — the draft follows the latest version of the form.

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- manifests are free-form JSON; destructuring drops fields */

import { normalizeFormDefinition, unpinFormVersions } from '@/lib/forms/definition'
import { compactLayoutForSave } from '@/lib/forms/layout'
import { isPlainObject } from '@/lib/utils/guards'
import { normalizeFormButtons } from '@/lib/forms/buttons'
import { normalizeFormHeader } from '@/lib/forms/header'
import { storedButtons } from '@/lib/forms/definition'

/** Old manifests carried a retired `forms` section of a different shape (no field list). */
export function isRetiredFormAsset(asset: unknown): boolean {
  return !isPlainObject(asset) || !Array.isArray((asset as Record<string, unknown>).fields)
}

/**
 * The form as the import stores it (lib/services/forms validateFormContent):
 * fields normalised, layout compacted (none when trivial), theme reference
 * parsed, tags lower-cased and de-duplicated. Plans compare this, so a
 * hand-written file does not show perpetual drift.
 */
export function normalizeFormAssetLikeImport(asset: Record<string, any>): Record<string, any> {
  if (isRetiredFormAsset(asset)) return asset
  const def = normalizeFormDefinition({ fields: asset.fields, layout: asset.layout, theme: asset.theme ?? undefined })
  const out: Record<string, any> = {
    ...asset,
    fields: def.fields,
    layout: def.layout ? compactLayoutForSave(def.layout, def.fields.map((f) => f.key)) : null,
    theme: def.theme,
    buttons: def.buttons ?? null,
    // An uploaded header image travels as bytes (image_data) and gets a new
    // address on import: compare the header without either.
    header: comparableHeader(asset.header),
  }
  if ('tags' in asset) {
    out.tags = Array.isArray(asset.tags)
      ? [...new Set(asset.tags.map((t: unknown) => String(t ?? '').trim().toLowerCase()).filter(Boolean))]
      : []
  }
  if ('description' in asset) out.description = String(asset.description ?? '').trim() || null
  delete out.version
  return out
}

/** A workflow with every `form_version` pin (nodes and start form) removed. */
export function stripWorkflowFormPins<T extends Record<string, any>>(workflow: T): T {
  if (!isPlainObject(workflow)) return workflow
  const hasNodePins = Array.isArray(workflow.nodes) && workflow.nodes.some((n: any) => n?.config && 'form_version' in n.config)
  const hasStartPin = isPlainObject(workflow.trigger_config?.start_form) && 'form_version' in workflow.trigger_config.start_form
  if (!hasNodePins && !hasStartPin) return workflow
  const { nodes, trigger_config } = unpinFormVersions(workflow.nodes, workflow.trigger_config)
  return { ...workflow, nodes, trigger_config } as T
}

function comparableHeader(raw: unknown): unknown {
  const header = normalizeFormHeader(isPlainObject(raw) && raw.image_data ? { ...raw, image_url: undefined } : raw)
  if (!header) return null
  if (isPlainObject(raw) && (raw.image === 'upload')) {
    const { image_url: _url, ...rest } = header
    return { ...rest, image: 'upload' }
  }
  return header
}

/** Bytes of an uploaded header image as they travel in a manifest. */
export interface HeaderImageData { content_type: string; data_base64: string }

const MAX_EMBED_BYTES = 1024 * 1024

/**
 * Export: an uploaded header image is read from storage and embedded in the
 * form asset (`header.image_data`), since its address belongs to this
 * workspace. Unreadable images fall back to the default mark.
 */
export async function embedFormHeaderImages(forms: Array<Record<string, any>>): Promise<Array<Record<string, any>>> {
  const out: Array<Record<string, any>> = []
  for (const form of forms) {
    const header = isPlainObject(form.header) ? form.header : null
    if (!header || header.image !== 'upload' || typeof header.image_url !== 'string') { out.push(form); continue }
    try {
      const [{ parseOwnStorageUrl }, { getStorageProvider }] = await Promise.all([import('@/lib/storage/refs'), import('@/lib/providers/storage')])
      const ref = parseOwnStorageUrl(header.image_url)
      if (!ref) throw new Error('not an own storage object')
      const storage = await getStorageProvider()
      const object = await storage.get(ref.bucket, ref.key)
      if (!object) throw new Error('missing')
      const bytes = new Uint8Array(await new Response(object.body).arrayBuffer())
      if (bytes.byteLength > MAX_EMBED_BYTES) throw new Error('too large')
      const { image_url: _url, ...rest } = header
      out.push({ ...form, header: { ...rest, image_data: { content_type: object.contentType ?? 'image/png', data_base64: Buffer.from(bytes).toString('base64') } } })
    } catch {
      const { image_url: _url, ...rest } = header
      out.push({ ...form, header: { ...rest, image: 'default' } })
    }
  }
  return out
}

/**
 * Import / package install: an embedded header image is uploaded into this
 * workspace (sanitised like any upload) and the header points at the new
 * copy; a header image address from elsewhere falls back to the default mark.
 */
export async function restoreFormHeaderImage(ctx: import('@/lib/services/context').ServiceContext, asset: Record<string, any>): Promise<Record<string, any>> {
  const header = isPlainObject(asset.header) ? asset.header : null
  if (!header || header.image !== 'upload') return asset
  const data = isPlainObject(header.image_data) ? header.image_data as unknown as HeaderImageData : null
  const { image_data: _data, ...rest } = header
  if (!data) {
    const own = typeof rest.image_url === 'string' && rest.image_url.includes(`/form-headers/${ctx.tenantId}/`)
    return own ? { ...asset, header: rest } : { ...asset, header: { ...rest, image: 'default', image_url: undefined } }
  }
  try {
    const bytes = Uint8Array.from(Buffer.from(String(data.data_base64 ?? ''), 'base64'))
    const { uploadFormHeaderImage } = await import('@/lib/services/uploads')
    const ext = data.content_type === 'image/svg+xml' ? 'svg' : data.content_type === 'image/webp' ? 'webp' : data.content_type === 'image/jpeg' ? 'jpg' : 'png'
    const stored = await uploadFormHeaderImage({ ...ctx, permissions: null }, { name: `header.${ext}`, type: String(data.content_type ?? ''), bytes })
    return { ...asset, header: { ...rest, image_url: stored.ref ?? stored.url } }
  } catch {
    return { ...asset, header: { ...rest, image: 'default', image_url: undefined } }
  }
}

/** Buttons of a manifest asset as stored (defaults dropped). */
export function portableButtons(raw: unknown) {
  return storedButtons(Array.isArray(raw) ? normalizeFormButtons(raw) : null)
}
