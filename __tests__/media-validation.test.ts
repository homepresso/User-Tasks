import { describe, expect, it } from 'vitest'
import { validateNode } from '@/lib/workflow-validation'
import { getNodeConfigSummary } from '@/lib/workflow-utils'
import { MEDIA_NODE_TYPES } from '@/lib/media/catalog'
import { NODE_CATALOG, type WorkflowNode } from '@/lib/workflow-schema'

function node(type: string, config: Record<string, unknown> = {}): WorkflowNode {
  return { id: 'm-1', type: type as WorkflowNode['type'], label: 'Media', position: { x: 0, y: 0 }, config }
}
const v = (type: string, config: Record<string, unknown> = {}) => validateNode(node(type, config))
const P = { integration_id: 'int-1' }
const SRC = { ...P, source: '{{form.file}}' }

describe('media steps in the catalog', () => {
  it('every media node type is in NODE_CATALOG', () => {
    for (const type of MEDIA_NODE_TYPES) expect(NODE_CATALOG.some((n) => n.type === type), type).toBe(true)
  })
})

describe('validateNode — media', () => {
  it('requires a provider except for Media Utilities', () => {
    for (const type of MEDIA_NODE_TYPES.filter((t) => t !== 'media_tools')) {
      expect(v(type, { source: 'x', prompt: 'p', text: 't' }), type).toContain('AI provider required')
    }
    expect(v('media_tools', { source: 'x' })).toEqual([])
  })

  it('does not require a provider for redaction with only custom boxes and no audio', () => {
    expect(v('media_redact_image', { source: 'x', targets: ['custom'], boxes: '{{boxes}}' })).toEqual([])
    expect(v('media_redact_video', { source: 'x', targets: ['custom'], boxes: '{{boxes}}', audio: 'none' })).toEqual([])
    expect(v('media_redact_video', { source: 'x', targets: ['custom'], boxes: '{{boxes}}', audio: 'bleep' })).toContain('Speech provider required')
    expect(v('media_redact_video', { source: 'x', targets: [], audio: 'bleep', transcribe_integration_id: 'int-2' })).toEqual([])
    expect(v('media_redact_video', { source: 'x', targets: [], audio: 'none', ...P })).toContain('Choose what to redact')
  })

  it('requires the source media', () => {
    for (const type of ['media_transcribe', 'media_analyze_image', 'media_analyze_video', 'media_redact_image', 'media_redact_video', 'media_tools']) {
      expect(v(type, P), type).toContain('Source media required')
    }
    expect(v('media_tts', { ...P, text: 'Hi' })).toEqual([])
    expect(v('media_generate_image', { ...P, prompt: 'A van' })).toEqual([])
    expect(v('media_generate_image', { ...P, prompt: 'A van', operation: 'edit' })).toContain('Image to edit required')
  })

  it('passes complete configs', () => {
    expect(v('media_transcribe', { ...SRC, formats: ['srt', 'vtt'], diarize: true })).toEqual([])
    expect(v('media_analyze_image', { ...SRC, features: ['faces', 'text'] })).toEqual([])
    expect(v('media_analyze_video', { ...SRC, max_frames: 60 })).toEqual([])
    expect(v('media_redact_image', SRC)).toEqual([])
    expect(v('media_redact_video', { ...SRC, sample_interval: 0.2, audio: 'bleep' })).toEqual([])
    expect(v('media_generate_image', { ...P, prompt: 'x', count: 4 })).toEqual([])
    expect(v('media_generate_image', { ...SRC, prompt: 'x', operation: 'edit', mask: '{{mask}}' })).toEqual([])
  })

  it('checks prompt, text and counts', () => {
    expect(v('media_generate_image', P)).toContain('Prompt required')
    expect(v('media_tts', P)).toContain('Text required')
    expect(v('media_generate_image', { ...P, prompt: 'x', count: 5 })).toContain('Number of images must be 1–4')
    expect(v('media_generate_image', { ...P, prompt: 'x', count: 0 })).toContain('Number of images must be 1–4')
    expect(v('media_generate_image', { ...P, prompt: 'x', count: '{{n}}' })).toEqual([])
  })

  it('checks formats, frames and sample interval', () => {
    expect(v('media_transcribe', { ...SRC, formats: ['srt', 'docx'] })).toContain('Unknown transcript format (srt, vtt, txt or json)')
    expect(v('media_analyze_video', { ...SRC, max_frames: 61 })).toContain('Max frames must be 1–60')
    expect(v('media_analyze_video', { ...SRC, max_frames: 0 })).toContain('Max frames must be 1–60')
    expect(v('media_redact_video', { ...SRC, sample_interval: 0.1 })).toContain('Seconds between frames must be at least 0.2')
    expect(v('media_analyze_image', { ...SRC, features: ['colour'] })).toContain('Unknown image feature')
  })

  it('requires at least one redaction target, and boxes for custom', () => {
    expect(v('media_redact_image', { ...SRC, targets: [] })).toContain('Choose what to redact')
    expect(v('media_redact_image', { ...SRC, targets: [], mode: 'detect_only' })).toContain('Choose what to find')
    expect(v('media_redact_image', { ...SRC, targets: ['faces', 'custom'] })).toContain('Boxes required (or remove "Boxes from earlier steps")')
    expect(v('media_redact_image', { ...SRC, targets: ['text_pii'], info_types: [] })).toContain('Choose the sensitive text to find')
    expect(v('media_redact_image', { ...SRC, targets: ['text_pii'], info_types: [], terms: 'Falcon' })).toEqual([])
  })

  it('checks Media Utilities operations', () => {
    const S = { source: 'x' }
    expect(v('media_tools', { ...S, operation: 'trim' })).toContain('Start or end required')
    expect(v('media_tools', { ...S, operation: 'trim', end: '0:30' })).toEqual([])
    expect(v('media_tools', { ...S, operation: 'burn_subtitles' })).toContain('Subtitles required')
    expect(v('media_tools', { ...S, operation: 'convert' })).toContain('Choose a known format to convert to')
    expect(v('media_tools', { ...S, operation: 'convert', format: 'avi' })).toContain('Choose a known format to convert to')
    expect(v('media_tools', { ...S, operation: 'convert', format: 'webm' })).toEqual([])
    expect(v('media_tools', { ...S, operation: 'frames', count: 101 })).toContain('Max frames must be 1–100')
    expect(v('media_tools', { ...S, operation: 'explode' })).toContain('Unknown operation')
    expect(v('media_tools', { ...S, run_mode: 'later' })).toContain('Unknown run mode')
  })
})

describe('getNodeConfigSummary — media', () => {
  const sum = (type: string, config: Record<string, unknown>) => getNodeConfigSummary({ type, config })

  it('summarises transcription with the provider and formats', () => {
    expect(sum('media_transcribe', { ...SRC, provider_label: 'Google Gemini', formats: ['srt', 'vtt'] })).toBe('Google Gemini · SRT, VTT → transcript')
    expect(sum('media_transcribe', { source: 'x', diarize: true })).toBe('SRT · speakers → transcript')
    expect(sum('media_transcribe', {})).toBeNull()
  })

  it('summarises analysis and redaction', () => {
    expect(sum('media_analyze_image', { source: 'x' })).toBe('description, labels, text → image_analysis')
    expect(sum('media_analyze_video', { source: 'x', prompt: 'q', output_var: 'clip' })).toBe('summary, scenes + question → clip')
    expect(sum('media_redact_image', { source: 'x' })).toBe('faces, sensitive text · blur → redacted_image')
    expect(sum('media_redact_video', { source: 'x', targets: ['plates'], style: 'pixelate', audio: 'bleep' })).toBe('license plates · pixelate + bleep speech → redacted_video')
    expect(sum('media_redact_image', { source: 'x', mode: 'detect_only', targets: ['faces'] })).toBe('Find faces → image_findings')
    expect(sum('media_redact_video', { source: 'x', targets: [], audio: 'mute' })).toBe('Mute speech → redacted_video')
  })

  it('summarises generation, speech and utilities', () => {
    expect(sum('media_generate_image', { prompt: 'A delivery van', count: 2 })).toBe('Generate ×2 "A delivery van"')
    expect(sum('media_generate_image', {})).toBeNull()
    expect(sum('media_tts', { text: 'Hi', voice: 'alloy' })).toBe('alloy · MP3 → speech')
    expect(sum('media_tools', { operation: 'trim', start: '0:05', end: '0:30' })).toBe('Trim 0:05–0:30')
    expect(sum('media_tools', { operation: 'convert', format: 'webm' })).toBe('Convert → WEBM')
    expect(sum('media_tools', {})).toBe('Media info → media_info')
    expect(sum('media_tools', { operation: 'frames' })).toBe('Frames every 1 s (max 10)')
  })
})
