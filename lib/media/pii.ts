/**
 * Sensitive information in pictures and speech, with the same detectors as
 * Redact Document (lib/documents/redact findHits: 50+ information types
 * with check digits and context, presets, terms, patterns):
 *
 *  - text found in an image (OCR lines with word boxes) → boxes to hide;
 *  - a transcript (segments with word timings) → time spans to bleep / mute.
 *
 * All the text is scanned at once (lines joined by newlines), so a label on
 * one line ("Passport No.") counts as context for the number below it. A
 * hit is mapped back to the words it covers; without word boxes / timings,
 * to the part of the line / segment its characters cover.
 */

import { findHits, maskValue, labelFor, type Hit, type RedactOptions } from '@/lib/documents/redact'
import { INFO_TYPE_BY_ID } from '@/lib/documents/pii/catalog'
import type { Box, OcrLine, TranscriptSegment } from './types'
import { unionBoxes } from './geometry'

export interface TextFinding {
  type: string
  label: string
  confidence: Hit['confidence']
  source: Hit['source']
  /** Masked unless includeValues. */
  text: string
}

export interface BoxFinding extends TextFinding { box: Box; line: number }
export interface SpanFinding extends TextFinding { start: number; end: number }

interface Piece { start: number; end: number; ref: number }

export function findingLabel(type: string): string {
  return INFO_TYPE_BY_ID[type]?.label ?? (type === 'term' ? 'Word or phrase' : type === 'pattern' ? 'Custom pattern' : labelFor(type))
}

function finding(hit: Hit, text: string, includeValues: boolean): TextFinding {
  const value = text.slice(hit.start, hit.end)
  return { type: hit.kind, label: findingLabel(hit.kind), confidence: hit.confidence, source: hit.source, text: includeValues ? value : maskValue(value) }
}

/** OCR lines → findings with boxes (one box per line a finding spans). */
export function findInOcr(lines: OcrLine[], options: RedactOptions, includeValues = false): BoxFinding[] {
  let text = ''
  const pieces: Piece[] = []
  const boxes: Array<{ box?: Box; line: number; text: string }> = []
  lines.forEach((line, li) => {
    if (li > 0) text += '\n'
    const words = line.words?.length ? line.words : [{ text: line.text, box: line.box }]
    words.forEach((w, wi) => {
      if (wi > 0) text += ' '
      const start = text.length
      text += w.text
      pieces.push({ start, end: text.length, ref: boxes.length })
      boxes.push({ box: w.box ?? line.box, line: li, text: w.text })
    })
  })
  if (!text.trim()) return []
  const hits = findHits(text, options)
  const out: BoxFinding[] = []
  for (const hit of hits) {
    // Per line: the union of the covered words' boxes (part of a word → proportional slice).
    const byLine = new Map<number, Box[]>()
    for (const p of pieces) {
      if (p.end <= hit.start || p.start >= hit.end) continue
      const ref = boxes[p.ref]
      if (!ref.box) continue
      const len = Math.max(1, p.end - p.start)
      const from = Math.max(0, hit.start - p.start) / len
      const to = Math.min(len, hit.end - p.start) / len
      const partial = from > 0 || to < 1
      const b = partial ? { x: ref.box.x + ref.box.width * from, y: ref.box.y, width: ref.box.width * (to - from), height: ref.box.height } : ref.box
      const list = byLine.get(ref.line) ?? []
      list.push(b)
      byLine.set(ref.line, list)
    }
    for (const [line, list] of byLine) {
      const box = unionBoxes(list)
      if (box) out.push({ ...finding(hit, text, includeValues), box, line })
    }
  }
  return out
}

/** Transcript → findings with time spans (seconds). */
export function findInTranscript(segments: TranscriptSegment[], options: RedactOptions, includeValues = false): SpanFinding[] {
  let text = ''
  const pieces: Piece[] = []
  const spans: Array<{ start: number; end: number }> = []
  segments.forEach((seg, si) => {
    if (si > 0) text += '\n'
    const words = seg.words?.length ? seg.words : null
    if (words) {
      words.forEach((w, wi) => {
        if (wi > 0) text += ' '
        const start = text.length
        text += w.text.trim()
        pieces.push({ start, end: text.length, ref: spans.length })
        spans.push({ start: w.start, end: w.end })
      })
    } else {
      const start = text.length
      text += seg.text.trim()
      pieces.push({ start, end: text.length, ref: spans.length })
      spans.push({ start: seg.start, end: seg.end })
    }
  })
  if (!text.trim()) return []
  const out: SpanFinding[] = []
  for (const hit of findHits(text, options)) {
    let start = Infinity
    let end = -Infinity
    for (const p of pieces) {
      if (p.end <= hit.start || p.start >= hit.end) continue
      const span = spans[p.ref]
      const len = Math.max(1, p.end - p.start)
      // Proportional estimate inside a long piece (a segment without word timings).
      const from = Math.max(0, hit.start - p.start) / len
      const to = Math.min(len, hit.end - p.start) / len
      start = Math.min(start, span.start + (span.end - span.start) * from)
      end = Math.max(end, span.start + (span.end - span.start) * to)
    }
    if (Number.isFinite(start) && end > start) out.push({ ...finding(hit, text, includeValues), start, end })
  }
  return out
}

/** Object labels that are license / number plates. */
export const PLATE_LABEL = /licen[cs]e[\s_-]*plate|number[\s_-]*plate|registration[\s_-]*plate|vehicle[\s_-]*registration/i
