'use client'

/**
 * Section editors of the custom reference builder: inputs (Ask / Fixed),
 * operation parameters, columns, filter (AND/OR groups), sort.
 */

import { ArrowDown, ArrowUp, KeyRound, Plus, Trash2, X } from 'lucide-react'
import { CUSTOM_INPUT_TYPES, FILTER_OPERATORS, isFilterGroup, type CustomColumn, type CustomInput, type FilterCondition, type FilterGroup, type SortSpec, type SourceInputDef, type SourceParam } from '@/lib/custom-references/types'
import { isSensitiveKey } from '@/lib/secret-keys'
import { CONTROL_HEIGHT, controlClass } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/* eslint-disable @typescript-eslint/no-explicit-any -- draft JSON */

export const muted = { color: 'var(--theme-muted-text)' }
export const border = { borderColor: 'var(--theme-surface-border)' }
/** Compact builder control: the shared control look at 28px (sm). */
export const fieldCls = cn(controlClass, CONTROL_HEIGHT.sm, 'min-w-0 px-2 text-xs')
/** @deprecated Kept for callers; controls take their colours from `fieldCls`. */
export const fieldStyle: React.CSSProperties = {}
export const smallBtn = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium hover:bg-subtle hover:text-fg'

export function Section({ title, hint, children, testId, actions }: { title: string; hint?: React.ReactNode; children: React.ReactNode; testId?: string; actions?: React.ReactNode }) {
  return (
    <section className="space-y-2.5 rounded-lg border border-border bg-panel p-3" data-testid={testId}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-ui font-semibold text-fg">{title}</h3>
          {hint && <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

// ─── Inputs ─────────────────────────────────────────────────────────────

export function InputsEditor({ inputs, onChange, settings }: {
  inputs: CustomInput[]
  onChange: (inputs: CustomInput[]) => void
  settings: Array<{ name: string; secret: boolean }>
}) {
  const update = (index: number, patch: Partial<CustomInput>) => onChange(inputs.map((input, i) => (i === index ? { ...input, ...patch } : input)))
  return (
    <div className="space-y-2">
      {inputs.length === 0 && <p className="text-xs text-fg-muted">No inputs — the reference takes no values from callers.</p>}
      {inputs.map((input, index) => {
        const fixed = input.mode === 'fixed'
        const secretName = fixed && !input.fixed_setting && isSensitiveKey(input.name)
        return (
          <div key={index} className="space-y-1.5 rounded border p-2 border-border" data-testid={`custom-input-${input.name || index}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <input className={`${fieldCls} w-36 font-mono`} value={input.name} placeholder="name" aria-label="Input name"
                onChange={(e) => update(index, { name: e.target.value.replace(/[^A-Za-z0-9_]/g, '') })} />
              <select className={fieldCls} value={input.type} aria-label="Input type" onChange={(e) => update(index, { type: e.target.value as CustomInput['type'] })}>
                {CUSTOM_INPUT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <div className="inline-flex overflow-hidden rounded border text-xs border-border" role="radiogroup" aria-label="Input mode">
                {(['ask', 'fixed'] as const).map((mode) => (
                  <button key={mode} type="button" role="radio" aria-checked={(input.mode ?? 'ask') === mode} data-testid={`input-mode-${mode}`}
                    className="px-2 py-0.5" onClick={() => update(index, { mode })}
                    style={(input.mode ?? 'ask') === mode ? { backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' } : undefined}>
                    {mode === 'ask' ? 'Ask callers' : 'Fixed value'}
                  </button>
                ))}
              </div>
              {!fixed && (
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={Boolean(input.required)} onChange={(e) => update(index, { required: e.target.checked })} /> required
                </label>
              )}
              <button type="button" className={`${smallBtn} ml-auto text-fg-muted`} onClick={() => onChange(inputs.filter((_, i) => i !== index))} aria-label={`Remove input ${input.name}`}><Trash2 size={11} /></button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {fixed ? (
                <>
                  <select className={fieldCls} aria-label="Fixed value source" value={input.fixed_setting ? `setting:${input.fixed_setting}` : 'constant'}
                    onChange={(e) => {
                      const v = e.target.value
                      update(index, v === 'constant' ? { fixed_setting: undefined } : { fixed_setting: v.slice(8), fixed_value: undefined })
                    }}>
                    <option value="constant">Constant</option>
                    {settings.map((s) => <option key={s.name} value={`setting:${s.name}`}>{s.secret ? '🔒 ' : ''}Integration setting: {s.name}</option>)}
                  </select>
                  {!input.fixed_setting && (
                    <input className={`${fieldCls} flex-1 font-mono`} placeholder="value" aria-label="Fixed value" data-testid="fixed-value"
                      value={input.fixed_value === undefined || input.fixed_value === null ? '' : typeof input.fixed_value === 'object' ? JSON.stringify(input.fixed_value) : String(input.fixed_value)}
                      onChange={(e) => update(index, { fixed_value: e.target.value })} />
                  )}
                  {input.fixed_setting && <span className="inline-flex items-center gap-1 text-xs text-fg-muted"><KeyRound size={11} /> resolved on the server from the integration — never shown or sent to callers</span>}
                </>
              ) : (
                <input className={`${fieldCls} w-40 font-mono`} placeholder="default (optional)" aria-label="Default value"
                  value={input.default_value === undefined || input.default_value === null ? '' : String(input.default_value)}
                  onChange={(e) => update(index, { default_value: e.target.value })} />
              )}
              <input className={`${fieldCls} flex-1`} placeholder="description" aria-label="Description" value={input.description ?? ''}
                onChange={(e) => update(index, { description: e.target.value })} />
            </div>
            {secretName && (
              <p className="text-xs" role="alert" style={{ color: 'var(--theme-danger)' }}>
                &quot;{input.name}&quot; looks like a secret — store it in the integration&apos;s credentials and pick it as an integration setting.
              </p>
            )}
            {fixed && <p className="text-xs text-fg-muted">Callers never see this input; a value they send is ignored.</p>}
          </div>
        )
      })}
      <button type="button" className={smallBtn} style={{ color: 'var(--theme-primary-text)' }} data-testid="add-input"
        onClick={() => onChange([...inputs, { name: `input${inputs.length + 1}`, type: 'string', mode: 'ask' }])}>
        <Plus size={11} /> Add input
      </button>
    </div>
  )
}

// ─── Operation parameters ───────────────────────────────────────────────

export function ParamsEditor({ sourceInputs, params, onChange, inputNames, apiTaken }: {
  sourceInputs: SourceInputDef[]
  params: SourceParam[]
  onChange: (params: SourceParam[]) => void
  inputNames: string[]
  /** Parameters already filled by a filter / sort / paging mapping. */
  apiTaken: Map<string, string>
}) {
  if (!sourceInputs.length) return <p className="text-xs text-fg-muted">The operation takes no parameters.</p>
  const valueOf = (name: string) => params.find((p) => p.name === name)?.value ?? ''
  const set = (name: string, value: string) => {
    const rest = params.filter((p) => p.name !== name)
    onChange(value === '' ? rest : [...rest, { name, value }])
  }
  return (
    <div className="space-y-1">
      {sourceInputs.map((si) => (
        <div key={si.name} className="flex items-center gap-1.5" data-testid={`param-${si.name}`}>
          <code className="w-40 shrink-0 truncate text-xs" title={si.description}>{si.name}{si.required ? ' *' : ''}</code>
          <span className="w-12 shrink-0 text-xs text-fg-muted">{si.location ?? 'query'}</span>
          {apiTaken.has(si.name)
            ? <span className="text-xs text-fg-muted">filled by {apiTaken.get(si.name)}</span>
            : (
              <>
                <input className={`${fieldCls} flex-1 font-mono`} value={valueOf(si.name)} aria-label={`Value for ${si.name}`}
                  placeholder={si.default_value ? `default: ${String(si.default_value)}` : 'empty — or a constant / {{input.name}}'}
                  onChange={(e) => set(si.name, e.target.value)} />
                <select className={`${fieldCls} w-28`} aria-label={`Use an input for ${si.name}`} value=""
                  onChange={(e) => { if (e.target.value) set(si.name, `{{input.${e.target.value}}}`) }}>
                  <option value="">use input…</option>
                  {inputNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </>
            )}
        </div>
      ))}
    </div>
  )
}

// ─── Columns ────────────────────────────────────────────────────────────

export function ColumnsEditor({ columns, onChange }: { columns: CustomColumn[]; onChange: (columns: CustomColumn[]) => void }) {
  const update = (i: number, patch: Partial<CustomColumn>) => onChange(columns.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= columns.length) return
    const next = [...columns]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  if (!columns.length) return <p className="text-xs text-fg-muted">No columns yet — add fields from the rows list above.</p>
  return (
    <ul className="space-y-1" data-testid="custom-columns">
      {columns.map((c, i) => (
        <li key={`${c.path}-${i}`} className="flex items-center gap-1.5" data-column={c.path}>
          <code className="w-48 shrink-0 truncate text-xs" title={c.path}>{c.path}</code>
          <span className="text-xs text-fg-muted">as</span>
          <input className={`${fieldCls} w-40 font-mono`} value={c.alias ?? ''} placeholder={c.path.split('.').pop()} aria-label={`Name for ${c.path}`}
            onChange={(e) => update(i, { alias: e.target.value })} />
          <select className={`${fieldCls} w-24`} value={c.type ?? ''} aria-label={`Type of ${c.path}`} onChange={(e) => update(i, { type: e.target.value || undefined })}>
            <option value="">auto</option>
            {['string', 'number', 'integer', 'boolean', 'date', 'object', 'array'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button type="button" className={`${smallBtn} text-fg-muted`} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={11} /></button>
          <button type="button" className={`${smallBtn} text-fg-muted`} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={11} /></button>
          <button type="button" className={`${smallBtn} text-fg-muted`} onClick={() => onChange(columns.filter((_, j) => j !== i))} aria-label={`Remove ${c.path}`}><X size={11} /></button>
        </li>
      ))}
    </ul>
  )
}

// ─── Filter ─────────────────────────────────────────────────────────────

export function FilterEditor({ group, onChange, fields, inputNames, apiParams, depth = 0 }: {
  group: FilterGroup
  onChange: (group: FilterGroup) => void
  fields: string[]
  inputNames: string[]
  /** Operation parameters a root AND condition may be sent to (REST). */
  apiParams: string[]
  depth?: number
}) {
  const listId = `cr-fields-${depth}`
  const valuesId = `cr-values-${depth}`
  const setNode = (i: number, node: FilterCondition | FilterGroup) => onChange({ ...group, conditions: group.conditions.map((c, j) => (j === i ? node : c)) })
  const remove = (i: number) => onChange({ ...group, conditions: group.conditions.filter((_, j) => j !== i) })
  const canApi = depth === 0 && group.op === 'and' && apiParams.length > 0
  return (
    <div className="space-y-1.5 rounded border p-2" style={{ ...border, marginLeft: depth ? 12 : 0 }} data-testid={depth ? 'filter-group' : 'filter-root'}>
      <datalist id={listId}>{fields.map((f) => <option key={f} value={f} />)}</datalist>
      <datalist id={valuesId}>{inputNames.map((n) => <option key={n} value={`{{input.${n}}}`} />)}</datalist>
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-fg-muted">Match</span>
        <select className={fieldCls} value={group.op} aria-label="Combine conditions with" onChange={(e) => onChange({ ...group, op: e.target.value as 'and' | 'or' })}>
          <option value="and">all (AND)</option>
          <option value="or">any (OR)</option>
        </select>
        <span className="text-fg-muted">of these</span>
      </div>
      {group.conditions.map((node, i) => isFilterGroup(node) ? (
        <div key={i} className="flex items-start gap-1">
          <FilterEditor group={node} onChange={(g) => setNode(i, g)} fields={fields} inputNames={inputNames} apiParams={[]} depth={depth + 1} />
          <button type="button" className={`${smallBtn} text-fg-muted`} onClick={() => remove(i)} aria-label="Remove group"><X size={11} /></button>
        </div>
      ) : (
        <div key={i} className="flex flex-wrap items-center gap-1.5" data-testid="filter-condition">
          <input className={`${fieldCls} w-40 font-mono`} list={listId} value={node.field} placeholder="field" aria-label="Filter field"
            onChange={(e) => setNode(i, { ...node, field: e.target.value })} />
          <select className={fieldCls} value={node.operator} aria-label="Operator" onChange={(e) => setNode(i, { ...node, operator: e.target.value as FilterCondition['operator'] })}>
            {FILTER_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {!FILTER_OPERATORS.find((o) => o.value === node.operator)?.unary && (
            <input className={`${fieldCls} w-44 font-mono`} list={valuesId} placeholder="value or {{input.name}}" aria-label="Filter value"
              value={node.value === undefined || node.value === null ? '' : Array.isArray(node.value) ? node.value.join(', ') : String(node.value)}
              onChange={(e) => setNode(i, { ...node, value: e.target.value })} />
          )}
          {canApi && (
            <select className={fieldCls} value={node.api_param ?? ''} aria-label="Where this filter runs" data-testid="filter-runs-at"
              onChange={(e) => setNode(i, { ...node, api_param: e.target.value || undefined })}>
              <option value="">on the server</option>
              {apiParams.map((p) => <option key={p} value={p}>at the API → {p}</option>)}
            </select>
          )}
          <button type="button" className={`${smallBtn} text-fg-muted`} onClick={() => remove(i)} aria-label="Remove condition"><X size={11} /></button>
        </div>
      ))}
      <div className="flex gap-2">
        <button type="button" className={smallBtn} style={{ color: 'var(--theme-primary-text)' }} data-testid="add-condition"
          onClick={() => onChange({ ...group, conditions: [...group.conditions, { field: fields[0] ?? '', operator: 'eq', value: '' }] })}>
          <Plus size={11} /> Condition
        </button>
        {depth < 2 && (
          <button type="button" className={smallBtn} style={{ color: 'var(--theme-primary-text)' }}
            onClick={() => onChange({ ...group, conditions: [...group.conditions, { op: group.op === 'and' ? 'or' : 'and', conditions: [] }] })}>
            <Plus size={11} /> Group ({group.op === 'and' ? 'OR' : 'AND'})
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Sort ───────────────────────────────────────────────────────────────

export function SortEditor({ sort, onChange, fields }: { sort: SortSpec[]; onChange: (sort: SortSpec[]) => void; fields: string[] }) {
  return (
    <div className="space-y-1" data-testid="sort-editor">
      <datalist id="cr-sort-fields">{fields.map((f) => <option key={f} value={f} />)}</datalist>
      {sort.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-12 text-xs text-fg-muted">{i === 0 ? 'Sort by' : 'then'}</span>
          <input className={`${fieldCls} w-48 font-mono`} list="cr-sort-fields" value={s.field} aria-label="Sort field"
            onChange={(e) => onChange(sort.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))} />
          <select className={fieldCls} value={s.direction} aria-label="Direction" onChange={(e) => onChange(sort.map((x, j) => (j === i ? { ...x, direction: e.target.value as 'asc' | 'desc' } : x)))}>
            <option value="asc">ascending</option>
            <option value="desc">descending</option>
          </select>
          <button type="button" className={`${smallBtn} text-fg-muted`} onClick={() => onChange(sort.filter((_, j) => j !== i))} aria-label="Remove sort"><X size={11} /></button>
        </div>
      ))}
      {sort.length < 5 && (
        <button type="button" className={smallBtn} style={{ color: 'var(--theme-primary-text)' }} data-testid="add-sort"
          onClick={() => onChange([...sort, { field: fields[0] ?? '', direction: 'asc' }])}>
          <Plus size={11} /> Sort column
        </button>
      )}
    </div>
  )
}

export function OptionalSelect({ label, value, options, onChange, testId }: { label: string; value: string | undefined; options: string[]; onChange: (v: string | undefined) => void; testId?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="w-32 shrink-0 text-fg-muted">{label}</span>
      <select className={`${fieldCls} w-44`} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} data-testid={testId}>
        <option value="">— not sent to the API —</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

