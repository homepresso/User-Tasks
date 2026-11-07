import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { geminiMockAnswer, imageSize, TRANSCRIPTS } from '@/lib/gallery/media-mock'
import { GALLERY_SAMPLES_DIR, readGallerySample } from '@/lib/gallery/verify-core'
import { parseGeminiImage, parseGeminiTranscript } from '@/lib/media/providers/gemini'

const sample = (name: string) => readFileSync(join(GALLERY_SAMPLES_DIR, name))
const answer = (res: Record<string, unknown>) => JSON.parse(((res.candidates as any[])[0].content.parts[0].text) as string)
const imageRequest = (name: string, properties: Record<string, unknown>) => ({
  contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'image/png', data: sample(name).toString('base64') } }, { text: 'Analyse this image.' }] }],
  generationConfig: { responseMimeType: 'application/json', responseJsonSchema: { type: 'object', properties } },
})

/* eslint-disable @typescript-eslint/no-explicit-any -- provider JSON */

describe('gallery media mock (verification of the Media & Evidence packages)', () => {
  it('reads the size of the synthetic PNG and JPEG samples', () => {
    expect(imageSize(sample('id-card.png'))).toEqual({ width: 640, height: 400 })
    expect(imageSize(sample('scene-photo.png'))).toEqual({ width: 640, height: 360 })
    expect(imageSize(sample('vehicle-damage.jpg'))).toEqual({ width: 800, height: 500 })
    expect(imageSize(Buffer.from('not an image'))).toBeNull()
  })

  it('answers image requests with the boxes of the picture it was sent', () => {
    const res = geminiMockAnswer(imageRequest('scene-photo.png', { faces: {}, objects: {}, text_lines: {} }))
    const parsed = parseGeminiImage(answer(res), { features: ['faces', 'objects', 'text'] }, 'mock')
    expect(parsed.faces).toHaveLength(1)
    expect(parsed.faces[0].box!.x).toBeCloseTo(56 / 640, 2)
    expect(parsed.objects.some((o) => o.name === 'license plate')).toBe(true)
    expect(parsed.ocr.map((l) => l.text)).toContain('SSN 078-05-1120')
    const card = parseGeminiImage(answer(geminiMockAnswer(imageRequest('id-card.png', { faces: {}, objects: {} }))), { features: ['faces', 'objects'] }, 'mock')
    expect(card.objects.filter((o) => o.name === 'license plate')).toHaveLength(0)
  })

  it('returns the structured answers a package sets and fills the rest by type', () => {
    const req = { ...imageRequest('ugc-upload.png', {}), generationConfig: { responseJsonSchema: { type: 'object', properties: { answer: { type: 'object', properties: { risk_score: { type: 'number' }, category: { type: 'string' }, flagged: { type: 'boolean' } } } } } } }
    expect(answer(geminiMockAnswer(req, { answers: { risk_score: 0.42 } })).answer).toEqual({ risk_score: 0.42, category: 'sample category', flagged: false })
  })

  it('transcribes with the recording the package chose, inside the sample length', () => {
    const req = { contents: [{ parts: [{ text: 'Generate a verbatim transcript' }] }], generationConfig: { responseJsonSchema: { type: 'object', properties: { segments: {} } } } }
    const parsed = parseGeminiTranscript(answer(geminiMockAnswer(req, { transcript: 'call' })), 'mock', { diarize: true }, undefined)
    expect(parsed.text).toContain('4111 1111 1111 1111')
    expect(parsed.speakers).toEqual(['Speaker 1', 'Speaker 2'])
    expect(parsed.segments.at(-1)!.end).toBeLessThanOrEqual(12)
    expect(Math.max(...TRANSCRIPTS.interview.map((s) => s.end))).toBeLessThanOrEqual(8)
  })

  it('serves samples by plain name only', () => {
    expect(readGallerySample('bodycam-clip.mp4')?.type).toBe('video/mp4')
    expect(readGallerySample('../package.json')).toBeNull()
    expect(readGallerySample('missing.png')).toBeNull()
  })
})
