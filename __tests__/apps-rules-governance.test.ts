import { describe, expect, it } from 'vitest'
import { appBindings, formParamUses, presentLayout, presentRules, referencedIds, ruleBindings, type ObjectFacts } from '@/lib/apps/governance'
import { appRuleSchema } from '@/lib/apps/rules'
import { rulesWarnings } from '@/lib/services/app-access'
import { normalisePageLayout } from '@/lib/apps/schema'

const T = '33333333-3333-4333-8333-333333333333'
const REF = '55555555-5555-4555-8555-555555555555'
const FORM = '11111111-1111-4111-8111-111111111111'
const WF = '22222222-2222-4222-8222-222222222222'

const rule = appRuleSchema.parse({
  id: 'r1', name: 'Credit', when: { type: 'row_click' }, then: [
    { type: 'table_lookup', table_id: T, row_id: '{{event.row.id}}' },
    { type: 'call_reference', reference_id: REF, inputs: {} },
    { type: 'confirm', title: 'Go?', then: [{ type: 'start_workflow', workflow_id: WF, inputs: {} }], else: [] },
    { type: 'open_target', target: { kind: 'form', form_id: FORM, params: {} } },
  ],
})

const facts = (perms: string[], grants: string[] = []): ObjectFacts => ({
  can: (p) => perms.includes(p), formGrants: new Set(grants), visibleReports: new Set(),
  exists: { form: new Set([FORM]), workflow: new Set([WF]), data_table: new Set([T]), report: new Set(), reference: new Set([REF]) },
})

describe('rules and governance', () => {
  it('binds every object a rule uses', () => {
    const b = ruleBindings([rule], 'Home')
    expect(b.map((x) => `${x.kind}:${x.need}:${x.action}`)).toEqual(['data_table:view:false', 'reference:view:false', 'workflow:start:true', 'form:submit:true'])
    const ids = referencedIds([{ widgets: [], rules: [rule] }], [])
    expect(ids.reference).toEqual([REF])
    expect(appBindings([], [], [rule]).objects).toHaveLength(4)
    expect(formParamUses([{ title: 'Home', layout: { widgets: [], rules: [rule] } }], []).map((u) => u.form)).toEqual([FORM])
  })

  it('replaces actions a viewer cannot use with no-ops, keeping positions', () => {
    const viewer = presentRules([rule], facts(['data.view', 'forms.submit'], [FORM]), 'viewer')[0]
    expect(viewer.then.map((a) => a.type)).toEqual(['table_lookup', 'noop', 'confirm', 'noop'])
    expect((viewer.then[2] as { then: Array<{ type: string }> }).then[0].type).toBe('noop')
    const contributor = presentRules([rule], facts(['data.view', 'integrations.view', 'workflows.view', 'workflows.activate', 'forms.edit']), 'contributor')[0]
    expect(contributor.then.map((a) => a.type)).toEqual(['table_lookup', 'call_reference', 'confirm', 'open_target'])
    const layout = presentLayout(normalisePageLayout({ widgets: [], rules: [rule], variables: [{ name: 'rowId' }] }), facts([]), 'viewer')
    expect(layout.variables?.[0].name).toBe('rowId')
    expect(layout.rules?.[0].then.every((a) => a.type === 'noop' || a.type === 'confirm')).toBe(true)
  })

  it('access analysis warns about rules referencing unknown things', () => {
    const r = appRuleSchema.parse({ id: 'r2', when: { type: 'row_click', widget: 'gone' }, then: [{ type: 'set_variable', values: [{ name: 'ghost', value: '1' }] }, { type: 'navigate', page_slug: 'details' }] })
    const pages = [
      { title: 'Home', slug: 'home', layout: normalisePageLayout({ widgets: [], rules: [r] }), filters: [] },
      { title: 'Details', slug: 'details', layout: normalisePageLayout({ widgets: [], params: [{ name: 'customer', required: true }] }), filters: [] },
    ]
    const w = rulesWarnings(pages, { params: [], variables: [], rules: [] })
    expect(w.join('\n')).toMatch(/gone/)
    expect(w.join('\n')).toMatch(/ghost/)
    expect(w.join('\n')).toMatch(/needs the parameter “customer”/)
  })
})
