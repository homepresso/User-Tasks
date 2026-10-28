"use client"

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  CloudDownload,
  CloudUpload,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  LayoutTemplate,
  Pencil,
  Play,
  Plus,
  Rocket,
  Trash2,
  Unplug,
  X,
} from 'lucide-react'
import { usePermissions } from '@/lib/permissions-context'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { formatRelativeDate } from '@/lib/utils'
import {
  commitPendingChanges,
  connectGitHubSync,
  deleteGitHubSyncTemplate,
  deployFromGitHub,
  disconnectGitHub,
  getGitHubCommits,
  getGitHubSyncStatus,
  listGitHubBranches,
  listGitHubRepos,
  listGitHubSyncTemplates,
  listSyncableAssets,
  pushEverything,
  pushSelection,
  runGitHubSyncTemplate,
  saveGitHubSyncTemplate,
  setGitHubSyncMode,
  setGitHubSyncSchedule,
  type GitHubSyncTemplateRow,
} from '@/app/actions/github-sync'
import { SECTION_LABELS, SYNC_SECTION_CATALOG } from '@/lib/github-sync/scope-catalog'
import { useJobs } from '@/components/jobs/jobs-provider'

type SyncStatus = Awaited<ReturnType<typeof getGitHubSyncStatus>>
type Deployment = SyncStatus['deployments'][number]
type SyncRun = SyncStatus['syncRuns'][number]

const MODE_OPTIONS: Array<{ value: 'auto' | 'queue'; label: string; description: string }> = [
  { value: 'auto', label: 'Auto-sync', description: 'Pushes to GitHub within a minute of each save' },
  { value: 'queue', label: 'Commit queue', description: 'Review queued changes and commit manually' },
]


/**
 * Follow a sync run or deployment as a background job (`sync.watch`), so its
 * completion pops up (and lands in the bell) wherever the user is by then.
 */
function useWatchSyncRun() {
  const jobs = useJobs()
  return (source: 'github_sync' | 'github_deploy', runId: string | undefined | null, label: string) => {
    if (!runId) return
    void jobs.start('sync.watch', { source, run_id: runId, label }, { effect: 'change', silentStart: true }).catch(() => undefined)
  }
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : ''
}

function isRunActive(run: SyncRun): boolean {
  return run.status === 'pending' || run.status === 'running'
}

export default function GitHubSyncPage() {
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const canView = can('sync.view') || can('settings.view')
  const canEdit = can('settings.edit')

  const { data, isLoading } = useQuery({
    queryKey: ['github-sync-status'],
    queryFn: () => getGitHubSyncStatus(),
    enabled: canView,
    // Poll fast while a sync run or deployment is in flight so the progress
    // bar and status chips update live; otherwise stop polling entirely.
    refetchInterval: (query) => {
      const deployments = query.state.data?.deployments ?? []
      const runs = query.state.data?.syncRuns ?? []
      const busy = deployments.some((d) => d.status === 'pending' || d.status === 'running')
        || runs.some(isRunActive)
      return busy ? 2500 : false
    },
  })

  if (!canView) {
    return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Not authorized.</p>
  }
  if (isLoading && !data) {
    return <PageSkeleton variant="settings" />
  }

  const connection = data?.connection && data.connection.isEnabled ? data.connection : null
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['github-sync-status'] })
  const activeRun = (data?.syncRuns ?? []).find(isRunActive) ?? null

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <GitBranch size={22} />
          GitHub Sync
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--theme-muted-text)' }}>
          Version your workspace configuration in a GitHub repository and deploy it back.
        </p>
      </div>

      {activeRun && <ActiveSyncBar run={activeRun} />}

      {connection ? (
        <ConnectedCard connection={connection} activeRun={activeRun} canEdit={canEdit} onChanged={refresh} />
      ) : (
        <ConnectCard canEdit={canEdit} onConnected={refresh} />
      )}

      {connection && (
        <ScheduleCard connection={connection} canEdit={canEdit} onChanged={refresh} />
      )}

      {connection && (
        <TemplatesCard activeRun={activeRun} canEdit={canEdit} onChanged={refresh} />
      )}

      {connection && (
        <PendingChangesCard
          connection={connection}
          pendingChanges={data?.pendingChanges ?? []}
          recentCommits={data?.recentCommits ?? []}
          activeRun={activeRun}
          canEdit={canEdit}
          onChanged={refresh}
        />
      )}

      {connection && (
        <DeploymentsCard
          connection={connection}
          deployments={data?.deployments ?? []}
          canEdit={canEdit}
          onChanged={refresh}
        />
      )}

      {connection && (
        <SyncActivityCard syncRuns={data?.syncRuns ?? []} deployments={data?.deployments ?? []} />
      )}

      {connection && <CommitHistoryCard connection={connection} activeRun={activeRun} />}
    </div>
  )
}

// ── Active sync progress bar ─────────────────────────────────────────────────

const RUN_KIND_LABELS: Record<string, string> = {
  full_resync: 'Full sync to GitHub',
  commit: 'Committing queued changes',
  scheduled: 'Scheduled sync to GitHub',
  template: 'Template sync to GitHub',
}

function runPercent(run: SyncRun): number {
  if (run.status === 'completed') return 100
  switch (run.progress?.phase) {
    case 'exporting': return 20
    case 'planning': return 40
    case 'pruning': return 55
    case 'uploading': return 82
    case 'done': return 100
    default: return run.status === 'running' ? 12 : 5
  }
}

function ActiveSyncBar({ run }: { run: SyncRun }) {
  const percent = runPercent(run)
  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: 'var(--theme-primary)', backgroundColor: 'var(--theme-primary-light)' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <CloudUpload size={15} className="animate-pulse" style={{ color: 'var(--theme-primary-text)' }} />
        <p className="text-sm font-medium">{RUN_KIND_LABELS[run.kind]}</p>
        <span className="ml-auto text-xs tabular-nums font-medium" style={{ color: 'var(--theme-primary-text)' }}>
          {percent}%
        </span>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ backgroundColor: 'var(--theme-surface)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${percent}%`,
            backgroundColor: 'var(--theme-primary)',
            backgroundImage:
              'linear-gradient(45deg, rgba(255,255,255,.25) 25%, transparent 25%, transparent 50%, rgba(255,255,255,.25) 50%, rgba(255,255,255,.25) 75%, transparent 75%, transparent)',
            backgroundSize: '1rem 1rem',
            animation: 'github-sync-stripes 1s linear infinite',
          }}
        />
      </div>
      <p className="text-xs mt-2" style={{ color: 'var(--theme-muted-text)' }}>
        {run.progress?.message ?? 'Waiting for the sync worker to pick this up…'}
        {' '}You can leave this page — the sync continues in the background.
      </p>
      <style>{`@keyframes github-sync-stripes { from { background-position: 1rem 0 } to { background-position: 0 0 } }`}</style>
    </div>
  )
}

// ── Connection (disconnected) ────────────────────────────────────────────────

function ConnectCard({ canEdit, onConnected }: { canEdit: boolean; onConnected: () => void }) {
  const [token, setToken] = useState('')
  const [repoFullName, setRepoFullName] = useState('')
  const [branch, setBranch] = useState('')
  const [pathPrefix, setPathPrefix] = useState('usertasks')
  const [mode, setMode] = useState<'auto' | 'queue'>('queue')
  const [error, setError] = useState<string | null>(null)

  const reposMutation = useMutation({
    mutationFn: () => listGitHubRepos({ token }),
    onMutate: () => setError(null),
    onError: (e) => setError(errText(e)),
  })
  const repos = reposMutation.data ?? []

  const branchesMutation = useMutation({
    mutationFn: (input: { owner: string; repo: string }) =>
      listGitHubBranches({ ...input, token }),
    onError: (e) => setError(errText(e)),
  })

  const connectMutation = useMutation({
    mutationFn: () => {
      const [owner, repo] = repoFullName.split('/')
      return connectGitHubSync({ token, owner, repo, branch, mode, pathPrefix })
    },
    onMutate: () => setError(null),
    onSuccess: onConnected,
    onError: (e) => setError(errText(e)),
  })

  const repoOptions = useMemo(
    () => repos.map((r) => ({
      value: r.full_name,
      label: r.full_name,
      hint: `${r.private ? 'private' : 'public'} · default: ${r.default_branch}`,
    })),
    [repos],
  )
  const branchOptions = useMemo(() => {
    const names = new Set<string>(branchesMutation.data ?? [])
    const selectedRepo = repos.find((r) => r.full_name === repoFullName)
    if (selectedRepo?.default_branch) names.add(selectedRepo.default_branch)
    return Array.from(names).sort().map((name) => ({ value: name, label: name }))
  }, [branchesMutation.data, repos, repoFullName])

  function pickRepo(fullName: string) {
    setRepoFullName(fullName)
    const selected = repos.find((r) => r.full_name === fullName)
    setBranch(selected?.default_branch ?? 'main')
    const [owner, repo] = fullName.split('/')
    if (owner && repo) branchesMutation.mutate({ owner, repo })
  }

  if (!canEdit) {
    return (
      <Card>
        <h3 className="text-sm font-semibold mb-2">Connection</h3>
        <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>
          GitHub sync is not connected. Ask an administrator with edit access to connect a repository.
        </p>
      </Card>
    )
  }

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1">Connect a repository</h3>
      <p className="text-xs mb-4" style={{ color: 'var(--theme-muted-text)' }}>
        Workspace configuration (workflows, forms, pages, and more) is committed as JSON files to the repository you choose.
      </p>

      {error && <InlineNotice tone="error" message={error} onDismiss={() => setError(null)} className="mb-4" />}

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium mb-1.5">Personal access token</label>
          <div className="flex gap-2">
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_… or github_pat_…"
              autoComplete="off"
            />
            <Button
              variant="outline"
              onClick={() => reposMutation.mutate()}
              disabled={!token.trim() || reposMutation.isPending}
              className="shrink-0"
            >
              {reposMutation.isPending ? 'Verifying…' : 'Verify & list repos'}
            </Button>
          </div>
          <p className="text-xs mt-1.5" style={{ color: 'var(--theme-muted-text)' }}>
            Needs the classic <code>repo</code> scope, or a fine-grained token with read/write <code>Contents</code> access to the target repository.
          </p>
        </div>

        {repos.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1.5">Repository</label>
                <AutocompleteSelect
                  value={repoFullName || null}
                  onChange={pickRepo}
                  options={repoOptions}
                  placeholder="Choose a repository…"
                  size="md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5">Branch</label>
                <AutocompleteSelect
                  value={branch || null}
                  onChange={setBranch}
                  options={branchOptions}
                  placeholder={branchesMutation.isPending ? 'Loading branches…' : 'Choose a branch…'}
                  disabled={!repoFullName}
                  size="md"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5">Path prefix</label>
              <Input
                value={pathPrefix}
                onChange={(e) => setPathPrefix(e.target.value)}
                placeholder="usertasks"
              />
              <p className="text-xs mt-1.5" style={{ color: 'var(--theme-muted-text)' }}>
                Directory in the repository where configuration files are written.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5">Sync mode</label>
              <ModeRadio value={mode} onChange={setMode} disabled={false} />
            </div>

            <div className="pt-1">
              <Button
                onClick={() => connectMutation.mutate()}
                disabled={!repoFullName || !branch || connectMutation.isPending}
              >
                {connectMutation.isPending ? 'Connecting…' : 'Connect'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  )
}

function ModeRadio({
  value,
  onChange,
  disabled,
}: {
  value: 'auto' | 'queue'
  onChange: (mode: 'auto' | 'queue') => void
  disabled: boolean
}) {
  return (
    <div className="space-y-2">
      {MODE_OPTIONS.map((option) => (
        <label
          key={option.value}
          className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer"
          style={{
            borderColor: value === option.value ? 'var(--theme-primary)' : 'var(--theme-surface-border)',
            backgroundColor: value === option.value ? 'var(--theme-primary-light)' : 'transparent',
            opacity: disabled ? 0.6 : 1,
          }}
        >
          <input
            type="radio"
            name="github-sync-mode"
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            disabled={disabled}
            className="mt-0.5 accent-[color:var(--theme-primary)]"
          />
          <span>
            <span className="block text-sm font-medium">{option.label}</span>
            <span className="block text-xs" style={{ color: 'var(--theme-muted-text)' }}>{option.description}</span>
          </span>
        </label>
      ))}
    </div>
  )
}

// ── Connection (connected) ───────────────────────────────────────────────────

function ConnectedCard({
  connection,
  activeRun,
  canEdit,
  onChanged,
}: {
  connection: NonNullable<SyncStatus['connection']>
  activeRun: SyncRun | null
  canEdit: boolean
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmPush, setConfirmPush] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const modeMutation = useMutation({
    mutationFn: (mode: 'auto' | 'queue') => setGitHubSyncMode(mode),
    onMutate: () => setError(null),
    onSuccess: onChanged,
    onError: (e) => setError(errText(e)),
  })

  const watchRun = useWatchSyncRun()
  const pushMutation = useMutation({
    mutationFn: () => pushEverything(),
    onMutate: () => { setError(null); setNotice(null) },
    onSuccess: (result: any) => {
      setConfirmPush(false)
      if (result.runId && !result.alreadyRunning) watchRun('github_sync', result.runId, 'Push everything to GitHub')
      if (result.alreadyRunning) {
        setNotice('A sync is already in progress — its progress is shown above.')
      } else if (result.runId) {
        setNotice('Sync started in the background. You can keep working — progress is shown above.')
      } else {
        setNotice(`Pushed everything in commit ${shortSha(result.commitSha)} (${result.filesChanged} files).`)
      }
      onChanged()
    },
    onError: (e) => { setConfirmPush(false); setError(errText(e)) },
  })

  const disconnectMutation = useMutation({
    mutationFn: () => disconnectGitHub(),
    onMutate: () => { setError(null); setNotice(null) },
    onSuccess: () => { setConfirmDisconnect(false); onChanged() },
    onError: (e) => { setConfirmDisconnect(false); setError(errText(e)) },
  })

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <GitBranch size={14} style={{ color: 'var(--theme-primary-text)' }} />
            Connected repository
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>
            Changes to workspace configuration are synced to this repository.
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmPush(true)}
              disabled={pushMutation.isPending || Boolean(activeRun)}
            >
              <CloudUpload size={13} />
              {activeRun ? 'Sync in progress…' : 'Push everything now'}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setConfirmDisconnect(true)} disabled={disconnectMutation.isPending}>
              <Unplug size={13} />
              Disconnect
            </Button>
          </div>
        )}
      </div>

      {error && <InlineNotice tone="error" message={error} onDismiss={() => setError(null)} className="mb-3" />}
      {notice && <InlineNotice tone="success" message={notice} onDismiss={() => setNotice(null)} className="mb-3" />}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <SummaryItem label="Repository" value={`${connection.owner}/${connection.repo}`} />
        <SummaryItem label="Branch" value={connection.branch} />
        <SummaryItem label="Connected as" value={connection.connectedLogin || '—'} />
        <SummaryItem
          label="Last push"
          value={connection.lastPushAt ? `${shortSha(connection.lastPushSha)} · ${formatRelativeDate(connection.lastPushAt)}` : 'Never'}
        />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1.5">Sync mode</label>
        <ModeRadio
          value={connection.mode}
          onChange={(mode) => modeMutation.mutate(mode)}
          disabled={!canEdit || modeMutation.isPending}
        />
      </div>

      <ConfirmDialog
        open={confirmPush}
        onOpenChange={setConfirmPush}
        title="Push everything now?"
        description={`This rewrites all configuration files under "${connection.pathPrefix}/" in ${connection.owner}/${connection.repo} (${connection.branch}) with the current workspace state, and removes files for assets that no longer exist. It runs in the background — you can keep working while it syncs.`}
        confirmLabel="Push everything"
        busy={pushMutation.isPending}
        onConfirm={() => pushMutation.mutate()}
      />
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect GitHub sync?"
        description={`Syncing to ${connection.owner}/${connection.repo} will stop and the stored token will be removed. Files already committed to the repository are left untouched.`}
        confirmLabel="Disconnect"
        destructive
        busy={disconnectMutation.isPending}
        onConfirm={() => disconnectMutation.mutate()}
      />
    </Card>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--theme-surface)' }}>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>{label}</p>
      <p className="text-sm font-medium truncate" title={value}>{value}</p>
    </div>
  )
}

// ── Scheduled syncs ──────────────────────────────────────────────────────────

const WEEKDAY_OPTIONS = [
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '0', label: 'Sunday' },
]

const FREQUENCY_OPTIONS = [
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
]

function ScheduleCard({
  connection,
  canEdit,
  onChanged,
}: {
  connection: NonNullable<SyncStatus['connection']>
  canEdit: boolean
  onChanged: () => void
}) {
  const saved = connection.schedule ?? null
  const [enabled, setEnabled] = useState(Boolean(saved))
  const [frequency, setFrequency] = useState<'hourly' | 'daily' | 'weekly'>(saved?.schedule_mode ?? 'daily')
  const [timeOfDay, setTimeOfDay] = useState(saved?.time_of_day ?? '02:00')
  const [weekday, setWeekday] = useState(String(saved?.day_of_week ?? 1))
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!enabled) return setGitHubSyncSchedule(null)
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      if (frequency === 'hourly') {
        return setGitHubSyncSchedule({ schedule_mode: 'hourly', minute_of_hour: 0, timezone })
      }
      if (frequency === 'weekly') {
        return setGitHubSyncSchedule({ schedule_mode: 'weekly', day_of_week: Number(weekday), time_of_day: timeOfDay, timezone })
      }
      return setGitHubSyncSchedule({ schedule_mode: 'daily', time_of_day: timeOfDay, timezone })
    },
    onMutate: () => { setError(null); setNotice(null) },
    onSuccess: () => {
      setNotice(enabled ? 'Scheduled sync saved.' : 'Scheduled sync disabled.')
      onChanged()
    },
    onError: (e) => setError(errText(e)),
  })

  const savedSummary = saved
    ? saved.schedule_mode === 'hourly'
      ? 'every hour'
      : saved.schedule_mode === 'weekly'
        ? `every ${WEEKDAY_OPTIONS.find((d) => d.value === String(saved.day_of_week))?.label ?? 'week'} at ${saved.time_of_day}`
        : `every day at ${saved.time_of_day}`
    : null

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
        <CalendarClock size={14} style={{ color: 'var(--theme-primary-text)' }} />
        Scheduled sync
      </h3>
      <p className="text-xs mb-4" style={{ color: 'var(--theme-muted-text)' }}>
        Automatically push the full workspace configuration to GitHub on a schedule
        {savedSummary ? <> — currently <span className="font-medium">{savedSummary}</span>.</> : '. Currently off.'}
      </p>

      {error && <InlineNotice tone="error" message={error} onDismiss={() => setError(null)} className="mb-3" />}
      {notice && <InlineNotice tone="success" message={notice} onDismiss={() => setNotice(null)} className="mb-3" />}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={!canEdit}
            className="accent-[color:var(--theme-primary)]"
          />
          Enable scheduled sync
        </label>

        {enabled && (
          <>
            <AutocompleteSelect
              value={frequency}
              onChange={(value) => setFrequency(value as 'hourly' | 'daily' | 'weekly')}
              options={FREQUENCY_OPTIONS}
              disabled={!canEdit}
              size="sm"
              className="w-36"
            />
            {frequency === 'weekly' && (
              <AutocompleteSelect
                value={weekday}
                onChange={setWeekday}
                options={WEEKDAY_OPTIONS}
                disabled={!canEdit}
                size="sm"
                className="w-36"
              />
            )}
            {frequency !== 'hourly' && (
              <Input
                type="time"
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
                disabled={!canEdit}
                className="w-28"
              />
            )}
          </>
        )}

        {canEdit && (
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="ml-auto shrink-0">
            {saveMutation.isPending ? 'Saving…' : 'Save schedule'}
          </Button>
        )}
      </div>
      {enabled && frequency !== 'hourly' && (
        <p className="text-xs mt-2" style={{ color: 'var(--theme-muted-text)' }}>
          Times use your current timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Syncs run within a minute of the scheduled time.
        </p>
      )}
    </Card>
  )
}

// ── Pending changes ──────────────────────────────────────────────────────────

function PendingChangesCard({
  connection,
  pendingChanges,
  recentCommits,
  activeRun,
  canEdit,
  onChanged,
}: {
  connection: NonNullable<SyncStatus['connection']>
  pendingChanges: SyncStatus['pendingChanges']
  recentCommits: SyncStatus['recentCommits']
  activeRun: SyncRun | null
  canEdit: boolean
  onChanged: () => void
}) {
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const watchRun = useWatchSyncRun()
  const commitMutation = useMutation({
    mutationFn: () => commitPendingChanges({ message: message.trim() || undefined }),
    onMutate: () => { setError(null); setNotice(null) },
    onSuccess: (result: any) => {
      setMessage('')
      if (result.runId && !result.alreadyRunning) watchRun('github_sync', result.runId, 'Commit to GitHub')
      if (result.alreadyRunning) {
        setNotice('A sync is already in progress — your changes will be picked up by the next commit.')
      } else if (result.runId) {
        setNotice('Commit started in the background — progress is shown at the top of the page.')
      } else if (result.commitSha) {
        setNotice(`Committed ${result.filesChanged} file${result.filesChanged === 1 ? '' : 's'} in ${shortSha(result.commitSha)}.`)
      } else {
        setNotice('Nothing to commit — the queue was already empty.')
      }
      onChanged()
    },
    onError: (e) => setError(errText(e)),
  })

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1">
        Pending changes
        {pendingChanges.length > 0 && (
          <span className="text-xs font-normal ml-2" style={{ color: 'var(--theme-muted-text)' }}>
            ({pendingChanges.length})
          </span>
        )}
      </h3>
      <p className="text-xs mb-4" style={{ color: 'var(--theme-muted-text)' }}>
        {connection.mode === 'queue'
          ? 'Saved changes wait here until you commit them.'
          : 'Auto-sync backlog — changes are usually pushed within a minute.'}
      </p>

      {error && <InlineNotice tone="error" message={error} onDismiss={() => setError(null)} className="mb-3" />}
      {notice && <InlineNotice tone="success" message={notice} onDismiss={() => setNotice(null)} className="mb-3" />}

      {pendingChanges.length === 0 ? (
        <p className="text-sm py-3" style={{ color: 'var(--theme-muted-text)' }}>No pending changes.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border mb-4" style={{ borderColor: 'var(--theme-surface-border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs" style={{ color: 'var(--theme-muted-text)', backgroundColor: 'var(--theme-surface)' }}>
                  <th className="px-3 py-2 font-medium">Asset</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Queued</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {pendingChanges.map((row) => (
                  <tr key={row.id} className="border-t" style={{ borderColor: 'var(--theme-surface-border)' }}>
                    <td className="px-3 py-2 font-medium">{row.asset_name || row.asset_id}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--theme-muted-text)' }}>{row.asset_type}</td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                        style={row.action === 'delete'
                          ? { backgroundColor: '#FEF2F2', color: '#DC2626' }
                          : { backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}
                      >
                        {row.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--theme-muted-text)' }}>{formatRelativeDate(row.queued_at)}</td>
                    <td className="px-3 py-2 text-xs">
                      <span style={{ color: 'var(--theme-muted-text)' }}>{row.status}</span>
                      {row.error && <span className="block text-red-500 truncate max-w-48" title={row.error}>{row.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canEdit && (
            <div className="flex gap-2">
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Commit message (optional)"
              />
              <Button
                onClick={() => commitMutation.mutate()}
                disabled={commitMutation.isPending || Boolean(activeRun)}
                className="shrink-0"
              >
                <GitCommitHorizontal size={14} />
                {commitMutation.isPending || activeRun
                  ? 'Committing…'
                  : `Commit ${pendingChanges.length} change${pendingChanges.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          )}
        </>
      )}

      {recentCommits.length > 0 && (
        <div className="mt-5 pt-4 border-t" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--theme-muted-text)' }}>Recently committed</h4>
          <div className="space-y-1">
            {recentCommits.map((row) => (
              <div key={row.id} className="flex items-center gap-2 text-xs">
                <GitCommitHorizontal size={12} className="shrink-0" style={{ color: 'var(--theme-muted-text)' }} />
                <span className="font-medium truncate">{row.asset_name || row.asset_id}</span>
                <span style={{ color: 'var(--theme-muted-text)' }}>{row.asset_type} · {row.action}</span>
                <span className="ml-auto shrink-0 font-mono" style={{ color: 'var(--theme-muted-text)' }}>{shortSha(row.commit_sha)}</span>
                <span className="shrink-0" style={{ color: 'var(--theme-muted-text)' }}>{formatRelativeDate(row.updated_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

// ── Deployments ──────────────────────────────────────────────────────────────

const DEPLOY_STATUS_STYLES: Record<Deployment['status'], { backgroundColor: string; color: string }> = {
  pending: { backgroundColor: '#FFFBEB', color: '#B45309' },
  running: { backgroundColor: '#EFF6FF', color: '#1D4ED8' },
  completed: { backgroundColor: '#ECFDF5', color: '#047857' },
  failed: { backgroundColor: '#FEF2F2', color: '#DC2626' },
}

function deploymentStats(stats: Record<string, any> | null): string | null {
  if (!stats) return null
  const parts: string[] = []
  if (typeof stats.created === 'number') parts.push(`${stats.created} created`)
  if (typeof stats.updated === 'number') parts.push(`${stats.updated} updated`)
  if (typeof stats.skipped === 'number' && stats.skipped > 0) parts.push(`${stats.skipped} skipped`)
  const errorCount = Array.isArray(stats.errors) ? stats.errors.length : 0
  if (errorCount > 0) parts.push(`${errorCount} error${errorCount === 1 ? '' : 's'}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

function DeploymentsCard({
  connection,
  deployments,
  canEdit,
  onChanged,
}: {
  connection: NonNullable<SyncStatus['connection']>
  deployments: Deployment[]
  canEdit: boolean
  onChanged: () => void
}) {
  const [ref, setRef] = useState('')
  const [dryRun, setDryRun] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const watchRun = useWatchSyncRun()
  const deployMutation = useMutation({
    mutationFn: () => deployFromGitHub({ ref: ref.trim() || undefined, dryRun }),
    onMutate: () => setError(null),
    onSuccess: (result: { deploymentId?: string } | undefined) => { watchRun('github_deploy', result?.deploymentId, dryRun ? 'Deployment dry run from GitHub' : 'Deploy from GitHub'); setRef(''); setDryRun(false); onChanged() },
    onError: (e) => setError(errText(e)),
  })

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1">Deployments</h3>
      <p className="text-xs mb-4" style={{ color: 'var(--theme-muted-text)' }}>
        Import configuration from {connection.owner}/{connection.repo} into this workspace. Re-deploys update existing assets instead of duplicating them.
      </p>

      {error && <InlineNotice tone="error" message={error} onDismiss={() => setError(null)} className="mb-3" />}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder={`Branch or ref (default: ${connection.branch})`}
            className="max-w-xs"
          />
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="accent-[color:var(--theme-primary)]"
            />
            Dry run (report only, no changes)
          </label>
          <Button onClick={() => deployMutation.mutate()} disabled={deployMutation.isPending} className="ml-auto shrink-0">
            <Rocket size={14} />
            {deployMutation.isPending ? 'Starting…' : 'Deploy from GitHub'}
          </Button>
        </div>
      )}

      {deployments.length === 0 ? (
        <p className="text-sm py-3" style={{ color: 'var(--theme-muted-text)' }}>No deployments yet.</p>
      ) : (
        <div className="space-y-2">
          {deployments.slice(0, 8).map((deployment) => {
            const stats = deploymentStats(deployment.stats)
            return (
              <div
                key={deployment.id}
                className="rounded-lg p-3 text-sm"
                style={{ backgroundColor: 'var(--theme-surface)', border: '1px solid var(--theme-surface-border)' }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                    style={DEPLOY_STATUS_STYLES[deployment.status]}
                  >
                    {deployment.status}
                  </span>
                  {deployment.dry_run && (
                    <span
                      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                      style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}
                    >
                      dry run
                    </span>
                  )}
                  <span className="text-xs font-mono" style={{ color: 'var(--theme-muted-text)' }}>
                    {deployment.source?.ref ?? ''}{deployment.source?.commit_sha ? ` @ ${shortSha(deployment.source.commit_sha)}` : ''}
                  </span>
                  <span className="ml-auto text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                    {formatRelativeDate(deployment.created_at)}
                    {deployment.completed_at ? ` · finished ${formatRelativeDate(deployment.completed_at)}` : ''}
                  </span>
                </div>
                {stats && (
                  <p className="text-xs mt-1.5" style={{ color: 'var(--theme-muted-text)' }}>{stats}</p>
                )}
                {deployment.status === 'failed' && deployment.error && (
                  <p className="text-xs text-red-500 mt-1.5">{deployment.error}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ── Sync activity timeline ───────────────────────────────────────────────────

interface ActivityEvent {
  id: string
  direction: 'export' | 'import'
  status: 'pending' | 'running' | 'completed' | 'failed'
  title: string
  detail: string | null
  error: string | null
  timestamp: string
}

const ACTIVITY_STATUS_COLORS: Record<ActivityEvent['status'], string> = {
  pending: '#B45309',
  running: '#1D4ED8',
  completed: '#047857',
  failed: '#DC2626',
}

/** Unified export/import history — the visual audit trail for GitHub sync. */
function SyncActivityCard({ syncRuns, deployments }: { syncRuns: SyncRun[]; deployments: Deployment[] }) {
  const events = useMemo<ActivityEvent[]>(() => {
    const exports: ActivityEvent[] = syncRuns.map((run) => ({
      id: `run-${run.id}`,
      direction: 'export',
      status: run.status,
      title: RUN_KIND_LABELS[run.kind] ?? 'Sync to GitHub',
      detail: run.status === 'completed'
        ? `${run.files_changed ?? 0} files · commit ${shortSha(run.commit_sha)}`
        : run.progress?.message ?? null,
      error: run.error,
      timestamp: run.completed_at ?? run.started_at ?? run.created_at,
    }))
    const imports: ActivityEvent[] = deployments.map((deployment) => ({
      id: `deploy-${deployment.id}`,
      direction: 'import',
      status: deployment.status,
      title: deployment.dry_run ? 'Dry-run deployment from GitHub' : 'Deployment from GitHub',
      detail: [
        deployment.source?.commit_sha ? `@ ${shortSha(deployment.source.commit_sha)}` : null,
        deploymentStats(deployment.stats),
      ].filter(Boolean).join(' · ') || null,
      error: deployment.error,
      timestamp: deployment.completed_at ?? deployment.started_at ?? deployment.created_at,
    }))
    return [...exports, ...imports]
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, 15)
  }, [syncRuns, deployments])

  if (events.length === 0) return null

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1">Sync activity</h3>
      <p className="text-xs mb-4" style={{ color: 'var(--theme-muted-text)' }}>
        Every export to and import from GitHub, most recent first. These events are also recorded in the workspace audit log.
      </p>

      <div className="relative pl-6">
        {/* vertical spine */}
        <div
          className="absolute left-[11px] top-1 bottom-1 w-px"
          style={{ backgroundColor: 'var(--theme-surface-border)' }}
        />
        <div className="space-y-4">
          {events.map((event) => {
            const color = ACTIVITY_STATUS_COLORS[event.status]
            const Icon = event.direction === 'export' ? CloudUpload : CloudDownload
            return (
              <div key={event.id} className="relative">
                <span
                  className="absolute -left-6 top-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2"
                  style={{ borderColor: color, backgroundColor: 'var(--theme-card-bg, var(--theme-surface))' }}
                >
                  <Icon size={12} style={{ color }} />
                </span>
                <div className="flex flex-wrap items-baseline gap-x-2 pl-2">
                  <span className="text-sm font-medium">{event.title}</span>
                  <span
                    className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                    style={{ backgroundColor: `${color}18`, color }}
                  >
                    {event.status}
                  </span>
                  <span className="ml-auto text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                    {formatRelativeDate(event.timestamp)}
                  </span>
                </div>
                {event.detail && (
                  <p className="text-xs mt-0.5 pl-2" style={{ color: 'var(--theme-muted-text)' }}>{event.detail}</p>
                )}
                {event.error && (
                  <p className="text-xs mt-0.5 pl-2 text-red-500">{event.error}</p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

// ── Commit history ───────────────────────────────────────────────────────────

/** Actual git log of the synced branch, straight from GitHub. */
function CommitHistoryCard({
  connection,
  activeRun,
}: {
  connection: NonNullable<SyncStatus['connection']>
  activeRun: SyncRun | null
}) {
  const { data: commits, isLoading, error } = useQuery({
    queryKey: ['github-sync-commits', connection.owner, connection.repo, connection.branch, connection.lastPushSha, activeRun === null],
    queryFn: () => getGitHubCommits(),
    staleTime: 30_000,
  })

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
        <GitCommitHorizontal size={14} style={{ color: 'var(--theme-primary-text)' }} />
        Commits
      </h3>
      <p className="text-xs mb-4" style={{ color: 'var(--theme-muted-text)' }}>
        Latest commits on <span className="font-mono">{connection.owner}/{connection.repo}</span> · <span className="font-mono">{connection.branch}</span>
      </p>

      {error && <InlineNotice tone="error" message={errText(error)} />}
      {isLoading && <p className="text-sm py-2" style={{ color: 'var(--theme-muted-text)' }}>Loading commits…</p>}
      {!isLoading && !error && (commits ?? []).length === 0 && (
        <p className="text-sm py-2" style={{ color: 'var(--theme-muted-text)' }}>No commits yet — push everything to create the first one.</p>
      )}

      <div className="divide-y" style={{ borderColor: 'var(--theme-surface-border)' }}>
        {(commits ?? []).map((commit) => (
          <div key={commit.sha} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
            <GitCommitHorizontal size={14} className="shrink-0" style={{ color: 'var(--theme-muted-text)' }} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate" title={commit.message}>
                {commit.message.split('\n')[0]}
              </p>
              <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                {commit.author ?? 'unknown'}{commit.date ? ` · ${formatRelativeDate(commit.date)}` : ''}
              </p>
            </div>
            <a
              href={commit.html_url}
              target="_blank"
              rel="noreferrer"
              className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs hover:underline"
              style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-primary-text)' }}
            >
              {commit.sha.slice(0, 7)}
              <ExternalLink size={10} />
            </a>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── Sync templates ───────────────────────────────────────────────────────────

type TemplateAssetPick = { section: string; id: string; name?: string }

function templateSummary(template: GitHubSyncTemplateRow): string {
  const parts: string[] = []
  if (template.asset_types.length > 0) {
    const labels = template.asset_types.map((t) => SECTION_LABELS[t] ?? t)
    parts.push(labels.length <= 3 ? labels.join(', ') : `${labels.slice(0, 3).join(', ')} +${labels.length - 3} more`)
  }
  if (template.assets.length > 0) parts.push(`${template.assets.length} individual item${template.assets.length === 1 ? '' : 's'}`)
  return parts.join(' · ') || 'Empty'
}

function templateScheduleText(schedule: GitHubSyncTemplateRow['schedule']): string | null {
  if (!schedule) return null
  if (schedule.schedule_mode === 'hourly') return 'every hour'
  if (schedule.schedule_mode === 'weekly') {
    const day = WEEKDAY_OPTIONS.find((d) => d.value === String(schedule.day_of_week))?.label ?? 'week'
    return `every ${day} at ${schedule.time_of_day}`
  }
  return `every day at ${schedule.time_of_day}`
}

/**
 * Named selections of asset types / individual items that sync on demand or
 * on their own schedule — for pushing a slice of the workspace instead of
 * everything.
 */
function TemplatesCard({
  activeRun,
  canEdit,
  onChanged,
}: {
  activeRun: SyncRun | null
  canEdit: boolean
  onChanged: () => void
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<GitHubSyncTemplateRow | 'new' | null>(null)
  const [deleting, setDeleting] = useState<GitHubSyncTemplateRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const { data: templates } = useQuery({
    queryKey: ['github-sync-templates'],
    queryFn: () => listGitHubSyncTemplates(),
  })
  const refreshTemplates = () => queryClient.invalidateQueries({ queryKey: ['github-sync-templates'] })

  const watchRun = useWatchSyncRun()
  const runMutation = useMutation({
    mutationFn: (templateId: string) => runGitHubSyncTemplate(templateId),
    onMutate: () => { setError(null); setNotice(null) },
    onSuccess: (result: any) => {
      if (result.runId && !result.alreadyRunning) watchRun('github_sync', result.runId, 'Template sync to GitHub')
      setNotice(result.alreadyRunning
        ? 'A sync is already in progress — try again when it finishes.'
        : 'Template sync started — progress is shown at the top of the page.')
      onChanged()
    },
    onError: (e) => setError(errText(e)),
  })

  const deleteMutation = useMutation({
    mutationFn: (templateId: string) => deleteGitHubSyncTemplate(templateId),
    onSuccess: () => { setDeleting(null); refreshTemplates() },
    onError: (e) => { setDeleting(null); setError(errText(e)) },
  })

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <LayoutTemplate size={14} style={{ color: 'var(--theme-primary-text)' }} />
          Sync templates
        </h3>
        {canEdit && editing === null && (
          <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
            <Plus size={13} />
            New template
          </Button>
        )}
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--theme-muted-text)' }}>
        Push a selection — whole asset types or individual items — on demand or on a schedule, instead of syncing everything.
      </p>

      {error && <InlineNotice tone="error" message={error} onDismiss={() => setError(null)} className="mb-3" />}
      {notice && <InlineNotice tone="success" message={notice} onDismiss={() => setNotice(null)} className="mb-3" />}

      {editing !== null ? (
        <TemplateEditor
          template={editing === 'new' ? null : editing}
          onSaved={() => { setEditing(null); refreshTemplates() }}
          onStarted={(startedNotice) => { setNotice(startedNotice); onChanged() }}
          onCancel={() => setEditing(null)}
        />
      ) : (templates ?? []).length === 0 ? (
        <p className="text-sm py-3" style={{ color: 'var(--theme-muted-text)' }}>
          No templates yet. Create one to sync a specific set of workflows, forms, or any other items.
        </p>
      ) : (
        <div className="space-y-2">
          {(templates ?? []).map((template) => {
            const scheduleText = templateScheduleText(template.schedule)
            return (
              <div
                key={template.id}
                className="rounded-lg p-3"
                style={{ backgroundColor: 'var(--theme-surface)', border: '1px solid var(--theme-surface-border)' }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium min-w-0 truncate">{template.name}</span>
                  {scheduleText && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}
                    >
                      <CalendarClock size={10} />
                      {scheduleText}
                    </span>
                  )}
                  <span className="ml-auto text-xs shrink-0" style={{ color: 'var(--theme-muted-text)' }}>
                    {template.last_run_at ? `Last run ${formatRelativeDate(template.last_run_at)}` : 'Never run'}
                  </span>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>{templateSummary(template)}</p>
                {canEdit && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runMutation.mutate(template.id)}
                      disabled={runMutation.isPending || Boolean(activeRun)}
                    >
                      <Play size={12} />
                      Run now
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(template)}>
                      <Pencil size={12} />
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(template)}>
                      <Trash2 size={12} />
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null) }}
        title={`Delete template "${deleting?.name ?? ''}"?`}
        description="The template and its schedule are removed. Files already committed to the repository are left untouched."
        confirmLabel="Delete"
        destructive
        busy={deleteMutation.isPending}
        onConfirm={() => { if (deleting) deleteMutation.mutate(deleting.id) }}
      />
    </Card>
  )
}

function TemplateEditor({
  template,
  onSaved,
  onStarted,
  onCancel,
}: {
  template: GitHubSyncTemplateRow | null
  onSaved: () => void
  onStarted: (notice: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(template?.name ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [assetTypes, setAssetTypes] = useState<string[]>(template?.asset_types ?? [])
  const [assets, setAssets] = useState<TemplateAssetPick[]>(template?.assets ?? [])
  const [pickSection, setPickSection] = useState<string | null>(null)
  const [pickItem, setPickItem] = useState<string | null>(null)
  const [scheduleEnabled, setScheduleEnabled] = useState(Boolean(template?.schedule))
  const [frequency, setFrequency] = useState<'hourly' | 'daily' | 'weekly'>(template?.schedule?.schedule_mode ?? 'daily')
  const [timeOfDay, setTimeOfDay] = useState(template?.schedule?.time_of_day ?? '02:00')
  const [weekday, setWeekday] = useState(String(template?.schedule?.day_of_week ?? 1))
  const [error, setError] = useState<string | null>(null)

  const { data: syncable } = useQuery({
    queryKey: ['github-sync-assets'],
    queryFn: () => listSyncableAssets(),
    staleTime: 60_000,
  })

  const sectionOptions = useMemo(
    () => SYNC_SECTION_CATALOG.map((info) => ({ value: info.section, label: info.label })),
    [],
  )
  const itemOptions = useMemo(() => {
    if (!pickSection) return []
    const chosen = new Set(assets.filter((a) => a.section === pickSection).map((a) => a.id))
    return (syncable?.[pickSection] ?? []).map((item) => ({
      value: item.id,
      label: item.name,
      disabled: chosen.has(item.id),
    }))
  }, [pickSection, syncable, assets])

  function buildSchedule() {
    if (!scheduleEnabled) return null
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    if (frequency === 'hourly') return { schedule_mode: 'hourly' as const, minute_of_hour: 0, timezone }
    if (frequency === 'weekly') return { schedule_mode: 'weekly' as const, day_of_week: Number(weekday), time_of_day: timeOfDay, timezone }
    return { schedule_mode: 'daily' as const, time_of_day: timeOfDay, timezone }
  }

  const saveMutation = useMutation({
    mutationFn: () => saveGitHubSyncTemplate({
      id: template?.id,
      name,
      description,
      assetTypes,
      assets,
      schedule: buildSchedule(),
    }),
    onMutate: () => setError(null),
    onSuccess: onSaved,
    onError: (e) => setError(errText(e)),
  })

  const watchRun = useWatchSyncRun()
  const runSelectionMutation = useMutation({
    mutationFn: () => pushSelection({ assetTypes, assets }),
    onMutate: () => setError(null),
    onSuccess: (result: any) => {
      if (result.runId && !result.alreadyRunning) watchRun('github_sync', result.runId, 'Selection sync to GitHub')
      onStarted(result.alreadyRunning
        ? 'A sync is already in progress — try again when it finishes.'
        : 'Selection sync started — progress is shown at the top of the page.')
    },
    onError: (e) => setError(errText(e)),
  })

  const hasSelection = assetTypes.length > 0 || assets.length > 0

  return (
    <div className="rounded-lg p-4 space-y-4" style={{ backgroundColor: 'var(--theme-surface)', border: '1px solid var(--theme-surface-border)' }}>
      {error && <InlineNotice tone="error" message={error} onDismiss={() => setError(null)} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1.5">Template name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Core workflows" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5">Description (optional)</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this template syncs" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1.5">Whole asset types</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {SYNC_SECTION_CATALOG.map((info) => (
            <label key={info.section} className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={assetTypes.includes(info.section)}
                onChange={(e) => setAssetTypes((prev) =>
                  e.target.checked ? [...prev, info.section] : prev.filter((sectionKey) => sectionKey !== info.section))}
                className="accent-[color:var(--theme-primary)]"
              />
              {info.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1.5">Individual items</label>
        <div className="flex flex-wrap items-center gap-2">
          <AutocompleteSelect
            value={pickSection}
            onChange={(section) => { setPickSection(section); setPickItem(null) }}
            options={sectionOptions}
            placeholder="Type…"
            size="sm"
            className="w-44"
          />
          <AutocompleteSelect
            value={pickItem}
            onChange={setPickItem}
            options={itemOptions}
            placeholder={pickSection ? 'Choose an item…' : 'Pick a type first'}
            disabled={!pickSection}
            size="sm"
            className="w-56"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!pickSection || !pickItem}
            onClick={() => {
              if (!pickSection || !pickItem) return
              const item = (syncable?.[pickSection] ?? []).find((candidate) => candidate.id === pickItem)
              setAssets((prev) => [...prev, { section: pickSection, id: pickItem, name: item?.name ?? pickItem }])
              setPickItem(null)
            }}
          >
            <Plus size={12} />
            Add
          </Button>
        </div>
        {assets.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {assets.map((asset) => (
              <span
                key={`${asset.section}:${asset.id}`}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium max-w-56"
                style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}
              >
                <span className="truncate">{asset.name ?? asset.id}</span>
                <span style={{ color: 'var(--theme-muted-text)' }}>· {SECTION_LABELS[asset.section] ?? asset.section}</span>
                <button
                  type="button"
                  className="shrink-0 hover:opacity-70"
                  onClick={() => setAssets((prev) => prev.filter((candidate) => !(candidate.section === asset.section && candidate.id === asset.id)))}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            checked={scheduleEnabled}
            onChange={(e) => setScheduleEnabled(e.target.checked)}
            className="accent-[color:var(--theme-primary)]"
          />
          Sync on a schedule
        </label>
        {scheduleEnabled && (
          <>
            <AutocompleteSelect
              value={frequency}
              onChange={(value) => setFrequency(value as 'hourly' | 'daily' | 'weekly')}
              options={FREQUENCY_OPTIONS}
              size="sm"
              className="w-36"
            />
            {frequency === 'weekly' && (
              <AutocompleteSelect value={weekday} onChange={setWeekday} options={WEEKDAY_OPTIONS} size="sm" className="w-36" />
            )}
            {frequency !== 'hourly' && (
              <Input type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} className="w-28" />
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !name.trim() || !hasSelection}>
          {saveMutation.isPending ? 'Saving…' : template ? 'Save template' : 'Create template'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => runSelectionMutation.mutate()}
          disabled={runSelectionMutation.isPending || !hasSelection}
          title="Push this selection once, without saving"
        >
          <Play size={12} />
          Sync selection now
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
