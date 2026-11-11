'use client'

/**
 * Live instances of a workflow and the "Migrate to version…" wizard.
 *
 *  - LiveInstancesPanel: waiting / paused runs with current node, version,
 *    waiting-since and the assignee of the open task, per-version counts;
 *    select instances → MigrateInstancesWizard.
 *  - MigrateInstancesWizard: target version → target node per distinct
 *    current node (pre-selected by id; any step of the target version, with a
 *    mini graph highlighting the choice) → dry-run review → confirm (typed
 *    for more than 10) → per-instance results linking to the new runs.
 *
 * Data comes from app/actions/workflow-instances (lib/services/workflow-runs);
 * migrating needs workflows.manage_runs, listing workflows.view_runs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import Link from 'next/link'
import { ArrowRight, CheckCircle2, ChevronLeft, GitBranch, Loader2, MoveRight, Plus, XCircle, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge, CountBadge, StatusPill, Tag } from '@/components/ui/badge'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'
import { Tooltip } from '@/components/ui/tooltip'
import { InlineNotice } from '@/components/ui/inline-notice'
import { serverRead } from '@/lib/server-read'
import { usePermissions } from '@/lib/permissions-context'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { plural } from '@/lib/format/plural'
import { NODE_CATALOG, type WorkflowEdge, type WorkflowNode } from '@/lib/workflow-schema'
import type { RunOverlay } from '@/lib/workflow-run-overlay'
import { RuntimeCanvas } from './runtime-canvas'
import { migratableNodes } from '@/lib/workflow-migration'
import { NODE_ICON_MAP } from './canvas-node'
import { useDataTableNames } from './workflow-lookups'
import { getNodeConfigSummary } from '@/lib/workflow-utils'
import { normalizeDataTableConfig, normalizeDataTableNodes } from '@/lib/workflow-table-refs'
import { runInlineJob, useJobs } from '@/components/jobs/jobs-provider'
import {
  getLiveInstances,
  planLiveInstanceMigration,
  type LiveInstancesData,
} from '@/app/actions/workflow-instances'
import type { LiveInstance, MigrationOutcome, MigrationPlan } from '@/lib/services/workflow-runs'

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow node rows are untyped */

/** Bulk migrations above this size need the count typed to confirm. */
export const TYPED_CONFIRM_THRESHOLD = 10

interface VersionRow {
  id: string
  version_number: number
  is_active: boolean
  published_at: string | null
  nodes: any[]
  edges: any[]
}

function isError<T extends object>(value: T | { error: string }): value is { error: string } {
  return !!value && typeof value === 'object' && 'error' in value && typeof (value as any).error === 'string'
}

export function NodeTypeIcon({ type, size = 12 }: { type: string | null | undefined; size?: number }) {
  const catalog = NODE_CATALOG.find((n) => n.type === type)
  const Icon = NODE_ICON_MAP[catalog?.icon ?? 'Plus'] ?? Plus
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded" style={{ backgroundColor: `color-mix(in srgb, ${catalog?.color ?? 'var(--theme-muted-text)'} 15%, transparent)`, color: catalog?.color ?? 'var(--theme-muted-text)' }}>
      <Icon size={size} />
    </span>
  )
}

/** The panel and the wizard: a Dialog (Esc / outside click / ✕ call `onClose`; pass a no-op while busy). */
function Overlay({ children, onClose, wide, title, subtitle }: { children: React.ReactNode; onClose: () => void; wide?: boolean; title: string; subtitle?: string }) {
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent
        size={wide ? 'xl' : 'lg'}
        className="max-h-[85vh]"
        title={<span className="flex items-center gap-2"><GitBranch size={16} className="text-fg-muted" aria-hidden="true" />{title}</span>}
        description={subtitle}
      >
        {children}
      </DialogContent>
    </Dialog>
  )
}

/** Small "Live" marker for the published version. */
function LiveMarker() {
  return <Badge tone="success" dot>Live</Badge>
}

// ─── Live instances panel ───

export function LiveInstancesPanel({ workflowId, initialVersionId, onClose }: { workflowId: string; initialVersionId?: string | null; onClose: () => void }) {
  const { can } = usePermissions()
  const [data, setData] = useState<LiveInstancesData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [versionFilter, setVersionFilter] = useState<string | null>(initialVersionId ?? null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [wizardRunIds, setWizardRunIds] = useState<string[] | null>(null)

  // Bumped to reload after a migration.
  const [reloadKey, setReloadKey] = useState(0)
  const load = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false
    getLiveInstances(workflowId, { limit: 500 }).then((result) => {
      if (cancelled) return
      if (isError(result)) setError(result.error)
      else { setData(result); setError(null) }
    })
    return () => { cancelled = true }
  }, [workflowId, reloadKey])

  const instances = useMemo(
    () => (data?.instances ?? []).filter((i) => versionFilter === null || i.version_id === versionFilter),
    [data, versionFilter],
  )
  const allSelected = instances.length > 0 && instances.every((i) => selected.has(i.run_id))
  const canMigrate = can('workflows.manage_runs')

  if (wizardRunIds) {
    return (
      <MigrateInstancesWizard
        workflowId={workflowId}
        runIds={wizardRunIds}
        onClose={() => setWizardRunIds(null)}
        onDone={() => { setSelected(new Set()); load() }}
      />
    )
  }

  return (
    <Overlay
      onClose={onClose}
      wide
      title="Live instances"
      subtitle={data ? `${plural(data.total, 'waiting or paused run', 'waiting or paused runs')}${data.on_older_versions ? ` · ${data.on_older_versions} on older versions` : ''}` : undefined}
    >
      <DialogBody className="space-y-3">
        {error && <InlineNotice tone="error" message={error} />}
        {!data && !error && (
          <div className="flex items-center justify-center py-10 text-fg-muted"><Loader2 size={20} className="animate-spin" aria-label="Loading" /></div>
        )}
        {data && (
          <>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by version">
              <VersionChip active={versionFilter === null} onClick={() => setVersionFilter(null)} label="All versions" count={data.total} />
              {data.versions.map((v) => (
                <VersionChip key={v.version_id ?? 'draft'} active={versionFilter === v.version_id} onClick={() => setVersionFilter(v.version_id)}
                  label={v.version_number != null ? `v${v.version_number}` : 'Draft'} count={v.instances} live={v.is_published} />
              ))}
            </div>

            {instances.length === 0 ? (
              <EmptyState size="sm" icon={GitBranch} title={`No live instances${versionFilter ? ' on this version' : ''}`} />
            ) : (
              <Table label="Live instances" stickyFirstColumn stickyColumns={2}>
                <THead>
                  <tr>
                    <TH className="w-8">
                      <Checkbox aria-label="Select all" checked={allSelected} disabled={!canMigrate}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(instances.map((i) => i.run_id)))} />
                    </TH>
                    <TH col="name">Instance</TH>
                    <TH col="number">Version</TH>
                    <TH col="name">Current node</TH>
                    <TH col="date">Waiting since</TH>
                    <TH col="people">Assignee</TH>
                  </tr>
                </THead>
                <TBody>
                  {instances.map((i) => (
                    <InstanceRow key={i.run_id} instance={i} publishedVersionId={data.published_version_id} checked={selected.has(i.run_id)} disabled={!canMigrate}
                      onToggle={() => setSelected((prev) => { const next = new Set(prev); if (next.has(i.run_id)) next.delete(i.run_id); else next.add(i.run_id); return next })} />
                  ))}
                </TBody>
              </Table>
            )}
          </>
        )}
      </DialogBody>
      <DialogFooter className="justify-between">
        <span className="num text-xs text-fg-muted">
          {canMigrate ? `${selected.size} selected` : 'Migrating instances needs the “Migrate live runs” permission.'}
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button disabled={!canMigrate || selected.size === 0} leadingIcon={<MoveRight />} onClick={() => setWizardRunIds([...selected])}>
            Migrate to version…
          </Button>
        </div>
      </DialogFooter>
    </Overlay>
  )
}

function VersionChip({ active, onClick, label, count, live }: { active: boolean; onClick: () => void; label: string; count: number; live?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors duration-[var(--ds-dur-fast)] ${active ? 'border-primary bg-primary-wash text-primary-text' : 'border-border text-fg hover:border-border-strong hover:bg-subtle'}`}>
      {label}
      {live && <span className="text-2xs font-semibold text-success">Live</span>}
      <CountBadge count={count} max={999} />
    </button>
  )
}

function InstanceRow({ instance: i, publishedVersionId, checked, disabled, onToggle }: { instance: LiveInstance; publishedVersionId: string | null; checked: boolean; disabled: boolean; onToggle: () => void }) {
  const older = i.version_id !== publishedVersionId
  const assignee = i.open_task?.assignee_name ?? i.open_task?.team_name ?? null
  return (
    <TR selected={checked}>
      <TD><Checkbox aria-label={`Select ${i.title ?? i.run_id}`} checked={checked} disabled={disabled} onChange={onToggle} /></TD>
      <TD className="min-w-0 py-1.5">
        <Link href={`/automations/runs/${i.run_id}`} className="font-medium text-primary-text hover:underline">
          {i.title || `Run ${i.run_id.slice(0, 8)}`}
        </Link>
        <div className="font-mono text-2xs text-fg-muted">{i.run_id.slice(0, 8)} · {i.status === 'paused' ? 'paused' : 'waiting'}</div>
      </TD>
      <TD>
        <Badge tone={older ? 'warning' : 'success'} className="font-mono">
          {i.version_number != null ? `v${i.version_number}` : 'Draft'}
        </Badge>
      </TD>
      <TD>
        <div className="flex items-center gap-1.5">
          <NodeTypeIcon type={i.current_node_type} />
          <span className="truncate" title={i.current_node_label ?? i.current_node_id ?? undefined}>{i.current_node_label ?? i.current_node_id ?? '—'}</span>
        </div>
      </TD>
      <TD className="whitespace-nowrap text-fg-muted">
        {i.waiting_since ? (
          <Tooltip content={formatAbsolute(i.waiting_since)}><span>{formatRelative(i.waiting_since)}</span></Tooltip>
        ) : '—'}
      </TD>
      <TD className={`whitespace-nowrap ${assignee ? 'text-fg' : 'text-fg-muted'}`}>{assignee ?? (i.open_task ? 'Unassigned' : '—')}</TD>
    </TR>
  )
}

// ─── Target graph preview ───

/**
 * Read-only preview of a version's graph with the chosen target step(s)
 * shown as where the instances continue: the shared run canvas (zoom
 * controls, minimap, zoom to step, full screen).
 */
export function MiniGraph({ nodes, edges, highlight, workflowId, height = 'min(420px, 50dvh)' }: { nodes: any[]; edges: any[]; highlight: ReadonlySet<string>; workflowId?: string; height?: string }) {
  const steps = useMemo(() => normalizeDataTableNodes((nodes ?? []).filter((n) => n?.position)) as WorkflowNode[], [nodes])
  const overlay = useMemo<RunOverlay>(() => ({
    nodes: Object.fromEntries(steps.filter((n) => n.type !== 'section_group').map((n) => [n.id, highlight.has(n.id) ? { status: 'waiting' as const, current: true } : { status: 'not_run' as const }])),
    edges: {},
    traversed: new Set(highlight),
  }), [steps, highlight])
  // A new target choice: zoom to it (not on open, which uses the readable opening view).
  const highlightKey = [...highlight].join(',')
  const [focus, setFocus] = useState<{ key: string; req: { nodeId: string; nonce: number; details: false } | null }>({ key: highlightKey, req: null })
  if (focus.key !== highlightKey) {
    const first = [...highlight][0]
    setFocus({ key: highlightKey, req: first ? { nodeId: first, nonce: (focus.req?.nonce ?? 0) + 1, details: false } : null })
  }
  if (!steps.length) return null
  return (
    <RuntimeCanvas
      nodes={steps}
      edges={(edges ?? []) as WorkflowEdge[]}
      overlay={overlay}
      nodeResults={{}}
      storageScope={workflowId ? `migrate:${workflowId}` : undefined}
      focusRequest={focus.req}
      height={height}
      minHeight={260}
      markerPrefix="mig-arrow"
      label="Target version graph"
    />
  )
}

// ─── Wizard ───

type Step = 'version' | 'nodes' | 'review' | 'results'

export function MigrateInstancesWizard({ workflowId, runIds, onClose, onDone }: { workflowId: string; runIds: string[]; onClose: () => void; onDone?: (outcome: MigrationOutcome) => void }) {
  const tableNames = useDataTableNames()
  const jobs = useJobs()
  const [step, setStep] = useState<Step>('version')
  const [instances, setInstances] = useState<LiveInstance[] | null>(null)
  const [versions, setVersions] = useState<VersionRow[] | null>(null)
  const [targetVersionId, setTargetVersionId] = useState<string | null>(null)
  const [nodeChoices, setNodeChoices] = useState<Record<string, string>>({})
  const [plan, setPlan] = useState<MigrationPlan | null>(null)
  const [outcome, setOutcome] = useState<MigrationOutcome | null>(null)
  const [busy, setBusy] = useState(false)
  // Synchronous guard: a double click must not start the migration twice.
  const migrateGuard = useSubmitGuard()
  const [error, setError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  // Callers pass a fresh array each render; reload only when the ids change.
  const runKey = runIds.join(',')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [live, { data: rows }] = await Promise.all([
        getLiveInstances(workflowId, { limit: 500 }),
        serverRead('automations.migrationVersions', { workflowId }),
      ])
      if (cancelled) return
      if (isError(live)) { setError(live.error); return }
      const wanted = new Set(runKey.split(','))
      const picked = live.instances.filter((i) => wanted.has(i.run_id))
      setInstances(picked)
      const list = (rows ?? []) as unknown as VersionRow[]
      setVersions(list)
      // Default target: the published version, else the newest the instances are not all on.
      const fromVersions = new Set(picked.map((i) => i.version_id))
      const preferred = list.find((v) => v.id === live.published_version_id && !(fromVersions.size === 1 && fromVersions.has(v.id)))
        ?? list.find((v) => !fromVersions.has(v.id)) ?? list[0]
      setTargetVersionId(preferred?.id ?? null)
    }
    void load()
    return () => { cancelled = true }
  }, [workflowId, runKey])

  const target = versions?.find((v) => v.id === targetVersionId) ?? null
  const targetChoices = useMemo(() => migratableNodes((target?.nodes ?? []) as any[]), [target])
  const targetIds = useMemo(() => new Set(targetChoices.map((n: any) => n.id)), [targetChoices])

  /** Distinct current nodes of the selected instances (node ids are stable across versions). */
  const sources = useMemo(() => {
    const map = new Map<string, { id: string; label: string; type: string | null; count: number }>()
    for (const i of instances ?? []) {
      const id = i.current_node_id ?? ''
      const entry = map.get(id) ?? { id, label: i.current_node_label ?? (id || 'No current node'), type: i.current_node_type, count: 0 }
      entry.count += 1
      map.set(id, entry)
    }
    return [...map.values()]
  }, [instances])

  // Pre-select the node with the same id in the target version.
  // The user's choices over the default: the node with the same id when the target has it.
  const nodeMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const src of sources) {
      const chosen = nodeChoices[src.id]
      map[src.id] = chosen !== undefined && (chosen === '' || targetIds.has(chosen)) ? chosen : targetIds.has(src.id) ? src.id : ''
    }
    return map
  }, [sources, targetIds, nodeChoices])

  const unmapped = sources.filter((s) => !nodeMap[s.id]).length
  const highlight = useMemo(() => new Set(Object.values(nodeMap).filter(Boolean)), [nodeMap])

  const migrationInput = useCallback(() => ({
    workflowId,
    toVersionId: targetVersionId!,
    runIds,
    nodeMap: Object.fromEntries(Object.entries(nodeMap).filter(([source, dest]) => source && dest)),
  }), [workflowId, targetVersionId, runIds, nodeMap])

  async function review() {
    setBusy(true); setError(null)
    const result = await planLiveInstanceMigration(migrationInput())
    setBusy(false)
    if (isError(result)) { setError(result.error); return }
    setPlan(result); setTyped(''); setStep('review')
  }

  async function migrate() {
    await migrateGuard.run(async () => {
      if (!plan) return
      setBusy(true); setError(null)
      const ready = plan.items.filter((i) => i.ok).map((i) => i.run_id)
      // A `workflow_instances.migrate` job: migrates in chunks that resume where
      // they stopped; a long one continues after the wizard closes.
      const outcome = await runInlineJob(jobs, 'workflow_instances.migrate', { ...migrationInput(), runIds: ready }, {
        onSuccess: (job) => { if (job.result?.data) onDone?.(job.result.data as MigrationOutcome) },
      })
      setBusy(false)
      if (outcome.status === 'failed') { setError(outcome.error); return }
      if (outcome.status === 'background') { onClose(); return }
      const result = outcome.job.result?.data as MigrationOutcome | undefined
      if (result) { setOutcome(result); setStep('results') }
    })
  }

  const ready = plan?.summary.ready ?? 0
  const needsTyped = ready > TYPED_CONFIRM_THRESHOLD
  const confirmed = !needsTyped || typed.trim() === String(ready)

  return (
    <Overlay
      onClose={busy ? () => {} : onClose}
      wide
      title={`Migrate ${plural(runIds.length, 'instance')} to another version`}
      subtitle={{ version: '1. Target version', nodes: '2. Where each instance continues', review: '3. Review the plan', results: 'Done' }[step]}
    >
      <DialogBody className="space-y-4">
        {error && <InlineNotice tone="error" message={error} onDismiss={() => setError(null)} />}
        {(!instances || !versions) && !error && (
          <div className="flex items-center justify-center py-10 text-fg-muted"><Loader2 size={20} className="animate-spin" aria-label="Loading" /></div>
        )}

        {instances && versions && step === 'version' && (
          <div className="space-y-2">
            {instances.length < runIds.length && (
              <InlineNotice tone="warning" message={`${runIds.length - instances.length} of the selected runs are no longer waiting or paused and were left out.`} />
            )}
            <p className="text-sm text-fg-muted">
              Each instance is closed out (its open task is cancelled) and a new run starts on the version you pick, at the node you choose next, with the same variables, task and trace.
            </p>
            <div className="space-y-1.5" role="radiogroup" aria-label="Target version">
              {versions.map((v) => {
                const onIt = instances.filter((i) => i.version_id === v.id).length
                return (
                  <label key={v.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors duration-[var(--ds-dur-fast)] ${targetVersionId === v.id ? 'border-primary bg-primary-wash' : 'border-border hover:border-border-strong'}`}>
                    <input type="radio" name="target-version" checked={targetVersionId === v.id} onChange={() => setTargetVersionId(v.id)} className="accent-primary" />
                    <Tag mono className="font-semibold">v{v.version_number}</Tag>
                    {v.is_active && <LiveMarker />}
                    <span className="flex-1 text-xs text-fg-muted">
                      {v.published_at ? <Tooltip content={formatAbsolute(v.published_at)}><span>published {formatRelative(v.published_at)}</span></Tooltip> : ''} · {plural(migratableNodes(v.nodes ?? []).length, 'step')}
                    </span>
                    {onIt > 0 && <span className="text-xs text-warning">{onIt} selected already on it</span>}
                  </label>
                )
              })}
            </div>
          </div>
        )}

        {instances && target && step === 'nodes' && (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              For each node the selected instances are at, choose the step of v{target.version_number} where they continue. Steps with the same id are pre-selected; a User Task target creates a fresh task.
            </p>
            <div className="space-y-2">
              {sources.map((s) => {
                const chosen = targetChoices.find((n: any) => n.id === nodeMap[s.id])
                return (
                  <div key={s.id || 'none'} className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${nodeMap[s.id] ? 'border-border' : 'border-warning'}`}>
                    <NodeTypeIcon type={s.type} />
                    <span className="min-w-[8rem] text-ui font-medium text-fg">{s.label}</span>
                    <span className="num text-xs text-fg-muted">{plural(s.count, 'instance')}</span>
                    <ArrowRight size={14} className="text-fg-muted" aria-hidden="true" />
                    <NodeTypeIcon type={chosen?.type} />
                    <Select aria-label={`Target node for ${s.label}`} value={nodeMap[s.id] ?? ''} onChange={(e) => setNodeChoices((m) => ({ ...m, [s.id]: e.target.value }))}
                      size="sm" wrapperClassName="flex-1 min-w-[12rem]">
                      <option value="">Choose a step…</option>
                      {targetChoices.map((n: any) => (
                        <option key={n.id} value={n.id}>
                          {n.label ?? n.id} · {NODE_CATALOG.find((c) => c.type === n.type)?.label ?? n.type}{(() => { const summary = n.config ? getNodeConfigSummary(normalizeDataTableConfig({ type: n.type, config: n.config }), { tableNames }) : null; return summary ? ` · ${summary}` : '' })()}{n.id === s.id ? ' (same node)' : ''}
                        </option>
                      ))}
                    </Select>
                  </div>
                )
              })}
            </div>
            <MiniGraph nodes={target.nodes ?? []} edges={target.edges ?? []} highlight={highlight} workflowId={workflowId} />
          </div>
        )}

        {plan && step === 'review' && (
          <div className="space-y-3">
            <PlanTable plan={plan} />
            <p className="num text-xs text-fg-muted">
              {ready} of {plan.summary.total} ready{plan.summary.blocked ? ` · ${plan.summary.blocked} blocked (left unchanged)` : ''}{plan.summary.with_warnings ? ` · ${plan.summary.with_warnings} with warnings` : ''}.
            </p>
            {needsTyped && ready > 0 && (
              <div className="space-y-1.5">
                <label htmlFor="migrate-confirm" className="block text-ui font-medium text-fg">Type <strong>{ready}</strong> to confirm migrating {ready} instances</label>
                <Input id="migrate-confirm" size="sm" value={typed} onChange={(e) => setTyped(e.target.value)} className="max-w-[10rem]" autoComplete="off" />
              </div>
            )}
          </div>
        )}

        {outcome && step === 'results' && <ResultsTable outcome={outcome} />}
      </DialogBody>

      <DialogFooter className="justify-between">
        <div>
          {(step === 'nodes' || step === 'review') && (
            <Button variant="ghost" disabled={busy} leadingIcon={<ChevronLeft />} onClick={() => setStep(step === 'review' ? 'nodes' : 'version')}>
              Back
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {step !== 'results' && <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>}
          {step === 'version' && (
            <Button disabled={!target || !instances?.length} onClick={() => setStep('nodes')}>Next</Button>
          )}
          {step === 'nodes' && (
            <Tooltip content={unmapped ? 'Instances without a target step will be skipped' : null}>
              <Button disabled={busy || unmapped === sources.length} loading={busy} onClick={review}>
                Review plan
              </Button>
            </Tooltip>
          )}
          {step === 'review' && (
            <Button disabled={busy || ready === 0 || !confirmed} loading={busy} leadingIcon={<MoveRight />} onClick={migrate}>
              Migrate {plural(ready, 'instance')}
            </Button>
          )}
          {step === 'results' && <Button onClick={onClose}>Done</Button>}
        </div>
      </DialogFooter>
    </Overlay>
  )
}

function PlanTable({ plan }: { plan: MigrationPlan }) {
  return (
    <Table label="Migration plan">
      <THead>
        <tr>
          <TH col="name">Instance</TH>
          <TH col="name">Now</TH>
          <TH col="name">Continues at (v{plan.to_version.version_number})</TH>
          <TH col="status">Closes</TH>
          <TH col="text">Notes</TH>
        </tr>
      </THead>
      <TBody>
        {plan.items.map((item) => (
          <TR key={item.run_id} className={item.ok ? undefined : 'opacity-75'}>
            <TD className="py-1.5">
              <div className="font-medium">{item.title || `Run ${item.run_id.slice(0, 8)}`}</div>
              <div className="font-mono text-2xs text-fg-muted">{item.run_id.slice(0, 8)}</div>
            </TD>
            <TD className="whitespace-nowrap">
              v{item.from_version_number ?? '?'} · {item.source_node_label ?? item.source_node_id ?? '—'}
            </TD>
            <TD>
              {item.ok ? (
                <span className="inline-flex items-center gap-1.5">
                  <NodeTypeIcon type={item.target_node_type} />
                  {item.target_node_label ?? item.target_node_id}
                  {item.create.creates_task && <Badge tone="brand">New task</Badge>}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-medium text-danger"><XCircle size={14} aria-hidden="true" /> Blocked</span>
              )}
            </TD>
            <TD className="whitespace-nowrap text-fg-muted">
              {item.ok ? `run${item.close.open_task_ids.length ? ` + ${item.close.open_task_ids.length} task` : ''}${item.close.queued_job_ids.length ? ` + ${item.close.queued_job_ids.length} job` : ''}` : '—'}
            </TD>
            <TD className="py-1.5">
              {!item.ok && <div className="text-danger">{item.blocked_reason}</div>}
              {item.ok && item.create.defaulted_variables.length > 0 && (
                <div className="text-fg-muted">Defaults for {item.create.defaulted_variables.join(', ')}</div>
              )}
              {item.warnings.map((w) => (
                <div key={w} className="flex items-start gap-1 text-warning"><AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" /> {w}</div>
              ))}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  )
}

function ResultsTable({ outcome }: { outcome: MigrationOutcome }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg">
        Migrated <strong>{outcome.summary.migrated}</strong>{outcome.summary.failed ? `, ${outcome.summary.failed} failed` : ''}{outcome.summary.skipped ? `, ${outcome.summary.skipped} skipped` : ''}.
      </p>
      <ul className="divide-y divide-border-subtle rounded-lg border border-border">
        {outcome.results.map((r) => (
          <li key={r.run_id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-ui">
            {r.ok ? <CheckCircle2 size={14} className="text-success" aria-label="Migrated" /> : <XCircle size={14} className="text-danger" aria-label="Failed" />}
            <Link href={`/automations/runs/${r.run_id}`} className="font-mono text-xs text-fg hover:underline">{r.run_id.slice(0, 8)}</Link>
            {r.new_run_id && (
              <>
                <ArrowRight size={14} className="text-fg-muted" aria-hidden="true" />
                <Link href={`/automations/runs/${r.new_run_id}`} className="font-mono text-xs font-medium text-primary-text hover:underline">{r.new_run_id.slice(0, 8)}</Link>
                {r.new_status && <StatusPill status={r.new_status} />}
              </>
            )}
            {r.error && <span className={`text-xs ${r.ok ? 'text-warning' : 'text-danger'}`}>{r.conflict ? 'Changed meanwhile — left alone. ' : ''}{r.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
