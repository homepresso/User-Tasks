/**
 * Import report helpers (client-safe, pure): coverage from report items, the
 * complexity level and readiness, and a Markdown rendering. Used by core
 * importers and exported through the extension SDK so every importer scores
 * the same way.
 */

import type { ImportCoverage, ImportReport, ImportReportItem } from '@/lib/extensions/sdk'

/** Coverage of report items: info items do not count; partial counts half. */
export function importCoverage(items: Pick<ImportReportItem, 'status'>[]): ImportCoverage {
  const c = { total: 0, mapped: 0, partial: 0, placeholder: 0, skipped: 0 }
  for (const item of items) {
    if (item.status === 'info') continue
    c.total++
    c[item.status]++
  }
  const percent = c.total ? Math.round(((c.mapped + c.partial / 2) / c.total) * 100) : 100
  return { ...c, percent }
}

/** 0–33 low, 34–66 medium, 67+ high. */
export function importComplexityLevel(score: number): 'low' | 'medium' | 'high' {
  const s = Math.max(0, Math.min(100, Math.round(score)))
  return s <= 33 ? 'low' : s <= 66 ? 'medium' : 'high'
}

/**
 * auto: everything mapped and not complex; rebuild: under half mapped or very
 * complex; review otherwise.
 */
export function importReadiness(coverage: ImportCoverage, score: number): ImportReport['readiness'] {
  if (coverage.percent < 50 || score >= 85) return 'rebuild'
  if (coverage.placeholder === 0 && coverage.partial === 0 && coverage.skipped === 0 && score <= 33) return 'auto'
  return 'review'
}

const STATUS_LABEL: Record<ImportReportItem['status'], string> = {
  mapped: 'Mapped', partial: 'Review', placeholder: 'Placeholder', skipped: 'Skipped', info: 'Info',
}

function cell(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 400)
}

/** The report as Markdown (download, the Agent, MCP). */
export function importReportMarkdown(report: ImportReport): string {
  const c = report.coverage
  const lines = [
    `# Import report: ${report.title}`,
    '',
    `Source: ${report.source}${report.preview ? ' (preview importer: mapping not verified on real exports)' : ''}`,
    '',
    `- Coverage: ${c.percent}% (${c.mapped} mapped, ${c.partial} to review, ${c.placeholder} placeholders, ${c.skipped} skipped, of ${c.total})`,
    `- Complexity: ${report.complexity.score}/100 (${report.complexity.level})${report.complexity.factors.length ? ` — ${report.complexity.factors.join('; ')}` : ''}`,
    `- Readiness: ${report.readiness}`,
  ]
  if (report.summary) lines.push('', report.summary)
  if (report.outputs.length) {
    lines.push('', '## What the import makes', '')
    for (const o of report.outputs) lines.push(`- ${o.kind}: ${o.name}${o.detail ? ` — ${o.detail}` : ''}`)
  }
  if (report.warnings.length) {
    lines.push('', '## Warnings', '')
    for (const w of report.warnings) lines.push(`- ${w}`)
  }
  if (report.items.length) {
    lines.push('', '## Items', '', '| Status | Kind | Source | Becomes | Notes |', '|---|---|---|---|---|')
    for (const i of report.items) lines.push(`| ${STATUS_LABEL[i.status]} | ${cell(i.kind)} | ${cell(i.name)}${i.location ? ` (${cell(i.location)})` : ''} | ${cell(i.mappedTo ?? '')} | ${cell(i.detail ?? '')} |`)
  }
  return lines.join('\n') + '\n'
}
