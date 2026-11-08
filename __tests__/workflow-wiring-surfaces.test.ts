/**
 * Wiring warnings reach programmatic builders: MCP workflows_create /
 * workflows_update / workflows_validate / workflows_preflight and REST
 * POST / PATCH /api/v1/workflows return `warnings` (node_id, message,
 * suggestion) so an AI builder can fix what it built. The linked forms are
 * read from the database when nodes carry no cached fields.
 */
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { PERMISSION_KEYS } from '@/lib/permissions'
import * as workflowCollectionRoute from '@/app/api/v1/workflows/route'
import * as workflowsRoute from '@/app/api/v1/workflows/[id]/route'
import { createMcpServer } from '@/lib/mcp/server'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- tool payloads are JSON */

type Memory = ReturnType<typeof createMemorySupabase>
const FORM_ID = '44444444-4444-4444-8444-444444444444'
const TASK_FORM = '77777777-7777-4777-8777-777777777777'

function seed(): Memory {
  return createMemorySupabase({
    workflows: [],
    workflow_versions: [],
    forms: [
      { id: FORM_ID, tenant_id: 'tenant-a', name: 'Onboarding', version: 2, fields: [{ key: 'full_name', label: 'Full name', type: 'text' }, { key: 'department', label: 'Department', type: 'text' }] },
      { id: TASK_FORM, tenant_id: 'tenant-a', name: 'HR approval', version: 1, fields: [{ key: 'approver_comment', label: 'Comment', type: 'textarea' }] },
    ],
  })
}

const NODES = [
  { id: 'trigger', type: 'form_submitted', label: 'Submitted', position: { x: 0, y: 0 }, config: { form_id: FORM_ID } },
  { id: 'title', type: 'set_title', label: 'Title', position: { x: 0, y: 120 }, config: { title: '{{full_name}}' } },
  { id: 'hr', type: 'user_task', label: 'HR approval', position: { x: 0, y: 240 }, config: { task_title: 'Approve {{form.full_name}}', assignee_id: '11111111-1111-4111-8111-111111111111', form_id: TASK_FORM, outcomes: ['approved'] } },
  { id: 'log', type: 'log', label: 'Log', position: { x: 0, y: 360 }, config: { message: '{{approver_comment}}' } },
]
const EDGES = [
  { id: 'e1', source: 'trigger', target: 'title' },
  { id: 'e2', source: 'title', target: 'hr' },
  { id: 'e3', source: 'hr', target: 'log', label: 'approved' },
]

const mcp = (memory: Memory) => createMcpServer({ tenantId: 'tenant-a', supabase: memory, permissions: [...PERMISSION_KEYS], scopes: { workflow_ids: [], table_ids: [] } } as never)
const payload = (result: { content?: Array<{ text?: string }>; isError?: boolean }) => {
  expect(result.isError, result.content?.[0]?.text).toBeFalsy()
  return JSON.parse(result.content?.[0]?.text ?? 'null')
}
const suggestions = (warnings: any[]) => warnings.map((w) => [w.node_id, w.suggestion])

describe('MCP', () => {
  it('workflows_create returns warnings with suggestions (forms read from the database)', async () => {
    const server = mcp(seed())
    const created = payload(await server.callTool('workflows_create', {
      name: 'Onboarding', trigger_type: 'form_submitted', nodes: JSON.stringify(NODES), edges: JSON.stringify(EDGES),
    }))
    expect(created.created).toBe(true)
    expect(suggestions(created.warnings)).toEqual([['title', '{{form.full_name}}'], ['log', '{{task_data.approver_comment}}']])
    expect(created.warnings[0]).toMatchObject({ node_label: 'Title', kind: 'reference', reference: '{{full_name}}' })
    expect(created.next_step).toMatch(/workflows_validate/)
  })

  it('workflows_update returns the remaining warnings; none once fixed', async () => {
    const server = mcp(seed())
    const { workflow } = payload(await server.callTool('workflows_create', { name: 'Onboarding', trigger_type: 'form_submitted', nodes: JSON.stringify(NODES), edges: JSON.stringify(EDGES) }))
    const fixed = NODES.map((n) => n.id === 'title' ? { ...n, config: { title: '{{form.full_name}}' } } : n)
    const partly = payload(await server.callTool('workflows_update', { workflow_id: workflow.id, nodes: JSON.stringify(fixed) }))
    expect(suggestions(partly.warnings)).toEqual([['log', '{{task_data.approver_comment}}']])
    const done = fixed.map((n) => n.id === 'log' ? { ...n, config: { message: '{{task_data.approver_comment}}' } } : n)
    const clean = payload(await server.callTool('workflows_update', { workflow_id: workflow.id, nodes: JSON.stringify(done) }))
    expect(clean.warnings).toEqual([])
    expect(clean.next_step).toBeUndefined()
  })

  it('workflows_validate checks a saved workflow or a draft graph without saving', async () => {
    const memory = seed()
    const server = mcp(memory)
    const draft = payload(await server.callTool('workflows_validate', {
      trigger_type: 'form_submitted',
      nodes: JSON.stringify([...NODES, { id: 'q', type: 'user_task', label: 'Odd', position: { x: 0, y: 480 }, config: { task_title: 'x', assignee_id: '11111111-1111-4111-8111-111111111111', assignee_mode: 'specific' } }]),
      edges: JSON.stringify([...EDGES, { id: 'e4', source: 'log', target: 'q' }]),
    }))
    expect(draft).toMatchObject({ valid: true, error_count: 0, warning_count: 3 })
    expect(draft.warnings.find((w: any) => w.node_id === 'q')).toMatchObject({ kind: 'config_key', key: 'assignee_mode', suggestion: 'assignment_type' })
    expect((await memory.from('workflows').select('id')).data).toEqual([])

    const { workflow } = payload(await server.callTool('workflows_create', { name: 'Onboarding', trigger_type: 'form_submitted', nodes: JSON.stringify(NODES), edges: JSON.stringify(EDGES) }))
    const saved = payload(await server.callTool('workflows_validate', { workflow_id: workflow.id }))
    expect(suggestions(saved.warnings)).toEqual([['title', '{{form.full_name}}'], ['log', '{{task_data.approver_comment}}']])
  })

  it('workflows_preflight lists warnings without changing valid', async () => {
    const result = payload(await mcp(seed()).callTool('workflows_preflight', { trigger_type: 'form_submitted', nodes: JSON.stringify(NODES), edges: JSON.stringify(EDGES) }))
    expect(result.warnings).toHaveLength(2)
  })

  it('a Data insert with output_var is saved as output_row_id_var (no key warning left)', async () => {
    const nodes = [NODES[0], { id: 'ins', type: 'update_data_table', label: 'Insert', position: { x: 0, y: 120 }, config: { table_id: 't1', operation: 'insert', column_values: { name: '{{form.full_name}}' }, output_var: 'new_id' } }, { id: 'l', type: 'log', label: 'L', position: { x: 0, y: 240 }, config: { message: '{{new_id}}' } }]
    const memory = seed()
    const created = payload(await mcp(memory).callTool('workflows_create', { name: 'Ins', trigger_type: 'form_submitted', nodes: JSON.stringify(nodes), edges: JSON.stringify([{ id: 'a', source: 'trigger', target: 'ins' }, { id: 'b', source: 'ins', target: 'l' }]) }))
    expect(created.warnings).toEqual([])
    const row = (await memory.from('workflows').select('nodes').eq('id', created.workflow.id).single()).data
    expect(row.nodes.find((n: any) => n.id === 'ins').config).toMatchObject({ output_row_id_var: 'new_id' })
    expect(row.nodes.find((n: any) => n.id === 'ins').config.output_var).toBeUndefined()
  })
})

describe('REST', () => {
  function authAs(memory: Memory) {
    vi.mocked(validateApiKey).mockResolvedValue({
      success: true, tenantId: 'tenant-a', keyId: 'key-1', keyType: 'tenant', createdBy: 'u1', actingUserId: null,
      scopes: { workflow_ids: [], table_ids: [] }, permissions: [...PERMISSION_KEYS],
      supabase: memory as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
    })
  }
  const req = (path: string, method: string, body: unknown) => new NextRequest(`https://app.test/api/v1${path}`, {
    method, headers: { authorization: 'Bearer ut_test', 'content-type': 'application/json' }, body: JSON.stringify(body),
  })

  it('POST and PATCH /workflows return warnings', async () => {
    const memory = seed()
    authAs(memory)
    const res = await workflowCollectionRoute.POST(req('/workflows', 'POST', { name: 'Onboarding', trigger_type: 'form_submitted', nodes: NODES, edges: EDGES }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(suggestions(data.warnings)).toEqual([['title', '{{form.full_name}}'], ['log', '{{task_data.approver_comment}}']])

    const patched = await workflowsRoute.PATCH(req(`/workflows/${data.workflow_id}`, 'PATCH', { nodes: NODES.filter((n) => n.id !== 'log'), edges: EDGES.slice(0, 2) }), { params: Promise.resolve({ id: data.workflow_id }) })
    expect(patched.status).toBe(200)
    expect(suggestions((await patched.json()).data.warnings)).toEqual([['title', '{{form.full_name}}']])
  })
})
