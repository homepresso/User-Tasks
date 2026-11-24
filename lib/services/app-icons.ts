/**
 * The workspace's uploaded app icons (custom SVG): a small library reused
 * across apps (tenants.settings.apps.icons — no migration). Uploading needs
 * edit access to an app (its editors, or apps.manage); anyone who can open
 * apps lists them (they are drawn on app cards, menus and buttons). Files are
 * cleaned (lib/apps/icon-svg.ts), stored through the storage provider at
 * task-files/app-icons/<tenant>/<uuid>.svg and served by /files (nosniff,
 * sandboxing CSP). Audited.
 */

import { APP_ICON_MAX_BYTES, MAX_LIBRARY_ICONS, cleanAppIconSvg, customIconToken } from '@/lib/apps/icon-svg'
import { getStorageProvider } from '@/lib/providers/storage'
import { fileRefFields } from '@/lib/storage/persist'
import { hasPerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'
import { getAppAccess } from './apps'

/* eslint-disable @typescript-eslint/no-explicit-any -- tenants JSON */

export interface AppIcon { id: string; token: string; name: string; url: string; tint: boolean; created_at: string }

async function loadLibrary(ctx: ServiceContext) {
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('tenants').select('id, settings').eq('id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workspace not found')
  const settings = (data.settings && typeof data.settings === 'object' ? data.settings : {}) as Record<string, any>
  const apps = (settings.apps && typeof settings.apps === 'object' ? settings.apps : {}) as Record<string, any>
  const icons = (Array.isArray(apps.icons) ? apps.icons : []) as AppIcon[]
  return { db, settings, apps, icons }
}

export async function listAppIcons(ctx: ServiceContext): Promise<AppIcon[]> {
  if (!hasPerm(ctx, 'apps.view') && !hasPerm(ctx, 'apps.manage')) return []
  return (await loadLibrary(ctx)).icons
}

export async function uploadAppIcon(ctx: ServiceContext, input: { app: string; name: string; type: string; bytes: Uint8Array; tint?: boolean }): Promise<AppIcon> {
  if ((await getAppAccess(ctx, input.app)) !== 'edit') throw ServiceError.forbidden('Only an app’s editors can upload icons')
  if (!(input.bytes instanceof Uint8Array) || !input.bytes.byteLength) throw ServiceError.validation('The file is empty')
  if (input.bytes.byteLength > APP_ICON_MAX_BYTES) throw new ServiceError('validation_error', 'Icons must be under 100 KB', { status: 413 })
  if (input.type && input.type !== 'image/svg+xml') throw ServiceError.validation('Upload an SVG file')
  const clean = cleanAppIconSvg(new TextDecoder().decode(input.bytes))
  if (!clean) throw ServiceError.validation('That SVG could not be used (it is not a valid, safe SVG image)')
  const lib = await loadLibrary(ctx)
  if (lib.icons.length >= MAX_LIBRARY_ICONS) throw ServiceError.validation(`The icon library is full (${MAX_LIBRARY_ICONS} icons)`)
  const id = crypto.randomUUID()
  const path = `app-icons/${ctx.tenantId}/${id}.svg`
  const storage = await getStorageProvider()
  try {
    await storage.put('task-files', path, new TextEncoder().encode(clean), { contentType: 'image/svg+xml' })
  } catch (error) {
    throw dbError(error as { message?: string }, 'Upload failed')
  }
  const ref = fileRefFields('task-files', path, storage.id).ref
  const icon: AppIcon = { id, token: customIconToken(id), name: String(input.name || 'Icon').replace(/\.svg$/i, '').slice(0, 60), url: ref ?? storage.publicUrl('task-files', path), tint: !!input.tint, created_at: new Date().toISOString() }
  const { error } = await (lib.db as any).from('tenants').update({ settings: { ...lib.settings, apps: { ...lib.apps, icons: [...lib.icons, icon] } } }).eq('id', ctx.tenantId)
  if (error) throw dbError(error)
  await audit(ctx, { objectType: 'workspace', objectId: ctx.tenantId, action: 'update', summary: `Uploaded app icon "${icon.name}"`, metadata: { icon_id: id } })
  return icon
}
