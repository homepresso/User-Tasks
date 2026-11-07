/**
 * The form sign-in page (lib/forms/sign-in-page.ts) on the server:
 * tenants.settings.forms.sign_in — no table of its own, so no migration.
 *
 *  - Any member reads it (the settings card, REST GET, MCP); settings.edit
 *    changes it (audited). The logo must be an upload in the workspace's own
 *    logos folder (logos/<tenant>/form-sign-in.<ext>).
 *  - The public page (/form-login) reads it with the service client by
 *    workspace, and gets only what it draws: these settings, the workspace's
 *    name and slug, and — when the page uses the workspace theme — the
 *    theme, which the page turns into CSS tokens on the server. Nothing
 *    else of the workspace leaves the server.
 */

import {
  DEFAULT_SIGN_IN_SETTINGS, applyFormSignInPatch, formSignInInputProblem, signInSettingsFromTenantSettings,
  type FormSignInSettings,
} from '@/lib/forms/sign-in-page'
import { tenantFolderObject } from '@/lib/storage/refs'
import type { WorkspaceTheme } from '@/lib/theme/schema'
import { requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- tenants.settings is untyped JSON */

export const formSignInDeps = {
  serviceClient: async (): Promise<AnySupabaseClient> => (await import('@/lib/cron-auth')).createServiceClient() as AnySupabaseClient,
}

async function readSettings(db: AnySupabaseClient, tenantId: string): Promise<FormSignInSettings> {
  const { data, error } = await (db as any).from('tenants').select('settings').eq('id', tenantId).maybeSingle()
  if (error) throw dbError(error)
  return signInSettingsFromTenantSettings(data?.settings)
}

/** The workspace's form sign-in page settings (any member). */
export async function getFormSignInSettings(ctx: ServiceContext): Promise<FormSignInSettings> {
  return readSettings(await serviceRoleClient(ctx), ctx.tenantId)
}

/**
 * Change some of the settings (settings.edit); the rest, and every other
 * key of tenants.settings, are kept. `''` clears logo_url, support_link_url
 * and accent_color. Audited.
 */
export async function setFormSignInSettings(ctx: ServiceContext, input: unknown): Promise<FormSignInSettings> {
  requirePerm(ctx, 'settings.edit')
  const problem = formSignInInputProblem(input)
  if (problem) throw ServiceError.validation(problem)
  const patch = input as Record<string, unknown>
  if (typeof patch.logo_url === 'string' && patch.logo_url && tenantFolderObject(patch.logo_url, 'logos', ctx.tenantId) === null) {
    throw ServiceError.validation('logo_url must be an image uploaded to this workspace’s logos (Settings → Forms → Form sign-in page).')
  }
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('tenants').select('id, settings').eq('id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workspace not found')
  const settings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? { ...data.settings } : {}
  const before = signInSettingsFromTenantSettings(settings)
  const next = applyFormSignInPatch(before, patch)
  const forms = settings.forms && typeof settings.forms === 'object' && !Array.isArray(settings.forms) ? { ...settings.forms } : {}
  forms.sign_in = next
  settings.forms = forms
  const { error: writeError } = await (db as any).from('tenants').update({ settings }).eq('id', ctx.tenantId)
  if (writeError) throw dbError(writeError)
  const changed = (Object.keys(next) as Array<keyof FormSignInSettings>).filter((k) => next[k] !== before[k])
  await audit(ctx, {
    objectType: 'workspace', objectId: ctx.tenantId, action: 'update',
    summary: changed.length ? `Changed the form sign-in page (${changed.join(', ')})` : 'Saved the form sign-in page (no change)',
    diff: { 'forms.sign_in': { before, after: next } },
  })
  return next
}

/* ── The public page ─────────────────────────────────────────────────── */

export interface PublicSignInPage {
  settings: FormSignInSettings
  /** The workspace the page signs in to; null when the link doesn't name one (a /form/<name> link on the main address). */
  workspace: { name: string; slug: string } | null
  /**
   * The workspace theme, read only when the page uses it (use_workspace_theme);
   * stays on the server — the page passes on just its CSS tokens
   * (lib/forms/sign-in-theme.ts).
   */
  theme: WorkspaceTheme | null
}

/** What /form-login draws for a workspace (service client; only the fields the page shows). */
export async function loadPublicSignInPage(tenantId: string | null): Promise<PublicSignInPage> {
  const fallback: PublicSignInPage = { settings: { ...DEFAULT_SIGN_IN_SETTINGS }, workspace: null, theme: null }
  if (!tenantId) return fallback
  try {
    const db = await formSignInDeps.serviceClient()
    const { data } = await (db as any).from('tenants').select('name, slug, settings').eq('id', tenantId).maybeSingle()
    if (!data) return fallback
    const settings = signInSettingsFromTenantSettings(data.settings)
    let theme: WorkspaceTheme | null = null
    if (settings.use_workspace_theme) {
      try {
        const { readWorkspaceTheme } = await import('./workspace-theme')
        theme = (await readWorkspaceTheme(db, tenantId)).theme
      } catch { /* the UserTasks look */ }
    }
    return {
      settings,
      workspace: { name: String(data.name ?? ''), slug: String(data.slug ?? '') },
      theme,
    }
  } catch {
    return fallback
  }
}

/** The workspace a form belongs to (for /f/<id> links on the main address), or null. */
export async function tenantOfForm(formId: string): Promise<string | null> {
  try {
    const db = await formSignInDeps.serviceClient()
    const { data } = await (db as any).from('forms').select('tenant_id').eq('id', formId).maybeSingle()
    return typeof data?.tenant_id === 'string' ? data.tenant_id : null
  } catch {
    return null
  }
}
