import { readFileSync } from 'fs'
import path from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DndContext } from '@dnd-kit/core'
import { describe, expect, it } from 'vitest'
import { createDefaultNode, NODE_CATALOG, type WorkflowNode } from '@/lib/workflow-schema'
import { CanvasNode } from '@/components/automations/canvas-node'
import { nodeCardModel, WorkflowNodeCard } from '@/components/automations/workflow-node-card'
import { WorkflowLookupsContext } from '@/components/automations/workflow-lookups'
import { computeRunOverlay, executedNodeIds, RUN_STATUS_TOKENS, type NodeRunOverlay } from '@/lib/workflow-run-overlay'

const noop = () => {}
const lookups = { tableNames: { t1: 'Vendors' } }

function designerMarkup(node: WorkflowNode) {
  return renderToStaticMarkup(createElement(WorkflowLookupsContext.Provider, { value: lookups },
    createElement(DndContext, null, createElement(CanvasNode, {
      node, isSelected: false, isConnecting: false, connectingSource: null,
      onSelect: noop, onDelete: noop, onStartConnect: noop, onFinishConnect: noop,
    }))))
}

function viewerMarkup(node: WorkflowNode, run?: NodeRunOverlay) {
  return renderToStaticMarkup(createElement(WorkflowLookupsContext.Provider, { value: lookups },
    createElement(WorkflowNodeCard, { node, run })))
}

/** What a person reads on the card + its icon / colour / ports, without runtime overlay or interactive chrome. */
function cardContent(html: string) {
  const strip = html
    .replace(/<span data-run-badge[\s\S]*?<\/span><\/span>|<span data-run-badge[\s\S]*?<\/span>(?=<div)/g, '')
    .replace(/<button[^>]*>[\s\S]*?<\/button>/g, (b) => (b.includes('DELETE?') || /<svg[^>]*lucide-x\b/.test(b) ? '' : b))
  const text = strip.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const attr = (name: string) => [...strip.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((m) => m[1])
  return {
    text,
    icon: attr('data-card-icon'),
    chips: attr('data-branch-chip'),
    header: (strip.match(/linear-gradient\(135deg, ([^,]+),/) ?? [])[1],
    width: strip.includes('w-56') ? 'w-56' : strip.includes('w-40') ? 'w-40' : '?',
  }
}

function sampleNode(type: string, i: number): WorkflowNode {
  const n = createDefaultNode(type as never, 100 + i, 200)
  n.id = `n-${type}`
  n.label = `Step ${type}`
  if (type === 'update_data_table' || type === 'data_table_event') n.config = { ...n.config, table_id: 't1', operation: 'list' }
  return n
}

describe('designer and viewers draw the same card', () => {
  const types = NODE_CATALOG.map((c) => c.type).filter((t) => t !== 'section_group')

  it.each(types.map((t, i) => [t, i] as const))('%s', (type, i) => {
    const node = sampleNode(type, i)
    const designer = cardContent(designerMarkup(node))
    const viewer = cardContent(viewerMarkup(node))
    expect(viewer).toEqual(designer)
    const model = nodeCardModel(node, lookups)
    expect(designer.text).toContain(model.label)
    expect(designer.chips).toEqual(model.branchLabels)
    if (model.summary) expect(designer.text).toContain(model.summary.slice(0, 12))
  })

  it('collapsed cards match too', () => {
    const node = { ...sampleNode('log', 0), collapsed: true }
    expect(cardContent(viewerMarkup(node))).toEqual(cardContent(designerMarkup(node)))
  })

  it('the runtime overlay adds status only — the card content is unchanged', () => {
    const node = sampleNode('condition', 0)
    const plain = cardContent(viewerMarkup(node))
    const run = viewerMarkup(node, { status: 'failed', durationMs: 42, error: 'boom' })
    expect(run).toContain('data-run-status="failed"')
    expect(run).toContain('Failed')
    expect(run).toContain('42ms')
    expect(cardContent(run)).toEqual(plain)
  })

  it('data table cards show the table name in both', () => {
    const node = sampleNode('update_data_table', 0)
    expect(designerMarkup(node)).toContain('Vendors')
    expect(viewerMarkup(node)).toContain('Vendors')
  })

  it('viewers use the shared card, sections, bands and edge renderer (no private copies)', () => {
    const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8')
    const runtime = read('components/automations/runtime-canvas.tsx')
    for (const part of ['<WorkflowNodeCard', '<SectionFrame', '<CanvasBands', '<EdgeRenderer', 'readOnly']) expect(runtime).toContain(part)
    for (const f of ['components/automations/process-viewer.tsx', 'components/automations/test-runner.tsx']) {
      const src = read(f)
      expect(src).toContain('<RuntimeCanvas')
      expect(src).not.toContain('routeEdges(')
      expect(src).not.toMatch(/className=\{`absolute rounded-2xl border-2/)
    }
    expect(read('components/automations/canvas-node.tsx')).toContain('<WorkflowNodeCard')
  })
})

describe('run overlay', () => {
  const nodes = [
    { id: 'a', type: 'webhook_received' }, { id: 'b', type: 'condition' }, { id: 'c', type: 'log' },
    { id: 'd', type: 'log' }, { id: 'e', type: 'user_task' }, { id: 's', type: 'section_group' }, { id: 'f', type: 'log', sectionId: 's' },
  ]
  const edges = [
    { id: 'ab', source: 'a', target: 'b' }, { id: 'bc', source: 'b', target: 'c' }, { id: 'bd', source: 'b', target: 'd' },
    { id: 'ce', source: 'c', target: 'e' }, { id: 'ef', source: 'e', target: 'f' },
  ]

  it('statuses: completed, failed, waiting, running, not run; stale results ignored', () => {
    const o = computeRunOverlay({
      nodes, edges,
      nodeResults: {
        a: { status: 'success', duration_ms: 3 },
        b: { status: 'success', output: { matched_branch: 'True', matched_branches: ['True'] } },
        c: { status: 'error', error: 'boom' },
        f: { status: 'success' }, // not reachable: e has no result
      },
    })
    expect(o.nodes.a).toMatchObject({ status: 'completed', durationMs: 3 })
    expect(o.nodes.b.takenBranches).toEqual(['True'])
    expect(o.nodes.c).toMatchObject({ status: 'failed', error: 'boom' })
    expect(o.nodes.d.status).toBe('not_run')
    expect(o.nodes.e.status).toBe('not_run')
    expect(o.nodes.f.status).toBe('not_run')
    expect(o.nodes.s).toBeUndefined()
    expect(o.edges).toEqual({ ab: 'success', bc: 'danger' })
  })

  it('waiting and running steps are current; edges into them are warnings', () => {
    const waiting = computeRunOverlay({ nodes, edges, nodeResults: { a: { status: 'success' }, b: { status: 'success' }, c: { status: 'success' } }, pausedNodeId: 'e', runWaiting: true })
    expect(waiting.nodes.e).toMatchObject({ status: 'waiting', current: true })
    expect(waiting.edges.ce).toBe('warning')
    const running = computeRunOverlay({ nodes, edges, nodeResults: { a: { status: 'success' } }, activeNodeId: 'b' })
    expect(running.nodes.b).toMatchObject({ status: 'running', current: true })
  })

  it('section counts as traversed when a member ran; migration runs start at their entry', () => {
    const o = computeRunOverlay({ nodes, edges, nodeResults: { e: { status: 'success' }, f: { status: 'success' } }, entryNodeId: 'e' })
    expect(o.nodes.f.status).toBe('completed')
    expect(o.traversed.has('s')).toBe(true)
    expect(executedNodeIds({ nodes, edges, nodeResults: { e: { status: 'success' } } }).has('e')).toBe(false)
  })

  it('visits and skipped', () => {
    const o = computeRunOverlay({ nodes, edges, nodeResults: { a: { status: 'success' }, b: { status: 'skipped' } }, visits: { a: 3 } })
    expect(o.nodes.a.visits).toBe(3)
    expect(o.nodes.b.status).toBe('skipped')
  })

  it('status colours are theme tokens with their on-colour pair', () => {
    for (const t of Object.values(RUN_STATUS_TOKENS)) {
      expect(t.fill).toMatch(/^var\(--theme-/)
      expect(t.on).toMatch(/^var\(--theme-/)
    }
  })
})
