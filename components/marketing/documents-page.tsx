import type { CSSProperties, ReactNode } from "react"
import Link from "next/link"
import {
  ArrowRight,
  Check,
  EyeOff,
  FileDiff,
  FileInput,
  FileOutput,
  FileSearch,
  FileStack,
  FileText,
  Files,
  ScanText,
  ShieldCheck,
  TableProperties,
  Upload,
  Zap,
} from "lucide-react"
import { MarketingFooter, MarketingHeader, SectionHeading, Shot, Snippet } from "@/components/marketing/marketing-ui"
import { SCREENSHOTS } from "@/lib/docs/screenshots"
import { DOCUMENTS_PAGE } from "@/lib/marketing-pages"

/**
 * /documents — the document actions (Read, Compare, Convert, PDF Tools,
 * Extract, Redact, Inspect) and OCR. Facts follow /docs/workflows/documents
 * (lib/docs/content/documents.ts). Server-rendered.
 */

const SITE_URL = "https://usertasks.com"


const THEME = {
  "--theme-card-bg": "#FFFFFF",
  "--theme-card-text": "#1B1916",
  "--theme-surface": "#F5F2EA",
  "--theme-surface-border": "#E6E1D5",
  "--theme-muted-text": "#6E6759",
} as CSSProperties

const DOC = "/docs/workflows/documents"

const ACTIONS: Array<{ icon: typeof FileText; title: string; type: string; body: string; href: string }> = [
  { icon: FileText, title: "Read Document", type: "doc_read", body: "Any supported file into text, Markdown, sanitised HTML, metadata, structure — headings, tables, sheets, slides, comments, tracked changes, form fields — and rows to loop over.", href: `${DOC}/read-document` },
  { icon: FileDiff, title: "Compare Documents", type: "doc_compare", body: "Two versions of a document, spreadsheet or JSON: changes, statistics, similarity, a side-by-side HTML report and a Word or PDF redline.", href: `${DOC}/compare-documents` },
  { icon: FileOutput, title: "Convert Document", type: "doc_convert", body: "To PDF, Word, HTML, Markdown, plain text, CSV, Excel or JSON. Optional external converter for pixel-perfect Office to PDF.", href: `${DOC}/convert-document` },
  { icon: FileStack, title: "PDF Tools", type: "doc_pdf", body: "Merge, split, extract pages, count pages, watermark or stamp text, rotate, and fill or read form fields.", href: `${DOC}/pdf-tools` },
  { icon: TableProperties, title: "Extract from Document", type: "doc_extract", body: "Tables, named values by pattern, and emails, URLs, phone numbers, dates, amounts and percentages — straight into a data table if you like.", href: `${DOC}/extract` },
  { icon: EyeOff, title: "Redact Document", type: "doc_redact", body: "A copy without emails, phone and card numbers, IBANs and other personal data, or the words and patterns you choose.", href: `${DOC}/redact` },
  { icon: FileSearch, title: "Inspect Document", type: "doc_inspect", body: "The real file type from the content, checksums, word and character counts, reading time, and search with context.", href: `${DOC}/inspect-document` },
  { icon: ScanText, title: "Scanned PDFs and OCR", type: "ocr", body: "Pages without a text layer are found and recognised with tesseract.js, offline, or Azure AI Document Intelligence.", href: `${DOC}/ocr` },
]

const FORMATS: Array<{ name: string; read: string }> = [
  { name: "Word .docx", read: "Text, headings, lists, tables, links, comments, tracked changes" },
  { name: "Excel .xlsx", read: "Every sheet, typed values, formula results, header detection, ranges" },
  { name: "PowerPoint .pptx", read: "Slide titles, text and speaker notes" },
  { name: "PDF", read: "Text per page, outline, links, form fields, tables; scanned pages with OCR" },
  { name: "OpenDocument", read: ".odt, .ods (as sheets), .odp" },
  { name: "Markdown", read: "Including front matter" },
  { name: "HTML", read: "Scripts and active content dropped" },
  { name: "CSV, TSV", read: "Delimiter detected, quoted fields" },
  { name: "JSON, XML, YAML", read: "Parsed into structure; a list of objects becomes rows" },
  { name: "RTF and text", read: "Text" },
  { name: "Images", read: "PNG, JPEG, GIF, WebP, BMP, TIFF with OCR" },
]

const SECURITY = [
  { title: "ZIP bombs", body: "Office files are ZIP containers: the reader checks the directory first and inflates every part with a hard output cap." },
  { title: "No XXE", body: "XML with a DOCTYPE is refused; only the predefined entities expand, with bounded depth and node count." },
  { title: "Sanitised HTML", body: "HTML output is rebuilt from escaped text and passed through an allow-list sanitiser: no scripts, handlers or javascript: links." },
  { title: "Safe PDF parsing", body: "pdf.js with eval off and no system fonts, so a crafted font cannot run code. Encrypted PDFs are refused clearly." },
  { title: "Your workspace only", body: "Files are read and written for the run's workspace; another workspace's file is simply not found. URLs go through the egress guard." },
  { title: "Nothing leaves", body: "The actions run in the app's own process with JavaScript libraries. Files only leave if you configure cloud OCR or an external converter." },
]

const HOW_TOS = [
  { href: `${DOC}/how-to/excel-to-data-table`, title: "Import an Excel file into a data table" },
  { href: `${DOC}/how-to/contract-redline`, title: "Redline two contract versions and email the changes" },
  { href: `${DOC}/how-to/extract-and-redact`, title: "Extract contact details and redact a copy" },
  { href: `${DOC}/how-to/invoice-pdf`, title: "Capture invoice PDFs into a table" },
]

const FAQS = [
  { question: "Which file formats can a workflow read?", answer: "Word, Excel and PowerPoint (.docx, .xlsx, .pptx), OpenDocument, PDF (scanned pages with OCR), Markdown, HTML, CSV and TSV, JSON, XML, YAML, RTF, plain text, and images with OCR. The type is detected from the file's content, not its name. Older .doc, .xls and .ppt files convert to PDF with the optional external converter." },
  { question: "Do documents leave my infrastructure?", answer: "No. The document actions run inside the app with JavaScript libraries and need no external service. A file only leaves if you choose a cloud OCR provider or point the optional Office-to-PDF converter at a service — and that should be one on your own network." },
  { question: "Can it produce a Word redline with tracked changes?", answer: "Yes. Compare Documents can write a Word redline as real tracked changes (or as formatting: green underline for inserted text, red strike-through for deleted), a PDF redline, and a side-by-side HTML report you can use as an email body." },
  { question: "How do I summarise or classify a document with AI?", answer: "Read Document turns the file into text or Markdown; a Run Agent step does the rest. Put {{document.markdown}} in the agent's prompt, give the agent declared outputs such as risk and summary, and branch on them." },
  { question: "Where do the files come from and go to?", answer: "In: a form's Attachments field, a User Task, an HTTP download, storage connectors, a URL or inline content. Out: file objects saved to your configured storage, which the next step can email, upload, loop over, read again or hand to an AI agent." },
]

function Points({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-6 space-y-2 text-sm leading-6 text-[#4A463E]">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-[#4F7A5B]" aria-hidden="true" /><span>{item}</span></li>
      ))}
    </ul>
  )
}

function DocLinks({ links }: { links: Array<{ href: string; label: string }> }) {
  return (
    <p className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="inline-flex items-center gap-1 font-semibold text-[#8A6D45] hover:underline">{link.label} <ArrowRight size={14} aria-hidden="true" /></Link>
      ))}
    </p>
  )
}

export function DocumentsPage() {
  const url = `${SITE_URL}/${DOCUMENTS_PAGE.slug}`
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": `${url}#webpage`, url, name: DOCUMENTS_PAGE.title, description: DOCUMENTS_PAGE.description, isPartOf: { "@id": `${SITE_URL}/#website` }, about: { "@id": `${SITE_URL}/#software` }, primaryImageOfPage: `${SITE_URL}${SCREENSHOTS["documents-read"].src}` },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "UserTasks", item: SITE_URL }, { "@type": "ListItem", position: 2, name: DOCUMENTS_PAGE.eyebrow, item: url }] },
      { "@type": "FAQPage", mainEntity: FAQS.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) },
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
          <div className="mx-auto max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pt-20">
            <nav aria-label="Breadcrumb" className="text-xs text-[#857D6D]"><Link href="/" className="hover:text-[#8A6D45]">UserTasks</Link><span className="px-2">/</span><span aria-current="page">{DOCUMENTS_PAGE.eyebrow}</span></nav>
            <p className="mt-8 inline-flex items-center gap-2 rounded-full border border-[#8A6D45]/30 bg-[#B08A54]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#8A6D45]">
              <Files size={13} aria-hidden="true" /> {DOCUMENTS_PAGE.eyebrow}
            </p>
            <h1 className="mt-6 max-w-4xl font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl">Read, compare and transform documents inside your workflows.</h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-[#4A463E]">
              Seven workflow steps work with <strong className="text-[#1B1916]">Word, Excel, PowerPoint, PDF, Markdown and HTML</strong> files right in the run: read them into text and rows, redline two versions, convert and split, pull values into a data table, remove personal data. No document service to buy or host — scanned PDFs and pixel-perfect Office to PDF are optional add-ons.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href={DOC} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#17150F] px-6 py-3 font-semibold text-[#FAF8F3] shadow-lg shadow-[#17150F]/20 hover:bg-[#2E2A24]">
                Document actions guide <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <a href="#how-tos" className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#1B1916]/15 px-6 py-3 font-medium text-[#33302A] hover:border-[#1B1916]/30">
                Four how-to guides
              </a>
            </div>
            <div className="mt-12">
              <Shot name="documents-read" alt="The workflow designer with the document actions in the palette and Read Document reading an uploaded Excel workbook" sizes="(min-width: 1152px) 1104px, 100vw" priority />
            </div>
          </div>
        </section>

        {/* Actions */}
        <section id="actions" className="scroll-mt-8 border-t border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="The document actions" title="Seven steps, one palette group.">
              Find them under Operations in the designer, next to the Word, Excel and PowerPoint template steps that fill documents in.
            </SectionHeading>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {ACTIONS.map(({ icon: Icon, title, type, body, href }) => (
                <Link key={title} href={href} className="group flex flex-col rounded-2xl border border-[#1B1916]/[0.08] bg-[#FAF8F3] p-5 transition hover:border-[#8A6D45]/40 hover:shadow-md">
                  <span className="flex items-center justify-between gap-2">
                    <Icon size={20} className="text-[#8A6D45]" aria-hidden="true" />
                    <code className="font-mono text-[11px] text-[#857D6D]">{type}</code>
                  </span>
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-1 flex-1 text-sm leading-6 text-[#4A463E]">{body}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#8A6D45] group-hover:underline">Docs <ArrowRight size={14} aria-hidden="true" /></span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Formats */}
        <section id="formats" className="scroll-mt-8 border-t border-[#1B1916]/[0.07]">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-start gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[2fr_3fr]">
            <div>
              <SectionHeading eyebrow="Formats" title="The files your business actually runs on.">
                The type is detected from the content — magic bytes, the parts inside a ZIP, text sniffing — not from the name. A mismatch is reported as a warning.
              </SectionHeading>
              <Points items={[
                <>Text, Markdown and HTML in <code className="font-mono text-[0.85em]">{"{{document.text}}"}</code>, rows in <code className="font-mono text-[0.85em]">{"{{document_rows}}"}</code></>,
                "Metadata: title, author, dates, pages, word counts",
                "Limits you set per instance: size, unpacked size, pages, time",
              ]} />
              <DocLinks links={[{ href: `${DOC}#supported-formats`, label: "Supported formats" }, { href: `${DOC}#limits`, label: "Limits" }]} />
            </div>
            <div className="overflow-hidden rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF]/70">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">What Read Document reads from each format</caption>
                <thead className="border-b border-[#1B1916]/[0.08] bg-[#F1EDE3] text-xs uppercase tracking-wider text-[#6E6759]">
                  <tr><th scope="col" className="px-4 py-2.5 font-semibold">Format</th><th scope="col" className="px-4 py-2.5 font-semibold">What you get</th></tr>
                </thead>
                <tbody className="divide-y divide-[#1B1916]/[0.06]">
                  {FORMATS.map((format) => (
                    <tr key={format.name}><th scope="row" className="whitespace-nowrap px-4 py-2.5 align-top font-semibold">{format.name}</th><td className="px-4 py-2.5 text-[#4A463E]">{format.read}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Compare */}
        <section id="compare" className="scroll-mt-8 border-t border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Compare" title="Redline two versions. Send the changes.">
              Compare contracts word by word, spreadsheets cell by cell with rows matched on key columns, or JSON with the path of every change. Get a Word redline with real tracked changes, a PDF redline and a side-by-side report ready to email.
            </SectionHeading>
            <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <figure>
                <Shot name="documents-compare" alt="Compare Documents settings: original and revised contract, compare by words, Word redline with tracked changes" sizes="(min-width: 1024px) 540px, 100vw" />
                <figcaption className="mt-2 text-sm text-[#6E6759]">Two contract versions, by words, with a Word redline in tracked changes.</figcaption>
              </figure>
              <figure>
                <Shot name="documents-compare-report" alt="Side-by-side comparison report in an email: deleted words struck through in red, inserted words underlined in green" sizes="(min-width: 1024px) 540px, 100vw" />
                <figcaption className="mt-2 text-sm text-[#6E6759]">The side-by-side report, used as the body of an email.</figcaption>
              </figure>
            </div>
            <DocLinks links={[{ href: `${DOC}/compare-documents`, label: "Compare Documents" }, { href: `${DOC}/how-to/contract-redline`, label: "How to: contract redline" }]} />
          </div>
        </section>

        {/* Pipeline */}
        <section id="pipeline" className="scroll-mt-8 border-t border-[#1B1916]/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="In and out" title="Attachments in, documents out.">
              Every document field takes a file object, a list of files, a storage reference, a URL or inline content. Every output is a file object the next step can use.
            </SectionHeading>
            <ol className="mt-10 grid gap-4 md:grid-cols-3">
              {[
                { icon: Upload, title: "In", items: ["A form's Attachments field", "A User Task upload", "HTTP Request and Download File", "Storage connectors: S3, Azure Blob, SharePoint, OneDrive, Box, Google Drive"] },
                { icon: Zap, title: "In the run", items: ["Read, compare, convert, split, stamp", "Extract values and tables", "Redact personal data", "Loop over rows, branch on what was found"] },
                { icon: FileInput, title: "Out", items: ["Email with Send Email attachments", "Upload to storage or post to an API", "Insert rows into a data table", "Give the text to an AI agent"] },
              ].map(({ icon: Icon, title, items }, index) => (
                <li key={title} className="relative rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF]/70 p-5">
                  <span className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#17150F] text-xs font-bold text-[#FAF8F3]">{index + 1}</span><Icon size={18} className="text-[#8A6D45]" aria-hidden="true" /><h3 className="font-semibold">{title}</h3></span>
                  <ul className="mt-3 space-y-1.5 text-sm leading-6 text-[#4A463E]">
                    {items.map((item) => <li key={item} className="flex gap-2"><Check size={15} className="mt-1 shrink-0 text-[#4F7A5B]" aria-hidden="true" />{item}</li>)}
                  </ul>
                </li>
              ))}
            </ol>
            <div className="mt-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-[3fr_2fr]">
              <Shot name="documents-data-picker" alt="The Data panel listing Read Document's outputs: text, markdown, html, rows, metadata and structure" sizes="(min-width: 1024px) 650px, 100vw" />
              <div>
                <h3 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">Every output in the data picker.</h3>
                <p className="mt-3 leading-7 text-[#4A463E]">Read Document&rsquo;s text, Markdown, rows, metadata and structure appear with their fields, ready to drag into the next step. Run history shows a compact summary, never the whole document.</p>
                <Points items={[
                  <>Collect files with a <Link href="/forms" className="font-semibold text-[#8A6D45] hover:underline">form</Link>, read them in the next step</>,
                  "Summarise or classify with a Run Agent step",
                  "Write extracted rows to a data table, up to 5,000 a run",
                ]} />
              </div>
            </div>
            <div className="mt-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
              <div>
                <h3 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">Read, then ask an agent.</h3>
                <p className="mt-3 leading-7 text-[#4A463E]">There is no separate AI document step: Read Document turns the file into Markdown, and a Run Agent step with declared outputs summarises it, classifies it, and lets the workflow branch on the answer.</p>
                <DocLinks links={[{ href: `${DOC}#summarise-or-classify-with-ai`, label: "Summarise or classify with AI" }, { href: "/docs/agents", label: "AI agents" }]} />
              </div>
              <Snippet language="json" code={`[
  { "type": "doc_read", "label": "Read contract",
    "config": { "source": "{{form.contract}}", "max_chars": 60000,
                "output_var": "document" } },
  { "type": "run_agent", "label": "Summarise",
    "config": { "agent_name": "Contract reviewer",
      "user_message": "Five bullet points, then low, medium or high risk.\\n\\n{{document.markdown}}",
      "output_variable": "review" } }
]`} />
            </div>
          </div>
        </section>

        {/* Security */}
        <section id="security" className="scroll-mt-8 border-t border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Security" title="Built for files you didn't write.">
              Documents come from customers, suppliers and the internet. The readers assume the worst.
            </SectionHeading>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {SECURITY.map((item) => (
                <article key={item.title} className="rounded-2xl border border-[#1B1916]/[0.08] bg-[#FAF8F3] p-5">
                  <ShieldCheck size={20} className="text-[#4F7A5B]" aria-hidden="true" />
                  <h3 className="mt-3 font-semibold">{item.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-[#4A463E]">{item.body}</p>
                </article>
              ))}
            </div>
            <DocLinks links={[{ href: `${DOC}#security`, label: "Security details" }, { href: "/docs/tasks/forms#how-files-are-kept-safe", label: "How uploaded files are kept safe" }]} />
          </div>
        </section>

        {/* How-tos */}
        <section id="how-tos" className="scroll-mt-8 border-t border-[#1B1916]/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="How-to guides" title="Four workflows to copy." />
            <ul className="mt-10 grid gap-4 sm:grid-cols-2">
              {HOW_TOS.map((guide) => (
                <li key={guide.href}>
                  <Link href={guide.href} className="group flex h-full items-center justify-between gap-4 rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF]/70 p-5 transition hover:border-[#8A6D45]/40 hover:shadow-md">
                    <span className="font-semibold">{guide.title}</span>
                    <ArrowRight size={16} className="shrink-0 text-[#8A6D45]" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-10">
              <Shot name="documents-test-run" alt="Test run logs: Read Document read three rows from two sheets of a workbook, then a loop logged each order" sizes="(min-width: 1152px) 1104px, 100vw" />
              <p className="mt-3 text-sm text-[#6E6759]">Save &amp; Test: Read Document reports the format, sheets and rows; the loop runs once per row.</p>
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
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl">Put documents in the loop.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-[#4A463E]">Collect files with a form, read and compare them in the run, and send the result where it needs to go.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href={DOC} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#17150F] px-6 py-3 font-semibold text-[#FAF8F3] hover:bg-[#2E2A24]">Document actions guide <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link href="/forms" className="inline-flex items-center justify-center rounded-lg border border-[#1B1916]/15 px-6 py-3 font-medium text-[#33302A] hover:border-[#1B1916]/30">Forms and attachments</Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
