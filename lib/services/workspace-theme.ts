/**
 * The workspace brand theme (`workspace_themes`, one row per tenant).
 *
 * Reads: any member (RLS lets members SELECT their workspace's row; the
 * dashboard layout reads it with the session client). Writes: `settings.edit`
 * only, through here — validated against the WorkspaceTheme schema, contrast
 * checked (pairs below 3:1 are refused), audited, and versioned with an
 * optimistic check so two editors can't silently overwrite each other. End
 * users have no write policy on the table; the service role writes.
 */

import { createHash } from 'node:crypto'
import { requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'
import { blockingContrastIssues, checkThemeContrast, type ContrastIssue } from '@/lib/theme/contrast'
import { FONT_FAMILY_RE } from '@/lib/theme/fonts'
import { THEME_TEMPLATES, defaultWorkspaceTheme, presetToWorkspaceTheme, type ThemeTemplate } from '@/lib/theme/presets'
import { parseStoredTheme } from '@/lib/theme/resolve'
import { MAX_THEME_BYTES, WorkspaceThemeSchema, formatThemeIssues, isOwnStorageUrl, type FontRef, type WorkspaceTheme } from '@/lib/theme/schema'
import { getPublicConfig } from '@/lib/config/public'
import { getStorageProviderFor, getStorageProviderId } from '@/lib/providers/storage'
import type { ProviderId } from '@/lib/config/schema'
import { persistableStorageValue } from '@/lib/storage/persist'
import { parseOwnStorageUrl, resolveStorageUrl, storageObjectUrl, tenantFolderObject } from '@/lib/storage/refs'

/* eslint-disable @typescript-eslint/no-explicit-any -- workspace_themes is not in the generated types yet */

export interface WorkspaceThemeRecord {
  theme: WorkspaceTheme
  /** 0 when the workspace has no stored row (platform default). */
  version: number
  updatedAt: string | null
  updatedBy: string | null
}

/** Stored theme for a tenant (expanded / defaulted), with the client the caller supplies. */
export async function readWorkspaceTheme(client: AnySupabaseClient, tenantId: string): Promise<WorkspaceThemeRecord> {
  const { data, error } = await (client as any)
    .from('workspace_themes')
    .select('theme, version, updated_at, updated_by')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw dbError(error)
  return {
    theme: parseStoredTheme(data?.theme),
    version: typeof data?.version === 'number' ? data.version : 0,
    updatedAt: data?.updated_at ?? null,
    updatedBy: data?.updated_by ?? null,
  }
}

export async function getWorkspaceTheme(ctx: ServiceContext): Promise<WorkspaceThemeRecord & { contrast: ContrastIssue[] }> {
  const record = await readWorkspaceTheme(ctx.supabase, ctx.tenantId)
  return { ...record, contrast: checkThemeContrast(record.theme) }
}

/** Uploaded images / fonts must sit in this workspace's own storage folder. */
function assertOwnAssets(theme: WorkspaceTheme, tenantId: string) {
  const inFolder = (url: string, bucket: string) => tenantFolderObject(url, bucket, tenantId) !== null
  for (const [key, url] of Object.entries(theme.branding)) {
    if (key !== 'wordmark' && typeof url === 'string' && !inFolder(url, 'logos')) {
      throw ServiceError.validation(`branding.${key} must be an upload in this workspace's logos folder`)
    }
  }
  for (const slot of ['sans', 'display', 'mono'] as const) {
    const font = theme.typography[slot]
    if (font.source === 'upload' && !inFolder(font.url, 'brand-fonts')) {
      throw ServiceError.validation(`typography.${slot}.url must be an upload in this workspace's brand-fonts folder`)
    }
  }
}

const FONT_SLOTS = ['sans', 'display', 'mono'] as const
const IMAGE_KEYS = ['logoLight', 'logoDark', 'favicon'] as const

function mapThemeAssets(theme: WorkspaceTheme, map: (value: string) => string): WorkspaceTheme {
  const out = structuredClone(theme)
  for (const key of IMAGE_KEYS) {
    const value = out.branding[key]
    if (typeof value === 'string') out.branding[key] = map(value)
  }
  for (const slot of FONT_SLOTS) {
    const font = out.typography[slot]
    if (font.source === 'upload') out.typography[slot] = { ...font, url: map(font.url) }
  }
  return out
}

/** Logos / fonts in the stored form for the provider (lib/storage/persist.ts). */
function persistThemeAssets(theme: WorkspaceTheme, providerId: ProviderId<'storage'>): WorkspaceTheme {
  return mapThemeAssets(theme, (value) => String(persistableStorageValue(value, providerId)))
}

/** Logos / fonts as usable absolute URLs (REST / MCP / manifests show URLs, never storage:// references). */
export function resolveThemeAssets(theme: WorkspaceTheme): WorkspaceTheme {
  return mapThemeAssets(theme, (value) => resolveStorageUrl(value, { absolute: true }))
}

export interface UpdateWorkspaceThemeOptions {
  /** Reject with 409 unless the stored version still equals this. */
  expectedVersion?: number
  /** Audit summary override (e.g. "Applied the Noir template"). */
  summary?: string
}

export async function updateWorkspaceTheme(ctx: ServiceContext, input: unknown, opts: UpdateWorkspaceThemeOptions = {}) {
  requirePerm(ctx, 'settings.edit')
  let size = 0
  try { size = JSON.stringify(input ?? null).length } catch { throw ServiceError.validation('theme must be JSON') }
  if (size > MAX_THEME_BYTES) throw ServiceError.validation(`theme is larger than ${MAX_THEME_BYTES} bytes`)

  const parsed = WorkspaceThemeSchema.safeParse(input)
  if (!parsed.success) {
    throw new ServiceError('validation_error', `Invalid theme: ${formatThemeIssues(parsed.error)}`, { details: parsed.error.issues })
  }
  assertOwnAssets(parsed.data, ctx.tenantId)
  const theme = persistThemeAssets(parsed.data, await getStorageProviderId())
  const blocking = blockingContrastIssues(theme)
  if (blocking.length) {
    const first = blocking[0]
    throw new ServiceError(
      'validation_error',
      `Contrast too low: ${first.pair} in ${first.mode} mode is ${first.ratio}:1 (needs ${first.required}:1)`,
      { details: blocking },
    )
  }

  const db = await serviceRoleClient(ctx)
  const { data: current, error: readErr } = await (db as any)
    .from('workspace_themes').select('version, theme').eq('tenant_id', ctx.tenantId).maybeSingle()
  if (readErr) throw dbError(readErr)
  const currentVersion: number = current?.version ?? 0
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== currentVersion) {
    throw ServiceError.conflict(`The theme was changed by someone else (version ${currentVersion}); reload and try again`)
  }

  const row = { theme, version: currentVersion + 1, updated_by: ctx.actorId, updated_at: new Date().toISOString() }
  if (current) {
    const { data, error } = await (db as any).from('workspace_themes').update(row)
      .eq('tenant_id', ctx.tenantId).eq('version', currentVersion).select('version')
    if (error) throw dbError(error)
    if (!data || data.length === 0) throw ServiceError.conflict('The theme was changed by someone else; reload and try again')
  } else {
    const { error } = await (db as any).from('workspace_themes').insert({ tenant_id: ctx.tenantId, ...row })
    if (error) {
      if (error.code === '23505') throw ServiceError.conflict('The theme was changed by someone else; reload and try again')
      throw dbError(error)
    }
  }

  const before = current ? parseStoredTheme(current.theme) : null
  await audit(ctx, {
    objectType: 'theme', objectId: ctx.tenantId, action: 'update',
    summary: opts.summary ?? `Updated the workspace theme "${theme.meta.name}"`,
    metadata: { version: row.version, base_preset: theme.meta.basePreset ?? null, previous: before?.meta.name ?? null },
  })
  return { theme, version: row.version, updatedAt: row.updated_at, updatedBy: ctx.actorId, contrast: checkThemeContrast(theme) }
}

/** Replace the workspace theme with a built-in template. */
export async function applyWorkspaceThemePreset(ctx: ServiceContext, presetId: string, opts: Omit<UpdateWorkspaceThemeOptions, 'summary'> = {}) {
  requirePerm(ctx, 'settings.edit')
  const theme = typeof presetId === 'string' ? presetToWorkspaceTheme(presetId) : null
  if (!theme) throw ServiceError.validation(`Unknown theme template "${String(presetId)}"`)
  return updateWorkspaceTheme(ctx, theme, { ...opts, summary: `Applied the "${theme.meta.name}" theme template to the workspace` })
}

// ── templates ───────────────────────────────────────────────────────────────

export interface WorkspaceThemePresetSummary extends ThemeTemplate {
  /** A few colours per mode, for thumbnails. */
  swatches: Record<'light' | 'dark', { primary: string; accent: string; sidebar: string; topbar: string; surface: string; card: string }>
}

/** The built-in starting templates (any member may list them). */
export function listWorkspaceThemePresets(): { presets: WorkspaceThemePresetSummary[]; total: number } {
  const presets = THEME_TEMPLATES.map((template) => {
    const theme = presetToWorkspaceTheme(template.id)!
    const swatch = (p: WorkspaceTheme['colors']['light']) => ({
      primary: p.primary, accent: p.accent, sidebar: p.sidebar, topbar: p.topbar, surface: p.surface, card: p.cardBg,
    })
    return { ...template, swatches: { light: swatch(theme.colors.light), dark: swatch(theme.colors.dark) } }
  })
  return { presets, total: presets.length }
}

// ── uploaded fonts ──────────────────────────────────────────────────────────

export const FONT_BUCKET = 'brand-fonts'
/** Largest woff2 file accepted (the bucket enforces the same limit). */
export const MAX_FONT_BYTES = 1024 * 1024
/** woff2 files start with the signature `wOF2`. */
const WOFF2_SIGNATURE = [0x77, 0x4f, 0x46, 0x32]
const FONT_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.woff2$/

export interface FontUploadInput {
  /** Original file name (`AcmeSans-Regular.woff2`); used for the family when none is given. */
  fileName: string
  bytes: Uint8Array
  /** CSS family name to register; derived from the file name when omitted. */
  family?: string | null
}

/** Family name from a file name: `AcmeSans-Bold.woff2` → `AcmeSans Bold`. */
export function familyFromFileName(fileName: string): string {
  const stem = String(fileName ?? '').replace(/\.[^.]*$/, '')
  return stem.replace(/[_-]+/g, ' ').replace(/[^A-Za-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 64)
}

/**
 * Checks an upload without touching storage: woff2 name and signature, size
 * (1 byte – 1 MB) and a CSS-safe family name. Returns the family to register.
 */
export function validateFontUpload(input: FontUploadInput): { family: string } {
  const fileName = String(input?.fileName ?? '').trim()
  if (!/\.woff2$/i.test(fileName)) throw ServiceError.validation('Only .woff2 font files can be uploaded')
  const bytes = input.bytes
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw ServiceError.validation('The font file is empty')
  if (bytes.byteLength > MAX_FONT_BYTES) {
    throw new ServiceError('validation_error', `Font files can be at most ${MAX_FONT_BYTES / 1024 / 1024} MB`, { status: 413 })
  }
  if (!WOFF2_SIGNATURE.every((byte, i) => bytes[i] === byte)) throw ServiceError.validation('The file is not a woff2 font')
  const family = (input.family ?? '').trim() || familyFromFileName(fileName)
  if (!FONT_FAMILY_RE.test(family)) {
    throw ServiceError.validation('Font family names may contain letters, digits, spaces and hyphens only (1-64 characters)')
  }
  return { family }
}

/** Usable (absolute) URL of a file in this workspace's brand-fonts folder for the configured provider. */
export function workspaceFontUrl(tenantId: string, fileName: string, supabaseUrl?: string): string {
  const config = supabaseUrl === undefined ? getPublicConfig() : { ...getPublicConfig(), supabaseUrl }
  return storageObjectUrl(FONT_BUCKET, `${tenantId}/${fileName}`, { absolute: true, config })
}

/**
 * Store a woff2 file in `brand-fonts/<tenant>/` (settings.edit). The object
 * name is the family slug plus a content hash, so uploading the same file
 * twice is idempotent. Returns the FontRef to put in the theme.
 */
export async function uploadWorkspaceThemeFont(ctx: ServiceContext, input: FontUploadInput) {
  requirePerm(ctx, 'settings.edit')
  const { family } = validateFontUpload(input)
  const hash = createHash('sha256').update(input.bytes).digest('hex').slice(0, 12)
  const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'font'
  const fileName = `${slug}-${hash}.woff2`
  const path = `${ctx.tenantId}/${fileName}`

  const storage = await getStorageProviderFor(await serviceRoleClient(ctx))
  try {
    await storage.put(FONT_BUCKET, path, input.bytes, { contentType: 'font/woff2', upsert: true, cacheControl: '31536000' })
  } catch (error) {
    throw dbError(error as { message?: string }, 'Could not store the font file')
  }

  const font: FontRef = { source: 'upload', family, url: workspaceFontUrl(ctx.tenantId, fileName) }
  await audit(ctx, {
    objectType: 'theme', objectId: ctx.tenantId, action: 'create',
    summary: `Uploaded the font "${family}" for the workspace theme`,
    metadata: { path, size: input.bytes.byteLength },
  })
  return { font, path: fileName, size: input.bytes.byteLength }
}

/** Whether `fileName` exists in this workspace's brand-fonts folder. */
async function workspaceFontExists(ctx: ServiceContext, fileName: string): Promise<boolean> {
  try {
    const storage = await getStorageProviderFor(await serviceRoleClient(ctx))
    return Boolean(await storage.head(FONT_BUCKET, `${ctx.tenantId}/${fileName}`))
  } catch {
    return false
  }
}

// ── config-as-code (manifest section `workspace_theme`) ─────────────────────

function tenantFolderFile(url: string, bucket: string, tenantId: string): string | null {
  return tenantFolderObject(url, bucket, tenantId)
}

/**
 * Stored theme → manifest form: uploaded fonts in this workspace's folder are
 * referenced by file name (`{ source: 'upload', family, path }`) so the same
 * files resolve in another environment; logos keep their URL.
 */
export function workspaceThemeToManifest(theme: WorkspaceTheme, tenantId: string): Record<string, any> {
  const out: Record<string, any> = resolveThemeAssets(theme)
  for (const slot of FONT_SLOTS) {
    const font = theme.typography[slot]
    if (font.source !== 'upload') continue
    const file = tenantFolderFile(font.url, FONT_BUCKET, tenantId)
    if (file) out.typography[slot] = { source: 'upload', family: font.family, path: file }
  }
  return out
}

export interface ResolvedManifestTheme {
  theme?: WorkspaceTheme
  error?: string
  warnings: string[]
}

/**
 * Manifest `workspace_theme` → a theme this workspace can store.
 *
 * - Uploaded fonts (`path`, or a `url` from any environment) resolve to the
 *   same file name in this workspace's brand-fonts folder; when the file is
 *   not there the slot falls back to the platform default font, with a
 *   warning (upload it, then apply again).
 * - Logo / dark logo / favicon URLs that are not this workspace's own uploads
 *   (another project's storage or another workspace) are dropped, with a warning.
 * - Then the usual schema + contrast validation (errors, not warnings).
 */
export async function resolveManifestWorkspaceTheme(ctx: ServiceContext, value: unknown): Promise<ResolvedManifestTheme> {
  const warnings: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'workspace_theme must be an object', warnings }
  const draft: Record<string, any> = structuredClone(value as Record<string, any>)
  const fallback = defaultWorkspaceTheme().typography

  for (const slot of FONT_SLOTS) {
    const font = draft.typography?.[slot]
    if (!font || typeof font !== 'object' || font.source !== 'upload') continue
    const own = typeof font.url === 'string' ? tenantFolderFile(font.url, FONT_BUCKET, ctx.tenantId) : null
    const ownOrigin = typeof font.url === 'string' && isOwnStorageUrl(font.url, [FONT_BUCKET])
    let fileName: string | null = null
    if (typeof font.path === 'string') fileName = font.path.split('/').pop() ?? null
    else if (typeof font.url === 'string') {
      const own = parseOwnStorageUrl(font.url)
      if (own) fileName = own.key.split('/').pop() ?? null
      else {
        try { fileName = decodeURIComponent(new URL(font.url).pathname.split('/').pop() ?? '') } catch { fileName = null }
      }
    }
    if (own && ownOrigin && !font.path) continue
    if (fileName && FONT_FILE_RE.test(fileName) && await workspaceFontExists(ctx, fileName)) {
      draft.typography[slot] = { source: 'upload', family: font.family, url: workspaceFontUrl(ctx.tenantId, fileName) }
      continue
    }
    draft.typography[slot] = fallback[slot]
    const file = fileName ? `"${fileName}"` : 'for this slot'
    warnings.push(`typography.${slot}: the font file ${file} is not uploaded to this workspace; using ${fallback[slot].family} instead (upload it, then apply again)`)
  }

  for (const key of IMAGE_KEYS) {
    const url = draft.branding?.[key]
    if (url === undefined || url === null) { if (draft.branding) delete draft.branding[key]; continue }
    if (typeof url === 'string' && isOwnStorageUrl(url, ['logos']) && tenantFolderFile(url, 'logos', ctx.tenantId)) continue
    delete draft.branding[key]
    warnings.push(`branding.${key}: dropped — the image is not an upload in this workspace (re-upload it in the theme designer)`)
  }

  const parsed = WorkspaceThemeSchema.safeParse(draft)
  if (!parsed.success) return { error: `Invalid theme: ${formatThemeIssues(parsed.error)}`, warnings }
  const blocking = blockingContrastIssues(parsed.data)
  if (blocking.length) {
    const first = blocking[0]
    return { error: `Contrast too low: ${first.pair} in ${first.mode} mode is ${first.ratio}:1 (needs ${first.required}:1)`, warnings }
  }
  return { theme: parsed.data, warnings }
}

// ── REST / MCP shape ────────────────────────────────────────────────────────

/** `{ workspace_theme, version, updated_at, updated_by, contrast }` (GET/PUT /workspace-theme, MCP). */
export function presentWorkspaceTheme(record: { theme: WorkspaceTheme; version: number; updatedAt: string | null; updatedBy: string | null; contrast: ContrastIssue[] }) {
  return {
    workspace_theme: resolveThemeAssets(record.theme),
    version: record.version,
    updated_at: record.updatedAt,
    updated_by: record.updatedBy,
    contrast: record.contrast,
  }
}

/** Members of the workspace (home tenant or active membership) — the designer's "applies to N members". */
export async function countWorkspaceMembers(ctx: ServiceContext): Promise<number> {
  const db = await serviceRoleClient(ctx)
  const [home, memberships] = await Promise.all([
    (db as any).from('users').select('id').eq('tenant_id', ctx.tenantId).is('deleted_at', null),
    (db as any).from('user_memberships').select('user_id').eq('tenant_id', ctx.tenantId).eq('is_active', true),
  ])
  if (home.error) throw dbError(home.error)
  if (memberships.error) throw dbError(memberships.error)
  const ids = new Set<string>([
    ...((home.data ?? []) as Array<{ id: string }>).map((r) => r.id),
    ...((memberships.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
  ])
  return ids.size
}
