import { describe, expect, it } from 'vitest'

import { buildWorkflowRecipes } from '@/lib/mcp/tools/workflows'

describe('MCP workflow recipes', () => {
  it('provides canonical workflow recipes for core automation patterns', () => {
    const workflowRecipes = buildWorkflowRecipes()

    expect(workflowRecipes.some((recipe) => recipe.name === 'Middleware Request Response')).toBe(true)

    const middleware = workflowRecipes.find((recipe) => recipe.name === 'Middleware Request Response')
    expect(middleware?.trigger_type).toBe('middleware_received')
    expect(middleware?.nodes.some((node) => node.type === 'end_workflow')).toBe(true)
  })
})
