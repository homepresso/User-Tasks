/**
 * Presentation metadata for the docs chrome: the header tabs, an icon and a
 * one-line blurb per sidebar section, and the docs home's curated links.
 * Kept apart from the content files (lib/docs/content) so the pages stay
 * plain Markdown; every link here is checked against the registry by
 * __tests__/docs-chrome.test.ts.
 */

import { DOC_SECTIONS, docHref, sectionOf } from './registry'
import type { DocSectionDef } from './types'

/** Icon names the docs components map to lucide icons (components/docs/icons.tsx). */
export type DocsIconName =
  | 'rocket' | 'graduation' | 'workflow' | 'file' | 'image' | 'inbox' | 'plug' | 'blocks' | 'bot' | 'shield'
  | 'code' | 'terminal' | 'activity' | 'cloud' | 'layers' | 'server' | 'gauge' | 'laptop' | 'book'

export type DocsTabId = 'guides' | 'api' | 'cli' | 'operate'

export interface DocsTab {
  id: DocsTabId
  label: string
  href: string
}

/** Header tabs: natural top-level groups of the sidebar sections. */
export const DOCS_TABS: DocsTab[] = [
  { id: 'guides', label: 'Guides', href: '/docs' },
  { id: 'api', label: 'API and MCP', href: '/docs/api' },
  { id: 'cli', label: 'CLI and SDK', href: '/docs/cli' },
  { id: 'operate', label: 'Self-hosting', href: '/docs/self-hosting' },
]

export interface SectionMeta {
  icon: DocsIconName
  blurb: string
  tab: DocsTabId
}

/** Keyed by DocSectionDef.title; a test fails if a section is missing. */
export const SECTION_META: Record<string, SectionMeta> = {
  'Getting started': { icon: 'rocket', blurb: 'Sign in or install, then learn the handful of ideas everything builds on.', tab: 'guides' },
  Tutorials: { icon: 'graduation', blurb: 'Hands-on walkthroughs: a form, an approval, an agent, an integration.', tab: 'guides' },
  Workflows: { icon: 'workflow', blurb: 'The designer, triggers, nodes, expressions, timing and error handling.', tab: 'guides' },
  Documents: { icon: 'file', blurb: 'Read, compare, convert, extract, redact and OCR documents in a workflow.', tab: 'guides' },
  'Media (images, audio, video)': { icon: 'image', blurb: 'Transcribe, analyse, redact and generate images, audio and video.', tab: 'guides' },
  Tasks: { icon: 'inbox', blurb: 'People in the loop: forms, fields, outcomes, assignment and SLAs.', tab: 'guides' },
  Integrations: { icon: 'plug', blurb: 'Call any API, use connectors, OAuth, OpenAPI import and webhooks.', tab: 'guides' },
  'Building blocks': { icon: 'blocks', blurb: 'Decision tables, data tables, reports, email templates and custom steps.', tab: 'guides' },
  'AI assistant (Agent)': { icon: 'bot', blurb: 'Bring your own model key and let the Agent build and run work with you.', tab: 'guides' },
  'Governance and security': { icon: 'shield', blurb: 'Roles, teams, SSO, SCIM, API keys, audit and retention.', tab: 'guides' },
  'API and MCP': { icon: 'code', blurb: 'The REST API, every endpoint, and the MCP server for AI clients.', tab: 'api' },
  'CLI, SDK and config': { icon: 'terminal', blurb: 'The usertasks CLI, the TypeScript SDK and config as code.', tab: 'cli' },
  Extensions: { icon: 'blocks', blurb: 'Build extensions compiled into UserTasks: manifest, workflow steps, connectors, API, jobs, menus and settings.', tab: 'cli' },
  Observability: { icon: 'activity', blurb: 'The event stream, log export destinations and background jobs.', tab: 'operate' },
  'Deploy anywhere': { icon: 'cloud', blurb: 'Reference topologies for Supabase, AWS, Azure, Google Cloud and on-premises.', tab: 'operate' },
  'Choosing services': { icon: 'layers', blurb: 'Pick the database, auth, storage, email and cache providers you run.', tab: 'operate' },
  'Self-hosting': { icon: 'server', blurb: 'Install, configure, update and back up your own UserTasks.', tab: 'operate' },
  Project: { icon: 'gauge', blurb: 'Performance measurements and project notes.', tab: 'operate' },
}

const FALLBACK_META: SectionMeta = { icon: 'book', blurb: '', tab: 'guides' }

export function sectionMeta(title: string): SectionMeta {
  return SECTION_META[title] ?? FALLBACK_META
}

/** Sections shown under a header tab, in sidebar order. */
export function sectionsForTab(tab: DocsTabId): DocSectionDef[] {
  return DOC_SECTIONS.filter((section) => sectionMeta(section.title).tab === tab)
}

/** The header tab a docs path belongs to (the docs home and unknown paths are Guides). */
export function tabForPath(pathname: string): DocsTabId {
  const path = pathname.replace(/[#?].*$/, '').replace(/\/+$/, '')
  if (path === '/docs' || !path.startsWith('/docs/')) return 'guides'
  const slug = path.slice('/docs/'.length)
  const section = sectionOf(slug) ?? DOC_SECTIONS.find((candidate) => (candidate.links ?? []).some((link) => link.href === path))
  return section ? sectionMeta(section.title).tab : 'guides'
}

export interface HomeLink {
  title: string
  body: string
  href: string
  icon: DocsIconName
}

/** "Start here" cards on the docs home. */
export const START_HERE: HomeLink[] = [
  { icon: 'laptop', title: 'Quick start on your computer', body: 'Run UserTasks locally in a few commands, then sign in with the setup code.', href: '/docs/self-hosting/quick-start' },
  { icon: 'cloud', title: 'Cloud quick start', body: 'Sign in, build and publish a first workflow, and run it.', href: '/docs/quickstart/cloud' },
  { icon: 'workflow', title: 'Build your first workflow', body: 'An approval with a form, a decision and an email, step by step.', href: '/docs/tutorials/approval-workflow' },
  { icon: 'terminal', title: 'CLI', body: 'Log in, edit workflows as files, tail logs and promote config.', href: '/docs/cli' },
  { icon: 'code', title: 'API', body: 'Authenticate and call every endpoint the app uses, or try them in the explorer.', href: '/docs/api' },
]

/** Deep links into long guides that are easy to miss from the section list. */
export const POPULAR_PAGES: Array<{ title: string; href: string }> = [
  { title: 'Step-by-step tutorials', href: '/docs/tutorials' },
  { title: 'Build a form with the wizard', href: '/docs/tasks/form-wizard' },
  { title: 'Set up the Agent (AI assistant)', href: '/docs/ai-assistants' },
  { title: 'Share and embed a form', href: '/docs/tasks/forms#sharing-and-embedding-forms' },
  { title: 'Form sign-in page', href: '/docs/tasks/forms#form-sign-in-page' },
  { title: 'Workspace address and friendly links', href: '/docs/governance/workspace-address' },
  { title: 'Form rules and read-only parts', href: '/docs/tasks/forms#rules' },
  { title: 'Parameters and test inputs', href: '/docs/tasks/forms#parameters-and-variables' },
  { title: 'When to load (faster forms)', href: '/docs/tasks/forms#when-to-load-faster-forms' },
  { title: 'Queued tasks and queue rules', href: '/docs/tasks#task-queue-rules' },
  { title: 'Task attachments', href: '/docs/tasks/attachments' },
  { title: 'Task completed screen', href: '/docs/tasks#task-completed-screen' },
]

export interface HomeFeature {
  icon: DocsIconName
  eyebrow: string
  title: string
  body: string
  links: Array<{ title: string; href: string }>
}

/** The self-hosting / API / Agent strip on the docs home. */
export const HOME_FEATURES: HomeFeature[] = [
  {
    icon: 'server',
    eyebrow: 'Self-hosting',
    title: 'Run it on your own infrastructure',
    body: 'Docker Compose, Kubernetes, air-gapped or from source, with Supabase or plain PostgreSQL.',
    links: [
      { title: 'Install step by step', href: docHref('self-hosting/install') },
      { title: 'Requirements', href: docHref('self-hosting/requirements') },
      { title: 'Troubleshooting', href: docHref('self-hosting/troubleshooting') },
    ],
  },
  {
    icon: 'code',
    eyebrow: 'API and MCP',
    title: 'Drive everything from code',
    body: 'The REST API covers what the app does; the MCP server hands the same tools to AI clients.',
    links: [
      { title: 'REST API guide', href: docHref('api') },
      { title: 'API Explorer', href: '/docs/api-explorer' },
      { title: 'MCP server', href: docHref('mcp') },
    ],
  },
  {
    icon: 'bot',
    eyebrow: 'Agent',
    title: 'Build with the AI assistant',
    body: 'Bring your own model key; the Agent builds forms and workflows and works tasks alongside you.',
    links: [
      { title: 'Set up the Agent', href: docHref('ai-assistants') },
      { title: 'Using the Agent', href: docHref('ai-assistants/using') },
      { title: 'Tutorial: build with the Agent', href: docHref('tutorials/agent-build-form-and-workflow') },
    ],
  },
]
