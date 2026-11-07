/**
 * Stability AI media provider (server-only): Stable Image generate (core /
 * ultra / sd3.5) and inpaint.
 *
 * API docs (shapes checked 2026-10-30; platform.stability.ai/docs now
 * redirects to docs.stability.ai):
 *   https://docs.stability.ai/api-reference/generate/stable-image-core.md
 *   https://docs.stability.ai/api-reference/generate/stable-image-ultra.md
 *   https://docs.stability.ai/api-reference/generate/stable-diffusion-35.md
 *   https://docs.stability.ai/api-reference/edit/inpaint.md
 *
 * Multipart requests with `Accept: image/*` return the image bytes (the
 * finish-reason header is CONTENT_FILTERED when the image was blurred).
 * One image per request: count > 1 makes several requests.
 *
 * Masks: our contract (and OpenAI's) is "transparent pixels = the area to
 * change"; Stability wants a black / white mask with WHITE = change. A PNG
 * mask with an alpha channel is converted; anything else is sent as is.
 */

import { PNG } from 'pngjs'
import { MediaProviderError, type EditImageOptions, type GenerateImageOptions, type GenerateImageResult, type MediaBlob, type MediaProvider, type MediaProviderContext } from '../types'
import { MEDIA_PROVIDER_BY_ID } from '../catalog'
import { joinUrl, mediaBytes, modelFor, multipart, requireKey } from './shared'

const INFO = MEDIA_PROVIDER_BY_ID.stability
const LABEL = 'Stability AI'
export const STABILITY_ASPECT_RATIOS = ['21:9', '16:9', '3:2', '5:4', '1:1', '4:5', '2:3', '9:16', '9:21'] as const

const base = (ctx: MediaProviderContext) => String(ctx.credentials.baseUrl || 'https://api.stability.ai').replace(/\/+$/, '')
const headers = (ctx: MediaProviderContext) => ({ Authorization: `Bearer ${requireKey(ctx.credentials, LABEL)}`, Accept: 'image/*' })

/** "16:9" as is; "1536x1024" → the closest supported ratio; else undefined (1:1 default). */
export function stabilityAspectRatio(size: string | undefined): string | undefined {
  const s = String(size ?? '').trim()
  if ((STABILITY_ASPECT_RATIOS as readonly string[]).includes(s)) return s
  const m = s.match(/^(\d+)\s*[x:]\s*(\d+)$/)
  if (!m) return undefined
  const target = Number(m[1]) / Number(m[2])
  if (!Number.isFinite(target) || target <= 0) return undefined
  let best: string = '1:1'
  let diff = Infinity
  for (const r of STABILITY_ASPECT_RATIOS) {
    const [w, h] = r.split(':').map(Number)
    const d = Math.abs(Math.log(w / h) - Math.log(target))
    if (d < diff) { diff = d; best = r }
  }
  return best
}

/** The endpoint path + sd3 model for a model id ("core", "ultra", "sd3.5-large", …). */
export function stabilityRoute(model: string): { path: string; sd3Model?: string } {
  const m = model.trim().toLowerCase()
  if (m === 'ultra') return { path: '/v2beta/stable-image/generate/ultra' }
  if (m.startsWith('sd3')) return { path: '/v2beta/stable-image/generate/sd3', sd3Model: m === 'sd3' ? 'sd3.5-large' : m }
  return { path: '/v2beta/stable-image/generate/core' }
}

const mimeFor = (format: string) => (format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png')

async function oneImage(ctx: MediaProviderContext, path: string, body: FormData, format: string) {
  const { bytes, contentType, headers: h } = await mediaBytes(ctx, LABEL, joinUrl(base(ctx), path), { method: 'POST', headers: headers(ctx), body })
  if (!bytes.byteLength) throw new MediaProviderError(`${LABEL} returned no image`)
  if (h.get('finish-reason') === 'CONTENT_FILTERED') ctx.log?.(`${LABEL}: the image was filtered (blurred) by the provider's content filter`)
  return { bytes, mime_type: contentType.startsWith('image/') ? contentType.split(';')[0] : mimeFor(format) }
}

async function generateImage(options: GenerateImageOptions, ctx: MediaProviderContext): Promise<GenerateImageResult> {
  const model = modelFor(options.model, ctx.credentials, 'image_model', INFO.defaults.image ?? 'core')
  const route = stabilityRoute(model)
  const format = options.format ?? 'png'
  const count = Math.max(1, Math.min(4, Math.floor(options.count ?? 1)))
  const images = []
  for (let i = 0; i < count; i++) {
    const body = multipart({
      prompt: options.prompt,
      negative_prompt: options.negativePrompt,
      aspect_ratio: stabilityAspectRatio(options.size),
      output_format: format,
      model: route.sd3Model,
    })
    images.push(await oneImage(ctx, route.path, body, format))
  }
  const priced = route.sd3Model ?? (model.toLowerCase() === 'ultra' ? 'ultra' : 'core')
  return { images, provider: 'stability', model: priced, usage: { unit: 'image', quantity: images.length, model: priced, operation: 'generate_image' } }
}

/** Alpha mask (transparent = change) → black / white mask (white = change). Non-PNG / no alpha → unchanged. */
export function stabilityMask(mask: MediaBlob): MediaBlob {
  if (!/png/i.test(mask.mime_type) && !/\.png$/i.test(mask.name)) return mask
  let png: PNG
  try { png = PNG.sync.read(Buffer.from(mask.bytes)) } catch { return mask }
  const { width, height, data } = png
  let hasAlpha = false
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) { hasAlpha = true; break }
  if (!hasAlpha) return mask
  const out = new PNG({ width, height })
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i + 3] < 128 ? 255 : 0
    out.data[i] = v; out.data[i + 1] = v; out.data[i + 2] = v; out.data[i + 3] = 255
  }
  return { name: 'mask.png', mime_type: 'image/png', bytes: new Uint8Array(PNG.sync.write(out)) }
}

async function editImage(options: EditImageOptions, ctx: MediaProviderContext): Promise<GenerateImageResult> {
  const format = options.format ?? 'png'
  const count = Math.max(1, Math.min(4, Math.floor(options.count ?? 1)))
  const mask = options.mask ? stabilityMask(options.mask) : undefined
  const images = []
  for (let i = 0; i < count; i++) {
    const body = multipart({ image: options.image, mask, prompt: options.prompt, negative_prompt: options.negativePrompt, output_format: format })
    images.push(await oneImage(ctx, '/v2beta/stable-image/edit/inpaint', body, format))
  }
  return { images, provider: 'stability', model: 'inpaint', usage: { unit: 'image', quantity: images.length, model: 'inpaint', operation: 'edit_image' } }
}

export const stabilityProvider: MediaProvider = {
  id: 'stability',
  label: INFO.label,
  capabilities: INFO.capabilities,
  maxImageBytes: 10 * 1024 * 1024,
  generateImage,
  editImage,
}
