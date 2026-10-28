import Link from "next/link"
import { ArrowRight, CalendarClock, Check, Download, FileCheck2, Fingerprint, FormInput, KeyRound, Lock, Radio, ShieldAlert, ShieldCheck, Terminal, Webhook } from "lucide-react"
import { SectionHeading, Snippet } from "@/components/marketing/marketing-ui"
import { UseCaseShell } from "@/components/marketing/use-case-page"
import { publicBaseUrl } from "@/lib/deployment"
import { sectionLabel, type CatalogField, type CatalogForm, type CatalogWorkflow } from "@/lib/gallery/catalog"
import { formatBytes, galleryCategory, GALLERY_SIGNING, relatedPackages, type GalleryPackage } from "@/lib/gallery/site"
import { GALLERY_NEEDS, GALLERY_TRIGGERS } from "@/lib/gallery/types"
import { describeSchedule, normalizeScheduleConfig } from "@/lib/workflow-schedule"
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow-schema"
import { PackageCard } from "./gallery-browser"
import { DIFFICULTY_LABEL, NativeBadge, NeedsChips, OriginBadge, PackageIcon, SystemChips, TriggerBadge } from "./gallery-ui"
import { WorkflowPreview } from "./workflow-preview"

const H2 = "font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight sm:text-3xl"

function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
}

function triggerNode(wf: CatalogWorkflow | undefined): WorkflowNode | undefined {
  return wf?.nodes.find((n: WorkflowNode) => n.type === wf.trigger_type)
}

/** One line on how the entry workflow starts, from its trigger node. */
function startDetail(pkg: GalleryPackage, entry: CatalogWorkflow | undefined): string {
  const trigger = triggerNode(entry)
  if (pkg.trigger === "schedule") {
    const description = describeSchedule(normalizeScheduleConfig(trigger?.config ?? {}))
    return description ? `${description}. You can also start it any time from the Run dialog, the API or the CLI.` : "Runs on a schedule."
  }
  if (entry?.trigger_type === "data_table_event") {
    const events = (trigger?.config?.event_types ?? []) as string[]
    const table = pkg.tables.length ? pkg.tables.find(() => true)?.name : null
    return `Starts when a row is ${events.length ? events.join(" or ") : "created, updated or deleted"}${table ? ` in a data table (see What's included)` : ""}.`
  }
  if (entry?.trigger_type === "middleware_received") return "Called synchronously: the caller waits and receives the workflow's final variables as the response."
  return pkg.start
}

function FieldPreview({ field }: { field: CatalogField }) {
  const control = field.options?.length
    ? <div className="flex flex-wrap gap-1">{field.options.slice(0, 6).map((o) => <span key={o} className="rounded-md border border-[#1B1916]/[0.12] bg-[#FAF8F3] px-1.5 py-0.5 text-[11px] text-[#4A463E]">{o}</span>)}{field.options.length > 6 && <span className="text-[11px] text-[#857D6D]">+{field.options.length - 6}</span>}</div>
    : field.type === "boolean"
      ? <span className="inline-flex h-4 w-4 rounded border border-[#1B1916]/25 bg-[#FFFFFF]" />
      : <span className="block h-8 truncate rounded-md border border-[#1B1916]/[0.14] bg-[#FFFFFF] px-2 text-[11px] leading-8 text-[#9A9282]">{field.default ? `Prefilled: ${field.default}` : field.type === "number" ? "0" : field.type === "date" ? "YYYY-MM-DD" : field.type === "datetime" ? "YYYY-MM-DD HH:mm" : field.type === "email" ? "name@company.com" : field.type === "url" ? "https://…" : field.type === "json" ? "{ … }" : ""}</span>
  return (
    <div className="grid gap-1">
      <span className="text-[13px] font-medium text-[#33302A]">{field.label}{field.required && <span className="text-[#A0533F]" aria-label="required"> *</span>} <span className="font-mono text-[10.5px] font-normal text-[#857D6D]">{field.key} · {field.type}</span></span>
      {control}
      {field.description && <span className="text-[11.5px] leading-4 text-[#6E6759]">{field.description}</span>}
    </div>
  )
}

function formShape(form: { columns?: number; themed?: boolean }): string | null {
  const parts = [form.columns ? `${form.columns}-column grid` : null, form.themed ? "own header and theme" : null].filter(Boolean)
  return parts.length ? parts.join(" · ") : null
}

function FormCard({ title, subtitle, fields, outcomes, badge }: { title: string; subtitle?: string; fields: CatalogField[]; outcomes?: string[]; badge: string }) {
  return (
    <article className="flex flex-col rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8A6D45]">{badge}</p>
      <h3 className="mt-1 font-semibold leading-snug">{title}</h3>
      {subtitle && <p className="mt-1 text-xs leading-5 text-[#6E6759]">{subtitle}</p>}
      <div className="mt-4 grid flex-1 content-start gap-3">
        {fields.length ? fields.map((field) => <FieldPreview key={field.key} field={field} />) : <p className="text-sm text-[#6E6759]">No fields: the person picks an outcome.</p>}
      </div>
      {outcomes && outcomes.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-[#1B1916]/[0.07] pt-4">
          {outcomes.map((o, i) => <span key={o} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${i === 0 ? "bg-[#17150F] text-[#FAF8F3]" : "border border-[#1B1916]/15 text-[#33302A]"}`}>{o}</span>)}
        </div>
      )}
    </article>
  )
}

function sampleCalls(pkg: GalleryPackage, entry: CatalogWorkflow | undefined) {
  const vars = JSON.stringify(pkg.sample_input)
  const inputs = Object.entries(pkg.sample_input).slice(0, 4).map(([k, v]) => `--input ${k}=${typeof v === "string" && /\s/.test(v) ? `"${v}"` : typeof v === "object" ? `'${JSON.stringify(v)}'` : String(v)}`).join(" ")
  const start = `curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \\
  -H "Authorization: Bearer $USERTASKS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"workflow_id":"<workflow id>","variables":${vars}}'`
  const cli = `usertasks workflows inputs <workflow id>          # the start form: keys, types, required
usertasks workflows run <workflow id> ${inputs}${Object.keys(pkg.sample_input).length > 4 ? " …" : ""} --wait`
  const webhook = entry?.trigger_type === "webhook_received" || entry?.trigger_type === "middleware_received"
    ? `usertasks webhooks create <workflow id>          # prints the hook slug and secret once
curl -X POST "$USERTASKS_URL/api/webhooks/inbound?hook=<slug>" \\
  -H "Authorization: Bearer <webhook secret>" -H "Content-Type: application/json" \\
  -d '${vars}'`
    : null
  return { start, cli, webhook }
}

export function GalleryPackagePage({ pkg }: { pkg: GalleryPackage }) {
  const baseUrl = publicBaseUrl()
  const url = `${baseUrl}/gallery/${pkg.slug}`
  const category = galleryCategory(pkg.category)
  const entry = pkg.workflows.find((wf) => wf.entry) ?? pkg.workflows[0]
  const others = pkg.workflows.filter((wf) => wf !== entry)
  const startInputs = pkg.inputs
  const forms: CatalogForm[] = pkg.forms
  const tableNames = Object.fromEntries(pkg.tables.map((t) => [t.id, t.name]))
  const calls = sampleCalls(pkg, entry)
  const counts = Object.entries(pkg.assets.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.section]: (acc[a.section] ?? 0) + 1 }), {}))
  const signed = pkg.file.signed
  const related = relatedPackages(pkg)
  const StartIcon = pkg.trigger === "form" ? FormInput : pkg.trigger === "schedule" ? CalendarClock : pkg.trigger === "event" ? Radio : Webhook

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": `${url}#package`,
        name: pkg.title,
        description: pkg.summary,
        url,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: category.title,
        operatingSystem: "UserTasks (cloud or self-hosted)",
        softwareVersion: pkg.version,
        datePublished: pkg.released,
        downloadUrl: `${baseUrl}${pkg.file.file}`,
        fileSize: formatBytes(pkg.file.size_bytes),
        keywords: pkg.tags.join(", "),
        isAccessibleForFree: true,
        license: "https://www.apache.org/licenses/LICENSE-2.0",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        publisher: { "@id": `${baseUrl}/#organization` },
        isPartOf: { "@id": `${baseUrl}/gallery#webpage` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "UserTasks", item: baseUrl },
          { "@type": "ListItem", position: 2, name: "Gallery", item: `${baseUrl}/gallery` },
          { "@type": "ListItem", position: 3, name: category.title, item: `${baseUrl}/gallery?category=${category.id}` },
          { "@type": "ListItem", position: 4, name: pkg.title, item: url },
        ],
      },
    ],
  }

  return (
    <UseCaseShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <main>
        {/* Hero */}
        <section className="border-b border-[#1B1916]/[0.06] bg-[radial-gradient(circle_at_50%_0%,rgba(176,138,84,0.14),transparent_45%)]">
          <div className="mx-auto max-w-6xl px-4 pb-14 pt-10 sm:px-6 sm:pt-12">
            <nav aria-label="Breadcrumb" className="flex flex-wrap items-center text-xs text-[#857D6D]">
              <Link href="/" className="hover:text-[#8A6D45]">UserTasks</Link><span className="px-2">/</span>
              <Link href="/gallery" className="hover:text-[#8A6D45]">Gallery</Link><span className="px-2">/</span>
              <Link href={`/gallery?category=${category.id}`} className="hover:text-[#8A6D45]">{category.title}</Link><span className="px-2">/</span>
              <span aria-current="page">{pkg.title}</span>
            </nav>
            <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_340px]">
              <div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#B08A54]/[0.14] text-[#8A6D45]"><PackageIcon icon={pkg.icon} category={pkg.category} size={22} /></span>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8A6D45]">{category.title} package</p>
                </div>
                <h1 className="mt-5 font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">{pkg.title}</h1>
                <p className="mt-5 max-w-2xl text-lg leading-8 text-[#4A463E]">{pkg.summary}</p>
                {pkg.systems.length > 0 && <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[#6E6759]">Connects to <SystemChips systems={pkg.systems} /></p>}
                <div className="mt-6 flex flex-wrap items-center gap-2">
                  <OriginBadge source="official" size="md" />
                  {pkg.native && <NativeBadge size="md" />}
                  <TriggerBadge trigger={pkg.trigger} size="md" />
                  <span className="rounded-full border border-[#1B1916]/12 bg-[#FFFFFF] px-3 py-1 text-sm text-[#4A463E]">{DIFFICULTY_LABEL[pkg.difficulty] ?? pkg.difficulty}</span>
                  <span className="rounded-full border border-[#1B1916]/12 bg-[#FFFFFF] px-3 py-1 text-sm text-[#4A463E]">~{pkg.setup_minutes} min setup</span>
                  <span className="rounded-full border border-[#1B1916]/12 bg-[#FFFFFF] px-3 py-1 font-mono text-sm text-[#4A463E]">v{pkg.version}</span>
                </div>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <a href={pkg.file.file} download={pkg.file.file_name} data-testid="download-package" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#17150F] px-6 py-3 font-semibold text-[#FAF8F3] shadow-lg shadow-[#17150F]/20 hover:bg-[#2E2A24]">
                    <Download size={16} aria-hidden="true" /> Download .utpkg <span className="font-normal text-[#CFC6B4]">{formatBytes(pkg.file.size_bytes)}</span>
                  </a>
                  <a href="#install" className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#1B1916]/15 px-6 py-3 font-medium text-[#33302A] hover:border-[#1B1916]/30">How to install</a>
                </div>
              </div>
              <aside className="h-fit rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-5 text-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8A6D45]">At a glance</p>
                <dl className="mt-3 grid gap-3">
                  <div><dt className="text-xs text-[#857D6D]">Starts</dt><dd className="mt-0.5 font-medium">{GALLERY_TRIGGERS[pkg.trigger].label}</dd></div>
                  <div><dt className="text-xs text-[#857D6D]">Includes</dt><dd className="mt-0.5 text-[#33302A]">{counts.map(([section, n]) => `${n} ${sectionLabel(section).replace(/^(?!API|AI)\w/, (c) => c.toLowerCase())}${n === 1 ? "" : "s"}`).join(" · ")}</dd></div>
                  <div><dt className="text-xs text-[#857D6D]">Asked for on install</dt><dd className="mt-0.5 text-[#33302A]">{pkg.requirements.length ? `${pkg.requirements.length} requirement${pkg.requirements.length === 1 ? "" : "s"} (credentials, URLs, assignees)` : "Nothing"}</dd></div>
                  <div><dt className="text-xs text-[#857D6D]">Released</dt><dd className="mt-0.5 text-[#33302A]">{pkg.released} · v{pkg.version}</dd></div>
                  <div><dt className="text-xs text-[#857D6D]">Signature</dt><dd className="mt-0.5 inline-flex items-center gap-1.5 text-[#33302A]">{signed ? <><ShieldCheck size={14} className="text-[#4F7A5B]" aria-hidden="true" /> Signed ({GALLERY_SIGNING.key_name})</> : <><ShieldAlert size={14} className="text-[#A0804F]" aria-hidden="true" /> Unsigned preview build</>}</dd></div>
                </dl>
                <div className="mt-4 border-t border-[#1B1916]/[0.07] pt-4"><NeedsChips needs={pkg.needs} />{pkg.optional_needs.length > 0 && <div className="mt-2"><NeedsChips needs={pkg.optional_needs} label="Optional" /></div>}</div>
              </aside>
            </div>
          </div>
        </section>

        {/* About + how it starts */}
        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8A6D45]">About this package</p>
              <h2 className={`mt-3 ${H2}`}>What it does</h2>
              <div className="mt-5 space-y-4 text-[15.5px] leading-7 text-[#4A463E]">{paragraphs(pkg.description).map((p) => <p key={p.slice(0, 40)}>{p}</p>)}</div>
            </div>
            <div className={`h-fit rounded-2xl border p-6 ${pkg.trigger === "form" ? "border-[#B08A54]/35 bg-[#B08A54]/[0.07]" : "border-[#1B1916]/[0.09] bg-[#F1EDE3]"}`}>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#FFFFFF] text-[#8A6D45]"><StartIcon size={18} aria-hidden="true" /></span>
              <h3 className="mt-3 text-lg font-semibold">{GALLERY_TRIGGERS[pkg.trigger].label}</h3>
              <p className="mt-2 text-sm leading-6 text-[#4A463E]">{startDetail(pkg, entry)}</p>
              <p className="mt-3 text-xs leading-5 text-[#6E6759]">{GALLERY_TRIGGERS[pkg.trigger].description}</p>
            </div>
          </div>
        </section>

        {/* Flow */}
        <section className="border-y border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <SectionHeading eyebrow="The flow" title="Step by step" />
            <ol className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {pkg.steps.map((step, i) => (
                <li key={step.title} className="flex gap-3 rounded-xl border border-[#1B1916]/[0.08] bg-[#FFFFFF] p-4">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#17150F] text-xs font-bold text-[#FAF8F3]">{i + 1}</span>
                  <div><p className="font-semibold leading-snug">{step.title}</p><p className="mt-1 text-sm leading-6 text-[#4A463E]">{step.body}</p></div>
                </li>
              ))}
            </ol>
            {entry && (
              <figure className="mt-10">
                <WorkflowPreview nodes={entry.nodes as WorkflowNode[]} edges={entry.edges as WorkflowEdge[]} tableNames={tableNames} label={`Workflow canvas of ${entry.name}: ${entry.nodes.length} steps`} markerPrefix={`gp-${pkg.slug}-entry`} />
                <figcaption className="mt-3 text-sm leading-6 text-[#6E6759]"><strong className="font-semibold text-[#33302A]">{entry.name}</strong> — {(entry.description ?? `${entry.nodes.length} steps`).replace(/\.$/, "")}. The same canvas you get in the designer after installing.</figcaption>
              </figure>
            )}
            {others.map((wf) => (
              <figure key={wf.id} className="mt-10">
                <h3 className="mb-3 text-lg font-semibold">Sub-workflow: {wf.name}</h3>
                <WorkflowPreview nodes={wf.nodes as WorkflowNode[]} edges={wf.edges as WorkflowEdge[]} tableNames={tableNames} label={`Workflow canvas of ${wf.name}`} markerPrefix={`gp-${pkg.slug}-${wf.id.slice(0, 8)}`} />
                {wf.description && <figcaption className="mt-3 text-sm leading-6 text-[#6E6759]">{wf.description}</figcaption>}
              </figure>
            ))}
          </div>
        </section>

        {/* Forms */}
        {(startInputs.length > 0 || forms.length > 0) && (
          <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <SectionHeading eyebrow="Forms" title={pkg.trigger === "form" ? "The start form and the task forms" : "Inputs and task forms"}>
              {pkg.trigger === "form"
                ? (forms.some((f) => f.kind === "page")
                  ? "People start it from a form page (/f/<id>) with its own header, theme and buttons; submitting it starts the workflow. User Tasks show their fields and outcome buttons to the assignee."
                  : "The workflow inputs are the start form: the Run dialog renders them on its grid and theme, and your own portal can post the same fields. User Tasks show their fields and outcome buttons to the assignee.")
                : "The inputs a caller passes when it starts a run, and the forms people complete when the process needs a decision."}
            </SectionHeading>
            <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {startInputs.length > 0 && !forms.some((f) => f.kind === "page") && <FormCard badge={pkg.trigger === "form" ? "Start form" : "Start inputs"} title={entry?.name ?? pkg.title} subtitle={pkg.trigger === "form" ? "Filled in by whoever starts the process" : "Passed by the calling system"} fields={startInputs} />}
              {forms.map((form) => form.kind === "page"
                ? <FormCard key={`page-${form.step}`} badge="Form page · /f/<id>" title={form.step} subtitle={[form.title !== form.step ? form.title : null, formShape(form), "Its own page: share the link or open it on a tablet"].filter(Boolean).join(" · ")} fields={form.fields} outcomes={form.buttons} />
                : <FormCard key={`${form.workflow}-${form.step}`} badge={`User Task${form.workflow !== entry?.name ? ` · ${form.workflow}` : ""}`} title={form.step} subtitle={[form.title, formShape(form)].filter(Boolean).join(" · ")} fields={form.fields} outcomes={form.buttons?.length ? form.buttons : form.outcomes} />)}
            </div>
          </section>
        )}

        {/* API */}
        <section className={forms.length || startInputs.length ? "border-y border-[#1B1916]/[0.07] bg-[#FFFFFF]/50" : ""}>
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <SectionHeading eyebrow={pkg.trigger === "api" ? "Headless" : "From your code"} title={pkg.trigger === "api" ? "Call it from your systems" : "Start a run over the API"}>
              Every workflow can be started over REST, MCP or the CLI, whatever its trigger, with the sample input below. Runs start straight away on the published version; replace {"<workflow id>"} with the id the install created.
            </SectionHeading>
            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              <div className="min-w-0"><p className="mb-2 text-sm font-semibold">REST</p><Snippet code={calls.start} language="shell" /></div>
              <div className="min-w-0"><p className="mb-2 text-sm font-semibold">CLI</p><Snippet code={calls.cli} language="shell" /></div>
              {calls.webhook && <div className="min-w-0 lg:col-span-2"><p className="mb-2 text-sm font-semibold">Inbound webhook{entry?.trigger_type === "middleware_received" ? " (synchronous: the response is the workflow result)" : ""}</p><Snippet code={calls.webhook} language="shell" /></div>}
            </div>
          </div>
        </section>

        {/* Included */}
        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <SectionHeading eyebrow="What's included" title={`${pkg.asset_count} assets, ready to adapt`} />
          <div className="mt-8 overflow-x-auto rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF]">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-[#F1EDE3] text-xs uppercase tracking-[0.12em] text-[#6E6759]">
                <tr><th scope="col" className="px-5 py-3 font-semibold">Type</th><th scope="col" className="px-5 py-3 font-semibold">Name</th><th scope="col" className="px-5 py-3 font-semibold">Details</th></tr>
              </thead>
              <tbody>
                {pkg.assets.map((asset) => (
                  <tr key={`${asset.section}-${asset.name}`} className="border-t border-[#1B1916]/[0.06] align-top">
                    <td className="whitespace-nowrap px-5 py-3 text-[#6E6759]">{sectionLabel(asset.section)}</td>
                    <td className="px-5 py-3 font-medium">{asset.name}</td>
                    <td className="px-5 py-3 text-[#4A463E]">{asset.detail ? <span className="font-mono text-xs">{asset.detail}</span> : null}{asset.detail && asset.description ? " — " : ""}{asset.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pkg.tables.length > 0 && (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {pkg.tables.map((table) => (
                <div key={table.name} className="rounded-xl border border-[#1B1916]/[0.08] bg-[#FFFFFF] p-4">
                  <p className="font-semibold">{table.name} <span className="font-normal text-[#6E6759]">· {table.rows ? `${table.rows} sample rows` : "schema only"}</span></p>
                  <p className="mt-2 flex flex-wrap gap-1.5">{table.columns.map((c) => <span key={c} className="rounded-md bg-[#F1EDE3] px-1.5 py-0.5 text-xs text-[#4A463E]">{c}</span>)}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Requirements */}
        <section className="border-y border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <SectionHeading eyebrow="Requirements" title="What you connect it to">
              Credentials never travel in a package. The install wizard asks for what your environment must provide, or installs it incomplete until you finish setup.
            </SectionHeading>
            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="font-semibold">Needs</h3>
                <ul className="mt-3 space-y-2">
                  {[...pkg.needs, ...pkg.optional_needs].map((need) => (
                    <li key={need} className="flex gap-2 text-sm leading-6 text-[#4A463E]"><Check size={16} className="mt-1 shrink-0 text-[#4F7A5B]" aria-hidden="true" /><span><strong className="font-semibold text-[#1B1916]">{GALLERY_NEEDS[need].label}{pkg.optional_needs.includes(need) ? " (optional)" : ""}</strong> — {GALLERY_NEEDS[need].description}</span></li>
                  ))}
                </ul>
                <h3 className="mt-8 font-semibold">After installing</h3>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-[#4A463E]">{pkg.setup.map((step) => <li key={step.slice(0, 40)}>{step}</li>)}</ol>
              </div>
              <div>
                <h3 className="font-semibold">Asked for on install</h3>
                {pkg.requirements.length ? (
                  <ul className="mt-3 space-y-3">
                    {pkg.requirements.map((r) => (
                      <li key={r.id} className="rounded-xl border border-[#1B1916]/[0.08] bg-[#FFFFFF] p-4">
                        <p className="flex items-center gap-2 font-medium">{r.kind === "user" ? <FormInput size={14} className="text-[#8A6D45]" aria-hidden="true" /> : <KeyRound size={14} className="text-[#8A6D45]" aria-hidden="true" />}{r.label}{r.required && <span className="rounded bg-[#B08A54]/[0.15] px-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#6F522B]">Required</span>}</p>
                        <ul className="mt-2 space-y-1 text-xs text-[#4A463E]">
                          {r.fields.map((f) => (
                            <li key={f.key} className="flex flex-wrap items-center gap-1.5">
                              {f.secret && <Lock size={11} className="text-[#857D6D]" aria-label="secret" />}
                              <span className="font-medium">{f.label}</span>
                              <span className="font-mono text-[10.5px] text-[#857D6D]">{f.key}</span>
                              {f.default !== undefined && <span className="text-[#857D6D]">default {String(f.default)}</span>}
                              {!f.required && <span className="text-[#857D6D]">· optional</span>}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-3 text-sm text-[#6E6759]">Nothing: it installs complete.</p>}
              </div>
            </div>
          </div>
        </section>

        {/* Install */}
        <section id="install" className="scroll-mt-8 mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <SectionHeading eyebrow="Install" title="Install it in your workspace">
            Works on UserTasks cloud and on any self-hosted instance. Installing creates the assets above; nothing runs until you complete setup and start it.
          </SectionHeading>
          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-6">
              <h3 className="flex items-center gap-2 font-semibold"><FileCheck2 size={16} className="text-[#8A6D45]" aria-hidden="true" /> In the app</h3>
              <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-[#4A463E]">
                <li><a href={pkg.file.file} download={pkg.file.file_name} className="font-semibold text-[#8A6D45] hover:underline">Download {pkg.file.file_name}</a>.</li>
                <li>Open <strong>Automations → Packages</strong> and drag the file onto the page (or choose <strong>Import package</strong>). <strong>Browse gallery</strong> there lists every gallery package without downloading by hand.</li>
                <li>Pick the file. The wizard verifies the checksum, every file hash and the signature, and shows the readme.</li>
                <li>Review the changes (what is created) and the data rows.</li>
                <li>Fill in the requirements, or tick <strong>Keep incomplete</strong> and finish later with <strong>Complete setup</strong>.</li>
                <li>Done: the workflow is published and active once setup is complete.</li>
              </ol>
            </div>
            <div className="grid min-w-0 gap-4">
              <div className="min-w-0">
                <h3 className="mb-2 flex items-center gap-2 font-semibold"><Terminal size={16} className="text-[#8A6D45]" aria-hidden="true" /> With the CLI</h3>
                <Snippet language="shell" code={`curl -fLO ${baseUrl}${pkg.file.file}
usertasks packages inspect ${pkg.file.file_name}       # offline: checksum, hashes, signature
usertasks packages install ${pkg.file.file_name} --dry-run
usertasks packages install ${pkg.file.file_name}       # prompts for each requirement
usertasks packages install ${pkg.file.file_name} --keep-incomplete --yes   # in CI; finish with:
usertasks packages complete ${pkg.slug} -f values.yaml`} />
              </div>
              <div className="rounded-xl border border-[#1B1916]/[0.08] bg-[#F1EDE3] p-4 text-sm">
                <p className="flex items-center gap-2 font-semibold"><Fingerprint size={15} className="text-[#8A6D45]" aria-hidden="true" /> Verify the download</p>
                <dl className="mt-2 grid gap-1.5 text-xs">
                  <div className="grid gap-0.5"><dt className="text-[#6E6759]">File SHA-256</dt><dd className="break-all font-mono text-[11px] text-[#33302A]">{pkg.file.sha256}</dd></div>
                  <div className="grid gap-0.5"><dt className="text-[#6E6759]">Package checksum (what is signed)</dt><dd className="break-all font-mono text-[11px] text-[#33302A]">{pkg.file.checksum}</dd></div>
                  <div className="grid gap-0.5"><dt className="text-[#6E6759]">Signer</dt><dd className="font-mono text-[11px] text-[#33302A]">{signed ? `${GALLERY_SIGNING.key_name} · ${pkg.file.fingerprint}` : "Unsigned preview build — compare the SHA-256 above"}</dd></div>
                </dl>
                <p className="mt-3 text-xs leading-5 text-[#6E6759]"><code className="font-mono">shasum -a 256 {pkg.file.file_name}</code> should print the file SHA-256. <Link href="/gallery#signing" className="font-semibold text-[#8A6D45] hover:underline">How gallery packages are signed</Link>.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Version */}
        <section className="border-t border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <SectionHeading eyebrow="Versions" title={`Version ${pkg.version}`} />
            <ol className="mt-6 space-y-3">
              {pkg.changelog.map((c) => (
                <li key={c.version} className="flex flex-col gap-1 rounded-xl border border-[#1B1916]/[0.08] bg-[#FFFFFF] p-4 sm:flex-row sm:gap-6">
                  <span className="font-mono text-sm font-semibold">v{c.version}</span>
                  <span className="text-sm text-[#6E6759]">{c.date}</span>
                  <span className="text-sm text-[#4A463E]">{c.notes}</span>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-sm text-[#6E6759]">Installing a newer version upgrades in place: local credentials and requirement values are kept, and changes you made are flagged first. <Link href="/docs/packages" className="font-semibold text-[#8A6D45] hover:underline">How packages work</Link></p>
          </div>
        </section>

        {related.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <SectionHeading eyebrow="More packages" title="Related" />
            <ul className="mt-8 grid gap-5 md:grid-cols-3">
              {related.map((other) => <li key={other.slug}><PackageCard card={{ href: `/gallery/${other.slug}`, source: "official", native: other.native, systems: other.systems, slug: other.slug, title: other.title, summary: other.summary, category: other.category, trigger: other.trigger, needs: other.needs, tags: other.tags, difficulty: other.difficulty, setup_minutes: other.setup_minutes, icon: other.icon ?? null, steps: 0, version: other.version }} /></li>)}
            </ul>
            <p className="mt-8"><Link href="/gallery" className="inline-flex items-center gap-1 text-sm font-semibold text-[#8A6D45] hover:underline">Browse the whole gallery <ArrowRight size={14} aria-hidden="true" /></Link></p>
          </section>
        )}
      </main>
    </UseCaseShell>
  )
}
