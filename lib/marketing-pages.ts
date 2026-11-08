/** Copy shared by the /workflows, /forms, /documents, /media, /ai-assistants and /connectors pages, their metadata and OG cards. */

export const WORKFLOWS_PAGE = {
  slug: 'workflows',
  eyebrow: 'Workflows',
  title: 'Build complex workflows visually, without limits',
  metaTitle: 'Complex Workflows: Visual Designer, Parallel Paths, Rules, People and Live Migration | UserTasks',
  description:
    'Build complex workflows on a visual canvas or as JSON: branches, parallel paths, loops, sub-workflows, decision tables, human tasks with forms, SLAs, timers, events and error paths — tested with Save & Test, versioned, and migrated live while they run.',
}


export const FORMS_PAGE = {
  slug: 'forms',
  eyebrow: 'Forms',
  title: 'Forms that start and drive your workflows',
  metaTitle: 'Workflow Forms: Grid Designer, Lookups, File Uploads and QR Pages | UserTasks',
  description:
    'Design forms on a grid with lookups, data tables people can filter and edit, multi-file attachments, buttons, headers and themes, and build any control you need as a sandboxed web component. Add rules, share them as links or QR codes, embed them in your website, start workflows when they are submitted and use every value downstream — validated on the server.',
}

export const DOCUMENTS_PAGE = {
  slug: 'documents',
  eyebrow: 'Documents',
  title: 'Read, compare and transform documents inside your workflows',
  metaTitle: 'Document Workflows: Read, Compare, Convert and Redact Files | UserTasks',
  description:
    'Workflow steps that read Word, Excel, PowerPoint, PDF (with OCR), Markdown and HTML, compare versions with a Word redline, convert, split and stamp PDFs, extract to data tables, redact personal data and inspect files — inside the run, on your own infrastructure.',
}

/**
 * /connectors — integrations and AI. Not /integrations: that path is the
 * signed-in Integrations page of the app.
 */
export const INTEGRATIONS_PAGE = {
  slug: 'connectors',
  eyebrow: 'Integrations and AI',
  title: 'Connect your workflows to any system and any AI service',
  metaTitle: 'Workflow Integrations: Connectors, OpenAPI, Databases, Webhooks, MCP and AI | UserTasks',
  description:
    'Connect workflows to any REST or OData API with OpenAPI import, response models and a data picker; to databases, files, email, e-signature (DocuSign, Adobe Acrobat Sign, Dropbox Sign, PandaDoc, SignNow, BoldSign), CRM, ERP and HR systems through ready-made connectors; to webhooks and MCP in both directions; and to Claude, OpenAI, Gemini, Mistral and local models with governed AI agents.',
}

export const MEDIA_PAGE = {
  slug: 'media',
  eyebrow: 'Images, audio and video',
  title: 'See, hear and redact: AI for images, audio and video inside your workflows',
  metaTitle: 'Media Workflows: Transcribe, Analyse and Redact Images, Audio and Video with AI | UserTasks',
  description:
    'Workflow steps that transcribe recordings with speakers and subtitles, analyse images and video, blur faces, plates and sensitive text, bleep spoken personal data, generate images and speech, and trim or convert media — with OpenAI, Gemini, Azure, AWS, Deepgram, AssemblyAI, ElevenLabs or Stability AI on your own key.',
}

/** /ai-assistants — Agent, the in-app AI co-worker (not the workflow Agents in /connectors#ai). */
export const AI_ASSISTANTS_PAGE = {
  slug: 'ai-assistants',
  eyebrow: 'Agent',
  title: 'Agent: your AI co-worker in every screen',
  metaTitle: 'Agent: an AI Co-worker for Forms, Tasks and Workflow Design, on Your Own Model | UserTasks',
  description:
    'Agent is one AI panel on every screen: it helps people fill forms, work tasks and design workflows, forms, tables and plugins, following the screen and their permissions. It proposes; people apply, decide and confirm. Bring your own key for OpenAI, Claude, Grok, Gemini, Azure OpenAI, Mistral, Groq, Ollama or any OpenAI-compatible model.',
}
