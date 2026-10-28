import { describe, it, expect } from 'vitest'
import { NODE_CATALOG, createDefaultNode, type NodeType } from '@/lib/workflow-schema'

describe('NODE_CATALOG', () => {
  it('has entries for all categories', () => {
    const categories = new Set(NODE_CATALOG.map(n => n.category))
    expect(categories).toContain('trigger')
    expect(categories).toContain('logic')
    expect(categories).toContain('operation')
    expect(categories).toContain('collection')
    expect(categories).toContain('action')
  })

  it('has unique type values', () => {
    const types = NODE_CATALOG.map(n => n.type)
    expect(new Set(types).size).toBe(types.length)
  })

  it('has non-empty labels, icons, and descriptions for every entry', () => {
    for (const entry of NODE_CATALOG) {
      expect(entry.label, `${entry.type} missing label`).toBeTruthy()
      expect(entry.icon, `${entry.type} missing icon`).toBeTruthy()
      expect(entry.description, `${entry.type} missing description`).toBeTruthy()
    }
  })

  it('has valid hex color codes', () => {
    for (const entry of NODE_CATALOG) {
      expect(entry.color, `${entry.type} has invalid color`).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('contains all trigger types', () => {
    const triggerTypes = NODE_CATALOG.filter(n => n.category === 'trigger').map(n => n.type)
    expect(triggerTypes).toContain('task_created')
    expect(triggerTypes).toContain('webhook_received')
    expect(triggerTypes).toContain('schedule')
  })

  it('contains set_title operation', () => {
    const op = NODE_CATALOG.find(n => n.type === 'set_title')
    expect(op).toBeDefined()
    expect(op?.category).toBe('operation')
  })

  it('contains decision_table action', () => {
    const action = NODE_CATALOG.find(n => n.type === 'decision_table')
    expect(action).toBeDefined()
    expect(action?.category).toBe('action')
  })
})

describe('createDefaultNode', () => {
  it('creates a node with correct type', () => {
    const node = createDefaultNode('set_variable')
    expect(node.type).toBe('set_variable')
  })

  it('creates a node with label from catalog', () => {
    const node = createDefaultNode('condition')
    expect(node.label).toBe('Branch by Condition')
  })

  it('creates a node with default position', () => {
    const node = createDefaultNode('delay')
    expect(node.position).toEqual({ x: 250, y: 100 })
  })

  it('creates a node with custom position', () => {
    const node = createDefaultNode('delay', 500, 300)
    expect(node.position).toEqual({ x: 500, y: 300 })
  })

  it('creates a node with empty config', () => {
    const node = createDefaultNode('http_request')
    expect(node.config).toEqual({})
  })

  it('creates a node with a valid UUID id', () => {
    const node = createDefaultNode('log')
    expect(node.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('creates unique IDs for each call', () => {
    const a = createDefaultNode('log')
    const b = createDefaultNode('log')
    expect(a.id).not.toBe(b.id)
  })
})
