import { describe, expect, it } from 'vitest'
import { createEmptyAssetIdMaps } from '@/lib/portability/id-maps'
import { diffValues, planManifest } from '@/lib/portability/plan'

const SRC_DT = '11111111-1111-4111-8111-111111111111'
const LOC_DT = '22222222-2222-4222-8222-222222222222'
const SRC_WF = '33333333-3333-4333-8333-333333333333'
const LOC_WF = '44444444-4444-4444-8444-444444444444'
const SRC_INT = '55555555-5555-4555-8555-555555555555'
const SRC_REF = '66666666-6666-4666-8666-666666666666'
const NEW_ID = '77777777-7777-4777-8777-777777777777'
const TRIGGER = { id: 't1', type: 'manual', label: 'Manual Trigger', position: { x: 300, y: 20 }, config: {} }
const EDGE = { id: 'e1', source: 't1', target: 'n1' }

describe('diffValues', () => {
  it('reports leaf paths and treats null/missing and __SECRET__ as equal', () => {
    expect(diffValues({ a: 1, b: null, c: { d: [1, 2] }, s: 'enc:v1:abc' }, { a: 1, c: { d: [1, 3] }, s: '__SECRET__' }))
      .toEqual([{ path: 'c.d[1]', before: 2, after: 3 }])
    expect(diffValues({ token: '__SECRET__' }, { token: 'plain' })).toEqual([])
    expect(diffValues({ x: [1] }, { x: [] })).toEqual([{ path: 'x[0]', before: 1 }])
  })
})

describe('planManifest', () => {
  const seed = () => {
    const ids = createEmptyAssetIdMaps()
    ids.decision_table[SRC_DT] = LOC_DT
    ids.workflow[SRC_WF] = LOC_WF
    return ids
  }

  it('classifies create / update / unchanged with remapped ids and ignored volatile fields', () => {
    const incoming = {
      decision_tables: [{ id: SRC_DT, name: 'Risk', inputs: [], outputs: [], rules: [], updated_at: '2026-01-01', exported_at: 'x' }],
      workflows: [{ id: SRC_WF, name: 'Intake', nodes: [TRIGGER, { id: 'n1', type: 'decision_table', config: { decision_table_id: SRC_DT, label: 'New label' } }], edges: [EDGE], is_active: false, extra_field: 'ignored' }],
      agents: [{ id: NEW_ID, name: 'Helper' }],
    }
    const current = {
      decision_tables: [{ id: LOC_DT, name: 'Risk', description: null, inputs: [], outputs: [], rules: [], created_at: '2025-01-01', updated_at: '2025-06-01' }],
      // Stored nodes carry the defaults the import's normaliser adds (label, position).
      workflows: [{ id: LOC_WF, name: 'Intake', nodes: [TRIGGER, { id: 'n1', type: 'decision_table', label: 'Decision Table', position: { x: 220, y: 160 }, config: { decision_table_id: LOC_DT, label: 'Old label' } }], edges: [EDGE], is_active: false }],
    }
    const plan = planManifest({ incoming, current, idSeed: seed() })
    const byName = Object.fromEntries(plan.assets.map((a) => [a.name, a]))
    expect(byName.Risk).toMatchObject({ action: 'unchanged', local_id: LOC_DT, matched_by: 'mapping' })
    // decision_table_id remapped SRC→LOC, so only the label differs; extra_field is not compared.
    expect(byName.Intake).toMatchObject({ action: 'update', local_id: LOC_WF, diffs: [{ path: 'nodes[1].config.label', before: 'Old label', after: 'New label' }] })
    expect(byName.Helper).toMatchObject({ action: 'create', local_id: null })
    expect(plan.summary).toEqual({ create: 1, update: 1, unchanged: 1, error: 0 })
  })

  it('treats __SECRET__ as equal to any stored credential', () => {
    const ids = createEmptyAssetIdMaps()
    ids.integration[SRC_INT] = SRC_INT
    const plan = planManifest({
      incoming: { integrations: [{ id: SRC_INT, name: 'ERP', type: 'rest_api', config: { base_url: 'u', auth_config: { token: '__SECRET__' } } }] },
      current: { integrations: [{ id: SRC_INT, name: 'ERP', type: 'rest_api', config: { base_url: 'u', auth_config: { token: '__SECRET__' } } }] },
      idSeed: ids,
    })
    expect(plan.assets[0]).toMatchObject({ action: 'unchanged', matched_by: 'id' })

    // A new credential in the file is an update, but its value is never echoed.
    const changed = planManifest({
      incoming: { integrations: [{ id: SRC_INT, name: 'ERP', config: { auth_config: { token: 'new-plain-token' }, headers: { Authorization: 'Bearer x' } } }] },
      current: { integrations: [{ id: SRC_INT, name: 'ERP', config: { auth_config: {}, headers: {} } }] },
      idSeed: ids,
    })
    expect(changed.assets[0].action).toBe('update')
    expect(changed.assets[0].diffs).toEqual([
      { path: 'config.auth_config.token', after: '__SECRET__' },
      { path: 'config.headers.Authorization', after: '__SECRET__' },
    ])
    expect(JSON.stringify(changed)).not.toContain('new-plain-token')
  })

  it('detects a rotated secret against the revealed stored value without echoing either', () => {
    const ids = createEmptyAssetIdMaps()
    ids.integration[SRC_INT] = SRC_INT
    const scrubbed = { integrations: [{ id: SRC_INT, name: 'ERP', config: { auth_config: { token: '__SECRET__' } } }] }
    const raw = { integrations: [{ id: SRC_INT, name: 'ERP', config: { auth_config: { token: 'enc:v1:stored' } } }] }
    const reveal = (stored: string) => (stored === 'enc:v1:stored' ? 'old-token' : undefined)
    const run = (token: string) => planManifest({
      incoming: { integrations: [{ id: SRC_INT, name: 'ERP', config: { auth_config: { token } } }] },
      current: scrubbed, idSeed: ids, secrets: { current: raw, reveal },
    })
    expect(run('old-token').assets[0].action).toBe('unchanged')
    expect(run('__SECRET__').assets[0].action).toBe('unchanged')
    const rotated = run('new-token')
    expect(rotated.assets[0]).toMatchObject({ action: 'update', diffs: [{ path: 'config.auth_config.token', before: '__SECRET__', after: '__SECRET__' }] })
    expect(JSON.stringify(rotated)).not.toMatch(/old-token|new-token|enc:v1/)
  })

  it('does not report values the import normaliser fills in (hand-written files)', () => {
    const ids = createEmptyAssetIdMaps()
    ids.decision_table[SRC_DT] = LOC_DT
    const plan = planManifest({
      // No field ids / labels in the file; the stored row has generated ones.
      incoming: { decision_tables: [{ id: SRC_DT, name: 'Risk', inputs: [{ key: 'amount' }], outputs: [{ key: 'tier' }], rules: [] }] },
      current: { decision_tables: [{ id: LOC_DT, name: 'Risk', description: null, inputs: [{ id: 'f1', key: 'amount', label: 'amount', type: 'text' }], outputs: [{ id: 'f2', key: 'tier', label: 'tier', type: 'text' }], rules: [] }] },
      idSeed: ids,
    })
    expect(plan.assets[0]).toMatchObject({ action: 'unchanged' })
    // …but a value the file does state is compared.
    const changed = planManifest({
      incoming: { decision_tables: [{ id: SRC_DT, name: 'Risk', inputs: [{ key: 'amount', type: 'number' }], outputs: [{ key: 'tier' }], rules: [] }] },
      current: { decision_tables: [{ id: LOC_DT, name: 'Risk', inputs: [{ id: 'f1', key: 'amount', label: 'amount', type: 'text' }], outputs: [{ id: 'f2', key: 'tier', label: 'tier', type: 'text' }], rules: [] }] },
      idSeed: ids,
    })
    expect(changed.assets[0].diffs).toEqual([{ path: 'inputs[0].type', before: 'text', after: 'number' }])
  })

  it('an untouched export of a workflow stored with non-canonical condition casing plans as unchanged', () => {
    const ids = createEmptyAssetIdMaps()
    ids.workflow[LOC_WF] = LOC_WF
    // As stored by the REST API / designer: `logic: "AND"`, `operator: "Equals"`.
    const condition = (logic: string, operator: string) => ({
      id: 'n1', type: 'condition', label: 'Auto approve?', position: { x: 220, y: 160 },
      config: { branches: [{ label: 'Yes', logic, rules: [{ field: '{{auto_approve}}', operator, value: 'true' }] }], has_else: true },
    })
    const stored = { id: LOC_WF, name: 'Invoice approval', trigger_type: 'manual', trigger_config: {}, nodes: [TRIGGER, condition('AND', 'Equals')], edges: [EDGE], is_active: true }
    const plan = planManifest({ incoming: { workflows: [structuredClone(stored)] }, current: { workflows: [stored] }, idSeed: ids })
    expect(plan.assets[0]).toMatchObject({ action: 'unchanged' })
    expect(plan.assets[0].diffs).toBeUndefined()

    // A real edit is still reported (in canonical form).
    const edited = { ...structuredClone(stored), nodes: [TRIGGER, condition('OR', 'Equals')] }
    const changed = planManifest({ incoming: { workflows: [edited] }, current: { workflows: [stored] }, idSeed: ids })
    expect(changed.assets[0]).toMatchObject({ action: 'update', diffs: [{ path: 'nodes[1].config.branches[0].logic', before: 'and', after: 'or' }] })
  })

  it('creates when the mapped local row no longer exists', () => {
    const plan = planManifest({ incoming: { workflows: [{ id: SRC_WF, name: 'Intake' }] }, current: {}, idSeed: seed() })
    expect(plan.assets[0]).toMatchObject({ action: 'create', local_id: null })
  })

  it('reports errors: missing / non-uuid / duplicate ids, nameless assets, orphan references', () => {
    const plan = planManifest({
      incoming: {
        workflows: [{ name: 'No id' }, { id: 'wf-1', name: 'Bad id' }, { id: NEW_ID, name: 'A' }, { id: NEW_ID, name: 'A again' }, { id: SRC_WF }],
        references: [{ id: SRC_REF, integration_id: SRC_INT, name: 'Orphan' }],
      },
      current: {},
      idSeed: createEmptyAssetIdMaps(),
      paths: { workflows: ['workflows/no-id.json', 'workflows/bad-id.json', 'workflows/a.json'] },
    })
    const errors = plan.assets.filter((a) => a.action === 'error').map((a) => a.error)
    // Plan order follows import order (references before workflows).
    expect(errors).toEqual([
      `Reference must be applied together with its integration (${SRC_INT} is not in the files)`,
      'Asset has no id',
      'id must be a UUID (got "wf-1")',
      `Duplicate id ${NEW_ID} in workflows`,
      'Asset has no name',
    ])
    expect(plan.assets.find((a) => a.name === 'A')).toMatchObject({ action: 'create', file: 'workflows/a.json' })
  })

  it('skips object-backed references and the internal __objects__ integration', () => {
    const plan = planManifest({
      incoming: {
        integrations: [{ id: SRC_INT, name: '__objects__' }],
        references: [{ id: SRC_REF, integration_id: SRC_INT, name: 'Object: Orders', request_config: { _executor: 'object', object_id: 'o1' } }],
        objects: [{ id: 'o1', name: 'Orders', generated_reference_id: SRC_REF, sources: [] }],
      },
      current: {},
      idSeed: createEmptyAssetIdMaps(),
    })
    expect(plan.assets.map((a) => `${a.section}:${a.action}`)).toEqual(['objects:create'])
  })
})
