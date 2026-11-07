/**
 * Accessibility report files (the `form.accessibility_report` job): CSV
 * (one row per finding, spreadsheet-safe via lib/documents toCsv) and PDF
 * (the document model rendered with @cantoo/pdf-lib via renderPdf).
 */

import { toCsv } from '@/lib/documents/sheets'
import { renderPdf } from '@/lib/documents/pdf-tools'
import type { Block } from '@/lib/documents/model'
import type { AccessibilityResult } from './types'
import { WCAG_CRITERIA, wcagUrl } from './wcag'

export const REPORT_COLUMNS = ['severity', 'rule', 'wcag', 'level', 'field', 'mode', 'message', 'how_to_fix', 'fix_available', 'source', 'reference'] as const

export function accessibilityReportCsv(result: AccessibilityResult): string {
  const rows: Array<Array<string | number | null>> = [[...REPORT_COLUMNS]]
  for (const f of result.findings) {
    rows.push([
      f.severity, f.rule, f.wcag.join(' '), f.level, f.field_key ?? '', f.mode ?? '', f.message, f.help,
      f.fix ? f.fix.label : '', f.source ?? 'checker', f.wcag.map((sc) => wcagUrl(sc)).filter(Boolean).join(' '),
    ])
  }
  return `${toCsv(rows)}\r\n`
}

export function reportFileName(name: string, format: 'csv' | 'pdf'): string {
  const base = name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'form'
  return `${base}-accessibility.${format}`
}

export async function accessibilityReportPdf(result: AccessibilityResult, meta: { name: string; generatedAt?: Date }): Promise<Uint8Array> {
  const s = result.summary
  const blocks: Block[] = [
    { type: 'heading', level: 1, inlines: [{ text: `Accessibility report: ${meta.name}` }] },
    { type: 'paragraph', inlines: [{ text: `WCAG 2.2 AA check · generated ${(meta.generatedAt ?? new Date()).toISOString().slice(0, 16).replace('T', ' ')} UTC` }] },
    { type: 'heading', level: 2, inlines: [{ text: `Score ${result.score} / 100` }] },
    { type: 'table', header: true, rows: [['Critical', 'Serious', 'Moderate', 'Minor', 'Review'], [s.critical, s.serious, s.moderate, s.minor, s.review].map(String)] },
  ]
  if (!result.findings.length) blocks.push({ type: 'paragraph', inlines: [{ text: 'No findings.' }] })
  for (const severity of ['critical', 'serious', 'moderate', 'minor', 'review'] as const) {
    const list = result.findings.filter((f) => f.severity === severity)
    if (!list.length) continue
    blocks.push({ type: 'heading', level: 2, inlines: [{ text: `${severity[0].toUpperCase()}${severity.slice(1)} (${list.length})` }] })
    for (const f of list) {
      const criteria = f.wcag.map((sc) => `${sc} ${WCAG_CRITERIA[sc]?.title ?? ''}`.trim()).join(', ')
      blocks.push({ type: 'list_item', ordered: false, level: 0, inlines: [{ text: f.message, bold: true }] })
      blocks.push({ type: 'list_item', ordered: false, level: 1, inlines: [{ text: `WCAG ${criteria} (level ${f.level})${f.field_key ? ` · field ${f.field_key}` : ''}${f.mode ? ` · ${f.mode} mode` : ''}${f.source === 'axe' ? ' · axe scan' : ''}` }] })
      blocks.push({ type: 'list_item', ordered: false, level: 1, inlines: [{ text: f.help }] })
    }
  }
  if (result.passed.length) {
    blocks.push({ type: 'heading', level: 2, inlines: [{ text: `Passed (${result.passed.length})` }] })
    for (const r of result.passed) blocks.push({ type: 'list_item', ordered: false, level: 0, inlines: [{ text: `${r.title} — WCAG ${r.wcag.join(', ')}` }] })
  }
  const { bytes } = await renderPdf(blocks, { title: `Accessibility report: ${meta.name}` })
  return bytes
}
