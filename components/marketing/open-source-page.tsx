import Link from "next/link"
import type { CSSProperties, ReactNode } from "react"
import { ArrowRight, Boxes, Code2, Eye, GitBranch, KeyRound, LifeBuoy, Scale, ShieldCheck, Terminal, Users } from "lucide-react"
import { ProductHero } from "@/components/marketing/product-hero"
import { DocLinks, FaqList, FeatureCard, InlineCode, MarketingFooter, MarketingHeader, SectionHeading, Snippet } from "@/components/marketing/marketing-ui"
import { CLI_PACKAGE, repositoryUrl, SOURCE_RELEASE_NOTE } from "@/lib/site-links"
import { DOCKER_BUILD_MEMORY_GB } from "@/lib/docker-build-memory"

/**
 * /open-source — the licence, the repository and how to get UserTasks running
 * on your own machine: a beginner's step-by-step guide (npm run setup:local,
 * scripts/setup-local.ts), then the two ways to run it (from source with a
 * local Supabase, or the standalone Docker stack) and the optional CLI, which
 * only talks to a running server. Commands follow README.md "Quick start",
 * the self-hosting/quick-start doc and docs/deployment-profiles.md; keep them
 * in step.
 */

const SITE_URL = "https://usertasks.com"

const THEME = {
  "--theme-card-bg": "var(--mkt-white)",
  "--theme-card-text": "var(--mkt-ink)",
  "--theme-surface": "var(--mkt-canvas)",
  "--theme-surface-border": "var(--mkt-line)",
  "--theme-muted-text": "var(--mkt-muted)",
} as CSSProperties

const DOCKER_DESKTOP_URL = "https://www.docker.com/products/docker-desktop/"

// Copyable snippets hold commands only: an interactive zsh (the macOS
// default) runs a pasted `# comment` as a command. Explanations go in the
// text around them (__tests__/shell-snippets.test.ts checks).
const FROM_SOURCE = (repo: string) => `git clone ${repo}.git usertasks
cd usertasks
npm run setup:local
npm run dev`

const BY_HAND = `npm install
npx supabase start
npx supabase status -o env
cp .env.example .env.local
npm run dev`

const STANDALONE = (repo: string) => `git clone ${repo}.git usertasks
cd usertasks
npm install
npm run stack -- up --email you@example.com --org "Acme Inc"`

const CLI = `npm install -g ${CLI_PACKAGE}
usertasks login
usertasks workflows list`

/** The beginner guide's commands, one per snippet (each copy button copies one thing). */
const BEGINNER = {
  clone: (repo: string) => `git clone ${repo}.git usertasks`,
  cd: "cd usertasks",
  setup: "npm run setup:local",
  dev: "npm run dev",
  stopDb: "npx supabase stop",
  startDb: "npx supabase start",
}

const FIRST_RUN = [
  { title: "Open http://localhost:3000", body: "A new install takes you straight to the Create your admin account screen." },
  { title: "Enter the setup code", body: "It's printed in the terminal running UserTasks as \"UserTasks setup code: XXXX-XXXX-XXXX\". Lost it? Run npm run setup-code." },
  { title: "Name your organisation and sign in", body: "You become its owner and land on the getting-started guide. The setup screen then disappears for good." },
  { title: "Invite your team", body: "Add people from Settings → Members & invites, or connect SSO, LDAP or SCIM. Self-hosted installs are invite-only." },
]

const IN_THE_REPO = [
  { icon: Code2, title: "The whole app", body: "Workflow engine, form designer, tasks, data tables, reports, the Agent and the REST API — the same code that runs usertasks.com." },
  { icon: Terminal, title: "CLI and SDK", body: "@user-tasks/cli and @user-tasks/sdk (TypeScript), plus usertasks-admin for installs, migrations and provider switches." },
  { icon: Boxes, title: "Deployments", body: "Docker Compose profiles, a Helm chart for Kubernetes, cloud templates and the signed air-gapped bundle." },
  { icon: KeyRound, title: "Extension kits", body: "Starter kits for custom workflow actions and form controls, and the sources of the gallery's official packages." },
]

const FAQS = [
  { question: "Is UserTasks really open source?", answer: "Yes. The whole platform is licensed under Apache-2.0: you can run it, change it and ship it, commercially or not. The cloud edition at usertasks.com runs the same code and is free during the beta." },
  { question: "What do I need to run it locally?", answer: "Git, Node.js 22 LTS (20.9 or later works) and Docker Desktop. From source, npm run setup:local starts the local Supabase in Docker and writes your settings; the standalone stack runs PostgreSQL, storage and the scheduler in Docker with no Supabase. Everything runs on Windows, macOS and Linux." },
  { question: "Does the CLI install UserTasks?", answer: "No. The CLI (@user-tasks/cli) is a remote control: it talks to a UserTasks server that is already running — your local one at http://localhost:3000, your company's server, or usertasks.com. It doesn't install a server, a database or Supabase. To run UserTasks itself, use npm run setup:local (from source) or npm run stack -- up (all in Docker)." },
  { question: "Do I need Supabase?", answer: "No. Supabase is the default and our recommended way to run UserTasks, but the standalone stack uses plain PostgreSQL, S3-compatible storage and built-in sign-in, and each area can be moved to AWS, Azure, Google Cloud or your own servers later." },
  { question: "How do I create the first account?", answer: "Open http://localhost:3000 and fill in Create your admin account with the setup code printed in the terminal. Scripts can use npm run bootstrap instead. After that, people join by invitation or through your SSO." },
  { question: "How do I contribute or report a security issue?", answer: "Open an issue or a pull request on GitHub; CONTRIBUTING.md explains the workflow and the checks. Report security issues privately as described in SECURITY.md, not in public issues." },
]

export function OpenSourcePage() {
  // NEXT_PUBLIC_REPOSITORY_URL (lib/site-links): while unset, no repository links are shown.
  const repoUrl = repositoryUrl()
  const repo = repoUrl ?? "<repository-url>"
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "UserTasks", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Open source", item: `${SITE_URL}/open-source` },
        ],
      },
      {
        "@type": "HowTo",
        name: "Install and start UserTasks on your computer",
        description: "A step-by-step guide for first-timers: install Git, Node.js and Docker Desktop, copy UserTasks, run npm run setup:local and npm run dev, then create your admin account with the setup code.",
        totalTime: "PT30M",
        tool: ["Git", "Node.js 22 LTS", "Docker Desktop"],
        step: [
          { "@type": "HowToStep", name: "Install three things", text: "Install Git (git-scm.com), Node.js LTS (nodejs.org) and Docker Desktop (docker.com). Restart your computer if Docker asks; on Windows, turn on WSL 2 if Docker Desktop asks." },
          { "@type": "HowToStep", name: "Open a terminal", text: "Windows: PowerShell from the Start menu. macOS: Terminal from Spotlight. Linux: your Terminal app." },
          { "@type": "HowToStep", name: "Copy UserTasks to your computer", text: `git clone ${repo}.git usertasks, then cd usertasks.` },
          { "@type": "HowToStep", name: "Set everything up", text: "npm run setup:local. It installs the packages, starts the local database in Docker and writes your settings. The first time takes a few minutes." },
          { "@type": "HowToStep", name: "Start it", text: "npm run dev. Wait for Ready and the line UserTasks setup code: XXXX-XXXX-XXXX." },
          { "@type": "HowToStep", name: "Create your admin account", text: "Open http://localhost:3000 and fill in Create your admin account with the setup code." },
          { "@type": "HowToStep", name: "Stop and start again", text: "To stop: Ctrl+C, then npx supabase stop. To start again: npx supabase start, then npm run dev. Your data is kept." },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQS.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })),
      },
    ],
  }

  return (
    <div className="mkt relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)" style={THEME}>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-(color:--mkt-paper)" aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <MarketingHeader tone="night" />

      <main>
        <ProductHero
          crumb="Open source"
          eyebrow="Open source · Apache-2.0"
          icon={GitBranch}
          title={<>The open source process platform. <span className="mkt-gradient-text">Running on your laptop in minutes.</span></>}
          intro={<>Every part of UserTasks — the workflow engine, forms, tasks, data, reports, the Agent, the API, the CLI — is open source under <strong className="text-white">Apache-2.0</strong>. Clone it from GitHub, run it on your own machine, and take it to Docker, Kubernetes or an air-gapped network when you&rsquo;re ready.</>}
          primary={repoUrl ? { href: repoUrl, label: "View on GitHub" } : { href: "#get-started", label: "Ways to run it" }}
          secondary={{ href: "#first-time", label: "Step-by-step install" }}
          bullets={["Apache-2.0 licence", "Runs on Windows, macOS and Linux", "Same code as usertasks.com"]}
        />

        {/* Beginner guide */}
        <section id="first-time" className="scroll-mt-24 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Step by step" title="Never done this before? Follow these steps">
              About half an hour, most of it waiting for downloads. You&rsquo;ll type a few commands into a <strong>terminal</strong>: a window where you type instructions instead of clicking. Each dark box below holds one command. Press its <strong>Copy</strong> button, paste it into the terminal, and press Enter.
            </SectionHeading>

            <ol className="mt-10 space-y-5">
              <BeginnerStep n={1} title="Install three things" see={<>Docker Desktop opens and, after a minute, says <strong>Engine running</strong>. Leave it open while you use UserTasks.</>}>
                <p>Download and install each one, accepting the default options:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li><ExtLink href="https://git-scm.com/downloads">Git</ExtLink>: copies UserTasks to your computer.</li>
                  <li><ExtLink href="https://nodejs.org/">Node.js</ExtLink>, the <strong>LTS</strong> version (22 or later): runs UserTasks.</li>
                  <li><ExtLink href={DOCKER_DESKTOP_URL}>Docker Desktop</ExtLink>: runs the database in the background.</li>
                </ul>
                <p className="mt-2">Restart your computer if Docker asks. On Windows, if Docker Desktop asks to turn on <strong>WSL 2</strong> (a Windows feature it needs), say yes.</p>
              </BeginnerStep>

              <BeginnerStep n={2} title="Open a terminal" see={<>A window with a blinking cursor. Type <InlineCode>node --version</InlineCode> and press Enter: you should see <InlineCode>v22…</InlineCode> or <InlineCode>v24…</InlineCode> (22 or higher; 20.9 still works, with a warning from one package). &ldquo;Not recognized&rdquo; or &ldquo;command not found&rdquo;? Close the terminal and open a new one; installers only reach new windows.</>}>
                <ul className="list-disc space-y-1 pl-5">
                  <li><strong>Windows:</strong> open the Start menu, type <em>PowerShell</em> and open <strong>Windows PowerShell</strong>.</li>
                  <li><strong>macOS:</strong> press <kbd className="font-mono text-[0.9em]">⌘ Space</kbd>, type <em>Terminal</em> and press Enter.</li>
                  <li><strong>Linux:</strong> open <strong>Terminal</strong> from your apps (often <kbd className="font-mono text-[0.9em]">Ctrl+Alt+T</kbd>).</li>
                </ul>
              </BeginnerStep>

              <BeginnerStep n={3} title="Copy UserTasks to your computer" see={<>&ldquo;Cloning into &lsquo;usertasks&rsquo;&hellip;&rdquo;, then the prompt comes back. After <InlineCode>cd usertasks</InlineCode>, the prompt ends in <InlineCode>usertasks</InlineCode>: you&rsquo;re in the UserTasks folder. Run every later command from here.</>}>
                <p>This makes a <InlineCode>usertasks</InlineCode> folder in your home folder. Then go into it (<InlineCode>cd</InlineCode> means &ldquo;change folder&rdquo;):</p>
                <div className="mt-3 space-y-2"><Snippet code={BEGINNER.clone(repo)} /><Snippet code={BEGINNER.cd} /></div>
              </BeginnerStep>

              <BeginnerStep n={4} title="Set everything up" see={<>Steps <InlineCode>[1/7]</InlineCode> to <InlineCode>[7/7]</InlineCode>, then <strong>All set.</strong> If it stops, it says what to fix in plain English. Fix it and run the same command again: it&rsquo;s safe to repeat.</>}>
                <p>One command installs the packages, starts the database in Docker, and writes your settings file (<InlineCode>.env.local</InlineCode>) with fresh keys. It takes a few minutes the first time.</p>
                <div className="mt-3"><Snippet code={BEGINNER.setup} /></div>
              </BeginnerStep>

              <BeginnerStep n={5} title="Start it" see={<>After a few seconds, <strong>Ready</strong>, and a line like <InlineCode>UserTasks setup code: XXXX-XXXX-XXXX</InlineCode>. Keep this window open: closing it stops UserTasks.</>}>
                <div><Snippet code={BEGINNER.dev} /></div>
              </BeginnerStep>

              <BeginnerStep n={6} title="Open http://localhost:3000 in your browser" see={<>The <strong>Create your admin account</strong> screen. Enter your organisation&rsquo;s name, your name, email and a password, and the setup code from step 5.</>}>
                <p>Type <InlineCode>http://localhost:3000</InlineCode> into the address bar of Chrome, Edge, Firefox or Safari. &ldquo;localhost&rdquo; means &ldquo;this computer&rdquo;: nothing is on the internet.</p>
              </BeginnerStep>

              <BeginnerStep n={7} title="You're in" see={<>The getting-started checklist, with a button for each first step.</>}>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Follow the <Link href="/docs/quickstart/cloud#the-getting-started-guide" className="font-semibold text-(color:--mkt-bronze) hover:underline">getting-started guide</Link>.</li>
                  <li>Install a ready-made solution from the <Link href="/gallery" className="font-semibold text-(color:--mkt-bronze) hover:underline">Gallery</Link>.</li>
                  <li><Link href="/docs/self-hosting/invite-people" className="font-semibold text-(color:--mkt-bronze) hover:underline">Invite people</Link> from Settings → Members &amp; invites.</li>
                  <li>Optional: drive it from the terminal with the <a href="#cli" className="font-semibold text-(color:--mkt-bronze) hover:underline">UserTasks CLI</a>.</li>
                </ul>
              </BeginnerStep>

              <BeginnerStep n={8} title="Stopping and starting again" see={<>Everything you made is still there next time: your data is kept between restarts.</>}>
                <p><strong>To stop:</strong> click the terminal running UserTasks and press <kbd className="font-mono text-[0.9em]">Ctrl+C</kbd>, then stop the database:</p>
                <div className="mt-2"><Snippet code={BEGINNER.stopDb} /></div>
                <p className="mt-4"><strong>To start again:</strong> open Docker Desktop, open a terminal, <InlineCode>cd usertasks</InlineCode>, then run these one after the other:</p>
                <div className="mt-2 space-y-2"><Snippet code={BEGINNER.startDb} /><Snippet code={BEGINNER.dev} /></div>
              </BeginnerStep>
            </ol>

            <aside className="mt-8 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/80 p-5 sm:p-6" aria-labelledby="if-something-goes-wrong">
              <h3 id="if-something-goes-wrong" className="flex items-center gap-2 font-semibold"><LifeBuoy size={18} aria-hidden="true" className="text-(color:--mkt-bronze)" /> If something goes wrong</h3>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-(color:--mkt-text)">
                <li><strong>&ldquo;Docker isn&rsquo;t running&rdquo;:</strong> open Docker Desktop, wait for <em>Engine running</em>, and run the command again.</li>
                <li><strong>Port 3000 is already in use:</strong> another program (often a second <InlineCode>npm run dev</InlineCode>) is using it. Close that terminal window, or restart your computer, and try again.</li>
                <li><strong>&ldquo;Could not read package.json&rdquo;:</strong> you&rsquo;re in the wrong folder. Run <InlineCode>cd usertasks</InlineCode> first.</li>
                <li><strong>&ldquo;zsh: command not found: #&rdquo; or &ldquo;bad pattern: #&rdquo;:</strong> the Mac&rsquo;s terminal doesn&rsquo;t accept <InlineCode>#</InlineCode> comments when you paste them. Paste one command at a time, without anything after a <InlineCode>#</InlineCode>, or run <InlineCode>setopt interactive_comments</InlineCode> first.</li>
                <li><strong>&ldquo;npm warn EBADENGINE&rdquo; mentioning <InlineCode>node &gt;=22</InlineCode>:</strong> a warning, not an error: your Node.js is older than 22. UserTasks still runs on 20.9 or later, but install the Node.js 22 LTS when you can.</li>
                <li><strong>Lost the setup code:</strong> in the UserTasks folder, run <InlineCode>npm run setup-code</InlineCode> for a new one.</li>
              </ul>
              <DocLinks links={[
                { href: "/docs/self-hosting/troubleshooting", label: "More fixes (incl. Windows)" },
                { href: "/docs/self-hosting/quick-start", label: "This guide, with more detail" },
              ]} />
            </aside>
          </div>
        </section>

        {/* Get started */}
        <section id="get-started" className="scroll-mt-24 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Get started" title="Two ways to run it">
              You need Git, Node.js 22 LTS (20.9 or later works) and Docker. Pick the path that suits you; you can change your mind later. Paste one command at a time if your terminal complains.
            </SectionHeading>

            <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <article className="flex min-w-0 flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-6">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-(color:--mkt-bronze)">1 · From source</p>
                <h3 className="mt-2 text-xl font-semibold">Clone the repository and run it with Supabase</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">The recommended way to try UserTasks and to contribute. <InlineCode>npm run setup:local</InlineCode> starts Supabase in Docker (the database, sign-in and file storage), builds the database and writes <InlineCode>.env.local</InlineCode> with fresh secrets.</p>
                <div className="mt-4 min-w-0"><Snippet code={FROM_SOURCE(repo)} /></div>
                <p className="mt-3 text-sm leading-6 text-(color:--mkt-text)"><InlineCode>npm run setup:local</InlineCode> sets up Supabase, the database and <InlineCode>.env.local</InlineCode>; <InlineCode>npm run dev</InlineCode> then serves UserTasks at <InlineCode>http://localhost:3000</InlineCode>. The lightest way to run it on a laptop.</p>
                <details className="group mt-4 text-sm">
                  <summary className="cursor-pointer font-semibold text-(color:--mkt-bronze) hover:underline">Prefer to do it by hand?</summary>
                  <p className="mt-2 leading-6 text-(color:--mkt-text)">The same steps, one at a time. <InlineCode>supabase/config.toml</InlineCode> is in the repository, so there&rsquo;s no <InlineCode>supabase init</InlineCode>.</p>
                  <div className="mt-3 min-w-0"><Snippet code={BY_HAND} /></div>
                  <p className="mt-3 leading-6 text-(color:--mkt-text)"><InlineCode>npx supabase start</InlineCode> applies <InlineCode>supabase/migrations</InlineCode>, and <InlineCode>npx supabase status -o env</InlineCode> prints <InlineCode>API_URL</InlineCode>, <InlineCode>ANON_KEY</InlineCode> and <InlineCode>SERVICE_ROLE_KEY</InlineCode>: paste those three into <InlineCode>.env.local</InlineCode> before <InlineCode>npm run dev</InlineCode>, with <InlineCode>ENCRYPTION_KEY</InlineCode> set to the output of <InlineCode>openssl rand -base64 32</InlineCode> and <InlineCode>CRON_SECRET</InlineCode> to that of <InlineCode>openssl rand -hex 32</InlineCode>.</p>
                </details>
              </article>

              <article className="flex min-w-0 flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-6">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-(color:--mkt-bronze)">2 · All in Docker</p>
                <h3 className="mt-2 text-xl font-semibold">One command, no Supabase</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">The standalone stack: PostgreSQL, S3-compatible storage, the scheduler, a mail catcher and the app, all in Docker with no Supabase, and fresh secrets written for you. It creates the first workspace too.</p>
                <div className="mt-4 min-w-0"><Snippet code={STANDALONE(repo)} /></div>
                <p className="mt-3 text-sm leading-6 text-(color:--mkt-text)">When it finishes, open <InlineCode>http://localhost:3000</InlineCode> and sign in with that email. The generated password is saved in <InlineCode>.usertasks-first-login</InlineCode> in the folder.</p>
                <p className="mt-3 rounded-lg border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 px-3 py-2 text-sm leading-6 text-(color:--mkt-text)"><strong>Before you start:</strong> it uses the ready-made app image for this version when one has been published, a download with no build and no extra memory needed. Otherwise it builds the image on your machine, which needs about {DOCKER_BUILD_MEMORY_GB} GB of memory for Docker (Docker Desktop → Settings → Resources → Memory) and takes a while the first time (10 to 20 minutes). On a laptop without a published image, From source is lighter.</p>
              </article>
            </div>

            <article id="cli" className="mt-6 grid min-w-0 scroll-mt-24 grid-cols-1 gap-6 rounded-2xl border border-dashed border-(color:--mkt-ink)/[0.14] bg-(color:--mkt-paper)/60 p-6 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-(color:--mkt-bronze)">Optional · The CLI from npm</p>
                <h3 className="mt-2 text-xl font-semibold">Then drive it from the terminal</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)"><InlineCode>{CLI_PACKAGE}</InlineCode> is a remote control, not an installer: it needs a UserTasks server that&rsquo;s already running, and it doesn&rsquo;t install a server, a database or Supabase. Point it at your local install (<InlineCode>http://localhost:3000</InlineCode>, the default), your company&rsquo;s server, or usertasks.com. Logging in opens your browser; on machines without one, use <InlineCode>usertasks login --api-key</InlineCode>.</p>
              </div>
              <div className="min-w-0">
                <Snippet code={CLI} />
                <p className="mt-3 text-sm leading-6 text-(color:--mkt-text)"><InlineCode>usertasks login</InlineCode> signs in to your local install at <InlineCode>http://localhost:3000</InlineCode>; for any other server, add its address: <InlineCode>usertasks login --url https://tasks.example.com</InlineCode>.</p>
              </div>
            </article>

            <DocLinks links={[
              { href: "/docs/self-hosting/install", label: "Step-by-step install guide" },
              { href: "/docs/self-hosting/requirements", label: "Requirements" },
              { href: "/docs/self-hosting/troubleshooting", label: "Troubleshooting (incl. Windows)" },
              { href: "/docs/self-hosting/cli", label: "Use the CLI with your server" },
            ]} />
          </div>
        </section>

        {/* First run */}
        <section className="relative">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="First sign-in" title="Create your admin account in the browser">
              A new install has no accounts and no sign-up page. The first person to open it, with the one-time setup code, becomes the owner.
            </SectionHeading>
            <ol className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FIRST_RUN.map((step, index) => (
                <li key={step.title} className="flex gap-4 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/80 p-5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(color:--mkt-primary) text-sm font-bold text-(color:--mkt-paper)">{index + 1}</span>
                  <div className="min-w-0">
                    <h3 className="font-semibold">{step.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <DocLinks links={[
              { href: "/docs/self-hosting/admin-account", label: "Create your admin account" },
              { href: "/docs/self-hosting/invite-people", label: "Invite people and connect SSO" },
              { href: "/docs/self-hosting/local-to-supabase-cloud", label: "Move to Supabase Cloud" },
              { href: "/docs/self-hosting/friendly-address", label: "Give it a friendly address" },
            ]} />
          </div>
        </section>

        {/* What's in the repository */}
        <section className="border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="On GitHub" title="What's in the repository">
              One repository, one licence, the same code that runs usertasks.com.
            </SectionHeading>
            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {IN_THE_REPO.map((item) => <FeatureCard key={item.title} icon={item.icon} title={item.title}>{item.body}</FeatureCard>)}
            </div>
            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FeatureCard icon={Scale} title="Apache-2.0">Use it, change it and ship it, commercially or not. Keep the licence and notices.</FeatureCard>
              <FeatureCard icon={Users} title="Contribute">Issues and pull requests are welcome. CONTRIBUTING.md explains the checks every change runs.</FeatureCard>
              <FeatureCard icon={ShieldCheck} title="Report a vulnerability">Please report security issues privately, as described in SECURITY.md.</FeatureCard>
            </div>
            <p className="mt-8">
              {repoUrl ? (
                <Link href={repoUrl} className="inline-flex items-center gap-2 rounded-lg bg-(color:--mkt-primary) px-6 py-3 font-semibold text-(color:--mkt-paper) hover:bg-(color:--mkt-primary-hover)">
                  Open the repository <ArrowRight size={16} aria-hidden="true" />
                </Link>
              ) : (
                <span className="text-sm text-(color:--mkt-muted)">{SOURCE_RELEASE_NOTE}</span>
              )}
            </p>
          </div>
        </section>

        <FaqList faqs={FAQS} />
      </main>

      <MarketingFooter />
    </div>
  )
}

/** One step of the beginner guide: what to do, then what you'll see. */
function BeginnerStep({ n, title, see, children }: { n: number; title: string; see: ReactNode; children?: ReactNode }) {
  return (
    <li className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/80 p-4 sm:p-6">
      <div className="flex items-center gap-3 sm:gap-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(color:--mkt-primary) text-sm font-bold text-(color:--mkt-paper)" aria-hidden="true">{n}</span>
        <h3 className="text-lg font-semibold leading-6"><span className="sr-only">Step {n}: </span>{title}</h3>
      </div>
      {/* Full width on phones (snippets need the room); indented under the title from sm up. */}
      <div className="min-w-0 sm:pl-12">
        {children && <div className="mt-3 text-[0.95rem] leading-7 text-(color:--mkt-text)">{children}</div>}
        <p className="mt-4 flex gap-2 rounded-xl bg-(color:--mkt-canvas) px-3 py-2.5 text-sm leading-6 text-(color:--mkt-text)">
          <Eye size={16} aria-hidden="true" className="mt-1 shrink-0 text-(color:--mkt-bronze)" />
          <span><strong className="text-(color:--mkt-ink)">What you&rsquo;ll see:</strong> {see}</span>
        </p>
      </div>
    </li>
  )
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-(color:--mkt-bronze) underline-offset-2 hover:underline">{children}</a>
}
