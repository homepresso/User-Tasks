'use client'

import { useState, useTransition } from 'react'
import { UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { InlineNotice } from '@/components/ui/inline-notice'
import { setupWizardInvite, type InviteOutcome } from '@/app/actions/setup-wizard'
import type { WizardPageData } from '@/lib/setup/wizard-data'
import { StepFooter } from './setup-wizard'

/** Step 6: the first invitations (the same invitations as Team → Invite). */
export function TeamStep({ data }: { data: WizardPageData }) {
  const [emails, setEmails] = useState('')
  const [role, setRole] = useState('member')
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<InviteOutcome[] | null>(null)
  const [pending, start] = useTransition()
  const send = () => start(async () => {
    setError(null)
    const res = await setupWizardInvite({ emails, role })
    if (!res.ok) { setError(res.error); return }
    setResults(res.results)
    if (res.invalid.length) setError(`Skipped (not email addresses): ${res.invalid.join(', ')}`)
    setEmails('')
  })
  return (
    <>
      <p className="text-sm text-fg-muted">Each person gets an email with a link to create their account{data.signIn.idps.length ? ' (or to sign in with your identity provider)' : ''}. Invitations last 7 days and can be resent from Team.</p>
      {data.email.provider === 'console' && <InlineNotice tone="warning" message="Email isn't set up yet, so invitations are only written to the server log. Set up email first (the previous step) if people should receive them." />}
      {data.team.pending ? <p className="text-xs text-fg-muted">{data.team.pending} invitation{data.team.pending === 1 ? ' is' : 's are'} waiting to be accepted.</p> : null}
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <Field label="Email addresses" description="One per line, or separated by commas.">
          <Textarea id="team-emails" rows={4} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder={'ada@example.com\ngrace@example.com'} />
        </Field>
        <Field label="Role">
          <Select id="team-role" value={role} onChange={(e) => setRole(e.target.value)} options={[{ value: 'viewer', label: 'Viewer' }, { value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]} />
        </Field>
      </div>
      {error && <InlineNotice tone="warning" message={error} />}
      {results && (
        <ul className="space-y-1 text-sm" aria-label="Invitations">
          {results.map((r) => (
            <li key={r.email} className={r.ok ? (r.emailSent ? 'text-success' : 'text-warning') : 'text-danger'}>
              {r.email}: {r.ok ? (r.emailSent ? 'invited' : `invited, but the email wasn't sent (${r.error}); resend it from Team`) : r.error}
            </li>
          ))}
        </ul>
      )}
      <Button leadingIcon={<UserPlus />} loading={pending} disabled={!emails.trim()} onClick={send}>Send invitations</Button>
      <StepFooter step="team" />
    </>
  )
}
