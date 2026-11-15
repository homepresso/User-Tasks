"use client"

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { RefreshCw, Users } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { InlineNotice } from '@/components/ui/inline-notice'
import { formatRelativeDate } from '@/lib/utils'
import { listDirectorySourceEntries, startDirectorySourceSync, type DirectorySyncRun, type getDirectorySyncStatus } from '@/app/actions/directory-sync'
import { errText, SummaryItem, unwrap } from './shared'

type Source = Awaited<ReturnType<typeof getDirectorySyncStatus>>['sources'][number]
type EntryStatus = 'pending' | 'linked' | 'inactive'

const STATUS_LABEL: Record<EntryStatus, string> = { pending: 'Pending first sign-in', linked: 'Has an account', inactive: 'No longer listed' }

/**
 * Directory sources contributed by extensions (lib/directory-sync/sources.ts):
 * state, counts, "Sync now", and the people the source lists — pending ones
 * become users at their first sign-in (no invitation, no seat before).
 */
export function DirectorySourcesCard({ sources, runs, canEdit, onChanged }: { sources: Source[]; runs: DirectorySyncRun[]; canEdit: boolean; onChanged: () => void }) {
  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Users size={14} style={{ color: 'var(--theme-primary-text)' }} />
        Directory sources from extensions
      </h3>
      <p className="text-xs mb-4 text-fg-muted">
        People and groups an extension brings in. Groups become read-only teams. People with an account here are linked by
        e-mail / UPN; everyone else is listed as pending and becomes a user at their first single sign-on — no invitation
        e-mail, and no licence seat until then.
      </p>
      <div className="space-y-4">
        {sources.map((source) => (
          <SourceRow
            key={source.source}
            source={source}
            activeRun={runs.find((r) => r.provider === source.source && (r.status === 'pending' || r.status === 'running')) ?? null}
            canEdit={canEdit}
            onChanged={onChanged}
          />
        ))}
      </div>
    </Card>
  )
}

function SourceRow({ source, activeRun, canEdit, onChanged }: { source: Source; activeRun: DirectorySyncRun | null; canEdit: boolean; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [showPeople, setShowPeople] = useState(false)
  const sync = useMutation({
    mutationFn: () => unwrap(startDirectorySourceSync(source.source, true)),
    onSuccess: () => { setError(null); onChanged() },
    onError: (e) => setError(errText(e)),
  })
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--theme-surface)', border: '1px solid var(--theme-surface-border)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{source.label}</p>
        <span className="text-xs text-fg-muted">{source.extension_name}</span>
        {source.available ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral">Not available</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowPeople((v) => !v)}>{showPeople ? 'Hide people' : 'People'}</Button>
          {canEdit && source.available && (
            <Button variant="secondary" size="sm" onClick={() => sync.mutate()} disabled={sync.isPending || Boolean(activeRun)}>
              <RefreshCw size={13} className={activeRun ? 'animate-spin' : ''} />
              {activeRun ? 'Syncing…' : 'Sync now'}
            </Button>
          )}
        </div>
      </div>
      {source.description && <p className="text-xs mt-1 text-fg-muted">{source.description}</p>}
      {!source.available && source.unavailable_reason && <p className="text-xs mt-1 text-fg-muted">{source.unavailable_reason}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
        <SummaryItem label="With an account" value={String(source.linked_users)} />
        <SummaryItem label="Pending first sign-in" value={String(source.pending_entries)} />
        <SummaryItem label="Groups (teams)" value={String(source.groups)} />
        <SummaryItem label="Last sync" value={source.last_sync_at ? formatRelativeDate(source.last_sync_at) : 'Never'} />
      </div>
      <p className="text-2xs mt-2 text-fg-muted">Syncs every {source.interval_minutes} minutes{source.last_full_sync_at ? ` · last full sync ${formatRelativeDate(source.last_full_sync_at)}` : ''}.</p>
      {source.last_error && <p className="text-xs text-danger mt-1.5">{source.last_error}</p>}
      {error && <div className="mt-2"><InlineNotice tone="danger" message={error} /></div>}
      {showPeople && <SourcePeople source={source.source} />}
    </div>
  )
}

function SourcePeople({ source }: { source: string }) {
  const [status, setStatus] = useState<EntryStatus | 'all'>('pending')
  const { data, isLoading, error } = useQuery({
    queryKey: ['directory-source-entries', source, status],
    queryFn: () => unwrap(listDirectorySourceEntries(source, { status: status === 'all' ? null : status })),
  })
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-1.5 mb-2">
        {(['pending', 'linked', 'inactive', 'all'] as const).map((s) => (
          <Button key={s} size="sm" variant={status === s ? 'primary' : 'ghost'} onClick={() => setStatus(s)}>
            {s === 'all' ? 'All' : STATUS_LABEL[s]}
          </Button>
        ))}
      </div>
      {isLoading && <p className="text-xs text-fg-muted">Loading…</p>}
      {error && <p className="text-xs text-danger">{errText(error)}</p>}
      {data && data.entries.length === 0 && <p className="text-xs text-fg-muted">Nobody here.</p>}
      {data && data.entries.length > 0 && (
        <ul className="divide-y" style={{ borderColor: 'var(--theme-surface-border)' }}>
          {data.entries.map((entry) => (
            <li key={entry.id} className="py-1.5 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium">{entry.display_name ?? '—'}</span>
              <span className="text-fg-muted">{entry.email ?? 'no e-mail / UPN'}</span>
              <span className="ml-auto text-fg-muted">{entry.group_ids.length} group{entry.group_ids.length === 1 ? '' : 's'}</span>
              <Badge tone={entry.status === 'linked' ? 'success' : entry.status === 'pending' ? 'info' : 'neutral'}>{STATUS_LABEL[entry.status as EntryStatus] ?? entry.status}</Badge>
            </li>
          ))}
        </ul>
      )}
      {data && data.total > data.entries.length && <p className="text-2xs mt-1 text-fg-muted">Showing {data.entries.length} of {data.total}. Use the API (GET /api/v1/directory-sync/sources/{'{source}'}/entries) for the full list.</p>}
    </div>
  )
}
