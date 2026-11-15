'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ArrowRight, BookOpen, CheckCircle2, CircleAlert, CircleDashed, CircleX, ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { InlineNotice } from '@/components/ui/inline-notice'
import { cn } from '@/lib/utils'
import { toUrlSlug } from '@/lib/utils/slug'
import { setupWizardOrganisation, setupWizardStep } from '@/app/actions/setup-wizard'
import type { CheckStatus } from '@/lib/admin/doctor'
import type { WizardPageData } from '@/lib/setup/wizard-data'
import { AreaActions } from '@/components/settings/switch-log-panel'
import { AreaActionNotes } from '@/components/settings/infrastructure-actions'
import { CopyBlock } from '@/components/settings/provider-switch-wizard'
import { StepFooter, stepHref } from './setup-wizard'

const HEALTH: Record<CheckStatus, { label: string; icon: React.ReactNode; cls: string }> = {
  ok: { label: 'Working', icon: <CheckCircle2 className="size-4" aria-hidden />, cls: 'text-success' },
  warn: { label: 'Needs a look', icon: <CircleAlert className="size-4" aria-hidden />, cls: 'text-warning' },
  fail: { label: 'Not working', icon: <CircleX className="size-4" aria-hidden />, cls: 'text-danger' },
  skip: { label: 'Not checked', icon: <CircleDashed className="size-4" aria-hidden />, cls: 'text-fg-muted' },
}

export function HealthBadge({ status }: { status: CheckStatus }) {
  const h = HEALTH[status]
  return <span className={cn('inline-flex items-center gap-1 text-xs font-medium', h.cls)} data-health={status}>{h.icon}{h.label}</span>
}

// ── Step 2: organisation ────────────────────────────────────────────────────

export function OrganisationStep({ data }: { data: WizardPageData }) {
  const router = useRouter()
  const org = data.organisation
  const [values, setValues] = useState({ name: org?.name ?? '', slug: org?.slug ?? '', contactName: org?.contactName ?? '', contactEmail: org?.contactEmail ?? data.viewerEmail })
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: k === 'slug' ? e.target.value.toLowerCase() : e.target.value }))
  const save = () => start(async () => {
    setError(null)
    const res = await setupWizardOrganisation(values)
    if (!res.ok) { setError(res.error); return }
    router.push(stepHref('services'))
  })
  const tone = data.address.status === 'ok' ? 'success' : data.address.status === 'warn' ? 'warning' : 'danger'
  return (
    <>
      {!org && <InlineNotice tone="warning" message="Your account isn't in an organisation yet, so there's nothing to name here. Skip this step." />}
      {org && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Organisation name">
            <Input id="wiz-org-name" value={values.name} onChange={(e) => { const name = e.target.value; setValues((v) => ({ ...v, name, slug: v.slug === toUrlSlug(v.name, 40) ? toUrlSlug(name, 40) : v.slug })) }} maxLength={120} />
          </Field>
          <Field label="Sign-in name" description="People type this as the Organisation when they sign in.">
            <Input id="wiz-org-slug" value={values.slug} onChange={set('slug')} className="font-mono" maxLength={50} spellCheck={false} autoCapitalize="none" />
          </Field>
          <Field label="Contact name" optional>
            <Input id="wiz-org-contact" value={values.contactName} onChange={set('contactName')} maxLength={120} />
          </Field>
          <Field label="Contact email" optional>
            <Input id="wiz-org-contact-email" type="email" value={values.contactEmail} onChange={set('contactEmail')} />
          </Field>
        </div>
      )}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-fg">Web address</h3>
        <InlineNotice tone={tone} title={data.address.configured ? `APP_URL: ${data.address.configured}` : 'APP_URL is not set'} message={<ul className="list-disc space-y-1 pl-4">{data.address.messages.map((m) => <li key={m}>{m}</li>)}</ul>} />
        <p className="text-xs text-fg-muted">APP_URL lives in the server&apos;s configuration file (the installer wrote it), because sign-in needs it before anything else loads. See <Link className="underline" href="/docs/self-hosting/setup-wizard">Setup wizard</Link> in the docs for how to change it.</p>
      </div>
      {error && <InlineNotice tone="danger" message={error} />}
      <StepFooter step="organisation" primary={org ? <Button disabled={pending || !values.name.trim() || !values.slug.trim()} loading={pending} trailingIcon={<ArrowRight />} onClick={save}>Save and continue</Button> : undefined} />
    </>
  )
}

// ── Step 3: services ────────────────────────────────────────────────────────

export function ServicesStep({ data }: { data: WizardPageData }) {
  const s = data.services
  if (!s) return <StepFooter step="services" />
  const counts = { ok: 0, warn: 0, fail: 0, skip: 0 } as Record<CheckStatus, number>
  for (const a of s.areas) counts[a.health]++
  const summary = counts.fail ? `${counts.fail} service${counts.fail === 1 ? ' is' : 's are'} not working.` : counts.warn ? `Everything works; ${counts.warn} could use a look.` : 'Everything is working.'
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className={cn('font-medium', counts.fail ? 'text-danger' : counts.warn ? 'text-warning' : 'text-success')} data-testid="services-summary">{summary}</span>
        <span className="text-xs text-fg-muted">Checked {new Date(s.checkedAt).toLocaleString()}</span>
        <Link href={stepHref('services', '&refresh=1')} className="inline-flex items-center gap-1 text-xs text-fg-muted underline"><RefreshCw className="size-3" aria-hidden /> Check again</Link>
      </div>
      {!s.gate.enabled && <InlineNotice tone="warning" message={s.gate.reason ?? 'Changes from this page are turned off on this server.'} />}
      <p className="text-sm text-fg-muted">
        Each service below can be changed in place. <strong>Change…</strong> picks another provider (with a connection test and a review before anything is saved);
        <strong> Settings</strong> edits the current one. Passwords and keys you type are stored encrypted and never shown again.
      </p>
      <ul className="grid gap-2">
        {s.areas.map((a) => (
          <li key={a.area} className="rounded-lg border border-border p-3" aria-label={a.label} data-area={a.area}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-fg">{a.label}</span>
              <span className="text-sm text-fg-muted">{a.providerLabel}</span>
              {a.onSupabase && <span className="rounded-full bg-subtle px-2 py-0.5 text-xs text-fg-muted">Supabase</span>}
              <span className="ml-auto flex items-center gap-2">
                <HealthBadge status={a.health} />
                <AreaActions area={a.area} label={a.label} actions={a.actions} />
              </span>
            </div>
            <p className="mt-0.5 text-xs text-fg-muted">{a.what}{a.source === 'env' ? ' Set in the server environment.' : ''}</p>
            <AreaActionNotes area={a.area} actions={a.actions} />
            {a.checks.some((c) => c.status === 'fail' || c.status === 'warn') && (
              <ul className="mt-2 space-y-0.5 text-xs">
                {a.checks.filter((c) => c.status === 'fail' || c.status === 'warn').map((c) => (
                  <li key={c.name} className={c.status === 'fail' ? 'text-danger' : 'text-warning'}>{c.name}: {c.detail}</li>
                ))}
              </ul>
            )}
            {a.checks.length > 0 && (
              <details className="mt-1 text-xs text-fg-muted">
                <summary className="cursor-pointer">All checks</summary>
                <ul className="mt-1 space-y-0.5">{a.checks.map((c) => <li key={c.name}><span className="font-medium">{c.status.toUpperCase()}</span> {c.name}: {c.detail}</li>)}</ul>
              </details>
            )}
          </li>
        ))}
      </ul>
      {s.moves.length > 0 && <SupabaseMoves moves={s.moves} />}
      <StepFooter step="services" />
    </>
  )
}

function SupabaseMoves({ moves }: { moves: NonNullable<WizardPageData['services']>['moves'] }) {
  return (
    <section aria-labelledby="move-off-supabase" className="space-y-3 rounded-lg border border-border bg-subtle p-4">
      <h3 id="move-off-supabase" className="text-sm font-semibold text-fg">Moving off Supabase (optional)</h3>
      <p className="text-xs text-fg-muted">
        You can move one service at a time, in this order. Every move copies your data and keeps the original, takes a backup first, and can be
        rolled back (Settings → Infrastructure → Switch log, or <code>usertasks-admin rollback &lt;switch id&gt;</code>). Nothing is deleted in Supabase.
      </p>
      <ol className="space-y-3">
        {moves.map((m, i) => (
          <li key={m.area} className="space-y-1 text-sm" data-move={m.area}>
            <p><span className="font-medium">{i + 1}. {m.label} → {m.target}.</span> <span className="text-fg-muted">{m.detail}</span></p>
            {m.how === 'page'
              ? <p className="text-xs text-fg-muted">Use <strong>Change…</strong> on the {m.label} card above: it tests the new provider, shows the plan and asks you to confirm before it copies anything.</p>
              : (
                <div className="space-y-1">
                  <p className="text-xs text-fg-muted">Run these on the server where UserTasks is installed (the first command only checks and shows the plan):</p>
                  {m.commands.map((c) => <CopyBlock key={c} text={c} />)}
                </div>
              )}
          </li>
        ))}
      </ol>
      <Link href="/docs/self-hosting/switching-providers" className="inline-flex items-center gap-1 text-xs underline"><BookOpen className="size-3" aria-hidden /> Switching providers: the full guide</Link>
    </section>
  )
}

// ── Step 7: done ────────────────────────────────────────────────────────────

export function DoneStep({ data }: { data: WizardPageData }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const skipped = Object.entries(data.progress.steps).filter(([, v]) => v === 'skipped').map(([k]) => k)
  const finish = () => start(async () => {
    await setupWizardStep('done', 'done')
    router.push('/home')
  })
  const links = [
    { href: '/home', label: 'Go to your home page' },
    { href: '/settings/infrastructure', label: 'Settings → Infrastructure: services, health and the switch log' },
    { href: '/team', label: 'Your team' },
    { href: '/docs/self-hosting', label: 'Self-hosting guide: backups and upgrades' },
  ]
  return (
    <>
      {data.services && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-fg">Health</h3>
          <ul className="grid gap-1 sm:grid-cols-3">
            {data.services.areas.map((a) => (
              <li key={a.area} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
                <span>{a.label}</span><HealthBadge status={a.health} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {skipped.length > 0 && (
        <InlineNotice tone="info" message={<>You skipped: {skipped.map((id, i) => <span key={id}>{i ? ', ' : ''}<Link className="underline" href={stepHref(id as never)}>{id.replace('-', ' ')}</Link></span>)}. Come back to Settings → Setup wizard whenever you like.</>} />
      )}
      <ul className="space-y-1 text-sm">
        {links.map((l) => <li key={l.href}><Link href={l.href} className="inline-flex items-center gap-1 text-primary-text hover:underline"><ExternalLink className="size-3.5" aria-hidden />{l.label}</Link></li>)}
      </ul>
      <p className="text-sm text-fg-muted">Before you rely on it: set up backups of the database{data.services?.areas.find((a) => a.area === 'storage')?.provider === 'local' ? ' and the files folder' : ''}, and keep the configuration file safe (it holds the encryption key).</p>
      <StepFooter step="done" canSkip={false} primary={<Button loading={pending} onClick={finish}>Finish</Button>} />
    </>
  )
}
