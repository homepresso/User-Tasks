'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ExternalLink, Hourglass, UserPlus, Workflow } from 'lucide-react'
import { serverQuery } from '@/lib/server-read'
import { usePermissions } from '@/lib/permissions-context'
import { Pagination, SearchBar } from '@/components/ui/list-controls'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge, type Tone } from '@/components/ui/badge'
import { PriorityBadge } from '@/components/ui/priority-badge'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Table, TBody, TD, TH, THead, TR, TableSkeleton } from '@/components/ui/table'
import { Tooltip } from '@/components/ui/tooltip'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { AssignTaskDialog, TakeOwnershipButton, useAssignTargets } from '@/components/tasks/assign-task'
import {
  WAITING_PAGE_SIZES, WAITING_PRIORITIES, WAITING_SLA, WAITING_SLA_LABEL, WAITING_TIMES, WAITING_TIME_LABEL,
  hasActiveFilters, nextActiveFilters, parseActiveFilters, serializeQueueTab, waitingFor,
  type ActiveTaskFilters,
} from '@/lib/automations/active-task-filters'
import type { ActiveTask } from '@/lib/services/active-tasks'
import { TimelineIconButton } from '@/components/timeline/timeline-sheet'

/*
 * The workflow queue page's "Active tasks" tab (?tab=tasks): every open
 * human task in the person's scope (lib/services/active-tasks — everything
 * with View all tasks; else their own, their reporting chain's and the
 * workflows they manage), filtered and paged on the server. Row actions
 * follow lib/task-authz decideTaskAssignment: Reassign, Take ownership;
 * admins (Complete any task) can select rows and reassign them together.
 */

const SLA_TONE: Record<ActiveTask['sla'], Tone> = { overdue: 'danger', due_soon: 'warning', on_track: 'success', none: 'neutral' }

function whoLabel(t: ActiveTask): string {
  if (t.assignee) return `${t.assignee.name}${t.others ? ` +${t.others}` : ''}`
  if (t.team) return `${t.team.name} team`
  if (t.state === 'claim') return 'Queue (can be claimed)'
  return 'Unassigned'
}

function WhoCell({ t }: { t: ActiveTask }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
      {t.state === 'unassigned'
        ? <Badge tone="warning" pill>Unassigned</Badge>
        : <span className="truncate font-medium text-fg">{whoLabel(t)}</span>}
      {t.state === 'queued' && <Badge tone="neutral" pill>Queued</Badge>}
      {t.state === 'held' && <Badge tone="warning" pill>On hold</Badge>}
    </span>
  )
}

function useActiveFilters() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const filters = useMemo(() => parseActiveFilters(searchParams), [searchParams])
  const go = useCallback((next: ActiveTaskFilters) => {
    const qs = serializeQueueTab('tasks', next, new URLSearchParams(searchParams.toString()))
    window.history.pushState(null, '', qs ? `${pathname}?${qs}` : pathname)
  }, [pathname, searchParams])
  const update = useCallback((patch: Partial<ActiveTaskFilters>) => go(nextActiveFilters(filters, patch)), [filters, go])
  return { filters, update, replace: go }
}

export function ActiveTasksTab() {
  const { can } = usePermissions()
  const { filters, update, replace } = useActiveFilters()
  const [searchText, setSearchText] = useState(filters.search)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assigning, setAssigning] = useState<{ ids: string[]; current: string | null } | null>(null)
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const { data: targets } = useAssignTargets()
  // Typed search reaches the URL (and the query) after a pause.
  useEffect(() => {
    if (searchText === filters.search) return
    const timer = setTimeout(() => update({ search: searchText }), 300)
    return () => clearTimeout(timer)
  }, [searchText, filters.search, update])

  const { data, error, isFetching } = useQuery({
    queryKey: ['active-tasks', filters],
    queryFn: () => serverQuery('automations.activeTasks', {
      search: filters.search || undefined, assignee: filters.assignee, workflow: filters.workflow, waiting: filters.waiting,
      sla: filters.sla, priority: filters.priority as never, unassigned: filters.unassigned || undefined, page: filters.page, pageSize: filters.pageSize,
    }),
    placeholderData: keepPreviousData,
  })
  const rows = data?.tasks ?? []
  const bulk = data?.can_bulk_reassign === true
  const runHref = (runId: string) => (can('workflows.view_runs') ? `/automations/runs/${runId}` : `/home/runs/${runId}`)
  const toggle = (id: string) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })

  const actions = (t: ActiveTask) => (
    <div className="inline-flex flex-wrap items-center justify-end gap-1 md:flex-nowrap">
      {t.can_take_ownership && t.state === 'unassigned' && <TakeOwnershipButton taskId={t.id} size="sm" variant="secondary" onDone={() => setNotice(`You now own “${t.title}”.`)} />}
      {t.can_reassign && (
        <Button size="sm" variant="ghost" leadingIcon={<UserPlus />} onClick={() => setAssigning({ ids: [t.id], current: whoLabel(t) })} data-waiting-reassign={t.id}>Reassign</Button>
      )}
      <LinkIconButton href={`/tasks/${t.id}`} label="Open task" icon={<ExternalLink />} />
      {t.run_id && <LinkIconButton href={runHref(t.run_id)} label="Process view" icon={<Workflow />} />}
      {t.run_id && <TimelineIconButton target={{ taskId: t.id }} title={t.title} />}
    </div>
  )

  const filtered = hasActiveFilters(filters)
  return (
    <section aria-labelledby="active-tasks-heading" className="space-y-3" data-active-tasks="">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 id="active-tasks-heading" className="text-base font-semibold text-fg">Active tasks</h2>
          <p className="text-xs text-fg-muted">
            {data?.scope === 'all' ? 'Every open task people need to act on in this workspace.' : 'Open tasks that are yours, your reports\', or in workflows you manage.'}
          </p>
        </div>
        {isFetching && data && <span role="status" className="text-xs text-fg-muted">Updating…</span>}
      </div>

      <div className="flex flex-wrap items-end gap-2" data-waiting-filters="">
        <SearchBar value={searchText} onChange={setSearchText} placeholder="Search task titles" className="min-w-48 flex-1" />
        <Select aria-label="Assignee" size="sm" value={filters.assignee ?? ''} onChange={(e) => update({ assignee: e.target.value || null })}
          placeholder="Any assignee" options={(targets?.users ?? []).map((u) => ({ value: u.id, label: u.name }))} wrapperClassName="w-[calc(50%-0.25rem)] sm:w-44" />
        <Select aria-label="Workflow" size="sm" value={filters.workflow ?? ''} onChange={(e) => update({ workflow: e.target.value || null })}
          placeholder="Any workflow" options={(data?.workflows ?? []).map((w) => ({ value: w.id, label: w.name }))} wrapperClassName="w-[calc(50%-0.25rem)] sm:w-44" />
        <Select aria-label="Waiting time" size="sm" value={filters.waiting ?? ''} onChange={(e) => update({ waiting: (e.target.value || null) as never })}
          placeholder="Any waiting time" options={WAITING_TIMES.map((w) => ({ value: w, label: WAITING_TIME_LABEL[w] }))} wrapperClassName="w-[calc(50%-0.25rem)] sm:w-44" />
        <Select aria-label="SLA status" size="sm" value={filters.sla ?? ''} onChange={(e) => update({ sla: (e.target.value || null) as never })}
          placeholder="Any SLA status" options={WAITING_SLA.map((s) => ({ value: s, label: WAITING_SLA_LABEL[s] }))} wrapperClassName="w-[calc(50%-0.25rem)] sm:w-40" />
        <Select aria-label="Priority" size="sm" value={filters.priority ?? ''} onChange={(e) => update({ priority: e.target.value || null })}
          placeholder="Any priority" options={WAITING_PRIORITIES.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))} wrapperClassName="w-[calc(50%-0.25rem)] sm:w-36" />
        <label className="flex h-8 items-center gap-2 text-xs text-fg">
          <Switch checked={filters.unassigned} onCheckedChange={(v: boolean) => update({ unassigned: v })} aria-label="Unassigned only" />
          Unassigned only
        </label>
      </div>

      {notice && <InlineNotice tone="success" message={notice} />}
      {error && !data && <InlineNotice tone="error" message={(error as Error).message || 'Could not load the active tasks.'} />}

      {bulk && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-subtle px-3 py-2 text-ui" data-waiting-bulk="">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="sm" leadingIcon={<UserPlus />} onClick={() => setConfirmBulk(true)} data-waiting-bulk-reassign="">Reassign…</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {!data ? (
        error ? null : <Table label="Active tasks"><TBody><TableSkeleton columns={6} /></TBody></Table>
      ) : rows.length === 0 ? (
        filtered
          ? <EmptyState variant="no-results" title="No active tasks match your filters" description="Try a different search, or clear the filters." action={{ label: 'Clear filters', onClick: () => { setSearchText(''); replace({ ...filters, search: '', assignee: null, workflow: null, waiting: null, sla: null, priority: null, unassigned: false, page: 1 }) } }} />
          : <EmptyState icon={Hourglass} title="No tasks are waiting" description="Open tasks people need to act on show here." />
      ) : (
        <>
          {/* Tablet / desktop: readable columns that scroll sideways when the space is narrow; the task's name stays in view. */}
          <Table containerClassName="max-md:hidden" label="Active tasks" stickyFirstColumn stickyColumns={bulk ? 2 : 1}>
            <THead>
              <tr>
                {bulk && <TH className="w-10"><span className="sr-only">Select</span></TH>}
                <TH col="title">Task</TH>
                <TH col="people">Assignee</TH>
                <TH col="date">Started</TH>
                <TH col="date">Waiting</TH>
                <TH col="date">Due</TH>
                <TH col="status">Priority</TH>
                <TH col="actions"><span className="sr-only">Actions</span></TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((t) => (
                <TR key={t.id} selected={selected.has(t.id)} data-waiting-row={t.id}>
                  {bulk && <TD className="w-10"><Checkbox checked={selected.has(t.id)} aria-label={`Select ${t.title}`} onChange={() => toggle(t.id)} /></TD>}
                  <TD className="min-w-48 max-w-0 py-2">
                    <Link href={`/tasks/${t.id}`} className="block truncate text-ui font-medium text-fg hover:underline" title={t.title}>{t.title}</Link>
                    <span className="block truncate text-xs text-fg-muted" title={t.workflow?.name ?? undefined}>
                      {t.workflow?.name ?? 'Workflow'}
                      {t.run_id && <> · <Link href={runHref(t.run_id)} className="text-primary-text hover:underline">Process view</Link></>}
                      {t.run_started_at && <span className="md:hidden"> · started {formatRelative(t.run_started_at)}</span>}
                    </span>
                  </TD>
                  <TD className="max-w-60 text-ui"><WhoCell t={t} /></TD>
                  <TD className="whitespace-nowrap text-ui text-fg-muted" data-active-run-started="">
                    {t.run_started_at
                      ? <Tooltip content={`Workflow started ${formatAbsolute(t.run_started_at)}`}><span>{formatRelative(t.run_started_at)}</span></Tooltip>
                      : <span>—</span>}
                  </TD>
                  <TD className="whitespace-nowrap text-ui text-fg-muted">
                    <Tooltip content={t.waiting_since ? `Since ${formatAbsolute(t.waiting_since)}` : ''}><span>{waitingFor(t.waiting_since)}</span></Tooltip>
                  </TD>
                  <TD className="whitespace-nowrap text-ui">
                    {t.due_date ? <Badge tone={SLA_TONE[t.sla]} pill>{t.sla === 'overdue' ? 'Overdue' : formatRelative(t.due_date)}</Badge> : <span className="text-fg-muted">—</span>}
                  </TD>
                  <TD className="whitespace-nowrap">{t.priority ? <PriorityBadge priority={t.priority} /> : '—'}</TD>
                  <TD className="w-px whitespace-nowrap text-right">{actions(t)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>

          {/* Phones: one card per task. */}
          <ul className="space-y-2 md:hidden" aria-label="Active tasks">
            {rows.map((t) => (
              <li key={t.id} data-waiting-card={t.id}>
                <Card padding="sm" className={selected.has(t.id) ? 'border-primary' : undefined}>
                  <div className="flex min-w-0 items-start gap-2">
                    {bulk && <Checkbox checked={selected.has(t.id)} aria-label={`Select ${t.title}`} onChange={() => toggle(t.id)} />}
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <Link href={`/tasks/${t.id}`} className="min-w-0 truncate text-ui font-medium text-fg">{t.title}</Link>
                        <span className="ml-auto shrink-0 text-2xs text-fg-muted">{waitingFor(t.waiting_since)}</span>
                      </div>
                      <p className="truncate text-xs text-fg-muted">{t.workflow?.name ?? 'Workflow'}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        <WhoCell t={t} />
                        {t.due_date && <Badge tone={SLA_TONE[t.sla]} pill>{t.sla === 'overdue' ? 'Overdue' : `Due ${formatRelative(t.due_date)}`}</Badge>}
                        {t.priority && <PriorityBadge priority={t.priority} />}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex justify-end border-t border-border-subtle pt-1.5">{actions(t)}</div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      {data && (
        <Pagination page={filters.page} pageSize={filters.pageSize} total={data.total} onPageChange={(page) => update({ page })}
          onPageSizeChange={(pageSize) => update({ pageSize })} pageSizeOptions={WAITING_PAGE_SIZES as unknown as number[]} noun="tasks" />
      )}

      <ConfirmDialog
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        title={`Reassign ${selected.size} task${selected.size === 1 ? '' : 's'}?`}
        description="You will pick one person for all of them. Each change is checked against your access, audited and recorded in the task's history, and the new assignee is notified."
        confirmLabel="Choose a person"
        onConfirm={() => { setConfirmBulk(false); setAssigning({ ids: [...selected], current: null }) }}
      />
      {assigning && (
        <AssignTaskDialog
          taskIds={assigning.ids}
          open
          onOpenChange={(open) => { if (!open) setAssigning(null) }}
          currentAssignee={assigning.current}
          onDone={(message) => { setNotice(message); setSelected(new Set()); setAssigning(null) }}
        />
      )}
    </section>
  )
}

function LinkIconButton({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Tooltip content={label}>
      <Button asChild variant="ghost" size="icon-sm">
        <Link href={href} aria-label={label}>
          <span className="inline-flex [&>svg]:size-[var(--btn-icon)]" aria-hidden="true">{icon}</span>
        </Link>
      </Button>
    </Tooltip>
  )
}
