// Forward dependency closure for exports and packages: starting from root
// assets (e.g. a workflow), find everything they need to run elsewhere —
// sub-workflows, custom activities, decision tables, data tables, integration
// references (→ their integration, or the connector that generated it),
// email templates, agents (→ their tools and integration), custom roles,
// retention policies, MCP servers, linked forms (form_id → the form, and its
// saved theme via theme_id; a form's options_source table_id → the data
// table) — by walking the exported asset JSON for
// the same id keys import remaps (ID_KEY_TO_MAP).
//
// People (user / team ids) never travel; they are reported separately so a
// package can turn them into requirements. System roles never travel either;
// role ids that don't resolve to a custom role are reported as `system_roles`.

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

import { buildManifestExport } from './export'
import { ID_KEY_TO_MAP } from './id-maps'
import { isUuid, PLAN_SECTIONS } from './plan'
import { formPageOf } from '@/lib/forms/form-page'

export type DependencyAssetType =
  | 'workflow' | 'workflow_activity' | 'data_table' | 'integration' | 'connector' | 'decision_table'
  | 'email_template' | 'agent' | 'report' | 'role' | 'mcp_server' | 'retention_policy' | 'log_destination'
  | 'form' | 'form_theme'

export const DEPENDENCY_TYPES: readonly DependencyAssetType[] = [
  'workflow', 'workflow_activity', 'data_table', 'integration', 'connector', 'decision_table',
  'email_template', 'agent', 'report', 'role', 'mcp_server', 'retention_policy', 'log_destination',
  'form', 'form_theme',
]

export interface AssetRef { type: DependencyAssetType; id: string }

export interface ClosureItem extends AssetRef {
  name: string
  /** 'root' for the roots; otherwise the asset that first needed it. */
  required_by: AssetRef | 'root'
}

export interface PersonRef {
  kind: 'user' | 'team'
  id: string
  /** Asset (section + id) and JSON path where the id appears. */
  section: string
  asset_id: string
  path: Array<string | number>
}

export interface DependencyClosure {
  items: ClosureItem[]
  /** Ids referenced but not found in this workspace. */
  missing: Array<AssetRef & { required_by: AssetRef }>
  people: PersonRef[]
  /** Role ids that are not custom roles (system roles: resolved by slug on install). */
  system_roles: Array<{ id: string; slug: string | null; section: string; asset_id: string; path: Array<string | number> }>
}

/** Keys holding a person id (never exported; become package requirements). */
const USER_KEYS = new Set(['assignee_id', 'assigneeId', 'user_id', 'userId', 'assign_to_user_id', 'escalation_user_id', 'redirect_user_id'])
const TEAM_KEYS = new Set(['team_id', 'teamId', 'escalation_team_id', 'assign_to_team_id'])

const SECTION_TYPE: Record<string, DependencyAssetType | 'reference' | 'object'> = Object.fromEntries(
  PLAN_SECTIONS.map(({ section, type }) => [section, type as DependencyAssetType | 'reference' | 'object']),
)

export interface FoundRef {
  type: DependencyAssetType | 'reference'
  id: string
  path: Array<string | number>
}

/**
 * Every asset id referenced inside one exported asset (pure). Custom
 * activity keys are returned as `activity_keys`; people separately.
 */
export function scanAssetReferences(asset: unknown): { refs: FoundRef[]; activityKeys: string[]; people: Array<{ kind: 'user' | 'team'; id: string; path: Array<string | number> }> } {
  const refs: FoundRef[] = []
  const activityKeys: string[] = []
  const people: Array<{ kind: 'user' | 'team'; id: string; path: Array<string | number> }> = []
  const walk = (value: unknown, path: Array<string | number>, depth: number) => {
    if (depth > 40 || value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...path, index], depth + 1))
      return
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = [...path, key]
      const mapped = ID_KEY_TO_MAP[key] as string | undefined
      if (typeof child === 'string' && isUuid(child)) {
        if (mapped && mapped !== 'reference') refs.push({ type: mapped as DependencyAssetType, id: child, path: childPath })
        else if (mapped === 'reference') refs.push({ type: 'reference', id: child, path: childPath })
        else if (USER_KEYS.has(key)) people.push({ kind: 'user', id: child, path: childPath })
        else if (TEAM_KEYS.has(key)) people.push({ kind: 'team', id: child, path: childPath })
        continue
      }
      if (key === 'custom_activity_key' && typeof child === 'string' && child.trim()) {
        activityKeys.push(child.trim())
        continue
      }
      if (Array.isArray(child) && ['tools', 'workflow_ids', 'policy_ids'].includes(key)) {
        const type: DependencyAssetType | 'reference' = key === 'tools' ? 'reference' : key === 'workflow_ids' ? 'workflow' : 'retention_policy'
        child.forEach((id, index) => { if (isUuid(id)) refs.push({ type, id, path: [...childPath, index] }) })
        continue
      }
      walk(child, childPath, depth + 1)
    }
  }
  walk(asset, [], 0)
  return { refs, activityKeys, people }
}

const key = (ref: AssetRef) => `${ref.type}:${ref.id}`

/**
 * Resolve the closure of `roots` in a tenant. `exclude` (type:id keys) stops
 * the walk at those assets (the author removed them from a package).
 */
export async function resolveDependencyClosure(
  supabase: any,
  tenantId: string,
  roots: AssetRef[],
  options: { exclude?: ReadonlySet<string>; maxItems?: number } = {},
): Promise<DependencyClosure> {
  const maxItems = options.maxItems ?? 2000
  const items = new Map<string, ClosureItem>()
  const missing: DependencyClosure['missing'] = []
  const people: PersonRef[] = []
  const systemRoles: DependencyClosure['system_roles'] = []
  const exclude = options.exclude ?? new Set<string>()

  // Connector-generated integrations travel as their connector.
  const { data: connectorRows } = await supabase.from('tenant_connectors').select('id, integration_id').eq('tenant_id', tenantId)
  const connectorByIntegration = new Map<string, string>(((connectorRows ?? []) as any[]).filter((r) => r.integration_id).map((r) => [String(r.integration_id), String(r.id)]))

  let queue: Array<{ ref: AssetRef; by: AssetRef | 'root' }> = roots.map((ref) => ({ ref, by: 'root' as const }))
  const seen = new Set<string>()
  while (queue.length) {
    // Normalise integrations generated by a connector onto the connector.
    queue = queue.map((entry) => entry.ref.type === 'integration' && connectorByIntegration.has(entry.ref.id)
      ? { ...entry, ref: { type: 'connector' as const, id: connectorByIntegration.get(entry.ref.id)! } }
      : entry)
    const batch = queue.filter((entry) => !seen.has(key(entry.ref)) && !exclude.has(key(entry.ref)))
    queue = []
    for (const entry of batch) seen.add(key(entry.ref))
    if (!batch.length) break
    if (items.size + batch.length > maxItems) throw new Error(`Too many dependencies (more than ${maxItems})`)

    const idsByType: Partial<Record<string, string[]>> = {}
    for (const { ref } of batch) (idsByType[ref.type] ??= []).push(ref.id)
    const exported = await buildManifestExport(supabase, tenantId, idsByType)
    const found = new Map<string, any>()
    const bySection: Array<{ section: string; asset: any }> = []
    for (const { section } of PLAN_SECTIONS) {
      for (const asset of Array.isArray(exported[section]) ? exported[section] : []) {
        bySection.push({ section, asset })
        const type = SECTION_TYPE[section]
        if (type && type !== 'reference' && type !== 'object') found.set(`${type}:${asset.id}`, asset)
      }
    }
    for (const entry of batch) {
      const asset = found.get(key(entry.ref))
      if (!asset) {
        if (entry.ref.type === 'role') {
          // A system role (never exported): resolved by slug on install.
          continue
        }
        if (entry.by !== 'root') missing.push({ ...entry.ref, required_by: entry.by })
        continue
      }
      items.set(key(entry.ref), { ...entry.ref, name: String(asset.name ?? asset.display_name ?? 'untitled'), required_by: entry.by })
    }

    // Scan every exported asset (references and objects belong to their integration).
    const referenceIds: Array<{ id: string; by: AssetRef }> = []
    const activityKeys: Array<{ key: string; by: AssetRef }> = []
    for (const { section, asset } of bySection) {
      const type = SECTION_TYPE[section]
      const owner: AssetRef | null = type === 'reference' || type === 'object'
        ? { type: 'integration', id: String(section === 'references' ? asset.integration_id : '') }
        : type ? { type: type as DependencyAssetType, id: String(asset.id) } : null
      if (!owner) continue
      const scanned = scanAssetReferences(asset)
      for (const ref of scanned.refs) {
        if (ref.type === 'reference') { referenceIds.push({ id: ref.id, by: owner }); continue }
        if (ref.type === 'role') {
          const roleRef = { type: 'role' as const, id: ref.id }
          if (!found.has(key(roleRef)) && !items.has(key(roleRef))) {
            systemRoles.push({ id: ref.id, slug: null, section, asset_id: String(asset.id), path: ref.path })
          }
        }
        if (ref.type === owner.type && ref.id === owner.id) continue
        queue.push({ ref: { type: ref.type, id: ref.id }, by: owner })
      }
      for (const activityKey of scanned.activityKeys) activityKeys.push({ key: activityKey, by: owner })
      for (const person of scanned.people) people.push({ ...person, section, asset_id: String(asset.id) })
    }

    // A workflow's form page ("Publish as form page", lib/forms/form-page):
    // the form links to the workflow (its Start workflow action), not the
    // other way round, so it is looked up — it travels with the workflow.
    const workflowRefs = batch.filter((entry) => entry.ref.type === 'workflow' && found.has(key(entry.ref))).map((entry) => entry.ref)
    if (workflowRefs.length) {
      const { data: formRows } = await supabase.from('forms').select('id, buttons').eq('tenant_id', tenantId)
      const wanted = new Set(workflowRefs.map((ref) => ref.id))
      for (const form of (formRows ?? []) as any[]) {
        const of = formPageOf(form.buttons)
        if (of && wanted.has(of.workflow_id)) queue.push({ ref: { type: 'form', id: String(form.id) }, by: { type: 'workflow', id: of.workflow_id } })
      }
    }

    if (referenceIds.length) {
      const unique = [...new Set(referenceIds.map((r) => r.id))]
      const { data: refs } = await supabase.from('integration_references').select('id, integration_id').eq('tenant_id', tenantId).in('id', unique)
      const integrationOf = new Map<string, string>(((refs ?? []) as any[]).map((r) => [String(r.id), String(r.integration_id)]))
      for (const { id, by } of referenceIds) {
        const integrationId = integrationOf.get(id)
        if (!integrationId) { missing.push({ type: 'integration', id, required_by: by }); continue }
        queue.push({ ref: { type: 'integration', id: integrationId }, by })
      }
    }
    if (activityKeys.length) {
      const unique = [...new Set(activityKeys.map((a) => a.key))]
      const { data: activities } = await supabase.from('custom_workflow_activities').select('id, key').eq('tenant_id', tenantId).in('key', unique)
      const idOf = new Map<string, string>(((activities ?? []) as any[]).map((a) => [String(a.key), String(a.id)]))
      for (const { key: activityKey, by } of activityKeys) {
        const id = idOf.get(activityKey)
        if (id) queue.push({ ref: { type: 'workflow_activity', id }, by })
      }
    }
  }

  // System roles: record their slug so installs can bind them by slug.
  const roleIds = [...new Set(systemRoles.map((r) => r.id))]
  if (roleIds.length) {
    const { data: roles } = await supabase.from('roles').select('id, slug, is_system').eq('tenant_id', tenantId).in('id', roleIds)
    const slugOf = new Map<string, string>(((roles ?? []) as any[]).filter((r) => r.is_system).map((r) => [String(r.id), String(r.slug)]))
    for (const role of systemRoles) role.slug = slugOf.get(role.id) ?? null
  }
  const dedupe = <T,>(list: T[], keyOf: (item: T) => string) => [...new Map(list.map((item) => [keyOf(item), item])).values()]
  return {
    items: [...items.values()],
    missing: dedupe(missing, (m) => `${m.type}:${m.id}`),
    people: dedupe(people, (p) => `${p.asset_id}:${p.path.join('.')}`),
    system_roles: dedupe(systemRoles.filter((r) => r.slug), (r) => `${r.asset_id}:${r.path.join('.')}`),
  }
}
