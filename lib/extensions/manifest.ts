/**
 * Extension manifest v1 (docs: /docs/developers/extensions).
 *
 * An extension is a versioned package compiled into the app at build time
 * (lib/extensions/build/codegen.ts) and switched on per workspace
 * (tenant_extensions) when its licence allows (lib/extensions/entitlement-port.ts).
 * The manifest is plain, serialisable data: what the extension is, what it
 * needs and what it contributes. Core renders every contribution itself
 * (nav, menus, settings forms, node panels), so the manifest never carries
 * code, CSS or remote assets. Behaviour lives in the extension's server
 * module (lib/extensions/sdk: defineServerExtension).
 *
 * This module is client-safe (zod only): the sidebar, palette and settings
 * renderers read manifests in the browser.
 */

import { z } from 'zod'
import { ACTION_FIELD_TYPES, type ActionField } from '@/lib/custom-actions/contract'
import { isSemver, isValidRange, satisfiesRange } from '@/lib/packages/semver'

export const EXTENSION_MANIFEST_VERSION = 1
/** The extension SDK contract core implements (engines.extension_sdk is checked against it). */
export const EXTENSION_SDK_VERSION = '1.0.0'

/** Extension ids: lower-case slug, 2–41 chars, no double / trailing hyphen. `ut-` is reserved for first-party extensions. */
export const EXTENSION_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
export const EXTENSION_ID_MAX = 41
/** Keys inside an extension (permissions, nodes, nav items …). */
export const CONTRIBUTION_KEY_RE = /^[a-z][a-z0-9_]{0,62}$/
/** Ids of ui entries (may use hyphens). */
const UI_ID_RE = /^[a-z][a-z0-9_-]{0,62}$/
export const RESERVED_ID_PREFIX = 'ut-'
/** Publishers allowed to use the reserved `ut-` prefix. */
export const FIRST_PARTY_PUBLISHERS = new Set(['usertasks'])
const RESERVED_IDS = new Set(['core', 'ext', 'api', 'admin', 'system', 'usertasks', 'settings', 'public'])

export const DEPLOYMENT_MODES = ['cloud', 'self_hosted'] as const
export const SETTINGS_SCOPES = ['workspace', 'instance', 'user'] as const
export type SettingsScope = (typeof SETTINGS_SCOPES)[number]

/** Object types row actions and detail tabs attach to (`ext:<id>.<type>` for an extension's own types). */
export const CORE_OBJECT_TYPES = ['task', 'workflow', 'form', 'data_table', 'data_row', 'report', 'run'] as const
export type CoreObjectType = (typeof CORE_OBJECT_TYPES)[number]
export type ObjectType = CoreObjectType | `ext:${string}`

/** Sidebar groups an item can join (`ext:<section id>` = a section the extension declares). */
export const CORE_NAV_GROUPS = ['primary', 'build', 'operate', 'people', 'govern'] as const

/* ── Shared building blocks ─────────────────────────────────────────── */

const text = (max: number) => z.string().trim().min(1).max(max)

/** A Lucide icon name (kebab or Pascal case) or an inline SVG (sanitised by core before rendering). */
export const iconSchema = z.union([
  z.string().trim().min(1).max(60).regex(/^[A-Za-z][A-Za-z0-9-]*$/, 'icon must be a Lucide icon name'),
  z.object({ lucide: z.string().trim().min(1).max(60).regex(/^[A-Za-z][A-Za-z0-9-]*$/) }).strict(),
  z.object({ svg: z.string().trim().min(10).max(20_000).regex(/^<svg[\s>]/i, 'svg must start with <svg') }).strict(),
])
export type ExtensionIcon = z.infer<typeof iconSchema>

/**
 * Guards shared by every UI entry. Evaluated on the server (UI payload) and
 * again on the client; the data behind each surface is still enforced by
 * services, the extension's handlers and RLS.
 *   permission     — all listed permissions (core keys or `ext.<id>.<key>`)
 *   anyPermission  — at least one
 *   feature        — a licence feature of this extension (entitlement port)
 *   deployment     — only in this deployment mode
 *   instanceAdmin  — instance admins only
 *   managerOnly    — people with a direct report
 *   setting        — `<workspace config key>` (truthy) or `<key> == <value>` / `<key> != <value>`
 */
export const guardSchema = z.object({
  permission: z.union([z.string(), z.array(z.string()).max(10)]).optional(),
  anyPermission: z.array(z.string()).max(10).optional(),
  feature: z.string().max(60).optional(),
  deployment: z.enum(DEPLOYMENT_MODES).optional(),
  instanceAdmin: z.boolean().optional(),
  managerOnly: z.boolean().optional(),
  setting: z.string().max(200).regex(/^[a-z][a-z0-9_.]*(\s*(==|!=)\s*.+)?$/, 'setting is "<key>" or "<key> == <value>"').optional(),
}).strict()
export type ExtensionGuard = z.infer<typeof guardSchema>

/**
 * Where an entry leads:
 *   page   — the extension's custom page /x/<id>/<page>
 *   route  — a core route (must start with /)
 *   action — the extension's UI action (server action → server module ui.actions[action])
 *   settings — one of the extension's settings pages
 *   url    — an external link (https only)
 */
export const targetSchema = z.union([
  z.object({ page: z.string().max(200).regex(/^[a-z0-9][a-z0-9/_-]*$|^$/) }).strict(),
  z.object({ route: z.string().max(500).regex(/^\/(?!\/)/, 'route must be a path starting with /') }).strict(),
  z.object({ action: z.string().regex(CONTRIBUTION_KEY_RE), confirm: z.string().max(300).optional() }).strict(),
  z.object({ settings: z.string().regex(UI_ID_RE) }).strict(),
  z.object({ url: z.string().url().max(1000).regex(/^https:\/\//, 'external links must be https'), external: z.literal(true) }).strict(),
])
export type ExtensionTarget = z.infer<typeof targetSchema>

/* ── Typed fields (node inputs/outputs and settings) ───────────────── */

const actionFieldSchema: z.ZodType<ActionField> = z.lazy(() => z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,62}$/),
  label: z.string().max(120).optional(),
  type: z.enum(ACTION_FIELD_TYPES),
  description: z.string().max(1000).optional(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  example: z.unknown().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string().optional() })).max(200).optional(),
  items: z.object({ type: z.enum(ACTION_FIELD_TYPES), fields: z.array(actionFieldSchema).max(40).optional() }).optional(),
  fields: z.array(actionFieldSchema).max(40).optional(),
  placeholder: z.string().max(200).optional(),
}).strict()) as z.ZodType<ActionField>

/**
 * Settings field types. They reuse the connector / provider field model:
 * `secret` and `certificate` values are encrypted at rest and never returned
 * to the browser (only whether one is set).
 */
export const SETTING_FIELD_TYPES = [
  'text', 'textarea', 'number', 'boolean', 'select', 'multiselect', 'url', 'hostname', 'email',
  'secret', 'certificate', 'json',
] as const
export type SettingFieldType = (typeof SETTING_FIELD_TYPES)[number]

const conditionSchema = z.object({
  field: z.string(),
  equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
  notEquals: z.union([z.string(), z.number(), z.boolean()]).optional(),
  in: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
}).strict()

export const settingFieldSchema = z.object({
  key: z.string().regex(CONTRIBUTION_KEY_RE),
  label: text(120),
  type: z.enum(SETTING_FIELD_TYPES),
  help: z.string().max(1000).optional(),
  placeholder: z.string().max(200).optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).max(200).optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  required: z.boolean().optional(),
  requiredWhen: conditionSchema.optional(),
  visibleWhen: conditionSchema.optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  maxLength: z.number().int().positive().max(100_000).optional(),
  pattern: z.object({ regex: z.string().max(500), message: z.string().max(200) }).strict().optional(),
}).strict()
export type SettingField = z.infer<typeof settingFieldSchema>

export const settingsSchemaSchema = z.object({
  sections: z.array(z.object({
    id: z.string().regex(UI_ID_RE),
    title: text(120),
    description: z.string().max(1000).optional(),
    fields: z.array(settingFieldSchema).min(1).max(60),
  }).strict()).min(1).max(20),
  /** Buttons such as "Test connection": each runs a UI action with the saved settings. */
  actions: z.array(z.object({ id: z.string().regex(UI_ID_RE), label: text(80), action: z.string().regex(CONTRIBUTION_KEY_RE) }).strict()).max(10).optional(),
}).strict()
export type SettingsSchema = z.infer<typeof settingsSchemaSchema>

/* ── Contributions ──────────────────────────────────────────────────── */

const nodeContributionSchema = z.object({
  key: z.string().regex(CONTRIBUTION_KEY_RE),
  label: text(80),
  description: text(300),
  icon: iconSchema.optional(),
  /** Palette group. */
  category: z.enum(['action', 'operation', 'logic']).default('action'),
  inputs: z.array(actionFieldSchema).max(40).default([]),
  outputs: z.array(actionFieldSchema).max(40).default([]),
  /** Licence feature the node needs (entitlement port), when not the whole extension. */
  feature: z.string().max(60).optional(),
}).strict()
export type NodeContribution = z.infer<typeof nodeContributionSchema>

const triggerContributionSchema = z.object({
  key: z.string().regex(CONTRIBUTION_KEY_RE),
  label: text(80),
  description: text(300),
  icon: iconSchema.optional(),
  /** Trigger settings the designer shows (e.g. which list to watch). */
  config: z.array(actionFieldSchema).max(20).default([]),
  /** Run variables the trigger provides (data picker). */
  variables: z.array(actionFieldSchema).max(40).default([]),
  feature: z.string().max(60).optional(),
}).strict()
export type TriggerContribution = z.infer<typeof triggerContributionSchema>

const navSectionSchema = z.object({ id: z.string().regex(UI_ID_RE), label: text(40), order: z.number().int().min(0).max(1000), when: guardSchema.optional() }).strict()
const navItemSchema = z.object({
  id: z.string().regex(UI_ID_RE),
  label: text(40),
  icon: iconSchema,
  target: targetSchema,
  /** A core group, or `ext:<section id>` for a section this extension declares. */
  group: z.union([z.enum(CORE_NAV_GROUPS), z.string().regex(/^ext:[a-z][a-z0-9_-]*$/)]),
  /** 0–1000; core items sit at multiples of 100 in their group. */
  order: z.number().int().min(0).max(1000).default(500),
  /** Count beside the item: a UI data source (server module ui.data[source]) returning { count, tone? }. */
  badge: z.object({ source: z.string().regex(CONTRIBUTION_KEY_RE) }).strict().optional(),
  mobile: z.boolean().optional(),
  when: guardSchema.optional(),
}).strict()
const menuItemSchema = z.object({
  id: z.string().regex(UI_ID_RE),
  label: text(60),
  icon: iconSchema.optional(),
  target: targetSchema,
  order: z.number().int().min(0).max(1000).default(500),
  danger: z.boolean().optional(),
  when: guardSchema.optional(),
}).strict()
const objectTypeSchema = z.union([z.enum(CORE_OBJECT_TYPES), z.string().regex(/^ext:[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$/)])
/** `appliesWhen`: `item.<path>` truthy, `!item.<path>`, or `item.<path> == / != <literal>`. */
export const APPLIES_WHEN_RE = /^!?item(\.[A-Za-z_][A-Za-z0-9_]*)+(\s*(==|!=)\s*(null|true|false|-?\d+(\.\d+)?|'[^']*'|"[^"]*"))?$/
const itemActionSchema = menuItemSchema.extend({
  objectTypes: z.array(objectTypeSchema).min(1).max(10),
  placement: z.enum(['menu', 'toolbar', 'both']).default('menu'),
  /** Also offered when several items are selected (the action receives them all). */
  bulk: z.boolean().optional(),
  appliesWhen: z.string().max(200).regex(APPLIES_WHEN_RE, 'appliesWhen is item.<path> [== | != literal]').optional(),
}).strict()
const createEntrySchema = z.object({
  id: z.string().regex(UI_ID_RE),
  label: text(60),
  paletteLabel: z.string().max(80).optional(),
  keywords: z.array(z.string().max(40)).max(20).default([]),
  icon: iconSchema,
  target: targetSchema,
  when: guardSchema.optional(),
}).strict()
const paletteEntrySchema = z.object({
  id: z.string().regex(UI_ID_RE),
  label: text(80),
  keywords: z.array(z.string().max(40)).max(20).default([]),
  target: targetSchema,
  section: z.enum(['navigate', 'actions']).default('actions'),
  when: guardSchema.optional(),
}).strict()
const detailTabSchema = z.object({
  id: z.string().regex(UI_ID_RE),
  objectTypes: z.array(objectTypeSchema).min(1).max(10),
  label: text(40),
  order: z.number().int().min(0).max(1000).default(500),
  /** UI data source rendering the tab: returns { fields: [{label, value, href?}] } or { items: [...] }. */
  source: z.string().regex(CONTRIBUTION_KEY_RE),
  appliesWhen: z.string().max(200).regex(APPLIES_WHEN_RE).optional(),
  when: guardSchema.optional(),
}).strict()
const widgetSchema = z.object({
  id: z.string().regex(UI_ID_RE),
  title: text(60),
  description: z.string().max(200).optional(),
  render: z.enum(['metric', 'list']),
  /** UI data source: metric → { value, label?, tone?, href? }; list → { items: [{ title, href?, meta? }] }. */
  source: z.string().regex(CONTRIBUTION_KEY_RE),
  size: z.object({ w: z.number().int().min(1).max(12), h: z.number().int().min(1).max(12) }).strict().default({ w: 4, h: 2 }),
  when: guardSchema.optional(),
}).strict()
const notificationTypeSchema = z.object({
  key: z.string().regex(CONTRIBUTION_KEY_RE),
  label: text(80),
  description: z.string().max(300).optional(),
  defaultChannels: z.array(z.enum(['in_app', 'email'])).min(1).default(['in_app']),
  userConfigurable: z.boolean().default(true),
}).strict()
const settingsPageSchema = z.object({
  id: z.string().regex(UI_ID_RE),
  scope: z.enum(SETTINGS_SCOPES),
  /** An existing Settings group label (e.g. "Workspace", "Developers") or a new one. */
  group: text(40),
  label: text(40),
  icon: iconSchema.optional(),
  order: z.number().int().min(0).max(1000).default(500),
  description: z.string().max(500).optional(),
  schema: settingsSchemaSchema,
  when: guardSchema.optional(),
}).strict()
const pageSchema = z.object({
  /** /x/<id>/<path> (empty string = the extension's root page). */
  path: z.string().max(200).regex(/^[a-z0-9][a-z0-9/_-]*$|^$/),
  title: text(80),
  when: guardSchema.optional(),
}).strict()

const uiContributionsSchema = z.object({
  navSections: z.array(navSectionSchema).max(5).default([]),
  navItems: z.array(navItemSchema).max(20).default([]),
  createEntries: z.array(createEntrySchema).max(10).default([]),
  paletteEntries: z.array(paletteEntrySchema).max(20).default([]),
  userMenu: z.array(menuItemSchema).max(5).default([]),
  itemActions: z.array(itemActionSchema).max(40).default([]),
  detailTabs: z.array(detailTabSchema).max(20).default([]),
  widgets: z.array(widgetSchema).max(10).default([]),
  notificationTypes: z.array(notificationTypeSchema).max(30).default([]),
  settingsPages: z.array(settingsPageSchema).max(10).default([]),
  pages: z.array(pageSchema).max(30).default([]),
}).strict()
export type UiContributions = z.infer<typeof uiContributionsSchema>
export type NavSectionContribution = z.infer<typeof navSectionSchema>
export type NavItemContribution = z.infer<typeof navItemSchema>
export type MenuItemContribution = z.infer<typeof menuItemSchema>
export type ItemActionContribution = z.infer<typeof itemActionSchema>
export type CreateEntryContribution = z.infer<typeof createEntrySchema>
export type PaletteEntryContribution = z.infer<typeof paletteEntrySchema>
export type DetailTabContribution = z.infer<typeof detailTabSchema>
export type WidgetContribution = z.infer<typeof widgetSchema>
export type NotificationTypeContribution = z.infer<typeof notificationTypeSchema>
export type SettingsPageContribution = z.infer<typeof settingsPageSchema>
export type PageContribution = z.infer<typeof pageSchema>

const permissionSchema = z.object({
  /** `view` → the permission `ext.<id>.view`. */
  key: z.string().regex(CONTRIBUTION_KEY_RE),
  label: text(80),
  description: z.string().max(400).optional(),
  /** System roles seeded with it when a workspace enables the extension. */
  default_roles: z.array(z.enum(['owner', 'admin', 'manager', 'member', 'viewer'])).default(['owner', 'admin']),
  /**
   * Core permissions that imply it: anyone holding one of them holds this
   * permission too, without any role being edited (so existing roles never
   * lose access when an extension is added).
   */
  implied_by: z.array(z.string()).max(10).default([]),
}).strict()
export type ExtensionPermission = z.infer<typeof permissionSchema>

/* ── The manifest ───────────────────────────────────────────────────── */

export const extensionManifestSchema = z.object({
  manifest_version: z.literal(EXTENSION_MANIFEST_VERSION),
  id: z.string().max(EXTENSION_ID_MAX).regex(EXTENSION_ID_RE, 'id must be a lower-case slug (letters, digits, single hyphens), starting with a letter'),
  name: text(120),
  description: z.string().max(1000).optional(),
  version: z.string().refine(isSemver, 'version must be semver, e.g. 1.0.0'),
  publisher: z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/), name: text(120), url: z.string().url().optional() }).strict(),
  engines: z.object({
    usertasks: z.string().refine(isValidRange, 'engines.usertasks must be a semver range'),
    extension_sdk: z.string().refine(isValidRange, 'engines.extension_sdk must be a semver range').optional(),
  }).strict(),
  licence: z.object({
    tier: z.enum(['free', 'paid']),
    /** Product code the licence names (paid). */
    sku: z.string().regex(/^[a-z][a-z0-9._-]{1,80}$/).optional(),
    /** Licence features this extension checks (subsets of the product). */
    features: z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/)).max(40).default([]),
  }).strict(),
  deployments: z.array(z.enum(DEPLOYMENT_MODES)).min(1).default(['cloud', 'self_hosted']),
  homepage: z.string().url().optional(),
  icon: iconSchema.optional(),
  capabilities: z.object({
    /** Tables the extension owns: ext_<id>__* (enforced by the migration linter). */
    db: z.boolean().default(false),
    /** Outbound hosts (always through the egress guard); "admin-approved" = the hosts a workspace admin configures. */
    egress: z.union([z.array(z.string().max(253)).max(50), z.literal('admin-approved')]).optional(),
    /** Unauthenticated inbound routes under /ext-public/<id>/… (glob, e.g. "/receivers/*"). */
    inbound_public_routes: z.array(z.string().regex(/^\/[A-Za-z0-9/_*.-]*$/)).max(20).default([]),
    /** Secret names the extension stores (settings secret / certificate fields). */
    secrets: z.array(z.string().regex(CONTRIBUTION_KEY_RE)).max(20).default([]),
  }).strict().default({ db: false, inbound_public_routes: [], secrets: [] }),
  permissions: z.array(permissionSchema).max(40).default([]),
  contributes: z.object({
    nodes: z.array(nodeContributionSchema).max(60).default([]),
    triggers: z.array(triggerContributionSchema).max(20).default([]),
    /** Keys of the connectors the manifest module defines (ext.<id>.<key>). */
    connectors: z.array(z.string().regex(CONTRIBUTION_KEY_RE)).max(20).default([]),
    ui: uiContributionsSchema.default({
      navSections: [], navItems: [], createEntries: [], paletteEntries: [], userMenu: [], itemActions: [],
      detailTabs: [], widgets: [], notificationTypes: [], settingsPages: [], pages: [],
    }),
  }).strict().default({
    nodes: [], triggers: [], connectors: [],
    ui: { navSections: [], navItems: [], createEntries: [], paletteEntries: [], userMenu: [], itemActions: [], detailTabs: [], widgets: [], notificationTypes: [], settingsPages: [], pages: [] },
  }),
}).strict()

export type ExtensionManifest = z.output<typeof extensionManifestSchema>
export type ExtensionManifestInput = z.input<typeof extensionManifestSchema>

export class ExtensionManifestError extends Error {
  constructor(message: string, readonly issues: string[] = [message]) {
    super(message)
    this.name = 'ExtensionManifestError'
  }
}

function uniq<T>(items: T[], key: (item: T) => string, what: string, issues: string[]) {
  const seen = new Set<string>()
  for (const item of items) {
    const k = key(item)
    if (seen.has(k)) issues.push(`duplicate ${what} "${k}"`)
    seen.add(k)
  }
}

/** Permission keys an entry may name: core keys (checked by the caller) or this extension's `ext.<id>.<key>`. */
function guardPermissions(guard: ExtensionGuard | undefined): string[] {
  if (!guard) return []
  const all = typeof guard.permission === 'string' ? [guard.permission] : guard.permission ?? []
  return [...all, ...(guard.anyPermission ?? [])]
}

/**
 * Validate a manifest: the zod schema plus the cross-field rules (unique
 * ids, namespaced permission references, declared sections, features and
 * settings pages, reserved ids and prefixes). Throws ExtensionManifestError
 * listing every problem.
 */
export function parseExtensionManifest(raw: unknown): ExtensionManifest {
  const parsed = extensionManifestSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
    throw new ExtensionManifestError(`Invalid extension manifest: ${issues.join('; ')}`, issues)
  }
  const m = parsed.data
  const issues: string[] = []
  if (RESERVED_IDS.has(m.id)) issues.push(`id "${m.id}" is reserved`)
  if (m.id.startsWith(RESERVED_ID_PREFIX) && !FIRST_PARTY_PUBLISHERS.has(m.publisher.id)) issues.push(`the "${RESERVED_ID_PREFIX}" id prefix is reserved for first-party extensions`)
  if (m.licence.tier === 'paid' && !m.licence.sku) issues.push('licence.sku is required for paid extensions')
  if (m.engines.extension_sdk && !satisfiesSdk(m.engines.extension_sdk)) {
    // Reported by checkCompatibility as well; listed here so `ext validate` says it early.
    issues.push(`engines.extension_sdk "${m.engines.extension_sdk}" does not accept SDK ${EXTENSION_SDK_VERSION}`)
  }

  const prefix = `ext.${m.id}.`
  const ownPerms = new Set(m.permissions.map((p) => `${prefix}${p.key}`))
  uniq(m.permissions, (p) => p.key, 'permission', issues)
  const features = new Set(m.licence.features)
  const checkFeature = (feature: string | undefined, where: string) => {
    if (feature && !features.has(feature)) issues.push(`${where}: feature "${feature}" is not declared in licence.features`)
  }
  const checkGuard = (guard: ExtensionGuard | undefined, where: string) => {
    for (const perm of guardPermissions(guard)) {
      if (perm.startsWith('ext.') && !perm.startsWith(prefix)) issues.push(`${where}: may only name this extension's permissions (${prefix}*), not "${perm}"`)
      else if (perm.startsWith(prefix) && !ownPerms.has(perm)) issues.push(`${where}: permission "${perm}" is not declared in permissions`)
    }
    checkFeature(guard?.feature, where)
  }

  const c = m.contributes
  uniq(c.nodes, (n) => n.key, 'node', issues)
  uniq(c.triggers, (t) => t.key, 'trigger', issues)
  uniq(c.connectors, (k) => k, 'connector', issues)
  for (const node of c.nodes) checkFeature(node.feature, `node ${node.key}`)
  for (const trigger of c.triggers) checkFeature(trigger.feature, `trigger ${trigger.key}`)

  const ui = c.ui
  const sections = new Set(ui.navSections.map((s) => s.id))
  uniq(ui.navSections, (s) => s.id, 'nav section', issues)
  uniq(ui.navItems, (i) => i.id, 'nav item', issues)
  uniq(ui.createEntries, (i) => i.id, 'create entry', issues)
  uniq(ui.paletteEntries, (i) => i.id, 'palette entry', issues)
  uniq(ui.userMenu, (i) => i.id, 'user menu item', issues)
  uniq(ui.itemActions, (i) => i.id, 'item action', issues)
  uniq(ui.detailTabs, (i) => i.id, 'detail tab', issues)
  uniq(ui.widgets, (i) => i.id, 'widget', issues)
  uniq(ui.notificationTypes, (i) => i.key, 'notification type', issues)
  uniq(ui.settingsPages, (i) => i.id, 'settings page', issues)
  uniq(ui.pages, (p) => p.path, 'page', issues)
  const pages = new Set(ui.pages.map((p) => p.path))
  const settingsPages = new Set(ui.settingsPages.map((p) => p.id))
  const checkTarget = (target: ExtensionTarget, where: string) => {
    if ('page' in target && !pages.has(target.page)) issues.push(`${where}: page "${target.page}" is not declared in contributes.ui.pages`)
    if ('settings' in target && !settingsPages.has(target.settings)) issues.push(`${where}: settings page "${target.settings}" is not declared`)
  }
  const ownObjectType = (type: string, where: string) => {
    if (type.startsWith('ext:') && !type.startsWith(`ext:${m.id}.`)) issues.push(`${where}: extension object types must be ext:${m.id}.<type>`)
  }
  for (const section of ui.navSections) checkGuard(section.when, `nav section ${section.id}`)
  for (const item of ui.navItems) {
    checkGuard(item.when, `nav item ${item.id}`)
    checkTarget(item.target, `nav item ${item.id}`)
    if (item.group.startsWith('ext:') && !sections.has(item.group.slice(4))) issues.push(`nav item ${item.id}: section "${item.group.slice(4)}" is not declared in navSections`)
  }
  for (const entry of [...ui.createEntries, ...ui.paletteEntries, ...ui.userMenu]) {
    checkGuard(entry.when, `entry ${entry.id}`)
    checkTarget(entry.target, `entry ${entry.id}`)
  }
  for (const action of ui.itemActions) {
    checkGuard(action.when, `item action ${action.id}`)
    checkTarget(action.target, `item action ${action.id}`)
    for (const type of action.objectTypes) ownObjectType(type, `item action ${action.id}`)
    if (action.bulk && !('action' in action.target)) issues.push(`item action ${action.id}: bulk actions must target an action`)
  }
  for (const tab of ui.detailTabs) {
    checkGuard(tab.when, `detail tab ${tab.id}`)
    for (const type of tab.objectTypes) ownObjectType(type, `detail tab ${tab.id}`)
  }
  for (const widget of ui.widgets) checkGuard(widget.when, `widget ${widget.id}`)
  for (const page of ui.settingsPages) {
    checkGuard(page.when, `settings page ${page.id}`)
    const keys = page.schema.sections.flatMap((s) => s.fields)
    uniq(keys, (f) => f.key, `field in settings page ${page.id}`, issues)
    for (const field of keys) {
      if ((field.type === 'select' || field.type === 'multiselect') && !field.options?.length) issues.push(`settings page ${page.id}: field ${field.key} needs options`)
      if (field.pattern) {
        try { new RegExp(field.pattern.regex) } catch { issues.push(`settings page ${page.id}: field ${field.key} has an invalid pattern`) }
      }
    }
  }
  for (const page of ui.pages) checkGuard(page.when, `page ${page.path || '(root)'}`)
  if (issues.length) throw new ExtensionManifestError(`Invalid extension manifest "${m.id}": ${issues.join('; ')}`, issues)
  return m
}

function satisfiesSdk(range: string): boolean {
  try { return satisfiesRange(EXTENSION_SDK_VERSION, range) } catch { return false }
}

/* ── Naming helpers ─────────────────────────────────────────────────── */

/** `ext.<id>.<key>` — the namespaced form of a node type, trigger type, permission or connector key. */
export function extKey(extensionId: string, key: string): string {
  return `ext.${extensionId}.${key}`
}

/** `ext.<id>.<key>` → { extensionId, key } (null when not an extension key). */
export function parseExtKey(value: string): { extensionId: string; key: string } | null {
  const match = /^ext\.([a-z][a-z0-9-]*)\.([a-z][a-z0-9_]*)$/.exec(String(value ?? ''))
  return match ? { extensionId: match[1], key: match[2] } : null
}

/** Database table prefix an extension owns: `ext_<id with _>__`. */
export function extensionTablePrefix(extensionId: string): string {
  return `ext_${extensionId.replace(/-/g, '_')}__`
}

/** MCP tool name prefix: `ext_<id with _>_`. */
export function extensionToolPrefix(extensionId: string): string {
  return `ext_${extensionId.replace(/-/g, '_')}_`
}

/** Event type prefix an extension emits under: `ext.<id with _>.` (event types are [a-z0-9_] segments). */
export function extensionEventPrefix(extensionId: string): string {
  return `ext.${extensionId.replace(/-/g, '_')}.`
}
