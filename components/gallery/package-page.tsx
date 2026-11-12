import Link from "next/link"
import { ArrowRight, CalendarClock, Check, FileCheck2, Fingerprint, FormInput, KeyRound, Lock, Radio, Terminal, Webhook } from "lucide-react"
import { Snippet } from "@/components/marketing/marketing-ui"
import { UseCaseShell } from "@/components/marketing/use-case-page"
import { publicBaseUrl } from "@/lib/deployment"
import { sectionLabel, type CatalogField, type CatalogForm, type CatalogWorkflow } from "@/lib/gallery/catalog"
import { formatBytes, galleryCategory, getGalleryControl, GALLERY_SIGNING, relatedPackages, type GalleryPackage } from "@/lib/gallery/site"
import { GALLERY_NEEDS, GALLERY_TRIGGERS } from "@/lib/gallery/types"
import { describeSchedule, normalizeScheduleConfig } from "@/lib/workflow-schedule"
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow-schema"
import { newestRelease } from "@/lib/gallery/browse"
import { officialBrowseItems, solutionItem } from "@/lib/gallery/browse-items"
import { CardStrip } from "./browse-cards"
import { DetailHero, DetailLayout, DetailSection, formatDate, GalleryBreadcrumbs, HeroActions, InstallCard, OfficialPublisher, paragraphs, Pill, SectionNav, sourceUrl, VersionHistory } from "./detail-ui"
import { DIFFICULTY_LABEL, NativeBadge, NeedsChips, PackageIcon, SystemChips, TriggerBadge } from "./gallery-ui"
import { WorkflowPreview } from "./workflow-preview"

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
    ? <div className="flex flex-wrap gap-1">{field.options.slice(0, 6).map((o) => <span key={o} className="rounded-md border border-(color:--mkt-ink)/[0.12] bg-(color:--mkt-paper) px-1.5 py-0.5 text-2xs text-(color:--mkt-text)">{o}</span>)}{field.options.length > 6 && <span className="text-2xs text-(color:--mkt-subtle)">+{field.options.length - 6}</span>}</div>
    : field.type === "boolean"
      ? <span className="inline-flex h-4 w-4 rounded border border-(color:--mkt-ink)/25 bg-(color:--mkt-white)" />
      : <span className="block h-8 truncate rounded-md border border-(color:--mkt-ink)/[0.14] bg-(color:--mkt-white) px-2 text-2xs leading-8 text-[#9A9282]">{field.default ? `Prefilled: ${field.default}` : field.type === "number" ? "0" : field.type === "date" ? "YYYY-MM-DD" : field.type === "datetime" ? "YYYY-MM-DD HH:mm" : field.type === "email" ? "name@company.com" : field.type === "url" ? "https://…" : field.type === "json" ? "{ … }" : ""}</span>
  return (
    <div className="grid gap-1">
      <span className="text-ui font-medium text-(color:--mkt-ink-soft)">{field.label}{field.required && <span className="text-[#A0533F]" aria-label="required"> *</span>} <span className="font-mono text-2xs font-normal text-(color:--mkt-subtle)">{field.key} · {field.type}</span></span>
      {control}
      {field.description && <span className="text-2xs leading-4 text-(color:--mkt-muted)">{field.description}</span>}
    </div>
  )
}

function formShape(form: { columns?: number; themed?: boolean }): string | null {
  const parts = [form.columns ? `${form.columns}-column grid` : null, form.themed ? "own header and theme" : null].filter(Boolean)
  return parts.length ? parts.join(" · ") : null
}

function FormCard({ title, subtitle, fields, outcomes, badge, uses }: { title: string; subtitle?: string; fields: CatalogField[]; outcomes?: string[]; badge: string; uses?: string[] }) {
  return (
    <article className="flex flex-col rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-5">
      <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-(color:--mkt-bronze)">{badge}</p>
      <h3 className="mt-1 font-semibold leading-snug">{title}</h3>
      {subtitle && <p className="mt-1 text-xs leading-5 text-(color:--mkt-muted)">{subtitle}</p>}
      {uses && uses.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-2xs text-(color:--mkt-muted)" data-testid="form-uses">
          <span className="font-semibold uppercase tracking-[0.12em]">Uses</span>
          {uses.map((u) => <span key={u} className="rounded-full bg-(color:--mkt-gold)/[0.14] px-2 py-0.5 font-medium text-[#6B5232]">{u}</span>)}
        </p>
      )}
      <div className="mt-4 grid flex-1 content-start gap-3">
        {fields.length ? fields.map((field) => <FieldPreview key={field.key} field={field} />) : <p className="text-sm text-(color:--mkt-muted)">No fields: the person picks an outcome.</p>}
      </div>
      {outcomes && outcomes.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-(color:--mkt-ink)/[0.07] pt-4">
          {outcomes.map((o, i) => <span key={o} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${i === 0 ? "bg-(color:--mkt-primary) text-(color:--mkt-paper)" : "border border-(color:--mkt-ink)/15 text-(color:--mkt-ink-soft)"}`}>{o}</span>)}
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
  const cli = `usertasks workflows inputs <workflow id>
usertasks workflows run <workflow id> ${inputs}${Object.keys(pkg.sample_input).length > 4 ? " …" : ""} --wait`
  const webhook = entry?.trigger_type === "webhook_received" || entry?.trigger_type === "middleware_received"
    ? `usertasks webhooks create <workflow id>
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

  const source = sourceUrl(`gallery/packages/${pkg.slug}`)
  const grouped = Object.entries(pkg.assets.reduce<Record<string, typeof pkg.assets>>((acc, a) => ({ ...acc, [a.section]: [...(acc[a.section] ?? []), a] }), {}))
  const hasForms = startInputs.length > 0 || forms.length > 0
  const sections = [
    { id: "overview", label: "Overview" },
    { id: "included", label: "What's included" },
    { id: "preview", label: "Preview" },
    ...(hasForms ? [{ id: "forms", label: "Forms" }] : []),
    { id: "requirements", label: "Requirements" },
    { id: "api", label: "API" },
    { id: "install", label: "Install" },
    { id: "versions", label: "Versions" },
  ]
  const relatedItems = related.map(solutionItem)
  const reference = newestRelease(officialBrowseItems())

  return (
    <UseCaseShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <main>
        <DetailHero
          breadcrumbs={<GalleryBreadcrumbs trail={[{ label: "Gallery", href: "/gallery" }, { label: category.title, href: `/gallery?category=${category.id}` }, { label: pkg.title }]} />}
          icon={<PackageIcon icon={pkg.icon} category={pkg.category} size={30} />}
          eyebrow={`${category.title} solution`}
          title={pkg.title}
          summary={pkg.summary}
          badges={(
            <>
              <OfficialPublisher signed={signed} />
              {pkg.native && <NativeBadge size="md" />}
              <TriggerBadge trigger={pkg.trigger} size="md" />
              <Pill mono>v{pkg.version}</Pill>
              <Pill>Updated <time dateTime={pkg.released}>{formatDate(pkg.released)}</time></Pill>
              {pkg.systems.length > 0 && <span className="inline-flex items-center gap-2 text-sm text-(color:--mkt-muted)">Connects to <SystemChips systems={pkg.systems} /></span>}
            </>
          )}
          actions={<HeroActions source={source} />}
        />
        <SectionNav sections={sections} />
        <DetailLayout
          aside={(
            <InstallCard
              file={pkg.file}
              downloadTestId="download-package"
              source={source}
              facts={[
                { label: "Version", value: <span className="font-mono">v{pkg.version}</span> },
                { label: "Last updated", value: <time dateTime={pkg.released}>{formatDate(pkg.released)}</time> },
                { label: "Publisher", value: "UserTasks (Official)" },
                { label: "Starts", value: GALLERY_TRIGGERS[pkg.trigger].label },
                { label: "Setup", value: `~${pkg.setup_minutes} min · ${DIFFICULTY_LABEL[pkg.difficulty] ?? pkg.difficulty}` },
                { label: "Asked on install", value: pkg.requirements.length ? `${pkg.requirements.length} requirement${pkg.requirements.length === 1 ? "" : "s"}` : "Nothing" },
                { label: "Size", value: formatBytes(pkg.file.size_bytes) },
              ]}
            >
              <NeedsChips needs={pkg.needs} />
              {pkg.optional_needs.length > 0 && <div className="mt-2"><NeedsChips needs={pkg.optional_needs} label="Optional" /></div>}
            </InstallCard>
          )}
        >
          <DetailSection id="overview" eyebrow="Overview" title="What it does">
            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-4 text-base leading-7 text-(color:--mkt-text)">{paragraphs(pkg.description).map((p) => <p key={p.slice(0, 40)}>{p}</p>)}</div>
              <div className={`h-fit rounded-2xl border p-5 ${pkg.trigger === "form" ? "border-(color:--mkt-gold)/35 bg-(color:--mkt-gold)/[0.07]" : "border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-sand)"}`}>
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-(color:--mkt-white) text-(color:--mkt-bronze)"><StartIcon size={18} aria-hidden="true" /></span>
                <h3 className="mt-3 text-lg font-semibold">{GALLERY_TRIGGERS[pkg.trigger].label}</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{startDetail(pkg, entry)}</p>
                <p className="mt-3 text-xs leading-5 text-(color:--mkt-muted)">{GALLERY_TRIGGERS[pkg.trigger].description}</p>
                {pkg.trigger === "form" && <Link href="/forms" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline">How forms work <ArrowRight size={14} aria-hidden="true" /></Link>}
              </div>
            </div>
            <h3 className="mt-10 text-lg font-semibold">Step by step</h3>
            <ol className="mt-4 grid gap-3 md:grid-cols-2">
              {pkg.steps.map((step, i) => (
                <li key={step.title} className="flex gap-3 rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-4">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(color:--mkt-primary) text-xs font-bold text-(color:--mkt-paper)">{i + 1}</span>
                  <div><p className="font-semibold leading-snug">{step.title}</p><p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{step.body}</p></div>
                </li>
              ))}
            </ol>
          </DetailSection>

          <DetailSection id="included" eyebrow="What's included" title={`${pkg.asset_count} assets, ready to adapt`} intro="Everything installs as ordinary workflows, tables, rules and integrations in your workspace: edit them in the designers afterwards.">
            <ul className="mb-6 flex flex-wrap gap-2" data-testid="included-counts">
              {counts.map(([section, n]) => <li key={section} className="rounded-full bg-(color:--mkt-ink)/[0.05] px-3 py-1 text-sm text-(color:--mkt-ink-soft)"><span className="num font-semibold">{n}</span> {sectionLabel(section).replace(/^(?!API|AI)\w/, (c) => c.toLowerCase())}{n === 1 ? "" : "s"}</li>)}
            </ul>
            <div className="grid gap-4 md:grid-cols-2">
              {grouped.map(([section, assets]) => (
                <div key={section} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5">
                  <h3 className="flex items-center justify-between gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-(color:--mkt-muted)">{sectionLabel(section)} <span className="num rounded-full bg-(color:--mkt-sand) px-2 py-0.5 text-xs text-(color:--mkt-ink-soft)">{assets.length}</span></h3>
                  <ul className="mt-3 space-y-3">
                    {assets.map((asset) => (
                      <li key={`${asset.section}-${asset.name}`} className="text-sm">
                        <p className="font-medium text-(color:--mkt-ink)">{asset.name}{asset.detail && <span className="ml-2 font-mono text-xs font-normal text-(color:--mkt-muted)">{asset.detail}</span>}</p>
                        {asset.description && <p className="mt-0.5 leading-6 text-(color:--mkt-text)">{asset.description}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {pkg.tables.length > 0 && (
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {pkg.tables.map((table) => (
                  <div key={table.name} className="rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-4">
                    <p className="font-semibold">{table.name} <span className="font-normal text-(color:--mkt-muted)">· {table.rows ? `${table.rows} sample rows` : "schema only"}</span></p>
                    <p className="mt-2 flex flex-wrap gap-1.5">{table.columns.map((c) => <span key={c} className="rounded-md bg-(color:--mkt-sand) px-1.5 py-0.5 text-xs text-(color:--mkt-text)">{c}</span>)}</p>
                  </div>
                ))}
              </div>
            )}
            {pkg.controls.length > 0 && (
              <div className="mt-8" data-testid="package-form-controls">
                <h3 className="text-lg font-semibold">{pkg.controls.length} official form control{pkg.controls.length === 1 ? "" : "s"}, installed with it</h3>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-(color:--mkt-text)">The forms use these controls from the gallery. They come inside the package and install into Extensibility → Form controls, sandboxed and signed like every official control: nothing else to download.</p>
                <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                  {pkg.controls.map((control) => {
                    const listing = getGalleryControl(control.slug)
                    return (
                      <li key={control.tag}>
                        <Link href={`/gallery/controls/${control.slug}`} className="group mkt-lift flex h-full flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-4 hover:border-(color:--mkt-bronze)/40">
                          <span className="flex items-center gap-2"><span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-(color:--mkt-gold)/[0.14] text-(color:--mkt-bronze)"><PackageIcon icon={listing?.icon ?? null} category="form-controls" size={16} /></span><span className="font-semibold">{listing?.title ?? control.name}</span></span>
                          <span className="mt-1 font-mono text-2xs text-(color:--mkt-subtle)">&lt;{control.tag}&gt;</span>
                          {listing && <span className="mt-2 flex-1 text-sm leading-6 text-(color:--mkt-text)">{listing.summary}</span>}
                          <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) group-hover:underline">Try it live <ArrowRight size={14} aria-hidden="true" /></span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </DetailSection>

          <DetailSection id="preview" eyebrow="Preview" title="The workflow canvas" intro="The same canvas you get in the designer after installing.">
            {entry && (
              <figure>
                <WorkflowPreview nodes={entry.nodes as WorkflowNode[]} edges={entry.edges as WorkflowEdge[]} tableNames={tableNames} label={`Workflow canvas of ${entry.name}: ${entry.nodes.length} steps`} markerPrefix={`gp-${pkg.slug}-entry`} />
                <figcaption className="mt-3 text-sm leading-6 text-(color:--mkt-muted)"><strong className="font-semibold text-(color:--mkt-ink-soft)">{entry.name}</strong> — {(entry.description ?? `${entry.nodes.length} steps`).replace(/\.$/, "")}.</figcaption>
              </figure>
            )}
            {others.map((wf) => (
              <figure key={wf.id} className="mt-10">
                <h3 className="mb-3 text-lg font-semibold">Sub-workflow: {wf.name}</h3>
                <WorkflowPreview nodes={wf.nodes as WorkflowNode[]} edges={wf.edges as WorkflowEdge[]} tableNames={tableNames} label={`Workflow canvas of ${wf.name}`} markerPrefix={`gp-${pkg.slug}-${wf.id.slice(0, 8)}`} />
                {wf.description && <figcaption className="mt-3 text-sm leading-6 text-(color:--mkt-muted)">{wf.description}</figcaption>}
              </figure>
            ))}
          </DetailSection>

          {hasForms && (
            <DetailSection id="forms" eyebrow="Forms" title={pkg.trigger === "form" ? "The start form and the task forms" : "Inputs and task forms"}
              intro={pkg.trigger === "form"
                ? (forms.some((f) => f.kind === "page")
                  ? "People start it from a form page (/f/<id>) with its own header, theme and buttons; submitting it starts the workflow. User Tasks show their fields and outcome buttons to the assignee."
                  : "The workflow inputs are the start form: the Run dialog renders them on its grid and theme, and your own portal can post the same fields. User Tasks show their fields and outcome buttons to the assignee.")
                : "The inputs a caller passes when it starts a run, and the forms people complete when the process needs a decision."}>
              <div className="grid gap-4 md:grid-cols-2">
                {startInputs.length > 0 && !forms.some((f) => f.kind === "page") && <FormCard badge={pkg.trigger === "form" ? "Start form" : "Start inputs"} title={entry?.name ?? pkg.title} subtitle={pkg.trigger === "form" ? "Filled in by whoever starts the process" : "Passed by the calling system"} fields={startInputs} />}
                {forms.map((form) => form.kind === "page"
                  ? <FormCard key={`page-${form.step}`} badge="Form page · /f/<id>" title={form.step} subtitle={[form.title !== form.step ? form.title : null, formShape(form), "Its own page: share the link or open it on a tablet"].filter(Boolean).join(" · ")} fields={form.fields} outcomes={form.buttons} uses={form.uses} />
                  : <FormCard key={`${form.workflow}-${form.step}`} badge={`User Task${form.workflow !== entry?.name ? ` · ${form.workflow}` : ""}`} title={form.step} subtitle={[form.title, formShape(form)].filter(Boolean).join(" · ")} fields={form.fields} outcomes={form.buttons?.length ? form.buttons : form.outcomes} uses={form.uses} />)}
              </div>
            </DetailSection>
          )}

          <DetailSection id="requirements" eyebrow="Permissions and requirements" title="What you connect it to" intro="Credentials never travel in a package. The install wizard asks for what your environment must provide, or installs it incomplete until you finish setup.">
            <div className="grid gap-6 xl:grid-cols-2">
              <div>
                <h3 className="font-semibold">Needs</h3>
                {[...pkg.needs, ...pkg.optional_needs].length ? (
                  <ul className="mt-3 space-y-2">
                    {[...pkg.needs, ...pkg.optional_needs].map((need) => (
                      <li key={need} className="flex gap-2 text-sm leading-6 text-(color:--mkt-text)"><Check size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" /><span><strong className="font-semibold text-(color:--mkt-ink)">{GALLERY_NEEDS[need].label}{pkg.optional_needs.includes(need) ? " (optional)" : ""}</strong> — {GALLERY_NEEDS[need].description}</span></li>
                    ))}
                  </ul>
                ) : <p className="mt-3 text-sm text-(color:--mkt-muted)">Nothing beyond UserTasks itself.</p>}
                <h3 className="mt-8 font-semibold">After installing</h3>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-(color:--mkt-text)">{pkg.setup.map((step) => <li key={step.slice(0, 40)}>{step}</li>)}</ol>
              </div>
              <div>
                <h3 className="font-semibold">Asked for on install</h3>
                {pkg.requirements.length ? (
                  <ul className="mt-3 space-y-3">
                    {pkg.requirements.map((r) => (
                      <li key={r.id} className="rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-4">
                        <p className="flex flex-wrap items-center gap-2 font-medium">{r.kind === "user" ? <FormInput size={14} className="text-(color:--mkt-bronze)" aria-hidden="true" /> : <KeyRound size={14} className="text-(color:--mkt-bronze)" aria-hidden="true" />}{r.label}{r.required && <span className="rounded bg-(color:--mkt-gold)/[0.15] px-1.5 text-2xs font-semibold text-[#6F522B]">Required</span>}</p>
                        <ul className="mt-2 space-y-1 text-xs text-(color:--mkt-text)">
                          {r.fields.map((f) => (
                            <li key={f.key} className="flex flex-wrap items-center gap-1.5">
                              {f.secret && <Lock size={11} className="text-(color:--mkt-subtle)" aria-label="secret" />}
                              <span className="font-medium">{f.label}</span>
                              <span className="break-all font-mono text-2xs text-(color:--mkt-subtle)">{f.key}</span>
                              {f.default !== undefined && <span className="break-all text-(color:--mkt-subtle)">default {String(f.default)}</span>}
                              {!f.required && <span className="text-(color:--mkt-subtle)">· optional</span>}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-3 text-sm text-(color:--mkt-muted)">Nothing: it installs complete.</p>}
              </div>
            </div>
          </DetailSection>

          <DetailSection id="api" eyebrow={pkg.trigger === "api" ? "Headless" : "From your code"} title={pkg.trigger === "api" ? "Call it from your systems" : "Start a run over the API"}
            intro={<>Every workflow can be started over REST, MCP or the CLI, whatever its trigger, with the sample input below. Runs start straight away on the published version; replace {"<workflow id>"} with the id the install created.</>}>
            <div className="grid gap-5">
              <div className="min-w-0"><p className="mb-2 text-sm font-semibold">REST</p><Snippet code={calls.start} language="shell" /></div>
              <div className="min-w-0"><p className="mb-2 text-sm font-semibold">CLI</p><Snippet code={calls.cli} language="shell" /><p className="mt-2 text-xs leading-5 text-(color:--mkt-muted)"><code className="font-mono">workflows inputs</code> shows the start form: keys, types and which are required.</p></div>
              {calls.webhook && <div className="min-w-0"><p className="mb-2 text-sm font-semibold">Inbound webhook{entry?.trigger_type === "middleware_received" ? " (synchronous: the response is the workflow result)" : ""}</p><Snippet code={calls.webhook} language="shell" /><p className="mt-2 text-xs leading-5 text-(color:--mkt-muted)"><code className="font-mono">webhooks create</code> prints the hook slug and its secret once: keep the secret for the Authorization header.</p></div>}
            </div>
          </DetailSection>

          <DetailSection id="install" eyebrow="Install" title="Install it in your workspace" intro="Works on UserTasks cloud and on any self-hosted instance. Installing creates the assets above; nothing runs until you complete setup and start it.">
            <div className="grid gap-5 xl:grid-cols-2">
              <div className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-6">
                <h3 className="flex items-center gap-2 font-semibold"><FileCheck2 size={16} className="text-(color:--mkt-bronze)" aria-hidden="true" /> In the app</h3>
                <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-(color:--mkt-text)" data-testid="install-steps">
                  <li><a href={pkg.file.file} download={pkg.file.file_name} className="break-all font-semibold text-(color:--mkt-bronze) hover:underline">Download {pkg.file.file_name}</a>.</li>
                  <li>Open <strong>Automations → Packages</strong> and drag the file onto the page (or choose <strong>Import package</strong>). <strong>Browse gallery</strong> there lists every gallery package without downloading by hand.</li>
                  <li>Pick the file. The wizard verifies the checksum, every file hash and the signature, and shows the readme.</li>
                  <li>Review the changes (what is created) and the data rows.</li>
                  <li>Fill in the requirements, or tick <strong>Keep incomplete</strong> and finish later with <strong>Complete setup</strong>.</li>
                  <li>Done: the workflow is published and active once setup is complete.</li>
                </ol>
              </div>
              <div className="grid min-w-0 gap-4">
                <div className="min-w-0">
                  <h3 className="mb-2 flex items-center gap-2 font-semibold"><Terminal size={16} className="text-(color:--mkt-bronze)" aria-hidden="true" /> With the CLI</h3>
                  <Snippet language="shell" code={`curl -fLO ${baseUrl}${pkg.file.file}
usertasks packages inspect ${pkg.file.file_name}
usertasks packages install ${pkg.file.file_name} --dry-run
usertasks packages install ${pkg.file.file_name}`} />
                  <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)"><code className="font-mono">inspect</code> checks the checksum, hashes and signature offline; <code className="font-mono">install</code> prompts for each requirement. In CI, install without prompts and finish setup from a values file:</p>
                  <div className="mt-2"><Snippet language="shell" code={`usertasks packages install ${pkg.file.file_name} --keep-incomplete --yes
usertasks packages complete ${pkg.slug} -f values.yaml`} /></div>
                </div>
              </div>
            </div>
            <div className="mt-5 rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold"><Fingerprint size={15} className="text-(color:--mkt-bronze)" aria-hidden="true" /> Verify the download</p>
              <dl className="mt-2 grid gap-1.5 text-xs">
                <div className="grid gap-0.5"><dt className="text-(color:--mkt-muted)">File SHA-256</dt><dd className="break-all font-mono text-2xs text-(color:--mkt-ink-soft)">{pkg.file.sha256}</dd></div>
                <div className="grid gap-0.5"><dt className="text-(color:--mkt-muted)">Package checksum (what is signed)</dt><dd className="break-all font-mono text-2xs text-(color:--mkt-ink-soft)">{pkg.file.checksum}</dd></div>
                <div className="grid gap-0.5"><dt className="text-(color:--mkt-muted)">Signer</dt><dd className="break-all font-mono text-2xs text-(color:--mkt-ink-soft)">{signed ? `${GALLERY_SIGNING.key_name} · ${pkg.file.fingerprint}` : "Unsigned preview build — compare the SHA-256 above"}</dd></div>
              </dl>
              <p className="mt-3 text-xs leading-5 text-(color:--mkt-muted)"><code className="break-all font-mono">shasum -a 256 {pkg.file.file_name}</code> should print the file SHA-256. <Link href="/gallery#signing" className="font-semibold text-(color:--mkt-bronze) hover:underline">How gallery packages are signed</Link>.</p>
            </div>
          </DetailSection>

          <DetailSection id="versions" eyebrow="Version history" title={`Version ${pkg.version}`}>
            <VersionHistory changelog={pkg.changelog} current={pkg.version} />
            <p className="mt-6 text-sm text-(color:--mkt-muted)">Installing a newer version upgrades in place: local credentials and requirement values are kept, and changes you made are flagged first. <Link href="/docs/packages" className="font-semibold text-(color:--mkt-bronze) hover:underline">How packages work</Link></p>
          </DetailSection>
        </DetailLayout>

        {relatedItems.length > 0 && (
          <section className="border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50" data-testid="related">
            <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
              <CardStrip eyebrow="More solutions" title="Related" items={relatedItems} reference={reference} more={{ href: "/gallery", label: "Browse the whole gallery" }} />
            </div>
          </section>
        )}
      </main>
    </UseCaseShell>
  )
}
