import Link from "next/link"
import { ArrowRight, Download, FileCheck2, Fingerprint, GitPullRequest, KeyRound, Play, ShieldAlert, ShieldCheck, Upload, UsersRound } from "lucide-react"
import { SectionHeading, Snippet } from "@/components/marketing/marketing-ui"
import { UseCaseShell } from "@/components/marketing/use-case-page"
import { publicBaseUrl } from "@/lib/deployment"
import { GALLERY_PACKAGES, GALLERY_SIGNING, getGalleryPackage, type GalleryCard } from "@/lib/gallery/site"
import { featuredRank, galleryCounts, isNew, newestRelease, sortItems } from "@/lib/gallery/browse"
import { communityBrowseItem, officialBrowseItems } from "@/lib/gallery/browse-items"
import { GalleryBrowser } from "./gallery-browser"
import { CardStrip as FeaturedStrip, renderBrowseCards } from "./browse-cards"
import { GalleryBreadcrumbs } from "./detail-ui"

export const GALLERY_TITLE = "Workflow package gallery"
export const GALLERY_DESCRIPTION = "The UserTasks gallery is where the community uploads and shares solutions: ready-made workflow packages for HR, finance, IT, sales, workplace and compliance, Workday and SAP integrations, and packages that need no integrations at all. Install in minutes on UserTasks cloud or self-hosted."

/** Public repository link once it is launched (NEXT_PUBLIC_REPOSITORY_URL). */
export function repositoryUrl(): string | null {
  const raw = String(process.env.NEXT_PUBLIC_REPOSITORY_URL ?? "").trim()
  return /^https:\/\//.test(raw) ? raw.replace(/\/+$/, "") : null
}

const FAQS = [
  { question: "What is in a package?", answer: "A .utpkg file holds a workflow and everything it uses: sub-workflows, decision tables, data tables with sample rows, REST integrations with their API references and response models, email templates and AI agents. It is a signed ZIP in the same config-as-code layout the CLI and GitHub sync use." },
  { question: "Do packages contain credentials?", answer: "No. Every secret is removed when a package is built and becomes a requirement. The install wizard (or the CLI) asks for base URLs, API tokens and the people who receive each task, or installs the package incomplete until you finish setup." },
  { question: "Can I change a package after installing it?", answer: "Yes. Installed assets are ordinary workflows, tables and integrations in your workspace. Edit them in the designer; installing a newer version later upgrades in place and flags anything you changed so you can keep it." },
  { question: "Does it work on a self-hosted instance?", answer: "Yes. Packages install the same way on UserTasks cloud and on any self-hosted deployment, from Automations → Packages (drag the file in, or Browse gallery), the REST API or the CLI. Browse gallery on a self-hosted instance shows the Official packages it ships with plus the Community packages from usertasks.com (GALLERY_INDEX_URL; set it to off for air-gapped instances)." },
  { question: "What is the difference between Official and Community packages?", answer: "Official packages are built by the UserTasks team from the sources in the repository and signed with the UserTasks Gallery key. Community packages are shared by UserTasks users: every one passes the same automatic checks (valid workflows and node settings, no secrets, placeholder hosts, size limits) and a moderator approves it before it is listed. Review a community package before running it, as you would any code from the internet." },
  { question: "What does No integrations needed mean?", answer: "The package uses only built-in features: forms, task forms, data tables with sample rows, decision tables, SLAs and escalations, email templates, schedules, sub-workflows and retention policies. It has no third-party API and asks for nothing on install, so it works as soon as it is installed." },
]

export function GalleryIndexPage({ communityCards = [] }: { communityCards?: GalleryCard[] }) {
  const baseUrl = publicBaseUrl()
  const official = officialBrowseItems()
  const items = [...official, ...communityCards.map(communityBrowseItem)]
  const counts = galleryCounts(items)
  const reference = newestRelease(official)
  const cards = renderBrowseCards(items, reference)
  // Four solutions, then the first featured form control and workflow action.
  const picks = sortItems(official.filter((i) => featuredRank(i.slug) !== null), "featured")
  const featured = [...picks.filter((i) => i.kind === "solution").slice(0, 4), ...(["control", "action"] as const).flatMap((k) => picks.filter((i) => i.kind === k).slice(0, 1))]
  const fresh = sortItems(official.filter((i) => isNew(i, reference)), "newest").slice(0, 3)
  const areas = Object.keys(counts.categories).length
  const repo = repositoryUrl()
  const example = (getGalleryPackage("expense-claims") ?? GALLERY_PACKAGES[0])?.file.file_name ?? "expense-claims-1.0.0.utpkg"
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${baseUrl}/gallery#webpage`,
        url: `${baseUrl}/gallery`,
        name: GALLERY_TITLE,
        description: GALLERY_DESCRIPTION,
        isPartOf: { "@id": `${baseUrl}/#website` },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: GALLERY_PACKAGES.length,
          itemListElement: GALLERY_PACKAGES.map((pkg, index) => ({ "@type": "ListItem", position: index + 1, name: pkg.title, url: `${baseUrl}/gallery/${pkg.slug}` })),
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "UserTasks", item: baseUrl },
          { "@type": "ListItem", position: 2, name: "Gallery", item: `${baseUrl}/gallery` },
        ],
      },
      { "@type": "FAQPage", mainEntity: FAQS.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) },
    ],
  }

  return (
    <UseCaseShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <main>
        <GalleryBrowser
          items={items}
          cards={cards}
          searchLabel="Search the gallery"
          placeholder="Search: onboarding, invoice, signature…"
          noun={{ one: "item", many: "items" }}
          hero={(
            <>
              <GalleryBreadcrumbs trail={[{ label: "Gallery" }]} />
              <h1 className="mt-6 max-w-4xl font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.06] tracking-tight sm:text-6xl">Install a working process in minutes. <span className="mkt-gradient-text-ink">Share yours.</span></h1>
              <p className="mkt-body mt-5 max-w-3xl text-(color:--mkt-text)" data-testid="gallery-intro">
                The gallery is where the UserTasks community uploads and shares solutions. Start from {counts.kinds.solution - counts.community} official solutions across {areas} areas{counts.community ? ` and ${counts.community} from the community` : ""}, {counts.kinds.control} form controls and {counts.kinds.action} workflow actions. Each solution is a complete workflow with its forms, rules, data, integrations and emails: Workday, SAP S/4HANA, ServiceNow and Salesforce flows, or packages that need no integrations at all.
              </p>
            </>
          )}
          heroFooter={(
            <div className="mt-7 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:flex sm:flex-wrap" data-testid="gallery-stats">
                {[
                  { n: counts.kinds.solution, label: "solutions" },
                  { n: counts.kinds.control, label: "form controls" },
                  { n: counts.kinds.action, label: "workflow actions" },
                  { n: counts.native, label: "need no integrations" },
                ].map((stat) => (
                  <div key={stat.label} className="flex items-baseline gap-1.5">
                    <dt className="sr-only">{stat.label}</dt>
                    <dd className="num font-[family-name:var(--font-display)] text-2xl font-bold text-(color:--mkt-ink)">{stat.n}</dd>
                    <span aria-hidden="true" className="text-sm text-(color:--mkt-muted)">{stat.label}</span>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap gap-3">
                <Link key="share" href="/gallery/share" data-testid="share-cta" className="mkt-btn-primary inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold"><Upload size={15} aria-hidden="true" /> Share your solution</Link>
                <Link key="docs" href="/docs/packages" className="inline-flex items-center gap-2 rounded-lg border border-(color:--mkt-ink)/15 bg-(color:--mkt-white) px-5 py-2.5 text-sm font-semibold text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">How packages work</Link>
              </div>
            </div>
          )}
          featured={(
            <section aria-labelledby="featured-heading" className="border-b border-(color:--mkt-ink)/[0.06] bg-(color:--mkt-white)/50">
              <div className="mx-auto grid max-w-7xl gap-12 px-4 py-12 sm:px-6">
                <FeaturedStrip id="featured" headingId="featured-heading" eyebrow="Featured" title="Popular starting points" items={featured} reference={reference}>
                  Hand-picked solutions, controls and actions that show what the platform does best.
                </FeaturedStrip>
                {fresh.length > 1 && <FeaturedStrip id="new" eyebrow="New" title="Just added" items={fresh} reference={reference} />}
              </div>
            </section>
          )}
        />

        <section className="border-y border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
            <SectionHeading eyebrow="How it works" title="Download, install, connect, run" />
            <ol className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Download, title: "Download", body: "Pick a package and download its .utpkg file: one signed ZIP with the workflow and everything it uses." },
                { icon: FileCheck2, title: "Install", body: "Drag the file onto Automations → Packages (or pick it from Browse gallery there), or run usertasks packages install. The file is verified before anything is written." },
                { icon: KeyRound, title: "Connect", body: "Give the base URLs and tokens of your systems and pick who receives each task. Or keep it incomplete and finish later." },
                { icon: Play, title: "Run", body: "Start it from the Run dialog, your portal, the API, a webhook or its schedule. Adapt the rules and tables to your policy." },
              ].map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-(color:--mkt-gold)/[0.12] text-(color:--mkt-bronze)"><Icon size={18} aria-hidden="true" /></span>
                  <p className="mt-3 text-xs font-semibold text-(color:--mkt-subtle)">Step {i + 1}</p>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{body}</p>
                </li>
              ))}
            </ol>
            <div className="mt-8 max-w-3xl">
              <Snippet language="shell" code={`curl -fLO ${baseUrl}/gallery/${example}
usertasks packages inspect ${example}
usertasks packages install ${example}`} />
            </div>
          </div>
        </section>

        <section id="signing" className="scroll-mt-8 mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-[1fr_420px]">
            <SectionHeading eyebrow="Trust" title="Signed packages, verifiable downloads">
              Official packages are built from the sources in the UserTasks repository and signed with the UserTasks Gallery ed25519 key. Community packages carry their author&apos;s signature when they have one, and their checksum either way. The signature covers a SHA-256 checksum of the manifest, which lists the hash of every file, so any change breaks verification.
            </SectionHeading>
            <div className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-5 text-sm">
              {GALLERY_SIGNING.signed ? (
                <>
                  <p className="flex items-center gap-2 font-semibold"><ShieldCheck size={16} className="text-(color:--mkt-green)" aria-hidden="true" /> Signed by {GALLERY_SIGNING.key_name}</p>
                  <p className="mt-3 text-xs text-(color:--mkt-muted)">Key fingerprint (SHA-256, first 16 bytes)</p>
                  <p className="mt-1 break-all font-mono text-xs" data-testid="gallery-fingerprint">{GALLERY_SIGNING.fingerprint}</p>
                  <p className="mt-3 text-xs leading-5 text-(color:--mkt-muted)">The install wizard shows <em>Signed by a trusted key</em> for it. Instances on an older release can add it to <code className="font-mono">PACKAGE_TRUSTED_FINGERPRINTS</code>.</p>
                </>
              ) : (
                <>
                  <p className="flex items-center gap-2 font-semibold"><ShieldAlert size={16} className="text-(color:--mkt-gold-deep)" aria-hidden="true" /> Preview builds</p>
                  <p className="mt-2 text-xs leading-5 text-(color:--mkt-muted)">{GALLERY_SIGNING.note} Each package page lists its file SHA-256 and package checksum.</p>
                </>
              )}
              <p className="mt-4 flex items-center gap-2 border-t border-(color:--mkt-ink)/[0.07] pt-3 text-xs text-(color:--mkt-muted)"><Fingerprint size={13} aria-hidden="true" /> Machine-readable list: <a href="/gallery/index.json" className="font-semibold text-(color:--mkt-bronze) hover:underline">/gallery/index.json</a></p>
            </div>
          </div>
        </section>

        <section id="share" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
            <SectionHeading eyebrow="Community" title="Share your solution">
              Built something others could use? Share it with the community. Every package is checked automatically and approved by a moderator before it is listed as Community.
            </SectionHeading>
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <div className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-6">
                <h3 className="flex items-center gap-2 font-semibold"><UsersRound size={16} className="text-[#6B4E8E]" aria-hidden="true" /> Upload on usertasks.com</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">Sign in, upload the .utpkg you built in Automations → Packages, and add a title, description, category, tags, screenshots and a licence (Apache-2.0 by default). We validate it straight away; a moderator reviews it and you get an email with the decision.</p>
                <Link href="/gallery/share" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline">Share your solution <ArrowRight size={14} aria-hidden="true" /></Link>
              </div>
              <div className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-6">
                <h3 className="flex items-center gap-2 font-semibold"><GitPullRequest size={16} className="text-(color:--mkt-bronze)" aria-hidden="true" /> Contribute an official package</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">Official packages are sources in the repository: add a folder to <code className="font-mono text-ui">gallery/packages</code> (gallery.json, README and the config-as-code assets) and open a pull request. CI validates and verifies it, and maintainers sign the release.</p>
                {repo
                  ? <a href={`${repo}/blob/main/CONTRIBUTING.md#gallery-packages`} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline">Contributing guide <ArrowRight size={14} aria-hidden="true" /></a>
                  : <p className="mt-4 text-xs text-(color:--mkt-muted)">The public repository link appears here once it is launched.</p>}
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
            <SectionHeading eyebrow="Questions" title="About packages" />
            <dl className="mt-8 grid gap-5 md:grid-cols-2">
              {FAQS.map((faq) => (
                <div key={faq.question} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5">
                  <dt className="font-semibold">{faq.question}</dt>
                  <dd className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{faq.answer}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-8 text-sm text-(color:--mkt-text)">
              Build your own: <Link href="/docs/packages" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Packages documentation <ArrowRight size={14} aria-hidden="true" /></Link>
            </p>
          </div>
        </section>
      </main>
    </UseCaseShell>
  )
}
