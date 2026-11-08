import Link from "next/link"
import { ArrowRight, Download, FileCheck2, Fingerprint, Globe, KeyRound, Keyboard, Lock, ShieldAlert, ShieldCheck, Terminal } from "lucide-react"
import { SectionHeading, Snippet } from "@/components/marketing/marketing-ui"
import { UseCaseShell } from "@/components/marketing/use-case-page"
import { publicBaseUrl } from "@/lib/deployment"
import type { ControlCatalogItem } from "@/lib/gallery/catalog"
import { controlCards, formatBytes, GALLERY_ACTIONS, GALLERY_CONTROLS, GALLERY_SIGNING, packagesUsingControls, type GalleryControl } from "@/lib/gallery/site"
import { USE_CASES } from "@/lib/use-cases"
import type { ControlCapability } from "@/lib/forms/custom-controls/contract"
import { ControlPreview } from "./control-preview"
import { ControlCardView, ControlsBrowser } from "./controls-browser"
import { OriginBadge, PackageIcon, SystemChips } from "./gallery-ui"

export const CONTROLS_TITLE = "Form controls gallery"
export const CONTROLS_DESCRIPTION = "Official web components for UserTasks forms: charts, saved reports, Google Places address search, OpenStreetMap maps, signatures, ratings, sliders, rich text, editable tables, Likert surveys and a PDF viewer. Each runs sandboxed, follows your form theme in light and dark mode and is keyboard and screen-reader accessible."

const H2 = "font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight sm:text-3xl"

const CAPABILITIES: Record<string, { label: string; body: string }> = {
  lookup: { label: "Lookups", body: "Suggestions come from the field's lookup source — a data table, or an API reference the UserTasks server calls with credentials stored on the server. The control only sees the suggestions." },
  reports: { label: "Saved reports", body: "Rows of the saved report the designer chose (the field's report_id, read by the server from the stored form), run as the person filling in the form: only reports they can open, with their permissions." },
  files: { label: "Files", body: "Uploads go through the Attachments pipeline (the same checks and storage). Reads are limited to files the form already gives the control: its own value, or an Attachments field the designer maps." },
  network: { label: "Network", body: "Fetches only from the hosts in its manifest, and only after an administrator approves them in Extensibility → Form controls. Until then the frame's CSP blocks every request. Map tiles come through the UserTasks server (public tile servers refuse the sandboxed frame's referrer-less requests), only once the tile host is approved." },
}

function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
}

function valueShape(item: ControlCatalogItem): string {
  const schema = item.value.schema
  if (item.value.type === "json" && schema?.properties) return `{ ${Object.entries(schema.properties).map(([k, v]) => `${k}: ${Array.isArray(v.type) ? v.type.join(" | ") : v.type ?? "any"}`).join(", ")} }`
  if (item.value.type === "array" && schema?.items?.properties) return `[{ ${Object.keys(schema.items.properties).join(", ")} }, …]`
  if (item.value.type === "files") return "[{ id, name, size, type }] (Attachments)"
  return item.value.type
}

function propType(prop: ControlCatalogItem["props"][number]): string {
  if (prop.type === "select") return (prop.options ?? []).map((o) => (typeof o === "string" ? o : o.label ?? o.value)).join(" / ")
  if (prop.type === "number") return `number${prop.min !== undefined || prop.max !== undefined ? ` ${prop.min ?? "…"}–${prop.max ?? "…"}` : ""}`
  if (prop.type === "string[]") return "list"
  return prop.type
}

function defaultText(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—"
  if (typeof value === "boolean") return value ? "yes" : "no"
  if (Array.isArray(value)) return value.length > 3 ? `${value.slice(0, 3).join(", ")}, …` : value.join(", ")
  if (typeof value === "object") return "JSON"
  return String(value)
}

export function ControlsIndexPage() {
  const baseUrl = publicBaseUrl()
  const cards = controlCards()
  const singles = GALLERY_CONTROLS.filter((c) => c.kind === "form_control")
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${baseUrl}/gallery/controls#webpage`,
        url: `${baseUrl}/gallery/controls`,
        name: CONTROLS_TITLE,
        description: CONTROLS_DESCRIPTION,
        isPartOf: { "@id": `${baseUrl}/#website` },
        mainEntity: { "@type": "ItemList", numberOfItems: GALLERY_CONTROLS.length, itemListElement: GALLERY_CONTROLS.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.title, url: `${baseUrl}/gallery/controls/${c.slug}` })) },
      },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "UserTasks", item: baseUrl },
        { "@type": "ListItem", position: 2, name: "Gallery", item: `${baseUrl}/gallery` },
        { "@type": "ListItem", position: 3, name: "Form controls", item: `${baseUrl}/gallery/controls` },
      ] },
    ],
  }
  return (
    <UseCaseShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <main>
        <section className="border-b border-[#1B1916]/[0.06] bg-[radial-gradient(circle_at_50%_0%,rgba(176,138,84,0.14),transparent_45%)]">
          <div className="mx-auto max-w-6xl px-4 pb-12 pt-10 sm:px-6 sm:pt-14">
            <nav aria-label="Breadcrumb" className="text-xs text-[#857D6D]">
              <Link href="/" className="hover:text-[#8A6D45]">UserTasks</Link><span className="px-2">/</span>
              <Link href="/gallery" className="hover:text-[#8A6D45]">Gallery</Link><span className="px-2">/</span>
              <span aria-current="page">Form controls</span>
            </nav>
            <GalleryTabs active="controls" />
            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.22em] text-[#8A6D45]">Form controls</p>
            <h1 className="mt-4 max-w-4xl font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl">Ready-made controls for your forms.</h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-[#4A463E]">
              {singles.length} official web components — charts, saved reports, address search, maps, signatures, ratings, tables and more. Install one and it appears in the form designer&apos;s <strong>Custom</strong> palette. Each runs in a sandboxed frame, follows your form theme in light and dark mode, works with a keyboard and a screen reader, and shows its value as text on completed tasks and on mobile.
            </p>
            <p className="mt-4 max-w-3xl leading-7 text-[#4A463E]" data-testid="controls-build-your-own">
              Need something that isn&apos;t here? These controls are built on the same <Link href="/forms#custom-controls" className="font-semibold text-[#8A6D45] hover:underline">custom control framework</Link> you can use: any web component becomes a form field, with a typed contract, a generated properties panel and the same sandbox. Start from the <a href="/downloads/form-control-starter.zip" download className="font-semibold text-[#8A6D45] hover:underline">starter kit</a>{" "}or from these controls&apos; sources.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/docs/tasks/gallery-form-controls" className="inline-flex items-center gap-2 rounded-lg bg-[#17150F] px-5 py-2.5 text-sm font-semibold text-[#FAF8F3] hover:bg-[#2E2A24]">Control reference <ArrowRight size={15} aria-hidden="true" /></Link>
              <Link href="/docs/tasks/custom-form-controls" className="inline-flex items-center gap-2 rounded-lg border border-[#1B1916]/15 px-5 py-2.5 text-sm font-semibold text-[#33302A] hover:border-[#1B1916]/30">Build your own</Link>
            </div>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <ControlsBrowser cards={cards} />
        </section>
        <section className="border-y border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <SectionHeading eyebrow="Security" title="Sandboxed by default, host services by permission">
              A control runs in an iframe with an opaque origin and a strict Content-Security-Policy: no cookies, no access to the page, no network. It talks to the form through a typed postMessage bridge that checks every message. Anything more is a capability the manifest declares and the host grants:
            </SectionHeading>
            <dl className="mt-8 grid gap-4 md:grid-cols-2">
              {Object.entries(CAPABILITIES).map(([id, c]) => (
                <div key={id} className="rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF] p-5">
                  <dt className="font-semibold">{c.label} <span className="font-mono text-xs font-normal text-[#857D6D]">{id}</span></dt>
                  <dd className="mt-2 text-sm leading-6 text-[#4A463E]">{c.body}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 max-w-3xl text-sm leading-6 text-[#4A463E]"><strong>Google Places:</strong> the address control never holds an API key. It asks the UserTasks server for suggestions; the server calls Places API (New) through an API reference whose key is stored encrypted in an integration. A key in the browser would be exposed — and a sandboxed frame sends no referrer, so referrer-restricted keys could not work there anyway.</p>
          </div>
        </section>
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading eyebrow="Install" title="From the gallery to your form in a minute" />
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              { title: "Install", body: "In the app: Extensibility → Form controls → Browse gallery (or Automations → Packages → Browse gallery → Form controls). Or download the .utpkg here and import it." },
              { title: "Set up", body: "Most controls need nothing. The address control asks for a Google Places API key (stored on the server); the map needs an admin to approve its tile hosts." },
              { title: "Use", body: "Drag the control from the designer's Custom palette onto a form, set its properties and map its context fields. Its value flows into the workflow like any field." },
            ].map((step, i) => (
              <li key={step.title} className="rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF] p-5">
                <p className="text-xs font-semibold text-[#857D6D]">Step {i + 1}</p>
                <h3 className="font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-[#4A463E]">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </UseCaseShell>
  )
}

/** Workflow packages | Form controls, at the top of both gallery pages. */
export function GalleryTabs({ active }: { active: "packages" | "controls" }) {
  const count = GALLERY_CONTROLS.length
  const tab = (on: boolean) => `inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold transition ${on ? "border-[#17150F] bg-[#17150F] text-[#FAF8F3]" : "border-[#1B1916]/15 bg-[#FFFFFF] text-[#4A463E] hover:border-[#1B1916]/30"}`
  return (
    <nav aria-label="Gallery sections" className="mt-6 flex flex-wrap gap-2" data-testid="gallery-tabs">
      <Link href="/gallery" aria-current={active === "packages" ? "page" : undefined} className={tab(active === "packages")}>Workflow packages</Link>
      <Link href="/gallery/controls" aria-current={active === "controls" ? "page" : undefined} className={tab(active === "controls")}>Form controls <span className={active === "controls" ? "text-[#D9CDB5]" : "text-[#857D6D]"}>{count}</span></Link>
      {GALLERY_ACTIONS.length > 0 && <Link href="/gallery/actions" className={tab(false)}>Workflow actions <span className="text-[#857D6D]">{GALLERY_ACTIONS.length}</span></Link>}
    </nav>
  )
}

/** A strip of form control cards (the /gallery index and /forms). */
export function ControlsTeaser({ limit = 6, heading = true }: { limit?: number; heading?: boolean }) {
  const cards = controlCards().filter((c) => c.kind === "form_control").slice(0, limit)
  if (!cards.length) return null
  return (
    <div>
      {heading && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionHeading eyebrow="Form controls" title="Ready-made controls for your forms">
            Official web components that install into Extensibility → Form controls: charts, saved reports, address search, maps, signatures and more.
          </SectionHeading>
          <Link href="/gallery/controls" className="inline-flex items-center gap-1 text-sm font-semibold text-[#8A6D45] hover:underline">All {controlCards().length} controls <ArrowRight size={14} aria-hidden="true" /></Link>
        </div>
      )}
      <ul className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => <li key={card.slug}><ControlCardView card={card} /></li>)}
      </ul>
    </div>
  )
}

function ControlReference({ item }: { item: ControlCatalogItem }) {
  return (
    <div className="space-y-8">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-5">
          <h3 className="font-semibold">Value</h3>
          <p className="mt-2 font-mono text-ui leading-6 text-[#33302A]">{valueShape(item)}</p>
          <p className="mt-2 text-sm leading-6 text-[#4A463E]">Stored as the field&apos;s value (type <code className="font-mono">{item.value.type}</code>), validated by the server against the control&apos;s schema{item.validation.reports_validity ? "; the control also reports its own validity while people type" : ""}.</p>
          {item.display && <p className="mt-2 text-sm leading-6 text-[#4A463E]">Read-only views (completed tasks, mobile, emails) show {item.display.template ? <code className="font-mono">{item.display.template}</code> : `the value as ${item.display.format}`}.</p>}
        </div>
        <div className="rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-5">
          <h3 className="flex items-center gap-2 font-semibold"><Keyboard size={16} className="text-[#8A6D45]" aria-hidden="true" /> Keyboard and screen readers</h3>
          {item.accessibility?.role && <p className="mt-2 text-sm text-[#4A463E]">Role: <code className="font-mono">{item.accessibility.role}</code>, named by the field label.</p>}
          <p className="mt-2 text-sm leading-6 text-[#4A463E]">{item.accessibility?.keyboard}</p>
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF]">
        <table className="w-full min-w-[560px] text-left text-sm">
          <caption className="px-5 pt-4 text-left font-semibold">Properties (set in the form designer)</caption>
          <thead className="text-xs text-[#857D6D]"><tr><th scope="col" className="px-5 py-2 font-medium">Property</th><th scope="col" className="px-3 py-2 font-medium">Type</th><th scope="col" className="px-3 py-2 font-medium">Default</th><th scope="col" className="px-5 py-2 font-medium">What it does</th></tr></thead>
          <tbody>
            {item.props.map((p) => (
              <tr key={p.name} className="border-t border-[#1B1916]/[0.06] align-top">
                <td className="px-5 py-2"><span className="font-medium">{p.label ?? p.name}</span> <code className="block font-mono text-2xs text-[#857D6D]">{p.name}</code></td>
                <td className="px-3 py-2 text-[#4A463E]">{propType(p)}</td>
                <td className="px-3 py-2 text-[#4A463E]">{defaultText(p.default)}</td>
                <td className="px-5 py-2 text-[#4A463E]">{p.description ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {item.context.length > 0 && (
        <div className="rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-5">
          <h3 className="font-semibold">Context (other fields it reads)</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-[#4A463E]">
            {item.context.map((c) => <li key={c.name}><code className="font-mono">{c.name}</code>{c.label ? ` — ${c.label}` : ""}{c.description ? `: ${c.description}` : ""}</li>)}
          </ul>
          <p className="mt-2 text-xs text-[#6E6759]">The designer maps each one to a field of the same form; the control receives those values read-only.</p>
        </div>
      )}
    </div>
  )
}

export function ControlDetailPage({ control }: { control: GalleryControl }) {
  const baseUrl = publicBaseUrl()
  const url = `${baseUrl}/gallery/controls/${control.slug}`
  const signed = control.file.signed
  const item = control.controls[0]
  const single = control.kind === "form_control" && item
  const capabilities = [...new Set(control.controls.flatMap((c) => c.capabilities))]
  const hosts = [...new Set(control.controls.flatMap((c) => c.hosts))]
  const libraries = [...new Map(control.controls.flatMap((c) => c.libraries).map((l) => [`${l.name}@${l.version}`, l])).values()]
  const related = controlCards().filter((c) => c.slug !== control.slug && c.kind === "form_control").slice(0, 3)
  const usedIn = packagesUsingControls(control.controls.map((c) => c.tag))
  const useCases = USE_CASES.filter((u) => u.gallery && usedIn.some((pkg) => pkg.slug === u.gallery))
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": `${url}#control`,
        name: control.title,
        description: control.summary,
        url,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Form control (web component)",
        operatingSystem: "UserTasks (cloud or self-hosted)",
        softwareVersion: control.version,
        datePublished: control.released,
        downloadUrl: `${baseUrl}${control.file.file}`,
        fileSize: formatBytes(control.file.size_bytes),
        keywords: control.tags.join(", "),
        isAccessibleForFree: true,
        license: "https://www.apache.org/licenses/LICENSE-2.0",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        publisher: { "@id": `${baseUrl}/#organization` },
      },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "UserTasks", item: baseUrl },
        { "@type": "ListItem", position: 2, name: "Gallery", item: `${baseUrl}/gallery` },
        { "@type": "ListItem", position: 3, name: "Form controls", item: `${baseUrl}/gallery/controls` },
        { "@type": "ListItem", position: 4, name: control.title, item: url },
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
              <Link href="/gallery/controls" className="hover:text-[#8A6D45]">Form controls</Link><span className="px-2">/</span>
              <span aria-current="page">{control.title}</span>
            </nav>
            <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_340px]">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#B08A54]/[0.14] text-[#8A6D45]"><PackageIcon icon={control.icon} category="form-controls" size={22} /></span>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8A6D45]">{control.kind === "control_bundle" ? "Control bundle" : `${control.control_kind === "display" ? "Display" : "Input"} form control`}</p>
                </div>
                <h1 className="mt-5 font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">{control.title}</h1>
                <p className="mt-2 break-words font-mono text-sm text-[#6E6759]">{control.controls.map((c) => `<${c.tag}>`).join(" ")}</p>
                <p className="mt-5 max-w-2xl text-lg leading-8 text-[#4A463E]">{control.summary}</p>
                {control.systems.length > 0 && <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[#6E6759]">Uses <SystemChips systems={control.systems} /></p>}
                <div className="mt-6 flex flex-wrap items-center gap-2">
                  <OriginBadge source="official" size="md" />
                  <span className="rounded-full border border-[#1B1916]/12 bg-[#FFFFFF] px-3 py-1 font-mono text-sm text-[#4A463E]">v{control.version}</span>
                  {capabilities.length === 0 && <span className="inline-flex items-center gap-1 rounded-full bg-[#4F7A5B]/[0.12] px-3 py-1 text-sm font-semibold text-[#2F5A3B]"><Lock size={13} aria-hidden="true" /> Self-contained</span>}
                </div>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <a href={control.file.file} download={control.file.file_name} data-testid="download-control" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#17150F] px-6 py-3 font-semibold text-[#FAF8F3] shadow-lg shadow-[#17150F]/20 hover:bg-[#2E2A24]">
                    <Download size={16} aria-hidden="true" /> Download .utpkg <span className="font-normal text-[#CFC6B4]">{formatBytes(control.file.size_bytes)}</span>
                  </a>
                  <a href="#install" className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#1B1916]/15 px-6 py-3 font-medium text-[#33302A] hover:border-[#1B1916]/30">Install in your workspace</a>
                </div>
              </div>
              <aside className="h-fit rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-5 text-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8A6D45]">At a glance</p>
                <dl className="mt-3 grid gap-3">
                  {single && <div><dt className="text-xs text-[#857D6D]">Value</dt><dd className="mt-0.5 font-medium">{item.value.type}</dd></div>}
                  <div><dt className="text-xs text-[#857D6D]">Host services</dt><dd className="mt-0.5 text-[#33302A]">{capabilities.length ? capabilities.map((c) => CAPABILITIES[c]?.label ?? c).join(", ") : "None — runs fully sandboxed"}</dd></div>
                  {hosts.length > 0 && <div><dt className="text-xs text-[#857D6D]">Network hosts (approved by an admin)</dt><dd className="mt-0.5 break-words font-mono text-xs text-[#33302A]">{hosts.join(", ")}</dd></div>}
                  <div><dt className="text-xs text-[#857D6D]">Asked for on install</dt><dd className="mt-0.5 text-[#33302A]">{control.requirements.length ? control.requirements.map((r) => r.label).join(", ") : "Nothing"}</dd></div>
                  <div><dt className="text-xs text-[#857D6D]">Bundled libraries</dt><dd className="mt-0.5 text-[#33302A]">{libraries.length ? libraries.filter((l) => !l.name.startsWith("@lit/") && !l.name.startsWith("lit-")).map((l) => `${l.name} ${l.version} (${l.licence})`).join(", ") : "None"}</dd></div>
                  <div><dt className="text-xs text-[#857D6D]">Module</dt><dd className="mt-0.5 text-[#33302A]">{formatBytes(control.controls.reduce((s, c) => s + c.module_bytes, 0))}, one ES module</dd></div>
                  <div><dt className="text-xs text-[#857D6D]">Signature</dt><dd className="mt-0.5 inline-flex items-center gap-1.5 text-[#33302A]">{signed ? <><ShieldCheck size={14} className="text-[#4F7A5B]" aria-hidden="true" /> Signed ({GALLERY_SIGNING.key_name})</> : <><ShieldAlert size={14} className="text-[#A0804F]" aria-hidden="true" /> Unsigned preview build</>}</dd></div>
                </dl>
              </aside>
            </div>
          </div>
        </section>

        {single && control.preview && (
          <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6" id="preview">
            <SectionHeading eyebrow="Try it" title="Live preview">
              The real control in the same sandboxed frame the app uses. Switch to dark mode or read-only to see how it adapts.
            </SectionHeading>
            <div className="mt-6">
              <ControlPreview
                slug={control.slug}
                tag={item.tag}
                name={item.name}
                label={control.preview.label ?? item.name}
                props={control.preview.props ?? {}}
                value={control.preview.value ?? null}
                context={control.preview.context ?? {}}
                fixtures={control.preview.fixtures ?? {}}
                capabilities={item.capabilities as ControlCapability[]}
                size={item.size}
                note={control.preview.note ?? null}
              />
            </div>
          </section>
        )}

        <section className="border-y border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_360px]">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8A6D45]">About</p>
              <h2 className={`mt-3 ${H2}`}>What it does</h2>
              <div className="mt-5 space-y-4 text-base leading-7 text-[#4A463E]">{paragraphs(control.description).map((p) => <p key={p.slice(0, 40)}>{p}</p>)}</div>
              {control.uses.length > 0 && (
                <>
                  <h3 className="mt-8 font-semibold">Good for</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-[#4A463E]">{control.uses.map((u) => <li key={u}>{u}</li>)}</ul>
                </>
              )}
            </div>
            <div className="h-fit rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-5">
              <h3 className="font-semibold">After installing</h3>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-[#4A463E]">{control.setup.map((s) => <li key={s}>{s}</li>)}</ol>
              {control.extras.length > 0 && (
                <>
                  <h3 className="mt-5 font-semibold">Also in the package</h3>
                  <ul className="mt-2 space-y-1 text-sm text-[#4A463E]">{control.extras.map((e) => <li key={`${e.section}-${e.name}`}>{e.name} <span className="text-xs text-[#857D6D]">({e.section.replace(/_/g, " ").replace(/s$/, "")})</span></li>)}</ul>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <SectionHeading eyebrow="Reference" title={single ? "Value, properties and accessibility" : "Controls in this bundle"} />
          <div className="mt-8 space-y-12">
            {single ? <ControlReference item={item} /> : (
              <ul className="grid gap-4 md:grid-cols-2">
                {control.controls.map((c) => (
                  <li key={c.tag} className="rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-5">
                    <p className="font-semibold"><Link href={`/gallery/controls/${c.slug}`} className="hover:underline">{c.name}</Link> <span className="font-mono text-xs text-[#6E6759]">&lt;{c.tag}&gt;</span></p>
                    <p className="mt-1 text-sm leading-6 text-[#4A463E]">{c.description}</p>
                    <p className="mt-2 text-xs text-[#6E6759]">value {c.value.type}{c.capabilities.length ? ` · ${c.capabilities.map((x) => CAPABILITIES[x]?.label ?? x).join(", ")}` : " · self-contained"}</p>
                  </li>
                ))}
              </ul>
            )}
            {capabilities.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 font-semibold"><KeyRound size={16} className="text-[#8A6D45]" aria-hidden="true" /> Capabilities and security</h3>
                <dl className="mt-3 grid gap-3 md:grid-cols-2">
                  {capabilities.map((c) => (
                    <div key={c} className="rounded-xl border border-[#1B1916]/[0.08] bg-[#FFFFFF] p-4">
                      <dt className="font-medium">{CAPABILITIES[c]?.label ?? c}</dt>
                      <dd className="mt-1 text-sm leading-6 text-[#4A463E]">{CAPABILITIES[c]?.body}{c === "network" && hosts.length ? <> Hosts: <span className="font-mono text-xs">{hosts.join(", ")}</span>.</> : null}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </section>

        <section id="install" className="scroll-mt-8 border-t border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <SectionHeading eyebrow="Install" title="Install it in your workspace">
              Works on UserTasks cloud and any self-hosted instance. The control lands in Extensibility → Form controls, enabled, and appears in the form designer&apos;s Custom palette.
            </SectionHeading>
            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              <div className="rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-6">
                <h3 className="flex items-center gap-2 font-semibold"><FileCheck2 size={16} className="text-[#8A6D45]" aria-hidden="true" /> In the app</h3>
                <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-[#4A463E]">
                  <li>Open <strong>Extensibility → Form controls → Browse gallery</strong> (it opens <strong>Packages → Browse gallery</strong> on the Form controls tab) and choose <strong>Install</strong> on {control.title}. Or <a href={control.file.file} download={control.file.file_name} className="font-semibold text-[#8A6D45] hover:underline">download {control.file.file_name}</a> and drag it onto Automations → Packages.</li>
                  <li>The wizard verifies the checksum, every file hash and the signature, and shows what it adds.</li>
                  {control.requirements.length > 0 && <li>Fill in {control.requirements.map((r) => r.label).join(", ")} — stored encrypted on the server — or keep it incomplete and finish later.</li>}
                  {hosts.length > 0 && <li>In Extensibility → Form controls, an administrator approves <span className="font-mono text-xs">{hosts.join(", ")}</span>.</li>}
                  <li>Drag the control onto a form in the designer and set its properties.</li>
                </ol>
              </div>
              <div className="grid min-w-0 gap-4">
                <div className="min-w-0">
                  <h3 className="mb-2 flex items-center gap-2 font-semibold"><Terminal size={16} className="text-[#8A6D45]" aria-hidden="true" /> With the CLI</h3>
                  <Snippet language="shell" code={`curl -fLO ${baseUrl}${control.file.file}
usertasks packages inspect ${control.file.file_name}
usertasks packages install ${control.file.file_name}`} />
                </div>
                <div className="rounded-xl border border-[#1B1916]/[0.08] bg-[#F1EDE3] p-4 text-sm">
                  <p className="flex items-center gap-2 font-semibold"><Fingerprint size={15} className="text-[#8A6D45]" aria-hidden="true" /> Verify the download</p>
                  <dl className="mt-2 grid gap-1.5 text-xs">
                    <div className="grid gap-0.5"><dt className="text-[#6E6759]">File SHA-256</dt><dd className="break-all font-mono text-2xs text-[#33302A]">{control.file.sha256}</dd></div>
                    <div className="grid gap-0.5"><dt className="text-[#6E6759]">Package checksum (what is signed)</dt><dd className="break-all font-mono text-2xs text-[#33302A]">{control.file.checksum}</dd></div>
                    {control.controls.map((c) => <div key={c.tag} className="grid gap-0.5"><dt className="text-[#6E6759]">&lt;{c.tag}&gt; module SHA-256</dt><dd className="break-all font-mono text-2xs text-[#33302A]">{c.sha256}</dd></div>)}
                    <div className="grid gap-0.5"><dt className="text-[#6E6759]">Signer</dt><dd className="font-mono text-2xs text-[#33302A]">{signed ? `${GALLERY_SIGNING.key_name} · ${control.file.fingerprint}` : "Unsigned preview build — compare the SHA-256 above"}</dd></div>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </section>

        {usedIn.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 pt-14 sm:px-6" data-testid="control-used-in">
            <SectionHeading eyebrow="Used in" title={`See it in ${usedIn.length === 1 ? "a ready-made process" : `${usedIn.length} ready-made processes`}`}>
              These gallery packages use {single ? "this control" : "these controls"} on their forms. Installing one brings the control{single ? "" : "s"} with it, together with the workflows, data tables and reports{useCases.length ? ", and each has a use-case page that walks through it" : ""}.
            </SectionHeading>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {usedIn.map((pkg) => {
                const story = useCases.find((u) => u.gallery === pkg.slug)
                return (
                  <li key={pkg.slug} className="flex h-full flex-col rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF] p-5">
                    <Link href={`/gallery/${pkg.slug}`} className="font-semibold hover:text-[#8A6D45] hover:underline">{pkg.title}</Link>
                    <p className="mt-2 flex-1 text-sm leading-6 text-[#4A463E]">{pkg.summary}</p>
                    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-[#8A6D45]">
                      <Link href={`/gallery/${pkg.slug}`} className="hover:underline">The package</Link>
                      {story && <Link href={`/use-cases/${story.slug}`} className="hover:underline">The use case</Link>}
                    </p>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {related.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className={H2}>More form controls</h2>
              <Link href="/gallery/controls" className="inline-flex items-center gap-1 text-sm font-semibold text-[#8A6D45] hover:underline"><Globe size={14} aria-hidden="true" /> All controls</Link>
            </div>
            <ul className="mt-6 grid gap-5 md:grid-cols-3">{related.map((card) => <li key={card.slug}><ControlCardView card={card} /></li>)}</ul>
          </section>
        )}
      </main>
    </UseCaseShell>
  )
}
