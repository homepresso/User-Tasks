/**
 * The workspace sign-in page for forms and apps (lib/forms/sign-in-page.ts)
 * on the server: tenants.settings.sign_in — no table of its own, so no
 * migration. Workspaces that saved it before it was shared still have it at
 * tenants.settings.forms.sign_in: read as the fallback, and the next save
 * writes the shared key (the old copy is left as it was, unused).
 *
 *  - Any member reads it (the settings card, REST GET, MCP); settings.edit
 *    changes it (audited). The logo must be an upload in the workspace's own
 *    logos folder (logos/<tenant>/form-sign-in.<ext>).
 *  - The public page (/sign-in, /form-login) reads it with the service client by
 *    workspace, and gets only what it draws: these settings, the workspace's
 *    name and slug, and — when the page uses the workspace theme — the
 *    theme, which the page turns into CSS tokens on the server. Nothing
 *    else of the workspace leaves the server.
 */

import { formSignInLogo, type FormSignInLogo } from '@/lib/forms/sign-in-logo'
import { readWorkspaceTheme } from './workspace-theme'
import {
  DEFAULT_SIGN_IN_SETTINGS, SIGN_IN_SETTINGS_KEY, applyFormSignInPatch, cleanOrgSlug, formSignInInputProblem, parseAppSignInChoice,
  signInSettingsFromTenantSettings, type AppSignInChoice, type FormSignInSettings,
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

/** The workspace's sign-in page settings (any member). */
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
    throw ServiceError.validation('logo_url must be an image uploaded to this workspace’s logos (Settings → Sign-in page).')
  }
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('tenants').select('id, settings').eq('id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workspace not found')
  const settings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? { ...data.settings } : {}
  const before = signInSettingsFromTenantSettings(settings)
  const next = applyFormSignInPatch(before, patch)
  settings[SIGN_IN_SETTINGS_KEY] = next
  const { error: writeError } = await (db as any).from('tenants').update({ settings }).eq('id', ctx.tenantId)
  if (writeError) throw dbError(writeError)
  const changed = (Object.keys(next) as Array<keyof FormSignInSettings>).filter((k) => next[k] !== before[k])
  await audit(ctx, {
    objectType: 'workspace', objectId: ctx.tenantId, action: 'update',
    summary: changed.length ? `Changed the sign-in page (${changed.join(', ')})` : 'Saved the sign-in page (no change)',
    diff: { [SIGN_IN_SETTINGS_KEY]: { before, after: next } },
  })
  return next
}

/** The shared names (the form-named ones stay for existing callers). */
export const getSignInPageSettings = getFormSignInSettings
export const setSignInPageSettings = setFormSignInSettings

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
  /**
   * The app being signed in to (an app return path), when the workspace has
   * one with that slug: its own sign-in choice and colour. Never its name —
   * the page doesn't say which apps exist.
   */
  app?: { choice: AppSignInChoice; color: string | null } | null
}

/** What /sign-in and /form-login draw for a workspace (service client; only the fields the page shows). */
export async function loadPublicSignInPage(tenantId: string | null, options: { appSlug?: string | null } = {}): Promise<PublicSignInPage> {
  const fallback: PublicSignInPage = { settings: { ...DEFAULT_SIGN_IN_SETTINGS }, workspace: null, theme: null }
  if (!tenantId) return fallback
  try {
    const db = await formSignInDeps.serviceClient()
    const [{ data }, app] = await Promise.all([
      (db as any).from('tenants').select('name, slug, settings').eq('id', tenantId).maybeSingle(),
      options.appSlug ? appSignInFacts(db, tenantId, options.appSlug) : Promise.resolve(null),
    ])
    if (!data) return fallback
    const settings = signInSettingsFromTenantSettings(data.settings)
    let theme: WorkspaceTheme | null = null
    if (settings.use_workspace_theme) {
      try {
        theme = (await readWorkspaceTheme(db, tenantId)).theme
      } catch { /* the UserTasks look */ }
    }
    return {
      settings,
      workspace: { name: String(data.name ?? ''), slug: String(data.slug ?? '') },
      theme,
      app,
    }
  } catch {
    return fallback
  }
}

const HEX_RE = /^#[0-9a-f]{6}$/i

/** An app's sign-in choice and colour (service client), or null when there is no app with that slug. */
async function appSignInFacts(db: AnySupabaseClient, tenantId: string, slug: string): Promise<PublicSignInPage['app']> {
  try {
    const { data } = await (db as any).from('apps').select('color, settings').eq('tenant_id', tenantId).eq('slug', slug).maybeSingle()
    if (!data) return null
    const color = typeof data.color === 'string' && HEX_RE.test(data.color) ? data.color.toLowerCase() : null
    return { choice: parseAppSignInChoice((data.settings as { sign_in_page?: unknown } | null)?.sign_in_page), color }
  } catch {
    return null
  }
}

/** The workspace with this slug (an ?org= hint on the main address), or null. */
export async function tenantBySlug(slug: string | null | undefined): Promise<{ id: string; slug: string } | null> {
  const clean = cleanOrgSlug(slug)
  if (!clean) return null
  try {
    const db = await formSignInDeps.serviceClient()
    const { data } = await (db as any).from('tenants').select('id, slug').eq('slug', clean).maybeSingle()
    return typeof data?.id === 'string' ? { id: data.id, slug: String(data.slug ?? clean) } : null
  } catch {
    return null
  }
}

/**
 * The form's own logo choice for its sign-in page (lib/forms/sign-in-logo.ts): the form
 * named by /f/<id> or /form/<system name> in this workspace, its published header, and
 * the workspace theme's logo for "Workspace logo". Inherit on anything missing.
 */
export async function formSignInLogoChoice(tenantId: string | null, ref: { formId?: string | null; formName?: string | null }): Promise<FormSignInLogo> {
  if (!tenantId || (!ref.formId && !ref.formName)) return { kind: 'inherit' }
  try {
    const db = await formSignInDeps.serviceClient()
    let query = (db as any).from('forms').select('header').eq('tenant_id', tenantId)
    query = ref.formId ? query.eq('id', ref.formId) : query.eq('system_name', ref.formName)
    const { data } = await query.maybeSingle()
    if (!data) return { kind: 'inherit' }
    const header = data.header as { enabled?: unknown; image?: unknown } | null
    let workspaceLogo: string | null = null
    if (header?.enabled === true && header.image === 'workspace_logo') {
      try {
        const branding = (await readWorkspaceTheme(db, tenantId)).theme.branding
        workspaceLogo = branding.logoLight ?? branding.logoDark ?? null
      } catch { /* inherit */ }
    }
    return formSignInLogo(data.header, workspaceLogo)
  } catch {
    return { kind: 'inherit' }
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
