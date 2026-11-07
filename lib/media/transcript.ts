/**
 * Transcripts (pure, client-safe): subtitle files (SRT, WebVTT, plain text,
 * JSON), reading SRT / VTT back, splitting long media into chunks and
 * stitching chunk transcripts together, speaker list, log previews.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */

import type { TranscriptResult, TranscriptSegment, TranscriptWord } from './types'

/* ── Time stamps ───────────────────────────────────────────────────── */

function stamp(seconds: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const rest = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(rest).padStart(3, '0')}`
}

export const srtTime = (s: number) => stamp(s, ',')
export const vttTime = (s: number) => stamp(s, '.')

/** "00:01:02,500" / "01:02.5" / "1:02:03.250" → seconds, or null. */
export function parseStamp(value: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(value.trim())
  if (!m) return null
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number(m[4].padEnd(3, '0')) / 1000 : 0)
}

/* ── Cues for subtitle files ───────────────────────────────────────── */

export interface Cue { start: number; end: number; text: string; speaker?: string }

/** Long segments are split into readable cues (≤ maxChars, ≤ maxSeconds) using word timings when present. */
export function segmentsToCues(segments: TranscriptSegment[], options: { maxChars?: number; maxSeconds?: number } = {}): Cue[] {
  const maxChars = options.maxChars ?? 84
  const maxSeconds = options.maxSeconds ?? 7
  const cues: Cue[] = []
  for (const seg of segments) {
    const text = seg.text.trim()
    if (!text) continue
    if (text.length <= maxChars && seg.end - seg.start <= maxSeconds) {
      cues.push({ start: seg.start, end: Math.max(seg.end, seg.start + 0.2), text, ...(seg.speaker ? { speaker: seg.speaker } : {}) })
      continue
    }
    if (seg.words?.length) {
      let cur: TranscriptWord[] = []
      const flush = () => {
        if (!cur.length) return
        cues.push({ start: cur[0].start, end: Math.max(cur[cur.length - 1].end, cur[0].start + 0.2), text: cur.map((w) => w.text.trim()).join(' ').replace(/\s+([,.!?;:])/g, '$1'), ...(seg.speaker ? { speaker: seg.speaker } : {}) })
        cur = []
      }
      for (const w of seg.words) {
        const len = cur.map((x) => x.text).join(' ').length + w.text.length + 1
        if (cur.length && (len > maxChars || w.end - cur[0].start > maxSeconds)) flush()
        cur.push(w)
      }
      flush()
      continue
    }
    // No word timings: split the text evenly over the segment's time.
    const words = text.split(/\s+/)
    const pieces: string[] = []
    let line = ''
    for (const w of words) {
      if (line && (line.length + w.length + 1) > maxChars) { pieces.push(line); line = w } else line = line ? `${line} ${w}` : w
    }
    if (line) pieces.push(line)
    const total = pieces.reduce((n, p) => n + p.length, 0) || 1
    let at = seg.start
    for (const p of pieces) {
      const dur = (seg.end - seg.start) * (p.length / total)
      cues.push({ start: at, end: Math.max(at + dur, at + 0.2), text: p, ...(seg.speaker ? { speaker: seg.speaker } : {}) })
      at += dur
    }
  }
  return cues
}

const speakerPrefix = (c: Cue, withSpeakers: boolean) => (withSpeakers && c.speaker ? `${c.speaker}: ` : '')

export function toSrt(segments: TranscriptSegment[], options: { speakers?: boolean } = {}): string {
  return segmentsToCues(segments).map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${speakerPrefix(c, options.speakers ?? true)}${c.text}\n`).join('\n')
}

export function toVtt(segments: TranscriptSegment[], options: { speakers?: boolean } = {}): string {
  const body = segmentsToCues(segments).map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${options.speakers !== false && c.speaker ? `<v ${c.speaker.replace(/[<>&]/g, '')}>` : ''}${c.text.replace(/-->/g, '→')}\n`).join('\n')
  return `WEBVTT\n\n${body}`
}

/** Plain text: one paragraph per speaker turn ("A: …") or per segment. */
export function toText(result: Pick<TranscriptResult, 'text' | 'segments'>): string {
  const hasSpeakers = result.segments.some((s) => s.speaker)
  if (!hasSpeakers) return `${result.text.trim()}\n`
  const turns: Array<{ speaker: string; text: string }> = []
  for (const s of result.segments) {
    const last = turns[turns.length - 1]
    const speaker = s.speaker ?? '?'
    if (last && last.speaker === speaker) last.text += ` ${s.text.trim()}`
    else turns.push({ speaker, text: s.text.trim() })
  }
  return `${turns.map((t) => `${t.speaker}: ${t.text}`).join('\n\n')}\n`
}

/** SRT or WebVTT text → cues (for burn-in and reuse). */
export function parseSubtitles(text: string): Cue[] {
  const cues: Cue[] = []
  const blocks = text.replace(/\r/g, '').replace(/^﻿/, '').split(/\n\s*\n/)
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    const at = lines.findIndex((l) => l.includes('-->'))
    if (at < 0) continue
    const [a, b] = lines[at].split('-->').map((x) => x.trim().split(/\s+/)[0])
    const start = parseStamp(a)
    const end = parseStamp(b)
    if (start === null || end === null) continue
    const body = lines.slice(at + 1).join('\n').replace(/<v\s+([^>]+)>/g, '$1: ').replace(/<[^>]+>/g, '')
    if (body.trim()) cues.push({ start, end, text: body.trim() })
  }
  return cues
}

/** Cues → SRT (for burn-in from any source). */
export function cuesToSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n')
}

/* ── Speakers ──────────────────────────────────────────────────────── */

export function speakersOf(segments: TranscriptSegment[]): string[] {
  const seen: string[] = []
  for (const s of segments) if (s.speaker && !seen.includes(s.speaker)) seen.push(s.speaker)
  return seen
}

/* ── Chunking ──────────────────────────────────────────────────────── */

export interface Chunk { index: number; start: number; duration: number }

/**
 * Pieces of at most `maxSeconds` (with `overlap` seconds shared between
 * neighbours so words at a boundary are not lost) covering `duration`.
 */
export function planChunks(duration: number, maxSeconds: number, overlap = 2): Chunk[] {
  if (!(duration > 0)) return [{ index: 0, start: 0, duration: maxSeconds }]
  if (duration <= maxSeconds) return [{ index: 0, start: 0, duration }]
  const step = Math.max(1, maxSeconds - overlap)
  const chunks: Chunk[] = []
  for (let start = 0, i = 0; start < duration; start += step, i++) {
    chunks.push({ index: i, start, duration: Math.min(maxSeconds, duration - start) })
    if (start + maxSeconds >= duration) break
  }
  return chunks
}

/** Seconds of 32 kbit/s mono MP3 that fit in `bytes` (with 10 % headroom). */
export function secondsForBytes(bytes: number, bitsPerSecond = 32_000): number {
  return Math.floor((bytes * 8 * 0.9) / bitsPerSecond)
}

/**
 * Chunk transcripts → one: times shifted by each chunk's start; in the
 * overlap, segments that start before the previous chunk's end are dropped
 * (the previous chunk heard them in full); segment ids renumbered.
 */
export function mergeChunkTranscripts(parts: Array<{ chunk: Chunk; result: TranscriptResult }>): TranscriptResult {
  const sorted = [...parts].sort((a, b) => a.chunk.start - b.chunk.start)
  const segments: TranscriptSegment[] = []
  const words: TranscriptWord[] = []
  let covered = 0
  let language: string | undefined
  for (const { chunk, result } of sorted) {
    language ??= result.language
    for (const seg of result.segments) {
      const start = seg.start + chunk.start
      const end = seg.end + chunk.start
      if (segments.length && start < covered - 0.25) continue
      segments.push({
        ...seg,
        id: segments.length,
        start,
        end,
        ...(seg.words ? { words: seg.words.map((w) => ({ ...w, start: w.start + chunk.start, end: w.end + chunk.start })) } : {}),
      })
    }
    for (const w of result.words ?? []) {
      const start = w.start + chunk.start
      if (words.length && start < (words[words.length - 1].end - 0.05)) continue
      words.push({ ...w, start, end: w.end + chunk.start })
    }
    covered = Math.max(covered, segments.length ? segments[segments.length - 1].end : covered)
  }
  const first = sorted[0]?.result
  const totalMinutes = sorted.reduce((n, p) => n + (p.result.usage?.unit === 'minute' ? p.result.usage.quantity : 0), 0)
  return {
    text: segments.length ? segments.map((s) => s.text.trim()).join(' ') : sorted.map((p) => p.result.text.trim()).join(' '),
    ...(language ? { language } : {}),
    duration: sorted.length ? Math.max(...sorted.map((p) => p.chunk.start + (p.result.duration ?? p.chunk.duration))) : undefined,
    segments,
    ...(words.length ? { words } : {}),
    speakers: speakersOf(segments),
    provider: first?.provider ?? 'openai',
    ...(first?.model ? { model: first.model } : {}),
    ...(first?.usage ? { usage: { ...first.usage, quantity: totalMinutes || first.usage.quantity } } : {}),
  }
}

/** A short, whitespace-collapsed preview for run logs. */
export function preview(text: string, n = 200): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

/** Accept a transcript object (from Transcribe), its segments, or SRT / VTT text → segments. */
export function transcriptSegmentsFrom(value: unknown): TranscriptSegment[] | null {
  if (!value) return null
  if (typeof value === 'string') {
    const t = value.trim()
    if (t.startsWith('{') || t.startsWith('[')) { try { return transcriptSegmentsFrom(JSON.parse(t)) } catch { /* text */ } }
    const cues = parseSubtitles(t)
    return cues.length ? cues.map((c, i) => ({ id: i, start: c.start, end: c.end, text: c.text })) : null
  }
  if (Array.isArray(value)) {
    const segs = value.filter((s) => s && typeof s === 'object' && Number.isFinite(Number((s as any).start)) && typeof (s as any).text === 'string')
    return segs.length ? segs.map((s: any, i) => ({ id: i, start: Number(s.start), end: Number(s.end ?? s.start), text: String(s.text), ...(s.speaker ? { speaker: String(s.speaker) } : {}), ...(Array.isArray(s.words) ? { words: s.words } : {}) })) : null
  }
  if (typeof value === 'object' && Array.isArray((value as any).segments)) return transcriptSegmentsFrom((value as any).segments)
  return null
}
