import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AFTER_SUBMIT_VARIABLES, FORM_VARIABLE_GROUPS, contextGroups, formVariableScope, type FormVariableContext, type FormVariableGroup,
} from '@/lib/forms/variable-catalog'
import { controlVariables, eventVariables } from '@/lib/forms/rule-variables'
import { FORM_RULE_EVENTS } from '@/lib/forms/form-rules'
import { searchVariables, templateProblems } from '@/lib/variable-picker'
import { CONTROLS_KEY } from '@/lib/forms/form-params'

const orders = {
  key: 'orders', label: 'Orders', type: 'data_table',
  data_table: {
    mode: 'select', source: 'table', table_id: 't1', key_column: 'OrderID', page_size: 5,
    columns: [
      { key: 'OrderID', type: 'number', label: 'Order ID' },
      { key: 'CustomerID', type: 'text', label: 'Customer name' },
      { key: 'Freight', type: 'number', label: 'Total' },
    ],
  },
}
const fields = [
  orders,
  { key: 'customer', label: 'Customer', type: 'lookup', lookup: { source: 'table', table_id: 't2', display_columns: ['city'] } },
  { key: 'notes', label: 'Notes', type: 'text' },
  { key: 'show', label: 'Show', type: 'button' },
]
const layout = {
  mode: 'steps',
  pages: [{ id: 'p1', title: 'Pick' }, { id: 'p2', title: 'Confirm' }],
  rows: [],
  sections: [{ key: 'extra', title: 'Extra', optional: true }],
  params: [{ name: 'region', type: 'text', label: 'Region', default: 'EU' }],
  variables: [{ name: 'chosen', type: 'number', label: 'Chosen order' }],
  state: { flags: [{ key: 'details' }] },
}
const values = { notes: 'Rush', orders: [{ OrderID: 10692, CustomerID: 'ALFKI', Freight: 61.02 }], [CONTROLS_KEY]: { orders: { row_count: 11 } } }
const source = { fields: fields as never, layout, values, now: new Date(2026, 10, 1) }
const rowSelectMessage: FormVariableContext = { kind: 'rule', event: 'row_select', target: 'orders', slot: 'action' }
const paths = (ctx: FormVariableContext) => formVariableScope(source, ctx).items.map((i) => i.path)
const groupsOf = (ctx: FormVariableContext) => [...new Set(formVariableScope(source, ctx).items.filter((i) => !i.hidden).map((i) => i.group))]

describe('the row-selected message case (why the row id was hard to find)', () => {
  const scope = formVariableScope(source, rowSelectMessage)
  it('This event comes first and starts with "Selected row › ID", typed, with the live preview\'s sample', () => {
    expect(scope.items[0]).toMatchObject({ path: 'event.row_id', label: 'Selected row › ID', group: 'This event', type: 'text', sample: '10692' })
    const cols = scope.items.filter((i) => i.parent === 'event.row')
    expect(cols.map((c) => [c.path, c.label, c.type, c.sample])).toEqual([
      ['event.row.OrderID', 'Selected row › Order ID', 'number', 10692],
      ['event.row.CustomerID', 'Selected row › Customer name', 'text', 'ALFKI'],
      ['event.row.Freight', 'Selected row › Total', 'number', 61.02],
    ])
  })
  it('no workflow-only variables (task_id, Status values…) crowd the list', () => {
    expect(scope.items.some((i) => /^(task_id|_title|completed|api_response)$/.test(i.path))).toBe(false)
  })
  it('"row id", "rowid" and "order id" find it', () => {
    expect(searchVariables(scope.items, 'row id')[0].path).toBe('event.row_id')
    expect(searchVariables(scope.items, 'rowid')[0].path).toBe('event.row_id')
    expect(searchVariables(scope.items, 'order id')[0].path).toBe('event.row_id')
  })
  it('the Controls equivalents are labelled for designers', () => {
    expect(scope.items.find((i) => i.path === 'control.orders.selected_row_id')).toMatchObject({ label: 'Orders › Selected row › ID', group: 'Controls', sample: '10692' })
    expect(scope.items.find((i) => i.path === 'control.orders.selected_row.Freight')).toMatchObject({ label: 'Orders › Selected row › Total', parent: 'control.orders.selected_row' })
    expect(scope.items.find((i) => i.path === 'control.orders.row_count')).toMatchObject({ label: 'Orders › Row count', sample: 11 })
  })
  it('the stored message is valid here', () => {
    expect(templateProblems('Order {{event.row_id}} ({{event.row.CustomerID}}) of {{control.orders.row_count}}', scope)).toEqual([])
  })
  it('the event\'s table falls back to the only Data table when none is picked', () => {
    expect(paths({ kind: 'rule', event: 'row_select', slot: 'action' })).toContain('event.row.Freight')
  })
})

describe('paths stay in step with what the runtime fills', () => {
  it('This event lists exactly eventVariables for every event', () => {
    for (const event of FORM_RULE_EVENTS) {
      const listed = formVariableScope(source, { kind: 'rule', event, target: event === 'item_select' ? 'customer' : 'orders', slot: 'condition' }).items.filter((i) => i.group === 'This event').map((i) => i.path).sort()
      expect(listed, event).toEqual(eventVariables(event, event === 'item_select' ? 'customer' : 'orders', fields as never).map((v) => v.path).sort())
    }
  })
  it('Controls + Sections cover every controlVariables path', () => {
    const listed = new Set(paths({ kind: 'button' }))
    for (const v of controlVariables(fields as never, layout.pages, layout.sections)) expect(listed.has(v.path), v.path).toBe(true)
  })
})

describe('context-aware groups', () => {
  it('every kind of input gets each group its runtime fills (and only those)', () => {
    const contexts: FormVariableContext[] = [
      { kind: 'rule', event: 'row_select', target: 'orders', slot: 'condition' }, rowSelectMessage, { kind: 'button' }, { kind: 'header' },
      { kind: 'default' }, { kind: 'bar' }, { kind: 'table_query', exclude: 'orders' }, { kind: 'lookup_query', exclude: 'customer' }, { kind: 'table_changes' },
    ]
    for (const ctx of contexts) expect(groupsOf(ctx).sort(), JSON.stringify(ctx)).toEqual([...contextGroups(ctx)].sort())
  })
  it('a rule condition reads all nine groups', () => {
    expect(contextGroups({ kind: 'rule', event: 'row_select', slot: 'condition' })).toEqual([...FORM_VARIABLE_GROUPS])
  })
  it('a Button\'s steps: no This event, a note pointing at Controls, the event path warned with its equivalent', () => {
    const scope = formVariableScope(source, { kind: 'button' })
    expect(scope.items.some((i) => i.path.startsWith('event.'))).toBe(false)
    expect(scope.note).toMatch(/aren't available in a Button's steps.*Orders › Selected row › ID/)
    expect(templateProblems('{{event.row_id}}', scope)[0].problem).toMatch(/Button's steps.*\{\{control\.orders\.selected_row_id\}\}/)
    expect(templateProblems('{{control.orders.selected_row_id}} {{notes}} {{param.region}}', scope)).toEqual([])
  })
  it('fields are written the way each input resolves them', () => {
    expect(paths({ kind: 'rule', event: 'form_load' })).toContain('notes')
    expect(paths({ kind: 'table_query', exclude: 'orders' })).toContain('form.notes')
    expect(paths({ kind: 'lookup_query', exclude: 'customer' })).toContain('task_data.notes')
    // A Data table's own query doesn't list the table itself.
    expect(paths({ kind: 'table_query', exclude: 'orders' }).some((p) => p.startsWith('control.orders.'))).toBe(false)
  })
  it('local extras come first and keep their own groups', () => {
    const scope = formVariableScope(source, { kind: 'bar' }, AFTER_SUBMIT_VARIABLES)
    expect(scope.items[0]).toMatchObject({ path: 'run_reference', group: 'After submit' })
    expect(templateProblems('Ref {{run_reference}}', scope)).toEqual([])
  })
})

describe('wrong-context warnings', () => {
  it('event.row_id in a "Form loads" rule', () => {
    const scope = formVariableScope(source, { kind: 'rule', event: 'form_load', slot: 'action' })
    const [p] = templateProblems('Row {{event.row_id}}', scope)
    expect(p.problem).toMatch(/“Form loads” rules have no \{\{event\.row_id\}\}.*Orders › Selected row › ID/)
  })
  it('unknown column, control, field, parameter; dates and flags where they are not filled', () => {
    const action = formVariableScope(source, rowSelectMessage)
    const problems = (t: string) => templateProblems(t, action).map((p) => p.problem)
    expect(problems('{{event.row.Nope}}')[0]).toMatch(/Orders has no column “Nope”/)
    expect(problems('{{control.ghost.value}}')[0]).toMatch(/No control “ghost”/)
    expect(problems('{{control.orders.selected_row.Nope}}')[0]).toMatch(/no column “Nope”/)
    expect(problems('{{nofield}}')[0]).toMatch(/No field “nofield”/)
    expect(problems('{{param.nope}}')[0]).toMatch(/No parameter “nope”/)
    expect(problems('{{today}}')[0]).toMatch(/Dates aren't filled in here/)
    expect(problems('{{state.details}}')[0]).toMatch(/Flags aren't filled in here/)
    // Fine: older event names, expressions, a lookup's label key.
    expect(problems('{{event.key}} {{= UPPER(notes) }} {{customer_label}}')).toEqual([])
  })
  it('the same paths are fine where they resolve', () => {
    const condition = formVariableScope(source, { kind: 'rule', event: 'row_select', target: 'orders', slot: 'condition' })
    expect(templateProblems('{{today}} {{state.details}} {{section.extra.visible}} {{user.email}}', condition)).toEqual([])
  })
})

/* ── Regression: every placeholder input in the forms designer gets a context-aware scope ── */

const ROOT = path.resolve(__dirname, '..')
function tsxUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? tsxUnder(full) : name.endsWith('.tsx') ? [full] : []
  })
}

/**
 * Each forms file that draws a VariableInput, and the scope its inputs read:
 * the contexts it sets itself, or the editors that render it (and set one).
 * A new file with a VariableInput fails here until it is listed — with the
 * scope its runtime resolves.
 */
const EDITORS: Record<string, { sets?: string[]; renderedBy?: string[]; workflow?: true }> = {
  'designer/form-designer.tsx': { sets: ["kind: 'header'"] },
  'designer/rules-panel.tsx': { sets: ["kind: 'rule', event: rule.event, target: rule.target, slot: 'condition'", "kind: 'rule', event: rule.event, target: rule.target, slot: 'action'", "kind: 'bar'"] },
  'designer/button-properties.tsx': { sets: ["kind: 'button'"] },
  'designer/field-properties.tsx': { sets: ["kind: 'default'"] },
  'designer/form-settings.tsx': { sets: ["kind: 'bar'"] },
  'designer/submitted-page-editor.tsx': { sets: ["kind: 'bar'"] },
  // The Task completed screen's wording (task forms): its own placeholders only (lib/tasks/completion-screen.ts).
  'designer/task-completed-editor.tsx': { sets: ["kind: 'task_completed'"] },
  'designer/data-table-properties.tsx': { sets: ["kind: 'table_query', exclude: field.key"] },
  'designer/lookup-properties.tsx': { sets: ["kind: 'lookup_query', exclude: field.key"] },
  'designer/table-changes-editor.tsx': { sets: ["kind: 'table_changes'"] },
  'designer/dynamic-value-editor.tsx': { sets: ["kind: 'dynamic_value', exclude: field.key"] },
  // A Label's expression (lib/forms/label-field.ts): fields, controls (rows, columns), parameters, variables, functions.
  'designer/label-properties.tsx': { sets: ["kind: 'expression', exclude: field.key"] },
  // Messages / questions and Set a variable: drawn inside a rule's Then or a Button's On click.
  'designer/message-editor.tsx': { renderedBy: ['designer/button-properties.tsx'] },
  'designer/set-variable-editor.tsx': { renderedBy: ['designer/rules-panel.tsx'] },
  'designer/call-reference-editor.tsx': { renderedBy: ['designer/rules-panel.tsx'] },
  'designer/data-action-editor.tsx': { renderedBy: ['designer/rules-panel.tsx'] },
  'designer/list-action-editor.tsx': { renderedBy: ['designer/rules-panel.tsx'] },
  // A workflow step's form parameters (workflow designer): the workflow lists.
  'node-form-section.tsx': { workflow: true },
}

describe('regression: no forms-designer input falls back to the workflow lists', () => {
  const formsDir = path.join(ROOT, 'components/forms')
  const files = tsxUnder(formsDir).filter((f) => /<VariableInput\b/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(formsDir, f))

  it('every file drawing a VariableInput is registered with its scope', () => {
    expect(files.length).toBeGreaterThan(5)
    for (const f of files) expect(EDITORS[f], `${f}: register it in EDITORS with the scope its inputs read`).toBeDefined()
  })

  it('each editor sets its context-aware scope (or is drawn only inside one that does)', () => {
    for (const [file, spec] of Object.entries(EDITORS)) {
      const text = readFileSync(path.join(formsDir, file), 'utf8')
      expect(text, file).not.toMatch(/scope=\{null\}/)
      for (const ctx of spec.sets ?? []) {
        expect(text, file).toContain('<DesignerVariableScope')
        expect(text.includes(ctx), `${file}: ${ctx}`).toBe(true)
      }
      for (const parent of spec.renderedBy ?? []) {
        const name = path.basename(file, '.tsx')
        expect(readFileSync(path.join(formsDir, parent), 'utf8'), `${parent} renders ${file}`).toContain(`./${name}'`)
        expect(EDITORS[parent].sets?.length, parent).toBeGreaterThan(0)
      }
    }
  })

  it('the designer wraps its whole properties panel in a base scope', () => {
    const dialog = readFileSync(path.join(formsDir, 'designer/form-designer.tsx'), 'utf8')
    const at = dialog.indexOf("<DesignerVariableScope state={state} context={{ kind: 'header' }}>")
    expect(at).toBeGreaterThan(0)
    expect(dialog.indexOf('id={`designer-panel-${tab}`}', at)).toBeGreaterThan(at)
    expect(dialog.indexOf('<RulesPanel', at)).toBeGreaterThan(at)
    expect(dialog.indexOf('<FieldProperties', at)).toBeGreaterThan(at)
    expect(dialog.indexOf('<FormSettings', at)).toBeGreaterThan(at)
  })

  it('every scoped kind lists every one of its groups for a form that has them', () => {
    const kinds: FormVariableContext[] = [
      { kind: 'rule', event: 'row_select', target: 'orders', slot: 'condition' }, { kind: 'rule', event: 'row_select', target: 'orders', slot: 'action' },
      { kind: 'button' }, { kind: 'header' }, { kind: 'default' }, { kind: 'bar' }, { kind: 'table_query' }, { kind: 'lookup_query' }, { kind: 'table_changes' }, { kind: 'expression' }, { kind: 'dynamic_value' }, { kind: 'task_completed' },
    ]
    for (const ctx of kinds) {
      const got = new Set(groupsOf(ctx))
      for (const g of contextGroups(ctx)) expect(got.has(g as FormVariableGroup), `${JSON.stringify(ctx)} → ${g}`).toBe(true)
    }
  })
})
