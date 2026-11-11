import { describe, expect, it } from 'vitest'
import { analyzeInfoPath } from '@/lib/infopath/analyze'
import { generateForms, reportMarkdown, negateText } from '@/lib/infopath/generate'
import { validateFormContent } from '@/lib/services/forms'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import type { FormRule } from '@/lib/forms/form-rules'
import { fixtureXsn } from './helpers/infopath-fixtures'

const NOW = '2026-11-11T00:00:00.000Z'
const expense = (opts = {}) => generateForms(analyzeInfoPath(fixtureXsn('expense-report'), { fileName: 'Expense Report.xsn' }), { now: NOW, ...opts })
const leave = (opts = {}) => generateForms(analyzeInfoPath(fixtureXsn('leave-request'), { fileName: 'Leave Request.xsn' }), { now: NOW, ...opts })
const field = (fields: TaskFieldDef[], key: string) => fields.find((f) => f.key === key)!
const rule = (rules: FormRule[] | undefined, name: string) => rules!.find((r) => r.name === name)!

describe('InfoPath generator — fields and layout', () => {
  const { forms, report } = expense()
  const form = forms[0]
  const fields = form.input.fields

  it('makes one valid form, named and tagged, with provenance', () => {
    expect(forms).toHaveLength(1)
    expect(form.name).toBe('Expense Report')
    expect(form.input.tags).toEqual(['expense-report', 'infopath'])
    expect(form.input.layout.source).toEqual({ kind: 'infopath', file_name: 'Expense Report.xsn', hash: expect.stringMatching(/^[0-9a-f]{64}$/), mode: 'per_view', imported_at: NOW, view: 'Expense Report' })
    expect(() => validateFormContent({ fields: form.input.fields, layout: form.input.layout })).not.toThrow()
    expect(report.summary).toMatchObject({ views: 1, forms: 1, repeating: 1 })
  })

  it('maps control types, required, patterns, defaults and options', () => {
    expect(field(fields, 'employee_name')).toMatchObject({ type: 'text', required: true, help_text: 'Your full name' })
    expect(field(fields, 'email')).toMatchObject({ type: 'email', required: true })
    expect(field(fields, 'department')).toMatchObject({ type: 'choice', options: ['Operations', 'Sales', 'Engineering'], default: 'Operations' })
    expect(field(fields, 'cost_center')).toMatchObject({ type: 'text', pattern: '^(?:[A-Z]{2}-\\d{4})$' })
    expect(field(fields, 'report_date').type).toBe('date')
    expect(field(fields, 'purpose').type).toBe('textarea')
    expect(field(fields, 'receipts').type).toBe('attachments')
    expect(field(fields, 'status')).toMatchObject({ type: 'text', default: 'Draft' })
    expect(field(fields, 'btn_submit_report')).toMatchObject({ type: 'button', label: 'Submit report' })
    // Options from a data connection: a text field (and a report item).
    expect(field(fields, 'project').type).toBe('text')
    expect(report.items.find((i) => i.area === 'field' && i.name === 'Project')).toMatchObject({ status: 'manual' })
  })

  it('turns the repeating table into a List with typed columns, a calculated column and a total', () => {
    const list = field(fields, 'line_items')
    expect(list.type).toBe('list')
    expect(list.list!.entry_mode).toBe('inline')
    expect(list.list!.columns.map((c) => [c.key, c.type])).toEqual([
      ['expense_date', 'date'], ['description', 'text'], ['category', 'choice'], ['quantity', 'number'], ['unit_price', 'currency'], ['line_total', 'calculated'],
    ])
    expect(list.list!.columns.find((c) => c.key === 'line_total')!.formula).toBe('(quantity * unit_price)')
    expect(list.list!.columns.find((c) => c.key === 'category')).toMatchObject({ options: ['Travel', 'Meals', 'Lodging', 'Other'], default: 'Travel' })
    expect(list.list!.columns.find((c) => c.key === 'unit_price')).toMatchObject({ currency: 'USD', min: 0 }) // ". < 0" validation → min 0
    expect(field(fields, 'total')).toMatchObject({ type: 'label', label_config: { expression: 'SUM(PLUCK({{form.line_items}}, "line_total"))', include: true } })
  })

  it('keeps the rough grid: layout rows and columns follow the InfoPath table', () => {
    const rows = form.input.layout.rows.map((r) => r.cells.map((c) => c.field_key))
    expect(rows).toContainEqual(['employee_name', 'email'])
    expect(rows).toContainEqual(['department', 'cost_center'])
    expect(rows).toContainEqual(['line_items'])
    expect(rows[0]).toEqual(['heading_expense_report'])
  })
})

describe('InfoPath generator — rules', () => {
  const { forms, report } = expense()
  const rules = forms[0].input.layout.rules

  it('converts conditional formatting to Always rules', () => {
    expect(rule(rules, 'Hide: Manager email (Hide for small reports)')).toMatchObject({ event: 'always', if: { match: 'all', conditions: [{ column: 'total', operator: 'lte', value: '1000' }] }, then: [{ type: 'show_hide', mode: 'hide', targets: ['field:manager_email'] }] })
    expect(rule(rules, 'Read only: Status')).toMatchObject({ then: [{ type: 'read_only', mode: 'read_only', targets: ['field:status'] }] })
    expect(report.items.find((i) => i.area === 'formatting' && i.status === 'skipped')?.detail).toMatch(/styling/)
  })

  it('converts field, button and load rules with their actions', () => {
    expect(rule(rules, 'Sales cost center')).toMatchObject({ event: 'value_change', target: 'department', if: { conditions: [{ column: 'department', operator: 'eq', value: 'Sales' }] }, then: [{ type: 'set_values', assign: { cost_center: 'SA-1000' } }] })
    expect(rule(rules, 'Large report warning')).toMatchObject({ event: 'button_click', target: 'btn_submit_report', then: [{ type: 'message', text: 'Reports over USD 5,000 need director approval.' }] })
    expect(rule(rules, 'Submit the report')).toMatchObject({ event: 'button_click', then: [{ type: 'set_values', assign: { status: 'Submitted' } }, { type: 'submit' }] })
    expect(rule(rules, 'Submit the report').disabled).toBeUndefined()
    expect(rule(rules, 'Default: Report date')).toMatchObject({ event: 'form_load', then: [{ type: 'set_values', assign: { report_date: '{{=TODAY()}}' } }] })
  })

  it('keeps what does not translate as disabled rules with the original in the notes', () => {
    const role = rule(rules, 'Managers see status')
    expect(role.disabled).toBe(true)
    expect(role.description).toMatch(/user role/)
    expect(role.description).toContain('xdXDocument:get-Role() = "Manager"')
    const query = rule(rules, 'Refresh projects')
    expect(query).toMatchObject({ disabled: true, then: [{ type: 'message' }] })
    expect(query.description).toMatch(/queries the data connection "Projects"/)
    expect(report.summary.rules).toEqual({ total: 5, converted: 3, partial: 0, manual: 2 })
    expect(report.items.filter((i) => i.area === 'role')).toHaveLength(2)
  })

  it('uses a matching data table for a query', () => {
    const { forms: f } = expense({ connections: { Projects: { table_id: 't-1', table_name: 'Projects' } } })
    expect(rule(f[0].input.layout.rules, 'Refresh projects')).toMatchObject({ then: [{ type: 'table_list', table_id: 't-1' }] })
    expect(rule(f[0].input.layout.rules, 'Refresh projects').disabled).toBeUndefined()
  })

  it('converts validation: always-rule errors, required, and leaves the rest disabled', () => {
    const { forms: f } = leave()
    const r = f[0].input.layout.rules
    expect(rule(r, 'Validate: The end date must be on or after the start date')).toMatchObject({ event: 'always', if: { conditions: [{ column: 'end_date', operator: 'lt', value: '{{form.start_date}}' }] }, then: [{ type: 'field_error', field: 'end_date' }] })
    expect(rule(r, 'Validate: Explain unpaid leave in a sentence')).toMatchObject({ disabled: true })
    expect(field(f[0].input.fields, 'start_date').required).toBe(true)
  })
})

describe('InfoPath generator — views and modes', () => {
  it('makes one form per view with switch view kept as a note', () => {
    const { forms, report } = leave()
    expect(forms.map((f) => f.name)).toEqual(['Leave Request — Leave request', 'Leave Request — Manager approval'])
    for (const f of forms) expect(() => validateFormContent({ fields: f.input.fields, layout: f.input.layout })).not.toThrow()
    const request = forms[0]
    expect(field(request.input.fields, 'leave_type')).toMatchObject({ type: 'choice', display: 'radio', options: ['Annual', 'Sick', 'Unpaid'], option_labels: { Annual: 'Annual leave', Sick: 'Sick leave', Unpaid: 'Unpaid leave' }, default: 'Annual' })
    expect(field(request.input.fields, 'call_time')).toMatchObject({ type: 'text', pattern: expect.stringContaining('[0-5]') })
    expect(field(request.input.fields, 'days')).toMatchObject({ type: 'number', min: 0.5, max: 60 })
    // The optional section with its show condition.
    expect(request.input.layout.sections).toEqual([{ key: 'medical_details', title: 'Medical details', optional: true }])
    expect(rule(request.input.layout.rules, 'Hide: Medical details')).toMatchObject({ event: 'always', if: { conditions: [{ column: 'leave_type', operator: 'neq', value: 'Sick' }] }, then: [{ type: 'show_hide', mode: 'hide', targets: ['section:medical_details'] }] })
    const send = rule(request.input.layout.rules, 'Send for approval')
    expect(send.then).toEqual([{ type: 'set_values', assign: { status: 'Pending approval' } }])
    expect(send.description).toMatch(/switches to the view "Approval"/)
    expect(report.items.find((i) => i.area === 'rule' && i.name.startsWith('Send for approval'))?.status).toBe('partial')
    // The approval view's fields not shown on it but used by its rules are added hidden.
    const approval = forms[1]
    expect(approval.input.layout.state?.hidden).toEqual(expect.arrayContaining(['field:status']))
    expect(rule(approval.input.layout.rules, 'Record the decision').then).toEqual([{ type: 'set_values', assign: { approved_on: '{{=TODAY()}}', status: '{{=CONCAT({{form.decision}}, " by manager")}}' } }])
    expect(rule(approval.input.layout.rules, 'Default for Full name' as string)).toBeUndefined()
  })

  it('combines views as steps: switch view becomes go to step, a field sits once', () => {
    const { forms } = leave({ mode: 'combined' })
    expect(forms).toHaveLength(1)
    const f = forms[0]
    expect(f.input.layout.mode).toBe('steps')
    expect(f.input.layout.pages!.map((p) => [p.id, p.title])).toEqual([['step_1', 'Leave request'], ['step_2', 'Manager approval']])
    expect(() => validateFormContent({ fields: f.input.fields, layout: f.input.layout })).not.toThrow()
    expect(rule(f.input.layout.rules, 'Send for approval').then).toEqual([{ type: 'set_values', assign: { status: 'Pending approval' } }, { type: 'go_to_page', page: 'step_2' }])
    expect(rule(f.input.layout.rules, 'Back to the request')).toMatchObject({ then: [{ type: 'go_to_page', page: 'step_1' }] })
    // start_date is on step 1; step 2 shows a read-only Label of it.
    expect(f.input.fields.filter((x) => x.key === 'start_date')).toHaveLength(1)
    expect(f.input.fields.find((x) => x.type === 'label' && x.label_config?.expression === '{{form.start_date}}')).toBeTruthy()
    expect(f.input.layout.source).toMatchObject({ mode: 'combined' })
    expect(f.input.layout.source!.view).toBeUndefined()
  })

  it('imports only the chosen views and reports the others', () => {
    const { forms, report } = leave({ views: ['Approval'] })
    expect(forms.map((f) => f.view)).toEqual(['Approval'])
    expect(report.items.find((i) => i.area === 'view' && i.id === 'view:Request')?.status).toBe('skipped')
  })

  it('writes a Markdown report', () => {
    const md = reportMarkdown(expense().report)
    expect(md).toContain('# InfoPath import: Expense Report')
    expect(md).toMatch(/Rules: 3 of 5 converted/)
    expect(md).toContain('Original: `if xdXDocument:get-Role() = "Manager"')
  })

  it('negates show conditions without double not()', () => {
    expect(negateText('not(a = 1)')).toBe('a = 1')
    expect(negateText('not(a) and not(b)')).toBe('not(not(a) and not(b))')
    expect(negateText('a = 1')).toBe('not(a = 1)')
  })
})
