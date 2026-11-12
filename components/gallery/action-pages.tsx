import Link from "next/link"
import { ArrowRight, Cpu, FileCheck2, Fingerprint, Globe, KeyRound, Lock, Database, FileText, Terminal, Timer, Workflow } from "lucide-react"
import { SectionHeading, Snippet } from "@/components/marketing/marketing-ui"
import { UseCaseShell } from "@/components/marketing/use-case-page"
import { publicBaseUrl } from "@/lib/deployment"
import { formatBytes, GALLERY_ACTIONS, GALLERY_SIGNING, type GalleryAction } from "@/lib/gallery/site"
import type { ActionField } from "@/lib/custom-actions/contract"
import { actionFieldTypeLabel } from "@/lib/custom-actions/manifest"
import { newestRelease } from "@/lib/gallery/browse"
import { officialBrowseItems } from "@/lib/gallery/browse-items"
import { GalleryBrowser } from "./gallery-browser"
import { BrowseCard, CardStrip, renderBrowseCards } from "./browse-cards"
import { DetailHero, DetailLayout, DetailSection, formatDate, GalleryBreadcrumbs, GalleryTabs, HeroActions, InstallCard, OfficialPublisher, paragraphs, Pill, primaryButton, secondaryButton, SectionNav, sourceUrl, VersionHistory } from "./detail-ui"
import { PackageIcon } from "./gallery-ui"

export const ACTIONS_TITLE = "Workflow actions gallery"
export const ACTIONS_DESCRIPTION = "Official custom workflow actions for UserTasks: math and statistics (loan schedules, compound interest, percentiles, unit conversion), text tools, business-day and SLA calendars, data transforms, IBAN / card / national ID validation and locale formatting, and UUIDs, hashes, HMAC and signed tokens. Each runs in a WebAssembly sandbox with typed inputs and outputs."


function capabilityText(action: GalleryAction): string {
  const c = action.capabilities
  if (!c.capabilities.length) return "None — pure computation"
  return c.capabilities.map((x) => (x === "secrets" ? `secrets (${c.secrets.join(", ")})` : x === "http" ? `HTTP (${c.hosts.join(", ")})` : x)).join(", ")
}

function json(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? "null"
  return text.length > 1800 ? `${text.slice(0, 1800)}\n…` : text
}

/** Workflow actions strip (the /gallery index). */
export function ActionsTeaser({ limit = 6 }: { limit?: number }) {
  const all = officialBrowseItems()
  const reference = newestRelease(all)
  const actions = all.filter((i) => i.kind === "action").slice(0, limit)
  if (!actions.length) return null
  return (
    <div data-testid="actions-teaser">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading eyebrow="Workflow actions" title="Custom steps for your workflows">
          Official sandboxed actions that install into Extensibility → Workflow actions: math and finance, text, business calendars, data transforms, validation and crypto.
        </SectionHeading>
        <Link href="/gallery/actions" className="inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline">All {GALLERY_ACTIONS.length} actions <ArrowRight size={14} aria-hidden="true" /></Link>
      </div>
      <ul className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {actions.map((a) => <li key={a.key} className="min-w-0"><BrowseCard item={a} reference={reference} /></li>)}
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
  const items = officialBrowseItems().filter((i) => i.kind === "action")
  const reference = newestRelease(officialBrowseItems())
  const functions = GALLERY_ACTIONS.reduce((n, a) => n + a.operations.length, 0)
  return (
    <UseCaseShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <main>
        <GalleryBrowser
          items={items}
          cards={renderBrowseCards(items, reference)}
          scope="action"
          searchLabel="Search workflow actions"
          placeholder="Search actions: loan, business days, slugify, IBAN…"
          noun={{ one: "action", many: "actions" }}
          hero={(
            <>
              <GalleryBreadcrumbs trail={[{ label: "Gallery", href: "/gallery" }, { label: "Workflow actions" }]} />
              <GalleryTabs active="actions" />
              <h1 className="mt-6 max-w-4xl font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.06] tracking-tight sm:text-6xl">The steps you keep rebuilding, ready to drop in.</h1>
              <p className="mkt-body mt-5 max-w-3xl text-(color:--mkt-text)">
                {GALLERY_ACTIONS.length} official actions with {functions} functions — loan schedules and percentiles, slugs and fuzzy matching, business-day SLAs and fiscal periods, group-by and joins, IBAN and national ID checks, UUIDs and signed tokens. Install one and it appears in the workflow designer&apos;s <strong>Custom actions</strong> palette with a typed input panel, and its outputs show up in the data picker with their types.
              </p>
            </>
          )}
          heroFooter={(
            <div className="mt-6 flex flex-wrap gap-3">
              <Link key="/docs/workflows/official-actions" href="/docs/workflows/official-actions" className={primaryButton}>Action reference <ArrowRight size={15} aria-hidden="true" /></Link>
              <Link key="/docs/workflows/custom-actions" href="/docs/workflows/custom-actions" className={secondaryButton}>Build your own</Link>
            </div>
          )}
        />
        <section className="border-y border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <SectionHeading eyebrow="Security" title="Your workflow runs the code. It never touches your server.">
              Custom actions run tenant code, so they run it somewhere it cannot hurt anything:
            </SectionHeading>
            <ul className="mt-8 grid gap-4 md:grid-cols-2">
              {SECURITY.map((s) => (
                <li key={s.title} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5">
                  <p className="flex items-center gap-2 font-semibold"><s.icon size={16} className="text-(color:--mkt-bronze)" aria-hidden="true" /> {s.title}</p>
                  <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{s.body}</p>
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
              <li key={step.title} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5">
                <p className="text-xs font-semibold text-(color:--mkt-subtle)">Step {i + 1}</p>
                <h3 className="font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{step.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-sm text-(color:--mkt-text)">Need something else? <Link href="/workflows#actions" className="font-semibold text-(color:--mkt-bronze) hover:underline">Build any action</Link> with the starter kit and the <code className="font-mono">@user-tasks/action</code> helper.</p>
        </section>
      </main>
    </UseCaseShell>
  )
}

function FieldList({ fields }: { fields: ActionField[] }) {
  if (!fields.length) return <p className="text-sm text-(color:--mkt-muted)">None</p>
  return (
    <ul className="space-y-1.5 text-sm">
      {fields.map((f) => (
        <li key={f.name} className="leading-6">
          <code className="font-mono text-ui text-(color:--mkt-ink-soft)">{f.name}</code>{" "}
          <span className="text-xs text-(color:--mkt-subtle)">{actionFieldTypeLabel(f)}{f.required ? " · required" : ""}{f.type === "select" && f.options?.length ? ` · ${f.options.map((o) => o.value).slice(0, 6).join(" / ")}${f.options.length > 6 ? " / …" : ""}` : ""}</span>
          {f.description && <span className="text-(color:--mkt-text)"> — {f.description}</span>}
          {f.type === "array" && f.items?.fields?.length ? <span className="block pl-4 text-xs text-(color:--mkt-muted)">each: {f.items.fields.map((x) => `${x.name} (${actionFieldTypeLabel(x)})`).join(", ")}</span> : null}
        </li>
      ))}
    </ul>
  )
}

export function ActionDetailPage({ action }: { action: GalleryAction }) {
  const baseUrl = publicBaseUrl()
  const url = `${baseUrl}/gallery/actions/${action.slug}`
  const signed = action.file.signed
  const allItems = officialBrowseItems()
  const reference = newestRelease(allItems)
  const related = allItems.filter((a) => a.kind === "action" && a.slug !== action.slug).slice(0, 3)
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
  const source = sourceUrl(`gallery/actions/${action.slug}`)
  const sections = [
    { id: "overview", label: "Overview" },
    ...(action.examples.length ? [{ id: "examples", label: "Examples" }] : []),
    { id: "included", label: "What's included" },
    { id: "reference", label: "Reference" },
    { id: "permissions", label: "Permissions" },
    { id: "install", label: "Install" },
    { id: "versions", label: "Versions" },
  ]
  return (
    <UseCaseShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <main>
        <DetailHero
          breadcrumbs={<GalleryBreadcrumbs trail={[{ label: "Gallery", href: "/gallery" }, { label: "Workflow actions", href: "/gallery/actions" }, { label: action.title }]} />}
          icon={<PackageIcon icon={action.icon} category="workflow-actions" size={30} />}
          eyebrow="Workflow action"
          title={action.title}
          subtitle={action.key}
          summary={action.summary}
          badges={(
            <>
              <OfficialPublisher signed={signed} />
              <Pill mono>v{action.version}</Pill>
              <Pill>Updated <time dateTime={action.released}>{formatDate(action.released)}</time></Pill>
              <Pill>{action.operations.length} functions</Pill>
              {caps.capabilities.length === 0 && <span className="inline-flex items-center gap-1 rounded-full bg-(color:--mkt-green)/[0.12] px-3 py-1 text-sm font-semibold text-[#2F5A3B]"><Lock size={13} aria-hidden="true" /> Pure computation</span>}
            </>
          )}
          actions={<HeroActions source={source} />}
        />
        <SectionNav sections={sections} />
        <DetailLayout
          aside={(
            <InstallCard
              file={action.file}
              downloadTestId="download-action"
              source={source}
              facts={[
                { label: "Version", value: <span className="font-mono">v{action.version}</span> },
                { label: "Last updated", value: <time dateTime={action.released}>{formatDate(action.released)}</time> },
                { label: "Publisher", value: "UserTasks (Official)" },
                { label: "Functions", value: String(action.operations.length) },
                { label: "Capabilities", value: caps.capabilities.length ? caps.capabilities.join(", ") : "None" },
                { label: "Limits", value: `${action.limits.timeout_ms / 1000} s · ${action.limits.memory_mb} MB` },
                { label: "Module", value: formatBytes(caps.module_bytes) },
              ]}
            />
          )}
        >
          <DetailSection id="overview" eyebrow="Overview" title="What it does">
            <div className="space-y-4 text-base leading-7 text-(color:--mkt-text)">{paragraphs(action.description).map((p) => <p key={p.slice(0, 40)}>{p}</p>)}</div>
            {action.uses.length > 0 && (
              <>
                <h3 className="mt-8 font-semibold">Good for</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-(color:--mkt-text)">{action.uses.map((u) => <li key={u}>{u}</li>)}</ul>
              </>
            )}
          </DetailSection>

          {action.examples.length > 0 && (
            <DetailSection id="examples" eyebrow="Examples" title="Real inputs, real outputs" intro="Each example ran in the sandbox when this gallery was built; the outputs are exactly what the step returns.">
              <div className="grid gap-4 xl:grid-cols-2">
                {action.examples.map((ex) => (
                  <div key={`${ex.operation}-${ex.title}`} className="min-w-0 rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-5" data-testid="action-example">
                    <p className="font-semibold">{ex.title} <span className="font-mono text-xs font-normal text-(color:--mkt-subtle)">{ex.operation}</span></p>
                    {ex.note && <p className="mt-1 text-sm text-(color:--mkt-text)">{ex.note}</p>}
                    <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-(color:--mkt-subtle)">Inputs</p>
                    <pre className="mt-1 max-h-56 overflow-auto rounded-lg bg-(color:--mkt-canvas) p-3 font-mono text-xs leading-5 text-(color:--mkt-ink-soft)">{json(ex.inputs)}</pre>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-(color:--mkt-subtle)">Outputs</p>
                    <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-(color:--mkt-code-bg) p-3 font-mono text-xs leading-5 text-(color:--mkt-code-text)">{ex.varies ? "Different on every run (random or time based)." : json(ex.outputs)}</pre>
                  </div>
                ))}
              </div>
            </DetailSection>
          )}

          <DetailSection id="included" eyebrow="What's included" title={`${action.operations.length} functions and a sample workflow`}>
            <ul className="flex flex-wrap gap-2">
              {action.operations.map((op) => <li key={op.id}><a href={`#fn-${op.id}`} className="inline-flex rounded-full border border-(color:--mkt-ink)/[0.1] bg-(color:--mkt-white) px-3 py-1 text-sm text-(color:--mkt-ink-soft) hover:border-(color:--mkt-bronze)/40">{op.label}</a></li>)}
            </ul>
            {action.sample_workflows.length > 0 && (
              <ul className="mt-5 grid gap-3 md:grid-cols-2">
                {action.sample_workflows.map((w) => (
                  <li key={w.name} className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-5">
                    <p className="flex items-center gap-2 font-semibold"><Workflow size={15} className="text-(color:--mkt-bronze)" aria-hidden="true" /> {w.name} <span className="text-xs font-normal text-(color:--mkt-muted)">sample workflow · {w.steps} steps</span></p>
                    {w.description && <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{w.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </DetailSection>

          <DetailSection id="reference" eyebrow="Reference" title="Functions, inputs and outputs" intro="The designer generates each function's input panel from these declarations; outputs appear in the data picker with their types.">
            <div className="grid gap-4">
              {action.operations.map((op) => (
                <div key={op.id} id={`fn-${op.id}`} className="scroll-mt-32 rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-5">
                  <h3 className="font-semibold">{op.label} <span className="font-mono text-xs font-normal text-(color:--mkt-subtle)">{op.id}</span></h3>
                  {op.description && <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{op.description}</p>}
                  <div className="mt-4 grid gap-6 md:grid-cols-2">
                    <div className="min-w-0"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-(color:--mkt-subtle)">Inputs</p><FieldList fields={op.inputs} /></div>
                    <div className="min-w-0"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-(color:--mkt-subtle)">Outputs</p><FieldList fields={op.outputs} /></div>
                  </div>
                </div>
              ))}
            </div>
          </DetailSection>

          <DetailSection id="permissions" eyebrow="Permissions and requirements" title="What it can reach">
            <div className="grid gap-3 text-sm md:grid-cols-3">
              <div className="rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-4"><p className="flex items-center gap-2 font-semibold"><Globe size={14} aria-hidden="true" /> Network</p><p className="mt-1 break-words text-(color:--mkt-text)">{caps.hosts.length ? `Only ${caps.hosts.join(", ")}, once an administrator approves.` : "None. The action cannot make requests."}</p></div>
              <div className="rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-4"><p className="flex items-center gap-2 font-semibold"><Database size={14} aria-hidden="true" /> Data and files</p><p className="mt-1 text-(color:--mkt-text)">{caps.capabilities.includes("data") || caps.capabilities.includes("files") ? "Only tables an administrator grants and files given as inputs." : "None. It only sees its inputs."}</p></div>
              <div className="rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-4"><p className="flex items-center gap-2 font-semibold"><FileText size={14} aria-hidden="true" /> Secrets</p><p className="mt-1 text-(color:--mkt-text)">{caps.secrets.length ? <>Declared: {caps.secrets.map((x) => <code key={x} className="mr-1 font-mono text-xs">secret://{x}</code>)}— set once in Extensibility, stored encrypted, never shown again.</> : "None."}</p></div>
            </div>
            <p className="mt-4 text-sm text-(color:--mkt-muted)">Capabilities: {capabilityText(action)}. Limits: {action.limits.timeout_ms / 1000} s and {action.limits.memory_mb} MB per run.</p>
            <h3 className="mt-8 font-semibold">After installing</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-(color:--mkt-text)">{action.setup.map((step) => <li key={step}>{step}</li>)}</ol>
          </DetailSection>

          <DetailSection id="install" eyebrow="Install" title="Install it in your workspace" intro="Works on UserTasks cloud and any self-hosted instance. The action lands in Extensibility → Workflow actions, enabled, with its sample workflow.">
            <div className="grid gap-5 xl:grid-cols-2">
              <div className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-6">
                <h3 className="flex items-center gap-2 font-semibold"><FileCheck2 size={16} className="text-(color:--mkt-bronze)" aria-hidden="true" /> In the app</h3>
                <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-(color:--mkt-text)" data-testid="install-steps">
                  <li>Open <strong>Extensibility → Workflow actions → Browse gallery</strong> and choose <strong>Install</strong> on {action.title}. Or <a href={action.file.file} download={action.file.file_name} className="break-all font-semibold text-(color:--mkt-bronze) hover:underline">download {action.file.file_name}</a> and drag it onto Automations → Packages.</li>
                  <li>The wizard verifies the checksum, every file hash and the signature, and shows what it adds.</li>
                  {caps.secrets.length > 0 && <li>In Extensibility → Workflow actions → Manage → Access, set {caps.secrets.join(" and ")} for the functions that need them.</li>}
                  <li>In the workflow designer, drag <strong>{action.name}</strong> from <strong>Custom actions</strong>, pick a function and fill its inputs. Save &amp; Test shows the typed outputs.</li>
                </ol>
              </div>
              <div className="grid min-w-0 gap-4">
                <div className="min-w-0">
                  <h3 className="mb-2 flex items-center gap-2 font-semibold"><Terminal size={16} className="text-(color:--mkt-bronze)" aria-hidden="true" /> With the CLI</h3>
                  <Snippet language="shell" code={`curl -fLO ${baseUrl}${action.file.file}
usertasks packages install ${action.file.file_name}
usertasks activities test ${action.key} -f '{"operation":"${action.operations[0]?.id ?? "run"}"}'`} />
                </div>
                <div className="rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) p-4 text-sm">
                  <p className="flex items-center gap-2 font-semibold"><Fingerprint size={15} className="text-(color:--mkt-bronze)" aria-hidden="true" /> Verify the download</p>
                  <dl className="mt-2 grid gap-1.5 text-xs">
                    <div className="grid gap-0.5"><dt className="text-(color:--mkt-muted)">File SHA-256</dt><dd className="break-all font-mono text-2xs text-(color:--mkt-ink-soft)">{action.file.sha256}</dd></div>
                    <div className="grid gap-0.5"><dt className="text-(color:--mkt-muted)">Package checksum (what is signed)</dt><dd className="break-all font-mono text-2xs text-(color:--mkt-ink-soft)">{action.file.checksum}</dd></div>
                    <div className="grid gap-0.5"><dt className="text-(color:--mkt-muted)">Module SHA-256</dt><dd className="break-all font-mono text-2xs text-(color:--mkt-ink-soft)">{caps.sha256}</dd></div>
                    <div className="grid gap-0.5"><dt className="text-(color:--mkt-muted)">Signer</dt><dd className="break-all font-mono text-2xs text-(color:--mkt-ink-soft)">{signed ? `${GALLERY_SIGNING.key_name} · ${action.file.fingerprint}` : "Unsigned preview build — compare the SHA-256 above"}</dd></div>
                  </dl>
                </div>
              </div>
            </div>
          </DetailSection>

          <DetailSection id="versions" eyebrow="Version history" title={`Version ${action.version}`}>
            <VersionHistory changelog={action.changelog} current={action.version} />
          </DetailSection>
        </DetailLayout>

        {related.length > 0 && (
          <section className="border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50" data-testid="related">
            <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
              <CardStrip eyebrow="More workflow actions" title="Related" items={related} reference={reference} more={{ href: "/gallery/actions", label: "All actions" }} />
            </div>
          </section>
        )}
      </main>
    </UseCaseShell>
  )
}
