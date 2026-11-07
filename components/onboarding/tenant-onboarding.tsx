'use client'

import { useState } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Building2, User, Globe, Check } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { InlineNotice } from '@/components/ui/inline-notice'
import { cn } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { toUrlSlug } from '@/lib/utils/slug'

interface TenantOnboardingProps {
  tenantId: string
  tenantName: string
  tenantSlug: string | null
}

const INDUSTRIES = [
  'Technology', 'Financial Services', 'Healthcare', 'Education', 'Manufacturing',
  'Retail & E-commerce', 'Media & Entertainment', 'Government', 'Non-profit',
  'Professional Services', 'Real Estate', 'Energy & Utilities', 'Transportation',
  'Agriculture', 'Hospitality', 'Other',
]

const STEPS = ['Organisation', 'Primary contact', 'Review'] as const

const SIZES = [
  { value: '1-10', label: '1-10 employees' },
  { value: '11-50', label: '11-50 employees' },
  { value: '51-200', label: '51-200 employees' },
  { value: '201-1000', label: '201-1,000 employees' },
  { value: '1001+', label: '1,000+ employees' },
]

export function TenantOnboarding({ tenantId, tenantName, tenantSlug }: TenantOnboardingProps) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  // Synchronous guard: two clicks in one frame both see saving === false.
  const submitGuard = useSubmitGuard()
  const [error, setError] = useState<string | null>(null)
  const [slugError, setSlugError] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: tenantName ?? '',
    slug: tenantSlug ?? toUrlSlug(tenantName ?? '', 40),
    contactName: '',
    contactEmail: '',
    industry: '',
    companySize: '',
  })

  function update(patch: Partial<typeof form>) {
    setForm(prev => ({ ...prev, ...patch }))
    if (patch.name && !tenantSlug) {
      setForm(prev => ({ ...prev, slug: toUrlSlug(patch.name!, 40) }))
    }
  }

  async function checkSlug() {
    if (!form.slug || form.slug.length < 3) { setSlugError('Slug must be at least 3 characters'); return false }
    const resp = await fetch(`/api/tenants/check-slug?slug=${form.slug}&tenant_id=${tenantId}`)
    const data = await resp.json()
    if (!data.available) { setSlugError('This URL is already taken. Try another.'); return false }
    setSlugError(null)
    return true
  }

  async function handleSubmit() {
    await submitGuard.run(async () => {
      setSaving(true); setError(null)
      try {
        const slugOk = await checkSlug()
        if (!slugOk) { setSaving(false); return }

        const resp = await fetch('/api/tenants/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenant_id: tenantId,
            name: form.name,
            slug: form.slug,
            contact_name: form.contactName,
            contact_email: form.contactEmail,
            industry: form.industry,
            company_size: form.companySize,
          }),
        })
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: 'Failed' }))
          throw new Error(err.error ?? 'Failed to save')
        }
        router.refresh()
      } catch (e: any) {
        setError(e.message)
      }
      setSaving(false)
    })
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card padding="none" className="w-full max-w-lg">
        <div className="px-8 pt-8 text-center">
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg border border-border bg-subtle text-fg-muted">
            <Building2 className="size-5" aria-hidden />
          </div>
          <h1 className="text-title text-fg">Set up your workspace</h1>
          <p className="mt-1 text-sm text-fg-muted">Complete your organisation profile to get started.</p>
        </div>

        {/* Step indicator */}
        <ol className="mt-6 flex items-center justify-center gap-2" aria-label="Setup steps">
          {STEPS.map((label, i) => {
            const s = i + 1
            return (
              <li key={label} className="flex items-center gap-2" aria-current={s === step ? 'step' : undefined}>
                <span className={cn(
                  'num flex size-7 items-center justify-center rounded-full text-xs font-semibold',
                  s < step ? 'bg-primary text-primary-fg' : s === step ? 'bg-primary-wash text-primary-text ring-1 ring-primary' : 'bg-muted text-fg-muted',
                )}>
                  {s < step ? <Check className="size-3.5" aria-hidden /> : s}
                </span>
                <span className="sr-only">{label}{s < step ? ', done' : ''}</span>
                {s < STEPS.length && <span aria-hidden className={cn('h-px w-8', s < step ? 'bg-primary' : 'bg-border')} />}
              </li>
            )
          })}
        </ol>

        <div className="p-8">
          {/* Step 1: Organisation */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="flex items-center gap-2 text-base font-semibold text-fg"><Building2 className="size-4 text-fg-muted" aria-hidden /> Organisation</h2>
              <Field label="Organisation name">
                <Input value={form.name} onChange={e => update({ name: e.target.value })} placeholder="Acme Corp" />
              </Field>
              <Field label="URL identifier" description="Unique; used in public URLs." error={slugError}>
                <Input value={form.slug} onChange={e => { setForm(prev => ({ ...prev, slug: toUrlSlug(e.target.value, 40) })); setSlugError(null) }}
                  placeholder="acme-corp" className="font-mono" leading={<span className="text-xs">/</span>} />
              </Field>
              <Field label="Industry" optional>
                <Select value={form.industry} onChange={e => update({ industry: e.target.value })} placeholder="Select industry…"
                  options={INDUSTRIES.map(i => ({ value: i, label: i }))} />
              </Field>
              <fieldset>
                <legend className="mb-1.5 text-ui font-medium text-fg">Company size <span className="ml-1.5 font-normal text-fg-muted">Optional</span></legend>
                <SegmentedControl aria-label="Company size" value={form.companySize} onValueChange={(v) => update({ companySize: v })}
                  className="w-full flex-wrap" options={SIZES.map(s => ({ value: s.value, text: s.label }))} />
              </fieldset>
              <Button className="w-full" onClick={() => setStep(2)} disabled={!form.name.trim() || !form.slug.trim()}>
                Continue
              </Button>
            </div>
          )}

          {/* Step 2: Contact */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="flex items-center gap-2 text-base font-semibold text-fg"><User className="size-4 text-fg-muted" aria-hidden /> Primary contact</h2>
              <Field label="Your name">
                <Input value={form.contactName} onChange={e => update({ contactName: e.target.value })} placeholder="Jane Smith" autoComplete="name" />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.contactEmail} onChange={e => update({ contactEmail: e.target.value })} placeholder="jane@acme.com" autoComplete="email" />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
                <Button onClick={() => setStep(3)} disabled={!form.contactName.trim() || !form.contactEmail.trim()}>Continue</Button>
              </div>
            </div>
          )}

          {/* Step 3: Review */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="flex items-center gap-2 text-base font-semibold text-fg"><Globe className="size-4 text-fg-muted" aria-hidden /> Review and finish</h2>
              <dl className="divide-y divide-border-subtle rounded-lg border border-border text-ui">
                {([
                  ['Organisation', form.name],
                  ['URL', <span key="u" className="font-mono text-xs">/{form.slug}/</span>],
                  ['Industry', form.industry],
                  ['Size', SIZES.find((s) => s.value === form.companySize)?.label],
                  ['Contact', form.contactName],
                  ['Email', form.contactEmail],
                ] as const).filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                    <dt className="text-fg-muted">{k}</dt>
                    <dd className="min-w-0 truncate font-medium text-fg">{v}</dd>
                  </div>
                ))}
              </dl>

              {error && <InlineNotice tone="danger" message={error} />}

              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
                <Button onClick={handleSubmit} loading={saving}>Complete setup</Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
