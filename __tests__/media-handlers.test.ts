/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaBackground, MediaContinue, runMediaNode, snapshotMediaConfig, type MediaNodeContext } from '@/lib/media/handlers'
import { MEDIA_PROVIDER_BY_ID } from '@/lib/media/catalog'
import { mediaNodeRoots } from '@/lib/media/schemas'
import { decodeImage } from '@/lib/media/image'
import { toPixels } from '@/lib/media/geometry'
import type { MediaCapability, MediaCredentials, MediaProvider, MediaProviderId } from '@/lib/media/types'
import { ID_CARD, idCardImage, pngBytes, regionDiff } from './helpers/media-fixtures'

vi.mock('@/lib/media/ffmpeg', async (orig) => ({ ...(await orig<typeof import('@/lib/media/ffmpeg')>()), ffmpegAvailable: async () => false }))

const creds = (id: MediaProviderId): { provider: (typeof MEDIA_PROVIDER_BY_ID)[MediaProviderId]; credentials: MediaCredentials } => ({
  provider: MEDIA_PROVIDER_BY_ID[id],
  credentials: { provider: id, integrationId: 'int-1', baseUrl: 'https://provider.test', apiKey: 'sk-test-secret', extra: {} },
})

interface Stored { name: string; mime: string; bytes: Uint8Array }

function harness(type: string, config: Record<string, any>, provider: Partial<MediaProvider> & { capabilities: MediaCapability[] }, files: Record<string, { name: string; mime_type: string; bytes: Uint8Array }> = {}, id: MediaProviderId = 'gemini') {
  const stored: Stored[] = []
  const warnings: string[] = []
  const variables: Record<string, any> = {}
  const ctx: MediaNodeContext = {
    type,
    config,
    resolve: (v) => (typeof v === 'string' && v.startsWith('{{') ? variables[v.slice(2, -2)] : v),
    supabase: {} as never,
    tenantId: 'tenant-a',
    variables,
    setVar: (n, v) => { variables[n] = v },
    warn: (m) => warnings.push(m),
    deps: {
      credentials: creds(id),
      provider: { id, label: MEDIA_PROVIDER_BY_ID[id].label, ...provider } as MediaProvider,
      store: async (bytes, name, mime) => {
        stored.push({ name, mime, bytes })
        return { _file: true, id: `f${stored.length}`, name, size: bytes.byteLength, mime_type: mime, content_type: mime, url: `/files/${name}`, path: `p/${name}`, storage_ref: `storage://task-files/p/${name}`, uploaded_by: null, uploaded_at: '2026-10-30T00:00:00Z', checksum_sha256: 'x' }
      },
      resolveFile: async (value) => {
        const f = files[String(value)]
        if (!f) throw new Error(`no fixture ${String(value)}`)
        return { ...f, size: f.bytes.byteLength, source: 'inline' }
      },
    },
  }
  return { ctx, stored, warnings, variables }
}

const audio = { name: 'call.mp3', mime_type: 'audio/mpeg', bytes: new Uint8Array(2048).fill(7) }
const transcript = {
  text: 'Hello, my SSN is 078-05-1120. Thanks.',
  language: 'en',
  duration: 9,
  segments: [
    { id: 0, start: 0, end: 4, text: 'Hello, my SSN is 078-05-1120.', speaker: 'A' },
    { id: 1, start: 4.5, end: 9, text: 'Thanks.', speaker: 'B' },
  ],
  provider: 'deepgram' as const,
  model: 'nova-3',
  usage: { unit: 'minute' as const, quantity: 0.15, model: 'nova-3', operation: 'transcribe' as const },
}

afterEach(() => vi.unstubAllEnvs())

describe('Transcribe', () => {
  it('sets the transcript, segments and files; the run log has counts and a short preview only', async () => {
    const transcribe = vi.fn(async () => transcript)
    const h = harness('media_transcribe', { integration_id: 'int-1', source: 'audio', formats: ['srt', 'vtt', 'txt', 'json'], diarize: true, language: 'en', output_var: 'call' }, { capabilities: ['transcribe'], transcribe }, { audio }, 'deepgram')
    const out = await runMediaNode(h.ctx) as Record<string, any>
    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ name: 'call.mp3', bytes: audio.bytes }), expect.objectContaining({ diarize: true, language: 'en' }), expect.anything())
    expect(h.stored.map((s) => [s.name, s.mime])).toEqual([['call-transcript.srt', 'application/x-subrip'], ['call-transcript.vtt', 'text/vtt'], ['call-transcript.txt', 'text/plain'], ['call-transcript.json', 'application/json']])
    expect(new TextDecoder().decode(h.stored[0].bytes)).toContain('00:00:00,000 --> 00:00:04,000\nA: Hello, my SSN is 078-05-1120.')
    expect(h.variables.call.text).toBe(transcript.text)
    expect(h.variables.call.speakers).toEqual(['A', 'B'])
    expect(h.variables.call_text).toBe(transcript.text)
    expect(h.variables.call_segments).toHaveLength(2)
    expect(h.variables.call_srt.name).toBe('call-transcript.srt')
    expect(h.variables.call_files).toHaveLength(4)
    // Every variable the picker offers is set.
    for (const root of mediaNodeRoots('media_transcribe', h.ctx.config)) expect(h.variables, root.path).toHaveProperty(root.path)
    expect(out).toMatchObject({ variable: 'call', provider: 'deepgram', segments: 2, speakers: 2, characters: transcript.text.length, files: expect.any(Array) })
    expect(out.cost.status).toMatch(/priced|unknown/)
    // No media, no full transcript beyond the preview.
    expect(JSON.stringify(out)).not.toContain('sk-test-secret')
    expect(out.text_preview.length).toBeLessThanOrEqual(201)
  })

  it('polls an asynchronous provider job inline until it is done, then cleans it up', async () => {
    let polls = 0
    const poll = vi.fn(async () => (++polls < 2 ? { done: false as const, pollAfterMs: 1 } : { done: true as const, result: transcript }))
    const cleanup = vi.fn(async () => {})
    const job = { async: true as const, provider: 'assemblyai' as const, operation: 'transcribe' as const, job: { id: 't-1' }, pollAfterMs: 1 }
    const h = harness('media_transcribe', { integration_id: 'int-1', source: 'audio' }, { capabilities: ['transcribe'], transcribe: async () => job, poll, cleanup }, { audio }, 'assemblyai')
    const out = await runMediaNode(h.ctx) as Record<string, any>
    expect(poll).toHaveBeenCalledTimes(2)
    expect(cleanup).toHaveBeenCalledWith(job, expect.anything())
    expect(out.segments).toBe(2)
    expect(h.variables.transcript_srt.name).toBe('call-transcript.srt')
  })

  it('hands a slow provider job to the background (saved runs), with the job in the state', async () => {
    vi.stubEnv('MEDIA_TIMEOUT_SECONDS', '5')
    const job = { async: true as const, provider: 'assemblyai' as const, operation: 'transcribe' as const, job: { id: 't-2' }, pollAfterMs: 10_000 }
    const h = harness('media_transcribe', { integration_id: 'int-1', source: 'audio' }, { capabilities: ['transcribe'], transcribe: async () => job, poll: async () => ({ done: false as const }) }, { audio }, 'assemblyai')
    h.ctx.canBackground = true
    const out = await runMediaNode(h.ctx)
    expect(out).toBeInstanceOf(MediaBackground)
    expect((out as MediaBackground).state.asyncJob).toEqual(job)
    // Inside the job: still not done → MediaContinue; done → output.
    const inJob = harness('media_transcribe', { integration_id: 'int-1', source: 'audio' }, { capabilities: ['transcribe'], poll: async () => ({ done: false as const, pollAfterMs: 30_000 }) }, {}, 'assemblyai')
    inJob.ctx.job = { state: { asyncJob: job, input: { name: 'call.mp3' } }, deadline: Date.now() + 100 }
    const cont = await runMediaNode(inJob.ctx)
    expect(cont).toBeInstanceOf(MediaContinue)
    const done = harness('media_transcribe', { integration_id: 'int-1', source: 'audio' }, { capabilities: ['transcribe'], poll: async () => ({ done: true as const, result: transcript }), cleanup: async () => {} }, {}, 'assemblyai')
    done.ctx.job = { state: { asyncJob: job, input: { name: 'call.mp3' } }, deadline: Date.now() + 5_000 }
    const finished = await runMediaNode(done.ctx) as Record<string, any>
    expect(finished.mode).toBe('background')
    expect(done.variables.transcript_srt.name).toBe('call-transcript.srt')
  })

  it('Background run mode queues at once (saved runs only)', async () => {
    const h = harness('media_transcribe', { integration_id: 'int-1', source: 'audio', run_mode: 'background' }, { capabilities: ['transcribe'], transcribe: async () => transcript }, { audio }, 'deepgram')
    h.ctx.canBackground = true
    expect(await runMediaNode(h.ctx)).toBeInstanceOf(MediaBackground)
    h.ctx.canBackground = false
    expect(await runMediaNode(h.ctx)).not.toBeInstanceOf(MediaBackground)
  })

  it('refuses a provider without the capability, naming the ones that can', async () => {
    const h = harness('media_transcribe', { integration_id: 'int-1', source: 'audio' }, { capabilities: ['generate_image', 'edit_image'] }, { audio }, 'stability')
    await expect(runMediaNode(h.ctx)).rejects.toThrow(/Stability AI cannot transcribe speech\. Choose a provider that can \(OpenAI, Google Gemini/)
    const none = harness('media_transcribe', { source: 'audio' }, { capabilities: ['transcribe'] }, { audio })
    await expect(runMediaNode(none.ctx)).rejects.toThrow(/choose the AI provider connection/)
  })

  it('a file over the provider limit needs FFmpeg to split it — a clear error without it', async () => {
    const h = harness('media_transcribe', { integration_id: 'int-1', source: 'audio' }, { capabilities: ['transcribe'], maxTranscribeBytes: 1000, transcribe: async () => transcript }, { audio }, 'openai')
    await expect(runMediaNode(h.ctx)).rejects.toThrow(/accepts 0 MB per request\. Longer media is split with FFmpeg/)
  })
})

describe('Analyze Image', () => {
  const image = { name: 'card.png', mime_type: 'image/png', bytes: pngBytes(idCardImage()) }

  it('passes only supported features, adds pixel boxes and warns about the rest', async () => {
    const analyzeImage = vi.fn(async () => ({
      description: 'A driver license.', labels: [{ name: 'Document', confidence: 0.9 }], objects: [], text: 'DRIVER LICENSE',
      ocr: [{ text: 'DRIVER LICENSE', box: { x: 0.4, y: 0.1, width: 0.27, height: 0.06 } }], faces: [{ box: ID_CARD.face, confidence: 0.99 }], safety: [],
      provider: 'gemini' as const, model: 'gemini-2.5-flash',
    }))
    const h = harness('media_analyze_image', { integration_id: 'int-1', source: 'image', features: ['description', 'faces', 'text', 'safety'], prompt: 'What document is this?', fields: [{ name: 'kind', type: 'string' }] }, { capabilities: ['analyze_image', 'detect_faces', 'ocr', 'detect_objects', 'analyze_video', 'transcribe'], analyzeImage }, { image })
    const out = await runMediaNode(h.ctx) as Record<string, any>
    const [blob, options] = analyzeImage.mock.calls[0] as unknown as [{ mime_type: string }, Record<string, any>]
    expect(blob.mime_type).toBe('image/jpeg')
    expect(options.features).toEqual(['description', 'faces', 'text'])
    expect(options.fields).toEqual([{ name: 'kind', type: 'string', description: undefined }])
    expect(h.warnings[0]).toMatch(/cannot check image safety/)
    expect(h.variables.image_analysis.faces[0].box_px).toEqual(toPixels(ID_CARD.face, 640, 400))
    expect(h.variables.image_analysis_text).toBe('DRIVER LICENSE')
    expect(out).toMatchObject({ faces: 1, text_lines: 1, width: 640, height: 400 })
  })
})

describe('Redact Image', () => {
  const image = { name: 'card.png', mime_type: 'image/png', bytes: pngBytes(idCardImage()) }
  const provider = {
    capabilities: ['analyze_image', 'detect_faces', 'ocr', 'detect_objects'] as MediaCapability[],
    analyzeImage: vi.fn(async () => ({
      labels: [], objects: [{ name: 'License plate', box: { x: 0.8, y: 0.85, width: 0.15, height: 0.08 } }], text: 'ID 078-05-1120',
      ocr: [{ text: 'ID 078-05-1120', words: [{ text: 'ID', box: { x: 0.36, y: ID_CARD.idLine.y, width: 0.04, height: ID_CARD.idLine.height } }, { text: '078-05-1120', box: ID_CARD.idLine }] }],
      faces: [{ box: ID_CARD.face, confidence: 0.98 }], safety: [], provider: 'gemini' as const,
    })),
  }

  it('blurs faces and the ID number, keeps the rest, returns masked findings', async () => {
    const h = harness('media_redact_image', { integration_id: 'int-1', source: 'image', targets: ['faces', 'text_pii'], padding: 0 }, provider, { image })
    const out = await runMediaNode(h.ctx) as Record<string, any>
    expect(out).toMatchObject({ total: 2, counts: { face: 1, us_ssn: 1 }, file: 'card-redacted.png', style: 'blur' })
    const redacted = decodeImage(h.stored[0].bytes)
    const original = idCardImage()
    expect(regionDiff(redacted, original, toPixels(ID_CARD.face, 640, 400))).toBeGreaterThan(40)
    expect(regionDiff(redacted, original, toPixels(ID_CARD.idLine, 640, 400))).toBeGreaterThan(40)
    expect(regionDiff(redacted, original, { left: 260, top: 40, width: 100, height: 60 })).toBe(0)
    const ssn = h.variables.redacted_image_findings.find((f: any) => f.type === 'us_ssn')
    expect(ssn.text).toBe('•••-••-••••')
    expect(ssn.box_px).toEqual(toPixels(ID_CARD.idLine, 640, 400))
    expect(h.variables.redacted_image_file.name).toBe('card-redacted.png')
    expect(h.variables.redacted_image_count).toBe(2)
  })

  it('plates, custom boxes (pixels) and box style; detect only stores nothing', async () => {
    const h = harness('media_redact_image', { integration_id: 'int-1', source: 'image', targets: ['plates', 'custom'], boxes: '{{marks}}', style: 'box', color: '#ff0000', padding: 0, output_format: 'jpeg' }, provider, { image })
    h.variables.marks = [{ left: 10, top: 10, width: 20, height: 20, label: 'Logo' }]
    const out = await runMediaNode(h.ctx) as Record<string, any>
    expect(out.counts).toEqual({ plate: 1, custom: 1 })
    expect(h.stored[0].name).toBe('card-redacted.jpg')
    const img = decodeImage(h.stored[0].bytes)
    const i = (20 * 640 + 20) * 4
    expect(img.data[i]).toBeGreaterThan(200)
    expect(img.data[i + 1]).toBeLessThan(60)
    const detect = harness('media_redact_image', { integration_id: 'int-1', source: 'image', targets: ['faces'], mode: 'detect_only' }, provider, { image })
    const d = await runMediaNode(detect.ctx) as Record<string, any>
    expect(detect.stored).toHaveLength(0)
    expect(d.mode).toBe('detect_only')
    expect(detect.variables.image_findings_count).toBe(1)
  })

  it('custom boxes alone need no provider', async () => {
    const h = harness('media_redact_image', { source: 'image', targets: ['custom'], boxes: [{ x: 0.1, y: 0.1, width: 0.1, height: 0.1 }] }, provider, { image })
    h.ctx.deps!.credentials = undefined
    const out = await runMediaNode(h.ctx) as Record<string, any>
    expect(out.total).toBe(1)
  })

  it('refuses a provider that cannot locate what was asked (no silent misses)', async () => {
    const h = harness('media_redact_image', { integration_id: 'int-1', source: 'image', targets: ['faces', 'text_pii'] }, { capabilities: ['transcribe', 'analyze_image', 'moderation', 'generate_image', 'edit_image', 'tts'] }, { image }, 'openai')
    await expect(runMediaNode(h.ctx)).rejects.toThrow(/OpenAI cannot locate faces/)
  })

  it('needs FFmpeg for other image formats', async () => {
    const h = harness('media_redact_image', { source: 'image', targets: ['custom'], boxes: [] }, provider, { image: { name: 'x.webp', mime_type: 'image/webp', bytes: new TextEncoder().encode('RIFF....WEBPVP8 xxxx') } })
    await expect(runMediaNode(h.ctx)).rejects.toThrow(/WEBP image.*FFmpeg/)
  })
})

describe('Generate / speech / utilities', () => {
  it('stores generated images and speech as files', async () => {
    const png = pngBytes(idCardImage())
    const g = harness('media_generate_image', { integration_id: 'int-1', prompt: 'A lighthouse', count: 2, output_name: 'poster' }, { capabilities: ['generate_image', 'edit_image'], generateImage: async () => ({ images: [{ bytes: png, mime_type: 'image/png', revised_prompt: 'A tall lighthouse' }, { bytes: png, mime_type: 'image/png' }], provider: 'stability' as const, usage: { unit: 'image' as const, quantity: 2, operation: 'generate_image' as const } }) }, {}, 'stability')
    const out = await runMediaNode(g.ctx) as Record<string, any>
    expect(out.files).toEqual(['poster-1.png', 'poster-2.png'])
    expect(g.variables.generated_image.revised_prompt).toBe('A tall lighthouse')
    expect(g.variables.generated_image_files).toHaveLength(2)

    const speak = vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mime_type: 'audio/mpeg', format: 'mp3' as const, provider: 'openai' as const, voice: 'alloy' }))
    const t = harness('media_tts', { integration_id: 'int-1', text: 'Your order shipped.', voice: 'alloy' }, { capabilities: ['tts'], speak }, {}, 'openai')
    const s = await runMediaNode(t.ctx) as Record<string, any>
    expect(speak).toHaveBeenCalledWith(expect.objectContaining({ text: 'Your order shipped.', voice: 'alloy', format: 'mp3' }), expect.anything())
    expect(s).toMatchObject({ characters: 19, file: 'speech.mp3' })
    expect(t.variables.speech_file.mime_type).toBe('audio/mpeg')
    const long = harness('media_tts', { integration_id: 'int-1', text: 'x'.repeat(20_001) }, { capabilities: ['tts'], speak }, {}, 'openai')
    await expect(runMediaNode(long.ctx)).rejects.toThrow(/at most 20000/)
  })

  it('media utilities without FFmpeg fail with the remedy', async () => {
    const h = harness('media_tools', { operation: 'trim', source: 'audio', start: '5' }, { capabilities: [] }, { audio })
    await expect(runMediaNode(h.ctx)).rejects.toThrow(/Media Utilities → Trim needs FFmpeg/)
  })
})

describe('background snapshot', () => {
  it('resolves expressions now and stores inline base64 inputs as files', async () => {
    const stored: string[] = []
    const out = await snapshotMediaConfig({
      config: { integration_id: 'int-1', source: '{{upload}}', language: '{{lang}}', fields: [{ name: 'a', description: 'plain' }], formats: ['srt'] },
      resolve: (v) => ({ '{{upload}}': { name: 'a.mp3', base64: Buffer.from('abc').toString('base64'), mime_type: 'audio/mpeg' }, '{{lang}}': 'de' } as Record<string, unknown>)[String(v)],
      supabase: {} as never,
      tenantId: 't',
      deps: { store: async (bytes, name, mime) => { stored.push(name); return { _file: true, id: 'x', name, size: bytes.byteLength, mime_type: mime, content_type: mime, url: '/files/x', path: 'p', storage_ref: 'storage://task-files/p', uploaded_by: null, uploaded_at: '', checksum_sha256: '' } } },
    })
    expect(out.language).toBe('de')
    expect(stored).toEqual(['a.mp3'])
    expect(out.source).toMatchObject({ name: 'a.mp3', storage_ref: 'storage://task-files/p' })
    expect(JSON.stringify(out)).not.toContain(Buffer.from('abc').toString('base64'))
    expect(out.fields).toEqual([{ name: 'a', description: 'plain' }])
  })
})
