/** Render command results as a table, JSON or YAML. */

import YAML from 'yaml'
import type { OutputFormat } from './settings'

const MAX_COLUMNS = 6
const MAX_CELL = 60
/** Column order preference for list tables; remaining scalar keys fill up to MAX_COLUMNS. */
const PREFERRED_COLUMNS = [
  'id', 'name', 'title', 'label', 'email', 'status', 'state', 'type', 'kind', 'action',
  'is_active', 'active', 'priority', 'version', 'workflow_id', 'created_at', 'updated_at',
]

type Row = Record<string, unknown>

const isPlainObject = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isScalar = (value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value)

function truncate(text: string, max = MAX_CELL): string {
  const single = text.replace(/\s+/g, ' ')
  return single.length > max ? `${single.slice(0, max - 1)}…` : single
}

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return truncate(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value) && value.every(isScalar)) return truncate(value.map((v) => String(v ?? '')).join(', '))
  return truncate(JSON.stringify(value))
}

/** Choose list columns: preferred keys first, then other mostly-scalar keys. */
export function pickColumns(rows: Row[]): string[] {
  const sample = rows.slice(0, 50)
  const keys: string[] = []
  for (const row of sample) for (const key of Object.keys(row)) if (!keys.includes(key)) keys.push(key)
  const scalarish = (key: string) => sample.some((row) => row[key] !== undefined && row[key] !== null && isScalar(row[key]))

  const preferred = PREFERRED_COLUMNS.filter((key) => keys.includes(key) && scalarish(key))
  const rest = keys.filter((key) => !preferred.includes(key) && scalarish(key))
  const columns = [...preferred, ...rest].slice(0, MAX_COLUMNS)
  return columns.length ? columns : keys.slice(0, MAX_COLUMNS)
}

export function grid(header: string[], body: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)))
  const line = (cells: string[]) => cells.map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i]))).join('  ').trimEnd()
  return [line(header), ...body.map(line)].join('\n')
}

export function renderTable(value: unknown, listKey?: string): string {
  let rows: unknown = value
  if (listKey && isPlainObject(value) && Array.isArray(value[listKey])) rows = value[listKey]

  if (Array.isArray(rows)) {
    if (rows.length === 0) return 'No results.'
    if (!rows.every(isPlainObject)) return rows.map(formatCell).join('\n')
    const columns = pickColumns(rows)
    return grid(columns.map((c) => c.toUpperCase()), rows.map((row) => columns.map((c) => formatCell(row[c]))))
  }
  if (isPlainObject(rows)) {
    const entries = Object.entries(rows).filter(([, v]) => v !== undefined)
    if (!entries.length) return ''
    const width = Math.max(...entries.map(([k]) => k.length))
    return entries.map(([k, v]) => `${k.padEnd(width)}  ${formatCell(v)}`.trimEnd()).join('\n')
  }
  return formatCell(rows)
}

export function render(value: unknown, format: OutputFormat, options: { listKey?: string } = {}): string {
  if (format === 'json') return JSON.stringify(value ?? null, null, 2)
  if (format === 'yaml') return YAML.stringify(value ?? null).trimEnd()
  return renderTable(value, options.listKey)
}
