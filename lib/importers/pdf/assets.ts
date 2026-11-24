/**
 * Storing what "Bring in styling and images" carries (server-only): the
 * pictures of an imported form go through the existing form asset uploads —
 * Display images through uploadFormImage (forms.edit, PNG / JPEG / WebP /
 * GIF ≤ 2 MB, checked by content, metadata stripped), the logo through
 * uploadFormHeaderImage (≤ 1 MB, the form-headers folder the header
 * validation expects). The PNGs were re-encoded from decoded pixels by the
 * importer already (graphics.ts): nothing of the PDF's original image bytes
 * is stored. Repeated pictures are stored once (by content).
 *
 * The form's theme is created with the forms service (createFormTheme:
 * validated, contrast-checked again). `cleanup()` removes what was stored
 * when the import stops half way.
 */

import { createHash } from 'node:crypto'
import { uploadFormHeaderImage, uploadFormImage } from '@/lib/services/uploads'
import { getStorageProvider } from '@/lib/providers/storage'
import { toStorageRef } from '@/lib/storage/refs'
import { isHeaderImageUrl } from '@/lib/forms/header'
import type { FormThemeOverrides } from '@/lib/forms/form-theme'
import type { ServiceContext } from '@/lib/services/context'
import type { FormThemeInput, FormThemeRow } from '@/lib/services/forms'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import type { PlannedHeader } from './style-plan'

const DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/

export interface PdfAssetStore {
  /** Fields with every display image's data: URL replaced by a stored form image. */
  fields(fields: TaskFieldDef[]): Promise<TaskFieldDef[]>
  /** The header with its logo stored (image 'none' when it can't be). */
  header(header: PlannedHeader): Promise<PlannedHeader>
  /** A saved form theme (created once per import). */
  theme(name: string, overrides: FormThemeOverrides, description: string): Promise<string>
  /** Stored images (count) — for the result's warnings. */
  readonly stored: number
  /** Remove what this import stored (images and the theme). */
  cleanup(): Promise<void>
}

/** The forms service's theme calls (passed in: the importer has the module loaded already). */
export interface ThemeService {
  createFormTheme(ctx: ServiceContext, input: FormThemeInput): Promise<FormThemeRow>
  deleteFormTheme(ctx: ServiceContext, id: string): Promise<unknown>
}

export function pdfAssetStore(ctx: ServiceContext, themes: ThemeService): PdfAssetStore {
  const images = new Map<string, string>()
  const headers = new Map<string, string>()
  const paths: Array<{ bucket: string; path: string }> = []
  let themeId: string | null = null
  const decode = (url: string) => {
    const m = DATA_URL.exec(url)
    return m ? { type: m[1], bytes: new Uint8Array(Buffer.from(m[2], 'base64')), hash: createHash('sha256').update(m[2]).digest('hex') } : null
  }
  const storeImage = async (url: string): Promise<string | null> => {
    const d = decode(url)
    if (!d) return null
    const hit = images.get(d.hash)
    if (hit) return hit
    const stored = await uploadFormImage(ctx, { name: 'pdf-image.png', type: d.type, bytes: d.bytes })
    paths.push({ bucket: 'task-files', path: stored.path })
    const ref = stored.ref ?? String(toStorageRef(stored.url))
    images.set(d.hash, ref)
    return ref
  }
  const walk = async (value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) { const out = []; for (const v of value) out.push(await walk(v)); return out }
    if (!value || typeof value !== 'object') return value
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = k === 'src' && typeof v === 'string' && v.startsWith('data:image/') ? (await storeImage(v)) ?? '' : await walk(v)
    }
    return out
  }
  return {
    get stored() { return images.size + headers.size },
    async fields(fields) { return (await walk(fields)) as TaskFieldDef[] },
    async header(header) {
      if (header.image !== 'upload' || !header.image_url?.startsWith('data:')) return header
      const d = decode(header.image_url)
      if (!d) return { ...header, image: 'none', image_url: undefined, image_alt: undefined }
      let url = headers.get(d.hash)
      if (!url) {
        const stored = await uploadFormHeaderImage(ctx, { name: 'pdf-logo.png', type: d.type, bytes: d.bytes })
        paths.push({ bucket: 'task-files', path: stored.path })
        const candidate = stored.ref ?? stored.url
        url = isHeaderImageUrl(candidate) ? candidate : String(toStorageRef(stored.url))
        headers.set(d.hash, url)
      }
      return { ...header, image_url: url }
    },
    async theme(name, overrides, description) {
      if (themeId) return themeId
      const row = await themes.createFormTheme(ctx, { name, description, overrides })
      themeId = row.id
      return row.id
    },
    async cleanup() {
      if (themeId) await themes.deleteFormTheme(ctx, themeId).catch(() => undefined)
      if (!paths.length) return
      try {
        const storage = await getStorageProvider()
        await storage.delete('task-files', paths.map((p) => p.path))
      } catch { /* best effort: an orphaned picture is harmless */ }
    },
  }
}
