import type { ScreenshotName } from '@/lib/docs/screenshot-names'

/**
 * Use-case pages for the cloud marketing site (/use-cases and
 * /use-cases/<slug>). Pure data so the pages, the landing section, the sitemap
 * and tests share one list. Statements about other vendors stay factual and
 * neutral: plain product names, no logos, no disparagement.
 */

export type UseCaseIcon = 'inbox' | 'shield' | 'bot' | 'plug' | 'list' | 'route' | 'layers' | 'scale' | 'captions' | 'car' | 'headset' | 'id' | 'image'
  | 'smile' | 'heart' | 'graduation' | 'hardhat' | 'ticket' | 'signature'

/** One box in the architecture diagram. Keep labels short (~26 chars). */
export type DiagramItem = { label: string; note?: string }

export type UseCaseDiagram = {
  /** Accessible name and description of the SVG. */
  title: string
  desc: string
  left: { label: string; items: DiagramItem[] }
  center: { label: string; items: string[] }
  right: { label: string; items: DiagramItem[] }
}

/** Sections of the /use-cases index. */
export type UseCaseGroup = 'platform' | 'media' | 'forms'

export type UseCase = {
  slug: string
  /** Index section: the platform use cases, images, audio and video, or surveys and forms built on the official form controls (default platform). */
  group?: UseCaseGroup
  /** Slug of the ready-made gallery package (/gallery/<slug>) the page offers. */
  gallery?: string
  icon: UseCaseIcon
  eyebrow: string
  /** Page heading. */
  title: string
  /** <title> / Open Graph title (without the brand suffix). */
  metaTitle: string
  description: string
  /** One or two sentences for cards. */
  summary: string
  keywords: string[]
  problem: { title: string; body: string; points: string[] }
  solution: { title: string; body: string; points: string[] }
  diagram: UseCaseDiagram
  /** Concept mapping for migration pages: what you have → what you use. */
  mapping?: { title: string; body: string; from: string; rows: Array<{ from: string; to: string; href?: string }> }
  /** Dated facts with their sources (SharePoint retirement timeline). */
  timeline?: { title: string; body: string; events: Array<{ date: string; text: string }>; sources: Array<{ label: string; href: string }> }
  features: Array<{ title: string; body: string; href: string }>
  snippet: { title: string; body: string; language: 'shell' | 'ts' | 'json'; code: string }
  screenshot: { name: ScreenshotName; alt: string; caption: string }
  steps?: Array<{ title: string; body: string }>
  /** Heading of the steps section (default: the migration plan heading). */
  stepsHeading?: { eyebrow: string; title: string }
  faqs: Array<{ question: string; answer: string }>
  /** Small print under the hero (trademark notice on migration pages). */
  disclaimer?: string
  related: string[]
}

const TRADEMARKS = 'UserTasks is an independent product and is not affiliated with or endorsed by the vendors named on this page. Product names are trademarks of their respective owners.'

/**
 * Use cases for the media steps (images, audio and video). Each one has a
 * ready-made package in the gallery (`gallery`). Wording about redaction and
 * records law stays careful: automated redaction helps a reviewer, a person
 * approves every release, and deadlines are configurable examples, not
 * legal advice.
 */
const MEDIA_USE_CASES: UseCase[] = [
  {
    slug: 'foia-evidence-redaction',
    group: 'media',
    gallery: 'foia-records-request-redaction',
    icon: 'scale',
    eyebrow: 'Public records and evidence redaction',
    title: 'Public records requests with AI-assisted redaction and a person who approves every release',
    metaTitle: 'FOIA and public records requests: evidence redaction workflow',
    description: 'Handle FOIA, state public records and Official Information Act requests from intake to release: statutory deadlines and SLAs, body-cam video, photos, audio and documents redacted for review, an exemptions log, legal approval and a release package.',
    summary: 'FOIA and public records requests: deadlines, AI-assisted redaction of video, photos, audio and documents, an exemptions log and legal approval before release.',
    keywords: ['FOIA request workflow', 'public records request software', 'body camera video redaction', 'evidence redaction workflow', 'OIA request tracking', 'exemption log', 'redact faces license plates video'],
    problem: {
      title: 'Requests have deadlines. Video takes hours to redact by hand.',
      body: 'Public records requests arrive by email and web forms, each with a statutory clock. Responsive records are increasingly body-worn camera and CCTV video, photos and interview audio, and every face, licence plate and spoken phone number of a bystander has to be found before release. Doing that frame by frame is slow, and the reasons for each redaction are easy to lose.',
      points: ['Deadlines tracked in a spreadsheet, extensions noticed too late', 'Hours of manual blurring per minute of video, bleeping audio by ear', 'Exemptions and approvals that are hard to reconstruct when a decision is reviewed'],
    },
    solution: {
      title: 'Automation finds what to redact. People decide what is released.',
      body: 'A request form starts the workflow: the deadline comes from a rules table you configure, an SLA and acknowledgement follow, and a records officer attaches the responsive records. Redact Video, Redact Image, Transcribe and Redact Document prepare redacted copies and propose exemptions; a legal reviewer compares every original with its redacted copy and approves a full or partial release, or denies it. Only then is the release package built and sent.',
      points: ['Statutory days, day types and default exemption codes as an editable decision table (examples, not legal advice)', 'Faces, licence plates and on-screen ID numbers blurred over time; spoken personal details bleeped from the transcript', 'An exemptions log per item and a cover letter, merged into a PDF release package', 'Originals stay restricted to the request; every step is written to an audit trail with a retention policy'],
    },
    diagram: {
      title: 'Public records request and evidence redaction architecture',
      desc: 'A request form starts the run. UserTasks sets the deadline and SLA, gathers records from a records officer, prepares redacted copies of video, photos, audio and documents with your own AI provider key, and waits for a legal reviewer. Approved releases are sent as a package or download link; every step is logged.',
      left: { label: 'Requests and records', items: [{ label: 'Request form', note: 'Form page · API' }, { label: 'Body-cam and CCTV video', note: 'Attachments' }, { label: 'Photos, audio, documents', note: 'Attachments' }] },
      center: { label: 'UserTasks engine', items: ['Deadline rules → SLA', 'Redact video, image, audio, text', 'Exemptions log', 'Legal review task', 'Release package'] },
      right: { label: 'Out', items: [{ label: 'Requester', note: 'Letters · package · link' }, { label: 'Your AI provider', note: 'Gemini, OpenAI, Azure, AWS' }, { label: 'Audit trail', note: 'Data table · retention' }] },
    },
    features: [
      { title: 'Redact Video', body: 'Faces, plates and on-screen text tracked over time; bleep or mute personal details in the speech.', href: '/docs/workflows/media/redact-video' },
      { title: 'Redact Image', body: 'Blur, pixelate or box faces, plates and sensitive text in each photo.', href: '/docs/workflows/media/redact-image' },
      { title: 'Redact Document', body: 'Find personal information for review, then redact it in Word, PDF or text.', href: '/docs/workflows/documents/redact' },
      { title: 'Assignment and SLAs', body: 'Statutory deadlines as SLAs, reminders and extensions.', href: '/docs/tasks/assignment-and-slas' },
      { title: 'Decision tables', body: 'Deadlines and default exemptions per regime, editable by the records team.', href: '/docs/decision-tables' },
      { title: 'Audit and retention', body: 'Request activity trail and retention policies for requests and logs.', href: '/docs/governance/audit-and-retention' },
    ],
    snippet: {
      title: 'One step blurs faces and plates and bleeps the speech',
      body: 'Redact Video samples frames, tracks what it finds and writes a redacted copy; long clips run in the background and the run resumes when the job is done. The original stays where it was attached.',
      language: 'json',
      code: `{
  "type": "media_redact_video",
  "label": "Redact Video: faces, plates, text, speech",
  "config": {
    "integration_id": "<your media AI provider>",
    "source": "{{evidence.bodycam_video}}",
    "targets": ["faces", "plates", "text_pii"],
    "audio": "bleep",
    "audio_info_types": ["@high", "phone", "email"],
    "style": "blur",
    "run_mode": "background",
    "output_var": "redacted_video"
  }
}`,
    },
    screenshot: { name: 'media-foia-review', alt: 'A legal review task for a public records request with links to each original and its redacted copy, exemption codes and Approve release, Partial release, Deny and Send back buttons', caption: 'The legal reviewer compares each original with its redacted copy and confirms the exemptions before anything is released.' },
    stepsHeading: { eyebrow: 'The flow', title: 'From request to release' },
    steps: [
      { title: 'Request and deadline', body: 'The request form starts the run; the rules table gives the statutory days (for example 20 business days under the US FOIA or 20 working days under the NZ OIA), an SLA and an acknowledgement email.' },
      { title: 'Gather records', body: 'The records officer attaches video, photos, interview audio and documents, or answers no records or extend deadline, which send their own letters.' },
      { title: 'Prepare redactions', body: 'Faces, plates and on-screen text are blurred, personal details bleeped from the audio, the transcript and document checked, and each item gets a proposed exemption.' },
      { title: 'Approve and release', body: 'A legal reviewer approves, approves in part, denies or sends back. Approved releases become a PDF package with cover letter and exemption log, sent by email or download link.' },
    ],
    faqs: [
      { question: 'Does the AI decide what is released?', answer: 'No. The media steps find faces, licence plates, on-screen numbers and spoken personal details and prepare redacted copies. A legal reviewer compares every original with its redacted copy, confirms the exemption codes and approves, approves in part or denies. Nothing is sent before that decision.' },
      { question: 'Are the deadlines and exemption codes correct for my jurisdiction?', answer: 'They are configurable examples, not legal advice. The package ships rows for the US federal FOIA, an example US state act, the New Zealand Official Information Act and the UK Freedom of Information Act; check day counting, holidays, extensions and exemptions with your counsel and edit the tables to match.' },
      { question: 'Where does the video go?', answer: 'Media is sent to the AI provider you connect with your own key (Google Gemini by default; OpenAI, Azure AI, AWS and others are supported) to find what to redact. Originals stay as restricted attachments of the request and are never attached to emails; redacted copies are stored in your workspace storage.' },
      { question: 'How long can the video be?', answer: 'Redact Video handles clips up to MEDIA_VIDEO_REDACT_MAX_SECONDS (10 minutes by default) and runs long ones in the background with FFmpeg. Split longer recordings or raise the limit on a self-hosted instance with the resources for it.' },
    ],
    disclaimer: 'Automated redaction is an aid for reviewers and can miss things; a person must check every redaction before release. Nothing on this page is legal advice.',
    related: ['support-call-qa-redaction', 'identity-document-kyc', 'approvals-and-compliance'],
  },
  {
    slug: 'meeting-minutes-from-recordings',
    group: 'media',
    gallery: 'meeting-recording-minutes',
    icon: 'captions',
    eyebrow: 'Meeting minutes',
    title: 'Meeting recordings to minutes, action items and owners',
    metaTitle: 'Meeting recording to minutes and action items workflow',
    description: 'Upload a meeting recording and get a transcript with speakers, AI-drafted minutes the organiser checks, a task for each action owner and the minutes emailed with SRT subtitles.',
    summary: 'A recording becomes a transcript with speakers, minutes the organiser checks, and a task for every action owner.',
    keywords: ['meeting minutes from recording', 'transcribe meeting with speakers', 'action items from meeting', 'AI meeting minutes workflow', 'srt from meeting recording'],
    problem: {
      title: 'Minutes are late, and action items fall through the gap.',
      body: 'Someone has to listen back, write the minutes and chase every owner. When nobody does, decisions get re-argued and actions live only in the memory of whoever was in the room.',
      points: ['Hours spent writing up a one-hour meeting', 'Actions with no owner, no date and no follow-up', 'Note-taking bots that assign work without anyone checking'],
    },
    solution: {
      title: 'AI drafts. The organiser checks. Owners get tasks.',
      body: 'Transcribe Audio / Video separates the speakers and writes SRT and VTT files; an agent drafts the summary, decisions and action items with the names said in the meeting. The organiser corrects the draft and picks each owner from the workspace people, and each action becomes a task with its due date.',
      points: ['Speaker labels, timestamps and subtitle files from your own AI provider key', 'Structured agent output: summary, decisions and actions with suggested owners', 'A person assigns every action: the agent only suggests names', 'Minutes as PDF plus SRT by email; actions tracked in a data table'],
    },
    diagram: {
      title: 'Meeting minutes architecture',
      desc: 'The organiser uploads a recording on a form page. UserTasks transcribes it with speakers, an agent drafts the minutes and actions, the organiser reviews them in a task and each action becomes a task for its owner. The minutes go out by email.',
      left: { label: 'In', items: [{ label: 'Meeting recording', note: 'Form page upload' }, { label: 'Attendees and recipients', note: 'Form fields' }] },
      center: { label: 'UserTasks engine', items: ['Transcribe with speakers', 'Agent drafts minutes', 'Organiser review task', 'Task per action owner'] },
      right: { label: 'Out', items: [{ label: 'Minutes PDF and SRT', note: 'Email' }, { label: 'Action items', note: 'Tasks · data table' }, { label: 'Your AI provider', note: 'Transcription · model' }] },
    },
    features: [
      { title: 'Transcribe Audio / Video', body: 'Timed segments, speaker labels and SRT / VTT / text files.', href: '/docs/workflows/media/transcribe' },
      { title: 'AI agents', body: 'Structured outputs for summaries, decisions and actions.', href: '/docs/agents' },
      { title: 'Forms', body: 'A form page with an attachments field for the recording.', href: '/docs/tasks/forms' },
      { title: 'How-to: transcribe a meeting', body: 'The step-by-step guide this package builds on.', href: '/docs/workflows/media/how-to/transcribe-meeting' },
    ],
    snippet: {
      title: 'Transcript with speakers in one step',
      body: 'The recording comes straight from the form’s attachments field; the transcript, segments and files are variables the next steps use.',
      language: 'json',
      code: `{
  "type": "media_transcribe",
  "config": {
    "integration_id": "<your media AI provider>",
    "source": "{{form.recording}}",
    "diarize": true,
    "formats": ["srt", "vtt", "txt"],
    "output_var": "transcript"
  }
}`,
    },
    screenshot: { name: 'media-transcribe', alt: 'The Transcribe Audio / Video step in the workflow designer with speaker and subtitle settings', caption: 'Transcribe with speakers and subtitle files, then hand the text to an agent.' },
    stepsHeading: { eyebrow: 'The flow', title: 'From recording to follow-up' },
    steps: [
      { title: 'Upload', body: 'The organiser uploads the recording with the meeting details and confirms everyone agreed to it.' },
      { title: 'Transcribe and draft', body: 'Speakers and timestamps, then an agent drafts the summary, decisions and up to three actions.' },
      { title: 'Check and assign', body: 'The organiser edits the draft and picks an owner and due date for each action.' },
      { title: 'Send and follow up', body: 'Owners get tasks; the minutes go out as a PDF with the SRT attached.' },
    ],
    faqs: [
      { question: 'Can the agent assign tasks to people?', answer: 'No. It suggests owners by the names said in the meeting; the organiser picks the actual person from the workspace people before any task is created.' },
      { question: 'Which providers can transcribe?', answer: 'Google Gemini by default, and any provider with transcription: OpenAI, Azure AI Speech, Deepgram, AssemblyAI, ElevenLabs or AWS Transcribe, each with your own key.' },
      { question: 'What about consent?', answer: 'The form asks the organiser to confirm everyone agreed to being recorded and transcribed. Follow your own policy and local law on recording meetings.' },
    ],
    related: ['support-call-qa-redaction', 'ai-agent-orchestration', 'foia-evidence-redaction'],
  },
  {
    slug: 'insurance-claim-photo-assessment',
    group: 'media',
    gallery: 'insurance-claim-photo-assessment',
    icon: 'car',
    eyebrow: 'Insurance claims',
    title: 'Claim photos assessed in seconds, decided by an adjuster',
    metaTitle: 'Insurance claim photo assessment and triage workflow',
    description: 'Claimants upload damage photos; AI describes the damage and estimates severity, a decision table triages the claim and sets the SLA, an adjuster decides, and repairers only get copies with faces and licence plates blurred.',
    summary: 'Damage photos analysed and triaged by rules, an adjuster decides, and repairers get copies with faces and plates blurred.',
    keywords: ['insurance claim photo assessment', 'AI vehicle damage triage', 'claims triage decision table', 'blur license plates claim photos', 'first notice of loss workflow'],
    problem: {
      title: 'Every claim waits for someone to look at the photos.',
      body: 'Minor dents and serious damage arrive in the same queue. Adjusters open each claim to decide how urgent it is, and the photos that go to repairers carry faces and licence plates that have nothing to do with the repair.',
      points: ['Simple claims waiting behind complex ones', 'Triage rules that live in adjusters’ heads', 'Personal data shared with third parties by default'],
    },
    solution: {
      title: 'A structured first look, rules for the queue, a person for the decision.',
      body: 'Analyze Image returns a description and a structured assessment: severity, damaged parts, a rough cost range and whether the photo matches the story. A decision table turns that and the cover into a band and an SLA. The adjuster sees the assessment marked as a hint and approves, asks for an inspection or declines.',
      points: ['Structured answers you define: severity, parts, cost range, drivable, confidence', 'Triage bands and SLAs as an editable decision table', 'Faces and licence plates blurred on every copy that leaves the claim', 'Approval and decline letters generated as PDFs'],
    },
    diagram: {
      title: 'Claim photo assessment architecture',
      desc: 'A claim form with photos starts the run. UserTasks analyses the photos, triages with a decision table, blurs faces and plates on shareable copies and creates an adjuster task. Letters go to the claimant and blurred photos to the repairer.',
      left: { label: 'In', items: [{ label: 'Claim form', note: 'Photos from the phone' }, { label: 'Policy and cover', note: 'Form fields' }] },
      center: { label: 'UserTasks engine', items: ['Analyze Image: damage', 'Decision table: triage + SLA', 'Redact Image: faces, plates', 'Adjuster task'] },
      right: { label: 'Out', items: [{ label: 'Claimant letters', note: 'PDF · email' }, { label: 'Repairer job', note: 'Blurred photos' }, { label: 'Claims register', note: 'Data table' }] },
    },
    features: [
      { title: 'Analyze Image', body: 'Descriptions, labels, objects and structured answers to your question.', href: '/docs/workflows/media/analyze-image' },
      { title: 'Redact Image', body: 'Blur faces and licence plates before photos are shared.', href: '/docs/workflows/media/redact-image' },
      { title: 'Decision tables', body: 'Triage bands, estimate bands and SLAs as rules.', href: '/docs/decision-tables' },
      { title: 'Assignment and SLAs', body: 'Due dates, reminders and escalation to the adjuster’s manager.', href: '/docs/tasks/assignment-and-slas' },
    ],
    snippet: {
      title: 'Ask the photo a structured question',
      body: 'With fields set, Analyze Image answers as an object the decision table can read directly.',
      language: 'json',
      code: `{
  "type": "media_analyze_image",
  "config": {
    "source": "{{form.damage_photos}}",
    "prompt": "Assess the visible vehicle damage for an adjuster.",
    "fields": [
      { "name": "severity", "type": "string" },
      { "name": "estimate_high", "type": "number" },
      { "name": "drivable", "type": "boolean" }
    ],
    "output_var": "damage"
  }
}`,
    },
    screenshot: { name: 'media-claim-before-after', alt: 'An illustrated damage photo before and after Redact Image, with the bystander’s face and the licence plate blurred', caption: 'The adjuster keeps the original; the repairer gets the copy with the face and plate blurred.' },
    stepsHeading: { eyebrow: 'The flow', title: 'From photos to a decision' },
    steps: [
      { title: 'Report damage', body: 'The claimant fills in the claim form and adds photos from their phone.' },
      { title: 'Assess and triage', body: 'Analyze Image returns the assessment; the decision table sets the band and SLA.' },
      { title: 'Blur for sharing', body: 'Every photo gets a copy with faces and plates blurred.' },
      { title: 'Adjuster decides', body: 'Approve repair, request an inspection or decline; letters and the repairer job follow.' },
    ],
    faqs: [
      { question: 'Is the AI estimate a settlement?', answer: 'No. It is a hint for triage and for the adjuster, who decides every claim and sets the approved amount.' },
      { question: 'Can it detect fraud?', answer: 'It flags whether the photo looks consistent with the description, which helps an adjuster decide where to look. It is not a fraud detector and should not be used to decline a claim on its own.' },
      { question: 'Who sees the original photos?', answer: 'The claim file and the adjuster. Copies sent to repairers have faces and licence plates blurred.' },
    ],
    related: ['identity-document-kyc', 'user-generated-media-moderation', 'approvals-and-compliance'],
  },
  {
    slug: 'support-call-qa-redaction',
    group: 'media',
    gallery: 'support-call-qa-redaction',
    icon: 'headset',
    eyebrow: 'Contact-centre QA',
    title: 'Score every support call, and archive it with card numbers bleeped',
    metaTitle: 'Support call QA scoring and PII redaction workflow',
    description: 'Transcribe each finished call, bleep card numbers and IDs from the recording and mask them in the transcript, score the call against your QA rubric with an AI agent, and send low scores to a supervisor.',
    summary: 'Every call transcribed, card numbers bleeped and masked, scored against your QA rubric, with low scores sent to a supervisor.',
    keywords: ['call center QA automation', 'redact credit card from call recording', 'bleep PII audio', 'AI call scoring', 'PCI call recording redaction'],
    problem: {
      title: 'QA samples a handful of calls. The archive keeps every card number.',
      body: 'Supervisors can only listen to a few calls per agent, and recordings with card numbers and dates of birth sit in storage for years. Sending raw transcripts to a model for scoring would spread that data further.',
      points: ['QA coverage of a few percent of calls', 'Recordings and transcripts full of card and ID numbers', 'Scoring tools that see everything the customer said'],
    },
    solution: {
      title: 'Redact first, then score, then let a person review.',
      body: 'The call is transcribed with speakers, card numbers and IDs are bleeped at the times they were spoken and masked in the transcript, and only the masked transcript reaches the QA agent. A decision table sends low scores, negative customers and unverified account changes to a supervisor.',
      points: ['Bleep or mute personal details in audio, from the transcript timings', 'The scoring agent never sees unmasked values', 'QA thresholds and review priorities as a decision table', 'Only redacted copies archived, with a retention policy'],
    },
    diagram: {
      title: 'Support call QA architecture',
      desc: 'Your telephony platform posts each finished call. UserTasks transcribes it, bleeps and masks personal details, scores the masked transcript with an agent, archives the redacted copies and sends flagged calls to a supervisor.',
      left: { label: 'In', items: [{ label: 'Telephony platform', note: 'Webhook · API' }, { label: 'Call recording', note: 'Signed URL' }] },
      center: { label: 'UserTasks engine', items: ['Transcribe: agent and customer', 'Bleep audio, mask transcript', 'Agent: QA rubric score', 'Supervisor review task'] },
      right: { label: 'Out', items: [{ label: 'QA archive', note: 'Redacted copies' }, { label: 'Agent feedback', note: 'Email' }, { label: 'Your AI provider', note: 'Transcription · model' }] },
    },
    features: [
      { title: 'Redact Video (audio)', body: 'Bleep or mute sensitive speech in audio and video.', href: '/docs/workflows/media/redact-video' },
      { title: 'Transcribe Audio / Video', body: 'Speaker labels and word timings for bleeping.', href: '/docs/workflows/media/transcribe' },
      { title: 'How-to: redact a support call', body: 'The guide behind this package.', href: '/docs/workflows/media/how-to/redact-support-call' },
      { title: 'AI agents', body: 'A QA rubric with structured scores and coaching notes.', href: '/docs/agents' },
    ],
    snippet: {
      title: 'Start it from your telephony platform',
      body: 'Post the call id and a signed recording URL when the call ends; the rest runs without a UI until a supervisor is needed.',
      language: 'shell',
      code: `curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \\
  -H "Authorization: Bearer $USERTASKS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"workflow_id":"<id>","variables":{
        "call_id":"CALL-0042",
        "recording_url":"https://telephony.example.com/rec/0042.mp3",
        "agent_name":"Casey Example","queue":"Billing"}}'`,
    },
    screenshot: { name: 'media-bleep-detail', alt: 'Run details of a Redact Video step listing the bleeped speech segments with masked card and ID numbers', caption: 'Each bleeped segment is listed with its time and a masked value — never the value itself.' },
    stepsHeading: { eyebrow: 'The flow', title: 'From call to coaching' },
    steps: [
      { title: 'Call ends', body: 'Your platform posts the call id, recording URL, agent and queue.' },
      { title: 'Transcribe and redact', body: 'Speakers are separated; card numbers and IDs are bleeped and masked.' },
      { title: 'Score', body: 'The QA agent scores the masked transcript; thresholds decide on a review.' },
      { title: 'Review and archive', body: 'Supervisors coach on flagged calls; redacted copies are archived with retention.' },
    ],
    faqs: [
      { question: 'Does this make us PCI compliant?', answer: 'No tool does that on its own. Bleeping card numbers from recordings and masking transcripts reduces where card data is stored, but your compliance depends on your whole process, including the original recordings in your telephony platform.' },
      { question: 'What if a number is missed?', answer: 'Detection depends on the transcript. Supervisors listen to flagged calls, and you can tighten the info types or add custom patterns and terms.' },
      { question: 'Is the original recording stored?', answer: 'Not by this package: it reads the recording from your platform’s URL and archives only the redacted copy and masked transcript.' },
    ],
    related: ['meeting-minutes-from-recordings', 'foia-evidence-redaction', 'ai-agent-orchestration'],
  },
  {
    slug: 'identity-document-kyc',
    group: 'media',
    gallery: 'kyc-id-document-redaction',
    icon: 'id',
    eyebrow: 'Identity checks (KYC)',
    title: 'ID document capture that keeps only what you need',
    metaTitle: 'KYC identity document capture with redaction for storage',
    description: 'Customers upload an ID photo and a selfie; the document is read, checked against the form by rules, the ID number is blacked out on the stored copy, and a person compares the photos and decides. No face recognition.',
    summary: 'ID photo and selfie: fields read and checked by rules, the number blacked out for storage, and a person compares the photos.',
    keywords: ['KYC document capture workflow', 'ID document OCR', 'redact ID number', 'identity verification review', 'data minimisation KYC'],
    problem: {
      title: 'Identity checks collect more data than they keep a reason for.',
      body: 'Onboarding teams retype fields from ID photos, and full-resolution scans with every number end up stored for years, in more places than anyone intended.',
      points: ['Manual retyping of names, dates and numbers', 'Full ID images kept indefinitely', 'Black-box verification nobody can explain'],
    },
    solution: {
      title: 'Read, check, redact — and a person decides.',
      body: 'Analyze Image reads the printed fields and finds face boxes; a Regex and conditions compare them with the form and a decision table flags anything odd. Redact Image blacks out the number on the stored copy. The reviewer compares the selfie with the ID photo themselves.',
      points: ['Extracted fields as a structured answer', 'Rule checks you can read and change', 'ID number blacked out on the stored copy; masked to its last four characters in the table', 'No face recognition or face matching: a person compares the photos'],
    },
    diagram: {
      title: 'Identity document capture architecture',
      desc: 'A form page collects the ID photo and selfie. UserTasks reads the document, checks it with rules, stores a redacted copy and creates a review task; verified identities keep masked fields only.',
      left: { label: 'In', items: [{ label: 'Verify your identity form', note: 'Phone camera' }, { label: 'ID photo and selfie', note: 'Attachments' }] },
      center: { label: 'UserTasks engine', items: ['Analyze Image: fields, face boxes', 'Regex, conditions, rules', 'Redact Image: number', 'Reviewer task'] },
      right: { label: 'Out', items: [{ label: 'Verified identities', note: 'Masked fields' }, { label: 'Redacted copy', note: 'Storage' }, { label: 'Customer email', note: 'Outcome' }] },
    },
    features: [
      { title: 'Analyze Image', body: 'Text with positions, face boxes and structured answers.', href: '/docs/workflows/media/analyze-image' },
      { title: 'Redact Image', body: 'Box or blur ID numbers and other sensitive text.', href: '/docs/workflows/media/redact-image' },
      { title: 'How-to: blur photos', body: 'Blur faces and ID numbers before storing photos.', href: '/docs/workflows/media/how-to/blur-photos' },
      { title: 'Audit and retention', body: 'Retention policies for the identity records you keep.', href: '/docs/governance/audit-and-retention' },
    ],
    snippet: {
      title: 'Black out the number before you store the copy',
      body: 'Redact Image finds sensitive text on the document and writes a new PNG; the original stays a restricted attachment.',
      language: 'json',
      code: `{
  "type": "media_redact_image",
  "config": {
    "source": "{{form.id_photo}}",
    "targets": ["text_pii"],
    "info_types": ["@high"],
    "style": "box",
    "output_var": "redacted_id"
  }
}`,
    },
    screenshot: { name: 'media-redact-before-after', alt: 'A specimen ID card before and after Redact Image', caption: 'A specimen card before and after redaction. The package keeps a copy with the number blacked out.' },
    stepsHeading: { eyebrow: 'The flow', title: 'From upload to a verified record' },
    steps: [
      { title: 'Upload', body: 'The customer adds an ID photo and a selfie on the form page.' },
      { title: 'Read and check', body: 'Fields are read, the number format checked and name and date of birth compared with the form.' },
      { title: 'Redact', body: 'The number is blacked out on a stored copy and masked in the table.' },
      { title: 'Review', body: 'A person compares the photos and verifies, asks for new documents or rejects.' },
    ],
    faqs: [
      { question: 'Does UserTasks match the selfie to the ID photo?', answer: 'No. The media steps only find face boxes and read text; they never identify a person or compare faces. The reviewer compares the photos and records that they did.' },
      { question: 'Is this a complete KYC / AML solution?', answer: 'No. It handles document capture, reading, rule checks, redaction and human review. Liveness checks, sanctions screening and document authenticity checks need specialist providers, which you can add as integrations.' },
      { question: 'What is kept after verification?', answer: 'The masked fields and a redacted copy in the Verified identities table, under a retention policy. Purge the original uploads on your own schedule.' },
    ],
    related: ['insurance-claim-photo-assessment', 'foia-evidence-redaction', 'approvals-and-compliance'],
  },
  {
    slug: 'user-generated-media-moderation',
    group: 'media',
    gallery: 'ugc-media-moderation',
    icon: 'image',
    eyebrow: 'Content moderation',
    title: 'Moderate uploads with AI triage and people for the hard calls',
    metaTitle: 'User-generated image and video moderation workflow',
    description: 'Images and videos arrive from your platform by API; AI scores them against your guidelines, a decision table approves or rejects clear cases, a moderator queue handles the rest, and your platform publishes or hides the upload.',
    summary: 'AI safety checks on images and videos, thresholds for clear cases, a moderator queue for the rest, and uploaders told the outcome.',
    keywords: ['content moderation workflow', 'image moderation API', 'video moderation queue', 'human in the loop moderation', 'user generated content review'],
    problem: {
      title: 'Uploads never stop, and every one needs a decision.',
      body: 'Reviewing every upload by hand does not scale, and a fully automatic filter makes mistakes nobody can appeal. Sensitive categories need a person, and every decision needs a reason.',
      points: ['Queues that grow quicker than moderators can clear them', 'Automatic rejections with no explanation or appeal', 'Decisions without a record of who decided and why'],
    },
    solution: {
      title: 'Automate the clear cases. Queue the rest.',
      body: 'Analyze Image or Analyze Video returns a structured verdict: risk score, category and reason. A decision table approves low risk, rejects high risk and queues the borderline and sensitive cases for a moderator. Your platform API publishes or hides the upload and the uploader is told how to appeal.',
      points: ['Your guidelines as a prompt and a structured answer', 'Thresholds and always-review categories as a decision table', 'Moderator tasks with the AI reason marked as a triage aid', 'Every decision logged with a retention policy'],
    },
    diagram: {
      title: 'Media moderation architecture',
      desc: 'Your platform posts each upload. UserTasks analyses it, applies thresholds, queues borderline items for a moderator and calls your platform to publish or hide it, telling the uploader.',
      left: { label: 'In', items: [{ label: 'Your platform', note: 'Webhook · API' }, { label: 'Image or video', note: 'Signed URL' }] },
      center: { label: 'UserTasks engine', items: ['Analyze Image / Video', 'Decision table: thresholds', 'Moderator task', 'Moderation log'] },
      right: { label: 'Out', items: [{ label: 'Publish or hide', note: 'Your platform API' }, { label: 'Uploader email', note: 'With appeal' }, { label: 'Your AI provider', note: 'Your key' }] },
    },
    features: [
      { title: 'Analyze Image', body: 'Descriptions, labels and structured answers.', href: '/docs/workflows/media/analyze-image' },
      { title: 'Analyze Video', body: 'Whole-video or sampled-frame analysis with answers.', href: '/docs/workflows/media/analyze-video' },
      { title: 'Decision tables', body: 'Approve, reject and review bands.', href: '/docs/decision-tables' },
      { title: 'User tasks', body: 'A moderator queue with outcome buttons.', href: '/docs/tasks' },
    ],
    snippet: {
      title: 'Start a check for each upload',
      body: 'Post the upload id and a media URL; the workflow calls back to your platform when it decides.',
      language: 'shell',
      code: `curl -X POST "$USERTASKS_URL/api/v1/workflows/start" \\
  -H "Authorization: Bearer $USERTASKS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"workflow_id":"<id>","variables":{
        "upload_id":"UP-0042","media_type":"image",
        "media_url":"https://cdn.example.com/u/0042.jpg",
        "uploader_email":"river@example.com"}}'`,
    },
    screenshot: { name: 'media-test-run', alt: 'A workflow test run with the output of a media step', caption: 'Test the moderation workflow with a sample upload before you connect your platform.' },
    stepsHeading: { eyebrow: 'The flow', title: 'From upload to decision' },
    steps: [
      { title: 'Upload arrives', body: 'Your platform posts the upload id, media URL and uploader.' },
      { title: 'AI verdict', body: 'Risk score, category, child safety concern and a reason.' },
      { title: 'Thresholds', body: 'Clear cases are approved or rejected; the rest go to a moderator.' },
      { title: 'Publish or hide', body: 'Your platform is called, the uploader is told and the decision is logged.' },
    ],
    faqs: [
      { question: 'Is the AI verdict final?', answer: 'Only for the bands you configure. Borderline items, self-harm and any possible child safety issue always go to a person, and uploaders can appeal.' },
      { question: 'What about child safety reports?', answer: 'The package queues possible child safety issues for specialist review; reporting to the authorities must follow your legal process and the hash-matching services your platform uses.' },
      { question: 'Can I use a dedicated moderation model?', answer: 'Yes. Add an OpenAI or AWS integration and use Analyze Image with the Safety feature, or keep the structured prompt with Gemini.' },
    ],
    related: ['insurance-claim-photo-assessment', 'ai-agent-orchestration', 'support-call-qa-redaction'],
  },
]

/**
 * Use cases built on the official form controls (ratings, sliders, Likert
 * matrices, editable tables, signatures, charts, saved reports, PDF viewer)
 * and nothing but built-in features: each one has a "No integrations needed"
 * package in the gallery (`gallery`). Signatures are internal sign-offs and
 * attestations, not a qualified e-signature service; NPS and engagement
 * thresholds are editable examples.
 */
const FORMS_USE_CASES: UseCase[] = [
  {
    slug: 'customer-satisfaction-nps-survey',
    group: 'forms',
    gallery: 'csat-nps-survey',
    icon: 'smile',
    eyebrow: 'Customer satisfaction and NPS',
    title: 'A customer survey that calls back every unhappy customer',
    metaTitle: 'CSAT and NPS survey with detractor follow-up workflow',
    description: 'Run a CSAT and Net Promoter Score survey on your own form page: star rating, 0-10 slider, Likert matrix and comment, every answer classified by a decision table, detractors called back within an SLA, and NPS charted by month.',
    summary: 'Star rating, 0-10 NPS slider and Likert matrix on a survey page; detractors get a follow-up call with an SLA, and NPS is charted by month.',
    keywords: ['NPS survey workflow', 'CSAT survey software', 'detractor follow-up process', 'net promoter score tracking', 'customer feedback form with likert scale', 'close the loop customer feedback'],
    problem: {
      title: 'Survey tools collect scores. Nobody calls the detractors.',
      body: 'Scores land in a survey tool, a spreadsheet or a monthly slide. The customer who gave you a 2 last Tuesday hears nothing back, the reasons behind low scores are never recorded, and NPS is worked out by hand once a quarter.',
      points: ['Low scores with no owner and no deadline', 'Reasons for detractors lost in free-text exports', 'NPS calculated by hand, long after it could help'],
    },
    solution: {
      title: 'Every answer is classified, saved and, when it is low, followed up.',
      body: 'Customers answer a three-step survey page with a progress bar and a review step. A decision table turns the 0-10 score into promoter, passive or detractor and decides how fast someone follows up; the answer is saved in a data table, and detractors become a call task with an SLA, reminders and escalation. A results page charts NPS by month and lists the open follow-ups.',
      points: ['Rating, Slider, Likert scale and Rich text controls on a stepped form page', 'Thresholds and follow-up hours as an editable decision table', 'Root cause, call notes and what was agreed recorded on the follow-up, and emailed to the customer', 'NPS trend, category split and open follow-ups on a results page'],
    },
    diagram: {
      title: 'Customer satisfaction survey architecture',
      desc: 'A customer submits the survey page. UserTasks classifies the answer with a decision table, saves it in a data table, creates a follow-up call task with an SLA for detractors and emails the customer. A results page charts NPS from the data table and shows saved reports.',
      left: { label: 'In', items: [{ label: 'Survey page', note: 'Form page · API' }, { label: 'Rating, slider, Likert', note: 'Form controls' }] },
      center: { label: 'UserTasks engine', items: ['Decision table: NPS category', 'Save to Survey responses', 'Follow-up task with SLA', 'Monthly summary'] },
      right: { label: 'Out', items: [{ label: 'Customer', note: 'Thank-you and follow-up email' }, { label: 'Results page', note: 'Charts · saved reports' }] },
    },
    features: [
      { title: 'Official form controls', body: 'Rating, Slider, Likert scale, Rich text, Chart and Saved report, installed with the package.', href: '/docs/tasks/gallery-form-controls' },
      { title: 'Steps and review', body: 'A three-step survey with a progress bar, a review step and resume later.', href: '/docs/tasks/forms' },
      { title: 'Decision tables', body: 'Promoter, passive and detractor thresholds and follow-up hours, editable without the designer.', href: '/docs/decision-tables' },
      { title: 'Assignment and SLAs', body: 'Follow-up calls within 24 or 48 hours, with reminders and manager escalation.', href: '/docs/tasks/assignment-and-slas' },
      { title: 'Reports', body: 'NPS by product area from workflow variables, and the open follow-ups.', href: '/docs/reports' },
    ],
    snippet: {
      title: 'A 0-10 slider is one field on the form',
      body: 'Official controls are fields like any other: the value is a number the decision table reads as {{form.nps}}.',
      language: 'json',
      code: `{
  "key": "nps",
  "type": "custom",
  "label": "How likely are you to recommend us to a friend or colleague?",
  "required": true,
  "custom": {
    "tag": "ut-slider",
    "version": "1.0.0",
    "props": { "min": 0, "max": 10, "step": 1, "marks": ["0 Not at all likely", "5", "10 Extremely likely"] }
  }
}`,
    },
    screenshot: { name: 'forms-csat-survey', alt: 'The customer satisfaction survey page: a progress bar, five-star rating and a 0-10 slider for how likely the customer is to recommend the company', caption: 'The survey page: star rating and 0-10 slider on the first of three steps, with a progress bar and a review step at the end.' },
    stepsHeading: { eyebrow: 'The flow', title: 'From answer to call-back' },
    steps: [
      { title: 'Customer answers', body: 'Star rating, 0-10 slider, a Likert matrix on the experience and a comment, across three steps with a review.' },
      { title: 'Classify and save', body: 'The decision table sets promoter, passive or detractor and the follow-up hours; the answer goes into Survey responses.' },
      { title: 'Call back', body: 'Detractors get a call task with an SLA; what was agreed is recorded and emailed to the customer.' },
      { title: 'Watch the trend', body: 'The results page charts NPS by month, the category split and the open follow-ups.' },
    ],
    faqs: [
      { question: 'Do customers need an account?', answer: 'Form pages are for people signed in to your workspace. For customers outside it, submit the same form from your own site or app with POST /api/v1/forms/{id}/submit and the workflow runs the same way.' },
      { question: 'How is the NPS worked out?', answer: 'Each answer gets +100 (promoter, 9-10), 0 (passive, 7-8) or -100 (detractor, 0-6). The average of those points is the NPS: the percentage of promoters minus the percentage of detractors. The thresholds are in a decision table you can edit.' },
      { question: 'Can I change the questions?', answer: 'Yes. The survey is a normal form: change the Likert statements, add steps or fields in the form designer. Renaming a Likert statement changes the key its answer is stored under, so update any expression that reads it.' },
    ],
    related: ['employee-pulse-survey', 'training-quiz-certificates', 'approvals-and-compliance'],
  },
  {
    slug: 'employee-pulse-survey',
    group: 'forms',
    gallery: 'employee-pulse-survey',
    icon: 'heart',
    eyebrow: 'Employee engagement',
    title: 'Pulse surveys that turn low scores into a manager conversation',
    metaTitle: 'Employee pulse survey and engagement questionnaire workflow',
    description: 'Run an employee engagement pulse survey in steps with Likert matrices per section, an anonymous option and an eNPS slider; scores by department on a results page, and managers asked to follow up on low, non-anonymous scores.',
    summary: 'A stepped questionnaire with Likert matrices, an anonymous option and eNPS; results by department, and manager follow-ups for low scores.',
    keywords: ['employee pulse survey', 'engagement survey workflow', 'eNPS survey', 'anonymous employee survey', 'likert scale questionnaire', 'manager follow-up engagement'],
    problem: {
      title: 'The annual survey is too late, and the results go nowhere.',
      body: 'Engagement surveys run once a year, arrive as a slide deck months later, and rarely lead to a conversation with the people who scored low. Anonymous answers are mixed with named ones, so people do not trust them either way.',
      points: ['Results long after anything could change', 'No follow-up owner for low scores', 'Unclear what is anonymous and what is not'],
    },
    solution: {
      title: 'Short, regular pulses with a clear anonymous option and a follow-up.',
      body: 'Employees answer a short questionnaire in steps with a progress bar: a Likert matrix per section, an eNPS slider and an overall mood rating. Section scores and an engagement score are worked out in the workflow, a decision table sets the band, and a low score from someone who did not choose to be anonymous becomes a follow-up task for their manager with an action plan. Anonymous answers are only counted.',
      points: ['Likert matrices per section, eNPS Slider, Rating and Rich text', 'Anonymous answers stored without a name, and never routed to a manager', 'Action plans as an editable table on the manager\'s task', 'Engagement by department and eNPS by round on a results page'],
    },
    diagram: {
      title: 'Employee pulse survey architecture',
      desc: 'An employee submits the pulse questionnaire. UserTasks scores each section, bands the result with a decision table, saves it, and for low named scores gives the manager a follow-up task with an action plan. A results page charts engagement by department.',
      left: { label: 'In', items: [{ label: 'Pulse questionnaire', note: 'Steps · progress bar' }, { label: 'Likert, slider, rating', note: 'Form controls' }] },
      center: { label: 'UserTasks engine', items: ['Section and engagement scores', 'Decision table: band', 'Save to Pulse responses', 'Manager follow-up task'] },
      right: { label: 'Out', items: [{ label: 'Manager', note: 'Action plan task' }, { label: 'Results page', note: 'Charts · saved reports' }] },
    },
    features: [
      { title: 'Official form controls', body: 'Likert scale, Slider, Rating, Rich text, Progress, Info card and Chart.', href: '/docs/tasks/gallery-form-controls' },
      { title: 'Steps with a progress bar', body: 'One section per step, conditional fields for the anonymous option.', href: '/docs/tasks/forms' },
      { title: 'Decision tables', body: 'Score bands and when a manager follows up.', href: '/docs/decision-tables' },
      { title: 'Data tables', body: 'Every answer, with department and round, ready to chart and export.', href: '/docs/data-tables' },
      { title: 'Reports', body: 'Engagement by department and eNPS by round from workflow variables.', href: '/docs/reports' },
    ],
    snippet: {
      title: 'A Likert matrix stores one number per statement',
      body: 'The answer is an object keyed by the statement, so the workflow can average a section with plain expressions.',
      language: 'json',
      code: `{
  "key": "wellbeing",
  "type": "custom",
  "label": "Wellbeing",
  "custom": {
    "tag": "ut-likert",
    "version": "1.0.0",
    "props": {
      "scale": "agree5",
      "statements": ["I have the energy I need for my work", "I can switch off after work"]
    }
  }
}
// value: { "i_have_the_energy_i_need_for_my_work": 4, "i_can_switch_off_after_work": 2 }`,
    },
    screenshot: { name: 'forms-pulse-questionnaire', alt: 'A step of the employee pulse questionnaire with a progress bar and a Likert matrix of agree-disagree statements', caption: 'One section per step: a Likert matrix with a progress bar, and an anonymous option at the start.' },
    stepsHeading: { eyebrow: 'The flow', title: 'From pulse to conversation' },
    steps: [
      { title: 'Employee answers', body: 'Likert matrices per section, eNPS slider and mood rating, named or anonymous.' },
      { title: 'Score and band', body: 'Section and engagement scores are calculated and a decision table sets the band.' },
      { title: 'Manager follows up', body: 'Low named scores give the manager a task with the scores and an action plan table.' },
      { title: 'See the trend', body: 'The results page charts engagement by department and eNPS by round.' },
    ],
    faqs: [
      { question: 'How anonymous are anonymous answers?', answer: 'An anonymous answer is saved without the person\'s name or manager and never creates a follow-up task. The workflow run still records who submitted the form, as every form submission does, so decide who can see runs and set retention before you promise full anonymity.' },
      { question: 'Can I change the sections and statements?', answer: 'Yes, in the form designer. The scores are Set Variable expressions over the Likert answers; update them when you add or rename statements.' },
      { question: 'Who receives the follow-ups?', answer: 'The manager the employee names on the form, or the person who installed the package when no manager is given. Change the routing in the designer.' },
    ],
    related: ['customer-satisfaction-nps-survey', 'training-quiz-certificates', 'approvals-and-compliance'],
  },
  {
    slug: 'training-quiz-certificates',
    group: 'forms',
    gallery: 'training-quiz-certification',
    icon: 'graduation',
    eyebrow: 'Training and assessment',
    title: 'Course feedback, a scored quiz and a certificate on a pass',
    metaTitle: 'Training quiz, assessment scoring and certificate workflow',
    description: 'Collect course feedback and run a scored quiz on one form, attest with a signature, and on a pass generate a PDF certificate with its expiry; retakes and fails become tasks, and results are charted by course.',
    summary: 'Feedback and a scored quiz on one form with a signed attestation; a PDF certificate on a pass, and retake or coaching tasks otherwise.',
    keywords: ['training quiz workflow', 'assessment scoring form', 'training certificate generator', 'course feedback form', 'compliance training attestation', 'quiz pass mark'],
    problem: {
      title: 'Quizzes are scored by hand and certificates are made in Word.',
      body: 'Training teams collect feedback in one tool, run the quiz in another, mark it by hand and copy names into a certificate template. Nobody tracks who needs a retake or when a certificate expires.',
      points: ['Manual marking and copy-paste certificates', 'No record that the learner did the quiz themselves', 'Expiry dates and retakes kept in a spreadsheet'],
    },
    solution: {
      title: 'One form, scored by the workflow, with a certificate on a pass.',
      body: 'The learner picks the course from a lookup, rates the trainer and the content, answers the quiz and signs an attestation. The workflow scores the answers, a decision table applies the pass mark, and a pass produces a PDF certificate with a number and expiry date by email. A retake goes back to the learner with the score shown; a fail becomes a coaching task with an SLA.',
      points: ['Rating, Likert scale, Signature and Progress controls', 'Pass, retake and fail bands in a decision table', 'Certificates as PDF built from a template in the workflow, no document service', 'Average score and pass rate by course on a results page'],
    },
    diagram: {
      title: 'Training quiz and certificate architecture',
      desc: 'A learner submits the feedback and quiz form with a signature. UserTasks scores it, applies the pass mark with a decision table, generates a PDF certificate on a pass and records the result; retakes and fails become tasks.',
      left: { label: 'In', items: [{ label: 'Feedback and quiz', note: 'Tabs or steps' }, { label: 'Signature attestation', note: 'Form control' }] },
      center: { label: 'UserTasks engine', items: ['Score the answers', 'Decision table: pass mark', 'Certificate PDF', 'Retake or coaching task'] },
      right: { label: 'Out', items: [{ label: 'Learner', note: 'Certificate by email' }, { label: 'Quiz results', note: 'Data table · reports' }] },
    },
    features: [
      { title: 'Official form controls', body: 'Rating, Likert scale, Signature, Progress and Chart on the forms.', href: '/docs/tasks/gallery-form-controls' },
      { title: 'Convert Document', body: 'The certificate text becomes a PDF inside the workflow.', href: '/docs/workflows/documents/convert-document' },
      { title: 'Decision tables', body: 'Pass, retake and fail bands per course.', href: '/docs/decision-tables' },
      { title: 'Data tables', body: 'Courses with pass marks and validity, and every result.', href: '/docs/data-tables' },
      { title: 'Reports', body: 'Pass rates and average scores from workflow variables.', href: '/docs/reports' },
    ],
    snippet: {
      title: 'Scoring is an expression per question',
      body: 'Each answer adds a point when it matches; the decision table compares the percentage with the course pass mark.',
      language: 'json',
      code: `{
  "type": "set_variable",
  "label": "Score",
  "config": {
    "name": "score_pct",
    "expression": "{{=ROUND((IF(form.q1 == \\"Report it to IT security\\", 1, 0) + IF(form.q2 == \\"Lock the screen\\", 1, 0) + IF(form.q3 == \\"A password manager\\", 1, 0)) * 100 / 3, 0)}}"
  }
}`,
    },
    screenshot: { name: 'forms-training-quiz', alt: 'The attestation step of the training feedback and quiz form: a stepper showing course, feedback and quiz completed, a confirmation checkbox and the learner\'s signature', caption: 'The last step before the review: the learner confirms they did the quiz themselves and signs. The workflow then scores it and issues the certificate.' },
    stepsHeading: { eyebrow: 'The flow', title: 'From quiz to certificate' },
    steps: [
      { title: 'Learner answers', body: 'Course lookup, feedback ratings, the quiz and a signature attesting they did it themselves.' },
      { title: 'Score and band', body: 'Expressions score each answer; the decision table applies the course pass mark.' },
      { title: 'Certificate', body: 'A pass generates a PDF certificate with a number and expiry date, emailed and recorded.' },
      { title: 'Retake or coach', body: 'Near misses go back to the learner; fails become a coaching task with an SLA.' },
    ],
    faqs: [
      { question: 'Is the signature a legal e-signature?', answer: 'It is an internal attestation: the drawn or typed signature is stored as an image with the submission, alongside who was signed in and when. For contracts that need a qualified or regulated e-signature, use a signature service.' },
      { question: 'Can I use my own certificate design?', answer: 'The package builds the certificate from text in the workflow so it needs no template. To use your branded Word template, swap the step for Word Document with find and replace, then Convert Document to PDF.' },
      { question: 'Can learners see the right answers?', answer: 'Not from the package. The correct answers live in the workflow\'s scoring expressions, which only people who can edit workflows see.' },
    ],
    related: ['employee-pulse-survey', 'site-safety-inspections', 'contract-policy-review-signoff'],
  },
  {
    slug: 'site-safety-inspections',
    group: 'forms',
    gallery: 'site-inspection-corrective-actions',
    icon: 'hardhat',
    eyebrow: 'Safety inspections',
    title: 'Site inspections where every failed item becomes a tracked action',
    metaTitle: 'Safety inspection checklist and corrective action workflow',
    description: 'Inspect a site with an editable checklist table, photos, a severity rating and the inspector\'s signature; every failed item becomes a corrective-action task with an SLA and a signed-off fix, and open actions are reported by site.',
    summary: 'An editable checklist, photos, severity and signature on one form; every failed item becomes a corrective action with an SLA and a signed-off fix.',
    keywords: ['safety inspection checklist app', 'corrective action tracking', 'site inspection form', 'workplace inspection workflow', 'health and safety audit checklist', 'CAPA workflow'],
    problem: {
      title: 'Failed checks end up on paper. Fixes are never confirmed.',
      body: 'Inspections are done on paper or in a spreadsheet, failed items are emailed to whoever might fix them, and nobody can say how many actions are open, which site is worst, or who confirmed the fix.',
      points: ['Checklists that cannot be reported on', 'Failed items without an owner or a deadline', 'No evidence that a fix was done and checked'],
    },
    solution: {
      title: 'One inspection form, one task per failed item, one place to see what is open.',
      body: 'The inspector picks the site, works through a checklist table with pass, fail or N/A, severity and notes, adds photos and signs. The workflow counts the failures, a decision table sets the outcome and the deadlines, and each failed item becomes a corrective-action task with an SLA, a photo of the fix and a signed sign-off. An overview page shows open actions by site and severity.',
      points: ['Editable table, Rating, Signature, Progress and Info card controls', 'Outcome bands and deadlines per severity in a decision table', 'Each corrective action signed off with evidence', 'Open actions by site from data tables and saved reports'],
    },
    diagram: {
      title: 'Site inspection and corrective action architecture',
      desc: 'An inspector submits the checklist with photos and a signature. UserTasks counts the failed items, sets the outcome with a decision table, records the inspection and creates a corrective-action task per failed item, each signed off when fixed.',
      left: { label: 'In', items: [{ label: 'Inspection form', note: 'Checklist table · photos' }, { label: 'Inspector signature', note: 'Form control' }] },
      center: { label: 'UserTasks engine', items: ['Count failed items', 'Decision table: outcome, SLA', 'Corrective action per item', 'Signed-off fix'] },
      right: { label: 'Out', items: [{ label: 'Site manager', note: 'Inspection report email' }, { label: 'Overview page', note: 'Open actions · reports' }] },
    },
    features: [
      { title: 'Official form controls', body: 'Editable table, Rating, Signature, Progress, Info card and Chart.', href: '/docs/tasks/gallery-form-controls' },
      { title: 'Forms and attachments', body: 'Site lookup that fills the details, photo uploads and steps.', href: '/docs/tasks/forms' },
      { title: 'Decision tables', body: 'Outcome bands and deadlines from the failed items and severity.', href: '/docs/decision-tables' },
      { title: 'Assignment and SLAs', body: 'Corrective-action deadlines by severity, reminders and escalation.', href: '/docs/tasks/assignment-and-slas' },
      { title: 'Data tables', body: 'Sites, inspections and corrective actions, with sample rows.', href: '/docs/data-tables' },
    ],
    snippet: {
      title: 'Failed rows of the checklist table, in one expression',
      body: 'The checklist is an array of rows; the workflow filters the failures and loops over them.',
      language: 'json',
      code: `{
  "type": "set_variable",
  "label": "Failed items",
  "config": {
    "name": "failed_items",
    "expression": "{{=FILTER_WHERE(form.checklist, \\"status\\", \\"Fail\\")}}"
  }
}`,
    },
    screenshot: { name: 'forms-inspection-checklist', alt: 'The checklist step of the site safety inspection form: an editable table of eight checks with their area and Pass, Fail or N/A status', caption: 'The checklist step: an editable table of standard checks. Each Fail row, with its severity and notes, becomes a corrective action.' },
    stepsHeading: { eyebrow: 'The flow', title: 'From inspection to fixed' },
    steps: [
      { title: 'Inspect', body: 'Site lookup, checklist table with pass, fail or N/A, severity, photos and the inspector\'s signature.' },
      { title: 'Assess', body: 'Failed items are counted and a decision table sets the outcome and deadlines; stop-work outcomes alert at once.' },
      { title: 'Fix', body: 'Each failed item becomes a corrective action with an SLA, fixed with a photo and a signed sign-off.' },
      { title: 'Review', body: 'The overview page shows open actions by site and severity, and the inspection history.' },
    ],
    faqs: [
      { question: 'Does it work on a tablet on site?', answer: 'Yes. The form, the checklist table and the signature pad work with touch, and photos can be taken with the device camera from the upload field. The page needs a connection to submit.' },
      { question: 'Can I change the checklist?', answer: 'Yes. The default checklist rows are a property of the table control; edit them in the form designer, or keep separate forms per site type.' },
      { question: 'Does it make us compliant with safety regulations?', answer: 'It records inspections, actions and sign-offs consistently; what you must inspect and how often depends on your regulator and your own risk assessment.' },
    ],
    related: ['training-quiz-certificates', 'contract-policy-review-signoff', 'approvals-and-compliance'],
  },
  {
    slug: 'event-registration-capacity',
    group: 'forms',
    gallery: 'event-registration-sessions',
    icon: 'ticket',
    eyebrow: 'Event registration',
    title: 'Event registration with session choices, capacity and a waitlist',
    metaTitle: 'Event registration with session capacity and waitlist workflow',
    description: 'Register several attendees at once with an editable table, collect session preferences, check seats against your sessions table, confirm or waitlist automatically, email every attendee and follow the event on an organiser dashboard.',
    summary: 'Register a group in one form, choose sessions, confirm or waitlist against capacity, email each attendee and watch seats fill on a dashboard.',
    keywords: ['event registration workflow', 'session capacity waitlist', 'group event registration form', 'conference session selection', 'internal event sign up', 'attendee confirmation email'],
    problem: {
      title: 'Registration spreadsheets overbook sessions.',
      body: 'Sign-ups arrive by form or email one person at a time, someone checks seats by hand, popular sessions are overbooked and waitlisted people are never offered an alternative.',
      points: ['Group sign-ups typed in one by one', 'Seats counted by hand, sessions overbooked', 'Waitlists without an owner'],
    },
    solution: {
      title: 'Seats are checked as people register, and the waitlist has an owner.',
      body: 'One person registers their group in an editable table with dietary and accessibility needs, picks sessions and rates their interest. The workflow counts the attendees, checks the seats left in the Sessions table, confirms and updates the seats, or waitlists and gives the organiser a task to offer an alternative. Every attendee gets a confirmation, and the organiser dashboard shows seats taken against capacity.',
      points: ['Editable table, Slider, Rating and Rich text on the registration form', 'Capacity from a data table, updated on every confirmation', 'Waitlist task for the organiser with an SLA', 'Seats, sessions and dietary needs on an organiser dashboard'],
    },
    diagram: {
      title: 'Event registration architecture',
      desc: 'A registrant submits attendees and session choices. UserTasks checks capacity in the Sessions table, confirms or waitlists, emails each attendee and records them; waitlisted registrations become a task for the organiser. A dashboard charts seats against capacity.',
      left: { label: 'In', items: [{ label: 'Registration form', note: 'Attendee table · sessions' }, { label: 'Events and sessions', note: 'Data tables' }] },
      center: { label: 'UserTasks engine', items: ['Count attendees', 'Check seats left', 'Confirm or waitlist', 'Organiser task'] },
      right: { label: 'Out', items: [{ label: 'Attendees', note: 'Confirmation emails' }, { label: 'Organiser dashboard', note: 'Charts · saved reports' }] },
    },
    features: [
      { title: 'Official form controls', body: 'Editable table, Slider, Rating, Rich text, Chart, Progress and Saved report.', href: '/docs/tasks/gallery-form-controls' },
      { title: 'Data tables', body: 'Events, sessions with capacity, registrations and attendees.', href: '/docs/data-tables' },
      { title: 'Forms', body: 'Lookups that fill the event details, steps and a review.', href: '/docs/tasks/forms' },
      { title: 'Email templates', body: 'Confirmation and waitlist emails per attendee.', href: '/docs/email-templates' },
      { title: 'Reports', body: 'Registrations by session and attendees by dietary need.', href: '/docs/reports' },
    ],
    snippet: {
      title: 'How many people did they register?',
      body: 'The attendee table is a list of rows: count it and compare with the seats left.',
      language: 'json',
      code: `{
  "type": "condition",
  "label": "Seats left?",
  "config": {
    "branches": [{
      "label": "Confirm",
      "logic": "and",
      "rules": [{ "field": "{{=COUNT(form.attendees)}}", "operator": "lte", "value": "{{seats_left}}" }]
    }],
    "has_else": true
  }
}`,
    },
    screenshot: { name: 'forms-event-dashboard', alt: 'The organiser dashboard with a chart of seats taken against capacity per session and a saved report of registrations', caption: 'The organiser dashboard: seats taken per session from the Sessions table, and registrations from a saved report.' },
    stepsHeading: { eyebrow: 'The flow', title: 'From sign-up to seat' },
    steps: [
      { title: 'Register', body: 'Event lookup, an attendee table, session choices and interest ratings, with a review step.' },
      { title: 'Check capacity', body: 'Attendees are counted and compared with the seats left in the Sessions table.' },
      { title: 'Confirm or waitlist', body: 'Confirmed seats are taken and every attendee is emailed; waitlisted groups get an organiser task.' },
      { title: 'Run the event', body: 'The dashboard shows seats against capacity, registrations and dietary needs.' },
    ],
    faqs: [
      { question: 'Can people outside the company register?', answer: 'Form pages are for signed-in people. For external events, post the same form from your website with the forms API and the workflow runs the same way.' },
      { question: 'What happens when two people register for the last seats at once?', answer: 'Each run reads the seats left and updates them in turn; for very popular sessions, keep a small buffer in the capacity or let the organiser confirm the last seats from the waitlist task.' },
      { question: 'Can attendees cancel?', answer: 'Not in the package as shipped. Add a cancellation form that updates the Registrations row and frees the seats, and offer them to the waitlist.' },
    ],
    related: ['customer-satisfaction-nps-survey', 'site-safety-inspections', 'approvals-and-compliance'],
  },
  {
    slug: 'contract-policy-review-signoff',
    group: 'forms',
    gallery: 'contract-policy-review-esign',
    icon: 'signature',
    eyebrow: 'Document review and sign-off',
    title: 'Policy and contract review with redlines, approvals and a signed sign-off',
    metaTitle: 'Policy and contract review, approval and internal sign-off workflow',
    description: 'Review a policy or contract PDF in the browser, comment with rich-text redlines, route it to reviewers and legal, and finish with a drawn signature, a sign-off certificate, an audit log and a retention policy.',
    summary: 'Reviewers read the PDF in the task, comment in rich text and approve; the owner signs off with a signature, and every step is in an audit log.',
    keywords: ['policy review workflow', 'contract review and approval', 'internal document sign-off', 'PDF review and approval process', 'document approval audit trail', 'policy management workflow'],
    problem: {
      title: 'Review rounds live in email threads and attachments.',
      body: 'Drafts go back and forth as attachments, comments arrive in five places, nobody is sure which version legal approved, and the sign-off is a reply saying "approved". When an auditor asks, the trail has to be rebuilt.',
      points: ['Versions and comments scattered across email', 'Approvals without a record of who saw which version', 'No register of what is due for review'],
    },
    solution: {
      title: 'One review route per document type, with the PDF in every task.',
      body: 'The owner submits the PDF and a summary of the changes. The document type sets the route: reviewers, legal when needed and the retention period. Each reviewer reads the PDF in the task, writes redline comments and approves or asks for changes, which send it back to the owner for a new version. The final sign-off is signed, a certificate is generated, and every step is written to an audit log.',
      points: ['PDF viewer, Rich text, Signature, Chart and Saved report controls', 'Review routes per document type as a data table', 'Request changes loops back to the owner with an SLA', 'Audit log, document register and a retention policy'],
    },
    diagram: {
      title: 'Policy and contract review architecture',
      desc: 'The owner submits a PDF. UserTasks routes it by document type to reviewers and legal, each reading it in the task and approving or requesting changes, then collects a signed sign-off, generates a certificate and writes every step to an audit log.',
      left: { label: 'In', items: [{ label: 'Submission form', note: 'PDF · summary of changes' }, { label: 'Document types', note: 'Review routes' }] },
      center: { label: 'UserTasks engine', items: ['Reviewer tasks with PDF viewer', 'Changes back to the owner', 'Legal review when needed', 'Signed sign-off and certificate'] },
      right: { label: 'Out', items: [{ label: 'Audit log', note: 'Data table · retention' }, { label: 'Document register', note: 'Dashboard · reports' }] },
    },
    features: [
      { title: 'Official form controls', body: 'PDF viewer, Rich text, Signature, Info card, Chart and Saved report.', href: '/docs/tasks/gallery-form-controls' },
      { title: 'Task forms', body: 'The PDF, comments and outcome buttons on every review task.', href: '/docs/tasks/forms' },
      { title: 'Convert Document', body: 'The sign-off certificate as a PDF.', href: '/docs/workflows/documents/convert-document' },
      { title: 'Audit and retention', body: 'An audit log of every step and a retention policy for it.', href: '/docs/governance/audit-and-retention' },
      { title: 'Assignment and SLAs', body: 'Review deadlines, reminders and escalation.', href: '/docs/tasks/assignment-and-slas' },
    ],
    snippet: {
      title: 'The PDF viewer shows another field\'s file',
      body: 'Map the viewer\'s Document context to the field that holds the uploaded PDF; reviewers read it without downloading anything.',
      language: 'json',
      code: `{
  "key": "document_view",
  "type": "custom",
  "label": "The document",
  "custom": {
    "tag": "ut-pdf-viewer",
    "version": "1.0.0",
    "props": { "allow_upload": false },
    "context_map": { "document": "document" }
  }
}`,
    },
    screenshot: { name: 'forms-contract-review', alt: 'A review task for a remote work policy: a document card with reference, type, version and owner, and the policy PDF in the viewer with page and zoom controls', caption: 'The reviewer reads the PDF in the task; below it are the summary of changes, a rich-text box for redline comments and the Approve and Request changes buttons.' },
    stepsHeading: { eyebrow: 'The flow', title: 'From draft to signed off' },
    steps: [
      { title: 'Submit', body: 'The owner uploads the PDF, picks the document type and summarises the changes.' },
      { title: 'Review', body: 'Reviewers read the PDF in the task and approve or request changes with redline comments.' },
      { title: 'Revise', body: 'Requested changes go back to the owner for a new version, with an SLA, and round again.' },
      { title: 'Sign off', body: 'The final sign-off is signed, a certificate PDF is generated and every step is in the audit log.' },
    ],
    faqs: [
      { question: 'Is this an e-signature service?', answer: 'It is an internal sign-off: the drawn or typed signature is stored with the signer, time and document version in the audit log. For agreements with external parties that need a regulated e-signature, send the approved PDF to a signature service.' },
      { question: 'Can reviewers mark up the PDF itself?', answer: 'Comments are written next to the PDF in rich text, quoting the clause. The PDF is not edited, so the version that was approved is exactly the one that was reviewed.' },
      { question: 'How long is the audit log kept?', answer: 'The package includes a retention policy (seven years by default) for the audit log; change it to match your records schedule.' },
    ],
    related: ['site-safety-inspections', 'training-quiz-certificates', 'approvals-and-compliance'],
  },
]

/**
 * Legal use cases built from forms (steps, Application mode, rules, Data
 * tables), decision tables, data tables and document steps only: each has a
 * "No integrations needed" package in the gallery and no e-signature.
 * Routing rules, SLAs and playbooks are editable examples, not legal advice.
 */
const LEGAL_USE_CASES: UseCase[] = [
  {
    slug: 'legal-request-intake',
    gallery: 'legal-request-intake',
    icon: 'scale',
    eyebrow: 'Legal front door',
    title: 'Legal request intake and triage, with the right lawyer and an SLA on every request',
    metaTitle: 'Legal request intake and triage workflow with SLAs',
    description: 'One stepped form for NDAs, contract reviews, legal questions and disputes; routing to the right legal queue with an SLA; and a queue page where the legal team filters, assigns and follows every request.',
    summary: 'People ask legal on one stepped form; a decision table routes each request to a queue with an SLA, and the legal team works from a filtered queue page.',
    keywords: ['legal intake form', 'legal request triage', 'legal front door', 'NDA request workflow', 'legal operations SLA', 'legal matter intake'],
    problem: {
      title: 'Legal work arrives by email, chat and corridor.',
      body: 'Requests come in without the contract, without a deadline and without saying what is actually needed. Lawyers chase the basics, nobody knows which requests are overdue, and the business cannot see where its NDA is.',
      points: ['Requests missing the document or the deadline', 'No queue, no owner, no SLA', 'No view of what is open, by type or by lawyer'],
    },
    solution: {
      title: 'One form, routed by rules, tracked in one table.',
      body: 'The Legal request form asks only what each request type needs and checks it before it is sent. A decision table picks the queue, the SLA and whether the general counsel reviews the outcome. The lawyer works from a tabbed task, can ask the requester for more information, and the requester is told at every step. The legal team sees every request on a queue page.',
      points: ['Steps with a progress bar, questions that follow the request type', 'Rules: the contract must be attached, urgency needs a reason', 'Routing table for queues, SLAs and general counsel review', 'Queue page: badges, filters by type, status and assignee, row click for details'],
    },
    diagram: {
      title: 'Legal request intake architecture',
      desc: 'The requester submits the stepped Legal request form. UserTasks routes it with a decision table, records it in the Legal requests table, gives a lawyer a task with an SLA, loops back to the requester for more information and closes it with an email.',
      left: { label: 'In', items: [{ label: 'Legal request form', note: 'Steps · rules · documents' }, { label: 'Routing table', note: 'Queue · SLA · GC review' }] },
      center: { label: 'UserTasks engine', items: ['Route and set the SLA', 'Lawyer task with tabs', 'More information loop', 'General counsel review'] },
      right: { label: 'Out', items: [{ label: 'Legal requests table', note: 'Queue page · filters' }, { label: 'Emails', note: 'Received · closed' }] },
    },
    features: [
      { title: 'Steps, tabs and Application mode', body: 'A four-step form with a progress bar and its own Next, Back and Send buttons.', href: '/docs/tasks/forms' },
      { title: 'Decision tables', body: 'Queue, SLA and general counsel review by type, value, urgency and area of law.', href: '/docs/decision-tables' },
      { title: 'Data tables', body: 'Every request in one table, listed on the queue page with filters and badges.', href: '/docs/data-tables' },
      { title: 'Assignment and SLAs', body: 'A due date from the routing table, reminders and the SLA on the run.', href: '/docs/tasks/assignment-and-slas' },
    ],
    snippet: {
      title: 'A rule that asks for the contract',
      body: 'Form rules run in the browser and again on the server at submit, so a contract review cannot reach legal without the contract.',
      language: 'json',
      code: `{
  "id": "r_contract_docs",
  "event": "before_submit",
  "if": { "match": "all", "conditions": [
    { "column": "request_type", "operator": "eq", "value": "Contract review" },
    { "column": "documents", "operator": "is_not_set" }
  ] },
  "then": [{ "type": "field_error", "field": "documents", "text": "Attach the contract you want reviewed." }]
}`,
    },
    screenshot: { name: 'forms-steps', alt: 'A standalone form page with a step indicator, the answers of each step and Back, Submit and Cancel buttons', caption: 'A stepped form page: people see where they are and what is left before they send the request.' },
    stepsHeading: { eyebrow: 'The flow', title: 'From question to answer' },
    steps: [
      { title: 'Ask', body: 'The requester completes four steps; the questions follow the request type and rules check the essentials.' },
      { title: 'Route', body: 'The routing table picks the queue, the SLA and whether the general counsel reviews the outcome.' },
      { title: 'Handle', body: 'A lawyer completes it, asks the requester for more information, or declines it, from a tabbed task.' },
      { title: 'Track', body: 'The Legal requests page shows what is open, what is due and who has it.' },
    ],
    faqs: [
      { question: 'Does it need a matter management system?', answer: 'No. Requests are kept in a UserTasks data table and the queue page is a form with Data table fields. Export the table or send rows to another system with a workflow if you have one.' },
      { question: 'Can the routing match our legal team?', answer: 'Yes. Queues, SLA days and general counsel review are rows in a decision table; tasks can go to a person, a team or a variable. The defaults are examples, not legal advice.' },
      { question: 'Who can see the requests?', answer: 'The queue page reads the table with each person’s own access: give the legal team View data, and Manage rows if they should change a status from the page.' },
    ],
    related: ['contract-review-approval', 'approvals-and-compliance', 'contract-policy-review-signoff'],
  },
  {
    slug: 'contract-review-approval',
    gallery: 'contract-review-approval',
    icon: 'signature',
    eyebrow: 'Contract review',
    title: 'Contract review against a clause playbook, with redlines between versions and a renewal register',
    metaTitle: 'Contract review and approval workflow with a clause playbook and register',
    description: 'Contract owners submit a draft on a stepped form; legal checks it against your clause playbook, every revision is compared with the last version, the approval chain follows risk and value, and a register shows renewals due in the next 90 days.',
    summary: 'Legal ticks playbook deviations in the task, revisions get a redline, finance and the general counsel approve when needed, and the register lists renewals due.',
    keywords: ['contract review workflow', 'contract approval process', 'clause playbook', 'contract redline comparison', 'contract register renewals', 'contract lifecycle without e-signature'],
    problem: {
      title: 'Contracts are reviewed from memory and tracked in a spreadsheet.',
      body: 'Each lawyer checks a draft against the standard positions they remember, revisions arrive without saying what changed, approvals happen in email, and the renewal date is noticed after the notice period has passed.',
      points: ['Deviations from standard terms found inconsistently', 'Revisions compared by eye', 'Renewal dates missed'],
    },
    solution: {
      title: 'A playbook in the task, a redline for every revision, and a register.',
      body: 'The owner fills in a numbered, four-step request with the draft. Legal reviews it with the Clause playbook as a Data table in the task, ticks the deviations and sets the risk. Requested changes go back to the owner; their revision is compared with the previous version and legal sees the similarity and a PDF redline. A decision table adds finance and general counsel approval when risk or value calls for it, and the Contract register records the renewal decision date.',
      points: ['Clause checklist: the playbook as a Data table in the task', 'Compare Documents: similarity and a PDF redline per revision', 'Approval route by risk, value and deviations', 'Register page with a "renewal within 90 days" filter'],
    },
    diagram: {
      title: 'Contract review and approval architecture',
      desc: 'The owner submits a contract on a stepped form. UserTasks registers it, gives legal a review task with the clause playbook, compares each revision with the last, routes approvals by risk and value and keeps the register with renewal dates.',
      left: { label: 'In', items: [{ label: 'Review request form', note: 'Steps · rules · the draft' }, { label: 'Clause playbook', note: 'Positions · fallbacks' }] },
      center: { label: 'UserTasks engine', items: ['Legal review with a checklist', 'Redline between versions', 'Finance and GC approval', 'Emails to the owner'] },
      right: { label: 'Out', items: [{ label: 'Contract register', note: 'Renewals due · badges' }, { label: 'Redline PDF', note: 'Per revision' }] },
    },
    features: [
      { title: 'Data table fields', body: 'The playbook as a selectable table in the task and the register as a page with base filters.', href: '/docs/tasks/forms' },
      { title: 'Compare Documents', body: 'Similarity, words added and removed, and a PDF redline between versions.', href: '/docs/workflows/documents/compare-documents' },
      { title: 'Decision tables', body: 'Finance and general counsel approval by risk, value and deviations.', href: '/docs/decision-tables' },
      { title: 'Data tables', body: 'The Contract register and the Clause playbook, editable by your team.', href: '/docs/data-tables' },
    ],
    snippet: {
      title: 'Renewals due in the next 90 days',
      body: 'The register page’s base filter is set by the author and always applied on the server; people can only narrow it with their own filters.',
      language: 'json',
      code: `"base_filter": { "match": "all", "conditions": [
  { "column": "renewal_date", "operator": "gte", "value": "{{today}}" },
  { "column": "renewal_date", "operator": "lte", "value": "{{today+90d}}" },
  { "column": "status", "operator": "in", "value": "Active,Approved" }
] }`,
    },
    screenshot: { name: 'forms-data-table', alt: 'A form with a Data table: a search box, an open filters panel, a sort and status badges, with a row count', caption: 'A Data table on a form page: search, filters, sorting and badges, run on the server.' },
    stepsHeading: { eyebrow: 'The flow', title: 'From draft to register' },
    steps: [
      { title: 'Request', body: 'The owner completes four numbered steps and attaches the draft; rules check dates, notice and board approval.' },
      { title: 'Review', body: 'Legal ticks the playbook deviations, sets the risk and approves, rejects or asks for changes.' },
      { title: 'Revise', body: 'The owner uploads a revision; it is compared with the last version and goes back to legal with a redline.' },
      { title: 'Approve and register', body: 'Finance and the general counsel approve when needed; the register keeps the renewal decision date.' },
    ],
    faqs: [
      { question: 'Does it sign the contract?', answer: 'No. It takes the contract to an approved version; sign it with the counterparty the way you do today. For an internal sign-off with a drawn signature, see the policy and contract review use case.' },
      { question: 'Which files can be compared?', answer: 'Word, PDF, OpenDocument, HTML, Markdown and text. The comparison works on the text, so a scanned PDF needs OCR first.' },
      { question: 'Can we change the playbook and thresholds?', answer: 'Yes. The Clause playbook and the Contract approval route are a data table and a decision table you edit; the defaults are examples, not legal advice.' },
    ],
    related: ['legal-request-intake', 'contract-policy-review-signoff', 'approvals-and-compliance'],
  },
]

export const USE_CASES: UseCase[] = [
  {
    slug: 'headless-task-management',
    icon: 'inbox',
    eyebrow: 'Headless task management',
    title: 'Human tasks and approvals inside your own app',
    metaTitle: 'Headless task management: human tasks in your own UI',
    description: 'Put approvals and human work inside your own portal or React app. UserTasks runs the workflow, creates typed tasks with outcomes, queues and SLAs, and exposes them through a REST API, TypeScript SDK and MCP server.',
    summary: 'Approvals and human steps inside your own portal or React app, with typed fields, outcomes, queues and SLAs behind an API.',
    keywords: ['headless task management', 'human task API', 'approval API', 'embedded workflow tasks', 'workflow engine for React'],
    problem: {
      title: 'Your users already have an app. The workflow should live there.',
      body: 'Customer portals, internal tools and line-of-business apps all need human steps: someone approves a refund, checks a document, fills in missing details. Sending people to a separate workflow product breaks the experience, and building assignment, deadlines, escalation and history yourself is a project of its own.',
      points: ['Approvals buried in email threads with no deadline or audit trail', 'A second UI that users have to learn and log in to', 'Home-grown task tables that never get escalation, reminders or reporting'],
    },
    solution: {
      title: 'UserTasks runs the process; your UI shows the work.',
      body: 'A workflow reaches a User Task node, creates a task with typed fields and outcomes, and waits. Your app lists the tasks for the signed-in person, renders the fields in your own components and completes the task with an outcome and values. The run continues on that outcome’s path.',
      points: ['Typed task fields and named outcomes, validated by the engine', 'Individual or team assignment, queues, due dates, reminders and escalation', 'List and complete tasks from the REST API, the TypeScript SDK, the CLI or MCP', 'Task and run events over Server-Sent Events or signed webhooks to refresh your UI'],
    },
    diagram: {
      title: 'Headless task management architecture',
      desc: 'Your web app, mobile app and AI assistants call the UserTasks API and MCP server. UserTasks runs the workflow, creates user tasks with fields and outcomes, applies queues and SLAs, and records events. It pushes events to your UI, sends notifications and updates your systems of record.',
      left: { label: 'Your front ends', items: [{ label: 'React app or portal', note: 'REST API · SDK' }, { label: 'Mobile app', note: 'REST API' }, { label: 'AI assistant', note: 'MCP server' }] },
      center: { label: 'UserTasks engine', items: ['Workflow run', 'User Task: fields + outcomes', 'Queues, SLAs, escalation', 'Event stream'] },
      right: { label: 'Out to your stack', items: [{ label: 'Live UI updates', note: 'SSE · signed webhooks' }, { label: 'Notifications', note: 'Email templates' }, { label: 'Systems of record', note: 'REST · OData · SQL' }] },
    },
    features: [
      { title: 'Tasks API', body: 'List assigned tasks and complete them with an outcome and typed values.', href: '/docs/tasks/api' },
      { title: 'Fields and outcomes', body: 'Typed inputs and named outcomes that route the run.', href: '/docs/tasks/fields-and-outcomes' },
      { title: 'Assignment and SLAs', body: 'People or team queues, due dates, reminders, escalation and redirects.', href: '/docs/tasks/assignment-and-slas' },
      { title: 'TypeScript SDK', body: 'Typed client generated from the OpenAPI 3.1 document.', href: '/docs/sdk' },
      { title: 'Event stream', body: 'Tail task and run events or ship them to your own endpoint.', href: '/docs/observability' },
      { title: 'MCP server', body: 'Let AI assistants list and act on tasks with the same permissions.', href: '/docs/mcp' },
    ],
    snippet: {
      title: 'Your server lists and completes tasks',
      body: 'Call the API from your back end (keep the API key off the browser), then render the fields with your own components.',
      language: 'ts',
      code: `import { apiKeyAuth, createClient } from '@usertasks/sdk'

const ut = createClient({
  baseUrl: process.env.USERTASKS_URL!,
  auth: apiKeyAuth(process.env.USERTASKS_API_KEY!),
})

// Open tasks for the inbox in your app
const { tasks } = await ut.GET('/tasks/assigned', { query: { status: 'todo,in_progress' } })

// The person clicks "Approve" in your UI
await ut.POST('/tasks/{id}/action', {
  path: { id: tasks[0].id },
  body: { action: 'complete', outcome: 'Approve', values: { approved_amount: 4200 } },
})`,
    },
    screenshot: { name: 'task-detail', alt: 'A UserTasks task with typed fields and Approve and Reject outcome buttons', caption: 'The same task in the built-in task list: fields, outcomes, notes and history. Your app can render it however it likes.' },
    faqs: [
      { question: 'Do my users need a UserTasks login?', answer: 'Not if your back end calls the API with an API key or OAuth token and acts for them. Tasks can still be assigned to individual UserTasks users or teams when you want the built-in task list, SSO and per-user permissions.' },
      { question: 'How does my UI find out that a task changed?', answer: 'Subscribe to the Server-Sent Events stream at /api/v1/events/stream, or ship task and run events to a signed webhook destination. Workflows can also call your API directly at any step.' },
      { question: 'Can I use it from a framework other than React?', answer: 'Yes. Everything is plain REST described by OpenAPI 3.1, so any language works. The TypeScript SDK is a convenience for Node.js and other fetch-capable runtimes.' },
      { question: 'What happens to a waiting task when I publish a new workflow version?', answer: 'Running instances stay on the version they started with. You can move live instances to the new version from the designer, the API or the CLI, choosing the node where each one continues.' },
    ],
    related: ['approvals-and-compliance', 'ai-agent-orchestration', 'middleware-integration-hub'],
  },
  {
    slug: 'approvals-and-compliance',
    icon: 'shield',
    eyebrow: 'Approvals and compliance',
    title: 'Multi-step approvals you can prove',
    metaTitle: 'Approval workflows with SLAs, escalation and audit trails',
    description: 'Build finance, HR and procurement approvals with decision-table approval matrices, SLAs, reminders, escalation, audit trails, retention policies and role-based governance.',
    summary: 'Finance, HR and procurement approvals with approval matrices, SLAs, escalation, audit trails and retention.',
    keywords: ['approval workflow software', 'approval matrix', 'invoice approval workflow', 'compliance workflow', 'audit trail workflow', 'SLA escalation'],
    problem: {
      title: 'Approvals are easy to start and hard to govern.',
      body: 'Who can approve what changes every quarter. Requests stall when an approver is away. And when the auditor asks why an invoice was paid, the answer is spread across inboxes, spreadsheets and a chat thread.',
      points: ['Approval limits hard-coded in scripts or kept in a spreadsheet', 'No deadline, so requests wait until someone chases them', 'Evidence that is incomplete, editable or gone when it is needed'],
    },
    solution: {
      title: 'Rules, people and evidence in one process.',
      body: 'A decision table holds the approval matrix: amount bands, departments, cost centres and the approvers they require. The workflow creates approval tasks in the right order, with deadlines, reminders and escalation, and every step, decision and permission change is recorded.',
      points: ['Approval matrices as decision tables that finance or HR can change and test', 'Sequential or parallel approvers, team queues and multi-assignee tasks', 'SLAs, reminders and escalation to a person, a team or the manager', 'Audit log, run history, retention policies with review and purge, and SSO'],
    },
    diagram: {
      title: 'Approval and compliance workflow architecture',
      desc: 'Requests arrive from a form, an API call or a business system. UserTasks evaluates the approval matrix in a decision table, creates approver tasks with SLAs, escalates overdue work and records audit evidence under retention policies. It then updates the ERP or HR system, stores the approval record and ships events to the log platform.',
      left: { label: 'Requests', items: [{ label: 'Purchase or invoice', note: 'ERP · API · webhook' }, { label: 'Leave or hiring request', note: 'HR system · your form' }, { label: 'Policy exception', note: 'Your portal' }] },
      center: { label: 'UserTasks engine', items: ['Decision table: approval matrix', 'Approver tasks with SLAs', 'Reminders and escalation', 'Audit trail and retention'] },
      right: { label: 'Outcomes', items: [{ label: 'ERP or HRIS updated', note: 'References · SQL' }, { label: 'Approval record', note: 'Word or PDF document' }, { label: 'SIEM and log platform', note: 'Splunk · Datadog · OTel' }] },
    },
    features: [
      { title: 'Decision tables', body: 'Ordered, typed rules with a test endpoint — the approval matrix as data.', href: '/docs/decision-tables' },
      { title: 'Assignment and SLAs', body: 'Due dates, reminders, escalation and redirects on every approval.', href: '/docs/tasks/assignment-and-slas' },
      { title: 'Audit and retention', body: 'Audit log, security events, retention policies with review, deletion queue.', href: '/docs/governance/audit-and-retention' },
      { title: 'Roles and permissions', body: 'Fine-grained permissions, scoped API keys, SSO and directory sync.', href: '/docs/governance/roles-and-permissions' },
      { title: 'Versions and live instances', body: 'Immutable published versions; move in-flight approvals when rules change.', href: '/docs/workflows/versions-and-runs' },
      { title: 'Log export', body: 'Ship task, run and security events to the platform your auditors use.', href: '/docs/observability/destinations' },
    ],
    snippet: {
      title: 'Test the approval matrix before you publish it',
      body: 'Decision tables are testable from the CLI or API, so a rule change can be checked in CI before it reaches a live approval.',
      language: 'shell',
      code: `# Who approves a 72k purchase in Finance?
usertasks decision-tables test <matrix-id> \\
  --set values:='{"amount":72000,"department":"Finance"}'

# Follow approvals and escalations as they happen
usertasks logs tail --type 'task.*'

# Approve from a script (or your own UI)
usertasks tasks complete <task-id> --outcome Approve --set approved_amount:=72000`,
    },
    screenshot: { name: 'decision-table', alt: 'A UserTasks decision table with amount bands and the approvers each band requires', caption: 'An approval matrix as a decision table: ordered rules, typed inputs and outputs.' },
    faqs: [
      { question: 'Can business users change approval limits without a developer?', answer: 'Yes. Approval limits live in decision tables that people with the right permission can edit and test. The workflow reads the table at run time, so a rule change does not need a new workflow version.' },
      { question: 'What evidence does UserTasks keep?', answer: 'Each run keeps its path, step logs, variables and the task outcomes with who completed them and when. Permission changes, sign-ins and key usage are audited as security events, and everything can be exported to your log platform.' },
      { question: 'How do retention policies work?', answer: 'Retention policies select records by age and type, can require a review before anything is purged, and send deletions through a queue that checks dependencies first.' },
      { question: 'What if an approver is unavailable?', answer: 'Tasks can escalate after a set time to a named person, a team or the assignee’s manager, send reminders before or after the due date, and be redirected by the assignee when that is allowed.' },
    ],
    related: ['headless-task-management', 'sharepoint-workflow-replacement', 'middleware-integration-hub'],
  },
  {
    slug: 'ai-agent-orchestration',
    icon: 'bot',
    eyebrow: 'AI agent orchestration',
    title: 'AI agents as workflow steps, with a person in the loop',
    metaTitle: 'AI agent orchestration with human-in-the-loop review',
    description: 'Run AI agents as governed workflow steps: granted tools only, structured outputs, human review tasks for low-confidence results, run history and traces — and an MCP server for AI assistants.',
    summary: 'Agents as governed workflow steps with granted tools, structured outputs, human review and full run history.',
    keywords: ['AI agent orchestration', 'human in the loop AI', 'AI workflow automation', 'MCP server workflow', 'AI guardrails workflow'],
    problem: {
      title: 'Agents are useful. Unsupervised agents are a risk.',
      body: 'A model can classify a document, draft a reply or pick the next step in seconds — but it can also be wrong, call a tool it should not, or leave no trace of why it decided what it did. Most teams need agents inside a process, not instead of one.',
      points: ['Agents with broad credentials and no permission boundary', 'No review step for uncertain or high-impact answers', 'Prompts, tool calls and results nobody can audit afterwards'],
    },
    solution: {
      title: 'The workflow decides what the agent may do, and when a person checks it.',
      body: 'A Run Agent node calls a model with instructions, granted tools and an output schema. The structured result goes into workflow variables, so the next node can branch on it — continue automatically when the answer is clear, or create a review task when it is not.',
      points: ['Any OpenAI-compatible model, connected as an AI connector', 'Only the tools you grant: references, workflows, external MCP servers', 'Structured outputs that conditions and decision tables can route on', 'Every run, step, tool call and token count recorded; prompts never exported'],
    },
    diagram: {
      title: 'AI agent orchestration architecture',
      desc: 'Emails, webhooks and schedules start workflows, and AI assistants connect through the MCP server. UserTasks runs the agent step with only its granted tools, routes its structured output through a condition, creates a human review task when needed and records run history. The agent calls the model and your APIs, and events go to your log platform.',
      left: { label: 'Triggers', items: [{ label: 'Inbound email or webhook', note: 'Documents, tickets' }, { label: 'Schedule', note: 'Batch triage' }, { label: 'AI assistant', note: 'MCP server' }] },
      center: { label: 'UserTasks engine', items: ['Run Agent: granted tools only', 'Structured output → condition', 'Human review task', 'Run history and traces'] },
      right: { label: 'Called by the agent', items: [{ label: 'Model', note: 'OpenAI-compatible API' }, { label: 'Your APIs', note: 'Granted references' }, { label: 'Event stream', note: 'agent.run.* events' }] },
    },
    features: [
      { title: 'AI agents', body: 'Instructions, granted tools and output schemas; run in a workflow or on demand.', href: '/docs/agents' },
      { title: 'User tasks', body: 'Review, correct or reject an agent’s answer before the process continues.', href: '/docs/tasks' },
      { title: 'Conditions and decision tables', body: 'Route on confidence, amount or category from the agent’s output.', href: '/docs/decision-tables' },
      { title: 'MCP server', body: 'Claude, ChatGPT, Cursor and other clients drive workflows and tasks with scoped permissions.', href: '/docs/mcp' },
      { title: 'Run history', body: 'The path taken, each step’s inputs and outputs, and errors.', href: '/docs/workflows/versions-and-runs' },
      { title: 'Event stream', body: 'Agent runs, token counts and failures as exportable events.', href: '/docs/observability/events' },
    ],
    snippet: {
      title: 'Run an agent, or let your assistant drive the engine',
      body: 'Execute an agent on demand from the CLI, or connect an MCP client with an API key or OAuth.',
      language: 'shell',
      code: `# Run an agent on demand (add --set async:=true to queue it)
usertasks agents execute <agent-id> --set message="Classify invoice INV-1042"

# Connect an MCP client (Claude Desktop, Cursor, …)
{
  "mcpServers": {
    "usertasks": {
      "url": "https://usertasks.com/api/mcp",
      "headers": { "Authorization": "Bearer <your-api-key>" }
    }
  }
}`,
    },
    screenshot: { name: 'run-detail', alt: 'A UserTasks run detail page showing the path taken and the status and duration of each step', caption: 'Every run keeps its path, each step’s status and duration, and the error if one failed.' },
    faqs: [
      { question: 'Which models can agents use?', answer: 'Any chat-completions endpoint that is OpenAI-compatible and supports tool calling — for example OpenAI, Azure OpenAI, Groq, Together, Ollama, or an Anthropic-compatible proxy.' },
      { question: 'How do I stop an agent doing something it should not?', answer: 'Agents can only call the tools you grant, and those tools run with permission checks. Put a User Task after the agent so a person approves high-impact actions, and branch on the structured output so uncertain answers always go to review.' },
      { question: 'Are prompts and model outputs sent to my log platform?', answer: 'No. Agent runs, steps, tool calls, token counts and errors are recorded and emitted as agent.run.* events, but prompts and model outputs are not included in exported events.' },
      { question: 'Do I have to use AI at all?', answer: 'No. Agents are optional; every other feature works without them.' },
    ],
    related: ['headless-task-management', 'middleware-integration-hub', 'approvals-and-compliance'],
  },
  {
    slug: 'middleware-integration-hub',
    icon: 'plug',
    eyebrow: 'Middleware and integration hub',
    title: 'One place for webhooks in, transforms and calls out',
    metaTitle: 'Integration hub: webhooks, transforms, retries and observability',
    description: 'Receive webhooks, transform payloads, route with decision tables, call REST, OData and SQL systems with retries and error workflows, export every event to Splunk, Datadog or OpenTelemetry, and promote config across environments as code.',
    summary: 'Webhooks in, transforms, decision-table routing and API or database calls out — with retries, log export and config as code.',
    keywords: ['integration hub', 'webhook middleware', 'API orchestration', 'workflow integration platform', 'webhook to API', 'config as code integrations'],
    problem: {
      title: 'Point-to-point integrations multiply quietly.',
      body: 'Each new partner or SaaS tool gets its own script, function or cron job. Credentials end up in several places, failures are found by customers, and nobody can say which version is running in production.',
      points: ['Glue code spread across functions, scripts and schedulers', 'Silent failures and hand-written retry logic', 'Dev, test and prod drifting apart'],
    },
    solution: {
      title: 'A governed hub that is still just code and config.',
      body: 'Webhook and Middleware triggers receive events; expressions, JSON and collection nodes reshape them; decision tables route them; references call your APIs and databases with centrally stored credentials. Failures retry with backoff or go to an error workflow, and every call is an event you can export.',
      points: ['Webhook trigger (queue and answer) or Middleware trigger (answer with the result)', '70+ expression functions, JSON, CSV and Excel nodes for transforms', 'REST, OData and SQL references with encrypted credentials and OAuth', 'Export, diff and apply config between environments, or sync with GitHub'],
    },
    diagram: {
      title: 'Middleware and integration hub architecture',
      desc: 'Partner webhooks, SaaS events and files arrive through webhook and middleware triggers. UserTasks transforms the payload with expressions and JSON nodes, routes it with a decision table, and retries or runs an error workflow on failure. It calls REST and OData APIs and databases, and exports every event to Splunk, Datadog or OpenTelemetry.',
      left: { label: 'Events in', items: [{ label: 'Partner webhooks', note: 'Signed, per-hook secret' }, { label: 'SaaS events', note: 'Webhook trigger' }, { label: 'Files', note: 'CSV · Excel · JSON' }] },
      center: { label: 'UserTasks engine', items: ['Webhook / Middleware trigger', 'Transform: expressions + JSON', 'Decision table routing', 'Retries and error workflows'] },
      right: { label: 'Calls out', items: [{ label: 'REST and OData APIs', note: 'References · OAuth' }, { label: 'Databases', note: 'Postgres · SQL Server · more' }, { label: 'Log platform', note: 'Splunk · Datadog · OTel' }] },
    },
    features: [
      { title: 'Webhooks', body: 'Inbound webhooks per workflow with rotating secrets; synchronous middleware responses.', href: '/docs/integrations/webhooks' },
      { title: 'Integrations and references', body: 'Reusable REST, OData and database operations with stored credentials.', href: '/docs/integrations' },
      { title: 'Expressions and functions', body: 'Transform payloads inline with typed functions.', href: '/docs/workflows/expressions' },
      { title: 'Error handling', body: 'Stop or continue per node, retries with backoff, central error workflows.', href: '/docs/workflows/error-handling' },
      { title: 'Observability', body: 'One event stream with filters, live tail and export destinations.', href: '/docs/observability' },
      { title: 'Config as code', body: 'Export, diff and apply between environments; GitHub sync.', href: '/docs/config-as-code' },
    ],
    snippet: {
      title: 'Wire a webhook and promote it',
      body: 'Create the inbound hook, send it a payload, and move the whole configuration from dev to prod after review.',
      language: 'shell',
      code: `usertasks webhooks create <workflow-id> --set slug=order-intake
curl -X POST "$USERTASKS_URL/api/webhooks/inbound?hook=order-intake" \\
  -H "Authorization: Bearer <secret>" -H "Content-Type: application/json" -d @order.json

usertasks --profile dev config export ./config
usertasks --profile prod config diff ./config --exit-code
usertasks --profile prod config apply ./config`,
    },
    screenshot: { name: 'log-export', alt: 'The UserTasks log export settings listing a Splunk HEC destination and a webhook destination with healthy status', caption: 'Log export: every run, call and change shipped to Splunk, Datadog, OpenTelemetry or a webhook.' },
    faqs: [
      { question: 'Can a workflow answer the webhook caller synchronously?', answer: 'Yes. A Middleware trigger keeps the request open until the run finishes and returns the run’s variables, so a workflow can validate or enrich a request in line. A Webhook trigger answers as soon as the run is queued.' },
      { question: 'What happens when a downstream system is down?', answer: 'Queue jobs retry automatically with backoff before they are marked dead. Per node you choose whether an error stops the run or continues with the error in variables, and a Workflow Error trigger can run a central error workflow.' },
      { question: 'Which databases can references query?', answer: 'Postgres, SQL Server and MySQL work out of the box; Snowflake, Oracle and MongoDB are available through optional drivers on self-hosted installs.' },
      { question: 'How do I keep dev and prod in step?', answer: 'Use config as code: export a workspace to files, review the change, diff it against production and apply it. Secrets stay out of Git. GitHub sync can commit every change and deploy pinned commits.' },
    ],
    related: ['ai-agent-orchestration', 'approvals-and-compliance', 'headless-task-management'],
  },
  {
    slug: 'sharepoint-workflow-replacement',
    icon: 'list',
    eyebrow: 'SharePoint workflow replacement',
    title: 'Replacing SharePoint 2010 and 2013 workflows',
    metaTitle: 'Replace retired SharePoint 2010 and 2013 workflows',
    description: 'Microsoft has retired SharePoint 2010 and SharePoint 2013 workflows in SharePoint Online. Map approval, collect-feedback and list-item workflows to UserTasks tasks, decision tables, webhooks and the SharePoint connector.',
    summary: 'Microsoft has retired SharePoint 2010 and 2013 workflows in SharePoint Online. Rebuild approvals and list workflows on an engine you control.',
    keywords: ['SharePoint 2013 workflow retirement', 'SharePoint 2010 workflow replacement', 'SharePoint Designer workflow alternative', 'SharePoint approval workflow migration', 'SharePoint list workflow'],
    problem: {
      title: 'The workflows behind many SharePoint sites have been switched off.',
      body: 'Approvals, feedback rounds and list-driven processes built with SharePoint Designer ran on the SharePoint 2010 and 2013 workflow engines. Microsoft has retired both in SharePoint Online, so those processes need a new home — and the definitions, task lists and history that went with them need to be rebuilt somewhere supported.',
      points: ['Approval and feedback workflows that no longer run', 'Task lists and workflow history lists with no engine behind them', 'Business rules hidden in SharePoint Designer conditions'],
    },
    solution: {
      title: 'Rebuild the process; keep SharePoint for content.',
      body: 'Your sites, lists and libraries stay in SharePoint. The process moves to UserTasks: approvals become User Tasks with outcomes and deadlines, conditions become decision tables, and the SharePoint connector reads and writes list items and files through Microsoft Graph.',
      points: ['SharePoint connector: list items, files, folders, libraries and search via Microsoft Graph', 'Approvals with outcomes, SLAs, reminders and escalation instead of task lists', 'Decision tables for the routing rules that lived in Designer conditions', 'Run history, audit and log export in place of workflow history lists'],
    },
    diagram: {
      title: 'SharePoint workflow replacement architecture',
      desc: 'SharePoint lists and libraries, scheduled checks and line-of-business systems start workflows in UserTasks through a schedule trigger, the SharePoint connector or an inbound webhook. UserTasks routes with decision tables, creates approval tasks with SLAs and records history. It writes status back to SharePoint list items and files, sends email and exports events.',
      left: { label: 'Starts from', items: [{ label: 'SharePoint list or library', note: 'Polled via Get List Items' }, { label: 'Line-of-business system', note: 'Inbound webhook' }, { label: 'Person in your portal', note: 'API · task list' }] },
      center: { label: 'UserTasks engine', items: ['Decision table: routing rules', 'Approval tasks with SLAs', 'Reminders and escalation', 'Run history and audit'] },
      right: { label: 'Writes back', items: [{ label: 'SharePoint list items', note: 'Create · update via Graph' }, { label: 'Documents', note: 'Upload to a library' }, { label: 'Email', note: 'Email templates' }] },
    },
    timeline: {
      title: 'What Microsoft has announced',
      body: 'Microsoft’s published timeline for SharePoint Online (Microsoft 365). Microsoft recommends migrating to Power Automate or another supported workflow orchestration solution. SharePoint Server on premises follows its own support lifecycle; check Microsoft’s pages for your version.',
      events: [
        { date: 'August 1, 2020', text: 'SharePoint 2010 workflows turned off for newly created tenants.' },
        { date: 'November 1, 2020', text: 'SharePoint 2010 workflow services removed from existing tenants.' },
        { date: 'April 2, 2024', text: 'SharePoint 2013 workflows turned off for new tenants.' },
        { date: 'April 2, 2026', text: 'SharePoint 2013 workflows removed from existing tenants and fully retired.' },
      ],
      sources: [
        { label: 'Microsoft Support: SharePoint 2010 workflow retirement', href: 'https://support.microsoft.com/en-us/office/sharepoint-2010-workflow-retirement-1ca3fff8-9985-410a-85aa-8120f626965f' },
        { label: 'Microsoft Support: SharePoint 2013 workflow retirement', href: 'https://support.microsoft.com/en-us/office/sharepoint-2013-workflow-retirement-4613d9cf-69aa-40f7-b6bf-6e7831c9691e' },
      ],
    },
    mapping: {
      title: 'Common SharePoint workflow patterns in UserTasks',
      body: 'Rebuild by pattern rather than action by action. Most SharePoint Designer workflows are one of a handful of shapes.',
      from: 'SharePoint workflow pattern',
      rows: [
        { from: 'Approval workflow (approve / reject)', to: 'User Task with Approve and Reject outcomes, assignees or a team queue, due date and escalation', href: '/docs/tasks/fields-and-outcomes' },
        { from: 'Collect Feedback', to: 'User Task with typed comment fields, assigned to several people; the run continues when they respond', href: '/docs/tasks' },
        { from: 'Workflow started when an item is created or changed', to: 'Schedule trigger with the SharePoint connector’s Get List Items, or an inbound webhook from the system that writes the item', href: '/docs/workflows/triggers' },
        { from: 'Conditions and lookups in SharePoint Designer', to: 'Condition and Switch nodes, and decision tables for rules the business maintains', href: '/docs/decision-tables' },
        { from: 'Update list item / create list item', to: 'SharePoint connector: Create List Item and Update List Item', href: '/docs/integrations/connectors' },
        { from: 'Pause for duration / pause until date', to: 'Delay and Pause Until nodes, resumed from the durable queue', href: '/docs/workflows/timing' },
        { from: 'Send an email', to: 'Send Email node with reusable email templates', href: '/docs/email-templates' },
        { from: 'Task list and workflow history list', to: 'The task list or your own UI, plus run history, audit and log export', href: '/docs/observability' },
      ],
    },
    features: [
      { title: 'Connectors', body: 'The SharePoint connector creates ready-made references for lists, files and search.', href: '/docs/integrations/connectors' },
      { title: 'Tasks and outcomes', body: 'Approvals and feedback with typed fields and named outcomes.', href: '/docs/tasks/fields-and-outcomes' },
      { title: 'Decision tables', body: 'Routing rules outside the workflow, testable from the API.', href: '/docs/decision-tables' },
      { title: 'Triggers', body: 'Schedules, webhooks, data events and task events.', href: '/docs/workflows/triggers' },
      { title: 'Email templates', body: 'Notifications with variables and a live preview.', href: '/docs/email-templates' },
      { title: 'Observability', body: 'Run history and exportable events in place of history lists.', href: '/docs/observability' },
    ],
    snippet: {
      title: 'Connect the site, import the rebuilt workflow',
      body: 'The SharePoint connector uses a Microsoft Entra app registration with Microsoft Graph permissions. Workflows are plain JSON you can review and version.',
      language: 'shell',
      code: `usertasks connectors catalog                 # includes SharePoint
usertasks connectors create -f sharepoint-hr-site.yaml
usertasks connectors test <id>

usertasks workflows create -f leave-approval.json
usertasks workflows publish <id> --set notes="Replaces the SharePoint 2013 leave approval"`,
    },
    screenshot: { name: 'designer', alt: 'The UserTasks workflow designer showing an approval workflow with the User Task settings panel open', caption: 'An approval rebuilt in the designer: trigger, decision, approval task and the update back to the list.' },
    steps: [
      { title: 'Inventory', body: 'List the workflows in each site with Microsoft’s assessment tooling, with owners, volumes and the lists they touch.' },
      { title: 'Group by pattern', body: 'Sort them into approvals, feedback, notifications and list updates; retire the ones nobody uses.' },
      { title: 'Rebuild one per pattern', body: 'Connect the site once, build a workflow per pattern and reuse it with different lists and rules.' },
      { title: 'Cut over by site', body: 'Point users at the new tasks, check results against the list, then remove the old workflow associations.' },
    ],
    faqs: [
      { question: 'Do I have to move my lists and documents out of SharePoint?', answer: 'No. Content can stay in SharePoint. UserTasks reads and writes list items and files through the SharePoint connector, which uses Microsoft Graph.' },
      { question: 'Can UserTasks import SharePoint Designer workflow files?', answer: 'No. Workflows are rebuilt, usually by pattern. Most Designer workflows are approvals, feedback rounds or list updates, which map to a small number of reusable UserTasks workflows.' },
      { question: 'What does Microsoft recommend?', answer: 'Microsoft recommends migrating to Power Automate or other supported workflow orchestration solutions. UserTasks is one option when you want an open-source engine with an API, CLI and on-premises deployment.' },
      { question: 'What about SharePoint Server on premises?', answer: 'On-premises support follows each SharePoint Server version’s lifecycle, as described on Microsoft’s retirement pages. UserTasks can be self-hosted next to an on-premises farm, but its SharePoint connector targets SharePoint Online through Microsoft Graph.' },
    ],
    disclaimer: TRADEMARKS,
    related: ['approvals-and-compliance', 'nintex-migration', 'k2-migration'],
  },
  {
    slug: 'nintex-migration',
    icon: 'route',
    eyebrow: 'Nintex migration guide',
    title: 'Moving Nintex workflows to UserTasks',
    metaTitle: 'Nintex migration guide: workflows, forms, tasks and rules',
    description: 'A neutral guide to moving Nintex workflows to UserTasks: how forms, workflows, tasks, connectors, document generation and rules map, and a wave-based migration plan.',
    summary: 'A neutral concept map and migration plan for Nintex workflows, forms, tasks, connectors and rules.',
    keywords: ['Nintex migration', 'Nintex replacement', 'Nintex alternative', 'Nintex workflow migration', 'Nintex forms replacement'],
    problem: {
      title: 'A migration is a chance to simplify, not just to copy.',
      body: 'Teams move off a workflow platform for many reasons: licensing models, deployment requirements, a wish to own the user interface, or wanting processes in code review. Whatever the reason, the hard part is the same — inventory, rebuild, prove the result and retire the old automation safely.',
      points: ['Hundreds of workflows of varying age, ownership and value', 'Forms coupled to the workflow that runs behind them', 'Connections, credentials and schedules spread across the estate'],
    },
    solution: {
      title: 'Map concepts, rebuild by outcome, move in waves.',
      body: 'UserTasks covers the workflow layer — workflows, approvals, human tasks, connectors, document generation and governance — through a REST API, MCP server and CLI. User interfaces are built in your own front end, or people use the built-in task list.',
      points: ['Visual designer plus JSON definitions you can review and version', 'Tasks with typed fields and outcomes, queues, SLAs and escalation', 'Integrations, OpenAPI import and pre-built connectors', 'Open source under Apache-2.0, in the cloud or self-hosted'],
    },
    diagram: {
      title: 'Nintex to UserTasks migration architecture',
      desc: 'Forms move to your own UI or the UserTasks task list, workflows move to the designer, and connectors move to integrations. During a parallel run, tasks from the existing engine can be ingested through the tasks ingest API so people work from one inbox. UserTasks calls the same business systems, generates documents and exports events.',
      left: { label: 'What you have', items: [{ label: 'Forms', note: '→ your UI or task list' }, { label: 'Workflows and tasks', note: '→ designer and user tasks' }, { label: 'Connectors', note: '→ integrations' }] },
      center: { label: 'UserTasks engine', items: ['Workflows and sub-workflows', 'User tasks with SLAs', 'Decision tables', 'Tasks ingest for parallel runs'] },
      right: { label: 'Connected to', items: [{ label: 'Business systems', note: 'REST · OData · SQL' }, { label: 'Generated documents', note: 'Word · Excel · PowerPoint' }, { label: 'Your log platform', note: 'Event export' }] },
    },
    mapping: {
      title: 'Nintex concepts and their UserTasks equivalents',
      body: 'A starting point for a capability inventory. Check each workflow’s actual behaviour; names alone rarely tell the whole story.',
      from: 'In Nintex',
      rows: [
        { from: 'Forms', to: 'Your own UI against the Tasks API (headless), or the built-in task list with typed fields', href: '/docs/tasks/api' },
        { from: 'Workflows and components', to: 'Workflows in the visual designer, and reusable sub-workflows', href: '/docs/workflows/sub-workflows' },
        { from: 'Assign a task / request approval', to: 'User Task nodes with outcomes, team queues, SLAs, reminders and escalation', href: '/docs/tasks/assignment-and-slas' },
        { from: 'Connectors and extensions', to: 'Integrations, references, pre-built connectors and OpenAPI import', href: '/docs/integrations' },
        { from: 'Document generation', to: 'Word, Excel and PowerPoint document nodes', href: '/docs/workflows/nodes' },
        { from: 'Conditions and business rules', to: 'Condition and Switch nodes, and decision tables', href: '/docs/decision-tables' },
        { from: 'Workflow history and reporting', to: 'Run history, reports with a reporting API, and log export', href: '/docs/reports' },
        { from: 'Desktop RPA bots', to: 'Not included. Call existing bots or their APIs from a workflow step', href: '/docs/integrations/references' },
      ],
    },
    features: [
      { title: 'Workflow designer', body: 'Canvas or JSON, published as immutable versions.', href: '/docs/workflows/designer' },
      { title: 'Tasks', body: 'The built-in task list, or your own UI through the API.', href: '/docs/tasks' },
      { title: 'Connectors', body: 'Pre-built connectors with service-specific connection tests.', href: '/docs/integrations/connectors' },
      { title: 'OpenAPI import', body: 'Turn an API description into reusable references.', href: '/docs/integrations/openapi-import' },
      { title: 'Decision tables', body: 'Rules analysts maintain, separate from routing.', href: '/docs/decision-tables' },
      { title: 'Config as code', body: 'Move workflows between environments as reviewed files.', href: '/docs/config-as-code' },
    ],
    snippet: {
      title: 'One inbox during the parallel run',
      body: 'While some processes still run on the old platform, post their human steps to UserTasks so people work from one task list.',
      language: 'shell',
      code: `usertasks tasks ingest \\
  --set title="Approve PO-88213 (legacy workflow)" \\
  --set assignee_email=ap.lead@example.com \\
  --set idempotency_key=legacy-po-88213

# Rebuilt workflows are files you review and promote
usertasks workflows create -f purchase-order-approval.json
usertasks --profile prod config diff ./config --exit-code`,
    },
    screenshot: { name: 'integrations', alt: 'The UserTasks integrations page listing connected systems and their references', caption: 'Integrations: one connection per system, with reusable references for workflows, agents and reports.' },
    steps: [
      { title: 'Inventory', body: 'Catalog workflows, forms, connectors, owners, schedules, volumes and dependencies — and decide where each user interface will live.' },
      { title: 'Rationalize', body: 'Retire unused automation and combine duplicated patterns before rebuilding.' },
      { title: 'Build the foundation', body: 'Create shared integrations, references, decision tables, roles and reports first.' },
      { title: 'Migrate and reconcile', body: 'Move processes in waves with scenario tests, owner sign-off, monitoring and a rollback window.' },
    ],
    faqs: [
      { question: 'Can UserTasks import Nintex workflow files?', answer: 'No. Workflows are rebuilt. A capability inventory and a pattern-based rebuild usually produce fewer, simpler workflows than a one-to-one conversion.' },
      { question: 'What replaces Nintex forms?', answer: 'UserTasks is headless: build the screens in your own front end against the Tasks API, or use the built-in task list, which renders typed fields and outcome buttons.' },
      { question: 'Can both platforms run side by side?', answer: 'Yes. Rebuilt processes run in UserTasks while the rest stay where they are. The tasks ingest API can bring human steps from the existing engine into the UserTasks task list during the transition.' },
      { question: 'How is UserTasks licensed?', answer: 'The engine is open source under Apache-2.0 and can be self-hosted, or used as a managed cloud service. Compare infrastructure, support and migration effort against your current agreement.' },
    ],
    disclaimer: TRADEMARKS,
    related: ['k2-migration', 'sharepoint-workflow-replacement', 'headless-task-management'],
  },
  {
    slug: 'k2-migration',
    icon: 'layers',
    eyebrow: 'K2 migration guide',
    title: 'Moving K2 applications to UserTasks',
    metaTitle: 'K2 migration guide: SmartForms, workflows and SmartObjects',
    description: 'A neutral guide to moving K2 applications to UserTasks: how SmartForms, workflows, worklists, SmartObjects, service instances and rules map, and how to migrate in waves.',
    summary: 'A neutral concept map and migration plan for K2 SmartForms, workflows, worklists and SmartObjects.',
    keywords: ['K2 migration', 'K2 replacement', 'K2 alternative', 'K2 SmartObjects replacement', 'K2 SmartForms replacement', 'Nintex Automation K2 migration'],
    problem: {
      title: 'K2 applications bundle forms, process and data.',
      body: 'A typical K2 application combines SmartForms, a workflow, SmartObjects over several data sources, roles and reports. Moving it is application modernisation rather than file conversion: the process intent has to survive while the coupling between screens, data and workflow is redesigned.',
      points: ['Forms, workflow and data access tightly coupled', 'Service instances and environment settings that only one person understands', 'Long-running instances that must finish or move cleanly'],
    },
    solution: {
      title: 'Separate the layers, then rebuild each one.',
      body: 'UserTasks replaces the process layer — workflows, worklists, rules, roles and governed data access — behind a REST API, MCP server and CLI. SmartForms screens are rebuilt in your own front end, or replaced by the built-in task list where a typed task form is enough.',
      points: ['Workflows and sub-workflows in the designer, as reviewable JSON', 'Worklists as task inboxes and team queues with SLAs and escalation', 'SmartObject-style data access through objects, data tables and references', 'Config as code and environment profiles in place of environment fields'],
    },
    diagram: {
      title: 'K2 to UserTasks migration architecture',
      desc: 'SmartForms move to your own UI or the UserTasks task list, workflows to the designer, and SmartObjects to objects, data tables and references. UserTasks runs workflows, worklist tasks with SLAs and decision tables, and calls the same SQL databases and services. Configuration moves between environments as code.',
      left: { label: 'What you have', items: [{ label: 'SmartForms', note: '→ your UI or task list' }, { label: 'Workflows and worklists', note: '→ designer and tasks' }, { label: 'SmartObjects', note: '→ objects and references' }] },
      center: { label: 'UserTasks engine', items: ['Workflows and sub-workflows', 'Task inbox and team queues', 'Decision tables', 'Objects and data tables'] },
      right: { label: 'Connected to', items: [{ label: 'SQL databases', note: 'SQL Server · Postgres' }, { label: 'Services', note: 'REST · OData' }, { label: 'Environments', note: 'Config as code' }] },
    },
    mapping: {
      title: 'K2 concepts and their UserTasks equivalents',
      body: 'Start with a capability inventory rather than screen-by-screen recreation.',
      from: 'In K2',
      rows: [
        { from: 'SmartForms and views', to: 'Your own UI against the Tasks API, or the built-in task list with typed fields', href: '/docs/tasks/api' },
        { from: 'Workflows, activities and events', to: 'Workflows in the designer: triggers, logic, actions, waits and sub-workflows', href: '/docs/workflows' },
        { from: 'Worklist and worklist items', to: 'Task inbox, team queues, outcomes, SLAs and escalation', href: '/docs/tasks' },
        { from: 'SmartObjects', to: 'Business objects over data tables and integration references', href: '/docs/data-tables' },
        { from: 'Service types and service instances', to: 'Integrations and references: REST, OData and SQL databases with stored credentials', href: '/docs/integrations/references' },
        { from: 'Roles and groups', to: 'Teams, roles and fine-grained permissions, with SSO and directory sync', href: '/docs/governance/teams-and-invitations' },
        { from: 'Rules and inline functions', to: 'Expressions and functions, conditions and decision tables', href: '/docs/workflows/expressions' },
        { from: 'Environment fields and deployment packages', to: 'Config as code: export, diff and apply per environment profile; GitHub sync', href: '/docs/config-as-code' },
      ],
    },
    features: [
      { title: 'Workflows', body: 'Triggers, branches, loops, parallel paths, waits and sub-workflows.', href: '/docs/workflows' },
      { title: 'Data tables and objects', body: 'Typed tables and business objects across tables and APIs.', href: '/docs/data-tables' },
      { title: 'References', body: 'Saved REST, OData and database operations.', href: '/docs/integrations/references' },
      { title: 'Tasks', body: 'Worklists as inboxes and queues, in the app or your own UI.', href: '/docs/tasks' },
      { title: 'Reports', body: 'Saved queries and charts over tasks, runs and data, with an API.', href: '/docs/reports' },
      { title: 'Live instance migration', body: 'Move in-flight runs between versions as processes evolve.', href: '/docs/workflows/versions-and-runs' },
    ],
    snippet: {
      title: 'Rebuild the data contract first',
      body: 'Start with the data and integration layer the application depends on, then build the workflow and screens on top of it.',
      language: 'shell',
      code: `# The database the K2 SmartObjects read from
usertasks integrations create -f erp-sql.yaml
usertasks references create -f get-vendor.yaml

# Workflow and rules as reviewable files
usertasks decision-tables import -f vendor-approval-matrix.json
usertasks workflows create -f vendor-onboarding.json`,
    },
    screenshot: { name: 'data-table', alt: 'A UserTasks data table with typed columns and rows', caption: 'A data table: typed columns, row events that start workflows, and an OData endpoint.' },
    steps: [
      { title: 'Portfolio assessment', body: 'Classify K2 applications by complexity, usage, business impact, integrations and retirement potential.' },
      { title: 'Capability mapping', body: 'Map workflows, worklists, SmartObjects, roles, reports, schedules and custom code — and decide where each screen will live.' },
      { title: 'Pilot migration', body: 'Rebuild one representative application to produce reusable patterns, tests and estimates.' },
      { title: 'Wave-based cutover', body: 'Migrate groups of applications with reconciliation, rollback, owner acceptance and retirement controls.' },
    ],
    faqs: [
      { question: 'What parts of a K2 application does UserTasks replace?', answer: 'The process layer: workflows, worklists and tasks, rules, roles and SmartObject-style data access. SmartForms screens are rebuilt in your own front end, or replaced by the built-in task list.' },
      { question: 'What replaces SmartObjects?', answer: 'Business objects combine a data table or reference with joined sources into one entity, and expose governed list, get, insert, update and delete operations to workflows, reports, the API and agents.' },
      { question: 'Can the result run on premises?', answer: 'Yes. The engine is open source under Apache-2.0 and can be self-hosted on your own servers or cloud account, next to the databases your applications use.' },
      { question: 'What happens to instances still running in K2?', answer: 'Let them finish where they are while new requests start in UserTasks, or bring their open human steps into the UserTasks task list through the tasks ingest API during the transition.' },
    ],
    disclaimer: TRADEMARKS,
    related: ['nintex-migration', 'sharepoint-workflow-replacement', 'middleware-integration-hub'],
  },
  ...MEDIA_USE_CASES,
  ...FORMS_USE_CASES,
  ...LEGAL_USE_CASES,
]

/** Use cases of one index section. */
export function useCasesInGroup(group: UseCaseGroup): UseCase[] {
  return USE_CASES.filter((useCase) => (useCase.group ?? 'platform') === group)
}

export function getUseCase(slug: string): UseCase | undefined {
  return USE_CASES.find((useCase) => useCase.slug === slug)
}

/** Old SEO pages folded into the migration guides (permanent redirects). */
export const USE_CASE_REDIRECTS: Record<string, string> = {
  '/k2-replacement': '/use-cases/k2-migration',
  '/nintex-replacement': '/use-cases/nintex-migration',
}
