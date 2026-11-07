'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Gavel, ChevronRight } from 'lucide-react'
import { serverQuery } from '@/lib/server-read'
import { getFormRetentionStatus, type RetentionPolicy } from '@/lib/retention-policies'
import { OBJECT_PERMISSION_META } from '@/lib/object-permission-types'
import type { FormGovernance } from '@/lib/services/form-governance'
import { RetentionPolicyAssignment } from './retention-policy-assignment'

type Row = Omit<FormGovernance, 'submission_count'>

/**
 * Settings → Governance → Retention: every reusable form with the retention
 * policy that governs its submissions, its status and legal hold, and a
 * picker to assign or change the policy (the hold is set in the form's
 * Details).
 */
export function FormRetentionOverview() {
  const [editing, setEditing] = useState<string | null>(null)
  const { data: forms = [], isLoading } = useQuery({
    queryKey: ['governance-form-retention'],
    queryFn: async () => (await serverQuery('governance.formRetention')) as Row[],
  })

  return (
    <section className="space-y-3" aria-labelledby="form-retention-heading" data-testid="governance-form-retention">
      <div>
        <h3 id="form-retention-heading" className="flex items-center gap-2 text-lg font-semibold text-fg">
          <ClipboardList size={16} aria-hidden /> Forms and submissions
        </h3>
        <p className="mt-1 text-xs text-fg-muted">
          A form&apos;s retention policy governs its submissions: purge policies delete them, with their uploaded files, as they come due (the audit trail is kept); review policies open a review of the form. A form on legal hold keeps everything and can&apos;t be deleted.
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="grid text-2xs font-semibold " style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) 90px', backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
          <div className="px-3 py-2">Form</div>
          <div className="px-2 py-2">Policy</div>
          <div className="px-2 py-2">Status</div>
          <div className="px-2 py-2" />
        </div>
        {isLoading ? (
          <p className="px-4 py-6 text-center text-xs text-fg-muted">Loading…</p>
        ) : forms.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-fg-muted">No forms yet</p>
        ) : forms.map((form) => {
          const status = getFormRetentionStatus({ policy: (form.retention_policy ?? null) as RetentionPolicy | null, appliedAt: form.retention_applied_at, createdAt: form.created_at })
          return (
            <div key={form.id} className="border-t text-xs border-border" data-testid="governance-form-row">
              <div className="grid items-center" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) 90px' }}>
                <div className="flex min-w-0 items-center gap-2 px-3 py-2.5">
                  <span className="truncate font-medium text-fg">{form.name}</span>
                  {form.legal_hold && (
                    <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-warning-wash px-1.5 py-0.5 text-2xs font-medium text-warning" title={form.legal_hold_reason ?? undefined}>
                      <Gavel size={8} aria-hidden /> Legal hold
                    </span>
                  )}
                  <Link href={OBJECT_PERMISSION_META.form.href(form.id)} className="shrink-0 hover:underline text-primary-text" aria-label={`Open details of ${form.name}`}>
                    <ChevronRight size={12} />
                  </Link>
                </div>
                <div className="truncate px-2 py-2.5 text-fg-muted">
                  {form.retention_policy?.name ?? (form.submission_retention_days ? `Keep submissions ${form.submission_retention_days} days` : 'None')}
                </div>
                <div className="truncate px-2 py-2.5 text-fg-muted">{form.legal_hold ? 'On hold — nothing purged' : status.label}</div>
                <div className="px-2 py-2.5 text-right">
                  <button type="button" className="text-2xs font-medium hover:underline text-primary-text"
                    onClick={() => setEditing(editing === form.id ? null : form.id)} aria-expanded={editing === form.id} aria-label={`Change the retention policy of ${form.name}`}>
                    {editing === form.id ? 'Close' : 'Change'}
                  </button>
                </div>
              </div>
              {editing === form.id && (
                <div className="px-3 pb-3">
                  <RetentionPolicyAssignment targetType="form" targetId={form.id} currentPolicyId={form.retention_policy_id} allowedScope="forms" compact label={form.name} onSaved={() => setEditing(null)} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
