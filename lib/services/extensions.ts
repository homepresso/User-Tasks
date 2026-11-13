/**
 * Extensions: the per-workspace lifecycle and settings of the extensions
 * compiled into this build. Shared by /api/v1/extensions, the MCP
 * extensions_* tools and Settings → Extensions.
 *
 *  - list / get: every extension in the build with its version, licence
 *    state (entitlement port), compatibility, whether it runs here and
 *    whether this workspace has it enabled (settings.view);
 *  - enable: needs settings.edit, a runnable extension and an entitlement;
 *    seeds the manifest's default_roles into the workspace's system roles
 *    and runs lifecycle.onEnable;
 *  - disable: hides the UI, stops its triggers, jobs and API for the
 *    workspace; settings, secrets and the extension's data are kept;
 *  - settings: typed by the manifest (workspace, instance or user scope),
 *    validated on the server with the same rules the form uses, secrets
 *    encrypted (lib/secret-crypto) and never returned, every change audited
 *    and versioned (config_version).
 *
 * Writes go through the service-role client after the permission checks;
 * members read state through RLS-free service calls here (tenant_extensions
 * has a SELECT policy for direct reads too).
 */

import { getServiceDb } from '@/lib/providers/db'
import { encryptSecret, isEncrypted } from '@/lib/secret-crypto'
import { writeAudit } from '@/lib/audit-log'
import { invalidateCredentialCache } from '@/lib/api-auth-cache'
import { getEntitlementPort } from '@/lib/extensions/entitlement-port'
import { createExtensionContext } from '@/lib/extensions/host'
import type { ExtensionManifest, SettingsPageContribution, SettingsScope } from '@/lib/extensions/manifest'
import { getExtensionManifest, getExtensionManifests, loadExtensionsReport } from '@/lib/extensions/registry'
import { checkCompatibility, getServerExtension, isExtensionRunnable, extensionProblems, PLATFORM_VERSION } from '@/lib/extensions/server-registry'
import { isSecretField, settingsDefaults, settingsFields, validateSettings } from '@/lib/extensions/settings'
import { invalidateTenantExtensions, isMissingTable, loadTenantExtensions } from '@/lib/extensions/state'
import { invalidateExtensionTriggerCache } from '@/lib/extensions/triggers'
import { requirePerm, ServiceError, type ServiceContext } from './context'

/* eslint-disable @typescript-eslint/no-explicit-any -- extension tables are not in the generated Database types */

export const MIGRATION_HINT = 'Apply migration 20270112000000_extension_framework.sql to use extensions'

export interface ExtensionSummary {
  id: string
  name: string
  description: string | null
  version: string
  publisher: { id: string; name: string }
  licence: { tier: 'free' | 'paid'; sku: string | null; state: string; allowed: boolean; reason: string | null }
  compatible: boolean
  runs_here: boolean
  problems: string[]
  enabled: boolean
  enabled_at: string | null
  config_version: number
  settings_pages: Array<{ id: string; scope: SettingsScope; label: string; group: string }>
  permissions: Array<{ key: string; label: string; implied_by: string[] }>
  contributes: { nodes: number; triggers: number; connectors: number; nav_items: number; settings_pages: number; pages: number }
}

async function summarize(ctx: ServiceContext, manifest: ExtensionManifest, rows: Map<string, any>): Promise<ExtensionSummary> {
  const decision = await getEntitlementPort().check({ tenantId: ctx.tenantId, extensionId: manifest.id })
  const compat = checkCompatibility(manifest)
  const problems = [
    ...compat.problems,
    ...(compat.deploymentSupported ? [] : [`not available in this deployment mode (supports ${manifest.deployments.join(', ')})`]),
    ...extensionProblems().filter((p) => p.includes(`"${manifest.id}"`)).map((p) => p.replace(/^Extension "[^"]+": /, '')),
  ]
  const row = rows.get(manifest.id)
  const ui = manifest.contributes.ui
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description ?? null,
    version: manifest.version,
    publisher: { id: manifest.publisher.id, name: manifest.publisher.name },
    licence: { tier: manifest.licence.tier, sku: manifest.licence.sku ?? null, state: decision.state, allowed: decision.allowed, reason: decision.reason ?? null },
    compatible: compat.compatible,
    runs_here: isExtensionRunnable(manifest.id),
    problems: [...new Set(problems)],
    enabled: row?.enabled === true,
    enabled_at: row?.enabled_at ?? null,
    config_version: Number(row?.config_version ?? 0),
    settings_pages: ui.settingsPages.map((p) => ({ id: p.id, scope: p.scope, label: p.label, group: p.group })),
    permissions: manifest.permissions.map((p) => ({ key: `ext.${manifest.id}.${p.key}`, label: p.label, implied_by: p.implied_by })),
    contributes: {
      nodes: manifest.contributes.nodes.length,
      triggers: manifest.contributes.triggers.length,
      connectors: manifest.contributes.connectors.length,
      nav_items: ui.navItems.length,
      settings_pages: ui.settingsPages.length,
      pages: ui.pages.length,
    },
  }
}

export async function listExtensions(ctx: ServiceContext) {
  requirePerm(ctx, 'settings.view')
  const manifests = getExtensionManifests()
  const { rows, missingTable } = await loadTenantExtensions(ctx.tenantId)
  const extensions = await Promise.all(manifests.map((m) => summarize(ctx, m, rows)))
  return {
    extensions,
    total: extensions.length,
    platform_version: PLATFORM_VERSION,
    problems: loadExtensionsReport().problems,
    ...(missingTable ? { notice: MIGRATION_HINT } : {}),
  }
}

function manifestOr404(id: string): ExtensionManifest {
  const manifest = getExtensionManifest(id)
  if (!manifest) throw ServiceError.notFound(`Extension "${id}" is not installed in this build`)
  return manifest
}

export async function getExtension(ctx: ServiceContext, id: string) {
  requirePerm(ctx, 'settings.view')
  return readExtension(ctx, id)
}

/** The summary without a permission check (after a change the caller was allowed to make). */
async function readExtension(ctx: ServiceContext, id: string) {
  const manifest = manifestOr404(id)
  const { rows } = await loadTenantExtensions(ctx.tenantId)
  return { extension: await summarize(ctx, manifest, rows) }
}

async function recordInstalledVersion(manifest: ExtensionManifest, actorId: string | null) {
  const db = getServiceDb() as any
  const { data } = await db.from('instance_extensions').select('installed_version').eq('extension_id', manifest.id).maybeSingle()
  if (data?.installed_version === manifest.version) return
  await db.from('instance_extensions').upsert({
    extension_id: manifest.id,
    installed_version: manifest.version,
    previous_version: data?.installed_version ?? null,
    updated_at: new Date().toISOString(),
    updated_by: actorId,
  }, { onConflict: 'extension_id' })
}

/** Give the workspace's system roles the manifest's default_roles permissions (additive). */
async function seedDefaultRoles(ctx: ServiceContext, manifest: ExtensionManifest): Promise<number> {
  const bySlug = new Map<string, string[]>()
  for (const p of manifest.permissions) for (const slug of p.default_roles) bySlug.set(slug, [...(bySlug.get(slug) ?? []), `ext.${manifest.id}.${p.key}`])
  if (!bySlug.size) return 0
  const db = getServiceDb() as any
  const { data: roles, error } = await db.from('roles').select('id, slug, permissions').eq('tenant_id', ctx.tenantId).eq('is_system', true).in('slug', [...bySlug.keys()])
  if (error) throw new Error(error.message)
  let changed = 0
  for (const role of (roles ?? []) as Array<{ id: string; slug: string; permissions: string[] | null }>) {
    const current = new Set(role.permissions ?? [])
    const add = (bySlug.get(role.slug) ?? []).filter((p) => !current.has(p))
    if (!add.length) continue
    const { error: updateError } = await db.from('roles').update({ permissions: [...current, ...add], updated_at: new Date().toISOString() }).eq('id', role.id).eq('tenant_id', ctx.tenantId)
    if (updateError) throw new Error(updateError.message)
    changed++
  }
  if (changed) await invalidateCredentialCache()
  return changed
}

function auditExtension(ctx: ServiceContext, manifest: ExtensionManifest, action: string, summary: string, metadata: Record<string, unknown> = {}) {
  return writeAudit({
    supabase: getServiceDb() as any,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId ?? ctx.credentialOwnerId ?? null,
    objectType: 'extension',
    objectId: manifest.id,
    action,
    summary,
    metadata: { extension: manifest.id, version: manifest.version, source: ctx.source, ...metadata },
  })
}

function tableError(error: { code?: string; message?: string }): Error {
  return isMissingTable(error) ? ServiceError.conflict(MIGRATION_HINT) : new Error(error.message)
}

export async function enableExtension(ctx: ServiceContext, id: string) {
  requirePerm(ctx, 'settings.edit')
  const manifest = manifestOr404(id)
  if (!isExtensionRunnable(id)) throw ServiceError.conflict(`${manifest.name} cannot run in this build: ${checkCompatibility(manifest).problems.join('; ') || 'see Settings → Extensions'}`)
  const decision = await getEntitlementPort().check({ tenantId: ctx.tenantId, extensionId: id })
  if (!decision.allowed) throw new ServiceError('payment_required', decision.reason ?? `${manifest.name} is not licensed`)
  const now = new Date().toISOString()
  const db = getServiceDb() as any
  const { error } = await db.from('tenant_extensions').upsert({
    tenant_id: ctx.tenantId, extension_id: id, enabled: true, enabled_by: ctx.actorId, enabled_at: now, disabled_at: null, updated_at: now, updated_by: ctx.actorId,
  }, { onConflict: 'tenant_id,extension_id' })
  if (error) throw tableError(error)
  invalidateTenantExtensions(ctx.tenantId)
  invalidateExtensionTriggerCache(ctx.tenantId)
  await recordInstalledVersion(manifest, ctx.actorId).catch(() => undefined)
  const rolesUpdated = await seedDefaultRoles(ctx, manifest)
  const hook = getServerExtension(id)?.lifecycle?.onEnable
  if (hook) await hook(createExtensionContext({ extensionId: id, tenantId: ctx.tenantId, actorId: ctx.actorId }))
  await auditExtension(ctx, manifest, 'toggle', `Enabled extension ${manifest.name}`, { enabled: true, roles_updated: rolesUpdated })
  return readExtension(ctx, id)
}

export async function disableExtension(ctx: ServiceContext, id: string) {
  requirePerm(ctx, 'settings.edit')
  const manifest = manifestOr404(id)
  const now = new Date().toISOString()
  const db = getServiceDb() as any
  const { data, error } = await db.from('tenant_extensions').update({ enabled: false, disabled_at: now, updated_at: now, updated_by: ctx.actorId })
    .eq('tenant_id', ctx.tenantId).eq('extension_id', id).select('extension_id')
  if (error) throw tableError(error)
  invalidateTenantExtensions(ctx.tenantId)
  invalidateExtensionTriggerCache(ctx.tenantId)
  if ((data ?? []).length) {
    const hook = getServerExtension(id)?.lifecycle?.onDisable
    if (hook) await hook(createExtensionContext({ extensionId: id, tenantId: ctx.tenantId, actorId: ctx.actorId })).catch((e) => console.warn(`[ext:${id}] onDisable failed:`, e))
    await auditExtension(ctx, manifest, 'toggle', `Disabled extension ${manifest.name} (settings and data kept)`, { enabled: false })
  }
  return readExtension(ctx, id)
}

/* ── Settings ─────────────────────────────────────────────────────── */

export interface SettingsAccess {
  /** Instance admin (instance scope), resolved by the caller (session only). */
  instanceAdmin?: boolean
}

function settingsPage(manifest: ExtensionManifest, pageId: string): SettingsPageContribution {
  const page = manifest.contributes.ui.settingsPages.find((p) => p.id === pageId)
  if (!page) throw ServiceError.notFound(`${manifest.name} has no settings page "${pageId}"`)
  return page
}

function checkScopeAccess(ctx: ServiceContext, page: SettingsPageContribution, write: boolean, access: SettingsAccess) {
  if (page.scope === 'workspace') requirePerm(ctx, write ? 'settings.edit' : 'settings.view')
  else if (page.scope === 'instance') {
    if (!access.instanceAdmin) throw ServiceError.forbidden('Instance settings are for instance administrators')
  } else if (!ctx.actorId) {
    throw ServiceError.forbidden('Personal settings need a signed-in user (or a user API key)')
  }
}

function secretsSetOf(page: SettingsPageContribution, stored: Record<string, unknown>): string[] {
  return settingsFields(page.schema).filter((f) => isSecretField(f) && typeof stored[f.key] === 'string' && stored[f.key]).map((f) => f.key)
}

async function readScope(ctx: ServiceContext, manifest: ExtensionManifest, page: SettingsPageContribution): Promise<{ config: Record<string, unknown>; secrets: Record<string, unknown>; version: number }> {
  const db = getServiceDb() as any
  if (page.scope === 'workspace') {
    const { data, error } = await db.from('tenant_extensions').select('config, secrets, config_version').eq('tenant_id', ctx.tenantId).eq('extension_id', manifest.id).maybeSingle()
    if (error) throw tableError(error)
    return { config: data?.config ?? {}, secrets: data?.secrets ?? {}, version: Number(data?.config_version ?? 0) }
  }
  if (page.scope === 'instance') {
    const { data, error } = await db.from('instance_extensions').select('config, secrets, config_version').eq('extension_id', manifest.id).maybeSingle()
    if (error) throw tableError(error)
    return { config: data?.config ?? {}, secrets: data?.secrets ?? {}, version: Number(data?.config_version ?? 0) }
  }
  const { data, error } = await db.from('users').select('preferences').eq('id', ctx.actorId).maybeSingle()
  if (error) throw new Error(error.message)
  const prefs = ((data?.preferences ?? {}) as Record<string, any>).ext?.[manifest.id] ?? {}
  return { config: prefs, secrets: {}, version: 0 }
}

/** The page's fields and current values (secrets: only whether each is set). */
export async function getExtensionSettings(ctx: ServiceContext, id: string, pageId: string, access: SettingsAccess = {}) {
  const manifest = manifestOr404(id)
  const page = settingsPage(manifest, pageId)
  checkScopeAccess(ctx, page, false, access)
  return readSettings(ctx, manifest, page)
}

async function readSettings(ctx: ServiceContext, manifest: ExtensionManifest, page: SettingsPageContribution) {
  const id = manifest.id
  const stored = await readScope(ctx, manifest, page)
  const fieldKeys = new Set(settingsFields(page.schema).filter((f) => !isSecretField(f)).map((f) => f.key))
  const values = { ...settingsDefaults(page.schema), ...Object.fromEntries(Object.entries(stored.config).filter(([k]) => fieldKeys.has(k))) }
  return {
    extension_id: id,
    page: { id: page.id, scope: page.scope, label: page.label, description: page.description ?? null, schema: page.schema },
    values,
    secrets_set: secretsSetOf(page, stored.secrets),
    config_version: stored.version,
  }
}

/** Validate and save one settings page (only the page's own keys change). */
export async function updateExtensionSettings(ctx: ServiceContext, id: string, pageId: string, input: Record<string, unknown>, access: SettingsAccess = {}) {
  const manifest = manifestOr404(id)
  const page = settingsPage(manifest, pageId)
  checkScopeAccess(ctx, page, true, access)
  const stored = await readScope(ctx, manifest, page)
  const validated = validateSettings(page.schema, input ?? {}, new Set(secretsSetOf(page, stored.secrets)))
  if (Object.keys(validated.errors).length) {
    throw ServiceError.validation(`Invalid settings: ${Object.values(validated.errors).join('; ')}`, { fields: validated.errors })
  }
  const hook = getServerExtension(id)?.settings?.validate
  if (hook) {
    const messages = await hook({ ctx: createExtensionContext({ extensionId: id, tenantId: ctx.tenantId, actorId: ctx.actorId }), scope: page.scope, page: page.id, values: validated.values })
    if (messages.length) throw ServiceError.validation(`Invalid settings: ${messages.join('; ')}`, { messages })
  }
  if (page.scope === 'user' && Object.keys(validated.secrets).length) throw ServiceError.validation('Personal settings cannot hold secrets')

  const secrets: Record<string, unknown> = { ...stored.secrets }
  for (const [key, value] of Object.entries(validated.secrets)) {
    if (value === null) delete secrets[key]
    else {
      const ciphertext = encryptSecret(value)
      if (!isEncrypted(ciphertext)) throw ServiceError.conflict('ENCRYPTION_KEY must be set to store secrets')
      secrets[key] = ciphertext
    }
  }
  const config = { ...stored.config, ...validated.values }
  const version = stored.version + 1
  const now = new Date().toISOString()
  const db = getServiceDb() as any
  if (page.scope === 'workspace') {
    const { error } = await db.from('tenant_extensions').upsert({
      tenant_id: ctx.tenantId, extension_id: id, config, secrets, config_version: version, updated_at: now, updated_by: ctx.actorId,
    }, { onConflict: 'tenant_id,extension_id' })
    if (error) throw tableError(error)
    invalidateTenantExtensions(ctx.tenantId)
  } else if (page.scope === 'instance') {
    const { error } = await db.from('instance_extensions').upsert({
      extension_id: id, installed_version: manifest.version, config, secrets, config_version: version, updated_at: now, updated_by: ctx.actorId,
    }, { onConflict: 'extension_id' })
    if (error) throw tableError(error)
  } else {
    const { data } = await db.from('users').select('preferences').eq('id', ctx.actorId).maybeSingle()
    const prefs = (data?.preferences ?? {}) as Record<string, any>
    const next = { ...prefs, ext: { ...(prefs.ext ?? {}), [id]: config } }
    const { error } = await db.from('users').update({ preferences: next }).eq('id', ctx.actorId)
    if (error) throw new Error(error.message)
  }
  if (page.scope !== 'user') {
    await auditExtension(ctx, manifest, 'update', `Updated ${manifest.name} settings (${page.label})`, {
      event: 'settings.updated', page: page.id, scope: page.scope, fields: Object.keys(validated.values), secrets_changed: Object.keys(validated.secrets), config_version: version,
    })
  }
  return readSettings(ctx, manifest, page)
}
