/**
 * A lookup's default passed in from a form parameter (gap: ignored). The
 * Revenue CRM forms open "Log activity" / "New deal" for an account with
 * `dynamic.default = {{param.account}}` on the Account lookup: the binding was
 * dropped (a lookup's default was not bindable), so the lookup opened empty.
 * A static `{{param.x}}` default fills too. The value is still confirmed
 * against the lookup's source on submit, like any other lookup value.
 */
import { describe, expect, it } from 'vitest'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import { applyDynamicValues, coerceDynamicValue, dynamicBindingProblems, fieldPropType, resolveExpression } from '@/lib/forms/dynamic-values'
import { openingFieldDefaults } from '@/lib/forms/preview-inputs'
import { FORM_PARAMS_KEY } from '@/lib/forms/form-params'

const TABLE = '00000000-0000-4000-8000-000000000010'
const lookup = (extra: Record<string, unknown> = {}) => ({ source: 'table', table_id: TABLE, search_columns: ['name'], display_columns: ['name'], value_column: 'account_ref', ...extra })

describe('a lookup default from a form parameter', () => {
  it('the dynamic default binding is kept on a lookup (single and multiple)', () => {
    const [single, multi] = normalizeTaskFields([
      { key: 'account', label: 'Account', type: 'lookup', lookup: lookup(), dynamic: { default: { kind: 'expr', expr: '{{param.account}}' } } },
      { key: 'accounts', label: 'Accounts', type: 'lookup', lookup: lookup({ multiple: true }), dynamic: { default: { kind: 'expr', expr: '{{param.accounts}}' } } },
    ])
    expect(single.dynamic?.default).toEqual({ kind: 'expr', expr: '{{param.account}}' })
    expect(multi.dynamic?.default).toEqual({ kind: 'expr', expr: '{{param.accounts}}' })
    expect(fieldPropType(single, 'default')).toBe('string')
    expect(fieldPropType(multi, 'default')).toBe('string_list')
    expect(dynamicBindingProblems(single)).toEqual({})
  })

  it('it resolves from the parameter like any other field default', () => {
    const [field] = normalizeTaskFields([{ key: 'account', label: 'Account', type: 'lookup', lookup: lookup(), dynamic: { default: { kind: 'expr', expr: '{{param.account}}' } } }])
    const value = resolveExpression(field.dynamic!.default!.kind === 'expr' ? field.dynamic!.default!.expr : '', { values: { [FORM_PARAMS_KEY]: { account: 'ACC-0042' } }, user: null, now: new Date() })
    const coerced = coerceDynamicValue(fieldPropType(field, 'default')!, value)
    expect(coerced).toEqual({ ok: true, value: 'ACC-0042' })
    expect(applyDynamicValues(field, { default: 'ACC-0042' }).default).toBe('ACC-0042')
  })

  it('a static {{param.x}} default fills the lookup when the form opens', () => {
    const fields = normalizeTaskFields([{ key: 'account', label: 'Account', type: 'lookup', lookup: lookup(), default: '{{param.account}}' }])
    expect(openingFieldDefaults(fields, { account: 'ACC-0042' }).account).toBe('ACC-0042')
  })
})
