'use client'

import { useState } from 'react'
import { CheckCircle2, Loader2, Send } from 'lucide-react'

const initialForm = { name: '', email: '', company: '', comments: '', website: '' }

export function ContactForm() {
  const [form, setForm] = useState(initialForm)
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [key]: event.target.value }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setStatus('sending')
    try {
      const response = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Unable to send your message.')
      setForm(initialForm)
      setStatus('sent')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to send your message.')
      setStatus('idle')
    }
  }

  const fieldClass = 'mt-1.5 w-full rounded-xl border border-[#1B1916]/10 bg-[#F1EDE3] px-4 py-3 text-base text-[#1B1916] outline-none placeholder:text-[#4A463E] focus:border-[#17150F]/60 focus:ring-2 focus:ring-[#17150F]/15'

  if (status === 'sent') return <div className="rounded-2xl border border-[#857B66]/20 bg-[#857B66]/[0.06] p-8 text-center" role="status"><CheckCircle2 className="mx-auto text-[#6F6858]" size={32} /><h2 className="mt-4 text-xl font-semibold">Thanks—we received your message.</h2><p className="mt-2 text-sm text-[#6E6759]">The UserTasks team will review your enquiry and follow up using the email you provided.</p><button type="button" onClick={() => setStatus('idle')} className="mt-5 text-sm font-medium text-[#8A6D45] hover:underline">Send another message</button></div>

  return <form onSubmit={submit} className="space-y-5" aria-busy={status === 'sending'}>
    <input name="website" value={form.website} onChange={set('website')} tabIndex={-1} autoComplete="off" aria-hidden="true" className="sr-only" />
    <div className="grid gap-5 sm:grid-cols-2">
      <label className="text-sm font-medium text-[#4A463E]">Name<input required minLength={2} maxLength={120} autoComplete="name" value={form.name} onChange={set('name')} className={fieldClass} placeholder="Your name" /></label>
      <label className="text-sm font-medium text-[#4A463E]">Work email<input required type="email" maxLength={254} autoComplete="email" value={form.email} onChange={set('email')} className={fieldClass} placeholder="you@company.com" /></label>
    </div>
    <label className="block text-sm font-medium text-[#4A463E]">Company<input required minLength={2} maxLength={160} autoComplete="organization" value={form.company} onChange={set('company')} className={fieldClass} placeholder="Company name" /></label>
    <label className="block text-sm font-medium text-[#4A463E]">How can we help?<textarea required minLength={10} maxLength={5000} rows={7} value={form.comments} onChange={set('comments')} className={fieldClass} placeholder="Tell us about your workflow, migration, on-premises deployment, or automation requirements." /></label>
    {error ? <p role="alert" className="rounded-lg border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</p> : null}
    <button type="submit" disabled={status === 'sending'} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#17150F] px-6 py-3.5 font-semibold text-[#FAF8F3] hover:bg-[#2E2A24] disabled:cursor-not-allowed disabled:opacity-60">{status === 'sending' ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />}{status === 'sending' ? 'Sending…' : 'Send message'}</button>
    <p className="text-center text-xs text-[#857D6D]">We use these details only to respond to your enquiry.</p>
  </form>
}
