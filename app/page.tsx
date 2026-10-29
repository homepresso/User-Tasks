import { redirect } from "next/navigation"
import { getSessionUserFast } from "@/lib/supabase/server"
import { LandingPage } from "@/components/marketing/landing-page"
import { isCloud, publicBaseUrl } from "@/lib/deployment"
import { repositoryUrl } from "@/lib/site-links"

export const metadata = {
  title: "UserTasks: Open-Source Headless Workflow Engine",
  description:
    "UserTasks is an open-source headless workflow engine: visual designer, human tasks, grid forms, document actions, integrations, decision tables and optional AI agents, driven from a REST API, an MCP server and a CLI — with log export to Splunk, Datadog, OpenTelemetry and webhooks.",
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
    title: "UserTasks: Open-Source Headless Workflow Engine",
    description: "Design workflows visually or as JSON, put people in the loop, connect any API — and drive it all from the API, MCP or the usertasks CLI. Ship every event to Splunk, Datadog or OpenTelemetry.",
    url: "/",
    type: "website",
  },
}

export default async function Home() {
  if (await getSessionUserFast()) {
    redirect("/tasks")
  }
  if (!isCloud()) {
    redirect("/login")
  }

  const baseUrl = publicBaseUrl()
  // Repository references only once the public repository exists.
  const repoUrl = repositoryUrl()
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${baseUrl}/#website`, url: baseUrl, name: "UserTasks", description: metadata.description },
      { "@type": "Organization", "@id": `${baseUrl}/#organization`, name: "UserTasks", url: baseUrl, logo: `${baseUrl}/brand/mark-512.png`, ...(repoUrl ? { sameAs: [repoUrl] } : {}) },
      {
        "@type": "SoftwareApplication",
        "@id": `${baseUrl}/#software`,
        name: "UserTasks",
        url: baseUrl,
        description: metadata.description,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Headless workflow engine",
        operatingSystem: "Web browser; managed cloud, private, or on-premises deployment",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Open source (Apache-2.0)" },
        featureList: ["Workflow engine", "Visual workflow designer", "REST, OData, database, webhook, and OAuth integrations", "Task list with SLAs, escalation, and audit trails", "Grid form designer with lookups, file uploads, form pages and QR codes", "Document actions: read, compare, convert, extract and redact Word, Excel, PowerPoint and PDF files", "Decision tables", "Optional AI agents", "Reports with a reporting API and MCP server", "Command-line interface with config as code", "Log export to Splunk, Datadog, OpenTelemetry and webhooks", "Cloud and on-premises deployment"],
        publisher: { "@id": `${baseUrl}/#organization` },
        ...(repoUrl ? { sameAs: [repoUrl] } : {}),
      },
      // codeRepository belongs to SoftwareSourceCode, not SoftwareApplication.
      ...(repoUrl
        ? [{ "@type": "SoftwareSourceCode", "@id": `${baseUrl}/#source`, name: "UserTasks", codeRepository: repoUrl, license: "https://www.apache.org/licenses/LICENSE-2.0", programmingLanguage: "TypeScript", targetProduct: { "@id": `${baseUrl}/#software` } }]
        : []),
    ],
  }

  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} /><LandingPage /></>
}
