import { redirect } from "next/navigation"
import { getSessionUserFast } from "@/lib/supabase/server"
import { HOME_FAQS, LandingPage } from "@/components/marketing/landing-page"
import { isCloud, publicBaseUrl } from "@/lib/deployment"
import { repositoryUrl } from "@/lib/site-links"
import { enforceHostWorkspace } from "@/lib/workspace-host"
import { siteGraph } from "@/lib/seo/site"
import { redirectToSetupIfNeeded } from "@/lib/setup/server"

export const metadata = {
  title: "UserTasks: The Open Source Process Platform",
  description:
    "UserTasks is the open source process platform: a visual designer for complex workflows, human tasks, grid forms, document actions, integrations with any system, decision tables, AI agents in workflows and Agent, an AI co-worker in every screen, on any model, driven from a REST API, an MCP server and a CLI — with log export to Splunk, Datadog, OpenTelemetry and webhooks.",
  keywords: [
    "headless workflow engine",
    "open source workflow engine",
    "workflow automation",
    "workflow designer",
    "decision tables",
    "workflow reporting API",
    "BPM",
    "on premises workflow automation",
    "workflow CLI",
    "workflow log export",
    "Splunk workflow logs",
    "OpenTelemetry logs",
  ],
  alternates: { canonical: "/" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  openGraph: {
    title: "UserTasks: The Open Source Process Platform",
    description: "Workflows, forms, tasks and an AI Agent in one open source platform. Describe a process and the Agent builds it; run it in our cloud or on your own servers.",
    url: "/",
    type: "website",
    siteName: "UserTasks",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "UserTasks: The Open Source Process Platform",
    description: "Workflows, forms, tasks and an AI Agent in one open source platform. Run it in our cloud or on your own servers.",
  },
}

export default async function Home() {
  // A workspace address (acme.usertasks.com) opens the app, never the landing page.
  if ((await enforceHostWorkspace()).kind === "member") redirect("/home")
  if (await getSessionUserFast()) {
    redirect("/home")
  }
  if (!isCloud()) {
    // A brand-new self-hosted install: create the admin account first.
    await redirectToSetupIfNeeded()
    redirect("/login")
  }

  const baseUrl = publicBaseUrl()
  // Repository references only once the public repository exists.
  const repoUrl = repositoryUrl()
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      ...siteGraph(baseUrl, { description: metadata.description, repoUrl, featureList: ["Workflow engine", "Visual designer for complex workflows: branches, parallel paths, loops, sub-workflows, SLAs, timers, events and error paths", "Save & Test with real forms; versions and live instance migration", "REST, OData, database, webhook, and OAuth integrations", "One task list with queued tasks, personal queue rules, attachments, SLAs, escalation and audit trails", "Grid form designer with lookups, file uploads, survey controls, rules, form pages, QR codes and website embedding", "Form wizard: a form, its approval workflow and a responses report with charts from a few questions", "Document actions: read, compare, convert, extract and redact Word, Excel, PowerPoint and PDF files", "Decision tables", "AI agents on Claude, OpenAI, Gemini, Mistral, local and other OpenAI-compatible models, with tools, files and human review", "Agent: an AI co-worker in every screen that helps fill forms, work tasks and design workflows, on your own provider key; it proposes, people apply and confirm", "Ready-made connectors for databases, storage, email, messaging, CRM, ERP and HR systems", "Reports with summary charts, a reporting API and MCP server", "Command-line interface with config as code", "Log export to Splunk, Datadog, OpenTelemetry and webhooks", "Cloud and on-premises deployment"] }),
      { "@type": "WebPage", "@id": `${baseUrl}/#webpage`, url: baseUrl, name: metadata.title, description: metadata.description, inLanguage: "en", isPartOf: { "@id": `${baseUrl}/#website` }, about: { "@id": `${baseUrl}/#software` } },
      { "@type": "FAQPage", "@id": `${baseUrl}/#faq`, mainEntity: HOME_FAQS.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) },
      // codeRepository belongs to SoftwareSourceCode, not SoftwareApplication.
      ...(repoUrl
        ? [{ "@type": "SoftwareSourceCode", "@id": `${baseUrl}/#source`, name: "UserTasks", codeRepository: repoUrl, license: "https://www.apache.org/licenses/LICENSE-2.0", programmingLanguage: "TypeScript", targetProduct: { "@id": `${baseUrl}/#software` } }]
        : []),
    ],
  }

  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} /><LandingPage /></>
}
