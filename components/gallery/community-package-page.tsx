import Link from "next/link"
import { ArrowRight, BadgeCheck, Download, ExternalLink, FileCheck2, Fingerprint, Scale, ShieldAlert, ShieldCheck, Terminal, UserRound, UsersRound } from "lucide-react"
import { Snippet } from "@/components/marketing/marketing-ui"
import { UseCaseShell } from "@/components/marketing/use-case-page"
import { publicBaseUrl } from "@/lib/deployment"
import { newestRelease } from "@/lib/gallery/browse"
import { officialBrowseItems } from "@/lib/gallery/browse-items"
import { formatBytes, galleryCategory } from "@/lib/gallery/site"
import { GALLERY_CATEGORIES, GALLERY_TRIGGERS, type GalleryCategoryId } from "@/lib/gallery/types"
import type { CommunityPackageView } from "@/lib/services/gallery-community"
import { CardStrip } from "./browse-cards"
import { CommunityPublisher, DetailHero, DetailLayout, DetailSection, formatDate, GalleryBreadcrumbs, InstallCard, paragraphs, Pill, primaryButton, secondaryButton, SectionNav } from "./detail-ui"
import { NativeBadge, PackageIcon, TriggerBadge } from "./gallery-ui"
import { ReportAbuse } from "./report-abuse"

/** The author's link, when it is an http(s) URL (the only kind the listing accepts). */
export function communityAuthorUrl(pkg: Pick<CommunityPackageView, "author_url">): string | null {
  return pkg.author_url && /^https?:\/\//.test(pkg.author_url) ? pkg.author_url : null
}

/** "UserTasks · Gallery · Community · <title>" in JSON-LD. */
function communityJsonLd(pkg: CommunityPackageView, baseUrl: string, categoryTitle: string | null, current: CommunityPackageView["versions"][number] | undefined) {
  const url = `${baseUrl}/gallery/community/${pkg.slug}`
  const authorUrl = communityAuthorUrl(pkg)
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": `${url}#package`,
        name: pkg.title,
        description: pkg.summary,
        url,
        applicationCategory: "BusinessApplication",
        ...(categoryTitle ? { applicationSubCategory: categoryTitle } : {}),
        operatingSystem: "UserTasks (cloud or self-hosted)",
        softwareVersion: pkg.current_version,
        ...(current ? { datePublished: String(current.released_at).slice(0, 10), fileSize: formatBytes(current.size_bytes) } : {}),
        downloadUrl: `${baseUrl}/api/gallery/community/${pkg.slug}/download`,
        keywords: pkg.tags.join(", "),
        isAccessibleForFree: true,
        license: pkg.licence,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        author: { "@type": "Person", name: pkg.author_name, ...(authorUrl ? { url: authorUrl } : {}) },
        isPartOf: { "@id": `${baseUrl}/gallery#webpage` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "UserTasks", item: baseUrl },
          { "@type": "ListItem", position: 2, name: "Gallery", item: `${baseUrl}/gallery` },
          { "@type": "ListItem", position: 3, name: "Community", item: `${baseUrl}/gallery?source=community` },
          { "@type": "ListItem", position: 4, name: pkg.title, item: url },
        ],
      },
    ],
  }
}

/**
 * A Community package: shared by a UserTasks user, validated automatically
 * and approved by a moderator. The same detail layout as the official
 * solutions, but published as Community (unverified publisher): the author's
 * name and link are theirs, and a signature is the author's own key.
 */
export function CommunityPackagePage({ pkg }: { pkg: CommunityPackageView }) {
  const baseUrl = publicBaseUrl()
  const category = GALLERY_CATEGORIES.some((c) => c.id === pkg.category) ? galleryCategory(pkg.category as GalleryCategoryId) : null
  const current = pkg.versions.find((v) => v.version === pkg.current_version) ?? pkg.versions[0]
  const download = `/api/gallery/community/${pkg.slug}/download`
  const authorUrl = communityAuthorUrl(pkg)
  const fileName = current?.file_name ?? `${pkg.slug}.utpkg`
  const released = current ? String(current.released_at).slice(0, 10) : null
  const official = officialBrowseItems()
  const related = official.filter((item) => item.kind === "solution" && category && item.category === category.id).slice(0, 3)
  const jsonLd = communityJsonLd(pkg, baseUrl, category?.title ?? null, current)

  const author = authorUrl
    ? <a href={authorUrl} rel="nofollow ugc noopener" target="_blank" className="inline-flex items-center gap-1 font-semibold text-[#4F3870] hover:underline" data-testid="community-author">{pkg.author_name} <ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>
    : <strong className="font-semibold text-(color:--mkt-ink-soft)" data-testid="community-author">{pkg.author_name}</strong>
  const signature = current?.signed
    ? <span className="inline-flex items-center gap-1.5"><ShieldCheck size={14} className="text-(color:--mkt-green)" aria-hidden="true" /> Author&apos;s key</span>
    : <span className="inline-flex items-center gap-1.5"><ShieldAlert size={14} className="text-(color:--mkt-gold-deep)" aria-hidden="true" /> Unsigned</span>

  const sections = [
    { id: "overview", label: "Overview" },
    { id: "trust", label: "Author and trust" },
    { id: "install", label: "Install" },
    { id: "versions", label: "Versions" },
  ]

  return (
    <UseCaseShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <main>
        <DetailHero
          breadcrumbs={<GalleryBreadcrumbs trail={[{ label: "Gallery", href: "/gallery" }, { label: "Community", href: "/gallery?source=community" }, { label: pkg.title }]} />}
          icon={<span className="text-[#4F3870]"><PackageIcon icon={null} category={(category?.id ?? "operations-compliance") as GalleryCategoryId} size={30} /></span>}
          eyebrow={`${category?.title ?? "Community"} · community package`}
          title={pkg.title}
          byline={<><UserRound size={14} aria-hidden="true" className="text-(color:--mkt-muted)" /> <span>Shared by {author}</span><span aria-hidden="true" className="text-(color:--mkt-faint)">·</span><span className="text-(color:--mkt-muted)" data-testid="author-verification">Identity not verified by UserTasks</span></>}
          summary={pkg.summary}
          badges={(
            <>
              <CommunityPublisher />
              {pkg.native && <NativeBadge size="md" />}
              <TriggerBadge trigger={pkg.trigger} size="md" />
              <Pill mono>v{pkg.current_version}</Pill>
              <span data-testid="download-count"><Pill><Download size={12} aria-hidden="true" /><span className="num">{pkg.downloads}</span> download{pkg.downloads === 1 ? "" : "s"}</Pill></span>
            </>
          )}
          actions={(
            <>
              <a href={download} data-testid="download-community" className={primaryButton}>
                <Download size={16} aria-hidden="true" /> Download .utpkg {current && <span className="num font-normal opacity-75">{formatBytes(current.size_bytes)}</span>}
              </a>
              <a href="#install" className={secondaryButton}>How to install <ArrowRight size={14} aria-hidden="true" /></a>
            </>
          )}
        />
        <SectionNav sections={sections} />
        <DetailLayout
          aside={(
            <InstallCard
              file={{ file: download, file_name: fileName, size_bytes: current?.size_bytes ?? 0, signed: Boolean(current?.signed) }}
              downloadTestId="install-card-download"
              downloadName={null}
              source={null}
              intro="Free for UserTasks cloud and self-hosted. Review what it does before you run it: it is not built by the UserTasks team."
              signature={signature}
              facts={[
                { label: "Publisher", value: <span className="inline-flex items-center gap-1 text-[#4F3870]"><UsersRound size={13} aria-hidden="true" /> Community</span> },
                { label: "Author", value: pkg.author_name },
                { label: "Version", value: <span className="font-mono">v{pkg.current_version}</span> },
                ...(released ? [{ label: "Last updated", value: <time dateTime={released}>{formatDate(released)}</time> }] : []),
                { label: "Starts", value: GALLERY_TRIGGERS[pkg.trigger].label },
                { label: "Asked on install", value: current?.requirement_count ? `${current.requirement_count} requirement${current.requirement_count === 1 ? "" : "s"}` : "Nothing" },
                { label: "Licence", value: <span className="inline-flex items-center gap-1"><Scale size={13} aria-hidden="true" />{pkg.licence}</span> },
              ]}
            />
          )}
        >
          <DetailSection id="overview" eyebrow="Overview" title="What it does">
            <div className="max-w-3xl space-y-4 text-base leading-7 text-(color:--mkt-text)">{paragraphs(pkg.description).map((p) => <p key={p.slice(0, 40)}>{p}</p>)}</div>
            {pkg.tags.length > 0 && (
              <ul className="mt-6 flex flex-wrap gap-1.5" aria-label="Tags">
                {pkg.tags.map((t) => <li key={t}><Link href={`/gallery?source=community&tag=${encodeURIComponent(t)}`} className="inline-flex rounded-md border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) px-2 py-0.5 text-xs text-(color:--mkt-muted-strong) hover:border-(color:--mkt-bronze)/40 hover:text-(color:--mkt-bronze)">#{t}</Link></li>)}
              </ul>
            )}
            {pkg.screenshots.length > 0 && (
              <div className="mt-8 grid gap-4 sm:grid-cols-2" data-testid="community-screenshots">
                {pkg.screenshots.map((shot, i) => (
                  // eslint-disable-next-line @next/next/no-img-element -- user screenshots served by the API (sanitised SVGs, checked rasters)
                  <img key={shot.path} src={`/api/gallery/community/${pkg.slug}/screenshots/${i + 1}`} alt={`${pkg.title} screenshot ${i + 1}`} loading="lazy" className="w-full rounded-xl border border-(color:--mkt-ink)/[0.1] bg-(color:--mkt-white)" />
                ))}
              </div>
            )}
          </DetailSection>

          <DetailSection id="trust" eyebrow="Author and trust" title="Who made it, and what was checked" testId="section-trust"
            intro="Community packages are shared by UserTasks users. They pass the same automatic checks as every gallery package and a moderator approves them before they are listed, but they are not built, reviewed line by line or signed by the UserTasks team.">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-[#6B4E8E]/20 bg-[#6B4E8E]/[0.05] p-5">
                <p className="flex items-center gap-2 font-semibold text-(color:--mkt-ink)"><UsersRound size={16} className="text-[#4F3870]" aria-hidden="true" /> Author</p>
                <dl className="mt-3 grid gap-2.5 text-sm">
                  <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5"><dt className="text-(color:--mkt-muted)">Shared by</dt><dd className="min-w-0 break-words">{author}</dd></div>
                  <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5"><dt className="text-(color:--mkt-muted)">Identity</dt><dd className="font-medium text-(color:--mkt-ink-soft)">Not verified: the name and link are the author&apos;s own</dd></div>
                  <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5"><dt className="text-(color:--mkt-muted)">Licence</dt><dd className="font-medium text-(color:--mkt-ink-soft)">{pkg.licence}</dd></div>
                </dl>
              </div>
              <div className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-5">
                <p className="flex items-center gap-2 font-semibold text-(color:--mkt-ink)"><Fingerprint size={16} className="text-(color:--mkt-bronze)" aria-hidden="true" /> Signature</p>
                {current?.signed
                  ? <p className="mt-3 text-sm leading-6 text-(color:--mkt-text)" data-testid="community-signature">Signed with the author&apos;s own key, so you can tell the file has not changed since they built it. It is not the UserTasks Gallery key and does not prove who the author is. <span className="mt-1 block break-all font-mono text-2xs text-(color:--mkt-muted)">{current.fingerprint}</span></p>
                  : <p className="mt-3 text-sm leading-6 text-(color:--mkt-text)" data-testid="community-signature">Not signed. Compare the file SHA-256 under Install with the file you downloaded.</p>}
              </div>
            </div>
            <ul className="mt-5 grid gap-2 text-sm leading-6 text-(color:--mkt-text)">
              <li className="flex gap-2"><BadgeCheck size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" /> Passed the gallery&apos;s automatic checks: valid workflows, nothing outside the package, no secrets, placeholder hosts, no custom code.</li>
              <li className="flex gap-2"><BadgeCheck size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" /> Approved by a moderator after a test install.</li>
              <li className="flex gap-2"><ShieldAlert size={16} className="mt-1 shrink-0 text-(color:--mkt-gold-deep)" aria-hidden="true" /> Read what it does and the changes the install wizard shows before you run it, as you would any code from the internet.</li>
            </ul>
            <div className="mt-6 flex flex-wrap items-start justify-between gap-4 rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) p-4">
              <p className="max-w-md text-sm leading-6 text-(color:--mkt-text)">Something wrong with it? Reports go to the moderators, who can unlist it.</p>
              <ReportAbuse slug={pkg.slug} version={pkg.current_version} />
            </div>
          </DetailSection>

          <DetailSection id="install" eyebrow="Install" title="Install it in your workspace" intro="Works on UserTasks cloud and on any self-hosted instance. The wizard verifies the checksum and shows every change before anything is installed; nothing runs until you complete setup.">
            <div className="grid gap-5 xl:grid-cols-2">
              <div className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-6">
                <h3 className="flex items-center gap-2 font-semibold"><FileCheck2 size={16} className="text-(color:--mkt-bronze)" aria-hidden="true" /> In the app</h3>
                <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-(color:--mkt-text)" data-testid="install-steps">
                  <li>Open <strong>Automations → Packages</strong> and choose <strong>Browse gallery</strong>: Community packages are listed there with this badge.</li>
                  <li>Or <a href={download} className="font-semibold text-(color:--mkt-bronze) hover:underline">download the file</a> and drag it onto the Packages page.</li>
                  <li>Review the changes, fill in any requirements, and finish setup.</li>
                </ol>
              </div>
              <div className="min-w-0">
                <h3 className="mb-2 flex items-center gap-2 font-semibold"><Terminal size={16} className="text-(color:--mkt-bronze)" aria-hidden="true" /> With the CLI</h3>
                <Snippet language="shell" code={`curl -fL -o ${fileName} ${baseUrl}${download}
usertasks packages inspect ${fileName}
usertasks packages install ${fileName} --dry-run`} />
              </div>
            </div>
            <div className="mt-5 rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold"><Fingerprint size={15} className="text-(color:--mkt-bronze)" aria-hidden="true" /> Verify the download</p>
              <dl className="mt-2 grid gap-1.5 text-xs">
                <div className="grid gap-0.5"><dt className="text-(color:--mkt-muted)">File SHA-256</dt><dd className="break-all font-mono text-2xs text-(color:--mkt-ink-soft)">{current?.sha256}</dd></div>
                <div className="grid gap-0.5"><dt className="text-(color:--mkt-muted)">Package checksum</dt><dd className="break-all font-mono text-2xs text-(color:--mkt-ink-soft)">{current?.checksum}</dd></div>
                <div className="grid gap-0.5"><dt className="text-(color:--mkt-muted)">Signer</dt><dd className="break-all font-mono text-2xs text-(color:--mkt-ink-soft)">{current?.signed ? `Author's key · ${current.fingerprint}` : "Unsigned: compare the SHA-256 above"}</dd></div>
              </dl>
            </div>
          </DetailSection>

          <DetailSection id="versions" eyebrow="Version history" title={`Version ${pkg.current_version}`}>
            <ol className="relative space-y-4 border-l border-(color:--mkt-ink)/[0.1] pl-6" data-testid="version-history">
              {pkg.versions.map((v) => {
                const date = String(v.released_at).slice(0, 10)
                const latest = v.version === pkg.current_version
                return (
                  <li key={v.version} className="relative">
                    <span aria-hidden="true" className={`absolute -left-[31px] top-1.5 size-2.5 rounded-full ring-4 ring-(color:--mkt-paper) ${latest ? "bg-[#6B4E8E]" : "bg-(color:--mkt-faint)"}`} />
                    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-mono text-sm font-semibold text-(color:--mkt-ink)">v{v.version}</span>
                      <time dateTime={date} className="text-sm text-(color:--mkt-muted)">{formatDate(date)}</time>
                      {latest && <span className="rounded-full bg-[#6B4E8E]/[0.12] px-2 py-0.5 text-2xs font-semibold text-[#4F3870]">Latest</span>}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{v.notes ?? "No notes."}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-(color:--mkt-muted)">
                      <span><span className="num">{v.downloads}</span> downloads · {formatBytes(v.size_bytes)}</span>
                      <a href={`${download}?version=${encodeURIComponent(v.version)}`} className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline"><FileCheck2 size={13} aria-hidden="true" /> Download<span className="sr-only"> v{v.version}</span></a>
                    </p>
                  </li>
                )
              })}
            </ol>
          </DetailSection>
        </DetailLayout>

        <section className="border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50" data-testid="related">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-14 sm:px-6">
            {related.length > 0 && category && (
              <CardStrip eyebrow={`More ${category.title}`} title="Official solutions like this" items={related} reference={newestRelease(official)} more={{ href: `/gallery?category=${category.id}`, label: `Browse ${category.title}` }} />
            )}
            <div className="mkt-ring flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
              <div>
                <p className="font-semibold text-(color:--mkt-ink)">Built something similar?</p>
                <p className="mt-1 text-sm text-(color:--mkt-text)">Share it with the community: it is checked automatically and reviewed by a moderator.</p>
              </div>
              <Link href="/gallery/share" className={secondaryButton}>Share your solution <ArrowRight size={14} aria-hidden="true" /></Link>
            </div>
          </div>
        </section>
      </main>
    </UseCaseShell>
  )
}
