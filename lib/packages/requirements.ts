/**
 * Package requirements: everything an install needs from the target
 * environment that the package cannot carry.
 *
 * detectRequirements (build time, pure) turns the scrubbed asset manifest
 * into requirements:
 *   connector         every connector: its credential fields (secret) plus
 *                     its configuration fields (host, database, URL, … —
 *                     optional, default = the source value)
 *   integration_auth  every '__SECRET__' inside an integration's config, plus
 *                     its base URL / database host (optional, flagged as
 *                     environment-specific)
 *   secret            every other '__SECRET__' (MCP servers, log
 *                     destinations, credentials inside workflow nodes, …)
 *   env               every `${env:VAR}` / `secret://…` reference
 *   user              user / team ids in workflows (people never travel)
 *   role              system roles referenced by id (bound by slug on install)
 *
 * applyRequirementValues (install / complete setup, pure) writes values at
 * each field's target path. requirementStatus decides met / missing.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

import { getConnectorDefinition } from '@/lib/connectors/registry'
import { SECRET_PLACEHOLDER } from '@/lib/portability/scrub'
import type { PackageRequirement, RequirementField, RequirementFieldType } from './format'

export interface DetectContext {
  people?: Array<{ kind: 'user' | 'team'; id: string; section: string; asset_id: string; path: Array<string | number> }>
  systemRoles?: Array<{ id: string; slug: string | null; section: string; asset_id: string; path: Array<string | number> }>
}

const ENV_KEY = /^(base_url|url|endpoint|host|hostname|server|database|port|instance_url|domain|site_url|account)$/i
const ENV_REF = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g
const SECRET_REF = /^secret:\/\/[\w./-]+$/

const SECTION_LABEL: Record<string, string> = {
  workflows: 'Workflow', integrations: 'Integration', connectors: 'Connector', mcp_servers: 'MCP server',
  log_destinations: 'Log destination', agents: 'Agent', references: 'Reference', decision_tables: 'Decision table',
  workflow_activities: 'Custom step', reports: 'Report', email_templates: 'Email template', data_tables: 'Data table',
  forms: 'Form', form_themes: 'Form theme',
}

function humanize(key: string): string {
  const text = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim()
  return text ? text[0].toUpperCase() + text.slice(1) : key
}

function pathKey(path: Array<string | number>): string {
  return path.map(String).join('.')
}

/** Every path whose value is the '__SECRET__' sentinel. */
export function secretPaths(value: unknown, path: Array<string | number> = [], out: Array<Array<string | number>> = [], depth = 0): Array<Array<string | number>> {
  if (depth > 40) return out
  if (value === SECRET_PLACEHOLDER) out.push(path)
  else if (Array.isArray(value)) value.forEach((item, index) => secretPaths(item, [...path, index], out, depth + 1))
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) secretPaths(child, [...path, key], out, depth + 1)
  return out
}

function envRefs(value: unknown, path: Array<string | number> = [], out: Array<{ path: Array<string | number>; name: string; secret: boolean }> = [], depth = 0) {
  if (depth > 40) return out
  if (typeof value === 'string') {
    for (const match of value.matchAll(ENV_REF)) out.push({ path, name: match[1], secret: false })
    if (SECRET_REF.test(value)) out.push({ path, name: value.slice('secret://'.length), secret: true })
  } else if (Array.isArray(value)) value.forEach((item, index) => envRefs(item, [...path, index], out, depth + 1))
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) envRefs(child, [...path, key], out, depth + 1)
  return out
}

function getAt(value: any, path: Array<string | number>): unknown {
  let node = value
  for (const seg of path) {
    if (node === null || typeof node !== 'object') return undefined
    node = node[seg as any]
  }
  return node
}

export function setAt(value: any, path: Array<string | number>, next: unknown): void {
  let node = value
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]
    if (node[seg as any] === null || typeof node[seg as any] !== 'object') node[seg as any] = typeof path[i + 1] === 'number' ? [] : {}
    node = node[seg as any]
  }
  node[path[path.length - 1] as any] = next
}

function fieldType(connectorType: string): RequirementFieldType {
  if (connectorType === 'password') return 'password'
  if (connectorType === 'number') return 'number'
  if (connectorType === 'textarea') return 'text'
  return 'string'
}

/** Requirements for a scrubbed asset manifest (format=manifest sections). */
export function detectRequirements(assets: Record<string, any>, context: DetectContext = {}): PackageRequirement[] {
  const requirements: PackageRequirement[] = []
  const claimed = new Set<string>()
  const claim = (section: string, id: string, path: Array<string | number>) => claimed.add(`${section}:${id}:${pathKey(path)}`)
  const isClaimed = (section: string, id: string, path: Array<string | number>) => claimed.has(`${section}:${id}:${pathKey(path)}`)

  for (const connector of Array.isArray(assets.connectors) ? assets.connectors : []) {
    const definition = getConnectorDefinition(String(connector.connector_key ?? ''))
    const id = String(connector.id)
    const fields: RequirementField[] = []
    for (const field of definition?.credentialFields ?? []) {
      const path = ['credentials', field.key]
      claim('connectors', id, path)
      fields.push({ key: `credentials.${field.key}`, label: field.label, type: fieldType(field.type), secret: true, ...(field.required ? {} : { description: 'Optional' }), target: { section: 'connectors', asset_id: id, path } })
    }
    for (const path of secretPaths(connector.config ?? {}, ['config'])) {
      claim('connectors', id, path)
      fields.push({ key: pathKey(path), label: humanize(String(path[path.length - 1])), type: 'password', secret: true, target: { section: 'connectors', asset_id: id, path } })
    }
    for (const field of definition?.fields ?? []) {
      const value = connector.config?.[field.key]
      if (value === SECRET_PLACEHOLDER) continue
      fields.push({
        key: `config.${field.key}`, label: field.label, type: fieldType(field.type), secret: false,
        ...(value !== undefined && value !== null && value !== '' ? { default: value } : {}),
        description: 'Environment setting (defaults to the source value)',
        target: { section: 'connectors', asset_id: id, path: ['config', field.key] },
      })
    }
    const requiredKeys = new Set((definition?.credentialFields ?? []).filter((f) => f.required).map((f) => `credentials.${f.key}`))
    if (!fields.length) continue
    requirements.push({
      id: `connector:connectors:${id}`,
      kind: 'connector',
      ref: { section: 'connectors', asset_id: id, name: String(connector.name ?? definition?.name ?? 'Connector') },
      label: `${definition?.name ?? 'Connector'} connection “${connector.name ?? definition?.name}”`,
      description: `Credentials${definition?.fields?.length ? ' and connection settings' : ''} for ${definition?.name ?? connector.connector_key}. The connector stays disabled until they are set.`,
      required: requiredKeys.size > 0 || fields.some((f) => f.secret && f.key.startsWith('config.')),
      fields: fields.map((field) => (requiredKeys.has(field.key) ? field : field.secret && field.key.startsWith('credentials.') ? { ...field, description: field.description ?? 'Optional' } : field)),
    })
  }

  for (const integration of Array.isArray(assets.integrations) ? assets.integrations : []) {
    const id = String(integration.id)
    const fields: RequirementField[] = []
    for (const path of secretPaths(integration.config ?? {}, ['config'])) {
      claim('integrations', id, path)
      fields.push({ key: pathKey(path), label: humanize(String(path[path.length - 1])), type: 'password', secret: true, target: { section: 'integrations', asset_id: id, path } })
    }
    const envCandidates: Array<Array<string | number>> = []
    for (const key of Object.keys(integration.config ?? {})) if (ENV_KEY.test(key)) envCandidates.push(['config', key])
    for (const key of Object.keys(integration.config?.db_config ?? {})) if (ENV_KEY.test(key)) envCandidates.push(['config', 'db_config', key])
    for (const path of envCandidates) {
      const value = getAt(integration, path)
      if (value === SECRET_PLACEHOLDER || (typeof value !== 'string' && typeof value !== 'number')) continue
      fields.push({ key: pathKey(path), label: humanize(String(path[path.length - 1])), type: /url|endpoint/i.test(String(path[path.length - 1])) ? 'url' : typeof value === 'number' ? 'number' : 'string', secret: false, default: value, description: 'Environment-specific (defaults to the source value)', target: { section: 'integrations', asset_id: id, path } })
    }
    if (!fields.length) continue
    requirements.push({
      id: `integration_auth:integrations:${id}`,
      kind: 'integration_auth',
      ref: { section: 'integrations', asset_id: id, name: String(integration.name ?? 'Integration') },
      label: `Integration “${integration.name}”`,
      description: fields.some((f) => f.secret) ? 'Authentication for this integration. It is installed inactive until the credentials are set.' : 'Environment-specific endpoint settings.',
      required: fields.some((f) => f.secret),
      fields,
    })
  }

  // Every other secret placeholder (MCP servers, log destinations, workflows, agents, …).
  for (const [section, list] of Object.entries(assets)) {
    if (!Array.isArray(list) || section === 'table_rows') continue
    for (const asset of list) {
      const id = String(section === 'objects' ? asset?.generated_reference_id ?? asset?.id : asset?.id)
      const paths = secretPaths(asset).filter((path) => !isClaimed(section, id, path) && !(section === 'connectors' || section === 'integrations'))
      if (!paths.length) continue
      const fields: RequirementField[] = paths.map((path) => {
        claim(section, id, path)
        return { key: pathKey(path), label: humanize(String(path[path.length - 1])), type: 'password', secret: true, target: { section, asset_id: id, path } }
      })
      requirements.push({
        id: `secret:${section}:${id}`,
        kind: 'secret',
        ref: { section, asset_id: id, name: String(asset?.name ?? 'Asset') },
        label: `${SECTION_LABEL[section] ?? humanize(section)} “${asset?.name ?? id}” secrets`,
        description: section === 'mcp_servers' || section === 'log_destinations'
          ? 'Credentials for this connection; it is installed disabled until they are set.'
          : 'Secret values that were removed from the package.',
        required: true,
        fields,
      })
    }
  }

  // ${env:VAR} / secret:// references anywhere.
  for (const [section, list] of Object.entries(assets)) {
    if (!Array.isArray(list) || section === 'table_rows') continue
    for (const asset of list) {
      const refs = envRefs(asset)
      if (!refs.length) continue
      const id = String(asset?.id)
      requirements.push({
        id: `env:${section}:${id}`,
        kind: 'env',
        ref: { section, asset_id: id, name: String(asset?.name ?? 'Asset') },
        label: `${SECTION_LABEL[section] ?? humanize(section)} “${asset?.name ?? id}” environment values`,
        description: 'Values the package takes from the target environment (${env:…} / secret:// references).',
        required: true,
        fields: refs.map((ref) => ({ key: pathKey(ref.path), label: ref.name, type: ref.secret ? 'password' : 'string', secret: ref.secret, description: ref.secret ? `secret://${ref.name}` : `\${env:${ref.name}}`, target: { section, asset_id: id, path: ref.path } })),
      })
    }
  }

  // People: assignees / teams never travel.
  const byAsset = new Map<string, NonNullable<DetectContext['people']>>()
  for (const person of context.people ?? []) {
    const key = `${person.section}:${person.asset_id}`
    byAsset.set(key, [...(byAsset.get(key) ?? []), person])
  }
  for (const [key, people] of byAsset) {
    const [section, assetId] = key.split(':')
    const asset = (Array.isArray(assets[section]) ? assets[section] : []).find((a: any) => String(a?.id) === assetId)
    if (!asset) continue
    requirements.push({
      id: `user:${section}:${assetId}`,
      kind: 'user',
      ref: { section, asset_id: assetId, name: String(asset.name ?? 'Workflow') },
      label: `${SECTION_LABEL[section] ?? humanize(section)} “${asset.name}” assignees`,
      description: 'Users and teams are not part of a package: pick who receives this work here (left empty, the step keeps an unknown assignee).',
      required: false,
      fields: people.map((person) => ({
        key: pathKey(person.path),
        label: `${person.kind === 'team' ? 'Team' : 'User'} for ${describeNodePath(asset, person.path)}`,
        type: person.kind === 'team' ? 'string' : 'user',
        secret: false,
        description: person.kind === 'team' ? 'Team id in this workspace' : 'User id or email in this workspace',
        target: { section, asset_id: assetId, path: person.path },
      })),
    })
  }

  // System roles: bound by slug on install.
  const roleGroups = new Map<string, NonNullable<DetectContext['systemRoles']>>()
  for (const role of context.systemRoles ?? []) {
    if (!role.slug) continue
    const key = `${role.section}:${role.asset_id}`
    roleGroups.set(key, [...(roleGroups.get(key) ?? []), role])
  }
  for (const [key, roles] of roleGroups) {
    const [section, assetId] = key.split(':')
    const asset = (Array.isArray(assets[section]) ? assets[section] : []).find((a: any) => String(a?.id) === assetId)
    if (!asset) continue
    requirements.push({
      id: `role:${section}:${assetId}`,
      kind: 'role',
      ref: { section, asset_id: assetId, name: String(asset.name ?? 'Asset') },
      label: `${SECTION_LABEL[section] ?? humanize(section)} “${asset.name}” roles`,
      description: 'Built-in roles are matched by slug in the target workspace.',
      required: false,
      fields: roles.map((role) => ({ key: pathKey(role.path), label: `Role for ${describeNodePath(asset, role.path)}`, type: 'string', secret: false, default: role.slug, description: 'Role slug (owner, admin, manager, member, viewer or a custom role)', target: { section, asset_id: assetId, path: role.path } })),
    })
  }
  return requirements
}

function describeNodePath(asset: any, path: Array<string | number>): string {
  if (path[0] === 'nodes' && typeof path[1] === 'number') {
    const node = asset?.nodes?.[path[1]]
    return `step “${node?.label ?? node?.type ?? path[1]}”`
  }
  return pathKey(path)
}

export type RequirementValues = Record<string, Record<string, unknown>>

const isEmptyValue = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '')

export interface FieldState { key: string; state: 'provided' | 'stored' | 'default' | 'missing' | 'optional' }
export interface RequirementState { id: string; status: 'met' | 'missing'; fields: FieldState[] }

/**
 * Status of every requirement. `stored(field)` says the target already holds
 * a (secret) value locally (upgrade / complete setup); `values` are the ones
 * supplied now.
 */
export function requirementStatus(
  requirements: PackageRequirement[],
  values: RequirementValues,
  stored: (requirement: PackageRequirement, field: RequirementField) => boolean = () => false,
): RequirementState[] {
  return requirements.map((requirement) => {
    const fields: FieldState[] = requirement.fields.map((field) => {
      const given = values[requirement.id]?.[field.key]
      if (!isEmptyValue(given)) return { key: field.key, state: 'provided' }
      if (stored(requirement, field)) return { key: field.key, state: 'stored' }
      if (!isEmptyValue(field.default)) return { key: field.key, state: 'default' }
      return { key: field.key, state: isFieldRequired(requirement, field) ? 'missing' : 'optional' }
    })
    return { id: requirement.id, status: fields.some((f) => f.state === 'missing') ? 'missing' : 'met', fields }
  })
}

/** Required = the requirement is required and the field is a secret (credentials) or an env reference without default. */
export function isFieldRequired(requirement: PackageRequirement, field: RequirementField): boolean {
  if (!requirement.required) return false
  if (field.description === 'Optional') return false
  if (requirement.kind === 'connector') return field.secret && field.key.startsWith('credentials.')
  if (requirement.kind === 'integration_auth') return field.secret
  return true
}

/**
 * Write supplied values into the asset manifest (in place). Secret fields
 * with no value keep the '__SECRET__' sentinel (an upsert then keeps the
 * stored value); `resolve` maps a field value to what is written (e.g. a
 * user email → user id, a role slug → role id).
 */
export function applyRequirementValues(
  assets: Record<string, any>,
  requirements: PackageRequirement[],
  values: RequirementValues,
  resolve: (requirement: PackageRequirement, field: RequirementField, value: unknown) => unknown = (_r, _f, value) => value,
): void {
  for (const requirement of requirements) {
    for (const field of requirement.fields) {
      const given = values[requirement.id]?.[field.key]
      const value = isEmptyValue(given) ? (requirement.kind === 'role' ? field.default : undefined) : given
      if (value === undefined) continue
      const list = Array.isArray(assets[field.target.section]) ? assets[field.target.section] : []
      const asset = list.find((a: any) => String(field.target.section === 'objects' ? a?.generated_reference_id : a?.id) === field.target.asset_id)
      if (!asset) continue
      const resolved = resolve(requirement, field, field.type === 'number' && typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value)
      if (resolved === undefined) continue
      setAt(asset, field.target.path, resolved)
    }
  }
}

/** Only the non-secret values (persisted with the install for upgrades). */
export function nonSecretValues(requirements: PackageRequirement[], values: RequirementValues): RequirementValues {
  const out: RequirementValues = {}
  for (const requirement of requirements) {
    for (const field of requirement.fields) {
      if (field.secret) continue
      const value = values[requirement.id]?.[field.key]
      if (isEmptyValue(value)) continue
      ;(out[requirement.id] ??= {})[field.key] = value
    }
  }
  return out
}
