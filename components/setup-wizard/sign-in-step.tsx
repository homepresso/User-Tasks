'use client'

import { useConfirm } from '@/components/ui/use-confirm'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { KeyRound, Pencil, Plus, ScanSearch, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { InlineNotice } from '@/components/ui/inline-notice'
import { setupWizardRemoveIdp, setupWizardSaveIdp, setupWizardTestIdp } from '@/app/actions/setup-wizard'
import { IDP_KINDS, idpRedirects, type IdpFormInput, type IdpKind, type IdpSummary } from '@/lib/setup/wizard-model'
import type { WizardPageData } from '@/lib/setup/wizard-data'
import { CopyBlock } from '@/components/settings/copy-block'
import { AllowHostButton } from '@/components/settings/allow-host-button'
import { StepFooter } from './setup-wizard'

/**
 * Step 4: sign-in with an identity provider (optional). Add Entra ID, AD FS,
 * Okta, Keycloak, Google or any OIDC / SAML provider: the form fills in the
 * preset, "Check connection" runs discovery (nothing saved), Save stores it
 * through the settings engine (switch log, rollback; the client secret
 * encrypted and never shown again), and "Test sign-in" gives the real
 * sign-in link to try in a private window.
 */

type Notice = { tone: 'success' | 'warning' | 'danger'; message: string; allowEntry?: string | null } | null

const FIELDS: Record<IdpKind, Array<{ key: keyof IdpFormInput; label: string; placeholder?: string; help?: string }>> = {
  entra: [
    { key: 'tenantId', label: 'Directory (tenant) id', placeholder: '00000000-0000-0000-0000-000000000000 or contoso.com', help: 'Entra admin center → Overview' },
    { key: 'clientId', label: 'Application (client) id', help: 'App registrations → your app → Overview' },
    { key: 'clientSecret', label: 'Client secret', help: 'App registrations → Certificates & secrets → New client secret (the Value)' },
  ],
  adfs: [{ key: 'metadataUrl', label: 'Federation metadata URL', placeholder: 'https://adfs.example.com/FederationMetadata/2007-06/FederationMetadata.xml' }],
  okta: [
    { key: 'domain', label: 'Okta domain', placeholder: 'acme.okta.com' },
    { key: 'clientId', label: 'Client id' },
    { key: 'clientSecret', label: 'Client secret' },
  ],
  keycloak: [
    { key: 'baseUrl', label: 'Keycloak address', placeholder: 'https://sso.example.com' },
    { key: 'realm', label: 'Realm', placeholder: 'usertasks' },
    { key: 'clientId', label: 'Client id' },
    { key: 'clientSecret', label: 'Client secret', help: 'Clients → your client → Credentials' },
  ],
  google: [
    { key: 'clientId', label: 'OAuth client id' },
    { key: 'clientSecret', label: 'OAuth client secret' },
  ],
  oidc: [
    { key: 'issuer', label: 'Issuer URL', placeholder: 'https://id.example.com', help: 'Its /.well-known/openid-configuration must load' },
    { key: 'clientId', label: 'Client id' },
    { key: 'clientSecret', label: 'Client secret' },
  ],
  saml: [{ key: 'metadataUrl', label: 'IdP metadata URL', placeholder: 'https://idp.example.com/metadata' }],
}

function blankForm(kind: IdpKind): IdpFormInput {
  return { kind, id: kind === 'oidc' || kind === 'saml' ? 'sso' : kind, name: IDP_KINDS.find((k) => k.id === kind)!.label.split(' (')[0] }
}

function IdpForm({ initial, existing, appUrl, orgSlug, onDone }: { initial: IdpFormInput; existing: IdpSummary | null; appUrl: string; orgSlug: string | null; onDone: (message: string) => void }) {
  const [form, setForm] = useState<IdpFormInput>({ defaultOrg: orgSlug ?? undefined, defaultRole: 'member', ...initial })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<Notice>(null)
  const [pending, start] = useTransition()
  const kind = IDP_KINDS.find((k) => k.id === form.kind)!
  const set = (key: keyof IdpFormInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const check = () => start(async () => {
    setNotice(null)
    const res = await setupWizardTestIdp(form)
    if (!res.ok) { setErrors(res.fieldErrors ?? {}); setNotice({ tone: 'danger', message: res.error, allowEntry: res.allowEntry }); return }
    setErrors({})
    setNotice({ tone: res.result.ok ? (res.result.warnings.length ? 'warning' : 'success') : 'danger', message: res.result.ok ? `Connection works: ${[res.result.detail, ...res.result.warnings].join(' ')}` : `The check failed: ${res.result.detail}` })
  })
  const save = () => start(async () => {
    setNotice(null)
    const res = await setupWizardSaveIdp(form)
    if (!res.ok) { setErrors(res.fieldErrors ?? {}); setNotice({ tone: 'danger', message: res.error, allowEntry: res.allowEntry }); return }
    onDone(`${form.name || form.id} saved. Try "Test sign-in" next.`)
  })

  return (
    <div className="space-y-4 rounded-lg border border-border p-4" aria-label="Identity provider">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Identity provider" error={errors.kind}>
          <Select id="idp-kind" value={form.kind} disabled={Boolean(existing)} onChange={(e) => setForm({ ...blankForm(e.target.value as IdpKind), defaultOrg: form.defaultOrg, defaultRole: form.defaultRole })} options={IDP_KINDS.map((k) => ({ value: k.id, label: k.label }))} />
        </Field>
        <Field label="Button label" description="On the sign-in page: Sign in with …" error={errors.name}>
          <Input id="idp-name" value={form.name ?? ''} onChange={set('name')} maxLength={60} />
        </Field>
        {FIELDS[form.kind].map((f) => (
          <Field key={f.key} label={f.label} error={errors[f.key]} description={f.key === 'clientSecret' && existing?.hasSecret ? 'Leave blank to keep the stored secret.' : f.help}>
            <Input
              id={`idp-${f.key}`}
              type={f.key === 'clientSecret' ? 'password' : 'text'}
              autoComplete={f.key === 'clientSecret' ? 'new-password' : 'off'}
              value={(form[f.key] as string | undefined) ?? ''}
              onChange={set(f.key)}
              placeholder={f.key === 'clientSecret' && existing?.hasSecret ? '••••••••' : f.placeholder}
              spellCheck={false}
            />
          </Field>
        ))}
        <Field label="Short id" description="Used in the sign-in address. Lowercase letters, digits, - and _." error={errors.id}>
          <Input id="idp-id" value={form.id} onChange={set('id')} disabled={Boolean(existing)} className="font-mono" spellCheck={false} />
        </Field>
        <Field label="Only these email domains" optional description="Comma separated, e.g. contoso.com. Recommended for Entra ID, AD FS and SAML." error={errors.allowedDomains}>
          <Input id="idp-domains" value={form.allowedDomains ?? ''} onChange={set('allowedDomains')} placeholder="example.com" />
        </Field>
        <Field label="New people join" optional description="Organisation sign-in name new accounts are added to." error={errors.defaultOrg}>
          <Input id="idp-org" value={form.defaultOrg ?? ''} onChange={set('defaultOrg')} className="font-mono" />
        </Field>
        <Field label="With the role" optional error={errors.defaultRole}>
          <Select id="idp-role" value={form.defaultRole ?? 'member'} onChange={set('defaultRole')} options={[{ value: 'viewer', label: 'Viewer' }, { value: 'member', label: 'Member' }, { value: 'manager', label: 'Manager' }, { value: 'admin', label: 'Admin' }]} />
        </Field>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-fg">Register this at {kind.label.split(' (')[0]}:</p>
        {idpRedirects(appUrl, { id: form.id || 'id', type: kind.type }).map((r) => (
          <div key={r.label}><p className="text-xs text-fg-muted">{r.label}</p><CopyBlock text={r.value} label={`Copy ${r.label}`} /></div>
        ))}
      </div>
      {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}
      {notice?.allowEntry && <AllowHostButton entry={notice.allowEntry} onAllowed={(message) => setNotice({ tone: 'success', message })} />}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" leadingIcon={<ScanSearch />} disabled={pending} onClick={check}>Check connection</Button>
        <Button leadingIcon={<KeyRound />} loading={pending} onClick={save}>Save identity provider</Button>
      </div>
    </div>
  )
}

export function SignInStep({ data }: { data: WizardPageData }) {
  const [confirm, confirmDialog] = useConfirm()
  const router = useRouter()
  const { signIn } = data
  const [editing, setEditing] = useState<{ form: IdpFormInput; existing: IdpSummary | null } | null>(signIn.idps.length ? null : signIn.refusal ? null : { form: blankForm('entra'), existing: null })
  const [message, setMessage] = useState<Notice>(null)
  const [pending, start] = useTransition()
  const remove = (idp: IdpSummary) => start(async () => {
    if (!(await confirm({ title: `Remove ${idp.name ?? idp.id}?`, description: 'People who sign in with it will need a password or another provider.', confirmLabel: 'Remove', destructive: true }))) return
    const res = await setupWizardRemoveIdp(idp.id)
    if (!res.ok) { setMessage({ tone: 'danger', message: res.error }); return }
    setMessage({ tone: 'success', message: `${idp.name ?? idp.id} removed (recorded in the switch log).` })
    router.refresh()
  })
  const testLink = (idp: IdpSummary) => `${data.appUrl}/auth/sso/${idp.id}/start?redirect=${encodeURIComponent('/home')}`

  return (
    <>
      {confirmDialog}
      <p className="text-sm text-fg-muted">
        Optional. People can always sign in with an email and password. Add your company&apos;s identity provider so they can use their work account
        instead: Microsoft Entra ID, AD FS, Okta, Keycloak, Google Workspace or any OpenID Connect or SAML provider.
      </p>
      {signIn.refusal && <InlineNotice tone="info" message={signIn.refusal} />}
      {message && <InlineNotice tone={message.tone} message={message.message} onDismiss={() => setMessage(null)} />}
      {signIn.idps.length > 0 && (
        <ul className="space-y-2">
          {signIn.idps.map((idp) => (
            <li key={idp.id} className="space-y-2 rounded-lg border border-border p-3" data-idp={idp.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-fg">{idp.name ?? idp.id}</span>
                <span className="text-xs text-fg-muted">{IDP_KINDS.find((k) => k.id === idp.kind)?.label} · {idp.where ?? idp.type.toUpperCase()}</span>
                <span className="ml-auto flex gap-1">
                  {!signIn.refusal && <Button size="sm" variant="ghost" leadingIcon={<Pencil />} onClick={() => setEditing({ form: idp.form as IdpFormInput, existing: idp })}>Edit</Button>}
                  {!signIn.refusal && <Button size="sm" variant="ghost" leadingIcon={<Trash2 />} disabled={pending} onClick={() => remove(idp)}>Remove</Button>}
                </span>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-fg-muted"><strong>Test sign-in:</strong> open this link in a private (incognito) window and sign in with a work account. Using it in this window signs you in as that account.</p>
                <CopyBlock text={testLink(idp)} label="Copy test sign-in link" />
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing
        ? <IdpForm key={editing.existing?.id ?? editing.form.kind} initial={editing.form} existing={editing.existing} appUrl={data.appUrl} orgSlug={data.organisation?.slug ?? null} onDone={(m) => { setEditing(null); setMessage({ tone: 'success', message: m }); router.refresh() }} />
        : !signIn.refusal && <Button variant="secondary" leadingIcon={<Plus />} onClick={() => setEditing({ form: blankForm('entra'), existing: null })}>Add an identity provider</Button>}
      <StepFooter step="sign-in" />
    </>
  )
}
