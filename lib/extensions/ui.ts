/**
 * UI contributions, resolved (client-safe).
 *
 * The server computes an ExtensionUiState for the signed-in person's
 * current workspace (lib/extensions/ui-server.ts: which extensions they may
 * use, licence state, allowed features, non-secret settings, deployment
 * mode, instance admin) and the shell renders every contribution from it.
 * Each entry's guard is evaluated here — permission, entitlement feature,
 * deployment mode, instance admin, manager, setting — the same function on
 * the server and in the browser. Data behind every surface is enforced
 * again by services, the extension's handlers and RLS.
 */

import { holdsPermission } from '@/lib/permissions'
import type { EntitlementDecision } from './entitlement-port'
import type {
  CreateEntryContribution, DetailTabContribution, ExtensionGuard, ExtensionManifest, ExtensionTarget, ItemActionContribution,
  MenuItemContribution, NavItemContribution, NavSectionContribution, NotificationTypeContribution, PageContribution,
  PaletteEntryContribution, SettingsPageContribution, WidgetContribution,
} from './manifest'
import { APPLIES_WHEN_RE } from './manifest'
import { getExtensionManifest } from './registry'

export interface ExtensionUiEntry {
  id: string
  name: string
  version: string
  licence: EntitlementDecision['state']
  /** Licence features the workspace may use. */
  features: string[]
  /** Workspace settings without secrets (for `setting` guards and pages). */
  config: Record<string, unknown>
}

export interface ExtensionUiState {
  /** Extensions usable in the current workspace (enabled, licensed, runnable). */
  extensions: ExtensionUiEntry[]
  deployment: 'cloud' | 'self_hosted'
  instanceAdmin: boolean
}

export const EMPTY_EXTENSION_UI: ExtensionUiState = { extensions: [], deployment: 'self_hosted', instanceAdmin: false }

export interface GuardSubject {
  /** Does the person hold the permission (implied permissions included)? */
  has: (permission: string) => boolean
  isManager?: boolean
}

function settingMatches(expr: string, config: Record<string, unknown>): boolean {
  const match = /^([a-z][a-z0-9_.]*)\s*(?:(==|!=)\s*(.+))?$/.exec(expr.trim())
  if (!match) return false
  const [, key, op, rawValue] = match
  const value = key.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined), config)
  if (!op) return Boolean(value) && !(Array.isArray(value) && value.length === 0)
  const expected = rawValue.trim().replace(/^['"]|['"]$/g, '')
  const equal = String(value ?? '') === expected
  return op === '==' ? equal : !equal
}

/** Evaluate a contribution guard for one person in one workspace. */
export function evaluateGuard(guard: ExtensionGuard | undefined, subject: GuardSubject, ext: ExtensionUiEntry, state: Pick<ExtensionUiState, 'deployment' | 'instanceAdmin'>): boolean {
  if (!guard) return true
  const all = typeof guard.permission === 'string' ? [guard.permission] : guard.permission ?? []
  if (!all.every((p) => subject.has(p))) return false
  if (guard.anyPermission?.length && !guard.anyPermission.some((p) => subject.has(p))) return false
  if (guard.feature && !ext.features.includes(guard.feature)) return false
  if (guard.deployment && guard.deployment !== state.deployment) return false
  if (guard.instanceAdmin && !state.instanceAdmin) return false
  if (guard.managerOnly && !subject.isManager) return false
  if (guard.setting && !settingMatches(guard.setting, ext.config)) return false
  return true
}

/** A permission set → GuardSubject.has (implied permissions honoured). */
export function permissionChecker(permissions: Iterable<string>): (permission: string) => boolean {
  const set = new Set(permissions)
  return (permission) => holdsPermission(set, permission)
}

/** `appliesWhen` over one item (row actions, detail tabs). */
export function appliesTo(expr: string | undefined, item: Record<string, unknown> | null | undefined): boolean {
  if (!expr) return true
  if (!APPLIES_WHEN_RE.test(expr)) return false
  const negate = expr.startsWith('!')
  const body = negate ? expr.slice(1) : expr
  const match = /^item((?:\.[A-Za-z_][A-Za-z0-9_]*)+)(?:\s*(==|!=)\s*(.+))?$/.exec(body)
  if (!match) return false
  const [, rawPath, op, literal] = match
  const value = rawPath.slice(1).split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined), item ?? {})
  let result: boolean
  if (!op) result = value !== undefined && value !== null && value !== false && value !== ''
  else {
    const raw = literal.trim()
    const expected: unknown = raw === 'null' ? null : raw === 'true' ? true : raw === 'false' ? false : /^-?\d/.test(raw) ? Number(raw) : raw.slice(1, -1)
    const equal = expected === null ? value === null || value === undefined : value === expected
    result = op === '==' ? equal : !equal
  }
  return negate ? !result : result
}

/** Where a target leads, as an href (null for actions — they run, not navigate). */
export function targetHref(extensionId: string, target: ExtensionTarget): string | null {
  if ('page' in target) return `/x/${extensionId}${target.page ? `/${target.page}` : ''}`
  if ('route' in target) return target.route
  if ('settings' in target) return `/settings/extensions/${extensionId}/${target.settings}`
  if ('url' in target) return target.url
  return null
}

export type Resolved<T> = T & { extensionId: string; extensionName: string; href: string | null }

interface ResolveContext {
  state: ExtensionUiState
  subject: GuardSubject
}

function* usable(state: ExtensionUiState): Generator<{ entry: ExtensionUiEntry; manifest: ExtensionManifest }> {
  for (const entry of state.extensions) {
    const manifest = getExtensionManifest(entry.id)
    if (manifest) yield { entry, manifest }
  }
}

function collect<T extends { when?: ExtensionGuard; target?: ExtensionTarget }>(
  { state, subject }: ResolveContext,
  pick: (manifest: ExtensionManifest) => readonly T[],
): Array<Resolved<T>> {
  const out: Array<Resolved<T>> = []
  for (const { entry, manifest } of usable(state)) {
    for (const item of pick(manifest)) {
      if (!evaluateGuard(item.when, subject, entry, state)) continue
      out.push({ ...item, extensionId: entry.id, extensionName: entry.name, href: item.target ? targetHref(entry.id, item.target) : null })
    }
  }
  return out
}

const byOrder = <T extends { order?: number; label?: string }>(a: T, b: T) => (a.order ?? 500) - (b.order ?? 500) || String(a.label ?? '').localeCompare(String(b.label ?? ''))

export interface ResolvedNav {
  /** Items for core groups (primary, build, operate, people, govern), sorted by order. */
  byGroup: Record<string, Array<Resolved<NavItemContribution>>>
  /** Extension sections (with their items), sorted by order; empty sections dropped. */
  sections: Array<Resolved<NavSectionContribution> & { key: string; items: Array<Resolved<NavItemContribution>> }>
}

export function resolveNav(ctx: ResolveContext): ResolvedNav {
  const items = collect(ctx, (m) => m.contributes.ui.navItems)
  const sections = collect(ctx, (m) => m.contributes.ui.navSections)
  const byGroup: ResolvedNav['byGroup'] = {}
  const sectionItems = new Map<string, Array<Resolved<NavItemContribution>>>()
  for (const item of items) {
    if (item.group.startsWith('ext:')) {
      const key = `${item.extensionId}:${item.group.slice(4)}`
      sectionItems.set(key, [...(sectionItems.get(key) ?? []), item])
    } else {
      (byGroup[item.group] ??= []).push(item)
    }
  }
  for (const list of Object.values(byGroup)) list.sort(byOrder)
  return {
    byGroup,
    sections: sections
      .map((s) => ({ ...s, key: `${s.extensionId}:${s.id}`, items: (sectionItems.get(`${s.extensionId}:${s.id}`) ?? []).sort(byOrder) }))
      .filter((s) => s.items.length > 0)
      .sort(byOrder),
  }
}

export const resolveCreateEntries = (ctx: ResolveContext): Array<Resolved<CreateEntryContribution>> => collect(ctx, (m) => m.contributes.ui.createEntries)
export const resolvePaletteEntries = (ctx: ResolveContext): Array<Resolved<PaletteEntryContribution>> => collect(ctx, (m) => m.contributes.ui.paletteEntries)
export const resolveUserMenu = (ctx: ResolveContext): Array<Resolved<MenuItemContribution>> => collect(ctx, (m) => m.contributes.ui.userMenu).sort(byOrder)
export const resolveWidgets = (ctx: ResolveContext): Array<Resolved<WidgetContribution>> => collect(ctx, (m) => m.contributes.ui.widgets)
export const resolvePages = (ctx: ResolveContext): Array<Resolved<PageContribution>> => collect(ctx, (m) => m.contributes.ui.pages)

export function resolveItemActions(ctx: ResolveContext, objectType: string, items: Array<Record<string, unknown>>, placement: 'menu' | 'toolbar' = 'menu'): Array<Resolved<ItemActionContribution>> {
  const bulk = items.length > 1
  return collect(ctx, (m) => m.contributes.ui.itemActions)
    .filter((a) => a.objectTypes.includes(objectType as never))
    .filter((a) => a.placement === 'both' || a.placement === placement)
    .filter((a) => (bulk ? a.bulk === true : true))
    .filter((a) => items.every((item) => appliesTo(a.appliesWhen, item)))
    .sort(byOrder)
}

export function resolveDetailTabs(ctx: ResolveContext, objectType: string, item: Record<string, unknown> | null): Array<Resolved<DetailTabContribution>> {
  return collect(ctx, (m) => m.contributes.ui.detailTabs)
    .filter((t) => t.objectTypes.includes(objectType as never) && appliesTo(t.appliesWhen, item))
    .sort(byOrder)
}

export function resolveSettingsPages(ctx: ResolveContext, scope?: SettingsPageContribution['scope']): Array<Resolved<SettingsPageContribution>> {
  return collect(ctx, (m) => m.contributes.ui.settingsPages).filter((p) => !scope || p.scope === scope).sort(byOrder)
}

export function resolveNotificationTypes(state: ExtensionUiState): Array<NotificationTypeContribution & { extensionId: string; type: string }> {
  const out: Array<NotificationTypeContribution & { extensionId: string; type: string }> = []
  for (const { entry, manifest } of usable(state)) {
    for (const t of manifest.contributes.ui.notificationTypes) out.push({ ...t, extensionId: entry.id, type: `ext.${entry.id}.${t.key}` })
  }
  return out
}
