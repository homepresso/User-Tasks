'use client'

/* eslint-disable @typescript-eslint/no-explicit-any -- moderation rows are untyped JSON from the service */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ArrowLeft, CheckCircle2, ExternalLink, FlaskConical, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InlineNotice } from '@/components/ui/inline-notice'
import {
  approveSubmissionAction, rejectSubmissionAction, resolveAbuseReportAction, setCommunityPackageListedAction, verifySubmissionAction,
} from '@/app/actions/gallery-moderation'
import { GALLERY_CATEGORIES } from '@/lib/gallery/types'

const muted = { color: 'var(--theme-muted-text)' }
const card = { backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }

function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'muted'; children: React.ReactNode }) {
  const colors = { ok: ['var(--status-done)', 'var(--status-done-bg)'], warn: ['var(--status-progress)', 'var(--status-progress-bg)'], bad: ['var(--status-blocked)', 'var(--status-blocked-bg)'], muted: ['var(--status-todo)', 'var(--status-todo-bg)'] }[tone]
  return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ color: colors[0], backgroundColor: colors[1] }}>{children}</span>
}

function Submission({ s, onDone }: { s: any; onDone: (message: string, ok: boolean) => void }) {
  const [reason, setReason] = useState('')
  const [pending, start] = useTransition()
  const router = useRouter()
  const summary = s.validation?.summary ?? {}
  const verification = s.verification ?? { status: 'not_run' }
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, label: string) => start(async () => {
    const result = await fn()
    onDone(result.ok ? label : result.error ?? 'Failed', result.ok)
    router.refresh()
  })
  const category = GALLERY_CATEGORIES.find((c) => c.id === s.category)?.title ?? s.category
  return (
    <article className="rounded-xl border p-5 space-y-4" style={card} data-testid={`submission-${s.slug}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{s.title} <span className="font-mono text-xs" style={muted}>{s.slug} · v{s.version}</span></h3>
          <p className="text-sm mt-1" style={muted}>{s.summary}</p>
          <p className="text-xs mt-1" style={muted}>{category} · by {s.author_name} ({s.submitter_email ?? 'unknown email'}) · {new Date(s.created_at).toLocaleString()}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {s.validation?.ok ? <Pill tone="ok"><ShieldCheck size={12} /> Validation passed</Pill> : <Pill tone="bad"><ShieldAlert size={12} /> Validation failed</Pill>}
          <Pill tone={verification.status === 'passed' ? 'ok' : verification.status === 'failed' ? 'bad' : 'muted'}><FlaskConical size={12} /> Run {verification.status.replace('_', ' ')}</Pill>
          {summary.native && <Pill tone="ok">No integrations needed</Pill>}
          <Pill tone={s.signed ? 'ok' : 'muted'}>{s.signed ? 'Signed' : 'Unsigned'}</Pill>
        </div>
      </div>
      <dl className="grid gap-2 text-xs sm:grid-cols-4">
        <div><dt style={muted}>Assets</dt><dd>{summary.asset_count ?? '—'} ({summary.workflows ?? 0} workflows)</dd></div>
        <div><dt style={muted}>Install asks for</dt><dd>{summary.requirement_count ?? 0} requirements</dd></div>
        <div><dt style={muted}>Starts</dt><dd>{summary.trigger ?? '—'}</dd></div>
        <div><dt style={muted}>Hosts</dt><dd className="break-all">{(summary.hosts ?? []).join(', ') || 'none'}</dd></div>
      </dl>
      {verification.detail && <p className="text-xs" style={muted}>Verification: {verification.detail}</p>}
      {!s.validation?.ok && (s.validation?.issues ?? []).length > 0 && (
        <ul className="list-disc pl-5 text-xs space-y-0.5" style={{ color: 'var(--status-blocked)' }}>{s.validation.issues.slice(0, 10).map((i: any) => <li key={`${i.path}-${i.message}`}>{i.path}: {i.message}</li>)}</ul>
      )}
      {(s.screenshots ?? []).length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {/* eslint-disable-next-line @next/next/no-img-element -- moderator preview of stored screenshots */}
          {s.screenshots.map((shot: any, i: number) => <img key={shot.path} src={`/api/gallery/submissions/${s.id}/screenshots/${i + 1}`} alt={`Screenshot ${i + 1}`} className="h-28 rounded border" style={{ borderColor: 'var(--theme-surface-border)' }} />)}
        </div>
      )}
      {s.status === 'pending' ? (
        <div className="grid gap-2">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={2000} placeholder="Reason (required to reject; optional note when approving)" className="w-full rounded-lg border px-3 py-2 text-sm bg-transparent" style={{ borderColor: 'var(--theme-surface-border)' }} data-testid="review-reason" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending || !s.validation?.ok} onClick={() => act(() => approveSubmissionAction(s.id, reason), `Approved ${s.title}: it is listed as Community`)} data-testid="approve"><CheckCircle2 size={14} /> Approve and list</Button>
            <Button size="sm" variant="outline" disabled={pending || !reason.trim()} onClick={() => act(() => rejectSubmissionAction(s.id, reason), `Rejected ${s.title}; the submitter was emailed`)} data-testid="reject"><XCircle size={14} /> Reject</Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => verifySubmissionAction(s.id), 'Verification finished')} data-testid="verify"><FlaskConical size={14} /> {pending ? 'Working…' : 'Run headless verification'}</Button>
          </div>
        </div>
      ) : (
        <p className="text-xs" style={muted}>{s.status} {s.reviewed_at ? `on ${new Date(s.reviewed_at).toLocaleString()}` : ''}{s.decision_reason ? ` — ${s.decision_reason}` : ''}</p>
      )}
    </article>
  )
}

export function GalleryReview({ enabled, pending, decided, reports, listed, headless }: { enabled: boolean; pending: any[]; decided: any[]; reports: any[]; listed: Array<{ id: string; slug: string; title: string; version: string; downloads: number; author: string }>; headless: string }) {
  const [notice, setNotice] = useState<{ message: string; ok: boolean } | null>(null)
  const [busy, start] = useTransition()
  const router = useRouter()
  const onDone = (message: string, ok: boolean) => setNotice({ message, ok })
  return (
    <div className="max-w-4xl space-y-6" data-testid="gallery-review">
      <div>
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm mb-2" style={muted}><ArrowLeft size={14} /> Settings</Link>
        <h1 className="text-2xl font-semibold">Gallery review</h1>
        <p className="text-sm mt-1" style={muted}>
          Community submissions waiting for a decision. Every package was validated on upload and is re-validated when you approve it; nothing is public until it is approved.
          Headless verification on this instance: <strong>{headless}</strong> (GALLERY_HEADLESS_VERIFY).{' '}
          <Link href="/gallery?source=community" target="_blank" className="inline-flex items-center gap-1 underline">Community gallery <ExternalLink size={12} /></Link>
        </p>
      </div>
      {!enabled && <InlineNotice tone="warning" message="The community gallery is not enabled on this instance (DEPLOYMENT_MODE=cloud or GALLERY_COMMUNITY=on)." />}
      {notice && <InlineNotice tone={notice.ok ? 'success' : 'error'} message={notice.message} />}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Waiting for review <span className="text-sm font-normal" style={muted}>{pending.length}</span></h2>
        {pending.length ? pending.map((s) => <Submission key={s.id} s={s} onDone={onDone} />) : <p className="text-sm" style={muted}>Nothing to review.</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Abuse reports <span className="text-sm font-normal" style={muted}>{reports.length}</span></h2>
        {reports.length ? reports.map((r) => (
          <div key={r.id} className="rounded-xl border p-4 text-sm flex flex-wrap items-center justify-between gap-3" style={card}>
            <div><p className="font-medium">{r.community_packages?.title ?? r.package_id} <span className="text-xs" style={muted}>{r.reason}{r.version ? ` · v${r.version}` : ''}</span></p>{r.details && <p className="text-xs mt-1" style={muted}>{r.details}</p>}</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => start(async () => { const res = await resolveAbuseReportAction(r.id, 'dismiss'); onDone(res.ok ? 'Report dismissed' : res.error ?? 'Failed', res.ok); router.refresh() })}>Dismiss</Button>
              <Button size="sm" disabled={busy} onClick={() => start(async () => { const res = await resolveAbuseReportAction(r.id, 'unlist'); onDone(res.ok ? 'Package unlisted' : res.error ?? 'Failed', res.ok); router.refresh() })}>Unlist package</Button>
            </div>
          </div>
        )) : <p className="text-sm" style={muted}>No open reports.</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Listed community packages <span className="text-sm font-normal" style={muted}>{listed.length}</span></h2>
        {listed.map((p) => (
          <div key={p.id} className="rounded-xl border p-3 text-sm flex items-center justify-between gap-3" style={card}>
            <span><Link href={`/gallery/community/${p.slug}`} target="_blank" className="font-medium underline">{p.title}</Link> <span className="text-xs" style={muted}>v{p.version} · {p.author} · {p.downloads} downloads</span></span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => start(async () => { const res = await setCommunityPackageListedAction(p.id, false); onDone(res.ok ? `${p.title} unlisted` : res.error ?? 'Failed', res.ok); router.refresh() })}>Unlist</Button>
          </div>
        ))}
      </section>

      {decided.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Recent decisions</h2>
          {decided.map((s) => <Submission key={s.id} s={s} onDone={onDone} />)}
        </section>
      )}
    </div>
  )
}
