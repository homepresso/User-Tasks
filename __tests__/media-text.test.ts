import { describe, expect, it } from 'vitest'
import { roundBox } from '@/lib/media/geometry'
import { findInOcr, findInTranscript, PLATE_LABEL } from '@/lib/media/pii'
import { resolveInfoTypes } from '@/lib/documents/pii/catalog'
import { cuesToSrt, mergeChunkTranscripts, parseStamp, parseSubtitles, planChunks, preview, secondsForBytes, segmentsToCues, speakersOf, srtTime, toSrt, toText, toVtt, transcriptSegmentsFrom, vttTime } from '@/lib/media/transcript'
import { sampleTimes, trackDetections, tracksToRegions } from '@/lib/media/tracking'
import type { OcrLine, TranscriptResult, TranscriptSegment } from '@/lib/media/types'

const types = resolveInfoTypes(['@high', 'date_of_birth'])

describe('sensitive text in images (OCR boxes)', () => {
  // Word boxes as an OCR provider returns them (fractions of a 640×400 card).
  const word = (text: string, x: number, y: number, w: number) => ({ text, box: { x, y, width: w, height: 0.06 } })
  const lines: OcrLine[] = [
    { text: 'DRIVER LICENSE', words: [word('DRIVER', 0.4, 0.1, 0.12), word('LICENSE', 0.53, 0.1, 0.14)] },
    { text: 'Name Jane Example', words: [word('Name', 0.4, 0.3, 0.08), word('Jane', 0.49, 0.3, 0.08), word('Example', 0.58, 0.3, 0.13)] },
    { text: 'SSN 078-05-1120', words: [word('SSN', 0.4, 0.55, 0.07), word('078-05-1120', 0.48, 0.55, 0.2)] },
    { text: 'Card 4111 1111 1111 1111', words: [word('Card', 0.4, 0.7, 0.08), word('4111', 0.49, 0.7, 0.07), word('1111', 0.57, 0.7, 0.07), word('1111', 0.65, 0.7, 0.07), word('1111', 0.73, 0.7, 0.07)] },
  ]

  it('finds ID / card numbers and returns the union of the words they cover, masked', () => {
    const found = findInOcr(lines, { infoTypes: types })
    const ssn = found.find((f) => f.type === 'us_ssn')!
    expect(ssn).toBeDefined()
    expect(roundBox(ssn.box)).toEqual({ x: 0.48, y: 0.55, width: 0.2, height: 0.06 })
    expect(ssn.text).toBe('•••-••-••••')
    expect(ssn.line).toBe(2)
    const card = found.find((f) => f.type === 'credit_card')!
    expect(card.box.x).toBeCloseTo(0.49)
    expect(card.box.x + card.box.width).toBeCloseTo(0.8)
    // The label word is not part of the box.
    expect(found.every((f) => f.box.x >= 0.48)).toBe(true)
    expect(findInOcr(lines, { infoTypes: types }, true).find((f) => f.type === 'us_ssn')!.text).toBe('078-05-1120')
  })

  it('a hit inside a longer word / a line without word boxes gets a proportional slice', () => {
    const found = findInOcr([{ text: 'ID:078-05-1120', box: { x: 0.1, y: 0.5, width: 0.7, height: 0.05 } }], { infoTypes: types, terms: [] })
    const ssn = found.find((f) => f.type === 'us_ssn')!
    expect(ssn.box.x).toBeCloseTo(0.1 + 0.7 * (3 / 14))
    expect(ssn.box.x + ssn.box.width).toBeCloseTo(0.8)
  })

  it('terms and patterns work too; no text → nothing', () => {
    expect(findInOcr(lines, { terms: ['jane example'] }).map((f) => f.type)).toEqual(['term'])
    expect(findInOcr(lines, { patterns: ['DRIVER\\s+LICENSE'] })[0].box).toEqual({ x: 0.4, y: 0.1, width: expect.closeTo(0.27, 6), height: 0.06 })
    expect(findInOcr([], { infoTypes: types })).toEqual([])
  })

  it('plate labels', () => {
    for (const l of ['License plate', 'Licence Plate', 'Vehicle registration plate', 'number_plate']) expect(PLATE_LABEL.test(l), l).toBe(true)
    expect(PLATE_LABEL.test('Car')).toBe(false)
  })
})

describe('sensitive speech (transcript → time spans)', () => {
  const segments: TranscriptSegment[] = [
    { id: 0, start: 0, end: 4, text: 'Thanks for calling, how can I help?', speaker: 'A' },
    {
      id: 1, start: 4.2, end: 11, speaker: 'B', text: 'My card number is 4111 1111 1111 1111 thanks',
      words: ['My', 'card', 'number', 'is', '4111', '1111', '1111', '1111', 'thanks'].map((t, i) => ({ text: t, start: 4.2 + i * 0.6, end: 4.2 + i * 0.6 + 0.5 })),
    },
    { id: 2, start: 11, end: 15, text: 'and my SSN is 078-05-1120.', speaker: 'B' },
  ]

  it('word timings give exact spans; segments without words a proportional estimate', () => {
    const spans = findInTranscript(segments, { infoTypes: types })
    const card = spans.find((s) => s.type === 'credit_card')!
    expect(card.start).toBeCloseTo(4.2 + 4 * 0.6)
    expect(card.end).toBeCloseTo(4.2 + 7 * 0.6 + 0.5)
    expect(card.text).not.toContain('4111')
    const ssn = spans.find((s) => s.type === 'us_ssn')!
    const text = 'and my SSN is 078-05-1120.'
    expect(ssn.start).toBeCloseTo(11 + 4 * (text.indexOf('078') / text.length))
    expect(ssn.end).toBeGreaterThan(ssn.start)
    expect(ssn.end).toBeLessThanOrEqual(15)
  })
})

describe('transcripts and subtitles', () => {
  const segs: TranscriptSegment[] = [
    { id: 0, start: 0, end: 2.5, text: 'Hello there.', speaker: 'A' },
    { id: 1, start: 2.5, end: 3661.25, text: 'General Kenobi.', speaker: 'B' },
  ]

  it('formats SRT and WebVTT stamps', () => {
    expect(srtTime(3661.25)).toBe('01:01:01,250')
    expect(vttTime(0.0004)).toBe('00:00:00.000')
    expect(parseStamp('01:01:01,250')).toBe(3661.25)
    expect(parseStamp('01:02.5')).toBe(62.5)
    expect(parseStamp('nope')).toBeNull()
  })

  it('writes SRT, VTT and text with speakers', () => {
    const short = [{ id: 0, start: 0, end: 2.5, text: 'Hello there.', speaker: 'A' }, { id: 1, start: 2.5, end: 4, text: 'General Kenobi.', speaker: 'B' }]
    expect(toSrt(short)).toBe('1\n00:00:00,000 --> 00:00:02,500\nA: Hello there.\n\n2\n00:00:02,500 --> 00:00:04,000\nB: General Kenobi.\n')
    expect(toVtt(short)).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:02.500\n<v A>Hello there.\n\n00:00:02.500 --> 00:00:04.000\n<v B>General Kenobi.\n')
    expect(toText({ text: 'x', segments: [...short, { id: 2, start: 4, end: 5, text: 'Again.', speaker: 'B' }] })).toBe('A: Hello there.\n\nB: General Kenobi. Again.\n')
    expect(toText({ text: 'Just text', segments: [] })).toBe('Just text\n')
    expect(speakersOf(segs)).toEqual(['A', 'B'])
  })

  it('splits long segments into readable cues (by words when timed)', () => {
    const long = 'word '.repeat(60).trim()
    const cues = segmentsToCues([{ id: 0, start: 0, end: 30, text: long }])
    expect(cues.length).toBeGreaterThan(3)
    expect(cues.every((c) => c.text.length <= 84)).toBe(true)
    expect(cues[cues.length - 1].end).toBeCloseTo(30, 0)
    const timed = segmentsToCues([{ id: 0, start: 0, end: 20, text: long, words: Array.from({ length: 60 }, (_, i) => ({ text: 'word', start: i / 3, end: i / 3 + 0.3 })) }])
    expect(timed.every((c) => c.end - c.start <= 7.5)).toBe(true)
  })

  it('reads SRT / VTT back (for burn-in and reuse)', () => {
    const srt = toSrt([{ id: 0, start: 1, end: 2, text: 'One' }, { id: 1, start: 3, end: 4, text: 'Two' }])
    expect(parseSubtitles(srt)).toEqual([{ start: 1, end: 2, text: 'One' }, { start: 3, end: 4, text: 'Two' }])
    expect(parseSubtitles('WEBVTT\n\n00:01.000 --> 00:02.000 align:start\n<v Ann>Hi <b>there</b>\n')).toEqual([{ start: 1, end: 2, text: 'Ann: Hi there' }])
    expect(cuesToSrt([{ start: 1, end: 2, text: 'x' }])).toBe('1\n00:00:01,000 --> 00:00:02,000\nx\n')
    expect(transcriptSegmentsFrom({ text: 'x', segments: [{ start: 1, end: 2, text: 'a' }] })).toEqual([{ id: 0, start: 1, end: 2, text: 'a' }])
    expect(transcriptSegmentsFrom(srt)?.length).toBe(2)
    expect(transcriptSegmentsFrom('just words')).toBeNull()
    expect(transcriptSegmentsFrom(null)).toBeNull()
  })

  it('plans overlapping chunks and stitches chunk transcripts', () => {
    expect(planChunks(100, 600)).toEqual([{ index: 0, start: 0, duration: 100 }])
    const chunks = planChunks(1500, 600, 2)
    expect(chunks).toEqual([{ index: 0, start: 0, duration: 600 }, { index: 1, start: 598, duration: 600 }, { index: 2, start: 1196, duration: 304 }])
    expect(secondsForBytes(25 * 1024 * 1024)).toBe(5898)
    const part = (texts: Array<[number, number, string]>, minutes: number): TranscriptResult => ({ text: texts.map((t) => t[2]).join(' '), segments: texts.map(([s, e, t], i) => ({ id: i, start: s, end: e, text: t })), provider: 'openai', model: 'whisper-1', language: 'en', usage: { unit: 'minute', quantity: minutes, operation: 'transcribe' } })
    const merged = mergeChunkTranscripts([
      { chunk: chunks[1], result: part([[0.5, 1.9, 'overlap word'], [3, 10, 'second part']], 10) },
      { chunk: chunks[0], result: part([[0, 5, 'first'], [590, 599.5, 'boundary sentence']], 10) },
      { chunk: chunks[2], result: part([[1, 4, 'third']], 5) },
    ])
    expect(merged.segments.map((s) => [s.start, s.text])).toEqual([[0, 'first'], [590, 'boundary sentence'], [601, 'second part'], [1197, 'third']])
    expect(merged.segments.map((s) => s.id)).toEqual([0, 1, 2, 3])
    expect(merged.text).toBe('first boundary sentence second part third')
    expect(merged.usage).toEqual({ unit: 'minute', quantity: 25, operation: 'transcribe' })
    expect(merged.language).toBe('en')
  })

  it('previews are short and collapsed', () => {
    expect(preview('a\n\n b', 10)).toBe('a b')
    expect(preview('x'.repeat(300)).length).toBe(201)
  })
})

describe('video tracking', () => {
  it('joins a face over consecutive samples into one region spanning ±interval', () => {
    const det = [0, 1, 2, 3].map((t) => ({ time: t, type: 'face', box: { x: 0.4 + t * 0.01, y: 0.3, width: 0.2, height: 0.3 } }))
    const tracks = trackDetections(det, { interval: 1, duration: 10, padding: 0 })
    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toMatchObject({ start: 0, end: 4, samples: 4 })
    expect(tracks[0].base).toBeCloseTo(0.06)
    expect(tracks[0].box.x).toBeCloseTo(0.4)
    expect(tracks[0].box.x + tracks[0].box.width).toBeCloseTo(0.63)
  })

  it('splits a face that moves far, and keeps different types / gaps apart', () => {
    const moving = [0, 1, 2].map((t) => ({ time: t, type: 'face', box: { x: 0.05 + t * 0.15, y: 0.3, width: 0.2, height: 0.3 } }))
    expect(trackDetections(moving, { interval: 1, duration: 10, padding: 0 }).length).toBeGreaterThan(1)
    const gap = [{ time: 0, type: 'face', box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }, { time: 6, type: 'face', box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }]
    expect(trackDetections(gap, { interval: 1, duration: 10 })).toHaveLength(2)
    const mixed = [{ time: 0, type: 'face', box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }, { time: 0, type: 'plate', box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }]
    expect(trackDetections(mixed, { interval: 1, duration: 10 })).toHaveLength(2)
  })

  it('regions are pixels in the frame; end is capped at the duration', () => {
    const t = trackDetections([{ time: 9.5, type: 'face', box: { x: 0.5, y: 0.5, width: 0.25, height: 0.25 } }], { interval: 1, duration: 10, padding: 0 })
    expect(tracksToRegions(t, { width: 640, height: 360 })).toEqual([{ left: 320, top: 180, width: 160, height: 90, start: 8.5, end: 10 }])
  })

  it('sample times respect the frame cap', () => {
    expect(sampleTimes(10, 1, 100).times).toHaveLength(10)
    const capped = sampleTimes(3600, 1, 600)
    expect(capped.times).toHaveLength(600)
    expect(capped.interval).toBe(6)
  })
})
