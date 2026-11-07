/**
 * Azure AI Vision media provider (server-only): Image Analysis 4.0
 * (caption, tags, objects, Read OCR with line + word polygons) and Face API
 * detection (face rectangles only — no identification).
 *
 * API docs (shapes checked 2026-10-30):
 *   https://learn.microsoft.com/en-us/azure/ai-services/computer-vision/how-to/call-analyze-image-40
 *   https://learn.microsoft.com/en-us/azure/ai-services/computer-vision/overview-image-analysis
 *   https://learn.microsoft.com/en-us/rest/api/face/face-detection-operations/detect (v1.2 GA)
 *   https://learn.microsoft.com/en-us/legal/cognitive-services/computer-vision/limited-access-identity
 *
 * Image Analysis 4.0 is deprecated (retires 2028-09-25). Caption is offered
 * in some regions only: when the service refuses it we retry without it.
 * Face detection is available without Limited Access registration; we send
 * returnFaceId=false (face ids exist only for the gated identify / verify
 * features) and no attributes. Face images: 1 KB – 6 MB.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */

import { MediaProviderError, type AnalyzeImageOptions, type FaceBox, type ImageAnalysis, type ImageLabel, type MediaBlob, type MediaProvider, type MediaProviderContext, type OcrLine } from '../types'
import { MEDIA_PROVIDER_BY_ID } from '../catalog'
import { bytesBody, imageSize, joinUrl, mediaJson, normBox, num, polygonBox, requireKey } from './shared'

const INFO = MEDIA_PROVIDER_BY_ID.azure_vision
const LABEL = 'Azure AI Vision'
export const AZURE_VISION_API_VERSION = '2024-02-01'
const CAPTION_LANGUAGES = ['en']

function endpoint(ctx: MediaProviderContext): string {
  const e = ctx.credentials.endpoint || ctx.credentials.baseUrl
  if (!e) throw new MediaProviderError(`${LABEL}: the integration needs the resource endpoint`)
  return e.replace(/\/+$/, '')
}

const headers = (ctx: MediaProviderContext) => ({ 'Ocp-Apim-Subscription-Key': requireKey(ctx.credentials, LABEL), 'Content-Type': 'application/octet-stream' })

/** Our features → Image Analysis features. */
export function azureFeatures(options: AnalyzeImageOptions): string[] {
  const out: string[] = []
  const f = new Set(options.features)
  const captionOk = !options.language || CAPTION_LANGUAGES.includes(options.language)
  if (f.has('description') && captionOk) out.push('caption')
  if (f.has('labels')) out.push('tags')
  if (f.has('objects')) out.push('objects')
  if (f.has('text')) out.push('read')
  return out
}

export function azureAnalyzeUrl(ctx: MediaProviderContext, features: string[], language?: string): string {
  const q = new URLSearchParams({ 'api-version': ctx.credentials.extra?.api_version || AZURE_VISION_API_VERSION, features: features.join(',') })
  if (language) q.set('language', language)
  if (features.includes('caption')) q.set('gender-neutral-caption', 'true')
  return `${joinUrl(endpoint(ctx), '/computervision/imageanalysis:analyze')}?${q.toString()}`
}

export function azureFaceUrl(ctx: MediaProviderContext): string {
  const q = new URLSearchParams({ detectionModel: 'detection_03', returnFaceId: 'false', returnFaceLandmarks: 'false' })
  return `${joinUrl(endpoint(ctx), '/face/v1.2/detect')}?${q.toString()}`
}

async function analyzeCall(input: MediaBlob, features: string[], options: AnalyzeImageOptions, ctx: MediaProviderContext): Promise<{ res: any; features: string[] }> {
  try {
    return { res: await mediaJson<any>(ctx, LABEL, azureAnalyzeUrl(ctx, features, options.language), { method: 'POST', headers: headers(ctx), body: bytesBody(input.bytes) }), features }
  } catch (error) {
    // Caption is not offered in every region / language: retry without it.
    if (error instanceof MediaProviderError && error.status === 400 && features.includes('caption') && /caption|feature|region/i.test(error.message)) {
      ctx.log?.(`${LABEL}: caption is not available for this resource; continuing without a description`)
      const rest = features.filter((f) => f !== 'caption')
      if (!rest.length) return { res: {}, features: [] }
      return { res: await mediaJson<any>(ctx, LABEL, azureAnalyzeUrl(ctx, rest, options.language), { method: 'POST', headers: headers(ctx), body: bytesBody(input.bytes) }), features: rest }
    }
    throw error
  }
}

export function parseAzureAnalysis(res: any, size: { width: number; height: number } | null, maxResults: number): Pick<ImageAnalysis, 'description' | 'labels' | 'objects' | 'text' | 'ocr' | 'width' | 'height'> {
  const width = num(res?.metadata?.width) ?? size?.width ?? 0
  const height = num(res?.metadata?.height) ?? size?.height ?? 0
  const pxBox = (b: any) => (b && width && height ? normBox(Number(b.x) / width, Number(b.y) / height, Number(b.w) / width, Number(b.h) / height) ?? undefined : undefined)
  const labels: ImageLabel[] = (res?.tagsResult?.values ?? []).slice(0, maxResults).map((t: any) => ({ name: String(t?.name ?? ''), ...(num(t?.confidence) !== undefined ? { confidence: Number(t.confidence) } : {}) })).filter((l: ImageLabel) => l.name)
  const objects: ImageLabel[] = (res?.objectsResult?.values ?? []).slice(0, maxResults).map((o: any) => {
    const tag = o?.tags?.[0] ?? {}
    const box = pxBox(o?.boundingBox)
    return { name: String(tag?.name ?? 'object'), ...(num(tag?.confidence) !== undefined ? { confidence: Number(tag.confidence) } : {}), ...(box ? { box } : {}) }
  })
  const ocr: OcrLine[] = []
  for (const block of res?.readResult?.blocks ?? []) {
    for (const line of block?.lines ?? []) {
      const words = (line?.words ?? []).map((w: any) => {
        const box = polygonBox(w?.boundingPolygon, width, height)
        return { text: String(w?.text ?? ''), ...(box ? { box } : {}), ...(num(w?.confidence) !== undefined ? { confidence: Number(w.confidence) } : {}) }
      })
      const box = polygonBox(line?.boundingPolygon, width, height)
      const confs = words.map((w: { confidence?: number }) => w.confidence).filter((c: number | undefined): c is number => c !== undefined)
      ocr.push({
        text: String(line?.text ?? ''), ...(box ? { box } : {}),
        ...(confs.length ? { confidence: Math.min(...confs) } : {}),
        ...(words.length ? { words } : {}),
      })
    }
  }
  return {
    ...(res?.captionResult?.text ? { description: String(res.captionResult.text) } : {}),
    labels, objects, text: ocr.map((l) => l.text).join('\n'), ocr,
    ...(width ? { width } : {}), ...(height ? { height } : {}),
  }
}

export function parseAzureFaces(res: any, width: number, height: number): FaceBox[] {
  if (!Array.isArray(res) || !width || !height) return []
  return res.map((f: any) => {
    const r = f?.faceRectangle ?? {}
    return normBox(Number(r.left) / width, Number(r.top) / height, Number(r.width) / width, Number(r.height) / height)
  }).filter((b): b is NonNullable<typeof b> => Boolean(b)).map((box) => ({ box }))
}

async function analyzeImage(input: MediaBlob, options: AnalyzeImageOptions, ctx: MediaProviderContext): Promise<ImageAnalysis> {
  const max = Math.max(1, Math.min(100, options.maxResults ?? 20))
  const features = azureFeatures(options)
  const wantsFaces = options.features.includes('faces')
  const size = imageSize(input.bytes)
  const [analysis, faces] = await Promise.all([
    features.length ? analyzeCall(input, features, options, ctx) : Promise.resolve({ res: {}, features: [] as string[] }),
    wantsFaces ? mediaJson<any>(ctx, LABEL, azureFaceUrl(ctx), { method: 'POST', headers: headers(ctx), body: bytesBody(input.bytes) }) : Promise.resolve(null),
  ])
  const parsed = parseAzureAnalysis(analysis.res, size, max)
  const width = parsed.width ?? size?.width ?? 0
  const height = parsed.height ?? size?.height ?? 0
  if (wantsFaces && (!width || !height)) throw new MediaProviderError(`${LABEL}: could not read the image size to place the face boxes`)
  const billed = [...analysis.features, ...(wantsFaces ? ['face-detect'] : [])]
  return {
    ...parsed,
    faces: wantsFaces ? parseAzureFaces(faces, width, height) : [],
    safety: [],
    provider: 'azure_vision',
    model: analysis.res?.modelVersion ? `image-analysis-4.0 (${analysis.res.modelVersion})` : 'image-analysis-4.0',
    ...(billed.length ? { usage: { unit: 'request', quantity: 1, model: billed.join('+'), operation: 'analyze_image' } } : {}),
  }
}

export const azureVisionProvider: MediaProvider = {
  id: 'azure_vision',
  label: INFO.label,
  capabilities: INFO.capabilities,
  // Face detection takes up to 6 MB (Image Analysis up to 20 MB).
  maxImageBytes: 6 * 1024 * 1024,
  analyzeImage,
}
