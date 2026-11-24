'use client'

/**
 * Extensibility → Workflow actions → Manage → Test: pick a function, fill
 * its generated input form (or edit the inputs as JSON), run it in the
 * sandbox and read the outputs as a typed table, with the raw JSON,
 * duration, logs, warnings and errors. Enter (or Cmd / Ctrl + Enter in a
 * multi-line box) runs. The last inputs per function are remembered in
 * this browser (never secrets).
 */

import { useMemo, useState } from 'react'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/field'
import { Kbd } from '@/components/ui/kbd'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { plural } from '@/lib/format/plural'
import type { ActionManifest, ActionOperation } from '@/lib/custom-actions/contract'
import {
  actionFieldToTestField, fieldsNamedInError, formatOutputValue, operationSample, outputRows, redactSecrets,
  secretValuesOf, testInputsStorageKey, validateActionInputs,
} from '@/lib/extensibility-test-inputs'
import { testWorkflowAction } from '@/app/actions/extensibility'
import { TestInputForm, useTestInputs } from './test-input-form'

function formatBytes(n: number | null | undefined) {
  if (n === null || n === undefined) return '—'
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

export interface ActionTestResultView {
  ok: boolean
  outputs?: Record<string, unknown>
  logs?: Array<{ level: string; message: string }>
  warnings?: string[]
  error?: { message: string; code: string } | null
  stats?: { duration_ms?: number; host_calls?: number; memory_bytes?: number | null } | null
}

export function ActionTestRunner({ manifest, activityId, canEdit, strict = true, demoInputs, run = testWorkflowAction }: {
  manifest: ActionManifest
  activityId: string
  canEdit: boolean
  /**
   * Packaged actions (runtime module) refuse inputs that fail their declared
   * types, so the form blocks the run too. Script activities (legacy) get
   * their inputs as they are: problems are shown but don't block.
   */
  strict?: boolean
  /** A script activity's saved demo inputs (the starting values when its function declares no sample). */
  demoInputs?: Record<string, unknown> | null
  /** The test call (the server action; injectable for tests). */
  run?: typeof testWorkflowAction
}) {
  const [operationId, setOperationId] = useState(manifest.operations[0]?.id ?? '')
  const operation = manifest.operations.find((o) => o.id === operationId) ?? manifest.operations[0]
  if (!operation) return <p className="text-ui text-fg-muted">This action declares no functions.</p>
  const picker = manifest.operations.length > 1 ? (
    <Field label="Function" id="test-op" className="min-w-[200px] max-w-sm">
      <Select value={operation.id} onChange={(e) => setOperationId(e.target.value)}>
        {manifest.operations.map((op) => <option key={op.id} value={op.id}>{op.label}</option>)}
      </Select>
    </Field>
  ) : null
  // Keyed by the function: switching regenerates the form (and its remembered inputs) and clears the result.
  const sample = { ...(demoInputs && typeof demoInputs === 'object' && !Array.isArray(demoInputs) ? demoInputs : {}), ...operationSample(operation) }
  return <OperationTest key={operation.id} activityId={activityId} operation={operation} canEdit={canEdit} picker={picker} run={run} single={manifest.operations.length === 1} strict={strict} sample={sample} />
}

function OperationTest({ activityId, operation, canEdit, picker, run, single, strict, sample }: {
  activityId: string
  operation: ActionOperation
  canEdit: boolean
  picker: React.ReactNode
  run: typeof testWorkflowAction
  single: boolean
  strict: boolean
  sample: Record<string, unknown>
}) {
  const fields = useMemo(() => operation.inputs.map((f) => actionFieldToTestField(f)), [operation])
  const state = useTestInputs(fields, { storageKey: testInputsStorageKey('action', activityId, operation.id), sample })
  const [attempted, setAttempted] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ActionTestResultView | null>(null)
  const validation = useMemo(() => validateActionInputs(operation, state.values), [operation, state.values])
  // Before the first run only errors in what was typed show; "required" waits for a run attempt.
  const shown = useMemo(() => Object.fromEntries(Object.entries(validation).filter(([name]) => attempted || !/ is required$/.test(validation[name]))), [validation, attempted])
  const blocking = (strict && Object.keys(validation).length > 0) || Object.keys(state.textErrors).length > 0 || Boolean(state.jsonMode && state.jsonError)
  const highlight = result && !result.ok && result.error?.code === 'invalid' ? fieldsNamedInError(fields, result.error.message) : []

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setAttempted(true)
    if (!canEdit || running || blocking) return
    const inputs = state.inputs()
    state.remember()
    setRunning(true)
    const res = await run(activityId, { operation: operation.id, inputs })
    setRunning(false)
    const view: ActionTestResultView = res.ok ? res.data : { ok: false, error: { message: res.error, code: 'host' }, logs: [] }
    // Secret inputs are never echoed back: scrub them from outputs, logs and errors.
    setResult(redactSecrets(view, secretValuesOf(fields, state.values)))
  }

  return (
    <form className="space-y-4" onSubmit={submit} noValidate data-testid="action-test" aria-label={`Test ${operation.label}`}>
      <div className="flex flex-wrap items-end gap-3">
        {picker}
        <div className={cn('min-w-0 flex-1 text-xs text-fg-muted', !picker && 'self-center')}>
          {single && <span className="font-medium text-fg">{operation.label} </span>}
          {operation.description}
        </div>
        <Button type="submit" disabled={!canEdit || running} loading={running} leadingIcon={<Play />} aria-keyshortcuts="Enter Meta+Enter Control+Enter">Run test</Button>
      </div>
      <TestInputForm
        state={state}
        idBase={`test-${operation.id}`}
        errors={shown}
        highlight={highlight}
        disabled={running}
        emptyText="This function takes no inputs."
      />
      {attempted && blocking && !running && (
        <p className="text-xs text-danger" role="alert">Fix the highlighted inputs to run the test.</p>
      )}
      {!canEdit && <p className="text-xs text-fg-muted">Running a test needs the Extensibility edit permission.</p>}
      <p className="text-2xs text-fg-muted">Press <Kbd>Enter</Kbd> to run (<Kbd>⌘</Kbd>/<Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> in a multi-line box). The last inputs are remembered in this browser, never secrets.</p>
      {result && <ActionTestResultPanel result={result} operation={operation} />}
    </form>
  )
}

export function ActionTestResultPanel({ result, operation }: { result: ActionTestResultView; operation: ActionOperation }) {
  const rows = result.ok ? outputRows(operation.outputs, result.outputs) : []
  const stats = result.stats
  return (
    <section className="space-y-3 border-t border-border-subtle pt-3" role="status" aria-label="Test result" data-testid="test-result">
      <p className={cn('num text-ui font-semibold', result.ok ? 'text-success' : 'text-danger')}>
        {result.ok
          ? `Succeeded in ${stats?.duration_ms ?? '?'} ms · ${plural(stats?.host_calls ?? 0, 'host call')} · ${formatBytes(stats?.memory_bytes)} memory`
          : `Failed (${result.error?.code ?? 'error'}): ${result.error?.message ?? 'Unknown error'}`}
      </p>
      {result.ok && (
        rows.length === 0
          ? <p className="text-xs text-fg-muted">The function returned no outputs.</p>
          : (
            <Table label="Outputs" className="text-xs">
              <THead><tr><TH>Output</TH><TH>Type</TH><TH>Value</TH></tr></THead>
              <TBody>
                {rows.map((row) => {
                  const { text, long } = formatOutputValue(row.value)
                  return (
                    <TR key={row.name} data-output={row.name}>
                      <TD className="align-top font-mono">{row.name}</TD>
                      <TD className="align-top whitespace-nowrap text-fg-muted">{row.type}{!row.declared && ' (undeclared)'}</TD>
                      <TD className="max-w-[28rem] align-top">
                        {row.missing ? <span className="text-fg-muted">Not returned</span>
                          : row.value === null ? <span className="text-fg-muted">null</span>
                            : long ? (
                              <details>
                                <summary className="cursor-pointer truncate font-mono">{text.slice(0, 80)}…</summary>
                                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-border-subtle bg-subtle p-2 font-mono text-2xs">{text}</pre>
                              </details>
                            ) : <span className="whitespace-pre-wrap break-words font-mono">{text}</span>}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )
      )}
      {(result.warnings ?? []).map((w) => <p key={w} className="text-xs text-warning">{w}</p>)}
      {(result.logs ?? []).length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-fg">Logs</p>
          <ul className="max-h-48 space-y-0.5 overflow-auto rounded-md border border-border-subtle bg-subtle p-2 font-mono text-2xs">
            {result.logs!.map((l, i) => <li key={i}><span className={l.level === 'error' ? 'text-danger' : l.level === 'warn' ? 'text-warning' : 'text-fg-muted'}>{l.level}</span> {l.message}</li>)}
          </ul>
        </div>
      )}
      {result.ok && (
        <details className="text-xs">
          <summary className="cursor-pointer text-fg-muted">Raw JSON</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded-md border border-border-subtle bg-subtle p-2 font-mono text-2xs">{JSON.stringify(result.outputs ?? {}, null, 2)}</pre>
        </details>
      )}
    </section>
  )
}
