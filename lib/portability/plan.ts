// Apply plan for config-as-code: compare an incoming manifest with the
// tenant's current state and classify every asset as create / update /
// unchanged / error, with field-level diffs. Pure — the caller resolves
// identity (which local row each incoming id maps to) and passes the tenant's
// current export; nothing here touches the database.

import { normalizeEmailTemplateContent } from '@/lib/email-templates'
import { normalizeFormAssetLikeImport, stripWorkflowFormPins } from './forms'
import { remapKnownIds, type AssetIdMaps } from './id-maps'
import {
  isObjectBackedReference,
  normalizeScaffoldDecisionTable,
  normalizeScaffoldReportConfig,
  normalizeScaffoldWorkflow,
} from './normalize'
import { isSecretKey, SECRET_PLACEHOLDER } from './scrub'
import { isPlainObject } from '@/lib/utils/guards'

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

export type PlanAction = 'create' | 'update' | 'unchanged' | 'error'
/** `workspace_theme` is the singleton theme section (planned by lib/services/config). */
export type PlanAssetType = keyof AssetIdMaps | 'object' | 'workspace_theme'
export type MatchKind = 'id' | 'mapping' | 'name' | 'slug' | 'package'

export interface FieldDiff {
  path: string
  before?: unknown
  after?: unknown
}

export interface AssetPlan {
  section: string
  asset_type: PlanAssetType
  source_id: string | null
  local_id: string | null
  name: string
  action: PlanAction
  /** How the local row was found (update / unchanged only). */
  matched_by?: MatchKind
  diffs?: FieldDiff[]
  /** Set when a diff list was cut at MAX_DIFFS. */
  diffs_truncated?: boolean
  error?: string
  /** Source file, when the manifest came from files. */
  file?: string
}

export interface ConfigPlan {
  assets: AssetPlan[]
  summary: Record<PlanAction, number>
}

/** Manifest section → id-map key, in import order (lib/portability/import.ts). */
export const PLAN_SECTIONS: ReadonlyArray<{ section: string; type: keyof AssetIdMaps | 'object' }> = [
  { section: 'email_templates', type: 'email_template' },
  { section: 'connectors', type: 'connector' },
  { section: 'data_tables', type: 'data_table' },
  { section: 'integrations', type: 'integration' },
  { section: 'references', type: 'reference' },
  { section: 'objects', type: 'object' },
  { section: 'decision_tables', type: 'decision_table' },
  { section: 'retention_policies', type: 'retention_policy' },
  { section: 'roles', type: 'role' },
  { section: 'mcp_servers', type: 'mcp_server' },
  { section: 'workflow_activities', type: 'workflow_activity' },
  { section: 'reports', type: 'report' },
  { section: 'agents', type: 'agent' },
  // Forms reference saved themes (theme_id) and workflows reference forms
  // (form_id), so themes, then forms, then workflows.
  { section: 'form_themes', type: 'form_theme' },
  { section: 'forms', type: 'form' },
  { section: 'workflows', type: 'workflow' },
  // Filters may name workflows, so destinations come last.
  { section: 'log_destinations', type: 'log_destination' },
]

/** Never compared, at any depth: timestamps and ownership change on every write. */
const VOLATILE_KEYS = new Set(['created_at', 'updated_at', 'exported_at', 'tenant_id', 'created_by', 'updated_by'])
/** Ignored at the top level only (identity is resolved separately). */
const TOP_LEVEL_IGNORED: Record<string, readonly string[]> = {
  objects: ['generated_reference_id'],
  // A connector's generated integration/references are identity, rebuilt per tenant.
  connectors: ['generated_integration_id', 'generated_references'],
  // A form's version is per environment (never exported); a file that carries one is not drift.
  forms: ['version'],
}
const OBJECT_SOURCE_IGNORED = new Set(['id', 'object_id'])
const MAX_DIFFS = 50
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

export function planAssetName(asset: Record<string, any>): string {
  return String(asset?.name ?? asset?.title ?? asset?.label ?? 'untitled')
}

/** Display key the plan, CLI and audit share: `section:source_id`. */
export function planKey(section: string, sourceId: string): string {
  return `${section}:${sourceId}`
}

function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile)
  if (!isPlainObject(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (VOLATILE_KEYS.has(key)) continue
    out[key] = stripVolatile(child)
  }
  return out
}

/** Comparable shape of one asset (incoming or local) for its section. */
function comparable(section: string, asset: Record<string, any>): Record<string, unknown> {
  const ignored = new Set(['id', ...(TOP_LEVEL_IGNORED[section] ?? [])])
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(asset)) {
    if (ignored.has(key)) continue
    if (section === 'objects' && key === 'sources' && Array.isArray(value)) {
      out[key] = value.map((source) => isPlainObject(source)
        ? Object.fromEntries(Object.entries(source).filter(([k]) => !OBJECT_SOURCE_IGNORED.has(k)))
        : source)
      continue
    }
    out[key] = value
  }
  return stripVolatile(out) as Record<string, unknown>
}

const isEmpty = (value: unknown) => value === undefined || value === null

type Segment = string | number
interface RawDiff { segs: Segment[]; before?: unknown; after?: unknown }

function formatPath(segs: Segment[]): string {
  return segs.reduce<string>((path, seg) => (typeof seg === 'number' ? `${path}[${seg}]` : path ? `${path}.${seg}` : seg), '') || '(value)'
}

function getAt(value: unknown, segs: Segment[]): unknown {
  let node: any = value
  for (const seg of segs) {
    if (node === null || typeof node !== 'object') return undefined
    node = node[seg as any]
  }
  return node
}

/** Stored value of a scrubbed secret at a path (decrypted), or undefined when unknown. */
type SecretLookup = (segs: Segment[]) => string | undefined

function diffWalk(before: unknown, after: unknown, segs: Segment[], out: RawDiff[], secretAt?: SecretLookup): void {
  if (after === SECRET_PLACEHOLDER) return
  if (before === SECRET_PLACEHOLDER) {
    // The export hides the stored credential; compare against the real value
    // when the caller can reveal it (otherwise the sentinel equals anything).
    const stored = typeof after === 'string' && secretAt ? secretAt(segs) : undefined
    if (stored !== undefined && stored !== after) out.push({ segs, before: SECRET_PLACEHOLDER, after: SECRET_PLACEHOLDER })
    return
  }
  if (isEmpty(before) && isEmpty(after)) return
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length)
    for (let i = 0; i < length; i++) diffWalk(before[i], after[i], [...segs, i], out, secretAt)
    return
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    for (const key of keys) diffWalk(before[key], after[key], [...segs, key], out, secretAt)
    return
  }
  if (before === after) return
  if (typeof before === 'number' && typeof after === 'number' && Number.isNaN(before) && Number.isNaN(after)) return
  out.push({ segs, ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) })
}

/**
 * Deep diff of `after` (incoming) against `before` (local). `__SECRET__` on
 * either side equals anything (credentials are never exported, so they can't
 * be compared); null and a missing key are equal.
 */
export function diffValues(before: unknown, after: unknown): FieldDiff[] {
  const out: RawDiff[] = []
  diffWalk(before, after, [], out)
  return out.map(({ segs, ...rest }) => ({ path: formatPath(segs), ...rest }))
}

/**
 * The import normalises some sections before writing (decision-table field
 * ids/labels, workflow node defaults and a trigger node, report configs).
 * Comparing the normalised incoming asset keeps hand-written files from
 * showing perpetual drift.
 */
function normalizeLikeImport(section: string, asset: Record<string, any>, localRow: Record<string, any>): Record<string, any> {
  if (section === 'decision_tables') return normalizeScaffoldDecisionTable(asset)
  if (section === 'email_templates') {
    // An import never clears the flag on the current default template.
    const normalized = normalizeEmailTemplateContent(asset)
    return localRow.is_default === true ? { ...normalized, is_default: true } : normalized
  }
  if (section === 'workflows') return stripWorkflowFormPins(normalizeScaffoldWorkflow(asset))
  if (section === 'forms') return normalizeFormAssetLikeImport(asset)
  if (section === 'reports' && isPlainObject(asset.config)) return { ...asset, config: normalizeScaffoldReportConfig(asset.config) }
  return asset
}

/**
 * Field diffs for an update. A difference only counts when the file says
 * something at that path: values the normaliser filled in (generated ids,
 * default node fields) are matched against whatever is stored.
 */
function assetDiffs(section: string, incoming: Record<string, any>, localRow: Record<string, any>, secretAt?: SecretLookup): FieldDiff[] {
  const raw = comparable(section, incoming)
  const after = comparable(section, normalizeLikeImport(section, incoming, localRow))
  // Workflows are canonicalised on both sides: rows written through the API
  // or the designer keep whatever spelling they were given (condition
  // `logic: "AND"`, `operator: "Equals"`), which the import would rewrite to
  // the same canonical form — so an untouched export must not diff.
  const before = comparable(section, section === 'workflows' ? normalizeScaffoldWorkflow(localRow) : localRow)
  // Only fields the export carries are compared: anything else in the file
  // is ignored by the import too.
  const scopedAfter = Object.fromEntries(Object.keys(before).map((k) => [k, after[k]]))
  const out: RawDiff[] = []
  diffWalk(before, scopedAfter, [], out, secretAt)
  return out
    .filter((d) => !(getAt(raw, d.segs) === undefined && getAt(scopedAfter, d.segs) !== undefined))
    .map(({ segs, before: b, after: a }) => {
      // A changed credential is reported, but never echoed back (CI logs).
      const secret = segs.some((seg) => typeof seg === 'string' && isSecretKey(seg))
        || ((section === 'connectors' || section === 'log_destinations') && segs[0] === 'credentials')
      const mask = (value: unknown) => (secret || (typeof value === 'string' && value.startsWith('enc:v1:')) ? SECRET_PLACEHOLDER : value)
      return { path: formatPath(segs), ...(b !== undefined ? { before: mask(b) } : {}), ...(a !== undefined ? { after: mask(a) } : {}) }
    })
}

export interface PlanManifestParams {
  /** Incoming manifest (sections of asset objects). */
  incoming: Record<string, any>
  /**
   * The tenant's current state as a (scrubbed) manifest export of the local
   * rows the seed points at. Keys present here define what is compared.
   */
  current: Record<string, any>
  /** source id → local id per asset type (self ids, stored mappings, adopted names). */
  idSeed: AssetIdMaps
  /** How each seeded id was matched, keyed by planKey(section, source_id). */
  matches?: Record<string, MatchKind>
  /** Source file of every incoming asset, parallel to incoming[section]. */
  paths?: Record<string, string[]>
  /**
   * The same local rows with credentials NOT scrubbed, plus a decryptor, so a
   * changed secret (e.g. a rotated `${env:TOKEN}`) is detected. Values are
   * only compared, never put into the plan.
   */
  secrets?: { current: Record<string, any>; reveal: (stored: string) => string | undefined }
}

/**
 * Classify every incoming asset. Object-backed references and the internal
 * `__objects__` integration are skipped (the import regenerates them from
 * their objects), mirroring importManifest.
 */
export function planManifest(params: PlanManifestParams): ConfigPlan {
  const { incoming, current, idSeed, matches = {}, paths = {}, secrets } = params
  const assets: AssetPlan[] = []
  const hasObjects = Array.isArray(incoming.objects) && incoming.objects.length > 0
  const objectReferenceIds = new Set(
    (Array.isArray(incoming.objects) ? incoming.objects : [])
      .map((objectDef: any) => String(objectDef?.generated_reference_id ?? '').trim())
      .filter(Boolean),
  )
  const incomingIntegrationIds = new Set(
    (Array.isArray(incoming.integrations) ? incoming.integrations : []).map((integration: any) => String(integration?.id ?? '')),
  )

  for (const { section, type } of PLAN_SECTIONS) {
    const list = incoming[section]
    if (!Array.isArray(list)) continue
    const localRows = new Map<string, any>(
      (Array.isArray(current[section]) ? current[section] : []).map((row: any) => [String(type === 'object' ? row?.generated_reference_id : row?.id), row]),
    )
    const rawRows = new Map<string, any>(
      (Array.isArray(secrets?.current[section]) ? secrets!.current[section] : []).map((row: any) => [String(row?.id), row]),
    )
    const seen = new Set<string>()

    for (const [index, asset] of list.entries()) {
      const file = paths[section]?.[index]
      if (!isPlainObject(asset)) {
        assets.push({ section, asset_type: type, source_id: null, local_id: null, name: 'untitled', action: 'error', error: 'Asset is not an object', ...(file ? { file } : {}) })
        continue
      }
      // Identity of an object is its generated reference (objects have no id map).
      const identity = type === 'object' ? asset.generated_reference_id : asset.id
      const sourceId = typeof identity === 'string' && identity ? identity : null
      const name = planAssetName(asset)
      const key = sourceId ? planKey(section, sourceId) : ''
      const base = { section, asset_type: type, source_id: sourceId, name, ...(file ? { file } : {}) }

      if (section === 'integrations' && asset.name === '__objects__' && hasObjects) continue
      if (section === 'references' && (objectReferenceIds.has(String(asset.id ?? '')) || isObjectBackedReference(asset))) continue

      const fail = (error: string) => assets.push({ ...base, local_id: null, action: 'error', error })
      if (!sourceId) { fail(type === 'object' ? 'Object has no generated_reference_id' : 'Asset has no id'); continue }
      if (!isUuid(sourceId)) { fail(`${type === 'object' ? 'generated_reference_id' : 'id'} must be a UUID (got "${sourceId}")`); continue }
      if (seen.has(sourceId)) { fail(`Duplicate id ${sourceId} in ${section}`); continue }
      seen.add(sourceId)
      if (section === 'references' && !incomingIntegrationIds.has(String(asset.integration_id ?? ''))) {
        fail(`Reference must be applied together with its integration (${asset.integration_id ?? 'no integration_id'} is not in the files)`)
        continue
      }
      if (typeof asset.name !== 'string' || !asset.name.trim()) { fail('Asset has no name'); continue }

      const mapName = type === 'object' ? 'reference' : type
      const localId = idSeed[mapName][sourceId] ?? null
      const localRow = localId ? localRows.get(localId) : undefined
      if (!localId || !localRow) {
        assets.push({ ...base, local_id: null, action: 'create' })
        continue
      }

      const rawRow = rawRows.get(String(localRow.id))
      const secretAt: SecretLookup | undefined = rawRow && secrets
        ? (segs) => {
            const stored = getAt(rawRow, segs)
            return typeof stored === 'string' ? secrets.reveal(stored) : undefined
          }
        : undefined
      const diffs = assetDiffs(section, remapKnownIds(structuredClone(asset), idSeed), localRow, secretAt)
      const matchedBy = matches[key] ?? (localId === sourceId ? 'id' : 'mapping')
      const plan: AssetPlan = { ...base, local_id: type === 'object' ? String(localRow.id) : localId, action: diffs.length ? 'update' : 'unchanged', matched_by: matchedBy }
      if (diffs.length) {
        plan.diffs = diffs.slice(0, MAX_DIFFS)
        if (diffs.length > MAX_DIFFS) plan.diffs_truncated = true
      }
      assets.push(plan)
    }
  }

  const summary: Record<PlanAction, number> = { create: 0, update: 0, unchanged: 0, error: 0 }
  for (const asset of assets) summary[asset.action]++
  return { assets, summary }
}
