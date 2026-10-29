import type { ReactNode } from "react"
import Image from "next/image"
import Link from "next/link"
import { Bot, Inbox, Layers, ListChecks, Plug, Route, ShieldCheck } from "lucide-react"
import { CopyButton } from "@/components/docs/copy-button"
import { SCREENSHOTS } from "@/lib/docs/screenshots"
import type { ScreenshotName } from "@/lib/docs/screenshot-names"
import type { UseCaseIcon } from "@/lib/use-cases"
import { Wordmark } from "@/components/brand/logo"

/**
 * Shared building blocks of the public site (landing and use-case pages):
 * cream paper, ink text, bronze accents, Fraunces headings.
 */

export const USE_CASE_ICONS: Record<UseCaseIcon, typeof Inbox> = {
  inbox: Inbox,
  shield: ShieldCheck,
  bot: Bot,
  plug: Plug,
  list: ListChecks,
  route: Route,
  layers: Layers,
}

export function SectionHeading({ eyebrow, title, children, as: Heading = "h2" }: { eyebrow: string; title: ReactNode; children?: ReactNode; as?: "h1" | "h2" }) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8A6D45]">{eyebrow}</p>
      <Heading className="mt-3 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl">{title}</Heading>
      {children && <p className="mt-4 text-lg leading-8 text-[#4A463E]">{children}</p>}
    </div>
  )
}

export function Shot({ name, alt, sizes, priority = false }: { name: ScreenshotName; alt: string; sizes: string; priority?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#1B1916]/10 bg-[#FFFFFF] shadow-[0_20px_60px_rgba(27,25,22,0.12)]">
      <Image src={SCREENSHOTS[name]} alt={alt} sizes={sizes} priority={priority} placeholder="blur" className="h-auto w-full" />
    </div>
  )
}

export function Snippet({ code, language = "shell" }: { code: string; language?: string }) {
  return (
    <div className="overflow-hidden rounded-xl bg-[#1C1A16]">
      <div className="flex items-center justify-between border-b border-[#FFFFFF]/[0.08] px-4 py-1">
        <span className="font-mono text-xs text-[#857D6D]">{language}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-4 text-[12.5px] leading-6 text-[#EDE8DC]"><code className="font-mono">{code}</code></pre>
    </div>
  )
}

/** Header for public pages other than the landing page. */
export function MarketingHeader() {
  return (
    <header className="border-b border-[#1B1916]/[0.08] bg-[#FAF8F3]/95">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-5 sm:px-6" aria-label="Main">
        <Link href="/" aria-label="UserTasks home"><Wordmark size={34} /></Link>
        <div className="flex items-center gap-1 sm:gap-2">
          <Link href="/use-cases" className="hidden whitespace-nowrap rounded-lg px-1.5 py-2 text-sm font-medium text-[#4A463E] hover:text-[#1B1916] min-[420px]:inline sm:px-3">Use cases</Link>
          <Link href="/forms" className="hidden whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-[#4A463E] hover:text-[#1B1916] sm:px-3 lg:inline">Forms</Link>
          <Link href="/documents" className="hidden whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-[#4A463E] hover:text-[#1B1916] sm:px-3 lg:inline">Documents</Link>
          <Link href="/gallery" className="whitespace-nowrap rounded-lg px-1.5 py-2 text-sm font-medium text-[#4A463E] hover:text-[#1B1916] sm:px-3">Gallery</Link>
          <Link href="/deploy-anywhere" className="hidden whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-[#4A463E] hover:text-[#1B1916] sm:inline sm:px-3">Deploy</Link>
          <Link href="/docs" className="whitespace-nowrap rounded-lg px-1.5 py-2 text-sm font-medium text-[#4A463E] hover:text-[#1B1916] sm:px-3">Docs</Link>
          <Link href="/contact" className="hidden whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-[#4A463E] hover:text-[#1B1916] sm:px-3 md:inline">Contact</Link>
          <Link href="/login" className="ml-1 whitespace-nowrap rounded-lg bg-[#17150F] px-3 py-2 sm:px-4 text-sm font-semibold text-[#FAF8F3] hover:bg-[#2E2A24]">Sign in</Link>
        </div>
      </nav>
    </header>
  )
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-[#1B1916]/[0.07]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
        <Wordmark size={26} />
        <p className="text-xs text-[#857D6D]">Open-source headless workflow engine · Apache-2.0 · © {new Date().getFullYear()} UserTasks</p>
        <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-[#6E6759]">
          <Link href="/use-cases" className="hover:text-[#1B1916]">Use cases</Link>
          <Link href="/forms" className="hover:text-[#1B1916]">Forms</Link>
          <Link href="/documents" className="hover:text-[#1B1916]">Documents</Link>
          <Link href="/gallery" className="hover:text-[#1B1916]">Package gallery</Link>
          <Link href="/deploy-anywhere" className="hover:text-[#1B1916]">Deploy anywhere</Link>
          <Link href="/docs" className="hover:text-[#1B1916]">Docs</Link>
          <Link href="/docs/api-explorer" className="hover:text-[#1B1916]">API Explorer</Link>
          <Link href="/open-source" className="hover:text-[#1B1916]">Why open source</Link>
          <Link href="/contact" className="hover:text-[#1B1916]">Contact</Link>
          <Link href="/login" className="hover:text-[#1B1916]">Sign in</Link>
        </div>
      </div>
    </footer>
  )
}
