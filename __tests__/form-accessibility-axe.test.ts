import { describe, expect, it, vi } from 'vitest'

const run = vi.fn()
vi.mock('axe-core', () => ({ default: { run } }))

import { axeResultsToFindings, fieldKeyFromTarget, runAxeScan, type AxeResultsLike } from '@/lib/forms/accessibility/axe'
import { checkFormAccessibility, mergeFindings } from '@/lib/forms/accessibility'
import { normalizeFormDefinition } from '@/lib/forms/definition'

const RESULTS: AxeResultsLike = {
  violations: [
    {
      id: 'label', impact: 'critical', tags: ['cat.forms', 'wcag2a', 'wcag412', 'wcag131'], help: 'Form elements must have labels', description: 'd',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.11/label',
      nodes: [{ target: ['#preview-field_1'], failureSummary: 'Fix any of the following:\n  Form element does not have an implicit (wrapped) <label>' }],
    },
    {
      id: 'color-contrast', impact: 'serious', tags: ['wcag2aa', 'wcag143'], help: 'Elements must meet minimum color contrast ratio thresholds', description: 'd',
      nodes: [{ target: ['#preview-first_name-label'] }, { target: ['.banner > p'] }],
    },
    { id: 'region', impact: 'moderate', tags: ['best-practice'], help: 'All page content should be contained by landmarks', description: 'd', nodes: [{ target: ['div'] }] },
  ],
}

describe('axe → findings', () => {
  it('maps violations onto checker rules, WCAG criteria, severities and fields; best practices are left out', () => {
    const findings = axeResultsToFindings(RESULTS, { mode: 'dark', idPrefix: 'preview-', fieldKeys: ['field_1', 'first_name', 'first'] })
    expect(findings.map((f) => [f.rule, f.severity, f.field_key, f.wcag])).toEqual([
      ['label-missing', 'critical', 'field_1', ['4.1.2', '1.3.1']],
      ['contrast-text', 'serious', 'first_name', ['1.4.3']],
      ['contrast-text', 'serious', undefined, ['1.4.3']],
    ])
    expect(findings[0]).toMatchObject({ source: 'axe', mode: 'dark', level: 'A', targets: ['#preview-field_1'], id: 'axe:label:#preview-field_1' })
    expect(findings[0].help).toContain('dequeuniversity')
    expect(findings[2].message).toContain('.banner > p')
  })

  it('fieldKeyFromTarget picks the longest matching key', () => {
    expect(fieldKeyFromTarget('#preview-first_name-label', 'preview-', ['first', 'first_name'])).toBe('first_name')
    expect(fieldKeyFromTarget('#other-x', 'preview-', ['x'])).toBeUndefined()
  })

  it('runAxeScan loads axe-core on demand, scopes to the element and runs the WCAG A/AA tags', async () => {
    run.mockResolvedValueOnce(RESULTS)
    const element = { nodeType: 1 } as unknown as Element
    const findings = await runAxeScan(element, { mode: 'light', fieldKeys: ['field_1'] })
    expect(run).toHaveBeenCalledWith(element, expect.objectContaining({ runOnly: { type: 'tag', values: expect.arrayContaining(['wcag2a', 'wcag2aa', 'wcag22aa']) } }))
    expect(findings).toHaveLength(3)
  })

  it('merging with the checker dedupes the same problem on the same field and across light / dark', () => {
    const def = normalizeFormDefinition({ fields: [{ key: 'field_1', label: '', type: 'text' }], header: { enabled: true, image: 'none', title: 'T' } })
    const base = checkFormAccessibility(def)
    expect(base.findings.some((f) => f.rule === 'label-missing' && f.field_key === 'field_1')).toBe(true)
    const light = axeResultsToFindings(RESULTS, { mode: 'light', fieldKeys: ['field_1', 'first_name'] })
    const dark = axeResultsToFindings(RESULTS, { mode: 'dark', fieldKeys: ['field_1', 'first_name'] })
    const merged = mergeFindings(base, [...light, ...dark])
    const axe = merged.findings.filter((f) => f.source === 'axe')
    // label (already reported by the checker) dropped; the two contrast nodes kept once each.
    expect(axe.map((f) => f.id).sort()).toEqual(['axe:color-contrast:#preview-first_name-label', 'axe:color-contrast:.banner > p'].sort())
    expect(merged.score).toBeLessThan(base.score)
  })
})
