'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { FileUp, RefreshCw, Users } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge, type Tone } from '@/components/ui/badge'
import { Checkbox, Radio } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'
import { usePermissions } from '@/lib/permissions-context'
import { cn } from '@/lib/utils'
import { OrgImportPanel } from './org-import-panel'
import { invitePeopleFromDirectory, keepPeopleInSync, listPeopleImportSources, previewPeopleImport } from '@/app/actions/people-import'
import type { ImportInviteRole, ImportSource, InviteResult, PeopleImportPreview, PreviewStatus } from '@/lib/services/people-import'

/**
 * Organization → Import people (lib/services/people-import.ts):
 *  1. Source: a connected directory (Entra ID, Okta, Google Workspace,
 *     LDAP / AD) or a CSV file (the org import panel).
 *  2. Preview: the directory's groups and people, read only; picking groups
 *     narrows the people to their members.
 *  3. Select people (invite) or groups (keep in sync).
 *  4. Invite the selected people with a role, or keep the selected groups in
 *     sync (the connection's group scope, a full sync starts).
 * Every step is checked again on the server.
 */

const STATUS: Record<PreviewStatus, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'brand' },
  member: { label: 'Member', tone: 'neutral' },
  invited: { label: 'Invited', tone: 'info' },
  no_email: { label: 'No email', tone: 'warning' },
  inactive: { label: 'Inactive', tone: 'warning' },
}

type Source = { kind: 'directory'; source: ImportSource } | { kind: 'csv' }

export function ImportPeopleWizard({ canManage }: { canManage: boolean }) {
  const { can } = usePermissions()
  const canInvite = can('team.invite')
  const canSync = can('settings.edit')
  const canDirectory = canInvite || canSync
  const [sources, setSources] = useState<ImportSource[] | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canDirectory) { setSources([]); return }
    let live = true
    void listPeopleImportSources().then((r) => { if (live) { if (r.ok) setSources(r.data.sources); else { setSources([]); setError(r.error) } } })
    return () => { live = false }
  }, [canDirectory])

  return (
    <div className="space-y-4" data-import-people-wizard>
      <section aria-labelledby="import-source-heading" className="space-y-2">
        <h2 id="import-source-heading" className="text-sm font-semibold text-fg">1. Where are the people?</h2>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Import source">
          {(sources ?? []).map((s) => {
            const active = source?.kind === 'directory' && source.source.provider === s.provider
            return (
              <button key={s.provider} type="button" role="radio" aria-checked={active} onClick={() => setSource({ kind: 'directory', source: s })}
                className={cn('flex min-w-[180px] items-center gap-2 rounded-lg border px-3 py-2 text-left text-ui', active ? 'border-primary bg-primary-wash' : 'border-border hover:bg-subtle')}
                data-import-source={s.provider}>
                <Users className="size-4 shrink-0 text-fg-muted" aria-hidden />
                <span className="min-w-0">
                  <span className="block font-medium text-fg">{s.label}</span>
                  <span className="block truncate text-xs text-fg-muted">{s.org_name ?? 'Connected'}{s.scope_group_ids.length ? ` · ${s.scope_group_ids.length} groups in sync` : ''}</span>
                </span>
              </button>
            )
          })}
          <button type="button" role="radio" aria-checked={source?.kind === 'csv'} onClick={() => setSource({ kind: 'csv' })}
            className={cn('flex min-w-[180px] items-center gap-2 rounded-lg border px-3 py-2 text-left text-ui', source?.kind === 'csv' ? 'border-primary bg-primary-wash' : 'border-border hover:bg-subtle')}
            data-import-source="csv">
            <FileUp className="size-4 shrink-0 text-fg-muted" aria-hidden />
            <span><span className="block font-medium text-fg">CSV file</span><span className="block text-xs text-fg-muted">Update people already here</span></span>
          </button>
        </div>
        {sources === null && canDirectory && <p className="text-xs text-fg-muted" role="status">Looking for directory connections…</p>}
        {sources !== null && sources.length === 0 && can('settings.view') && (
          <InlineNotice tone="info" title="No directory connected"
            message="Connect Microsoft Entra ID, Okta, Google Workspace or LDAP / Active Directory to import people from it (or push with SCIM)."
            actions={<Link href="/settings/sso" className={buttonVariants({ variant: 'secondary', size: 'sm' })} data-org-directory-link>Connect a directory</Link>} />
        )}
        {error && <InlineNotice tone="danger" message={error} onDismiss={() => setError(null)} />}
      </section>

      {source?.kind === 'csv' && <OrgImportPanel canManage={canManage} />}
      {source?.kind === 'directory' && <DirectoryImport key={source.source.provider} source={source.source} canInvite={canInvite} canSync={canSync} />}
    </div>
  )
}

function DirectoryImport({ source, canInvite, canSync }: { source: ImportSource; canInvite: boolean; canSync: boolean }) {
  const [preview, setPreview] = useState<PeopleImportPreview | null>(null)
  const [busy, setBusy] = useState<'preview' | 'invite' | 'sync' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [groupIds, setGroupIds] = useState<string[]>(source.scope_group_ids)
  const [groupFilter, setGroupFilter] = useState('')
  const [peopleFilter, setPeopleFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'invite' | 'sync'>(canInvite ? 'invite' : 'sync')
  const [role, setRole] = useState<ImportInviteRole>('member')
  const [invited, setInvited] = useState<InviteResult | null>(null)
  const [synced, setSynced] = useState<{ groups: number; already_running: boolean } | null>(null)

  async function load(groups: string[]) {
    setBusy('preview'); setError(null); setInvited(null); setSynced(null)
    const r = await previewPeopleImport({ provider: source.provider, group_ids: groups })
    setBusy(null)
    if (!r.ok) { setError(r.error); return }
    setPreview(r.data)
    setSelected(new Set(r.data.users.filter((u) => u.status === 'new').map((u) => u.externalId)))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per source
  useEffect(() => { void load(source.scope_group_ids) }, [source.provider])

  const groups = useMemo(() => (preview?.groups ?? []).filter((g) => !groupFilter || g.displayName.toLowerCase().includes(groupFilter.toLowerCase())), [preview, groupFilter])
  const people = useMemo(() => (preview?.users ?? []).filter((u) => !peopleFilter || `${u.displayName} ${u.email ?? ''}`.toLowerCase().includes(peopleFilter.toLowerCase())), [preview, peopleFilter])
  const invitable = (preview?.users ?? []).filter((u) => u.status === 'new')

  async function invite() {
    setBusy('invite'); setError(null)
    const r = await invitePeopleFromDirectory({ provider: source.provider, external_ids: [...selected], role })
    setBusy(null)
    if (!r.ok) { setError(r.error); return }
    setInvited(r.data)
    await load(groupIds)
    setInvited(r.data)
  }

  async function sync() {
    setBusy('sync'); setError(null)
    const r = await keepPeopleInSync({ provider: source.provider, group_ids: groupIds })
    setBusy(null)
    if (!r.ok) { setError(r.error); return }
    setSynced({ groups: r.data.scope_group_ids.length, already_running: r.data.already_running })
  }

  return (
    <div className="space-y-4" data-directory-import={source.provider}>
      {error && <InlineNotice tone="danger" message={error} onDismiss={() => setError(null)} />}
      <section aria-labelledby="import-preview-heading" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="import-preview-heading" className="text-sm font-semibold text-fg">2. Preview and select</h2>
          <Button variant="secondary" size="sm" leadingIcon={<RefreshCw aria-hidden />} loading={busy === 'preview'} onClick={() => void load(groupIds)} data-import-refresh>
            {groupIds.length ? `Show members of ${groupIds.length} group${groupIds.length === 1 ? '' : 's'}` : 'Show everyone'}
          </Button>
        </div>
        <p className="text-xs text-fg-muted">Nothing is written until you invite or turn on sync. Pick groups to narrow the people to their members.</p>
        {!preview && busy === 'preview' && <p className="text-xs text-fg-muted" role="status">Reading {source.label}…</p>}
        {preview && (
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="space-y-2" data-import-groups>
              <p className="text-xs font-medium text-fg-muted">Groups ({preview.groups.length}){groupIds.length ? ` · ${groupIds.length} selected` : ''}</p>
              <Input size="sm" placeholder="Filter groups" aria-label="Filter groups" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} />
              <div className="max-h-[360px] space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {groups.length === 0 && <p className="text-xs text-fg-muted">No groups</p>}
                {groups.map((g) => (
                  <Checkbox key={g.externalId} label={g.displayName} description={g.description ?? undefined} checked={groupIds.includes(g.externalId)}
                    onChange={(e) => setGroupIds((ids) => (e.target.checked ? [...ids, g.externalId] : ids.filter((id) => id !== g.externalId)))}
                    data-import-group={g.externalId} />
                ))}
              </div>
            </div>
            <div className="min-w-0 space-y-2" data-import-people>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-medium text-fg-muted">
                  People ({preview.totalUsers}{preview.truncated ? `, first ${preview.users.length} shown` : ''}) · {invitable.length} new · {selected.size} selected
                </p>
                <div className="ml-auto w-56"><Input size="sm" placeholder="Filter people" aria-label="Filter people" value={peopleFilter} onChange={(e) => setPeopleFilter(e.target.value)} /></div>
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                <Table label="Directory people">
                  <THead>
                    <TR>
                      <TH className="w-8">
                        <Checkbox aria-label="Select all new people" checked={invitable.length > 0 && invitable.every((u) => selected.has(u.externalId))}
                          onChange={(e) => setSelected(e.target.checked ? new Set(invitable.map((u) => u.externalId)) : new Set())} />
                      </TH>
                      <TH>Name</TH><TH>Email</TH><TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {people.map((u) => (
                      <TR key={u.externalId} data-import-person={u.status}>
                        <TD>
                          <Checkbox aria-label={`Select ${u.displayName || u.email}`} disabled={u.status !== 'new'} checked={selected.has(u.externalId)}
                            onChange={(e) => setSelected((s) => { const next = new Set(s); if (e.target.checked) next.add(u.externalId); else next.delete(u.externalId); return next })} />
                        </TD>
                        <TD>{u.displayName || '—'}</TD>
                        <TD className="text-fg-muted">{u.email ?? '—'}</TD>
                        <TD><Badge tone={STATUS[u.status].tone}>{STATUS[u.status].label}</Badge></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </div>
          </div>
        )}
      </section>

      {preview && (
        <section aria-labelledby="import-action-heading" className="space-y-3 rounded-lg border border-border p-3">
          <h2 id="import-action-heading" className="text-sm font-semibold text-fg">3. Invite or keep in sync</h2>
          <div className="space-y-2" role="radiogroup" aria-label="What to do">
            <Radio name="import-mode" label="Invite the selected people" description="One-off invitations by email. They join when they accept; nothing stays linked to the directory."
              checked={mode === 'invite'} disabled={!canInvite} onChange={() => setMode('invite')} data-import-mode="invite" />
            <Radio name="import-mode" label="Keep the selected groups in sync"
              description={groupIds.length ? `${source.label} keeps the members of ${groupIds.length} group${groupIds.length === 1 ? '' : 's'} up to date here (accounts, teams, leavers). A full sync starts now.` : `No groups selected: everyone ${source.label} returns is kept in sync. A full sync starts now.`}
              checked={mode === 'sync'} disabled={!canSync} onChange={() => setMode('sync')} data-import-mode="sync" />
          </div>
          {mode === 'invite' ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-ui text-fg" htmlFor="import-role">Role</label>
              <div className="w-40">
                <Select id="import-role" size="sm" value={role} onChange={(e) => setRole(e.target.value as ImportInviteRole)}>
                  <option value="viewer">Viewer</option>
                  <option value="member">Member</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </Select>
              </div>
              <Button size="sm" disabled={!selected.size || !canInvite} loading={busy === 'invite'} onClick={() => void invite()} data-import-invite>
                Invite {selected.size} {selected.size === 1 ? 'person' : 'people'}
              </Button>
            </div>
          ) : (
            <Button size="sm" disabled={!canSync} loading={busy === 'sync'} onClick={() => void sync()} data-import-sync>Turn on sync</Button>
          )}
          {invited && (
            <div data-import-result><InlineNotice tone={invited.invited.length ? 'success' : 'warning'}
              title={`Invited ${invited.invited.length} ${invited.invited.length === 1 ? 'person' : 'people'}`}
              message={[
                invited.skipped.length ? `${invited.skipped.length} skipped (${[...new Set(invited.skipped.map((s) => s.reason))].join('; ')}).` : '',
                invited.email_failures ? `${invited.email_failures} invitation email${invited.email_failures === 1 ? '' : 's'} could not be sent: resend from Members & invites.` : '',
              ].filter(Boolean).join(' ') || undefined} /></div>
          )}
          {synced && (
            <InlineNotice tone="success" title={synced.already_running ? 'A sync is already running' : 'Sync started'}
              message={`${synced.groups ? `${synced.groups} group${synced.groups === 1 ? '' : 's'}` : 'Everyone'} will be kept in sync. Progress is in Settings → SSO & directory.`}
              actions={<Link href="/settings/sso" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>View sync</Link>} />
          )}
        </section>
      )}
    </div>
  )
}
