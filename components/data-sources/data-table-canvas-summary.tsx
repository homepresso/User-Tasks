'use client'

/**
 * A Data table control on the designer canvas shows where its rows come
 * from: "Rows from: List invoices · Refresh", and the first rows of the last
 * test with its columns (WYSIWYG). Unbound: "Get rows from…" (select the
 * control to choose). Refresh re-runs the API's test call (fixed parameter
 * values and defaults) and updates the shared references cache.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, RefreshCw } from 'lucide-react'
import type { DataTableFieldConfig } from '@/lib/forms/data-table'
import { serverRead } from '@/lib/server-read'
import { referenceResponseSchema, type ResponseSchema } from '@/lib/response-schema'
import { explainApiError, responseView, sampleRows } from '@/lib/data-sources/api-rows'
import { REFERENCES_QUERY_KEY, useApiReferences } from './api-source-picker'
import { SampleRowsTable } from './api-source-steps'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows as the browser reads them */

const stop = (e: React.SyntheticEvent) => e.stopPropagation()

export function DataTableCanvasSummary({ config }: { config: DataTableFieldConfig | undefined }) {
  const isApi = config?.source === 'reference' && !!config.reference_id
  const isTable = config?.source === 'table' && !!config.table_id
  const { data: references = [] } = useApiReferences(isApi)
  const { data: tables = [] } = useQuery({ queryKey: ['forms-table-columns'], enabled: isTable, staleTime: 60_000, queryFn: async () => (await serverRead('forms.tableColumns')).data ?? [] })
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!config || (!isApi && !isTable)) {
    return <p className="mt-0.5 text-2xs font-medium text-primary-text" data-testid="dt-canvas-unbound">Get rows from… <span className="font-normal text-fg-muted">(choose in the panel)</span></p>
  }
  const ref = isApi ? (references as any[]).find((r) => String(r.id) === config.reference_id) : null
  const table = isTable ? (tables as any[]).find((t) => t.id === config.table_id) : null
  const name = isApi ? ref?.name ?? 'an API' : table?.name ?? 'a data table'
  const view = isApi ? responseView(referenceResponseSchema(ref)) : null
  const rows = view?.root ? sampleRows(view.sample, config.results_path ?? '') : []

  async function refresh() {
    if (!ref) return
    setBusy(true); setError(null)
    const inputs: Record<string, string> = {}
    for (const input of Array.isArray(ref.inputs) ? ref.inputs : []) {
      const mapped = config?.input_mappings?.[input.name]
      const v = mapped && !mapped.includes('{{') ? mapped : input.default_value
      if (v !== undefined && v !== null && v !== '') inputs[input.name] = String(v)
    }
    try {
      const res = await fetch('/api/integrations/reference-sample', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ reference_id: ref.id, inputs }) })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.response_schema) throw new Error(json?.error ?? 'The test call failed')
      const schema = json.response_schema as ResponseSchema
      queryClient.setQueryData(REFERENCES_QUERY_KEY, (list: any[] | undefined) => (list ?? []).map((r) => (String(r.id) === String(ref.id) ? { ...r, request_config: { ...(r.request_config ?? {}), response_schema: schema } } : r)))
    } catch (e) {
      setError(explainApiError(e instanceof Error ? e.message : String(e)).title)
    } finally { setBusy(false) }
  }

  return (
    <div className="mt-1 min-w-0 space-y-1" data-testid="dt-canvas-source">
      <p className="flex min-w-0 items-center gap-1 text-2xs text-fg-muted">
        <span className="shrink-0">Rows from:</span>
        <span className="min-w-0 truncate font-medium text-fg">{name}</span>
        {isApi && (
          <>
            <span aria-hidden>·</span>
            <button type="button" onClick={(e) => { stop(e); void refresh() }} onKeyDown={stop} disabled={busy}
              className="inline-flex shrink-0 items-center gap-0.5 font-medium text-primary-text disabled:opacity-50" aria-label={`Refresh the sample rows from ${name}`} data-testid="dt-canvas-refresh">
              {busy ? <Loader2 size={10} className="animate-spin" aria-hidden /> : <RefreshCw size={10} aria-hidden />} Refresh
            </button>
          </>
        )}
        {isTable && <span className="shrink-0">· data table</span>}
      </p>
      {error && <p className="text-2xs text-danger" role="alert">{error}</p>}
      {isApi && rows.length > 0 && <div className="pointer-events-none"><SampleRowsTable rows={rows} columns={config.columns} max={3} locale={config.locale} /></div>}
      {isApi && !rows.length && <p className="text-2xs text-fg-muted">No sample rows yet: Test the API in the panel.</p>}
    </div>
  )
}
