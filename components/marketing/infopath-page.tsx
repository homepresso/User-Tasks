import type { CSSProperties } from "react"
import Link from "next/link"
import { ArrowRight, Check, FileStack, Lock, Minus, X } from "lucide-react"
import { ProductHero } from "@/components/marketing/product-hero"
import { MarketingFooter, MarketingHeader, SectionHeading } from "@/components/marketing/marketing-ui"
import { InfoPathPreview } from "@/components/marketing/infopath-preview"
import { INFOPATH_PAGE } from "@/lib/marketing-pages"
import { publicBaseUrl } from "@/lib/deployment"
import { breadcrumbNode, displayDate, faqNode, howToNode, jsonLdHtml, webPageNode } from "@/lib/seo/site"

/**
 * /infopath — "Migrate from InfoPath": drop an .xsn into the hero for an
 * analyze-only preview (POST /api/public/infopath/analyze, nothing stored),
 * then what maps, what doesn't, how it works, privacy and an FAQ.
 */

const THEME = {
  "--theme-card-bg": "var(--mkt-white)",
  "--theme-card-text": "var(--mkt-ink)",
  "--theme-surface": "var(--mkt-canvas)",
  "--theme-surface-border": "var(--mkt-line)",
  "--theme-muted-text": "var(--mkt-muted)",
} as CSSProperties

const MAPS: Array<[string, string]> = [
  ["Each view", "A form of its own, “Expense Report — Approval”. Or all views as steps of one form."],
  ["Text boxes, date pickers, drop-downs, option buttons, check boxes", "Text, number, currency, date, choice, radio and yes / no fields, typed from your data source"],
  ["Repeating tables", "List fields: an editable table with a column per control, nested tables as nested Lists, row arithmetic as calculated columns"],
  ["Repeating sections", "Repeating sections: a card per item with the same controls and layout, nested up to 3 levels"],
  ["Pictures, signatures and ink", "Image fields (camera on phones), display images for logos, electronic signature fields — also per row of a repeating table (a signature column) and per item of a repeating section"],
  ["Rich text, list boxes, people pickers, bulleted lists", "Rich text, multi-select list boxes, people pickers and text lists"],
  ["Choice groups", "Choice groups: one alternative section at a time, with a switch"],
  ["Sections and optional sections", "Sections and optional sections, with their show conditions"],
  ["Layout tables", "Rows of up to four columns, in the same order"],
  ["“Cannot be blank”, patterns, ranges", "Required, pattern, min / max and length checks, enforced on the server"],
  ["Default values and formulas", "Defaults, form-load rules and calculated values that keep their number, currency or percent format"],
  ["XPath functions", "substring-before / after, translate, normalize-space, starts-with, Nz, Avg, Max, Min, xdUtil:Concat; sum and count with a filter become SUMIF / COUNTIF; xdMath:Eval becomes a calculated List column"],
  ["Rules on fields, buttons and form load", "Form rules: set values, show messages, hide, make read only, go to step"],
  ["Data validation", "Field errors that block submit, in the browser and again on the server; on repeating fields, List column and row validations"],
  ["Conditional formatting", "“Always” rules that hide, lock or style while the condition holds: font colour, font size and font, shading, bold, italic, underline, strikethrough, with colours snapped to your theme; in a repeating table, row styles and cells hidden or locked row by row (locked cells keep their saved value on the server), and whole columns hidden by a condition on the form"],
  ["Fonts, sizes and colours in the view", "Font size, font, colour, bold, italic and underline on labels, values, table headers and cells, mapped to web-safe fonts (Calibri, Segoe UI, Arial, Verdana, Tahoma, Times New Roman, Georgia, Courier New) or to the matching Google font for anything else Google Fonts has (served from your own site, never from Google), and kept readable in dark mode; the view's usual font is left to your theme"],
  ["User roles, get-Role(), user names", "Conditions on the person's workspace roles; userName() and get-DisplayName() become the signed-in person's email and name"],
]

const LEFT_OUT = [
  "Data connections (SharePoint lists, web services, databases) without a data table or API integration of the same name: create one and import again, and they connect",
  "Secondary data sources read in formulas (GetDOM), position() and last() in formulas, and filters other than one “=” comparison",
  "Form code (JScript, C#, managed code) is never run",
  "Certificates on digital signatures (they become electronic signatures)",
  "Nesting deeper than 3 levels, and fonts that are neither web-safe nor on Google Fonts (they fall back to your theme's font)",
  "Person fields on a form shared publicly: anonymous visitors don't see them",
  "Rules that convert only in part: the converted actions run, the rest is in the rule's notes",
]

const STEPS = [
  { title: "Drop your .xsn", body: "Up here, or in the app: Forms → Import → InfoPath form. We unpack the template and read every view, rule and validation." },
  { title: "Check the report", body: "Each view, each field and each rule, with what it becomes. The items that need a person are listed and kept as notes, never dropped." },
  { title: "Import", body: "One form per view, ready in the designer. Optionally a data table for the submissions and a workflow that saves them." },
]

/** Dated facts, from Microsoft's own pages (checked on INFOPATH_FACTS_CHECKED). */
const INFOPATH_FACTS_CHECKED = "2026-11-11"
const EOL_FACTS = [
  { date: "May 18, 2026", text: "Publishing new InfoPath forms, or updates to existing ones, blocked in SharePoint Online." },
  { date: "July 14, 2026", text: "InfoPath 2013 reached the end of extended support, and InfoPath Forms Services was removed from SharePoint Online with no option to extend." },
  { date: "July 14, 2026", text: "Extended support for InfoPath Forms Services in SharePoint Server 2016, 2019 and Subscription Edition ended." },
]
const EOL_SOURCES = [
  { label: "Microsoft Tech Community: Support update for InfoPath Forms Services in Microsoft 365", href: "https://techcommunity.microsoft.com/blog/spblog/support-update-for-infopath-forms-services-in-microsoft-365/3858190" },
  { label: "Microsoft Lifecycle: InfoPath 2013", href: "https://learn.microsoft.com/en-us/lifecycle/products/infopath-2013" },
]

const FAQS = [
  { question: "What is the UserTasks InfoPath importer?", answer: "It is a converter built into UserTasks, an open-source forms and workflow platform. It reads a Microsoft InfoPath form template (.xsn) and rebuilds each view as a UserTasks form, converting fields, repeating tables and sections, pictures, signatures, conditional formatting, rules, validation and formulas where they translate, and listing everything else in a report." },
  { question: "When did InfoPath support end?", answer: "InfoPath 2013 reached the end of extended support on July 14, 2026. On the same date Microsoft removed InfoPath Forms Services from SharePoint Online, and extended support for InfoPath Forms Services in SharePoint Server 2016, 2019 and Subscription Edition ended. Publishing new forms to SharePoint Online was blocked from May 18, 2026." },
  { question: "Is my file stored?", answer: "No. The preview on this page reads the file in memory, sends back a summary and forgets it. Nothing is written to disk or a database, and our logs record only counts (how many views, fields and rules), never names or content. When you choose “Create these forms”, the file waits in your own browser until the importer opens it." },
  { question: "Which InfoPath versions work?", answer: "Form templates from InfoPath 2007, 2010 and 2013, including browser-enabled forms for SharePoint and InfoPath Forms Services. Templates are CAB archives with MSZIP compression, which is what InfoPath saves. A template re-packed with LZX compression is refused with a message: save it again from InfoPath Designer, or upload a .zip of its source files." },
  { question: "What happens to rules that don't convert?", answer: "Each one becomes a turned-off rule on the form, named after the InfoPath rule, with the original XPath in its notes, and is listed in the import report. You finish it in the Rules tab. Nothing is dropped silently." },
  { question: "My form reads a SharePoint list. Will that work?", answer: "Data connections don't move by themselves. Export the list from SharePoint as CSV or Excel and import it straight into a data table with the same name (Create from file infers the columns), or add an integration for the service. Then import the form again: query rules use it. Until then the report says what each connection was for." },
  { question: "How big can the file be?", answer: "Up to 4 MB here and in the app. Images make most templates large: export the source files from InfoPath Designer, zip them without the images and upload the .zip. Self-hosted instances accept up to 20 MB through the API and CLI." },
  { question: "What does it cost?", answer: "The preview is free and needs no account. UserTasks is open source (Apache-2.0): run it on your own servers, or use the cloud edition, free during the beta." },
]

export function InfoPathPage() {
  const baseUrl = publicBaseUrl()
  const jsonLd = [
    webPageNode(baseUrl, `/${INFOPATH_PAGE.slug}`, { name: INFOPATH_PAGE.title, description: INFOPATH_PAGE.description, updated: INFOPATH_FACTS_CHECKED }),
    breadcrumbNode(baseUrl, [{ name: INFOPATH_PAGE.eyebrow, path: `/${INFOPATH_PAGE.slug}` }]),
    howToNode("Migrate an InfoPath form to UserTasks", STEPS, { description: "Upload a Microsoft InfoPath form template (.xsn), check the conversion report and import the forms.", totalTime: "PT10M" }),
    faqNode(FAQS),
  ]

  return (
    <div className="mkt relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)" style={THEME}>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-(color:--mkt-paper)" aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <MarketingHeader tone="night" />
      <main>
        <ProductHero
          crumb="Migrate from InfoPath"
          eyebrow={INFOPATH_PAGE.eyebrow}
          icon={FileStack}
          title={<>Bring your InfoPath forms <span className="mkt-gradient-text">to UserTasks.</span></>}
          intro={<>InfoPath is retired, but your forms still do real work. Drop in an .xsn and see it rebuilt: every view a form, repeating tables as Lists, repeating sections, pictures, signatures, conditional formatting, and the rules, validation and formulas — <strong className="text-white">converted for you</strong>. What doesn't is listed plainly, never lost.</>}
          primary={{ href: "#try", label: "Try it with your form" }}
          secondary={{ href: "/docs/tasks/import-infopath", label: "Read how it maps" }}
          bullets={["Free preview, no account", "Nothing stored", "One form per view, or views as steps"]}
          visual={<div id="try" className="scroll-mt-24"><InfoPathPreview /></div>}
        />

        <section id="end-of-support" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <SectionHeading eyebrow="InfoPath end of support" title="InfoPath is out of support. Your forms don't have to be.">
                The UserTasks InfoPath importer reads a Microsoft InfoPath form template (.xsn) and rebuilds it as UserTasks forms: one per view, with fields, repeating tables, rules, validation and formulas converted where they translate. UserTasks is open source (Apache-2.0) and runs in our cloud or on your own servers.
              </SectionHeading>
              <p className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <Link href="/infopath-migration-guide" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Read the InfoPath migration guide <ArrowRight size={14} aria-hidden="true" /></Link>
                <Link href="/sharepoint-workflow-migration" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">SharePoint workflow migration <ArrowRight size={14} aria-hidden="true" /></Link>
              </p>
            </div>
            <div>
              <ol className="space-y-3">
                {EOL_FACTS.map((fact) => (
                  <li key={fact.text} className="grid gap-1 rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-4 sm:grid-cols-[8.5rem_1fr] sm:gap-4">
                    <span className="font-semibold text-(color:--mkt-bronze)">{fact.date}</span>
                    <span className="text-sm leading-6 text-(color:--mkt-text)">{fact.text}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 text-xs leading-5 text-(color:--mkt-muted)">
                Sources: {EOL_SOURCES.map((source, i) => <span key={source.href}>{i > 0 && " · "}<a href={source.href} rel="noopener" className="text-(color:--mkt-bronze) hover:underline">{source.label}</a></span>)}. Last checked <time dateTime={INFOPATH_FACTS_CHECKED}>{displayDate(INFOPATH_FACTS_CHECKED)}</time>.
              </p>
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="How it works" title="Three steps, about ten minutes.">
              The same importer runs here, in the app, through the REST API and MCP, from the CLI and in the Agent panel.
            </SectionHeading>
            <ol className="mt-10 grid gap-4 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-6" data-reveal>
                  <span className="flex size-8 items-center justify-center rounded-full bg-(color:--mkt-ink) font-semibold text-white">{i + 1}</span>
                  <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="maps" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="What maps" title="Fields, repeating tables and sections, formatting, rules, validation and formulas.">
              The importer reads the template&apos;s data source for types and required fields, each view for controls, labels and layout, and the manifest for rules, validation and calculations. XPath conditions and formulas become UserTasks conditions and expression functions.
            </SectionHeading>
            <div className="mt-10 overflow-hidden rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)">
              <table className="w-full text-left text-sm">
                <thead className="bg-(color:--mkt-sand) text-xs uppercase tracking-wider text-(color:--mkt-muted)"><tr><th scope="col" className="px-4 py-3">In InfoPath</th><th scope="col" className="px-4 py-3">In UserTasks</th></tr></thead>
                <tbody>
                  {MAPS.map(([from, to]) => (
                    <tr key={from} className="border-t border-(color:--mkt-ink)/[0.06] align-top">
                      <td className="px-4 py-3 font-semibold">{from}</td>
                      <td className="px-4 py-3 text-(color:--mkt-text)"><Check size={14} className="mr-1.5 inline text-(color:--mkt-green)" aria-hidden="true" />{to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-6" data-reveal>
                <h3 className="flex items-center gap-2 text-lg font-semibold"><Minus size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />What still needs a person</h3>
                <ul className="mt-4 space-y-2 text-sm leading-6 text-(color:--mkt-text)">
                  {LEFT_OUT.map((t) => <li key={t} className="flex gap-2"><X size={16} className="mt-1 shrink-0 text-(color:--mkt-coral)" aria-hidden="true" />{t}</li>)}
                </ul>
                <p className="mt-4 text-sm text-(color:--mkt-muted)">Each one is in the report, and behaviour is kept as a turned-off rule with the original expression, so you finish it rather than rediscover it.</p>
              </div>
              <div className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-6" data-reveal>
                <h3 className="flex items-center gap-2 text-lg font-semibold"><Lock size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />Privacy</h3>
                <ul className="mt-4 space-y-2 text-sm leading-6 text-(color:--mkt-text)">
                  {[
                    "The preview reads your file in memory and forgets it: nothing is stored",
                    "Only a summary comes back: no raw expressions, list addresses or file contents",
                    "Logs keep counts only, never names or content",
                    "Form code in a template is never run",
                    "Templates are checked before they are read: size, file count and unpacked size, with no external XML entities",
                  ].map((t) => <li key={t} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{t}</li>)}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="FAQ" title="Questions people ask before they migrate." />
            <div className="mt-10 space-y-3">
              {FAQS.map((faq) => (
                <details key={faq.question} className="group rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) p-5">
                  <summary className="cursor-pointer list-none"><h3 className="inline font-semibold">{faq.question}</h3></summary>
                  <p className="mt-3 text-sm leading-7 text-(color:--mkt-muted)">{faq.answer}</p>
                </details>
              ))}
            </div>
            <p className="mt-10 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <Link href="/docs/tasks/import-infopath" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Import InfoPath forms (docs) <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/docs/tutorials/migrate-infopath" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Tutorial: migrate an expense report <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/infopath-migration-guide" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">InfoPath migration guide <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/sharepoint-workflow-migration" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Replace SharePoint workflows <ArrowRight size={14} aria-hidden="true" /></Link>
            </p>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  )
}
