/**
 * Extension workflow nodes and triggers as catalog entries (client-safe).
 *
 * A node an extension declares (`contributes.nodes[]`) is the node type
 * `ext.<id>.<key>`; a trigger is `ext.<id>.<key>` with category `trigger`.
 * The designer derives its panel from the declared inputs and outputs — the
 * same ActionField model custom actions use (components/automations/
 * custom-action-config) — and the node stores them like a custom action
 * step: `input_mappings` (values or {{data}}), `_action_outputs` (data
 * picker snapshot) and `_output_prefix`.
 */

import type { ActionField } from '@/lib/custom-actions/contract'
import { extKey, parseExtKey, type ExtensionIcon } from './manifest'
import { getExtensionManifest, getExtensionManifests } from './registry'

export const EXTENSION_NODE_COLOR = '#0EA5E9'

export interface ExtensionCatalogEntry {
  type: `ext.${string}`
  label: string
  /** Lucide icon name (Pascal case), "Puzzle" when the manifest gives none or an SVG. */
  icon: string
  category: 'trigger' | 'action' | 'operation' | 'logic'
  color: string
  description: string
  extensionId: string
  extensionName: string
  key: string
  /** Node inputs (triggers: the trigger's settings). */
  inputs: ActionField[]
  /** Node outputs (triggers: the run variables). */
  outputs: ActionField[]
  feature?: string
}

/** Lucide name in Pascal case for a manifest icon (SVG icons → fallback). */
export function iconName(icon: ExtensionIcon | undefined, fallback = 'Puzzle'): string {
  const raw = typeof icon === 'string' ? icon : icon && 'lucide' in icon ? icon.lucide : ''
  if (!raw) return fallback
  return raw.includes('-') || /^[a-z]/.test(raw) ? raw.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('') : raw
}

let cache: { manifests: unknown; entries: ExtensionCatalogEntry[] } | null = null

/** Every extension node and trigger in the build, triggers first. */
export function extensionNodeCatalog(): ExtensionCatalogEntry[] {
  const manifests = getExtensionManifests()
  if (!manifests.length) return []
  if (cache && cache.manifests === manifests) return cache.entries
  const entries: ExtensionCatalogEntry[] = []
  for (const m of manifests) {
    for (const t of m.contributes.triggers) {
      entries.push({
        type: extKey(m.id, t.key) as `ext.${string}`, label: t.label, icon: iconName(t.icon, 'Zap'), category: 'trigger', color: '#22C55E',
        description: t.description, extensionId: m.id, extensionName: m.name, key: t.key, inputs: t.config, outputs: t.variables, feature: t.feature,
      })
    }
  }
  for (const m of manifests) {
    for (const n of m.contributes.nodes) {
      entries.push({
        type: extKey(m.id, n.key) as `ext.${string}`, label: n.label, icon: iconName(n.icon), category: n.category, color: EXTENSION_NODE_COLOR,
        description: n.description, extensionId: m.id, extensionName: m.name, key: n.key, inputs: n.inputs, outputs: n.outputs, feature: n.feature,
      })
    }
  }
  cache = { manifests, entries }
  return entries
}

export function extensionCatalogEntry(type: string): ExtensionCatalogEntry | null {
  if (!String(type ?? '').startsWith('ext.')) return null
  const parsed = parseExtKey(type)
  if (!parsed || !getExtensionManifest(parsed.extensionId)) return null
  return extensionNodeCatalog().find((e) => e.type === type) ?? null
}

/** `ext.<id>.<key>` (any, installed or not). */
export function looksLikeExtensionNodeType(type: string): boolean {
  return parseExtKey(type) !== null
}

/** An installed extension's node or trigger type. */
export function isExtensionNodeType(type: string): boolean {
  return extensionCatalogEntry(type) !== null
}

export function isExtensionTriggerType(type: string): boolean {
  return extensionCatalogEntry(type)?.category === 'trigger'
}

/** Node types of these extensions (designer: hide the nodes of extensions a workspace has not enabled). */
export function extensionNodeTypesOf(extensionIds: Iterable<string>): Set<string> {
  const ids = new Set(extensionIds)
  return new Set(extensionNodeCatalog().filter((e) => ids.has(e.extensionId)).map((e) => e.type))
}
