import { describe, expect, it, vi } from 'vitest'
import { getAgentBuiltinToolNames, normalizeAgentOutputConfig } from '@/lib/agent-knowledge'
import { BUILTIN_TOOL_DEFS, READ_ONLY_BUILTIN_TOOLS } from '@/lib/agent-tool-defs'
import { MEDIA_PROVIDER_BY_ID } from '@/lib/media/catalog'
import { buildAgentFileParts } from '@/lib/agent-files'
import { idCardImage, pngBytes } from './helpers/media-fixtures'

const loadMediaCredentials = vi.fn(async (_db: unknown, tenantId: string, id: string) => {
  if (tenantId !== 'tenant-a' || id !== 'int-media') throw new Error('Integration not found')
  return { provider: MEDIA_PROVIDER_BY_ID.gemini, credentials: { provider: 'gemini', integrationId: id, baseUrl: 'https://x.test', apiKey: 'k', extra: {} } }
})
const transcribe = vi.fn(async () => ({ text: 'Hello from the call', segments: [{ id: 0, start: 0, end: 2.04, text: 'Hello from the call', speaker: 'A' }], speakers: ['A'], provider: 'gemini', duration: 2 }))
const analyzeImage = vi.fn(async () => ({ description: 'An ID card', labels: [{ name: 'Card' }], objects: [], text: 'ID 078-05-1120', ocr: [], faces: [{ box: { x: 0, y: 0, width: 0.1, height: 0.1 } }], safety: [], provider: 'gemini' }))
vi.mock('@/lib/media/credentials', () => ({ loadMediaCredentials }))
vi.mock('@/lib/media/providers', () => ({ getMediaProvider: () => ({ id: 'gemini', label: 'Google Gemini', capabilities: ['transcribe', 'analyze_image', 'detect_faces', 'ocr', 'detect_objects', 'analyze_video'], transcribe, analyzeImage }) }))

const { runMediaTool } = await import('@/lib/agents/tools/media')

function runtime(media: unknown) {
  return {
    tenantId: 'tenant-a', agentId: 'agent-1', actingUserId: null, outputConfig: normalizeAgentOutputConfig({ media_access: media }),
    db: () => ({}) as never, permissions: async () => null, allowedHosts: [], generatedFiles: [],
  }
}

describe('agent media tools', () => {
  it('are granted only with media access and an integration, and are not read-only (approval-eligible)', () => {
    expect(getAgentBuiltinToolNames(normalizeAgentOutputConfig({}))).not.toContain('transcribe_media')
    expect(getAgentBuiltinToolNames(normalizeAgentOutputConfig({ media_access: { enabled: true } }))).not.toContain('transcribe_media')
    expect(getAgentBuiltinToolNames(normalizeAgentOutputConfig({ media_access: { enabled: true, integration_id: 'int-media' } }))).toEqual(expect.arrayContaining(['transcribe_media', 'analyze_image']))
    for (const name of ['transcribe_media', 'analyze_image']) {
      expect(BUILTIN_TOOL_DEFS.find((t) => t.name === name)?.category).toBe('media')
      expect(READ_ONLY_BUILTIN_TOOLS.has(name)).toBe(false)
    }
  })

  it('refuses when media access is off', async () => {
    await expect(runMediaTool(runtime({ enabled: false, integration_id: 'int-media' }) as never, 'transcribe_media', { file_id: 'x' }, [])).rejects.toThrow(/disabled/)
  })

  it('transcribes an attached file with the granted integration of the agent tenant', async () => {
    const files = [{ id: 'f1', name: 'call.mp3', mime_type: 'audio/mpeg', bytes: new Uint8Array(10) }]
    const out = await runMediaTool(runtime({ enabled: true, integration_id: 'int-media' }) as never, 'transcribe_media', { file_id: 'call.mp3', diarize: true }, files)
    expect(loadMediaCredentials).toHaveBeenCalledWith(expect.anything(), 'tenant-a', 'int-media')
    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ name: 'call.mp3' }), expect.objectContaining({ diarize: true }), expect.anything())
    expect(out).toMatchObject({ text: 'Hello from the call', speakers: ['A'], segments: [{ start: 0, end: 2, speaker: 'A', text: 'Hello from the call' }] })
    await expect(runMediaTool(runtime({ enabled: true, integration_id: 'int-media' }) as never, 'transcribe_media', { file_id: 'nope' }, files)).rejects.toThrow(/No file "nope"/)
  })

  it('analyzes an attached image (no identities, face count only)', async () => {
    const files = [{ id: 'img', name: 'card.png', mime_type: 'image/png', bytes: pngBytes(idCardImage()) }]
    const out = await runMediaTool(runtime({ enabled: true, integration_id: 'int-media' }) as never, 'analyze_image', { file_id: 'card.png', features: ['description', 'faces', 'text'] }, files)
    expect(out).toMatchObject({ description: 'An ID card', face_count: 1, text: 'ID 078-05-1120', width: 640, height: 400 })
    expect(out).not.toHaveProperty('faces')
  })

  it('URLs go through the egress guard', async () => {
    await expect(runMediaTool(runtime({ enabled: true, integration_id: 'int-media' }) as never, 'analyze_image', { url: 'http://169.254.169.254/latest/meta-data' }, [])).rejects.toThrow(/blocked/i)
  })

  it('audio / video given to an agent step are referenced, not sent to the chat model', async () => {
    const { parts, summary } = await buildAgentFileParts([{ name: 'call.mp3', mime_type: 'audio/mpeg', size: 2048, bytes: new Uint8Array(2048) } as never], 'https://api.openai.com', 'openai')
    expect(summary[0].sent_as).toBe('reference')
    expect(JSON.stringify(parts)).toContain('transcribe_media')
  })
})
