import Link from "next/link"
import { ArrowRight, Cpu, Download, FileCheck2, Fingerprint, Globe, KeyRound, Lock, Database, FileText, ShieldAlert, ShieldCheck, Terminal, Timer, Workflow } from "lucide-react"
import { SectionHeading, Snippet } from "@/components/marketing/marketing-ui"
import { UseCaseShell } from "@/components/marketing/use-case-page"
import { publicBaseUrl } from "@/lib/deployment"
import { formatBytes, GALLERY_ACTIONS, GALLERY_SIGNING, type GalleryAction } from "@/lib/gallery/site"
import type { ActionField } from "@/lib/custom-actions/contract"
import { actionFieldTypeLabel } from "@/lib/custom-actions/manifest"
import { CardPreview, galleryCardClass, OriginBadge, PackageIcon } from "./gallery-ui"

export const ACTIONS_TITLE = "Workflow actions gallery"
export const ACTIONS_DESCRIPTION = "Official custom workflow actions for UserTasks: math and statistics (loan schedules, compound interest, percentiles, unit conversion), text tools, business-day and SLA calendars, data transforms, IBAN / card / national ID validation and locale formatting, and UUIDs, hashes, HMAC and signed tokens. Each runs in a WebAssembly sandbox with typed inputs and outputs."

const H2 = "font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight sm:text-3xl"

function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
}

function capabilityText(action: GalleryAction): string {
  const c = action.capabilities
  if (!c.capabilities.length) return "None — pure computation"
  return c.capabilities.map((x) => (x === "secrets" ? `secrets (${c.secrets.join(", ")})` : x === "http" ? `HTTP (${c.hosts.join(", ")})` : x)).join(", ")
}

function json(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? "null"
  return text.length > 1800 ? `${text.slice(0, 1800)}\n…` : text
}

/** One action card (index, teasers). */
export function ActionCardView({ action }: { action: GalleryAction }) {
  return (
    <Link href={`/gallery/actions/${action.slug}`} data-testid={`action-card-${action.slug}`} className={galleryCardClass}>
      <CardPreview tone="ink" icon={<PackageIcon icon={action.icon} category="workflow-actions" size={28} />}
        badge={<span className="num whitespace-nowrap rounded-full bg-[#FFFFFF] px-2.5 py-0.5 text-xs font-semibold text-[#33302A] ring-1 ring-inset ring-[#17150F]/15">{action.operations.length} functions</span>} />
      <div className="flex flex-1 flex-col p-4">
        <p className="text-xs font-medium text-[#8A6D45]">Workflow action</p>
        <h3 className="mt-1.5 text-base font-semibold leading-snug text-[#1B1916] group-hover:underline">{action.title}</h3>
        <p className="mt-0.5 truncate font-mono text-xs text-[#6E6759]">{action.key}</p>
        <p className="mt-1 truncate text-sm text-[#4A463E]" title={action.summary}>{action.summary}</p>
        <p className="mt-3 line-clamp-2 text-xs leading-5 text-[#6E6759]">{action.operations.slice(0, 6).map((o) => o.label).join(" · ")}{action.operations.length > 6 ? ` · +${action.operations.length - 6} more` : ""}</p>
        <p className="mt-auto flex flex-wrap gap-1.5 pt-3 text-2xs">
          {action.capabilities.capabilities.length === 0
            ? <span className="inline-flex items-center gap-1 rounded-full bg-[#4F7A5B]/[0.12] px-2 py-0.5 font-semibold text-[#2F5A3B]"><Lock size={12} aria-hidden="true" /> Pure computation</span>
            : <span className="inline-flex items-center gap-1 rounded-full bg-[#4E6E8E]/[0.12] px-2 py-0.5 font-semibold text-[#34506B]"><KeyRound size={12} aria-hidden="true" /> Uses {action.capabilities.capabilities.join(", ")}</span>}
        </p>
      </div>
    </Link>
  )
}

/** Workflow actions strip (the /gallery index). */
export function ActionsTeaser({ limit = 6 }: { limit?: number }) {
  const actions = GALLERY_ACTIONS.slice(0, limit)
  if (!actions.length) return null
  return (
    <div data-testid="actions-teaser">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading eyebrow="Workflow actions" title="Custom steps for your workflows">
          Official sandboxed actions that install into Extensibility → Workflow actions: math and finance, text, business calendars, data transforms, validation and crypto.
        </SectionHeading>
        <Link href="/gallery/actions" className="inline-flex items-center gap-1 text-sm font-semibold text-[#8A6D45] hover:underline">All {GALLERY_ACTIONS.length} actions <ArrowRight size={14} aria-hidden="true" /></Link>
      </div>
      <ul className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {actions.map((a) => <li key={a.slug}><ActionCardView action={a} /></li>)}
      </ul>
    </div>
  )
}

const SECURITY = [
  { icon: Cpu, title: "A separate JavaScript engine", body: "Each run gets a fresh QuickJS engine compiled to WebAssembly: no Node APIs, no process, environment, files, sockets, timers or database — only what the action is handed. Not node:vm, not new Function." },
  { icon: Timer, title: "Hard limits", body: "Memory and stack are capped per run, CPU is interrupted at the deadline (an endless loop stops), and every value crossing the boundary is JSON with a size limit." },
  { icon: KeyRound, title: "Capabilities by approval", body: "HTTP only to hosts the manifest declares and an administrator approves, through the egress guard. Data tables only as granted. Files only when given as inputs. Secrets only by declared name, encrypted at rest." },
  { icon: Fingerprint, title: "Versioned and signed", body: "Every version is immutable with a SHA-256; gallery packages are signed with the UserTasks Gallery key. A kill switch turns an action off everywhere at once, and deleting one a workflow uses is refused." },
]

export function ActionsIndexPage() {
  const baseUrl = publicBaseUrl()
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${baseUrl}/gallery/actions#webpage`,
        url: `${baseUrl}/gallery/actions`,
        name: ACTIONS_TITLE,
        description: ACTIONS_DESCRIPTION,
        isPartOf: { "@id": `${baseUrl}/#website` },
        mainEntity: { "@type": "ItemList", numberOfItems: GALLERY_ACTIONS.length, itemListElement: GALLERY_ACTIONS.map((a, i) => ({ "@type": "ListItem", position: i + 1, name: a.title, url: `${baseUrl}/gallery/actions/${a.slug}` })) },
      },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "UserTasks", item: baseUrl },
        { "@type": "ListItem", position: 2, name: "Gallery", item: `${baseUrl}/gallery` },
        { "@type": "ListItem", position: 3, name: "Workflow actions", item: `${baseUrl}/gallery/actions` },
      ] },
    ],
  }
  const functions = GALLERY_ACTIONS.reduce((n, a) => n + a.operations.length, 0)
  return (
    <UseCaseShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <main>
        <section className="border-b border-[#1B1916]/[0.06] bg-[radial-gradient(circle_at_50%_0%,rgba(176,138,84,0.14),transparent_45%)]">
          <div className="mx-auto max-w-6xl px-4 pb-12 pt-10 sm:px-6 sm:pt-14">
            <nav aria-label="Breadcrumb" className="text-xs text-[#857D6D]">
              <Link href="/" className="hover:text-[#8A6D45]">UserTasks</Link><span className="px-2">/</span>
              <Link href="/gallery" className="hover:text-[#8A6D45]">Gallery</Link><span className="px-2">/</span>
              <span aria-current="page">Workflow actions</span>
            </nav>
            <ActionsGalleryTabs />
            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.22em] text-[#8A6D45]">Workflow actions</p>
            <h1 className="mt-4 max-w-4xl font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl">The steps you keep rebuilding, ready to drop in.</h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-[#4A463E]">
              {GALLERY_ACTIONS.length} official actions with {functions} functions — loan schedules and percentiles, slugs and fuzzy matching, business-day SLAs and fiscal periods, group-by and joins, IBAN and national ID checks, UUIDs and signed tokens. Install one and it appears in the workflow designer&apos;s <strong>Custom actions</strong> palette with a typed input panel, and its outputs show up in the data picker with their types.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/docs/workflows/official-actions" className="inline-flex items-center gap-2 rounded-lg bg-[#17150F] px-5 py-2.5 text-sm font-semibold text-[#FAF8F3] hover:bg-[#2E2A24]">Action reference <ArrowRight size={15} aria-hidden="true" /></Link>
              <Link href="/docs/workflows/custom-actions" className="inline-flex items-center gap-2 rounded-lg border border-[#1B1916]/15 px-5 py-2.5 text-sm font-semibold text-[#33302A] hover:border-[#1B1916]/30">Build your own</Link>
            </div>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3" data-testid="actions-grid">
            {GALLERY_ACTIONS.map((a) => <li key={a.slug}><ActionCardView action={a} /></li>)}
          </ul>
        </section>
        <section className="border-y border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <SectionHeading eyebrow="Security" title="Your workflow runs the code. It never touches your server.">
              Custom actions run tenant code, so they run it somewhere it cannot hurt anything:
            </SectionHeading>
            <ul className="mt-8 grid gap-4 md:grid-cols-2">
              {SECURITY.map((s) => (
                <li key={s.title} className="rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF] p-5">
                  <p className="flex items-center gap-2 font-semibold"><s.icon size={16} className="text-[#8A6D45]" aria-hidden="true" /> {s.title}</p>
                  <p className="mt-2 text-sm leading-6 text-[#4A463E]">{s.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading eyebrow="Install" title="From the gallery to a running step in a minute" />
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              { title: "Install", body: "In the app: Extensibility → Workflow actions → Browse gallery (or Automations → Packages → Browse gallery → Workflow actions). Or download the .utpkg here and import it." },
              { title: "Use", body: "Drag the action from the designer's Custom actions palette, pick a function, fill its inputs with values or {{data}}. A sample workflow comes with every action." },
              { title: "Test", body: "Save & Test shows the typed outputs in the data panel and the run log (version, duration, host calls). Extensibility → Manage → Test runs one function on its own." },
            ].map((step, i) => (
              <li key={step.title} className="rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF] p-5">
                <p className="text-xs font-semibold text-[#857D6D]">Step {i + 1}</p>
                <h3 className="font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-[#4A463E]">{step.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-sm text-[#4A463E]">Need something else? <Link href="/workflows#actions" className="font-semibold text-[#8A6D45] hover:underline">Build any action</Link> with the starter kit and the <code className="font-mono">@usertasks/action</code> helper.</p>
        </section>
      </main>
    </UseCaseShell>
  )
}

/** Workflow packages | Form controls | Workflow actions (the actions pages). */
function ActionsGalleryTabs() {
  const tab = (on: boolean) => `inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold transition ${on ? "border-[#17150F] bg-[#17150F] text-[#FAF8F3]" : "border-[#1B1916]/15 bg-[#FFFFFF] text-[#4A463E] hover:border-[#1B1916]/30"}`
  return (
    <nav aria-label="Gallery sections" className="mt-6 flex flex-wrap gap-2" data-testid="gallery-tabs">
      <Link href="/gallery" className={tab(false)}>Workflow packages</Link>
      <Link href="/gallery/controls" className={tab(false)}>Form controls</Link>
      <Link href="/gallery/actions" aria-current="page" className={tab(true)}>Workflow actions <span className="text-[#D9CDB5]">{GALLERY_ACTIONS.length}</span></Link>
    </nav>
  )
}

function FieldList({ fields }: { fields: ActionField[] }) {
  if (!fields.length) return <p className="text-sm text-[#6E6759]">None</p>
  return (
    <ul className="space-y-1.5 text-sm">
      {fields.map((f) => (
        <li key={f.name} className="leading-6">
          <code className="font-mono text-ui text-[#33302A]">{f.name}</code>{" "}
          <span className="text-xs text-[#857D6D]">{actionFieldTypeLabel(f)}{f.required ? " · required" : ""}{f.type === "select" && f.options?.length ? ` · ${f.options.map((o) => o.value).slice(0, 6).join(" / ")}${f.options.length > 6 ? " / …" : ""}` : ""}</span>
          {f.description && <span className="text-[#4A463E]"> — {f.description}</span>}
          {f.type === "array" && f.items?.fields?.length ? <span className="block pl-4 text-xs text-[#6E6759]">each: {f.items.fields.map((x) => `${x.name} (${actionFieldTypeLabel(x)})`).join(", ")}</span> : null}
        </li>
      ))}
    </ul>
  )
}

export function ActionDetailPage({ action }: { action: GalleryAction }) {
  const baseUrl = publicBaseUrl()
  const url = `${baseUrl}/gallery/actions/${action.slug}`
  const signed = action.file.signed
  const related = GALLERY_ACTIONS.filter((a) => a.slug !== action.slug).slice(0, 3)
  const caps = action.capabilities
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": `${url}#action`,
        name: action.title,
        description: action.summary,
        url,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Workflow action",
        operatingSystem: "UserTasks (cloud or self-hosted)",
        softwareVersion: action.version,
        datePublished: action.released,
        downloadUrl: `${baseUrl}${action.file.file}`,
        fileSize: formatBytes(action.file.size_bytes),
        keywords: action.tags.join(", "),
        isAccessibleForFree: true,
        license: "https://www.apache.org/licenses/LICENSE-2.0",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        publisher: { "@id": `${baseUrl}/#organization` },
      },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "UserTasks", item: baseUrl },
        { "@type": "ListItem", position: 2, name: "Gallery", item: `${baseUrl}/gallery` },
        { "@type": "ListItem", position: 3, name: "Workflow actions", item: `${baseUrl}/gallery/actions` },
        { "@type": "ListItem", position: 4, name: action.title, item: url },
      ] },
    ],
  }
  return (
    <UseCaseShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <main>
        <section className="border-b border-[#1B1916]/[0.06] bg-[radial-gradient(circle_at_50%_0%,rgba(176,138,84,0.14),transparent_45%)]">
          <div className="mx-auto max-w-6xl px-4 pb-12 pt-10 sm:px-6 sm:pt-12">
            <nav aria-label="Breadcrumb" className="flex flex-wrap items-center text-xs text-[#857D6D]">
              <Link href="/" className="hover:text-[#8A6D45]">UserTasks</Link><span className="px-2">/</span>
              <Link href="/gallery" className="hover:text-[#8A6D45]">Gallery</Link><span className="px-2">/</span>
              <Link href="/gallery/actions" className="hover:text-[#8A6D45]">Workflow actions</Link><span className="px-2">/</span>
              <span aria-current="page">{action.title}</span>
            </nav>
            <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_340px]">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#B08A54]/[0.14] text-[#8A6D45]"><PackageIcon icon={action.icon} category="workflow-actions" size={22} /></span>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8A6D45]">Workflow action</p>
                </div>
                <h1 className="mt-5 font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">{action.title}</h1>
                <p className="mt-2 font-mono text-sm text-[#6E6759]">{action.key}</p>
                <p className="mt-5 max-w-2xl text-lg leading-8 text-[#4A463E]">{action.summary}</p>
                <div className="mt-6 flex flex-wrap items-center gap-2">
                  <OriginBadge source="official" size="md" />
                  <span className="rounded-full border border-[#1B1916]/12 bg-[#FFFFFF] px-3 py-1 font-mono text-sm text-[#4A463E]">v{action.version}</span>
                  <span className="rounded-full border border-[#1B1916]/12 bg-[#FFFFFF] px-3 py-1 text-sm text-[#4A463E]">{action.operations.length} functions</span>
                  {caps.capabilities.length === 0 && <span className="inline-flex items-center gap-1 rounded-full bg-[#4F7A5B]/[0.12] px-3 py-1 text-sm font-semibold text-[#2F5A3B]"><Lock size={13} aria-hidden="true" /> Pure computation</span>}
                </div>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <a href={action.file.file} download={action.file.file_name} data-testid="download-action" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#17150F] px-6 py-3 font-semibold text-[#FAF8F3] shadow-lg shadow-[#17150F]/20 hover:bg-[#2E2A24]">
                    <Download size={16} aria-hidden="true" /> Download .utpkg <span className="font-normal text-[#CFC6B4]">{formatBytes(action.file.size_bytes)}</span>
                  </a>
                  <a href="#install" className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#1B1916]/15 px-6 py-3 font-medium text-[#33302A] hover:border-[#1B1916]/30">Install in your workspace</a>
                </div>
              </div>
              <aside className="h-fit rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-5 text-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8A6D45]">At a glance</p>
                <dl className="mt-3 grid gap-3">
                  <div><dt className="text-xs text-[#857D6D]">Functions</dt><dd className="mt-0.5 text-[#33302A]">{action.operations.map((o) => o.label).join(", ")}</dd></div>
                  <div><dt className="text-xs text-[#857D6D]">Capabilities</dt><dd className="mt-0.5 text-[#33302A]">{capabilityText(action)}</dd></div>
                  <div><dt className="text-xs text-[#857D6D]">Limits</dt><dd className="mt-0.5 text-[#33302A]">{action.limits.timeout_ms / 1000} s · {action.limits.memory_mb} MB per run</dd></div>
                  <div><dt className="text-xs text-[#857D6D]">Module</dt><dd className="mt-0.5 text-[#33302A]">{formatBytes(caps.module_bytes)}, one ES module, no dependencies at run time</dd></div>
                  <div><dt className="text-xs text-[#857D6D]">Includes</dt><dd className="mt-0.5 text-[#33302A]">{action.sample_workflows.map((w) => w.name).join(", ") || "—"} (sample workflow)</dd></div>
                  <div><dt className="text-xs text-[#857D6D]">Signature</dt><dd className="mt-0.5 inline-flex items-center gap-1.5 text-[#33302A]">{signed ? <><ShieldCheck size={14} className="text-[#4F7A5B]" aria-hidden="true" /> Signed ({GALLERY_SIGNING.key_name})</> : <><ShieldAlert size={14} className="text-[#A0804F]" aria-hidden="true" /> Unsigned preview build</>}</dd></div>
                </dl>
              </aside>
            </div>
          </div>
        </section>

        <section className="border-b border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_360px]">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8A6D45]">About</p>
              <h2 className={`mt-3 ${H2}`}>What it does</h2>
              <div className="mt-5 space-y-4 text-base leading-7 text-[#4A463E]">{paragraphs(action.description).map((p) => <p key={p.slice(0, 40)}>{p}</p>)}</div>
              <h3 className="mt-8 font-semibold">Good for</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-[#4A463E]">{action.uses.map((u) => <li key={u}>{u}</li>)}</ul>
            </div>
            <div className="h-fit rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-5">
              <h3 className="font-semibold">After installing</h3>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-[#4A463E]">{action.setup.map((s) => <li key={s}>{s}</li>)}</ol>
            </div>
          </div>
        </section>

        {action.examples.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6" id="examples">
            <SectionHeading eyebrow="Examples" title="Real inputs, real outputs">
              Each example ran in the sandbox when this gallery was built; the outputs are exactly what the step returns.
            </SectionHeading>
            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              {action.examples.map((ex) => (
                <div key={`${ex.operation}-${ex.title}`} className="min-w-0 rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-5" data-testid="action-example">
                  <p className="font-semibold">{ex.title} <span className="font-mono text-xs font-normal text-[#857D6D]">{ex.operation}</span></p>
                  {ex.note && <p className="mt-1 text-sm text-[#4A463E]">{ex.note}</p>}
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[#857D6D]">Inputs</p>
                  <pre className="mt-1 max-h-56 overflow-auto rounded-lg bg-[#F6F3EC] p-3 font-mono text-xs leading-5 text-[#33302A]">{json(ex.inputs)}</pre>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[#857D6D]">Outputs</p>
                  <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-[#17150F] p-3 font-mono text-xs leading-5 text-[#EDE6D6]">{ex.varies ? "Different on every run (random or time based)." : json(ex.outputs)}</pre>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="border-y border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <SectionHeading eyebrow="Reference" title="Functions, inputs and outputs">
              The designer generates each function&apos;s input panel from these declarations; outputs appear in the data picker with their types.
            </SectionHeading>
            <div className="mt-8 grid gap-5">
              {action.operations.map((op) => (
                <div key={op.id} id={`fn-${op.id}`} className="scroll-mt-8 rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-5">
                  <h3 className="font-semibold">{op.label} <span className="font-mono text-xs font-normal text-[#857D6D]">{op.id}</span></h3>
                  {op.description && <p className="mt-1 text-sm leading-6 text-[#4A463E]">{op.description}</p>}
                  <div className="mt-4 grid gap-6 md:grid-cols-2">
                    <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#857D6D]">Inputs</p><FieldList fields={op.inputs} /></div>
                    <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#857D6D]">Outputs</p><FieldList fields={op.outputs} /></div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-8 grid gap-4 md:grid-cols-3 text-sm">
              <div className="rounded-xl border border-[#1B1916]/[0.08] bg-[#FFFFFF] p-4"><p className="flex items-center gap-2 font-semibold"><Globe size={14} aria-hidden="true" /> Network</p><p className="mt-1 text-[#4A463E]">{caps.hosts.length ? `Only ${caps.hosts.join(", ")}, once an administrator approves.` : "None. The action cannot make requests."}</p></div>
              <div className="rounded-xl border border-[#1B1916]/[0.08] bg-[#FFFFFF] p-4"><p className="flex items-center gap-2 font-semibold"><Database size={14} aria-hidden="true" /> Data and files</p><p className="mt-1 text-[#4A463E]">{caps.capabilities.includes("data") || caps.capabilities.includes("files") ? "Only tables an administrator grants and files given as inputs." : "None. It only sees its inputs."}</p></div>
              <div className="rounded-xl border border-[#1B1916]/[0.08] bg-[#FFFFFF] p-4"><p className="flex items-center gap-2 font-semibold"><FileText size={14} aria-hidden="true" /> Secrets</p><p className="mt-1 text-[#4A463E]">{caps.secrets.length ? <>Declared: {caps.secrets.map((s) => <code key={s} className="mr-1 font-mono text-xs">secret://{s}</code>)}— set once in Extensibility, stored encrypted, never shown again.</> : "None."}</p></div>
            </div>
          </div>
        </section>

        <section id="install" className="scroll-mt-8">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <SectionHeading eyebrow="Install" title="Install it in your workspace">
              Works on UserTasks cloud and any self-hosted instance. The action lands in Extensibility → Workflow actions, enabled, with its sample workflow.
            </SectionHeading>
            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              <div className="rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-6">
                <h3 className="flex items-center gap-2 font-semibold"><FileCheck2 size={16} className="text-[#8A6D45]" aria-hidden="true" /> In the app</h3>
                <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-[#4A463E]">
                  <li>Open <strong>Extensibility → Workflow actions → Browse gallery</strong> and choose <strong>Install</strong> on {action.title}. Or <a href={action.file.file} download={action.file.file_name} className="font-semibold text-[#8A6D45] hover:underline">download {action.file.file_name}</a> and drag it onto Automations → Packages.</li>
                  <li>The wizard verifies the checksum, every file hash and the signature, and shows what it adds.</li>
                  {caps.secrets.length > 0 && <li>In Extensibility → Workflow actions → Manage → Access, set {caps.secrets.join(" and ")} for the functions that need them.</li>}
                  <li>In the workflow designer, drag <strong>{action.name}</strong> from <strong>Custom actions</strong>, pick a function and fill its inputs. Save &amp; Test shows the typed outputs.</li>
                </ol>
              </div>
              <div className="grid min-w-0 gap-4">
                <div className="min-w-0">
                  <h3 className="mb-2 flex items-center gap-2 font-semibold"><Terminal size={16} className="text-[#8A6D45]" aria-hidden="true" /> With the CLI</h3>
                  <Snippet language="shell" code={`curl -fLO ${baseUrl}${action.file.file}
usertasks packages install ${action.file.file_name}
usertasks activities test ${action.key} -f '{"operation":"${action.operations[0]?.id ?? "run"}"}'`} />
                </div>
                <div className="rounded-xl border border-[#1B1916]/[0.08] bg-[#F1EDE3] p-4 text-sm">
                  <p className="flex items-center gap-2 font-semibold"><Fingerprint size={15} className="text-[#8A6D45]" aria-hidden="true" /> Verify the download</p>
                  <dl className="mt-2 grid gap-1.5 text-xs">
                    <div className="grid gap-0.5"><dt className="text-[#6E6759]">File SHA-256</dt><dd className="break-all font-mono text-2xs text-[#33302A]">{action.file.sha256}</dd></div>
                    <div className="grid gap-0.5"><dt className="text-[#6E6759]">Package checksum (what is signed)</dt><dd className="break-all font-mono text-2xs text-[#33302A]">{action.file.checksum}</dd></div>
                    <div className="grid gap-0.5"><dt className="text-[#6E6759]">Module SHA-256</dt><dd className="break-all font-mono text-2xs text-[#33302A]">{caps.sha256}</dd></div>
                    <div className="grid gap-0.5"><dt className="text-[#6E6759]">Signer</dt><dd className="font-mono text-2xs text-[#33302A]">{signed ? `${GALLERY_SIGNING.key_name} · ${action.file.fingerprint}` : "Unsigned preview build — compare the SHA-256 above"}</dd></div>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </section>

        {related.length > 0 && (
          <section className="border-t border-[#1B1916]/[0.07] mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className={H2}>More workflow actions</h2>
              <Link href="/gallery/actions" className="inline-flex items-center gap-1 text-sm font-semibold text-[#8A6D45] hover:underline"><Workflow size={14} aria-hidden="true" /> All actions</Link>
            </div>
            <ul className="mt-6 grid gap-5 md:grid-cols-3">{related.map((a) => <li key={a.slug}><ActionCardView action={a} /></li>)}</ul>
          </section>
        )}
      </main>
    </UseCaseShell>
  )
}
