import Link from "next/link"
import {
  AlarmClock,
  ArrowRight,
  BadgeCheck,
  Braces,
  CalendarClock,
  CircleStop,
  Download,
  FlaskConical,
  GitBranch,
  GitMerge,
  Layers,
  KeyRound,
  ListChecks,
  Puzzle,
  Radio,
  Repeat,
  RotateCcw,
  Scale,
  ShieldCheck,
  Split,
  Timer,
  UserCheck,
  Users,
  Workflow,
  Zap,
} from "lucide-react"
import { ProductHero } from "@/components/marketing/product-hero"
import { CheckList, DocLinks, FaqList, FeatureCard, InlineCode, MarketingFooter, MarketingHeader, Pill, SectionHeading, Shot, Snippet } from "@/components/marketing/marketing-ui"
import { OFFICIAL_ACTIONS } from "@/lib/docs/content/custom-actions"
import { SCREENSHOTS } from "@/lib/docs/screenshots"
import { CONNECTOR_COUNT, WORKFLOW_NODE_COUNT } from "@/lib/marketing-connectors"
import { WORKFLOWS_PAGE } from "@/lib/marketing-pages"

/**
 * /workflows — the workflow headliner page, alongside /forms and /documents:
 * control flow, rules, people, time and events, errors, Save & Test, run
 * history, versions and live migration. /workflow-automation stays the
 * broader "workflow automation" solution page and links here. Screenshots
 * are the Northwind demo workspace ("Supplier invoice — end to end").
 * #actions is the custom workflow action framework (the landing page links
 * to it).
 */

const SITE_URL = "https://usertasks.com"

const FLOW_BLOCKS = [
  { icon: GitBranch, title: "Branch by Condition", body: "If, else-if and else, each branch a set of AND / OR rules over any variable or expression." },
  { icon: GitMerge, title: "Branch by Value", body: "One outgoing path per value — approver level, region, status — plus a default." },
  { icon: Repeat, title: "Loops", body: "For each item in a list (lines, files, rows) or N times, with the current item in the data picker." },
  { icon: Split, title: "Parallel and sequential", body: "Fan out to two or more branches at once, or one after another." },
  { icon: Layers, title: "Sub-workflows", body: "Call a shared workflow as a step: wait for its variables, or start it and carry on." },
  { icon: RotateCcw, title: "Go To Activity", body: "Send work back for rework and approve again, without long edges across the canvas." },
  { icon: Scale, title: "Decision tables", body: "Ordered, typed rules — first match wins — that analysts change without touching the flow." },
  { icon: CircleStop, title: "End Workflow", body: "Stop a path deliberately with a reason in the run log." },
]

const FAQS = [
  { question: "How complex can a workflow get?", answer: "There is no fixed limit on steps or branches. Workflows combine conditions and value switches, loops, parallel and sequential paths, rework jumps, sub-workflows called synchronously or asynchronously, decision tables, User Tasks, timers, external events and error paths. Shared stages live in sub-workflows so a large process stays readable." },
  { question: "How do I test a workflow before publishing it?", answer: "Save & Test runs the draft with saved test cases. Start forms and User Task forms appear exactly as people see them, you act on tasks inside the test, and the process view shows the path taken with each step’s input, output and log. Test runs are marked as tests and stay out of reports." },
  { question: "What happens to running instances when I publish a new version?", answer: "Runs in progress stay on the version they started with. To move waiting or paused runs to the new version, choose the step in the new version where each group continues, review a dry run, and migrate. The old run is closed out and a new run carries its variables, task and trace forward." },
  { question: "Can business rules change without a new workflow version?", answer: "Yes. Put policy in a decision table: ordered, typed rules that analysts edit and test on their own. The workflow reads the table when it runs and branches on the outputs." },
  { question: "Can I build workflows from code or with an AI assistant?", answer: "Yes. The designer and the API share one JSON definition. Create, update, publish and migrate workflows with the REST API, the usertasks CLI or config as code, or let Claude, ChatGPT and other MCP clients build them through the MCP server." },
  { question: "Is it safe to run our own code in a custom action?", answer: "Custom actions run in QuickJS compiled to WebAssembly, a separate JavaScript engine created fresh for every run, with capped memory, stack and time. The code has no access to the server process, its environment, the file system or the network. It can only call the host through ctx, and every call is checked against what the manifest declares and what an administrator approved. node:vm and new Function are not used: they are not a security boundary." },
  { question: "Can a custom action read our database?", answer: "Only the data tables an administrator grants it, with read or write access, and only if its manifest declares the data capability. It never gets a database connection or credentials; queries go through the data table service, limited to the granted tables. HTTP is limited to approved hosts through the egress guard, files to the ones passed in as inputs, and secrets to the names it declares." },
  { question: "Which languages can I write actions in?", answer: "JavaScript or TypeScript (or anything that compiles to one self-contained ES module). The starter kit has both: TypeScript with defineAction types from @user-tasks/action, and plain JavaScript. Pure-JavaScript npm packages are bundled into the module; packages that need Node built-ins will not run in the sandbox." },
  { question: "How do I test an action before uploading it?", answer: "npm test in the starter kit runs every operation's sample inputs and your test cases in the same QuickJS sandbox the app uses, with the same limits. runAction from @user-tasks/action/testing does the same from any test framework, with mocks for HTTP, data tables, files and secrets. After uploading, Test runs an operation in the workspace, and Save & Test shows it in a real run with its logs." },
  { question: "What are the limits?", answer: "10 seconds per run by default (up to 60), 32 MB of memory by default (up to 128), a 256 KB stack, 200 host calls per run, 5 MB of inputs and of outputs, and a 1 MB module. Operators can lower the time ceiling or switch custom actions off on a server; each action has its own kill switch." },
  { question: "How do I share actions between workspaces?", answer: "Upload the same package (versions are immutable and checksummed, optionally signed with ed25519), or move actions with packages and config as code alongside the workflows that use them. Approvals and secrets never travel: an administrator reviews them in each workspace." },
]

const TRIGGERS = ["Form submitted", "Webhook", "Middleware (answers in line)", "Schedule", "Data table row created, updated or deleted", "Task created, received, submitted, updated, completed or rejected", "Another workflow failed", "Workflow SLA at risk or breached", "Retention review due", "API, MCP or CLI start"]

export function WorkflowsPage() {
  const page = WORKFLOWS_PAGE
  const url = `${SITE_URL}/${page.slug}`
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": `${url}#webpage`, url, name: page.title, description: page.description, isPartOf: { "@id": `${SITE_URL}/#website` }, about: { "@id": `${SITE_URL}/#software` }, primaryImageOfPage: `${SITE_URL}${SCREENSHOTS["workflows-designer"].src}` },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "UserTasks", item: SITE_URL }, { "@type": "ListItem", position: 2, name: "Workflows", item: url }] },
      { "@type": "FAQPage", mainEntity: FAQS.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) },
    ],
  }

  return (
    <div className="mkt relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-(color:--mkt-paper)" aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <MarketingHeader tone="night" />

      <main>
        {/* Hero */}
        <ProductHero
          crumb="Workflows"
          eyebrow="Workflows"
          icon={Workflow}
          title={<>Processes you can <span className="mkt-gradient-text">actually see.</span></>}
          intro={<>Real processes branch, loop, wait for people, run steps side by side, call other processes and fail in interesting ways. Model all of it on one canvas — or as JSON — test it with the real forms, publish it as a version and move live runs forward when the process changes. <strong className="text-white">{WORKFLOW_NODE_COUNT} node types</strong>, durable runs, every step recorded.</>}
          primary={{ href: "/docs/workflows", label: "Read the workflow guide" }}
          secondary={{ href: "/gallery", label: "Start from a package" }}
          scenes={["canvas", "process", "deploy"]}
          bullets={["Branches, loops, parallel paths and sub-workflows", "People, rules, timers and events in one flow", "Tested with real forms, versioned, migrated live"]}
        />
        <section className="relative">
          <div className="mx-auto max-w-6xl px-4 pb-6 pt-14 sm:px-6">
            <div className="mt-12">
              <Shot name="workflows-designer" alt="The designer with a supplier invoice workflow: a loop over invoice lines, an approval policy, a four-way branch by approver with finance manager and CFO tasks, a rework loop, vendor onboarding as a sub-workflow, payment and notification in parallel, and a payment error path; the Branch by Value settings are open" sizes="(min-width: 1152px) 1104px, 100vw" priority />
            </div>
            <ul className="mt-8 grid gap-3 text-sm text-(color:--mkt-text) sm:grid-cols-3">
              {[
                [Workflow, "Branches, loops, parallel paths and sub-workflows"],
                [ListChecks, "People, rules, timers and events in the same flow"],
                [FlaskConical, "Tested with real forms, versioned, migrated live"],
              ].map(([Icon, text]) => {
                const I = Icon as typeof Workflow
                return <li key={text as string} className="flex items-start gap-2"><I size={16} className="mt-0.5 shrink-0 text-(color:--mkt-bronze)" aria-hidden="true" />{text as string}</li>
              })}
            </ul>
          </div>
        </section>

        {/* Control flow */}
        <section id="control-flow" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Control flow" title="Every shape a process takes.">
              Each node shows a one-line summary of its settings, so a published flow reads like a specification. Group related steps in sections; sketch with placeholders before every system exists.
            </SectionHeading>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {FLOW_BLOCKS.map((block) => <FeatureCard key={block.title} icon={block.icon} title={block.title}>{block.body}</FeatureCard>)}
            </div>
            <DocLinks links={[{ href: "/docs/workflows/sub-workflows", label: "Sub-workflows, loops and parallel paths" }, { href: "/docs/workflows/designer", label: "The designer" }, { href: "/docs/workflows/nodes", label: "Node reference" }, { href: "/documents", label: "Document steps" }, { href: "/media", label: "Image, audio and video steps" }]} />
          </div>
        </section>

        {/* Decision tables */}
        <section id="rules" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[2fr_3fr]">
            <div>
              <SectionHeading eyebrow="Business rules" title="Rules out of the flow, where analysts can change them.">
                A decision table takes typed inputs, checks ordered rules and returns typed outputs. The workflow branches on the result; the policy changes without a new workflow version.
              </SectionHeading>
              <CheckList items={[
                "Number, text, boolean and date inputs with comparison operators",
                "First enabled match wins; each rule labelled for the audit trail",
                <>Results as variables — <InlineCode>{"{{approver_level}}"}</InlineCode>, <InlineCode>{"{{rule_label}}"}</InlineCode> — for the next step</>,
                "Test a table from the API; read once per run, even inside loops",
              ]} />
              <DocLinks links={[{ href: "/docs/decision-tables", label: "Decision tables" }]} />
            </div>
            <Shot name="decision-table" alt="The Invoice approval policy decision table with rules by amount, vendor risk and category" sizes="(min-width: 1024px) 650px, 100vw" />
          </div>
        </section>

        {/* People */}
        <section id="people" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="People in the loop" title="Human steps that are part of the flow, not a side channel.">
              A User Task waits for a person and continues on the outcome they choose. Each outcome is an edge on the canvas, and every field they fill in is a typed variable downstream.
            </SectionHeading>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <FeatureCard icon={ListChecks} title="Forms and outcomes">Grid forms with lookups and attachments, and outcomes such as Approved, Rejected or Needs info.</FeatureCard>
              <FeatureCard icon={Users} title="Assignment">A person, a variable, a team or a queue. Several assignees with first response, all, consensus, unanimous or custom rules.</FeatureCard>
              <FeatureCard icon={AlarmClock} title="Due dates and escalation">Relative or fixed due dates, reminders, escalation and redirection.</FeatureCard>
              <FeatureCard icon={UserCheck} title="Manager view">Managers see their reports’ work and can act on their behalf, with a recorded reason.</FeatureCard>
            </div>
            <DocLinks links={[{ href: "/forms", label: "Forms" }, { href: "/docs/tasks/assignment-and-slas", label: "Assignment and SLAs" }, { href: "/docs/tasks/manager-view", label: "Manager view" }]} />
          </div>
        </section>

        {/* Time and events */}
        <section id="time-and-events" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Time, SLAs and events" title="Wait for days. Start on anything. Know when it’s late." />
            <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-3">
              <div>
                <h3 className="flex items-center gap-2 font-semibold"><Zap size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />Triggers</h3>
                <ul className="mt-3 space-y-1.5 text-sm leading-6 text-(color:--mkt-text)">
                  {TRIGGERS.map((trigger) => <li key={trigger} className="flex gap-2"><span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-(color:--mkt-bronze)" aria-hidden="true" />{trigger}</li>)}
                </ul>
              </div>
              <div>
                <h3 className="flex items-center gap-2 font-semibold"><Timer size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />Timers and waits</h3>
                <p className="mt-3 text-sm leading-6 text-(color:--mkt-text)">Pause for a duration or until a date — <InlineCode>{"{{=ADD_DAYS(due_date, -3)}}"}</InlineCode>. Long waits hold nothing in memory: the run is parked and the queue wakes it. A run can also wait for an external event and resume with its values.</p>
                <div className="mt-4"><Snippet code={`usertasks events complete <event-id> \\
  --set return_variables:='{"payment_status":"settled"}'`} /></div>
              </div>
              <div>
                <h3 className="flex items-center gap-2 font-semibold"><CalendarClock size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />SLAs</h3>
                <p className="mt-3 text-sm leading-6 text-(color:--mkt-text)">Set SLA gives a run a deadline and a warning threshold. Warnings and breaches start Workflow SLA triggers, appear in run lists and reports, and go to your log platform as events.</p>
                <DocLinks links={[{ href: "/docs/workflows/triggers", label: "Triggers" }, { href: "/docs/workflows/timing", label: "Delays, pauses and SLAs" }]} />
              </div>
            </div>
          </div>
        </section>

        {/* Errors */}
        <section id="errors" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-start gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[3fr_2fr]">
            <div className="min-w-0">
              <SectionHeading eyebrow="Error paths and retries" title="Decide what a failure means, step by step.">
                Every node either stops the run or continues on error. Continue, and the next steps see what failed — so the flow can retry, compensate or hand the problem to a person.
              </SectionHeading>
              <div className="mt-6">
                <Snippet language="text" code={`Create payment          onError: continue
Payment failed?         {{has_error}} equals true
  Failed → Fix the payment (User Task) → Retry → Create payment
  Else   → Payment scheduled

{{last_error}}  {{last_error_node}}  {{last_error_node_type}}`} />
              </div>
            </div>
            <div>
              <CheckList items={[
                "Workflow Error triggers start a central error workflow with the failing run, node and message",
                "Resume, pause or cancel runs from the run page, the API or the CLI",
                "Queue jobs retried with backoff before they are marked dead — with events either way",
                "HTTP 4xx and 5xx answers stored with their status, so you branch on them",
              ]} />
              <DocLinks links={[{ href: "/docs/workflows/error-handling", label: "Error handling" }]} />
            </div>
          </div>
        </section>

        {/* Save & Test */}
        <section id="save-and-test" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Save & Test" title="Test the draft the way people will use it.">
              Save & Test runs the draft with saved test cases. When the run reaches a User Task, the task appears right there in test mode — fill it in, choose an outcome and watch the run continue.
            </SectionHeading>
            <div className="mt-10">
              <Shot name="workflows-save-test" alt="The Test Workflow dialog: a Finance manager approval task in test mode with a comment and Approved, Rejected and Needs info buttons, above the process view showing the steps completed so far and the task waiting" sizes="(min-width: 1152px) 1104px, 100vw" />
            </div>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              <FeatureCard icon={FlaskConical} title="Test cases">Named sets of inputs that are kept with the workflow. Run one or all.</FeatureCard>
              <FeatureCard icon={ListChecks} title="Real forms">Start forms and task forms drawn exactly as people see them and checked on the server.</FeatureCard>
              <FeatureCard icon={Radio} title="Process view and logs">The path taken, each step’s input, output and log. Test runs stay out of reports.</FeatureCard>
            </div>
          </div>
        </section>

        {/* Runs */}
        <section id="runs" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[3fr_2fr]">
            <Shot name="workflows-process-viewer" alt="The process view of a completed run: the path through the approval policy, the finance manager approval and both parallel branches marked completed, and the steps that did not run greyed out" sizes="(min-width: 1024px) 650px, 100vw" />
            <div>
              <SectionHeading eyebrow="Every run, on the canvas" title="See the path each run took.">
                The process view draws a run on its own workflow: completed steps with their timings, steps that did not run, loops with their visit counts and the step that is waiting.
              </SectionHeading>
              <CheckList items={[
                "Compared with a typical run: duration, steps, visits and edges, node by node",
                "Variables and the full log for every step",
                <>Follow runs live with <InlineCode>usertasks logs tail</InlineCode>, or ship every event to Splunk, Datadog or OpenTelemetry</>,
              ]} />
              <DocLinks links={[{ href: "/docs/workflows/versions-and-runs", label: "Versions and runs" }, { href: "/docs/observability", label: "Observability" }]} />
            </div>
          </div>
        </section>

        {/* Versions */}
        <section id="versions" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[2fr_3fr]">
            <div>
              <SectionHeading eyebrow="Versions and live migration" title="Change the process while it runs.">
                Publishing freezes the draft as a numbered version. Runs in progress finish on the version they started — or you move them forward.
              </SectionHeading>
              <CheckList items={[
                "Pick the target version and, for each step instances wait at, where they continue",
                "A dry-run review before anything changes; blocked and conflicting instances left alone",
                "The new run carries the variables, task and trace; both runs link to each other",
                "Version history with notes; export, diff and apply workflows as code",
              ]} />
              <DocLinks links={[{ href: "/docs/workflows/versions-and-runs#migrating-live-instances", label: "Migrating live instances" }, { href: "/docs/config-as-code", label: "Config as code" }]} />
            </div>
            <Shot name="migrate-instances" alt="The migration wizard mapping the step waiting instances are at to a step of the new version, with a graph preview" sizes="(min-width: 1024px) 650px, 100vw" />
          </div>
        </section>

        {/* As code */}
        <section id="as-code" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2">
            <div>
              <SectionHeading eyebrow="Designer or JSON" title="The same definition, from the canvas, the CLI or an AI assistant.">
                The designer and the API share one definition — nodes, edges and variables. Edit it in your editor, review it in a pull request, or let Claude or ChatGPT build it through the MCP server.
              </SectionHeading>
              <DocLinks links={[{ href: "/docs/workflows", label: "Authoring as JSON" }, { href: "/docs/mcp", label: "MCP server" }, { href: "/connectors", label: `${CONNECTOR_COUNT} connectors and any API` }, { href: "/workflow-automation", label: "Workflow automation for people and systems" }]} />
            </div>
            <Snippet code={`usertasks workflows definition <id> -o json > invoice.json
$EDITOR invoice.json
usertasks workflows update <id> -f invoice.json
usertasks workflows publish <id> --set notes="CFO step for new vendors"
usertasks workflows migrate-instances <id> --to <version-id> --all --dry-run`} />
          </div>
        </section>


        {/* Custom actions */}
        <section id="actions" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Custom actions" title="Build any action — or install one.">
              When no built-in step fits, write your own in JavaScript or TypeScript. A typed manifest turns it into a node with a function picker, a generated input panel and typed outputs in the data picker. It runs in a sandbox, and reaches only what an administrator grants.
            </SectionHeading>
            <div className="mt-10 grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
              <div className="min-w-0">
                <Snippet language="typescript" code={`import { defineAction } from '@user-tasks/action'

export default defineAction({
  operations: {
    async lookup(inputs: { customer_id: string }, ctx) {
      const res = await ctx.http.fetch(
        \`https://crm.example.com/api/customers/\${inputs.customer_id}\`,
        { headers: { authorization: 'Bearer secret://crm_key' } },
      )
      if (!res.ok) ctx.fail(\`CRM returned \${res.status}\`, { retryable: res.status >= 500 })
      return { name: res.json.name, tier: res.json.tier }
    },
  },
})`} />
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <FeatureCard icon={Braces} title="A typed contract">Operations with typed inputs and outputs. The designer builds the input panel from them, and the data picker lists the outputs with their types.</FeatureCard>
                <FeatureCard icon={ShieldCheck} title="Isolated per run">QuickJS compiled to WebAssembly: a fresh engine for every run, with capped memory, stack and time. No process, environment, file system or network.</FeatureCard>
                <FeatureCard icon={KeyRound} title="Capabilities and grants">HTTP to approved hosts through the egress guard, granted data tables, input files and declared secrets — nothing else.</FeatureCard>
                <FeatureCard icon={BadgeCheck} title="Versioned and signed">Immutable versions with SHA-256 and optional ed25519 signatures; pin a version on a node, or disable an action everywhere at once.</FeatureCard>
              </div>
            </div>
            <div className="mt-12">
              <h3 className="flex items-center gap-2 font-semibold"><Puzzle size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />Six official actions, ready to install</h3>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {OFFICIAL_ACTIONS.map((action) => (
                  <li key={action.key}>
                    <Link href={`/gallery/actions/${action.slug}`} className="block h-full rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-4 hover:border-(color:--mkt-bronze)/40">
                      <span className="font-semibold">{action.name}</span>
                      <span className="mt-1 block text-sm leading-6 text-(color:--mkt-text)">{action.summary}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="/downloads/action-starter.zip" download className="inline-flex items-center justify-center gap-2 rounded-lg bg-(color:--mkt-primary) px-6 py-3 font-semibold text-(color:--mkt-paper) hover:bg-(color:--mkt-primary-hover)">
                <Download size={16} aria-hidden="true" /> Download the starter kit
              </a>
              <Link href="/gallery/actions" className="inline-flex items-center justify-center gap-2 rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">
                Browse official actions
              </Link>
            </div>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-(color:--mkt-muted)">The kit has the same action in TypeScript and plain JavaScript, a test harness that runs your samples in the real sandbox, and a package script. <InlineCode>@user-tasks/action</InlineCode> brings the types, <InlineCode>defineAction</InlineCode> and <InlineCode>runAction</InlineCode> for your own tests.</p>
            <DocLinks links={[{ href: "/docs/workflows/custom-actions", label: "Custom workflow actions" }, { href: "/docs/workflows/custom-actions#security-model", label: "Security model" }, { href: "/docs/workflows/official-actions", label: "Official actions reference" }]} />
          </div>
        </section>

        <FaqList faqs={FAQS} />

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="rounded-3xl border border-(color:--mkt-ink)/10 bg-gradient-to-br from-(color:--mkt-primary)/[0.06] via-transparent to-(color:--mkt-gold)/[0.12] p-8 text-center sm:p-14">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Model the process you actually have.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-(color:--mkt-text)">Start in the cloud or self-host it next to your systems. Open source under Apache-2.0.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/docs/workflows" className="inline-flex items-center justify-center gap-2 rounded-lg bg-(color:--mkt-primary) px-6 py-3 font-semibold text-(color:--mkt-paper) hover:bg-(color:--mkt-primary-hover)">Workflow guide <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link href="/connectors" className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">Integrations and AI</Link>
              <Link href="/media" className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">Images, audio and video</Link>
              <Link href="/use-cases" className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">Use cases</Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}

