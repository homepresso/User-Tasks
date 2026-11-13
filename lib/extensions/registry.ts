/**
 * The extensions compiled into this build (client-safe view).
 *
 * Reads the generated manifest registry (lib/extensions/generated, written
 * by the build from USERTASKS_EXTENSIONS), validates every manifest once and
 * namespaces the connectors it defines. An invalid manifest is left out and
 * reported (loadExtensionsReport — the build, boot and `extensions:gen`
 * fail on it). In the public build the list is empty and every helper here
 * is a cheap no-op.
 *
 * Server behaviour (nodes, endpoints, jobs …) is in ./server-registry.
 */

import type { ConnectorDefinition } from '@/lib/connectors/registry'
import type { ExtensionDefinition } from '@/lib/extensions/sdk'
import { GENERATED_EXTENSIONS } from './generated/registry.client'
import { extKey, parseExtensionManifest, ExtensionManifestError, type ExtensionManifest } from './manifest'

export interface LoadedExtension {
  manifest: ExtensionManifest
  /** Connector definitions with namespaced keys (`ext.<id>.<key>`). */
  connectors: ConnectorDefinition[]
}

interface Loaded {
  extensions: LoadedExtension[]
  byId: Map<string, LoadedExtension>
  problems: string[]
}

let override: readonly ExtensionDefinition[] | null = null
let cache: { source: readonly ExtensionDefinition[]; loaded: Loaded } | null = null

function load(definitions: readonly ExtensionDefinition[]): Loaded {
  const extensions: LoadedExtension[] = []
  const problems: string[] = []
  const byId = new Map<string, LoadedExtension>()
  for (const def of definitions) {
    let manifest: ExtensionManifest
    try {
      manifest = parseExtensionManifest(def?.manifest)
    } catch (error) {
      problems.push(error instanceof ExtensionManifestError ? error.message : `Invalid extension: ${(error as Error).message}`)
      continue
    }
    if (byId.has(manifest.id)) {
      problems.push(`Extension "${manifest.id}" is registered twice`)
      continue
    }
    const declared = new Set(manifest.contributes.connectors)
    const connectors: ConnectorDefinition[] = []
    for (const connector of def.connectors ?? []) {
      if (!declared.has(connector.key)) {
        problems.push(`Extension "${manifest.id}": connector "${connector.key}" is not listed in contributes.connectors`)
        continue
      }
      connectors.push({ ...connector, key: extKey(manifest.id, connector.key) })
    }
    for (const key of declared) {
      if (!(def.connectors ?? []).some((c) => c.key === key)) problems.push(`Extension "${manifest.id}": contributes.connectors lists "${key}" but the manifest module defines no such connector`)
    }
    const loaded = { manifest, connectors }
    extensions.push(loaded)
    byId.set(manifest.id, loaded)
  }
  return { extensions, byId, problems }
}

function current(): Loaded {
  const source = override ?? GENERATED_EXTENSIONS
  if (!cache || cache.source !== source) cache = { source, loaded: load(source) }
  return cache.loaded
}

/** True when the build has at least one (valid) extension — the fast path everywhere else. */
export function hasExtensions(): boolean {
  return current().extensions.length > 0
}

export function getLoadedExtensions(): readonly LoadedExtension[] {
  return current().extensions
}

export function getExtensionManifests(): ExtensionManifest[] {
  return current().extensions.map((e) => e.manifest)
}

export function getExtensionManifest(id: string): ExtensionManifest | null {
  return current().byId.get(id)?.manifest ?? null
}

export function getLoadedExtension(id: string): LoadedExtension | null {
  return current().byId.get(id) ?? null
}

/** Every valid extension plus the problems that kept others out. */
export function loadExtensionsReport(): { extensions: ExtensionManifest[]; problems: string[] } {
  const loaded = current()
  return { extensions: loaded.extensions.map((e) => e.manifest), problems: [...loaded.problems] }
}

/** Test hook: replace the generated registry (null restores it). */
export function __setExtensionsForTests(definitions: readonly ExtensionDefinition[] | null): void {
  override = definitions
  cache = null
}
