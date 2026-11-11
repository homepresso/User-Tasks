import type { CSSProperties, ReactNode } from "react"
import Link from "next/link"
import {
  ArrowRight,
  AudioLines,
  Bot,
  Captions,
  Check,
  Clapperboard,
  Clock,
  Container,
  Film,
  ImagePlus,
  KeyRound,
  Lock,
  Receipt,
  ScanEye,
  ScanFace,
  ShieldCheck,
  VideoOff,
  Waves,
} from "lucide-react"
import { ProductHero } from "@/components/marketing/product-hero"
import { DocLinks, FaqList, FeatureCard, InlineCode as BaseInlineCode, MarketingFooter, MarketingHeader, Pill, SectionHeading, Shot, Snippet } from "@/components/marketing/marketing-ui"
import { SCREENSHOTS } from "@/lib/docs/screenshots"
import { PATTERN_INFO_TYPES } from "@/lib/documents/pii/catalog"
import { MEDIA_CAPABILITY_LABELS, MEDIA_NODE_TYPES, MEDIA_PROVIDERS, MEDIA_STEP_LABELS, MEDIA_TOOL_OPERATIONS, type MediaNodeType } from "@/lib/media/catalog"
import { MEDIA_PAGE } from "@/lib/marketing-pages"
import { useCasesInGroup } from "@/lib/use-cases"
import { UseCaseCard } from "@/components/marketing/use-case-page"

/**
 * /media — the media steps (lib/media): Transcribe, Analyze Image / Video,
 * Redact Image / Video, Generate / Edit Image, Text to Speech and Media
 * Utilities. The provider grid and capability matrix are generated from
 * lib/media/catalog.ts; facts follow /docs/workflows/media
 * (lib/docs/content/media.ts). Server-rendered.
 */

const SITE_URL = "https://usertasks.com"

const THEME = {
  "--theme-card-bg": "var(--mkt-white)",
  "--theme-card-text": "var(--mkt-ink)",
  "--theme-surface": "var(--mkt-canvas)",
  "--theme-surface-border": "var(--mkt-line)",
  "--theme-muted-text": "var(--mkt-muted)",
} as CSSProperties

const DOC = "/docs/workflows/media"

/** "51" → "50+" — stays true as types are added. */
const INFO_TYPE_COUNT = `${Math.floor(PATTERN_INFO_TYPES.length / 10) * 10}+`
const PROVIDER_STEPS = MEDIA_NODE_TYPES.filter((type) => type !== "media_tools").length

const STEPS: Record<MediaNodeType, { icon: typeof Captions; body: string; href: string }> = {
  media_transcribe: { icon: Captions, body: "Speech to text with timestamps, speaker labels, word timings and SRT, VTT, TXT or JSON files.", href: `${DOC}/transcribe` },
  media_analyze_image: { icon: ScanEye, body: "Describe, label, read text, locate faces and objects, check safety — or answer a question as named fields.", href: `${DOC}/analyze-image` },
  media_analyze_video: { icon: Film, body: "A summary, scenes with timestamps, labels, on-screen text and key frames.", href: `${DOC}/analyze-video` },
  media_redact_image: { icon: ScanFace, body: "Blur, pixelate or box faces, license plates and sensitive text — or only report where they are.", href: `${DOC}/redact-image` },
  media_redact_video: { icon: VideoOff, body: "The same over time in a video, and bleep or mute sensitive speech, also in audio-only files.", href: `${DOC}/redact-video` },
  media_generate_image: { icon: ImagePlus, body: "Create images from a prompt, or edit one with a mask.", href: `${DOC}/generate-image` },
  media_tts: { icon: AudioLines, body: "Turn text into an audio file in a chosen voice.", href: `${DOC}/text-to-speech` },
  media_tools: { icon: Clapperboard, body: "Media info, extract audio or frames, thumbnail, trim, convert, compress, burn in subtitles.", href: `${DOC}/utilities` },
}

const HOW_TOS = [
  { href: `${DOC}/quick-start`, title: "Quick start: transcribe a recording in 3 minutes", body: "One connection, one step, Save & Test." },
  { href: `${DOC}/how-to/transcribe-meeting`, title: "Transcribe a meeting recording and email the summary", body: "Speakers, an agent's summary and the SRT file attached." },
  { href: `${DOC}/how-to/blur-photos`, title: "Blur faces and ID numbers in photos before storing", body: "Detect only first, then a redacted copy into storage." },
  { href: `${DOC}/how-to/redact-support-call`, title: "Redact PII from a support call recording", body: "Bleep card numbers, dates of birth and names in the audio." },
]

const FAQS = [
  { question: "Which AI providers can the media steps use?", answer: `${MEDIA_PROVIDERS.map((p) => p.label).join(", ")}. You add a provider once as an integration with your own API key and choose it in each step. The designer lists only connections that can do the step, and says what the chosen one lacks.` },
  { question: "Where do my images, recordings and videos go?", answer: "Only to the provider you choose in the step, and only when the step runs — adding a connection or designing a workflow sends nothing. Data residency and retention follow that provider and the region or endpoint you configure. Run history never contains the media or full transcripts: it shows counts, durations, file names, a short preview and the estimated cost." },
  { question: "Can it recognise who is in a photo?", answer: "No. Faces are located, never identified: the steps return where a face is so it can be blurred or counted, not who it is." },
  { question: "How does redaction find ID numbers and card numbers in an image?", answer: `The step reads the image's text with positions and checks it with the same ${INFO_TYPE_COUNT} information types as Redact Document — national IDs, card and bank numbers, dates of birth and more, with check digits and context words — plus any words and patterns you add. Each finding has a type, a confidence and a box; the values are masked in the run history.` },
  { question: "How long can a recording be?", answer: "Up to two hours by default (MEDIA_MAX_DURATION_SECONDS) and 100 MB (MEDIA_MAX_MB); self-hosters can raise both. In run mode Auto, media longer than five minutes runs in the background and the workflow continues when the result is ready." },
  { question: "What does it cost?", answer: "The provider bills your account directly. Each step estimates its cost from the provider's published list prices and returns it with the result and in the run history; when there is no price for a model it says so rather than guessing. Self-hosters can override prices with MEDIA_PRICES_JSON." },
  { question: "Do I need FFmpeg?", answer: "Only for local processing: Media Utilities, Redact Video, frame sampling in Analyze Video and splitting recordings longer than a provider accepts in one upload. The Docker image includes FFmpeg, so Docker, Kubernetes and on-premises installs are ready. Everything that runs at the provider — transcription, image analysis and redaction, image generation and speech — works on every deployment." },
]

/** Inline code that wraps anywhere, so long expressions don't widen the page on phones. */
function InlineCode({ children }: { children: ReactNode }) {
  return <span className="[overflow-wrap:anywhere]"><BaseInlineCode>{children}</BaseInlineCode></span>
}

function Points({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-6 space-y-2 text-sm leading-6 text-(color:--mkt-text)">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" /><span>{item}</span></li>
      ))}
    </ul>
  )
}

export function MediaPage() {
  const url = `${SITE_URL}/${MEDIA_PAGE.slug}`
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": `${url}#webpage`, url, name: MEDIA_PAGE.title, description: MEDIA_PAGE.description, isPartOf: { "@id": `${SITE_URL}/#website` }, about: { "@id": `${SITE_URL}/#software` }, primaryImageOfPage: `${SITE_URL}${SCREENSHOTS["media-designer"].src}` },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "UserTasks", item: SITE_URL }, { "@type": "ListItem", position: 2, name: MEDIA_PAGE.eyebrow, item: url }] },
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
          crumb="Images, audio and video"
          eyebrow="Images, audio and video"
          icon={Waves}
          title={<>See, hear and redact: <span className="mkt-gradient-text">AI for images, audio and video.</span></>}
          intro={<>Eight workflow steps work with the photos, recordings and videos your processes collect: <strong className="text-white">transcribe a call, read a photo, blur faces and ID numbers, bleep a card number</strong>, generate an image or a spoken notice, trim and convert. They use the AI provider you choose — with your own key — and hand every result to the next step.</>}
          primary={{ href: DOC, label: "Media actions guide" }}
          secondary={{ href: `${DOC}/quick-start`, label: "Transcribe a recording in 3 minutes" }}
        />
        <section className="relative">
          <div className="mx-auto max-w-6xl px-4 pb-6 pt-14 sm:px-6">
            <dl className="mt-10 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                [String(MEDIA_NODE_TYPES.length), "workflow steps"],
                [String(MEDIA_PROVIDERS.length), "AI providers"],
                [INFO_TYPE_COUNT, "sensitive info types"],
                ["Your key", "per workspace, encrypted"],
              ].map(([value, label]) => (
                <div key={label} className="rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 px-4 py-3">
                  <dt className="sr-only">{label}</dt>
                  <dd className="font-display text-2xl font-bold">{value}</dd>
                  <dd className="text-xs text-(color:--mkt-muted)">{label}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-12">
              <Shot name="media-designer" alt="The workflow designer with Analyze Image and Redact Image steps; the Redact Image settings show Google Gemini as the AI provider, the ID photo as the image, and Faces and Sensitive text selected" sizes="(min-width: 1152px) 1104px, 100vw" priority />
            </div>
          </div>
        </section>

        {/* Steps */}
        <section id="steps" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="The media actions" title="Eight steps, next to the document actions.">
              Find them under Operations in the designer. {PROVIDER_STEPS} call the AI provider you connect; Media Utilities runs FFmpeg on your server and needs no provider.
            </SectionHeading>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {MEDIA_NODE_TYPES.map((type) => {
                const { icon: Icon, body, href } = STEPS[type]
                return (
                  <Link key={type} href={href} className="group flex flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-5 transition hover:border-(color:--mkt-bronze)/40 hover:shadow-md">
                    <span className="flex items-center justify-between gap-2">
                      <Icon size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                      <code className="truncate font-mono text-2xs text-(color:--mkt-subtle)">{type}</code>
                    </span>
                    <h3 className="mt-3 font-semibold">{MEDIA_STEP_LABELS[type]}</h3>
                    <p className="mt-1 flex-1 text-sm leading-6 text-(color:--mkt-text)">{body}</p>
                    <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) group-hover:underline">Docs <ArrowRight size={14} aria-hidden="true" /></span>
                  </Link>
                )
              })}
            </div>
          </div>
        </section>

        {/* Transcribe */}
        <section id="transcribe" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2">
            <div>
              <SectionHeading eyebrow="Transcribe" title="Every word, who said it and when.">
                Meetings, support calls, interviews and voice notes become text, timed segments and subtitle files the next step can summarise, search or attach.
              </SectionHeading>
              <Points items={[
                "Speaker labels, segment and word timestamps, language detection and a vocabulary hint",
                <>SRT and VTT subtitles, plain text and JSON — as files in <InlineCode>{"{{transcript_files}}"}</InlineCode></>,
                "Long recordings run in the background; the run continues when the transcript is ready",
                "Recordings longer than a provider's upload limit are split into chunks automatically",
              ]} />
              <DocLinks links={[{ href: `${DOC}/transcribe`, label: "Transcribe Audio / Video" }, { href: `${DOC}/quick-start`, label: "Quick start" }]} />
            </div>
            <Shot name="media-transcribe-detail" alt="The Transcribe the call step and its settings: Deepgram as the AI provider, the Recording input as the source, Label speakers on, SRT and TXT files and run mode Auto" sizes="(min-width: 1024px) 540px, 100vw" />
          </div>
        </section>

        {/* Analyse */}
        <section id="analyse" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2">
            <div>
              <SectionHeading eyebrow="Analyse images and video" title="Ask a photo a question. Branch on the answer.">
                Analyze Image describes, labels and reads a photo, finds faces and objects with boxes and checks it for unsafe content. Give it a question and named fields and the answer comes back typed.
              </SectionHeading>
              <Points items={[
                <>Damage photos, receipts, site inspections: <InlineCode>{"{{image_analysis_answer.damaged}}"}</InlineCode> in a Condition</>,
                "Analyze Video: a summary, scenes with timestamps, labels, on-screen text and key frames",
                "Google Gemini watches a whole video; other providers look at frames sampled from it",
              ]} />
              <DocLinks links={[{ href: `${DOC}/analyze-image`, label: "Analyze Image" }, { href: `${DOC}/analyze-video`, label: "Analyze Video" }]} />
            </div>
            <Snippet language="json" code={`{
  "type": "media_analyze_image",
  "label": "Check photo",
  "config": {
    "integration_id": "<integration-id>",
    "source": "{{form.photo}}",
    "features": ["description", "text"],
    "prompt": "Is there visible damage to the vehicle? Which part?",
    "fields": [
      { "name": "damaged", "type": "boolean" },
      { "name": "part", "type": "string" }
    ]
  }
}`} />
          </div>
        </section>

        {/* Redact */}
        <section id="redact" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Redact images, video and speech" title="Blur what shouldn't be seen. Bleep what shouldn't be heard.">
              Redact Image and Redact Video find faces, license plates and sensitive text and make a copy with them blurred, pixelated or boxed — the original stays untouched. Redact Video also bleeps or mutes spoken personal data, in video and in audio-only recordings.
            </SectionHeading>
            <figure className="mt-10">
              <Shot name="media-redact-before-after" alt="A specimen driver license before and after Redact Image: the face, date of birth and SSN are blurred; the name and the specimen notice are unchanged" sizes="(min-width: 1152px) 1104px, 100vw" />
              <figcaption className="mt-2 text-sm text-(color:--mkt-muted)">Redact Image on a specimen card: one face, one date of birth and one US SSN found and blurred.</figcaption>
            </figure>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FeatureCard icon={ScanFace} title="Faces and plates">Located, never identified. Boxes from Azure AI Vision and AWS are measured; Gemini&rsquo;s come from the model — check them with Detect only.</FeatureCard>
              <FeatureCard icon={ShieldCheck} title={`${INFO_TYPE_COUNT} information types`}>National IDs, card and bank numbers, dates of birth and more — the same detectors, check digits and context words as Redact Document.</FeatureCard>
              <FeatureCard icon={AudioLines} title="Bleep spoken PII">Transcribe the speech, find card numbers, dates of birth or the names you list, and bleep or mute exactly those words.</FeatureCard>
              <FeatureCard icon={ScanEye} title="Detect only">Report what was found — type, masked text, confidence and box — without changing the file. Findings are masked in the run history.</FeatureCard>
            </div>
            <div className="mt-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
              <Shot name="media-bleep-detail" alt="Redact Video settings: Sensitive speech set to Bleep, Deepgram as the speech provider, the transcript from an earlier step reused, and all high-confidence information types" sizes="(min-width: 1024px) 540px, 100vw" />
              <div>
                <h3 className="font-display text-2xl font-bold tracking-tight">A support call, safe to share.</h3>
                <p className="mt-3 leading-7 text-(color:--mkt-text)">Transcribe the call once, pass the transcript to Redact Video and bleep every card number and date of birth. The copy is a file object; <InlineCode>audio_segments</InlineCode> lists what was bleeped and when, with the text masked.</p>
                <DocLinks links={[{ href: `${DOC}/redact-image`, label: "Redact Image" }, { href: `${DOC}/redact-video`, label: "Redact Video" }, { href: "/docs/workflows/documents/info-types", label: "Information types" }]} />
              </div>
            </div>
          </div>
        </section>

        {/* Generate, speak, utilities */}
        <section id="generate" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Generate, speak and convert" title="Make media, too.">
              Create the image a notification needs, speak a message for a phone line, and prepare files for the next system — all in the same run.
            </SectionHeading>
            <div className="mt-10 grid gap-6 lg:grid-cols-3">
              <article className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-6">
                <ImagePlus size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                <h3 className="mt-3 text-lg font-semibold">Generate / Edit Image</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">One to four images from a prompt with expressions in it, or an edit of an existing image with an optional mask. PNG, JPEG or WebP, with OpenAI or Stability AI.</p>
                <DocLinks links={[{ href: `${DOC}/generate-image`, label: "Generate / Edit Image" }]} />
              </article>
              <article className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-6">
                <AudioLines size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                <h3 className="mt-3 text-lg font-semibold">Text to Speech</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">&ldquo;Hello {"{{customer.first_name}}"}, your order has shipped.&rdquo; — as MP3, WAV, Opus, AAC or FLAC, in the voice, speed and style you choose, with OpenAI, Azure AI Speech, Deepgram or ElevenLabs.</p>
                <DocLinks links={[{ href: `${DOC}/text-to-speech`, label: "Text to Speech" }]} />
              </article>
              <article className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-6">
                <Clapperboard size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                <h3 className="mt-3 text-lg font-semibold">Media Utilities</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">FFmpeg on your server, no provider, nothing sent out:</p>
                <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Media Utilities operations">
                  {MEDIA_TOOL_OPERATIONS.map((op) => <li key={op.id} className="rounded-full border border-(color:--mkt-ink)/10 bg-(color:--mkt-white) px-2.5 py-1 text-xs font-medium text-(color:--mkt-ink-soft)">{op.label}</li>)}
                </ul>
                <DocLinks links={[{ href: `${DOC}/utilities`, label: "Media Utilities" }]} />
              </article>
            </div>
          </div>
        </section>

        {/* Providers */}
        <section id="providers" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Bring your own key" title={`${MEDIA_PROVIDERS.length} providers. Pick per step.`}>
              Add a provider once as an integration with your own API key, then choose it in each step — Deepgram for calls, Azure AI Vision for redaction, Gemini for video. The designer lists only connections that can do the step.
            </SectionHeading>
            <ul className="mt-10 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3" aria-label="Media AI providers">
              {MEDIA_PROVIDERS.map((provider) => (
                <li key={provider.id} className="flex items-center gap-2 rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 px-4 py-3 text-sm font-semibold">
                  <KeyRound size={15} className="shrink-0 text-(color:--mkt-bronze)" aria-hidden="true" />{provider.label}
                </li>
              ))}
            </ul>
            <div className="relative mt-8 overflow-x-auto rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70">
              <table className="w-full min-w-[860px] text-left text-sm">
                <caption className="sr-only">What each media provider can do</caption>
                <thead className="border-b border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) text-2xs uppercase tracking-wider text-(color:--mkt-muted)">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Provider</th>
                    {MEDIA_CAPABILITY_LABELS.map(([cap, label]) => <th key={cap} scope="col" className="px-2 py-2.5 text-center font-semibold">{label}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-(color:--mkt-ink)/[0.06]">
                  {MEDIA_PROVIDERS.map((provider) => (
                    <tr key={provider.id}>
                      <th scope="row" className="whitespace-nowrap px-4 py-2.5 font-semibold">{provider.label}</th>
                      {MEDIA_CAPABILITY_LABELS.map(([cap, label]) => (
                        <td key={cap} className="px-2 py-2.5 text-center">
                          {provider.capabilities.includes(cap)
                            ? <><Check size={16} className="inline text-(color:--mkt-green)" aria-hidden="true" /><span className="sr-only">{label}: yes</span></>
                            : <><span className="text-[#B5AD9C]" aria-hidden="true">—</span><span className="sr-only">{label}: no</span></>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-(color:--mkt-muted)">Generated from the provider catalogue in the code, so it matches what the designer offers. Limits and notes per provider are in the docs.</p>
            <DocLinks links={[{ href: `${DOC}/providers`, label: "Provider setup and where to get keys" }, { href: `${DOC}#providers-and-capabilities`, label: "Capability matrix" }]} />
          </div>
        </section>

        {/* Privacy and cost */}
        <section id="privacy" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Privacy and cost" title="Your provider, your key, your bill — and a record of each.">
              Media goes to one place: the provider you chose for the step, when the step runs. What it cost is on the step&rsquo;s result.
            </SectionHeading>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FeatureCard icon={Lock} title="Only to your provider">Nothing is sent when you add a connection or design a workflow. Residency follows the provider and the region or endpoint you configure.</FeatureCard>
              <FeatureCard icon={KeyRound} title="Keys per workspace">Each key is stored encrypted on the workspace&rsquo;s integration, or as a reference to your secret store, and loaded only for that workspace&rsquo;s runs.</FeatureCard>
              <FeatureCard icon={ShieldCheck} title="Lean run history">Counts, durations, provider, model, file names and a 200-character preview — never the media or a full transcript. Temporary files are deleted when the step ends.</FeatureCard>
              <FeatureCard icon={Receipt} title="Cost on every step">An estimate from the provider&rsquo;s list prices — per minute, image or character — with the result and in the run history. No price, no guess: it says &ldquo;cost unknown&rdquo;.</FeatureCard>
            </div>
            <div className="mt-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-[3fr_2fr]">
              <Shot name="media-test-run-detail" alt="Save & Test logs: Blur face and ID numbers redacted one face, one date of birth and one US SSN with blur, and an estimated cost in USD" sizes="(min-width: 1024px) 650px, 100vw" />
              <div>
                <h3 className="font-display text-2xl font-bold tracking-tight">Test it before it touches real files.</h3>
                <p className="mt-3 leading-7 text-(color:--mkt-text)">Save &amp; Test runs the steps inline on a sample. The log shows what was found by type, the style used and the estimated cost — the values themselves stay masked.</p>
                <DocLinks links={[{ href: `${DOC}#privacy`, label: "Privacy" }, { href: `${DOC}#cost`, label: "Cost" }]} />
              </div>
            </div>
          </div>
        </section>

        {/* Agents */}
        <section id="agents" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[2fr_3fr]">
            <div>
              <SectionHeading eyebrow="AI agents" title="Agents that can listen and look.">
                Turn on Media (images, audio, video) in the agent designer and pick a connection: the agent gets <InlineCode>transcribe_media</InlineCode> and <InlineCode>analyze_image</InlineCode> for files attached to the conversation or a URL.
              </SectionHeading>
              <Points items={[
                "Same provider connections and keys as the workflow steps",
                "Put the media tools on the agent's approval list, like any tool that calls out",
                "Or keep it in the workflow: Transcribe, then hand {{transcript_text}} to a Run Agent step",
              ]} />
              <DocLinks links={[{ href: "/docs/agents#tools", label: "Agent tools" }, { href: "/connectors#ai", label: "AI agents and models" }]} />
            </div>
            <Shot name="media-agent" alt="The agent designer's capability bundles with Media (images, audio, video) enabled, using a Deepgram connection, with the tools transcribe_media and analyze_image" sizes="(min-width: 1024px) 650px, 100vw" />
          </div>
        </section>

        {/* Where it runs */}
        <section id="platforms" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Where it runs" title="Provider steps everywhere. FFmpeg in the box." />
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <article className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-6">
                <Clock size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                <h3 className="mt-3 text-lg font-semibold">Every deployment</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">Transcription within the provider&rsquo;s upload limit, image analysis, image redaction (PNG and JPEG are processed in JavaScript), image generation and text to speech run wherever UserTasks runs — cloud, serverless or your own servers.</p>
              </article>
              <article className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-6">
                <Container size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                <h3 className="mt-3 text-lg font-semibold">Docker, Kubernetes and on-premises</h3>
                <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">The Docker image ships with FFmpeg, so Media Utilities, Redact Video, frame sampling for Analyze Video and chunked transcription of long recordings work out of the box with Docker Compose, the Helm chart and on-premises installs. Elsewhere, point <InlineCode>FFMPEG_PATH</InlineCode> at a binary; serverless hosts without FFmpeg, such as Vercel, run the provider steps.</p>
              </article>
            </div>
            <DocLinks links={[{ href: `${DOC}#where-it-runs`, label: "Where it runs" }, { href: `${DOC}#limits`, label: "Limits" }, { href: "/deploy-anywhere", label: "Deploy anywhere" }]} />
          </div>
        </section>

        {/* Use cases with ready-made packages */}
        <section id="use-cases" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Use cases" title="Six processes, each with a package to install.">
              Public records requests with evidence redaction, meeting minutes, claim photos, call QA, identity documents and upload moderation — each a use case page and a signed package in the gallery.
            </SectionHeading>
            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {useCasesInGroup("media").map((useCase) => <UseCaseCard key={useCase.slug} useCase={useCase} />)}
            </div>
            <DocLinks links={[{ href: "/use-cases#media", label: "All media use cases" }, { href: "/gallery?category=media-evidence", label: "Media & Evidence packages" }, { href: "/gallery/foia-records-request-redaction", label: "FOIA / public records package" }]} />
          </div>
        </section>

        {/* How-tos */}
        <section id="how-tos" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="How-to guides" title="Start with a recording, a photo or a call." />
            <ul className="mt-10 grid gap-4 sm:grid-cols-2">
              {HOW_TOS.map((guide) => (
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
            <div className="mt-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
              <div>
                <h3 className="font-display text-2xl font-bold tracking-tight">Recordings and photos from a form.</h3>
                <p className="mt-3 leading-7 text-(color:--mkt-text)">Every media field takes a file from a form&rsquo;s Attachments field, an earlier step, a storage reference or a URL. Every output — transcripts, redacted copies, images, speech, frames — is a file object the next step can email, store or loop over.</p>
                <DocLinks links={[{ href: "/forms", label: "Forms and attachments" }, { href: "/documents", label: "Document actions" }]} />
              </div>
              <Snippet language="json" code={`{
  "type": "media_transcribe",
  "label": "Transcribe meeting",
  "config": {
    "integration_id": "<integration-id>",
    "source": "{{form.recording}}",
    "diarize": true,
    "formats": ["srt", "txt"],
    "output_var": "transcript"
  }
}`} />
            </div>
          </div>
        </section>

        <FaqList faqs={FAQS} />

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="rounded-3xl border border-(color:--mkt-ink)/10 bg-gradient-to-br from-(color:--mkt-primary)/[0.06] via-transparent to-(color:--mkt-gold)/[0.12] p-8 text-center sm:p-14">
            <Bot size={28} className="mx-auto text-(color:--mkt-bronze)" aria-hidden="true" />
            <h2 className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl">Put recordings and photos in the loop.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-(color:--mkt-text)">Collect them with a form, transcribe, analyse and redact them in the run, and send the result where it needs to go — with the provider you trust.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href={`${DOC}/quick-start`} className="inline-flex items-center justify-center gap-2 rounded-lg bg-(color:--mkt-primary) px-6 py-3 font-semibold text-(color:--mkt-paper) hover:bg-(color:--mkt-primary-hover)">Quick start <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link href={DOC} className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">Media actions guide</Link>
              <Link href="/workflows" className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">Workflows</Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
