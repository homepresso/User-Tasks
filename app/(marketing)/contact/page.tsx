import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Building2, MessageSquare, Workflow } from 'lucide-react'
import { ContactForm } from '@/components/marketing/contact-form'
import { Wordmark } from '@/components/brand/logo'

export const metadata: Metadata = { title: 'Contact UserTasks | Workflow Automation and BPM', description: 'Contact UserTasks about workflow automation, BPM, on-premises deployment, K2 or Nintex migration, integrations, and enterprise requirements.', alternates: { canonical: '/contact' }, openGraph: { title: 'Contact UserTasks', description: 'Talk to UserTasks about workflow automation, migration, or private deployment.', url: '/contact', type: 'website' } }

export default function ContactPage() {
  return <div className="min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)" style={{ ['--theme-card-bg' as any]: 'var(--mkt-white)', ['--theme-card-text' as any]: 'var(--mkt-ink)', ['--theme-surface' as any]: 'var(--mkt-canvas)', ['--theme-surface-border' as any]: 'var(--mkt-line)', ['--theme-muted-text' as any]: 'var(--mkt-muted)', ['--theme-primary' as any]: 'var(--mkt-primary)', ['--theme-primary-hover' as any]: 'var(--mkt-primary-hover)' }}>
    <header className="border-b border-(color:--mkt-ink)/[0.08]"><nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5"><Link href="/" aria-label="UserTasks home"><Wordmark size={34} /></Link><Link href="/login" className="text-sm text-(color:--mkt-text) hover:text-(color:--mkt-ink)">Sign in</Link></nav></header>
    <main className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[0.9fr_1.1fr] lg:py-24">
      <section><Link href="/" className="inline-flex items-center gap-1 text-sm text-(color:--mkt-bronze) hover:underline"><ArrowLeft size={14} /> Back to UserTasks</Link><p className="mt-10 text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">Contact UserTasks</p><h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Let&apos;s talk about the process you need to run</h1><p className="mt-5 mkt-body text-(color:--mkt-text)">Tell us what you are automating, replacing, or deploying. We can discuss workflow architecture, BPM, K2 or Nintex migration, integrations, private networking, and on-premises requirements.</p><div className="mt-8 space-y-3">{[[Workflow, 'Workflow and BPM design'], [Building2, 'Private and on-premises deployment'], [MessageSquare, 'Migration and product evaluation']].map(([Icon, label]) => { const ItemIcon = Icon as typeof Workflow; return <div key={String(label)} className="flex items-center gap-3 rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-ink)/[0.03] p-4"><ItemIcon size={18} className="text-(color:--mkt-bronze)" /><span className="text-sm text-(color:--mkt-text)">{String(label)}</span></div> })}</div></section>
      <section className="rounded-2xl border border-(color:--mkt-ink)/10 bg-(color:--mkt-canvas) p-6 shadow-2xl shadow-black/30 sm:p-8"><h2 className="text-xl font-semibold">Send us a message</h2><p className="mb-7 mt-2 text-sm text-(color:--mkt-muted)">Complete the form and the UserTasks team will follow up.</p><ContactForm /></section>
    </main>
  </div>
}
