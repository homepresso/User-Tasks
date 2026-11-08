import { describe, expect, it } from 'vitest'
import { TUTORIAL_PAGES } from '@/lib/docs/content/tutorials'
import { pageBlocks } from '@/lib/docs/render'
import { validateNode } from '@/lib/workflow-validation'
import { canonicalizeNodeConfigShapes } from '@/lib/portability/normalize'
import { NODE_CATALOG } from '@/lib/workflow-schema'
import type { WorkflowNode } from '@/lib/workflow-schema'

// Snippets titled "<Node> config" / "... step" hold a bare node config; the
// title says which node type it belongs to.
const CONFIG_TYPES: Record<string, string> = {
  'Set Variable config': 'set_variable',
  'User Task config': 'user_task',
  'Branch by Condition config': 'condition',
  'Parallel config': 'parallel',
  'Send Email config (Requester branch)': 'send_email',
  'Data step: insert': 'update_data_table',
  'Decision Table step': 'decision_table',
}

describe('tutorial JSON snippets', () => {
  const snippets = TUTORIAL_PAGES.flatMap((page) =>
    pageBlocks(page).flatMap((block) => (block.kind === 'code' && block.lang === 'json' ? [{ slug: page.slug, title: block.title ?? '', code: block.code }] : [])))

  it('exist and parse', () => {
    expect(snippets.length).toBeGreaterThanOrEqual(8)
    for (const s of snippets) expect(() => JSON.parse(s.code), `${s.slug}: ${s.title}`).not.toThrow()
  })

  it('are valid, canonical node configs', () => {
    for (const s of snippets) {
      const parsed = JSON.parse(s.code)
      const type = parsed.type ?? CONFIG_TYPES[s.title]
      expect(type, `${s.slug}: ${s.title} has no node type`).toBeDefined()
      expect(NODE_CATALOG.some((n) => n.type === type), type).toBe(true)
      const node = (parsed.type ? parsed : { id: 'n', type, label: 'Step', position: { x: 0, y: 0 }, config: parsed }) as WorkflowNode
      expect(validateNode(node), `${s.slug}: ${s.title}`).toEqual([])
      expect(canonicalizeNodeConfigShapes(type, node.config as Record<string, unknown>), `${s.slug}: ${s.title}`).toEqual(node.config)
    }
  })
})
