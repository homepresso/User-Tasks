import Link from "next/link"
import { ArrowRight, FileCheck2, Fingerprint, KeyRound, Keyboard, Lock, Terminal } from "lucide-react"
import { SectionHeading, Snippet } from "@/components/marketing/marketing-ui"
import { UseCaseShell } from "@/components/marketing/use-case-page"
import { publicBaseUrl } from "@/lib/deployment"
import type { ControlCatalogItem } from "@/lib/gallery/catalog"
import { formatBytes, GALLERY_CONTROLS, GALLERY_SIGNING, packagesUsingControls, type GalleryControl } from "@/lib/gallery/site"
import { USE_CASES } from "@/lib/use-cases"
import type { ControlCapability } from "@/lib/forms/custom-controls/contract"
import { ControlPreview } from "./control-preview"
import { newestRelease } from "@/lib/gallery/browse"
import { officialBrowseItems } from "@/lib/gallery/browse-items"
import { GalleryBrowser } from "./gallery-browser"
import { BrowseCard, CardStrip, renderBrowseCards } from "./browse-cards"
import { DetailHero, DetailLayout, DetailSection, formatDate, GalleryBreadcrumbs, GalleryTabs, HeroActions, InstallCard, OfficialPublisher, paragraphs, Pill, primaryButton, secondaryButton, SectionNav, sourceUrl, VersionHistory } from "./detail-ui"
import { PackageIcon, SystemChips } from "./gallery-ui"

export const CONTROLS_TITLE = "Form controls gallery"
export const CONTROLS_DESCRIPTION = "Official web components for UserTasks forms: charts, saved reports, Google Places address search, OpenStreetMap maps, signatures, ratings, sliders, rich text, editable tables, Likert surveys and a PDF viewer. Each runs sandboxed, follows your form theme in light and dark mode and is keyboard and screen-reader accessible."

const CAPABILITIES: Record<string, { label: string; body: string }> = {
  lookup: { label: "Lookups", body: "Suggestions come from the field's lookup source — a data table, or an API reference the UserTasks server calls with credentials stored on the server. The control only sees the suggestions." },
  reports: { label: "Saved reports", body: "Rows of the saved report the designer chose (the field's report_id, read by the server from the stored form), run as the person filling in the form: only reports they can open, with their permissions." },
  files: { label: "Files", body: "Uploads go through the Attachments pipeline (the same checks and storage). Reads are limited to files the form already gives the control: its own value, or an Attachments field the designer maps." },
  network: { label: "Network", body: "Fetches only from the hosts in its manifest, and only after an administrator approves them in Extensibility → Form controls. Until then the frame's CSP blocks every request. Map tiles come through the UserTasks server (public tile servers refuse the sandboxed frame's referrer-less requests), only once the tile host is approved." },
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
  const items = officialBrowseItems().filter((i) => i.kind === "control")
  const reference = newestRelease(officialBrowseItems())
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
        <GalleryBrowser
          items={items}
          cards={renderBrowseCards(items, reference)}
          scope="control"
          searchLabel="Search form controls"
          placeholder="Search controls: chart, address, signature, table…"
          noun={{ one: "control", many: "controls and bundles" }}
          hero={(
            <>
              <GalleryBreadcrumbs trail={[{ label: "Gallery", href: "/gallery" }, { label: "Form controls" }]} />
              <GalleryTabs active="controls" />
              <h1 className="mt-6 max-w-4xl font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.06] tracking-tight sm:text-6xl">Ready-made controls for your forms.</h1>
              <p className="mkt-body mt-5 max-w-3xl text-(color:--mkt-text)">
                {singles.length} official web components — charts, saved reports, address search, maps, signatures, ratings, tables and more. Install one and it appears in the form designer&apos;s <strong>Custom</strong> palette. Each runs in a sandboxed frame, follows your form theme in light and dark mode, works with a keyboard and a screen reader, and shows its value as text on completed tasks and on mobile.
              </p>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-(color:--mkt-text)" data-testid="controls-build-your-own">
                Need something that isn&apos;t here? These controls are built on the same <Link key="/forms#custom-controls" href="/forms#custom-controls" className="font-semibold text-(color:--mkt-bronze) hover:underline">custom control framework</Link> you can use: any web component becomes a form field, with a typed contract, a generated properties panel and the same sandbox. Start from the <a href="/downloads/form-control-starter.zip" download className="font-semibold text-(color:--mkt-bronze) hover:underline">starter kit</a>{" "}or from these controls&apos; sources.
              </p>
            </>
          )}
          heroFooter={(
            <div className="mt-6 flex flex-wrap gap-3">
              <Link key="/docs/tasks/gallery-form-controls" href="/docs/tasks/gallery-form-controls" className={primaryButton}>Control reference <ArrowRight size={15} aria-hidden="true" /></Link>
              <Link key="/docs/tasks/custom-form-controls" href="/docs/tasks/custom-form-controls" className={secondaryButton}>Build your own</Link>
            </div>
          )}
        />
        <section className="border-y border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <SectionHeading eyebrow="Security" title="Sandboxed by default, host services by permission">
              A control runs in an iframe with an opaque origin and a strict Content-Security-Policy: no cookies, no access to the page, no network. It talks to the form through a typed postMessage bridge that checks every message. Anything more is a capability the manifest declares and the host grants:
            </SectionHeading>
            <dl className="mt-8 grid gap-4 md:grid-cols-2">
              {Object.entries(CAPABILITIES).map(([id, c]) => (
                <div key={id} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5">
                  <dt className="font-semibold">{c.label} <span className="font-mono text-xs font-normal text-(color:--mkt-subtle)">{id}</span></dt>
                  <dd className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{c.body}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 max-w-3xl text-sm leading-6 text-(color:--mkt-text)"><strong>Google Places:</strong> the address control never holds an API key. It asks the UserTasks server for suggestions; the server calls Places API (New) through an API reference whose key is stored encrypted in an integration. A key in the browser would be exposed — and a sandboxed frame sends no referrer, so referrer-restricted keys could not work there anyway.</p>
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
              <li key={step.title} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5">
                <p className="text-xs font-semibold text-(color:--mkt-subtle)">Step {i + 1}</p>
                <h3 className="font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </UseCaseShell>
  )
}

export { GalleryTabs }

/** A strip of form control cards (the /gallery index and /forms). */
export function ControlsTeaser({ limit = 6, heading = true }: { limit?: number; heading?: boolean }) {
  const all = officialBrowseItems()
  const reference = newestRelease(all)
  const cards = all.filter((c) => c.kind === "control" && c.facet !== "Bundle").slice(0, limit)
  if (!cards.length) return null
  return (
    <div>
      {heading && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionHeading eyebrow="Form controls" title="Ready-made controls for your forms">
            Official web components that install into Extensibility → Form controls: charts, saved reports, address search, maps, signatures and more.
          </SectionHeading>
          <Link href="/gallery/controls" className="inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline">All {GALLERY_CONTROLS.length} controls <ArrowRight size={14} aria-hidden="true" /></Link>
        </div>
      )}
      <ul className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => <li key={card.key} className="min-w-0"><BrowseCard item={card} reference={reference} /></li>)}
      </ul>
    </div>
  )
}

function ControlReference({ item }: { item: ControlCatalogItem }) {
  return (
    <div className="space-y-8">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-5">
          <h3 className="font-semibold">Value</h3>
          <p className="mt-2 font-mono text-ui leading-6 text-(color:--mkt-ink-soft)">{valueShape(item)}</p>
          <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">Stored as the field&apos;s value (type <code className="font-mono">{item.value.type}</code>), validated by the server against the control&apos;s schema{item.validation.reports_validity ? "; the control also reports its own validity while people type" : ""}.</p>
          {item.display && <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">Read-only views (completed tasks, mobile, emails) show {item.display.template ? <code className="font-mono">{item.display.template}</code> : `the value as ${item.display.format}`}.</p>}
        </div>
        <div className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-5">
          <h3 className="flex items-center gap-2 font-semibold"><Keyboard size={16} className="text-(color:--mkt-bronze)" aria-hidden="true" /> Keyboard and screen readers</h3>
          {item.accessibility?.role && <p className="mt-2 text-sm text-(color:--mkt-text)">Role: <code className="font-mono">{item.accessibility.role}</code>, named by the field label.</p>}
          <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{item.accessibility?.keyboard}</p>
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white)">
        <table className="w-full min-w-[560px] text-left text-sm">
          <caption className="px-5 pt-4 text-left font-semibold">Properties (set in the form designer)</caption>
          <thead className="text-xs text-(color:--mkt-subtle)"><tr><th scope="col" className="px-5 py-2 font-medium">Property</th><th scope="col" className="px-3 py-2 font-medium">Type</th><th scope="col" className="px-3 py-2 font-medium">Default</th><th scope="col" className="px-5 py-2 font-medium">What it does</th></tr></thead>
          <tbody>
            {item.props.map((p) => (
              <tr key={p.name} className="border-t border-(color:--mkt-ink)/[0.06] align-top">
                <td className="px-5 py-2"><span className="font-medium">{p.label ?? p.name}</span> <code className="block font-mono text-2xs text-(color:--mkt-subtle)">{p.name}</code></td>
                <td className="px-3 py-2 text-(color:--mkt-text)">{propType(p)}</td>
                <td className="px-3 py-2 text-(color:--mkt-text)">{defaultText(p.default)}</td>
                <td className="px-5 py-2 text-(color:--mkt-text)">{p.description ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {item.context.length > 0 && (
        <div className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-5">
          <h3 className="font-semibold">Context (other fields it reads)</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-(color:--mkt-text)">
            {item.context.map((c) => <li key={c.name}><code className="font-mono">{c.name}</code>{c.label ? ` — ${c.label}` : ""}{c.description ? `: ${c.description}` : ""}</li>)}
          </ul>
          <p className="mt-2 text-xs text-(color:--mkt-muted)">The designer maps each one to a field of the same form; the control receives those values read-only.</p>
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
  const allItems = officialBrowseItems()
  const reference = newestRelease(allItems)
  const related = allItems.filter((c) => c.kind === "control" && c.slug !== control.slug && c.facet !== "Bundle").slice(0, 3)
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
  const source = sourceUrl(control.kind === "control_bundle" ? `gallery/controls/bundles/${control.slug}` : `gallery/controls/${control.slug}`)
  const hasPreview = Boolean(single && control.preview)
  const sections = [
    { id: "overview", label: "Overview" },
    ...(hasPreview ? [{ id: "preview", label: "Live preview" }] : []),
    { id: "included", label: "What's included" },
    { id: "reference", label: "Reference" },
    { id: "permissions", label: "Permissions" },
    { id: "install", label: "Install" },
    { id: "versions", label: "Versions" },
    ...(usedIn.length ? [{ id: "used-in", label: "Used in" }] : []),
  ]
  return (
    <UseCaseShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <main>
        <DetailHero
          breadcrumbs={<GalleryBreadcrumbs trail={[{ label: "Gallery", href: "/gallery" }, { label: "Form controls", href: "/gallery/controls" }, { label: control.title }]} />}
          icon={<PackageIcon icon={control.icon} category="form-controls" size={30} />}
          eyebrow={control.kind === "control_bundle" ? "Control bundle" : `${control.control_kind === "display" ? "Display" : "Input"} form control`}
          title={control.title}
          subtitle={control.controls.map((c) => `<${c.tag}>`).join(" ")}
          summary={control.summary}
          badges={(
            <>
              <OfficialPublisher signed={signed} />
              <Pill mono>v{control.version}</Pill>
              <Pill>Updated <time dateTime={control.released}>{formatDate(control.released)}</time></Pill>
              {capabilities.length === 0 && <span className="inline-flex items-center gap-1 rounded-full bg-(color:--mkt-green)/[0.12] px-3 py-1 text-sm font-semibold text-[#2F5A3B]"><Lock size={13} aria-hidden="true" /> Self-contained</span>}
              {control.systems.length > 0 && <span className="inline-flex items-center gap-2 text-sm text-(color:--mkt-muted)">Uses <SystemChips systems={control.systems} /></span>}
            </>
          )}
          actions={<HeroActions source={source} />}
        />
        <SectionNav sections={sections} />
        <DetailLayout
          aside={(
            <InstallCard
              file={control.file}
              downloadTestId="download-control"
              source={source}
              facts={[
                { label: "Version", value: <span className="font-mono">v{control.version}</span> },
                { label: "Last updated", value: <time dateTime={control.released}>{formatDate(control.released)}</time> },
                { label: "Publisher", value: "UserTasks (Official)" },
                ...(single ? [{ label: "Value", value: <span className="font-mono">{item.value.type}</span> }] : [{ label: "Controls", value: String(control.controls.length) }]),
                { label: "Host services", value: capabilities.length ? capabilities.map((c) => CAPABILITIES[c]?.label ?? c).join(", ") : "None" },
                { label: "Asked on install", value: control.requirements.length ? control.requirements.map((r) => r.label).join(", ") : "Nothing" },
                { label: "Module", value: formatBytes(control.controls.reduce((sum, c) => sum + c.module_bytes, 0)) },
              ]}
            />
          )}
        >
          <DetailSection id="overview" eyebrow="Overview" title="What it does">
            <div className="space-y-4 text-base leading-7 text-(color:--mkt-text)">{paragraphs(control.description).map((p) => <p key={p.slice(0, 40)}>{p}</p>)}</div>
            {control.uses.length > 0 && (
              <>
                <h3 className="mt-8 font-semibold">Good for</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-(color:--mkt-text)">{control.uses.map((u) => <li key={u}>{u}</li>)}</ul>
              </>
            )}
          </DetailSection>

          {single && control.preview && (
            <DetailSection id="preview" eyebrow="Try it" title="Live preview" intro="The real control in the same sandboxed frame the app uses. Switch to dark mode or read-only to see how it adapts.">
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
            </DetailSection>
          )}

          <DetailSection id="included" eyebrow="What's included" title={single ? "One control, one module" : `${control.controls.length} controls in this bundle`}>
            <ul className="grid gap-3 md:grid-cols-2">
              {control.controls.map((c) => (
                <li key={c.tag} className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-5">
                  <p className="font-semibold">{single ? c.name : <Link href={`/gallery/controls/${c.slug}`} className="hover:underline">{c.name}</Link>} <span className="font-mono text-xs text-(color:--mkt-muted)">&lt;{c.tag}&gt;</span></p>
                  {c.description && <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{c.description}</p>}
                  <p className="mt-2 text-xs text-(color:--mkt-muted)">value {c.value.type} · {formatBytes(c.module_bytes)}{c.capabilities.length ? ` · ${c.capabilities.map((x) => CAPABILITIES[x]?.label ?? x).join(", ")}` : " · self-contained"}</p>
                </li>
              ))}
              {control.extras.map((e) => (
                <li key={`${e.section}-${e.name}`} className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-5">
                  <p className="font-semibold">{e.name} <span className="text-xs font-normal text-(color:--mkt-muted)">({e.section.replace(/_/g, " ").replace(/s$/, "")})</span></p>
                  {e.description && <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{e.description}</p>}
                </li>
              ))}
            </ul>
            {libraries.length > 0 && <p className="mt-4 text-sm text-(color:--mkt-muted)">Bundled libraries: {libraries.filter((l) => !l.name.startsWith("@lit/") && !l.name.startsWith("lit-")).map((l) => `${l.name} ${l.version} (${l.licence})`).join(", ") || "Lit only"}.</p>}
          </DetailSection>

          {single && (
            <DetailSection id="reference" eyebrow="Reference" title="Value, properties and accessibility">
              <ControlReference item={item} />
            </DetailSection>
          )}
          {!single && (
            <DetailSection id="reference" eyebrow="Reference" title="Each control's reference">
              <p className="text-sm leading-6 text-(color:--mkt-text)">Every control in the bundle has its own page with its value, properties, keyboard support and a live preview: follow the links above.</p>
            </DetailSection>
          )}

          <DetailSection id="permissions" eyebrow="Permissions and requirements" title="Sandboxed, host services by permission">
            {capabilities.length ? (
              <dl className="grid gap-3 md:grid-cols-2">
                {capabilities.map((c) => (
                  <div key={c} className="rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-4">
                    <dt className="flex items-center gap-2 font-medium"><KeyRound size={14} className="text-(color:--mkt-bronze)" aria-hidden="true" /> {CAPABILITIES[c]?.label ?? c}</dt>
                    <dd className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{CAPABILITIES[c]?.body}{c === "network" && hosts.length ? <> Hosts: <span className="break-all font-mono text-xs">{hosts.join(", ")}</span>.</> : null}</dd>
                  </div>
                ))}
              </dl>
            ) : <p className="text-sm leading-6 text-(color:--mkt-text)">None. It runs fully sandboxed: an opaque-origin frame with no network, no cookies and no access to the page.</p>}
            <h3 className="mt-8 font-semibold">After installing</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-(color:--mkt-text)">{control.setup.map((step) => <li key={step}>{step}</li>)}</ol>
          </DetailSection>

          <DetailSection id="install" eyebrow="Install" title="Install it in your workspace" intro="Works on UserTasks cloud and any self-hosted instance. The control lands in Extensibility → Form controls, enabled, and appears in the form designer's Custom palette.">
            <div className="grid gap-5 xl:grid-cols-2">
              <div className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-6">
                <h3 className="flex items-center gap-2 font-semibold"><FileCheck2 size={16} className="text-(color:--mkt-bronze)" aria-hidden="true" /> In the app</h3>
                <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-(color:--mkt-text)" data-testid="install-steps">
                  <li>Open <strong>Extensibility → Form controls → Browse gallery</strong> (it opens <strong>Packages → Browse gallery</strong> on the Form controls tab) and choose <strong>Install</strong> on {control.title}. Or <a href={control.file.file} download={control.file.file_name} className="break-all font-semibold text-(color:--mkt-bronze) hover:underline">download {control.file.file_name}</a> and drag it onto Automations → Packages.</li>
                  <li>The wizard verifies the checksum, every file hash and the signature, and shows what it adds.</li>
                  {control.requirements.length > 0 && <li>Fill in {control.requirements.map((r) => r.label).join(", ")} — stored encrypted on the server — or keep it incomplete and finish later.</li>}
                  {hosts.length > 0 && <li>In Extensibility → Form controls, an administrator approves <span className="break-all font-mono text-xs">{hosts.join(", ")}</span>.</li>}
                  <li>Drag the control onto a form in the designer and set its properties.</li>
                </ol>
              </div>
              <div className="grid min-w-0 gap-4">
                <div className="min-w-0">
                  <h3 className="mb-2 flex items-center gap-2 font-semibold"><Terminal size={16} className="text-(color:--mkt-bronze)" aria-hidden="true" /> With the CLI</h3>
                  <Snippet language="shell" code={`curl -fLO ${baseUrl}${control.file.file}
usertasks packages inspect ${control.file.file_name}
usertasks packages install ${control.file.file_name}`} />
                </div>
                <div className="rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) p-4 text-sm">
                  <p className="flex items-center gap-2 font-semibold"><Fingerprint size={15} className="text-(color:--mkt-bronze)" aria-hidden="true" /> Verify the download</p>
                  <dl className="mt-2 grid gap-1.5 text-xs">
                    <div className="grid gap-0.5"><dt className="text-(color:--mkt-muted)">File SHA-256</dt><dd className="break-all font-mono text-2xs text-(color:--mkt-ink-soft)">{control.file.sha256}</dd></div>
                    <div className="grid gap-0.5"><dt className="text-(color:--mkt-muted)">Package checksum (what is signed)</dt><dd className="break-all font-mono text-2xs text-(color:--mkt-ink-soft)">{control.file.checksum}</dd></div>
                    {control.controls.map((c) => <div key={c.tag} className="grid gap-0.5"><dt className="text-(color:--mkt-muted)">&lt;{c.tag}&gt; module SHA-256</dt><dd className="break-all font-mono text-2xs text-(color:--mkt-ink-soft)">{c.sha256}</dd></div>)}
                    <div className="grid gap-0.5"><dt className="text-(color:--mkt-muted)">Signer</dt><dd className="break-all font-mono text-2xs text-(color:--mkt-ink-soft)">{signed ? `${GALLERY_SIGNING.key_name} · ${control.file.fingerprint}` : "Unsigned preview build — compare the SHA-256 above"}</dd></div>
                  </dl>
                </div>
              </div>
            </div>
          </DetailSection>

          <DetailSection id="versions" eyebrow="Version history" title={`Version ${control.version}`}>
            <VersionHistory changelog={control.changelog} current={control.version} />
          </DetailSection>

          {usedIn.length > 0 && (
            <DetailSection id="used-in" testId="control-used-in" eyebrow="Used in" title={`See it in ${usedIn.length === 1 ? "a ready-made process" : `${usedIn.length} ready-made processes`}`}
              intro={<>These gallery packages use {single ? "this control" : "these controls"} on their forms. Installing one brings the control{single ? "" : "s"} with it, together with the workflows, data tables and reports{useCases.length ? ", and each has a use-case page that walks through it" : ""}.</>}>
              <ul className="grid gap-3 sm:grid-cols-2">
                {usedIn.map((pkg) => {
                  const story = useCases.find((u) => u.gallery === pkg.slug)
                  return (
                    <li key={pkg.slug} className="flex h-full flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5">
                      <Link href={`/gallery/${pkg.slug}`} className="font-semibold hover:text-(color:--mkt-bronze) hover:underline">{pkg.title}</Link>
                      <p className="mt-2 flex-1 text-sm leading-6 text-(color:--mkt-text)">{pkg.summary}</p>
                      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-(color:--mkt-bronze)">
                        <Link href={`/gallery/${pkg.slug}`} className="hover:underline">The package</Link>
                        {story && <Link href={`/use-cases/${story.slug}`} className="hover:underline">The use case</Link>}
                      </p>
                    </li>
                  )
                })}
              </ul>
            </DetailSection>
          )}
        </DetailLayout>

        {related.length > 0 && (
          <section className="border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50" data-testid="related">
            <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
              <CardStrip eyebrow="More form controls" title="Related" items={related} reference={reference} more={{ href: "/gallery/controls", label: "All controls" }} />
            </div>
          </section>
        )}
      </main>
    </UseCaseShell>
  )
}
