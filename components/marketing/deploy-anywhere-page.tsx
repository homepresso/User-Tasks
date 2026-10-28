import type { CSSProperties, ReactNode } from "react"
import Link from "next/link"
import { ArrowRight, Check, CloudCog, GitCompareArrows, History, RotateCcw, ShieldCheck, Undo2, Zap } from "lucide-react"
import { MarketingFooter, MarketingHeader, SectionHeading, Snippet } from "@/components/marketing/marketing-ui"
import { TopologyDiagram } from "@/components/topology/topology-diagram"
import { AREAS, AREA_LABEL, DEPLOY_ANYWHERE, getTopology } from "@/lib/topologies"

/**
 * /deploy-anywhere — the five deployment topologies, the "start on Supabase,
 * move each area whenever you're ready" story and the provider grid. Server-rendered, data
 * from lib/topologies.ts (the same source as the docs diagrams). Provider
 * names are plain text: no third-party logos.
 */

const SITE_URL = "https://usertasks.com"

const THEME = {
  "--theme-card-bg": "#FFFFFF",
  "--theme-card-text": "#1B1916",
  "--theme-surface": "#F5F2EA",
  "--theme-surface-border": "#E6E1D5",
  "--theme-muted-text": "#6E6759",
} as CSSProperties

const NAV = [
  { id: "supabase", label: "Supabase only" },
  { id: "hybrid", label: "Hybrid" },
  { id: "single-cloud", label: "Single cloud" },
  { id: "multi-cloud", label: "Multi-cloud" },
  { id: "on-premises", label: "On-premises" },
]

const STEPS = [
  { title: "Deploy on Supabase", body: "One project gives you the database, auth, storage, realtime and scheduling. No provider settings — every area starts on its default." },
  { title: "Move areas when you're ready", body: "If you'd like to use other services, move files to your bucket, email to your domain, secrets to your vault or sign-in to your IdP. One switch per area; the app keeps running." },
  { title: "Settle where it suits you", body: "Stay on Supabase, stop at hybrid, or carry on to a single cloud, several clouds, or a network with no internet at all. The database moves last." },
]

const SAFETY = [
  { icon: GitCompareArrows, title: "Pre-flight checks", body: "The target is probed before anything changes: reachable, writable, configured. A failed check stops the switch." },
  { icon: History, title: "Backup and step log", body: "Settings and every row a switch touches are backed up; each step is recorded as it starts and finishes." },
  { icon: RotateCcw, title: "Idempotent steps", body: "If a step fails, fix the cause and run the same command again. The provider setting is written last." },
  { icon: Undo2, title: "Rollback", body: "usertasks-admin rollback restores settings and undoes data changes where it can — URLs, accounts, pg_cron jobs, data keys." },
]

const SWITCH_SNIPPET = `# every area: provider and health
usertasks-admin status

# plan, then run: files to S3, email to SES
usertasks-admin switch storage --to s3 --dry-run
usertasks-admin switch storage --to s3 --yes
usertasks-admin switch email --to ses --yes

# every switch, with rollback ids
usertasks-admin history`

const FAQS = [
  { question: "Should I stay on Supabase?", answer: "Supabase is an excellent platform and our recommended way to run UserTasks. Supabase only is a complete topology, and hybrid (Supabase for the database with some areas in your own cloud account) is the most common setup. If you'd like to use other services, you can move each area whenever you're ready." },
  { question: "Can I switch back?", answer: "Yes. Every switch takes a backup and records its steps; usertasks-admin rollback restores the settings and undoes its data changes where possible. Moving the database never writes to the source, so pointing the app back is always possible." },
  { question: "Which clouds are supported?", answer: "AWS, Microsoft Azure and Google Cloud, through their own services and identities where it matters (managed identity, IAM roles, service accounts), plus any PostgreSQL, S3-compatible store, SMTP relay, OIDC or SAML identity provider and Redis-compatible cache." },
  { question: "Does it run without internet access?", answer: "Yes. The on-premises reference profile runs on a network with no route out, and its smoke test fails if the app can reach the internet: PostgreSQL, built-in auth or Keycloak, MinIO, SSE realtime, the worker and an SMTP relay." },
]

function Diagram({ id }: { id: string }) {
  const topology = getTopology(id)
  return topology ? <TopologyDiagram topology={topology} className="mt-8 block" /> : null
}

function TopologySection({ id, index, title, when, points, diagram, docs, children }: { id: string; index: number; title: string; when: string; points: string[]; diagram?: string; docs: Array<{ href: string; label: string }>; children?: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-8 border-t border-[#1B1916]/[0.07]">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-end">
          <div>
            <p className="text-xs font-bold text-[#8A6D45]">0{index}</p>
            <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
            <p className="mt-4 text-lg leading-8 text-[#4A463E]">{when}</p>
          </div>
          <ul className="space-y-2 text-sm text-[#4A463E]">
            {points.map((point) => (
              <li key={point} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-[#4F7A5B]" aria-hidden="true" />{point}</li>
            ))}
          </ul>
        </div>
        {diagram && <Diagram id={diagram} />}
        {children}
        {docs.length > 0 && <p className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {docs.map((doc) => (
            <Link key={doc.href} href={doc.href} className="inline-flex items-center gap-1 font-semibold text-[#8A6D45] hover:underline">{doc.label} <ArrowRight size={14} aria-hidden="true" /></Link>
          ))}
        </p>}
      </div>
    </section>
  )
}

function CloudCard({ id, href }: { id: string; href: string }) {
  const topology = getTopology(id)
  if (!topology) return null
  const items = topology.zones.flatMap((zone) => zone.items)
  return (
    <article className="flex flex-col rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF]/70 p-5">
      <h3 className="font-[family-name:var(--font-display)] text-xl font-bold">{topology.name.replace("Single cloud: ", "")}</h3>
      <p className="mt-1 text-sm leading-6 text-[#6E6759]">{topology.hosting}</p>
      <dl className="mt-4 flex-1 divide-y divide-[#1B1916]/[0.06] text-sm">
        {[...topology.builtIn, ...items].map((item) => (
          <div key={item.area} className="flex justify-between gap-4 py-1.5">
            <dt className="shrink-0 text-[#6E6759]">{AREA_LABEL[item.area]}</dt>
            <dd className="text-right font-medium text-[#1B1916]">{item.service}</dd>
          </div>
        ))}
      </dl>
      <Link href={href} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#8A6D45] hover:underline">The {topology.name.replace("Single cloud: ", "")} guide <ArrowRight size={14} aria-hidden="true" /></Link>
    </article>
  )
}

const BADGES = [
  { key: "onPrem", label: "On-prem" },
  { key: "aws", label: "AWS" },
  { key: "azure", label: "Azure" },
  { key: "gcp", label: "Google Cloud" },
] as const

export function DeployAnywherePage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${SITE_URL}/${DEPLOY_ANYWHERE.slug}#webpage`,
        url: `${SITE_URL}/${DEPLOY_ANYWHERE.slug}`,
        name: DEPLOY_ANYWHERE.title,
        description: DEPLOY_ANYWHERE.description,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${SITE_URL}/#software` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "UserTasks", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: DEPLOY_ANYWHERE.eyebrow, item: `${SITE_URL}/${DEPLOY_ANYWHERE.slug}` },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQS.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })),
      },
    ],
  }

  return (
    <div className="relative min-h-screen bg-[#FAF8F3] text-[#1B1916]" style={THEME}>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[#FAF8F3]" aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <MarketingHeader />

      <main>
        {/* Hero */}
        <section className="bg-[radial-gradient(circle_at_50%_0%,rgba(176,138,84,0.16),transparent_45%)]">
          <div className="mx-auto max-w-6xl px-4 pb-14 pt-12 sm:px-6 sm:pt-20">
            <nav aria-label="Breadcrumb" className="text-xs text-[#857D6D]"><Link href="/" className="hover:text-[#8A6D45]">UserTasks</Link><span className="px-2">/</span>{DEPLOY_ANYWHERE.eyebrow}</nav>
            <p className="mt-8 inline-flex items-center gap-2 rounded-full border border-[#8A6D45]/30 bg-[#B08A54]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#8A6D45]">
              <CloudCog size={13} aria-hidden="true" /> {DEPLOY_ANYWHERE.eyebrow}
            </p>
            <h1 className="mt-6 max-w-4xl font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl">
              Start on Supabase. Move each piece when you&rsquo;re ready.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-[#4A463E]">
              UserTasks splits its infrastructure into eleven areas — database, auth, storage, realtime, scheduler, email, secrets, KMS, cache, log export and directory sync — and each one has its own provider. Supabase is an excellent platform and our recommended way to run UserTasks: deploy on it with nothing else to configure. If you&rsquo;d like to use other services, move areas to <strong className="text-[#1B1916]">AWS</strong>, <strong className="text-[#1B1916]">Azure</strong>, <strong className="text-[#1B1916]">Google Cloud</strong> or <strong className="text-[#1B1916]">your own servers</strong> whenever you&rsquo;re ready, one checked, reversible switch at a time.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/docs/topologies" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#17150F] px-6 py-3 font-semibold text-[#FAF8F3] shadow-lg shadow-[#17150F]/20 hover:bg-[#2E2A24]">
                Choose your topology <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link href="/docs/quickstart/self-host" className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#1B1916]/15 px-6 py-3 font-medium text-[#33302A] hover:border-[#1B1916]/30">
                Self-host quickstart
              </Link>
            </div>
            <nav aria-label="Topologies on this page" className="mt-10">
              <ol className="flex flex-wrap gap-2">
                {NAV.map((item, index) => (
                  <li key={item.id}>
                    <a href={`#${item.id}`} className="inline-flex items-center gap-2 rounded-full border border-[#1B1916]/10 bg-[#FFFFFF]/70 px-3.5 py-1.5 text-sm font-medium text-[#33302A] hover:border-[#8A6D45]/40">
                      <span className="text-xs font-bold text-[#8A6D45]">0{index + 1}</span>{item.label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </div>
        </section>

        {/* The path */}
        <section className="border-t border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="The path every install takes" title="Zero configuration on day one. Your infrastructure on day ninety.">
              You never have to pick your final topology up front. Each area moves on its own, with the app running in between, so you can check every step before you take the next.
            </SectionHeading>
            <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start">
              <ol className="space-y-4">
                {STEPS.map((step, index) => (
                  <li key={step.title} className="flex gap-4 rounded-2xl border border-[#1B1916]/[0.08] bg-[#FAF8F3] p-5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#17150F] text-sm font-bold text-[#FAF8F3]">{index + 1}</span>
                    <div>
                      <h3 className="font-semibold">{step.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-[#4A463E]">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div>
                <Snippet code={SWITCH_SNIPPET} />
                <p className="mt-3 text-sm leading-6 text-[#6E6759]">
                  The same command for every area. <Link href="/docs/self-hosting/switching-providers" className="font-semibold text-[#8A6D45] hover:underline">How a switch runs</Link>
                </p>
              </div>
            </div>
          </div>
        </section>

        <TopologySection
          id="supabase" index={1} title="Supabase only"
          when="The default, and a complete topology in its own right: one Supabase project, Resend for email, and the app wherever you like to run Node.js."
          points={["Live in minutes — nothing beyond the app to operate", "Supabase handles database backups and failover", "Any area can move later, whenever you’re ready"]}
          diagram="supabase"
          docs={[{ href: "/docs/topologies/supabase", label: "Supabase only" }]}
        />

        <TopologySection
          id="hybrid" index={2} title="Hybrid: Supabase plus your cloud"
          when="Keep the Supabase database, and put the areas your security team cares about under your own account: files in your bucket, email from your domain, credentials in your vault, sign-in through your IdP."
          points={["Worked examples for AWS (S3, SES, Secrets Manager), Google Cloud (Cloud Storage, Cloud Scheduler, Secret Manager) and Azure (Blob, Entra ID, Communication Services, Key Vault)", "Native identities — task roles, managed identity, service accounts — instead of keys", "The most common place to stop"]}
          diagram="hybrid-aws"
          docs={[{ href: "/docs/topologies/hybrid", label: "Hybrid examples for AWS, Google Cloud and Azure" }]}
        />

        <TopologySection
          id="single-cloud" index={3} title="Single cloud: AWS, Azure or Google Cloud"
          when="One cloud for everything — one IAM model, one audit trail, one region. The database moves last, after auth, realtime and the scheduler."
          points={["AWS, Azure and Google Cloud reference profiles with smoke tests, plus Terraform and Bicep", "AWS with IAM everywhere: RDS and ElastiCache IAM auth, S3, SES, Secrets Manager, KMS, CloudWatch Logs", "Realtime and scheduling built into the app — no broker to run"]}
          docs={[]}
        >
          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            <CloudCard id="aws" href="/docs/topologies/aws" />
            <CloudCard id="azure" href="/docs/topologies/azure" />
            <CloudCard id="gcp" href="/docs/topologies/google-cloud" />
          </div>
        </TopologySection>

        <TopologySection
          id="multi-cloud" index={4} title="Multi-cloud"
          when="When the services you must use already live in different places. Every area is configured on its own, so any combination works — with a few rules that keep it fast."
          points={["Keep the app next to its database", "Keep secrets in the app’s cloud; other clouds’ keys become references", "Serve public files from the bucket or a CDN to avoid paying egress twice"]}
          diagram="multi-cloud"
          docs={[{ href: "/docs/topologies/multi-cloud", label: "Multi-cloud rules and example" }]}
        />

        <TopologySection
          id="on-premises" index={5} title="On-premises and air-gapped"
          when="Everything inside your network, with no SaaS and no outbound internet. The reference profile runs on a network with no route out, and its smoke test proves the app can’t reach the internet."
          points={["PostgreSQL, built-in auth with Keycloak or AD FS, MinIO, SMTP, Valkey", "Vault Transit for keys, syslog or Splunk for logs, LDAP for the directory", "Docker Compose or Kubernetes with the same image"]}
          diagram="on-prem"
          docs={[{ href: "/docs/topologies/on-premises", label: "On-premises and air-gapped" }, { href: "/on-premises-workflow-automation", label: "On-premises workflow automation" }]}
        />

        {/* Area grid */}
        <section id="areas" className="scroll-mt-8 border-t border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Eleven areas, one choice each" title="Pick the service for each area.">
              Each area is independent within a few rules — the database moves last, SSE realtime works with any database, files stored outside Supabase Storage become <code className="font-mono text-base">storage://</code> references. Provider names are shown as text; every option below exists today.
            </SectionHeading>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {AREAS.map((area) => {
                const has = (key: (typeof BADGES)[number]["key"]) => area.options.some((option) => option[key])
                return (
                  <Link key={area.id} href={area.docs} className="group flex flex-col rounded-2xl border border-[#1B1916]/[0.08] bg-[#FAF8F3] p-5 transition hover:border-[#8A6D45]/40 hover:shadow-md">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-lg font-semibold">{area.label}</h3>
                      {area.variable
                        ? <code className="truncate font-mono text-[11px] text-[#857D6D]">{area.variable}</code>
                        : <span className="text-[11px] text-[#857D6D]">per workspace</span>}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-[#4A463E]">{area.summary}</p>
                    <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={`${area.label} options`}>
                      {area.options.map((option) => (
                        <li key={option.name} className="rounded-md border border-[#1B1916]/[0.08] bg-[#FFFFFF] px-2 py-0.5 text-xs text-[#33302A]">{option.name}</li>
                      ))}
                    </ul>
                    <ul className="mt-4 flex flex-wrap gap-1.5 border-t border-[#1B1916]/[0.06] pt-3" aria-label="Runs on">
                      {BADGES.map((badge) => (
                        <li key={badge.key} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${has(badge.key) ? "border-[#4F7A5B]/30 bg-[#4F7A5B]/[0.08] text-[#35553F]" : "border-[#1B1916]/[0.08] text-[#857D6D]"}`}>
                          {has(badge.key) && <Check size={11} aria-hidden="true" />}{badge.label}{!has(badge.key) && <span className="sr-only"> (not available)</span>}
                        </li>
                      ))}
                    </ul>
                  </Link>
                )
              })}
            </div>
          </div>
        </section>

        {/* Safety */}
        <section className="border-t border-[#1B1916]/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="usertasks-admin switch" title="Every switch is checked, backed up and reversible." />
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {SAFETY.map(({ icon: Icon, title, body }) => (
                <article key={title} className="rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF]/60 p-5">
                  <Icon size={20} className="text-[#8A6D45]" aria-hidden="true" />
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-[#4A463E]">{body}</p>
                </article>
              ))}
            </div>
            <p className="mt-6 flex items-start gap-2 text-sm leading-6 text-[#4A463E]">
              <ShieldCheck size={16} className="mt-1 shrink-0 text-[#4F7A5B]" aria-hidden="true" />
              Release gates run the standalone, on-premises, Azure and Google Cloud profiles end to end, and a full move of a seeded Supabase install onto plain PostgreSQL — sign-in with migrated passwords, files, jobs, log export and the row-level security snapshot included.
            </p>
          </div>
        </section>

        {/* Fast execution */}
        <section className="border-y border-[#1B1916]/[0.07] bg-[#17150F] text-[#EDE8DC]">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:px-6 lg:grid-cols-[auto_1fr] lg:items-center">
            <Zap size={36} className="text-[#E2C9A0]" aria-hidden="true" />
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: "#FAF8F3" }}>The same fast execution engine, wherever it runs.</h2>
              <p className="mt-3 max-w-3xl leading-7 text-[#D8D1C2]">
                Topology changes the services around the engine, not the engine. Workflows, tasks, the API, the MCP server and the CLI behave identically on every one of them — keep the app next to its database and you keep the speed. <Link href="/docs/performance" className="font-semibold text-[#E2C9A0] hover:underline">How we measure it</Link>
              </p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
          <h2 className="text-center font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">Questions</h2>
          <div className="mt-8 space-y-3">
            {FAQS.map((faq) => (
              <details key={faq.question} className="group rounded-xl border border-[#1B1916]/[0.08] bg-[#F1EDE3] p-5">
                <summary className="cursor-pointer list-none font-semibold">{faq.question}</summary>
                <p className="mt-3 text-sm leading-7 text-[#6E6759]">{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="rounded-3xl border border-[#1B1916]/10 bg-gradient-to-br from-[#17150F]/[0.06] via-transparent to-[#B08A54]/[0.12] p-8 text-center sm:p-14">
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl">Find your topology in five questions.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-[#4A463E]">The decision guide maps your constraints — residency, one cloud, no internet, existing vendors — to a topology, with the switch sequence to get there from Supabase.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/docs/topologies" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#17150F] px-6 py-3 font-semibold text-[#FAF8F3] hover:bg-[#2E2A24]">Choose your topology <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link href="/docs/services" className="inline-flex items-center justify-center rounded-lg border border-[#1B1916]/15 px-6 py-3 font-medium text-[#33302A] hover:border-[#1B1916]/30">Choosing each service</Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
