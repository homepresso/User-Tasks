/**
 * Data-picker output models of the document actions (client-safe: no
 * server imports). Kept next to the handlers so the picker shows exactly
 * what lib/documents/handlers sets.
 */

import type { SchemaField, SchemaNode } from '@/lib/response-schema'

const s = (description?: string): SchemaNode => ({ type: 'string', ...(description ? { description } : {}) })
const n = (description?: string): SchemaNode => ({ type: 'number', ...(description ? { description } : {}) })
const i = (description?: string): SchemaNode => ({ type: 'integer', ...(description ? { description } : {}) })
const b = (description?: string): SchemaNode => ({ type: 'boolean', ...(description ? { description } : {}) })
const f = (name: string, node: SchemaNode): SchemaField => ({ name, ...node })
const obj = (fields: SchemaField[], description?: string): SchemaNode => ({ type: 'object', fields, ...(description ? { description } : {}) })
const arr = (items: SchemaNode, description?: string): SchemaNode => ({ type: 'array', items, ...(description ? { description } : {}) })

/** A stored file (same fields as a form attachment). */
export const FILE_OBJECT_SCHEMA: SchemaNode = obj([
  f('name', s('File name')),
  f('url', s('Download URL')),
  f('size', i('Bytes')),
  f('mime_type', s('MIME type')),
  f('storage_ref', s('storage:// reference')),
  f('checksum_sha256', s('SHA-256 of the content')),
  f('id', s('File id')),
  f('uploaded_at', s('ISO 8601')),
], 'File')

const TABLE_SCHEMA = obj([f('header', arr(s())), f('rows', arr(arr(s()))), f('records', arr(obj([])))])

export const READ_RESULT_SCHEMA: SchemaNode = obj([
  f('text', s('Plain text')),
  f('markdown', s('Markdown')),
  f('html', s('Sanitised HTML')),
  f('rows', arr(obj([]), 'Rows of the first sheet / table')),
  f('metadata', obj([
    f('title', s()), f('author', s()), f('subject', s()), f('keywords', s()), f('created', s('ISO 8601')), f('modified', s('ISO 8601')),
    f('last_modified_by', s()), f('pages', i()), f('slides', i()), f('sheets', i()), f('format', s('docx, xlsx, pdf, …')), f('format_label', s()),
    f('words', i()), f('characters', i()), f('characters_no_spaces', i()), f('lines', i()), f('paragraphs', i()), f('sentences', i()), f('reading_time_minutes', i()),
  ])),
  f('structure', obj([
    f('headings', arr(obj([f('level', i()), f('text', s())]))),
    f('links', arr(obj([f('text', s()), f('href', s())]))),
    f('tables', arr(TABLE_SCHEMA)),
    f('sheets', arr(obj([f('name', s()), f('range', s()), f('row_count', i()), f('column_count', i()), f('headers', arr(s())), f('rows', arr(obj([]))), f('values', arr(arr({ type: 'any' })))]))),
    f('slides', arr(obj([f('number', i()), f('title', s()), f('text', s()), f('notes', s())]))),
    f('pages', arr(obj([f('number', i()), f('text', s()), f('characters', i()), f('has_text_layer', b()), f('ocr', obj([f('provider', s()), f('confidence', n())]))]))),
    f('comments', arr(obj([f('author', s()), f('date', s()), f('text', s())]))),
    f('tracked_changes', obj([f('insertions', i()), f('deletions', i()), f('items', arr(obj([f('type', s()), f('author', s()), f('date', s()), f('text', s())])))])),
    f('front_matter', obj([])),
    f('outline', arr(obj([f('title', s()), f('level', i()), f('page', i())]))),
    f('form_fields', arr(obj([f('name', s()), f('type', s()), f('value', { type: 'any' })]))),
    f('data', { type: 'any', description: 'Parsed JSON / YAML / XML' }),
  ])),
  f('truncated', b()),
  f('warnings', arr(s())),
], 'Document')

const DIFF_SCHEMA = obj([
  f('mode', s('lines, words, characters, sentences, sheet or json')),
  f('identical', b()),
  f('similarity', n('0–100')),
  f('stats', obj([f('added', i()), f('removed', i()), f('changed', i()), f('unchanged', i()), f('added_words', i()), f('removed_words', i()), f('cells_changed', i())])),
  f('changes', arr(obj([f('type', s()), f('old_text', s()), f('new_text', s()), f('path', s()), f('key', obj([])), f('columns', arr(obj([f('column', s()), f('old', { type: 'any' }), f('new', { type: 'any' })])))]))),
  f('unified', s('Unified diff')),
  f('html', s('HTML report')),
  f('redline_docx', FILE_OBJECT_SCHEMA),
  f('redline_pdf', FILE_OBJECT_SCHEMA),
  f('report', FILE_OBJECT_SCHEMA),
], 'Comparison')

export interface PickerRoot { path: string; label: string; schema: SchemaNode; description?: string }

/** The roots a document action sets (mirrors lib/documents/handlers). */
export function documentNodeRoots(type: string, config: Record<string, any>): PickerRoot[] {
  const ov = (fallback: string) => String(config.output_var ?? '').replace(/[^\w.]/g, '') || fallback
  switch (type) {
    case 'doc_read': {
      const v = ov('document')
      return [
        { path: v, label: v, schema: READ_RESULT_SCHEMA, description: 'Text, metadata and structure' },
        { path: `${v}_text`, label: `${v}_text`, schema: s('Plain text') },
        { path: `${v}_rows`, label: `${v}_rows`, schema: arr(obj([]), 'Rows (sheet / first table)'), description: 'Rows — loop over them' },
        { path: `${v}_count`, label: `${v}_count`, schema: i('Row count') },
      ]
    }
    case 'doc_compare': {
      const v = ov('comparison')
      return [
        { path: v, label: v, schema: DIFF_SCHEMA, description: 'Differences, stats and files' },
        { path: `${v}_identical`, label: `${v}_identical`, schema: b() },
        { path: `${v}_similarity`, label: `${v}_similarity`, schema: n('0–100') },
        { path: `${v}_html`, label: `${v}_html`, schema: s('HTML report — email body') },
        ...(config.redline === 'docx' || config.redline === 'both' ? [{ path: `${v}_redline_docx`, label: `${v}_redline_docx`, schema: FILE_OBJECT_SCHEMA }] : []),
        ...(config.redline === 'pdf' || config.redline === 'both' ? [{ path: `${v}_redline_pdf`, label: `${v}_redline_pdf`, schema: FILE_OBJECT_SCHEMA }] : []),
        ...(config.report === 'html' || config.report === 'pdf' ? [{ path: `${v}_report`, label: `${v}_report`, schema: FILE_OBJECT_SCHEMA }] : []),
      ]
    }
    case 'doc_convert': {
      const v = ov('converted_file')
      return [{ path: v, label: v, schema: FILE_OBJECT_SCHEMA, description: 'Converted file' }]
    }
    case 'doc_pdf': {
      const op = config.operation ?? 'merge'
      if (op === 'page_count') { const v = ov('page_count'); return [{ path: v, label: v, schema: i('Pages') }] }
      if (op === 'read_form') {
        const v = ov('form')
        return [
          { path: v, label: v, schema: obj([f('fields', arr(obj([f('name', s()), f('type', s()), f('value', { type: 'any' }), f('options', arr(s()))]))), f('values', obj([]))]) },
          { path: `${v}_values`, label: `${v}_values`, schema: obj([], 'Field name → value') },
        ]
      }
      if (op === 'split') { const v = ov('pdf_files'); return [{ path: v, label: v, schema: arr(FILE_OBJECT_SCHEMA, 'PDF parts') }, { path: `${v}_count`, label: `${v}_count`, schema: i() }] }
      const v = ov('pdf_file')
      return [{ path: v, label: v, schema: FILE_OBJECT_SCHEMA, description: 'New PDF' }]
    }
    case 'doc_extract': {
      const v = ov('extracted')
      const values = (Array.isArray(config.patterns) ? config.patterns : []).map((p: any) => String(p?.name ?? '').trim()).filter(Boolean)
      return [
        {
          path: v, label: v, schema: obj([
            f('rows', arr(obj([]))), f('tables', arr(TABLE_SCHEMA)), f('values', obj(values.map((name: string) => f(name, s())))),
            f('found', obj([f('emails', arr(s())), f('urls', arr(s())), f('phones', arr(s())), f('dates', arr(obj([f('text', s()), f('date', s('YYYY-MM-DD'))]))), f('amounts', arr(obj([f('text', s()), f('value', n()), f('currency', s())]))), f('percentages', arr(obj([f('text', s()), f('value', n())])))])),
            f('table_rows_inserted', i()),
          ]),
        },
        { path: `${v}_rows`, label: `${v}_rows`, schema: arr(obj([])), description: 'Rows — loop over them' },
        { path: `${v}_count`, label: `${v}_count`, schema: i() },
        ...values.map((name: string) => ({ path: `${v}_${name}`, label: `${v}_${name}`, schema: s(`Pattern "${name}"`) })),
      ]
    }
    case 'doc_redact': {
      const v = ov('redacted')
      return [
        { path: v, label: v, schema: obj([f('file', FILE_OBJECT_SCHEMA), f('text', s()), f('counts', obj([])), f('total', i())]) },
        { path: `${v}_file`, label: `${v}_file`, schema: FILE_OBJECT_SCHEMA, description: 'Redacted copy' },
        { path: `${v}_text`, label: `${v}_text`, schema: s() },
        { path: `${v}_count`, label: `${v}_count`, schema: i('Redactions') },
      ]
    }
    case 'doc_inspect': {
      const v = ov('inspection')
      return [
        {
          path: v, label: v, schema: obj([
            f('type', obj([f('format', s()), f('mime_type', s()), f('extension', s()), f('label', s()), f('extension_mismatch', b())])),
            f('checksums', obj([f('sha256', s()), f('sha1', s()), f('md5', s())])),
            f('stats', obj([f('words', i()), f('characters', i()), f('reading_time_minutes', i()), f('pages', i())])),
            f('search', obj([f('count', i()), f('matches', arr(obj([f('text', s()), f('line', i()), f('page', i()), f('context', s())])))])),
          ]),
        },
        ...(config.operation === 'search' || config.query ? [{ path: `${v}_matches`, label: `${v}_matches`, schema: arr(obj([f('text', s()), f('line', i()), f('context', s())])) }, { path: `${v}_match_count`, label: `${v}_match_count`, schema: i() }] : []),
      ]
    }
  }
  return []
}
