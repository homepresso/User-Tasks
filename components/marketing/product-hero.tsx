import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowRight, Check } from "lucide-react"
import { DemoStage, type SceneId } from "@/components/marketing/demo/demo-stage"

/**
 * The dark hero every product page shares: breadcrumb, eyebrow, headline,
 * intro, two calls to action, then either a mini interactive demo (`scenes`)
 * or any other visual. Pair it with <MarketingHeader tone="night" />.
 */
export function ProductHero({ crumb, eyebrow, icon: Icon, title, intro, primary, secondary, scenes, demoLabel, visual, bullets }: {
  crumb: string
  eyebrow: string
  icon: typeof Check
  title: ReactNode
  intro: ReactNode
  primary: { href: string; label: string }
  secondary?: { href: string; label: string }
  scenes?: SceneId[]
  demoLabel?: string
  visual?: ReactNode
  bullets?: string[]
}) {
  return (
    <section data-hero-night className="mkt-night mkt-grain relative overflow-hidden">
      <div aria-hidden="true" className="mkt-grid pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="pointer-events-none absolute -top-56 left-1/2 h-[40rem] w-[70rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(232,178,102,0.26),transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute right-[-14rem] top-[24rem] h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(closest-side,rgba(139,124,246,0.2),transparent)]" />
      <div className="relative mx-auto max-w-6xl px-4 pt-10 sm:px-6 sm:pt-14">
        <nav aria-label="Breadcrumb" className="text-xs text-[#A89E8C]"><Link href="/" className="hover:text-white">UserTasks</Link><span className="px-2">/</span><span aria-current="page">{crumb}</span></nav>
        <div className="mt-8 grid items-end gap-8 lg:grid-cols-[1.25fr_1fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-[#fff]/[0.05] py-1 pl-1 pr-3 text-xs font-semibold uppercase tracking-wider text-[#F0C27B]">
              <span className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-[#F3C77F] to-[#D99A52] text-[#1B1406]"><Icon size={13} aria-hidden="true" /></span>{eyebrow}
            </p>
            <h1 className="mt-6 font-display text-[clamp(2.4rem,5.2vw,4.25rem)] font-bold leading-[1.02] tracking-[-0.025em] text-white text-balance">{title}</h1>
          </div>
          <div>
            <p className="text-[17px] leading-8 text-[#D9D0BF]">{intro}</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href={primary.href} className="mkt-btn-ember inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold">{primary.label} <ArrowRight size={16} aria-hidden="true" /></Link>
              {secondary && <Link href={secondary.href} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-5 py-3 font-semibold text-[#F4EFE4] hover:border-white/35">{secondary.label}</Link>}
            </div>
          </div>
        </div>
        {bullets && (
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[#C9BFAE]">
            {bullets.map((bullet) => <li key={bullet} className="flex items-center gap-2"><Check size={14} className="text-[#7FA98A]" aria-hidden="true" />{bullet}</li>)}
          </ul>
        )}
      </div>
      <div className="relative mx-auto max-w-6xl px-3 pb-16 pt-10 sm:px-6 sm:pb-24 sm:pt-12">
        {scenes ? <DemoStage scenes={scenes} label={demoLabel ?? `${crumb}: an interactive replica`} heightClass="h-[420px] sm:h-[500px] lg:h-[540px]" /> : visual}
      </div>
    </section>
  )
}
