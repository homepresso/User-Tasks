import Link from "next/link"
import { ArrowRight, BadgeCheck, Ban, Boxes, CheckCircle2, Clock, ExternalLink, Fingerprint, GitPullRequest, LogIn, Mail, Puzzle, ShieldCheck, Upload, UsersRound, XCircle } from "lucide-react"
import { Snippet } from "@/components/marketing/marketing-ui"
import { UseCaseShell } from "@/components/marketing/use-case-page"
import type { SubmissionView } from "@/lib/services/gallery-community"
import { CommunityPublisher, formatDate, GalleryBreadcrumbs, H2, OfficialPublisher, primaryButton } from "./detail-ui"
import { repositoryUrl } from "./gallery-index"
import { ShareForm } from "./share-form"

const CHECKS = [
  "A valid .utpkg: checksums match, a signature (optional) verifies, at most 5 MB",
  "Real workflows: known node types, valid node settings, one trigger, every outcome and branch connected",
  "Everything it points at is inside the package (tables, forms, references, sub-workflows, templates)",
  "No secrets: credentials are placeholders, integrations use placeholder hosts (*.example.com)",
  "No raw HTTP or placeholder steps, custom code, MCP servers or log destinations",
  "Forms, lookups and buttons are valid; screenshots are real images (SVGs sanitised)",
]

/** The page's parts, in order (the step strip under the title links to them). */
export const SHARE_SECTIONS = [
  { id: "what", label: "What you can share" },
  { id: "requirements", label: "Requirements and signing" },
  { id: "submit", label: "Submit" },
  { id: "next", label: "After you submit" },
] as const

const STATUS: Record<string, { label: string; className: string; Icon: typeof Clock }> = {
  approved: { label: "Approved", className: "bg-(color:--mkt-green)/[0.12] text-[#2F5A3B]", Icon: CheckCircle2 },
  rejected: { label: "Changes needed", className: "bg-[#A0533F]/[0.1] text-[#7A3B2C]", Icon: XCircle },
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status === "pending" ? "In review" : status, className: "bg-(color:--mkt-gold)/[0.16] text-[#6F522B]", Icon: Clock }
  return <span className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${s.className}`}><s.Icon size={13} aria-hidden="true" /> {s.label}</span>
}

function SectionHead({ id, n, eyebrow, title, children }: { id: string; n: number; eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="max-w-3xl">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)"><span aria-hidden="true" className="num inline-flex size-5 items-center justify-center rounded-full bg-(color:--mkt-gold)/[0.18] text-2xs tracking-normal text-[#6F522B]">{n}</span>{eyebrow}</p>
      <h2 id={`${id}-heading`} className={`mt-2 ${H2}`}>{title}</h2>
      {children && <p className="mkt-body mt-3 text-(color:--mkt-text)">{children}</p>}
    </div>
  )
}

export function SharePage({ user, submissions, enabled }: { user: { name: string } | null; submissions: SubmissionView[]; enabled: boolean }) {
  const repo = repositoryUrl()
  return (
    <UseCaseShell>
      <main>
        <section className="relative overflow-hidden border-b border-(color:--mkt-ink)/[0.06]">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_90%_at_30%_0%,rgba(107,78,142,0.12),transparent_70%)]" />
          <div aria-hidden="true" className="mkt-grid pointer-events-none absolute inset-0" />
          <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-8 sm:px-6 sm:pb-12 sm:pt-10">
            <GalleryBreadcrumbs trail={[{ label: "Gallery", href: "/gallery" }, { label: "Share your solution" }]} />
            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">Community gallery</p>
            <h1 className="mt-2 max-w-4xl font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">Share your solution</h1>
            <p className="mkt-body mt-4 max-w-3xl text-(color:--mkt-text)">The gallery is where the UserTasks community uploads and shares solutions. Upload a package you built, tell people what it does, and once a moderator approves it, it is listed as a Community package for every UserTasks workspace, cloud and self-hosted.</p>
            <nav aria-label="Steps" className="mt-8" data-testid="share-steps">
              <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {SHARE_SECTIONS.map((s, i) => (
                  <li key={s.id} className="min-w-0">
                    <a href={`#${s.id}`} className="group mkt-lift flex h-full items-center gap-3 rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) px-4 py-3 text-sm font-semibold text-(color:--mkt-ink-soft) outline-none hover:border-(color:--mkt-bronze)/40 focus-visible:ring-2 focus-visible:ring-(color:--mkt-bronze) motion-reduce:transform-none">
                      <span aria-hidden="true" className="num inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-(color:--mkt-primary) text-xs font-bold text-(color:--mkt-paper)">{i + 1}</span>
                      <span className="min-w-0 group-hover:text-(color:--mkt-bronze)">{s.label}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </div>
        </section>

        <section id="what" aria-labelledby="what-heading" className="scroll-mt-24 mx-auto max-w-7xl px-4 py-14 sm:px-6" data-testid="share-section-what">
          <SectionHead id="what" n={1} eyebrow="What you can share" title="A workflow solution you built">Anything you built in your workspace and exported as a package: the workflows with their forms, data tables, rules, email templates and sample data. It installs as ordinary, editable assets.</SectionHead>
          <ul className="mt-8 grid gap-4 md:grid-cols-3">
            <li className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-5">
              <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-xl bg-(color:--mkt-gold)/[0.14] text-(color:--mkt-bronze)"><Boxes size={20} /></span>
              <h3 className="mt-4 font-semibold">Workflow packages (.utpkg)</h3>
              <p className="mt-1.5 text-sm leading-6 text-(color:--mkt-text)">Build it in <strong>Automations → Packages</strong> or with <code className="font-mono text-xs">usertasks packages build</code>. Up to 5 MB, with up to 6 screenshots.</p>
            </li>
            <li className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-5">
              <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-xl bg-[#A0533F]/[0.1] text-[#A0533F]"><Ban size={20} /></span>
              <h3 className="mt-4 font-semibold">Not accepted</h3>
              <p className="mt-1.5 text-sm leading-6 text-(color:--mkt-text)">Real credentials or hosts, raw HTTP or placeholder steps, custom code, MCP servers and log destinations. Use placeholders and demo data only.</p>
            </li>
            <li className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-5">
              <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-xl bg-(color:--mkt-ink)/[0.06] text-(color:--mkt-ink-soft)"><Puzzle size={20} /></span>
              <h3 className="mt-4 font-semibold">Form controls and actions</h3>
              <p className="mt-1.5 text-sm leading-6 text-(color:--mkt-text)">They run code, so they are published as official items. <a href="#contribute" className="font-semibold text-(color:--mkt-bronze) hover:underline">Contribute one with a pull request</a>.</p>
            </li>
          </ul>
        </section>

        <section id="requirements" aria-labelledby="requirements-heading" className="scroll-mt-24 border-y border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50" data-testid="share-section-requirements">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
            <SectionHead id="requirements" n={2} eyebrow="Requirements and signing" title="What we check, and what the badge means">Every upload is checked the moment you submit it; an invalid package is refused with its issues and nothing is stored.</SectionHead>
            <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-6">
                <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck size={16} className="text-(color:--mkt-green)" aria-hidden="true" /> Checked automatically</h3>
                <ul className="mt-4 space-y-2.5 text-sm leading-6 text-(color:--mkt-text)" data-testid="share-checks">{CHECKS.map((c) => <li key={c} className="flex gap-2"><CheckCircle2 size={15} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{c}</li>)}</ul>
              </div>
              <div className="grid content-start gap-5">
                <div className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-6" data-testid="share-signing">
                  <h3 className="flex items-center gap-2 font-semibold"><Fingerprint size={16} className="text-(color:--mkt-bronze)" aria-hidden="true" /> Signing and verification</h3>
                  <p className="mt-3 text-sm leading-6 text-(color:--mkt-text)">Signing is optional. If you sign the package with your own key, the signature must verify, and the listing shows its fingerprint so people can tell the file has not changed. It does not verify who you are: your name and link are shown as you enter them.</p>
                  <dl className="mt-4 grid gap-3 text-sm">
                    <div className="grid gap-1.5"><dt><CommunityPublisher /></dt><dd className="text-(color:--mkt-text)">Shared by a user, checked automatically and approved by a moderator. Not built or signed by the UserTasks team.</dd></div>
                    <div className="grid gap-1.5"><dt><OfficialPublisher signed /></dt><dd className="text-(color:--mkt-text)">Built from the repository by the UserTasks team and signed with the UserTasks Gallery key. <Link href="/gallery#signing" className="font-semibold text-(color:--mkt-bronze) hover:underline">How official packages are signed</Link>.</dd></div>
                  </dl>
                </div>
                <div className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-sand) p-6 text-sm leading-6 text-(color:--mkt-text)">
                  <h3 className="flex items-center gap-2 font-semibold text-(color:--mkt-ink)"><UsersRound size={16} className="text-[#4F3870]" aria-hidden="true" /> Then a moderator reviews it</h3>
                  <p className="mt-2">The package is installed in a scratch workspace and run with your sample input where possible. A moderator approves it or explains what to change, and you get an email either way. Approved packages show your name, the licence, version history and downloads. Anyone can report a listed package.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="submit" aria-labelledby="submit-heading" className="scroll-mt-24 mx-auto max-w-7xl px-4 py-14 sm:px-6" data-testid="share-section-submit">
          <SectionHead id="submit" n={3} eyebrow="Submit" title="Upload a package" />
          <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0">
              {!enabled
                ? <p className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-6 text-sm leading-6 text-(color:--mkt-text)" data-testid="share-disabled">Sharing is available on usertasks.com. On a self-hosted instance, build the package in Automations → Packages and share it at usertasks.com/gallery/share, or contribute it as an official package with a pull request.</p>
                : user
                  ? <ShareForm defaultAuthor={user.name} />
                  : (
                    <div className="mkt-ring p-6 sm:p-8">
                      <span aria-hidden="true" className="inline-flex size-11 items-center justify-center rounded-xl bg-(color:--mkt-gold)/[0.14] text-(color:--mkt-bronze)"><LogIn size={20} /></span>
                      <p className="mt-4 text-lg font-semibold text-(color:--mkt-ink)">Sign in to share a solution</p>
                      <p className="mt-1.5 max-w-xl text-sm leading-6 text-(color:--mkt-text)">Your submissions and the moderators&apos; decisions are tied to your account, so you can follow the review and publish new versions.</p>
                      <Link href="/login?redirect=%2Fgallery%2Fshare" data-testid="share-sign-in" className={`mt-5 ${primaryButton}`}>Sign in to share <ArrowRight size={15} aria-hidden="true" /></Link>
                    </div>
                  )}
            </div>
            <aside className="grid h-fit gap-5 lg:sticky lg:top-24" aria-label="Before you submit">
              <div className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-5 text-sm">
                <p className="font-semibold text-(color:--mkt-ink)">Before you submit</p>
                <ul className="mt-3 space-y-2 leading-6 text-(color:--mkt-text)">
                  <li className="flex gap-2"><BadgeCheck size={15} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />Demo data only, in the package and the screenshots</li>
                  <li className="flex gap-2"><BadgeCheck size={15} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />A sample input lets moderators run it end to end</li>
                  <li className="flex gap-2"><BadgeCheck size={15} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />A new version keeps the package id and raises the version number</li>
                </ul>
              </div>
              {user && submissions.length > 0 && (
                <div className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-5">
                  <h3 className="text-sm font-semibold text-(color:--mkt-ink)">Your submissions</h3>
                  <ul className="mt-3 divide-y divide-(color:--mkt-ink)/[0.07]" data-testid="my-submissions">
                    {submissions.map((s) => {
                      const date = String(s.created_at).slice(0, 10)
                      return (
                        <li key={s.id} className="grid gap-1.5 py-3 text-sm first:pt-0 last:pb-0">
                          <StatusPill status={s.status} />
                          <span className="min-w-0 break-words font-medium text-(color:--mkt-ink-soft)">{s.title} <span className="font-mono text-xs font-normal text-(color:--mkt-muted)">v{s.version}</span></span>
                          <span className="text-xs text-(color:--mkt-muted)">Submitted <time dateTime={date}>{formatDate(date)}</time></span>
                          {s.decision_reason && <span className="text-xs leading-5 text-(color:--mkt-text)">Moderator: {s.decision_reason}</span>}
                          {s.status === "approved" && <Link href={`/gallery/community/${s.slug}`} className="inline-flex items-center gap-1 text-xs font-semibold text-(color:--mkt-bronze) hover:underline">View listing <ArrowRight size={12} aria-hidden="true" /></Link>}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </aside>
          </div>
        </section>

        <section id="next" aria-labelledby="next-heading" className="scroll-mt-24 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50" data-testid="share-section-next">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
            <SectionHead id="next" n={4} eyebrow="After you submit" title="From upload to listing" />
            <ol className="mt-8 grid gap-4 md:grid-cols-4">
              {[
                { Icon: Upload, title: "Checked at once", body: "The automatic checks run while you wait. Issues are listed so you can fix them and upload again." },
                { Icon: Clock, title: "Queued for review", body: "Nothing is public yet. A moderator test-installs it in a scratch workspace." },
                { Icon: Mail, title: "Decision by email", body: "Approved, or what to change. Your submissions above show the status too." },
                { Icon: ExternalLink, title: "Listed as Community", body: "With your name, licence, versions and downloads, in the gallery and in every workspace's Browse gallery." },
              ].map(({ Icon, title, body }, i) => (
                <li key={title} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5">
                  <p className="flex items-center gap-2"><span className="num text-xs font-semibold text-(color:--mkt-subtle)">{i + 1}</span><Icon size={16} className="text-(color:--mkt-bronze)" aria-hidden="true" /></p>
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-(color:--mkt-text)">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="contribute" aria-labelledby="contribute-heading" className="scroll-mt-24 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">Or</p>
              <h2 id="contribute-heading" className={`mt-2 ${H2}`}>Contribute an official package with a pull request</h2>
              <p className="mkt-body mt-3 text-(color:--mkt-text)">Official packages are folders in the repository&apos;s <code className="font-mono text-sm">gallery/packages</code>: a gallery.json (metadata, sample input, expected run), a README and the config-as-code assets. Export the assets, add gallery/packages/my-package/gallery.json and README.md, then validate, verify and open the pull request. CI validates every package and verifies it end to end on a local stack; maintainers sign releases with the UserTasks Gallery key.</p>
            </div>
            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              <div className="min-w-0">
                <Snippet language="shell" code={`usertasks config export --workflow <id> --out gallery/packages/my-package/assets
npm run gallery:build -- --validate my-package
npm run gallery:build -- --out /tmp/g my-package && npm run gallery:verify -- --dir /tmp/g my-package
git checkout -b gallery/my-package && git commit -am "Gallery: my package" && git push`} />
              </div>
              <div className="rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-5 text-sm leading-6 text-(color:--mkt-text)">
                <h3 className="flex items-center gap-2 font-semibold text-(color:--mkt-ink)"><GitPullRequest size={16} className="text-(color:--mkt-bronze)" aria-hidden="true" /> Contributing guide</h3>
                <p className="mt-2">The CONTRIBUTING guide&apos;s Gallery packages section and gallery/README.md list the rules: placeholder hosts, placeholder or routed assignees, response models on every reference, and a sample input that reaches the first task.</p>
                {repo
                  ? <a href={`${repo}/blob/main/CONTRIBUTING.md#gallery-packages`} className="mt-3 inline-flex font-semibold text-(color:--mkt-bronze) hover:underline">Open CONTRIBUTING.md</a>
                  : <p className="mt-3 text-xs text-(color:--mkt-muted)">The public repository link appears here once it is launched.</p>}
              </div>
            </div>
          </div>
        </section>
      </main>
    </UseCaseShell>
  )
}
