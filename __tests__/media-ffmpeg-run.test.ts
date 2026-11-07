/**
 * Media steps that run FFmpeg, end to end against the real binaries.
 * Skipped when FFmpeg is not installed (set FFMPEG_PATH / FFPROBE_PATH to
 * run them elsewhere, e.g. a wrapper that runs the Docker image). Every
 * input is generated here with FFmpeg's own test sources.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ffmpegAvailable, probeMedia, runFfmpeg, buildThumbnailArgs } from '@/lib/media/ffmpeg'
import { runMediaNode, type MediaNodeContext } from '@/lib/media/handlers'
import { MEDIA_PROVIDER_BY_ID } from '@/lib/media/catalog'
import { decodeImage } from '@/lib/media/image'
import type { MediaProvider } from '@/lib/media/types'
import { regionDiff } from './helpers/media-fixtures'

const HAVE_FFMPEG = await ffmpegAvailable()

describe.skipIf(!HAVE_FFMPEG)('media steps with FFmpeg', () => {
  let dir = ''
  const fixtures: Record<string, { name: string; mime_type: string; bytes: Uint8Array }> = {}

  beforeAll(async () => {
    dir = await mkdtemp(path.join(process.env.MEDIA_TMP_DIR || tmpdir(), 'media-test-'))
    const video = path.join(dir, 'clip.mp4')
    await runFfmpeg(['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=10:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video])
    const audio = path.join(dir, 'call.mp3')
    await runFfmpeg(['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=16000:duration=3', '-c:a', 'libmp3lame', audio])
    fixtures.video = { name: 'clip.mp4', mime_type: 'video/mp4', bytes: new Uint8Array(await readFile(video)) }
    fixtures.audio = { name: 'call.mp3', mime_type: 'audio/mpeg', bytes: new Uint8Array(await readFile(audio)) }
    fixtures.evil = { ...fixtures.video, name: 'clip$(touch PWNED);rm -rf x`id`.mp4' }
  }, 120_000)

  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })

  function harness(type: string, config: Record<string, any>, provider?: Partial<MediaProvider>) {
    const stored: Array<{ name: string; mime: string; bytes: Uint8Array }> = []
    const variables: Record<string, any> = {}
    const ctx: MediaNodeContext = {
      type, config, resolve: (v) => v, supabase: {} as never, tenantId: 't', variables, setVar: (n, v) => { variables[n] = v }, warn: () => {},
      deps: {
        ...(provider ? { provider: { id: 'gemini', label: 'Google Gemini', capabilities: [], ...provider } as MediaProvider, credentials: { provider: MEDIA_PROVIDER_BY_ID.gemini, credentials: { provider: 'gemini', integrationId: 'i', baseUrl: 'https://x.test', apiKey: 'k', extra: {} } } } : {}),
        resolveFile: async (v) => { const f = fixtures[String(v)]; return { ...f, size: f.bytes.byteLength, source: 'storage' } },
        store: async (bytes, name, mime) => { stored.push({ name, mime, bytes }); return { _file: true, id: String(stored.length), name, size: bytes.byteLength, mime_type: mime, content_type: mime, url: '/f', path: 'p', storage_ref: 's', uploaded_by: null, uploaded_at: '', checksum_sha256: '' } },
      },
    }
    return { ctx, stored, variables }
  }

  async function probeStored(bytes: Uint8Array, ext: string) {
    const p = path.join(dir, `check-${Math.random().toString(36).slice(2)}.${ext}`)
    await writeFile(p, bytes)
    return { info: await probeMedia(p), file: p }
  }

  it('info, extract audio, frames, thumbnail', async () => {
    const info = harness('media_tools', { operation: 'info', source: 'video' })
    await runMediaNode(info.ctx)
    expect(info.variables.media_info).toMatchObject({ has_video: true, has_audio: true, video: { width: 320, height: 240 } })
    expect(info.variables.media_info.duration).toBeCloseTo(4, 0)

    const audio = harness('media_tools', { operation: 'extract_audio', source: 'video', format: 'wav' })
    await runMediaNode(audio.ctx)
    expect(audio.stored[0].name).toBe('clip-audio.wav')
    expect((await probeStored(audio.stored[0].bytes, 'wav')).info).toMatchObject({ has_video: false, has_audio: true })

    const frames = harness('media_tools', { operation: 'frames', source: 'video', interval: 1, count: 3 })
    const out = await runMediaNode(frames.ctx) as Record<string, any>
    expect(out.frames).toBe(3)
    expect(frames.variables.frames.map((f: any) => f.time)).toEqual([0, 1, 2])
    expect(decodeImage(frames.stored[0].bytes)).toMatchObject({ width: 320, height: 240 })

    const thumb = harness('media_tools', { operation: 'thumbnail', source: 'video', at: '00:00:02', format: 'png' })
    await runMediaNode(thumb.ctx)
    expect(thumb.stored[0].name).toBe('clip-thumbnail.png')
  }, 120_000)

  it('trim, convert, compress and burn in subtitles', async () => {
    const trim = harness('media_tools', { operation: 'trim', source: 'video', start: '1', end: '00:00:03' })
    await runMediaNode(trim.ctx)
    expect((await probeStored(trim.stored[0].bytes, 'mp4')).info.duration).toBeCloseTo(2, 0)

    const conv = harness('media_tools', { operation: 'convert', source: 'video', format: 'mov', max_width: 160 })
    await runMediaNode(conv.ctx)
    expect((await probeStored(conv.stored[0].bytes, 'mov')).info.video).toMatchObject({ width: 160, height: 120 })

    const comp = harness('media_tools', { operation: 'compress', source: 'video', quality: 'low' })
    await runMediaNode(comp.ctx)
    expect(comp.stored[0].name).toBe('clip-compressed.mp4')

    const subs = harness('media_tools', { operation: 'burn_subtitles', source: 'video', subtitles: { text: 'x', segments: [{ start: 0, end: 3, text: "Hello, it's: [a] test; really" }] } })
    await runMediaNode(subs.ctx)
    expect((await probeStored(subs.stored[0].bytes, 'mp4')).info.has_video).toBe(true)
  }, 180_000)

  it('redacts a region over time and bleeps a sensitive phrase', async () => {
    const box = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }
    const provider = { capabilities: ['detect_faces', 'analyze_image'] as never, analyzeImage: async () => ({ labels: [], objects: [], text: '', ocr: [], faces: [{ box, confidence: 0.9 }], safety: [], provider: 'gemini' as const }) }
    const h = harness('media_redact_video', {
      integration_id: 'i', source: 'video', targets: ['faces'], sample_interval: 1, padding: 0, style: 'pixelate', audio: 'bleep',
      transcript: { segments: [{ start: 0.5, end: 3.5, text: 'my card is 4111 1111 1111 1111 ok' }] },
    }, provider)
    const out = await runMediaNode(h.ctx) as Record<string, any>
    expect(out.frames_sampled).toBe(4)
    expect(out.regions).toBeGreaterThanOrEqual(1)
    expect(out.audio_segments).toBe(1)
    expect(out.counts).toMatchObject({ face: 4, credit_card: 1 })
    const { info, file } = await probeStored(h.stored[0].bytes, 'mp4')
    expect(info).toMatchObject({ has_video: true, has_audio: true })
    // Compare a frame of the original and the copy: changed inside the box, (almost) unchanged outside.
    const grab = async (input: string, out: string) => { await runFfmpeg(buildThumbnailArgs(input, out, 1.5, { format: 'png' })); return decodeImage(new Uint8Array(await readFile(out))) }
    const original = path.join(dir, 'orig.mp4')
    await writeFile(original, fixtures.video.bytes)
    const a = await grab(original, path.join(dir, 'a.png'))
    const b = await grab(file, path.join(dir, 'b.png'))
    expect(regionDiff(a, b, { left: 100, top: 80, width: 120, height: 80 })).toBeGreaterThan(15)
    expect(regionDiff(a, b, { left: 0, top: 0, width: 60, height: 40 })).toBeLessThan(12)
  }, 180_000)

  it('audio-only redaction keeps the format; hostile file names never reach a shell', async () => {
    const h = harness('media_redact_video', { source: 'audio', targets: [], audio: 'mute', transcript: [{ start: 0.2, end: 2.8, text: 'SSN 078-05-1120' }] })
    const out = await runMediaNode(h.ctx) as Record<string, any>
    expect(out.audio_segments).toBe(1)
    expect(h.stored[0].name).toBe('call-redacted.mp3')

    const evil = harness('media_tools', { operation: 'convert', source: 'evil', format: 'mp3' })
    await runMediaNode(evil.ctx)
    expect(evil.stored[0].name).not.toContain('/')
    expect(existsSync(path.join(process.cwd(), 'PWNED'))).toBe(false)
    expect((await readdir(dir)).some((n) => n.includes('PWNED'))).toBe(false)
    const badStart = harness('media_tools', { operation: 'trim', source: 'video', start: '1; touch PWNED' })
    await expect(runMediaNode(badStart.ctx)).rejects.toThrow(/must be a number of seconds/)
  }, 120_000)
})
