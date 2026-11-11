import type { CSSProperties, ReactNode } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  Accessibility,
  ArrowRight,
  AtSign,
  Calendar,
  CalendarClock,
  Check,
  CheckSquare,
  CircleDot,
  Code2,
  DollarSign,
  FileInput,
  FlaskConical,
  Hash,
  Heading,
  KeyRound,
  Library,
  Link2,
  ListChecks,
  Minus,
  Paperclip,
  Phone,
  Puzzle,
  QrCode,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  Type,
  AlignLeft,
  User,
  Zap,
} from "lucide-react"
import { ProductHero } from "@/components/marketing/product-hero"
import { MarketingFooter, MarketingHeader, SectionHeading, Shot, Snippet } from "@/components/marketing/marketing-ui"
import { SCREENSHOTS } from "@/lib/docs/screenshots"
import { FORMS_PAGE } from "@/lib/marketing-pages"
import { GALLERY_CONTROLS, GALLERY_PACKAGES } from "@/lib/gallery/site"
import { ControlsTeaser } from "@/components/gallery/control-pages"
import { useCasesInGroup } from "@/lib/use-cases"

/**
 * /forms — the grid form designer, field types (lookups, attachments),
 * buttons, headers, themes, form pages with QR codes, the Form submitted
 * trigger, sharing and embedding, the form sign-in page, rules, lazy
 * loading, testing with the real form, custom controls and the
 * accessibility checker. Server-rendered; screenshots are
 * the Northwind demo workspace (scripts/screenshots).
 */

const SITE_URL = "https://usertasks.com"


const THEME = {
  "--theme-card-bg": "var(--mkt-white)",
  "--theme-card-text": "var(--mkt-ink)",
  "--theme-surface": "var(--mkt-canvas)",
  "--theme-surface-border": "var(--mkt-line)",
  "--theme-muted-text": "var(--mkt-muted)",
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
  { icon: Table2, label: "Data table", note: "query, select or edit rows" },
  { icon: Paperclip, label: "Attachments", note: "several files" },
  { icon: Heading, label: "Section heading", note: "layout" },
  { icon: Minus, label: "Divider", note: "layout" },
]

const SURVEY_CONTROLS = ["Star rating", "NPS (0 to 10)", "Agreement scale", "Matrix / grid", "Slider", "Satisfaction faces", "Ranking", "Picture choice", "Yes / No / Maybe"]

const BEHAVIOURS = [
  { step: "Show message", body: "A message under the form, with the submitted values filled in." },
  { step: "Show success screen", body: "Replace the form with a title, text and a Submit another, Close or link button." },
  { step: "Start workflow", body: "Start any workflow with the form's values mapped to its inputs — on the server, attributed to whoever submitted." },
  { step: "Redirect", body: "Go to an app page or an address on your allow list." },
  { step: "Close form", body: "Close the form." },
]

/** The control framework, as built (lib/forms/custom-controls): every claim here is in the code. */
const CONTROL_FRAMEWORK = [
  { icon: Puzzle, title: "Web components, your way", body: "A standard custom element built with Lit, plain JavaScript or any framework that compiles to one, plus a manifest. Upload it in Extensibility → Form controls and it joins the designer's palette under Custom." },
  { icon: FileInput, title: "A typed contract", body: "Values are string, number, boolean, date, JSON, a list or files, checked against the control's JSON schema on the server. Properties (text, number, select, colour, lists, JSON…) become a generated properties panel." },
  { icon: Check, title: "Behaves like a built-in field", body: "Required and validity, the form theme as --ut-* tokens in light and dark, the field label as the accessible name, keyboard and role metadata, and a text formatter for read-only views." },
  { icon: ShieldCheck, title: "Sandboxed, capability-gated", body: "Each instance runs in its own frame with a strict CSP and no network. Lookups, file uploads and reads, saved reports and approved network hosts are granted per capability; map tiles come through the server." },
  { icon: Library, title: "Versioned and signed", body: "Every upload is an immutable version with its SHA-256 checksum and an optional ed25519 signature. Forms keep their version until a designer upgrades; controls travel in packages and config as code." },
  { icon: Zap, title: "Everywhere forms run", body: "Task forms, form pages, start forms, steps and tabs, Save & Test and Run, with the value read-only on completed tasks and mobile. Values reach the workflow typed, as {{form.<key>}} and {{task_data.<key>}}." },
]

const FAQS = [
  { question: "Where can a form be used?", answer: "On a User Task (what the assignee fills in), as a workflow's start form (the Run dialog, Save & Test, API and CLI starts), as a reusable form on its own page (/f/<id>, or a friendly link on your workspace address) with a QR code and an embed code for your website, and as the form a task trigger declares. One designer builds all of them." },
  { question: "How does a form start a workflow?", answer: "Two ways. Add a Form submitted trigger to a workflow and choose the form: every submission — from its page, the API, MCP or a linked User Task — starts a run with the values as {{form.<key>}}. Or give a button a Start workflow behaviour that maps the form's values to another workflow's inputs." },
  { question: "Can I put a form on my own website?", answer: "Yes. The form's QR code dialog has Embed in a website: copy an iframe for the form's link, and optionally a small script for your page that sizes the frame to the form. Public (anonymous) forms can be filled in right on your page. Forms that need sign-in can't be filled in inside another site, because browsers don't keep sign-ins in third-party frames, so the frame offers to open the form in a new tab." },
  { question: "Is validation only in the browser?", answer: "No. Every way of submitting — the form page, the task screen, the REST API, MCP, the CLI and test runs — is checked on the server against the form: types, required fields, ranges, patterns, options, people, lookup values and attachments. Invalid values are refused with one message per field." },
  { question: "Which files can people upload?", answer: "An Attachments field sets how many files, how large and which kinds (documents, images, spreadsheets, PDF only or any safe file). Files are checked by their content, stored in private storage, never served publicly and can be scanned with ClamAV. Workflows then loop over them, email them, upload them or read them with document actions." },
  { question: "Can I build my own form controls?", answer: "Yes. The custom control framework turns any web component — built with Lit or plain JavaScript — into a form field: upload it with a manifest in Extensibility → Form controls and it appears in the designer under Custom, with a properties panel generated from its manifest. It runs in a sandboxed frame with no network access unless an admin approves hosts, can use lookups, files and saved reports when it declares them, and its values are validated on the server like any field. The starter kit has a Lit and a plain JavaScript example, a dev harness and packaging scripts, and the gallery has official controls to install or learn from." },
  { question: "Can I build forms from code?", answer: "Yes. Forms, form themes and submissions have REST endpoints, MCP tools and usertasks CLI commands, and travel with config as code, GitHub sync and packages. The designer writes the same JSON you can send." },
]

function Pill({ icon: Icon, children }: { icon: typeof Type; children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-(color:--mkt-bronze)/30 bg-(color:--mkt-gold)/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-(color:--mkt-bronze)">
      <Icon size={13} aria-hidden="true" /> {children}
    </p>
  )
}

function Points({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-6 space-y-2 text-sm leading-6 text-(color:--mkt-text)">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" /><span>{item}</span></li>
      ))}
    </ul>
  )
}

function DocLinks({ links }: { links: Array<{ href: string; label: string }> }) {
  return (
    <p className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">{link.label} <ArrowRight size={14} aria-hidden="true" /></Link>
      ))}
    </p>
  )
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-(color:--mkt-ink)/[0.06] px-1 py-0.5 font-mono text-[0.85em] text-(color:--mkt-ink-soft)">{children}</code>
}

export function FormsPage() {
  const formPackages = GALLERY_PACKAGES.filter((pkg) => pkg.trigger === "form" && (pkg.forms ?? []).some((form) => form.kind === "page")).slice(0, 6)
  const formPackageCount = GALLERY_PACKAGES.filter((pkg) => pkg.trigger === "form").length
  const officialControlCount = GALLERY_CONTROLS.filter((control) => control.kind === "form_control").length
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
    <div className="mkt relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)" style={THEME}>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-(color:--mkt-paper)" aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <MarketingHeader tone="night" />

      <main>
        {/* Hero */}
        <ProductHero
          crumb="Forms"
          eyebrow="Forms"
          icon={FileInput}
          title={<>Forms that do <span className="mkt-gradient-text">the typing for you.</span></>}
          intro={<>Design a form on a grid, with lookups into your data and APIs, file uploads, buttons, a header and your theme. Share it as a link on your workspace's own address, embed it in your website or print a QR code, start a workflow every time it is submitted, and use each value in the steps that follow — <strong className="text-white">checked on the server</strong>, whoever sends it.</>}
          primary={{ href: "/docs/tasks/forms#build-your-first-form-in-5-minutes", label: "Build your first form" }}
          secondary={{ href: "/gallery?trigger=form", label: `${formPackageCount} form-started packages` }}
          scenes={["form", "task", "table"]}
          bullets={["One designer for task forms, start forms and form pages", "Every submission validated on the server", "Values typed and ready in the next step"]}
        />
        <section className="relative">
          <div className="mx-auto max-w-6xl px-4 pb-6 pt-14 sm:px-6">
            <div className="mt-12">
              <Shot name="forms-designer" alt="The UserTasks form designer: a palette of field types, a grid of rows with one to four columns, and the settings of an Attachments field" sizes="(min-width: 1152px) 1104px, 100vw" priority />
            </div>
            <ul className="mt-8 grid gap-3 text-sm text-(color:--mkt-text) sm:grid-cols-3">
              {[
                [FileInput, "One designer for task forms, start forms and form pages"],
                [ShieldCheck, "Every submission validated on the server"],
                [Zap, "Values typed and ready in the next step"],
              ].map(([Icon, text]) => {
                const I = Icon as typeof Type
                return <li key={text as string} className="flex items-start gap-2"><I size={16} className="mt-0.5 shrink-0 text-(color:--mkt-bronze)" aria-hidden="true" />{text as string}</li>
              })}
            </ul>
          </div>
        </section>

        {/* Form wizard */}
        <section id="wizard" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Form wizard" title="No designer needed: a form, its data and its approvals in seven steps.">
              Pick a starting point — a request, survey, quiz, registration, feedback or incident form — and answer a few plain questions. The wizard creates the form, a data table for the responses, an optional review or approval workflow and a results page with charts, all linked and all editable in the full designers later.
            </SectionHeading>
            <Points items={[
              "Questions in plain words: short answer, choice, rating, recommend score, yes / no, money, date, file upload and more",
              "\u201cShow this question only if\u2026\u201d, page breaks, one question at a time and quiz scoring",
              "Approval by a person, the requester\u2019s manager, a team or several stages — the decision is written back and emailed",
              "A results page with response counts, approval rate and charts, for the people you choose",
              "Change it later: new questions add columns, collected answers are never removed",
            ]} />
            <DocLinks links={[{ href: "/docs/tasks/form-wizard", label: "Build a form with the wizard" }, { href: "/docs/tutorials", label: "Tutorials" }]} />
            <div className="mt-10 flex flex-col gap-4 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-gradient-to-br from-(color:--mkt-primary)/[0.04] to-(color:--mkt-gold)/[0.10] p-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <h3 className="flex items-center gap-2 text-lg font-semibold"><Sparkles size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />Agent on your forms and in the designer</h3>
                <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">With your own AI provider key, Agent helps people fill a form: it answers questions, explains validation errors and proposes values they apply. It never submits. In the form designer it proposes fields and rules, and every change waits for your confirmation.</p>
              </div>
              <Link href="/ai-assistants" className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline">Agent, your AI co-worker <ArrowRight size={14} aria-hidden="true" /></Link>
            </div>
          </div>
        </section>

        {/* Grid */}
        <section id="grid" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
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
                "Multi-step forms and tabs: a stepper or progress bar, Next that checks each step, conditional steps, an optional review step — one submission, same values",
              ]} />
              <DocLinks links={[{ href: "/docs/tasks/forms#grid-layout", label: "Grid layout" }, { href: "/docs/tasks/forms#steps-and-tabs", label: "Steps and tabs" }, { href: "/docs/tasks/forms#the-form-designer", label: "The form designer" }]} />
            </div>
            <figure className="mx-auto w-[260px] shrink-0 sm:w-[300px]">
              <div className="overflow-hidden rounded-[2rem] border-[6px] border-(color:--mkt-primary) bg-(color:--mkt-white) shadow-[0_20px_60px_rgba(27,25,22,0.18)]">
                <Image src={SCREENSHOTS["forms-phone"]} alt="The Customer return form on a phone: every row collapsed to one column" sizes="300px" placeholder="blur" className="h-auto w-full" />
              </div>
              <figcaption className="mt-3 text-center text-sm text-(color:--mkt-muted)">The same form at phone width.</figcaption>
            </figure>
          </div>
        </section>

        {/* Field types + lookup */}
        <section id="fields" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Field types" title="Every field a real process needs.">
              Eighteen types plus nine survey controls, each with its own validation, help text, default value (expressions welcome), read-only and <em>visible when</em> rules.
            </SectionHeading>
            <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Field types">
              {FIELD_TYPES.map(({ icon: Icon, label, note }) => (
                <li key={label} className={`rounded-xl border p-3 ${label === "Autocomplete / lookup" || label === "Attachments" || label === "Data table" ? "border-(color:--mkt-bronze)/35 bg-(color:--mkt-gold)/[0.08]" : "border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70"}`}>
                  <Icon size={16} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                  <span className="mt-2 block text-sm font-semibold leading-5">{label}</span>
                  <span className="block text-xs leading-5 text-(color:--mkt-muted)">{note}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-5">
              <h3 className="font-semibold">Survey controls, built in</h3>
              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Survey controls">
                {SURVEY_CONTROLS.map((label) => <li key={label} className="rounded-full border border-(color:--mkt-ink)/10 bg-(color:--mkt-paper) px-2.5 py-1 text-xs font-medium text-(color:--mkt-ink-soft)">{label}</li>)}
              </ul>
              <p className="mt-3 text-sm leading-6 text-(color:--mkt-text)">They work in the designer, the wizard, task forms, public forms and embeds, in rules and validation, and save to data tables and reports, where summary charts count and average them.</p>
              <DocLinks links={[{ href: "/docs/tasks/survey-controls", label: "Survey controls and charts" }, { href: "/docs/reports#summary-charts", label: "Report summary charts" }]} />
            </div>
            <div className="mt-14 grid grid-cols-1 items-center gap-10 lg:grid-cols-[2fr_3fr]">
              <div>
                <h3 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Lookups into your data and your APIs.</h3>
                <p className="mt-4 leading-7 text-(color:--mkt-text)">An autocomplete field suggests as people type — from a data table, or from any API reference you have connected. Picking a customer can fill in their email and phone.</p>
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

        {/* Data tables */}
        <section id="data-tables" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[2fr_3fr]">
            <div>
              <SectionHeading eyebrow="Data tables" title="Tables of live data — searched, picked and edited in the form.">
                Put rows from a data table or an API on a form. People search, filter, sort and page on the server, pick rows, or edit cells and add rows — and a &ldquo;for each changed row&rdquo; rule writes the changes back.
              </SectionHeading>
              <Points items={[
                "You choose the columns, formats, base filter and sort; people can only narrow it",
                <>Filters use form values, the current user or dates (<Code>{"{{today-30d}}"}</Code>)</>,
                "Update a data table, call an API or start a workflow per changed row — once per submission",
                "Only the selected columns leave the server; credentials never do",
              ]} />
              <DocLinks links={[{ href: "/docs/tasks/forms#data-table-fields", label: "Data table fields" }, { href: "/docs/tasks/forms#for-each-changed-row", label: "For each changed row" }]} />
            </div>
            <Shot name="forms-data-table" alt="A form with a Data table of vendors: search, a Risk filter, a Name sort and status badges" sizes="(min-width: 1024px) 650px, 100vw" />
          </div>
        </section>

        {/* Attachments */}
        <section id="attachments" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
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
              <p className="mt-6 rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-4 text-sm leading-6 text-(color:--mkt-text)">
                Then read them: <Link href="/documents" className="font-semibold text-(color:--mkt-bronze) hover:underline">document actions</Link> turn an uploaded Word, Excel, PowerPoint or PDF file into text, rows and structure in the next step.
              </p>
              <DocLinks links={[{ href: "/docs/tasks/forms#attachments", label: "Attachments" }, { href: "/docs/tasks/forms#how-files-are-kept-safe", label: "How files are kept safe" }]} />
            </div>
          </div>
        </section>

        {/* Buttons and headers */}
        <section id="buttons" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Buttons, behaviours and headers" title="Decide what happens when someone presses Submit.">
              Rename buttons, style them, add outcome buttons that complete a task, a Save draft button or more submit buttons. Each one runs its steps in order — and a header with your logo, a title and a subtitle sits above the fields.
            </SectionHeading>
            <div className="mt-10 grid grid-cols-1 items-start gap-8 lg:grid-cols-[2fr_3fr]">
              <ol className="space-y-3">
                {BEHAVIOURS.map((item, index) => (
                  <li key={item.step} className="flex gap-4 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-4">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(color:--mkt-primary) text-xs font-bold text-(color:--mkt-paper)">{index + 1}</span>
                    <div><h3 className="font-semibold">{item.step}</h3><p className="mt-0.5 text-sm leading-6 text-(color:--mkt-text)">{item.body}</p></div>
                  </li>
                ))}
              </ol>
              <div className="min-w-0">
                <Shot name="forms-buttons" alt="The Buttons and header tab: a header with the workspace logo, title and subtitle, and a Submit return button that shows a success screen" sizes="(min-width: 1024px) 650px, 100vw" />
                <p className="mt-3 text-sm leading-6 text-(color:--mkt-muted)">Typical chains: <em>Submit → Start workflow → Show success screen</em> with the run reference. A double-click records one submission.</p>
              </div>
            </div>
            <DocLinks links={[{ href: "/docs/tasks/forms#buttons-and-behaviours", label: "Buttons and behaviours" }, { href: "/docs/tasks/forms#header", label: "Headers" }]} />
          </div>
        </section>

        {/* Themes */}
        <section id="themes" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
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

        {/* Rules, test inputs, loading and motion */}
        <section id="rules" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[2fr_3fr]">
              <div>
                <SectionHeading eyebrow="Rules" title="Forms that react as people fill them in.">
                  When something happens, check a condition, then act: show or hide a field, set or calculate a value, call an API, show a message, or make a field, section, tab or the whole form read only.
                </SectionHeading>
                <Points items={[
                  "Read-only fields keep their value and normal look, stay selectable and are announced as read only",
                  <>Parameters from the link (<Code>{"?customer_id=ALFKI"}</Code>) can prefill fields through an API reference</>,
                  "Test parameters and variables in the designer's Preview, then copy the link with those values",
                ]} />
                <DocLinks links={[{ href: "/docs/tasks/forms#rules", label: "Form rules" }, { href: "/docs/tasks/forms#parameters-and-variables", label: "Parameters and variables" }]} />
              </div>
              <Shot name="forms-rules-runtime" alt="A Customer account review form: clicking a customer row filled the name, contact and city fields and switched to the Details tab" sizes="(min-width: 1024px) 650px, 100vw" />
            </div>
            <div className="mt-14 grid grid-cols-1 items-center gap-10 lg:grid-cols-[3fr_2fr]">
              <Shot name="form-lazy-load" alt="The form designer with a tab selected and its When to load setting on When first shown, with Preload in background ticked" sizes="(min-width: 1024px) 650px, 100vw" />
              <div>
                <h3 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Long forms that open fast, and move gently.</h3>
                <p className="mt-4 leading-7 text-(color:--mkt-text)">Each tab, step or section can load when it is first shown or when a rule loads it. Until then its tables, lookups and custom controls don&apos;t run, and a skeleton stands in.</p>
                <Points items={[
                  "Values, defaults and required checks don't depend on what has loaded",
                  "Animations per form: None, Subtle or Expressive",
                  "Nothing moves when the device asks for reduced motion",
                ]} />
                <DocLinks links={[{ href: "/docs/tasks/forms#when-to-load-faster-forms", label: "When to load" }, { href: "/docs/tasks/forms#animations", label: "Animations" }]} />
              </div>
            </div>
          </div>
        </section>

        {/* Form pages, QR, trigger */}
        <section id="form-pages" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Share, embed and the Form submitted trigger" title="A link, an embed, a QR code — and a workflow on every submission.">
              Every reusable form opens on its own page, without the app around it. Share the link, put the form on your website, print the QR code on a poster or a tablet stand, and let the Form submitted trigger start a workflow with the values.
            </SectionHeading>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {[
                { icon: Link2, title: "Form pages and friendly links", body: "Each form opens on its own page with its header, theme, lookups and buttons. On your workspace address it also has a readable link, acme.usertasks.com/form/employee-onboarding, that keeps working after a rename." },
                { icon: Code2, title: "Embed in your website", body: "Copy an iframe from the QR code dialog. The form shows on a transparent page, and an optional script sizes the frame to fit. Public forms work anywhere; forms that need sign-in offer to open in a new tab." },
                { icon: KeyRound, title: "Your form sign-in page", body: "Visitors who need to sign in get a page you design: ten layouts, your logo and wording, password and single sign-on, or the workspace theme. Then they go straight back to the form." },
                { icon: QrCode, title: "QR codes", body: "Download PNG or SVG, with or without the name and link under the code. Dark on a white card with a quiet zone, so it scans on screen and in print." },
                { icon: FileInput, title: "Publish as form page", body: "Turn a workflow's start form into a page in one click. It stays in sync with the published version and starts the workflow as the person who submits." },
                { icon: Library, title: "Submissions", body: "Listed per form, exported to CSV as a background job, and kept as long as you choose, or as long as a retention policy says." },
              ].map(({ icon: Icon, title, body }) => (
                <article key={title} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-5">
                  <Icon size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{body}</p>
                </article>
              ))}
            </div>
            <div className="mt-10">
              <Shot name="forms-trigger" alt="A workflow whose Form submitted trigger is linked to the Customer return form, with the form page link, Copy link, Open form, QR code and every form variable listed" sizes="(min-width: 1152px) 1104px, 100vw" />
            </div>
            <DocLinks links={[{ href: "/docs/tasks/forms#sharing-and-embedding-forms", label: "Sharing and embedding" }, { href: "/docs/tasks/forms#friendly-form-links", label: "Friendly form links" }, { href: "/docs/tasks/forms#form-sign-in-page", label: "Form sign-in page" }, { href: "/docs/tasks/forms#the-form-submitted-trigger", label: "The Form submitted trigger" }, { href: "/docs/tasks/forms#form-pages-and-qr-codes", label: "QR codes" }]} />
          </div>
        </section>

        {/* Downstream */}
        <section id="downstream" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
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
        <section id="library" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Reuse, version and test" title="Build a form once. Change it safely." />
            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Library, title: "Forms library", body: "Search and tag forms, see which steps use each one, duplicate, export and import. Link a form from any User Task, or detach a local copy." },
                { icon: CalendarClock, title: "Versions", body: "Every change to fields, layout or theme is a new version. Drafts follow the latest; publishing a workflow pins the version it uses." },
                { icon: FlaskConical, title: "Test with the real form", body: "Save & Test draws the form exactly as people see it, checks it on the server and starts a test run. Test cases remember what you entered." },
                { icon: ShieldCheck, title: "Validated on the server", body: "The page, the task screen, the API, MCP, the CLI and test runs all go through the same checks. Read-only fields keep their value." },
              ].map(({ icon: Icon, title, body }) => (
                <article key={title} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-5">
                  <Icon size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{body}</p>
                </article>
              ))}
            </div>
            <div className="mt-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
              <div>
                <h3 className="font-display text-2xl font-bold tracking-tight">Forms as code, too.</h3>
                <p className="mt-3 leading-7 text-(color:--mkt-text)">Forms, form themes and submissions have REST endpoints, MCP tools and CLI commands, and travel with config as code, GitHub sync and packages. Upload files and submit with the same checks as the browser.</p>
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

        {/* The control framework: build any control */}
        <section id="custom-controls" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50" data-testid="forms-control-framework">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Custom control framework" title="Build any control you need.">
              When a built-in field isn&apos;t enough, build your own: a seat map, a product configurator, a body diagram, a barcode scanner — whatever the process calls for. The UserTasks control framework turns a web component into a form field that works everywhere forms run, sandboxed and validated like any other.
            </SectionHeading>
            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {CONTROL_FRAMEWORK.map(({ icon: Icon, title, body }) => (
                <article key={title} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-5">
                  <Icon size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{body}</p>
                </article>
              ))}
            </div>
            <div className="mt-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
              <div className="min-w-0">
                <h3 className="font-display text-2xl font-bold tracking-tight">Start from the kit.</h3>
                <p className="mt-3 leading-7 text-(color:--mkt-text)">A star rating in Lit + TypeScript and in plain JavaScript, a dev harness that plays the form and logs every event, and scripts that build and package one self-contained module to upload. Prefer a library? The <code className="font-mono text-ui">@user-tasks/form-control</code> package in the repository has the contract types, a vanilla base element and a Lit mixin. Or start from one of the {officialControlCount} official controls in the gallery — their sources are in the repository too.</p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <a href="/downloads/form-control-starter.zip" download className="inline-flex items-center gap-2 rounded-lg bg-(color:--mkt-primary) px-5 py-2.5 text-sm font-semibold text-(color:--mkt-paper) hover:bg-(color:--mkt-primary-hover)" data-testid="forms-starter-kit">Download the starter kit</a>
                  <Link href="/docs/tasks/custom-form-controls" className="inline-flex items-center gap-1 rounded-lg border border-(color:--mkt-ink)/15 px-5 py-2.5 text-sm font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">Read the guide <ArrowRight size={14} aria-hidden="true" /></Link>
                  <Link href="/gallery/controls" className="inline-flex items-center gap-1 rounded-lg border border-(color:--mkt-ink)/15 px-5 py-2.5 text-sm font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">Official controls <ArrowRight size={14} aria-hidden="true" /></Link>
                </div>
              </div>
              <div className="min-w-0">
                <Snippet code={`cd form-control-starter/lit-ts
npm install
npm run dev       # harness on localhost:5180
npm run package   # release/ut-star-rating-1.0.0.zip
# upload it in Extensibility → Form controls`} />
              </div>
            </div>
            <figure className="mt-10">
              <Shot name="forms-control-harness" sizes="(min-width: 1152px) 1104px, 100vw" alt="The form control starter kit's dev harness: a star rating control on the left, its properties, theme switch and a log of the messages it exchanges with the form on the right" />
              <figcaption className="mt-3 text-sm leading-6 text-(color:--mkt-muted)">The starter kit&apos;s harness plays the part of the form: edit properties and context, switch light and dark, toggle disabled, read-only, required and invalid, answer lookups, and watch every event the control sends.</figcaption>
            </figure>
          </div>
        </section>

        {/* Accessibility */}
        <section id="accessibility" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Accessibility" title="Accessible by default.">
              Before anyone fills a form in, check it against WCAG 2.2 AA.
            </SectionHeading>
            <article className="mt-8 max-w-3xl rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-5">
              <Accessibility size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
              <h3 className="mt-3 font-semibold">Accessibility checker</h3>
              <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">A score and findings by severity with their WCAG success criteria: labels, help text, errors, contrast of the theme, focus order, target size, input purpose and more. Fix buttons apply safe fixes, an axe-core scan covers the live preview, and a minimum score can gate publishing.</p>
            </article>
            <div className="mt-6 max-w-3xl"><Snippet code={`usertasks forms check-accessibility <form id>`} /></div>
            <DocLinks links={[{ href: "/docs/tasks/forms#accessibility-checker", label: "Accessibility checker" }]} />
          </div>
        </section>

        {/* Ready-made controls (gallery/controls) */}
        {GALLERY_CONTROLS.length > 0 && (
          <section id="ready-made-controls" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
              <SectionHeading eyebrow="Ready-made controls" title="Charts, address search, maps, signatures — installed in a minute.">
                Not building your own? The gallery has official form controls: charts and saved reports, Google Places address search (the API key stays on the server), OpenStreetMap maps, signatures, ratings, sliders, rich text, editable tables, Likert surveys and a PDF viewer. Each installs into Extensibility → Form controls from Browse gallery, is sandboxed like any custom control, and is keyboard and screen-reader accessible.
              </SectionHeading>
              <div className="mt-8"><ControlsTeaser limit={6} heading={false} /></div>
              <div className="mt-10" data-testid="forms-control-use-cases">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">See them at work</p>
                <h3 className="mt-2 font-display text-2xl font-bold tracking-tight">Six processes built on these controls</h3>
                <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {useCasesInGroup("forms").map((useCase) => (
                    <li key={useCase.slug}>
                      <Link href={`/use-cases/${useCase.slug}`} className="group flex h-full flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5 transition hover:border-(color:--mkt-bronze)/40 hover:shadow-md">
                        <span className="text-xs font-semibold uppercase tracking-wider text-(color:--mkt-bronze)">{useCase.eyebrow}</span>
                        <span className="mt-1 font-semibold">{useCase.title}</span>
                        <span className="mt-2 flex-1 text-sm leading-6 text-(color:--mkt-text)">{useCase.summary}</span>
                        <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) group-hover:underline">The use case <ArrowRight size={14} aria-hidden="true" /></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <Link href="/gallery/controls" className="mt-6 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline" data-testid="forms-ready-made-controls">Browse all {GALLERY_CONTROLS.length} form controls →</Link>
            </div>
          </section>
        )}

        {/* Gallery */}
        <section id="packages" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Package gallery" title="Start from a form that already works.">
              {formPackageCount} gallery packages start from a form — form pages with their own header and theme, grid task forms, and the workflow behind them. Install one and change it in the designer.
            </SectionHeading>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {formPackages.map((pkg) => (
                <li key={pkg.slug}>
                  <Link href={`/gallery/${pkg.slug}`} className="group flex h-full flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5 transition hover:border-(color:--mkt-bronze)/40 hover:shadow-md">
                    <span className="text-xs font-semibold uppercase tracking-wider text-(color:--mkt-bronze)">Form page</span>
                    <span className="mt-1 font-semibold">{pkg.title}</span>
                    <span className="mt-2 flex-1 text-sm leading-6 text-(color:--mkt-text)">{pkg.summary}</span>
                    <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) group-hover:underline">See the package <ArrowRight size={14} aria-hidden="true" /></span>
                  </Link>
                </li>
              ))}
            </ul>
            <DocLinks links={[{ href: "/gallery?trigger=form", label: "Every form-started package" }]} />
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
          <h2 className="text-center font-display text-3xl font-bold tracking-tight">Questions</h2>
          <div className="mt-8 space-y-3">
            {FAQS.map((faq) => (
              <details key={faq.question} className="group rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) p-5">
                <summary className="cursor-pointer list-none"><h3 className="inline font-semibold">{faq.question}</h3></summary>
                <p className="mt-3 text-sm leading-7 text-(color:--mkt-muted)">{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="rounded-3xl border border-(color:--mkt-ink)/10 bg-gradient-to-br from-(color:--mkt-primary)/[0.06] via-transparent to-(color:--mkt-gold)/[0.12] p-8 text-center sm:p-14">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Build your first form in five minutes.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-(color:--mkt-text)">Fields on a grid, a button that starts a workflow, a page with a QR code. The guide walks through it step by step.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/docs/tasks/forms#build-your-first-form-in-5-minutes" className="inline-flex items-center justify-center gap-2 rounded-lg bg-(color:--mkt-primary) px-6 py-3 font-semibold text-(color:--mkt-paper) hover:bg-(color:--mkt-primary-hover)">Forms guide <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link href="/documents" className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">Document actions</Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
