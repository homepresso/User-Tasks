'use client'

import { useMemo, useRef, useState, type DragEvent } from 'react'
import { Download, FileUp, RefreshCw, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Badge, type Tone } from '@/components/ui/badge'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'
import { applyOrgImport, exportOrgStructure, orgImportTemplate, planOrgImport } from '@/app/actions/org-import'
import type { OrgImportColumn, OrgImportMapping, OrgImportPlan, OrgImportResult, OrgImportRowPlan } from '@/lib/services/org-import'
import { CSV_LIMITS } from '@/lib/org/csv'
import { cn } from '@/lib/utils'

/**
 * Organization → Manage → Import: upload a CSV, check the column mapping,
 * review the dry run (per-row diff, manager loops), then apply. Parsing and
 * planning run on the server (app/actions/org-import.ts); nothing is
 * written until Apply.
 */

const FIELD_LABELS: Record<OrgImportColumn, string> = {
  email: 'Email (required)',
  display_name: 'Name (not imported)',
  manager_email: 'Manager email',
  job_title: 'Job title',
  department: 'Department',
  division: 'Division',
  location: 'Location',
  employee_id: 'Employee ID',
  cost_center: 'Cost centre',
  team: 'Team(s)',
}
const FIELDS = Object.keys(FIELD_LABELS) as OrgImportColumn[]

const ACTION_TONE: Record<OrgImportRowPlan['action'], Tone> = { create: 'brand', update: 'info', unchanged: 'neutral', error: 'danger' }
const ACTION_LABEL: Record<OrgImportRowPlan['action'], string> = { create: 'New', update: 'Update', unchanged: 'Unchanged', error: 'Error' }

type Filter = 'all' | 'changes' | 'errors'

function download(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

export function OrgImportPanel({ canManage }: { canManage: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [csv, setCsv] = useState<string | null>(null)
  const [mapping, setMapping] = useState<OrgImportMapping>({})
  const [plan, setPlan] = useState<OrgImportPlan | null>(null)
  const [result, setResult] = useState<OrgImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'plan' | 'apply' | 'export' | 'template' | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [filter, setFilter] = useState<Filter>('changes')
  const [dragging, setDragging] = useState(false)

  async function runPlan(text: string, nextMapping: OrgImportMapping) {
    setBusy('plan'); setError(null); setResult(null)
    const res = await planOrgImport({ csv: text, mapping: nextMapping })
    setBusy(null)
    if (!res.ok) { setPlan(null); setError(res.error); return }
    setPlan(res.data)
    setMapping(res.data.mapping)
    setFilter(res.data.summary.create + res.data.summary.update + res.data.summary.errors ? 'changes' : 'all')
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null); setResult(null); setPlan(null)
    if (file.size > CSV_LIMITS.maxBytes) { setError(`The file is larger than ${CSV_LIMITS.maxBytes / 1024 / 1024} MB`); return }
    if (!/\.(csv|txt)$/i.test(file.name) && file.type && !/csv|text/.test(file.type)) { setError('Choose a .csv file'); return }
    const text = await file.text()
    setFileName(file.name)
    setCsv(text)
    setMapping({})
    await runPlan(text, {})
  }

  function onDrop(e: DragEvent) {
    e.preventDefault(); setDragging(false)
    void onFile(e.dataTransfer.files?.[0])
  }

  async function onMappingChange(field: OrgImportColumn, header: string) {
    const next = { ...mapping, [field]: header || null }
    setMapping(next)
    if (csv) await runPlan(csv, next)
  }

  async function onApply() {
    if (!csv) return
    setBusy('apply'); setError(null)
    const res = await applyOrgImport({ csv, mapping })
    setBusy(null); setConfirm(false)
    if (!res.ok) { setError(res.error); return }
    setResult(res.data)
    setPlan(res.data)
    setFilter(res.data.summary.errors ? 'errors' : 'changes')
  }

  async function onExport() {
    setBusy('export'); setError(null)
    const res = await exportOrgStructure()
    setBusy(null)
    if (!res.ok) { setError(res.error); return }
    download(res.data.csv, res.data.filename)
  }

  async function onTemplate() {
    setBusy('template'); setError(null)
    const res = await orgImportTemplate()
    setBusy(null)
    if (!res.ok) { setError(res.error); return }
    download(res.data.csv, res.data.filename)
  }

  function reset() {
    setCsv(null); setFileName(null); setPlan(null); setResult(null); setMapping({}); setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const rows = useMemo(() => {
    if (!plan) return []
    if (filter === 'errors') return plan.rows.filter((r) => r.action === 'error' || r.warnings.length)
    if (filter === 'changes') return plan.rows.filter((r) => r.action !== 'unchanged' || r.warnings.length)
    return plan.rows
  }, [plan, filter])
  const visibleRows = rows.slice(0, 500)
  const applicable = plan ? plan.summary.create + plan.summary.update : 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl space-y-1 text-ui text-fg-muted">
          <p>
            Update job titles, departments, divisions, locations, employee IDs, cost centres, managers and teams for people already in this workspace, matched by email.
            A blank cell leaves a value as it is; <code className="font-mono text-fg">-</code> clears it. Teams are added, never removed. The import never creates or invites people.
          </p>
          <p>Department and division also place people in org units (created when missing, marked as imported from CSV).</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" leadingIcon={<Download aria-hidden />} onClick={() => void onTemplate()} loading={busy === 'template'}>Download template</Button>
          <Button variant="secondary" size="sm" leadingIcon={<Download aria-hidden />} onClick={() => void onExport()} loading={busy === 'export'}>Export current structure</Button>
        </div>
      </div>

      {!canManage && <InlineNotice tone="info">You can export the structure. Importing needs the Manage organization permission.</InlineNotice>}
      {error && <InlineNotice tone="danger" onDismiss={() => setError(null)}>{error}</InlineNotice>}

      {canManage && !csv && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn('flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-subtle px-6 py-10 text-center', dragging && 'border-primary bg-primary-wash')}
        >
          <FileUp className="size-8 text-fg-muted" aria-hidden />
          <div className="text-ui text-fg">Drop a CSV file here, or</div>
          <Button size="sm" leadingIcon={<Upload aria-hidden />} onClick={() => inputRef.current?.click()} loading={busy === 'plan'}>Choose file</Button>
          <div className="text-xs text-fg-muted">Up to {CSV_LIMITS.maxBytes / 1024 / 1024} MB and {CSV_LIMITS.maxRows.toLocaleString('en-US')} rows. Columns: email, manager_email, job_title, department, division, location, employee_id, cost_center, team.</div>
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file" onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
      )}

      {canManage && csv && (
        <div className="flex flex-wrap items-center gap-2 text-ui">
          <span className="text-fg-muted">File:</span>
          <span className="font-medium text-fg">{fileName}</span>
          <Button variant="ghost" size="sm" leadingIcon={<RefreshCw aria-hidden />} onClick={reset} disabled={busy !== null}>Choose another file</Button>
        </div>
      )}

      {canManage && plan && !result && (
        <section aria-labelledby="org-import-mapping" className="rounded-lg border border-border bg-panel p-4">
          <h3 id="org-import-mapping" className="mb-3 text-ui font-semibold text-fg">Column mapping</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map((field) => (
              <label key={field} className="space-y-1">
                <span className="block text-xs text-fg-muted">{FIELD_LABELS[field]}</span>
                <Select
                  size="sm"
                  value={plan.mapping[field] ?? ''}
                  onChange={(e) => void onMappingChange(field, e.target.value)}
                  disabled={busy !== null}
                  placeholder="Not imported"
                  options={plan.headers.filter(Boolean).map((h) => ({ value: h, label: h }))}
                />
              </label>
            ))}
          </div>
        </section>
      )}

      {plan && (
        <section aria-labelledby="org-import-preview" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="org-import-preview" className="text-ui font-semibold text-fg">{result ? 'Import result' : 'Preview (dry run)'}</h3>
              <Badge tone="brand">{plan.summary.create} new</Badge>
              <Badge tone="info">{plan.summary.update} update</Badge>
              <Badge tone="neutral">{plan.summary.unchanged} unchanged</Badge>
              <Badge tone={plan.summary.errors ? 'danger' : 'neutral'}>{plan.summary.errors} errors</Badge>
            </div>
            <SegmentedControl<Filter>
              size="sm"
              aria-label="Rows to show"
              value={filter}
              onValueChange={setFilter}
              options={[{ value: 'changes', text: 'Changes' }, { value: 'errors', text: 'Errors' }, { value: 'all', text: 'All' }]}
            />
          </div>

          {result && (
            <InlineNotice tone={result.summary.errors ? 'warning' : 'success'} title="Import applied">
              {result.people_updated} people updated, {result.managers_changed} managers changed, {result.units_created} org units and {result.teams_created} teams created,
              {' '}{result.team_memberships_added} team memberships added{result.summary.errors ? `; ${result.summary.errors} rows skipped (see Errors)` : ''}.
            </InlineNotice>
          )}
          {plan.cycles.length > 0 && (
            <InlineNotice tone="danger" title="Manager loops">
              These rows would make people manage each other in a loop and are skipped: {plan.cycles.map((c) => [...c, c[0]].join(' → ')).join('; ')}
            </InlineNotice>
          )}
          {!result && (plan.org_units.create.length > 0 || plan.teams.create.length > 0) && (
            <InlineNotice tone="info">
              {plan.org_units.create.length > 0 && <>New org units: {plan.org_units.create.join(', ')}. </>}
              {plan.teams.create.length > 0 && <>New teams: {plan.teams.create.join(', ')}.</>}
            </InlineNotice>
          )}

          <Table aria-label="Import rows" stickyFirstColumn stickyColumns={2}>
            <THead>
              <tr>
                <TH numeric>Row</TH>
                <TH col="name">Person</TH>
                <TH col="status">Result</TH>
                <TH col="text" className="min-w-64">Changes</TH>
              </tr>
            </THead>
            <TBody>
              {visibleRows.length === 0 && (
                <TR><TD colSpan={4} className="text-fg-muted">No rows to show.</TD></TR>
              )}
              {visibleRows.map((r) => (
                <TR key={r.row}>
                  <TD numeric className="align-top">{r.row}</TD>
                  <TD className="align-top">
                    <div className="font-medium text-fg">{r.display_name ?? r.email}</div>
                    {r.display_name && <div className="text-xs text-fg-muted">{r.email}</div>}
                  </TD>
                  <TD className="align-top"><Badge tone={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action]}</Badge></TD>
                  <TD className="py-2 align-top">
                    {Object.keys(r.changes).length > 0 && (
                      <ul className="space-y-0.5">
                        {Object.entries(r.changes).map(([field, c]) => (
                          <li key={field} className="text-xs">
                            <span className="text-fg-muted">{field.replace(/_/g, ' ')}:</span>{' '}
                            <span className="text-fg-muted line-through decoration-fg-subtle">{show(c.before)}</span>{' → '}
                            <span className="text-fg">{show(c.after)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {r.errors.map((e) => <div key={e} className="text-xs text-danger">{e}</div>)}
                    {r.warnings.map((w) => <div key={w} className="text-xs text-warning">{w}</div>)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {rows.length > visibleRows.length && <p className="text-xs text-fg-muted">Showing the first {visibleRows.length} of {rows.length} rows.</p>}

          {canManage && !result && (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={reset} disabled={busy !== null}>Cancel</Button>
              <Button onClick={() => setConfirm(true)} disabled={busy !== null || applicable === 0}>
                Apply {applicable} {applicable === 1 ? 'change' : 'changes'}
              </Button>
            </div>
          )}
          {result && (
            <div className="flex justify-end"><Button variant="secondary" onClick={reset}>Import another file</Button></div>
          )}
        </section>
      )}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Apply the import?"
        description={`${applicable} ${applicable === 1 ? 'person' : 'people'} will be updated${plan?.summary.errors ? `; ${plan.summary.errors} rows with errors are skipped` : ''}. Changes are recorded in the audit log.`}
        confirmLabel="Apply import"
        busy={busy === 'apply'}
        onConfirm={onApply}
      />
    </div>
  )
}
