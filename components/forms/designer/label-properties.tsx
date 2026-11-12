'use client'

import { useMemo } from 'react'
import { AlertTriangle, CircleCheck, CircleX } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { VariableInput } from '@/components/automations/variable-input'
import type { DesignerField, DesignerState } from '@/lib/forms/designer-state'
import {
  LABEL_EMPHASES, LABEL_EMPHASIS_LABELS, LABEL_FORMAT_KINDS, LABEL_SIZES, LABEL_SIZE_LABELS, computeLabelValues, expressionKnown, expressionProblems,
  formatLabelValue, inferLabelFormat, labelLoopWarnings, readsTableRows, type LabelFieldConfig,
} from '@/lib/forms/label-field'
import { CELL_FORMAT_LABELS, normalizeCellFormat, type CellFormatKind } from '@/lib/formatting/cell-format'
import { withFormContext } from '@/lib/forms/form-params'
import { layoutPages, layoutSectionControls, withControlState } from '@/lib/forms/rule-variables'
import type { DataTableColumn } from '@/lib/forms/data-table'
import { FormattedCellView } from '../data-table-cell'
import { FormatEditor } from './data-table-properties'
import { DesignerVariableScope } from './designer-variable-scope'
import { useDesignerPreviewValues } from './designer-preview-context'
import { designerInputClass as inputClass } from './designer-controls'

/**
 * A Label's properties (lib/forms/label-field.ts): the expression (the
 * workflow expression language — fields, parameters, controls and
 * functions from the {x} picker), evaluated live against the designer
 * preview's values; the display (format, prefix / suffix, size, alignment,
 * empty text); and "Include in submission".
 */

const muted: React.CSSProperties = { color: 'var(--theme-muted-text)' }

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-medium" style={muted}>{children}</label>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-2 border-t pt-3 border-border">
      <legend className="pr-2 text-2xs font-semibold" style={muted}>{title}</legend>
      {children}
    </fieldset>
  )
}

export function LabelProperties({ state, field, onPatch }: {
  state: DesignerState
  field: DesignerField
  onPatch: (config: LabelFieldConfig | undefined, tag?: string) => void
}) {
  const config = field.label_config ?? {}
  const id = (name: string) => `lp-${field._id}-${name}`
  const set = (patch: Partial<LabelFieldConfig>, tag?: string) => {
    const next: LabelFieldConfig = { ...config, ...patch }
    for (const k of Object.keys(next) as Array<keyof LabelFieldConfig>) if (next[k] === undefined || next[k] === '' || next[k] === false) delete next[k]
    onPatch(Object.keys(next).length ? next : undefined, tag)
  }
  const preview = useDesignerPreviewValues()
  const tables = state.fields.filter((f) => f.type === 'data_table' && f.data_table)
  // Live: the expression against the preview's values (its tables' loaded rows included).
  const live = useMemo(() => {
    const values = withControlState(state.fields as never, withFormContext(state.layout, preview ?? {}), layoutPages(state.layout), layoutSectionControls(state.layout))
    return computeLabelValues(state.fields, values)[field.key] ?? null
  }, [state.fields, state.layout, preview, field.key])
  const problems = useMemo(() => expressionProblems(config.expression, expressionKnown(state.fields, state.layout, field.key)), [config.expression, state.fields, state.layout, field.key])
  const loops = useMemo(() => labelLoopWarnings(state.fields, state.layout).filter((w) => w.includes(`"${field.label || field.key}"`) || w.includes(field.label || field.key)), [state.fields, state.layout, field.key, field.label])
  const rowsRead = readsTableRows(field)
  const inferred = useMemo(() => (config.format ? null : inferLabelFormat(field, state.fields as never)), [config.format, field, state.fields])
  const kind = config.format?.kind ?? 'text'
  const shown = formatLabelValue(config, live?.value ?? null, { inferred })
  const autoLabel = inferred ? `Auto: ${CELL_FORMAT_LABELS[inferred.kind]}${inferred.currency ? ` (${inferred.currency})` : ''}` : 'Auto: as calculated'
  const firstTable = tables[0]
  const numberCol = firstTable?.data_table?.columns.find((c) => c.type === 'number')
  const numberCols = (firstTable?.data_table?.columns ?? []).filter((c) => c.type === 'number')
  const examples: Array<{ label: string; text: string }> = [
    ...(firstTable && numberCol ? [{ label: `Sum of ${numberCol.label || numberCol.key}`, text: `SUM(control.${firstTable.key}.rows, "${numberCol.key}")` }] : []),
    ...(firstTable && numberCols.length >= 2 ? [{ label: `${numberCols[0].label || numberCols[0].key} × ${numberCols[1].label || numberCols[1].key}, summed`, text: `SUMPRODUCT(control.${firstTable.key}.rows, "${numberCols[0].key}", "${numberCols[1].key}")` }] : []),
    ...(firstTable ? [{ label: 'Count rows', text: `COUNT(control.${firstTable.key}.rows)` }] : []),
  ]
  const column: DataTableColumn = { key: field.key, label: field.label || field.key, type: ['number', 'integer', 'currency', 'percent'].includes(kind) ? 'number' : kind === 'date' ? 'date' : kind === 'datetime' ? 'datetime' : kind === 'boolean' ? 'boolean' : 'text', format: config.format ?? { kind: 'text' } }

  return (
    <div className="space-y-3" data-testid="label-properties">
      <Section title="Expression">
        <DesignerVariableScope state={state} context={{ kind: 'expression', exclude: field.key }}>
          <VariableInput
            value={config.expression ?? ''}
            multiline
            rows={2}
            ariaLabel="Expression"
            placeholder='e.g. {{form.qty}} * {{form.price}} — or SUM(control.lines.rows, "amount")'
            onChange={(v) => set({ expression: v.trim() ? v : undefined }, `label-expr-${field._id}`)}
          />
        </DesignerVariableScope>
        <p className="text-2xs" style={muted}>
          The workflow expression language, without <code className="font-mono">{'{{= }}'}</code>: + − × ÷, ROUND, IF, COALESCE, CONCAT, and row aggregates —
          {' '}<code className="font-mono">SUM(rows, &quot;col&quot;)</code>, <code className="font-mono">SUMPRODUCT(rows, &quot;qty&quot;, &quot;price&quot;)</code>,
          {' '}<code className="font-mono">SUMIF(rows, &quot;status&quot;, &quot;open&quot;, &quot;amount&quot;)</code>, <code className="font-mono">SUM(MAP(rows, &quot;qty * price&quot;))</code>. Press <code className="font-mono">{'{x}'}</code> for fields, controls and functions. Empty: rules or the default fill it.
        </p>
        {examples.length > 0 && !config.expression && (
          <div className="flex flex-wrap gap-1">
            {examples.map((e) => (
              <button key={e.text} type="button" className="rounded border px-1.5 py-0.5 text-2xs border-border text-primary-text" onClick={() => set({ expression: e.text })} data-label-example>
                {e.label}
              </button>
            ))}
          </div>
        )}
        {config.expression && (
          <div className="space-y-1 rounded-md border p-1.5 text-2xs border-border" data-testid="label-live" aria-live="polite">
            <p className="flex items-center gap-1" style={muted}>
              {live?.evaluation.error || problems.length ? <CircleX className="text-danger" size={12} aria-hidden /> : <CircleCheck className="text-success" size={12} aria-hidden />}
              Preview value:
              <span className="font-semibold text-fg" data-label-live-value>
                {shown.prefix}<FormattedCellView cell={shown} />{shown.suffix ? ` ${shown.suffix}` : ''}
              </span>
              {typeof live?.evaluation.ms === 'number' && live.evaluation.ms > 5 && <span>· {live.evaluation.ms} ms</span>}
            </p>
            {problems.map((p) => <p className="text-danger" key={p} data-label-problem>{p}</p>)}
            {!problems.length && live?.evaluation.error && <p className="text-danger" data-label-problem>{live.evaluation.error}</p>}
            {!problems.length && !live?.evaluation.error && live?.evaluation.warning && <p className="flex items-start gap-1 text-warning"><AlertTriangle size={11} className="mt-0.5" aria-hidden /> {live.evaluation.warning}</p>}
            <p style={muted}>Worked out from the preview&apos;s values — fill the form on the right (add table rows) to try it.</p>
          </div>
        )}
      </Section>

      <Section title="Display">
        <div className="grid grid-cols-2 gap-1">
          <div>
            <Label>Format</Label>
            <AutocompleteSelect value={config.format ? kind : ''} placeholder={autoLabel} clearable={Boolean(config.format)}
              options={[{ value: '', label: autoLabel, hint: 'Currency when it adds up currency fields, else as calculated' }, ...LABEL_FORMAT_KINDS.map((k) => ({ value: k, label: CELL_FORMAT_LABELS[k] }))]}
              onChange={(v) => set({ format: v ? normalizeCellFormat({ kind: v as CellFormatKind, ...(v === 'currency' && inferred?.currency ? { currency: inferred.currency } : {}), ...(v === 'number' ? { decimals: 2 } : {}) }) : undefined })} />
          </div>
          <div>
            <Label>Align</Label>
            <AutocompleteSelect value={config.align ?? ''} placeholder="Auto" clearable options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]}
              onChange={(v) => set({ align: (v || undefined) as LabelFieldConfig['align'] })} />
          </div>
          <div>
            <Label>Size</Label>
            <AutocompleteSelect value={config.size ?? 'md'} options={LABEL_SIZES.map((s) => ({ value: s, label: LABEL_SIZE_LABELS[s] }))} onChange={(v) => set({ size: v && v !== 'md' ? v as LabelFieldConfig['size'] : undefined })} />
          </div>
          <div>
            <Label>Emphasis</Label>
            <AutocompleteSelect value={config.emphasis ?? 'normal'} options={LABEL_EMPHASES.map((s) => ({ value: s, label: LABEL_EMPHASIS_LABELS[s] }))} onChange={(v) => set({ emphasis: v && v !== 'normal' ? v as LabelFieldConfig['emphasis'] : undefined })} />
          </div>
          <div>
            <Label htmlFor={id('prefix')}>Prefix</Label>
            <input id={id('prefix')} className={inputClass} maxLength={40} placeholder="e.g. $" value={config.prefix ?? ''} onChange={(e) => set({ prefix: e.target.value || undefined }, `label-prefix-${field._id}`)} />
          </div>
          <div>
            <Label htmlFor={id('suffix')}>Suffix</Label>
            <input id={id('suffix')} className={inputClass} maxLength={40} placeholder="e.g. items" value={config.suffix ?? ''} onChange={(e) => set({ suffix: e.target.value || undefined }, `label-suffix-${field._id}`)} />
          </div>
          <div className="col-span-2">
            <Label htmlFor={id('empty')}>When there is no value, show</Label>
            <input id={id('empty')} className={inputClass} maxLength={80} placeholder="—" value={config.empty_text ?? ''} onChange={(e) => set({ empty_text: e.target.value || undefined }, `label-empty-${field._id}`)} />
          </div>
        </div>
        {config.format && kind !== 'text' && (
          <FormatEditor col={column} hideKind onChange={(format, tag) => set({ format: format && format.kind !== 'text' ? format : undefined }, tag ? `label-${tag}-${field._id}` : undefined)} />
        )}
        <label className="flex items-center gap-1.5 text-2xs">
          <input className="accent-primary" type="checkbox" checked={config.hide_caption === true} onChange={(e) => set({ hide_caption: e.target.checked || undefined })} />
          Hide the caption (screen readers still hear it)
        </label>
      </Section>

      <Section title="Submission">
        <label className="flex items-start gap-1.5 text-2xs" data-testid="label-include">
          <input type="checkbox" className="mt-0.5 accent-primary" checked={config.include === true} onChange={(e) => set({ include: e.target.checked || undefined })} />
          <span>
            Include in submission
            <span className="block text-2xs" style={muted}>
              Stored as <code className="font-mono">{`{{form.${field.key}}}`}</code> / <code className="font-mono">{`task_data.${field.key}`}</code>. The server works the value out again — it never takes the browser&apos;s.
            </span>
          </span>
        </label>
        {config.include && rowsRead.length > 0 && (
          <p className="text-2xs" style={muted} data-testid="label-rows-note">
            The stored value is recomputed from the table&apos;s first page (as the form loads it, with the base filter) plus the person&apos;s changes — searching or paging the table changes what the label shows, not what is stored.
          </p>
        )}
      </Section>

      {loops.map((w) => (
        <p key={w} role="status" className="flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-2xs border-warning" data-testid="label-loop">
          <AlertTriangle size={12} aria-hidden className="mt-0.5 shrink-0 text-warning" /> {w}
        </p>
      ))}
      <p className="text-2xs" style={muted}>
        Rules: set it with <em>Set or calculate field values</em> or an API reference&apos;s results, and react with <em>When › Label changes</em> ({'{{event.value}}'}, {'{{event.previous_value}}'}). Other rules read it as <code className="font-mono">{`{{control.${field.key}.value}}`}</code>.
      </p>
    </div>
  )
}
