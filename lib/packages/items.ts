/**
 * Package items — pure rules behind "add / remove items" on an authored
 * package and "detach / adopt" on an install (lib/services/package-items,
 * lib/services/package-installs):
 *
 * - itemDependencyGraph: which item uses which, from the exported assets
 *   (a workflow → its forms, tables, decision tables, custom steps…), with
 *   references folded onto their integration, connector-generated
 *   integrations onto their connector, custom steps found by key and form
 *   controls by tag — the same edges the dependency closure walks
 *   (lib/portability/dependencies), but in both directions.
 * - dependentsOf: what in the package still uses the items being removed
 *   ("Workflow X uses this form").
 * - versionChanges: what was added / removed since the last built version
 *   ("Unpublished changes").
 */

import { scanAssetReferences, type DependencyAssetType } from '@/lib/portability/dependencies'
import { PLAN_SECTIONS } from '@/lib/portability/plan'

/* eslint-disable @typescript-eslint/no-explicit-any -- exported assets are free-form JSON */

export interface ItemRef { type: string; id: string }
export const itemKey = (ref: ItemRef) => `${ref.type}:${ref.id}`

/** Manifest section → item type (references and objects belong to their integration). */
export const SECTION_ITEM_TYPE: Record<string, DependencyAssetType> = Object.fromEntries(
  PLAN_SECTIONS.filter(({ type }) => type !== 'reference' && type !== 'object').map(({ section, type }) => [section, type as DependencyAssetType]),
)
/** Item type → manifest section. */
export const ITEM_TYPE_SECTION: Record<string, string> = Object.fromEntries(Object.entries(SECTION_ITEM_TYPE).map(([section, type]) => [type, section]))

export interface ItemGraph {
  /** item key → keys of the items it uses directly. */
  uses: Map<string, Set<string>>
  /** item key → keys of the items that use it directly. */
  usedBy: Map<string, Set<string>>
}

/** Direct "uses" edges between the exported items (keys are `type:id`). */
export function itemDependencyGraph(assets: Record<string, unknown>): ItemGraph {
  const list = (section: string): any[] => (Array.isArray(assets[section]) ? (assets[section] as any[]) : [])
  const referenceOwner = new Map<string, string>()
  const connectorOfIntegration = new Map<string, string>()
  for (const reference of list('references')) if (reference?.id && reference?.integration_id) referenceOwner.set(String(reference.id), `integration:${reference.integration_id}`)
  for (const connector of list('connectors')) {
    for (const ref of Array.isArray(connector?.generated_references) ? connector.generated_references : []) if (ref?.id) referenceOwner.set(String(ref.id), `connector:${connector.id}`)
    for (const field of ['generated_integration_id', 'integration_id']) if (connector?.[field]) connectorOfIntegration.set(String(connector[field]), `connector:${connector.id}`)
  }
  for (const [ref, owner] of referenceOwner) {
    const integrationId = owner.startsWith('integration:') ? owner.slice('integration:'.length) : null
    if (integrationId && connectorOfIntegration.has(integrationId)) referenceOwner.set(ref, connectorOfIntegration.get(integrationId)!)
  }
  const activityByKey = new Map<string, string>(list('workflow_activities').filter((a) => a?.key).map((a) => [String(a.key), `workflow_activity:${a.id}`]))
  const controlByTag = new Map<string, string>(list('form_controls').filter((c) => c?.tag).map((c) => [String(c.tag), `form_control:${c.id}`]))

  const resolve = (type: string, id: string): string | null => {
    if (type === 'reference') return referenceOwner.get(id) ?? null
    if (type === 'integration' && connectorOfIntegration.has(id)) return connectorOfIntegration.get(id)!
    return `${type}:${id}`
  }

  const uses = new Map<string, Set<string>>()
  const add = (from: string, to: string | null | undefined) => {
    if (!to || to === from) return
    if (!uses.has(from)) uses.set(from, new Set())
    uses.get(from)!.add(to)
  }
  const scan = (owner: string, asset: unknown) => {
    if (!uses.has(owner)) uses.set(owner, new Set())
    const found = scanAssetReferences(asset)
    for (const ref of found.refs) add(owner, resolve(ref.type, ref.id))
    for (const key of found.activityKeys) add(owner, activityByKey.get(key))
    for (const tag of found.controlTags) add(owner, controlByTag.get(tag))
  }
  for (const [section, type] of Object.entries(SECTION_ITEM_TYPE)) {
    for (const asset of list(section)) if (asset?.id) scan(`${type}:${asset.id}`, asset)
  }
  // An integration's references (its operations) are part of the integration.
  for (const reference of list('references')) {
    const owner = reference?.id ? referenceOwner.get(String(reference.id)) : null
    if (owner) scan(owner, reference)
  }

  const usedBy = new Map<string, Set<string>>()
  for (const [from, targets] of uses) {
    for (const to of targets) {
      if (!usedBy.has(to)) usedBy.set(to, new Set())
      usedBy.get(to)!.add(from)
    }
  }
  return { uses, usedBy }
}

export interface Dependent<T extends ItemRef = ItemRef> {
  item: T
  used_by: T[]
}

/**
 * Items being removed that something staying in the package still uses.
 * `inPackage` is every item in the package (key → the item, with its name).
 */
export function dependentsOf<T extends ItemRef>(graph: ItemGraph, removing: readonly ItemRef[], inPackage: ReadonlyMap<string, T>): Array<Dependent<T>> {
  const removingKeys = new Set(removing.map(itemKey))
  const out: Array<Dependent<T>> = []
  for (const ref of removing) {
    const users = [...(graph.usedBy.get(itemKey(ref)) ?? [])]
      .filter((key) => inPackage.has(key) && !removingKeys.has(key))
      .map((key) => inPackage.get(key)!)
    if (users.length) out.push({ item: inPackage.get(itemKey(ref)) ?? (ref as T), used_by: users })
  }
  return out
}

/** "Workflow “Approve” uses this form" — one line per dependent item. */
export function describeDependents(dependents: ReadonlyArray<Dependent<ItemRef & { name?: string | null; label?: string }>>): string[] {
  return dependents.map(({ item, used_by }) => {
    const users = used_by.slice(0, 3).map((u) => `${u.label ?? u.type.replace(/_/g, ' ')} “${u.name ?? u.id}”`)
    const more = used_by.length > 3 ? ` and ${used_by.length - 3} more` : ''
    return `${users.join(', ')}${more} ${used_by.length === 1 ? 'uses' : 'use'} ${item.label ? item.label.toLowerCase() : item.type.replace(/_/g, ' ')} “${item.name ?? item.id}”`
  })
}

/** Item refs of a built version's assets (sections → `type:id`). */
export function versionItemRefs(assets: Record<string, unknown>): Array<ItemRef & { name: string }> {
  const out: Array<ItemRef & { name: string }> = []
  for (const [section, type] of Object.entries(SECTION_ITEM_TYPE)) {
    const list = Array.isArray(assets[section]) ? (assets[section] as any[]) : []
    for (const asset of list) if (asset?.id) out.push({ type, id: String(asset.id), name: String(asset.name ?? asset.display_name ?? 'untitled') })
  }
  return out
}

/** Added / removed between the last built version and the package now. */
export function versionChanges<T extends ItemRef>(current: readonly T[], built: readonly T[]): { added: T[]; removed: T[] } {
  const builtKeys = new Set(built.map(itemKey))
  const currentKeys = new Set(current.map(itemKey))
  return { added: current.filter((ref) => !builtKeys.has(itemKey(ref))), removed: built.filter((ref) => !currentKeys.has(itemKey(ref))) }
}

/**
 * Lists after removing items from a package: dropped from roots / added
 * items, and left out (excluded) when something else would still pull them
 * in. With no root left, the added items become the roots.
 */
export function removeFromLists(
  lists: { roots: ItemRef[]; items: ItemRef[]; excluded: ItemRef[] },
  removing: readonly ItemRef[],
  stillPulledIn: ReadonlySet<string>,
): { roots: ItemRef[]; items: ItemRef[]; excluded: ItemRef[] } {
  const removingKeys = new Set(removing.map(itemKey))
  let roots = lists.roots.filter((ref) => !removingKeys.has(itemKey(ref)))
  let items = lists.items.filter((ref) => !removingKeys.has(itemKey(ref)))
  if (!roots.length && items.length) { roots = items; items = [] }
  const known = new Set(lists.excluded.map(itemKey))
  const excluded = [...lists.excluded, ...removing.filter((ref) => stillPulledIn.has(itemKey(ref)) && !known.has(itemKey(ref))).map((ref) => ({ type: ref.type, id: ref.id }))]
  return { roots, items, excluded }
}
