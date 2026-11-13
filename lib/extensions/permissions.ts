/**
 * Dynamic extension permissions (client-safe).
 *
 * Core permission keys are a closed list (lib/permissions PERMISSION_KEYS)
 * stored in role payloads. Extension permissions are `ext.<id>.<key>`,
 * declared in each manifest, and must work without editing existing roles
 * (the August 2026 Case Management lesson: new keys missing from stored
 * roles made the nav disappear until a backfill migration ran). So:
 *
 *  - implied_by: a manifest permission names core permissions that imply it
 *    (e.g. `ext.acme.view` ⊂ `settings.view`). expandPermissions adds it to
 *    every permission set built anywhere (session, API keys, OAuth, MCP), so
 *    existing roles get sensible access the moment an extension is enabled;
 *  - explicit grants: roles and API keys may also hold `ext.<id>.<key>`
 *    directly (role editor group per extension). Well-formed keys of an
 *    extension no longer in the build are kept on save, never stripped;
 *  - default_roles: when a workspace enables the extension its system roles
 *    are given the permission (lib/services/extensions.ts), as a convenience
 *    on top of implied_by.
 */

import { getExtensionManifests } from './registry'

export const EXTENSION_PERMISSION_RE = /^ext\.[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9_]{0,62}$/

export interface ExtensionPermissionDef {
  key: string
  label: string
  description: string
  extensionId: string
  extensionName: string
  impliedBy: string[]
  defaultRoles: string[]
}

let cache: { manifests: unknown; defs: ExtensionPermissionDef[]; implied: Map<string, string[]>; keys: Set<string> } | null = null

function current() {
  const manifests = getExtensionManifests()
  if (cache && cache.manifests === manifests) return cache
  const defs: ExtensionPermissionDef[] = []
  const implied = new Map<string, string[]>()
  for (const m of manifests) {
    for (const p of m.permissions) {
      const key = `ext.${m.id}.${p.key}`
      defs.push({ key, label: p.label, description: p.description ?? '', extensionId: m.id, extensionName: m.name, impliedBy: p.implied_by, defaultRoles: p.default_roles })
      for (const core of p.implied_by) implied.set(core, [...(implied.get(core) ?? []), key])
    }
  }
  cache = { manifests, defs, implied, keys: new Set(defs.map((d) => d.key)) }
  return cache
}

export function extensionPermissionDefs(): ExtensionPermissionDef[] {
  return current().defs
}

/** A permission an installed extension declares. */
export function isExtensionPermission(key: string): boolean {
  return current().keys.has(key)
}

/** Well-formed `ext.<id>.<key>` (installed or not) — kept on role / key saves. */
export function looksLikeExtensionPermission(key: string): boolean {
  return EXTENSION_PERMISSION_RE.test(key)
}

/** Extension permissions a core permission implies. */
export function extensionPermissionsImpliedBy(permission: string): readonly string[] {
  return current().implied.get(permission) ?? []
}

/** Whether any installed extension declares implications (fast path). */
export function hasExtensionImplications(): boolean {
  return current().implied.size > 0
}

/** Role editor groups, one per extension (after the core groups). */
export function extensionPermissionGroups(): Array<{ key: string; label: string; permissions: Array<{ key: string; label: string; description: string }> }> {
  const groups = new Map<string, { key: string; label: string; permissions: Array<{ key: string; label: string; description: string }> }>()
  for (const def of current().defs) {
    const group = groups.get(def.extensionId) ?? { key: `ext.${def.extensionId}`, label: def.extensionName, permissions: [] }
    group.permissions.push({ key: def.key, label: def.label, description: def.description + (def.impliedBy.length ? ` (included with ${def.impliedBy.join(', ')})` : '') })
    groups.set(def.extensionId, group)
  }
  return [...groups.values()]
}
