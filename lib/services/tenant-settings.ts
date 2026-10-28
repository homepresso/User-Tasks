/**
 * Workspace (tenants row) settings writes. End users have no UPDATE policy on
 * `tenants` (20261031000000_tenant_settings_lockdown.sql), so every change goes
 * through here: `settings.edit` check, service-role write scoped to
 * ctx.tenantId, audit row. JSON columns are merged, never replaced, so one
 * setting can't wipe its neighbours (the old logo upload replaced `branding`).
 */

import { requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'
import { getPublicConfig } from '@/lib/config/public'
import { getStorageProviderId } from '@/lib/providers/storage'
import { persistableStorageValue } from '@/lib/storage/persist'
import { tenantFolderObject } from '@/lib/storage/refs'

/* eslint-disable @typescript-eslint/no-explicit-any -- tenants JSON columns are untyped */

type Json = Record<string, unknown>

async function loadTenant(ctx: ServiceContext, columns: string) {
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('tenants').select(columns).eq('id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workspace not found')
  return { db, tenant: data as Json }
}

function asObject(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Json) } : {}
}

/**
 * Logo URLs must be this workspace's object in the `logos` bucket of our own
 * storage — a `storage://` reference, the app's /files route, or a Supabase
 * public URL of our own project — no arbitrary external images in the sidebar.
 */
export function isWorkspaceLogoUrl(url: string, tenantId: string, supabaseUrl?: string): boolean {
  const config = supabaseUrl === undefined ? undefined : { ...getPublicConfig(), supabaseUrl }
  return tenantFolderObject(url, 'logos', tenantId, config) !== null
}

/** Set (or clear, with null) the workspace logo; other `branding` keys are kept. */
export async function setWorkspaceLogo(ctx: ServiceContext, logoUrl: string | null) {
  requirePerm(ctx, 'settings.edit')
  if (logoUrl !== null && (typeof logoUrl !== 'string' || !isWorkspaceLogoUrl(logoUrl, ctx.tenantId))) {
    throw ServiceError.validation("logo_url must be this workspace's upload in the logos bucket")
  }
  const stored = logoUrl === null ? null : String(persistableStorageValue(logoUrl, await getStorageProviderId()))
  const { db, tenant } = await loadTenant(ctx, 'id, branding')
  const before = asObject(tenant.branding)
  const branding = { ...before }
  if (stored) branding.logo_url = stored
  else delete branding.logo_url

  const { error } = await (db as any).from('tenants').update({ branding }).eq('id', ctx.tenantId)
  if (error) throw dbError(error)
  await audit(ctx, {
    objectType: 'workspace', objectId: ctx.tenantId, action: 'update',
    summary: logoUrl ? 'Updated the workspace logo' : 'Removed the workspace logo',
    diff: { logo_url: { before: before.logo_url ?? null, after: stored } },
  })
  return { branding }
}

export interface OnboardingInput {
  name: string
  slug: string
  contact_name?: string | null
  contact_email?: string | null
  industry?: string | null
  company_size?: string | null
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,62}$/

/**
 * First-run workspace details (name, slug, contact) + onboarding_completed.
 * Same rule as any other workspace rename: `settings.edit` (the provisioned
 * owner holds it).
 */
export async function completeOnboarding(ctx: ServiceContext, input: OnboardingInput) {
  requirePerm(ctx, 'settings.edit')
  const name = String(input.name ?? '').trim()
  const slug = String(input.slug ?? '').trim().toLowerCase()
  if (!name || !slug) throw ServiceError.validation('name and slug are required')
  if (slug.length < 3) throw ServiceError.validation('Slug must be at least 3 characters')
  if (!SLUG_RE.test(slug)) throw ServiceError.validation('Slug may only contain lowercase letters, numbers and hyphens')

  const db = await serviceRoleClient(ctx)
  const { data: taken } = await (db as any).from('tenants').select('id')
    .eq('slug', slug).is('deleted_at', null).neq('id', ctx.tenantId)
  if (taken && taken.length > 0) throw ServiceError.conflict('This slug is already taken')

  const { error } = await (db as any).from('tenants').update({
    name,
    slug,
    contact_name: input.contact_name ?? null,
    contact_email: input.contact_email ?? null,
    industry: input.industry ?? null,
    company_size: input.company_size ?? null,
    onboarding_completed: true,
  }).eq('id', ctx.tenantId)
  if (error) throw dbError(error)
  await audit(ctx, {
    objectType: 'workspace', objectId: ctx.tenantId, action: 'update',
    summary: `Completed workspace setup as "${name}"`,
    metadata: { slug },
  })
  return { slug }
}
