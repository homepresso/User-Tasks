/**
 * Test helpers for the media provider modules: a recording fake of
 * ctx.fetch (queued responses), a context builder and tiny fixtures.
 */
import { expect } from 'vitest'
import { MEDIA_PROVIDER_BY_ID } from '@/lib/media/catalog'
import type { MediaCapability, MediaCredentials, MediaProvider, MediaProviderContext, MediaProviderId } from '@/lib/media/types'

export interface RecordedCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

type Reply = Response | ((call: RecordedCall) => Response | Promise<Response>)

export function fakeFetch(replies: Reply[]) {
  const calls: RecordedCall[] = []
  const queue = [...replies]
  const fetch = async (url: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = {}
    new Headers(init.headers ?? {}).forEach((value, key) => { headers[key] = value })
    const call: RecordedCall = { url, method: String(init.method ?? 'GET').toUpperCase(), headers, body: init.body }
    calls.push(call)
    const next = queue.shift()
    if (!next) throw new Error(`unexpected request ${call.method} ${url}`)
    return typeof next === 'function' ? next(call) : next
  }
  return { fetch, calls, remaining: () => queue.length }
}

export const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } })

export const bytes = (data: Uint8Array, contentType = 'application/octet-stream', headers: Record<string, string> = {}) =>
  new Response(data as Uint8Array<ArrayBuffer>, { status: 200, headers: { 'content-type': contentType, ...headers } })

export function ctxFor(provider: MediaProviderId, fetch: MediaProviderContext['fetch'], creds: Partial<MediaCredentials> = {}): MediaProviderContext {
  return {
    credentials: { provider, integrationId: 'int-1', baseUrl: '', apiKey: 'test-key-123456', extra: {}, ...creds },
    fetch,
    now: () => Date.UTC(2026, 9, 30, 12, 0, 0),
  }
}

/** A 1×1 PNG. */
export const PNG_1PX = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))

/** A PNG header claiming 640×400 (enough for size sniffing). */
export function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, width)
  new DataView(b.buffer).setUint32(20, height)
  return b
}

export const AUDIO = { name: 'call.mp3', mime_type: 'audio/mpeg', bytes: new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4, 5]), duration: 90 }

const METHOD_FOR: Partial<Record<MediaCapability, keyof MediaProvider>> = {
  transcribe: 'transcribe',
  analyze_image: 'analyzeImage',
  detect_faces: 'analyzeImage',
  ocr: 'analyzeImage',
  detect_objects: 'analyzeImage',
  moderation: 'analyzeImage',
  analyze_video: 'analyzeVideo',
  generate_image: 'generateImage',
  edit_image: 'editImage',
  tts: 'speak',
}

/** The module lists exactly the catalog's capabilities and has a method for each. */
export function expectCatalogCapabilities(provider: MediaProvider) {
  expect([...provider.capabilities]).toEqual(MEDIA_PROVIDER_BY_ID[provider.id].capabilities)
  for (const cap of provider.capabilities) expect(typeof provider[METHOD_FOR[cap]!], `${provider.id} ${cap}`).toBe('function')
}

/** No secret appears anywhere in an error message. */
export async function expectSafeError(promise: Promise<unknown>, secrets: string[], match?: RegExp) {
  let error: any
  try { await promise } catch (e) { error = e }
  expect(error, 'expected an error').toBeTruthy()
  expect(error.name).toBe('MediaProviderError')
  for (const s of secrets) expect(String(error.message)).not.toContain(s)
  if (match) expect(String(error.message)).toMatch(match)
  return error
}
