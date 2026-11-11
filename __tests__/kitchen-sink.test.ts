/**
 * The kitchen sink self-test (lib/kitchen-sink/build.ts):
 * - covers every step type of NODE_CATALOG, or excludes it with a reason —
 *   a new step type fails here until it is added to the kitchen sink or to
 *   KITCHEN_SINK_EXCLUDED;
 * - the shipped files are what the builder produces (npm run kitchen-sink:build);
 * - the bundle is an importable config manifest whose cross-references all
 *   point at bundled assets;
 * - both workflows pass the wiring check with no warnings.
 * The run itself is in __tests__/test-workflows-run.test.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- workflow and fake-database rows are free-form JSON */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { NODE_CATALOG } from '@/lib/workflow-schema'
import { validateWorkflowWiring, formatWiringWarning } from '@/lib/workflow-wiring'
import { validateWorkflow } from '@/lib/workflow-validation'
import { normalizeImportDocument } from '@/lib/portability/import-document'
import { canonicalizeNodeConfigShapes } from '@/lib/portability/normalize'
import { isUuid } from '@/lib/portability/plan'
import { parseActionManifest } from '@/lib/custom-actions/manifest'
import { buildKitchenSink, KITCHEN_SINK_EXCLUDED, KITCHEN_SINK_IDS, KITCHEN_SINK_NAME } from '@/lib/kitchen-sink/build'

const built = buildKitchenSink()
const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8')

describe('kitchen sink coverage', () => {
  const used = new Set(built.workflow.nodes.map((n) => n.type))

  it.each(NODE_CATALOG.map((n) => n.type))('%s is in the kitchen sink or excluded with a reason', (type) => {
    if (used.has(type)) {
      expect(KITCHEN_SINK_EXCLUDED[type], `${type} is used AND excluded`).toBeUndefined()
    } else {
      expect(KITCHEN_SINK_EXCLUDED[type], `${type} is neither in the kitchen sink nor in KITCHEN_SINK_EXCLUDED (lib/kitchen-sink/build.ts)`).toMatch(/\w{3,}/)
    }
  })

  it('excludes only catalog types', () => {
    const catalog = new Set<string>(NODE_CATALOG.map((n) => n.type))
    expect(Object.keys(KITCHEN_SINK_EXCLUDED).filter((t) => !catalog.has(t))).toEqual([])
  })

  it('has an assertion per group and unique check ids', () => {
    const ids = built.checks.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(built.checks.length).toBeGreaterThanOrEqual(70)
    // Every section with steps (other than setup and summary) asserts something.
    const groups = new Set(built.checks.map((c) => c.group))
    const sections = built.workflow.nodes.filter((n) => n.type === 'section_group').map((n) => n.label)
    expect(sections.filter((s) => !groups.has(s) && s !== 'Setup' && s !== 'Summary')).toEqual([])
  })
})

describe('kitchen sink files', () => {
  it('test-workflows/17-kitchen-sink.json is up to date (npm run kitchen-sink:build)', () => {
    expect(JSON.parse(read('test-workflows/17-kitchen-sink.json'))).toEqual(built.workflow)
  })

  it('examples/kitchen-sink/kitchen-sink.bundle.json is up to date (npm run kitchen-sink:build)', () => {
    expect(JSON.parse(read('examples/kitchen-sink/kitchen-sink.bundle.json'))).toEqual(built.bundle)
  })
})

describe('kitchen sink bundle', () => {
  const bundle = built.bundle

  it('is a config manifest the import accepts as is (ids kept, so references stay linked)', () => {
    const doc = normalizeImportDocument(structuredClone(bundle))
    expect(doc.kind).toBe('manifest')
    expect((doc as any).manifest).toEqual(bundle)
    for (const section of ['data_tables', 'decision_tables', 'forms', 'roles', 'workflow_activities', 'workflows']) {
      expect(bundle[section].length, section).toBeGreaterThan(0)
      for (const asset of bundle[section]) expect(isUuid(asset.id), `${section} ${asset.name}`).toBe(true)
    }
  })

  it('references only bundled assets', () => {
    const main = bundle.workflows.find((w: any) => w.id === KITCHEN_SINK_IDS.workflow)
    expect(main.name).toBe(KITCHEN_SINK_NAME)
    const refs = main.nodes.flatMap((n: any) => [n.config.table_id, n.config.decision_table_id, n.config.sub_workflow_id, n.config.form_id, n.config.role_id, n.config.custom_activity_id]).filter(Boolean)
    const ids = new Set(Object.values(KITCHEN_SINK_IDS))
    expect(refs.filter((id: string) => !ids.has(id as any))).toEqual([])
    expect(new Set(refs)).toEqual(new Set(Object.values(KITCHEN_SINK_IDS).filter((id) => id !== KITCHEN_SINK_IDS.workflow)))
    // Both workflows can be started (Run now needs is_active).
    expect(bundle.workflows.map((w: any) => w.is_active)).toEqual([true, true])
    // Sub-workflows are imported first.
    expect(bundle.workflows[0].id).toBe(KITCHEN_SINK_IDS.subWorkflow)
  })

  it('ships a valid custom action manifest', () => {
    const action = bundle.workflow_activities[0]
    const manifest = parseActionManifest(action.manifest)
    expect(manifest.key).toBe(action.key)
    expect(manifest.operations.map((o) => o.id)).toEqual(['double'])
  })

  it.each([
    ['main workflow', built.workflow],
    ['sub-workflow', built.subWorkflow],
  ])('%s passes the wiring check with no warnings and uses canonical shapes', (_name, wf) => {
    const form = bundle.forms[0]
    const check = (nodes: unknown[]) => validateWorkflowWiring({
      nodes,
      edges: wf.edges,
      workflowVariables: wf.user_variables as any,
      linkedForms: { [form.id]: { fields: form.fields, name: form.name, version: 1 } },
    }).map(formatWiringWarning)
    expect(check(wf.nodes)).toEqual([])
    // Strict: a webhook trigger may carry any variable, so references are
    // only all checked under a trigger with a closed set of variables.
    expect(check(wf.nodes.map((n) => (n.type === 'webhook_received' ? { ...n, type: 'schedule' } : n)))).toEqual([])
    for (const node of wf.nodes) expect(canonicalizeNodeConfigShapes(node.type, node.config), node.id).toEqual(node.config)
    // The designer's own checks ("issues to configure") find nothing either.
    expect(validateWorkflow(wf.nodes as any, 'webhook_received').nodeErrors).toEqual([])
  })

  it('every edge joins two steps and every step but the trigger is reachable', () => {
    const wf = built.workflow
    const byId = new Set(wf.nodes.map((n) => n.id))
    expect(wf.edges.filter((e) => !byId.has(e.source) || !byId.has(e.target))).toEqual([])
    const out = new Map<string, string[]>()
    for (const e of wf.edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target])
    for (const n of wf.nodes) if (n.type === 'goto_activity') out.set(n.id, [...(out.get(n.id) ?? []), n.config.target_node_id])
    const seen = new Set<string>(['trigger'])
    const queue = ['trigger']
    while (queue.length) for (const next of out.get(queue.pop()!) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next) }
    expect(wf.nodes.filter((n) => n.type !== 'section_group' && !seen.has(n.id)).map((n) => n.id)).toEqual([])
  })
})
