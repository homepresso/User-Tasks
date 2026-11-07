import type { DocPageDef } from '../types'
import { getConnectorDefinition } from '@/lib/connectors/registry'
import { MEDIA_CAPABILITY_LABELS, MEDIA_NODE_TYPES, MEDIA_PROVIDERS, MEDIA_STEP_LABELS, providerSupportsNode, type MediaNodeType } from '@/lib/media/catalog'

/**
 * Media actions (lib/media): Transcribe, Analyze Image / Video, Redact Image
 * / Video, Generate / Edit Image, Text to Speech and Media Utilities —
 * overview with the capability matrix (generated from MEDIA_PROVIDERS),
 * provider setup, one page per step and how-tos. Config keys follow
 * lib/media/handlers.ts, outputs lib/media/schemas.ts (mediaNodeRoots), and
 * designer wording components/automations/media-action-panels.tsx.
 */

const esc = (s: string) => s.replace(/\|/g, '\\|')

const CAPABILITY_COLUMNS = MEDIA_CAPABILITY_LABELS

const STEP_LABELS: Record<MediaNodeType, string> = { ...MEDIA_STEP_LABELS, media_transcribe: 'Transcribe' }

/** Provider × capability (✓ / —), from lib/media/catalog.ts. */
function capabilityMatrixMarkdown(): string {
  const head = `| Provider | ${CAPABILITY_COLUMNS.map(([, label]) => label).join(' | ')} |`
  const rule = `|---|${CAPABILITY_COLUMNS.map(() => '---').join('|')}|`
  const rows = MEDIA_PROVIDERS.map((p) => `| ${esc(p.label)} | ${CAPABILITY_COLUMNS.map(([cap]) => (p.capabilities.includes(cap) ? '✓' : '—')).join(' | ')} |`)
  return [head, rule, ...rows].join('\n')
}

/** Step → providers that can run it. */
function stepProvidersMarkdown(): string {
  const rows = MEDIA_NODE_TYPES.map((type) => {
    const providers = type === 'media_tools' ? 'None needed (FFmpeg on the server)' : MEDIA_PROVIDERS.filter((p) => providerSupportsNode(p, type)).map((p) => esc(p.label)).join(', ')
    return `| ${STEP_LABELS[type]} | \`${type}\` | ${providers} |`
  })
  return ['| Step | Type | Providers |', '|---|---|---|', ...rows].join('\n')
}

/** Provider notes (limits, approximations). */
function providerNotesMarkdown(): string {
  return MEDIA_PROVIDERS.filter((p) => p.notes).map((p) => `- **${p.label}** — ${p.notes}`).join('\n')
}

/** "Region (optional)" → "Region"; optional fields are marked by the caller. */
const fieldLabel = (label: string) => label.replace(/\s*\(optional\)\s*$/i, '')

/** What the connector form asks for, from its definition (lib/connectors). */
function connectorFieldsMarkdown(type: string): string | null {
  const def = getConnectorDefinition(type)
  if (!def) return null
  const fields = [...def.credentialFields, ...def.fields].map((f) => `${fieldLabel(f.label)}${f.required ? '' : ' (optional)'}`)
  return fields.length ? fields.join(', ') : null
}

/** One heading per vendor: key source, connector, form fields, steps, notes. */
function providerSetupMarkdown(): string {
  return MEDIA_PROVIDERS.map((p) => {
    const def = getConnectorDefinition(p.integrationTypes[0])
    const steps = MEDIA_NODE_TYPES.filter((t) => t !== 'media_tools' && providerSupportsNode(p, t)).map((t) => STEP_LABELS[t])
    const models = Object.entries(p.defaults).map(([op, model]) => `${op}: \`${model}\``).join(', ')
    const fields = connectorFieldsMarkdown(p.integrationTypes[0])
    const permissions = def?.recommendedPermissions
    return [
      `## ${p.label}`,
      '',
      `- **API key:** ${p.keyFrom}.`,
      `- **Connector:** **Integrations → Connectors → ${def?.name ?? p.label}** (connector key${p.integrationTypes.length > 1 ? 's' : ''} ${p.integrationTypes.map((t) => `\`${t}\``).join(', ')}).`,
      ...(fields ? [`- **The form asks for:** ${esc(fields)}.`] : []),
      ...(permissions ? [`- **${permissions.title}:** ${permissions.items.map((i) => `\`${i}\``).join('; ')}.${permissions.note ? ` ${permissions.note}` : ''}`] : []),
      `- **Steps:** ${steps.join(', ')}.`,
      ...(models ? [`- **Default models:** ${models} (change them per step with **Model**).`] : []),
      ...(p.notes ? [`- **Notes:** ${p.notes}`] : []),
    ].join('\n')
  }).join('\n\n')
}

const FILE_INPUT = `A file object (a form's [Attachments field](/docs/tasks/forms#attachments) such as \`{{form.recording}}\`, or a file from another step), a list of files (the first is used), a \`storage://\` reference, an http(s) URL (fetched through the egress guard) or base64 content. Files are read for the run's workspace only — the same rules as the [document actions](/docs/workflows/documents#file-inputs).`

const PROVIDER_INPUT = `**AI provider** (\`integration_id\`): one of the workspace's integrations made from a media-capable connector — see [Provider setup](/docs/workflows/media/providers). It is chosen in the designer (not an expression). The picker lists only connections that can do the step, and warns when the chosen provider cannot do a feature you picked.`

const RUN_MODE = `**Run** (\`run_mode\`): \`auto\` (default) runs the step in the background when the media is longer than \`MEDIA_INLINE_MAX_SECONDS\` (300 seconds) or the provider works as an asynchronous job, and the run continues when it finishes; \`inline\` always waits in the step; \`background\` always hands it to a job. Background needs a saved workflow run — **Save & Test** always runs inline.`

export const MEDIA_PAGES: DocPageDef[] = [
  {
    slug: 'workflows/media',
    title: 'Media actions',
    description: 'Transcribe audio and video, analyse images and video, blur faces, plates and sensitive text, generate images and speech, and trim or convert media inside a workflow run — with your own AI provider.',
    body: `
Eight workflow steps work with images, audio and video. Seven of them use an AI provider you connect with **your own API key** — OpenAI, Google Gemini, Azure AI, AWS, Deepgram, AssemblyAI, ElevenLabs or Stability AI. The eighth, **Media Utilities**, runs FFmpeg on the server and needs no provider.

Find them in the designer's palette under **Operations**, next to the document actions.

::image media-designer | The workflow designer with Analyze Image and Redact Image steps; the Redact Image settings show Google Gemini as the AI provider and Faces and Sensitive text selected | An ID photo check: Analyze Image describes the photo, Redact Image blurs the face and ID numbers, Send Email delivers the copy.

New to the media steps? [Quick start: transcribe a recording in 3 minutes](/docs/workflows/media/quick-start).

## The media actions

| Node | Type | What it does |
|---|---|---|
| [Transcribe Audio / Video](/docs/workflows/media/transcribe) | \`media_transcribe\` | Speech to text with timestamps, speakers, word timings and SRT / VTT / TXT / JSON files |
| [Analyze Image](/docs/workflows/media/analyze-image) | \`media_analyze_image\` | Describe, label, read text, locate faces and objects and check safety; answer a question, optionally as named fields |
| [Analyze Video](/docs/workflows/media/analyze-video) | \`media_analyze_video\` | Summary, scenes with timestamps, labels, on-screen text and key frames |
| [Redact Image](/docs/workflows/media/redact-image) | \`media_redact_image\` | Blur, pixelate or box faces, license plates and sensitive text (ID numbers, card numbers…) in an image, or only report where they are |
| [Redact Video](/docs/workflows/media/redact-video) | \`media_redact_video\` | The same over time in a video, and bleep or mute sensitive speech (also in audio-only files) |
| [Generate / Edit Image](/docs/workflows/media/generate-image) | \`media_generate_image\` | Create images from a prompt, or edit one with a mask |
| [Text to Speech](/docs/workflows/media/text-to-speech) | \`media_tts\` | Turn text into an audio file in a chosen voice |
| [Media Utilities](/docs/workflows/media/utilities) | \`media_tools\` | Media info, extract audio or frames, thumbnail, trim, convert, compress, burn in subtitles |

## Providers and capabilities

Each provider does some of the work. The designer lists only connections that can do a step and says what the chosen one lacks ("OpenAI cannot locate faces — choose Google Gemini, Azure AI Vision or AWS").

${capabilityMatrixMarkdown()}

${stepProvidersMarkdown()}

Faces are **located, never identified**: no step recognises who a person is.

${providerNotesMarkdown()}

Set up a provider: [Provider setup](/docs/workflows/media/providers).

## Inputs and outputs

Every media field takes an expression. ${FILE_INPUT}

Output files (transcript files, redacted copies, generated images, speech, frames, converted media) are saved through the configured storage provider and returned as **file objects** — the same fields as a form attachment (\`id\`, \`name\`, \`size\`, \`mime_type\`, \`url\`, \`storage_ref\`, \`checksum_sha256\`, …) — so a later step can email, store, loop over or analyse them. Frames and key frames also carry \`time\` (seconds from the start).

Each step writes its result to its **Output variable** (\`output_var\`) and a few shortcuts next to it, such as \`{{transcript_text}}\` and \`{{transcript_srt}}\`. The data picker and the Variables panel list them with their fields.

## Privacy

- **Media goes to the provider you choose.** When a step runs, the media (or frames of it, or its audio) is sent to that provider's API with your key. Data residency and retention follow that provider and the region or endpoint you configure in the connection — check its terms before sending personal data.
- **Nothing is sent until a step runs.** Adding a connection or designing a workflow sends nothing.
- **Run logs never contain media or full transcripts.** The run history shows counts, durations, provider, model, file names, at most a 200-character text preview and the estimated cost. The full result is only in the run's variables.
- **Temporary files** are written to \`MEDIA_TMP_DIR\` (default: the system temp folder) and deleted when the step finishes.
- **Redaction findings** are masked (•••) in the run history.

## Cost

Provider calls are billed by the provider to your account. Each step estimates its cost from the provider's published **list prices as of the date of the built-in price table** (per minute of audio, per image, per character…) and returns it as \`cost\` (\`status\`, \`amount\`, \`currency\`, \`detail\`); the run history shows it too. When there is no price for a model, the cost is reported as **cost unknown** (\`status: "unknown"\`). Discounts, free tiers and taxes are not included. Self-hosters can override prices with \`MEDIA_PRICES_JSON\`.

::image media-test-run | Save & Test logs with the Redact Image step expanded: counts of one face, one date of birth and one US SSN, style blur and an estimated cost in USD | The step's run log: what was found by type, the style, and the estimated cost with how it was computed.

## Limits

Instance-wide limits come from the environment (see [Environment variables](/docs/self-hosting/environment)):

| Variable | Default | What it limits |
|---|---|---|
| \`MEDIA_MAX_MB\` | 100 | Largest media input, in MB |
| \`MEDIA_MAX_DURATION_SECONDS\` | 7200 | Longest audio or video accepted |
| \`MEDIA_INLINE_MAX_SECONDS\` | 300 | In run mode **Auto**, longer media runs in the background |
| \`MEDIA_TIMEOUT_SECONDS\` | 120 | Time for a step that runs inline |
| \`MEDIA_JOB_TIMEOUT_SECONDS\` | 3600 | Time for a background job, including waiting for the provider |
| \`MEDIA_MAX_IMAGE_MEGAPIXELS\` | 40 | Largest decoded image |
| \`MEDIA_VIDEO_REDACT_MAX_SECONDS\` | 600 | Longest video Redact Video accepts |
| \`MEDIA_FFMPEG_TIMEOUT_SECONDS\` | 600 | One FFmpeg command |
| \`FFMPEG_PATH\` / \`FFPROBE_PATH\` | \`ffmpeg\` / \`ffprobe\` on PATH | The FFmpeg binaries |
| \`MEDIA_TOOLS\` | on | \`off\` turns local media processing off |
| \`MEDIA_TMP_DIR\` | system temp folder | Where temporary files go |
| \`MEDIA_PRICES_JSON\` | built-in table | Price overrides for the cost estimates |

Providers have their own limits too (upload sizes, image sizes) — see the notes above.

## Where it runs

Provider-side work — transcription within the provider's upload limit, image analysis, image redaction (PNG and JPEG are processed in JavaScript), image generation and text to speech — works on every deployment.

Local media processing needs **FFmpeg** on the server:

- **Media Utilities** (every operation),
- **Redact Video**,
- **Analyze Video** with a provider that cannot watch a whole video (frames are sampled),
- **Transcribe** of audio longer than the provider accepts in one upload (it is split into chunks),
- image formats other than PNG and JPEG.

The **Docker image includes FFmpeg** (build argument \`INCLUDE_MEDIA_TOOLS=true\`, the default). **Vercel has no FFmpeg**: those steps fail with a clear error that names the step and says to use the Docker image or set \`FFMPEG_PATH\`. Elsewhere, install \`ffmpeg\` and \`ffprobe\` on the PATH or point \`FFMPEG_PATH\` / \`FFPROBE_PATH\` at them. \`MEDIA_TOOLS=off\` turns local processing off on any deployment.

## Agents

An agent can also transcribe and look at files: turn on **Media (images, audio, video)** in the agent designer and choose a connection. The agent then gets the tools \`transcribe_media\` and \`analyze_image\` (a file attached to the conversation, or a URL). They send media to the chosen provider, so they can be put on the agent's approval list like other tools that call out. See [AI agents](/docs/agents#tools).

::image media-agent | The agent designer's Tools tab: the Media (images, audio, video) bundle is enabled with a Deepgram connection and lists transcribe_media and analyze_image | Media access in the agent designer: one connection, two tools.

In a workflow you don't need the agent tools: transcribe or read the file with a media step and put the result in a [Run Agent](/docs/workflows/nodes#node-run-agent) prompt, or hand the image itself to the agent with Run Agent's **Files**.

## How-to guides

- [Quick start: transcribe a recording in 3 minutes](/docs/workflows/media/quick-start)
- [Transcribe a meeting recording and email the summary](/docs/workflows/media/how-to/transcribe-meeting)
- [Blur faces and ID numbers in photos before storing](/docs/workflows/media/how-to/blur-photos)
- [Redact PII from a support call recording](/docs/workflows/media/how-to/redact-support-call)

## Related

- [Document actions](/docs/workflows/documents) — Word, Excel, PowerPoint and PDF; scanned pages with OCR. Redact Image and Redact Video use the same [information types](/docs/workflows/documents/info-types) as Redact Document.
- [Attachments](/docs/tasks/forms#attachments) — collect recordings and photos with a form; they arrive as file objects the media steps take.
- [AI agents](/docs/agents) and the [Run Agent](/docs/workflows/nodes#node-run-agent) step — summarise a transcript or classify a photo's description.
`,
  },
  {
    slug: 'workflows/media/quick-start',
    title: 'Quick start: transcribe a recording in 3 minutes',
    description: 'Connect a transcription provider, add one Transcribe step to a workflow, upload a short recording in Save & Test and read the transcript and subtitle file.',
    body: `
From an API key to a transcript in one workflow step. You need a short recording (an MP3, M4A, WAV or MP4 of a minute or two) and a key from a transcription provider — Deepgram, OpenAI, AssemblyAI, ElevenLabs, Azure AI Speech, Google Gemini or AWS. This guide uses Deepgram; the others work the same way.

## 1. Connect the provider (1 minute)

1. Get a key: ${MEDIA_PROVIDERS.find((p) => p.id === 'deepgram')?.keyFrom ?? 'console.deepgram.com → API Keys'}.
2. In UserTasks open **Integrations**, switch to the **Connectors** tab, choose **Deepgram**, paste the key and save.

The key is stored encrypted for this workspace and used only by its runs. Nothing is sent to Deepgram until a step runs. Other providers: [Provider setup](/docs/workflows/media/providers).

## 2. Add the step (1 minute)

1. Create a workflow (**Workflows → New Automation**) with a **Manual** trigger.
2. With nothing selected on the canvas, choose **Design start form** and add an **Attachments** input named \`recording\` (allow audio and video, or any safe file).
3. From the palette (**Operations**), drag **Transcribe Audio / Video** under the trigger. Choose your Deepgram connection in **AI provider**, put \`{{recording}}\` in **Audio or video** (or pick **Recording** in the Data panel), and turn on **Label speakers**. Keep **Files** at **SRT**.

The step's JSON:

\`\`\`json title="Transcribe"
{
  "type": "media_transcribe",
  "label": "Transcribe",
  "config": {
    "integration_id": "<integration-id>",
    "source": "{{recording}}",
    "diarize": true,
    "formats": ["srt"],
    "output_var": "transcript"
  }
}
\`\`\`

::image media-transcribe-detail | The Transcribe step and its settings: Deepgram as the AI provider, the Recording input as the source, Label speakers on, SRT and TXT files and run mode Auto | Transcribe settings: provider, source, speakers, files and run mode.

## 3. Test it (1 minute)

Press **Save & Test**, upload the recording in the start form and run. Save & Test always runs the step inline, so the result appears in the test panel:

- \`{{transcript_text}}\` — the whole transcript,
- \`{{transcript_segments}}\` — timed segments with \`speaker\`,
- \`{{transcript_srt}}\` — the subtitle file, a file object you can attach to an email.

The run history shows the duration, language, segment count, a 200-character preview and the estimated [cost](/docs/workflows/media#cost) — never the whole transcript.

## Next

- Summarise it: add a [Run Agent](/docs/workflows/nodes#node-run-agent) step with \`{{transcript_text}}\` in the prompt — the full recipe is [Transcribe a meeting recording and email the summary](/docs/workflows/media/how-to/transcribe-meeting).
- Longer recordings: publish the workflow and run it for real; in run mode **Auto**, media over five minutes runs in the background and the run continues when the transcript is ready.
- Subtitles in the video: [Media Utilities](/docs/workflows/media/utilities) → **Burn in subtitles** with \`{{transcript_srt}}\`.
`,
  },
  {
    slug: 'workflows/media/providers',
    title: 'Media provider setup',
    description: 'Where to get an API key for OpenAI, Google Gemini, Azure AI Speech and Vision, AWS, Deepgram, AssemblyAI, ElevenLabs and Stability AI, which connector to add and what each can do.',
    body: `
The media steps call an AI provider with **your own API key**. Add the provider once as an integration (**Integrations → Connectors**, then the provider), paste the key, and choose that connection in the step's **AI provider** field. The key is stored encrypted and loaded only for the workspace's own runs. See [Connectors](/docs/integrations/connectors).

A provider can only do what it supports — see the [capability matrix](/docs/workflows/media#providers-and-capabilities). For example, OpenAI transcribes, describes images, checks safety, generates and edits images and speaks, but cannot return face or text boxes, so Redact Image needs Google Gemini, Azure AI Vision or AWS.

${providerSetupMarkdown()}

## Choosing a provider

- **Meetings and calls:** any transcription provider. Deepgram and Azure AI Speech answer in one request; AssemblyAI and AWS work as jobs (long recordings run in the background). Speaker labels: turn on **Label speakers**.
- **Redaction:** Azure AI Vision and AWS return measured face and text boxes; Google Gemini's boxes are located by the model and approximate — check the results.
- **Whole-video understanding:** Google Gemini watches the video itself; other providers look at sampled frames (needs FFmpeg).
- **Images and speech:** OpenAI or Stability AI generate images; OpenAI, Azure AI Speech, Deepgram and ElevenLabs speak.
`,
  },
  {
    slug: 'workflows/media/transcribe',
    title: 'Transcribe Audio / Video',
    description: 'Speech to text with timestamps, speaker labels, word timings and SRT, VTT, TXT or JSON transcript files, using your own transcription provider.',
    body: `
**Transcribe Audio / Video** (\`media_transcribe\`) turns the speech in an audio or video file into text, timed segments and subtitle files.

::image media-transcribe | The Transcribe step selected in a support call workflow, with Deepgram as the AI provider, the Recording input as the source, Label speakers on, SRT and TXT files and run mode Auto | Transcribe with speaker labels into SRT and TXT files; run mode Auto moves long recordings to the background.

## Inputs

${PROVIDER_INPUT}

**Audio or video** (\`source\`): ${FILE_INPUT}

## Options

| Setting | Key | Default | What it does |
|---|---|---|---|
| Language | \`language\` | detect | A language code such as \`en\`, \`de\` or \`es-MX\`; empty detects it |
| Label speakers | \`diarize\` | off | Adds a speaker label to each segment |
| Max speakers | \`max_speakers\` | detect | A hint for speaker labelling |
| Word timings | \`word_timestamps\` | off | Adds \`words\` with start and end times |
| Vocabulary hint | \`prompt\` | — | Names and terms the provider should expect |
| Files | \`formats\` | \`["srt"]\` | Any of \`srt\`, \`vtt\`, \`txt\`, \`json\` |
| Model | \`model\` | the provider's default | Override the model |
| Output file name | \`output_name\` | from the source | Base name of the transcript files |
| Run | \`run_mode\` | \`auto\` | \`auto\`, \`inline\` or \`background\` |
| Output variable | \`output_var\` | \`transcript\` | Where the result goes |

${RUN_MODE}

## Outputs

| Variable | Contents |
|---|---|
| \`{{transcript}}\` | \`text\`, \`language\`, \`duration\`, \`segments\` (\`id\`, \`start\`, \`end\`, \`text\`, \`speaker\`, \`confidence\`, \`words\`), \`words\`, \`speakers\`, \`files\` (\`srt\`, \`vtt\`, \`txt\`, \`json\`), \`provider\`, \`model\`, \`chunks\`, \`cost\` |
| \`{{transcript_text}}\` | The full transcript |
| \`{{transcript_segments}}\` | Timed segments — loop over them |
| \`{{transcript_files}}\` | Every transcript file — attach them to an email |
| \`{{transcript_srt}}\`, \`{{transcript_vtt}}\`, \`{{transcript_txt}}\`, \`{{transcript_json}}\` | One file per chosen format |

Times are seconds from the start.

## Example

\`\`\`json title="Transcribe with speakers"
{
  "type": "media_transcribe",
  "label": "Transcribe meeting",
  "config": {
    "integration_id": "<integration-id>",
    "source": "{{form.recording}}",
    "diarize": true,
    "formats": ["srt", "txt"],
    "output_var": "transcript"
  }
}
\`\`\`

Then use \`{{transcript_text}}\` in a [Run Agent](/docs/workflows/nodes#node-run-agent) prompt to summarise it, or burn \`{{transcript_srt}}\` into the video with [Media Utilities](/docs/workflows/media/utilities).

## Notes

- Long audio is split into chunks when the provider has an upload limit (needs FFmpeg); \`chunks\` says how many.
- The run history shows the duration, language, segment count and a 200-character preview — never the full transcript.
`,
  },
  {
    slug: 'workflows/media/analyze-image',
    title: 'Analyze Image',
    description: 'Describe an image, list labels and objects, read its text, locate faces, check safety, or answer a question about it — optionally as named fields.',
    body: `
**Analyze Image** (\`media_analyze_image\`) looks at one image and returns what you ask for.

## Inputs

${PROVIDER_INPUT}

**Image** (\`source\`): ${FILE_INPUT}

## Options

| Setting | Key | Default | What it does |
|---|---|---|---|
| Find | \`features\` | \`["description", "labels", "text"]\` | Any of \`description\`, \`labels\`, \`objects\` (with boxes), \`text\` (OCR), \`faces\` (boxes only), \`safety\` |
| Question or instruction | \`prompt\` | — | Answered in \`answer\` |
| Answer fields | \`fields\` | — | With a prompt: \`[{ "name", "type", "description" }]\` (\`type\`: \`string\`, \`number\`, \`boolean\`, \`array\`, \`object\`); the answer is then an object with these keys |
| Max labels / objects | \`max_results\` | 20 | |
| Model | \`model\` | the provider's default | |
| Output variable | \`output_var\` | \`image_analysis\` | |

## Outputs

| Variable | Contents |
|---|---|
| \`{{image_analysis}}\` | \`description\`, \`labels\` and \`objects\` (\`name\`, \`confidence\`, \`box\`), \`text\`, \`ocr\` (lines with \`box\` and \`box_px\`), \`faces\` (\`box\`, \`box_px\`, \`confidence\`), \`face_count\`, \`safety\` (\`flagged\`, \`categories\`), \`answer\`, \`width\`, \`height\`, \`provider\`, \`model\`, \`cost\` |
| \`{{image_analysis_description}}\` | The description |
| \`{{image_analysis_text}}\` | Text found, lines joined |
| \`{{image_analysis_labels}}\` | Label names |
| \`{{image_analysis_answer}}\` | The answer to the prompt |

Boxes are fractions of the image (\`x\`, \`y\`, \`width\`, \`height\` from 0 to 1, origin top left); \`box_px\` is the same box in pixels.

## Example

\`\`\`json title="Check a damage photo"
{
  "type": "media_analyze_image",
  "label": "Check photo",
  "config": {
    "integration_id": "<integration-id>",
    "source": "{{form.photo}}",
    "features": ["description", "text"],
    "prompt": "Is there visible damage to the vehicle? Which part?",
    "fields": [
      { "name": "damaged", "type": "boolean" },
      { "name": "part", "type": "string", "description": "bumper, door, windscreen…" }
    ]
  }
}
\`\`\`

Branch on \`{{image_analysis_answer.damaged}}\` in a Condition.

## Notes

- Not every provider has every feature — see the [capability matrix](/docs/workflows/media#providers-and-capabilities). Faces are located, never identified.
- Images larger than the provider accepts are downsized before they are sent.
`,
  },
  {
    slug: 'workflows/media/analyze-video',
    title: 'Analyze Video',
    description: 'Summarise a video, split it into scenes with timestamps, list labels and on-screen text, save key frames, or answer a question about it.',
    body: `
**Analyze Video** (\`media_analyze_video\`) understands a video. Google Gemini watches the whole video; other providers that can analyse images look at frames sampled evenly from it (this needs FFmpeg on the server).

## Inputs

${PROVIDER_INPUT}

**Video** (\`source\`): ${FILE_INPUT}

## Options

| Setting | Key | Default | What it does |
|---|---|---|---|
| Find | \`features\` | \`["summary", "scenes"]\` | Any of \`summary\`, \`scenes\`, \`labels\`, \`text\` (on-screen text) |
| Question or instruction | \`prompt\` | — | Answered in \`answer\` |
| Answer fields | \`fields\` | — | As for [Analyze Image](/docs/workflows/media/analyze-image#options) |
| Max frames | \`max_frames\` | 12 | 1–60; frames sampled for providers that cannot watch a whole video |
| Save key frames | \`keyframes\` | off | Stores key frames as image files |
| Model | \`model\` | the provider's default | |
| Run | \`run_mode\` | \`auto\` | \`auto\`, \`inline\` or \`background\` |
| Output variable | \`output_var\` | \`video_analysis\` | |

${RUN_MODE}

## Outputs

| Variable | Contents |
|---|---|
| \`{{video_analysis}}\` | \`summary\`, \`scenes\` (\`start\`, \`end\`, \`title\`, \`description\`), \`labels\` (\`name\`, \`confidence\`, \`times\`), \`text\` (\`text\`, \`start\`, \`end\`), \`keyframes\`, \`answer\`, \`duration\`, \`frames_analysed\`, \`method\` (\`native\` or \`frames\`), \`provider\`, \`model\`, \`cost\` |
| \`{{video_analysis_summary}}\` | The summary |
| \`{{video_analysis_scenes}}\` | Scenes — loop over them |
| \`{{video_analysis_keyframes}}\` | Key frame images (each with \`time\`) |
| \`{{video_analysis_answer}}\` | The answer to the prompt |

## Example

\`\`\`json title="Chapters for a training video"
{
  "type": "media_analyze_video",
  "label": "Chapters",
  "config": {
    "integration_id": "<integration-id>",
    "source": "{{form.video}}",
    "features": ["summary", "scenes"],
    "keyframes": true
  }
}
\`\`\`
`,
  },
  {
    slug: 'workflows/media/redact-image',
    title: 'Redact Image',
    description: 'Blur, pixelate or box faces, license plates and sensitive text such as ID and card numbers in an image, or only report where they are.',
    body: `
**Redact Image** (\`media_redact_image\`) finds faces, license plates and sensitive text in an image and makes a copy with them blurred, pixelated or covered — or, in **Detect only**, reports where they are without changing anything.

Sensitive text is found by reading the image's text (OCR with positions) and checking it with the same [information types](/docs/workflows/documents/info-types) as Redact Document: national IDs, card and bank numbers, dates of birth and more, with check digits and context words.

::image media-redact-before-after | A specimen driver license before and after Redact Image: the face, date of birth and SSN are blurred; the name and the specimen notice are unchanged | A specimen card (not a real document) before and after: one face, one date of birth and one US SSN blurred.

## Inputs

${PROVIDER_INPUT} Not needed when the only target is **Boxes from earlier steps**.

**Image** (\`source\`): ${FILE_INPUT}

## Options

| Setting | Key | Default | What it does |
|---|---|---|---|
| Action | \`mode\` | \`redact\` | \`redact\` makes a copy; \`detect_only\` only reports findings |
| Find | \`targets\` | \`["faces", "text_pii"]\` | Any of \`faces\`, \`text_pii\` (sensitive text), \`plates\` (license plates), \`custom\` (boxes you pass in) |
| Information types | \`info_types\` | \`["@high"]\` | For \`text_pii\`: type ids, \`@high\` (every type that can reach high confidence), \`*\` or \`category:<id>\` |
| Regions | \`regions\` | every region | Limit the types to regions such as \`US\`, \`UK\`, \`NZ\` |
| Minimum confidence | \`min_confidence\` | \`medium\` | \`low\`, \`medium\` or \`high\` |
| Words and phrases | \`terms\` | — | Comma- or newline-separated text to cover wherever it appears |
| Patterns | \`patterns\` | — | Regular expressions (\`[{ "pattern": "ACC-\\\\d{6}" }]\`) |
| Boxes | \`boxes\` | — | For \`custom\`: a list of \`{ x, y, width, height }\` (fractions) or \`{ left, top, width, height }\` (pixels), optional \`label\` — for example \`{{image_analysis.faces}}\` from Analyze Image |
| Style | \`style\` | \`blur\` | \`blur\`, \`pixelate\` or \`box\` (a solid box) |
| Box color | \`color\` | \`#000000\` | For \`box\` |
| Padding | \`padding\` | 10 | Percent of each box added on every side |
| Output format | \`output_format\` | \`same\` | \`same\`, \`png\` or \`jpeg\` |
| Output file name | \`output_name\` | \`<source>-redacted\` | |
| Output variable | \`output_var\` | \`redacted_image\` (\`image_findings\` in Detect only) | |

::image media-redact-settings | Redact Image settings: Action Redact a copy, Find Faces and Sensitive text, information types All high-confidence types, regions and categories | Action, targets, information types and regions in the designer.

## Outputs

| Variable | Contents |
|---|---|
| \`{{redacted_image}}\` | \`mode\`, \`file\`, \`findings\`, \`counts\` (type → count), \`total\`, \`width\`, \`height\`, \`provider\`, \`cost\` |
| \`{{redacted_image_file}}\` | The redacted copy (not in Detect only) |
| \`{{redacted_image_findings}}\` | Findings — \`type\` (\`face\`, \`plate\`, \`custom\` or an info type id such as \`us_ssn\`), \`label\`, \`source\`, \`text\` (masked), \`confidence\`, \`box\`, \`box_px\` |
| \`{{redacted_image_count}}\` | Regions redacted (findings in Detect only) |

## Example

\`\`\`json title="Blur faces and ID numbers"
{
  "type": "media_redact_image",
  "label": "Blur faces and IDs",
  "config": {
    "integration_id": "<integration-id>",
    "source": "{{form.photo}}",
    "targets": ["faces", "text_pii"],
    "info_types": ["@high"],
    "style": "blur"
  }
}
\`\`\`

## Notes

- The covered areas are changed in the pixels of the copy; the original file is not changed.
- Box accuracy depends on the provider: Azure AI Vision and AWS measure boxes; Google Gemini's are located by the model and approximate. Run **Detect only** in Save & Test first and check the findings.
- PNG and JPEG are processed in JavaScript on every deployment; other image formats need FFmpeg.
`,
  },
  {
    slug: 'workflows/media/redact-video',
    title: 'Redact Video',
    description: 'Blur faces, license plates and sensitive text across a video, and bleep or mute sensitive speech — in video or audio-only files.',
    body: `
**Redact Video** (\`media_redact_video\`) does what [Redact Image](/docs/workflows/media/redact-image) does, over time: it analyses frames at a fixed interval (**Seconds between analysed frames**) and covers what it finds in the copy. It can also **bleep** or **mute** sensitive speech, found by transcribing the audio and checking the words against the information types and your terms.

Audio-only files — a call recording — work too: clear **Find** and set **Sensitive speech** to \`bleep\` or \`mute\`; only the speech is redacted.

::image media-bleep-detail | The Bleep card numbers step and its settings: Sensitive speech set to Bleep, Deepgram as the speech provider, the transcript from an earlier step reused, and All high-confidence types selected | Bleeping sensitive speech in a call recording, reusing the transcript from an earlier Transcribe step.

It needs FFmpeg on the server (not available on Vercel) and accepts videos up to \`MEDIA_VIDEO_REDACT_MAX_SECONDS\` (600 seconds by default).

## Inputs

${PROVIDER_INPUT} Needed for faces, plates and sensitive text on screen; not needed for **Boxes from earlier steps** alone, or for speech alone when a **Speech provider** is chosen.

**Video (or audio)** (\`source\`): ${FILE_INPUT}

## Options

Everything from [Redact Image](/docs/workflows/media/redact-image#options) (\`mode\`, \`targets\`, \`info_types\`, \`regions\`, \`min_confidence\`, \`terms\`, \`patterns\`, \`boxes\`, \`style\`, \`padding\`) — boxes may also carry \`start\` and \`end\` in seconds — plus:

| Setting | Key | Default | What it does |
|---|---|---|---|
| Seconds between analysed frames | \`sample_interval\` | 1 | At least 0.2. Shorter catches faster movement but costs more provider calls |
| Sensitive speech | \`audio\` | \`none\` | \`none\`, \`bleep\` or \`mute\` |
| Spoken information types | \`audio_info_types\` | — | Info types to find in the speech |
| Spoken words and phrases | \`audio_terms\` | — | Words to bleep or mute |
| Speech provider | \`transcribe_integration_id\` | the AI provider, when it can transcribe | The connection that transcribes the audio |
| Transcript | \`transcript\` | — | A transcript from an earlier Transcribe step (with word timings) to reuse |
| Output format | \`output_format\` | \`mp4\` | \`mp4\`, \`webm\` or \`mov\` |
| Run | \`run_mode\` | \`auto\` | \`auto\`, \`inline\` or \`background\` |
| Output variable | \`output_var\` | \`redacted_video\` (\`video_findings\` in Detect only) | |

${RUN_MODE}

## Outputs

| Variable | Contents |
|---|---|
| \`{{redacted_video}}\` | \`mode\`, \`file\`, \`findings\` (with \`start\` and \`end\`), \`counts\`, \`total\`, \`duration\`, \`frames_sampled\`, \`audio_segments\` (\`start\`, \`end\`, \`type\`, masked \`text\`), \`provider\`, \`cost\` |
| \`{{redacted_video_file}}\` | The redacted copy (not in Detect only) |
| \`{{redacted_video_findings}}\` | Findings — loop over them |
| \`{{redacted_video_count}}\` | Regions redacted (findings in Detect only) |

## Example

\`\`\`json title="Blur faces and plates, bleep IDs"
{
  "type": "media_redact_video",
  "label": "Redact dashcam clip",
  "config": {
    "integration_id": "<integration-id>",
    "source": "{{form.video}}",
    "targets": ["faces", "plates"],
    "sample_interval": 0.5,
    "audio": "bleep",
    "audio_info_types": ["@high"]
  }
}
\`\`\`

## Notes

- A region that appears between two sampled frames for less than the interval can be missed; lower \`sample_interval\` for fast motion, and review the result.
- Cost grows with the number of frames sent to the provider (duration ÷ interval).
`,
  },
  {
    slug: 'workflows/media/generate-image',
    title: 'Generate / Edit Image',
    description: 'Create images from a prompt, or edit an image with an optional mask, with OpenAI or Stability AI.',
    body: `
**Generate / Edit Image** (\`media_generate_image\`) creates images from a text prompt, or changes an existing image.

## Inputs

${PROVIDER_INPUT}

**Prompt** (\`prompt\`, required): what to draw, or what to change. Expressions allowed.

For **Edit**: **Image to edit** (\`source\`) and an optional **Mask** (\`mask\`) — a PNG the same size as the image whose transparent pixels mark the area to change. ${FILE_INPUT}

## Options

| Setting | Key | Default | What it does |
|---|---|---|---|
| Operation | \`operation\` | \`generate\` | \`generate\` or \`edit\` |
| Size | \`size\` | \`auto\` | Pixels such as \`1024x1024\` or \`1536x1024\`, or an aspect ratio such as \`16:9\` (Stability AI) |
| Images | \`count\` | 1 | 1–4 |
| Format | \`format\` | \`png\` | \`png\`, \`jpeg\` or \`webp\` |
| Quality | \`quality\` | the provider's default | Provider-specific, such as \`low\`, \`medium\`, \`high\` |
| Negative prompt | \`negative_prompt\` | — | What to avoid (Stability AI) |
| Model | \`model\` | the provider's default | |
| Output file name | \`output_name\` | \`generated\` | |
| Output variable | \`output_var\` | \`generated_image\` | |

## Outputs

| Variable | Contents |
|---|---|
| \`{{generated_image}}\` | \`file\`, \`files\`, \`revised_prompt\`, \`provider\`, \`model\`, \`cost\` |
| \`{{generated_image_file}}\` | The first image |
| \`{{generated_image_files}}\` | All images |

## Example

\`\`\`json title="A product illustration"
{
  "type": "media_generate_image",
  "label": "Illustration",
  "config": {
    "integration_id": "<integration-id>",
    "prompt": "A flat illustration of {{product.name}} on a plain background",
    "size": "1024x1024",
    "format": "png"
  }
}
\`\`\`
`,
  },
  {
    slug: 'workflows/media/text-to-speech',
    title: 'Text to Speech',
    description: 'Turn text into an audio file in a chosen voice with OpenAI, Azure AI Speech, Deepgram or ElevenLabs.',
    body: `
**Text to Speech** (\`media_tts\`) speaks text and stores the audio as a file.

## Inputs

${PROVIDER_INPUT}

**Text** (\`text\`, required): expressions allowed.

## Options

| Setting | Key | Default | What it does |
|---|---|---|---|
| Voice | \`voice\` | the provider's default | A voice name or id from the provider (for example \`alloy\` for OpenAI) |
| Format | \`format\` | \`mp3\` | \`mp3\`, \`wav\`, \`opus\`, \`aac\` or \`flac\` |
| Speed | \`speed\` | 1 | The provider's range applies |
| Language | \`language\` | detect | Such as \`en-US\` |
| Style instructions | \`instructions\` | — | How to speak ("calm and friendly"), where the model supports it |
| Model | \`model\` | the provider's default | |
| Output file name | \`output_name\` | \`speech\` | |
| Output variable | \`output_var\` | \`speech\` | |

## Outputs

| Variable | Contents |
|---|---|
| \`{{speech}}\` | \`file\`, \`characters\`, \`format\`, \`voice\`, \`provider\`, \`model\`, \`cost\` |
| \`{{speech_file}}\` | The audio file |

## Example

\`\`\`json title="A spoken notice"
{
  "type": "media_tts",
  "label": "Speak notice",
  "config": {
    "integration_id": "<integration-id>",
    "text": "Hello {{customer.first_name}}, your order {{order.number}} has shipped.",
    "format": "mp3"
  }
}
\`\`\`
`,
  },
  {
    slug: 'workflows/media/utilities',
    title: 'Media Utilities',
    description: 'Media info, extract audio or frames, make a thumbnail, trim, convert, compress or burn in subtitles — with FFmpeg on the server, no AI provider.',
    body: `
**Media Utilities** (\`media_tools\`) changes audio and video files with FFmpeg on the server. It needs no AI provider and sends nothing out. It is not available on Vercel (no FFmpeg) — see [Where it runs](/docs/workflows/media#where-it-runs).

## Inputs

**Audio or video** (\`source\`): ${FILE_INPUT}

## Operations

| Operation | \`operation\` | Settings | Output |
|---|---|---|---|
| Get media info | \`info\` | — | Duration, size, container, bit rate, video codec / size / frame rate / rotation, audio codec / sample rate / channels |
| Extract audio | \`extract_audio\` | \`format\`: \`mp3\` (default), \`wav\`, \`m4a\`, \`ogg\`, \`flac\` | An audio file |
| Extract frames | \`frames\` | \`interval\` (seconds, default 1), \`count\` (default 10, at most 100), \`format\` \`png\` or \`jpeg\` | A list of images, each with \`time\` |
| Thumbnail | \`thumbnail\` | \`at\` (default 1 second, or 10 % into a short clip), \`format\` | An image |
| Trim | \`trim\` | \`start\` and / or \`end\`: seconds (\`12.5\`) or \`hh:mm:ss[.ms]\` | A shorter file |
| Convert format | \`convert\` | \`format\`: \`mp4\`, \`webm\`, \`mov\`, \`gif\`, \`mp3\`, \`wav\`, \`m4a\`, \`ogg\`, \`flac\`; optional \`max_width\`, \`max_height\` | A new file |
| Compress | \`compress\` | \`quality\`: \`low\` (smallest), \`medium\`, \`high\`; optional \`max_width\`, \`max_height\` | A smaller file |
| Burn in subtitles | \`burn_subtitles\` | \`subtitles\`: an SRT or VTT file, SRT text, or a transcript from Transcribe | A video with the subtitles drawn in |

Also: **Run** (\`run_mode\`, \`auto\` / \`inline\` / \`background\`), **Output file name** (\`output_name\`) and **Output variable** (\`output_var\`).

## Outputs

| Operation | Variable | Contents |
|---|---|---|
| \`info\` | \`{{media_info}}\` | \`duration\`, \`size\`, \`format\`, \`bit_rate\`, \`has_video\`, \`has_audio\`, \`video\` (\`codec\`, \`width\`, \`height\`, \`fps\`, \`rotation\`), \`audio\` (\`codec\`, \`sample_rate\`, \`channels\`) |
| \`frames\` | \`{{frames}}\`, \`{{frames_count}}\` | The frame images (each with \`time\`) and how many |
| every other | \`{{media_file}}\` | The new file |

## Example

\`\`\`json title="Add subtitles to a clip"
[
  { "type": "media_transcribe", "label": "Transcribe",
    "config": { "integration_id": "<integration-id>", "source": "{{form.video}}", "formats": ["srt"] } },
  { "type": "media_tools", "label": "Burn in subtitles",
    "config": { "operation": "burn_subtitles", "source": "{{form.video}}", "subtitles": "{{transcript_srt}}" } }
]
\`\`\`
`,
  },
  {
    slug: 'workflows/media/how-to/transcribe-meeting',
    title: 'Transcribe a meeting recording and email the summary',
    description: 'A form takes a meeting recording; the workflow transcribes it with speaker labels, has an agent summarise it and emails the summary with the SRT transcript attached.',
    body: `
A team uploads meeting recordings through a form. The workflow transcribes each one, asks an agent for a summary with action items, and emails it to the organiser with the subtitle file attached.

You need a connection that can transcribe (see [Provider setup](/docs/workflows/media/providers)) and an agent that summarises (see [AI agents](/docs/agents)).

## 1. The form

Create a form with an **Attachments** field \`recording\` (accept audio and video) and an **Email** field \`organiser\`. Use a **Form submitted** trigger, so the file is \`{{form.recording}}\`.

## 2. Transcribe

Add **Transcribe Audio / Video**. Choose the connection in **AI provider**, set **Audio or video** to \`{{form.recording}}\`, turn on **Label speakers**, and keep **Files** at **SRT**.

\`\`\`json title="Transcribe"
{
  "type": "media_transcribe",
  "label": "Transcribe meeting",
  "config": {
    "integration_id": "<integration-id>",
    "source": "{{form.recording}}",
    "diarize": true,
    "formats": ["srt"],
    "output_var": "transcript"
  }
}
\`\`\`

The canvas shows \`SRT · speakers → transcript\` (with the provider name in front). A recording longer than five minutes runs in the background (run mode **Auto**) and the workflow continues when the transcript is ready.

## 3. Summarise

Add **Run Agent** with a prompt that includes the text:

\`\`\`json title="Summarise"
{
  "type": "run_agent",
  "label": "Summarise",
  "config": {
    "agent_id": "<agent-id>",
    "agent_name": "Meeting notes",
    "user_message": "Summarise this meeting in five bullet points, then list action items with owners.\\n\\n{{transcript_text}}",
    "output_variable": "summary"
  }
}
\`\`\`

With speaker labels, the segments in \`{{transcript_segments}}\` carry \`speaker\`; ask the agent to attribute action items if you pass them instead of the plain text.

## 4. Email

Add **Send Email** to \`{{form.organiser}}\` with the summary in the body and the SRT file attached:

\`\`\`json title="Send the summary"
{
  "type": "send_email",
  "label": "Email summary",
  "config": {
    "to": "{{form.organiser}}",
    "subject": "Meeting summary",
    "body": "{{summary}}",
    "attachments": "{{transcript_srt}}"
  }
}
\`\`\`

## 5. Test

Press **Save & Test** with a short recording (Save & Test always runs inline). The run history shows the duration, segment count, a short preview and the estimated cost — never the whole transcript.
`,
  },
  {
    slug: 'workflows/media/how-to/blur-photos',
    title: 'Blur faces and ID numbers in photos before storing',
    description: 'Blur faces and sensitive text such as ID and card numbers in uploaded photos with Redact Image, then store the redacted copy.',
    body: `
Field staff upload photos of documents and sites. Before the photos are kept, faces and ID numbers must be blurred.

You need a connection that can locate faces and read text with positions: **Azure AI Vision**, **AWS** or **Google Gemini** (see the [capability matrix](/docs/workflows/media#providers-and-capabilities)). OpenAI cannot return boxes.

## 1. Check what is found

Add **Redact Image** after the form trigger. Set **Image** to \`{{form.photo}}\` (for several photos, put the step inside a [Loop](/docs/workflows/nodes#node-loop) over \`{{form.photos}}\` and use \`{{item}}\`). Choose **Detect only**, and under **Find** keep **Faces** and **Sensitive text**. **Information types** defaults to **All high-confidence types**; narrow it with **Regions** if you like.

Press **Save & Test** with a sample photo and look at \`findings\` in the step's output: each has a \`type\` (\`face\`, or an info type such as \`us_passport\`), a masked \`text\`, a \`confidence\` and a \`box\`.

## 2. Redact

Switch **Action** to **Redact a copy** and keep **Style** at **Blur**:

\`\`\`json title="Blur faces and IDs"
{
  "type": "media_redact_image",
  "label": "Blur faces and IDs",
  "config": {
    "integration_id": "<integration-id>",
    "source": "{{form.photo}}",
    "targets": ["faces", "text_pii"],
    "info_types": ["@high"],
    "style": "blur",
    "padding": 10
  }
}
\`\`\`

The canvas shows \`faces, sensitive text · blur → redacted_image\`. The copy is \`{{redacted_image_file}}\`.

## 3. Store it

Use the file object like any form attachment:

- keep \`{{redacted_image_file.url}}\` or \`{{redacted_image_file.storage_ref}}\` in a data table row with **Update Data Table**, or
- attach it to an email, convert it with **File to Base64** for an API, or upload it with a storage connector.

Branch on \`{{redacted_image_count}}\` to flag photos where nothing was found, if every photo is expected to contain an ID.

## Tips

- Add \`plates\` to **Find** for vehicle photos (needs a provider with object boxes).
- Use **Solid box** instead of blur for documents you will print.
- Have Analyze Image return \`faces\` first, then pass \`{{image_analysis.faces}}\` as **Boxes** with the target **Boxes from earlier steps** to reuse its boxes.
`,
  },
  {
    slug: 'workflows/media/how-to/redact-support-call',
    title: 'Redact PII from a support call recording',
    description: 'Transcribe a support call, then bleep card numbers, dates of birth and the customer\'s name in the audio with Redact Video — it handles audio-only files.',
    body: `
Support calls are recorded as audio files. Before they are shared for training, card numbers, dates of birth and the customer's name must be bleeped.

**Redact Video handles audio-only input**: with **Sensitive speech** set to **Bleep**, it transcribes the call, finds the sensitive words and bleeps them. There are no frames to analyse, so clear **Find** and choose a transcription connection as the **Speech provider**. It needs FFmpeg on the server (the Docker image includes it; Vercel does not).

## 1. Transcribe (optional, reusable)

If you also want the text, transcribe first with word timings and pass the result on, so the call is transcribed only once:

\`\`\`json title="Transcribe the call"
{
  "type": "media_transcribe",
  "label": "Transcribe call",
  "config": {
    "integration_id": "<integration-id>",
    "source": "{{form.call}}",
    "diarize": true,
    "word_timestamps": true,
    "formats": ["txt"],
    "output_var": "transcript"
  }
}
\`\`\`

## 2. Bleep the audio

Add **Redact Video**. Set **Video (or audio)** to \`{{form.call}}\`, clear **Find**, set **Sensitive speech** to **Bleep**, choose **Spoken information types** (for example *Credit / debit card number* and *Date of birth*) and add the customer's name under **Spoken words and phrases**. Put \`{{transcript}}\` in **Transcript** to reuse step 1.

\`\`\`json title="Bleep sensitive speech"
{
  "type": "media_redact_video",
  "label": "Bleep PII",
  "config": {
    "transcribe_integration_id": "<integration-id>",
    "source": "{{form.call}}",
    "targets": [],
    "audio": "bleep",
    "audio_info_types": ["credit_card", "date_of_birth"],
    "audio_terms": "{{form.customer_name}}",
    "transcript": "{{transcript}}"
  }
}
\`\`\`

The bleeped copy is \`{{redacted_video_file}}\`; \`{{redacted_video.audio_segments}}\` lists what was bleeped and when (text masked).

## 3. Check and share

Run **Save & Test** with a sample call, listen to the copy, and check \`audio_segments\`. Speech recognition can miss or mishear words, so review a sample of calls before relying on it. Then attach \`{{redacted_video_file}}\` to an email or store it.
`,
  },
]
