/**
 * App specs, server side (lib/apps/spec.ts is the pure model): plan and
 * apply ONE structured proposal for a whole app — or a change to one — for
 * the AI Agent (lib/assistants/tools/designer.ts, confirmed by the person),
 * MCP (apps_plan / apps_apply_spec) and REST (POST /api/v1/apps/plan,
 * /api/v1/apps/apply).
 *
 *  - planAppSpec: read-only. Compiles the spec against the existing app (edit
 *    access needed) or checks Build apps (apps.manage) for a new one, then the
 *    governance a builder must pass: every form, workflow, data table, report,
 *    agent and API reference the spec ADDS must exist in this workspace and be
 *    visible to the caller (an API reference needs View integrations, letting
 *    app viewers see / run one needs Manage references, a "Start a workflow"
 *    rule needs Start workflows); every person, team and role must be of this
 *    workspace. Returns plain-language errors (never throws for a bad spec)
 *    or a summary for a confirmation card.
 *  - applyAppSpec: plans again (nothing is trusted from an earlier plan),
 *    then applies through lib/services/apps.ts — so every write is audited
 *    as the caller (marked "via Agent" for the Agent) with the usual checks.
 *    A new app is created whole; if any later step fails the app is deleted
 *    again. Changes to an existing app are undone in reverse order when a
 *    step fails (app settings and page layouts restored, pages added removed,
 *    deleted pages re-created). Either way the error says nothing was kept.
 *  - describeAppObject: a form's fields and parameters, a data table's
 *    columns and views, a workflow's trigger — what a builder binds to.
 *
 * Drafts (lib/services/app-versions.ts): apply writes the app's DRAFT — a new
 * app starts unpublished (only its editors see it), a change to a published
 * app is invisible to its audience until someone publishes it. `publish:
 * true` (only when the person explicitly asked) publishes right after
 * applying, with `publish_note` as the version note.
 */

import { appReferenceIds, collectAppReferences, type AppDocument } from '@/lib/apps/references'
import { APP_DESIGN_GUIDE, APP_SPEC_EXAMPLE, BUILTIN_ICON_NAMES, appSpecJsonSchema, compileAppSpec, summariseSpec, type CompiledSpec, type ExistingApp, type SpecSummary } from '@/lib/apps/spec'
import { WIDGET_CONFIG_SCHEMAS, isWidgetType, normalisePageLayout, type AppDetail, type AppPage, type PageLayout } from '@/lib/apps/schema'
import { ruleActions, type AppRule } from '@/lib/apps/rules'
import { layoutFormParams } from '@/lib/forms/form-params'
import { WIDGET_CATALOG } from '@/lib/apps/widgets'
import { PAGE_TEMPLATES } from '@/lib/apps/templates'
import { z } from 'zod'
import * as apps from './apps'
import { loadObjects } from './app-access'
import { hasPerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'
import { appDraftsAvailable } from './app-published'
import { publishApp } from './app-versions'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped tables and free-form specs */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OBJECT_KINDS = ['form', 'workflow', 'data_table', 'report', 'agent', 'reference'] as const
type ObjectKind = (typeof OBJECT_KINDS)[number]
const KIND_LABEL: Record<ObjectKind, string> = { form: 'form', workflow: 'workflow', data_table: 'data table', report: 'report', agent: 'agent', reference: 'API reference' }
const SEARCH_KIND: Record<ObjectKind, string> = { form: 'form', workflow: 'workflow', data_table: 'table', report: 'report', agent: 'agent', reference: 'reference' }

export interface AppSpecPlan {
  valid: boolean
  /** Plain-language problems to fix (the model fixes its spec and plans again). */
  errors: string[]
  warnings: string[]
  mode: 'create' | 'edit' | null
  app: { id: string | null; slug: string | null; name: string }
  /** The confirmation card: title, lines, warnings and a widget table. */
  summary: SpecSummary | null
  /** draft (default): applied to the app's draft; publish: published right after (publish: true); live: no drafts on this server. */
  save_as?: 'draft' | 'publish' | 'live'
}

export interface AppSpecResult {
  applied: true
  mode: 'create' | 'edit'
  app: { id: string; slug: string; name: string }
  /** Open the app / its builder. */
  href: string
  builder_href: string
  pages: Array<{ slug: string; title: string; widgets: number; created: boolean }>
  deleted_pages: string[]
  warnings: string[]
  /** People in the audience who can't use something the app shows (apps_access_check / apps_access_grant). */
  access: { issues: number; grantable: number } | null
  /** draft: saved to the app's draft (publish to make it live); published: published as `version`; live: no drafts on this server (live at once). */
  saved_as: 'draft' | 'published' | 'live'
  /** The version published (saved_as published). */
  version: number | null
  /** The draft as its audience would see it (editors). */
  preview_href: string
}

export interface PublishChoice { publish: boolean; note: string | null }

/** The apply-only keys (publish, publish_note) are not part of the app spec itself. */
export function splitPublish(spec: unknown): { spec: unknown; choice: PublishChoice } {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return { spec, choice: { publish: false, note: null } }
  const { publish, publish_note, ...rest } = spec as Record<string, unknown>
  return { spec: rest, choice: { publish: publish === true, note: typeof publish_note === 'string' && publish_note.trim() ? publish_note.trim().slice(0, 1000) : null } }
}

interface Prepared {
  compiled: CompiledSpec
  existing: (ExistingApp & { detail: AppDetail }) | null
  summary: SpecSummary
  appName: string
  /** Publish right after applying (publish: true and drafts enabled). */
  publish?: PublishChoice | null
}

/* ── Loading the existing app ────────────────────────────────────────── */

async function loadExisting(ctx: ServiceContext, key: string): Promise<(ExistingApp & { detail: AppDetail }) | string> {
  let detail: AppDetail
  try {
    detail = await apps.getApp(ctx, key)
  } catch (error) {
    if (error instanceof ServiceError && (error.status === 404 || error.status === 403)) return `App “${key}” not found — check the id or slug with apps_list`
    throw error
  }
  if (detail.access !== 'edit') return `You can open “${detail.name}” but not edit it — ask one of its editors or someone with Build apps`
  const pages = await apps.listPages(ctx, detail.id)
  return {
    id: detail.id, slug: detail.slug, name: detail.name, menu: detail.menu, nav: detail.nav, params: detail.params, variables: detail.variables,
    rules: detail.rules, style: detail.style, audience: detail.audience, editors: detail.editors, pages, detail,
  }
}

function existingDoc(existing: ExistingApp | null): AppDocument {
  if (!existing) return { pages: [] }
  return {
    menu: existing.menu,
    settings: { nav: existing.nav, params: existing.params, variables: existing.variables, rules: existing.rules, style: existing.style },
    pages: existing.pages.map((p) => ({ slug: p.slug, title: p.title, icon: p.icon, layout: p.layout, filters: p.filters })),
  }
}

/* ── Governance ──────────────────────────────────────────────────────── */

interface Names { objects: Map<string, string>; principals: Map<string, string> }

/** May a builder bind this object? (it exists here and they can see it) */
function bindable(ctx: ServiceContext, kind: ObjectKind, info: { created_by: string | null; is_shared?: boolean } | undefined): string | null {
  if (!info) return 'does not exist in this workspace'
  const can = (p: string) => hasPerm(ctx, p)
  switch (kind) {
    case 'form': return can('forms.view') || can('forms.edit') || can('forms.submit') ? null : 'you can\'t see forms (View forms)'
    case 'workflow': return can('workflows.view') ? null : 'you can\'t see workflows (View workflows)'
    case 'data_table': return can('data.view') ? null : 'you can\'t see data tables (View data)'
    case 'report': return !can('reports.view') ? 'you can\'t see reports (View reports)' : info.is_shared || info.created_by === ctx.actorId ? null : 'is a private report of someone else'
    case 'agent': return can('agents.view') ? null : 'you can\'t see agents (View agents)'
    case 'reference': return can('integrations.view') ? null : 'binding an API reference needs View integrations'
  }
}

function allRules(doc: AppDocument): Array<{ rules: AppRule[]; where: string; key: string }> {
  const out: Array<{ rules: AppRule[]; where: string; key: string }> = [{ rules: ((doc.settings as any)?.rules ?? []) as AppRule[], where: 'app rules', key: 'app' }]
  for (const p of doc.pages ?? []) out.push({ rules: ((p.layout as PageLayout | undefined)?.rules ?? []) as AppRule[], where: `page “${p.title}”`, key: `page:${p.slug}` })
  return out
}

function cardRefs(doc: AppDocument): Map<string, { ref: string | null; allow: boolean; where: string }> {
  const out = new Map<string, { ref: string | null; allow: boolean; where: string }>()
  for (const p of doc.pages ?? []) {
    for (const w of ((p.layout as PageLayout | undefined)?.widgets ?? [])) {
      if (w.type !== 'card_view' || (w.config as any).source !== 'reference') continue
      out.set(`${p.slug}:${w.id}`, { ref: (w.config as any).reference_id ?? null, allow: (w.config as any).allow_viewers === true, where: `Page “${p.title}” › ${w.title || w.id}` })
    }
  }
  return out
}

async function governance(ctx: ServiceContext, db: AnySupabaseClient, compiled: CompiledSpec, existing: ExistingApp | null): Promise<{ errors: string[]; names: Names }> {
  const errors: string[] = []
  const before = existingDoc(existing)
  const after = compiled.doc as AppDocument
  const had = appReferenceIds(before)
  const now = appReferenceIds(after)
  const refs = collectAppReferences(after)
  const whereOf = (kind: string, id: string) => refs.find((r) => r.kind === kind && r.id === id)?.where ?? (((compiled.app?.audience ?? []) as any[]).some((a) => a.id === id) ? 'Audience' : ((compiled.app?.editors ?? []) as string[]).includes(id) ? 'Editors' : 'the app')

  // Objects: everything named is loaded (names for the card); only ADDED ones must be bindable by the caller.
  const ids = Object.fromEntries(OBJECT_KINDS.map((k) => [k, [...new Set([...now[k], ...had[k]])]])) as Record<ObjectKind, string[]>
  const objects = await loadObjects(db, ctx.tenantId, ids)
  const names: Names = { objects: new Map(), principals: new Map() }
  for (const k of OBJECT_KINDS) for (const [id, info] of objects[k]) names.objects.set(id, info.name)
  for (const kind of OBJECT_KINDS) {
    const old = new Set(had[kind])
    for (const id of now[kind]) {
      if (old.has(id)) continue
      const problem = UUID_RE.test(id) ? bindable(ctx, kind, objects[kind].get(id)) : 'is not an id'
      if (problem) errors.push(`${whereOf(kind, id)}: the ${KIND_LABEL[kind]} ${id} ${problem} — pick one with apps_search (kind ${SEARCH_KIND[kind]})`)
    }
  }

  // People, teams and roles must be of this workspace.
  const audience = ((compiled.app?.audience ?? []) as Array<{ type: 'user' | 'team' | 'role'; id: string }>)
  const fromAudience = (t: string) => audience.filter((a) => a.type === t).map((a) => a.id)
  const principalIds = {
    user: [...new Set([...now.user, ...fromAudience('user'), ...((compiled.app?.editors ?? []) as string[])])],
    team: [...new Set([...now.team, ...fromAudience('team')])],
    role: [...new Set([...now.role, ...fromAudience('role')])],
  }
  const checks: Array<[keyof typeof principalIds, string, string, string]> = [['user', 'user_memberships', 'user_id', 'person'], ['team', 'teams', 'id', 'team'], ['role', 'roles', 'id', 'role']]
  for (const [kind, table, column, noun] of checks) {
    const list = principalIds[kind].filter((id) => UUID_RE.test(id))
    const bad = principalIds[kind].filter((id) => !UUID_RE.test(id))
    for (const id of bad) errors.push(`${whereOf(kind, id)}: "${id}" is not a ${noun} id — look it up with apps_search (kind ${kind})`)
    if (!list.length) continue
    let query = (db as any).from(table).select(kind === 'user' ? column : `${column}, name`).eq('tenant_id', ctx.tenantId).in(column, list)
    if (table === 'user_memberships') query = query.eq('is_active', true)
    const { data, error } = await query
    if (error) throw dbError(error)
    const found = new Set(((data ?? []) as any[]).map((r) => String(r[column])))
    for (const r of (data ?? []) as any[]) if (r.name) names.principals.set(`${kind}:${r[column]}`, `${noun === 'team' ? 'Team' : 'Role'} ${r.name}`)
    for (const id of list) if (!found.has(id)) errors.push(`${whereOf(kind, id)}: no ${noun} with id ${id} in this workspace — look it up with apps_search (kind ${kind})`)
  }
  if (principalIds.user.length) {
    const { data } = await (db as any).from('users').select('id, display_name, email').in('id', principalIds.user.filter((id) => UUID_RE.test(id)))
    for (const u of (data ?? []) as any[]) names.principals.set(`user:${u.id}`, String(u.display_name || u.email || 'A person'))
  }

  // API reference cards: letting app viewers see the data needs Manage references.
  const oldCards = cardRefs(before)
  for (const [key, card] of cardRefs(after)) {
    const was = oldCards.get(key)
    if (card.allow && (!was || !was.allow || was.ref !== card.ref) && !hasPerm(ctx, 'integrations.manage_references')) errors.push(`${card.where}: letting app viewers see API data (allow_viewers) needs Manage references — leave allow_viewers off`)
  }
  // Rules: "Call an API reference" for viewers, "Start a workflow".
  const oldActions = new Map(allRules(before).flatMap((g) => g.rules.flatMap((r) => ruleActions(r).map(({ path, action }) => [`${g.key}:${r.id}:${path}`, action] as const))))
  for (const g of allRules(after)) {
    for (const r of g.rules) {
      for (const { path, action } of ruleActions(r)) {
        const was = oldActions.get(`${g.key}:${r.id}:${path}`) as any
        const a = action as any
        if (a.type === 'call_reference' && a.allow_viewers && (!was || was.type !== 'call_reference' || !was.allow_viewers || was.reference_id !== a.reference_id) && !hasPerm(ctx, 'integrations.manage_references')) {
          errors.push(`${g.where} › rule ${r.name ?? r.id}: letting app viewers run an API reference needs Manage references`)
        }
        if (a.type === 'start_workflow' && (!was || was.type !== 'start_workflow' || was.workflow_id !== a.workflow_id) && !hasPerm(ctx, 'workflows.activate')) {
          errors.push(`${g.where} › rule ${r.name ?? r.id}: "Start a workflow" needs Start workflows`)
        }
      }
    }
  }
  return { errors, names }
}

/* ── Plan ────────────────────────────────────────────────────────────── */

async function prepare(ctx: ServiceContext, input: unknown): Promise<{ plan: AppSpecPlan; prepared: Prepared | null }> {
  const { spec, choice } = splitPublish(input)
  const fail = (errors: string[], mode: AppSpecPlan['mode'] = null, app: AppSpecPlan['app'] = { id: null, slug: null, name: '' }) => ({ plan: { valid: false, errors, warnings: [], mode, app, summary: null }, prepared: null })
  if (ctx.authKind === 'anonymous') throw ServiceError.forbidden('Apps are not available on a public form')
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return fail(['The spec must be an object: { app?, app_id?, pages, … }'])
  const key = typeof (spec as any).app_id === 'string' ? String((spec as any).app_id).trim() : ''
  let existing: (ExistingApp & { detail: AppDetail }) | null = null
  if (key) {
    const loaded = await loadExisting(ctx, key)
    if (typeof loaded === 'string') return fail([loaded], 'edit')
    existing = loaded
  } else if (!hasPerm(ctx, 'apps.manage')) {
    return fail(['Creating an app needs Build apps (apps.manage) — ask an admin for it, or give app_id to change an app you edit'], 'create')
  }
  const result = compileAppSpec(spec, existing)
  const appName = existing ? String((spec as any).app?.name ?? existing.name) : String((spec as any).app?.name ?? '')
  const appRef = { id: existing?.id ?? null, slug: existing?.slug ?? null, name: appName }
  if (!result.ok) return fail(result.errors, existing ? 'edit' : 'create', appRef)
  const db = await serviceRoleClient(ctx)
  const { errors, names } = await governance(ctx, db, result.compiled, existing)
  if (errors.length) return fail([...new Set(errors)].slice(0, 40), result.compiled.mode, appRef)
  const summary = summariseSpec(result.compiled, { appName, name: (_k, id) => names.objects.get(id) ?? null, principal: (type, id) => names.principals.get(`${type}:${id}`) ?? null })
  const drafts = await appDraftsAvailable(db)
  const saveAs: AppSpecPlan['save_as'] = !drafts ? 'live' : choice.publish ? 'publish' : 'draft'
  if (saveAs === 'draft') summary.lines.push(existing ? 'Saved as a draft — the app’s audience keeps seeing the published version until you publish' : 'Saved as a draft — only the app’s editors see it until you publish it')
  else if (saveAs === 'publish') summary.warnings.push('Publishes straight away: everyone in the app’s audience sees it at once')
  else if (existing) summary.warnings.push('Apps have no draft on this server: people who can open the app see the change at once')
  return {
    plan: { valid: true, errors: [], warnings: result.compiled.warnings, mode: result.compiled.mode, app: appRef, summary, save_as: saveAs },
    prepared: { compiled: result.compiled, existing, summary, appName },
  }
}

/** Check a spec and describe it (read-only; never throws for a bad spec — errors come back as plain lines). */
export async function planAppSpec(ctx: ServiceContext, spec: unknown): Promise<AppSpecPlan> {
  return (await prepare(ctx, spec)).plan
}

/* ── Apply ───────────────────────────────────────────────────────────── */

/** The service calls apply uses (a seam for tests that inject a failing step). */
export interface ApplyDeps {
  createApp: typeof apps.createApp
  updateApp: typeof apps.updateApp
  deleteApp: typeof apps.deleteApp
  createPage: typeof apps.createPage
  updatePage: typeof apps.updatePage
  deletePage: typeof apps.deletePage
  reorderPages: typeof apps.reorderPages
}

const DEFAULT_DEPS: ApplyDeps = {
  createApp: apps.createApp, updateApp: apps.updateApp, deleteApp: apps.deleteApp,
  createPage: apps.createPage, updatePage: apps.updatePage, deletePage: apps.deletePage, reorderPages: apps.reorderPages,
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Apply a spec as the caller (plans again first). A failed step leaves nothing behind. */
export async function applyAppSpec(ctx: ServiceContext, spec: unknown, deps: Partial<ApplyDeps> = {}): Promise<AppSpecResult> {
  const d: ApplyDeps = { ...DEFAULT_DEPS, ...deps }
  const { plan, prepared } = await prepare(ctx, spec)
  if (prepared) prepared.publish = plan.save_as === 'publish' ? splitPublish(spec).choice : null
  if (!prepared) {
    if (plan.errors.some((e) => /needs Build apps|but not edit it/.test(e))) throw ServiceError.forbidden(plan.errors[0])
    if (plan.errors.some((e) => /not found/.test(e)) && plan.mode === 'edit') throw ServiceError.notFound(plan.errors[0])
    throw ServiceError.validation(`The app spec has ${plan.errors.length} problem${plan.errors.length === 1 ? '' : 's'}:\n- ${plan.errors.join('\n- ')}`, plan.errors)
  }
  const { compiled, existing } = prepared
  return compiled.mode === 'create' ? applyCreate(ctx, d, prepared) : applyEdit(ctx, d, prepared, existing!)
}

async function finish(ctx: ServiceContext, appId: string, prepared: Prepared, mode: 'create' | 'edit'): Promise<AppSpecResult> {
  const detail = await apps.getApp(ctx, appId)
  const { compiled } = prepared
  const widgets = compiled.changes.reduce((n, c) => n + c.added.length, 0)
  await audit(ctx, {
    objectType: 'app', objectId: appId, action: mode === 'create' ? 'create' : 'update',
    summary: `${mode === 'create' ? 'Built' : 'Changed'} app "${detail.name}" from a spec (${compiled.changes.length} page${compiled.changes.length === 1 ? '' : 's'}, ${widgets} new widget${widgets === 1 ? '' : 's'})`,
    metadata: { kind: 'app_spec', pages: compiled.changes.map((c) => c.slug), deleted_pages: compiled.deletes.map((p) => p.slug), widgets_added: widgets },
  })
  let access: AppSpecResult['access'] = null
  try {
    const analysis = await apps.getAppAccessAnalysis(ctx, appId)
    access = { issues: analysis.gaps.length, grantable: analysis.grantable }
  } catch { access = null }
  const home = detail.home_page ?? compiled.doc.pages[0]?.slug ?? 'home'
  const warnings = [...compiled.warnings]
  let savedAs: AppSpecResult['saved_as'] = detail.content === 'live' ? 'live' : 'draft'
  let version: number | null = null
  if (prepared.publish?.publish && savedAs === 'draft') {
    try {
      const published = await publishApp(ctx, appId, { note: prepared.publish.note })
      savedAs = 'published'
      version = published.version
    } catch (error) {
      warnings.push(`Saved as a draft but not published: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return {
    applied: true, mode,
    app: { id: detail.id, slug: detail.slug, name: detail.name },
    href: `/apps/${detail.slug}`,
    builder_href: `/apps/${detail.slug}/${home}?edit=1`,
    preview_href: `/apps/${detail.slug}/${home}?preview=1`,
    saved_as: savedAs,
    version,
    pages: compiled.changes.map((c) => ({ slug: c.slug, title: c.title, widgets: compiled.doc.pages.find((p) => p.slug === c.slug)?.layout.widgets.length ?? 0, created: c.created })),
    deleted_pages: compiled.deletes.map((p) => p.slug),
    warnings,
    access,
  }
}

async function applyCreate(ctx: ServiceContext, d: ApplyDeps, prepared: Prepared): Promise<AppSpecResult> {
  const { compiled } = prepared
  const created = await d.createApp(ctx, compiled.app as never)
  try {
    const [first, ...rest] = compiled.pages
    // The new app starts with an empty Home page: the first page of the spec becomes it.
    if (first) await d.updatePage(ctx, created.id, 'home', first.input as never)
    for (const op of rest) await d.createPage(ctx, created.id, op.input as never)
    if (compiled.order) await d.reorderPages(ctx, created.id, compiled.order)
  } catch (error) {
    try {
      await d.deleteApp(ctx, created.id)
    } catch (cleanup) {
      throw ServiceError.validation(`Building the app failed (${reason(error)}) and it could not be removed again (${reason(cleanup)}): delete “${created.name}” from Apps`)
    }
    throw rethrow(error, 'Nothing was created')
  }
  return finish(ctx, created.id, prepared, 'create')
}

type Undo = () => Promise<unknown>

async function applyEdit(ctx: ServiceContext, d: ApplyDeps, prepared: Prepared, existing: ExistingApp & { detail: AppDetail }): Promise<AppSpecResult> {
  const { compiled } = prepared
  const appId = existing.id
  const undo: Undo[] = []
  try {
    if (compiled.app) {
      const patch = compiled.app
      const previous: Record<string, unknown> = {}
      const det = existing.detail as any
      for (const k of Object.keys(patch)) previous[k] = k === 'audience' ? existing.audience ?? [] : k === 'editors' ? existing.editors ?? [] : det[k] ?? null
      await d.updateApp(ctx, appId, patch as never)
      undo.push(() => d.updateApp(ctx, appId, previous as never))
    }
    for (const op of compiled.pages) {
      if (op.op === 'create') {
        const page = await d.createPage(ctx, appId, op.input as never)
        undo.push(() => d.deletePage(ctx, appId, page.id))
      } else {
        // Pages are addressed by slug (ids in some stores look like slugs); the undo uses the slug it now has.
        await d.updatePage(ctx, appId, op.before.slug, op.input as never)
        const b = op.before
        undo.push(() => d.updatePage(ctx, appId, op.slug, { title: b.title, slug: b.slug, icon: b.icon, layout: normalisePageLayout(b.layout) as never, filters: b.filters } as never))
      }
    }
    for (const del of compiled.deletes) {
      const before = existing.pages.find((p) => p.id === del.id) as AppPage
      await d.deletePage(ctx, appId, del.slug)
      undo.push(() => d.createPage(ctx, appId, { title: before.title, slug: before.slug, icon: before.icon, position: before.position, layout: before.layout as never, filters: before.filters } as never))
    }
    if (compiled.order) {
      const previous = existing.pages.map((p) => p.slug)
      await d.reorderPages(ctx, appId, compiled.order)
      undo.push(() => d.reorderPages(ctx, appId, previous))
    }
  } catch (error) {
    const failed: string[] = []
    for (const step of undo.reverse()) {
      try { await step() } catch (e) { failed.push(reason(e)) }
    }
    if (failed.length) throw ServiceError.validation(`Changing the app failed (${reason(error)}); ${failed.length} step${failed.length === 1 ? '' : 's'} could not be undone (${failed[0]}) — check the app in its builder`)
    throw rethrow(error, 'Nothing was changed')
  }
  return finish(ctx, appId, prepared, 'edit')
}

function rethrow(error: unknown, prefix: string): ServiceError {
  if (error instanceof ServiceError) {
    return new ServiceError(error.code, `${prefix}: ${error.message}`, { status: error.status, details: error.details })
  }
  return ServiceError.validation(`${prefix}: ${reason(error)}`)
}

/* ── Object details (what a builder binds to) ────────────────────────── */

export async function describeAppObject(ctx: ServiceContext, input: { kind: 'form' | 'table' | 'workflow'; id: string }): Promise<Record<string, unknown>> {
  if (!hasPerm(ctx, 'apps.manage') && !hasPerm(ctx, 'apps.view')) throw ServiceError.forbidden('Forbidden: you lack the \'apps.view\' permission')
  if (!UUID_RE.test(String(input.id ?? ''))) throw ServiceError.validation('id: a UUID from apps_search')
  const db = await serviceRoleClient(ctx)
  if (input.kind === 'form') {
    if (!hasPerm(ctx, 'forms.view') && !hasPerm(ctx, 'forms.edit') && !hasPerm(ctx, 'forms.submit')) throw ServiceError.forbidden('Forbidden: you lack the \'forms.view\' permission')
    const { data, error } = await (db as any).from('forms').select('id, name, fields, layout').eq('tenant_id', ctx.tenantId).eq('id', input.id).maybeSingle()
    if (error) throw dbError(error)
    if (!data) throw ServiceError.notFound('Form not found')
    const fields = (Array.isArray(data.fields) ? data.fields : []).slice(0, 200).map((f: any) => ({ key: f?.key, label: f?.label, type: f?.type, required: f?.required === true || undefined, options: Array.isArray(f?.options) ? f.options.slice(0, 20).map((o: any) => (typeof o === 'object' ? o?.value ?? o?.label : o)) : undefined }))
    const params = layoutFormParams(data.layout).map((p) => ({ name: p.name, label: p.label, type: p.type, required: p.required === true || undefined, default: p.default }))
    return { kind: 'form', id: data.id, name: data.name, fields, params, note: params.length ? 'Pass parameters with params { <name>: { from: "static" | "filter" | "system" | "event" | "variable" | "param", … } } on the button, menu entry, tab or form widget.' : 'This form declares no parameters.' }
  }
  if (input.kind === 'table') {
    if (!hasPerm(ctx, 'data.view')) throw ServiceError.forbidden('Forbidden: you lack the \'data.view\' permission')
    const { data, error } = await (db as any).from('custom_tables').select('id, name, columns, views').eq('tenant_id', ctx.tenantId).eq('id', input.id).maybeSingle()
    if (error) throw dbError(error)
    if (!data) throw ServiceError.notFound('Data table not found')
    return {
      kind: 'table', id: data.id, name: data.name,
      columns: (Array.isArray(data.columns) ? data.columns : []).map((c: any) => ({ key: c?.key, name: c?.name, type: c?.type ?? 'text', options: Array.isArray(c?.options) ? c.options.slice(0, 20) : undefined })),
      views: (Array.isArray(data.views) ? data.views : []).filter((v: any) => v?.id).map((v: any) => ({ id: v.id, name: v.name })),
    }
  }
  if (!hasPerm(ctx, 'workflows.view')) throw ServiceError.forbidden('Forbidden: you lack the \'workflows.view\' permission')
  const { data, error } = await (db as any).from('workflows').select('id, name, trigger_type, trigger_config, is_active').eq('tenant_id', ctx.tenantId).eq('id', input.id).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workflow not found')
  const formId = data.trigger_config?.form_id ?? null
  return {
    kind: 'workflow', id: data.id, name: data.name, trigger_type: data.trigger_type, active: data.is_active === true, start_form_id: formId,
    note: data.trigger_type === 'form_submitted' && formId ? 'Started by submitting its form: a "New …" button should open that form (new_submission with start_form_id), not start_workflow.' : 'start_workflow buttons start it directly (manual / webhook triggers).',
  }
}

/* ── Reference (for the Agent and MCP clients) ───────────────────────── */

/** The spec format, design guide, templates, a one-line widget catalogue and an example (static). */
export function appSpecReference(widgetTypes: readonly string[] = []): Record<string, unknown> {
  const schemas: Record<string, unknown> = {}
  for (const t of widgetTypes.slice(0, 20)) {
    if (!isWidgetType(t)) { schemas[t] = { error: `Unknown widget type "${t}"` }; continue }
    try { schemas[t] = z.toJSONSchema(WIDGET_CONFIG_SCHEMAS[t], { io: 'input', unrepresentable: 'any' }) } catch { schemas[t] = null }
  }
  return {
    guide: APP_DESIGN_GUIDE,
    spec_schema: appSpecJsonSchema(),
    widgets: WIDGET_CATALOG.map((e) => `${e.type} (${e.group}, ${e.w}×${e.h}): ${e.description}`),
    icons: { builtin: BUILTIN_ICON_NAMES, note: 'Every icon (app, page, button, tile, tab, menu entry, metric) must be one of these names, or an uploaded icon (svg:<id>) — anything else is rejected.' },
    templates: PAGE_TEMPLATES.map((t) => ({ id: t.id, title: t.title, description: t.description, filters: t.filters.map((f) => f.id), widgets: t.layout.widgets.map((w) => w.type) })),
    ...(widgetTypes.length ? { widget_config_schemas: schemas } : {}),
    example: APP_SPEC_EXAMPLE,
    note: 'Ids in the example are placeholders — look the real ones up with apps_search. Check with apps_plan, then apps_apply_spec.',
  }
}
