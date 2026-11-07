/**
 * Package gallery: types shared by the build (scripts/gallery-build.ts), the
 * validation test, the install verification (scripts/gallery-verify.ts) and
 * the marketing pages (/gallery). Pure and client-safe.
 *
 * Sources live in gallery/packages/<slug>/:
 *
 *   gallery.json                   GalleryMeta (this file)
 *   README.md                      the package readme (shown by the install wizard)
 *   assets/<dir>/<name>-<id>.json  config-as-code / GitHub-sync envelopes
 *   assets/data-rows/<table>-<id>.json   sample rows (table_rows envelopes)
 *
 * The assets folder is a normal config-as-code folder, so
 * `usertasks config apply gallery/packages/<slug>/assets` works too.
 */

import type { MediaMockOptions } from './media-mock'

export const GALLERY_CATEGORIES = [
  { id: 'hr-people', title: 'HR & People', summary: 'Onboarding, leave, reviews and the people processes every company runs.' },
  { id: 'finance', title: 'Finance', summary: 'Expenses, invoices, purchasing, vendors and the month-end close.' },
  { id: 'it-security', title: 'IT & Security', summary: 'Access, incidents, changes, identity lifecycle and alert handling.' },
  { id: 'customer-sales', title: 'Customer & Sales', summary: 'Leads, quotes, customer onboarding and complaints with SLAs.' },
  { id: 'operations-compliance', title: 'Operations & Compliance', summary: 'Contracts, attestations, audits, supplier risk and privacy requests.' },
  { id: 'workplace', title: 'Workplace & Facilities', summary: 'Visitors, rooms, vehicles, equipment, events and the everyday office processes.' },
  { id: 'surveys-assessments', title: 'Surveys & Assessments', summary: 'Customer and employee surveys, questionnaires, quizzes and inspections built on ratings, Likert scales, sliders, signatures and charts.' },
  { id: 'media-evidence', title: 'Media & Evidence', summary: 'Recordings, photos and video: transcripts, redaction, records requests, claims, identity checks and moderation.' },
  { id: 'headless-integration', title: 'Headless & Integration', summary: 'API-first orchestration, sync, reconciliation, documents, AI and ETL with no UI at all.' },
  { id: 'form-controls', title: 'Form controls', summary: 'Web components for your forms: charts, saved reports, address search, maps, signatures, ratings, rich text, tables, surveys and PDF viewing.' },
  { id: 'workflow-actions', title: 'Workflow actions', summary: 'Custom workflow steps that run sandboxed: math and statistics, text, business calendars, data transforms, validation and formatting, crypto and IDs.' },
] as const

/** The category of form control packages (gallery/controls); workflow packages use the others. */
export const FORM_CONTROLS_CATEGORY = 'form-controls' as const

/** The category of custom workflow action packages (gallery/actions). */
export const WORKFLOW_ACTIONS_CATEGORY = 'workflow-actions' as const

/** Where a gallery package comes from: built from gallery/packages (official) or shared by the community and approved by a moderator. */
export type GalleryOrigin = 'official' | 'community'

export const GALLERY_ORIGINS: Record<GalleryOrigin, { label: string; description: string }> = {
  official: { label: 'Official', description: 'Built and maintained by the UserTasks team from the sources in the repository.' },
  community: { label: 'Community', description: 'Shared by a member of the UserTasks community and approved by a moderator after automatic validation.' },
}

/** The badge for packages that use built-in features only: no integration, AI model or install-time values. */
export const NATIVE_BADGE = { label: 'No integrations needed', description: 'Uses only built-in features (forms, data tables, decision tables, emails, schedules). Installs complete with nothing to configure.' } as const

export type GalleryCategoryId = (typeof GALLERY_CATEGORIES)[number]['id']

/** How a package's main workflow starts. */
export type GalleryTrigger = 'form' | 'api' | 'schedule' | 'event'

export const GALLERY_TRIGGERS: Record<GalleryTrigger, { label: string; badge: string; description: string }> = {
  form: {
    label: 'Starts from a form',
    badge: 'Starts from a form',
    description: 'Someone fills in a form to start it: the workflow start form (Run dialog in the app, or your own portal posting to the API) or a standalone form page (/f/<id>) whose Form submitted trigger starts the workflow. People complete User Task forms along the way.',
  },
  api: {
    label: 'Headless / API',
    badge: 'Headless / API',
    description: 'Another system starts it over REST or an inbound webhook. No UI is needed; people only appear where a decision needs a human.',
  },
  schedule: {
    label: 'Scheduled',
    badge: 'Scheduled',
    description: 'Runs on a schedule (daily, weekly, monthly) in your time zone.',
  },
  event: {
    label: 'Event-driven',
    badge: 'Event-driven',
    description: 'Starts when something changes: a data-table row is created or updated, or a task changes state.',
  },
}

/**
 * What an install needs from the target environment, in words people search
 * for. The precise, generated requirements (credential fields, URLs,
 * assignees) are in the package manifest; these are the chips.
 */
export const GALLERY_NEEDS = {
  rest_api: { label: 'REST API', description: 'A REST API integration: set its base URL and credentials on install.' },
  email: { label: 'Email', description: 'Email delivery configured for the instance (EMAIL_PROVIDER), used for notifications.' },
  assignees: { label: 'Assignees', description: 'People in your workspace to receive the User Tasks (picked on install).' },
  ai_model: { label: 'AI model', description: 'An OpenAI-compatible model endpoint and API key for the AI agent.' },
  webhook: { label: 'Inbound webhook', description: 'An inbound webhook created for the workflow, so other systems can start it.' },
  documents: { label: 'Document templates', description: 'Word / Excel / PowerPoint template files reachable by URL or in storage.' },
  directory: { label: 'Directory / HR system', description: 'An HR system or directory API that lists people and their status.' },
  media_ai: { label: 'Media AI provider', description: 'An API key for a media AI provider (Google Gemini by default; OpenAI, Azure AI, AWS and others can be swapped in) that transcribes, analyses and finds what to redact.' },
} as const

export type GalleryNeed = keyof typeof GALLERY_NEEDS

export type GalleryDifficulty = 'starter' | 'intermediate' | 'advanced'

export interface GalleryChangelogEntry {
  version: string
  /** YYYY-MM-DD */
  date: string
  notes: string
}

/** gallery/packages/<slug>/gallery.json */
export interface GalleryMeta {
  /** Stable package uuid (the package id in every environment; never change it). */
  id: string
  slug: string
  title: string
  category: GalleryCategoryId
  /** One sentence for cards and meta descriptions. */
  summary: string
  /** Long description: paragraphs separated by blank lines. */
  description: string
  trigger: GalleryTrigger
  /** The workflow (asset id) that starts the process. */
  entry_workflow: string
  /**
   * A reusable form (asset id) people submit to start the process on its own
   * page (/f/<id>): its Submit button's Start workflow action, or the entry
   * workflow's Form submitted trigger (implied then). Verification submits it.
   */
  entry_form?: string
  /** One or two sentences: how it starts, in plain words. */
  start: string
  difficulty: GalleryDifficulty
  setup_minutes: number
  tags: string[]
  version: string
  changelog: GalleryChangelogEntry[]
  needs: GalleryNeed[]
  optional_needs?: GalleryNeed[]
  /** How to fill in each requirement after install (ordered steps). */
  setup: string[]
  /** Step-by-step explanation of the flow, in order (shown on the detail page). */
  steps: Array<{ title: string; body: string }>
  /** Example start: variables for the entry workflow (sample API call and verification). */
  sample_input: Record<string, unknown>
  /** What a run started with sample_input reaches (verified against the local stack). */
  expect: 'waiting' | 'completed'
  /** Lucide-style icon name for cards. */
  icon?: string
  /**
   * Third-party systems the package talks to, as shown on the system chips
   * ("Workday", "SAP S/4HANA"). Empty / absent for built-in-only packages.
   */
  systems?: string[]
  /**
   * Verification only (scripts/gallery-verify.ts). sample_input values may be
   * the token "$owner" (the scratch workspace owner's user id, e.g. for a
   * Person field that routes the first task). `agent_outputs`: what the
   * mock AI model answers for each agent output.
   */
  verify_mocks?: {
    agent_outputs?: Record<string, unknown>
    /** The form button verification presses (default: the first submitting button). */
    button?: string
    /**
     * Workflow input → file name: the verifier passes the file's URL as that input. A .docx / .xlsx / .pptx
     * name is a generated template; any other name is a synthetic sample from gallery/samples/.
     */
    files?: Record<string, string>
    /** Entry form attachments: field key → sample file names (gallery/samples/) uploaded before the form is submitted. */
    uploads?: Record<string, string[]>
    /** The mock media AI provider's canned content for this package (lib/gallery/media-mock.ts). */
    media?: MediaMockOptions
    /**
     * User Tasks the verifier completes in order after the run starts (as the install-time assignee), each
     * with an outcome, values ("$owner" = the verifying user) and sample files for attachments fields.
     * `expect` then applies to where the run is after the last one.
     */
    tasks?: Array<{ outcome: string; values?: Record<string, unknown>; uploads?: Record<string, string[]>; button?: string }>
    /** Run variables that must hold a value when the run reaches `expect` (redacted files, transcripts, …). */
    expect_outputs?: string[]
  }
}

/**
 * What a gallery entry installs: a workflow package (process, the default),
 * one official form control (gallery/controls/<slug>), or a bundle of them.
 */
export type GalleryKind = 'process' | 'form_control' | 'control_bundle' | 'workflow_action'

/** Input controls change the form's values; display controls show data (charts, reports, cards). */
export type GalleryControlKind = 'input' | 'display'

/** Canned host answers for a control's live preview on the website (and its contract tests). */
export interface GalleryControlFixtures {
  lookup?: { items: Array<{ value: string; label: string; description?: string; fields?: Record<string, unknown> }>; truncated?: boolean }
  report?: { report: { id: string; name: string; description: string | null; visualization: string | null }; columns: Array<{ key: string; label: string; type: string }>; rows: Array<Record<string, unknown>>; total: number; truncated: boolean }
  /** A file the preview serves to `file` requests (bytes as base64). */
  file?: { id: string; name: string; type: string; size?: number; __bytes: string }
  upload?: { id: string; name: string; size: number; type: string }
}

/** gallery/controls/<slug>/gallery.json — an official form control's listing. */
export interface ControlGalleryMeta {
  /** Package uuid (never change it). */
  id: string
  /** The form_control asset id inside the package (never change it). */
  asset_id: string
  /** = the folder name; the page is /gallery/controls/<slug>. */
  slug: string
  title: string
  kind: GalleryControlKind
  /** One sentence for cards and meta descriptions (40-200 characters). */
  summary: string
  /** Paragraphs separated by blank lines (200+ characters). */
  description: string
  icon?: string
  tags: string[]
  /** = manifest.json version. */
  version: string
  changelog: GalleryChangelogEntry[]
  /** Example uses (cards and the detail page). */
  uses: string[]
  /** What to do after installing (ordered). */
  setup: string[]
  /** Third-party services it talks to (Google Maps Platform, OpenStreetMap…). */
  systems?: string[]
  /** The website's live preview. */
  preview: {
    props?: Record<string, unknown>
    value?: unknown
    label?: string
    height?: number
    /** Values of the declared context entries. */
    context?: Record<string, unknown>
    fixtures?: GalleryControlFixtures
    note?: string
  }
}

/** gallery/controls/bundles/<slug>/gallery.json — several official controls in one package. */
export interface ControlBundleMeta {
  id: string
  slug: string
  title: string
  summary: string
  description: string
  icon?: string
  tags: string[]
  version: string
  changelog: GalleryChangelogEntry[]
  /** Control folder slugs, in order. */
  controls: string[]
}

/** One worked example on an action's gallery page (its outputs are computed by the build, in the sandbox). */
export interface ActionGalleryExample {
  /** Operation id. */
  operation: string
  title: string
  inputs: Record<string, unknown>
  note?: string
}

/** gallery/actions/<slug>/gallery.json — an official custom workflow action's listing. */
export interface ActionGalleryMeta {
  /** Package uuid (never change it). */
  id: string
  /** The workflow_activity asset id inside the package (never change it). */
  asset_id: string
  /** = the folder name; the page is /gallery/actions/<slug>. */
  slug: string
  title: string
  /** One sentence for cards and meta descriptions (40-200 characters). */
  summary: string
  /** Paragraphs separated by blank lines (200+ characters). */
  description: string
  icon?: string
  tags: string[]
  /** = manifest.json version. */
  version: string
  changelog: GalleryChangelogEntry[]
  /** Example uses (cards and the detail page). */
  uses: string[]
  /** What to do after installing (ordered). */
  setup: string[]
  /** 2-6 worked examples (the build runs them and shows the outputs). */
  examples: ActionGalleryExample[]
}

/** What index.json says about a workflow action entry. */
export interface GalleryActionSummary {
  key: string
  operations: Array<{ id: string; label: string }>
  /** Declared capabilities (http, data, files, secrets); [] = pure computation. */
  capabilities: string[]
  hosts: string[]
  secrets: string[]
  module_bytes: number
  sha256: string
}

/** What index.json says about a form control entry (the install wizard and the picker show it). */
export interface GalleryControlSummary {
  /** Custom element tags in the package. */
  tags: string[]
  kind?: GalleryControlKind
  value_types: string[]
  capabilities: string[]
  /** Network hosts the controls declare (an admin approves them after install). */
  hosts: string[]
  /** Bundled libraries: "chart.js 4.5.1 (MIT)". */
  libraries: string[]
  module_bytes: number
}

/** One entry of public/gallery/index.json. */
export interface GalleryIndexEntry {
  /** Absent = 'process' (workflow package). */
  kind?: GalleryKind
  /** Form control entries. */
  control?: GalleryControlSummary
  /** Workflow action entries. */
  action?: GalleryActionSummary
  id: string
  slug: string
  title: string
  category: GalleryCategoryId
  summary: string
  /** How a workflow package starts (absent for form controls). */
  trigger?: GalleryTrigger
  version: string
  released: string
  tags: string[]
  needs: GalleryNeed[]
  optional_needs: GalleryNeed[]
  difficulty: GalleryDifficulty
  setup_minutes: number
  /** Path below the site root, e.g. /gallery/expense-claims-1.0.0.utpkg */
  file: string
  file_name: string
  size_bytes: number
  /** sha256 of the .utpkg file bytes (hex). */
  sha256: string
  /** The package checksum (signed value): sha256 over the canonical manifest. */
  checksum: string
  signed: boolean
  fingerprint: string | null
  asset_count: number
  requirement_count: number
  page: string
  /** official (gallery/packages) or community (approved submission). Absent in older indexes = official. */
  source?: GalleryOrigin
  /** System chips (Workday, SAP S/4HANA, …). */
  systems?: string[]
  /** Built-in features only: no integrations, agents or requirements ("No integrations needed"). */
  native?: boolean
  /** Community packages: the author as they chose to be shown, licence and download count. */
  author?: { name: string; url: string | null } | null
  licence?: string
  downloads?: number
}

export interface GalleryIndex {
  format_version: 1
  generator: 'usertasks-gallery'
  /** Date of the newest package release (deterministic: not the build time). */
  updated: string
  signing: { signed: boolean; fingerprint: string | null; public_key: string | null; key_name: string; note: string }
  categories: Array<{ id: GalleryCategoryId; title: string; summary: string; count: number }>
  packages: GalleryIndexEntry[]
}

/** Reasons people can give when they report a community package. */
export const ABUSE_REASONS = {
  malicious: 'Malicious or unsafe (exfiltrates data, calls unexpected hosts)',
  credentials: 'Contains credentials or personal data',
  copyright: 'Copyright or licence violation',
  spam: 'Spam or misleading',
  broken: 'Does not work as described',
  other: 'Something else',
} as const
export type AbuseReason = keyof typeof ABUSE_REASONS
