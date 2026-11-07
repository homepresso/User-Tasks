'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Gavel } from 'lucide-react'
import { serverQuery } from '@/lib/server-read'
import { usePermissions } from '@/lib/permissions-context'
import { getFormRetentionStatus, type RetentionPolicy } from '@/lib/retention-policies'
import { RetentionPolicyAssignment } from '@/components/governance/retention-policy-assignment'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { setFormLegalHold } from '@/app/actions/form-governance'
import type { FormGovernance } from '@/lib/services/form-governance'

/**
 * Retention and legal hold in a form's Details (like a data table's Access
 * tab): the retention policy that governs the form's submissions, its status,
 * the submission count and the legal hold. People who manage governance
 * (team.change_roles) can change them; everyone else with the form sees them.
 */
export function FormGovernanceSection({ formId, formName }: { formId: string; formName: string }) {
  const { can } = usePermissions()
  const canManage = can('team.change_roles')
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  const { data: gov } = useQuery({
    queryKey: ['governance-form', formId],
    queryFn: async () => (await serverQuery('governance.form', { formId })) as FormGovernance,
  })

  const status = getFormRetentionStatus({
    policy: (gov?.retention_policy ?? null) as RetentionPolicy | null,
    appliedAt: gov?.retention_applied_at ?? null,
    createdAt: gov?.created_at ?? null,
  })
  const purges = gov?.retention_policy && ['purge_on', 'purge_on_exact_date'].includes(String(gov.retention_policy.policy_mode))

  async function toggleHold(hold: boolean) {
    setBusy(true)
    setNotice(null)
    const result = await setFormLegalHold(formId, { hold, reason: hold ? reason : null })
    setBusy(false)
    if (!result.ok) { setNotice({ tone: 'error', message: result.error }); return }
    setReason('')
    setNotice({ tone: 'success', message: hold ? 'Legal hold placed' : 'Legal hold released' })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['governance-form', formId] }),
      queryClient.invalidateQueries({ queryKey: ['governance-form-retention'] }),
    ])
  }

  return (
    <section className="mt-4 space-y-3 border-t pt-4 border-border" aria-label="Retention" data-testid="form-retention">
      <div className="flex items-center gap-2">
        <Archive className="text-primary-text" size={15} aria-hidden />
        <h3 className="text-sm font-semibold">Retention</h3>
        {gov?.legal_hold && (
          <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-2xs font-medium text-amber-800" data-testid="form-legal-hold-badge">
            <Gavel size={9} aria-hidden /> Legal hold
          </span>
        )}
      </div>
      {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}
      <p className="text-xs text-fg-muted">
        {gov ? `${gov.submission_count} submission${gov.submission_count === 1 ? '' : 's'} stored. ` : ''}
        Status: <strong data-testid="form-retention-status">{status.label}</strong>
        {gov?.legal_hold ? ' — on hold, nothing is purged.' : purges ? ' — submissions older than the policy are purged daily, with their files.' : ''}
        {gov && !gov.retention_policy && gov.submission_retention_days ? ` Keep submissions: ${gov.submission_retention_days} days.` : ''}
      </p>
      {canManage ? (
        <>
          {gov && (
            <RetentionPolicyAssignment
              key={gov.retention_policy_id ?? 'none'}
              targetType="form"
              targetId={formId}
              currentPolicyId={gov.retention_policy_id}
              allowedScope="forms"
              label={formName}
              title="Retention policy"
              help="The policy governs this form's submissions: purge policies delete them (and their uploaded files) when they come due, review policies open a review. It replaces the form's own Keep submissions setting. The audit trail is kept."
            />
          )}
          <div className="rounded-lg border p-2.5 space-y-2 border-border">
            <p className="text-xs font-medium">Legal hold</p>
            <p className="text-2xs text-fg-muted">
              {gov?.legal_hold
                ? `Held since ${gov.legal_hold_at ? new Date(gov.legal_hold_at).toLocaleDateString() : '—'}${gov.legal_hold_reason ? `: ${gov.legal_hold_reason}` : ''}. No submission or file is purged and the form can't be deleted until the hold is released.`
                : 'Keep every submission and file of this form, whatever its retention policy, and block deleting the form.'}
            </p>
            {gov?.legal_hold ? (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => toggleHold(false)} data-testid="form-legal-hold-release">Release hold</Button>
            ) : (
              <div className="flex gap-2">
                <Input aria-label="Legal hold reason" placeholder="Reason (optional)" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button type="button" size="sm" variant="outline" disabled={busy || !gov} onClick={() => toggleHold(true)} data-testid="form-legal-hold-place">Place hold</Button>
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="text-2xs text-fg-muted">
          {gov?.retention_policy ? `Policy: ${gov.retention_policy.name}. ` : ''}People who manage roles change retention and legal holds (Settings → Governance).
        </p>
      )}
    </section>
  )
}
