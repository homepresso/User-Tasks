/**
 * Data-picker output models of the media steps (client-safe: no server
 * imports). They mirror exactly what lib/media/handlers.ts sets, so the
 * picker, the variables panel and the docs agree with the engine.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */

import type { SchemaField, SchemaNode } from '@/lib/response-schema'
import { FILE_OBJECT_SCHEMA } from '@/lib/documents/schemas'

const s = (description?: string): SchemaNode => ({ type: 'string', ...(description ? { description } : {}) })
const n = (description?: string): SchemaNode => ({ type: 'number', ...(description ? { description } : {}) })
const i = (description?: string): SchemaNode => ({ type: 'integer', ...(description ? { description } : {}) })
const b = (description?: string): SchemaNode => ({ type: 'boolean', ...(description ? { description } : {}) })
const f = (name: string, node: SchemaNode): SchemaField => ({ name, ...node })
const obj = (fields: SchemaField[], description?: string): SchemaNode => ({ type: 'object', fields, ...(description ? { description } : {}) })
const arr = (items: SchemaNode, description?: string): SchemaNode => ({ type: 'array', items, ...(description ? { description } : {}) })

export { FILE_OBJECT_SCHEMA }

/** A stored media file (same fields as a form attachment) — frames / key frames add `time`. */
const TIMED_FILE_SCHEMA: SchemaNode = obj([...((FILE_OBJECT_SCHEMA as { fields: SchemaField[] }).fields), f('time', n('Seconds from the start'))], 'File')

export const BOX_SCHEMA: SchemaNode = obj([
  f('x', n('Left, fraction of the width (0–1)')), f('y', n('Top, fraction of the height (0–1)')),
  f('width', n('Fraction of the width')), f('height', n('Fraction of the height')),
], 'Box (fractions of the image)')

export const PIXEL_BOX_SCHEMA: SchemaNode = obj([f('left', i()), f('top', i()), f('width', i()), f('height', i())], 'Box in pixels')

export const COST_SCHEMA: SchemaNode = obj([
  f('status', s('priced or unknown')), f('amount', n()), f('currency', s('USD, …')), f('detail', s('Units × price')),
], 'Estimated provider cost (list price)')

const WORD_SCHEMA = obj([f('text', s()), f('start', n('Seconds')), f('end', n('Seconds')), f('confidence', n('0–1')), f('speaker', s())])
const SEGMENT_SCHEMA = obj([f('id', i()), f('start', n('Seconds')), f('end', n('Seconds')), f('text', s()), f('speaker', s('Speaker label (diarisation)')), f('confidence', n()), f('words', arr(WORD_SCHEMA))])

export const TRANSCRIPT_SCHEMA: SchemaNode = obj([
  f('text', s('Full transcript')),
  f('language', s('Detected or requested language')),
  f('duration', n('Seconds')),
  f('segments', arr(SEGMENT_SCHEMA, 'Timed segments')),
  f('words', arr(WORD_SCHEMA, 'Word timings (when requested)')),
  f('speakers', arr(s(), 'Speaker labels')),
  f('files', obj([f('srt', FILE_OBJECT_SCHEMA), f('vtt', FILE_OBJECT_SCHEMA), f('txt', FILE_OBJECT_SCHEMA), f('json', FILE_OBJECT_SCHEMA)], 'Transcript files')),
  f('provider', s()), f('model', s()), f('chunks', i('Pieces the media was split into')), f('cost', COST_SCHEMA),
], 'Transcript')

const LABEL_SCHEMA = obj([f('name', s()), f('confidence', n('0–1')), f('box', BOX_SCHEMA)])

export const IMAGE_ANALYSIS_SCHEMA: SchemaNode = obj([
  f('description', s('One-paragraph description')),
  f('labels', arr(LABEL_SCHEMA, 'Labels / tags')),
  f('objects', arr(LABEL_SCHEMA, 'Objects with boxes')),
  f('text', s('Text found (OCR), lines joined')),
  f('ocr', arr(obj([f('text', s()), f('confidence', n()), f('box', BOX_SCHEMA), f('box_px', PIXEL_BOX_SCHEMA)]), 'Text lines with boxes')),
  f('faces', arr(obj([f('box', BOX_SCHEMA), f('box_px', PIXEL_BOX_SCHEMA), f('confidence', n())]), 'Face boxes (no identification)')),
  f('face_count', i()),
  f('safety', obj([f('flagged', b('Any category flagged')), f('categories', arr(obj([f('category', s()), f('flagged', b()), f('score', n())])))])),
  f('answer', { type: 'any', description: 'Answer to the prompt (an object when fields are set)' }),
  f('width', i('Pixels')), f('height', i('Pixels')),
  f('provider', s()), f('model', s()), f('cost', COST_SCHEMA),
], 'Image analysis')

export const VIDEO_ANALYSIS_SCHEMA: SchemaNode = obj([
  f('summary', s()),
  f('scenes', arr(obj([f('start', n('Seconds')), f('end', n('Seconds')), f('title', s()), f('description', s())]), 'Scenes / chapters')),
  f('labels', arr(obj([f('name', s()), f('confidence', n()), f('times', arr(n()))]))),
  f('text', arr(obj([f('text', s()), f('start', n()), f('end', n())]), 'On-screen text')),
  f('keyframes', arr(TIMED_FILE_SCHEMA, 'Key frame images')),
  f('answer', { type: 'any', description: 'Answer to the prompt (an object when fields are set)' }),
  f('duration', n('Seconds')), f('frames_analysed', i()), f('method', s('native or frames')),
  f('provider', s()), f('model', s()), f('cost', COST_SCHEMA),
], 'Video analysis')

const FINDING_SCHEMA = obj([
  f('type', s('face, plate, custom, or an info type id (us_ssn, credit_card, …)')),
  f('label', s()), f('source', s('provider, ocr, custom')),
  f('text', s('Text found (masked •) for text findings')),
  f('confidence', s('low, medium, high (text) or 0–1 (boxes)')),
  f('box', BOX_SCHEMA), f('box_px', PIXEL_BOX_SCHEMA),
  f('start', n('Seconds (video)')), f('end', n('Seconds (video)')),
])

const REDACTION_SCHEMA = (video: boolean): SchemaNode => obj([
  f('mode', s('redact or detect_only')),
  f('file', FILE_OBJECT_SCHEMA),
  f('findings', arr(FINDING_SCHEMA)),
  f('counts', obj([], 'Type → count')),
  f('total', i()),
  ...(video
    ? [f('duration', n('Seconds')), f('frames_sampled', i()), f('audio_segments', arr(obj([f('start', n()), f('end', n()), f('type', s()), f('text', s('Masked'))]), 'Bleeped / muted audio'))]
    : [f('width', i()), f('height', i())]),
  f('provider', s()), f('cost', COST_SCHEMA),
])

export const MEDIA_INFO_SCHEMA: SchemaNode = obj([
  f('duration', n('Seconds')), f('size', i('Bytes')), f('format', s('Container (mp4, mov, mp3, …)')), f('bit_rate', i()),
  f('has_video', b()), f('has_audio', b()),
  f('video', obj([f('codec', s()), f('width', i()), f('height', i()), f('fps', n()), f('rotation', i())])),
  f('audio', obj([f('codec', s()), f('sample_rate', i()), f('channels', i())])),
], 'Media info')

export interface MediaPickerRoot { path: string; label: string; schema: SchemaNode; description?: string }

/** Output variable of a media step (config.output_var, sanitised) or its default. */
export function mediaOutputVar(type: string, config: Record<string, any>): string {
  const v = String(config.output_var ?? '').replace(/[^\w.]/g, '')
  if (v) return v
  switch (type) {
    case 'media_transcribe': return 'transcript'
    case 'media_analyze_image': return 'image_analysis'
    case 'media_analyze_video': return 'video_analysis'
    case 'media_redact_image': return config.mode === 'detect_only' ? 'image_findings' : 'redacted_image'
    case 'media_redact_video': return config.mode === 'detect_only' ? 'video_findings' : 'redacted_video'
    case 'media_generate_image': return 'generated_image'
    case 'media_tts': return 'speech'
    case 'media_tools': {
      const op = String(config.operation ?? 'info')
      return op === 'info' ? 'media_info' : op === 'frames' ? 'frames' : 'media_file'
    }
  }
  return 'media'
}

/** The roots a media step sets (mirrors lib/media/handlers). */
export function mediaNodeRoots(type: string, config: Record<string, any>): MediaPickerRoot[] {
  const v = mediaOutputVar(type, config)
  switch (type) {
    case 'media_transcribe': {
      const formats: string[] = Array.isArray(config.formats) ? config.formats : ['srt']
      return [
        { path: v, label: v, schema: TRANSCRIPT_SCHEMA, description: 'Text, timed segments, speakers and files' },
        { path: `${v}_text`, label: `${v}_text`, schema: s('Full transcript') },
        { path: `${v}_segments`, label: `${v}_segments`, schema: arr(SEGMENT_SCHEMA), description: 'Segments — loop over them' },
        { path: `${v}_files`, label: `${v}_files`, schema: arr(FILE_OBJECT_SCHEMA), description: 'Transcript files — attach to an email' },
        ...formats.filter((fmt) => ['srt', 'vtt', 'txt', 'json'].includes(fmt)).map((fmt) => ({ path: `${v}_${fmt}`, label: `${v}_${fmt}`, schema: FILE_OBJECT_SCHEMA, description: `${fmt.toUpperCase()} file` })),
      ]
    }
    case 'media_analyze_image':
      return [
        { path: v, label: v, schema: IMAGE_ANALYSIS_SCHEMA, description: 'Description, labels, text, faces, safety' },
        { path: `${v}_description`, label: `${v}_description`, schema: s() },
        { path: `${v}_text`, label: `${v}_text`, schema: s('Text found (OCR)') },
        { path: `${v}_labels`, label: `${v}_labels`, schema: arr(s(), 'Label names') },
        { path: `${v}_answer`, label: `${v}_answer`, schema: { type: 'any', description: 'Answer to the prompt' } },
      ]
    case 'media_analyze_video':
      return [
        { path: v, label: v, schema: VIDEO_ANALYSIS_SCHEMA, description: 'Summary, scenes, labels, on-screen text' },
        { path: `${v}_summary`, label: `${v}_summary`, schema: s() },
        { path: `${v}_scenes`, label: `${v}_scenes`, schema: arr(obj([f('start', n()), f('end', n()), f('title', s()), f('description', s())])), description: 'Scenes — loop over them' },
        { path: `${v}_keyframes`, label: `${v}_keyframes`, schema: arr(TIMED_FILE_SCHEMA), description: 'Key frame images' },
        { path: `${v}_answer`, label: `${v}_answer`, schema: { type: 'any', description: 'Answer to the prompt' } },
      ]
    case 'media_redact_image':
    case 'media_redact_video': {
      const video = type === 'media_redact_video'
      const detect = config.mode === 'detect_only'
      return [
        { path: v, label: v, schema: REDACTION_SCHEMA(video), description: detect ? 'Findings' : 'Redacted copy and findings' },
        ...(detect ? [] : [{ path: `${v}_file`, label: `${v}_file`, schema: FILE_OBJECT_SCHEMA, description: video ? 'Redacted video' : 'Redacted image' }]),
        { path: `${v}_findings`, label: `${v}_findings`, schema: arr(FINDING_SCHEMA), description: 'Findings — loop over them' },
        { path: `${v}_count`, label: `${v}_count`, schema: i(detect ? 'Findings' : 'Regions redacted') },
      ]
    }
    case 'media_generate_image':
      return [
        { path: v, label: v, schema: obj([f('file', FILE_OBJECT_SCHEMA), f('files', arr(FILE_OBJECT_SCHEMA)), f('revised_prompt', s()), f('provider', s()), f('model', s()), f('cost', COST_SCHEMA)]), description: 'Generated images' },
        { path: `${v}_file`, label: `${v}_file`, schema: FILE_OBJECT_SCHEMA, description: 'First image' },
        { path: `${v}_files`, label: `${v}_files`, schema: arr(FILE_OBJECT_SCHEMA), description: 'All images' },
      ]
    case 'media_tts':
      return [
        { path: v, label: v, schema: obj([f('file', FILE_OBJECT_SCHEMA), f('characters', i()), f('format', s()), f('voice', s()), f('provider', s()), f('model', s()), f('cost', COST_SCHEMA)]), description: 'Speech audio' },
        { path: `${v}_file`, label: `${v}_file`, schema: FILE_OBJECT_SCHEMA, description: 'Audio file' },
      ]
    case 'media_tools': {
      const op = String(config.operation ?? 'info')
      if (op === 'info') return [{ path: v, label: v, schema: MEDIA_INFO_SCHEMA, description: 'Duration, codecs, resolution' }]
      if (op === 'frames') return [
        { path: v, label: v, schema: arr(TIMED_FILE_SCHEMA), description: 'Frame images — loop over them' },
        { path: `${v}_count`, label: `${v}_count`, schema: i() },
      ]
      return [{ path: v, label: v, schema: FILE_OBJECT_SCHEMA, description: op === 'thumbnail' ? 'Thumbnail image' : op === 'extract_audio' ? 'Audio file' : 'New media file' }]
    }
  }
  return []
}
