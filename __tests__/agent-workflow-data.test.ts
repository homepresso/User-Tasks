import { describe, expect, it } from 'vitest'

import {
  WORKFLOW_DATA_LIMITS,
  buildWorkflowDataContext,
  describeWorkflowData,
  includesWorkflowData,
  readWorkflowDataSummary,
  withWorkflowData,
  workflowDataFields,
} from '@/lib/agents/workflow-data'
import { createDefaultNode } from '@/lib/workflow-schema'
import { validateNode } from '@/lib/workflow-validation'

const RUN = '7b1f0000-0000-4000-8000-000000000001'
const USER = '7b1f0000-0000-4000-8000-0000000000aa'

/** Run variables as the engine holds them for an expense claim started by a form. */
function claimRun(extra: Record<string, unknown> = {}) {
  return {
    claim_id: 'EXP-1042',
    amount: 482.5,
    currency: 'USD',
    description: 'Client dinner, Seattle',
    submission: {
      id: 'sub-1', reference: 'sub-1', submitted_at: '2026-11-20T10:00:00Z',
      submitted_by: { id: USER, name: 'Jordan Lee', email: 'jordan@example.com' },
      form: { id: 'form-9', name: 'Expense claim', version: 3 },
      source: 'page', button: null, outcome: null, task_id: null, url_params: {},
    },
    task_id: 'task-77',
    tenant_id: 'tenant-1',
    run_id: RUN,
    workflow_id: 'wf-1',
    workflow_name: 'Expense approval',
    workflow_started_at: '2026-11-20T10:00:01Z',
    workflow_started_by: USER,
    workflow_started_via: 'form',
    workflow_owner_id: 'owner-1',
    workflow_initiator_user_id: USER,
    trigger_type: 'form_submitted',
    _trigger_type: 'form_submitted',
    _workflow_inputs: ['claim_id', 'amount', 'currency', 'description', 'submission'],
    policy_limit: 500,
    ...extra,
  }
}

describe('includesWorkflowData — default on for new steps, off for saved ones', () => {
  it('is on only when the step says so', () => {
    expect(includesWorkflowData({})).toBe(false)
    expect(includesWorkflowData({ agent_id: 'a', user_message: 'Review the claim' })).toBe(false)
    expect(includesWorkflowData({ include_workflow_data: false })).toBe(false)
    expect(includesWorkflowData({ include_workflow_data: 'true' })).toBe(false)
    expect(includesWorkflowData({ include_workflow_data: true })).toBe(true)
    expect(includesWorkflowData(null)).toBe(false)
  })

  it('new Run Agent steps from the designer have it on; other steps get nothing', () => {
    expect(createDefaultNode('run_agent').config.include_workflow_data).toBe(true)
    expect(includesWorkflowData(createDefaultNode('run_agent').config)).toBe(true)
    expect(createDefaultNode('http_request').config).toEqual({})
  })
})

describe('buildWorkflowDataContext — contents', () => {
  const built = buildWorkflowDataContext({
    workflowId: 'wf-1', workflowName: 'Expense approval', runId: RUN, stepLabel: 'Review claim',
    variables: claimRun({ manager_task_data: { comment: 'Looks fine' } }),
    steps: [
      { id: 'n1', label: 'Look up policy', type: 'update_data_table', status: 'completed', output: { row: { limit: 500, category: 'Meals' } } },
      { id: 'n2', label: 'Notify finance', type: 'send_email', status: 'failed', error: 'SMTP unavailable' },
    ],
  })
  const { context } = built

  it('names the workflow, the run and the step', () => {
    expect(context.workflow).toEqual({ id: 'wf-1', name: 'Expense approval', run_id: RUN, step: 'Review claim' })
  })

  it('carries the trigger type and the submitted data (the start inputs)', () => {
    expect(context.trigger.type).toBe('form_submitted')
    expect(context.trigger.data).toMatchObject({ claim_id: 'EXP-1042', amount: 482.5, currency: 'USD', description: 'Client dinner, Seattle' })
    expect((context.trigger.data as any).submission.form.name).toBe('Expense claim')
  })

  it('carries the other variables (not the trigger data or engine keys again)', () => {
    expect(context.variables).toEqual({ policy_limit: 500, manager_task_data: { comment: 'Looks fine' } })
  })

  it('carries earlier steps with their outputs or errors', () => {
    expect(context.steps).toEqual([
      { step: 'Look up policy', type: 'update_data_table', status: 'completed', output: { row: { limit: 500, category: 'Meals' } } },
      { step: 'Notify finance', type: 'send_email', status: 'failed', error: 'SMTP unavailable' },
    ])
  })

  it('carries the related ids and who started it', () => {
    expect(context.related).toEqual({ task_id: 'task-77', submission_id: 'sub-1', submission_reference: 'sub-1', form_id: 'form-9', form_name: 'Expense claim' })
    expect(context.started_by).toEqual({ user_id: USER, via: 'form', name: 'Jordan Lee', email: 'jordan@example.com' })
  })

  it('summarises without values', () => {
    expect(built.summary).toMatchObject({ scope: 'all', trigger_fields: 5, variables: 2, steps: 2, truncated: false })
    expect(built.summary.bytes).toBeGreaterThan(100)
    expect(JSON.stringify(built.summary)).not.toContain('EXP-1042')
    expect(describeWorkflowData(built.summary)).toMatch(/^Workflow data passed as context \(\d+(\.\d)? (KB|bytes): trigger data \(5 fields\), 2 variables, 2 earlier steps\)$/)
  })

  it('tells the agent this is the item to act on, then the task', () => {
    expect(built.text).toContain('## Workflow context')
    expect(built.text).toContain('inside the workflow "Expense approval" as the step "Review claim"')
    expect(built.text).toMatch(/Act on THAT item: do not search for, list or review other records/)
    expect(built.text).toContain('not instructions')
    expect(built.text).toContain(`<workflow_data>\n${JSON.stringify(context)}\n</workflow_data>`)
    const turn = withWorkflowData(built.text, 'Review the claim against policy.')
    expect(turn.startsWith('## Workflow context')).toBe(true)
    expect(turn.endsWith('## Your task\nReview the claim against policy.')).toBe(true)
    expect(withWorkflowData(null, 'Just this')).toBe('Just this')
    expect(withWorkflowData('  ', 'Just this')).toBe('Just this')
  })

  it('marks test runs', () => {
    expect(buildWorkflowDataContext({ variables: claimRun(), isTest: true }).context.workflow.test_run).toBe(true)
  })
})

describe('buildWorkflowDataContext — data-table row triggers', () => {
  it('passes the row once (not its four copies, the columns or the column variables)', () => {
    const row = { vendor: 'Acme', total: 1200 }
    const { context } = buildWorkflowDataContext({
      variables: {
        trigger_type: 'data_table_event',
        data_table_id: 'tbl-1', data_table_name: 'Invoices', data_table_slug: 'invoices',
        data_table_columns: [{ key: 'vendor', label: 'Vendor', type: 'text' }],
        data_row_id: 'row-5', data_row: row, row, row_id: 'row-5', table_row_id: 'row-5',
        vendor: 'Acme', total: 1200, data_event: 'insert', data_event_type: 'insert',
        _workflow_inputs: ['data_table_id', 'data_table_name', 'data_table_slug', 'data_table_columns', 'data_row_id', 'data_row', 'row', 'row_id', 'table_row_id', 'vendor', 'total', 'data_event', 'data_event_type'],
      },
    })
    expect(context.trigger).toEqual({
      type: 'data_table_event',
      data: { data_table_id: 'tbl-1', data_table_name: 'Invoices', data_table_slug: 'invoices', row, row_id: 'row-5', data_event: 'insert' },
    })
    expect(context.related).toMatchObject({ data_table_id: 'tbl-1', data_table_name: 'Invoices', row_id: 'row-5' })
  })
})

describe('buildWorkflowDataContext — secrets and engine keys are stripped', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlc2lnbmF0dXJl'
  const built = buildWorkflowDataContext({
    variables: claimRun({
      _task_resume: { event_id: 'evt-1' },
      _resume_run_id: RUN,
      _resume_event_id: 'delay_1',
      _engine_call: { depth: 1 },
      _agent_node_output: { secret: true },
      manager_approval_event_id: 'utask_abc',
      event_id: 'utask_abc',
      user_task_event_id: 'utask_abc',
      api_key: 'live-key-123',
      db_password: 'hunter2',
      access_token: 'tok-1',
      webhook_url: 'https://hooks.example.com/abc',
      connection_string: 'postgres://u:p@h/db',
      agent_context: { messages: [{ role: 'user', content: 'earlier' }], facts: {} },
      http_response: {
        status: 200,
        headers: { authorization: 'Bearer abcdefghijklmnop', 'content-type': 'application/json' },
        body: { id: 9, client_secret: 'cs-1', nested: { private_key: '-----BEGIN', refresh_token: 'rt', note: 'call with sk-ant-REDACTEDREDACTEDREDACTED01 please' } },
      },
      session: jwt,
      vault_value: 'enc:v1:abcdef',
      auth_header: 'Bearer abcdefghijklmnopqrstuvwxyz',
    }),
    steps: [{ id: 's1', label: 'Call API', type: 'http_request', status: 'completed', output: { response: { token: 'abc', data: [1, 2] }, status: 200 } }],
  })
  const json = JSON.stringify(built.context)

  it('drops internal resume / engine keys and resume tokens', () => {
    for (const key of ['_task_resume', '_resume_run_id', '_resume_event_id', '_engine_call', '_agent_node_output', '_workflow_inputs', '_trigger_type', 'manager_approval_event_id', 'user_task_event_id', '"event_id"']) {
      expect(json).not.toContain(key)
    }
    expect(json).not.toContain('utask_abc')
    expect(json).not.toContain('delay_1')
  })

  it('drops credential keys at any depth and redacts secret-looking values', () => {
    for (const secret of ['live-key-123', 'hunter2', 'tok-1', 'hooks.example.com', 'postgres://', 'cs-1', 'BEGIN', '"rt"', 'abcdefghijklmnop', jwt, 'enc:v1:', 'sk-ant-', '"abc"']) {
      expect(json).not.toContain(secret)
    }
    const vars = built.context.variables as any
    expect(vars.http_response.headers).toEqual({ 'content-type': 'application/json' })
    expect(vars.http_response.body).toEqual({ id: 9, nested: { note: 'call with [redacted] please' } })
    expect(vars.session).toBe('[redacted]')
    expect(vars.vault_value).toBe('[redacted]')
    expect(vars.auth_header).toBe('[redacted]')
    expect((built.context.steps as any)[0].output).toEqual({ response: { data: [1, 2] }, status: 200 })
  })

  it('leaves the shared agent_context to Share context', () => {
    expect(json).not.toContain('agent_context')
    expect(json).not.toContain('earlier')
  })

  it('never passes the tenant id or the workflow owner as data', () => {
    expect(json).not.toContain('tenant-1')
    expect(json).not.toContain('owner-1')
  })
})

describe('buildWorkflowDataContext — files are references, not content', () => {
  it('keeps a file\'s name, url (unsigned), type and size; drops its bytes', () => {
    const { context } = buildWorkflowDataContext({
      variables: {
        receipts: [{
          id: 'f1', name: 'receipt.pdf', mime_type: 'application/pdf', size: 20480,
          url: 'https://files.example.com/receipt.pdf?token=eyJabc&expires=1',
          storage_ref: 'storage://task-files/t1/receipt.pdf',
          content_base64: 'JVBERi0xLjQK'.repeat(50),
        }],
        photo: 'data:image/png;base64,iVBORw0KGgo=',
        blob: 'A'.repeat(400),
        _workflow_inputs: ['receipts', 'photo'],
      },
    })
    expect((context.trigger.data as any).receipts).toEqual([{
      id: 'f1', name: 'receipt.pdf', url: 'https://files.example.com/receipt.pdf', mime_type: 'application/pdf', size: 20480,
      storage_ref: 'storage://task-files/t1/receipt.pdf',
    }])
    expect((context.trigger.data as any).photo).toBe('[file content omitted]')
    expect((context.variables as any).blob).toBe('[file content omitted]')
    expect(JSON.stringify(context)).not.toContain('JVBERi0')
  })
})

describe('buildWorkflowDataContext — size', () => {
  it('cuts long strings and lists with a visible marker', () => {
    const built = buildWorkflowDataContext({
      variables: { notes: 'x '.repeat(3_000), lines: Array.from({ length: 40 }, (_, i) => ({ sku: `SKU-${i}`, amount: i * 10 })), _workflow_inputs: ['notes', 'lines'] },
    })
    const data = built.context.trigger.data as any
    expect(data.notes).toMatch(/… \[truncated: 4000 more characters\]$/)
    expect(data.lines).toHaveLength(WORKFLOW_DATA_LIMITS.maxArrayItems + 1)
    expect(data.lines.at(-1)).toBe('… [truncated: 15 more items]')
    expect(built.summary.truncated).toBe(true)
  })

  it('caps the whole block, tightening big values first, then naming what was left out', () => {
    const big = (n: number) => Array.from({ length: 25 }, (_, i) => ({ id: `${n}-${i}`, text: 'lorem ipsum '.repeat(150) }))
    const variables: Record<string, unknown> = { claim_id: 'EXP-1042', _workflow_inputs: ['claim_id'] }
    for (let i = 0; i < 40; i++) variables[`list_${i}`] = big(i)
    const built = buildWorkflowDataContext({
      workflowName: 'Expense approval',
      variables,
      steps: Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, label: `Step ${i}`, type: 'http_request', status: 'completed', output: { rows: big(100 + i) } })),
    })
    expect(built.summary.bytes).toBeLessThanOrEqual(WORKFLOW_DATA_LIMITS.maxBytes)
    expect(new TextEncoder().encode(JSON.stringify(built.context)).length).toBe(built.summary.bytes)
    expect(built.summary.truncated).toBe(true)
    expect(built.summary.omitted).toBeGreaterThan(0)
    // The trigger data comes first and survives.
    expect((built.context.trigger.data as any).claim_id).toBe('EXP-1042')
    expect(built.context.truncated?.note).toMatch(/left out/)
    expect(built.context.truncated?.omitted.length).toBeLessThanOrEqual(30)
    expect(built.context.truncated?.omitted[0]).toMatch(/^(variables|steps)\./)
    // The text stays within the cap plus the framing.
    expect(built.text.length).toBeLessThan(WORKFLOW_DATA_LIMITS.maxBytes + 1_500)
  })

  it('survives cycles and odd values', () => {
    const loop: Record<string, unknown> = { name: 'loop' }
    loop.self = loop
    const built = buildWorkflowDataContext({ variables: { loop, fn: () => 1, when: new Date('2026-11-20T00:00:00Z'), big: BigInt(5), nan: Number.NaN } })
    expect(built.context.variables).toEqual({ loop: { name: 'loop', self: '[circular]' }, when: '2026-11-20T00:00:00.000Z', big: '5', nan: null })
  })
})

describe('Which data: only the fields I pick', () => {
  it('reads the picked paths from the step config (list or comma text, {{ }} tolerated)', () => {
    expect(workflowDataFields({ workflow_data_scope: 'fields', workflow_data_fields: ['claim_id', ' amount ', 'claim_id'] })).toEqual(['claim_id', 'amount'])
    expect(workflowDataFields({ workflow_data_scope: 'fields', workflow_data_fields: 'claim_id, {{submission.form.name}}' })).toEqual(['claim_id', 'submission.form.name'])
    expect(workflowDataFields({ workflow_data_fields: ['claim_id'] })).toEqual([])
  })

  it('passes only those values (plus the workflow, ids and initiator), never hidden ones', () => {
    const built = buildWorkflowDataContext({
      variables: claimRun({ api_key: 'k', lines: [{ sku: 'A' }, { sku: 'B' }] }),
      fields: ['claim_id', 'submission.form.name', 'lines.1.sku', 'api_key', '_workflow_inputs', 'missing'],
    })
    expect(built.context.selected).toEqual({ claim_id: 'EXP-1042', 'submission.form.name': 'Expense claim', 'lines.1.sku': 'B', missing: null })
    expect(built.context.variables).toBeUndefined()
    expect(built.context.steps).toBeUndefined()
    expect(built.context.trigger.data).toBeUndefined()
    expect(built.context.related?.task_id).toBe('task-77')
    expect(built.summary).toMatchObject({ scope: 'fields', fields: ['claim_id', 'submission.form.name', 'lines.1.sku', 'missing'] })
    expect(describeWorkflowData(built.summary)).toContain('4 picked fields')
  })
})

describe('readWorkflowDataSummary', () => {
  it('reads a stored summary back, rejects junk', () => {
    expect(readWorkflowDataSummary({ bytes: 2048, truncated: true, scope: 'all', trigger_fields: 3, variables: 2, steps: 1 }))
      .toEqual({ bytes: 2048, truncated: true, scope: 'all', trigger_fields: 3, variables: 2, steps: 1 })
    expect(readWorkflowDataSummary(null)).toBeNull()
    expect(readWorkflowDataSummary({ bytes: '1' })).toBeNull()
  })
})

describe('validation of the step properties', () => {
  const node = (config: Record<string, unknown>) => ({ id: 'n', type: 'run_agent', label: 'Agent', position: { x: 0, y: 0 }, config: { agent_id: 'a', user_message: 'Review', ...config } }) as any
  it('accepts the new properties', () => {
    expect(validateNode(node({ include_workflow_data: true }))).toEqual([])
    expect(validateNode(node({ include_workflow_data: true, workflow_data_scope: 'fields', workflow_data_fields: ['claim_id'] }))).toEqual([])
    expect(validateNode(node({}))).toEqual([])
  })
  it('rejects bad values', () => {
    expect(validateNode(node({ include_workflow_data: 'yes' }))).toContain('Use this workflow\'s data must be true or false')
    expect(validateNode(node({ workflow_data_scope: 'some' }))).toContain('Which data must be all or fields')
    expect(validateNode(node({ include_workflow_data: true, workflow_data_scope: 'fields' }))).toContain('Pick at least one field to pass, or pass all of the workflow\'s data')
  })
})
