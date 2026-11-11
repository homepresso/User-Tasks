import type { CSSProperties } from "react"
import Image, { type StaticImageData } from "next/image"
import Link from "next/link"
import {
  ArrowRight,
  Ban,
  Bot,
  Check,
  CircleCheck,
  FileInput,
  FileLock2,
  Gauge,
  History,
  KeyRound,
  ListChecks,
  MousePointerClick,
  PenTool,
  Receipt,
  Route,
  Server,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react"
import { ProductHero } from "@/components/marketing/product-hero"
import { DocLinks, FaqList, FeatureCard, MarketingFooter, MarketingHeader, Pill, SectionHeading } from "@/components/marketing/marketing-ui"
import { ScreenshotFrame } from "@/components/marketing/screenshot-frame"
import { ASSISTANT_PROVIDERS, PROVIDER_PRESETS } from "@/lib/assistants/types"
import { AI_ASSISTANTS_PAGE } from "@/lib/marketing-pages"
import assistantForm from "@/public/screenshots/assistant-form.webp"
import assistantFormPhone from "@/public/screenshots/assistant-form-phone.webp"
import assistantTask from "@/public/screenshots/assistant-task.webp"
import assistantDesigner from "@/public/screenshots/assistant-designer.webp"
import assistantPlan from "@/public/screenshots/assistant-plan.webp"

/**
 * /ai-assistants — Agent, the one in-app AI panel (lib/assistants,
 * components/assistants): its abilities follow the screen (forms, tasks,
 * builders) and the person's permissions. Distinct from workflow Agents
 * (/connectors#ai). Facts follow /docs/ai-assistants; the provider list is
 * generated from lib/assistants/types.ts. Screenshots are real captures of
 * the app (local stack, scripted model replies) with the Agent panel's
 * title and context chip. Server-rendered.
 */

const SITE_URL = "https://usertasks.com"
const SETUP = "/docs/ai-assistants"
const USING = "/docs/ai-assistants/using"

const THEME = {
  "--theme-card-bg": "var(--mkt-white)",
  "--theme-card-text": "var(--mkt-ink)",
  "--theme-surface": "var(--mkt-canvas)",
  "--theme-surface-border": "var(--mkt-line)",
  "--theme-muted-text": "var(--mkt-muted)",
} as CSSProperties

/** "OpenAI, Anthropic Claude, …, Ollama and OpenAI-compatible" from the settings page's own list. */
const PROVIDER_LABELS = ASSISTANT_PROVIDERS.map((id) => PROVIDER_PRESETS[id].label)
const PROVIDER_SENTENCE = `${PROVIDER_LABELS.slice(0, -1).join(", ")} or any OpenAI-compatible server`

const ABILITIES = [
  { icon: FileInput, title: "Fill forms", where: "On a form", body: "Answers questions about the form, explains validation errors and proposes field values. The person previews them and clicks Apply or Apply all.", never: "Never submits the form.", href: "#forms" },
  { icon: ListChecks, title: "Work tasks", where: "On a task", body: "Summarises a task and its history, explains what each outcome means, drafts comments, and approves or completes a task when asked.", never: "Never acts without your confirmation.", href: "#tasks" },
  { icon: PenTool, title: "Build", where: "In the builders", body: "Designs workflows, forms, data tables, decision tables, reports and agents with you, reading what you have open and proposing changes.", never: "A confirmation card before every change.", href: "#build" },
]

const FAQS = [
  { question: "Which AI providers can Agent use?", answer: `${PROVIDER_SENTENCE} (vLLM, LiteLLM, a gateway). The model must support tool calling. Choose the provider in Settings and enter your own API key, or reuse an AI connection your workflow agents already have.` },
  { question: "Can I use a model running on my own servers?", answer: "Yes. Choose Ollama or OpenAI-compatible and enter its address. A self-hosted UserTasks instance that reaches a model server on its own network sets ALLOW_PRIVATE_EGRESS=true, because base URLs pass the same egress checks as connectors." },
  { question: "Where is the API key kept?", answer: "Encrypted at rest with the instance's encryption key. It is never returned to the browser, never logged and never audited; the settings page shows only its last four characters. Settings changes and connection tests are audited." },
  { question: "What is sent to the provider?", answer: "What the person types, plus what is on their screen: the visible fields and values of the form they are filling, the task's details and comments as they can see them, or the item open in the designer. Hidden fields are left out and secret fields such as passwords, tokens and keys are never sent." },
  { question: "Can Agent see or do more than the person using it?", answer: "No. It acts only with the signed-in person's permissions, so it cannot see what they could not see, and its abilities on each screen follow those permissions. It has no tools to submit forms, complete tasks, publish, delete or change settings." },
  { question: "What stops a form or task from instructing Agent?", answer: "Form and task content is treated as untrusted input. It goes into a clearly marked data block in the person's message, never into the system instructions, and Agent is told not to follow instructions found inside it. Tool results are marked the same way." },
  { question: "Does the conversation follow me between screens?", answer: "Yes. The panel stays open and keeps the conversation as you move between screens, for example from the form designer to the workflow builder, and the history survives a reload. It is kept in that browser, for you in that workspace: it doesn't follow you to another device and is cleared when you sign out. New conversation starts again." },
  { question: "How do I control cost?", answer: "Set a daily message limit per person and a monthly cost cap for the workspace. Every request is recorded with who made it, its tokens and its cost, priced with the same price table as workflow agents. Short bursts are also rate limited per person and per workspace." },
  { question: "How is Agent different from Agents in workflows?", answer: "Agent works beside a person, on the screen they are using, and only proposes. Agents in workflows are AI steps that run inside a process with the tools you grant them, and stop for a person when a decision needs one. Both can use the same provider connections." },
]

function AppShot({ src, alt, sizes, priority = false }: { src: StaticImageData; alt: string; sizes: string; priority?: boolean }) {
  return (
    <ScreenshotFrame>
      <Image src={src} alt={alt} sizes={sizes} priority={priority} placeholder="blur" className="h-auto w-full" />
    </ScreenshotFrame>
  )
}

function Points({ items }: { items: string[] }) {
  return (
    <ul className="mt-6 space-y-2 text-sm leading-6 text-(color:--mkt-text)">
      {items.map((item) => (
        <li key={item} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" /><span>{item}</span></li>
      ))}
    </ul>
  )
}

function Never({ children }: { children: string }) {
  return (
    <p className="mt-5 inline-flex items-start gap-2 rounded-xl border border-(color:--mkt-ink)/10 bg-(color:--mkt-sand) px-4 py-2.5 text-sm font-semibold text-(color:--mkt-ink-soft)">
      <Ban size={16} className="mt-0.5 shrink-0 text-(color:--mkt-bronze)" aria-hidden="true" />{children}
    </p>
  )
}

export function AiAssistantsPage() {
  const url = `${SITE_URL}/${AI_ASSISTANTS_PAGE.slug}`
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": `${url}#webpage`, url, name: AI_ASSISTANTS_PAGE.title, description: AI_ASSISTANTS_PAGE.description, isPartOf: { "@id": `${SITE_URL}/#website` }, about: { "@id": `${SITE_URL}/#software` }, primaryImageOfPage: `${SITE_URL}${assistantForm.src}` },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "UserTasks", item: SITE_URL }, { "@type": "ListItem", position: 2, name: AI_ASSISTANTS_PAGE.eyebrow, item: url }] },
      { "@type": "FAQPage", mainEntity: FAQS.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) },
    ],
  }

  return (
    <div className="mkt relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)" style={THEME}>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-(color:--mkt-paper)" aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <MarketingHeader tone="night" />

      <main>
        {/* Hero */}
        <ProductHero
          crumb="Agent"
          eyebrow="The UserTasks Agent"
          icon={Sparkles}
          title={<>An Agent that <span className="mkt-gradient-text">asks before it acts.</span></>}
          intro={<>One floating Agent button on every screen. It knows where you are and helps you <strong className="text-white">fill a form</strong>, <strong className="text-white">work a task</strong> or <strong className="text-white">build</strong> a workflow, form, table or plugin, using the AI provider you choose and your own key. It proposes. Applying a value, choosing an outcome and saving a change stay with you.</>}
          primary={{ href: SETUP, label: "Set up Agent" }}
          secondary={{ href: USING, label: "What Agent can do" }}
          scenes={["agent", "build", "form"]}
        />
        <section className="relative">
          <div className="mx-auto max-w-6xl px-4 pb-6 pt-14 sm:px-6">
            <dl className="mt-10 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ["1", "panel on every screen"],
                [String(ASSISTANT_PROVIDERS.length), "provider choices, self-hosted too"],
                ["Your key", "stored encrypted"],
                ["Off", "until an admin turns it on"],
              ].map(([value, label]) => (
                <div key={label} className="rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 px-4 py-3">
                  <dt className="sr-only">{label}</dt>
                  <dd className="font-display text-2xl font-bold">{value}</dd>
                  <dd className="text-xs text-(color:--mkt-muted)">{label}</dd>
                </div>
              ))}
            </dl>
            <figure className="mt-12">
              <AppShot src={assistantForm} alt="An Expense claim form with the Agent panel open beside it, looking at the form: eight suggested values (name, work email, dates, category, amount, description and host email), each with an Apply button, plus Dismiss and Apply all" sizes="(min-width: 1152px) 1104px, 100vw" priority />
              <figcaption className="mt-2 text-sm text-(color:--mkt-muted)">Agent on an expense claim. Nothing changes until the person applies a value.</figcaption>
            </figure>
          </div>
        </section>

        {/* One Agent, abilities by screen */}
        <section id="abilities" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="One Agent" title="Its abilities follow the screen and your permissions.">
              Forms, tasks, the form designer (including inside it), the workflow builder, data tables, decision tables, reports and agents: Agent knows which screen you are on and offers only what fits it and what you are allowed to do.
            </SectionHeading>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {ABILITIES.map(({ icon: Icon, title, where, body, never, href }) => (
                <Link key={title} href={href} className="group flex flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-6 transition hover:border-(color:--mkt-bronze)/40 hover:shadow-md">
                  <span className="flex items-center justify-between gap-2">
                    <Icon size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                    <span className="text-2xs font-semibold uppercase tracking-wider text-(color:--mkt-subtle)">{where}</span>
                  </span>
                  <h3 className="mt-3 text-lg font-semibold">{title}</h3>
                  <p className="mt-1 flex-1 text-sm leading-6 text-(color:--mkt-text)">{body}</p>
                  <p className="mt-4 flex items-start gap-2 text-sm font-semibold text-(color:--mkt-ink-soft)"><Ban size={15} className="mt-0.5 shrink-0 text-(color:--mkt-bronze)" aria-hidden="true" />{never}</p>
                </Link>
              ))}
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <FeatureCard icon={MousePointerClick} title="Every screen">An Agent button at the bottom-right; on a phone, just above the tab bar, opening as a full-height sheet.</FeatureCard>
              <FeatureCard icon={Route} title="Goes where you go">The panel stays open and keeps the conversation as you move, say from the form designer to the workflow builder.</FeatureCard>
              <FeatureCard icon={History} title="Survives a reload">The history is still there after a reload, in the same browser. New conversation starts again.</FeatureCard>
            </div>
          </div>
        </section>

        {/* Forms */}
        <section id="forms" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[3fr_2fr]">
            <div>
              <SectionHeading eyebrow="On forms" title="Describe it once. Review the values. Apply.">
                &ldquo;I took a taxi from the airport to a client meeting on 5 November, $245.50.&rdquo; Agent reads the form as the person sees it and proposes values for the fields it can fill.
              </SectionHeading>
              <Points items={[
                "Answers questions about the form and explains why it can't be submitted yet",
                "A preview card lists each field with its current and proposed value: Apply one, Apply all or Dismiss",
                "Values go in through the form itself, so rules, dynamic fields and validation run as if typed",
                "Only visible, editable fields; hidden, read-only and secret fields are never filled",
                "Turn it off for a single form in the form designer",
              ]} />
              <Never>It never submits the form or presses its buttons.</Never>
              <DocLinks links={[{ href: USING, label: "Agent on forms" }, { href: "/forms", label: "Forms" }]} />
            </div>
            <figure className="mx-auto w-full max-w-[300px]">
              <div className="overflow-hidden rounded-[2rem] border-[6px] border-(color:--mkt-ink) bg-(color:--mkt-white) shadow-elev-3">
                <Image src={assistantFormPhone} alt="Agent on a phone: a full-height sheet with the suggested values for the expense claim and Apply all" sizes="300px" placeholder="blur" className="h-auto w-full" />
              </div>
              <figcaption className="mt-3 text-center text-sm text-(color:--mkt-muted)">On a phone it opens as a full-height sheet.</figcaption>
            </figure>
          </div>
        </section>

        {/* Tasks */}
        <section id="tasks" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[2fr_3fr]">
            <div>
              <SectionHeading eyebrow="On tasks" title="Catch up on a task in one question.">
                On a task page it summarises the request and its comments, explains what each outcome means and helps the person respond.
              </SectionHeading>
              <Points items={[
                "Suggests an outcome with its reasoning; the person chooses with the task's own buttons",
                "Drafts a comment or an outcome note to copy or post",
                "Fills the task's form fields with the same preview-and-apply card",
                "Approves, declines or completes a task when asked — required fields first, then a confirmation card",
                "On a task the person can only read, it summarises and explains",
              ]} />
              <Never>It never actions a task without the person's confirmation, or one they couldn't action themselves.</Never>
              <DocLinks links={[{ href: USING, label: "Agent on tasks" }, { href: "/docs/tasks", label: "Tasks" }]} />
            </div>
            <AppShot src={assistantTask} alt="A purchase approval task with the Agent panel open: a summary of the request, a suggested outcome of Approve with its reason, and a draft outcome note with a Copy button" sizes="(min-width: 1024px) 650px, 100vw" />
          </div>
        </section>

        {/* Builders */}
        <section id="build" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="In the builders" title="Ask for the tedious parts. Confirm every change.">
              In the workflow builder, the form designer, data tables, decision tables, reports and agents, Agent knows what you have open. &ldquo;Add an approval step after the manager review&rdquo; works in a workflow; &ldquo;add a phone field with validation&rdquo; in a form.
            </SectionHeading>
            <div className="mt-10 grid grid-cols-1 items-center gap-10 lg:grid-cols-[3fr_2fr]">
              <AppShot src={assistantDesigner} alt="The form designer with the Agent panel open beside the grid, looking at the Expense claim form: it read the form and shows a confirmation card to update it, with a warning that forms have no draft, and Cancel and Confirm buttons" sizes="(min-width: 1024px) 650px, 100vw" />
              <div>
                <Points items={[
                  "Reads freely: lists, definitions, the node catalog and preflight checks",
                  "Each write shows a card of what will be created or changed, with warnings, and waits for Confirm",
                  "Workflows are saved as drafts and new agents start inactive, never published automatically; runs keep the published version",
                  "Uses the same tools as the MCP server, offered only as far as your permissions allow, and audited as you",
                ]} />
                <Never>It never publishes, runs, deletes workflows, forms or tables, handles secrets or changes settings.</Never>
                <DocLinks links={[{ href: USING, label: "Agent in the builders" }, { href: "/workflows", label: "Workflows" }]} />
              </div>
            </div>
            <div className="mt-16 grid grid-cols-1 items-center gap-10 lg:grid-cols-[3fr_2fr]">
              <AppShot src={assistantPlan} alt="Home with the Agent panel open: a build plan card for a leave request process listing a data table, two forms and a workflow, with Cancel and Build all buttons" sizes="(min-width: 1024px) 650px, 100vw" />
              <div>
                <h3 className="font-display text-2xl font-bold tracking-tight">From a written process to a working draft.</h3>
                <p className="mt-3 leading-7 text-(color:--mkt-text)">Paste or attach a procedure, a flowchart or a whiteboard photo and ask Agent to build it. It answers with one build plan: the tables, forms, decision tables, workflow and report, and how they link.</p>
                <Points items={[
                  "Change the plan in chat before anything is made",
                  "Build all creates every item in order and wires them together",
                  "Everything is a draft: you test and publish the workflow",
                ]} />
                <DocLinks links={[{ href: `${USING}#build-a-complete-process-from-a-document`, label: "Build from a process" }, { href: "/docs/tutorials/agent-build-from-process", label: "Tutorial" }]} />
              </div>
            </div>
          </div>
        </section>

        {/* Privacy and control */}
        <section id="privacy" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Privacy and control" title="Your model, your key, your rules.">
              Nothing appears to anyone until a provider key is set, Agent is turned on and the person is allowed to use it.
            </SectionHeading>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FeatureCard icon={KeyRound} title="Bring your own key">Stored encrypted, never sent back to the browser and never logged. The settings page shows only the last four characters.</FeatureCard>
              <FeatureCard icon={Server} title="Self-hosted models">Point it at Ollama or any OpenAI-compatible server on your own network, or at a gateway or proxy with a base URL.</FeatureCard>
              <FeatureCard icon={ShieldCheck} title="The person's permissions">Agent acts only as the signed-in person. It cannot see what they could not see or do what they could not do.</FeatureCard>
              <FeatureCard icon={FileLock2} title="Content is untrusted">Form and task content goes in a marked data block, never the system instructions, and is not followed as instructions. Secret fields are never sent.</FeatureCard>
              <FeatureCard icon={Users} title="Who can use it">Everyone, or only chosen roles and teams. Any form can turn off form help.</FeatureCard>
              <FeatureCard icon={Gauge} title="Limits">A daily message limit per person and a monthly cost cap for the workspace, plus rate limits on short bursts.</FeatureCard>
              <FeatureCard icon={Receipt} title="Usage recorded">Every request records who made it, its tokens and its cost, so you can see what Agent is used for and what it costs.</FeatureCard>
              <FeatureCard icon={CircleCheck} title="Confirm before change">Field values wait for Apply, outcomes for the task&rsquo;s buttons and designer changes for Confirm.</FeatureCard>
            </div>
            <DocLinks links={[{ href: SETUP, label: "Setup, limits and privacy" }]} />
          </div>
        </section>

        {/* Providers and setup */}
        <section id="providers" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2">
            <div>
              <SectionHeading eyebrow="Providers" title="Pick the model you already trust." />
              <ul className="mt-8 flex flex-wrap gap-2" aria-label="Agent providers">
                {PROVIDER_LABELS.map((label) => (
                  <li key={label} className="inline-flex items-center gap-1.5 rounded-full border border-(color:--mkt-ink)/10 bg-(color:--mkt-white) px-3.5 py-1.5 text-sm font-semibold text-(color:--mkt-ink-soft)"><KeyRound size={13} className="text-(color:--mkt-bronze)" aria-hidden="true" />{label}</li>
                ))}
              </ul>
              <p className="mt-6 text-sm leading-6 text-(color:--mkt-text)">Any model id your key can use, as long as it supports tool calling. On Azure the model is your deployment name; Ollama, vLLM, LiteLLM and other OpenAI-compatible servers only need their address. Or reuse an AI connection your workflow agents already have.</p>
            </div>
            <div>
              <SectionHeading eyebrow="Setup" title="Four steps in Settings." />
              <ol className="mt-8 space-y-3">
                {[
                  ["Choose a provider", "From the list, or any OpenAI-compatible server."],
                  ["Add your key", "Enter an API key, or use an Integrations connection. Set a base URL for Azure, a gateway or your own server."],
                  ["Test the connection", "A one-line request with the saved settings that reports what the provider answered."],
                  ["Turn Agent on", "One switch, for everyone or for chosen roles and teams, with a daily limit and a monthly cap."],
                ].map(([title, body], index) => (
                  <li key={title} className="flex gap-4 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-4">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-(color:--mkt-primary) font-display text-sm font-bold text-(color:--mkt-paper)">{index + 1}</span>
                    <span>
                      <span className="block font-semibold">{title}</span>
                      <span className="mt-0.5 block text-sm leading-6 text-(color:--mkt-text)">{body}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 text-sm text-(color:--mkt-muted)">Needs the Manage the Agent permission, which Owner and Admin have.</p>
              <DocLinks links={[{ href: SETUP, label: "Set up Agent" }]} />
            </div>
          </div>
        </section>

        {/* Agent and Agents */}
        <section id="agents" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Agent and Agents" title="A co-worker on screen. Steps in your workflows.">
              Agent sits beside a person on the screen they are using. Agents run inside workflows. Use either, both or neither.
            </SectionHeading>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <article className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-6">
                <Sparkles size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                <h3 className="mt-3 text-lg font-semibold">Agent, your AI co-worker in every screen</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">One chat panel across forms, tasks and the builders. It works with what the person has open, proposes, and waits for them to apply, decide or confirm.</p>
                <DocLinks links={[{ href: SETUP, label: "Agent guide" }]} />
              </article>
              <article className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-6">
                <Bot size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                <h3 className="mt-3 text-lg font-semibold">Agents in workflows</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">An AI step in a workflow with instructions, the tools you grant it and a typed output. It runs on its own, is traced, and stops for a person when a decision needs one.</p>
                <DocLinks links={[{ href: "/connectors#ai", label: "AI agents and models" }, { href: "/docs/agents", label: "Agents guide" }]} />
              </article>
            </div>
          </div>
        </section>

        {/* Learn */}
        <section id="learn" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Learn" title="Guides and tutorials." />
            <ul className="mt-10 grid gap-4 sm:grid-cols-2">
              {[
                { href: SETUP, title: "Setting up Agent", body: "Provider, key, who can use it, limits, costs and privacy." },
                { href: USING, title: "Using Agent", body: "What it can do on each screen, and what it never does." },
                { href: "/docs/tasks/form-wizard", title: "Build a form with the wizard", body: "A form, its approval workflow and a responses report with charts." },
                { href: "/docs/tutorials", title: "Tutorials", body: "Step-by-step walkthroughs, start to finish." },
              ].map((guide) => (
                <li key={guide.href}>
                  <Link href={guide.href} className="group flex h-full items-center justify-between gap-4 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-5 transition hover:border-(color:--mkt-bronze)/40 hover:shadow-md">
                    <span>
                      <span className="block font-semibold">{guide.title}</span>
                      <span className="mt-1 block text-sm text-(color:--mkt-muted)">{guide.body}</span>
                    </span>
                    <ArrowRight size={16} className="shrink-0 text-(color:--mkt-bronze)" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <FaqList faqs={FAQS} />

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="rounded-3xl border border-(color:--mkt-ink)/10 bg-gradient-to-br from-(color:--mkt-primary)/[0.06] via-transparent to-(color:--mkt-gold)/[0.12] p-8 text-center sm:p-14">
            <Sparkles size={28} className="mx-auto text-(color:--mkt-bronze)" aria-hidden="true" />
            <h2 className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl">Turn on Agent in a few minutes.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-(color:--mkt-text)">Choose a provider, add your key, test the connection and turn Agent on for the people you choose.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href={SETUP} className="inline-flex items-center justify-center gap-2 rounded-lg bg-(color:--mkt-primary) px-6 py-3 font-semibold text-(color:--mkt-paper) hover:bg-(color:--mkt-primary-hover)">Set up Agent <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link href="/forms" className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">Forms</Link>
              <Link href="/workflows" className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">Workflows</Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
