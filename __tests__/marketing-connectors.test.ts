import { describe, expect, it } from 'vitest'
import { CONNECTOR_CATALOG } from '@/lib/connectors/registry'
import { aiConnectors, CONNECTOR_COUNT, CONNECTOR_REFERENCE_COUNT, connectorGroups, WORKFLOW_NODE_COUNT } from '@/lib/marketing-connectors'
import { NODE_CATALOG } from '@/lib/workflow-schema'

describe('public connector catalogue (/connectors)', () => {
  it('lists every registry connector exactly once', () => {
    const listed = [...connectorGroups().flatMap((group) => group.connectors), ...aiConnectors()].map((connector) => connector.key)
    expect(new Set(listed).size).toBe(listed.length)
    expect(listed.sort()).toEqual(CONNECTOR_CATALOG.map((connector) => connector.key).sort())
    expect(CONNECTOR_COUNT).toBe(CONNECTOR_CATALOG.length)
  })

  it('keeps AI providers out of the other groups', () => {
    const ai = new Set(CONNECTOR_CATALOG.filter((connector) => connector.category === 'ai').map((connector) => connector.key))
    expect(aiConnectors().map((connector) => connector.key).sort()).toEqual([...ai].sort())
    for (const group of connectorGroups()) for (const connector of group.connectors) expect(ai.has(connector.key)).toBe(false)
  })

  it('derives the counts shown on the site from the code', () => {
    expect(CONNECTOR_REFERENCE_COUNT).toBe(CONNECTOR_CATALOG.reduce((sum, connector) => sum + connector.referenceTemplates.length, 0))
    expect(WORKFLOW_NODE_COUNT).toBe(NODE_CATALOG.filter((node) => node.category !== 'section').length)
  })
})
