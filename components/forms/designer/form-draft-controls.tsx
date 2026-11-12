'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, GitCompare, History, Rocket, Trash2, User, Users } from 'lucide-react'
import { serverRead } from '@/lib/server-read'
import {
  discardFormDesignDraft, publishFormDesignDraft, restoreFormVersionAsDraft, shareFormDesignDraft, unshareFormDesignDraft,
} from '@/app/actions/forms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { InlineNotice } from '@/components/ui/inline-notice'
import { SearchableMultiOptionPicker, type SearchableMultiOption } from '@/components/ui/searchable-multi-option-picker'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip } from '@/components/ui/tooltip'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { plural } from '@/lib/format/plural'
import type { FormDraftDiff } from '@/lib/forms/draft-diff'

/**
 * Draft and publish in the form designer page (lib/services/form-design-
 * drafts.ts): the draft banner, Publish (with a note), Discard draft,
 * Compare with published, Version history (Restore as draft) and Share
 * draft (people and teams who may preview it, read only).
 */

export interface DraftSummary {
  updated_at: string
  created_at: string
  updated_by: { id: string; name: string } | null
  base_version: number
  reviewer_count: number
}

export interface DesignDraftView {
  available: boolean
  form: { id: string; name: string; version: number }
  draft: ({ fields: unknown[]; layout: unknown; theme: unknown; buttons: unknown[] | null; header: unknown; updated_at: string; base_version: number; summary: DraftSummary }) | null
  publish_problems: string[]
}

export const designDraftKey = (formId: string | null) => ['form-design-draft', formId] as const

/**
 * The form's draft for the designer (forms.edit). Never persisted or served
 * stale: the designer opens on it, and a stale "no draft" would let an
 * editor save over the shared draft. Callers wait for isFetchedAfterMount.
 */
export function useDesignDraft(formId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: designDraftKey(formId),
    enabled: enabled && Boolean(formId),
    meta: { persist: false },
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => ((await serverRead('forms.designDraft', { id: formId! })).data ?? null) as DesignDraftView | null,
  })
}

/** "Ana is editing the draft": someone else saved it in the last 10 minutes. */
export const EDITING_WINDOW_MS = 10 * 60 * 1000

/** Re-render every 30 s so "2 min ago" stays true. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export function DraftBanner({ summary, publishedVersion, myId, dirty, problems, onCompare, onShare, onDiscard }: {
  summary: DraftSummary
  publishedVersion: number
  myId: string | null
  dirty: boolean
  problems: string[]
  onCompare: () => void
  onShare: () => void
  onDiscard: () => void
}) {
  const now = useNow()
  const by = summary.updated_by
  const byName = by ? (by.id === myId ? 'you' : by.name) : 'someone'
  const someoneElseEditing = Boolean(by && by.id !== myId && now - new Date(summary.updated_at).getTime() < EDITING_WINDOW_MS)
  const stale = summary.base_version < publishedVersion
  return (
    <div className="mb-2 flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[color-mix(in_srgb,var(--theme-warning)_35%,var(--ds-border))] bg-warning-wash px-3 py-1.5 text-ui" role="status" data-form-draft-banner="">
      <span className="font-semibold text-fg">Draft — not visible to others</span>
      <Tooltip content={formatAbsolute(summary.updated_at)}>
        <span className="text-fg-muted" data-form-draft-saved="">· Last saved {formatRelative(summary.updated_at, { now: new Date(now) })} by {byName}</span>
      </Tooltip>
      {someoneElseEditing && <span className="inline-flex items-center gap-1 font-medium text-warning" data-form-draft-editing=""><User className="size-3.5" aria-hidden />{by!.name} is editing the draft</span>}
      {stale && <span className="text-fg-muted" data-form-draft-stale="">· Started from v{summary.base_version}; v{publishedVersion} was published since — publishing replaces it</span>}
      {dirty && <span className="text-fg-muted">· You have unsaved changes</span>}
      {problems.length > 0 && <span className="text-danger" data-form-draft-problems="">· {plural(problems.length, 'problem')} to fix before publishing</span>}
      <span className="ml-auto flex items-center gap-1">
        <Button size="sm" variant="ghost" leadingIcon={<GitCompare />} onClick={onCompare} data-form-draft-compare="">Compare</Button>
        <Button size="sm" variant="ghost" leadingIcon={<Eye />} onClick={onShare} data-form-draft-share="">
          Share draft{summary.reviewer_count ? ` (${summary.reviewer_count})` : ''}
        </Button>
        <Button size="sm" variant="ghost" leadingIcon={<Trash2 />} onClick={onDiscard} data-form-draft-discard="">Discard</Button>
      </span>
    </div>
  )
}

function DiffList({ diff }: { diff: FormDraftDiff | null | undefined }) {
  if (!diff) return <p className="text-ui text-fg-muted">Loading the changes…</p>
  return (
    <ul className="list-disc space-y-1 pl-5 text-ui" data-form-draft-diff="">
      {diff.lines.map((line, i) => <li key={i}>{line}</li>)}
    </ul>
  )
}

function useCompare(formId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['form-draft-compare', formId],
    enabled,
    staleTime: 0,
    queryFn: async () => ((await serverRead('forms.draftCompare', { id: formId })).data ?? null) as { published_version: number; diff: FormDraftDiff } | null,
  })
}

export function CompareDialog({ formId, open, onOpenChange }: { formId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data } = useCompare(formId, open)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" title="Compare with published" description={data ? `What the draft changes against version ${data.published_version}, which everyone sees now.` : undefined}>
        <DialogBody><DiffList diff={data?.diff} /></DialogBody>
        <DialogFooter><Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PublishDialog({ formId, formName, open, onOpenChange, problems, onPublished }: {
  formId: string
  formName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  problems: string[]
  onPublished: (version: number, changed: boolean) => void | Promise<void>
}) {
  const { data } = useCompare(formId, open)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (open) { setError(null) } }, [open])
  async function publish() {
    setBusy(true); setError(null)
    const result = await publishFormDesignDraft(formId, note.trim() || null)
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    setNote('')
    await onPublished(result.data.version, result.data.version_changed)
  }
  const next = data ? data.published_version + 1 : null
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v) }}>
      <DialogContent size="md" title={`Publish “${formName}”`} description={next ? `The draft becomes version ${next}. Everyone filling this form sees it; published workflows keep the version they pinned. Draft reviewers lose access.` : undefined} data-form-publish-dialog="">
        <DialogBody className="space-y-4">
          {problems.length > 0 && (
            <InlineNotice tone="danger" title="Fix these before publishing">
              <ul className="mt-1 list-disc pl-5">{problems.slice(0, 8).map((p, i) => <li key={i}>{p}</li>)}</ul>
            </InlineNotice>
          )}
          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">Changes</p>
            <DiffList diff={data?.diff} />
          </div>
          <Field label="Note" optional>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="What changed? (shown in the version history)" data-form-publish-note="" />
          </Field>
          {error && <InlineNotice tone="danger">{error}</InlineNotice>}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void publish()} loading={busy} disabled={problems.length > 0} leadingIcon={<Rocket />} data-form-publish-confirm="">Publish{next ? ` version ${next}` : ''}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DiscardDraftDialog({ formId, open, onOpenChange, onDiscarded, onError }: { formId: string; open: boolean; onOpenChange: (open: boolean) => void; onDiscarded: () => void | Promise<void>; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  return (
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Discard the draft?"
        description="Every unpublished change to this form is thrown away for all editors, and the people you shared the draft with lose access. The published version stays as it is."
        confirmLabel="Discard draft"
        destructive
        busy={busy}
        onConfirm={async () => {
          setBusy(true)
          const result = await discardFormDesignDraft(formId)
          setBusy(false)
          onOpenChange(false)
          if (!result.ok) { onError(result.error); return }
          await onDiscarded()
        }}
      />
  )
}

type VersionRow = { id: string; version: number; name: string; note?: string | null; created_by: string | null; created_at: string }

export function VersionHistoryDialog({ formId, open, onOpenChange, currentVersion, draftsAvailable, onRestored }: {
  formId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  currentVersion: number
  draftsAvailable: boolean
  onRestored: (version: number) => void | Promise<void>
}) {
  const { data: versions } = useQuery({
    queryKey: ['form-versions', formId],
    enabled: open,
    staleTime: 0,
    queryFn: async () => ((await serverRead('forms.versions', { id: formId })).data ?? []) as VersionRow[],
  })
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function restore(version: number) {
    setBusy(version); setError(null)
    const result = await restoreFormVersionAsDraft(formId, version)
    setBusy(null)
    if (!result.ok) { setError(result.error); return }
    onOpenChange(false)
    await onRestored(version)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" title="Version history" description={draftsAvailable ? 'Every published version, newest first. Restore as draft copies a version into the draft (replacing it) — nothing changes for others until you publish.' : 'Every published version, newest first.'}>
        <DialogBody className="space-y-3">
          {error && <InlineNotice tone="danger">{error}</InlineNotice>}
          {!versions ? <p className="text-ui text-fg-muted">Loading…</p> : (
            <ul className="divide-y divide-border-subtle rounded-md border border-border" data-form-version-list="">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center gap-3 px-3 py-2 text-ui" data-form-version={v.version}>
                  <span className="w-10 shrink-0 font-mono text-xs text-fg-muted">v{v.version}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate"><span className="font-medium">{formatAbsolute(v.created_at)}</span>{v.version === currentVersion && <Badge tone="success" className="ml-2">Published</Badge>}</p>
                    {v.note && <p className="truncate text-xs text-fg-muted">“{v.note}”</p>}
                  </div>
                  {draftsAvailable && (
                    <Button size="sm" variant="ghost" loading={busy === v.version} disabled={busy !== null} onClick={() => void restore(v.version)} data-form-version-restore={v.version}>Restore as draft</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogFooter><Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type ReviewerRow = { id: string; principal_type: 'user' | 'team'; principal_id: string; name: string; member_count: number | null; added_by: { id: string; name: string } | null; created_at: string }

export function ShareDraftDialog({ formId, open, onOpenChange, hasDraft, onChanged }: { formId: string; open: boolean; onOpenChange: (open: boolean) => void; hasDraft: boolean; onChanged: () => void }) {
  const queryClient = useQueryClient()
  const key = ['form-draft-reviewers', formId]
  const { data: list } = useQuery({
    queryKey: key,
    enabled: open,
    queryFn: async () => ((await serverRead('forms.draftReviewers', { id: formId })).data ?? null) as { reviewers: ReviewerRow[]; has_draft: boolean } | null,
  })
  const { data: targets } = useQuery({
    queryKey: ['form-draft-reviewer-targets'],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => ((await serverRead('forms.draftReviewerTargets')).data ?? null) as { users: Array<{ id: string; name: string; email: string | null }>; teams: Array<{ id: string; name: string }> } | null,
  })
  const [picked, setPicked] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const reviewers = list?.reviewers ?? []
  const shared = useMemo(() => new Set(reviewers.map((r) => `${r.principal_type}:${r.principal_id}`)), [reviewers])
  const options = useMemo<SearchableMultiOption[]>(() => [
    ...(targets?.users ?? []).map((u) => ({ value: `user:${u.id}`, label: u.name, subtitle: u.email && u.email !== u.name ? u.email : undefined, group: 'People', keywords: u.email ? [u.email] : [] })),
    ...(targets?.teams ?? []).map((t) => ({ value: `team:${t.id}`, label: t.name, subtitle: 'Team', group: 'Teams' })),
  ].filter((o) => !shared.has(o.value)), [targets, shared])
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: key }); onChanged() }

  async function share() {
    if (!picked.length) return
    setBusy(true); setError(null); setMessage(null)
    const principals = picked.map((v) => { const [type, id] = v.split(':') as ['user' | 'team', string]; return { type, id } })
    const result = await shareFormDesignDraft(formId, { principals, note: note.trim() || null })
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    setPicked([]); setNote('')
    refresh()
    const { added, notified } = result.data
    setMessage(added.length ? `Shared with ${added.map((r) => r.name).join(', ')}.${notified ? ` ${plural(notified, 'person', 'people')} notified.` : ''}` : 'Everyone you chose can already preview the draft.')
  }
  async function remove(r: ReviewerRow) {
    setRemoving(r.id); setError(null); setMessage(null)
    const result = await unshareFormDesignDraft(formId, r.id)
    setRemoving(null)
    if (!result.ok) { setError(result.error); return }
    refresh()
    setMessage(`Stopped sharing with ${r.name}.`)
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/forms/${formId}/draft-preview`); setMessage('Preview link copied') } catch { setError('Could not copy the link') }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v) }}>
      <DialogContent size="md" title="Share draft" description="People and teams you add can preview this draft and try filling it in — read only, nothing they enter is submitted. They don't need Edit forms. Access ends when the draft is published or discarded." data-form-share-draft-dialog="">
        <DialogBody className="space-y-4">
          {!hasDraft ? <InlineNotice tone="info">Save a draft first: there is nothing to share until the form has unpublished changes.</InlineNotice> : (
            <>
              <Field label="People or teams">
                <SearchableMultiOptionPicker options={options} values={picked} onChange={setPicked} placeholder="Search people and teams" searchPlaceholder="Type a name or team…" emptyLabel="Nobody else to add" />
              </Field>
              <Field label="Note" optional>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="What should they look at? (shown in their notification)" data-form-share-note="" />
              </Field>
            </>
          )}
          {error && <InlineNotice tone="danger">{error}</InlineNotice>}
          {message && <InlineNotice tone="success">{message}</InlineNotice>}
          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">{reviewers.length ? `Can preview: ${plural(reviewers.length, 'person or team', 'people / teams')}` : 'Not shared with anyone yet'}</p>
            {reviewers.length > 0 && (
              <ul className="divide-y divide-border-subtle rounded-md border border-border" data-form-draft-reviewers="">
                {reviewers.map((r) => {
                  const Icon = r.principal_type === 'team' ? Users : User
                  return (
                    <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-ui" data-form-draft-reviewer={r.principal_type}>
                      <Icon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{r.name}</p>
                        <p className="truncate text-xs text-fg-muted">{[r.principal_type === 'team' ? `Team · ${plural(r.member_count ?? 0, 'member')}` : null, r.added_by ? `added by ${r.added_by.name}` : null].filter(Boolean).join(' · ')}</p>
                      </div>
                      <Badge tone="neutral">Can preview</Badge>
                      <IconButton size="sm" label={`Stop sharing with ${r.name}`} icon={<Trash2 />} loading={removing === r.id} disabled={removing !== null} onClick={() => void remove(r)} />
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          {hasDraft && <Button variant="ghost" className="mr-auto" onClick={() => void copyLink()}>Copy preview link</Button>}
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
          {hasDraft && <Button onClick={() => void share()} loading={busy} disabled={!picked.length} leadingIcon={<Eye />} data-form-share-submit="">Share</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The ⋯ menu's "Version history" icon (re-exported for the page). */
export const VersionHistoryIcon = History
