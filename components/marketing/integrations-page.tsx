import Link from "next/link"
import {
  ArrowRight,
  Bot,
  Building2,
  Database,
  FileSignature,
  FileText,
  Fingerprint,
  Hourglass,
  GitBranch,
  KeyRound,
  ListChecks,
  Network,
  Plug,
  Radio,
  ScrollText,
  ShieldCheck,
  Terminal,
  Webhook,
  Wrench,
} from "lucide-react"
import { ProductHero } from "@/components/marketing/product-hero"
import { CheckList, DocLinks, FaqList, FeatureCard, InlineCode, MarketingFooter, MarketingHeader, Pill, SectionHeading, Shot, Snippet } from "@/components/marketing/marketing-ui"
import { SCREENSHOTS } from "@/lib/docs/screenshots"
import { GALLERY_PACKAGES } from "@/lib/gallery/site"
import { aiConnectors, CONNECTOR_COUNT, CONNECTOR_REFERENCE_COUNT, connectorGroups, shortProviderName } from "@/lib/marketing-connectors"
import { INTEGRATIONS_PAGE } from "@/lib/marketing-pages"

/**
 * /connectors — integrations and AI: any REST / OData API (OpenAPI import,
 * response models, data picker), the connector catalogue generated from the
 * connector registry, databases, webhooks, MCP in both directions, the API,
 * SDK and CLI, and AI agents. Screenshots are the Northwind demo workspace.
 */

const SITE_URL = "https://usertasks.com"
const ENTERPRISE_PREFIXES = ["workday-", "sap-", "salesforce-", "servicenow-", "netsuite-", "entra-"]

const FAQS = [
  { question: "Can UserTasks connect to a system that has no connector?", answer: "Yes. Any HTTP/JSON API is a REST integration: import its OpenAPI 2 or 3 document or Postman collection to get one reference per operation, or define references by hand. OData v2/v4 services, SQL and MongoDB databases and outbound webhooks are integration types of their own. Connectors only add a setup form, a connection test and ready-made references on top." },
  { question: "How are credentials kept safe?", answer: "Credentials are encrypted at rest and write-only: the API, exports and packages return a placeholder instead of the value. OAuth 2.0 connections use authorization code with PKCE and refresh tokens automatically. Outbound calls to private and cloud-metadata addresses are blocked unless a self-hosted server allows private egress, and every call is logged with headers redacted." },
  { question: "Which AI models can agents use?", answer: "Any model behind an OpenAI-compatible chat-completions endpoint with tool calling. Ready-made connectors cover OpenAI, Azure OpenAI, Claude, Google Gemini, Mistral, DeepSeek, Groq, Together, Perplexity and Ollama for models on your own hardware." },
  { question: "Can Claude or ChatGPT drive UserTasks?", answer: "Yes. UserTasks runs an MCP server at /api/mcp. Claude, ChatGPT, Cursor and other MCP clients can list and start workflows, act on tasks, build workflows, decision tables and reports and read the event stream — always within the permissions of the API key or OAuth token they use." },
  { question: "Do prompts or responses leave my environment in logs?", answer: "No. Agent runs, tool calls, token counts and errors are recorded and emitted as events, but prompts and model outputs are not included in exported events, and file contents never reach logs." },
]

export function IntegrationsPage() {
  const groups = connectorGroups()
  const ai = aiConnectors()
  // One package per system first, so the list shows their range.
  const enterprisePackages = ENTERPRISE_PREFIXES.flatMap((prefix) => GALLERY_PACKAGES.filter((pkg) => pkg.slug.startsWith(prefix)).slice(0, 1)).slice(0, 6)
  const url = `${SITE_URL}/${INTEGRATIONS_PAGE.slug}`
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": `${url}#webpage`, url, name: INTEGRATIONS_PAGE.title, description: INTEGRATIONS_PAGE.description, isPartOf: { "@id": `${SITE_URL}/#website` }, about: { "@id": `${SITE_URL}/#software` }, primaryImageOfPage: `${SITE_URL}${SCREENSHOTS["integrations-openapi-import"].src}` },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "UserTasks", item: SITE_URL }, { "@type": "ListItem", position: 2, name: INTEGRATIONS_PAGE.eyebrow, item: url }] },
      { "@type": "ItemList", name: "UserTasks connectors", numberOfItems: CONNECTOR_COUNT, itemListElement: [...groups.flatMap((group) => group.connectors), ...ai].map((connector, index) => ({ "@type": "ListItem", position: index + 1, name: connector.name })) },
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
          crumb="Integrations"
          eyebrow="Integrations and AI"
          icon={Plug}
          title={<>Systems that <span className="mkt-gradient-text">finally talk.</span></>}
          intro={<>Import an API from its OpenAPI document, connect a database, start from a ready-made connector or call any endpoint — once, with encrypted credentials — and use those operations in every workflow, agent, report and MCP client. Then put <strong className="text-white">any AI model</strong> to work on the same governed connections.</>}
          primary={{ href: "/docs/integrations", label: "Integration guide" }}
          secondary={{ href: "#connectors", label: `Browse ${CONNECTOR_COUNT} connectors` }}
          scenes={["cli", "table"]}
        />
        <section className="relative">
          <div className="mx-auto max-w-6xl px-4 pb-6 pt-14 sm:px-6">
            <dl className="mt-12 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                [String(CONNECTOR_COUNT), "ready-made connectors"],
                [String(CONNECTOR_REFERENCE_COUNT), "ready-made operations"],
                [String(ai.length), "AI providers, plus any OpenAI-compatible endpoint"],
                ["Any", "REST or OData API, database or webhook"],
              ].map(([value, label]) => (
                <div key={label} className="flex flex-col-reverse justify-end rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-4">
                  <dt className="mt-1 text-sm leading-5 text-(color:--mkt-text)">{label}</dt>
                  <dd className="font-display text-3xl font-bold">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Any API */}
        <section id="any-api" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[2fr_3fr]">
            <div>
              <SectionHeading eyebrow="Any REST or OData API" title="Import the API. Get every operation.">
                Drop in an OpenAPI 2 or 3 document or a Postman collection: UserTasks previews every operation, creates the integration from its server and security scheme, and one reference per operation with typed inputs.
              </SectionHeading>
              <CheckList items={[
                "API key, bearer, basic or OAuth 2.0 (authorization code with PKCE, automatic refresh)",
                "OData v2 / v4 services with standard query options",
                "A reference is a typed, tested operation that workflows, agents, reports and MCP call by name",
                "Credentials are never taken from the document — and never returned by the API",
              ]} />
              <DocLinks links={[{ href: "/docs/integrations/openapi-import", label: "OpenAPI and Postman import" }, { href: "/docs/integrations/references", label: "References" }, { href: "/docs/integrations/oauth", label: "OAuth connections" }]} />
            </div>
            <Shot name="integrations-openapi-import" alt="Import API Specification: an OpenAPI 3.0 document for a demo logistics API with its name, base URL, tags and bearer authentication, and eight operations selected to become references" sizes="(min-width: 1024px) 650px, 100vw" priority />
          </div>
        </section>

        {/* Response models */}
        <section id="response-models" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[3fr_2fr]">
            <Shot name="integrations-data-picker" alt="The Insert data picker on a workflow step listing the Get Customers response — total, page and a data list with id, name and email — and the choices for a field inside a list: loop through each item, the first item, an item at an index or one found by a condition" sizes="(min-width: 1024px) 650px, 100vw" />
            <div>
              <SectionHeading eyebrow="Response models and the data picker" title="Click the field you need — not a JSON path.">
                Every reference knows the shape of its response: from the OpenAPI schema, the table columns, the connector’s outputs or a real test call. Workflows browse it in the data picker.
              </SectionHeading>
              <CheckList items={[
                <>Pick <InlineCode>{"response › data[] › email"}</InlineCode> and choose: loop through each item, the first item, or one that matches</>,
                "Example values from the captured sample; credential-like fields masked",
                "Add a named output from any field with one click",
              ]} />
              <DocLinks links={[{ href: "/docs/integrations/references#response-model", label: "Response models" }, { href: "/docs/workflows/api-responses", label: "Using API responses" }]} />
            </div>
          </div>
        </section>

        {/* Connector catalogue */}
        <section id="connectors" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Connectors" title={`${CONNECTOR_COUNT} connectors, ready when you are.`}>
              A connector asks only for that service’s settings and credentials, tests the connection with a service-specific check and creates ready-made references. This list is generated from the product’s connector registry.
            </SectionHeading>
            <div className="mt-10 space-y-10">
              {groups.map((group) => (
                <div key={group.id} id={`connectors-${group.id}`} className="scroll-mt-8">
                  <h3 className="font-display text-xl font-bold tracking-tight">{group.title}</h3>
                  {group.note && <p className="mt-1 text-sm text-(color:--mkt-muted)">{group.note}</p>}
                  <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {group.connectors.map((connector) => (
                      <li key={connector.key} className="flex flex-col rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-4">
                        <span className="font-semibold">{connector.name}</span>
                        <span className="mt-1 flex-1 text-sm leading-6 text-(color:--mkt-text)">{connector.description}</span>
                        {connector.references > 0 && <span className="mt-2 text-xs font-semibold text-(color:--mkt-bronze)">{connector.references} ready-made {connector.references === 1 ? "operation" : "operations"}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="mt-12 grid grid-cols-1 gap-6 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-6 lg:grid-cols-[2fr_3fr]">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-semibold"><Building2 size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />Workday, SAP, Salesforce, ServiceNow</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">The big systems of record have connectors with their common operations ready — and their REST and OData APIs stay fully reachable as references, so nothing is out of bounds. The gallery has working packages for them.</p>
                <DocLinks links={[{ href: "/docs/integrations/connectors", label: "Connector reference" }, { href: "/gallery", label: "Package gallery" }]} />
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {enterprisePackages.map((pkg) => (
                  <li key={pkg.slug}>
                    <Link href={`/gallery/${pkg.slug}`} className="group flex h-full flex-col rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-4 transition hover:border-(color:--mkt-bronze)/40 hover:shadow-md">
                      <span className="text-sm font-semibold">{pkg.title}</span>
                      <span className="mt-1 line-clamp-2 flex-1 text-xs leading-5 text-(color:--mkt-text)">{pkg.summary}</span>
                      <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-(color:--mkt-bronze) group-hover:underline">See the package <ArrowRight size={12} aria-hidden="true" /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* E-signature */}
        <section id="e-signature" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="E-signature" title="Send for signature. Wait. Keep the signed PDF.">
              DocuSign, Adobe Acrobat Sign, Dropbox Sign, PandaDoc, SignNow and BoldSign behave the same in a workflow: one set of steps, normalized statuses, and the provider-specific options one click away.
            </SectionHeading>
            <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-3">
              <div>
                <h3 className="flex items-center gap-2 font-semibold"><FileSignature size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />Send for Signature</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">Send the contract a Word or PDF step just generated — or a provider template with roles and prefilled fields — to signers in order, with reminders, expiry and embedded &ldquo;Sign now&rdquo; links. A retried step never sends a second envelope.</p>
              </div>
              <div>
                <h3 className="flex items-center gap-2 font-semibold"><Hourglass size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />Wait for Signature</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">The run pauses until the envelope is completed, declined, voided or expires, then branches on the outcome with every signer&rsquo;s status — and the signed PDF and certificate stored as workflow files.</p>
              </div>
              <div>
                <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />Verified webhooks</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">Every provider callback is signature-checked and replay-protected, and the envelope&rsquo;s status is read back from the provider before anything resumes. No webhook? Waiting envelopes are polled.</p>
              </div>
            </div>
            <DocLinks links={[{ href: "/docs/integrations/e-signature", label: "E-signature setup" }, { href: "#connectors-esign", label: "E-signature connectors" }]} />
          </div>
        </section>

        {/* Databases and webhooks */}
        <section id="databases-and-webhooks" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Databases, webhooks and HTTP" title="Reach data where it lives. Let other systems call in." />
            <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-3">
              <div>
                <h3 className="flex items-center gap-2 font-semibold"><Database size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />Databases</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">PostgreSQL, SQL Server, MySQL, Oracle, Snowflake and MongoDB as integrations: saved, parameterised operations with response models from the table columns. Self-hosted servers can reach databases on private networks.</p>
                <DocLinks links={[{ href: "/docs/self-hosting/optional-drivers", label: "Database drivers" }]} />
              </div>
              <div>
                <h3 className="flex items-center gap-2 font-semibold"><Webhook size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />Inbound webhooks</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">A Webhook trigger starts a run as soon as it is queued; a Middleware trigger keeps the request open and answers with the run’s variables, so a workflow can validate or enrich a request in line.</p>
                <div className="mt-4"><Snippet code={`curl -X POST "$USERTASKS_URL/api/webhooks/inbound?hook=invoice-intake" \\
  -H "Authorization: Bearer <secret>" -d @invoice.json`} /></div>
              </div>
              <div>
                <h3 className="flex items-center gap-2 font-semibold"><Network size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />Outbound calls</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">Webhook integrations and HTTP Request steps call other systems. Failed deliveries are retried and dead-lettered with an event; every call is logged with method, host, status and duration, headers redacted.</p>
                <DocLinks links={[{ href: "/docs/integrations/webhooks", label: "Webhooks" }, { href: "/docs/integrations", label: "Integration types" }]} />
              </div>
            </div>
          </div>
        </section>

        {/* AI */}
        <section id="ai" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="AI models and agents" title="Any AI model — doing real work, under your rules.">
              An agent is a model, instructions, the tools you grant it and an output schema. Run it as a workflow step or on demand. Nothing it does bypasses permissions, and every run is traced.
            </SectionHeading>
            <div className="mt-8">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-(color:--mkt-muted)">Ready-made AI connectors</h3>
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="AI providers with a ready-made connector">
                {ai.map((provider) => <li key={provider.key} className="rounded-full border border-(color:--mkt-ink)/10 bg-(color:--mkt-white) px-3.5 py-1.5 text-sm font-semibold text-(color:--mkt-ink-soft)">{shortProviderName(provider.name)}</li>)}
                <li className="rounded-full border border-dashed border-(color:--mkt-ink)/20 px-3.5 py-1.5 text-sm font-semibold text-(color:--mkt-muted)">Any OpenAI-compatible endpoint</li>
              </ul>
            </div>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <FeatureCard icon={Wrench} title="Granted tools">Any integration reference, starting a workflow, tools from MCP servers you register, and built-in tools — only what you grant.</FeatureCard>
              <FeatureCard icon={FileText} title="Files">Hand an agent the files from a form or a loop: images and PDFs to models that read them, extracted text from Word, Excel and PowerPoint for the rest.</FeatureCard>
              <FeatureCard icon={ListChecks} title="Structured outputs">Declare the outputs; the agent’s answer is parsed into typed variables the next step can branch on.</FeatureCard>
              <FeatureCard icon={ShieldCheck} title="A person decides">Follow the agent with a User Task, so a person approves, corrects or rejects before anything irreversible happens.</FeatureCard>
            </div>
            <div className="mt-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
              <div>
                <p className="leading-7 text-(color:--mkt-text)">Runs, steps, tool calls, token counts and errors are recorded and emitted as events; prompts and model outputs are not exported. Rate limits apply per workspace, and models can run on your own hardware with Ollama.</p>
                <p className="mt-4 rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-4 text-sm leading-6 text-(color:--mkt-text)">
                  AI for people, too: <Link href="/ai-assistants" className="font-semibold text-(color:--mkt-bronze) hover:underline">Agent</Link>, the AI co-worker in every screen, helps people fill forms, work tasks and build, on your own key. It proposes; the person applies, decides or confirms.
                </p>
                <p className="mt-4 rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-4 text-sm leading-6 text-(color:--mkt-text)">
                  Images, audio and video too: <Link href="/media" className="font-semibold text-(color:--mkt-bronze) hover:underline">media steps</Link> transcribe recordings, analyse photos and video, blur faces and bleep spoken personal data with OpenAI, Gemini, Azure, AWS, Deepgram, AssemblyAI, ElevenLabs or Stability AI — and agents can use them as tools.
                </p>
                <DocLinks links={[{ href: "/docs/agents", label: "AI agents" }, { href: "/media", label: "AI for images, audio and video" }, { href: "/use-cases/ai-agent-orchestration", label: "Agents with a person in the loop" }, { href: "/gallery/ai-agent-triage-hitl", label: "Triage package" }]} />
              </div>
              <Snippet code={`usertasks agents execute <agent-id> \\
  --set message="Classify invoice INV-20931 and check the vendor"
usertasks agents execute <agent-id> --set message="…" --set async:=true`} />
            </div>
          </div>
        </section>

        {/* MCP both ways */}
        <section id="mcp" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="MCP, both ways" title="AI clients drive UserTasks. Agents use your MCP servers." />
            <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <article className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-6">
                <Bot size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                <h3 className="mt-3 text-lg font-semibold">The UserTasks MCP server</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">Claude, ChatGPT, Cursor and other MCP clients connect to <InlineCode>/api/mcp</InlineCode> with an API key or MCP OAuth. They list and start workflows, act on tasks, build workflows, decision tables and reports, and read the event stream — within the credential’s permissions, every change audited.</p>
                <div className="mt-4"><Snippet language="json" code={`{ "mcpServers": { "usertasks": {
  "url": "https://tasks.example.com/api/mcp",
  "headers": { "Authorization": "Bearer <your-api-key>" } } } }`} /></div>
                <DocLinks links={[{ href: "/docs/mcp", label: "MCP server and tools" }]} />
              </article>
              <article className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-6">
                <Plug size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                <h3 className="mt-3 text-lg font-semibold">Your MCP servers as agent tools</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">Register external MCP servers under Integrations and grant their tools to an agent next to your references and workflows. The agent sees each tool’s name, description and input schema; the run trace shows every call.</p>
                <CheckList items={["Registered once per workspace, granted per agent", "Mixed freely with references, workflows and built-in tools", "Permissions and rate limits as for every other tool"]} />
                <DocLinks links={[{ href: "/docs/agents", label: "Agent tools" }]} />
              </article>
            </div>
          </div>
        </section>

        {/* Developers and platform */}
        <section id="developers" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="For your own code and your platform" title="Every operation from code — and in your identity and log stack." />
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard icon={Terminal} title="REST API, SDK and CLI">Every screen is an endpoint described by OpenAPI 3.1; a typed TypeScript SDK and the usertasks CLI cover all of it.</FeatureCard>
              <FeatureCard icon={GitBranch} title="Config as code and GitHub sync">Export a workspace to files, review it in a pull request, diff and apply it — or let GitHub sync do it. Secrets stay out of Git.</FeatureCard>
              <FeatureCard icon={ScrollText} title="Packages">Bundle a workflow and everything it uses into a signed, versioned file and install it in other environments — or from the gallery. Credentials never travel.</FeatureCard>
              <FeatureCard icon={Fingerprint} title="SSO and directory sync">OIDC and SAML sign-in; people, groups and managers from Entra ID, Okta, Google Workspace, LDAP or SCIM.</FeatureCard>
              <FeatureCard icon={KeyRound} title="API keys and OAuth apps">Scoped keys, limited to chosen workflows or tables if you like, and OAuth apps with scopes for other applications.</FeatureCard>
              <FeatureCard icon={Radio} title="Log export">Runs, steps, integration calls, agent runs and audit events to Splunk, Datadog, OpenTelemetry or a signed webhook.</FeatureCard>
            </div>
            <div className="mt-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
              <Snippet language="ts" code={`import { apiKeyAuth, createClient } from '@user-tasks/sdk'

const client = createClient({ baseUrl: 'https://tasks.example.com',
  auth: apiKeyAuth(process.env.USERTASKS_API_KEY!) })

await client.POST('/workflows/start', {
  body: { workflow_id: '<id>', variables: { amount: 1200 }, async: true },
})`} />
              <div>
                <p className="leading-7 text-(color:--mkt-text)">Start runs, complete tasks and read results from your own applications, scripts and CI — with the same permissions as every other client.</p>
                <DocLinks links={[{ href: "/docs/api", label: "REST API" }, { href: "/docs/sdk", label: "TypeScript SDK" }, { href: "/docs/cli", label: "CLI" }, { href: "/docs/config-as-code", label: "Config as code" }]} />
              </div>
            </div>
          </div>
        </section>

        <FaqList faqs={FAQS} />

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="rounded-3xl border border-(color:--mkt-ink)/10 bg-gradient-to-br from-(color:--mkt-primary)/[0.06] via-transparent to-(color:--mkt-gold)/[0.12] p-8 text-center sm:p-14">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Connect it once. Use it everywhere.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-(color:--mkt-text)">The same references serve workflows, agents, reports, lookups on forms and MCP clients — tested, logged and governed in one place.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/docs/integrations" className="inline-flex items-center justify-center gap-2 rounded-lg bg-(color:--mkt-primary) px-6 py-3 font-semibold text-(color:--mkt-paper) hover:bg-(color:--mkt-primary-hover)">Integration guide <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link href="/workflows" className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">Complex workflows</Link>
              <Link href="/use-cases/middleware-integration-hub" className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">Integration hub use case</Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
