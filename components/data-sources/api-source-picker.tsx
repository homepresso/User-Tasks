'use client'

/**
 * "Get rows from an API" — the guided picker shared by the form Data table
 * control (its rows) and Data table / Data grid column bindings (dropdown and
 * autocomplete options):
 *
 *   1. Which API — a saved API reference, or a new one made here from a
 *      pasted address (app/actions/api-quick-reference.ts), with a link to
 *      its full settings;
 *   2. What to send — each parameter in plain words, filled in from the form
 *      fields / workflow variables (VariableInput, the designer's scope), with
 *      search, paging and same-named fields suggested automatically;
 *   3. Test — one real call; errors in plain words with the fix;
 *   4. The response as draggable badges, the most likely list of records
 *      picked automatically (no JSON paths to type);
 *   5–6. The caller's own steps (columns to show, value / label, when to
 *      refresh) under the response, through `children`.
 *
 * The picker edits nothing itself: it reports the reference, mappings and
 * badge actions; the caller writes them to its model (DataTableFieldConfig or
 * LookupConfig) with lib/data-sources/api-rows.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ExternalLink, FlaskConical, Loader2, Plus, Wand2 } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { VariableInput } from '@/components/automations/variable-input'
import { serverRead } from '@/lib/server-read'
import { isWriteReference, referencePickerHint } from '@/lib/custom-references/types'
import { referenceResponseSchema, type ResponseSchema, type SchemaNode } from '@/lib/response-schema'
import {
  detectRowArrays, explainApiError, humanizeLabel, parseApiAddress, responseView, sampleRows, suggestInputMappings,
  type BadgeAction, type ApiErrorHelp, type RefInputLike, type ResponseBadge,
} from '@/lib/data-sources/api-rows'
import { quickCreateApiReference } from '@/app/actions/api-quick-reference'
import { cn } from '@/lib/utils'
import { ResponseBadgeTree } from './response-badge-tree'
import { ResponseDropZone } from './data-chip'

/* eslint-disable @typescript-eslint/no-explicit-any -- reference rows as the browser reads them */

export const REFERENCES_QUERY_KEY = ['forms-lookup-references'] as const

/** The workspace's API references (shared cache with the lookup and Data table editors). */
export function useApiReferences(enabled = true) {
  return useQuery({
    queryKey: REFERENCES_QUERY_KEY, enabled, staleTime: 60_000,
    queryFn: async () => { const { data, error } = await serverRead('integrations.references'); if (error) throw new Error(error.message); return (data ?? []) as any[] },
  })
}

const inputCls = 'h-7 w-full min-w-0 rounded border border-border bg-panel px-2 text-2xs outline-none focus-visible:ring-2 focus-visible:ring-primary'

export function Step({ n, title, children, done, testId }: { n: number; title: string; children: React.ReactNode; done?: boolean; testId?: string }) {
  return (
    <section className="min-w-0 space-y-1.5" data-api-step={testId ?? n}>
      <h4 className="flex items-center gap-1.5 text-2xs font-semibold text-fg">
        <span className={cn('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-2xs', done ? 'bg-primary text-primary-fg' : 'border border-border text-fg-muted')} aria-hidden>{n}</span>
        {title}
      </h4>
      <div className="min-w-0 space-y-1.5 pl-5">{children}</div>
    </section>
  )
}

export function settingsHref(ref: any): string | null {
  const integration = ref?.integration?.id ?? ref?.integration_id
  return integration ? `/integrations/${integration}` : null
}

/** A sample value for a test call: a fixed mapping as it is, else the parameter's default. */
function testValue(mapping: string | undefined, input: RefInputLike): string {
  if (mapping && !mapping.includes('{{')) return mapping
  const d = input.default_value
  return d === undefined || d === null ? '' : String(d)
}

/* ── Create a reference inline ────────────────────────────────────────── */

function NewReferenceForm({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const { data: connections = [] } = useQuery({
    queryKey: ['integrations-list-for-picker'], staleTime: 60_000,
    queryFn: async () => ((await serverRead('integrations.list')).data ?? []) as any[],
  })
  const [address, setAddress] = useState('')
  const [name, setName] = useState('')
  const [auth, setAuth] = useState<'none' | 'api_key' | 'bearer'>('none')
  const [keyName, setKeyName] = useState('X-API-Key')
  const [secret, setSecret] = useState('')
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false })
  const pool = (connections as any[]).filter((c) => c.type === 'rest_api' || c.type === 'odata').map((c) => ({ id: String(c.id), base_url: c.config?.base_url ?? null, name: String(c.name) }))
  const parsed = address.trim() ? parseApiAddress(address, pool) : null
  const existing = parsed?.connectionId ? pool.find((c) => c.id === parsed.connectionId) : null
  async function create() {
    if (!parsed) return
    setState({ busy: true })
    const res = await quickCreateApiReference({ address, name: name.trim() || undefined, ...(existing ? {} : { auth: { type: auth, key_name: keyName, value: secret } }) })
    if (!res.ok) { setState({ busy: false, error: res.error }); return }
    setState({ busy: false })
    onCreated(res.data.reference_id)
  }
  return (
    <div className="space-y-1.5 rounded-md border border-border p-2" data-testid="new-api-reference">
      <label className="block text-2xs font-medium text-fg-muted">The API&apos;s web address
        <input className={cn(inputCls, 'mt-0.5 font-mono')} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://api.example.com/invoices?status=open" autoFocus />
      </label>
      {address.trim() && !parsed && <p className="text-2xs text-danger" role="alert">Paste a full address that starts with https://</p>}
      {parsed && (
        <p className="text-2xs text-fg-muted">
          {existing ? <>Uses your connection <strong className="text-fg">{existing.name}</strong>. </> : <>Makes a new connection to <code>{parsed.baseUrl}</code>. </>}
          Reads <code>{parsed.path}</code>{parsed.params.length ? <> with {parsed.params.length} parameter{parsed.params.length === 1 ? '' : 's'} you can fill in from the form ({parsed.params.map((p) => p.name).join(', ')})</> : null}.
        </p>
      )}
      <label className="block text-2xs font-medium text-fg-muted">Name
        <input className={cn(inputCls, 'mt-0.5')} value={name} onChange={(e) => setName(e.target.value)} placeholder={parsed?.name ?? 'e.g. Invoices'} />
      </label>
      {parsed && !existing && (
        <fieldset className="space-y-1">
          <legend className="text-2xs font-medium text-fg-muted">Does it need a key?</legend>
          <div className="flex gap-1" role="radiogroup" aria-label="Sign-in">
            {([['none', 'No'], ['api_key', 'API key'], ['bearer', 'Token']] as const).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={auth === v} onClick={() => setAuth(v)}
                className={cn('h-6 flex-1 rounded border text-2xs', auth === v ? 'border-primary bg-primary-wash text-primary-text' : 'border-border')}>{l}</button>
            ))}
          </div>
          {auth === 'api_key' && <input className={cn(inputCls, 'font-mono')} aria-label="Header name" value={keyName} onChange={(e) => setKeyName(e.target.value)} />}
          {auth !== 'none' && <input className={inputCls} type="password" autoComplete="off" aria-label={auth === 'api_key' ? 'API key' : 'Token'} placeholder={auth === 'api_key' ? 'The API key' : 'The token'} value={secret} onChange={(e) => setSecret(e.target.value)} />}
          {auth !== 'none' && <p className="text-2xs text-fg-muted">Stored encrypted with the connection; never shown again or sent to the browser.</p>}
        </fieldset>
      )}
      {state.error && <p className="text-2xs text-danger" role="alert">{state.error}</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={create} disabled={!parsed || state.busy} className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-2xs font-medium text-primary-fg disabled:opacity-50" data-testid="new-api-reference-create">
          {state.busy && <Loader2 size={11} className="animate-spin" aria-hidden />} Create and use it
        </button>
        <button type="button" onClick={onCancel} className="text-2xs text-fg-muted">Cancel</button>
      </div>
      <p className="text-2xs text-fg-muted">Reads only (GET). For other methods, sign-in types or response settings, use Integrations.</p>
    </div>
  )
}

/* ── The picker ───────────────────────────────────────────────────────── */

export interface ApiTestResult { root: SchemaNode; sample: unknown }

export interface ApiSourcePickerProps {
  mode: 'rows' | 'options'
  referenceId: string | undefined
  /** A reference chosen (or made): the caller resets its rows / columns and takes the suggested parameter mappings. */
  onReference: (ref: { id: string; integration_id?: string; inputs: RefInputLike[]; mappings?: Record<string, string> } | null) => void
  mappings: Record<string, string> | undefined
  onMappings: (next: Record<string, string> | undefined, tag?: string) => void
  /** The rows in use ('' = the response itself; undefined = not chosen yet). */
  resultsPath: string | undefined
  /** A badge action (dropped or chosen from its menu). */
  onBadgeAction: (action: BadgeAction, badge: Pick<ResponseBadge, 'path' | 'kind' | 'rowPath'>, test: ApiTestResult) => void
  /** Variables offered in the parameters (besides the designer's scope). */
  placeholders?: Array<{ name: string; group: string; label?: string }>
  /** Fields a same-named parameter is filled from (and the token prefix: form / task_data). */
  suggestFrom?: { fields: Array<{ key: string; label?: string }>; prefix: string }
  /** The table's own state ({{page}}, {{sort}}…) may be suggested (rows mode). */
  tableState?: boolean
  /** Steps 5+ under the response (columns, value / label, refresh). */
  children?: (test: ApiTestResult | null) => React.ReactNode
  /** The last test's response (the caller keeps it for its own previews). */
  onTested?: (test: ApiTestResult | null) => void
}

export function ApiSourcePicker({ mode, referenceId, onReference, mappings, onMappings, resultsPath, onBadgeAction, placeholders = [], suggestFrom, tableState = mode === 'rows', children, onTested }: ApiSourcePickerProps) {
  const queryClient = useQueryClient()
  const { data: references = [], isLoading, error: listError } = useApiReferences()
  const reference = (references as any[]).find((r) => String(r.id) === referenceId)
  const inputs: RefInputLike[] = Array.isArray(reference?.inputs) ? reference.inputs.filter((i: any) => i?.name) : []
  const [creating, setCreating] = useState(false)
  const [testValues, setTestValues] = useState<Record<string, string>>({})
  const [run, setRun] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; help?: ApiErrorHelp; note?: string }>({ status: 'idle' })
  // A just-loaded response; else the reference's stored one (its last test).
  const [loaded, setLoaded] = useState<ResponseSchema | null>(null)
  useEffect(() => { setLoaded(null); setRun({ status: 'idle' }); setTestValues({}) }, [referenceId])
  // Memoised on the reference row (a new model object every render would loop through onTested).
  const stored = useMemo(() => (reference ? referenceResponseSchema(reference) : null), [reference])
  const test = useMemo<ApiTestResult | null>(() => {
    const view = responseView(loaded ?? stored)
    return view.root ? { root: view.root, sample: view.sample } : null
  }, [loaded, stored])
  const onTestedRef = useRef(onTested)
  onTestedRef.current = onTested
  useEffect(() => { onTestedRef.current?.(test) }, [test])
  // A response already there (the reference's last test) and no rows chosen yet: start with the most likely list.
  const actionRef = useRef(onBadgeAction)
  useEffect(() => { actionRef.current = onBadgeAction })
  const autoPicked = useRef<string | null>(null)
  useEffect(() => {
    if (!test || !referenceId || resultsPath !== undefined || autoPicked.current === referenceId) return
    const { best } = detectRowArrays(test.root, test.sample)
    if (best === null) return
    autoPicked.current = referenceId
    actionRef.current('use_rows', { path: best, kind: 'rows' }, test)
  }, [test, referenceId, resultsPath])

  const options = (references as any[])
    .filter((r) => !isWriteReference(r) || String(r.id) === referenceId)
    .map((r) => ({ value: String(r.id), label: String(r.name), hint: referencePickerHint(r) }))
  const href = settingsHref(reference)

  function choose(id: string, list: any[] = references as any[]) {
    const ref = list.find((r) => String(r.id) === id)
    if (!ref) { onReference(null); return }
    const refInputs: RefInputLike[] = Array.isArray(ref.inputs) ? ref.inputs.filter((i: any) => i?.name) : []
    // Parameters filled in from their names.
    const suggested = suggestInputMappings(refInputs, suggestFrom?.fields ?? [], {}, { fieldPrefix: suggestFrom?.prefix, tableState })
    onReference({ id, integration_id: ref.integration?.id ? String(ref.integration.id) : ref.integration_id ? String(ref.integration_id) : undefined, inputs: refInputs, ...(Object.keys(suggested).length ? { mappings: suggested } : {}) })
  }

  async function runTest() {
    if (!referenceId) return
    setRun({ status: 'loading' })
    const values: Record<string, string> = {}
    for (const input of inputs) {
      const v = testValues[input.name] ?? testValue(mappings?.[input.name], input)
      if (v !== '') values[input.name] = v
    }
    try {
      const res = await fetch('/api/integrations/reference-sample', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ reference_id: referenceId, inputs: values }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.response_schema) throw new Error(json?.error ?? 'The test call failed')
      const schema = json.response_schema as ResponseSchema
      setLoaded(schema)
      queryClient.setQueryData(REFERENCES_QUERY_KEY, (rows: any[] | undefined) => (rows ?? []).map((r) => (String(r.id) === referenceId ? { ...r, request_config: { ...(r.request_config ?? {}), response_schema: schema } } : r)))
      const view = responseView(schema)
      const { best } = detectRowArrays(view.root, view.sample)
      // First test (or rows no longer in the response): the most likely list becomes the rows.
      const current = resultsPath ?? null
      const stillThere = current !== null && view.root ? detectRowArrays(view.root, view.sample).candidates.some((c) => c.path === current) : false
      if (view.root && best !== null && !stillThere) onBadgeAction('use_rows', { path: best, kind: 'rows' }, { root: view.root, sample: view.sample })
      const rows = view.root ? sampleRows(view.sample, stillThere ? current : best).length : 0
      setRun({ status: 'done', note: best === null ? 'The API answered, but its response has no list of records.' : `It worked: ${rows} row${rows === 1 ? '' : 's'} found${best ? ` in “${best.split('.').pop()}”` : ''}.` })
    } catch (e) {
      setRun({ status: 'error', help: explainApiError(e instanceof Error ? e.message : String(e)) })
    }
  }

  const missing = inputs.filter((i) => i.required && !(testValues[i.name] ?? testValue(mappings?.[i.name], i)).trim())
  const rowsInUse = resultsPath ?? null

  return (
    <div className="min-w-0 space-y-3" data-testid={`api-source-picker-${mode}`}>
      <Step n={1} title="Which API?" done={!!reference} testId="which">
        {listError && <p className="text-2xs text-danger" role="alert">{(listError as Error).message}</p>}
        {!creating && (
          <AutocompleteSelect value={referenceId ?? ''} placeholder={isLoading ? 'Loading…' : options.length ? 'Choose a saved API…' : 'No saved APIs yet — create one'} options={options}
            onChange={(v) => choose(v)} />
        )}
        {isWriteReference(reference) && <p className="text-2xs text-danger" role="alert">This API reference changes data, so it can&apos;t fill a table or a list. Choose one that reads.</p>}
        {!creating && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1 text-2xs font-medium text-primary-text" data-testid="api-new-reference"><Plus size={11} aria-hidden /> New API from a web address</button>
            {href && <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-2xs text-fg-muted hover:text-fg" data-testid="api-reference-settings">Open its settings <ExternalLink size={10} aria-hidden /></a>}
          </div>
        )}
        {creating && (
          <NewReferenceForm onCancel={() => setCreating(false)} onCreated={async (id) => {
            setCreating(false)
            const fresh = await queryClient.fetchQuery({ queryKey: REFERENCES_QUERY_KEY, staleTime: 0, queryFn: async () => ((await serverRead('integrations.references')).data ?? []) as any[] })
            choose(id, fresh as any[])
          }} />
        )}
      </Step>

      {reference && (
        <Step n={2} title={inputs.length ? 'What to send' : 'What to send (nothing needed)'} done={inputs.length === 0 || !inputs.some((i) => i.required && !mappings?.[i.name] && !i.default_value)} testId="send">
          {inputs.length === 0 && <p className="text-2xs text-fg-muted">This API takes no parameters.</p>}
          {inputs.map((input) => {
            const mapped = mappings?.[input.name] ?? ''
            return (
              <div key={input.name} className="min-w-0" data-api-input={input.name}>
                <p className="text-2xs font-medium text-fg">{humanizeLabel(input.name)}{input.required ? <span className="text-danger"> *</span> : null}
                  <span className="font-normal text-fg-muted"> {input.description ? `· ${input.description}` : ''}</span></p>
                <VariableInput value={mapped} extraVariables={placeholders} ariaLabel={`${humanizeLabel(input.name)} parameter`}
                  placeholder={input.default_value !== undefined && input.default_value !== '' && input.default_value !== null ? `Empty: uses “${String(input.default_value)}”` : 'A value, or pick a form field with {x}'}
                  onChange={(v) => { const m = { ...(mappings ?? {}) }; if (v) m[input.name] = v; else delete m[input.name]; onMappings(Object.keys(m).length ? m : undefined, `api-in-${input.name}`) }} />
              </div>
            )
          })}
          {inputs.length > 0 && (
            <button type="button" className="inline-flex items-center gap-1 text-2xs font-medium text-primary-text"
              onClick={() => { const s = suggestInputMappings(inputs, suggestFrom?.fields ?? [], mappings ?? {}, { fieldPrefix: suggestFrom?.prefix, tableState }); onMappings({ ...(mappings ?? {}), ...s }) }}>
              <Wand2 size={11} aria-hidden /> Fill in from matching fields
            </button>
          )}
        </Step>
      )}

      {reference && !isWriteReference(reference) && (
        <Step n={3} title="Test it" done={!!test} testId="test">
          {inputs.some((i) => (mappings?.[i.name] ?? '').includes('{{')) && (
            <div className="space-y-1 rounded border border-dashed border-border p-1.5">
              <p className="text-2xs text-fg-muted">Values for the test call (the form fills these in for real):</p>
              {inputs.filter((i) => (mappings?.[i.name] ?? '').includes('{{')).map((i) => (
                <label key={i.name} className="grid grid-cols-[6rem_1fr] items-center gap-1 text-2xs">
                  <span className="truncate">{humanizeLabel(i.name)}</span>
                  <input className={inputCls} value={testValues[i.name] ?? testValue(undefined, i)} onChange={(e) => setTestValues((v) => ({ ...v, [i.name]: e.target.value }))} aria-label={`Test value for ${humanizeLabel(i.name)}`} />
                </label>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={runTest} disabled={run.status === 'loading' || missing.length > 0}
              className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-2xs font-medium text-primary-fg disabled:opacity-50" data-testid="api-test">
              {run.status === 'loading' ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <FlaskConical size={11} aria-hidden />}
              {test ? 'Test again' : 'Test'}
            </button>
            {missing.length > 0 && <span className="text-2xs text-fg-muted">Needs a value for {missing.map((m) => humanizeLabel(m.name)).join(', ')}</span>}
            {run.status === 'loading' && <span className="text-2xs text-fg-muted" role="status">Calling the API…</span>}
          </div>
          <div aria-live="polite">
            {run.status === 'done' && run.note && <p className="flex items-center gap-1 text-2xs text-success" data-testid="api-test-ok"><CheckCircle2 size={11} aria-hidden /> {run.note}</p>}
            {run.status === 'error' && run.help && (
              <div role="alert" className="space-y-0.5 rounded border border-danger/40 bg-danger/5 p-1.5" data-testid="api-test-error">
                <p className="flex items-center gap-1 text-2xs font-semibold text-danger"><AlertTriangle size={11} aria-hidden /> {run.help.title}</p>
                <p className="text-2xs text-fg">{run.help.fix}</p>
                {run.help.settings && href && <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-2xs font-medium text-primary-text">Open the reference settings <ExternalLink size={10} aria-hidden /></a>}
              </div>
            )}
          </div>
          {!test && run.status !== 'error' && <p className="text-2xs text-fg-muted">Calls the API once so you can see what comes back and pick what to show.</p>}
        </Step>
      )}

      {reference && test && (
        <Step n={4} title={mode === 'rows' ? 'Pick the rows' : 'Pick the options'} done={resultsPath !== undefined} testId="pick">
          <p className="text-2xs text-fg-muted">
            {mode === 'rows' ? 'The list marked “rows in use” fills the table. ' : 'The list marked “rows in use” gives the options. '}
            Drag a badge onto the {mode === 'rows' ? 'table settings below' : 'value or label below'}, or click it for choices.
          </p>
          <ResponseDropZone testId="rows" label={mode === 'rows' ? 'Drop a list here to fill the table with it' : 'Drop a list here to take the choices from it'}
            accepts={(p) => p.kind === 'rows' || p.kind === 'sublist'} onDrop={(p) => onBadgeAction('use_rows', p, test)} className="px-1.5 py-1">
            <p className="text-2xs" data-testid="api-rows-in-use">
              <span className="text-fg-muted">{mode === 'rows' ? 'Rows from: ' : 'Choices from: '}</span>
              <span className="font-medium text-fg">{rowsInUse === null ? 'drop a list here' : rowsInUse === '' ? 'the whole response' : rowsInUse.split('.').pop()?.replace('[]', '')}</span>
            </p>
          </ResponseDropZone>
          <ResponseBadgeTree root={test.root} sample={test.sample} rowsPath={rowsInUse} mode={mode} onAction={(a, b) => onBadgeAction(a, b, test)} />
        </Step>
      )}

      {reference && children?.(test)}
    </div>
  )
}
