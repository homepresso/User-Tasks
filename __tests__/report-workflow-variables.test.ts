import { describe, expect, it } from 'vitest'
import {
  definitionVariableColumns,
  isTaskFieldColumnKey,
  mergeVariableColumns,
  storedVariableColumns,
  workflowIdOfSourceInputs,
} from '@/lib/report-workflow-variables'
import {
  assertReportSourceAccess,
  configReadsRunVariables,
  inspectReportConfigIssues,
  isScopedVariableColumnKey,
  matchesTypedFilterValue,
} from '@/lib/mcp/tools/reports'
import { getReportValue, reportResultColumnLabel } from '@/lib/report-sources'

const definition = {
  user_variables: [
    { name: 'amount', type: 'number', defaultValue: '0' },
    { name: 'due', type: 'date', defaultValue: '' },
    { name: 'region', type: 'string', defaultValue: 'North' },
    { name: 'api_token', type: 'string', defaultValue: '' },
  ],
  nodes: [
    { id: 'start', type: 'manual', label: 'Start', config: {} },
    {
      id: 'approve', type: 'user_task', label: 'Approve',
      config: {
        fields: [
          { id: 'f1', key: 'approved_amount', label: 'Approved amount', type: 'number' },
          { id: 'f2', key: 'decision_date', label: 'Decision date', type: 'date' },
          { id: 'f3', key: 'urgent', label: 'Urgent', type: 'boolean' },
          { id: 'f4', key: 'receipts', label: 'Receipts', type: 'attachments' },
          { id: 'f5', key: 'vendor', label: 'Vendor', type: 'lookup', lookup: { source: 'table', table_id: '00000000-0000-4000-8000-000000000001', display_columns: ['name'], value_column: 'code' } },
        ],
      },
    },
    { id: 'score', type: 'set_variable', label: 'Score', config: { name: 'score', expression: '{{=MULTIPLY(amount, 2)}}' } },
    { id: 'total', type: 'math', label: 'Total', config: { output_var: 'total' } },
    { id: 'call', type: 'http_request', label: 'Call API', config: {} },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'approve' },
    { id: 'e2', source: 'approve', target: 'score' },
    { id: 'e3', source: 'score', target: 'total' },
    { id: 'e4', source: 'total', target: 'call' },
  ],
}

describe('workflow variable columns from the definition', () => {
  const columns = definitionVariableColumns(definition)
  const byKey = Object.fromEntries(columns.map((column) => [column.key, column]))

  it('lists the inputs, typed from their declarations, without credential-like ones', () => {
    expect(byKey['vars.amount']).toMatchObject({ type: 'number', group: 'Workflow inputs' })
    expect(byKey['vars.due']).toMatchObject({ type: 'date' })
    expect(byKey['vars.region']).toMatchObject({ type: 'text' })
    expect(byKey['vars.api_token']).toBeUndefined()
  })

  it('lists task form fields with their types, attachment counts and lookup item fields', () => {
    expect(byKey['vars.task_data.approved_amount']).toMatchObject({ type: 'number', label: 'Approved amount' })
    expect(byKey['vars.task_data.decision_date']).toMatchObject({ type: 'date' })
    expect(byKey['vars.task_data.urgent']).toMatchObject({ type: 'boolean' })
    expect(byKey['vars.task_data.receipts']).toBeUndefined() // the files themselves are not stored
    expect(byKey['vars.task_data.receipts_count']).toMatchObject({ type: 'number' })
    expect(byKey['vars.task_data.vendor']).toBeDefined()
    expect(byKey['vars.task_data.vendor_item.name']).toBeDefined()
    expect(byKey['vars.task_data.vendor_item.code']).toBeDefined()
  })

  it('lists scalar step outputs and skips responses', () => {
    expect(byKey['vars.score']).toBeDefined()
    expect(byKey['vars.total']).toMatchObject({ type: 'number' })
    expect(byKey['vars.outcome']).toBeDefined()
    expect(byKey['vars.call_api_response']).toBeUndefined()
    expect(byKey['vars.call_api_status']).toMatchObject({ type: 'number' })
  })

  it('lists Form submitted values under form.*', () => {
    const formColumns = definitionVariableColumns({
      nodes: [{ id: 't', type: 'form_submitted', label: 'Form', config: { form_name: 'Expense', fields: [{ id: 'a', key: 'cost', label: 'Cost', type: 'currency' }] } }],
      edges: [],
    })
    const keys = formColumns.map((column) => column.key)
    expect(keys).toContain('vars.form.cost')
    expect(keys).toContain('vars.submitted_by_email')
    expect(formColumns.find((column) => column.key === 'vars.form.cost')?.type).toBe('number')
    expect(formColumns.find((column) => column.key === 'vars.submitted_at')?.type).toBe('date')
    expect(keys).not.toContain('vars.form')
  })
})

describe('stored variables refine and extend the columns', () => {
  it('types untyped definition columns from values and adds stored-only ones', () => {
    const stored = storedVariableColumns([
      { score: 10, extra: 'x', when: '2026-10-01', task_id: 'ignored' },
      { score: 12, extra: 'y' },
    ])
    expect(stored.columns.map((column) => column.key)).toEqual(['vars.score', 'vars.extra', 'vars.when'])
    const merged = mergeVariableColumns(definitionVariableColumns(definition), stored)
    const byKey = Object.fromEntries(merged.map((column) => [column.key, column]))
    expect(byKey['vars.score'].type).toBe('number') // Set Variable is untyped in the definition
    expect(byKey['vars.amount'].type).toBe('number')
    expect(byKey['vars.extra']).toMatchObject({ type: 'text', group: 'Stored on runs' })
    expect(byKey['vars.when'].type).toBe('date')
  })
})

describe('report config handling of variable columns', () => {
  it('validates workflow ids and column keys', () => {
    expect(workflowIdOfSourceInputs({ workflow_id: '0d5e0000-0000-4000-8000-0000000000a1' })).toBe('0d5e0000-0000-4000-8000-0000000000a1')
    expect(workflowIdOfSourceInputs({ workflow_id: "x' or 1=1" })).toBeNull()
    expect(isTaskFieldColumnKey('fields.amount')).toBe(true)
    expect(isScopedVariableColumnKey('workflow_runs', 'vars.amount')).toBe(true)
    expect(isScopedVariableColumnKey('tasks', 'fields.amount')).toBe(true)
    expect(isScopedVariableColumnKey('tasks', 'vars.amount')).toBe(false)
    expect(isScopedVariableColumnKey('agent_runs', 'vars.amount')).toBe(false)
  })

  it('accepts variable columns on workflow runs in saved configs', () => {
    const { issues } = inspectReportConfigIssues({
      data_source: 'workflow_runs',
      source_inputs: { workflow_id: '0d5e0000-0000-4000-8000-0000000000a1' },
      columns: ['vars.region', 'SUM_vars.amount'],
      group_by: ['vars.region'],
      aggregations: [{ field: 'vars.amount', fn: 'SUM' }],
      filters: [{ field: 'vars.amount', operator: 'gt', value: '100' }],
      visualization: 'bar',
    })
    expect(issues).toEqual([])
    expect(inspectReportConfigIssues({ data_source: 'agent_runs', columns: ['vars.x'] }).issues).toContain('Unknown report column: vars.x')
  })

  it('needs workflows.view to read variable values', () => {
    const config = { data_source: 'workflow_runs', columns: ['status', 'vars.amount'] }
    expect(configReadsRunVariables(config as any)).toBe(true)
    // The workflow_runs source itself needs workflows.view_runs (governance audit 2026-11).
    const runs = ['reports.view', 'workflows.view_runs']
    expect(() => assertReportSourceAccess(config as any, runs)).toThrow(/workflows\.view/)
    expect(() => assertReportSourceAccess(config as any, [...runs, 'workflows.view'])).not.toThrow()
    expect(() => assertReportSourceAccess({ data_source: 'workflow_runs', columns: ['status'] } as any, runs)).not.toThrow()
    expect(() => assertReportSourceAccess({ data_source: 'workflow_runs', columns: ['status'] } as any, ['reports.view'])).toThrow(/workflows\.view_runs/)
    const joined = { data_source: 'tasks', columns: ['title'], joins: [{ source: 'workflow_runs', alias: 'run', local_field: 'id', foreign_field: 'task_id', columns: ['vars.amount'] }] }
    expect(() => assertReportSourceAccess(joined as any, [...runs, 'tasks.view_all'])).toThrow(/workflows\.view/)
    // Unrestricted (session RLS-only callers that pass no permissions) are not gated here.
    expect(() => assertReportSourceAccess(config as any, null)).not.toThrow()
  })

  it('compares typed variables as numbers / booleans', () => {
    expect(matchesTypedFilterValue('120', { field: 'vars.amount', operator: 'gt', value: '100' }, 'number')).toBe(true)
    expect(matchesTypedFilterValue(90, { field: 'vars.amount', operator: 'gt', value: '100' }, 'number')).toBe(false)
    expect(matchesTypedFilterValue(9, { field: 'vars.amount', operator: 'gt', value: '10' }, 'number')).toBe(false)
    expect(matchesTypedFilterValue(true, { field: 'vars.ok', operator: 'eq', value: 'true' }, 'boolean')).toBe(true)
    expect(matchesTypedFilterValue(null, { field: 'vars.amount', operator: 'is_null', value: null }, 'number')).toBe(true)
  })

  it('reads flat variable keys, joined flat keys and dotted paths', () => {
    expect(getReportValue({ 'vars.amount': 5 }, 'vars.amount')).toBe(5)
    expect(getReportValue({ run: { 'vars.amount': 7 } }, 'run.vars.amount')).toBe(7)
    expect(getReportValue({ workflow: { name: 'W' } }, 'workflow.name')).toBe('W')
  })
})

describe('result column labels', () => {
  const columns = [{ key: 'vars.task_data.approved_amount', label: 'Approved amount' }, { key: 'vars.region', label: 'Region' }]
  it('labels aggregates of variable columns from the column label', () => {
    expect(reportResultColumnLabel('vars.region', columns)).toBe('Region')
    expect(reportResultColumnLabel('SUM_vars.task_data.approved_amount', columns)).toBe('Sum of Approved amount')
    expect(reportResultColumnLabel('AVG_vars.score', columns)).toBe('Average of score')
    expect(reportResultColumnLabel('COUNT_id', [...columns, { key: 'id', label: 'ID' }])).toBe('Count')
    expect(reportResultColumnLabel('data_unit_price', columns)).toBe('unit price')
  })
})
