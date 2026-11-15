'use client'

/**
 * Field-change filter builder of an extension trigger (manifest
 * `contributes.triggers[].filters`): rows of field → operator → value,
 * typed by the fields the trigger's `fieldsFrom` data source returns
 * (lib/extensions/field-filters.ts). Saves a FieldFilterGroup
 * `{ match, rules: [{ field, op, value?, changed? }] }` on the trigger's
 * config field; the extension evaluates it with evaluateFieldFilters.
 */

import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  FIELD_FILTER_OPERATOR_LABELS, fieldFilterNeedsValue, fieldFilterOperators, parseFieldFilters,
  type FieldFilterField, type FieldFilterGroup, type FieldFilterOperator, type FieldFilterRule,
} from '@/lib/extensions/field-filters'

const MAX_RULES = 20

function ValueEditor({ field, rule, onChange, id }: { field: FieldFilterField | undefined; rule: FieldFilterRule; onChange: (value: unknown) => void; id: string }) {
  const value = rule.value === undefined || rule.value === null ? '' : String(rule.value)
  if (field?.type === 'boolean') {
    return (
      <Select id={id} size="sm" value={value} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')} aria-label="Value">
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </Select>
    )
  }
  if ((field?.type === 'choice' || field?.type === 'multichoice') && field.choices?.length) {
    return (
      <Select id={id} size="sm" value={value} onChange={(e) => onChange(e.target.value || undefined)} aria-label="Value">
        <option value="">—</option>
        {field.choices.map((c) => <option key={c} value={c}>{c}</option>)}
      </Select>
    )
  }
  return (
    <Input
      id={id}
      size="sm"
      type={field?.type === 'number' ? 'number' : field?.type === 'date' ? 'date' : 'text'}
      value={value}
      placeholder={field?.type === 'user' ? 'Name, e-mail or login' : 'Value'}
      aria-label="Value"
      onChange={(e) => {
        const raw = e.target.value
        onChange(raw === '' ? undefined : field?.type === 'number' && Number.isFinite(Number(raw)) ? Number(raw) : raw)
      }}
    />
  )
}

export function FieldFilterBuilder({ label, description, fields, value, onChange, loading }: {
  label: string
  description?: string
  /** The fields offered (null while loading or when the source failed). */
  fields: FieldFilterField[] | null
  value: unknown
  onChange: (next: FieldFilterGroup | null) => void
  loading?: boolean
}) {
  const group: FieldFilterGroup = parseFieldFilters(value) ?? { match: 'all', rules: [] }
  const rules = group.rules
  const byName = new Map((fields ?? []).map((f) => [f.name, f]))
  const save = (next: FieldFilterRule[], match = group.match) => onChange(next.length ? { match, rules: next } : null)
  const update = (index: number, patch: Partial<FieldFilterRule>) => save(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  const first = fields?.[0]

  return (
    <div className="space-y-2 border-t border-border-subtle pt-2" data-field-filter-builder>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-fg">{label}</span>
        {rules.length > 1 && (
          <Select size="sm" className="ml-auto w-auto" value={group.match} onChange={(e) => save(rules, e.target.value === 'any' ? 'any' : 'all')} aria-label="Match">
            <option value="all">All conditions</option>
            <option value="any">Any condition</option>
          </Select>
        )}
      </div>
      {description && <p className="text-xs text-fg-muted">{description}</p>}
      {!rules.length && <p className="text-xs text-fg-subtle">No conditions: every matching event starts the workflow.</p>}
      {rules.map((rule, index) => {
        const field = byName.get(rule.field)
        const ops = fieldFilterOperators(field?.type ?? 'string')
        const id = `field-filter-${index}`
        return (
          <div key={index} className="space-y-1.5 rounded-sm border border-border-subtle p-2" data-field-filter-rule={index}>
            <div className="flex items-center gap-1.5">
              <Select size="sm" value={rule.field} aria-label="Field" onChange={(e) => {
                const next = byName.get(e.target.value)
                const nextOps = fieldFilterOperators(next?.type ?? 'string')
                update(index, { field: e.target.value, op: nextOps.includes(rule.op) ? rule.op : 'changed', value: undefined, type: next?.type })
              }}>
                {!field && <option value={rule.field}>{rule.field}{fields ? ' (not in the list any more)' : ''}</option>}
                {(fields ?? []).map((f) => <option key={f.name} value={f.name}>{f.label ?? f.name}</option>)}
              </Select>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove condition" onClick={() => save(rules.filter((_, i) => i !== index))}>
                <X className="size-3.5" />
              </Button>
            </div>
            <Select size="sm" value={rule.op} aria-label="Operator" onChange={(e) => {
              const op = e.target.value as FieldFilterOperator
              update(index, { op, ...(fieldFilterNeedsValue(op) ? {} : { value: undefined }), ...(op === 'changed' ? { changed: undefined } : {}) })
            }}>
              {ops.map((op) => <option key={op} value={op}>{FIELD_FILTER_OPERATOR_LABELS[op]}</option>)}
            </Select>
            {fieldFilterNeedsValue(rule.op) && <ValueEditor id={id} field={field} rule={rule} onChange={(v) => update(index, { value: v })} />}
            {!['changed', 'changed_to', 'changed_from'].includes(rule.op) && (
              <Checkbox
                label="Only when this field changes"
                checked={rule.changed === true}
                onChange={(e) => update(index, { changed: e.target.checked || undefined })}
              />
            )}
          </div>
        )
      })}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!first || rules.length >= MAX_RULES}
        onClick={() => first && save([...rules, { field: first.name, op: 'changed', type: first.type }])}
      >
        <Plus className="size-3.5" /> Add condition
      </Button>
      {!fields && !loading && <p className="text-xs text-fg-subtle">Choose the trigger&apos;s settings above to see the fields.</p>}
    </div>
  )
}
