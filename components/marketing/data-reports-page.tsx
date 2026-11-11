import { BarChart3, Database, FileSpreadsheet, Filter, LayoutDashboard, Link2, Scale, Table2, Webhook, Zap } from "lucide-react"
import { DocLinks, FaqList, FeatureCard, MarketingFooter, MarketingHeader, SectionHeading, Shot, Snippet } from "@/components/marketing/marketing-ui"
import { ProductHero } from "@/components/marketing/product-hero"
import { SCREENSHOTS } from "@/lib/docs/screenshots"
import { DATA_REPORTS_PAGE } from "@/lib/marketing-pages"

/**
 * /data-and-reports — data tables, saved reports with charts, OData and the
 * reporting API. Not /data or /reports: those are signed-in app routes.
 */

const SITE_URL = "https://usertasks.com"

const BLOCKS = [
  { icon: Table2, title: "Data tables", body: "Typed columns and permissions. Workflows read and write them; forms show and edit them." },
  { icon: Zap, title: "Rows that start work", body: "Creating, updating or deleting a row can start a workflow, so a table is also a trigger." },
  { icon: Scale, title: "Decision tables", body: "Ordered, typed rules your analysts edit and test on their own; workflows read the answer." },
  { icon: BarChart3, title: "Saved reports", body: "Over tasks, runs, rules, integrations and your own tables, with up to eight summary charts above the table." },
  { icon: Filter, title: "Filter, group, export", body: "Filters, grouping and sorting saved with the report; aggregations run in the database and exports are built on the server." },
  { icon: LayoutDashboard, title: "Business objects", body: "One object that spans tables and APIs, so forms and reports see a customer or an order, not its storage." },
  { icon: Link2, title: "OData", body: "Tables and saved reports as an OData service, so Excel, Power BI and other clients read them with an API key." },
  { icon: Webhook, title: "API and MCP", body: "Every table and report through the REST API and the MCP server, for your apps and your AI clients." },
]

const FAQS = [
  { question: "Do I need a separate database for process data?", answer: "No. Data tables live in UserTasks with typed columns and permissions, and workflows, forms, reports and the API all use them. When the data belongs in another system, workflows read and write it there through references and connectors." },
  { question: "Can I report on how long approvals take?", answer: "Yes. Saved reports cover tasks and workflow runs as well as your tables, so you can chart counts, durations and outcomes by step, team or anything in the form." },
  { question: "Can Power BI or Excel read the data?", answer: "Yes. UserTasks exposes data tables and saved reports as an OData service with $metadata, $filter, $select, $orderby, $top and $skip. Connect with an API key that has read access." },
  { question: "Can AI assistants query the data?", answer: "Through the MCP server, Claude, ChatGPT and other MCP clients can build and run reports, within the permissions of the API key or the signed-in person." },
]

export function DataReportsPage() {
  const page = DATA_REPORTS_PAGE
  const url = `${SITE_URL}/${page.slug}`
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": `${url}#webpage`, url, name: page.title, description: page.description, isPartOf: { "@id": `${SITE_URL}/#website` }, about: { "@id": `${SITE_URL}/#software` }, primaryImageOfPage: `${SITE_URL}${SCREENSHOTS["home-activity"].src}` },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "UserTasks", item: SITE_URL }, { "@type": "ListItem", position: 2, name: "Data and reports", item: url }] },
      { "@type": "FAQPage", mainEntity: FAQS.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) },
    ],
  }

  return (
    <div className="mkt relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <MarketingHeader tone="night" />
      <main>
        <ProductHero
          crumb="Data and reports"
          eyebrow="Data and reports"
          icon={Database}
          title={<>Numbers <span className="mkt-gradient-text">without the export.</span></>}
          intro={<>Every request your processes handle is already data. Keep it in <strong className="text-white">data tables</strong> your workflows read and write, and report on it, and on the tasks and runs themselves, with <strong className="text-white">saved reports and charts</strong> that are always current.</>}
          primary={{ href: "/docs/reports", label: "Read the reports guide" }}
          secondary={{ href: "/docs/data-tables", label: "Data tables" }}
          scenes={["table", "report"]}
          demoLabel="Data and reports: purchase requests as a data table, then a report with charts"
          bullets={["Typed data tables your workflows write", "Up to eight charts per saved report", "OData for Excel and Power BI"]}
        />

        <section>
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
            <SectionHeading eyebrow="Building blocks" title="From a form to a figure, in one place.">
              The same tables feed forms, workflows, rules and reports, so the numbers match what actually happened.
            </SectionHeading>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {BLOCKS.map((block) => <FeatureCard key={block.title} icon={block.icon} title={block.title}>{block.body}</FeatureCard>)}
            </div>
            <DocLinks links={[{ href: "/docs/data-tables", label: "Data tables" }, { href: "/docs/reports", label: "Reports" }, { href: "/docs/decision-tables", label: "Decision tables" }, { href: "/docs/api", label: "REST API" }, { href: "/docs/mcp", label: "MCP server" }]} />
          </div>
        </section>

        <section className="border-y border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/60">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
            <SectionHeading eyebrow="Reports" title="Charts above, rows below, always current.">
              Pick a source, filter and group it, choose up to eight summary charts and save it. Read it in the app, from the API and MCP, or as an OData collection.
            </SectionHeading>
            <Shot name="home-activity" alt="Charts of tasks completed per day and median time to complete over the last 30 days" sizes="(min-width: 1152px) 640px, 100vw" />
          </div>
        </section>

        <section>
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.1fr_0.9fr]">
            <Shot name="forms-table-changes" alt="A form with an editable data table of vendors: one new row and three changed terms, ready to save" sizes="(min-width: 1152px) 640px, 100vw" />
            <div>
              <SectionHeading eyebrow="OData and the API" title="Your BI tools, connected in a minute.">
                Point Excel or Power BI at the OData feed, or call the REST API from anything else.
              </SectionHeading>
              <div className="mt-6"><Snippet code={`GET https://acme.usertasks.com/api/odata/$metadata\nAuthorization: Bearer <API key with read access>`} language="http" /></div>
              <p className="mt-3 flex items-center gap-2 text-sm text-(color:--mkt-muted)"><FileSpreadsheet size={15} aria-hidden="true" /> Works with Excel, Power BI and any OData client.</p>
            </div>
          </div>
        </section>

        <div className="border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-sand)/50"><FaqList faqs={FAQS} /></div>
      </main>
      <MarketingFooter />
    </div>
  )
}
