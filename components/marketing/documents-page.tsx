import type { CSSProperties, ReactNode } from "react"
import Link from "next/link"
import {
  ArrowRight,
  AudioLines,
  Captions,
  Check,
  EyeOff,
  FileDiff,
  FileInput,
  FileOutput,
  FileSearch,
  FileStack,
  FileText,
  Files,
  ScanEye,
  ScanFace,
  ScanText,
  ShieldCheck,
  TableProperties,
  Upload,
  Zap,
} from "lucide-react"
import { ProductHero } from "@/components/marketing/product-hero"
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
  "--theme-card-bg": "var(--mkt-white)",
  "--theme-card-text": "var(--mkt-ink)",
  "--theme-surface": "var(--mkt-canvas)",
  "--theme-surface-border": "var(--mkt-line)",
  "--theme-muted-text": "var(--mkt-muted)",
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
  { icon: ScanText, title: "Scanned PDFs and OCR", type: "ocr", body: "Pages without a text layer are found and recognised with your own Azure AI Document Intelligence key (set per workspace), or tesseract.js offline when self-hosted.", href: `${DOC}/ocr` },
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

const MEDIA = "/docs/workflows/media"

const MEDIA_ACTIONS: Array<{ icon: typeof FileText; title: string; body: string; href: string }> = [
  { icon: Captions, title: "Transcribe", body: "Audio and video to text with timestamps and speaker labels, plus SRT and VTT subtitle files.", href: `${MEDIA}/transcribe` },
  { icon: ScanEye, title: "Analyse images and video", body: "Describe, label and read the text in an image; summarise a video into scenes with timestamps.", href: `${MEDIA}/analyze-image` },
  { icon: ScanFace, title: "Blur what shouldn't be seen", body: "Blur, pixelate or cover faces, license plates and sensitive text such as ID numbers — in photos and video.", href: `${MEDIA}/redact-image` },
  { icon: AudioLines, title: "Generate images and speech", body: "Create or edit images from a prompt, and turn text into an audio file in a chosen voice.", href: `${MEDIA}/text-to-speech` },
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
  { question: "Where do images, audio and video go?", answer: "To the AI provider you choose in the step, with your own API key, and only when the step runs — data residency follows that provider and the region you configure. Run history never contains the media or full transcripts. Media Utilities (trim, convert, frames, subtitles) runs on your server with FFmpeg and sends nothing out." },
  { question: "Where do the files come from and go to?", answer: "In: a form's Attachments field, a User Task, an HTTP download, storage connectors, a URL or inline content. Out: file objects saved to your configured storage, which the next step can email, upload, loop over, read again or hand to an AI agent." },
]

function Points({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-6 space-y-2 text-sm leading-6 text-(color:--mkt-text)">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" /><span>{item}</span></li>
      ))}
    </ul>
  )
}

function DocLinks({ links }: { links: Array<{ href: string; label: string }> }) {
  return (
    <p className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">{link.label} <ArrowRight size={14} aria-hidden="true" /></Link>
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
    <div className="mkt relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)" style={THEME}>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-(color:--mkt-paper)" aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <MarketingHeader tone="night" />

      <main>
        {/* Hero */}
        <ProductHero
          crumb="Documents"
          eyebrow="Documents"
          icon={Files}
          title={<>Read, compare and transform documents <span className="mkt-gradient-text">inside your workflows.</span></>}
          intro={<>Seven workflow steps work with <strong className="text-white">Word, Excel, PowerPoint, PDF, Markdown and HTML</strong> files right in the run: read them into text and rows, redline two versions, convert and split, pull values into a data table, remove personal data. No document service to buy or host — scanned PDFs and pixel-perfect Office to PDF are optional add-ons.</>}
          primary={{ href: DOC, label: "Document actions guide" }}
          secondary={{ href: "#how-tos", label: "Four how-to guides" }}
        />
        <section className="relative">
          <div className="mx-auto max-w-6xl px-4 pb-6 pt-14 sm:px-6">
            <div className="mt-12">
              <Shot name="documents-read" alt="The workflow designer with the document actions in the palette and Read Document reading an uploaded Excel workbook" sizes="(min-width: 1152px) 1104px, 100vw" priority />
            </div>
          </div>
        </section>

        {/* Actions */}
        <section id="actions" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="The document actions" title="Seven steps, one palette group.">
              Find them under Operations in the designer, next to the Word, Excel and PowerPoint template steps that fill documents in.
            </SectionHeading>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {ACTIONS.map(({ icon: Icon, title, type, body, href }) => (
                <Link key={title} href={href} className="group flex flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-5 transition hover:border-(color:--mkt-bronze)/40 hover:shadow-md">
                  <span className="flex items-center justify-between gap-2">
                    <Icon size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                    <code className="font-mono text-2xs text-(color:--mkt-subtle)">{type}</code>
                  </span>
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-1 flex-1 text-sm leading-6 text-(color:--mkt-text)">{body}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) group-hover:underline">Docs <ArrowRight size={14} aria-hidden="true" /></span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Formats */}
        <section id="formats" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
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
            <div className="overflow-hidden rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">What Read Document reads from each format</caption>
                <thead className="border-b border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) text-xs uppercase tracking-wider text-(color:--mkt-muted)">
                  <tr><th scope="col" className="px-4 py-2.5 font-semibold">Format</th><th scope="col" className="px-4 py-2.5 font-semibold">What you get</th></tr>
                </thead>
                <tbody className="divide-y divide-(color:--mkt-ink)/[0.06]">
                  {FORMATS.map((format) => (
                    <tr key={format.name}><th scope="row" className="whitespace-nowrap px-4 py-2.5 align-top font-semibold">{format.name}</th><td className="px-4 py-2.5 text-(color:--mkt-text)">{format.read}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Compare */}
        <section id="compare" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Compare" title="Redline two versions. Send the changes.">
              Compare contracts word by word, spreadsheets cell by cell with rows matched on key columns, or JSON with the path of every change. Get a Word redline with real tracked changes, a PDF redline and a side-by-side report ready to email.
            </SectionHeading>
            <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <figure>
                <Shot name="documents-compare" alt="Compare Documents settings: original and revised contract, compare by words, Word redline with tracked changes" sizes="(min-width: 1024px) 540px, 100vw" />
                <figcaption className="mt-2 text-sm text-(color:--mkt-muted)">Two contract versions, by words, with a Word redline in tracked changes.</figcaption>
              </figure>
              <figure>
                <Shot name="documents-compare-report" alt="Side-by-side comparison report in an email: deleted words struck through in red, inserted words underlined in green" sizes="(min-width: 1024px) 540px, 100vw" />
                <figcaption className="mt-2 text-sm text-(color:--mkt-muted)">The side-by-side report, used as the body of an email.</figcaption>
              </figure>
            </div>
            <DocLinks links={[{ href: `${DOC}/compare-documents`, label: "Compare Documents" }, { href: `${DOC}/how-to/contract-redline`, label: "How to: contract redline" }]} />
          </div>
        </section>

        {/* Pipeline */}
        <section id="pipeline" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
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
                <li key={title} className="relative rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-5">
                  <span className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-(color:--mkt-primary) text-xs font-bold text-(color:--mkt-paper)">{index + 1}</span><Icon size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" /><h3 className="font-semibold">{title}</h3></span>
                  <ul className="mt-3 space-y-1.5 text-sm leading-6 text-(color:--mkt-text)">
                    {items.map((item) => <li key={item} className="flex gap-2"><Check size={15} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{item}</li>)}
                  </ul>
                </li>
              ))}
            </ol>
            <div className="mt-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-[3fr_2fr]">
              <Shot name="documents-data-picker" alt="The Data panel listing Read Document's outputs: text, markdown, html, rows, metadata and structure" sizes="(min-width: 1024px) 650px, 100vw" />
              <div>
                <h3 className="font-display text-2xl font-bold tracking-tight">Every output in the data picker.</h3>
                <p className="mt-3 leading-7 text-(color:--mkt-text)">Read Document&rsquo;s text, Markdown, rows, metadata and structure appear with their fields, ready to drag into the next step. Run history shows a compact summary, never the whole document.</p>
                <Points items={[
                  <>Collect files with a <Link href="/forms" className="font-semibold text-(color:--mkt-bronze) hover:underline">form</Link>, read them in the next step</>,
                  "Summarise or classify with a Run Agent step",
                  "Write extracted rows to a data table, up to 5,000 a run",
                ]} />
              </div>
            </div>
            <div className="mt-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
              <div>
                <h3 className="font-display text-2xl font-bold tracking-tight">Read, then ask an agent.</h3>
                <p className="mt-3 leading-7 text-(color:--mkt-text)">There is no separate AI document step: Read Document turns the file into Markdown, and a Run Agent step with declared outputs summarises it, classifies it, and lets the workflow branch on the answer.</p>
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

        {/* Media */}
        <section id="media" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Images, audio and video" title="Recordings and photos are documents too.">
              Eight more steps work with media: transcribe, analyse, redact, generate, and trim or convert. They use the AI provider you connect with your own API key — OpenAI, Google Gemini, Azure AI, AWS, Deepgram, AssemblyAI, ElevenLabs or Stability AI — and media is sent to that provider only when a step runs.
            </SectionHeading>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {MEDIA_ACTIONS.map(({ icon: Icon, title, body, href }) => (
                <Link key={title} href={href} className="group flex flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-5 transition hover:border-(color:--mkt-bronze)/40 hover:shadow-md">
                  <Icon size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-1 flex-1 text-sm leading-6 text-(color:--mkt-text)">{body}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) group-hover:underline">Docs <ArrowRight size={14} aria-hidden="true" /></span>
                </Link>
              ))}
            </div>
            <DocLinks links={[{ href: "/media", label: "Images, audio and video" }, { href: MEDIA, label: "Media actions guide" }, { href: `${MEDIA}/how-to/transcribe-meeting`, label: "How to: transcribe a meeting and email the summary" }]} />
          </div>
        </section>

        {/* Security */}
        <section id="security" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Security" title="Built for files you didn't write.">
              Documents come from customers, suppliers and the internet. The readers assume the worst.
            </SectionHeading>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {SECURITY.map((item) => (
                <article key={item.title} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-5">
                  <ShieldCheck size={20} className="text-(color:--mkt-green)" aria-hidden="true" />
                  <h3 className="mt-3 font-semibold">{item.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{item.body}</p>
                </article>
              ))}
            </div>
            <DocLinks links={[{ href: `${DOC}#security`, label: "Security details" }, { href: "/docs/tasks/forms#how-files-are-kept-safe", label: "How uploaded files are kept safe" }]} />
          </div>
        </section>

        {/* How-tos */}
        <section id="how-tos" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="How-to guides" title="Four workflows to copy." />
            <ul className="mt-10 grid gap-4 sm:grid-cols-2">
              {HOW_TOS.map((guide) => (
                <li key={guide.href}>
                  <Link href={guide.href} className="group flex h-full items-center justify-between gap-4 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-5 transition hover:border-(color:--mkt-bronze)/40 hover:shadow-md">
                    <span className="font-semibold">{guide.title}</span>
                    <ArrowRight size={16} className="shrink-0 text-(color:--mkt-bronze)" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-10">
              <Shot name="documents-test-run" alt="Test run logs: Read Document read three rows from two sheets of a workbook, then a loop logged each order" sizes="(min-width: 1152px) 1104px, 100vw" />
              <p className="mt-3 text-sm text-(color:--mkt-muted)">Save &amp; Test: Read Document reports the format, sheets and rows; the loop runs once per row.</p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
          <h2 className="text-center font-display text-3xl font-bold tracking-tight">Questions</h2>
          <div className="mt-8 space-y-3">
            {FAQS.map((faq) => (
              <details key={faq.question} className="group rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) p-5">
                <summary className="cursor-pointer list-none"><h3 className="inline font-semibold">{faq.question}</h3></summary>
                <p className="mt-3 text-sm leading-7 text-(color:--mkt-muted)">{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="rounded-3xl border border-(color:--mkt-ink)/10 bg-gradient-to-br from-(color:--mkt-primary)/[0.06] via-transparent to-(color:--mkt-gold)/[0.12] p-8 text-center sm:p-14">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Put documents in the loop.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-(color:--mkt-text)">Collect files with a form, read and compare them in the run, and send the result where it needs to go.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href={DOC} className="inline-flex items-center justify-center gap-2 rounded-lg bg-(color:--mkt-primary) px-6 py-3 font-semibold text-(color:--mkt-paper) hover:bg-(color:--mkt-primary-hover)">Document actions guide <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link href="/forms" className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">Forms and attachments</Link>
              <Link href="/media" className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">Images, audio and video</Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
