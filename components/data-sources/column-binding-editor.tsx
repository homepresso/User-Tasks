'use client'

/**
 * A dropdown / autocomplete / multi-select / lookup column's options source,
 * the same on a form Data table column and a Data grid view column: "Get the
 * choices from…" a data table or an API. An API goes through the guided
 * picker (test, badges, "What people see / What is stored"); every other
 * setting stays in the lookup editor (LookupProperties) under "All
 * settings". The value written is the shared binding model (LookupConfig).
 */

import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { LookupConfig } from '@/lib/forms/lookup'
import type { DesignerState } from '@/lib/forms/designer-state'
import { bindingSetLabel, bindingSetValue, bindingUseRows } from '@/lib/data-sources/api-rows'
import { LookupProperties } from '@/components/forms/designer/lookup-properties'
import { DesignerVariableScope } from '@/components/forms/designer/designer-variable-scope'
import { ResponseDragProvider } from './data-chip'
import { GetRowsFrom, type RowsSourceChoice } from './get-rows-from'
import { ApiSourcePicker, useApiReferences, type ApiTestResult } from './api-source-picker'
import { ValueLabelPicker, useGeneratedColumns } from './api-source-steps'

export function ColumnBindingEditor({ binding, onBinding, state, rowColumns, fieldId, fieldKey, label, extraChoices = [] }: {
  binding: LookupConfig | undefined
  onBinding: (next: LookupConfig | undefined) => void
  state: Pick<DesignerState, 'fields' | 'layout'>
  /** The row's other columns ({{row.<column>}}: cascading choices). */
  rowColumns: Array<{ key: string; label: string }>
  fieldId: string
  fieldKey: string
  label: string
  /** More sources a surface offers (e.g. a SharePoint list when that extension is on). */
  extraChoices?: RowsSourceChoice[]
}) {
  const [chosen, setChosen] = useState<'table' | 'reference' | null>(binding ? binding.source === 'reference' ? 'reference' : 'table' : null)
  const [advanced, setAdvanced] = useState(false)
  const [test, setTest] = useState<ApiTestResult | null>(null)
  const rowPlaceholders = rowColumns.map((c) => ({ name: `row.${c.key}`, group: 'This row', label: c.label || c.key }))
  const latest = useRef(binding)
  // A layout effect: fresh before any child's effect (the picker's auto-pick) reads it.
  useLayoutEffect(() => { latest.current = binding }, [binding])
  const { data: references = [] } = useApiReferences(chosen === 'reference')
  const resultsPath = binding?.source === 'reference' && binding.reference_id && (binding.value_field || binding.display_fields?.length) ? binding.results_path ?? '' : binding?.results_path
  const { generated } = useGeneratedColumns(test, resultsPath)
  const lookupField = { _id: fieldId, key: fieldKey, label, type: 'lookup' as const, lookup: binding ?? { source: chosen === 'reference' ? 'reference' as const : 'table' as const, min_chars: 0 } }
  const lookup = <LookupProperties state={state} rowColumns={rowColumns} field={lookupField} onPatch={(next) => onBinding({ ...next, multiple: undefined, fill: undefined })} />
  const refName = (references as Array<{ id: string; name: string }>).find((r) => String(r.id) === binding?.reference_id)?.name

  if (!chosen) {
    return <GetRowsFrom kind="options" choices={['table', 'reference', ...extraChoices.filter((c) => c !== 'typed')]} onPick={(c) => {
      if (c === 'reference') { setChosen('reference'); onBinding(undefined) }
      else { setChosen('table') }
    }} />
  }

  return (
    <ResponseDragProvider>
      <div className="min-w-0 space-y-2" data-testid="column-binding-editor">
        <div className="flex items-center gap-2 text-2xs">
          <span className="text-fg-muted">Choices from:</span>
          <span className="min-w-0 truncate font-medium text-fg">{chosen === 'reference' ? refName ?? 'an API' : 'a data table'}</span>
          <button type="button" className="ml-auto text-2xs font-medium text-primary-text" onClick={() => { setChosen(null); setTest(null); onBinding(undefined) }}>Change</button>
        </div>
        {chosen === 'table' ? lookup : (
          <>
            {/* The lookup's own scope (as LookupProperties): the typed text, this row's columns ({{row.<column>}}), the form. */}
            <DesignerVariableScope state={state} context={{ kind: 'lookup_query', exclude: fieldKey }} extras={rowPlaceholders.length ? rowPlaceholders : undefined}>
            <ApiSourcePicker
              mode="options"
              referenceId={binding?.reference_id}
              resultsPath={resultsPath}
              mappings={binding?.input_mappings}
              placeholders={[{ name: 'search', group: 'Lookup', label: 'What the person types' }, ...rowPlaceholders]}
              suggestFrom={{ fields: rowColumns.map((c) => ({ key: c.key, label: c.label })), prefix: 'row' }}
              onTested={setTest}
              onReference={(ref) => onBinding(ref ? { source: 'reference', reference_id: ref.id, integration_id: ref.integration_id, input_mappings: ref.mappings, min_chars: 0 } : undefined)}
              onMappings={(m) => latest.current && onBinding({ ...latest.current, input_mappings: m })}
              onBadgeAction={(action, badge, t) => {
                const cur = latest.current ?? { source: 'reference' as const }
                if (action === 'use_rows') onBinding(bindingUseRows(cur, badge.path, t.sample, t.root))
                else if (action === 'set_value' && badge.rowPath) onBinding(bindingSetValue(cur, badge.rowPath))
                else if (action === 'set_label' && badge.rowPath) onBinding(bindingSetLabel(cur, badge.rowPath))
              }}>
              {() => binding?.reference_id ? <ValueLabelPicker binding={binding} generated={generated} onChange={(next) => onBinding(next)} /> : null}
            </ApiSourcePicker>
            </DesignerVariableScope>
            <div>
              <button type="button" className="flex items-center gap-1 text-2xs font-medium text-fg-muted" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>
                {advanced ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />} All settings (search, filters, labels, caching)
              </button>
              {advanced && <div className="mt-1.5">{lookup}</div>}
            </div>
          </>
        )}
      </div>
    </ResponseDragProvider>
  )
}
