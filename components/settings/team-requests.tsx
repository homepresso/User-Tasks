'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Inbox, Mail, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Badge, type Tone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { SearchInput } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { InlineNotice } from '@/components/ui/inline-notice'
import { EmptyState } from '@/components/ui/empty-state'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { DialogBody, DialogFooter } from '@/components/ui/dialog'
import { Table, TBody, TD, TH, THead, TR, Truncate } from '@/components/ui/table'
import { sanitizeHtml } from '@/lib/html-sanitize'
import { getTeamRequestAction, listTeamRequestsAction, updateTeamRequestAction } from '@/app/actions/team-requests'
import type { TeamRequestDetail, TeamRequestListItem } from '@/lib/services/team-requests'
import {
  TEAM_REQUEST_KIND_LABELS, TEAM_REQUEST_STATUS_LABELS, TEAM_REQUEST_STATUSES, type TeamRequestKind, type TeamRequestStatus,
} from '@/lib/contact/team-request-labels'

/**
 * Settings → Requests (instance admins): the team's request log. Filters
 * live in the URL (kind, status, q) and re-render the page on the server;
 * paging is keyset (Next / Previous keep a stack of cursors). Clicking a
 * row opens its detail: the notification's HTML (sanitised again here),
 * the structured facts, how the notification went, status and note, and
 * Reply by email.
 */

const KIND_TONE: Record<TeamRequestKind, Tone> = {
  contact: 'info',
  feedback: 'brand',
  docs_feedback: 'neutral',
  beta_signup: 'success',
  trial: 'warning',
  other: 'neutral',
}

const STATUS_TONE: Record<TeamRequestStatus, Tone> = {
  new: 'info',
  in_progress: 'warning',
  handled: 'success',
  spam: 'neutral',
}

const KIND_OPTIONS = [{ value: 'all', label: 'All kinds' }, ...Object.entries(TEAM_REQUEST_KIND_LABELS).map(([value, label]) => ({ value, label }))]
const STATUS_FILTER_OPTIONS = [
  { value: 'open', label: 'Open (new + in progress)' },
  ...TEAM_REQUEST_STATUSES.map((s) => ({ value: s, label: TEAM_REQUEST_STATUS_LABELS[s] })),
  { value: 'all', label: 'All statuses' },
]
const STATUS_OPTIONS = TEAM_REQUEST_STATUSES.map((s) => ({ value: s, label: TEAM_REQUEST_STATUS_LABELS[s] }))

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/

/** mailto: for a reply, or null when the address isn't a plain email. */
export function replyHref(to: string | null | undefined, subject: string): string | null {
  const address = to?.trim()
  if (!address || !EMAIL.test(address)) return null
  return `mailto:${address}?subject=${encodeURIComponent(subject.startsWith('Re:') ? subject : `Re: ${subject}`)}`
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function factLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

function factValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map(factValue).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const DELIVERY_LABEL: Record<string, string> = { ok: 'Delivered', failed: 'Failed', unconfigured: 'Not configured', pending: 'Pending' }
const DELIVERY_TONE: Record<string, Tone> = { ok: 'success', failed: 'danger', unconfigured: 'neutral', pending: 'warning' }

export interface TeamRequestsViewProps {
  filters: { kind: string; status: string; q: string }
  initial: { items: TeamRequestListItem[]; nextCursor: string | null }
  initialId: string | null
  error: string | null
}

export function TeamRequestsView({ filters, initial, initialId, error }: TeamRequestsViewProps) {
  const router = useRouter()
  const pathname = usePathname() ?? '/settings/requests'
  const [items, setItems] = useState(initial.items)
  const [nextCursor, setNextCursor] = useState(initial.nextCursor)
  /** Cursors of the pages before this one ('' = the first page). */
  const [cursorStack, setCursorStack] = useState<string[]>([])
  const [currentCursor, setCurrentCursor] = useState('')
  const [loadError, setLoadError] = useState<string | null>(error)
  const [paging, startPaging] = useTransition()
  const [search, setSearch] = useState(filters.q)
  const [openId, setOpenId] = useState<string | null>(initialId)

  // A new server render (filters changed, or refreshed after a save): back to its first page.
  useEffect(() => {
    setItems(initial.items)
    setNextCursor(initial.nextCursor)
    setCursorStack([])
    setCurrentCursor('')
    setLoadError(error)
  }, [initial, error])

  const pushFilters = useCallback((next: Partial<TeamRequestsViewProps['filters']>) => {
    const merged = { ...filters, ...next }
    const params = new URLSearchParams()
    if (merged.kind && merged.kind !== 'all') params.set('kind', merged.kind)
    if (merged.status && merged.status !== 'open') params.set('status', merged.status)
    if (merged.q.trim()) params.set('q', merged.q.trim())
    router.replace(params.size ? `${pathname}?${params}` : pathname)
  }, [filters, pathname, router])

  // Search: debounced into the URL.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (search.trim() === filters.q.trim()) return
    searchTimer.current = setTimeout(() => pushFilters({ q: search }), 350)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [search, filters.q, pushFilters])

  const loadPage = (cursor: string, stack: string[]) => startPaging(async () => {
    const result = await listTeamRequestsAction({ kind: filters.kind as never, status: filters.status as never, q: filters.q || undefined, cursor: cursor || undefined })
    if (!result.ok) { setLoadError(result.error); return }
    setLoadError(null)
    setItems(result.data.items)
    setNextCursor(result.data.nextCursor)
    setCursorStack(stack)
    setCurrentCursor(cursor)
  })

  const onNext = () => { if (nextCursor) loadPage(nextCursor, [...cursorStack, currentCursor]) }
  const onPrevious = () => {
    if (!cursorStack.length) return
    loadPage(cursorStack[cursorStack.length - 1], cursorStack.slice(0, -1))
  }
  const onRefresh = () => loadPage(currentCursor, cursorStack)

  const onUpdated = (detail: TeamRequestDetail) => {
    setItems((list) => list.map((row) => (row.id === detail.id ? { ...row, status: detail.status, handled_at: detail.handled_at } : row)))
  }

  const filtered = filters.kind !== 'all' || filters.status !== 'open' || Boolean(filters.q)
  const page = cursorStack.length + 1

  return (
    <div className="space-y-4" data-testid="team-requests">
      <PageHeader
        title="Requests"
        description="Everything people send the team: the contact form, in-app feedback, docs feedback, beta signups and trials. Each one is kept here and sent to ChirpMe."
        actions={<Button variant="secondary" size="sm" onClick={onRefresh} disabled={paging}><RefreshCw className="size-4" aria-hidden /> Refresh</Button>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Kind" size="sm" wrapperClassName="w-44" value={filters.kind} options={KIND_OPTIONS} onChange={(e) => pushFilters({ kind: e.target.value })} data-testid="filter-kind" />
        <Select aria-label="Status" size="sm" wrapperClassName="w-56" value={filters.status} options={STATUS_FILTER_OPTIONS} onChange={(e) => pushFilters({ status: e.target.value })} data-testid="filter-status" />
        <SearchInput size="sm" className="w-72" value={search} onValueChange={setSearch} placeholder="Search name, email, company, title" aria-label="Search requests" maxLength={200} />
      </div>

      {loadError && <InlineNotice tone="danger" message={loadError} />}

      {!loadError && items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          variant={filtered ? 'no-results' : 'first-run'}
          title={filtered ? 'No requests match' : 'No open requests'}
          description={filtered ? 'Try another kind, status or search.' : 'New contact messages, feedback and signups show up here.'}
        />
      ) : items.length > 0 && (
        <Table label="Team requests" aria-busy={paging}>
          <THead>
            <tr>
              <TH col="date">Date</TH>
              <TH col="status">Kind</TH>
              <TH col="people">Name</TH>
              <TH col="name">Company</TH>
              <TH col="name">Email</TH>
              <TH col="title">Title</TH>
              <TH col="status">Status</TH>
            </tr>
          </THead>
          <TBody>
            {items.map((row) => (
              <TR key={row.id} interactive selected={row.id === openId} onClick={() => setOpenId(row.id)} data-testid={`request-${row.id}`}>
                <TD col="date"><time dateTime={row.created_at} suppressHydrationWarning>{formatDate(row.created_at)}</time></TD>
                <TD col="status"><Badge tone={KIND_TONE[row.kind] ?? 'neutral'}>{TEAM_REQUEST_KIND_LABELS[row.kind] ?? row.kind}</Badge></TD>
                <TD col="people" className="max-w-0"><Truncate text={row.name ?? '—'} /></TD>
                <TD col="name" className="max-w-0"><Truncate text={row.company ?? '—'} /></TD>
                <TD col="name" className="max-w-0">
                  {row.email && replyHref(row.email, row.title)
                    ? <a href={replyHref(row.email, row.title)!} onClick={(e) => e.stopPropagation()} className="block truncate text-primary hover:underline" title={row.email}>{row.email}</a>
                    : <Truncate text={row.email ?? '—'} />}
                </TD>
                <TD col="title" className="max-w-0"><Truncate text={row.title} /></TD>
                <TD col="status"><Badge tone={STATUS_TONE[row.status] ?? 'neutral'} dot>{TEAM_REQUEST_STATUS_LABELS[row.status] ?? row.status}</Badge></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {(cursorStack.length > 0 || nextCursor) && (
        <div className="flex items-center justify-end gap-2 text-sm text-fg-muted">
          <span>Page {page}</span>
          <Button variant="secondary" size="sm" onClick={onPrevious} disabled={paging || cursorStack.length === 0}><ChevronLeft className="size-4" aria-hidden /> Previous</Button>
          <Button variant="secondary" size="sm" onClick={onNext} disabled={paging || !nextCursor}>Next <ChevronRight className="size-4" aria-hidden /></Button>
        </div>
      )}

      <RequestSheet id={openId} onClose={() => setOpenId(null)} onUpdated={onUpdated} />
    </div>
  )
}

function RequestSheet({ id, onClose, onUpdated }: { id: string | null; onClose: () => void; onUpdated: (d: TeamRequestDetail) => void }) {
  const [detail, setDetail] = useState<TeamRequestDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<TeamRequestStatus>('new')
  const [note, setNote] = useState('')
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [loading, startLoading] = useTransition()
  const [saving, startSaving] = useTransition()

  useEffect(() => {
    setDetail(null)
    setError(null)
    setNotice(null)
    if (!id) return
    startLoading(async () => {
      const result = await getTeamRequestAction(id)
      if (!result.ok) { setError(result.error); return }
      setDetail(result.data)
      setStatus(result.data.status)
      setNote(result.data.note ?? '')
    })
  }, [id])

  // Re-sanitised at render (defence in depth): the stored HTML was escaped when it was built.
  const safeHtml = useMemo(() => (detail ? sanitizeHtml(detail.detail_html, { relativeLinks: false, hrefSchemes: ['https', 'http', 'mailto'] }) : ''), [detail])
  const reply = detail ? replyHref(detail.reply_to ?? detail.email, detail.title) : null
  const dirty = detail ? status !== detail.status || (note.trim() || null) !== (detail.note ?? null) : false
  const facts = detail ? Object.entries(detail.facts ?? {}) : []
  const delivery = (detail?.delivery ?? {}) as Record<string, unknown>

  const save = () => {
    if (!detail) return
    startSaving(async () => {
      const result = await updateTeamRequestAction(detail.id, { status, note: note.trim() || null })
      if (!result.ok) { setNotice({ tone: 'danger', text: result.error }); return }
      setDetail(result.data)
      setStatus(result.data.status)
      setNote(result.data.note ?? '')
      setNotice({ tone: 'success', text: 'Saved' })
      onUpdated(result.data)
    })
  }

  return (
    <Sheet open={Boolean(id)} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent size="lg" title={detail?.title ?? (error ? 'Request' : 'Loading…')} description={detail ? `${TEAM_REQUEST_KIND_LABELS[detail.kind] ?? detail.kind} · ${formatDate(detail.created_at)}` : undefined}>
        <DialogBody className="space-y-5" data-testid="request-detail">
          {error && <InlineNotice tone="danger" message={error} />}
          {loading && !detail && <p className="text-fg-muted">Loading…</p>}
          {detail && (
            <>
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-fg-muted">Name</dt><dd>{detail.name ?? '—'}</dd>
                <dt className="text-fg-muted">Email</dt><dd>{detail.email ?? '—'}</dd>
                <dt className="text-fg-muted">Company</dt><dd>{detail.company ?? '—'}</dd>
                {detail.reply_to && detail.reply_to !== detail.email && (<><dt className="text-fg-muted">Reply to</dt><dd>{detail.reply_to}</dd></>)}
                {detail.url && (<><dt className="text-fg-muted">Link</dt><dd className="break-all">{/^https?:\/\//i.test(detail.url) ? <a href={detail.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{detail.url}</a> : detail.url}</dd></>)}
              </dl>

              <section>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">Message</h3>
                <div className="prose-sm space-y-2 rounded-md border border-border-subtle bg-subtle p-3 text-sm [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_a]:text-primary" dangerouslySetInnerHTML={{ __html: safeHtml }} data-testid="request-html" />
              </section>

              {facts.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">Details</h3>
                  <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                    {facts.map(([key, value]) => (<FactRow key={key} label={factLabel(key)} value={factValue(value)} />))}
                  </dl>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">Notification</h3>
                <div className="flex flex-wrap gap-2 text-sm">
                  {(['chirp', 'email'] as const).map((channel) => {
                    const state = String(delivery[channel] ?? 'pending')
                    return <Badge key={channel} tone={DELIVERY_TONE[state] ?? 'neutral'}>{channel === 'chirp' ? 'ChirpMe' : 'Team email'}: {DELIVERY_LABEL[state] ?? state}{channel === 'chirp' && delivery.chirp_status ? ` (${String(delivery.chirp_status)})` : ''}</Badge>
                  })}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-fg-muted">Triage</h3>
                <Select aria-label="Status" size="sm" wrapperClassName="w-48" value={status} options={STATUS_OPTIONS} onChange={(e) => setStatus(e.target.value as TeamRequestStatus)} data-testid="request-status" />
                <Textarea aria-label="Note" rows={3} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note for the team (who's on it, what was agreed…)" />
                {detail.handled_at && <p className="text-xs text-fg-muted">Closed {formatDate(detail.handled_at)}</p>}
                {notice && <InlineNotice tone={notice.tone} message={notice.text} />}
              </section>

              {detail.events.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">History</h3>
                  <ul className="space-y-1 text-xs text-fg-muted">
                    {detail.events.map((e) => (
                      <li key={e.id}>
                        {formatDate(e.occurred_at)} · {e.actor_email ?? 'Someone'}
                        {e.to_status ? ` marked it ${TEAM_REQUEST_STATUS_LABELS[e.to_status as TeamRequestStatus] ?? e.to_status}` : ''}
                        {e.note ? `${e.to_status ? ' and' : ''} noted “${e.note.length > 120 ? `${e.note.slice(0, 120)}…` : e.note}”` : !e.to_status ? ' cleared the note' : ''}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </DialogBody>
        {detail && (
          <DialogFooter>
            {reply && <Button asChild variant="secondary" size="sm"><a href={reply}><Mail className="size-4" aria-hidden /> Reply by email</a></Button>}
            <Button size="sm" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (<><dt className="text-fg-muted">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></>)
}
