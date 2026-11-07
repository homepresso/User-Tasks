/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { azureSpeechProvider, azureSsml } from '@/lib/media/providers/azure-speech'
import { azureVisionProvider } from '@/lib/media/providers/azure-vision'
import { imageSize, retryTiming } from '@/lib/media/providers/shared'
import type { TranscriptResult } from '@/lib/media/types'
import { AUDIO, bytes, ctxFor, expectCatalogCapabilities, expectSafeError, fakeFetch, json, pngHeader } from './helpers/media-fetch'

const KEY = 'azure-test-key-0123456789'

beforeEach(() => { vi.spyOn(retryTiming, 'sleep').mockResolvedValue(undefined) })
afterEach(() => { vi.restoreAllMocks() })

describe('azure speech', () => {
  const ctx = (fetch: any, creds: Record<string, unknown> = {}) => ctxFor('azure_speech', fetch, { baseUrl: 'https://eastus.api.cognitive.microsoft.com', region: 'eastus', apiKey: KEY, ...creds })

  it('implements the catalog capabilities', () => expectCatalogCapabilities(azureSpeechProvider))

  it('fast transcription: multipart audio + definition, phrases → segments with speakers and words', async () => {
    const fx = fakeFetch([json({
      durationMilliseconds: 6000,
      combinedPhrases: [{ text: 'Hello. My date of birth is 4 July 1980.' }],
      phrases: [
        { speaker: 1, offsetMilliseconds: 0, durationMilliseconds: 1200, text: 'Hello.', locale: 'en-US', confidence: 0.93, words: [{ text: 'Hello.', offsetMilliseconds: 0, durationMilliseconds: 1200 }] },
        { speaker: 2, offsetMilliseconds: 1500, durationMilliseconds: 4500, text: 'My date of birth is 4 July 1980.', locale: 'en-US', confidence: 0.9, words: [{ text: 'My', offsetMilliseconds: 1500, durationMilliseconds: 200 }] },
      ],
    })])
    const res = await azureSpeechProvider.transcribe!(AUDIO, { language: 'en-US', diarize: true, maxSpeakers: 3, wordTimestamps: true, prompt: 'Contoso, Visa' }, ctx(fx.fetch)) as TranscriptResult
    const call = fx.calls[0]
    expect(call.url).toBe('https://eastus.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15')
    expect(call.headers['ocp-apim-subscription-key']).toBe(KEY)
    const form = call.body as FormData
    expect((form.get('audio') as File).name).toBe('call.mp3')
    expect(JSON.parse(String(form.get('definition')))).toEqual({ locales: ['en-US'], diarization: { enabled: true, maxSpeakers: 3 }, phraseList: { phrases: ['Contoso', 'Visa'] }, profanityFilterMode: 'None' })
    expect(res.text).toBe('Hello. My date of birth is 4 July 1980.')
    expect(res.duration).toBe(6)
    expect(res.segments[1]).toMatchObject({ start: 1.5, end: 6, speaker: 'Speaker 2', confidence: 0.9 })
    expect(res.segments[1].words?.[0]).toEqual({ text: 'My', start: 1.5, end: 1.7, speaker: 'Speaker 2' })
    expect(res.speakers).toEqual(['Speaker 1', 'Speaker 2'])
    expect(res.usage).toEqual({ unit: 'minute', quantity: 0.1, model: 'fast-transcription', operation: 'transcribe' })
  })

  it('a bare language code uses the multilingual model (no locales)', async () => {
    const fx = fakeFetch([json({ durationMilliseconds: 0, phrases: [] })])
    await azureSpeechProvider.transcribe!(AUDIO, { language: 'en' }, ctx(fx.fetch, { endpoint: 'https://my-speech.cognitiveservices.azure.com' }))
    expect(fx.calls[0].url).toMatch(/^https:\/\/my-speech\.cognitiveservices\.azure\.com\/speechtotext/)
    expect(JSON.parse(String((fx.calls[0].body as FormData).get('definition'))).locales).toEqual([])
  })

  it('TTS: SSML with escaped text and prosody rate, output format header', async () => {
    const fx = fakeFetch([bytes(new Uint8Array([9, 9]), 'audio/mpeg')])
    const res = await azureSpeechProvider.speak!({ text: 'Fish & <chips>', speed: 1.2 }, ctx(fx.fetch))
    const call = fx.calls[0]
    expect(call.url).toBe('https://eastus.tts.speech.microsoft.com/cognitiveservices/v1')
    expect(call.headers['content-type']).toBe('application/ssml+xml')
    expect(call.headers['x-microsoft-outputformat']).toBe('audio-24khz-96kbitrate-mono-mp3')
    expect(call.headers['user-agent']).toBeTruthy()
    expect(String(call.body)).toBe('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="en-US-AvaMultilingualNeural"><prosody rate="1.2">Fish &amp; &lt;chips&gt;</prosody></voice></speak>')
    expect(res.usage).toMatchObject({ unit: 'char', quantity: 14, model: 'neural' })
    expect(azureSsml({ text: 'x' }, 'fr-FR-DeniseNeural')).toContain('xml:lang="fr-FR"')
  })

  it('unsupported formats and auth errors are clear and safe', async () => {
    await expectSafeError(azureSpeechProvider.speak!({ text: 'x', format: 'flac' }, ctx(fakeFetch([]).fetch)), [KEY], /does not offer flac/)
    const fx = fakeFetch([json({ error: { code: '401', message: 'Access denied due to invalid subscription key.' } }, 401)])
    const err = await expectSafeError(azureSpeechProvider.transcribe!(AUDIO, {}, ctx(fx.fetch)), [KEY], /401: Access denied.*check the API key/)
    expect(err.retryable).toBe(false)
  })
})

describe('azure vision', () => {
  const ENDPOINT = 'https://my-vision.cognitiveservices.azure.com'
  const ctx = (fetch: any) => ctxFor('azure_vision', fetch, { baseUrl: ENDPOINT, endpoint: ENDPOINT, apiKey: KEY })
  const image = { name: 'id.png', mime_type: 'image/png', bytes: pngHeader(640, 400) }

  it('implements the catalog capabilities', () => expectCatalogCapabilities(azureVisionProvider))

  it('reads image sizes from headers', () => {
    expect(imageSize(pngHeader(640, 400))).toEqual({ width: 640, height: 400 })
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x90, 0x02, 0x80, 0x03, 0, 0, 0, 0])
    expect(imageSize(jpeg)).toEqual({ width: 640, height: 400 })
  })

  it('Image Analysis 4.0 + Face detect: polygons and rectangles → normalised boxes', async () => {
    const fx = fakeFetch([
      json({
        modelVersion: '2023-10-01', metadata: { width: 640, height: 400 },
        captionResult: { text: 'a card with a photo', confidence: 0.8 },
        tagsResult: { values: [{ name: 'text', confidence: 0.99 }] },
        objectsResult: { values: [{ boundingBox: { x: 256, y: 200, w: 128, h: 40 }, tags: [{ name: 'license plate', confidence: 0.7 }] }] },
        readResult: { blocks: [{ lines: [{ text: 'ID 078-05-1120', boundingPolygon: [{ x: 256, y: 220 }, { x: 576, y: 220 }, { x: 576, y: 252 }, { x: 256, y: 252 }], words: [
          { text: 'ID', boundingPolygon: [{ x: 256, y: 220 }, { x: 290, y: 220 }, { x: 290, y: 252 }, { x: 256, y: 252 }], confidence: 0.99 },
          { text: '078-05-1120', boundingPolygon: [{ x: 300, y: 220 }, { x: 576, y: 220 }, { x: 576, y: 252 }, { x: 300, y: 252 }], confidence: 0.95 },
        ] }] }] },
      }),
      json([{ faceRectangle: { top: 80, left: 38, width: 160, height: 220 } }]),
    ])
    const res = await azureVisionProvider.analyzeImage!(image, { features: ['description', 'labels', 'objects', 'text', 'faces'] }, ctx(fx.fetch))
    const [analyze, face] = fx.calls
    expect(analyze.url).toBe(`${ENDPOINT}/computervision/imageanalysis:analyze?api-version=2024-02-01&features=caption%2Ctags%2Cobjects%2Cread&gender-neutral-caption=true`)
    expect(analyze.headers['ocp-apim-subscription-key']).toBe(KEY)
    expect(analyze.headers['content-type']).toBe('application/octet-stream')
    expect(face.url).toBe(`${ENDPOINT}/face/v1.2/detect?detectionModel=detection_03&returnFaceId=false&returnFaceLandmarks=false`)
    expect(res.description).toBe('a card with a photo')
    expect(res.objects[0]).toEqual({ name: 'license plate', confidence: 0.7, box: { x: 0.4, y: 0.5, width: 0.2, height: 0.1 } })
    expect(res.ocr[0].box).toEqual({ x: 0.4, y: 0.55, width: 0.5, height: 0.08 })
    expect(res.ocr[0].words?.[1]).toMatchObject({ text: '078-05-1120', confidence: 0.95 })
    expect(res.ocr[0].confidence).toBe(0.95)
    expect(res.faces).toEqual([{ box: { x: 0.0594, y: 0.2, width: 0.25, height: 0.55 } }])
    expect(res.usage).toEqual({ unit: 'request', quantity: 1, model: 'caption+tags+objects+read+face-detect', operation: 'analyze_image' })
  })

  it('retries without caption when the region does not offer it', async () => {
    const fx = fakeFetch([
      json({ error: { code: 'InvalidRequest', message: 'The feature \'Caption\' is not supported in this region.' } }, 400),
      json({ metadata: { width: 640, height: 400 }, tagsResult: { values: [{ name: 'card', confidence: 0.9 }] } }),
    ])
    const res = await azureVisionProvider.analyzeImage!(image, { features: ['description', 'labels'] }, ctx(fx.fetch))
    expect(fx.calls[1].url).toContain('features=tags')
    expect(res.description).toBeUndefined()
    expect(res.labels).toEqual([{ name: 'card', confidence: 0.9 }])
    expect(res.usage?.model).toBe('tags')
  })
})
