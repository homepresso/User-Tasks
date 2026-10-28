import { describe, it, expect, vi } from 'vitest'
import { UPDATABLE_TASK_FIELDS, WORKFLOW_UPDATABLE_TASK_FIELDS, validateTaskFieldValue } from '@/lib/task-fields'

import { __testing } from '@/lib/workflow-engine'
import { validateNode } from '@/lib/workflow-validation'

describe('task field allowlists', () => {
  it('UI allowlist excludes dangerous columns', () => {
    for (const field of ['tenant_id', 'assignee_id', 'metadata', 'event_id', 'is_workflow_task', 'deleted_at', 'outcome']) {
      expect(UPDATABLE_TASK_FIELDS.has(field), field).toBe(false)
    }
    for (const field of ['description', 'progress_pct', 'estimated_completion', 'status']) {
      expect(UPDATABLE_TASK_FIELDS.has(field), field).toBe(true)
    }
  })

  it('workflow allowlist excludes identity/tenancy columns', () => {
    const fields = WORKFLOW_UPDATABLE_TASK_FIELDS as readonly string[]
    expect(fields).not.toContain('tenant_id')
    expect(fields).not.toContain('event_id')
    expect(fields).not.toContain('metadata')
    expect(fields).toContain('status')
    expect(fields).toContain('outcome')
  })

  it('validates status/priority/progress values', () => {
    expect(validateTaskFieldValue('status', 'in_progress')).toBeNull()
    expect(validateTaskFieldValue('status', 'not-a-status')).toContain('not a valid')
    expect(validateTaskFieldValue('priority', 'high')).toBeNull()
    expect(validateTaskFieldValue('priority', 'urgent!!!')).toContain('not a valid')
    expect(validateTaskFieldValue('progress_pct', 50)).toBeNull()
    expect(validateTaskFieldValue('progress_pct', 150)).toContain('between 0 and 100')
    expect(validateTaskFieldValue('title', 'anything')).toBeNull()
  })
})

describe('workflow update_task node allowlist', () => {
  const node = (field: string) =>
    ({ id: 'n1', type: 'update_task', label: 'Update Task', position: { x: 0, y: 0 }, config: { field, value: 'x' } }) as any

  function makeCtx() {
    const b: any = {
      update: () => b, eq: () => b, select: () => b, order: () => b, limit: () => b, in: () => b,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (res: any) => Promise.resolve({ data: [], error: null }).then(res),
    }
    return {
      supabase: { from: () => b },
      tenantId: 'tenant-1',
      taskId: 'task-1',
      variables: {},
      liveBindings: {},
      nodeResults: {} as Record<string, any>,
      executedNodes: new Set<string>(),
      executionTrace: [],
      logs: [],
      onEvent: () => {},
    } as any
  }

  it('rejects a disallowed field at execution', async () => {
    const ctx = makeCtx()
    await expect(__testing.executeNode(node('tenant_id'), [], [], ctx)).rejects.toThrow('not allowed')
  })

  it('allows an allowlisted field', async () => {
    const ctx = makeCtx()
    await expect(__testing.executeNode(node('priority'), [], [], ctx)).resolves.toBeUndefined()
    expect(ctx.nodeResults['n1'].status).toBe('success')
  })

  it('validation flags disallowed fields at save time', () => {
    const bad = validateNode({ id: 'n1', type: 'update_task', label: 'U', position: { x: 0, y: 0 }, config: { field: 'event_id' } } as any)
    expect(bad.join(' ')).toContain('cannot be updated')
    const good = validateNode({ id: 'n1', type: 'update_task', label: 'U', position: { x: 0, y: 0 }, config: { field: 'status' } } as any)
    expect(good).toHaveLength(0)
  })
})
