import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Building2, MessageSquare, Workflow } from 'lucide-react'
import { ContactForm } from '@/components/marketing/contact-form'
import { Wordmark } from '@/components/brand/logo'

export const metadata: Metadata = { title: 'Contact UserTasks | Workflow Automation and BPM', description: 'Contact UserTasks about workflow automation, BPM, on-premises deployment, K2 or Nintex migration, integrations, and enterprise requirements.', alternates: { canonical: '/contact' }, openGraph: { title: 'Contact UserTasks', description: 'Talk to UserTasks about workflow automation, migration, or private deployment.', url: '/contact', type: 'website' } }

export default function ContactPage() {
  return <div className="min-h-screen bg-[#FAF8F3] text-[#1B1916]" style={{ ['--theme-card-bg' as any]: '#FFFFFF', ['--theme-card-text' as any]: '#1B1916', ['--theme-surface' as any]: '#F5F2EA', ['--theme-surface-border' as any]: '#E6E1D5', ['--theme-muted-text' as any]: '#6E6759', ['--theme-primary' as any]: '#17150F', ['--theme-primary-hover' as any]: '#2E2A24' }}>
    <header className="border-b border-[#1B1916]/[0.08]"><nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5"><Link href="/" aria-label="UserTasks home"><Wordmark size={34} /></Link><Link href="/login" className="text-sm text-[#4A463E] hover:text-[#1B1916]">Sign in</Link></nav></header>
    <main className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[0.9fr_1.1fr] lg:py-24">
      <section><Link href="/" className="inline-flex items-center gap-1 text-sm text-[#8A6D45] hover:underline"><ArrowLeft size={14} /> Back to UserTasks</Link><p className="mt-10 text-xs font-semibold uppercase tracking-[0.2em] text-[#8A6D45]">Contact UserTasks</p><h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Let&apos;s talk about the process you need to run</h1><p className="mt-5 text-lg leading-8 text-[#4A463E]">Tell us what you are automating, replacing, or deploying. We can discuss workflow architecture, BPM, K2 or Nintex migration, integrations, private networking, and on-premises requirements.</p><div className="mt-8 space-y-3">{[[Workflow, 'Workflow and BPM design'], [Building2, 'Private and on-premises deployment'], [MessageSquare, 'Migration and product evaluation']].map(([Icon, label]) => { const ItemIcon = Icon as typeof Workflow; return <div key={String(label)} className="flex items-center gap-3 rounded-xl border border-[#1B1916]/[0.08] bg-[#1B1916]/[0.03] p-4"><ItemIcon size={18} className="text-[#8A6D45]" /><span className="text-sm text-[#4A463E]">{String(label)}</span></div> })}</div></section>
      <section className="rounded-2xl border border-[#1B1916]/10 bg-[#F5F2EA] p-6 shadow-2xl shadow-black/30 sm:p-8"><h2 className="text-xl font-semibold">Send us a message</h2><p className="mb-7 mt-2 text-sm text-[#6E6759]">Complete the form and the UserTasks team will follow up.</p><ContactForm /></section>
    </main>
  </div>
}
