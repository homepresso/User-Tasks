/**
 * Form accessibility on the server: the workspace setting
 * (tenants.settings.forms.accessibility — lib/forms/accessibility/settings),
 * the check of a reusable form (POST /api/v1/forms/{id}/accessibility, MCP
 * forms_check_accessibility, `usertasks forms check-accessibility`) and the
 * pre-publish gate lib/services/forms runs on create / update (so "Publish
 * as form page" and form syncs too) when the mode is `block`.
 *
 * Colours are resolved here as the designer resolves them: the workspace
 * theme's light and dark palettes (workspace_themes) and a saved form
 * theme's overrides (form_themes), so the server and the designer score the
 * same definition the same way. Config-as-code / package imports skip the
 * gate (an import must not fail half way on a policy the source workspace
 * didn't have).
 */

import { normalizeFormDefinition, type FormDefinition } from '@/lib/forms/definition'
import { parseFormThemeOverrides, type FormThemeOverrides } from '@/lib/forms/form-theme'
import { checkFormAccessibility, describeFindings, type AccessibilityResult, type CheckOptions } from '@/lib/forms/accessibility'
import {
  DEFAULT_FORM_ACCESSIBILITY, formAccessibilityFromTenantSettings, type FormAccessibilitySettings,
} from '@/lib/forms/accessibility/settings'
import { parseStoredTheme } from '@/lib/theme/resolve'
import { getDb, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- tenants / theme JSON columns are untyped */

export async function readFormAccessibilitySettings(db: AnySupabaseClient, tenantId: string): Promise<FormAccessibilitySettings> {
  try {
    const { data, error } = await (db as any).from('tenants').select('settings').eq('id', tenantId).maybeSingle()
    if (error) return DEFAULT_FORM_ACCESSIBILITY
    return formAccessibilityFromTenantSettings(data?.settings)
  } catch {
    return DEFAULT_FORM_ACCESSIBILITY
  }
}

/** The workspace's setting (any member: the designer needs it). */
export async function getFormAccessibilitySettings(ctx: ServiceContext): Promise<FormAccessibilitySettings> {
  return readFormAccessibilitySettings(getDb(ctx), ctx.tenantId)
}

/** Change the setting (settings.edit); other `settings` keys are kept. */
export async function setFormAccessibilitySettings(ctx: ServiceContext, input: { mode?: unknown; min_score?: unknown }): Promise<FormAccessibilitySettings> {
  requirePerm(ctx, 'settings.edit')
  if (input.mode !== undefined && input.mode !== 'off' && input.mode !== 'warn' && input.mode !== 'block') throw ServiceError.validation('mode must be off, warn or block')
  if (input.min_score !== undefined) {
    const n = Number(input.min_score)
    if (!Number.isInteger(n) || n < 0 || n > 100) throw ServiceError.validation('min_score must be a whole number from 0 to 100')
  }
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('tenants').select('id, settings').eq('id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workspace not found')
  const settings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? { ...data.settings } : {}
  const before = formAccessibilityFromTenantSettings(settings)
  const next: FormAccessibilitySettings = {
    mode: (input.mode as FormAccessibilitySettings['mode'] | undefined) ?? before.mode,
    min_score: input.min_score !== undefined ? Number(input.min_score) : before.min_score,
  }
  const forms = settings.forms && typeof settings.forms === 'object' && !Array.isArray(settings.forms) ? { ...settings.forms } : {}
  forms.accessibility = next
  settings.forms = forms
  const { error: updateError } = await (db as any).from('tenants').update({ settings }).eq('id', ctx.tenantId)
  if (updateError) throw dbError(updateError)
  await audit(ctx, {
    objectType: 'workspace', objectId: ctx.tenantId, action: 'update',
    summary: `Set the form accessibility check to ${next.mode} (minimum score ${next.min_score})`,
    diff: { 'forms.accessibility': { before, after: next } },
  })
  return next
}

/** Colours the form draws with: the workspace palettes and the concrete mini theme. */
export async function resolveCheckTheme(db: AnySupabaseClient, tenantId: string, def: FormDefinition): Promise<NonNullable<CheckOptions['theme']>> {
  let theme = parseStoredTheme(null)
  try {
    const { data } = await (db as any).from('workspace_themes').select('theme').eq('tenant_id', tenantId).maybeSingle()
    theme = parseStoredTheme(data?.theme)
  } catch { /* the platform default */ }
  let overrides: FormThemeOverrides | null = null
  if (def.theme.source === 'custom') overrides = def.theme.overrides
  else if (def.theme.source === 'saved') {
    try {
      const { data } = await (db as any).from('form_themes').select('overrides').eq('id', def.theme.theme_id).eq('tenant_id', tenantId).maybeSingle()
      overrides = parseFormThemeOverrides(data?.overrides)
    } catch { overrides = null }
  }
  return { light: theme.colors.light, dark: theme.colors.dark, overrides }
}

export async function checkDefinition(db: AnySupabaseClient, tenantId: string, def: FormDefinition): Promise<AccessibilityResult> {
  return checkFormAccessibility(def, { theme: await resolveCheckTheme(db, tenantId, def), language: 'en' })
}

/**
 * Check a reusable form (forms.view): its latest version, or `definition`
 * (an unsaved draft of it: fields, layout, theme, buttons, header).
 */
export async function checkFormAccessibilityFor(ctx: ServiceContext, formId: string, input: { definition?: Record<string, unknown> | null } = {}) {
  requirePerm(ctx, 'forms.view')
  const { getForm } = await import('./forms')
  const form = await getForm(ctx, formId) as any
  const def = normalizeFormDefinition(input.definition && typeof input.definition === 'object' ? input.definition as any : form)
  const settings = await getFormAccessibilitySettings(ctx)
  const result = await checkDefinition(getDb(ctx), ctx.tenantId, def)
  return {
    form_id: String(form.id),
    form_version: Number(form.version),
    checked: input.definition ? 'definition' as const : 'saved' as const,
    ...result,
    policy: { ...settings, passes: settings.mode === 'off' || result.score >= settings.min_score },
  }
}

/**
 * The pre-publish gate: with mode `block`, a definition scoring below the
 * workspace's min_score is refused with its top findings.
 */
export async function assertFormAccessibility(db: AnySupabaseClient, tenantId: string, def: FormDefinition): Promise<void> {
  const settings = await readFormAccessibilitySettings(db, tenantId)
  if (settings.mode !== 'block') return
  const result = await checkDefinition(db, tenantId, def)
  if (result.score >= settings.min_score) return
  const blocking = result.findings.filter((f) => f.severity !== 'review')
  throw ServiceError.validation(
    `Accessibility score ${result.score} is below this workspace's minimum of ${settings.min_score}. Fix: ${describeFindings(blocking)}`,
    { accessibility: { score: result.score, min_score: settings.min_score, findings: blocking.slice(0, 10).map(({ id, rule, severity, wcag, field_key, message }) => ({ id, rule, severity, wcag, field_key, message })) } },
  )
}
