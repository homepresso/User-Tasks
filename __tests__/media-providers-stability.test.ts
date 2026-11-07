/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */
import { PNG } from 'pngjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stabilityAspectRatio, stabilityMask, stabilityProvider } from '@/lib/media/providers/stability'
import { retryTiming } from '@/lib/media/providers/shared'
import { PNG_1PX, bytes, ctxFor, expectCatalogCapabilities, expectSafeError, fakeFetch, json } from './helpers/media-fetch'

const KEY = 'sk-stability-test-key-01234'
const ctx = (fetch: any) => ctxFor('stability', fetch, { baseUrl: 'https://api.stability.ai', apiKey: KEY })

beforeEach(() => { vi.spyOn(retryTiming, 'sleep').mockResolvedValue(undefined) })
afterEach(() => { vi.restoreAllMocks() })

describe('stability', () => {
  it('implements the catalog capabilities', () => expectCatalogCapabilities(stabilityProvider))

  it('maps sizes to aspect ratios', () => {
    expect(stabilityAspectRatio('16:9')).toBe('16:9')
    expect(stabilityAspectRatio('1536x1024')).toBe('3:2')
    expect(stabilityAspectRatio('1024x1024')).toBe('1:1')
    expect(stabilityAspectRatio('auto')).toBeUndefined()
  })

  it('generate core: multipart with Accept image/*; one request per image', async () => {
    const fx = fakeFetch([bytes(PNG_1PX, 'image/png', { 'finish-reason': 'SUCCESS' }), bytes(PNG_1PX, 'image/png')])
    const res = await stabilityProvider.generateImage!({ prompt: 'a lighthouse', negativePrompt: 'text', size: '16:9', count: 2 }, ctx(fx.fetch))
    expect(fx.calls).toHaveLength(2)
    const call = fx.calls[0]
    expect(call.url).toBe('https://api.stability.ai/v2beta/stable-image/generate/core')
    expect(call.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(call.headers.accept).toBe('image/*')
    const form = call.body as FormData
    expect(form.get('prompt')).toBe('a lighthouse')
    expect(form.get('negative_prompt')).toBe('text')
    expect(form.get('aspect_ratio')).toBe('16:9')
    expect(form.get('output_format')).toBe('png')
    expect(form.get('model')).toBeNull()
    expect(res.images).toHaveLength(2)
    expect(res.usage).toEqual({ unit: 'image', quantity: 2, model: 'core', operation: 'generate_image' })
  })

  it('sd3.5 models go to /generate/sd3 with a model field', async () => {
    const fx = fakeFetch([bytes(PNG_1PX, 'image/png')])
    const res = await stabilityProvider.generateImage!({ prompt: 'x', model: 'sd3.5-medium' }, ctx(fx.fetch))
    expect(fx.calls[0].url).toBe('https://api.stability.ai/v2beta/stable-image/generate/sd3')
    expect((fx.calls[0].body as FormData).get('model')).toBe('sd3.5-medium')
    expect(res.usage?.model).toBe('sd3.5-medium')
  })

  it('inpaint converts an alpha mask (transparent = change) to white = change', async () => {
    const mask = new PNG({ width: 2, height: 1 })
    mask.data.set([0, 0, 0, 0, 0, 0, 0, 255])
    const converted = stabilityMask({ name: 'mask.png', mime_type: 'image/png', bytes: new Uint8Array(PNG.sync.write(mask)) })
    const px = PNG.sync.read(Buffer.from(converted.bytes)).data
    expect([...px]).toEqual([255, 255, 255, 255, 0, 0, 0, 255])

    const fx = fakeFetch([bytes(PNG_1PX, 'image/png')])
    const res = await stabilityProvider.editImage!({ prompt: 'remove the sign', image: { name: 'a.png', mime_type: 'image/png', bytes: PNG_1PX }, mask: { name: 'mask.png', mime_type: 'image/png', bytes: new Uint8Array(PNG.sync.write(mask)) } }, ctx(fx.fetch))
    expect(fx.calls[0].url).toBe('https://api.stability.ai/v2beta/stable-image/edit/inpaint')
    const form = fx.calls[0].body as FormData
    expect((form.get('image') as File).name).toBe('a.png')
    expect((form.get('mask') as File).name).toBe('mask.png')
    expect(res.usage).toEqual({ unit: 'image', quantity: 1, model: 'inpaint', operation: 'edit_image' })
  })

  it('errors carry the provider message, never the key', async () => {
    const fx = fakeFetch([json({ id: 'e1', name: 'payment_required', errors: ['You lack sufficient credits to make this request.'] }, 402)])
    const err = await expectSafeError(stabilityProvider.generateImage!({ prompt: 'x' }, ctx(fx.fetch)), [KEY], /402: You lack sufficient credits/)
    expect(err.retryable).toBe(false)
  })
})
