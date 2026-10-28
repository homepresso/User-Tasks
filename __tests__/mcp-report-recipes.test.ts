import { describe, expect, it } from 'vitest'

import { REPORT_SOURCES } from '@/lib/report-sources'
import { buildSourceSpecificRecipes } from '@/lib/mcp/tools/reports'

describe('MCP report source recipes', () => {
  it('provides canonical grouped workflow run recipes', () => {
    const source = REPORT_SOURCES.find((candidate) => candidate.key === 'workflow_runs')
    expect(source).toBeTruthy()

    const recipes = buildSourceSpecificRecipes(source!)
    const grouped = recipes.find((recipe) => recipe.name === 'Runs by status')

    expect(grouped).toBeTruthy()
    expect(grouped?.config).toMatchObject({
      data_source: 'workflow_runs',
      columns: ['status', 'COUNT_id'],
      group_by: ['status'],
      aggregations: [{ field: 'id', fn: 'COUNT' }],
      visualization: 'bar',
      sort: { field: 'COUNT_id', direction: 'desc' },
    })
  })

  it('provides retention coverage recipes using the virtual assignment source', () => {
    const source = REPORT_SOURCES.find((candidate) => candidate.key === 'retention_policy_assignments')
    expect(source).toBeTruthy()

    const recipes = buildSourceSpecificRecipes(source!)
    const grouped = recipes.find((recipe) => recipe.name === 'Coverage by retention policy')

    expect(grouped).toBeTruthy()
    expect(grouped?.config).toMatchObject({
      data_source: 'retention_policy_assignments',
      columns: ['retention_policy_name', 'COUNT_id'],
      group_by: ['retention_policy_name'],
      aggregations: [{ field: 'id', fn: 'COUNT' }],
      visualization: 'bar',
      sort: { field: 'COUNT_id', direction: 'desc' },
    })
  })
})
