import Link from "next/link"
import { CheckCircle2, Clock, GitPullRequest, ShieldCheck, Upload, XCircle } from "lucide-react"
import { SectionHeading, Snippet } from "@/components/marketing/marketing-ui"
import { UseCaseShell } from "@/components/marketing/use-case-page"
import type { SubmissionView } from "@/lib/services/gallery-community"
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

function StatusIcon({ status }: { status: string }) {
  if (status === "approved") return <CheckCircle2 size={14} className="text-[#4F7A5B]" aria-hidden="true" />
  if (status === "rejected") return <XCircle size={14} className="text-[#A0533F]" aria-hidden="true" />
  return <Clock size={14} className="text-[#A0804F]" aria-hidden="true" />
}

export function SharePage({ user, submissions, enabled }: { user: { name: string } | null; submissions: SubmissionView[]; enabled: boolean }) {
  const repo = repositoryUrl()
  return (
    <UseCaseShell>
      <main>
        <section className="border-b border-[#1B1916]/[0.06] bg-[radial-gradient(circle_at_50%_0%,rgba(107,78,142,0.12),transparent_45%)]">
          <div className="mx-auto max-w-6xl px-4 pb-12 pt-10 sm:px-6 sm:pt-14">
            <nav aria-label="Breadcrumb" className="text-xs text-[#857D6D]">
              <Link href="/" className="hover:text-[#8A6D45]">UserTasks</Link><span className="px-2">/</span><Link href="/gallery" className="hover:text-[#8A6D45]">Gallery</Link><span className="px-2">/</span><span aria-current="page">Share your solution</span>
            </nav>
            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.22em] text-[#6B4E8E]">Community gallery</p>
            <h1 className="mt-4 max-w-4xl font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">Share your solution</h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-[#4A463E]">The gallery is where the UserTasks community uploads and shares solutions. Upload a package you built, tell people what it does, and once a moderator approves it, it is listed as a Community package for every UserTasks workspace, cloud and self-hosted.</p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-semibold"><Upload size={18} className="text-[#6B4E8E]" aria-hidden="true" /> Upload a package</h2>
              <div className="mt-5">
                {!enabled
                  ? <p className="rounded-xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-5 text-sm text-[#4A463E]">Sharing is available on usertasks.com. On a self-hosted instance, build the package in Automations → Packages and share it at usertasks.com/gallery/share, or contribute it as an official package with a pull request.</p>
                  : user
                    ? <ShareForm defaultAuthor={user.name} />
                    : (
                      <div className="rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-6 text-sm text-[#4A463E]">
                        <p>Sign in to share a solution: your submissions and the moderators&apos; decisions are tied to your account.</p>
                        <Link href="/login?redirect=%2Fgallery%2Fshare" data-testid="share-sign-in" className="mt-4 inline-flex rounded-lg bg-[#17150F] px-5 py-2.5 font-semibold text-[#FAF8F3]">Sign in to share</Link>
                      </div>
                    )}
              </div>
              {user && submissions.length > 0 && (
                <div className="mt-10">
                  <h2 className="text-lg font-semibold">Your submissions</h2>
                  <ul className="mt-3 divide-y divide-[#1B1916]/[0.07] rounded-xl border border-[#1B1916]/[0.09] bg-[#FFFFFF]" data-testid="my-submissions">
                    {submissions.map((s) => (
                      <li key={s.id} className="flex flex-col gap-1 p-4 text-sm sm:flex-row sm:items-center sm:gap-4">
                        <span className="inline-flex items-center gap-1.5 font-medium capitalize"><StatusIcon status={s.status} /> {s.status}</span>
                        <span className="flex-1">{s.title} <span className="font-mono text-xs text-[#6E6759]">v{s.version}</span></span>
                        <span className="text-xs text-[#6E6759]">{String(s.created_at).slice(0, 10)}</span>
                        {s.status === "approved" && <Link href={`/gallery/community/${s.slug}`} className="text-xs font-semibold text-[#8A6D45] hover:underline">View listing</Link>}
                        {s.decision_reason && <span className="w-full text-xs text-[#6E6759] sm:w-auto">Moderator: {s.decision_reason}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <aside className="grid h-fit gap-5">
              <div className="rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-5 text-sm">
                <p className="flex items-center gap-2 font-semibold"><ShieldCheck size={16} className="text-[#4F7A5B]" aria-hidden="true" /> What we check automatically</p>
                <ul className="mt-3 space-y-2 text-[13px] leading-5 text-[#4A463E]">{CHECKS.map((c) => <li key={c} className="flex gap-2"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[#4F7A5B]" aria-hidden="true" />{c}</li>)}</ul>
              </div>
              <div className="rounded-2xl border border-[#1B1916]/[0.09] bg-[#F1EDE3] p-5 text-sm leading-6 text-[#4A463E]">
                <p className="font-semibold text-[#1B1916]">Then a moderator reviews it</p>
                <p className="mt-2">The package is installed in a scratch workspace and run with your sample input where possible. A moderator approves it or explains what to change, and you get an email either way. Approved packages show your name, the licence, version history and downloads. Anyone can report a listed package.</p>
              </div>
            </aside>
          </div>
        </section>

        <section id="contribute" className="scroll-mt-8 border-t border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <SectionHeading eyebrow="Or" title="Contribute an official package with a pull request">
              Official packages are folders in the repository&apos;s <code className="font-mono">gallery/packages</code>: a gallery.json (metadata, sample input, expected run), a README and the config-as-code assets. CI validates every package and verifies it end to end on a local stack; maintainers sign releases with the UserTasks Gallery key.
            </SectionHeading>
            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              <Snippet language="shell" code={`usertasks config export --workflow <id> --out gallery/packages/my-package/assets
# add gallery/packages/my-package/gallery.json and README.md
npm run gallery:build -- --validate my-package
npm run gallery:build -- --out /tmp/g my-package && npm run gallery:verify -- --dir /tmp/g my-package
git checkout -b gallery/my-package && git commit -am "Gallery: my package" && git push`} />
              <div className="rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-5 text-sm leading-6 text-[#4A463E]">
                <p className="flex items-center gap-2 font-semibold text-[#1B1916]"><GitPullRequest size={16} className="text-[#8A6D45]" aria-hidden="true" /> Contributing guide</p>
                <p className="mt-2">The CONTRIBUTING guide&apos;s Gallery packages section and gallery/README.md list the rules: placeholder hosts, placeholder or routed assignees, response models on every reference, and a sample input that reaches the first task.</p>
                {repo
                  ? <a href={`${repo}/blob/main/CONTRIBUTING.md#gallery-packages`} className="mt-3 inline-flex font-semibold text-[#8A6D45] hover:underline">Open CONTRIBUTING.md</a>
                  : <p className="mt-3 text-xs text-[#6E6759]">The public repository link appears here once it is launched.</p>}
              </div>
            </div>
          </div>
        </section>
      </main>
    </UseCaseShell>
  )
}
