'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Building2, User, Globe, Check, Loader2 } from 'lucide-react'
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
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#F9FAFB' }}>
      <div className="w-full max-w-lg rounded-2xl border bg-white shadow-xl p-8">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ backgroundColor: 'var(--theme-primary-light, #EBE4D5)', color: 'var(--theme-primary, #17150F)' }}>
            <Building2 size={28} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Set up your workspace</h1>
          <p className="text-sm text-gray-500 mt-1">Complete your organisation profile to get started</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {[1, 2, 3].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${s < step ? 'bg-[color:var(--theme-primary)] text-[color:var(--theme-on-primary)]' : s === step ? 'bg-[color:var(--theme-accent-light)] text-[color:var(--theme-card-text)] ring-2 ring-[color:var(--theme-primary)]' : 'bg-gray-100 text-gray-400'}`}>
                {s < step ? <Check size={14} /> : s}
              </div>
              {s < 3 && <div className={`w-8 h-0.5 ${s < step ? 'bg-[color:var(--theme-primary)]' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        {/* Step 1: Organisation */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Building2 size={14} /> Organisation</h2>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Organisation Name</label>
              <Input value={form.name} onChange={e => update({ name: e.target.value })} placeholder="Acme Corp" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">URL Identifier <span className="font-normal text-gray-400">(unique, used in public URLs)</span></label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 shrink-0">/{form.slug}/</span>
                <Input value={form.slug} onChange={e => { setForm(prev => ({ ...prev, slug: toUrlSlug(e.target.value, 40) })); setSlugError(null) }} placeholder="acme-corp" className="font-mono" />
              </div>
              {slugError && <p className="text-xs text-red-500 mt-1">{slugError}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Industry</label>
              <select value={form.industry} onChange={e => update({ industry: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                <option value="">Select industry...</option>
                {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Company Size</label>
              <div className="grid grid-cols-3 gap-2">
                {SIZES.map(s => (
                  <button key={s.value} type="button" onClick={() => update({ companySize: s.value })}
                    className={`rounded-lg border px-2 py-1.5 text-xs text-center transition-all ${form.companySize === s.value ? 'border-[color:var(--theme-primary)] bg-[color:var(--theme-primary-light)] text-[color:var(--theme-card-text)] font-medium' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <Button className="w-full" onClick={() => setStep(2)} disabled={!form.name.trim() || !form.slug.trim()}>
              Continue
            </Button>
          </div>
        )}

        {/* Step 2: Contact */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><User size={14} /> Primary Contact</h2>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Your Name</label>
              <Input value={form.contactName} onChange={e => update({ contactName: e.target.value })} placeholder="Jane Smith" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <Input type="email" value={form.contactEmail} onChange={e => update({ contactEmail: e.target.value })} placeholder="jane@acme.com" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>Back</Button>
              <Button className="flex-1" onClick={() => setStep(3)} disabled={!form.contactName.trim() || !form.contactEmail.trim()}>Continue</Button>
            </div>
          </div>
        )}

        {/* Step 3: Review */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Globe size={14} /> Review & Finish</h2>
            <div className="rounded-lg border p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Organisation</span><span className="font-medium">{form.name}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">URL</span><span className="font-mono text-xs">/{form.slug}/</span></div>
              {form.industry && <div className="flex justify-between"><span className="text-gray-500">Industry</span><span>{form.industry}</span></div>}
              {form.companySize && <div className="flex justify-between"><span className="text-gray-500">Size</span><span>{form.companySize}</span></div>}
              <div className="flex justify-between"><span className="text-gray-500">Contact</span><span>{form.contactName}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Email</span><span>{form.contactEmail}</span></div>
            </div>

            {error && <p className="text-xs text-red-500 rounded-lg bg-red-50 p-2">{error}</p>}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>Back</Button>
              <Button className="flex-1" onClick={handleSubmit} disabled={saving}>
                {saving ? <><Loader2 size={14} className="mr-1 animate-spin" /> Saving...</> : 'Complete Setup'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
