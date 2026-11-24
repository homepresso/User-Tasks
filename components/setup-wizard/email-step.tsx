'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Mail, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { InlineNotice } from '@/components/ui/inline-notice'
import { setupWizardSaveEmail, setupWizardSendTestEmail } from '@/app/actions/setup-wizard'
import { EMAIL_CHOICES, type EmailChoiceId } from '@/lib/setup/wizard-model'
import type { WizardPageData } from '@/lib/setup/wizard-data'
import { AllowHostButton } from '@/components/settings/allow-host-button'
import { StepFooter } from './setup-wizard'
import { FREE_EMAIL_PROVIDERS } from '@/lib/infrastructure/addon'

/**
 * Step 5: how email is sent, and a real test message. Saving goes through
 * the provider engine (a settings change, or a config-only email switch,
 * recorded in the switch log); passwords are write-only.
 */

type Notice = { tone: 'success' | 'warning' | 'danger'; message: string; allowEntry?: string | null } | null

const FIELDS: Record<string, Array<{ option: string; label: string; secret?: boolean; placeholder?: string; help?: string; choices?: string[] }>> = {
  smtp: [
    { option: 'smtp_host', label: 'Mail server', placeholder: 'mail.example.com' },
    { option: 'smtp_port', label: 'Port', placeholder: '587' },
    { option: 'smtp_starttls', label: 'Encryption (STARTTLS)', choices: ['required', 'opportunistic', 'off'] },
    { option: 'smtp_user', label: 'User name', help: 'Usually the mailbox address. Leave blank for a relay that needs no sign-in.' },
    { option: 'smtp_password', label: 'Password', secret: true, help: 'Microsoft 365 with multi-factor sign-in: an app password, or allow SMTP AUTH for this mailbox.' },
  ],
  resend: [{ option: 'resend_api_key', label: 'Resend API key', secret: true }],
  azure_communication: [
    { option: 'acs_connection_string', label: 'Connection string', secret: true, help: 'Or leave blank and give the endpoint (managed identity).' },
    { option: 'acs_endpoint', label: 'Endpoint', placeholder: 'https://<resource>.communication.azure.com' },
  ],
  ses: [
    { option: 'ses_region', label: 'Region', placeholder: 'us-east-1' },
    { option: 'ses_access_key_id', label: 'Access key id', help: 'Blank: the server\'s AWS role.' },
    { option: 'ses_secret_access_key', label: 'Secret access key', secret: true },
  ],
  console: [],
}

function choiceFor(provider: string, values: Record<string, string>): EmailChoiceId {
  if (provider === 'smtp') return values.smtp_host === 'smtp.office365.com' ? 'm365' : 'smtp'
  return (EMAIL_CHOICES.find((c) => c.provider === provider)?.id ?? 'smtp') as EmailChoiceId
}

export function EmailStep({ data }: { data: WizardPageData }) {
  const router = useRouter()
  const { email } = data
  const [choice, setChoice] = useState<EmailChoiceId>(choiceFor(email.provider, email.values))
  const option = EMAIL_CHOICES.find((c) => c.id === choice)!
  const same = option.provider === email.provider
  const initial = (c: (typeof EMAIL_CHOICES)[number]) => ({ from: email.from ?? '', ...(c.provider === email.provider ? email.values : {}), ...Object.fromEntries(Object.entries(c.defaults).filter(([k]) => c.provider !== email.provider || !email.values[k])) })
  const [values, setValues] = useState<Record<string, string>>(initial(option))
  const [to, setTo] = useState(data.viewerEmail)
  const [notice, setNotice] = useState<Notice>(null)
  const [testNotice, setTestNotice] = useState<Notice>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, start] = useTransition()
  const pinnedProvider = email.source === 'env'

  const pick = (id: EmailChoiceId) => {
    setChoice(id)
    setValues(initial(EMAIL_CHOICES.find((c) => c.id === id)!))
    setErrors({})
    setNotice(null)
  }
  const save = () => start(async () => {
    setNotice(null)
    const res = await setupWizardSaveEmail({ choice, values })
    if (!res.ok) { setErrors(res.fieldErrors ?? {}); setNotice({ tone: 'danger', message: res.error, allowEntry: res.allowEntry }); return }
    setErrors({})
    setNotice({ tone: 'success', message: res.switched ? `Email now goes through ${option.label}. Send a test below.` : 'Email settings saved. Send a test below.' })
    router.refresh()
  })
  const sendTest = () => start(async () => {
    setTestNotice(null)
    const res = await setupWizardSendTestEmail(to)
    if (!res.ok) { setTestNotice({ tone: 'danger', message: res.error, allowEntry: res.allowEntry }); return }
    const failed = res.checks.find((c) => c.status === 'fail')
    const sent = res.checks.find((c) => c.name === 'test send')
    setTestNotice(failed ? { tone: 'danger', message: `Not sent: ${failed.detail}` } : { tone: 'success', message: sent ? `Test message ${sent.detail}. Check the inbox (and the spam folder).` : 'Sent.' })
  })

  const fields = FIELDS[option.provider] ?? []
  return (
    <>
      <p className="text-sm text-fg-muted">
        UserTasks emails invitations, task notifications and password resets. Now: <strong>{EMAIL_CHOICES.find((c) => c.id === choiceFor(email.provider, email.values))?.label ?? email.provider}</strong>
        {email.from ? <> from <span className="font-mono">{email.from}</span></> : null}.
      </p>
      {email.provider === 'console' && <InlineNotice tone="warning" message="Emails are only written to the server log at the moment: nobody receives invitations or password resets until you choose a real way to send them." />}
      {pinnedProvider && <InlineNotice tone="info" message="The email provider is set by EMAIL_PROVIDER in the server environment, so it can't be changed here. You can still send a test." />}
      {!pinnedProvider && (
        <div className="space-y-4">
          <Field label="Send email with">
            <Select id="email-choice" value={choice} onChange={(e) => pick(e.target.value as EmailChoiceId)} options={EMAIL_CHOICES.map((c) => ({ value: c.id, label: FREE_EMAIL_PROVIDERS.includes(c.provider) ? c.label : `${c.label} (Infrastructure add-on)` }))} />
          </Field>
          {!same && !FREE_EMAIL_PROVIDERS.includes(option.provider) && (
            <InlineNotice tone="info" message={<>Sending through the {option.label} API is part of the Infrastructure add-on (a paid extension); SMTP (including Microsoft 365 and Exchange), Resend and log-only are free. <Link href="/settings/infrastructure#infrastructure-addon" className="underline">About the add-on</Link></>} />
          )}
          {option.provider !== 'console' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="From address" description='Like UserTasks <tasks@example.com>. Microsoft 365: the mailbox you sign in with (or one it may send as).' error={errors.from}>
                <Input id="email-from" value={values.from ?? ''} onChange={(e) => setValues((v) => ({ ...v, from: e.target.value }))} disabled={email.pinned.includes('from')} />
              </Field>
              {fields.map((f) => (
                <Field key={f.option} label={f.label} error={errors[f.option]} description={f.secret && same && email.secretsSet.includes(f.option) ? 'Saved. Leave blank to keep it.' : email.pinned.includes(f.option) ? 'Set in the server environment.' : f.help}>
                  {f.choices
                    ? <Select id={`email-${f.option}`} value={values[f.option] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.option]: e.target.value }))} options={f.choices.map((c) => ({ value: c, label: c }))} placeholder="Default" disabled={email.pinned.includes(f.option)} />
                    : <Input id={`email-${f.option}`} type={f.secret ? 'password' : 'text'} autoComplete={f.secret ? 'new-password' : 'off'} value={values[f.option] ?? ''} placeholder={f.secret && same && email.secretsSet.includes(f.option) ? '••••••••' : f.placeholder} onChange={(e) => setValues((v) => ({ ...v, [f.option]: e.target.value }))} disabled={email.pinned.includes(f.option)} />}
                </Field>
              ))}
            </div>
          )}
          {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}
          {notice?.allowEntry && <AllowHostButton entry={notice.allowEntry} onAllowed={(m) => setNotice({ tone: 'success', message: m.replace('Run the test again.', 'Save again.') })} />}
          <Button leadingIcon={<Mail />} loading={pending} onClick={save}>Save email settings</Button>
        </div>
      )}
      <div className="space-y-2 border-t border-border-subtle pt-4">
        <h3 className="text-sm font-semibold text-fg">Send a test</h3>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="To" className="min-w-[16rem] flex-1">
            <Input id="email-test-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Button variant="secondary" leadingIcon={<Send />} disabled={pending || !to.trim()} onClick={sendTest}>Send test email</Button>
        </div>
        {testNotice && <InlineNotice tone={testNotice.tone} message={testNotice.message} onDismiss={() => setTestNotice(null)} />}
        {testNotice?.allowEntry && <AllowHostButton entry={testNotice.allowEntry} onAllowed={(m) => setTestNotice({ tone: 'success', message: m })} />}
      </div>
      <StepFooter step="email" />
    </>
  )
}
