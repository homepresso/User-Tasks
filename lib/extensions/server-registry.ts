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
  return problems
}

/** `/receivers/*` style glob (`*` = one or more path characters). */
export function globMatches(glob: string, path: string): boolean {
  const re = new RegExp(`^${glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`)
  return re.test(path)
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
  }
  // Extensions that declare nodes or triggers need a server module.
  for (const { manifest } of manifests) {
    if (byId.has(manifest.id)) continue
    if (source.some((s) => s?.id === manifest.id)) continue
    const compat = checkCompatibility(manifest)
    if (!compat.compatible) problems.push(...compat.problems.map((p) => `Extension "${manifest.id}": ${p}`))
    else if (manifest.contributes.nodes.length || manifest.contributes.triggers.length) problems.push(`Extension "${manifest.id}" declares nodes or triggers but has no server module`)
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
