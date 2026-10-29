import type { CSSProperties, ReactNode } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  ArrowRight,
  AtSign,
  Calendar,
  CalendarClock,
  Check,
  CheckSquare,
  CircleDot,
  DollarSign,
  FileInput,
  FlaskConical,
  Hash,
  Heading,
  Library,
  Link2,
  ListChecks,
  Minus,
  Paperclip,
  Phone,
  QrCode,
  Search,
  ShieldCheck,
  Type,
  AlignLeft,
  User,
  Zap,
} from "lucide-react"
import { MarketingFooter, MarketingHeader, SectionHeading, Shot, Snippet } from "@/components/marketing/marketing-ui"
import { SCREENSHOTS } from "@/lib/docs/screenshots"
import { FORMS_PAGE } from "@/lib/marketing-pages"
import { GALLERY_PACKAGES } from "@/lib/gallery/site"

/**
 * /forms — the grid form designer, field types (lookups, attachments),
 * buttons, headers, themes, form pages with QR codes, the Form submitted
 * trigger and testing with the real form. Server-rendered; screenshots are
 * the Northwind demo workspace (scripts/screenshots).
 */

const SITE_URL = "https://usertasks.com"


const THEME = {
  "--theme-card-bg": "#FFFFFF",
  "--theme-card-text": "#1B1916",
  "--theme-surface": "#F5F2EA",
  "--theme-surface-border": "#E6E1D5",
  "--theme-muted-text": "#6E6759",
} as CSSProperties

const FIELD_TYPES: Array<{ icon: typeof Type; label: string; note: string }> = [
  { icon: Type, label: "Text", note: "length, pattern" },
  { icon: AlignLeft, label: "Long text", note: "length" },
  { icon: AtSign, label: "Email", note: "format checked" },
  { icon: Phone, label: "Phone", note: "format checked" },
  { icon: Link2, label: "URL", note: "http(s) only" },
  { icon: Hash, label: "Number", note: "min / max" },
  { icon: DollarSign, label: "Currency", note: "ISO code, min / max" },
  { icon: Calendar, label: "Date", note: "date range" },
  { icon: CalendarClock, label: "Date & time", note: "UTC, range" },
  { icon: CheckSquare, label: "Checkbox", note: "yes / no" },
  { icon: CircleDot, label: "Single select", note: "dropdown or radio" },
  { icon: ListChecks, label: "Multi-select", note: "selection count" },
  { icon: User, label: "Person", note: "a workspace member" },
  { icon: Search, label: "Autocomplete / lookup", note: "data table or API" },
  { icon: Paperclip, label: "Attachments", note: "several files" },
  { icon: Heading, label: "Section heading", note: "layout" },
  { icon: Minus, label: "Divider", note: "layout" },
]

const BEHAVIOURS = [
  { step: "Show message", body: "A message under the form, with the submitted values filled in." },
  { step: "Show success screen", body: "Replace the form with a title, text and a Submit another, Close or link button." },
  { step: "Start workflow", body: "Start any workflow with the form's values mapped to its inputs — on the server, attributed to whoever submitted." },
  { step: "Redirect", body: "Go to an app page or an address on your allow list." },
  { step: "Close form", body: "Close the form." },
]

const FAQS = [
  { question: "Where can a form be used?", answer: "On a User Task (what the assignee fills in), as a workflow's start form (the Run dialog, Save & Test, API and CLI starts), as a reusable form on its own page at /f/<id> with a QR code, and as the form a task trigger declares. One designer builds all of them." },
  { question: "How does a form start a workflow?", answer: "Two ways. Add a Form submitted trigger to a workflow and choose the form: every submission — from its page, the API, MCP or a linked User Task — starts a run with the values as {{form.<key>}}. Or give a button a Start workflow behaviour that maps the form's values to another workflow's inputs." },
  { question: "Is validation only in the browser?", answer: "No. Every way of submitting — the form page, the task screen, the REST API, MCP, the CLI and test runs — is checked on the server against the form: types, required fields, ranges, patterns, options, people, lookup values and attachments. Invalid values are refused with one message per field." },
  { question: "Which files can people upload?", answer: "An Attachments field sets how many files, how large and which kinds (documents, images, spreadsheets, PDF only or any safe file). Files are checked by their content, stored in private storage, never served publicly and can be scanned with ClamAV. Workflows then loop over them, email them, upload them or read them with document actions." },
  { question: "Can I build forms from code?", answer: "Yes. Forms, form themes and submissions have REST endpoints, MCP tools and usertasks CLI commands, and travel with config as code, GitHub sync and packages. The designer writes the same JSON you can send." },
]

function Pill({ icon: Icon, children }: { icon: typeof Type; children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-[#8A6D45]/30 bg-[#B08A54]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#8A6D45]">
      <Icon size={13} aria-hidden="true" /> {children}
    </p>
  )
}

function Points({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-6 space-y-2 text-sm leading-6 text-[#4A463E]">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-[#4F7A5B]" aria-hidden="true" /><span>{item}</span></li>
      ))}
    </ul>
  )
}

function DocLinks({ links }: { links: Array<{ href: string; label: string }> }) {
  return (
    <p className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="inline-flex items-center gap-1 font-semibold text-[#8A6D45] hover:underline">{link.label} <ArrowRight size={14} aria-hidden="true" /></Link>
      ))}
    </p>
  )
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-[#1B1916]/[0.06] px-1 py-0.5 font-mono text-[0.85em] text-[#33302A]">{children}</code>
}

export function FormsPage() {
  const formPackages = GALLERY_PACKAGES.filter((pkg) => pkg.trigger === "form" && (pkg.forms ?? []).some((form) => form.kind === "page")).slice(0, 6)
  const formPackageCount = GALLERY_PACKAGES.filter((pkg) => pkg.trigger === "form").length
  const url = `${SITE_URL}/${FORMS_PAGE.slug}`
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": `${url}#webpage`, url, name: FORMS_PAGE.title, description: FORMS_PAGE.description, isPartOf: { "@id": `${SITE_URL}/#website` }, about: { "@id": `${SITE_URL}/#software` }, primaryImageOfPage: `${SITE_URL}${SCREENSHOTS["forms-designer"].src}` },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "UserTasks", item: SITE_URL }, { "@type": "ListItem", position: 2, name: FORMS_PAGE.eyebrow, item: url }] },
      { "@type": "FAQPage", mainEntity: FAQS.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) },
    ],
  }

  return (
    <div className="relative min-h-screen bg-[#FAF8F3] text-[#1B1916]" style={THEME}>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[#FAF8F3]" aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <MarketingHeader />

      <main>
        {/* Hero */}
        <section className="bg-[radial-gradient(circle_at_50%_0%,rgba(176,138,84,0.16),transparent_45%)]">
          <div className="mx-auto max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pt-20">
            <nav aria-label="Breadcrumb" className="text-xs text-[#857D6D]"><Link href="/" className="hover:text-[#8A6D45]">UserTasks</Link><span className="px-2">/</span><span aria-current="page">{FORMS_PAGE.eyebrow}</span></nav>
            <div className="mt-8"><Pill icon={FileInput}>{FORMS_PAGE.eyebrow}</Pill></div>
            <h1 className="mt-6 max-w-4xl font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl">Forms that start and drive your workflows.</h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-[#4A463E]">
              Design a form on a grid, with lookups into your data and APIs, file uploads, buttons, a header and your theme. Give it its own page and a QR code, start a workflow every time it is submitted, and use each value in the steps that follow — <strong className="text-[#1B1916]">checked on the server</strong>, whoever sends it.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/docs/tasks/forms#build-your-first-form-in-5-minutes" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#17150F] px-6 py-3 font-semibold text-[#FAF8F3] shadow-lg shadow-[#17150F]/20 hover:bg-[#2E2A24]">
                Build your first form <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link href="/gallery?trigger=form" className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#1B1916]/15 px-6 py-3 font-medium text-[#33302A] hover:border-[#1B1916]/30">
                {formPackageCount} form-started packages
              </Link>
            </div>
            <div className="mt-12">
              <Shot name="forms-designer" alt="The UserTasks form designer: a palette of field types, a grid of rows with one to four columns, and the settings of an Attachments field" sizes="(min-width: 1152px) 1104px, 100vw" priority />
            </div>
            <ul className="mt-8 grid gap-3 text-sm text-[#4A463E] sm:grid-cols-3">
              {[
                [FileInput, "One designer for task forms, start forms and form pages"],
                [ShieldCheck, "Every submission validated on the server"],
                [Zap, "Values typed and ready in the next step"],
              ].map(([Icon, text]) => {
                const I = Icon as typeof Type
                return <li key={text as string} className="flex items-start gap-2"><I size={16} className="mt-0.5 shrink-0 text-[#8A6D45]" aria-hidden="true" />{text as string}</li>
              })}
            </ul>
          </div>
        </section>

        {/* Grid */}
        <section id="grid" className="scroll-mt-8 border-t border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1fr_auto]">
            <div>
              <SectionHeading eyebrow="Grid designer" title="Drag fields onto a grid. It works on a phone too.">
                Rows of one to four columns, fields that span them, section headings and dividers. On a phone every row collapses to one column, so one layout serves the desk and the warehouse floor.
              </SectionHeading>
              <Points items={[
                "Drag from the palette, or select a type and press Enter",
                "Move fields between cells, rows up and down; undo and redo",
                <>Keys follow the label (<Code>contact_email</Code>) and rename safely: references in later steps are listed and updated</>,
                "Preview in light or dark, desktop or phone, and check the validation rules",
                "Fully keyboard-operable: Alt+arrows move a field, Delete removes it",
              ]} />
              <DocLinks links={[{ href: "/docs/tasks/forms#grid-layout", label: "Grid layout" }, { href: "/docs/tasks/forms#the-form-designer", label: "The form designer" }]} />
            </div>
            <figure className="mx-auto w-[260px] shrink-0 sm:w-[300px]">
              <div className="overflow-hidden rounded-[2rem] border-[6px] border-[#17150F] bg-[#FFFFFF] shadow-[0_20px_60px_rgba(27,25,22,0.18)]">
                <Image src={SCREENSHOTS["forms-phone"]} alt="The Customer return form on a phone: every row collapsed to one column" sizes="300px" placeholder="blur" className="h-auto w-full" />
              </div>
              <figcaption className="mt-3 text-center text-sm text-[#6E6759]">The same form at phone width.</figcaption>
            </figure>
          </div>
        </section>

        {/* Field types + lookup */}
        <section id="fields" className="scroll-mt-8 border-t border-[#1B1916]/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Field types" title="Every field a real process needs.">
              Seventeen types, each with its own validation, help text, default value (expressions welcome), read-only and <em>visible when</em> rules.
            </SectionHeading>
            <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Field types">
              {FIELD_TYPES.map(({ icon: Icon, label, note }) => (
                <li key={label} className={`rounded-xl border p-3 ${label === "Autocomplete / lookup" || label === "Attachments" ? "border-[#8A6D45]/35 bg-[#B08A54]/[0.08]" : "border-[#1B1916]/[0.08] bg-[#FFFFFF]/70"}`}>
                  <Icon size={16} className="text-[#8A6D45]" aria-hidden="true" />
                  <span className="mt-2 block text-sm font-semibold leading-5">{label}</span>
                  <span className="block text-xs leading-5 text-[#6E6759]">{note}</span>
                </li>
              ))}
            </ul>
            <div className="mt-14 grid grid-cols-1 items-center gap-10 lg:grid-cols-[2fr_3fr]">
              <div>
                <h3 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight sm:text-3xl">Lookups into your data and your APIs.</h3>
                <p className="mt-4 leading-7 text-[#4A463E]">An autocomplete field suggests as people type — from a data table, or from any API reference you have connected. Picking a customer can fill in their email and phone.</p>
                <Points items={[
                  "Search one or more columns; show a main line and a second line",
                  <>Filters can use other fields (<Code>{"{{task_data.region}}"}</Code>) or workflow variables</>,
                  "Several selections as chips, or free text when you allow it",
                  <>The chosen item travels downstream as <Code>{"{{form.customer_item}}"}</Code></>,
                  "Re-checked on the server; credentials never reach the browser",
                ]} />
                <DocLinks links={[{ href: "/docs/tasks/forms#autocomplete-lookup-fields", label: "Lookup fields" }, { href: "/docs/tasks/forms#field-types", label: "Every field type" }]} />
              </div>
              <Shot name="forms-lookup" alt="Preview of a form whose Customer lookup suggests two customers with their city and country" sizes="(min-width: 1024px) 650px, 100vw" />
            </div>
          </div>
        </section>

        {/* Attachments */}
        <section id="attachments" className="scroll-mt-8 border-t border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-start gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[3fr_2fr]">
            <Shot name="forms-page" alt="A standalone form page with a header, three-column rows, a customer lookup that filled the contact fields, and three uploaded files" sizes="(min-width: 1024px) 650px, 100vw" />
            <div>
              <SectionHeading eyebrow="Attachments" title="Photos, PDFs and spreadsheets, straight into the run.">
                Drag files in, paste them, browse, or use the camera on a phone. Each file shows its progress and can be retried, reordered or removed.
              </SectionHeading>
              <Points items={[
                "Set how many files, how large, and which kinds: documents, images, spreadsheets, PDF only or any safe file",
                "Checked by content, not name; programs, scripts and macro-enabled Office files refused",
                "Private storage, downloads only for people who may see the task or submission, optional ClamAV scan",
                <>Loop over <Code>{"{{form.photos}}"}</Code>, email them, upload them to S3 or SharePoint, or give them to an AI agent</>,
              ]} />
              <p className="mt-6 rounded-xl border border-[#1B1916]/[0.08] bg-[#FAF8F3] p-4 text-sm leading-6 text-[#4A463E]">
                Then read them: <Link href="/documents" className="font-semibold text-[#8A6D45] hover:underline">document actions</Link> turn an uploaded Word, Excel, PowerPoint or PDF file into text, rows and structure in the next step.
              </p>
              <DocLinks links={[{ href: "/docs/tasks/forms#attachments", label: "Attachments" }, { href: "/docs/tasks/forms#how-files-are-kept-safe", label: "How files are kept safe" }]} />
            </div>
          </div>
        </section>

        {/* Buttons and headers */}
        <section id="buttons" className="scroll-mt-8 border-t border-[#1B1916]/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Buttons, behaviours and headers" title="Decide what happens when someone presses Submit.">
              Rename buttons, style them, add outcome buttons that complete a task, a Save draft button or more submit buttons. Each one runs its steps in order — and a header with your logo, a title and a subtitle sits above the fields.
            </SectionHeading>
            <div className="mt-10 grid grid-cols-1 items-start gap-8 lg:grid-cols-[2fr_3fr]">
              <ol className="space-y-3">
                {BEHAVIOURS.map((item, index) => (
                  <li key={item.step} className="flex gap-4 rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF]/70 p-4">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#17150F] text-xs font-bold text-[#FAF8F3]">{index + 1}</span>
                    <div><h3 className="font-semibold">{item.step}</h3><p className="mt-0.5 text-sm leading-6 text-[#4A463E]">{item.body}</p></div>
                  </li>
                ))}
              </ol>
              <div className="min-w-0">
                <Shot name="forms-buttons" alt="The Buttons and header tab: a header with the workspace logo, title and subtitle, and a Submit return button that shows a success screen" sizes="(min-width: 1024px) 650px, 100vw" />
                <p className="mt-3 text-sm leading-6 text-[#6E6759]">Typical chains: <em>Submit → Start workflow → Show success screen</em> with the run reference. A double-click records one submission.</p>
              </div>
            </div>
            <DocLinks links={[{ href: "/docs/tasks/forms#buttons-and-behaviours", label: "Buttons and behaviours" }, { href: "/docs/tasks/forms#header", label: "Headers" }]} />
          </div>
        </section>

        {/* Themes */}
        <section id="themes" className="scroll-mt-8 border-t border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[2fr_3fr]">
            <div>
              <SectionHeading eyebrow="Themes" title="Your brand on every surface of the form.">
                Forms follow your workspace theme in light and dark. Give one a mini theme — accent, page background or gradient, inputs, borders, buttons, radius, font, density, label position — and it applies to the page, the task, the preview and the success screen.
              </SectionHeading>
              <Points items={[
                "Start from a preset, save themes and reuse them across forms",
                "Separate light and dark colours",
                "Every text and background pair kept legible (AA contrast), with an Auto-fix for low-contrast pairs",
              ]} />
              <DocLinks links={[{ href: "/docs/tasks/forms#themes-the-workspace-theme-and-mini-themes", label: "Form themes" }, { href: "/docs/governance/workspace-theme", label: "Workspace theme" }]} />
            </div>
            <Shot name="forms-theme" alt="The designer previewing a form at phone width with a custom mini theme: bronze accent, cream page and a header with the workspace logo" sizes="(min-width: 1024px) 650px, 100vw" />
          </div>
        </section>

        {/* Form pages, QR, trigger */}
        <section id="form-pages" className="scroll-mt-8 border-t border-[#1B1916]/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Form pages and the Form submitted trigger" title="A link, a QR code — and a workflow on every submission.">
              Every reusable form has its own page. Share the link, print the QR code on a poster or a tablet stand, and let the Form submitted trigger start a workflow with the values.
            </SectionHeading>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {[
                { icon: Link2, title: "Form pages", body: "/f/<id> for signed-in members, with the header, grid, theme, lookups and buttons. Submissions are listed, exported to CSV and kept as long as you choose." },
                { icon: QrCode, title: "QR codes", body: "Download PNG or SVG, with or without the name and link under the code. Dark on a white card with a quiet zone, so it scans on screen and in print." },
                { icon: FileInput, title: "Publish as form page", body: "Turn a workflow's start form into a page in one click. It stays in sync with the published version and starts the workflow as the person who submits." },
              ].map(({ icon: Icon, title, body }) => (
                <article key={title} className="rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF]/70 p-5">
                  <Icon size={20} className="text-[#8A6D45]" aria-hidden="true" />
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-[#4A463E]">{body}</p>
                </article>
              ))}
            </div>
            <div className="mt-10">
              <Shot name="forms-trigger" alt="A workflow whose Form submitted trigger is linked to the Customer return form, with the form page link, Copy link, Open form, QR code and every form variable listed" sizes="(min-width: 1152px) 1104px, 100vw" />
            </div>
            <DocLinks links={[{ href: "/docs/tasks/forms#the-form-submitted-trigger", label: "The Form submitted trigger" }, { href: "/docs/tasks/forms#form-pages-and-qr-codes", label: "Form pages and QR codes" }, { href: "/docs/tasks/forms#start-forms-and-task-triggers", label: "Publish as form page" }]} />
          </div>
        </section>

        {/* Downstream */}
        <section id="downstream" className="scroll-mt-8 border-t border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[3fr_2fr]">
            <Shot name="forms-data-picker" alt="The Data panel docked beside a Log step, listing the Customer return form's fields with their keys and types" sizes="(min-width: 1024px) 650px, 100vw" />
            <div>
              <SectionHeading eyebrow="Values downstream" title="Every field, typed, in the next step.">
                The Data panel lists the form's fields first — label, key and type — at every step. Drag one onto a setting, or click to insert it.
              </SectionHeading>
              <div className="mt-6">
                <Snippet language="text" code={`{{form.order_number}}          "10248"
{{form.refund_amount}}         412.5
{{form.customer_item.city}}    "Marseille"
{{form.photos_count}}          3
{{task_data.approved_amount}}  after a User Task`} />
              </div>
              <DocLinks links={[{ href: "/docs/tasks/forms#use-the-values-downstream-the-data-panel-and-drag-and-drop", label: "Data panel and drag and drop" }, { href: "/docs/tasks/forms#keys-and-downstream-data", label: "Keys and downstream data" }]} />
            </div>
          </div>
        </section>

        {/* Library, versions, testing, server validation */}
        <section id="library" className="scroll-mt-8 border-t border-[#1B1916]/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Reuse, version and test" title="Build a form once. Change it safely." />
            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Library, title: "Forms library", body: "Search and tag forms, see which steps use each one, duplicate, export and import. Link a form from any User Task, or detach a local copy." },
                { icon: CalendarClock, title: "Versions", body: "Every change to fields, layout or theme is a new version. Drafts follow the latest; publishing a workflow pins the version it uses." },
                { icon: FlaskConical, title: "Test with the real form", body: "Save & Test draws the form exactly as people see it, checks it on the server and starts a test run. Test cases remember what you entered." },
                { icon: ShieldCheck, title: "Validated on the server", body: "The page, the task screen, the API, MCP, the CLI and test runs all go through the same checks. Read-only fields keep their value." },
              ].map(({ icon: Icon, title, body }) => (
                <article key={title} className="rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF]/70 p-5">
                  <Icon size={20} className="text-[#8A6D45]" aria-hidden="true" />
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-[#4A463E]">{body}</p>
                </article>
              ))}
            </div>
            <div className="mt-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
              <div>
                <h3 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">Forms as code, too.</h3>
                <p className="mt-3 leading-7 text-[#4A463E]">Forms, form themes and submissions have REST endpoints, MCP tools and CLI commands, and travel with config as code, GitHub sync and packages. Upload files and submit with the same checks as the browser.</p>
                <DocLinks links={[{ href: "/docs/tasks/forms#reusable-forms", label: "Reusable forms" }, { href: "/docs/tasks/forms#test-with-the-real-form-save--test-and-run", label: "Testing with forms" }]} />
              </div>
              <Snippet code={`usertasks forms create -f customer-return.json
usertasks forms submit <form id> \\
  --set values:='{"order_number":"10248","refund_amount":412.5}' \\
  --attach photos=./carton.jpg --attach photos=./delivery-note.pdf
usertasks forms submissions <form id> -o json`} />
            </div>
          </div>
        </section>

        {/* Gallery */}
        <section id="packages" className="scroll-mt-8 border-t border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Package gallery" title="Start from a form that already works.">
              {formPackageCount} gallery packages start from a form — form pages with their own header and theme, grid task forms, and the workflow behind them. Install one and change it in the designer.
            </SectionHeading>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {formPackages.map((pkg) => (
                <li key={pkg.slug}>
                  <Link href={`/gallery/${pkg.slug}`} className="group flex h-full flex-col rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF] p-5 transition hover:border-[#8A6D45]/40 hover:shadow-md">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#8A6D45]">Form page</span>
                    <span className="mt-1 font-semibold">{pkg.title}</span>
                    <span className="mt-2 flex-1 text-sm leading-6 text-[#4A463E]">{pkg.summary}</span>
                    <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#8A6D45] group-hover:underline">See the package <ArrowRight size={14} aria-hidden="true" /></span>
                  </Link>
                </li>
              ))}
            </ul>
            <DocLinks links={[{ href: "/gallery?trigger=form", label: "Every form-started package" }]} />
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
          <h2 className="text-center font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">Questions</h2>
          <div className="mt-8 space-y-3">
            {FAQS.map((faq) => (
              <details key={faq.question} className="group rounded-xl border border-[#1B1916]/[0.08] bg-[#F1EDE3] p-5">
                <summary className="cursor-pointer list-none font-semibold">{faq.question}</summary>
                <p className="mt-3 text-sm leading-7 text-[#6E6759]">{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="rounded-3xl border border-[#1B1916]/10 bg-gradient-to-br from-[#17150F]/[0.06] via-transparent to-[#B08A54]/[0.12] p-8 text-center sm:p-14">
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl">Build your first form in five minutes.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-[#4A463E]">Fields on a grid, a button that starts a workflow, a page with a QR code. The guide walks through it step by step.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/docs/tasks/forms#build-your-first-form-in-5-minutes" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#17150F] px-6 py-3 font-semibold text-[#FAF8F3] hover:bg-[#2E2A24]">Forms guide <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link href="/documents" className="inline-flex items-center justify-center rounded-lg border border-[#1B1916]/15 px-6 py-3 font-medium text-[#33302A] hover:border-[#1B1916]/30">Document actions</Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
