/**
 * Global search (header search box) and data-row search, run server-side
 * as the signed-in user.
 *
 * Every object type a person can open is searched by name (ILIKE; the large
 * tables have pg_trgm indexes), at most `limit + 1` rows per type so a
 * section knows whether it has more, all types in parallel. Each section is
 * gated on the permission of the area it links to and filtered to the
 * current workspace explicitly (RLS still applies on the caller's client;
 * the tables without client SELECT grants are read with the service client
 * and scoped here the way their own services scope them). Sections come
 * back in display order with Forms first; within a section, an exact name
 * match ranks first, then prefix and word matches, then the rest by
 * recency (lib/search/rank).
 *
 * Navigation shortcuts, docs and gallery entries are static and public, so
 * the search box filters them in the browser (lib/search/pages).
 */

import { formDesignerHref } from '@/lib/forms/designer-links'
import { escapeLikePattern } from '@/lib/utils'
import { formPageOf } from '@/lib/forms/form-page'
import { rankByMatch } from '@/lib/search/rank'
import { getDb, hasPerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { dbError, serviceRoleClient } from './_shared'
import { authorizeFileDownload } from './form-files'

/* eslint-disable @typescript-eslint/no-explicit-any -- search rows */

const TASK_STATUSES: Record<string, string> = {
  todo: 'To Do', in_progress: 'In Progress', blocked: 'Blocked', completed: 'Completed', cancelled: 'Cancelled',
}
const TASK_PRIORITIES: Record<string, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', none: 'None',
}
const TASK_COLUMNS = 'id, title, status, priority, due_date, assignee:users!tasks_assignee_id_fkey(display_name)'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Display order of the sections (Forms first). */
export const SEARCH_SECTIONS = [
  { key: 'forms', label: 'Forms' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'workflows', label: 'Workflows' },
  { key: 'runs', label: 'Workflow runs' },
  { key: 'tables', label: 'Data tables' },
  { key: 'rows', label: 'Data rows' },
  { key: 'reports', label: 'Reports' },
  { key: 'rules', label: 'Business rules' },
  { key: 'email_templates', label: 'Email templates' },
  { key: 'agents', label: 'Agents' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'custom_steps', label: 'Custom steps' },
  { key: 'packages', label: 'Packages' },
  { key: 'retention', label: 'Retention policies' },
  { key: 'submissions', label: 'Form submissions' },
  { key: 'files', label: 'Files' },
  { key: 'teams', label: 'Teams' },
  { key: 'people', label: 'People' },
] as const

export type SearchSectionKey = (typeof SEARCH_SECTIONS)[number]['key']

export type SearchHitKind =
  | 'form' | 'form_page' | 'task' | 'workflow' | 'schedule' | 'run' | 'table' | 'row' | 'report' | 'rule'
  | 'email_template' | 'agent' | 'integration' | 'connector' | 'reference' | 'mcp_server' | 'custom_step'
  | 'package' | 'retention_policy' | 'submission' | 'file' | 'team' | 'person'

export interface SearchHit {
  kind: SearchHitKind
  id: string
  title: string
  subtitle?: string
  /** Short right-hand detail (a due date…). */
  meta?: string
  href: string
  /** Forms: the friendly link (/form/<system name>), used instead of href on a workspace address. */
  friendly_href?: string
}

export interface SearchSection {
  key: SearchSectionKey
  label: string
  hits: SearchHit[]
  /** More matches than shown (ask again with `section` for up to SEARCH_MORE_LIMIT). */
  more: boolean
}

export interface GlobalSearchResults {
  query: string
  /** Non-empty sections, in display order. */
  sections: SearchSection[]
}

export interface GlobalSearchOptions {
  /** Only this section, with the larger limit ("Show more"). */
  section?: SearchSectionKey
  /** Hits per section (default SEARCH_DEFAULT_LIMIT, max SEARCH_MORE_LIMIT). */
  limit?: number
}

export const SEARCH_DEFAULT_LIMIT = 4
export const SEARCH_MORE_LIMIT = 25

function normalizeQuery(raw: unknown, min = 2): string {
  const q = String(raw ?? '').trim()
  if (q.length < min) throw ServiceError.validation(`Search for at least ${min} characters`)
  return q.slice(0, 200)
}

function keyword(map: Record<string, string>, lowerQ: string): string | null {
  const hit = Object.entries(map).find(([key, label]) => label.toLowerCase().includes(lowerQ) || key.includes(lowerQ))
  return hit ? hit[0] : null
}

function rows(result: { data: unknown; error: { message?: string } | null }) {
  if (result.error) throw dbError(result.error)
  return (result.data ?? []) as Array<Record<string, any>>
}

function shortDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function searchableText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(searchableText).filter(Boolean).join(' ')
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['name', 'title', 'label', 'url']) if (typeof record[key] === 'string') return record[key] as string
    return Object.values(record).map(searchableText).filter(Boolean).join(' ')
  }
  return String(value)
}

const join = (...parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join(' · ')
const enc = encodeURIComponent

/** One section's query: resolves to at most `want` candidate rows. */
type Loader = (want: number) => PromiseLike<{ data: unknown; error: { message?: string } | null }>

interface SectionPlan {
  key: SearchSectionKey
  /** Candidate loaders (merged, deduplicated by kind + id). */
  loaders: Array<{ load: Loader; toHit: (row: any) => SearchHit | null }>
  /** Ranked by name (false: keep the loaders' order, e.g. tasks). */
  rank?: boolean
  /** Async visibility check on the hits (files). */
  filter?: (hits: SearchHit[], rows: Map<string, any>) => Promise<SearchHit[]>
}

export async function globalSearch(ctx: ServiceContext, rawQuery: string, options: GlobalSearchOptions = {}): Promise<GlobalSearchResults> {
  const q = normalizeQuery(rawQuery)
  const db = getDb(ctx) as any
  const tenantId = ctx.tenantId
  // Words in order, anything between ("contract 12" finds "Contract API 12").
  // Escaped: commas/parens break .or() parsing; %/_ are LIKE wildcards.
  const pattern = `%${q.split(/\s+/).filter(Boolean).map(escapeLikePattern).join('%')}%`
  const lowerQ = q.toLowerCase()
  const isId = UUID_RE.test(q)
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? (options.section ? SEARCH_MORE_LIMIT : SEARCH_DEFAULT_LIMIT)) || SEARCH_DEFAULT_LIMIT, 1), SEARCH_MORE_LIMIT)
  // Fetch a few more than shown so ranking can lift an exact match that is
  // not among the most recent, and so `more` is known.
  const want = limit * 2 + 1
  let adminDb: AnySupabaseClient | null = null
  const admin = async () => (adminDb ??= await serviceRoleClient(ctx)) as any

  const can = (permission: string) => hasPerm(ctx, permission)
  const plans: SectionPlan[] = []

  /* Forms: the library (forms.view); people who may only fill forms in find the form pages. */
  if (can('forms.view') || can('forms.submit')) {
    const libraryAccess = can('forms.view')
    plans.push({
      key: 'forms',
      loaders: [{
        load: (n) => db.from('forms').select('id, name, system_name, description, tags, buttons, version, updated_at')
          .eq('tenant_id', tenantId).or(`name.ilike.${pattern},description.ilike.${pattern}`)
          .order('updated_at', { ascending: false }).limit(n),
        toHit: (f) => {
          const page = formPageOf(f.buttons)
          if (!libraryAccess && !page) return null
          return {
            kind: page ? 'form_page' : 'form',
            id: f.id,
            title: f.name,
            subtitle: page ? join('Form page', page.workflow_name && `starts ${page.workflow_name}`) : join(`Form v${f.version ?? 1}`, f.description),
            // Search opens the form to fill in (runtime); only people who can't submit land in the library.
            href: can('forms.submit') ? `/fill/${f.id}` : formDesignerHref(f.id),
            ...(can('forms.submit') && f.system_name ? { friendly_href: `/form/${enc(f.system_name)}` } : {}),
          }
        },
      }],
    })
  }

  /* Tasks: title, description, then status / priority keywords; RLS decides which. */
  if (can('tasks.view_own') || can('tasks.view_all')) {
    const tasksBy = (column: 'title' | 'description') => (n: number) => db.from('tasks')
      .select(TASK_COLUMNS).eq('tenant_id', tenantId).ilike(column, pattern).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(n)
    const status = keyword(TASK_STATUSES, lowerQ)
    const priority = keyword(TASK_PRIORITIES, lowerQ)
    const toHit = (t: any): SearchHit => ({
      kind: 'task', id: t.id, title: t.title,
      subtitle: join(TASK_STATUSES[t.status] ?? t.status, TASK_PRIORITIES[t.priority] ?? t.priority, t.assignee?.display_name),
      meta: shortDate(t.due_date),
      href: `/tasks/${t.id}`,
    })
    plans.push({
      key: 'tasks',
      loaders: [
        ...(isId ? [{ load: () => db.from('tasks').select(TASK_COLUMNS).eq('tenant_id', tenantId).eq('id', q).is('deleted_at', null).limit(1), toHit }] : []),
        { load: tasksBy('title'), toHit },
        { load: tasksBy('description'), toHit },
        ...(status ? [{ load: (n: number) => db.from('tasks').select(TASK_COLUMNS).eq('tenant_id', tenantId).is('deleted_at', null).eq('status', status).order('created_at', { ascending: false }).limit(n), toHit }] : []),
        ...(priority ? [{ load: (n: number) => db.from('tasks').select(TASK_COLUMNS).eq('tenant_id', tenantId).is('deleted_at', null).eq('priority', priority).order('created_at', { ascending: false }).limit(n), toHit }] : []),
      ],
    })
  }

  if (can('workflows.view')) {
    plans.push({
      key: 'workflows',
      loaders: [{
        load: (n) => db.from('workflows').select('id, name, is_active, trigger_type, has_unpublished_changes')
          .eq('tenant_id', tenantId).ilike('name', pattern).order('updated_at', { ascending: false }).limit(n),
        toHit: (w) => ({
          kind: w.trigger_type === 'schedule' ? 'schedule' : 'workflow',
          id: w.id,
          title: w.name,
          subtitle: join(w.is_active ? 'Active' : 'Draft', w.trigger_type === 'schedule' ? 'Scheduled' : String(w.trigger_type ?? '').replace(/_/g, ' ')),
          href: `/automations/${w.id}`,
        }),
      }],
    })
    plans.push({
      key: 'rules',
      loaders: [{
        load: (n) => db.from('decision_tables').select('id, name, description')
          .eq('tenant_id', tenantId).ilike('name', pattern).order('updated_at', { ascending: false }).limit(n),
        toHit: (r) => ({ kind: 'rule', id: r.id, title: r.name, subtitle: join('Decision table', r.description), href: `/automations/rules/${r.id}` }),
      }],
    })
    plans.push({
      key: 'email_templates',
      loaders: [{
        load: (n) => db.from('email_templates').select('id, name, subject')
          .eq('tenant_id', tenantId).or(`name.ilike.${pattern},subject.ilike.${pattern}`).order('updated_at', { ascending: false }).limit(n),
        toHit: (t) => ({ kind: 'email_template', id: t.id, title: t.name, subtitle: t.subject ? `Subject: ${t.subject}` : 'Email template', href: `/automations/email-templates?open=${t.id}` }),
      }],
    })
  }

  if (can('workflows.view_runs')) {
    const toHit = (r: any): SearchHit => ({
      kind: 'run', id: r.id,
      title: r.title || `${r.workflow?.name ?? 'Workflow'} run`,
      subtitle: join(r.workflow?.name, r.status),
      meta: shortDate(r.started_at),
      href: `/automations/runs/${r.id}`,
    })
    const columns = 'id, title, status, started_at, workflow:workflows(name)'
    plans.push({
      key: 'runs',
      rank: false,
      loaders: [
        ...(isId ? [{ load: () => db.from('workflow_runs').select(columns).eq('tenant_id', tenantId).eq('id', q).limit(1), toHit }] : []),
        { load: (n: number) => db.from('workflow_runs').select(columns).eq('tenant_id', tenantId).ilike('title', pattern).order('started_at', { ascending: false }).limit(n), toHit },
      ],
    })
  }

  if (can('data.view')) {
    plans.push({
      key: 'tables',
      loaders: [{
        load: (n) => db.from('custom_tables').select('id, name, description')
          .eq('tenant_id', tenantId).ilike('name', pattern).order('name').limit(n),
        toHit: (t) => ({ kind: 'table', id: t.id, title: t.name, subtitle: t.description || 'Data table', href: `/data/${t.id}` }),
      }],
    })
    plans.push({
      key: 'rows',
      rank: false,
      loaders: [{
        // Row content (search_custom_table_rows: the caller's workspace, RLS-checked).
        load: (n) => db.rpc('search_custom_table_rows', { q, lim: n }),
        toHit: (r) => {
          let snippet = ''
          let field = ''
          if (r.data && typeof r.data === 'object') {
            for (const [key, value] of Object.entries(r.data as Record<string, unknown>)) {
              const text = searchableText(value)
              if (text.toLowerCase().includes(lowerQ)) {
                snippet = text.length > 60 ? `${text.slice(0, 60)}…` : text
                field = key
                break
              }
            }
          }
          return {
            kind: 'row', id: r.id,
            title: field ? `${field}: ${snippet || 'Match found'}` : snippet || `Row ${String(r.id).slice(0, 8)}`,
            subtitle: r.table_name ?? 'Table',
            href: `/data/${r.table_id}`,
          }
        },
      }],
    })
  }

  if (can('reports.view')) {
    plans.push({
      key: 'reports',
      loaders: [{
        // Shared reports and the caller's own (as the RLS policy).
        load: (n) => {
          let query = db.from('reports').select('id, name, description, category, is_shared, created_by')
            .eq('tenant_id', tenantId).ilike('name', pattern)
          if (ctx.actorId) query = query.or(`is_shared.eq.true,created_by.eq.${ctx.actorId}`)
          else query = query.eq('is_shared', true)
          return query.order('updated_at', { ascending: false }).limit(n)
        },
        toHit: (r) => ({ kind: 'report', id: r.id, title: r.name, subtitle: join(r.category, r.is_shared ? 'Shared' : 'Private', r.description), href: `/reports/${r.id}` }),
      }],
    })
  }

  if (can('agents.view')) {
    plans.push({
      key: 'agents',
      loaders: [{
        load: (n) => db.from('agents').select('id, name, description, is_active')
          .eq('tenant_id', tenantId).ilike('name', pattern).order('updated_at', { ascending: false }).limit(n),
        toHit: (a) => ({ kind: 'agent', id: a.id, title: a.name, subtitle: join(a.is_active ? 'Active' : 'Inactive', a.description), href: `/agents/${a.id}` }),
      }],
    })
  }

  if (can('integrations.view')) {
    plans.push({
      key: 'integrations',
      loaders: [
        {
          load: (n) => db.from('integrations').select('id, name, type, is_active')
            .eq('tenant_id', tenantId).ilike('name', pattern).order('name').limit(n),
          toHit: (i) => ({ kind: 'integration', id: i.id, title: i.name, subtitle: join('Integration', i.type, i.is_active ? 'Active' : 'Inactive'), href: `/integrations/${i.id}` }),
        },
        {
          // Never the config / credentials columns.
          load: (n) => db.from('tenant_connectors').select('id, display_name, connector_key, is_enabled')
            .eq('tenant_id', tenantId).or(`display_name.ilike.${pattern},connector_key.ilike.${pattern}`).order('display_name').limit(n),
          toHit: (c) => ({ kind: 'connector', id: c.id, title: c.display_name || c.connector_key, subtitle: join('Connector', c.connector_key, c.is_enabled ? 'Enabled' : 'Disabled'), href: `/integrations?tab=connectors&q=${enc(c.display_name || c.connector_key)}` }),
        },
        {
          load: (n) => db.from('integration_references').select('id, name, integration_id, integration:integrations(name)')
            .eq('tenant_id', tenantId).ilike('name', pattern).order('name').limit(n),
          toHit: (r) => ({ kind: 'reference', id: r.id, title: r.name, subtitle: join('API reference', r.integration?.name), href: `/integrations/${r.integration_id}` }),
        },
        {
          load: (n) => db.from('mcp_servers').select('id, name, url, is_active')
            .eq('tenant_id', tenantId).ilike('name', pattern).order('name').limit(n),
          toHit: (m) => ({ kind: 'mcp_server', id: m.id, title: m.name, subtitle: join('MCP server', m.is_active ? 'Active' : 'Inactive'), href: `/integrations?tab=mcp&q=${enc(m.name)}` }),
        },
      ],
    })
  }

  if (can('extensibility.view')) {
    plans.push({
      key: 'custom_steps',
      loaders: [{
        load: (n) => db.from('custom_workflow_activities').select('id, name, key, status, description')
          .eq('tenant_id', tenantId).or(`name.ilike.${pattern},key.ilike.${pattern}`).order('updated_at', { ascending: false }).limit(n),
        toHit: (a) => ({ kind: 'custom_step', id: a.id, title: a.name, subtitle: join('Custom step', a.key, a.status), href: `/extensibility?q=${enc(a.name)}` }),
      }],
    })
  }

  if (can('packages.view')) {
    plans.push({
      key: 'packages',
      loaders: [{
        // packages has no client SELECT grant (lib/services/packages reads it the same way).
        load: async (n) => (await admin()).from('packages').select('id, name, slug, description, latest_version')
          .eq('tenant_id', tenantId).or(`name.ilike.${pattern},slug.ilike.${pattern}`).order('updated_at', { ascending: false }).limit(n),
        toHit: (p) => ({ kind: 'package', id: p.id, title: p.name, subtitle: join('Package', p.latest_version && `v${p.latest_version}`, p.description), href: '/packages' }),
      }],
    })
  }

  if (can('settings.view')) {
    const governance = can('team.change_roles')
    if (governance || can('reports.view')) {
      plans.push({
        key: 'retention',
        loaders: [{
          load: (n) => db.from('retention_policies').select('id, name, policy_mode, duration_value, duration_unit')
            .eq('tenant_id', tenantId).ilike('name', pattern).order('name').limit(n),
          toHit: (p) => ({
            kind: 'retention_policy', id: p.id, title: p.name,
            subtitle: join('Retention policy', p.duration_value && p.duration_unit && `${p.duration_value} ${p.duration_unit}`, p.policy_mode),
            href: governance ? '/settings/governance?tab=retention' : '/reports/retention',
          }),
        }],
      })
    }
  }

  /* Submissions: one's own, or the workspace's with forms.edit (as lib/services/form-submissions). */
  if (can('forms.submit') && can('forms.view') && (ctx.actorId || can('forms.edit'))) {
    const scoped = async (n: number, match: (query: any) => any) => {
      let query = (await admin()).from('form_submissions').select('id, form_id, form_name, outcome, source, created_at').eq('tenant_id', tenantId)
      if (!can('forms.edit')) query = query.eq('submitted_by', ctx.actorId)
      return match(query).order('created_at', { ascending: false }).limit(n)
    }
    const toHit = (s: any): SearchHit => ({
      kind: 'submission', id: s.id,
      title: s.form_name || 'Form submission',
      subtitle: join('Submission', s.outcome, s.source),
      meta: shortDate(s.created_at),
      href: `/automations/forms?q=${enc(s.form_name ?? '')}&submissions=${s.form_id}`,
    })
    plans.push({
      key: 'submissions',
      rank: false,
      loaders: [
        ...(isId ? [{ load: (n: number) => scoped(n, (query) => query.eq('id', q)), toHit }] : []),
        { load: (n: number) => scoped(n, (query) => query.ilike('form_name', pattern)), toHit },
      ],
    })
  }

  /* Files: uploaded form files by name, each checked like a download (lib/services/form-files). */
  if (ctx.actorId && (can('forms.submit') || can('tasks.view_own') || can('tasks.view_all'))) {
    plans.push({
      key: 'files',
      loaders: [{
        load: async (n) => (await admin()).from('form_files')
          .select('id, tenant_id, name, size, mime_type, status, uploaded_by, context_kind, task_id, submission_id, form_id, created_at')
          .eq('tenant_id', tenantId).in('status', ['pending', 'bound']).ilike('name', pattern)
          .order('created_at', { ascending: false }).limit(n),
        toHit: (f) => ({
          kind: 'file', id: f.id, title: f.name,
          subtitle: join(f.mime_type, f.task_id ? 'Task attachment' : f.submission_id ? 'Form submission file' : 'Upload'),
          meta: shortDate(f.created_at),
          href: f.task_id ? `/tasks/${f.task_id}` : `/attachments/${f.id}`,
        }),
      }],
      filter: async (hits, byId) => {
        const allowed = await Promise.all(hits.map((hit) => authorizeFileDownload(ctx, byId.get(hit.id)).catch(() => false)))
        return hits.filter((_, i) => allowed[i])
      },
    })
  }

  if (can('team.view_members')) {
    plans.push({
      key: 'teams',
      loaders: [{
        load: (n) => db.from('teams').select('id, name, description')
          .eq('tenant_id', tenantId).ilike('name', pattern).order('name').limit(n),
        toHit: (t) => ({ kind: 'team', id: t.id, title: t.name, subtitle: t.description || 'Team', href: '/team' }),
      }],
    })
    plans.push({
      key: 'people',
      loaders: [{
        load: (n) => db.from('users').select('id, display_name, email')
          .eq('tenant_id', tenantId).is('deleted_at', null).or(`display_name.ilike.${pattern},email.ilike.${pattern}`).order('display_name').limit(n),
        toHit: (m) => ({ kind: 'person', id: m.id, title: m.display_name || m.email, subtitle: m.email, href: '/team' }),
      }],
    })
  }

  const selected = options.section ? plans.filter((plan) => plan.key === options.section) : plans
  const built = await Promise.all(selected.map(async (plan): Promise<SearchSection> => {
    const results = await Promise.all(plan.loaders.map(async (loader) => ({ loader, rows: rows(await loader.load(want)) })))
    const seen = new Set<string>()
    const byId = new Map<string, any>()
    let hits: SearchHit[] = []
    for (const { loader, rows: found } of results) {
      for (const row of found) {
        const hit = loader.toHit(row)
        if (!hit || seen.has(`${hit.kind}:${hit.id}`)) continue
        seen.add(`${hit.kind}:${hit.id}`)
        byId.set(hit.id, row)
        hits.push(hit)
      }
    }
    if (plan.rank !== false) hits = rankByMatch(hits, q, (hit) => hit.title)
    if (plan.filter) hits = await plan.filter(hits.slice(0, limit + 1), byId)
    const label = SEARCH_SECTIONS.find((s) => s.key === plan.key)!.label
    return { key: plan.key, label, hits: hits.slice(0, limit), more: hits.length > limit }
  }))

  const order = new Map<string, number>(SEARCH_SECTIONS.map((s, i) => [s.key, i]))
  return {
    query: q,
    sections: built.filter((s) => s.hits.length > 0).sort((a, b) => order.get(a.key)! - order.get(b.key)!),
  }
}

/** Rows whose content matches (data tables list search), up to `limit`. */
export async function searchDataTableRows(ctx: ServiceContext, rawQuery: string, limit = 50) {
  if (!hasPerm(ctx, 'data.view')) throw ServiceError.forbidden("Forbidden: you lack the 'data.view' permission")
  const q = normalizeQuery(rawQuery)
  const { data, error } = await (getDb(ctx) as any).rpc('search_custom_table_rows', { q, lim: Math.min(Math.max(Math.trunc(limit) || 50, 1), 200) })
  if (error) throw dbError(error)
  return (data ?? []) as Array<{ id: string; table_id: string; data: Record<string, unknown>; table_name: string }>
}
