import { describe, expect, it } from 'vitest'
import { contextGroups, formVariableScope, type FormVariableContext } from '@/lib/forms/variable-catalog'
import { hasWorkflowTokens, resolveTaskForm, resolveWorkflowText, resolveWorkflowTokens } from '@/lib/forms/workflow-tokens'
import { clearLivePrefillThrottle, refreshTaskLivePrefill } from '@/lib/services/task-live-prefill'

const workflow = [
  { path: 'after.Title', label: 'Title', group: 'list' as const, source: 'List item', typeLabel: 'Single line of text', control: { type: 'text' }, sample: 'Title' },
  { path: 'after.Amount', label: 'Amount', group: 'list' as const, source: 'List item', typeLabel: 'Currency', control: { type: 'currency' }, sample: 1250 },
  { path: 'cost_centre', label: 'Cost centre', group: 'start' as const, source: 'Workflow input', typeLabel: 'Text', control: { type: 'text' } },
  { path: 'threshold', label: 'threshold', group: 'variables' as const, source: 'Set threshold', typeLabel: 'Number', control: { type: 'number' } },
  { path: 'task_data.comments', label: 'Comments', group: 'steps' as const, source: 'Manager approval › Form', typeLabel: 'Long text', control: { type: 'textarea' } },
]
const fields = [{ key: 'notes', label: 'Notes', type: 'text' }]
const KINDS: FormVariableContext[] = [
  { kind: 'header' }, { kind: 'default' }, { kind: 'bar' }, { kind: 'button' }, { kind: 'rule', event: 'form_load', slot: 'condition' } as FormVariableContext,
  { kind: 'rule', event: 'form_load', slot: 'action' } as FormVariableContext, { kind: 'table_query' }, { kind: 'lookup_query' }, { kind: 'dynamic_value' }, { kind: 'expression' }, { kind: 'table_changes' }, { kind: 'task_completed' },
]

describe('workflow variables in the form designer\'s pickers', () => {
  it('every editor context offers the step\'s workflow data, grouped and labelled, typed, with no problem flagged', () => {
    for (const ctx of KINDS) {
      const scope = formVariableScope({ fields: fields as never, layout: {}, workflow }, ctx)
      const amount = scope.items.find((i) => i.path === 'after.Amount')
      expect(amount, JSON.stringify(ctx)).toMatchObject({ label: 'Amount', group: 'Workflow · List item', type: 'number', sample: 1250 })
      expect(scope.items.find((i) => i.path === 'task_data.comments')).toMatchObject({ label: 'Manager approval › Form › Comments', group: 'Workflow · Earlier steps' })
      expect(scope.items.find((i) => i.path === 'cost_centre')?.group).toBe('Workflow · Start inputs')
      expect(scope.problem?.('after.Amount') ?? null, JSON.stringify(ctx)).toBeNull()
      // The form's own groups are unchanged.
      expect(scope.groups).toEqual(contextGroups(ctx))
    }
  })
  it('a standalone form shows no workflow variables', () => {
    const scope = formVariableScope({ fields: fields as never, layout: {} }, { kind: 'default' })
    expect(scope.items.some((i) => i.group.startsWith('Workflow'))).toBe(false)
    expect(scope.items.some((i) => i.path === 'after.Amount')).toBe(false)
  })
})

describe('resolving them on the server', () => {
  const vars = { after: { Title: 'Laptop', Amount: 1200, api_token: 'leak' }, cost_centre: 'CC-9', client_secret: 'nope', task_data: { comments: 'run-level' } }
  it('replaces run variables only: the form\'s own namespaces and formulas stay for the form; secrets are blank', () => {
    expect(resolveWorkflowText('Approve {{after.Title}} for {{ after.Amount }} ({{cost_centre}})', vars)).toBe('Approve Laptop for 1200 (CC-9)')
    expect(resolveWorkflowText('{{form.notes}} {{task_data.comments}} {{user.email}} {{today}} {{= SUM(1,2)}}', vars)).toBe('{{form.notes}} {{task_data.comments}} {{user.email}} {{today}} {{= SUM(1,2)}}')
    expect(resolveWorkflowText('[{{after.api_token}}][{{client_secret}}]', vars)).toBe('[][]')
    expect(resolveWorkflowText('{{unknown_var}}', vars)).toBe('{{unknown_var}}')
  })
  it('walks the whole form definition (rules, buttons, filters), keeping keys', () => {
    const parts = {
      fields: [{ key: 'amount', label: 'Amount (limit {{after.Amount}})', type: 'number', visible_when: { field: 'x', operator: 'equals', value: '{{cost_centre}}' } }],
      form_layout: { rows: [], rules: [{ id: 'r1', when: { field: 'amount', operator: 'gt', value: '{{after.Amount}}' }, then: [{ type: 'message', text: 'Over {{after.Amount}}' }] }] },
      form_buttons: [{ id: 'save', actions: [{ type: 'save_target', values: { Status: '{{cost_centre}}' } }] }],
    }
    const { resolved, templates } = resolveTaskForm(parts, vars)
    expect(templates).toBe(parts)
    expect((resolved.fields as any)[0]).toMatchObject({ label: 'Amount (limit 1200)', visible_when: { value: 'CC-9' } })
    expect((resolved.form_layout as any).rules[0]).toMatchObject({ when: { value: '1200' }, then: [{ text: 'Over 1200' }] })
    expect((resolved.form_buttons as any)[0].actions[0].values).toEqual({ Status: 'CC-9' })
    expect(resolveTaskForm({ fields: [{ key: 'a', label: '{{form.b}}', type: 'text' }] }, vars).templates).toBeNull()
    expect(hasWorkflowTokens(resolveWorkflowTokens(parts, vars), vars)).toBe(false)
  })
})

function fakeSys(runVars: Record<string, unknown>) {
  const updates: any[] = []
  return {
    updates,
    from(table: string) {
      const chain: any = {
        eq: () => chain,
        maybeSingle: async () => ({ data: table === 'workflow_runs' ? { variables: runVars } : null }),
        update: (patch: unknown) => { updates.push({ table, patch }); return chain },
        select: (cols?: string) => (cols === 'updated_at' ? Promise.resolve({ data: [{ updated_at: 'later' }], error: null }) : chain),
      }
      return chain
    },
  }
}

describe('a variable is resolved when the task opens (the run\'s current value)', () => {
  it('re-resolves from the templates the task was created with', async () => {
    clearLivePrefillThrottle()
    const templates = { fields: [{ key: 'amount', label: 'Amount (limit {{threshold}})', type: 'number' }], form_layout: { rows: [], rules: [] }, form_buttons: null }
    const task = { id: 't1', tenant_id: 'tenant', status: 'todo', workflow_run_id: 'run1', updated_at: 'now', metadata: { fields: [{ key: 'amount', label: 'Amount (limit 500)', type: 'number' }], form_layout: { rows: [], rules: [] }, workflow_templates: templates } }
    const sys = fakeSys({ threshold: 750 })
    const out = await refreshTaskLivePrefill({ tenantId: 'tenant', actorId: 'u', permissions: new Set() } as any, task, { sys })
    expect(out.metadata.fields).toEqual([{ key: 'amount', label: 'Amount (limit 750)', type: 'number' }])
    expect(Object.keys(sys.updates[0].patch.metadata)).toContain('workflow_templates')
    expect(Object.keys(sys.updates[0].patch)).toEqual(['metadata'])
  })
  it('a task without workflow templates or live prefill is untouched', async () => {
    clearLivePrefillThrottle()
    const task = { id: 't2', tenant_id: 'tenant', status: 'todo', workflow_run_id: 'run1', metadata: { fields: [] } }
    expect(await refreshTaskLivePrefill({ tenantId: 'tenant' } as any, task, { sys: fakeSys({}) })).toBe(task)
  })
})
