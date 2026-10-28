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

export const GALLERY_CATEGORIES = [
  { id: 'hr-people', title: 'HR & People', summary: 'Onboarding, leave, reviews and the people processes every company runs.' },
  { id: 'finance', title: 'Finance', summary: 'Expenses, invoices, purchasing, vendors and the month-end close.' },
  { id: 'it-security', title: 'IT & Security', summary: 'Access, incidents, changes, identity lifecycle and alert handling.' },
  { id: 'customer-sales', title: 'Customer & Sales', summary: 'Leads, quotes, customer onboarding and complaints with SLAs.' },
  { id: 'operations-compliance', title: 'Operations & Compliance', summary: 'Contracts, attestations, audits, supplier risk and privacy requests.' },
  { id: 'workplace', title: 'Workplace & Facilities', summary: 'Visitors, rooms, vehicles, equipment, events and the everyday office processes.' },
  { id: 'headless-integration', title: 'Headless & Integration', summary: 'API-first orchestration, sync, reconciliation, documents, AI and ETL with no UI at all.' },
] as const

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
    /** Workflow input → file name (.docx / .xlsx / .pptx): the verifier serves a generated template and passes its URL as that input. */
    files?: Record<string, string>
  }
}

/** One entry of public/gallery/index.json. */
export interface GalleryIndexEntry {
  id: string
  slug: string
  title: string
  category: GalleryCategoryId
  summary: string
  trigger: GalleryTrigger
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
