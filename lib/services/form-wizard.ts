/**
 * The form wizard's server side: one orchestration that turns a WizardSpec
 * (lib/forms/wizard/spec.ts) into ordinary, linked objects, and the reads
 * the wizard and the results page need. Shared by the wizard's server
 * actions (app/actions/form-wizard.ts), POST /api/v1/forms/wizard and the
 * MCP forms_wizard_create tool.
 *
 * Create (createWizardForm), in order, each step through the normal service
 * (validation, audit, GitHub sync):
 *   1. the responses data table (a column per question + system columns)
 *   2. the reusable form (fields, layout, rules, theme, header, Submitted page)
 *   3. the workflow ("Form submitted" → save the row → review stages),
 *      published and active
 *   4. the public link (anonymous access) when asked, Forms-menu grants for
 *      the chosen roles / teams
 *   5. one saved report on the table, every question as a column (private to the creator)
 *   6. the project row (form_wizard_projects): the spec and the manifest of
 *      what was created, so "Edit with the wizard" updates the same objects
 * A failure at any step removes what was already created (best effort, in
 * reverse) and the error is reported.
 *
 * Permissions: forms.wizard. The person needs none of the build permissions
 * the steps normally need: after the forms.wizard check (and the inputs'
 * own checks: roles / teams / people / themes of this workspace, the
 * workspace's anonymous switch), the steps run with a context that holds
 * exactly the build permissions the wizard uses, on a service-role client,
 * attributed to the person (created_by = them). That context never leaves
 * this module. Updating needs forms.wizard and being the project's owner (or
 * forms.edit). The results page: the owner, the roles / teams chosen in the
 * wizard, or forms.edit.
 */

import { formDesignerHref } from '@/lib/forms/designer-links'
import { isPlainObject } from '@/lib/utils/guards'
import {
  WizardSpecSchema, WIZARD_LIMITS, isAnswerKind,
  type WizardSpec, type WizardQuestion,
} from '@/lib/forms/wizard/spec'
import {
  STATUS, answerQuestions, assignWizardKeys, buildFormInput, buildReports, buildTableColumns, buildWorkflow,
  isQuiz, maxScore, mergeTableColumns, questionColumns, questionField, scoreOf, wizardPlan, type WizardColumn, type WizardPlanItem,
} from '@/lib/forms/wizard/build'
import { completionStats, responseTrend, surveyStats, type SurveyStat } from '@/lib/forms/survey-stats'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { getDb, hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- form_wizard_projects and the build tables are not in the generated types */

export const WIZARD_PERMISSION = 'forms.wizard'

/**
 * The build permissions the wizard's own steps use — granted only to the
 * internal context of one orchestration, never to the person.
 */
export const WIZARD_STEP_PERMISSIONS = [
  'forms.view', 'forms.edit', 'forms.delete',
  'data.view', 'data.create', 'data.edit_schema', 'data.manage_rows', 'data.delete',
  'workflows.view', 'workflows.create', 'workflows.edit', 'workflows.activate', 'workflows.delete',
  'reports.view', 'reports.create', 'reports.edit_own', 'reports.delete',
  'team.change_roles',
] as const

const PROJECT_COLUMNS = 'id, tenant_id, owner_id, name, status, spec, manifest, draft, form_id, created_at, updated_at'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface WizardManifest {
  form_id: string
  table_id: string
  workflow_id: string | null
  report_ids: string[]
  /** Report key (lib/forms/wizard/build buildReports) → id: an update only adds the missing ones. */
  reports?: Record<string, string>
  /** Forms-menu grants the wizard made (an update removes the ones no longer chosen). */
  grant_ids?: string[]
  /** Every key the form / table used, so a removed question's key is never reused. */
  keys?: string[]
}

export interface WizardProject {
  id: string
  owner_id: string | null
  name: string
  status: 'draft' | 'created'
  spec: unknown
  manifest: Partial<WizardManifest>
  draft: unknown | null
  form_id: string | null
  created_at: string
  updated_at: string
}

export interface WizardLinks {
  form: string
  share: string
  public: string | null
  results: string
  edit: string
  form_designer: string
  workflow_designer: string | null
  table: string
  reports: string[]
}

export interface WizardCreateResult {
  project: WizardProject
  manifest: WizardManifest
  links: WizardLinks
  plan: WizardPlanItem[]
  warnings: string[]
}

/* ── Contexts ───────────────────────────────────────────────────────── */

/**
 * The internal context of one orchestration: the caller's identity and
 * tenant, a service-role client and the wizard's step permissions.
 */
async function stepContext(ctx: ServiceContext): Promise<ServiceContext> {
  const admin = await serviceRoleClient(ctx)
  const permissions = ctx.permissions === null ? null : new Set<string>([...ctx.permissions, ...WIZARD_STEP_PERMISSIONS])
  return { ...ctx, db: admin, supabase: admin, permissions }
}

function requireWizard(ctx: ServiceContext) {
  if (ctx.authKind === 'anonymous') throw ServiceError.forbidden('This is not available on a public form')
  requirePerm(ctx, WIZARD_PERMISSION)
}

/* ── Projects ───────────────────────────────────────────────────────── */

function present(row: any): WizardProject {
  return {
    id: String(row.id),
    owner_id: row.owner_id ?? null,
    name: String(row.name ?? ''),
    status: row.status === 'created' ? 'created' : 'draft',
    spec: row.spec ?? {},
    manifest: isPlainObject(row.manifest) ? row.manifest as Partial<WizardManifest> : {},
    draft: row.draft ?? null,
    form_id: row.form_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function loadProject(db: AnySupabaseClient, tenantId: string, id: string): Promise<WizardProject> {
  if (!UUID_RE.test(String(id ?? ''))) throw ServiceError.notFound('Wizard form not found')
  const { data, error } = await (db as any).from('form_wizard_projects').select(PROJECT_COLUMNS).eq('tenant_id', tenantId).eq('id', id).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Wizard form not found')
  return present(data)
}

/** Owner, or forms.edit (designers may update any wizard form of the workspace). */
function canManage(ctx: ServiceContext, project: WizardProject): boolean {
  return (ctx.actorId !== null && project.owner_id === ctx.actorId) || hasPerm(ctx, 'forms.edit')
}

/** The signed-in person's wizard forms and drafts, newest first. */
export async function listWizardProjects(ctx: ServiceContext): Promise<WizardProject[]> {
  requireWizard(ctx)
  const db = await serviceRoleClient(ctx)
  let query = (db as any).from('form_wizard_projects').select(PROJECT_COLUMNS).eq('tenant_id', ctx.tenantId).order('updated_at', { ascending: false }).limit(200)
  query = ctx.actorId ? query.eq('owner_id', ctx.actorId) : query.is('owner_id', null)
  const { data, error } = await query
  if (error) throw dbError(error)
  return ((data ?? []) as any[]).map(present)
}

/** One wizard form (to resume or edit): its owner, or forms.edit. */
export async function getWizardProject(ctx: ServiceContext, id: string): Promise<WizardProject & { links: WizardLinks | null }> {
  requireWizard(ctx)
  const db = await serviceRoleClient(ctx)
  const project = await loadProject(db, ctx.tenantId, id)
  if (!canManage(ctx, project)) throw ServiceError.notFound('Wizard form not found')
  const links = project.status === 'created' && project.manifest.form_id ? await linksFor(db, ctx.tenantId, project.id, project.manifest as WizardManifest) : null
  return { ...project, links }
}

/** Bound what a draft may hold (it is not validated: people save half-finished work). */
function boundedDraft(input: unknown): Record<string, unknown> {
  if (!isPlainObject(input)) throw ServiceError.validation('The draft must be an object')
  const text = JSON.stringify(input)
  if (text.length > 200_000) throw ServiceError.validation('The draft is too large')
  return JSON.parse(text)
}

/**
 * Autosave the wizard's working copy (resumable). Without an id a draft
 * project is made; with one, the project's draft is replaced (a created
 * form's objects don't change until it is saved again).
 */
export async function saveWizardDraft(ctx: ServiceContext, input: { id?: string | null; draft: unknown }): Promise<WizardProject> {
  requireWizard(ctx)
  const draft = boundedDraft(input.draft)
  const name = String((draft as any).name ?? '').trim().slice(0, WIZARD_LIMITS.name) || 'Untitled form'
  const db = await serviceRoleClient(ctx)
  if (input.id) {
    const project = await loadProject(db, ctx.tenantId, input.id)
    if (!canManage(ctx, project)) throw ServiceError.notFound('Wizard form not found')
    const update: Record<string, unknown> = { draft }
    if (project.status === 'draft') { update.name = name; update.spec = draft }
    const { data, error } = await (db as any).from('form_wizard_projects').update(update).eq('tenant_id', ctx.tenantId).eq('id', project.id).select(PROJECT_COLUMNS).single()
    if (error || !data) throw dbError(error, 'Could not save the draft')
    return present(data)
  }
  const { count } = await (db as any).from('form_wizard_projects').select('id', { count: 'exact', head: true }).eq('tenant_id', ctx.tenantId).eq('owner_id', ctx.actorId).eq('status', 'draft')
  if ((count ?? 0) >= 50) throw ServiceError.conflict('You have 50 unfinished wizard drafts: finish or discard some first')
  const { data, error } = await (db as any).from('form_wizard_projects').insert({
    tenant_id: ctx.tenantId, owner_id: ctx.actorId, name, status: 'draft', spec: draft, draft,
  }).select(PROJECT_COLUMNS).single()
  if (error || !data) throw dbError(error, 'Could not save the draft')
  return present(data)
}

/** Discard a draft: an unfinished project is deleted, a created one only loses its working copy. */
export async function discardWizardDraft(ctx: ServiceContext, id: string): Promise<{ deleted: boolean; id: string }> {
  requireWizard(ctx)
  const db = await serviceRoleClient(ctx)
  const project = await loadProject(db, ctx.tenantId, id)
  if (!canManage(ctx, project)) throw ServiceError.notFound('Wizard form not found')
  if (project.status === 'draft') {
    const { error } = await (db as any).from('form_wizard_projects').delete().eq('tenant_id', ctx.tenantId).eq('id', id)
    if (error) throw dbError(error)
    return { deleted: true, id }
  }
  const { error } = await (db as any).from('form_wizard_projects').update({ draft: null }).eq('tenant_id', ctx.tenantId).eq('id', id)
  if (error) throw dbError(error)
  return { deleted: false, id }
}

/* ── Options (what the wizard offers this person) ───────────────────── */

export interface WizardOptions {
  /** The workspace allows public form links (step 4). */
  anonymous_enabled: boolean
  /** An AI provider is configured: "Describe it and we'll draft it" (step 1). */
  ai_available: boolean
  /** An Entra ID connection: AAD group approvers (step 5). */
  entra_groups: boolean
  themes: Array<{ id: string; name: string }>
  roles: Array<{ id: string; name: string }>
  teams: Array<{ id: string; name: string }>
  /** People of the workspace (approver pickers): active members. */
  people: Array<{ id: string; name: string; email: string | null }>
  /** Which designers the person can open afterwards ("Open in designer" links). */
  designers: { form: boolean; workflow: boolean; table: boolean; reports: boolean }
}

export async function getWizardOptions(ctx: ServiceContext): Promise<WizardOptions> {
  requireWizard(ctx)
  const db = await serviceRoleClient(ctx)
  const [{ getAnonymousWorkspaceSettings }, provider, entra, themes, roles, teams] = await Promise.all([
    import('./anonymous-forms'),
    findAiProvider(db, ctx.tenantId).catch(() => null),
    import('@/lib/directory-sync/entra-groups').then((m) => m.entraGroupCapabilities(db as any, ctx.tenantId)).catch(() => ({ entraGroups: false })),
    (db as any).from('form_themes').select('id, name').eq('tenant_id', ctx.tenantId).order('name').limit(200),
    (db as any).from('roles').select('id, name').eq('tenant_id', ctx.tenantId).order('name').limit(200),
    (db as any).from('teams').select('id, name').eq('tenant_id', ctx.tenantId).order('name').limit(500),
  ])
  const { data: memberRows } = await (db as any).from('user_memberships').select('user_id').eq('tenant_id', ctx.tenantId).eq('is_active', true).limit(2000)
  const memberIds = [...new Set(((memberRows ?? []) as any[]).map((m) => String(m.user_id)))]
  const { data: users } = memberIds.length
    ? await (db as any).from('users').select('id, display_name, email').in('id', memberIds).is('deleted_at', null)
    : { data: [] }
  const anonymous = await getAnonymousWorkspaceSettings(ctx).catch(() => ({ enabled: false }))
  return {
    anonymous_enabled: Boolean(anonymous.enabled),
    ai_available: Boolean(provider),
    entra_groups: Boolean((entra as any)?.entraGroups),
    themes: (themes.data ?? []).map((t: any) => ({ id: String(t.id), name: String(t.name) })),
    roles: (roles.data ?? []).map((r: any) => ({ id: String(r.id), name: String(r.name) })),
    teams: (teams.data ?? []).map((t: any) => ({ id: String(t.id), name: String(t.name) })),
    people: ((users ?? []) as any[]).map((u) => ({ id: String(u.id), name: String(u.display_name || u.email || u.id), email: u.email ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    designers: { form: hasPerm(ctx, 'forms.view'), workflow: hasPerm(ctx, 'workflows.view'), table: hasPerm(ctx, 'data.view'), reports: hasPerm(ctx, 'reports.view') },
  }
}

/* ── Validation against the workspace ───────────────────────────────── */

export function parseSpec(input: unknown): WizardSpec {
  const parsed = WizardSpecSchema.safeParse(input)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}`)
    throw ServiceError.validation(`The form is not ready: ${problems.slice(0, 5).join('; ')}`, { problems })
  }
  return parsed.data
}

async function idsIn(db: AnySupabaseClient, table: string, tenantId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const { data, error } = await (db as any).from(table).select('id').eq('tenant_id', tenantId).in('id', ids)
  if (error) throw dbError(error)
  return new Set(((data ?? []) as any[]).map((r) => String(r.id)))
}

/** People in the workspace (members, or whose home workspace it is). */
async function membersIn(db: AnySupabaseClient, tenantId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const [{ data: m }, { data: u }] = await Promise.all([
    (db as any).from('user_memberships').select('user_id').eq('tenant_id', tenantId).eq('is_active', true).in('user_id', ids),
    (db as any).from('users').select('id').eq('tenant_id', tenantId).in('id', ids),
  ])
  return new Set([...((m ?? []) as any[]).map((r) => String(r.user_id)), ...((u ?? []) as any[]).map((r) => String(r.id))])
}

/** Everything the spec points at belongs to this workspace, and what it turns on is allowed here. */
async function checkReferences(ctx: ServiceContext, db: AnySupabaseClient, spec: WizardSpec): Promise<void> {
  const roleIds = [...new Set([...spec.audience.role_ids, ...spec.results.role_ids])]
  const teamIds = [...new Set([...spec.audience.team_ids, ...spec.results.team_ids, ...spec.approval.stages.flatMap((s) => (s.assignee.kind === 'team' ? [s.assignee.team_id] : []))])]
  const userIds = [...new Set(spec.approval.stages.flatMap((s) => (s.assignee.kind === 'person' ? [s.assignee.user_id] : s.assignee.kind === 'manager' ? [s.assignee.fallback_user_id] : [])))]
  const [roles, teams, users] = await Promise.all([idsIn(db, 'roles', ctx.tenantId, roleIds), idsIn(db, 'teams', ctx.tenantId, teamIds), membersIn(db, ctx.tenantId, userIds)])
  const missing = [
    ...roleIds.filter((id) => !roles.has(id)).map(() => 'a role'),
    ...teamIds.filter((id) => !teams.has(id)).map(() => 'a team'),
    ...userIds.filter((id) => !users.has(id)).map(() => 'a person'),
  ]
  if (missing.length) throw ServiceError.validation(`The form names ${[...new Set(missing)].join(', ')} that is not in this workspace`)
  if (spec.look.theme.kind === 'saved' && !(await idsIn(db, 'form_themes', ctx.tenantId, [spec.look.theme.theme_id])).size) throw ServiceError.validation('The chosen form theme is not in this workspace')
  if (spec.audience.internal && spec.audience.who === 'selected' && !spec.audience.role_ids.length && !spec.audience.team_ids.length) {
    throw ServiceError.validation('Choose at least one role or team who fills it in, or choose everyone')
  }
  if (spec.audience.public_link) {
    const { getAnonymousWorkspaceSettings } = await import('./anonymous-forms')
    if (!(await getAnonymousWorkspaceSettings(ctx)).enabled) throw ServiceError.validation('Public links are turned off for this workspace: an admin can allow anonymous forms in Settings → Forms')
  }
  if (spec.approval.stages.some((s) => s.assignee.kind === 'group')) {
    const { entraGroupCapabilities } = await import('@/lib/directory-sync/entra-groups')
    if (!(await entraGroupCapabilities(db as any, ctx.tenantId)).entraGroups) throw ServiceError.validation('Entra ID groups are not available: this workspace has no Entra ID connection')
  }
}

/* ── Links ───────────────────────────────────────────────────────────── */

async function linksFor(db: AnySupabaseClient, tenantId: string, projectId: string, manifest: WizardManifest): Promise<WizardLinks> {
  const { data: access } = await (db as any).from('form_anonymous_access').select('token, enabled').eq('tenant_id', tenantId).eq('form_id', manifest.form_id).maybeSingle()
  return {
    form: `/fill/${manifest.form_id}`,
    share: `/f/${manifest.form_id}`,
    public: access?.enabled && access?.token ? `/p/${access.token}` : null,
    results: `/forms/results/${projectId}`,
    edit: `/forms/wizard/${projectId}`,
    form_designer: formDesignerHref(manifest.form_id),
    workflow_designer: manifest.workflow_id ? `/automations/${manifest.workflow_id}` : null,
    table: `/data/${manifest.table_id}`,
    reports: (manifest.report_ids ?? []).map((id) => `/reports/${id}`),
  }
}

/* ── Create ─────────────────────────────────────────────────────────── */

/** Undo steps, run in reverse on failure. */
type Undo = { label: string; run: () => Promise<unknown> }

async function rollback(undo: Undo[]): Promise<string[]> {
  const failed: string[] = []
  for (const step of [...undo].reverse()) {
    try { await step.run() } catch (error) {
      failed.push(step.label)
      console.warn(`[form-wizard] rollback of ${step.label} failed:`, error instanceof Error ? error.message : error)
    }
  }
  return failed
}

/** Dependencies, swappable in tests. */
export const wizardDeps = {
  forms: () => import('./forms'),
  dataTables: () => import('./data-tables'),
  workflows: () => import('./workflows'),
  reports: () => import('./reports'),
  anonymous: () => import('./anonymous-forms'),
  grants: () => import('./object-permissions'),
}

/** Hard-delete a workflow the wizard just made (versions cascade): a queued delete would leave it using the form. */
async function removeWorkflow(db: AnySupabaseClient, tenantId: string, id: string) {
  const { error } = await (db as any).from('workflows').delete().eq('tenant_id', tenantId).eq('id', id)
  if (error) throw dbError(error)
}

async function removeTable(db: AnySupabaseClient, tenantId: string, id: string) {
  await (db as any).from('custom_table_rows').delete().eq('tenant_id', tenantId).eq('table_id', id)
  const { error } = await (db as any).from('custom_tables').delete().eq('tenant_id', tenantId).eq('id', id)
  if (error) throw dbError(error)
}

async function removeReports(db: AnySupabaseClient, tenantId: string, ids: string[]) {
  if (!ids.length) return
  const { error } = await (db as any).from('reports').delete().eq('tenant_id', tenantId).in('id', ids)
  if (error) throw dbError(error)
}

/** Forms-menu grants: the chosen roles / teams, or every role that can submit forms ("everyone"). */
async function grantTargets(db: AnySupabaseClient, tenantId: string, spec: WizardSpec): Promise<Array<{ role_id?: string; team_id?: string }>> {
  if (!spec.audience.internal || !spec.audience.show_in_menu) return []
  if (spec.audience.who === 'selected') return [...spec.audience.role_ids.map((role_id) => ({ role_id })), ...spec.audience.team_ids.map((team_id) => ({ team_id }))]
  const { data } = await (db as any).from('roles').select('id, permissions').eq('tenant_id', tenantId)
  return ((data ?? []) as any[]).filter((r) => Array.isArray(r.permissions) && r.permissions.includes('forms.submit')).map((r) => ({ role_id: String(r.id) }))
}

async function applyGrants(step: ServiceContext, formId: string, spec: WizardSpec, undo?: Undo[]): Promise<string[]> {
  const { setObjectPermission } = await wizardDeps.grants()
  const ids: string[] = []
  for (const target of await grantTargets(getDb(step), step.tenantId, spec)) {
    const grant = await setObjectPermission(step, { object_type: 'form', object_id: formId, ...target, can_view: true, can_execute: true })
    ids.push(String(grant.id))
  }
  if (undo && ids.length) undo.push({ label: 'grants', run: () => (getDb(step) as any).from('object_permissions').delete().eq('tenant_id', step.tenantId).in('id', ids) })
  return ids
}

async function createReports(step: ServiceContext, spec: WizardSpec, tableId: string, existing: Record<string, string> = {}): Promise<Record<string, string>> {
  const { importReport } = await wizardDeps.reports()
  const out: Record<string, string> = { ...existing }
  for (const report of buildReports(spec, tableId)) {
    if (out[report.key]) {
      // Edit with the wizard: the form's report follows its questions (new
      // columns appear). Reports made by earlier versions (one per question)
      // are left as they are.
      await (getDb(step) as any).from('reports').update({ config: report.config, description: report.description })
        .eq('id', out[report.key]).eq('tenant_id', step.tenantId)
      continue
    }
    const row = await importReport(step, { payload: { name: report.name, description: report.description, category: report.category, is_shared: false, config: report.config } })
    out[report.key] = String(row.id)
  }
  return out
}

/**
 * Create everything the spec describes (see the module comment). `projectId`
 * = the person's draft project to turn into the created one.
 */
export async function createWizardForm(ctx: ServiceContext, input: unknown, options: { projectId?: string | null } = {}): Promise<WizardCreateResult> {
  requireWizard(ctx)
  const spec = assignWizardKeys(parseSpec(input))
  const step = await stepContext(ctx)
  const db = getDb(step)
  await checkReferences(ctx, db, spec)
  let draftProject: WizardProject | null = null
  if (options.projectId) {
    draftProject = await loadProject(db, ctx.tenantId, options.projectId)
    if (!canManage(ctx, draftProject)) throw ServiceError.notFound('Wizard form not found')
    if (draftProject.status === 'created') throw ServiceError.conflict('This form was already created: save your changes to update it')
  }

  const undo: Undo[] = []
  const warnings: string[] = []
  const { forms, dataTables, workflows, anonymous } = { forms: await wizardDeps.forms(), dataTables: await wizardDeps.dataTables(), workflows: await wizardDeps.workflows(), anonymous: await wizardDeps.anonymous() }
  try {
    // 1. The responses table.
    const tableName = `${spec.name} responses`.slice(0, 120)
    const columns = buildTableColumns(spec)
    const table = await dataTables.createDataTable(step, { name: tableName, description: `Responses to the form "${spec.name}" (made by the form wizard).`, columns: columns as any })
    undo.push({ label: 'data table', run: () => removeTable(db, ctx.tenantId, table.id) })

    // 2. The form.
    const form = await forms.createForm(step, buildFormInput(spec))
    undo.push({ label: 'form', run: () => forms.deleteForm(step, form.id) })

    // 3. The workflow, published (active).
    const wf = buildWorkflow(spec, { formId: form.id, formName: form.name, tableId: table.id, tableName: table.name })
    const created = await workflows.createWorkflow(step, { ...wf, tags: ['wizard'], publish: true, publish_notes: 'Made by the form wizard' })
    undo.push({ label: 'workflow', run: () => removeWorkflow(db, ctx.tenantId, created.workflow_id) })

    // 4. Who fills it in.
    if (spec.audience.public_link) {
      await anonymous.setFormAnonymousAccess(step, form.id, { enabled: true })
      undo.push({ label: 'public link', run: () => (db as any).from('form_anonymous_access').delete().eq('tenant_id', ctx.tenantId).eq('form_id', form.id) })
    }
    const grantIds = await applyGrants(step, form.id, spec, undo)

    // 5. Saved reports.
    const reports = await createReports(step, spec, table.id)
    undo.push({ label: 'reports', run: () => removeReports(db, ctx.tenantId, Object.values(reports)) })

    // 6. The project.
    const manifest: WizardManifest = {
      form_id: form.id, table_id: table.id, workflow_id: created.workflow_id,
      report_ids: Object.values(reports), reports, grant_ids: grantIds,
      keys: spec.questions.map((q) => q.key!).filter(Boolean),
    }
    const row = { tenant_id: ctx.tenantId, owner_id: ctx.actorId, name: spec.name, status: 'created', spec, manifest, draft: null, form_id: form.id }
    const write = draftProject
      ? (db as any).from('form_wizard_projects').update(row).eq('tenant_id', ctx.tenantId).eq('id', draftProject.id)
      : (db as any).from('form_wizard_projects').insert(row)
    const { data: saved, error } = await write.select(PROJECT_COLUMNS).single()
    if (error || !saved) throw dbError(error, 'Could not save the wizard form')
    const project = present(saved)
    await audit(step, {
      objectType: 'form', objectId: form.id, action: 'create',
      summary: `Created form "${spec.name}" with the form wizard (data table, workflow${reports ? ', reports' : ''})`,
      metadata: { wizard_project_id: project.id, table_id: table.id, workflow_id: created.workflow_id, approval: spec.approval.mode, questions: answerQuestions(spec).length },
    })
    return { project, manifest, links: await linksFor(db, ctx.tenantId, project.id, manifest), plan: wizardPlan(spec), warnings }
  } catch (error) {
    const failed = await rollback(undo)
    const message = error instanceof Error ? error.message : String(error)
    const detail = failed.length ? ` Some parts could not be removed (${failed.join(', ')}): an admin can delete them.` : ' Nothing was kept.'
    if (error instanceof ServiceError) throw new ServiceError(error.code, `Could not create the form: ${message}.${detail}`, { details: error.details })
    throw new ServiceError('internal', `Could not create the form: ${message}.${detail}`)
  }
}

/* ── Update ("Edit with the wizard") ────────────────────────────────── */

/**
 * Apply an edited spec to the objects the project created: new questions
 * get new columns (existing columns and their data are never removed or
 * retyped), the form gets a new version, the workflow is rebuilt and
 * published again, new chart questions get reports, the public link and
 * Forms-menu grants follow the choices. Keys of existing questions are kept.
 */
export async function updateWizardForm(ctx: ServiceContext, projectId: string, input: unknown): Promise<WizardCreateResult> {
  requireWizard(ctx)
  const step = await stepContext(ctx)
  const db = getDb(step)
  const project = await loadProject(db, ctx.tenantId, projectId)
  if (!canManage(ctx, project)) throw ServiceError.notFound('Wizard form not found')
  if (project.status !== 'created' || !project.manifest.form_id || !project.manifest.table_id) throw ServiceError.conflict('This form has not been created yet')
  const manifest = project.manifest as WizardManifest

  // Keep every question's key: by id from the stored spec, then whatever the caller sent.
  const raw = parseSpec(input)
  const stored = WizardSpecSchema.safeParse(project.spec)
  const keyById = new Map<string, string>(stored.success ? stored.data.questions.filter((q) => q.key).map((q) => [q.id, q.key!]) : [])
  const withKeys: WizardSpec = { ...raw, questions: raw.questions.map((q) => (keyById.has(q.id) ? { ...q, key: keyById.get(q.id) } : q)) }
  const { forms, dataTables, workflows, anonymous } = { forms: await wizardDeps.forms(), dataTables: await wizardDeps.dataTables(), workflows: await wizardDeps.workflows(), anonymous: await wizardDeps.anonymous() }
  const table = await dataTables.getDataTable(step, manifest.table_id).catch(() => null)
  if (!table) throw ServiceError.conflict('The responses data table of this form was deleted, so the wizard cannot update it')
  const existingColumns: WizardColumn[] = (Array.isArray(table.columns) ? table.columns : [])
    .filter((c: any) => c?.key && !['id', 'date_created'].includes(String(c.key)))
    .map((c: any) => ({ key: String(c.key), name: String(c.name ?? c.key), type: String(c.type ?? 'text'), ...(Array.isArray(c.options) ? { options: c.options.map(String) } : {}) }))
  const taken = new Set<string>([...(manifest.keys ?? []), ...existingColumns.map((c) => c.key)])
  // A new question whose key the caller made up must not take an old column's key.
  const fresh = withKeys.questions.map((q) => (q.key && !keyById.has(q.id) && taken.has(q.key) ? { ...q, key: undefined } : q))
  const spec = assignWizardKeys({ ...withKeys, questions: fresh }, taken)
  // A kept key on a question of another kind would retype its column: refused.
  for (const q of answerQuestions(spec)) {
    const col = existingColumns.find((c) => c.key === q.key)
    const want = buildTableColumns(spec).find((c) => c.key === q.key)
    if (col && want && col.type !== want.type && stored.success && stored.data.questions.find((s) => s.id === q.id)?.kind !== q.kind) {
      throw ServiceError.validation(`"${q.label}" changed kind, which would change the type of its column: add it as a new question instead`)
    }
  }
  await checkReferences(ctx, db, spec)

  const warnings: string[] = []
  // 1. Columns: merged, never dropped.
  const merged = mergeTableColumns(existingColumns, buildTableColumns(spec))
  await dataTables.updateDataTable(step, manifest.table_id, { columns: merged as any })
  // 2. The form: a new version.
  const formInput = buildFormInput(spec)
  const form = await forms.updateForm(step, manifest.form_id, formInput as any)
  // 3. The workflow: rebuilt and published (recreated if it was deleted).
  const wf = buildWorkflow(spec, { formId: manifest.form_id, formName: form.name, tableId: manifest.table_id, tableName: table.name })
  let workflowId = manifest.workflow_id
  const exists = workflowId ? (await (db as any).from('workflows').select('id').eq('tenant_id', ctx.tenantId).eq('id', workflowId).maybeSingle()).data : null
  if (exists) {
    await workflows.updateWorkflow(step, workflowId!, { name: wf.name, description: wf.description, nodes: wf.nodes as any, edges: wf.edges as any, publish: true, publish_notes: 'Updated by the form wizard' } as any)
  } else {
    const created = await workflows.createWorkflow(step, { ...wf, tags: ['wizard'], publish: true, publish_notes: 'Made by the form wizard' } as any)
    workflowId = created.workflow_id
    warnings.push('The workflow had been deleted: a new one was made')
  }
  // 4. Public link and Forms-menu grants.
  const access = await (db as any).from('form_anonymous_access').select('enabled').eq('tenant_id', ctx.tenantId).eq('form_id', manifest.form_id).maybeSingle()
  if (spec.audience.public_link !== Boolean(access.data?.enabled)) await anonymous.setFormAnonymousAccess(step, manifest.form_id, { enabled: spec.audience.public_link })
  if (manifest.grant_ids?.length) await (db as any).from('object_permissions').delete().eq('tenant_id', ctx.tenantId).eq('object_type', 'form').eq('object_id', manifest.form_id).in('id', manifest.grant_ids)
  const grantIds = await applyGrants(step, manifest.form_id, spec)
  // 5. Reports for new chart questions.
  const reports = await createReports(step, spec, manifest.table_id, manifest.reports ?? {})

  const next: WizardManifest = {
    ...manifest, workflow_id: workflowId, reports, report_ids: [...new Set([...(manifest.report_ids ?? []), ...Object.values(reports)])], grant_ids: grantIds,
    keys: [...new Set([...taken, ...spec.questions.map((q) => q.key!).filter(Boolean)])],
  }
  const { data: saved, error } = await (db as any).from('form_wizard_projects')
    .update({ name: spec.name, spec, manifest: next, draft: null }).eq('tenant_id', ctx.tenantId).eq('id', project.id).select(PROJECT_COLUMNS).single()
  if (error || !saved) throw dbError(error, 'Could not save the wizard form')
  await audit(step, {
    objectType: 'form', objectId: manifest.form_id, action: 'update',
    summary: `Updated form "${spec.name}" with the form wizard`,
    metadata: { wizard_project_id: project.id, columns: merged.length, approval: spec.approval.mode },
  })
  return { project: present(saved), manifest: next, links: await linksFor(db, ctx.tenantId, project.id, next), plan: wizardPlan(spec), warnings }
}

/** What Create would make (no writes): the review step and the API's dry run. */
export function planWizardForm(ctx: ServiceContext, input: unknown): { plan: WizardPlanItem[]; spec: WizardSpec } {
  requireWizard(ctx)
  const spec = assignWizardKeys(parseSpec(input))
  return { plan: wizardPlan(spec), spec }
}

/* ── Results page ───────────────────────────────────────────────────── */

export interface WizardResultsQuery {
  search?: string
  status?: string
  sort?: 'newest' | 'oldest'
  page?: number
  page_size?: number
}

/**
 * A chart per question on the results page: the survey summary of the
 * question's type (lib/forms/survey-stats.ts — rating average and
 * distribution, NPS, agreement shares, grid rows, slider histogram,
 * CSAT %, ranking positions, choice counts, number averages).
 */
export type WizardChart = SurveyStat
export interface WizardResults {
  project: { id: string; name: string; description: string | null; owner_id: string | null }
  approval: boolean
  quiz: { max: number } | null
  summary: {
    total: number
    this_week: number
    last_week: number
    pending: number
    approved: number
    declined: number
    changes: number
    /** Approved ÷ decided (approved + declined + changes), %. */
    approval_rate: number | null
    average_score: number | null
  }
  charts: WizardChart[]
  /** Responses per day, the last 30 days. */
  trend: Array<{ date: string; count: number }>
  /** Answered count and share per question. */
  completion: Array<{ key: string; label: string; answered: number; share: number }>
  columns: Array<{ key: string; label: string; kind: string }>
  rows: Array<{ id: string; created_at: string; values: Record<string, unknown> }>
  total: number
  page: number
  page_size: number
  statuses: string[]
  links: WizardLinks | null
  can_edit: boolean
}

async function viewerCanSeeResults(ctx: ServiceContext, db: AnySupabaseClient, project: WizardProject, spec: WizardSpec | null): Promise<boolean> {
  if (canManage(ctx, project)) return true
  if (!ctx.actorId || !spec) return false
  const roleIds = spec.results.role_ids
  const teamIds = spec.results.team_ids
  if (roleIds.length) {
    const { data } = await (db as any).from('user_roles').select('role_id').eq('tenant_id', ctx.tenantId).eq('user_id', ctx.actorId).in('role_id', roleIds).limit(1)
    if (data?.length) return true
  }
  if (teamIds.length) {
    const { data } = await (db as any).from('user_teams').select('team_id').eq('user_id', ctx.actorId).in('team_id', teamIds).limit(1)
    if (data?.length) return true
  }
  return false
}

const MAX_RESULT_ROWS = 5000

function asText(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(asText).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** The answer questions as form fields (their type, options and scale), for aggregation. */
function answerFields(spec: WizardSpec): TaskFieldDef[] {
  return answerQuestions(spec).filter((q) => q.key).map(questionField).filter((f): f is TaskFieldDef => f !== null)
}

/** Charts per question from the stored rows (pure: the results page, tests): aggregated here, so only the numbers reach the browser. */
export function wizardCharts(spec: WizardSpec, rows: Array<Record<string, unknown>>): WizardChart[] {
  return surveyStats(answerFields(spec), rows)
}

/** Summary cards (pure). */
export function wizardSummary(spec: WizardSpec, rows: Array<{ created_at: string; values: Record<string, unknown> }>, now = Date.now()): WizardResults['summary'] {
  const day = 86_400_000
  const status = (s: string) => rows.filter((r) => r.values.status === s).length
  const approved = status(STATUS.approved)
  const declined = status(STATUS.declined)
  const changes = status(STATUS.changes)
  const decided = approved + declined + changes
  const scores = isQuiz(spec) ? rows.map((r) => (typeof r.values.score === 'number' ? r.values.score : scoreOf(spec, r.values))).filter((n): n is number => typeof n === 'number' && Number.isFinite(n)) : []
  return {
    total: rows.length,
    this_week: rows.filter((r) => now - Date.parse(r.created_at) < 7 * day).length,
    last_week: rows.filter((r) => { const age = now - Date.parse(r.created_at); return age >= 7 * day && age < 14 * day }).length,
    pending: status(STATUS.pending),
    approved, declined, changes,
    approval_rate: decided ? Math.round((approved / decided) * 100) : null,
    average_score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
  }
}

/** The results page: summary cards, charts and one page of responses (search, status filter, order). */
export async function getWizardResults(ctx: ServiceContext, projectId: string, query: WizardResultsQuery = {}): Promise<WizardResults> {
  if (ctx.authKind === 'anonymous') throw ServiceError.forbidden('This is not available on a public form')
  const db = await serviceRoleClient(ctx)
  const project = await loadProject(db, ctx.tenantId, projectId)
  const parsed = WizardSpecSchema.safeParse(project.spec)
  const spec = parsed.success ? parsed.data : null
  if (!(await viewerCanSeeResults(ctx, db, project, spec))) throw ServiceError.notFound('Results not found')
  if (project.status !== 'created' || !spec || !project.manifest.table_id) throw ServiceError.conflict('This form has not been created yet')
  const manifest = project.manifest as WizardManifest
  const { data, error } = await (db as any).from('custom_table_rows').select('id, data, created_at')
    .eq('tenant_id', ctx.tenantId).eq('table_id', manifest.table_id).order('created_at', { ascending: false }).limit(MAX_RESULT_ROWS)
  if (error) throw dbError(error)
  const all = ((data ?? []) as any[]).map((r) => ({ id: String(r.id), created_at: String(r.created_at), values: isPlainObject(r.data) ? r.data as Record<string, unknown> : {} }))
  for (const r of all) if (isQuiz(spec) && typeof r.values.score !== 'number') r.values = { ...r.values, score: scoreOf(spec, r.values) }

  const search = String(query.search ?? '').trim().toLowerCase().slice(0, 200)
  let filtered = all
  if (query.status) filtered = filtered.filter((r) => r.values.status === query.status)
  if (search) filtered = filtered.filter((r) => Object.values(r.values).some((v) => asText(v).toLowerCase().includes(search)))
  if (query.sort === 'oldest') filtered = [...filtered].reverse()
  const pageSize = Math.max(5, Math.min(100, Math.floor(query.page_size ?? 25)))
  const page = Math.max(1, Math.floor(query.page ?? 1))
  const approval = spec.approval.mode !== 'none'
  const columns = [
    { key: 'reference', label: 'Reference', kind: 'system' },
    { key: 'submitted_at', label: 'Submitted', kind: 'system' },
    { key: 'submitted_by', label: 'By', kind: 'system' },
    ...(approval ? [{ key: 'status', label: 'Status', kind: 'system' }] : []),
    ...(spec.approval.mode === 'multi' ? [{ key: 'stage', label: 'Stage', kind: 'system' }] : []),
    ...(isQuiz(spec) ? [{ key: 'score', label: 'Score', kind: 'system' }] : []),
    // A grid of statements: a column per statement (as in the data table).
    ...answerQuestions(spec).filter((q) => q.key).flatMap((q) => questionColumns(q).map((c) => ({ key: c.key, label: c.name, kind: q.kind }))),
  ]
  return {
    project: { id: project.id, name: spec.name, description: spec.description ?? null, owner_id: project.owner_id },
    approval,
    quiz: isQuiz(spec) ? { max: maxScore(spec) } : null,
    summary: wizardSummary(spec, all),
    charts: spec.results.charts ? wizardCharts(spec, all.map((r) => r.values)) : [],
    trend: responseTrend(all.map((r) => r.created_at)),
    completion: completionStats(answerFields(spec), all.map((r) => r.values)),
    columns,
    rows: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    page_size: pageSize,
    statuses: approval ? [STATUS.pending, STATUS.approved, STATUS.declined, STATUS.changes] : [],
    links: canManage(ctx, project) ? await linksFor(db, ctx.tenantId, project.id, manifest) : null,
    can_edit: canManage(ctx, project) && hasPerm(ctx, WIZARD_PERMISSION),
  }
}

/* ── "Describe it and we'll draft it" ───────────────────────────────── */

async function findAiProvider(db: AnySupabaseClient, tenantId: string): Promise<{ id: string; type: string; config: any } | null> {
  const { data } = await (db as any).from('integrations').select('id, type, config, is_active').eq('tenant_id', tenantId).limit(200)
  const { isAiProviderIntegration } = await import('@/lib/agents/provider')
  const found = ((data ?? []) as any[]).find((i) => i.is_active !== false && isAiProviderIntegration({ type: i.type, config: i.config }))
  return found ? { id: String(found.id), type: String(found.type ?? ''), config: found.config } : null
}

const AI_KINDS = ['short_text', 'long_text', 'number', 'money', 'date', 'choice', 'choices', 'rating', 'nps', 'yes_no', 'yes_no_maybe', 'likert', 'csat', 'ranking', 'email', 'phone', 'file', 'heading']
const AI_OPTION_KINDS = ['choice', 'choices', 'likert', 'ranking']

/** The model's JSON → questions the wizard can use (anything else is dropped). */
export function questionsFromAi(text: string): WizardQuestion[] {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  let parsed: any
  try { parsed = JSON.parse(text.slice(start, end + 1)) } catch { return [] }
  const list = Array.isArray(parsed?.questions) ? parsed.questions : []
  const out: WizardQuestion[] = []
  for (const [i, raw] of list.slice(0, 40).entries()) {
    if (!isPlainObject(raw) || !AI_KINDS.includes(String(raw.kind)) || typeof raw.label !== 'string' || !raw.label.trim()) continue
    const kind = raw.kind as WizardQuestion['kind']
    const q: WizardQuestion = { id: `q_ai${i + 1}`, kind, label: raw.label.trim().slice(0, WIZARD_LIMITS.label) }
    if (typeof raw.help === 'string' && raw.help.trim()) q.help = raw.help.trim().slice(0, WIZARD_LIMITS.help)
    if (raw.required === true && isAnswerKind(kind)) q.required = true
    if (AI_OPTION_KINDS.includes(kind)) {
      const options = Array.isArray(raw.options) ? [...new Set(raw.options.filter((o: unknown) => typeof o === 'string' && o.trim()).map((o: string) => o.trim().slice(0, WIZARD_LIMITS.option)))].slice(0, WIZARD_LIMITS.options) as string[] : []
      if (options.length < (kind === 'choice' || kind === 'choices' ? 1 : 2)) continue
      q.options = options
    }
    out.push(q)
  }
  return out
}

/**
 * Propose questions from a description with the workspace's AI provider
 * (the first active AI provider integration, the one agents use). The text
 * is sent to that provider; nothing is stored.
 */
export async function draftQuestionsWithAi(ctx: ServiceContext, input: { description: string; template?: string | null }): Promise<{ questions: WizardQuestion[]; name: string | null }> {
  requireWizard(ctx)
  const description = String(input.description ?? '').trim().slice(0, WIZARD_LIMITS.aiDescription)
  if (description.length < 10) throw ServiceError.validation('Describe the form in a sentence or two')
  const db = await serviceRoleClient(ctx)
  const provider = await findAiProvider(db, ctx.tenantId)
  if (!provider) throw ServiceError.validation('No AI provider is set up in this workspace: start from a template instead')
  const [{ decryptSensitiveFields }, { resolveAgentEndpoint, chatBodyParams, DEFAULT_MODEL }, { safeFetch }] = await Promise.all([
    import('@/lib/secret-fields'), import('@/lib/agents/provider'), import('@/lib/egress-guard'),
  ])
  const integration = { type: provider.type, config: decryptSensitiveFields(provider.config) }
  const endpoint = resolveAgentEndpoint(integration)
  const model = String((integration.config as any)?.default_model ?? (integration.config as any)?.model ?? DEFAULT_MODEL[endpoint.kind] ?? 'gpt-4.1')
  const system = [
    'You design short, friendly forms for non-technical people.',
    `Reply with JSON only: {"name": string, "questions": [{"kind": one of ${AI_KINDS.join(', ')}, "label": string, "help"?: string, "required"?: boolean, "options"?: string[]}]}.`,
    'Use plain words, 3 to 12 questions, options only for choice / choices / likert (the scale, worst to best) / ranking (2 to 8 each). rating is 1 to 5 stars, csat smiley faces, nps 0 to 10. No personal data the purpose does not need.',
  ].join(' ')
  let res: Response
  try {
    res = await safeFetch(endpoint.url, {
      method: 'POST',
      headers: endpoint.headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: `Form type: ${input.template ?? 'any'}. Description: ${description}` }],
        ...chatBodyParams(endpoint.kind, model, { maxTokens: 1500, temperature: 0.3 }),
      }),
      signal: AbortSignal.timeout(45_000),
    })
  } catch (error) {
    throw ServiceError.validation(`The AI provider could not be reached (${error instanceof Error ? error.message : 'network error'}): start from a template instead`)
  }
  if (!res.ok) throw ServiceError.validation(`The AI provider answered ${res.status}: start from a template instead`)
  const body = await res.json().catch(() => null) as any
  const text = String(body?.choices?.[0]?.message?.content ?? '')
  const questions = questionsFromAi(text)
  if (!questions.length) throw ServiceError.validation('The AI provider did not suggest usable questions: try describing it differently, or start from a template')
  let name: string | null = null
  try { const n = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))?.name; if (typeof n === 'string' && n.trim()) name = n.trim().slice(0, WIZARD_LIMITS.name) } catch { /* ignore */ }
  return { questions, name }
}
