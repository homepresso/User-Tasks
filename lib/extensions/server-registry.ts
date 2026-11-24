/**
 * Server side of the extension registry: each extension's server module
 * (nodes, triggers, endpoints, jobs, events, MCP tools, migrations,
 * transports, UI actions and data) joined to its validated manifest, with
 * the compatibility check that runs at boot.
 *
 * An extension whose engines.usertasks / engines.extension_sdk range does
 * not accept this build, whose server module id differs from its manifest,
 * or whose server module names a node / trigger the manifest does not
 * declare is left out (`extensionProblems()` lists why; Settings →
 * Extensions shows it). Data stays; the extension simply does not run.
 */

import packageJson from '@/package.json'
import { satisfiesRange } from '@/lib/packages/semver'
import { getDeploymentMode } from '@/lib/deployment'
import { PERMISSION_KEYS } from '@/lib/permissions'
import type { ServerExtension } from '@/lib/extensions/sdk'
import { GENERATED_SERVER_EXTENSIONS } from './generated/registry.server'
import { EXTENSION_SDK_VERSION, type ExtensionManifest } from './manifest'
import { getExtensionManifest, getLoadedExtensions, loadExtensionsReport } from './registry'
import { registerUsageCounter } from '@/lib/licensing/limits'
// Side effect: the licensing implementation behind the entitlement port (server only).
import './licensing-wiring'

export const PLATFORM_VERSION: string = packageJson.version

export interface ExtensionCompatibility {
  compatible: boolean
  /** Why not, when not. */
  problems: string[]
  /** Built for another deployment mode: installed, but never active here. */
  deploymentSupported: boolean
}

/** engines + deployment check for one manifest against this build. */
export function checkCompatibility(manifest: ExtensionManifest, platformVersion: string = PLATFORM_VERSION): ExtensionCompatibility {
  const problems: string[] = []
  if (!satisfiesRange(platformVersion, manifest.engines.usertasks)) problems.push(`needs UserTasks ${manifest.engines.usertasks}; this build is ${platformVersion}`)
  if (manifest.engines.extension_sdk && !satisfiesRange(EXTENSION_SDK_VERSION, manifest.engines.extension_sdk)) problems.push(`needs extension SDK ${manifest.engines.extension_sdk}; core provides ${EXTENSION_SDK_VERSION}`)
  const deploymentSupported = manifest.deployments.includes(getDeploymentMode())
  return { compatible: problems.length === 0, problems, deploymentSupported }
}

let override: readonly ServerExtension[] | null = null
let cache: { source: readonly ServerExtension[]; manifests: unknown; byId: Map<string, ServerExtension>; problems: string[] } | null = null

function structuralProblems(manifest: ExtensionManifest, server: ServerExtension): string[] {
  const problems: string[] = []
  const nodes = new Set(manifest.contributes.nodes.map((n) => n.key))
  for (const key of Object.keys(server.nodes ?? {})) if (!nodes.has(key)) problems.push(`server module implements node "${key}" that the manifest does not declare`)
  for (const key of nodes) if (!server.nodes?.[key]) problems.push(`node "${key}" has no handler in the server module`)
  const triggers = new Set(manifest.contributes.triggers.map((t) => t.key))
  for (const key of Object.keys(server.triggers ?? {})) if (!triggers.has(key)) problems.push(`server module implements trigger "${key}" that the manifest does not declare`)
  const sources = new Set(manifest.contributes.directorySources.map((d) => d.key))
  for (const key of Object.keys(server.directorySources ?? {})) if (!sources.has(key)) problems.push(`server module implements directory source "${key}" that the manifest does not declare`)
  for (const key of sources) if (typeof server.directorySources?.[key]?.sync !== 'function') problems.push(`directory source "${key}" has no sync handler in the server module`)
  const importers = new Set(manifest.contributes.importers.map((i) => i.key))
  for (const key of Object.keys(server.importers ?? {})) if (!importers.has(key)) problems.push(`server module implements importer "${key}" that the manifest does not declare`)
  for (const key of importers) {
    const handler = server.importers?.[key]
    if (typeof handler?.analyze !== 'function' || typeof handler?.import !== 'function') problems.push(`importer "${key}" needs analyze and import handlers in the server module`)
  }
  if (server.infopath && typeof server.infopath.enrich !== 'function') problems.push('infopath.enrich must be a function')
  const publicGlobs = manifest.capabilities.inbound_public_routes
  for (const route of server.publicRoutes ?? []) {
    if (!publicGlobs.some((glob) => globMatches(glob, route.path.replace(/\{[^}]+\}/g, 'x')))) {
      problems.push(`public route ${route.path} is not declared in capabilities.inbound_public_routes`)
    }
  }
  const versions = new Set<string>()
  for (const m of server.migrations ?? []) {
    if (!/^\d{14}$/.test(m.version)) problems.push(`migration version "${m.version}" must be a 14-digit timestamp`)
    if (versions.has(m.version)) problems.push(`migration ${m.version} is listed twice`)
    versions.add(m.version)
  }
  if ((server.migrations ?? []).length && !manifest.capabilities.db) problems.push('server module ships migrations but capabilities.db is false')

  // Permissions named by endpoints, routes and tools: core keys or this extension's own.
  const own = new Set(manifest.permissions.map((p) => `ext.${manifest.id}.${p.key}`))
  const core = new Set<string>(PERMISSION_KEYS)
  const checkPermission = (permission: string | null | undefined, where: string) => {
    if (permission == null) return
    if (!core.has(permission) && !own.has(permission)) problems.push(`${where}: permission "${permission}" is neither a core permission nor declared by the extension`)
  }
  const routes = new Set<string>()
  for (const { endpoint } of server.endpoints ?? []) {
    const where = `endpoint ${endpoint.method} ${endpoint.path}`
    if (!endpoint.path.startsWith('/')) problems.push(`${where}: path must start with /`)
    if (endpoint.auth && endpoint.auth !== 'bearer') problems.push(`${where}: extension endpoints use bearer auth (public routes are publicRoutes)`)
    if (routes.has(`${endpoint.method} ${endpoint.path}`)) problems.push(`${where}: declared twice`)
    routes.add(`${endpoint.method} ${endpoint.path}`)
    checkPermission(endpoint.permission, where)
  }
  for (const route of server.publicRoutes ?? []) if (route.auth.kind === 'api_key') checkPermission(route.auth.permission, `public route ${route.path}`)
  const tools = new Set<string>()
  for (const tool of server.mcpTools ?? []) {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(tool.name)) problems.push(`MCP tool "${tool.name}": name must be lower-case letters, digits and _`)
    if (tools.has(tool.name)) problems.push(`MCP tool "${tool.name}" is declared twice`)
    tools.add(tool.name)
    if (!tool.permission) problems.push(`MCP tool "${tool.name}" needs a permission`)
    checkPermission(tool.permission, `MCP tool ${tool.name}`)
  }
  const jobs = new Set<string>()
  for (const job of server.jobs ?? []) {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(job.name)) problems.push(`job "${job.name}": name must be a lower-case slug`)
    if (jobs.has(job.name)) problems.push(`job "${job.name}" is declared twice`)
    jobs.add(job.name)
  }
  for (const key of Object.keys(server.transports ?? {})) if (!/^[a-z][a-z0-9_]{0,40}$/.test(key)) problems.push(`transport "${key}": key must be lower-case letters, digits and _`)
  // Licence features named by endpoints and tools must be declared; usage counters are namespaced limit keys.
  const features = new Set(manifest.licence.features)
  for (const { endpoint, feature } of server.endpoints ?? []) if (feature && !features.has(feature)) problems.push(`endpoint ${endpoint.method} ${endpoint.path}: feature "${feature}" is not declared in licence.features`)
  for (const tool of server.mcpTools ?? []) if (tool.feature && !features.has(tool.feature)) problems.push(`MCP tool ${tool.name}: feature "${tool.feature}" is not declared in licence.features`)
  // Form data targets (lib/forms/data-target.ts): keys, a submit hook, declared features and permissions.
  for (const [key, target] of Object.entries(server.formTargets ?? {})) {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(key)) problems.push(`form target "${key}": key must be lower-case letters, digits and _`)
    if (typeof target?.submit !== 'function') problems.push(`form target "${key}" has no submit hook`)
    if (target?.feature && !features.has(target.feature)) problems.push(`form target ${key}: feature "${target.feature}" is not declared in licence.features`)
    checkPermission(target?.bindPermission, `form target ${key}`)
  }
  if (server.processing) {
    if (typeof server.processing.handoff !== 'function') problems.push('processing.handoff must be a function')
    if (server.processing.feature && !features.has(server.processing.feature)) problems.push(`processing provider: feature "${server.processing.feature}" is not declared in licence.features`)
  }
  if (server.infrastructure) {
    if (!server.infrastructure.actions || typeof server.infrastructure.actions !== 'object') problems.push('infrastructure.actions must be an object of functions')
    for (const [name, fn] of Object.entries(server.infrastructure.actions ?? {})) if (typeof fn !== 'function' || !/^[a-z][a-zA-Z0-9_]{0,60}$/.test(name)) problems.push(`infrastructure action "${name}" must be a function with a camelCase name`)
    if (typeof server.infrastructure.href !== 'string' || !server.infrastructure.href.startsWith('/x/')) problems.push('infrastructure.href must be the add-on page (/x/…)')
    if (!server.infrastructure.feature) problems.push('infrastructure provider: a licence feature is required (changing infrastructure is licensed)')
    else if (!features.has(server.infrastructure.feature)) problems.push(`infrastructure provider: feature "${server.infrastructure.feature}" is not declared in licence.features`)
  }
  if (server.infopath?.feature && !features.has(server.infopath.feature)) problems.push(`infopath hook: feature "${server.infopath.feature}" is not declared in licence.features`)
  for (const key of Object.keys(server.usageCounters ?? {})) {
    if (!new RegExp(`^${manifest.id.replace(/-/g, '\\-')}\\.[a-z][a-z0-9_]{0,40}$`).test(key)) problems.push(`usage counter "${key}" must be named "${manifest.id}.<name>"`)
  }
  return problems
}

/** `/receivers/*` style glob (`*` = one or more path characters). */
export function globMatches(glob: string, path: string): boolean {
  const re = new RegExp(`^${glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`)
  return re.test(path)
}

/** Usage counters of a compatible extension → the licensing layer (Settings → Licence, ctx.licence.limit). */
function registerCounters(extensionId: string, server: ServerExtension, manifest: ExtensionManifest): void {
  for (const [key, counter] of Object.entries(server.usageCounters ?? {})) {
    registerUsageCounter(key, async (tenantId) => {
      const { createExtensionContext } = await import('./host')
      return Number(await counter({ ctx: createExtensionContext({ extensionId, tenantId }) })) || 0
    })
  }
  // A directory source's seat limit counts the accounts linked to it (core-owned), unless the extension counts it itself.
  for (const seatLimit of new Set(manifest.contributes.directorySources.map((d) => d.seatLimit).filter((k): k is string => Boolean(k)))) {
    if (server.usageCounters?.[seatLimit]) continue
    registerUsageCounter(seatLimit, async () => {
      const [{ directorySourceSeatUsage }, { getServiceDb }] = await Promise.all([import('@/lib/directory-sync/sources'), import('@/lib/providers/db')])
      return directorySourceSeatUsage(getServiceDb() as never, extensionId, seatLimit)
    })
  }
}

function current() {
  const source = override ?? GENERATED_SERVER_EXTENSIONS
  const manifests = getLoadedExtensions()
  if (cache && cache.source === source && cache.manifests === manifests) return cache
  const byId = new Map<string, ServerExtension>()
  const problems: string[] = []
  for (const server of source) {
    const manifest = getExtensionManifest(server?.id)
    if (!manifest) {
      problems.push(`Server module "${server?.id}" has no valid manifest in this build`)
      continue
    }
    const compat = checkCompatibility(manifest)
    const structural = structuralProblems(manifest, server)
    if (!compat.compatible || structural.length) {
      problems.push(...[...compat.problems, ...structural].map((p) => `Extension "${manifest.id}": ${p}`))
      continue
    }
    byId.set(manifest.id, server)
    registerCounters(manifest.id, server, manifest)
  }
  // Extensions that declare nodes or triggers need a server module.
  for (const { manifest } of manifests) {
    if (byId.has(manifest.id)) continue
    if (source.some((s) => s?.id === manifest.id)) continue
    const compat = checkCompatibility(manifest)
    if (!compat.compatible) problems.push(...compat.problems.map((p) => `Extension "${manifest.id}": ${p}`))
    else if (manifest.contributes.nodes.length || manifest.contributes.triggers.length || manifest.contributes.importers.length) problems.push(`Extension "${manifest.id}" declares nodes, triggers or importers but has no server module`)
  }
  cache = { source, manifests, byId, problems }
  return cache
}

/** The server module of a compatible extension (null when absent, incompatible or broken). */
export function getServerExtension(id: string): ServerExtension | null {
  return current().byId.get(id) ?? null
}

export function getServerExtensions(): ServerExtension[] {
  return [...current().byId.values()]
}

/**
 * Is the extension runnable in this build at all (valid manifest, compatible,
 * built for this deployment mode)? Per-workspace enablement and licences are
 * checked by ./state.
 */
export function isExtensionRunnable(id: string): boolean {
  const manifest = getExtensionManifest(id)
  if (!manifest) return false
  const compat = checkCompatibility(manifest)
  if (!compat.compatible || !compat.deploymentSupported) return false
  const needsServer = manifest.contributes.nodes.length > 0 || manifest.contributes.triggers.length > 0
  return !needsServer || current().byId.has(id)
}

/** Every reason an extension in this build is invalid or will not run. */
export function extensionProblems(): string[] {
  return [...loadExtensionsReport().problems, ...current().problems]
}

/** Test hook: replace the generated server registry (null restores it). */
export function __setServerExtensionsForTests(servers: readonly ServerExtension[] | null): void {
  override = servers
  cache = null
}
