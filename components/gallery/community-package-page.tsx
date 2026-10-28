import Link from "next/link"
import { Download, ExternalLink, FileCheck2, Fingerprint, Scale, ShieldAlert, ShieldCheck, Terminal, UserRound } from "lucide-react"
import { SectionHeading, Snippet } from "@/components/marketing/marketing-ui"
import { UseCaseShell } from "@/components/marketing/use-case-page"
import { publicBaseUrl } from "@/lib/deployment"
import { formatBytes, galleryCategory } from "@/lib/gallery/site"
import { GALLERY_CATEGORIES, GALLERY_ORIGINS, GALLERY_TRIGGERS, type GalleryCategoryId } from "@/lib/gallery/types"
import type { CommunityPackageView } from "@/lib/services/gallery-community"
import { NativeBadge, OriginBadge, PackageIcon, TriggerBadge } from "./gallery-ui"
import { ReportAbuse } from "./report-abuse"

function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
}

/** A Community package: shared by a UserTasks user, validated automatically, approved by a moderator. */
export function CommunityPackagePage({ pkg }: { pkg: CommunityPackageView }) {
  const baseUrl = publicBaseUrl()
  const category = GALLERY_CATEGORIES.some((c) => c.id === pkg.category) ? galleryCategory(pkg.category as GalleryCategoryId) : null
  const current = pkg.versions.find((v) => v.version === pkg.current_version) ?? pkg.versions[0]
  const download = `/api/gallery/community/${pkg.slug}/download`
  const authorUrl = pkg.author_url && /^https?:\/\//.test(pkg.author_url) ? pkg.author_url : null
  return (
    <UseCaseShell>
      <main>
        <section className="border-b border-[#1B1916]/[0.06] bg-[radial-gradient(circle_at_50%_0%,rgba(107,78,142,0.12),transparent_45%)]">
          <div className="mx-auto max-w-6xl px-4 pb-14 pt-10 sm:px-6 sm:pt-12">
            <nav aria-label="Breadcrumb" className="flex flex-wrap items-center text-xs text-[#857D6D]">
              <Link href="/" className="hover:text-[#8A6D45]">UserTasks</Link><span className="px-2">/</span>
              <Link href="/gallery" className="hover:text-[#8A6D45]">Gallery</Link><span className="px-2">/</span>
              <Link href="/gallery?source=community" className="hover:text-[#8A6D45]">Community</Link><span className="px-2">/</span>
              <span aria-current="page">{pkg.title}</span>
            </nav>
            <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_340px]">
              <div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#6B4E8E]/[0.12] text-[#4F3870]"><PackageIcon icon={null} category={(category?.id ?? "operations-compliance") as GalleryCategoryId} size={22} /></span>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#6B4E8E]">{category?.title ?? "Community"} · community package</p>
                </div>
                <h1 className="mt-5 font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">{pkg.title}</h1>
                <p className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-[#4A463E]"><UserRound size={14} aria-hidden="true" /> by {authorUrl ? <a href={authorUrl} rel="nofollow ugc noopener" target="_blank" className="inline-flex items-center gap-1 font-semibold text-[#6B4E8E] hover:underline">{pkg.author_name} <ExternalLink size={11} aria-hidden="true" /></a> : <strong>{pkg.author_name}</strong>}</p>
                <p className="mt-5 max-w-2xl text-lg leading-8 text-[#4A463E]">{pkg.summary}</p>
                <div className="mt-6 flex flex-wrap items-center gap-2">
                  <OriginBadge source="community" size="md" />
                  {pkg.native && <NativeBadge size="md" />}
                  <TriggerBadge trigger={pkg.trigger} size="md" />
                  <span className="rounded-full border border-[#1B1916]/12 bg-[#FFFFFF] px-3 py-1 font-mono text-sm text-[#4A463E]">v{pkg.current_version}</span>
                  <span className="rounded-full border border-[#1B1916]/12 bg-[#FFFFFF] px-3 py-1 text-sm text-[#4A463E]" data-testid="download-count"><Download size={12} className="mr-1 inline" aria-hidden="true" />{pkg.downloads} download{pkg.downloads === 1 ? "" : "s"}</span>
                </div>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <a href={download} data-testid="download-community" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#17150F] px-6 py-3 font-semibold text-[#FAF8F3] hover:bg-[#2E2A24]">
                    <Download size={16} aria-hidden="true" /> Download .utpkg {current && <span className="font-normal text-[#CFC6B4]">{formatBytes(current.size_bytes)}</span>}
                  </a>
                  <a href="#install" className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#1B1916]/15 px-6 py-3 font-medium text-[#33302A] hover:border-[#1B1916]/30">How to install</a>
                </div>
              </div>
              <aside className="h-fit rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-5 text-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6B4E8E]">At a glance</p>
                <dl className="mt-3 grid gap-3">
                  <div><dt className="text-xs text-[#857D6D]">Source</dt><dd className="mt-0.5 text-[#33302A]">{GALLERY_ORIGINS.community.description}</dd></div>
                  <div><dt className="text-xs text-[#857D6D]">Starts</dt><dd className="mt-0.5 font-medium">{GALLERY_TRIGGERS[pkg.trigger].label}</dd></div>
                  <div><dt className="text-xs text-[#857D6D]">Asked for on install</dt><dd className="mt-0.5 text-[#33302A]">{current?.requirement_count ? `${current.requirement_count} requirement${current.requirement_count === 1 ? "" : "s"}` : "Nothing"}</dd></div>
                  <div><dt className="text-xs text-[#857D6D]">Licence</dt><dd className="mt-0.5 inline-flex items-center gap-1.5 text-[#33302A]"><Scale size={13} aria-hidden="true" />{pkg.licence}</dd></div>
                  <div><dt className="text-xs text-[#857D6D]">Signature</dt><dd className="mt-0.5 inline-flex items-center gap-1.5 text-[#33302A]">{current?.signed ? <><ShieldCheck size={14} className="text-[#4F7A5B]" aria-hidden="true" /> Signed by the author ({current.fingerprint})</> : <><ShieldAlert size={14} className="text-[#A0804F]" aria-hidden="true" /> Unsigned: compare the checksum</>}</dd></div>
                </dl>
                <p className="mt-4 border-t border-[#1B1916]/[0.07] pt-3 text-xs leading-5 text-[#6E6759]">Community packages pass the gallery&apos;s automatic checks and a moderator&apos;s review, but they are not built by the UserTasks team. Read what it does before you run it.</p>
              </aside>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <SectionHeading eyebrow="About this package" title="What it does" />
          <div className="mt-5 max-w-3xl space-y-4 text-[15.5px] leading-7 text-[#4A463E]">{paragraphs(pkg.description).map((p) => <p key={p.slice(0, 40)}>{p}</p>)}</div>
          {pkg.tags.length > 0 && <p className="mt-5 flex flex-wrap gap-1.5">{pkg.tags.map((t) => <span key={t} className="rounded-md bg-[#F1EDE3] px-1.5 py-0.5 text-xs text-[#4A463E]">{t}</span>)}</p>}
          {pkg.screenshots.length > 0 && (
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {pkg.screenshots.map((shot, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- user screenshots served by the API (sanitised SVGs, checked rasters)
                <img key={shot.path} src={`/api/gallery/community/${pkg.slug}/screenshots/${i + 1}`} alt={`${pkg.title} screenshot ${i + 1}`} loading="lazy" className="w-full rounded-xl border border-[#1B1916]/[0.1] bg-[#FFFFFF]" />
              ))}
            </div>
          )}
        </section>

        <section id="install" className="scroll-mt-8 border-y border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <SectionHeading eyebrow="Install" title="Install it in your workspace">Works on UserTasks cloud and on any self-hosted instance: Browse gallery in Automations → Packages lists it, or drag the downloaded file in. The wizard verifies the checksum and shows every change before anything is installed.</SectionHeading>
            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              <div className="min-w-0"><h3 className="mb-2 flex items-center gap-2 font-semibold"><Terminal size={16} className="text-[#8A6D45]" aria-hidden="true" /> With the CLI</h3>
                <Snippet language="shell" code={`curl -fL -o ${current?.file_name ?? `${pkg.slug}.utpkg`} ${baseUrl}${download}
usertasks packages inspect ${current?.file_name ?? `${pkg.slug}.utpkg`}
usertasks packages install ${current?.file_name ?? `${pkg.slug}.utpkg`} --dry-run`} />
              </div>
              <div className="rounded-xl border border-[#1B1916]/[0.08] bg-[#F1EDE3] p-4 text-sm">
                <p className="flex items-center gap-2 font-semibold"><Fingerprint size={15} className="text-[#8A6D45]" aria-hidden="true" /> Verify the download</p>
                <dl className="mt-2 grid gap-1.5 text-xs">
                  <div className="grid gap-0.5"><dt className="text-[#6E6759]">File SHA-256</dt><dd className="break-all font-mono text-[11px] text-[#33302A]">{current?.sha256}</dd></div>
                  <div className="grid gap-0.5"><dt className="text-[#6E6759]">Package checksum</dt><dd className="break-all font-mono text-[11px] text-[#33302A]">{current?.checksum}</dd></div>
                </dl>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <SectionHeading eyebrow="Versions" title="Version history" />
          <ol className="mt-6 space-y-3" data-testid="version-history">
            {pkg.versions.map((v) => (
              <li key={v.version} className="flex flex-col gap-1 rounded-xl border border-[#1B1916]/[0.08] bg-[#FFFFFF] p-4 sm:flex-row sm:items-center sm:gap-6">
                <span className="font-mono text-sm font-semibold">v{v.version}</span>
                <span className="text-sm text-[#6E6759]">{String(v.released_at).slice(0, 10)}</span>
                <span className="flex-1 text-sm text-[#4A463E]">{v.notes ?? "—"}</span>
                <span className="text-xs text-[#6E6759]">{v.downloads} downloads · {formatBytes(v.size_bytes)}</span>
                <a href={`${download}?version=${encodeURIComponent(v.version)}`} className="inline-flex items-center gap-1 text-sm font-semibold text-[#8A6D45] hover:underline"><FileCheck2 size={13} aria-hidden="true" /> Download</a>
              </li>
            ))}
          </ol>
          <div className="mt-10 flex flex-wrap items-start justify-between gap-6 border-t border-[#1B1916]/[0.07] pt-6">
            <p className="text-sm text-[#6E6759]">Built something similar? <Link href="/gallery/share" className="font-semibold text-[#8A6D45] hover:underline">Share your solution</Link>.</p>
            <ReportAbuse slug={pkg.slug} version={pkg.current_version} />
          </div>
        </section>
      </main>
    </UseCaseShell>
  )
}
