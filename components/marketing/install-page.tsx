import type { CSSProperties } from "react"
import { ArchiveRestore, DownloadCloud, HardDrive, RefreshCw, ShieldCheck, Terminal, Trash2, Undo2 } from "lucide-react"
import { ProductHero } from "@/components/marketing/product-hero"
import { DocLinks, FaqList, FeatureCard, InlineCode, MarketingFooter, MarketingHeader, SectionHeading, Snippet } from "@/components/marketing/marketing-ui"

/**
 * /install — the one-line installer (deploy/install/install.sh, install.ps1,
 * served at /install.sh and /install.ps1) and the `usertasks` command it puts
 * on the server. Commands follow the self-hosting/install and upgrade docs
 * (lib/docs/content/self-hosting-guide.ts); keep them in step. Snippets hold
 * commands only (__tests__/shell-snippets.test.ts).
 */

const SITE_URL = "https://usertasks.com"

const THEME = {
  "--theme-card-bg": "var(--mkt-white)",
  "--theme-card-text": "var(--mkt-ink)",
  "--theme-surface": "var(--mkt-canvas)",
  "--theme-surface-border": "var(--mkt-line)",
  "--theme-muted-text": "var(--mkt-muted)",
} as CSSProperties

export const INSTALL_SH = "curl -fsSL https://usertasks.com/install.sh | sh"
export const INSTALL_PS1 = "irm https://usertasks.com/install.ps1 | iex"
const INSTALL_SH_OPTIONS = "curl -fsSL https://usertasks.com/install.sh | sh -s -- --port 8080 --dir /opt/usertasks --url https://tasks.example.com"
const INSTALL_PS1_OPTIONS = "& ([scriptblock]::Create((irm https://usertasks.com/install.ps1))) -Port 8080 -Dir C:\\UserTasks"
const MANAGE = `usertasks status
usertasks backup
usertasks upgrade`

const STEPS = [
  { title: "Checks the machine", body: "Linux or macOS (amd64 or arm64; Windows uses install.ps1), memory, disk space, and Docker with Compose 2.20 or later. No Docker? It says how to get it, and on common Linux distributions offers to install Docker Engine for you." },
  { title: "Downloads a signed release", body: "A small, versioned bundle: the Compose file, a settings template and the usertasks command. It checks the release signature and the checksum before running anything from it." },
  { title: "Pulls the published image", body: "ghcr.io/homepresso/usertasks, pinned to the exact image the release names. If it can't be downloaded, it can build the image locally instead (that needs about 10 GB of memory for Docker)." },
  { title: "Asks which services to use", body: "Everything in containers (the default), your own PostgreSQL, a Supabase project, or your own choice for each service. Then it writes .env with fresh secrets." },
  { title: "Starts UserTasks", body: "Applies the database migrations, starts the containers and waits until UserTasks answers." },
  { title: "Prints your setup code", body: "Open the address it prints, enter the setup code on the Create your admin account screen, and you're the owner. It opens your browser when it can." },
]

const COMMANDS = [
  { icon: Terminal, title: "usertasks status", body: "The version, the containers and their health, whether setup is done, and pending migrations." },
  { icon: HardDrive, title: "usertasks backup", body: "A database dump, the files and your .env (with ENCRYPTION_KEY) in one folder under backups/." },
  { icon: ArchiveRestore, title: "usertasks restore", body: "Puts a backup back: the database, the files and .env. It takes a fresh backup first." },
  { icon: RefreshCw, title: "usertasks upgrade", body: "Backs up, downloads and verifies the new release, applies the migrations, switches and checks it's healthy." },
  { icon: Undo2, title: "Automatic rollback", body: "If the new version doesn't come up, upgrade switches the code back to the version you had and says so." },
  { icon: Trash2, title: "usertasks uninstall", body: "Stops and removes UserTasks. Your data stays unless you add --purge and confirm." },
]

const FAQS = [
  { question: "Is it safe to pipe a script into my shell?", answer: "The installer is one function that only runs once it has fully downloaded, so a broken connection does nothing. Read it first if you prefer: download https://usertasks.com/install.sh, look through it, then run it with sh. Everything it downloads after that is checked against the release signature before it runs." },
  { question: "What does it need?", answer: "Linux or macOS with Docker (Docker Engine with the Compose plugin, or Docker Desktop), or Windows 10/11 with Docker Desktop and WSL 2. About 2 GB of memory for the containers (4 GB or more recommended) and 5 GB of disk." },
  { question: "Can I run it again?", answer: "Yes. It finds the existing install, keeps .env, its secrets and your data, and only starts anything that isn't running. To change the services later, run usertasks config." },
  { question: "How do I upgrade?", answer: "Run usertasks upgrade (or usertasks upgrade --to <version>). It backs up first, applies the migrations, switches to the new version, checks its health, and rolls the code back by itself if the new version doesn't start." },
  { question: "I already have the UserTasks CLI. Do the commands clash?", answer: "No. Server commands (status, logs, backup, restore, upgrade, config, uninstall, setup-code, admin) are handled on the server; anything else is passed to the CLI from npm if it's installed. If a usertasks command was already on your PATH, the installer leaves it alone and names this one usertasks-server." },
  { question: "Where are my files?", answer: "In the install folder: ~/usertasks (or /opt/usertasks when run as root; %USERPROFILE%\\usertasks on Windows). .env holds the secrets; back it up with the database. The data lives in Docker volumes named after the project." },
]

export function InstallPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "UserTasks", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Install", item: `${SITE_URL}/install` },
        ],
      },
      {
        "@type": "HowTo",
        name: "Install self-hosted UserTasks with one command",
        description: "Run the one-line installer on a machine with Docker, open the address it prints and create your admin account with the setup code.",
        totalTime: "PT10M",
        tool: ["Docker"],
        step: [
          { "@type": "HowToStep", name: "Install Docker", text: "Docker Engine with the Compose plugin on Linux, or Docker Desktop on macOS and Windows." },
          { "@type": "HowToStep", name: "Run the installer", text: `Linux and macOS: ${INSTALL_SH}. Windows PowerShell: ${INSTALL_PS1}.` },
          { "@type": "HowToStep", name: "Choose your services", text: "Everything in containers, your own PostgreSQL, a Supabase project, or custom." },
          { "@type": "HowToStep", name: "Create your admin account", text: "Open the address it prints and enter the setup code it shows." },
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
          crumb="Install"
          eyebrow="Self-hosted · Docker"
          icon={DownloadCloud}
          title={<>Install UserTasks <span className="mkt-gradient-text">with one command.</span></>}
          intro={<>On any machine with Docker: the installer checks it, downloads a <strong className="text-white">signed release</strong>, asks which services to use, starts everything and prints your setup code. Then <InlineCode>usertasks upgrade</InlineCode> keeps it current.</>}
          primary={{ href: "#install", label: "Install now" }}
          secondary={{ href: "#manage", label: "Upgrade and back up" }}
          bullets={["Linux, macOS and Windows", "Signed, pinned releases", "Safe to run again"]}
        />

        <section id="install" className="scroll-mt-24 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Install" title="Paste one line into a terminal">
              Start Docker first. The installer asks a few questions; press Enter to accept the defaults.
            </SectionHeading>
            <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <article className="flex min-w-0 flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-6">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-(color:--mkt-bronze)">Linux and macOS</p>
                <div className="mt-4 min-w-0"><Snippet code={INSTALL_SH} /></div>
                <p className="mt-4 text-sm leading-6 text-(color:--mkt-text)">With options: another port, folder or public address. <InlineCode>--non-interactive</InlineCode> takes the defaults; <InlineCode>--version</InlineCode> pins a release.</p>
                <div className="mt-3 min-w-0"><Snippet code={INSTALL_SH_OPTIONS} /></div>
              </article>
              <article className="flex min-w-0 flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-6">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-(color:--mkt-bronze)">Windows (PowerShell, Docker Desktop)</p>
                <div className="mt-4 min-w-0"><Snippet code={INSTALL_PS1} language="powershell" /></div>
                <p className="mt-4 text-sm leading-6 text-(color:--mkt-text)">Docker Desktop must use the WSL 2 backend and Linux containers. With options:</p>
                <div className="mt-3 min-w-0"><Snippet code={INSTALL_PS1_OPTIONS} language="powershell" /></div>
              </article>
            </div>
            <ol className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {STEPS.map((step, index) => (
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
              { href: "/docs/self-hosting/install#one-line-installer", label: "Install step by step" },
              { href: "/docs/self-hosting/requirements", label: "Requirements" },
              { href: "/docs/self-hosting/admin-account", label: "Create your admin account" },
              { href: "/docs/self-hosting/friendly-address", label: "HTTPS and a friendly address" },
            ]} />
          </div>
        </section>

        <section id="manage" className="scroll-mt-24 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="After the install" title="One command to run it">
              The installer puts a <InlineCode>usertasks</InlineCode> command on the server for everyday care.
            </SectionHeading>
            <div className="mt-8 max-w-xl"><Snippet code={MANAGE} /></div>
            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {COMMANDS.map((item) => <FeatureCard key={item.title} icon={item.icon} title={item.title}>{item.body}</FeatureCard>)}
            </div>
            <div className="mt-10 grid grid-cols-1 gap-4">
              <FeatureCard icon={ShieldCheck} title="Verified downloads">Every release lists its files in SHA256SUMS, signed with the UserTasks release key (and with Sigstore). The installer and usertasks upgrade refuse anything that doesn&rsquo;t match, and the release pins the exact image digest.</FeatureCard>
            </div>
            <DocLinks links={[
              { href: "/docs/self-hosting/upgrade", label: "Upgrade to a new release" },
              { href: "/docs/self-hosting/updates-and-backups", label: "Backups" },
              { href: "/docs/self-hosting/switching-providers", label: "Switch services later" },
              { href: "/docs/self-hosting/choose", label: "Other ways to run it" },
            ]} />
          </div>
        </section>

        <FaqList faqs={FAQS} />
      </main>

      <MarketingFooter />
    </div>
  )
}
