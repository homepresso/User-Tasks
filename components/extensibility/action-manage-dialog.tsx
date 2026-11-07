'use client'

/**
 * Extensibility → Workflow actions → Manage: one action's functions and
 * capabilities, the administrator's grants (kill switch, approved HTTP hosts,
 * data tables, secrets), a Test runner (outputs, logs, warnings, stats),
 * versions with checksums / signatures, and where it is used.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- action summaries are free-form JSON */

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Database, FileText, Globe, KeyRound, Play, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Field } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Tabs } from '@/components/ui/tabs'
import { Tooltip } from '@/components/ui/tooltip'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'
import { Dialog, DialogBody, DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/format/date'
import { formatCount } from '@/lib/format/number'
import { plural } from '@/lib/format/plural'
import { actionFieldTypeLabel } from '@/lib/custom-actions/manifest'
import type { ActionManifest } from '@/lib/custom-actions/contract'
import { getWorkflowActionDetail, listGrantableTables, setWorkflowActionSecrets, testWorkflowAction, updateWorkflowActionAccess } from '@/app/actions/extensibility'

type Tab = 'overview' | 'access' | 'test' | 'versions' | 'usages'

function formatBytes(n: number | null | undefined) {
  if (n === null || n === undefined) return '—'
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

/** Keyed by the action so its tabs and notices start fresh for each one. */
export function ActionManageDialog(props: { activityId: string | null; canEdit: boolean; onClose: () => void }) {
  return <ActionManageDialogInner key={props.activityId ?? 'none'} {...props} />
}

function ActionManageDialogInner({ activityId, canEdit, onClose }: { activityId: string | null; canEdit: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const { data, refetch, isLoading } = useQuery({
    queryKey: ['workflow-action-detail', activityId],
    queryFn: async () => {
      const res = await getWorkflowActionDetail(activityId!)
      if (!res.ok) throw new Error(res.error)
      return res.data
    },
    enabled: Boolean(activityId),
  })
  const action = data?.activity as any
  const manifest = action?.action_manifest as ActionManifest | undefined
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(input: Parameters<typeof updateWorkflowActionAccess>[1], ok: string) {
    setBusy(true)
    const res = await updateWorkflowActionAccess(activityId!, input)
    setBusy(false)
    if (!res.ok) { setNotice({ kind: 'error', text: res.error }); return }
    setNotice({ kind: 'ok', text: ok })
    await refetch()
    await queryClient.invalidateQueries({ queryKey: ['custom-workflow-activities'] })
  }

  return (
    <Dialog open={Boolean(activityId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="xl"
        className="max-h-[90vh]"
        title={action?.name ?? 'Workflow action'}
        description={action ? <><code className="font-mono text-xs">{action.key}</code> · v{action.version} · {action.runtime === 'module' ? 'Packaged action' : 'Script activity'}{action.signature?.verified ? ' · Signed' : ''}</> : 'Loading…'}
      >
        <DialogBody className="space-y-4">
          {action && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Switch
                  label="Enabled"
                  checked={action.enabled !== false}
                  disabled={!canEdit || busy}
                  onCheckedChange={(checked: boolean) => save({ enabled: checked }, checked ? 'Enabled' : 'Disabled — steps using it now fail fast')}
                />
                {action.signature?.verified && (
                  <Tooltip content={`Signer fingerprint ${action.signature.key_fingerprint}`}>
                    <Badge tone="success" tabIndex={0}>
                      <BadgeCheck size={12} aria-hidden="true" className="-ml-0.5 mr-1 inline" />{action.signature.via === 'package' ? 'Signed package' : 'Signed'}
                    </Badge>
                  </Tooltip>
                )}
                <Tooltip content="SHA-256 of the module">
                  <span className="font-mono text-2xs text-fg-muted" tabIndex={0}>sha256 {String(action.sha256 ?? '').slice(0, 16)}…</span>
                </Tooltip>
                {!action.code_execution_enabled && <span className="text-xs text-warning">Execution is switched off on this server</span>}
              </div>

              <Tabs
                aria-label="Action"
                value={tab}
                onValueChange={setTab}
                items={[
                  { value: 'overview', label: 'Functions' },
                  { value: 'access', label: 'Access' },
                  { value: 'test', label: 'Test' },
                  { value: 'versions', label: 'Versions', count: action.versions?.length ?? 0 },
                  { value: 'usages', label: 'Used by', count: data?.usages.length ?? 0 },
                ]}
              />

              {notice && (
                <InlineNotice tone={notice.kind === 'ok' ? 'success' : 'danger'} message={notice.text} />
              )}

              <div>
                {tab === 'overview' && manifest && <Overview manifest={manifest} action={action} />}
                {tab === 'access' && manifest && <Access manifest={manifest} action={action} canEdit={canEdit} busy={busy} onSave={save} onSecrets={async (values) => {
                  setBusy(true)
                  const res = await setWorkflowActionSecrets(activityId!, values)
                  setBusy(false)
                  setNotice(res.ok ? { kind: 'ok', text: 'Secrets saved (encrypted)' } : { kind: 'error', text: res.error })
                  if (res.ok) await refetch()
                }} />}
                {tab === 'test' && manifest && <TestRunner manifest={manifest} activityId={activityId!} canEdit={canEdit} />}
                {tab === 'versions' && (
                  <Table>
                    <THead>
                      <tr><TH>Version</TH><TH>Origin</TH><TH numeric>Size</TH><TH>SHA-256</TH><TH>Signature</TH><TH>Added</TH></tr>
                    </THead>
                    <TBody>
                      {(action.versions ?? []).map((v: any) => (
                        <TR key={v.version}>
                          <TD className="font-mono text-xs">{v.version}{v.version === action.version && <Badge tone="brand" className="ml-2 font-sans">Current</Badge>}</TD>
                          <TD>{v.origin}</TD>
                          <TD numeric>{formatBytes(v.size_bytes)}</TD>
                          <TD className="font-mono text-xs">
                            <Tooltip content={v.sha256}><span tabIndex={0}>{String(v.sha256).slice(0, 12)}…</span></Tooltip>
                          </TD>
                          <TD>{v.signature?.verified ? `Verified (${String(v.signature.key_fingerprint).slice(0, 8)}…)` : v.signature ? 'Unverified' : '—'}</TD>
                          <TD className="text-fg-muted">{v.created_at ? formatDate(v.created_at) : '—'}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
                {tab === 'usages' && (
                  (data?.usages.length ?? 0) === 0
                    ? <p className="text-ui text-fg-muted">No workflow uses this action yet. It can be deleted.</p>
                    : <ul className="divide-y divide-border-subtle text-ui">{data!.usages.map((u: any, i: number) => (
                      <li key={`${u.id}-${i}`} className="py-2"><a className="text-primary-text hover:underline" href={`/automations/${u.id}`}>{u.name}</a> › {u.node_label} <span className="text-fg-muted">({u.where}{u.operation ? `, ${u.operation}` : ''})</span></li>
                    ))}</ul>
                )}
              </div>
            </>
          )}
          {isLoading && <p className="text-ui text-fg-muted">Loading…</p>}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function Overview({ manifest, action }: { manifest: ActionManifest; action: any }) {
  const caps = manifest.capabilities ?? {}
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-fg">
        {!caps.http && !caps.data && !caps.files && !caps.credentials?.length && <span className="inline-flex items-center gap-1"><ShieldCheck size={14} className="text-success" aria-hidden="true" /> Pure computation — no network, data, files or secrets</span>}
        {caps.http && <span className="inline-flex items-center gap-1"><Globe size={14} className="text-fg-muted" aria-hidden="true" /> HTTP: {caps.http.hosts.join(', ')}</span>}
        {caps.data && <span className="inline-flex items-center gap-1"><Database size={14} className="text-fg-muted" aria-hidden="true" /> Data tables ({caps.data.write ? 'read / write' : 'read'})</span>}
        {caps.files && <span className="inline-flex items-center gap-1"><FileText size={14} className="text-fg-muted" aria-hidden="true" /> Files given as inputs</span>}
        {(caps.credentials?.length ?? 0) > 0 && <span className="inline-flex items-center gap-1"><KeyRound size={14} className="text-fg-muted" aria-hidden="true" /> Secrets: {caps.credentials!.map((s) => s.name).join(', ')}</span>}
        <span className="num text-fg-muted">Limits: {formatCount(manifest.limits.timeout_ms)} ms · {formatCount(manifest.limits.memory_mb)} MB</span>
      </div>
      {(manifest.description || action.description) && <p className="text-ui text-fg-muted">{manifest.description || action.description}</p>}
      <div className="grid gap-2 md:grid-cols-2">
        {manifest.operations.map((op) => (
          <Card key={op.id} variant="inset" padding="sm" className="space-y-1.5">
            <p className="text-ui font-semibold text-fg">{op.label} <code className="font-mono text-2xs font-normal text-fg-muted">{op.id}</code></p>
            {op.description && <p className="text-xs text-fg-muted">{op.description}</p>}
            <p className="text-xs text-fg-muted"><span className="font-medium text-fg">In:</span> {op.inputs.map((f) => `${f.name}${f.required ? '*' : ''} (${actionFieldTypeLabel(f)})`).join(', ') || 'none'}</p>
            <p className="text-xs text-fg-muted"><span className="font-medium text-fg">Out:</span> {op.outputs.map((f) => `${f.name} (${actionFieldTypeLabel(f)})`).join(', ')}</p>
          </Card>
        ))}
      </div>
    </div>
  )
}

function Access({ manifest, action, canEdit, busy, onSave, onSecrets }: {
  manifest: ActionManifest
  action: any
  canEdit: boolean
  busy: boolean
  onSave: (input: Parameters<typeof updateWorkflowActionAccess>[1], ok: string) => Promise<void>
  onSecrets: (values: Record<string, string | null>) => Promise<void>
}) {
  const caps = manifest.capabilities ?? {}
  const [hosts, setHosts] = useState<string[]>(action.approved_hosts ?? [])
  const [grants, setGrants] = useState<Array<{ table_id: string; access: 'read' | 'write' }>>((action.data_grants ?? []).map((g: any) => ({ table_id: g.table_id, access: g.access })))
  const [secretValues, setSecretValues] = useState<Record<string, string>>({})
  const { data: tables = [] } = useQuery({
    queryKey: ['grantable-tables'],
    queryFn: async () => { const r = await listGrantableTables(); return r.ok ? r.data : [] },
    enabled: Boolean(caps.data),
  })
  const tableName = useMemo(() => new Map(tables.map((t: any) => [t.id, t.name])), [tables])
  if (!caps.http && !caps.data && !caps.credentials?.length && !caps.files) {
    return <p className="text-ui text-fg-muted">This action declares no capabilities: it only computes with its inputs. Nothing to approve.</p>
  }
  return (
    <div className="space-y-6">
      {caps.http && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-fg">Approved HTTP hosts</h3>
          <p className="text-xs text-fg-muted">Requests go through the egress guard (no private or metadata addresses) and only to hosts you tick here.</p>
          {caps.http.hosts.map((h) => (
            <Checkbox
              key={h}
              disabled={!canEdit}
              checked={hosts.includes(h)}
              onChange={(e) => setHosts((prev) => e.target.checked ? [...prev, h] : prev.filter((x) => x !== h))}
              label={<code className="font-mono text-xs">{h}</code>}
              className="flex"
            />
          ))}
          {canEdit && <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSave({ approved_hosts: hosts }, 'Hosts saved')}>Save hosts</Button>}
        </section>
      )}
      {caps.data && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-fg">Data tables</h3>
          <p className="text-xs text-fg-muted">The action can only reach tables granted here ({caps.data.write ? 'read or read / write' : 'read only'}).</p>
          {grants.map((g, i) => (
            <div key={`${g.table_id}-${i}`} className="flex items-center gap-2 text-ui">
              <span className="min-w-0 flex-1 truncate">{tableName.get(g.table_id) ?? g.table_id}</span>
              <Select size="sm" wrapperClassName="w-auto" aria-label="Access" disabled={!canEdit || !caps.data?.write} value={g.access} onChange={(e) => setGrants((prev) => prev.map((x, j) => j === i ? { ...x, access: e.target.value as 'read' | 'write' } : x))}>
                <option value="read">Read</option>
                {caps.data?.write && <option value="write">Read / write</option>}
              </Select>
              {canEdit && <IconButton size="sm" label="Remove" icon={<X />} onClick={() => setGrants((prev) => prev.filter((_, j) => j !== i))} />}
            </div>
          ))}
          {canEdit && (
            <Select size="sm" wrapperClassName="w-auto" value="" onChange={(e) => e.target.value && setGrants((prev) => [...prev, { table_id: e.target.value, access: 'read' }])} aria-label="Grant a table">
              <option value="">Grant a table…</option>
              {tables.filter((t: any) => !grants.some((g) => g.table_id === t.id)).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          )}
          {canEdit && <div><Button size="sm" variant="secondary" disabled={busy} onClick={() => onSave({ data_grants: grants }, 'Table grants saved')}>Save grants</Button></div>}
        </section>
      )}
      {(caps.credentials?.length ?? 0) > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-fg">Secrets</h3>
          <p className="text-xs text-fg-muted">Stored encrypted; never shown again. The action reads them as <code className="font-mono">secret://name</code>.</p>
          {caps.credentials!.map((s) => {
            const status = (action.capabilities?.secrets ?? []).find((x: any) => x.name === s.name)
            return (
              <div key={s.name} className="space-y-1">
                <label htmlFor={`secret-${s.name}`} className="flex flex-wrap items-center gap-2 text-ui font-medium text-fg">
                  {s.label ?? s.name} <code className="font-mono text-2xs font-normal text-fg-muted">secret://{s.name}</code>
                  <Badge tone={status?.set ? 'success' : 'warning'}>{status?.set ? 'Set' : 'Not set'}</Badge>
                </label>
                {s.description && <p className="text-xs text-fg-muted">{s.description}</p>}
                {canEdit && (
                  <div className="flex gap-2">
                    <Input id={`secret-${s.name}`} type="password" autoComplete="off" value={secretValues[s.name] ?? ''} placeholder={status?.set ? '•••••••• (replace)' : 'Value'}
                      onChange={(e) => setSecretValues((prev) => ({ ...prev, [s.name]: e.target.value }))} />
                    {status?.set && <Button size="sm" variant="ghost" onClick={() => onSecrets({ [s.name]: null })}>Clear</Button>}
                  </div>
                )}
              </div>
            )
          })}
          {canEdit && <Button size="sm" variant="secondary" disabled={busy || !Object.values(secretValues).some(Boolean)} onClick={async () => { await onSecrets(Object.fromEntries(Object.entries(secretValues).filter(([, v]) => v))); setSecretValues({}) }}>Save secrets</Button>}
        </section>
      )}
      {caps.files && <p className="text-xs text-fg-muted">Files: the action can read only files given to it as file inputs in a workflow step (nothing to approve).</p>}
    </div>
  )
}

function TestRunner({ manifest, activityId, canEdit }: { manifest: ActionManifest; activityId: string; canEdit: boolean }) {
  const [operationId, setOperationId] = useState(manifest.operations[0]?.id ?? '')
  const operation = manifest.operations.find((o) => o.id === operationId) ?? manifest.operations[0]
  const sample = operation?.sample ?? Object.fromEntries((operation?.inputs ?? []).filter((f) => f.example !== undefined).map((f) => [f.name, f.example]))
  const [text, setText] = useState(JSON.stringify(sample, null, 2))
  const [result, setResult] = useState<any>(null)
  const [running, setRunning] = useState(false)
  async function run() {
    let inputs: Record<string, unknown>
    try { inputs = JSON.parse(text || '{}') } catch { setResult({ ok: false, error: { message: 'Inputs are not valid JSON', code: 'invalid' }, logs: [] }); return }
    setRunning(true)
    const res = await testWorkflowAction(activityId, { operation: operationId, inputs })
    setRunning(false)
    setResult(res.ok ? res.data : { ok: false, error: { message: res.error, code: 'host' }, logs: [] })
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Function" id="test-op" className="min-w-[200px]">
          <Select value={operationId} onChange={(e) => {
            const next = manifest.operations.find((o) => o.id === e.target.value)
            setOperationId(e.target.value)
            setText(JSON.stringify(next?.sample ?? Object.fromEntries((next?.inputs ?? []).filter((f) => f.example !== undefined).map((f) => [f.name, f.example])), null, 2))
            setResult(null)
          }}>
            {manifest.operations.map((op) => <option key={op.id} value={op.id}>{op.label}</option>)}
          </Select>
        </Field>
        <Button onClick={run} disabled={!canEdit || running} loading={running} leadingIcon={<Play />}>Run test</Button>
      </div>
      <Field label="Inputs (JSON)" id="test-inputs">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} className="bg-subtle font-mono text-xs" />
      </Field>
      {result && (
        <div className="space-y-2" role="status">
          <p className={cn('num text-ui font-semibold', result.ok ? 'text-success' : 'text-danger')}>
            {result.ok ? `Succeeded in ${result.stats?.duration_ms ?? '?'} ms · ${plural(result.stats?.host_calls ?? 0, 'host call')} · ${formatBytes(result.stats?.memory_bytes)} memory` : `Failed (${result.error?.code}): ${result.error?.message}`}
          </p>
          {result.ok && (
            <div className="space-y-1">
              {(operation?.outputs ?? []).map((f) => (
                <div key={f.name} className="text-xs"><code className="font-mono">{f.name}</code> <span className="text-fg-muted">({actionFieldTypeLabel(f)})</span></div>
              ))}
              <pre className="max-h-64 overflow-auto rounded-md border border-border-subtle bg-subtle p-2 font-mono text-2xs">{JSON.stringify(result.outputs, null, 2)}</pre>
            </div>
          )}
          {(result.warnings ?? []).map((w: string) => <p key={w} className="text-xs text-warning">{w}</p>)}
          {(result.logs ?? []).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-fg">Logs</p>
              <ul className="space-y-0.5 rounded-md border border-border-subtle bg-subtle p-2 font-mono text-2xs">{result.logs.map((l: any, i: number) => <li key={i}><span className={l.level === 'error' ? 'text-danger' : l.level === 'warn' ? 'text-warning' : 'text-fg-muted'}>{l.level}</span> {l.message}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
