"use client"

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  CloudDownload,
  Globe,
  KeyRound,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Unplug,
} from 'lucide-react'
import { usePermissions } from '@/lib/permissions-context'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { formatRelativeDate } from '@/lib/utils'
import {
  connectDirectory,
  disconnectDirectory,
  getDirectorySyncStatus,
  startDirectorySync,
  updateDirectoryOptions,
} from '@/app/actions/directory-sync'
import { LdapForm } from './ldap-form'
import { useJobs } from '@/components/jobs/jobs-provider'
import { GoogleConnectCard, ScimCard } from './google-scim'
import { errText, OptionCheckbox, PROVIDER_META, providerLabel, SummaryItem, unwrap } from './shared'

type DirectoryStatus = Awaited<ReturnType<typeof getDirectorySyncStatus>>
type Connection = DirectoryStatus['connections'][number]
type SyncRun = DirectoryStatus['runs'][number]
/** Pull directories (SCIM has its own card). */
type Provider = 'entra' | 'okta' | 'ldap' | 'google'
const PULL_PROVIDERS: Provider[] = ['entra', 'okta', 'ldap', 'google']

function isRunActive(run: SyncRun): boolean {
  return run.status === 'pending' || run.status === 'running'
}

export default function SsoDirectoryPage() {
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const canView = can('team.view_members') || can('settings.view')
  const canEdit = can('settings.edit')

  const { data, isLoading } = useQuery({
    queryKey: ['directory-sync-status'],
    queryFn: () => getDirectorySyncStatus(),
    enabled: canView,
    // Poll fast while a directory sync run is in flight so the progress bar
    // and status chips update live; otherwise stop polling entirely.
    refetchInterval: (query) => {
      const runs = query.state.data?.runs ?? []
      return runs.some(isRunActive) ? 2500 : false
    },
  })

  if (!canView) {
    return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Not authorized.</p>
  }
  if (isLoading && !data) {
    return <PageSkeleton variant="settings" />
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['directory-sync-status'] })
  const runs = data?.runs ?? []
  const activeRun = runs.find(isRunActive) ?? null

  const connectionFor = (provider: Connection['provider']): Connection | null =>
    (data?.connections ?? []).find((c: Connection) => c.provider === provider && c.isEnabled) ?? null
  const scimConnection = (data?.connections ?? []).find((c: Connection) => c.provider === 'scim') ?? null

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <KeyRound size={22} />
          SSO &amp; Directory
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--theme-muted-text)' }}>
          Sync users and groups from Microsoft Entra ID, Okta, LDAP / Active Directory or Google Workspace, or let your identity provider push them with SCIM.
        </p>
      </div>

      {activeRun && <ActiveSyncBar run={activeRun} />}

      {PULL_PROVIDERS.map((provider) => {
        const connection = connectionFor(provider)
        if (connection) {
          return (
            <ConnectedProviderCard
              key={provider}
              provider={provider}
              connection={connection}
              activeRun={activeRun && activeRun.provider === provider ? activeRun : null}
              anyRunActive={Boolean(activeRun)}
              canEdit={canEdit}
              onChanged={refresh}
            />
          )
        }
        if (!canEdit) return <DisconnectedNotice key={provider} provider={provider} />
        if (provider === 'entra') return <EntraConnectCard key={provider} onConnected={refresh} />
        if (provider === 'okta') return <OktaConnectCard key={provider} onConnected={refresh} />
        if (provider === 'ldap') return <CollapsedConnect key={provider} provider={provider}><LdapForm initial={null} onDone={refresh} /></CollapsedConnect>
        return <CollapsedConnect key={provider} provider={provider}><GoogleConnectCard onConnected={refresh} /></CollapsedConnect>
      })}

      {(data?.canViewSettings || scimConnection?.isEnabled) && (
        <ScimCard
          connection={scimConnection}
          tokens={data?.scimTokens ?? []}
          scimUrl={data?.scimUrl ?? ''}
          canEdit={canEdit}
          onChanged={refresh}
        />
      )}

      <SyncHistoryCard runs={runs} />

      <Card>
        <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
          <ShieldCheck size={14} style={{ color: 'var(--theme-primary-text)' }} />
          Single sign-on
        </h3>
        <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
          Sign-in is handled by the instance&apos;s auth provider (Supabase Auth, or built-in auth with OIDC / SAML
          identity providers). Directory sync here handles provisioning — synced users sign in with their work
          account, and with built-in auth an LDAP connection can also let them sign in with their directory password.
        </p>
        <p className="text-xs mt-2" style={{ color: 'var(--theme-muted-text)' }}>
          Microsoft note: on the app registration used for <em>sign-in</em>, add the <code>email</code> and{' '}
          <code>xms_edov</code> optional claims so Microsoft reports verified emails — that is what links a
          sign-in to the account provisioned by directory sync instead of creating a duplicate.
        </p>
      </Card>
    </div>
  )
}

// ── Active sync progress bar ─────────────────────────────────────────────────

function runPercent(run: SyncRun): number {
  if (run.status === 'completed') return 100
  switch (run.progress?.phase) {
    case 'fetching': return 20
    case 'users': return 50
    case 'groups': return 80
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
        <CloudDownload size={15} className="animate-pulse" style={{ color: 'var(--theme-primary-text)' }} />
        <p className="text-sm font-medium">Syncing from {providerLabel(run.provider)}</p>
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
            animation: 'directory-sync-stripes 1s linear infinite',
          }}
        />
      </div>
      <p className="text-xs mt-2" style={{ color: 'var(--theme-muted-text)' }}>
        {run.progress?.message ?? 'Waiting for the sync worker to pick this up…'}
        {' '}You can leave this page — the sync continues in the background.
      </p>
      <style>{`@keyframes directory-sync-stripes { from { background-position: 1rem 0 } to { background-position: 0 0 } }`}</style>
    </div>
  )
}

// ── Connect forms (disconnected) ─────────────────────────────────────────────

function DisconnectedNotice({ provider }: { provider: Provider }) {
  const Icon = PROVIDER_META[provider].icon
  return (
    <Card>
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
        <Icon size={14} style={{ color: 'var(--theme-primary-text)' }} />
        {PROVIDER_META[provider].label}
      </h3>
      <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>
        {PROVIDER_META[provider].label} is not connected. Ask an administrator with edit access to connect the directory.
      </p>
    </Card>
  )
}

/** A connect form behind a "Connect" button (LDAP, Google), so the page stays short. */
function CollapsedConnect({ provider, children }: { provider: Provider; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const Icon = PROVIDER_META[provider].icon
  if (open) return <>{children}</>
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Icon size={14} style={{ color: 'var(--theme-primary-text)' }} />
          {PROVIDER_META[provider].label}
        </h3>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Connect</Button>
      </div>
    </Card>
  )
}

function EntraConnectCard({ onConnected }: { onConnected: () => void }) {
  const [tenantId, setTenantId] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [syncGroups, setSyncGroups] = useState(true)
  const [autoProvision, setAutoProvision] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const connectMutation = useMutation({
    mutationFn: () => unwrap(connectDirectory({
      provider: 'entra',
      credentials: { tenant_id: tenantId.trim(), client_id: clientId.trim(), client_secret: clientSecret.trim() },
      syncGroups,
      autoProvision,
    })),
    onMutate: () => setError(null),
    onSuccess: onConnected,
    onError: (e) => setError(errText(e)),
  })

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Building2 size={14} style={{ color: 'var(--theme-primary-text)' }} />
        Connect Microsoft Entra ID
      </h3>
      <p className="text-xs mb-4" style={{ color: 'var(--theme-muted-text)' }}>
        Create an app registration in Entra with admin-consented Application permissions{' '}
        <code>User.Read.All</code> and <code>GroupMember.Read.All</code>, then paste its credentials.
      </p>

      {error && <InlineNotice tone="error" message={error} onDismiss={() => setError(null)} className="mb-4" />}

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1.5">Directory (tenant) ID</label>
            <Input
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5">Application (client) ID</label>
            <Input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              autoComplete="off"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5">Client secret</label>
          <Input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="Client secret value"
            autoComplete="off"
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <OptionCheckbox label="Sync groups as teams" checked={syncGroups} disabled={false} onChange={setSyncGroups} />
          <OptionCheckbox
            label="Automatically create accounts for directory users"
            checked={autoProvision}
            disabled={false}
            onChange={setAutoProvision}
          />
        </div>

        <div className="pt-1">
          <Button
            onClick={() => connectMutation.mutate()}
            disabled={!tenantId.trim() || !clientId.trim() || !clientSecret.trim() || connectMutation.isPending}
          >
            {connectMutation.isPending ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function OktaConnectCard({ onConnected }: { onConnected: () => void }) {
  const [orgUrl, setOrgUrl] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [syncGroups, setSyncGroups] = useState(true)
  const [autoProvision, setAutoProvision] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const connectMutation = useMutation({
    mutationFn: () => unwrap(connectDirectory({
      provider: 'okta',
      credentials: { org_url: orgUrl.trim(), api_token: apiToken.trim() },
      syncGroups,
      autoProvision,
    })),
    onMutate: () => setError(null),
    onSuccess: onConnected,
    onError: (e) => setError(errText(e)),
  })

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Globe size={14} style={{ color: 'var(--theme-primary-text)' }} />
        Connect Okta
      </h3>
      <p className="text-xs mb-4" style={{ color: 'var(--theme-muted-text)' }}>
        Create an API token in Okta Admin → Security → API, then paste it here along with your org URL.
      </p>

      {error && <InlineNotice tone="error" message={error} onDismiss={() => setError(null)} className="mb-4" />}

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1.5">Org URL</label>
            <Input
              value={orgUrl}
              onChange={(e) => setOrgUrl(e.target.value)}
              placeholder="https://your-org.okta.com"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5">API token</label>
            <Input
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder="Okta API token"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <OptionCheckbox label="Sync groups as teams" checked={syncGroups} disabled={false} onChange={setSyncGroups} />
          <OptionCheckbox
            label="Automatically create accounts for directory users"
            checked={autoProvision}
            disabled={false}
            onChange={setAutoProvision}
          />
        </div>

        <div className="pt-1">
          <Button
            onClick={() => connectMutation.mutate()}
            disabled={!orgUrl.trim() || !apiToken.trim() || connectMutation.isPending}
          >
            {connectMutation.isPending ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

// ── Connected provider card ──────────────────────────────────────────────────

function ConnectedProviderCard({
  provider,
  connection,
  activeRun,
  anyRunActive,
  canEdit,
  onChanged,
}: {
  provider: Provider
  connection: Connection
  activeRun: SyncRun | null
  anyRunActive: boolean
  canEdit: boolean
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [editing, setEditing] = useState(false)
  const meta = PROVIDER_META[provider]
  const Icon = meta.icon

  const optionsMutation = useMutation({
    mutationFn: (options: { syncGroups?: boolean; autoProvision?: boolean }) =>
      unwrap(updateDirectoryOptions(provider, options)),
    onMutate: () => setError(null),
    onSuccess: onChanged,
    onError: (e) => setError(errText(e)),
  })

  const jobs = useJobs()
  const syncMutation = useMutation({
    mutationFn: (full: boolean) => unwrap(startDirectorySync(provider, { full })),
    onMutate: () => { setError(null); setNotice(null) },
    onSuccess: (result: { runId: string; alreadyRunning: boolean }) => {
      // Follow the run as a background job: its completion pops up wherever the user is.
      if (result.runId && !result.alreadyRunning) {
        void jobs.start('sync.watch', { source: 'directory_sync', run_id: result.runId, label: `${providerLabel(provider)} directory sync` }, { effect: 'change', silentStart: true }).catch(() => undefined)
      }
      setNotice(result.alreadyRunning
        ? 'A sync is already in progress — its progress is shown above.'
        : 'Sync started in the background. You can keep working — progress is shown above.')
      onChanged()
    },
    onError: (e) => setError(errText(e)),
  })

  const disconnectMutation = useMutation({
    mutationFn: () => unwrap(disconnectDirectory(provider)),
    onMutate: () => { setError(null); setNotice(null) },
    onSuccess: () => { setConfirmDisconnect(false); onChanged() },
    onError: (e) => { setConfirmDisconnect(false); setError(errText(e)) },
  })

  if (editing && provider === 'ldap') {
    return <LdapForm initial={connection.settings ?? {}} onDone={() => { setEditing(false); onChanged() }} onCancel={() => setEditing(false)} />
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Icon size={14} style={{ color: 'var(--theme-primary-text)' }} />
            {meta.label}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>
            Users and groups are synced from this directory into the workspace.
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button
              size="sm"
              onClick={() => syncMutation.mutate(false)}
              disabled={syncMutation.isPending || anyRunActive}
            >
              <RefreshCw size={13} />
              {activeRun ? 'Sync in progress…' : 'Sync now'}
            </Button>
            {provider === 'ldap' && (
              <Button size="sm" variant="outline" onClick={() => syncMutation.mutate(true)} disabled={syncMutation.isPending || anyRunActive} title="Read every user instead of only the changes">
                Full sync
              </Button>
            )}
            {provider === 'ldap' && connection.settings && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Settings2 size={13} />
                Settings
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmDisconnect(true)}
              disabled={disconnectMutation.isPending}
            >
              <Unplug size={13} />
              Disconnect
            </Button>
          </div>
        )}
      </div>

      {error && <InlineNotice tone="error" message={error} onDismiss={() => setError(null)} className="mb-3" />}
      {notice && <InlineNotice tone="success" message={notice} onDismiss={() => setNotice(null)} className="mb-3" />}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <SummaryItem label="Organization" value={connection.orgName || '—'} />
        <SummaryItem
          label="Last sync"
          value={connection.lastSyncAt ? formatRelativeDate(connection.lastSyncAt) : 'Never'}
        />
        <SummaryItem label="Linked users" value={String(connection.linkedUsers)} />
        <SummaryItem label="Linked groups" value={String(connection.linkedGroups)} />
      </div>

      {provider === 'ldap' && connection.settings?.bind_login === true && (
        <p className="text-xs mb-3" style={{ color: 'var(--theme-muted-text)' }}>
          Directory password sign-in is on for this organisation (built-in auth).
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <OptionCheckbox
          label="Sync groups as teams"
          checked={connection.syncGroups}
          disabled={!canEdit || optionsMutation.isPending}
          onChange={(checked) => optionsMutation.mutate({ syncGroups: checked })}
        />
        <OptionCheckbox
          label="Automatically create accounts for directory users"
          checked={connection.autoProvision}
          disabled={!canEdit || optionsMutation.isPending}
          onChange={(checked) => optionsMutation.mutate({ autoProvision: checked })}
        />
      </div>

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={`Disconnect ${meta.label}?`}
        description={`Directory syncing from ${connection.orgName || meta.label} will stop and the stored credentials will be removed. Existing directory links are kept, and no user accounts are deleted.`}
        confirmLabel="Disconnect"
        destructive
        busy={disconnectMutation.isPending}
        onConfirm={() => disconnectMutation.mutate()}
      />
    </Card>
  )
}

// ── Sync history ─────────────────────────────────────────────────────────────

const DEPLOY_STATUS_STYLES: Record<SyncRun['status'], { backgroundColor: string; color: string }> = {
  pending: { backgroundColor: '#FFFBEB', color: '#B45309' },
  running: { backgroundColor: '#EFF6FF', color: '#1D4ED8' },
  completed: { backgroundColor: '#ECFDF5', color: '#047857' },
  failed: { backgroundColor: '#FEF2F2', color: '#DC2626' },
}

function runStats(stats: Record<string, number> | null): string | null {
  if (!stats) return null
  const parts: string[] = []
  const users = (stats.users_created ?? 0) + (stats.users_linked ?? 0)
  if (stats.users_seen !== undefined && users === 0) parts.push(`${stats.users_seen} user${stats.users_seen === 1 ? '' : 's'} checked`)
  if (users > 0) {
    parts.push(`${users} user${users === 1 ? '' : 's'}${stats.users_created ? ` (${stats.users_created} new)` : ''}`)
  }
  if (stats.users_deactivated) {
    parts.push(`${stats.users_deactivated} deactivated`)
  }
  const groups = (stats.groups_created ?? 0) + (stats.groups_updated ?? 0)
  if (groups > 0) {
    parts.push(`${groups} group${groups === 1 ? '' : 's'}${stats.groups_created ? ` (${stats.groups_created} new)` : ''}`)
  }
  const memberships = (stats.memberships_added ?? 0) + (stats.memberships_removed ?? 0)
  if (memberships > 0) {
    parts.push(`${memberships} membership${memberships === 1 ? '' : 's'}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

function SyncHistoryCard({ runs }: { runs: SyncRun[] }) {
  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1">Sync history</h3>
      <p className="text-xs mb-4" style={{ color: 'var(--theme-muted-text)' }}>
        Recent directory sync runs, most recent first.
      </p>

      {runs.length === 0 ? (
        <p className="text-sm py-3" style={{ color: 'var(--theme-muted-text)' }}>
          No syncs yet — connect a directory and run the first sync to see it here.
        </p>
      ) : (
        <div className="space-y-2">
          {runs.slice(0, 10).map((run) => {
            const stats = runStats(run.stats)
            return (
              <div
                key={run.id}
                className="rounded-lg p-3 text-sm"
                style={{ backgroundColor: 'var(--theme-surface)', border: '1px solid var(--theme-surface-border)' }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                    style={DEPLOY_STATUS_STYLES[run.status]}
                  >
                    {run.status}
                  </span>
                  <span className="text-xs font-medium min-w-0 truncate">
                    {providerLabel(run.provider)}{run.mode === 'delta' ? ' · changes only' : ''}
                  </span>
                  <span className="ml-auto text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                    {formatRelativeDate(run.created_at)}
                    {run.completed_at ? ` · finished ${formatRelativeDate(run.completed_at)}` : ''}
                  </span>
                </div>
                {stats && (
                  <p className="text-xs mt-1.5" style={{ color: 'var(--theme-muted-text)' }}>{stats}</p>
                )}
                {isRunActive(run) && run.progress?.message && (
                  <p className="text-xs mt-1.5" style={{ color: 'var(--theme-muted-text)' }}>{run.progress.message}</p>
                )}
                {run.status === 'failed' && run.error && (
                  <p className="text-xs text-red-500 mt-1.5">{run.error}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
