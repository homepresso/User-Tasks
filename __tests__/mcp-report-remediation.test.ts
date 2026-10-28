import { describe, expect, it } from 'vitest'

import { inspectReportConfigIssues, remediateReportConfig } from '@/lib/mcp/tools/reports'

describe('MCP report remediation', () => {
  it('remediates report configs with legacy aggregate aliases and invalid columns', () => {
    const rawConfig = {
      source: 'workflow_runs',
      columns: ['workflow_runs._count', 'not_a_real_column'],
      filters: [{ field: 'workflow_runs._count', operator: 'gte', value: 2 }],
      sort: { field: 'not_a_real_column', direction: 'desc' },
      groupBy: ['status'],
      aggregations: [{ fn: 'COUNT', field: 'id' }],
    }

    const before = inspectReportConfigIssues(rawConfig)
    expect(before.issues.length).toBeGreaterThan(0)

    const remediation = remediateReportConfig(rawConfig)
    const after = inspectReportConfigIssues(remediation.config)

    expect(remediation.fixes.length).toBeGreaterThan(0)
    expect(remediation.config.data_source).toBe('workflow_runs')
    expect(remediation.config.columns).toEqual(['COUNT_id'])
    expect(remediation.config.filters?.[0]?.field).toBe('COUNT_id')
    expect(remediation.config.sort?.field).not.toBe('not_a_real_column')
    expect(remediation.config.visualization).toBe('table')
    expect(after.issues).toEqual([])
  })
})
