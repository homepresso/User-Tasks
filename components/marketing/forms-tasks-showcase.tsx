import type { ReactNode } from "react"
import Image from "next/image"
import Link from "next/link"
import { ArrowRight, Check, CheckCircle2, Code2, Globe, Inbox, KeyRound, ListFilter, Paperclip, Zap } from "lucide-react"
import { SectionHeading } from "@/components/marketing/marketing-ui"
import { SCREENSHOTS } from "@/lib/docs/screenshots"
import type { ScreenshotName } from "@/lib/docs/screenshot-names"

/**
 * Landing-page section for sharing forms (standalone links, website embeds,
 * workspace addresses, the form sign-in page, rules, lazy loading) and the
 * task list (queued tasks and queue rules, attachments, the completed
 * screen). Server-rendered, no client code. Features without a screenshot get
 * a small CSS illustration instead (decorative, hidden from screen readers);
 * the card text carries the meaning.
 */

type Card = { icon: typeof Inbox; title: string; body: string; href: string; link: string; visual: ReactNode }

function Frame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex aspect-[16/10] items-center justify-center overflow-hidden border-b border-(color:--mkt-ink)/[0.06] bg-gradient-to-br from-(color:--mkt-primary)/[0.04] to-(color:--mkt-gold)/[0.12] p-5 ${className}`} aria-hidden="true">
      {children}
    </div>
  )
}

function ShotVisual({ name, position = "object-left-top" }: { name: ScreenshotName; position?: string }) {
  return (
    <div className="aspect-[16/10] overflow-hidden border-b border-(color:--mkt-ink)/[0.06] bg-(color:--mkt-white)">
      <Image src={SCREENSHOTS[name]} alt="" sizes="(min-width: 1024px) 360px, (min-width: 768px) 50vw, 100vw" placeholder="blur" className={`h-full w-full object-cover ${position}`} />
    </div>
  )
}

const EmbedVisual = (
  <Frame>
    <div className="w-full max-w-xs overflow-hidden rounded-lg bg-(color:--mkt-code-bg) p-3 font-mono text-[11px] leading-5 text-(color:--mkt-code-text) shadow-sm">
      <p><span className="text-(color:--mkt-gold-light)">&lt;iframe</span> src=&quot;https://acme</p>
      <p className="pl-4">.usertasks.com/form/</p>
      <p className="pl-4">support-request?embed=1&quot;</p>
      <p><span className="text-(color:--mkt-gold-light)">&gt;&lt;/iframe&gt;</span></p>
      <p className="mt-2 text-(color:--mkt-faint)">// resizes to fit the form</p>
    </div>
  </Frame>
)

const AddressVisual = (
  <Frame>
    <div className="w-full max-w-xs overflow-hidden rounded-lg border border-(color:--mkt-ink)/10 bg-(color:--mkt-white) shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-(color:--mkt-ink)/[0.08] px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-(color:--mkt-coral)/70" />
        <span className="h-2 w-2 rounded-full bg-(color:--mkt-gold)/80" />
        <span className="h-2 w-2 rounded-full bg-(color:--mkt-green)/70" />
        <span className="ml-2 flex-1 truncate rounded bg-(color:--mkt-canvas) px-2 py-0.5 text-[11px] text-(color:--mkt-ink-soft)"><strong className="font-semibold">acme</strong>.usertasks.com/form/employee-onboarding</span>
      </div>
      <div className="space-y-2 p-3">
        <div className="h-2.5 w-2/3 rounded bg-(color:--mkt-ink)/80" />
        <div className="h-6 rounded border border-(color:--mkt-ink)/10" />
        <div className="h-6 rounded border border-(color:--mkt-ink)/10" />
        <div className="ml-auto h-6 w-20 rounded bg-(color:--mkt-primary)" />
      </div>
    </div>
  </Frame>
)

const SignInVisual = (
  <Frame className="gap-2">
    <div className="flex h-28 w-24 overflow-hidden rounded-md border border-(color:--mkt-ink)/10 bg-(color:--mkt-white) shadow-sm">
      <div className="w-1/2 bg-(color:--mkt-primary)" />
      <div className="flex flex-1 flex-col justify-center gap-1.5 p-1.5"><div className="h-1.5 w-3/4 rounded bg-(color:--mkt-ink)/70" /><div className="h-3 rounded border border-(color:--mkt-ink)/15" /><div className="h-3 rounded bg-(color:--mkt-primary)" /></div>
    </div>
    <div className="flex h-32 w-24 flex-col justify-center gap-1.5 rounded-md border border-(color:--mkt-ink)/10 bg-(color:--mkt-white) p-2 shadow-md">
      <div className="mx-auto h-4 w-4 rounded-full bg-(color:--mkt-bronze)" />
      <div className="mx-auto h-1.5 w-2/3 rounded bg-(color:--mkt-ink)/70" />
      <div className="h-3 rounded border border-(color:--mkt-ink)/15" />
      <div className="h-3 rounded border border-(color:--mkt-ink)/15" />
      <div className="h-3 rounded bg-(color:--mkt-bronze)" />
    </div>
    <div className="flex h-28 w-24 flex-col justify-center gap-1.5 rounded-md bg-(color:--mkt-code-bg) p-2 shadow-sm">
      <div className="h-1.5 w-2/3 rounded bg-(color:--mkt-gold-light)" />
      <div className="h-3 rounded border border-white/20" />
      <div className="h-3 rounded bg-(color:--mkt-gold)" />
    </div>
  </Frame>
)

const QueueVisual = (
  <Frame>
    <div className="w-full max-w-xs divide-y divide-(color:--mkt-ink)/[0.07] overflow-hidden rounded-lg border border-(color:--mkt-ink)/10 bg-(color:--mkt-white) text-[11px] shadow-sm">
      {[
        { task: "Approve invoice INV-24019", status: "Queued", queued: true },
        { task: "Review expense claim", status: "Queued", queued: true },
        { task: "Onboard supplier", status: "In progress", queued: false },
      ].map((row) => (
        <div key={row.task} className="flex items-center gap-2 px-3 py-2">
          <span className="flex-1 truncate font-medium text-(color:--mkt-ink)">{row.task}</span>
          <span className={`rounded-full px-1.5 py-0.5 ${row.queued ? "bg-(color:--mkt-gold)/20 text-[#6B5232]" : "bg-(color:--mkt-ink)/[0.06] text-(color:--mkt-muted-strong)"}`}>{row.status}</span>
          {row.queued && <span className="rounded border border-(color:--mkt-ink)/15 px-1.5 py-0.5 text-(color:--mkt-ink-soft)">Accept</span>}
        </div>
      ))}
    </div>
  </Frame>
)

const CompletedVisual = (
  <Frame>
    <div className="w-full max-w-xs rounded-lg border border-(color:--mkt-ink)/10 bg-(color:--mkt-white) p-4 text-[11px] shadow-sm">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-(color:--mkt-ink)"><CheckCircle2 size={16} className="text-(color:--mkt-green)" />Approved: Invoice #1042</p>
      <p className="mt-2 text-(color:--mkt-muted)">What happens next</p>
      <p className="font-medium text-(color:--mkt-ink-soft)">Now with Finance (Priya Shah)</p>
      <div className="mt-3 flex gap-1.5">
        <span className="rounded bg-(color:--mkt-primary) px-2 py-1 text-(color:--mkt-paper)">Next task</span>
        <span className="rounded border border-(color:--mkt-ink)/15 px-2 py-1 text-(color:--mkt-ink-soft)">Back to my tasks</span>
      </div>
    </div>
  </Frame>
)

const SHARE: Card[] = [
  { icon: Code2, title: "Embed a form in any website", body: "Copy an iframe from the form's QR code dialog. An optional script sizes the frame to the form, so there is no scrollbar inside it. Public forms work anywhere; forms that need sign-in offer to open in a new tab.", href: "/docs/tasks/forms#sharing-and-embedding-forms", link: "Sharing and embedding", visual: EmbedVisual },
  { icon: Globe, title: "Your own address, readable links", body: "Each workspace gets an address like acme.usertasks.com, and every reusable form a link named after it. Form links open the form on its own, without the app around it. Rename a form and old links still work.", href: "/docs/governance/workspace-address", link: "Workspace addresses", visual: AddressVisual },
  { icon: KeyRound, title: "A sign-in page in your brand", body: "Visitors who need to sign in see your form sign-in page: ten designs, your logo and wording, password and single sign-on, then straight back to the form. Or let it follow the workspace theme.", href: "/docs/tasks/forms#form-sign-in-page", link: "Form sign-in page", visual: SignInVisual },
]

const BUILD: Card[] = [
  { icon: ListFilter, title: "Rules that react as people fill it in", body: "Show or hide fields, fill them from a lookup or an API, or make a field, section, tab or the whole form read only while a condition holds. Try parameters and variables in the designer's Preview before you share the link.", href: "/docs/tasks/forms#rules", link: "Form rules", visual: <ShotVisual name="forms-rules-runtime" /> },
  { icon: Zap, title: "Long forms that open fast", body: "Load a tab or section when it is first shown, or when a rule asks for it, so the form opens with only what people see first. Subtle or expressive animations, and nothing moves when the device asks for reduced motion.", href: "/docs/tasks/forms#when-to-load-faster-forms", link: "When to load", visual: <ShotVisual name="form-lazy-load" /> },
]

const TASKS: Card[] = [
  { icon: Inbox, title: "One task list, your queue rules", body: "Tasks waiting for you show as Queued in My tasks, with Accept, Decline or Claim. Each person decides which new tasks wait for acceptance and which go straight to their list, by priority, workflow or who assigned them.", href: "/docs/tasks#task-queue-rules", link: "Queued tasks and queue rules", visual: QueueVisual },
  { icon: Paperclip, title: "Attachments on every task", body: "Contracts, invoices, photos and evidence, each with a name, type and description. Workflows read them in later steps and can file generated documents back on the task.", href: "/docs/tasks/attachments", link: "Task attachments", visual: <ShotVisual name="task-attachments" /> },
  { icon: CheckCircle2, title: "People know what happens next", body: "After choosing an outcome, a completed screen confirms the choice, says who has the work now and offers the next task. Each workspace sets the wording.", href: "/docs/tasks#task-completed-screen", link: "Task completed screen", visual: CompletedVisual },
]

function CardGrid({ cards, columns }: { cards: Card[]; columns: string }) {
  return (
    <div className={`grid grid-cols-1 gap-6 ${columns}`}>
      {cards.map(({ icon: Icon, title, body, href, link, visual }) => (
        <article key={title} className="flex flex-col overflow-hidden rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper)">
          {visual}
          <div className="flex flex-1 flex-col p-5">
            <h3 className="flex items-center gap-2 text-lg font-semibold"><Icon size={17} className="shrink-0 text-(color:--mkt-bronze)" aria-hidden="true" />{title}</h3>
            <p className="mt-2 flex-1 text-sm leading-6 text-(color:--mkt-text)">{body}</p>
            <Link href={href} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline">{link} <ArrowRight size={14} aria-hidden="true" /></Link>
          </div>
        </article>
      ))}
    </div>
  )
}

export function FormsTasksShowcase() {
  return (
    <section id="forms-and-tasks" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionHeading eyebrow="Forms and tasks" title="Share a form anywhere. Work every task from one list.">
          Send a link, put the form on your own website or print a QR code. People sign in on a page that looks like yours, and whatever they are asked to do next lands in one task list.
        </SectionHeading>
        <div className="mt-10 space-y-6">
          <CardGrid cards={SHARE} columns="md:grid-cols-3" />
          <CardGrid cards={BUILD} columns="md:grid-cols-2" />
        </div>
        <h3 className="mt-14 font-display text-2xl font-bold tracking-tight">For the people doing the work</h3>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-(color:--mkt-text)">
          {["Accept, decline, hold, redirect or escalate", "SLAs, reminders and escalation", "On desktop and phones"].map((item) => (
            <li key={item} className="flex items-center gap-1.5"><Check size={15} className="text-(color:--mkt-green)" aria-hidden="true" />{item}</li>
          ))}
        </ul>
        <div className="mt-6">
          <CardGrid cards={TASKS} columns="md:grid-cols-3" />
        </div>
        <p className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href="/forms" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Everything forms can do <ArrowRight size={14} aria-hidden="true" /></Link>
          <Link href="/docs/tasks" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Tasks guide <ArrowRight size={14} aria-hidden="true" /></Link>
        </p>
      </div>
    </section>
  )
}
